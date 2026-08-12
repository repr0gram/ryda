import SwiftUI
import MapKit
import RydaKit

/// The route, coloured by a channel.
///
/// `MKPolyline` has no per-vertex colouring and `MapPolyline`'s `ShapeStyle`
/// gradient is applied in the map's screen space rather than along the line, so
/// neither does what the web map does. The trace is therefore split into many
/// short polylines, each a flat colour.
///
/// Segments are bucketed by **distance travelled, not sample index**. Samples
/// are spaced by time and the colour ramp is normalised by distance; the two
/// only coincide at constant speed, so index bucketing paints climbs with
/// descent colours on any ride with a stop in it. The web map documents the
/// same trap.
struct RouteMap: View {
    let coordinates: [CLLocationCoordinate2D]
    let distance: [Double]
    let channel: [Float]?
    let colour: Color
    /// Where the scrub cursor sits, as a sample index.
    let marker: Int?

    private static let segmentCount = 180

    var body: some View {
        Map(initialPosition: .region(region)) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                MapPolyline(coordinates: segment.points)
                    .stroke(
                        colour.opacity(segment.intensity),
                        style: .init(lineWidth: 3.5, lineCap: .round, lineJoin: .round)
                    )
            }
            if let marker, marker < coordinates.count {
                Annotation("", coordinate: coordinates[marker]) {
                    Circle()
                        .fill(Palette.ink)
                        .frame(width: 11, height: 11)
                        .overlay(Circle().strokeBorder(Palette.surface1, lineWidth: 2.5))
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControlVisibility(.hidden)
        .allowsHitTesting(false)
    }

    private struct Segment {
        let points: [CLLocationCoordinate2D]
        /// 0.55…1.0 rather than 0…1, so a coasting stretch stays a legible route
        /// rather than fading into the basemap.
        let intensity: Double
    }

    private var segments: [Segment] {
        guard coordinates.count > 1, distance.count == coordinates.count else { return [] }
        let total = distance.last! - distance.first!
        guard total > 0 else { return [] }

        // 2nd–98th percentile, so one GPS spike doesn't flatten the whole ramp.
        let bounds = channel.flatMap { percentileRange($0) }

        var result: [Segment] = []
        var start = 0
        for step in 1...Self.segmentCount {
            let target = distance.first! + total * Double(step) / Double(Self.segmentCount)
            var end = start
            while end < distance.count - 1 && distance[end] < target { end += 1 }
            guard end > start else { continue }

            var intensity = 1.0
            if let channel, let bounds, bounds.hi > bounds.lo {
                let (lo, hi) = bounds
                var sum = 0.0
                for i in start...end { sum += Double(channel[i]) }
                let mean = sum / Double(end - start + 1)
                let t = (mean - lo) / (hi - lo)
                intensity = 0.55 + 0.45 * min(1, max(0, t))
            }
            // Overlap by one point, or the joins leave visible gaps.
            result.append(Segment(points: Array(coordinates[start...end]), intensity: intensity))
            start = end
        }
        return result
    }

    private func percentileRange(_ values: [Float]) -> (lo: Double, hi: Double)? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let lo = sorted[Int(Double(sorted.count - 1) * 0.02)]
        let hi = sorted[Int(Double(sorted.count - 1) * 0.98)]
        return (Double(lo), Double(hi))
    }

    private var region: MKCoordinateRegion {
        guard !coordinates.isEmpty else {
            return MKCoordinateRegion(
                center: .init(latitude: 45.5, longitude: -73.57),
                span: .init(latitudeDelta: 0.2, longitudeDelta: 0.2)
            )
        }
        let lats = coordinates.map(\.latitude)
        let lons = coordinates.map(\.longitude)
        let minLat = lats.min()!, maxLat = lats.max()!
        let minLon = lons.min()!, maxLon = lons.max()!
        return MKCoordinateRegion(
            center: .init(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: .init(
                latitudeDelta: max(0.005, (maxLat - minLat) * 1.25),
                longitudeDelta: max(0.005, (maxLon - minLon) * 1.25)
            )
        )
    }
}
