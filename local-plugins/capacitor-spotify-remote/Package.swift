// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorSpotifyRemote — Spotify App Remote (SPTAppRemote) for the PrepNucleus
// music player (iOS only; Android is a stub that reports unavailable and keeps the Web API path).
//
// Spotify's iOS SDK ships as an SPM package whose only product, `SpotifyiOS`, is a binaryTarget
// wrapping SpotifyiOS.xcframework (verified in the repo at tag v5.0.1: Package.swift declares
// `.binaryTarget(name: "SpotifyiOS", path: "SpotifyiOS.xcframework")`, slices ios-arm64 +
// ios-arm64_x86_64-simulator, framework floor iOS 12 — below this plugin's iOS 17 floor, so no
// deployment-target change is needed). We therefore depend on the upstream package pinned to an
// EXACT version instead of vendoring the xcframework the way capacitor-needle does: no binary is
// committed and no fetch script is required. Bump only after re-checking the new tag's
// Package.swift, CHANGELOG and header surface (see NOTES-spotify-remote.md at the repo root).
let package = Package(
    name: "StewardmdCapacitorSpotifyRemote",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "StewardmdCapacitorSpotifyRemote",
            targets: ["SpotifyRemotePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(name: "SpotifyiOS", url: "https://github.com/spotify/ios-sdk.git", exact: "5.0.1")
    ],
    targets: [
        .target(
            name: "SpotifyRemotePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "SpotifyiOS", package: "SpotifyiOS")
            ],
            path: "ios/Sources/SpotifyRemotePlugin")
    ]
)
