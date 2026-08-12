import SwiftUI
import RydaKit

struct SignInScreen: View {
    @Environment(SessionStore.self) private var session

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var error: String?
    @State private var busy = false

    enum Mode: String, CaseIterable {
        case signIn = "Sign in"
        case signUp = "Create account"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Ryda")
                    .font(.largeTitle.weight(.medium))
                    .foregroundStyle(Palette.ink)
                Text("Ride analysis that tells you something.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.inkSecondary)
            }

            Picker("", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            VStack(spacing: 12) {
                if mode == .signUp {
                    field("Name", text: $name, content: .name)
                }
                field("Email", text: $email, content: .emailAddress, keyboard: .emailAddress)
                secureField()
            }

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Palette.statusCritical)
            }

            Button(action: submit) {
                HStack {
                    if busy { ProgressView().tint(Palette.brandContrast) }
                    Text(mode.rawValue).fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Palette.brand, in: .rect(cornerRadius: 10))
                .foregroundStyle(Palette.brandContrast)
            }
            .disabled(busy || email.isEmpty || password.count < 10)

            Text("Rides are analysed on the server so this app and the website always agree. Nothing is computed twice.")
                .font(.caption)
                .foregroundStyle(Palette.inkMuted)

            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface0)
    }

    private func field(
        _ label: String,
        text: Binding<String>,
        content: UITextContentType,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption).foregroundStyle(Palette.inkSecondary)
            TextField("", text: text)
                .textContentType(content)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Palette.surface2, in: .rect(cornerRadius: 8))
                .foregroundStyle(Palette.ink)
        }
    }

    private func secureField() -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text("Password").font(.caption).foregroundStyle(Palette.inkSecondary)
                Text("at least 10 characters").font(.caption2).foregroundStyle(Palette.inkMuted)
            }
            SecureField("", text: $password)
                .textContentType(mode == .signIn ? .password : .newPassword)
                .padding(10)
                .background(Palette.surface2, in: .rect(cornerRadius: 8))
                .foregroundStyle(Palette.ink)
        }
    }

    private func submit() {
        busy = true
        error = nil
        Task {
            do {
                if mode == .signIn {
                    try await session.signIn(email: email, password: password)
                } else {
                    try await session.signUp(
                        email: email, password: password, name: name.isEmpty ? email : name
                    )
                }
            } catch {
                self.error = Self.describe(error)
            }
            busy = false
        }
    }

    private static func describe(_ error: Error) -> String {
        switch error {
        case APIError.unauthorized:
            return "That email and password don't match."
        case APIError.server(_, let message?):
            return message
        case APIError.transport(let message):
            return message
        case APIError.notJSON(let status, _):
            // Worth naming rather than hiding: this is what an access wall looks
            // like, and it is not a credentials problem.
            return "The server answered \(status) with something that wasn't JSON."
        case APIError.decoding(let summary):
            return "The server's answer didn't match what this app expects — \(summary). The app is probably older than the API."
        case KeychainError.status(let status):
            // Signing in worked and then could not be remembered, which is a
            // different problem from bad credentials and needs saying so.
            return "Signed in, but the session couldn't be saved (keychain error \(status))."
        default:
            return "That didn't work: \(error)"
        }
    }
}
