import SwiftUI
import RydaKit

struct RideDetailScreen: View {
    let rideId: String
    @Environment(SessionStore.self) private var session

    @State private var streams: RideStreams?
    @State private var response: StreamsResponse?
    @State private var error: String?
    @State private var cursor = CursorModel()

    var body: some View {
        ScrollView {
            if let streams, let response {
                content(streams, response)
            } else if let error {
                ContentUnavailableView("Couldn't load this ride", systemImage: "exclamationmark.triangle", description: Text(error))
                    .padding(.top, 60)
            } else {
                ProgressView().tint(Palette.inkMuted).padding(.top, 60)
            }
        }
        .background(Palette.surface0)
        .navigationTitle(response?.estimate == nil ? "Ride" : (rideName ?? "Ride"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var rideName: String? { nil }

    @ViewBuilder
    private func content(_ s: RideStreams, _ r: StreamsResponse) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let metrics = r.analysis {
                StatGrid(metrics: metrics, estimated: s.estimateSource == .estimated)
            }

            if !s.coordinates.isEmpty {
                RouteMap(
                    coordinates: s.coordinates,
                    distance: s.distance,
                    channel: s.power,
                    colour: Palette.power,
                    marker: cursor.index
                )
                .frame(height: 260)
                .clipShape(.rect(cornerRadius: 14))
            }

            VStack(alignment: .leading, spacing: 14) {
                if let power = s.power {
                    ChannelChart(
                        title: s.estimateSource == .estimated ? "Power (estimated)" : "Power",
                        unit: "W", colour: Palette.power,
                        x: s.time, y: power, cursor: cursor
                    )
                }
                if let hr = s.heartRate {
                    ChannelChart(
                        title: "Heart rate", unit: "bpm", colour: Palette.heartRate,
                        x: s.time, y: hr, cursor: cursor
                    )
                }
                ChannelChart(
                    title: "Elevation", unit: "m", colour: Palette.elevationLine,
                    x: s.time, y: s.altitude.map(Float.init), filled: true, cursor: cursor
                )
            }
            .padding(14)
            .background(Palette.surface1, in: .rect(cornerRadius: 14))

            if let zones = r.zones {
                VStack(alignment: .leading, spacing: 18) {
                    ZoneBars(
                        title: "Power",
                        caption: "against \(r.estimate?.settings.ftp ?? 0) W threshold",
                        slices: zones.power
                    )
                    if let hr = zones.heartRate {
                        ZoneBars(
                            title: "Heart rate",
                            caption: "against \(r.estimate?.settings.lthr ?? 0) bpm threshold",
                            slices: hr
                        )
                    } else {
                        Text("Set a threshold heart rate to see heart-rate zones. They're measured rather than modelled, so with no power meter they're the trustworthy half.")
                            .font(.caption2)
                            .foregroundStyle(Palette.inkMuted)
                    }
                }
                .padding(14)
                .background(Palette.surface1, in: .rect(cornerRadius: 14))
            }

            if let estimate = r.estimate {
                ConfidenceNote(estimate: estimate, sampled: s.sampleCount, full: s.fullSampleCount)
            }
        }
        .padding(16)
    }

    private func load() async {
        do {
            let response = try await session.api.streams(rideId: rideId)
            self.streams = try RideStreams(response: response)
            self.response = response
        } catch APIError.unauthorized {
            await session.signOut()
        } catch {
            self.error = String(describing: error)
        }
    }
}

private struct StatGrid: View {
    let metrics: RideMetrics
    let estimated: Bool

    private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 1), count: 3) }

    /// Average speed over moving time, not elapsed — a coffee stop is not
    /// slow riding, and every other figure here already excludes stopped time.
    private var averageSpeedKmh: Double {
        metrics.movingSeconds > 0
            ? (metrics.distanceMeters / metrics.movingSeconds) * 3.6
            : 0
    }

    var body: some View {
        // Three rows of three, grouped by what each row answers: how far and how
        // long, how hard, and what it cost.
        LazyVGrid(columns: columns, spacing: 1) {
            tile("Distance", Format.distance(metrics.distanceMeters), "km")
            tile("Moving", Format.duration(Int(metrics.movingSeconds)), "")
            tile("Climbing", Format.whole(metrics.elevationGainMeters), "m")

            tile("Weighted", Format.whole(metrics.weightedPower), "W")
            tile("Intensity", String(format: "%.2f", metrics.intensity), "")
            tile("Load", Format.whole(metrics.load), "")

            tile("Energy", metrics.calories.map { Format.calories($0) } ?? "—", "kcal")
            tile("Heart rate", metrics.meanHeartRate.map { Format.whole($0) } ?? "—", "bpm")
            tile("Speed", String(format: "%.1f", averageSpeedKmh), "km/h")
        }
        .background(Palette.hairline)
        .clipShape(.rect(cornerRadius: 14))
    }

    private func tile(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .medium))
                .foregroundStyle(Palette.inkMuted)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                // Proportional figures, not monospaced: these are hero numbers,
                // and the web app's .figure-hero makes the same choice.
                Text(value).font(.title3.weight(.medium)).foregroundStyle(Palette.ink)
                if !unit.isEmpty {
                    Text(unit).font(.caption2).foregroundStyle(Palette.inkMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Palette.surface1)
    }
}

private struct ConfidenceNote: View {
    let estimate: StreamsResponse.Estimate
    let sampled: Int
    let full: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Palette.confidence(estimate.confidence.level))
                    .frame(width: 7, height: 7)
                Text(estimate.confidence.level.capitalized + " confidence")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Palette.ink)
                Text(estimate.source == .estimated ? "· estimated, not measured" : "· measured")
                    .font(.caption)
                    .foregroundStyle(Palette.inkMuted)
            }
            Text(estimate.confidence.summary)
                .font(.caption2)
                .foregroundStyle(Palette.inkSecondary)

            if estimate.settingsSource == .default || !estimate.settings.configured {
                // The single most important caveat in the app. Without the
                // rider's own mass this is a confident number about a stranger.
                Text("These watts are modelled against a default \(Int(estimate.settings.riderKg)) kg rider — set your weight and threshold on the website to make them yours.")
                    .font(.caption2)
                    .foregroundStyle(Palette.statusWarning)
            }

            if sampled < full {
                Text("Charts drawn from \(sampled) of \(full) samples; every figure above is computed from all of them.")
                    .font(.caption2)
                    .foregroundStyle(Palette.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.surface1, in: .rect(cornerRadius: 14))
    }
}
