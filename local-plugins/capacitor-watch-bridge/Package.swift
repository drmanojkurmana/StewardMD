// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StewardmdCapacitorWatchBridge",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "StewardmdCapacitorWatchBridge",
            targets: ["WatchBridgePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(name: "StewardMDWatchCore", path: "../../Packages/StewardMDWatchCore")
    ],
    targets: [
        .target(
            name: "WatchBridgePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "StewardMDWatchCore", package: "StewardMDWatchCore")
            ],
            path: "ios/Sources/WatchBridgePlugin")
    ]
)
