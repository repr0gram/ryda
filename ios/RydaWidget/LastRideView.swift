import WidgetKit
import SwiftUI
import RydaKit

struct LastRideView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LastRideEntry

    var body: some View {
        switch entry.state {
        case .ride(let ride, let days, let form):
            body(for: ride, days: days, form: form, stale: nil)
        case .stale(let ride, let days, let asOf):
            body(for: ride, days: days, form: nil, stale: asOf)
        case .noRides:
            message("No rides yet", "Import one on the website.")
        case .signedOut:
            message("Sign in to Ryda", "Tap to open the app.")
                .widgetURL(URL(string: "ryda://signin"))
        case .unreachable(let status):
            message("Can't reach your session", "Keychain error \(status).")
                .widgetURL(URL(string: "ryda://signin"))
        }
    }

    @ViewBuilder
    private func body(
        for ride: Summary.LatestRide,
        days: Int,
        form: Double?,
        stale: Date?
    ) -> some View {
        // Medium is twice as wide as it is tall, so a row of figures under the
        // headline leaves the right-hand half empty and squeezes everything into
        // a strip. Two columns use the shape the family actually has: identity
        // and the headline number on the left, the read-out down the right.
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(ride.name)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)

                Text(stale == nil
                     ? Format.daysSince(days)
                     : "as of \(stale!.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(stale == nil ? Palette.inkMuted : Palette.statusWarning)

                Spacer(minLength: 4)

                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(String(format: "%.1f", ride.distanceKm))
                        .font(.system(size: family == .systemSmall ? 30 : 34, weight: .medium))
                        .foregroundStyle(Palette.ink)
                    Text("km").font(.caption).foregroundStyle(Palette.inkMuted)
                }

                if family == .systemSmall {
                    Spacer(minLength: 4)
                    HStack(spacing: 10) {
                        metric(Format.duration(ride.movingSeconds), "")
                        metric("\(ride.weightedPower)", "W")
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

            if family != .systemSmall {
                VStack(alignment: .leading, spacing: 5) {
                    row("Time", Format.duration(ride.movingSeconds), "")
                    row("Power", "\(ride.weightedPower)", "W")
                    row("Climb", "\(ride.elevationGainMeters)", "m")
                    row("Load", Format.whole(ride.load), "")
                    if let calories = ride.calories {
                        row("Energy", Format.calories(calories), "kcal")
                    } else if let form {
                        row("Form", (form > 0 ? "+" : "") + Format.whole(form), "")
                    }
                }
                .frame(maxHeight: .infinity, alignment: .center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "ryda://ride/\(ride.id)"))
    }

    /// A label/value pair for the right-hand column. Values are monospaced and
    /// right-aligned in a fixed width so the numbers line up as a column rather
    /// than ragging with their digit counts.
    private func row(_ label: String, _ value: String, _ unit: String) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(Palette.inkMuted)
                .frame(width: 42, alignment: .leading)
            Text(value)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(Palette.inkSecondary)
                .frame(width: 52, alignment: .trailing)
            Text(unit)
                .font(.system(size: 9))
                .foregroundStyle(Palette.inkMuted)
                .frame(width: 26, alignment: .leading)
        }
    }

    private func metric(_ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(value)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(Palette.inkSecondary)
            if !unit.isEmpty {
                Text(unit).font(.system(size: 9)).foregroundStyle(Palette.inkMuted)
            }
        }
    }

    private func message(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(Palette.ink)
            Text(detail).font(.caption2).foregroundStyle(Palette.inkMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

#Preview(as: .systemSmall) {
    LastRideWidget()
} timeline: {
    LastRideEntry(date: .now, state: .ride(LastRideProvider.sample, daysSince: 1, form: -11))
    LastRideEntry(date: .now, state: .signedOut)
}

#Preview(as: .systemMedium) {
    LastRideWidget()
} timeline: {
    LastRideEntry(date: .now, state: .ride(LastRideProvider.sample, daysSince: 0, form: -11))
}
