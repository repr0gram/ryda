import SwiftUI
import RydaKit

/// Where the time actually went.
///
/// Bars are scaled against the busiest zone, not against the total. Most rides
/// put 70% of their time in one or two zones, and scaling to the total flattens
/// every other zone into an invisible sliver — the web panel documents the same
/// choice. Every bar keeps its name and its time, so colour never carries
/// meaning on its own.
struct ZoneBars: View {
    let title: String
    let caption: String
    let slices: [ZoneSlice]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.caption.weight(.medium)).foregroundStyle(Palette.inkSecondary)
                Spacer()
                Text(caption).font(.caption2).foregroundStyle(Palette.inkMuted)
            }
            ForEach(slices) { slice in
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Text("Z\(slice.index)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Palette.inkMuted)
                        Text(slice.name)
                            .font(.caption2)
                            .foregroundStyle(Palette.inkSecondary)
                            .lineLimit(1)
                    }
                    .frame(width: 108, alignment: .leading)

                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Palette.surface3)
                            Capsule()
                                .fill(Palette.zone(token: slice.token))
                                .frame(width: geo.size.width * proportion(slice))
                        }
                    }
                    .frame(height: 9)

                    HStack(spacing: 5) {
                        Text(Format.compactDuration(slice.seconds))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Palette.inkSecondary)
                        Text("\(Int((slice.fraction * 100).rounded()))%")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Palette.inkMuted)
                    }
                    .frame(width: 76, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "Zone \(slice.index), \(slice.name), \(slice.range), \(Format.compactDuration(slice.seconds))"
                )
            }
        }
    }

    private var peak: Double {
        max(slices.map(\.fraction).max() ?? 0, 0.0001)
    }

    private func proportion(_ slice: ZoneSlice) -> Double {
        min(1, slice.fraction / peak)
    }
}
