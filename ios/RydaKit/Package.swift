// swift-tools-version: 6.0
import PackageDescription

// The shared brain: API client, models, stream decoding, token storage.
//
// A package rather than a framework target, for one practical reason — it
// builds and tests on macOS in about a second with no simulator involved, and
// base64/typed-array decoding is exactly the kind of thing you want to iterate
// on in a one-second loop.
//
// Nothing here may import UIKit, MapKit, Charts or WidgetKit. The moment it
// does, the fast test loop is gone.
let package = Package(
    name: "RydaKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "RydaKit", targets: ["RydaKit"]),
    ],
    targets: [
        .target(
            name: "RydaKit",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "RydaKitTests",
            dependencies: ["RydaKit"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
