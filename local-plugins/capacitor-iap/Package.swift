// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorIap - minimal StoreKit 2 in-app-purchase bridge for StewardMD Pro (iOS 15+).
// No third-party runtime; the server re-validates every transaction via the App Store Server API.
let package = Package(
    name: "StewardmdCapacitorIap",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "StewardmdCapacitorIap", targets: ["IapPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "IapPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/IapPlugin")
    ]
)
