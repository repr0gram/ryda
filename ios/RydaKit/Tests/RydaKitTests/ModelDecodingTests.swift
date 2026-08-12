import Testing
import Foundation
@testable import RydaKit

private func decoder() -> JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom { dec in
        let raw = try dec.singleValueContainer().decode(String.self)
        guard let date = ISO8601.parse(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: raw))
        }
        return date
    }
    return d
}

private func encode<T>(_ values: [T]) -> String {
    values.withUnsafeBytes { Data($0).base64EncodedString() }
}

@Suite("Model decoding")
struct ModelDecodingTests {
    @Test("parses the fractional-second timestamps JavaScript actually sends")
    func fractionalSeconds() throws {
        // JSONDecoder's built-in .iso8601 rejects this exact string, which is
        // what every date in the app looks like.
        let withFraction = ISO8601.parse("2026-08-09T16:30:41.000Z")
        #expect(withFraction != nil)
        // And the same instant without them, in case anything ever emits it.
        #expect(ISO8601.parse("2026-08-09T16:30:41Z") == withFraction)
        #expect(ISO8601.parse("not a date") == nil)
    }

    @Test("an account with no rides decodes as empty, not as an error")
    func emptySummary() throws {
        // The API returns literally this, with every other key absent. A struct
        // of non-optionals throws keyNotFound forever on a new account and the
        // widget shows a permanent error that looks like a widget bug.
        let json = Data(#"{"hasRides":false}"#.utf8)
        let response = try decoder().decode(SummaryResponse.self, from: json)
        #expect(response.summary == nil)
    }

    @Test("a populated summary decodes every field the widget shows")
    func populatedSummary() throws {
        let json = Data("""
        {"hasRides":true,"asOf":"2026-08-12","fitness":7,"fatigue":16,"form":-11,
         "rampRate":1,"consistency":0.21,"loadLast7Days":101,"daysSinceLastRide":3,
         "latestRide":{"id":"29771551-347","name":"Afternoon Ride",
           "startedAt":"2026-08-09T16:30:41.000Z","distanceKm":105.8,
           "movingSeconds":15919,"elevationGainMeters":262,"weightedPower":119,"load":101},
         "rideCount":3,"ftp":190,"settingsConfigured":true}
        """.utf8)
        let summary = try #require(decoder().decode(SummaryResponse.self, from: json).summary)
        #expect(summary.form == -11)          // form is routinely negative
        #expect(summary.daysSinceLastRide == 3)
        #expect(summary.latestRide.distanceKm == 105.8)
        #expect(summary.settingsConfigured)
    }

    @Test("latitude and longitude are not transposed")
    func coordinateOrder() throws {
        // latlng arrives interleaved [lat, lng, …], which maps straight onto
        // CLLocationCoordinate2D(latitude:longitude:) and is therefore the
        // easiest pair in the codebase to swap. Montreal is +45, -73; swapped it
        // would be -73, +45, which is open ocean off Antarctica.
        let n = 2
        let flat: [Double] = [45.4969699960202, -73.55175998993218, 45.5, -73.5]
        let json = Data("""
        {"sampleCount":\(n),"altitudeSource":"barometric","speedIsDerived":false,
         "channels":{"time":"\(encode([0.0, 1.0]))",
                     "distance":"\(encode([0.0, 7.3]))",
                     "altitude":"\(encode([12.0, 12.5]))",
                     "latlng":"\(encode(flat))"}}
        """.utf8)
        let streams = try RideStreams(response: decoder().decode(StreamsResponse.self, from: json))
        #expect(streams.coordinates.count == n)
        #expect(streams.coordinates[0].latitude == 45.4969699960202)
        #expect(streams.coordinates[0].longitude == -73.55175998993218)
    }

    @Test("the estimate is taken from its own block, never from the power channel")
    func estimateIsSeparate() throws {
        // `power` means a real meter was present. The modelled number lives
        // outside `channels` precisely so the two can never be confused.
        let json = Data("""
        {"sampleCount":2,"fullSampleCount":20805,"altitudeSource":"gps","speedIsDerived":true,
         "channels":{"time":"\(encode([0.0, 1.0]))",
                     "distance":"\(encode([0.0, 7.3]))",
                     "altitude":"\(encode([12.0, 12.5]))"},
         "estimate":{"channel":"\(encode([Float(120), Float(454)]))","source":"estimated",
           "settings":{"riderKg":78,"bikeKg":11,"positionId":"hoods","surfaceId":"road",
                       "ftp":190,"lthr":168,"configured":true},
           "settingsSource":"saved",
           "confidence":{"level":"high","flags":[],"summary":"as good as it gets"}}}
        """.utf8)
        let response = try decoder().decode(StreamsResponse.self, from: json)
        let streams = try RideStreams(response: response)
        #expect(streams.estimateSource == .estimated)
        #expect(streams.power == [120, 454])
        #expect(streams.fullSampleCount == 20805)
        #expect(response.estimate?.settingsSource == .saved)
        #expect(response.estimate?.settings.ftp == 190)
    }

    @Test("a channel whose length disagrees with sampleCount is rejected")
    func lengthMismatch() throws {
        // Nothing server-side cross-checks channel lengths, so a response
        // truncated in transit has to fail here rather than be indexed past.
        let json = Data("""
        {"sampleCount":100,"altitudeSource":"gps","speedIsDerived":true,
         "channels":{"time":"\(encode([0.0, 1.0]))",
                     "distance":"\(encode([0.0, 7.3]))",
                     "altitude":"\(encode([12.0, 12.5]))"}}
        """.utf8)
        let response = try decoder().decode(StreamsResponse.self, from: json)
        #expect(throws: StreamError.self) { try RideStreams(response: response) }
    }

    @Test("rider settings round-trip, including an unset threshold heart rate")
    func riderSettings() throws {
        let json = Data("""
        {"settings":{"riderKg":75,"bikeKg":9,"positionId":"hoods","surfaceId":"road",
                     "ftp":250,"lthr":0,"configured":false},"source":"default"}
        """.utf8)
        let response = try decoder().decode(RiderSettingsResponse.self, from: json)
        // Zero lthr and source "default" both mean "do not present these as the
        // rider's own numbers".
        #expect(response.settings.lthr == 0)
        #expect(response.source == .default)
        #expect(response.settings.configured == false)
    }
}
