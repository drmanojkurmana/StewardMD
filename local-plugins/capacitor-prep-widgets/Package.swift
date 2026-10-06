// swift-tools-version: 5.9
import PackageDescription

// Depends on StewardMDWatchCore for PrepSnapshot + PrepActivityAttributes, the same types the widget
// extension renders (the pattern capacitor-watch-bridge uses for the Code Blue / Sepsis activities).
let package = Package(
    name: "StewardmdCapacitorPrepWidgets",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "StewardmdCapacitorPrepWidgets",
            targets: ["PrepWidgetsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(name: "StewardMDWatchCore", path: "../../Packages/StewardMDWatchCore")
    ],
    targets: [
        .target(
            name: "PrepWidgetsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "StewardMDWatchCore", package: "StewardMDWatchCore")
            ],
            path: "ios/Sources/PrepWidgetsPlugin")
    ]
)
