import SwiftUI
import RydaKit

struct AccountScreen: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        NavigationStack {
            List {
                Section("Your numbers") {
                    if let settings = session.settings {
                        row("Rider", "\(Int(settings.riderKg)) kg")
                        row("Bike + kit", "\(Int(settings.bikeKg)) kg")
                        row("Threshold", "\(settings.ftp) W")
                        row("Threshold HR", settings.lthr > 0 ? "\(settings.lthr) bpm" : "not set")
                        row("Position", settings.positionId.capitalized)
                    } else {
                        Text("Loading…").foregroundStyle(Palette.inkMuted)
                    }
                }
                .listRowBackground(Palette.surface1)

                Section {
                    Text(explanation)
                        .font(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
                .listRowBackground(Palette.surface1)

                Section {
                    Button("Sign out", role: .destructive) {
                        Task { await session.signOut() }
                    }
                }
                .listRowBackground(Palette.surface1)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.surface0)
            .navigationTitle("Account")
        }
    }

    private var explanation: String {
        if session.settingsSource == .saved && session.settings?.configured == true {
            return "These are edited on the website, and every watt this app shows is computed from them on the server — so the phone and the website can never disagree about the same ride."
        }
        return "These are defaults, not your numbers. Mass scales estimated power almost linearly, so until you set them on the website every wattage here is a confident guess about somebody else."
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(Palette.inkSecondary)
            Spacer()
            Text(value).monospacedDigit().foregroundStyle(Palette.ink)
        }
        .font(.subheadline)
    }
}
