import Foundation
import Security

/// Where the session token lives.
///
/// A protocol rather than a concrete type for two reasons: tests need an
/// in-memory one so they never touch a real keychain, and the app/widget sharing
/// story depends on an entitlement that may not be available on every signing
/// setup — see `KeychainTokenStore`.
public protocol TokenStore: Sendable {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}

public struct KeychainTokenStore: TokenStore {
    private let service: String
    private let account = "session"
    private let accessGroup: String?

    /// - Parameter accessGroup: the shared keychain group, so the widget
    ///   extension can read what the app wrote. Both processes have their own
    ///   bundle identifier, so without a group each gets its own silo and the
    ///   widget is permanently signed out.
    ///
    ///   This needs a Keychain Sharing / App Group entitlement, which is
    ///   generally a paid-membership capability. Simulator builds do not enforce
    ///   it. Passing `nil` degrades to a private keychain — the app still works,
    ///   the widget just cannot see the token.
    public init(service: String = "com.fadi.ryda", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func read() throws -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status != errSecItemNotFound else { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.status(status)
        }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ token: String) throws {
        let data = Data(token.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // NOT kSecAttrAccessibleWhenUnlocked. The widget refreshes while the
            // phone is locked in a pocket; with WhenUnlocked those reads fail
            // with errSecInteractionNotAllowed, the widget blanks overnight and
            // mysteriously recovers the moment you pick the phone up.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemUpdate(baseQuery() as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = baseQuery()
            insert.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.status(addStatus) }
            return
        }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    public func clear() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}

public enum KeychainError: Error, Sendable {
    case status(OSStatus)
}

/// For tests, and for previews that must never touch a real keychain.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(token: String? = nil) { self.token = token }

    public func read() throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return token
    }

    public func write(_ token: String) throws {
        lock.lock(); defer { lock.unlock() }
        self.token = token
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        token = nil
    }
}
