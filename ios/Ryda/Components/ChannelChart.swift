import SwiftUI
import Charts
import RydaKit

/// Where the scrub cursor is, kept deliberately outside the chart views.
///
/// This is the same decision the web app documents as "scrub position lives
/// outside React". If the index lived in the parent's `@State`, every drag frame
/// would re-render all three charts over their full point set, and a long ride
/// would feel broken. Only the readouts and the rule line observe this.
@Observable
@MainActor
final class CursorModel {
    var index: Int?
}

struct ChannelChart: View {
    let title: String
    let unit: String
    let colour: Color
    let x: [Double]
    let y: [Float]
    /// Filled area rather than a line — used for elevation, which is context.
    var filled = false
    let cursor: CursorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).font(.caption).foregroundStyle(Palette.inkSecondary)
                Spacer()
                Readout(unit: unit, y: y, colour: colour, cursor: cursor)
            }
            chart
                .frame(height: filled ? 64 : 90)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(Array(y.enumerated()), id: \.offset) { i, value in
                if filled {
                    AreaMark(x: .value("x", x[safe: i] ?? 0), y: .value(unit, value))
                        .foregroundStyle(colour.opacity(0.35))
                } else {
                    LineMark(x: .value("x", x[safe: i] ?? 0), y: .value(unit, value))
                        .foregroundStyle(colour)
                        .lineStyle(.init(lineWidth: 1.2))
                }
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) {
                AxisValueLabel().font(.caption2).foregroundStyle(Palette.inkMuted)
                AxisGridLine().foregroundStyle(Palette.hairline)
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { drag in
                                guard let plot = proxy.plotFrame else { return }
                                let dx = drag.location.x - geo[plot].origin.x
                                guard let value: Double = proxy.value(atX: dx) else { return }
                                cursor.index = nearestIndex(to: value)
                            }
                            .onEnded { _ in cursor.index = nil }
                    )
            }
        }
        .chartBackground { _ in
            RuleOverlay(x: x, colour: colour, cursor: cursor)
        }
    }

    private func nearestIndex(to value: Double) -> Int? {
        guard !x.isEmpty else { return nil }
        // The x array is monotonic (time or cumulative distance), so a binary
        // search is exact and cheap enough to run on every drag frame.
        var lo = 0, hi = x.count - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if x[mid] < value { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }
}

/// The one part that re-renders while dragging.
private struct RuleOverlay: View {
    let x: [Double]
    let colour: Color
    let cursor: CursorModel

    var body: some View {
        GeometryReader { geo in
            if let i = cursor.index, i < x.count, let first = x.first, let last = x.last,
               last > first {
                let t = (x[i] - first) / (last - first)
                Rectangle()
                    .fill(Palette.inkMuted.opacity(0.55))
                    .frame(width: 1)
                    .position(x: geo.size.width * t, y: geo.size.height / 2)
            }
        }
    }
}

private struct Readout: View {
    let unit: String
    let y: [Float]
    let colour: Color
    let cursor: CursorModel

    var body: some View {
        HStack(spacing: 3) {
            Text(value)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(colour)
            Text(unit).font(.caption2).foregroundStyle(Palette.inkMuted)
        }
    }

    private var value: String {
        guard let i = cursor.index, i < y.count else { return "—" }
        return String(Int(y[i].rounded()))
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
