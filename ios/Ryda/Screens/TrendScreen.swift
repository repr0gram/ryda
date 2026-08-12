import SwiftUI
import Charts
import RydaKit

struct TrendScreen: View {
    @Environment(SessionStore.self) private var session

    @State private var trend: TrendResponse?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let trend, trend.hasRides {
                    content(trend)
                } else if let error {
                    ContentUnavailableView("Couldn't load your trend", systemImage: "chart.xyaxis.line", description: Text(error))
                        .padding(.top, 60)
                } else if trend != nil {
                    ContentUnavailableView(
                        "Nothing to plot yet",
                        systemImage: "chart.xyaxis.line",
                        description: Text("Fitness and form need a few rides before they mean anything.")
                    )
                    .padding(.top, 60)
                } else {
                    ProgressView().tint(Palette.inkMuted).padding(.top, 60)
                }
            }
            .background(Palette.surface0)
            .navigationTitle("Trend")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func content(_ trend: TrendResponse) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 1) {
                stat("Fitness", trend.fitness, Palette.power)
                stat("Fatigue", trend.fatigue, Palette.heartRate)
                stat("Form", trend.form, Palette.speed)
            }
            .background(Palette.hairline)
            .clipShape(.rect(cornerRadius: 14))

            Chart {
                ForEach(trend.series) { point in
                    AreaMark(
                        x: .value("Day", point.date),
                        y: .value("Fitness", point.fitness)
                    )
                    .foregroundStyle(Palette.power.opacity(0.16))

                    LineMark(
                        x: .value("Day", point.date),
                        y: .value("Fitness", point.fitness)
                    )
                    .foregroundStyle(Palette.power)

                    LineMark(
                        x: .value("Day", point.date),
                        y: .value("Fatigue", point.fatigue)
                    )
                    .foregroundStyle(Palette.heartRate)
                }
                RuleMark(y: .value("Zero", 0))
                    .foregroundStyle(Palette.hairline)
            }
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .trailing) {
                    AxisValueLabel().font(.caption2).foregroundStyle(Palette.inkMuted)
                    AxisGridLine().foregroundStyle(Palette.hairline)
                }
            }
            .frame(height: 220)
            .padding(14)
            .background(Palette.surface1, in: .rect(cornerRadius: 14))

            VStack(alignment: .leading, spacing: 6) {
                Text("Form is fitness minus fatigue, read before today's ride is folded in. Negative means you're carrying more fatigue than fitness — which is where training actually happens, as long as it doesn't stay there.")
                if let ramp = trend.rampRate {
                    Text("Ramp rate \(ramp > 0 ? "+" : "")\(Format.whole(ramp)) fitness per week. Sustained above about +5 to +8 is where injury risk starts climbing.")
                }
            }
            .font(.caption2)
            .foregroundStyle(Palette.inkMuted)
        }
        .padding(16)
    }

    private func stat(_ label: String, _ value: Double?, _ colour: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .medium))
                .foregroundStyle(Palette.inkMuted)
            Text(value.map { Format.whole($0) } ?? "—")
                .font(.title2.weight(.medium))
                .foregroundStyle(colour)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Palette.surface1)
    }

    private func load() async {
        do {
            trend = try await session.api.trend(days: 120, today: Format.localToday())
            error = nil
        } catch APIError.unauthorized {
            await session.signOut()
        } catch {
            self.error = String(describing: error)
        }
    }
}
