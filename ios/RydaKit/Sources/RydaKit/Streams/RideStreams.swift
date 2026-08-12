import Foundation
import CoreLocation

/// One ride's sample channels, decoded.
///
/// Built once from a `StreamsResponse` and read many times. The coordinate
/// array in particular is built here and nowhere else: `latlng` arrives
/// interleaved as `[lat, lng, lat, lng, …]`, which maps directly onto
/// `CLLocationCoordinate2D(latitude:longitude:)` and is therefore the classic
/// place to silently transpose the pair and render the ride in the Indian Ocean.
public struct RideStreams: Sendable {
    public let sampleCount: Int
    /// How many samples the ride actually has, before the server decimated it.
    public let fullSampleCount: Int
    public let altitudeSource: String
    public let speedIsDerived: Bool

    public let time: [Double]
    public let distance: [Double]
    public let altitude: [Double]
    public let coordinates: [CLLocationCoordinate2D]
    public let speed: [Float]?
    public let heartRate: [Float]?
    public let cadence: [Float]?
    public let temperature: [Float]?
    public let paused: [UInt8]?

    /// Watts. Measured when the file carried a meter, otherwise the server's
    /// estimate — `estimateSource` says which, and nothing else should guess.
    public let power: [Float]?
    public let estimateSource: EstimateSource?

    public enum EstimateSource: String, Sendable, Codable {
        case measured
        case estimated
    }

    public init(response: StreamsResponse) throws {
        let n = response.sampleCount
        sampleCount = n
        fullSampleCount = response.fullSampleCount ?? n
        altitudeSource = response.altitudeSource
        speedIsDerived = response.speedIsDerived

        let c = response.channels
        func f64(_ key: String) throws -> [Double]? {
            guard let raw = c[key] else { return nil }
            return try ChannelDecoder.float64(raw, expecting: n, channel: key)
        }
        func f32(_ key: String) throws -> [Float]? {
            guard let raw = c[key] else { return nil }
            return try ChannelDecoder.float32(raw, expecting: n, channel: key)
        }

        // time, distance and altitude are NOT NULL server-side, so their absence
        // is a broken response rather than a ride without them.
        guard let t = try f64("time"), let d = try f64("distance"), let a = try f64("altitude")
        else {
            throw StreamError.length(channel: "time/distance/altitude", got: 0, want: n)
        }
        time = t
        distance = d
        altitude = a

        if let raw = c["latlng"] {
            // Two doubles per sample, hence the doubled expectation. Getting
            // this wrong is a length error rather than a silent half-route.
            let flat = try ChannelDecoder.float64(raw, expecting: n * 2, channel: "latlng")
            coordinates = stride(from: 0, to: flat.count, by: 2).map {
                CLLocationCoordinate2D(latitude: flat[$0], longitude: flat[$0 + 1])
            }
        } else {
            coordinates = []
        }

        speed = try f32("speed")
        heartRate = try f32("heartrate")
        cadence = try f32("cadence")
        temperature = try f32("temperature")
        paused = try c["paused"].map { try ChannelDecoder.uint8($0, expecting: n, channel: "paused") }

        // The estimate rides outside `channels` deliberately, so that a modelled
        // number can never be mistaken for one a power meter recorded.
        if let estimate = response.estimate {
            power = try ChannelDecoder.float32(estimate.channel, expecting: n, channel: "estimate")
            estimateSource = estimate.source
        } else if let measured = try f32("power") {
            power = measured
            estimateSource = .measured
        } else {
            power = nil
            estimateSource = nil
        }
    }
}
