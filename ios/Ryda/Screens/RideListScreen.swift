import SwiftUI
import RydaKit

struct RideListScreen: View {
    @Environment(SessionStore.self) private var session
    @Binding var deepLinkedRide: String?

    @State private var rides: [RideSummary] = []
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Palette.statusCritical)
                }
                if loaded && rides.isEmpty && error == nil {
                    ContentUnavailableView(
                        "No rides yet",
                        systemImage: "bicycle",
                        description: Text("Import rides on the website and sync them, and they'll appear here.")
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(rides) { ride in
                    NavigationLink(value: ride.id) {
                        RideRow(ride: ride)
                    }
                    .listRowBackground(Palette.surface1)
                }
            }
            .listStyle(.plain)
            .background(Palette.surface0)
            .navigationTitle("Rides")
            .navigationDestination(for: String.self) { RideDetailScreen(rideId: $0) }
            .refreshable { await load() }
            .task { await load() }
            // A widget tap arrives as a ride id; push it once the list exists so
            // Back lands somewhere sensible rather than on an empty stack.
            .navigationDestination(item: $deepLinkedRide) { RideDetailScreen(rideId: $0) }
        }
    }

    private func load() async {
        do {
            rides = try await session.api.rides()
            error = nil
        } catch APIError.unauthorized {
            await session.signOut()
        } catch {
            self.error = "Couldn't reach Ryda. \(error.localizedDescription)"
        }
        loaded = true
    }
}

private struct RideRow: View {
    let ride: RideSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(ride.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                Spacer()
                Text(ride.startedAt, format: .dateTime.day().month(.abbreviated))
                    .font(.caption)
                    .foregroundStyle(Palette.inkMuted)
            }
            HStack(spacing: 14) {
                metric(Format.distance(ride.distanceMeters), "km")
                metric(Format.duration(ride.movingSeconds), "")
                metric(Format.whole(ride.elevationGainMeters), "m")
                metric(Format.whole(ride.weightedPower), "W")
                metric(Format.whole(ride.load), "load")
            }
        }
        .padding(.vertical, 4)
    }

    private func metric(_ value: String, _ unit: String) -> some View {
        HStack(spacing: 2) {
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Palette.inkSecondary)
            if !unit.isEmpty {
                Text(unit).font(.caption2).foregroundStyle(Palette.inkMuted)
            }
        }
    }
}
