// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StewardmdCapacitorCaptureGuard",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "StewardmdCapacitorCaptureGuard",
            targets: ["CaptureGuardPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CaptureGuardPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CaptureGuardPlugin")
    ]
)
