import Foundation

// MARK: - Rides

public struct RideSummary: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let startedAt: Date
    /// The rider's own calendar day, deliberately a string.
    ///
    /// Decoding this to a `Date` would reintroduce exactly the timezone shift it
    /// exists to prevent: an evening ride belongs to the evening, not to
    /// tomorrow in UTC.
    public let localDate: String
    public let sport: String
    public let hasMeasuredPower: Bool
    public let devices: [String]
    public let durationSeconds: Int
    public let movingSeconds: Int
    public let distanceMeters: Double
    public let elevationGainMeters: Double
    public let meanPower: Double
    public let weightedPower: Double
    public let load: Double
    public let meanHeartRate: Double?
    public let decouplingPercent: Double?
    public let confidence: String
    public let sampleCount: Int
    public let altitudeSource: String
    /// Mechanical work and the dietary calories it cost. Derived server-side
    /// from mean power and moving time, so they exist for rides stored before
    /// the fields did — hence optional.
    public let kilojoules: Double?
    public let calories: Double?
}

public struct RideListResponse: Codable, Sendable {
    public let rides: [RideSummary]
}

// MARK: - Streams

public struct StreamsResponse: Codable, Sendable {
    public let sampleCount: Int
    public let fullSampleCount: Int?
    public let altitudeSource: String
    public let speedIsDerived: Bool
    public let channels: [String: String]
    public let estimate: Estimate?
    public let analysis: RideMetrics?
    public let zones: Zones?

    public struct Estimate: Codable, Sendable {
        public let channel: String
        public let source: RideStreams.EstimateSource
        public let settings: RiderSettings
        public let settingsSource: SettingsSource
        public let confidence: Confidence
    }

    public struct Zones: Codable, Sendable {
        public let power: [ZoneSlice]
        public let heartRate: [ZoneSlice]?
    }
}

public struct Confidence: Codable, Sendable {
    public let level: String
    public let flags: [String]
    public let summary: String
}

public struct ZoneSlice: Codable, Sendable, Identifiable {
    public let index: Int
    public let name: String
    public let purpose: String
    public let token: String
    public let seconds: Double
    public let fraction: Double
    public let range: String

    public var id: Int { index }
}

public struct RideMetrics: Codable, Sendable {
    public let durationSeconds: Double
    public let movingSeconds: Double
    public let distanceMeters: Double
    public let elevationGainMeters: Double
    public let meanPower: Double
    public let weightedPower: Double
    public let intensity: Double
    public let load: Double
    public let variability: Double
    public let kilojoules: Double
    /// Computed server-side from `kilojoules` and a stated gross efficiency,
    /// so every client agrees about the same ride.
    public let calories: Double?
    public let meanHeartRate: Double?
    public let efficiency: Double?
}

// MARK: - Rider settings

public enum SettingsSource: String, Codable, Sendable {
    case saved
    case `default`
}

public struct RiderSettings: Codable, Sendable, Equatable {
    public let riderKg: Double
    public let bikeKg: Double
    public let positionId: String
    public let surfaceId: String
    public let ftp: Int
    /// Zero means unset, and heart-rate zones stay hidden rather than being
    /// anchored on a guess.
    public let lthr: Int
    /// False until the rider entered their own numbers. A client that cannot
    /// tell a real 75 kg from a defaulted one prints confident nonsense.
    public let configured: Bool
}

public struct RiderSettingsResponse: Codable, Sendable {
    public let settings: RiderSettings
    public let source: SettingsSource
}

// MARK: - Summary

/// The widget's payload.
///
/// Modelled as an enum because the API genuinely returns two different shapes:
/// an account with no rides gets literally `{"hasRides": false}` with every
/// other key *absent*, not null. A struct of non-optionals throws `keyNotFound`
/// forever on a new account, and the widget shows an error state that looks like
/// a bug in the widget.
public enum SummaryResponse: Decodable, Sendable {
    case empty
    case populated(Summary)

    private enum Keys: String, CodingKey { case hasRides }

    public init(from decoder: Decoder) throws {
        let flag = try decoder.container(keyedBy: Keys.self)
        if try flag.decode(Bool.self, forKey: .hasRides) {
            self = .populated(try Summary(from: decoder))
        } else {
            self = .empty
        }
    }

    public var summary: Summary? {
        if case .populated(let s) = self { return s }
        return nil
    }
}

public struct Summary: Codable, Sendable {
    public let asOf: String
    public let fitness: Double
    public let fatigue: Double
    public let form: Double
    public let rampRate: Double
    public let consistency: Double
    public let loadLast7Days: Double
    public let daysSinceLastRide: Int
    public let latestRide: LatestRide
    public let rideCount: Int
    public let ftp: Int
    public let settingsConfigured: Bool

    /// Deliberately not the same type as `RideSummary`. The same ride is
    /// described with different units and precision here — kilometres not
    /// metres, rounded integers not raw doubles — and one struct pretending to
    /// cover both would need every field optional.
    public struct LatestRide: Codable, Sendable {
        public let id: String
        public let name: String
        public let startedAt: Date
        public let distanceKm: Double
        public let movingSeconds: Int
        public let elevationGainMeters: Int
        public let weightedPower: Int
        public let load: Double
        public let calories: Double?

        /// Spelled out because the synthesised memberwise initialiser is
        /// internal, and the widget builds sample entries from another module.
        public init(
            id: String,
            name: String,
            startedAt: Date,
            distanceKm: Double,
            movingSeconds: Int,
            elevationGainMeters: Int,
            weightedPower: Int,
            load: Double,
            calories: Double? = nil
        ) {
            self.id = id
            self.name = name
            self.startedAt = startedAt
            self.distanceKm = distanceKm
            self.movingSeconds = movingSeconds
            self.elevationGainMeters = elevationGainMeters
            self.weightedPower = weightedPower
            self.load = load
            self.calories = calories
        }
    }
}

// MARK: - Trend

public struct TrendResponse: Codable, Sendable {
    public let hasRides: Bool
    public let asOf: String?
    public let fitness: Double?
    public let fatigue: Double?
    public let form: Double?
    public let rampRate: Double?
    public let consistency: Double?
    public let series: [TrendPoint]
}

public struct TrendPoint: Codable, Sendable, Identifiable {
    public let date: String
    public let load: Double
    public let fitness: Double
    public let fatigue: Double
    public let form: Double

    public var id: String { date }
}

// MARK: - Auth

public struct AuthResponse: Codable, Sendable {
    public let token: String?
    public let user: AuthUser
}

public struct AuthUser: Codable, Sendable {
    public let id: String
    public let email: String
    public let name: String?
}
