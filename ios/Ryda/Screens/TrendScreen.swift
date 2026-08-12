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

            // Every LineMark carries an explicit `series:`. Without it, two
            // lines sharing an x are one series to Swift Charts, and it draws a
            // single path zigzagging between fitness and fatigue on every day —
            // which looks exactly like a violently spiky curve, on a chart whose
            // whole point is that a 42-day average cannot be spiky.
            VStack(alignment: .leading, spacing: 10) {
            Chart {
                ForEach(trend.series) { point in
                    AreaMark(
                        x: .value("Day", day(point)),
                        y: .value("Fitness", point.fitness)
                    )
                    .foregroundStyle(Palette.power.opacity(0.14))

                    LineMark(
                        x: .value("Day", day(point)),
                        y: .value("Fitness", point.fitness),
                        series: .value("Series", "Fitness")
                    )
                    .foregroundStyle(Palette.power)
                    .lineStyle(.init(lineWidth: 1.8))

                    LineMark(
                        x: .value("Day", day(point)),
                        y: .value("Fatigue", point.fatigue),
                        series: .value("Series", "Fatigue")
                    )
                    .foregroundStyle(Palette.heartRate)
                    .lineStyle(.init(lineWidth: 1.2))

                    LineMark(
                        x: .value("Day", day(point)),
                        y: .value("Form", point.form),
                        series: .value("Series", "Form")
                    )
                    .foregroundStyle(Palette.speed)
                    .lineStyle(.init(lineWidth: 1.2))
                }
                RuleMark(y: .value("Zero", 0))
                    .foregroundStyle(Palette.hairline)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .month)) {
                    AxisValueLabel(format: .dateTime.month(.abbreviated))
                        .font(.caption2)
                        .foregroundStyle(Palette.inkMuted)
                    AxisGridLine().foregroundStyle(Palette.hairline)
                }
            }
            .chartYAxis {
                AxisMarks(position: .trailing) {
                    AxisValueLabel().font(.caption2).foregroundStyle(Palette.inkMuted)
                    AxisGridLine().foregroundStyle(Palette.hairline)
                }
            }
            .frame(height: 220)

            HStack(spacing: 14) {
                key("Fitness", Palette.power)
                key("Fatigue", Palette.heartRate)
                key("Form", Palette.speed)
            }
        }
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

    private func key(_ label: String, _ colour: Color) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(colour).frame(width: 14, height: 2)
            Text(label).font(.caption2).foregroundStyle(Palette.inkMuted)
        }
    }

    /// The series arrives as YYYY-MM-DD, deliberately a string elsewhere so a
    /// timezone can never shift which day a ride belongs to. Plotting wants a
    /// real date for spacing and month labels, so it is parsed here and nowhere
    /// else, at local noon — far enough from either midnight to be safe.
    private func day(_ point: TrendPoint) -> Date {
        let parts = point.date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return .now }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return Calendar.current.date(from: components) ?? .now
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
