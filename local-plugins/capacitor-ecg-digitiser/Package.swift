// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorEcgDigitiser — on-device ECG digitiser (iOS = Core ML, built into iOS; no
// third-party runtime, no binaryTarget). The .mlpackage is DOWNLOADED at runtime and compiled on device.
let package = Package(
    name: "StewardmdCapacitorEcgDigitiser",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "StewardmdCapacitorEcgDigitiser", targets: ["EcgDigitiserPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "EcgDigitiserPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/EcgDigitiserPlugin")
    ]
)
