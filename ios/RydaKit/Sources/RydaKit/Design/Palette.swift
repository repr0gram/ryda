#if canImport(UIKit)
import SwiftUI

/// The token layer, ported from `src/app/globals.css`.
///
/// A Swift file rather than an asset catalogue on purpose: the point of these
/// hexes is that they can be diffed against the stylesheet, and the discipline
/// there is one declaration per token with no duplicated theme blocks. A
/// `UIColor` trait closure is the direct analogue of CSS `light-dark()`.
///
/// Channel colours are semantic and global — heart rate is this red in every
/// chart, on the map trace, and in every legend, on the phone and on the web.
public enum Palette {
    // MARK: Surfaces

    public static let surface0 = dynamic(light: 0xFAF9F7, dark: 0x0B0C0E)
    public static let surface1 = dynamic(light: 0xFFFFFF, dark: 0x131417)
    public static let surface2 = dynamic(light: 0xF4F2EF, dark: 0x1A1C20)
    public static let surface3 = dynamic(light: 0xE9E6E1, dark: 0x22252A)
    public static let hairline = dynamic(light: 0xE2DED7, dark: 0x2A2E34)

    public static let ink = dynamic(light: 0x16181C, dark: 0xF2F3F5)
    public static let inkSecondary = dynamic(light: 0x4A4F57, dark: 0xB4B9C0)
    public static let inkMuted = dynamic(light: 0x7A8089, dark: 0x7E858E)

    public static let brand = dynamic(light: 0x4A3AA7, dark: 0x9085E9)
    public static let brandContrast = dynamic(light: 0xFFFFFF, dark: 0x0B0C0E)

    // MARK: Data channels

    public static let power = dynamic(light: 0x2A78D6, dark: 0x3987E5)
    public static let heartRate = dynamic(light: 0xE34948, dark: 0xE66767)
    public static let cadence = dynamic(light: 0xE87BA4, dark: 0xD55181)
    public static let speed = dynamic(light: 0x008300, dark: 0x008300)
    public static let temperature = dynamic(light: 0xEB6834, dark: 0xD95926)
    public static let wBalance = dynamic(light: 0xEDA100, dark: 0xC98500)

    /// Elevation is context, not identity — a recessive ghost fill behind the
    /// active channel, so it takes chrome rather than a hue slot.
    public static let elevation = dynamic(light: 0xD8D3C9, dark: 0x2B2F36)
    public static let elevationLine = dynamic(light: 0xBDB6A8, dark: 0x3A3F47)

    // MARK: Zones

    /// Ordinal, not categorical: zone 1 to zone 7 is one axis of increasing
    /// intensity, so these are only ever used in ramp order. Lightness falls
    /// monotonically so the ordering survives greyscale and colour-vision
    /// deficiency, and every bar carries its name and its time regardless.
    private static let zoneRamp: [Color] = [
        dynamic(light: 0x8296A8, dark: 0x6B7C8C),
        dynamic(light: 0x4A8FD4, dark: 0x3F83C6),
        dynamic(light: 0x1BAF7A, dark: 0x199E70),
        dynamic(light: 0xEDA100, dark: 0xC98500),
        dynamic(light: 0xE8752E, dark: 0xD16624),
        dynamic(light: 0xD03B3B, dark: 0xC03535),
        dynamic(light: 0x9C2F68, dark: 0x8C2A5D),
    ]

    /// Resolves the `--zone-N` token the server sends with each zone slice, so
    /// the phone and the web cannot drift apart on which band is which colour.
    public static func zone(token: String) -> Color {
        guard let n = Int(token.replacingOccurrences(of: "--zone-", with: "")),
              (1...zoneRamp.count).contains(n)
        else { return inkMuted }
        return zoneRamp[n - 1]
    }

    // MARK: Status

    public static let statusGood = Color(hex: 0x0CA30C)
    public static let statusWarning = Color(hex: 0xFAB219)
    public static let statusSerious = Color(hex: 0xEC835A)
    public static let statusCritical = Color(hex: 0xD03B3B)

    public static func confidence(_ level: String) -> Color {
        switch level {
        case "high": return statusGood
        case "moderate": return statusWarning
        case "low": return statusSerious
        default: return statusCritical
        }
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    init(hex: UInt32) { self.init(uiColor: UIColor(hex: hex)) }
}
#endif
