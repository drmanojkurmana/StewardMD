// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StewardMDWatchCore",
    platforms: [.macOS(.v13), .watchOS(.v10), .iOS(.v16)],
    products: [
        .library(name: "StewardMDWatchCore", targets: ["StewardMDWatchCore"])
    ],
    targets: [
        .target(name: "StewardMDWatchCore"),
        .testTarget(name: "StewardMDWatchCoreTests", dependencies: ["StewardMDWatchCore"])
    ]
)
