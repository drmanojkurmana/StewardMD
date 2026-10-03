// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorNeedle — the Needle 3 router engine for StewardMD Edge (iOS side).
//
// CNeedle is a LOCAL xcframework built from the pinned upstream static libraries by
// scripts/make-xcframework.sh (it is not in git: run scripts/fetch-needle.sh first). The archive is
// C++ against libc++ (std::__1) and libSystem only, hence the single extra linked library.
// No process isolation on iOS: one serial queue and a token cap instead (gate A0.2). Device only:
// the simulator slice is optional and unaudited.
let package = Package(
    name: "StewardmdCapacitorNeedle",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "StewardmdCapacitorNeedle", targets: ["NeedlePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .binaryTarget(name: "CNeedle", path: "ios/Frameworks/CNeedle.xcframework"),
        .target(
            name: "NeedlePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "CNeedle"
            ],
            path: "ios/Sources/NeedlePlugin",
            linkerSettings: [.linkedLibrary("c++")])
    ]
)
