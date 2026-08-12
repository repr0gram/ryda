import WidgetKit
import SwiftUI
import RydaKit
import Security

@main
struct RydaWidgetBundle: WidgetBundle {
    var body: some Widget { LastRideWidget() }
}

struct LastRideWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LastRide", provider: LastRideProvider()) { entry in
            LastRideView(entry: entry)
                .containerBackground(Palette.surface1, for: .widget)
        }
        .configurationDisplayName("Last ride")
        .description("Your most recent ride, and how long ago it was.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// Sendable because WidgetKit's completion handlers are `@Sendable`, so the
/// timeline has to be able to cross a concurrency boundary to reach them.
struct LastRideEntry: TimelineEntry, Sendable {
    let date: Date
    let state: State

    enum State: Sendable {
        case ride(Summary.LatestRide, daysSince: Int, form: Double)
        case noRides
        case signedOut
        /// The keychain refused the read — an entitlement problem, not a
        /// sign-in problem, and signing in again will not touch it.
        case unreachable(OSStatus)
        /// Last known good data, when the network failed this time round.
        case stale(Summary.LatestRide, daysSince: Int, asOf: Date)
    }
}

struct LastRideProvider: TimelineProvider {
    func placeholder(in context: Context) -> LastRideEntry {
        LastRideEntry(date: Date(), state: .ride(Self.sample, daysSince: 1, form: -11))
    }

    /// The Widget Gallery. Must return synchronously and must never touch the
    /// network — a spinner here is what stops people adding the widget at all.
    func getSnapshot(in context: Context, completion: @escaping @Sendable (LastRideEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(await fetch()) }
    }

    func getTimeline(
        in context: Context,
        completion: @escaping @Sendable (Timeline<LastRideEntry>) -> Void
    ) {
        Task {
            let entry = await fetch()
            var entries = [entry]

            // Extra entries at the next local midnights, with the day count
            // recomputed offline. Without these a widget shows "2 days ago"
            // until its next network refresh happens to land, which is how
            // single-entry widgets are always subtly wrong about dates.
            if case .ride(let ride, let days, let form) = entry.state {
                for ahead in 1...2 {
                    if let midnight = Self.midnight(daysAhead: ahead) {
                        entries.append(
                            LastRideEntry(
                                date: midnight,
                                state: .ride(ride, daysSince: days + ahead, form: form)
                            )
                        )
                    }
                }
            }

            // 45 minutes sits comfortably inside WidgetKit's daily budget.
            // A ride appears when one is imported, which is rare; refreshing
            // harder just gets the widget throttled into staleness.
            let next: Date
            switch entry.state {
            case .signedOut: next = .now.addingTimeInterval(4 * 3600)
            case .unreachable: next = .now.addingTimeInterval(4 * 3600)
            case .noRides: next = .now.addingTimeInterval(6 * 3600)
            case .stale: next = .now.addingTimeInterval(15 * 60)
            case .ride: next = .now.addingTimeInterval(45 * 60)
            }
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }

    /// The widget calls exactly one endpoint, and it must stay that way: a
    /// widget extension has roughly a 30 MB ceiling, and decoding a ride's
    /// streams in here would get it killed.
    private func fetch() async -> LastRideEntry {
        let api = RydaEnvironment.api()
        switch await api.tokenStatus() {
        case .present:
            break
        case .absent:
            return LastRideEntry(date: .now, state: .signedOut)
        case .unreadable(let status):
            // Distinct from signed-out on purpose. This is the failure mode
            // where the widget cannot see the keychain group the app writes to,
            // and reporting it as "sign in" would send the rider round a loop
            // they can never complete.
            return LastRideEntry(date: .now, state: .unreachable(status))
        }
        do {
            let response = try await api.summary(today: Format.localToday())
            switch response {
            case .empty:
                return LastRideEntry(date: .now, state: .noRides)
            case .populated(let summary):
                SummaryCache.save(summary)
                return LastRideEntry(
                    date: .now,
                    state: .ride(
                        summary.latestRide,
                        daysSince: summary.daysSinceLastRide,
                        form: summary.form
                    )
                )
            }
        } catch APIError.unauthorized {
            return LastRideEntry(date: .now, state: .signedOut)
        } catch {
            // Never a blank widget and never a stale number presented as
            // current: show the last good figures, labelled with when they were.
            if let cached = SummaryCache.load() {
                return LastRideEntry(
                    date: .now,
                    state: .stale(
                        cached.summary.latestRide,
                        daysSince: cached.summary.daysSinceLastRide,
                        asOf: cached.savedAt
                    )
                )
            }
            return LastRideEntry(date: .now, state: .signedOut)
        }
    }

    private static func midnight(daysAhead: Int) -> Date? {
        let calendar = Calendar.current
        guard let day = calendar.date(byAdding: .day, value: daysAhead, to: .now) else { return nil }
        return calendar.startOfDay(for: day)
    }

    static let sample = Summary.LatestRide(
        id: "sample", name: "Afternoon Ride", startedAt: .now,
        distanceKm: 105.8, movingSeconds: 15919,
        elevationGainMeters: 262, weightedPower: 122, load: 182
    )
}
