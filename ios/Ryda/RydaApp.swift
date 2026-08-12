import SwiftUI
import RydaKit

@main
struct RydaApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(Palette.brand)
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    /// Set by a widget tap, so a cold launch can open straight to the ride.
    @State private var deepLinkedRide: String?

    var body: some View {
        Group {
            switch session.state {
            case .unknown:
                ProgressView().tint(Palette.inkMuted)
            case .signedOut:
                SignInScreen()
            case .signedIn:
                MainTabs(deepLinkedRide: $deepLinkedRide)
            }
        }
        .background(Palette.surface0)
        .task {
            await session.restore()
            #if DEBUG
            // Debug-only, same reasoning as the token hook in SessionStore:
            // `simctl openurl` puts a system confirmation in front of the deep
            // link, which nothing on the command line can dismiss, so driving
            // to a screen for a screenshot needs a way in that isn't a URL.
            //
            //   xcrun simctl launch booted com.fadi.ryda \
            //     -RydaDebugToken "<token>" -RydaDebugRide "<ride id>"
            if let ride = UserDefaults.standard.string(forKey: "RydaDebugRide"), !ride.isEmpty {
                deepLinkedRide = ride
            }
            #endif
        }
        .onOpenURL { url in
            // ryda://ride/<id>
            guard url.scheme == "ryda", url.host == "ride" else { return }
            let id = url.pathComponents.dropFirst().joined(separator: "/")
            if !id.isEmpty { deepLinkedRide = id }
        }
    }
}

struct MainTabs: View {
    @Binding var deepLinkedRide: String?
    // Same debug affordance as the token and ride hooks: simctl cannot tap, so
    // reaching a tab for a screenshot needs a way in that is not a gesture.
    @State private var selection = debugTab

    private static var debugTab: Int {
        #if DEBUG
        // integer(forKey:) rather than object(forKey:) as? Int — a launch
        // argument arrives as a string, and the cast silently yields nil.
        return UserDefaults.standard.integer(forKey: "RydaDebugTab")
        #else
        return 0
        #endif
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab("Rides", systemImage: "bicycle", value: 0) {
                RideListScreen(deepLinkedRide: $deepLinkedRide)
            }
            Tab("Trend", systemImage: "chart.xyaxis.line", value: 1) {
                TrendScreen()
            }
            Tab("Account", systemImage: "person.crop.circle", value: 2) {
                AccountScreen()
            }
        }
    }
}
