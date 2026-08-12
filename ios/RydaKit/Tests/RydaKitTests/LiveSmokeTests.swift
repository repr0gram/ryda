import Testing
import Foundation
@testable import RydaKit

/// Temporary: drives the real production API to find a decoding failure.
@Suite("live", .enabled(if: ProcessInfo.processInfo.environment["RYDA_LIVE"] != nil))
struct LiveSmokeTests {
    @Test("sign up, then every endpoint the app touches")
    func fullPath() async throws {
        let base = URL(string: "https://ryda-nine.vercel.app")!
        let token = ProcessInfo.processInfo.environment["RYDA_TOKEN"] ?? ""
        let api = RydaAPI(baseURL: base, tokens: InMemoryTokenStore(token: token))

        do {
            let settings = try await api.riderSettings()
            print("SETTINGS OK \(settings.source) ftp=\(settings.settings.ftp)")
        } catch {
            print("SETTINGS FAILED: \(error)")
            throw error
        }

        do {
            let rides = try await api.rides()
            print("RIDES OK count=\(rides.count)")
        } catch {
            print("RIDES FAILED: \(error)")
            throw error
        }

        do {
            let summary = try await api.summary(today: Format.localToday())
            print("SUMMARY OK empty=\(summary.summary == nil)")
        } catch {
            print("SUMMARY FAILED: \(error)")
            throw error
        }

        do {
            let trend = try await api.trend(days: 30, today: Format.localToday())
            print("TREND OK hasRides=\(trend.hasRides) points=\(trend.series.count)")
        } catch {
            print("TREND FAILED: \(error)")
            throw error
        }

        let rides = try await api.rides()
        for ride in rides {
            do {
                let response = try await api.streams(rideId: ride.id)
                let decoded = try RideStreams(response: response)
                print("STREAMS OK \(ride.name) samples=\(decoded.sampleCount) kcal=\(response.analysis?.calories ?? -1)")
            } catch {
                print("STREAMS FAILED \(ride.name): \(error)")
                throw error
            }
        }
    }
}
