import Foundation

/// Parsing for the timestamps this API actually sends.
///
/// JavaScript's `toISOString()` emits fractional seconds —
/// `2026-08-12T09:14:03.000Z` — and `JSONDecoder.DateDecodingStrategy.iso8601`
/// rejects those outright. Every date in the app fails to decode with the
/// built-in strategy, which is the most common way to lose an afternoon here.
///
/// The formatters are built per call rather than cached: `ISO8601DateFormatter`
/// is not `Sendable`, and a decoding strategy closure must be. Dates appear only
/// in ride summaries — tens per response, not thousands — so this never shows up
/// in a profile.
enum ISO8601 {
    static func parse(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}
