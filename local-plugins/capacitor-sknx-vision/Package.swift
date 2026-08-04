// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorSknxVision - EXPERIMENTAL on-device dermatology classifier (iOS = Core ML, built
// into iOS; no third-party runtime, no binaryTarget). The .mlpackage is DOWNLOADED at runtime and
// compiled on device. Mirrors capacitor-ecg-digitiser.
let package = Package(
    name: "StewardmdCapacitorSknxVision",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "StewardmdCapacitorSknxVision", targets: ["SknxVisionPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SknxVisionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/SknxVisionPlugin")
    ]
)
