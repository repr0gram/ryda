#if canImport(UIKit)
import Foundation

/// Where this build points and which keychain it shares.
///
/// Read from Info.plist rather than compiled in, so the app and the widget
/// extension — two separate bundles — agree by construction, and so pointing a
/// debug build at a dev server is a plist edit rather than a code change.
public enum RydaEnvironment {
    public static var baseURL: URL {
        guard let raw = value("RydaBaseURL"), let url = URL(string: raw) else {
            return RydaAPI.production
        }
        return url
    }

    /// The shared keychain group. Nil when the entitlement is missing, which
    /// leaves the app working and the widget unable to see the token — see
    /// KeychainTokenStore.
    public static var keychainGroup: String? {
        guard let raw = value("RydaKeychainGroup"), !raw.isEmpty else { return nil }
        // Unexpanded build settings mean the entitlement was never applied.
        return raw.contains("$(") ? nil : raw
    }

    public static var appGroup: String? {
        guard let raw = value("RydaAppGroup"), !raw.isEmpty else { return nil }
        return raw
    }

    /// One store, shared by the app and the widget.
    public static func tokenStore() -> any TokenStore {
        KeychainTokenStore(accessGroup: keychainGroup)
    }

    public static func api() -> RydaAPI {
        RydaAPI(baseURL: baseURL, tokens: tokenStore())
    }

    private static func value(_ key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }
}
#endif
