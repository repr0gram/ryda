import SwiftUI
import RydaKit

/// Who is signed in, and the one API instance everything else borrows.
@Observable
@MainActor
final class SessionStore {
    enum State: Equatable {
        case unknown
        case signedOut
        case signedIn(email: String)
    }

    private(set) var state: State = .unknown
    private(set) var settings: RiderSettings?
    private(set) var settingsSource: SettingsSource = .default
    let api: RydaAPI

    init(api: RydaAPI = RydaEnvironment.api()) {
        self.api = api
    }

    /// Decide on launch whether the stored token is still good.
    ///
    /// A token can only be stale, never refreshable — sessions are DB-backed
    /// with no refresh token — so the only question is whether it still works.
    /// Any request answers that, and the settings are wanted anyway.
    func restore() async {
        guard state == .unknown else { return }

        #if DEBUG
        // Debug-only: let a launch argument seed the session, so screens can be
        // driven and screenshotted from the command line without a human typing
        // a password into the Simulator. Compiled out of Release entirely —
        // there is no path from a shipped build to this.
        //
        //   xcrun simctl launch booted com.fadi.ryda -RydaDebugToken "<token>"
        if let token = UserDefaults.standard.string(forKey: "RydaDebugToken"), !token.isEmpty {
            try? RydaEnvironment.tokenStore().write(token)
        }
        #endif

        guard await api.hasToken() else {
            state = .signedOut
            return
        }
        do {
            let response = try await api.riderSettings()
            settings = response.settings
            settingsSource = response.source
            state = .signedIn(email: "")
        } catch APIError.unauthorized {
            state = .signedOut
        } catch {
            // Offline with a token that was good last time. Treat that as signed
            // in and let individual screens show their own failure, rather than
            // dumping the rider at a password prompt because a tunnel ate a
            // request.
            state = .signedIn(email: "")
        }
    }

    func signIn(email: String, password: String) async throws {
        let user = try await api.signIn(email: email, password: password)
        await loadSettings()
        state = .signedIn(email: user.email)
    }

    func signUp(email: String, password: String, name: String) async throws {
        let user = try await api.signUp(email: email, password: password, name: name)
        await loadSettings()
        state = .signedIn(email: user.email)
    }

    func signOut() async {
        await api.signOut()
        settings = nil
        state = .signedOut
    }

    private func loadSettings() async {
        guard let response = try? await api.riderSettings() else { return }
        settings = response.settings
        settingsSource = response.source
    }
}
