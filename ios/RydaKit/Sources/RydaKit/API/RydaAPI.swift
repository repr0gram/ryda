import Foundation
import Security

public enum APIError: Error, Sendable, Equatable {
    case unauthorized
    case notFound
    /// The response was not JSON — almost always an access wall or a captive
    /// portal returning HTML, which otherwise surfaces as a decoding failure and
    /// sends you looking in the wrong place entirely.
    case notJSON(status: Int, contentType: String?)
    case server(status: Int, message: String?)
    case transport(String)
}

/// Everything the app and the widget know about talking to Ryda.
///
/// An `actor` because the token is mutable shared state and Swift 6 will not
/// let it be otherwise, and because it gives one natural home for the rule that
/// matters: a 401 clears the token and throws. There is no refresh token, so
/// retrying is pointless, and retrying silently is worse than pointless.
public actor RydaAPI {
    public static let production = URL(string: "https://ryda-nine.vercel.app")!

    private let baseURL: URL
    private let session: URLSession
    private let tokens: any TokenStore
    private let decoder: JSONDecoder

    public init(
        baseURL: URL = RydaAPI.production,
        tokens: any TokenStore,
        session: URLSession? = nil
    ) {
        self.baseURL = baseURL
        self.tokens = tokens
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.waitsForConnectivity = true
            config.timeoutIntervalForRequest = 30
            // The defaults are far too small for 150 KB stream responses, which
            // would make the ETag on those responses buy nothing.
            config.urlCache = URLCache(
                memoryCapacity: 8 * 1024 * 1024,
                diskCapacity: 128 * 1024 * 1024
            )
            self.session = URLSession(configuration: config)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { d in
            let raw = try d.singleValueContainer().decode(String.self)
            guard let date = ISO8601.parse(raw) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: d.codingPath, debugDescription: "not an ISO-8601 date: \(raw)")
                )
            }
            return date
        }
        self.decoder = decoder
    }

    // MARK: Auth

    public func signIn(email: String, password: String) async throws -> AuthUser {
        try await authenticate(path: "/api/auth/sign-in/email", body: [
            "email": email, "password": password,
        ])
    }

    public func signUp(email: String, password: String, name: String) async throws -> AuthUser {
        try await authenticate(path: "/api/auth/sign-up/email", body: [
            "email": email, "password": password, "name": name,
        ])
    }

    private func authenticate(path: String, body: [String: String]) async throws -> AuthUser {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let auth: AuthResponse = try await send(request, authenticated: false)
        guard let token = auth.token else { throw APIError.unauthorized }
        try tokens.write(token)
        return auth.user
    }

    public func signOut() async {
        var request = URLRequest(url: baseURL.appending(path: "/api/auth/sign-out"))
        request.httpMethod = "POST"
        _ = try? await raw(request, authenticated: true)
        try? tokens.clear()
    }

    public func hasToken() -> Bool {
        tokenStatus() == .present
    }

    /// Distinguishes "not signed in" from "cannot read the keychain at all".
    public func tokenStatus() -> TokenStatus {
        do {
            return try tokens.read() == nil ? .absent : .present
        } catch KeychainError.status(let status) {
            return .unreadable(status)
        } catch {
            return .unreadable(errSecInternalError)
        }
    }

    // MARK: Data

    public func summary(today: String) async throws -> SummaryResponse {
        try await get("/api/summary", query: ["today": today])
    }

    public func rides() async throws -> [RideSummary] {
        let body: RideListResponse = try await get("/api/rides")
        return body.rides
    }

    public func trend(days: Int = 180, today: String) async throws -> TrendResponse {
        try await get("/api/trend", query: ["days": String(days), "today": today])
    }

    public func riderSettings() async throws -> RiderSettingsResponse {
        try await get("/api/rider-settings")
    }

    /// A ride's samples plus the server's analysis of them.
    ///
    /// `include=power` is what keeps the physics in one implementation: the
    /// watts, metrics and zones all arrive computed, from the full series, even
    /// though the samples themselves are decimated for the wire.
    public func streams(rideId: String, maxSamples: Int = 2000) async throws -> StreamsResponse {
        try await get(
            "/api/rides/\(rideId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? rideId)/streams",
            query: ["include": "power", "maxSamples": String(maxSamples)]
        )
    }

    // MARK: Plumbing

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var components = URLComponents(
            url: baseURL.appending(path: path), resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return try await send(URLRequest(url: components.url!), authenticated: true)
    }

    private func send<T: Decodable>(_ request: URLRequest, authenticated: Bool) async throws -> T {
        let (data, response) = try await raw(request, authenticated: authenticated)

        // Guard the content type before decoding. An access wall answers with a
        // 200 and HTML, and "The data couldn't be read" sends you debugging a
        // decoder that is working perfectly.
        let contentType = response.value(forHTTPHeaderField: "Content-Type")
        guard contentType?.contains("json") == true else {
            throw APIError.notJSON(status: response.statusCode, contentType: contentType)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.server(status: response.statusCode, message: String(describing: error))
        }
    }

    private func raw(
        _ request: URLRequest,
        authenticated: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        var request = request
        if authenticated, let token = try? tokens.read() {
            // Note the space: the bearer plugin compares the first seven
            // characters case-insensitively against "bearer ".
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        // Deliberately no Origin header. Better Auth skips CSRF validation
        // entirely for a request with no Cookie, no Sec-Fetch-* and no Origin —
        // which is exactly a bare URLSession call. Adding one turns validation
        // on against a trustedOrigins list that is not configured, and every
        // sign-in starts failing with 403.

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("not an HTTP response")
        }

        switch http.statusCode {
        case 200..<300:
            return (data, http)
        case 401:
            // Sessions are DB-backed with no refresh token, so there is nothing
            // to retry with. Drop it and let the UI ask for a password.
            try? tokens.clear()
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        default:
            let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError.server(
                status: http.statusCode,
                message: (message?["message"] ?? message?["error"]) as? String
            )
        }
    }
}
