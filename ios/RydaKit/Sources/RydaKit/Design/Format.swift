import Foundation

/// Shared number and date formatting, so the phone reads like the website.
public enum Format {
    /// `4:25:19` for a long ride, `47:12` for a short one. Never `04:25:19`.
    public static func duration(_ seconds: some BinaryInteger) -> String {
        let total = Int(seconds)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    /// `1h 20m` / `47m` / `38s` — for zone rows, where seconds-level precision
    /// is noise.
    public static func compactDuration(_ seconds: Double) -> String {
        if seconds < 60 { return "\(Int(seconds.rounded()))s" }
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
    }

    public static func distance(_ metres: Double) -> String {
        String(format: "%.1f", metres / 1000)
    }

    public static func whole(_ value: Double) -> String {
        String(Int(value.rounded()))
    }

    /// "today" / "yesterday" / "3 days ago" — the widget's subtitle.
    public static func daysSince(_ days: Int) -> String {
        switch days {
        case ..<0: return "today"   // a clock disagreement, not the future
        case 0: return "today"
        case 1: return "yesterday"
        default: return "\(days) days ago"
        }
    }

    /// The rider's local calendar day as `YYYY-MM-DD`.
    ///
    /// Sent with every request that asks a date-shaped question, because the
    /// server runs in UTC and would otherwise decide an evening ride happened
    /// yesterday. Matches `toLocalDate` in the web app, which also uses local
    /// calendar fields rather than a UTC conversion.
    public static func localToday(_ date: Date = Date()) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1
        )
    }
}
