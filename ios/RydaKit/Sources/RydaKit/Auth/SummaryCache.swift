#if canImport(UIKit)
import Foundation

/// The last summary that arrived intact, in the shared App Group container.
///
/// The app writes it after every fetch; the widget reads it when the network
/// fails. The point is that the widget never goes blank and never shows a stale
/// number as if it were current — `savedAt` is what lets it say "as of 09:14"
/// instead of quietly lying.
public enum SummaryCache {
    public struct Cached: Sendable {
        public let summary: Summary
        public let savedAt: Date
    }

    private static var url: URL? {
        guard let group = RydaEnvironment.appGroup else { return nil }
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("summary.json")
    }

    public static func save(_ summary: Summary) {
        guard let url else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(Envelope(summary: summary, savedAt: Date()))
        else { return }
        try? data.write(to: url, options: .atomic)
    }

    public static func load() -> Cached? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return Cached(summary: envelope.summary, savedAt: envelope.savedAt)
    }

    /// Written by us, read by us, so plain .iso8601 is correct here — unlike the
    /// API's dates, which carry fractional seconds the built-in strategy rejects.
    private struct Envelope: Codable {
        let summary: Summary
        let savedAt: Date
    }
}
#endif
