// swift-tools-version: 5.9
import PackageDescription

// SPM manifest for the vendored @capacitor-community/speech-recognition plugin.
// The upstream 7.0.1 package ships only a CocoaPods podspec (no Package.swift), so
// Capacitor skips it under SPM. StewardMD's iOS project uses SPM, so we vendor the
// plugin locally, converted to pure-Swift CAPBridgedPlugin registration, and expose it
// here. The product/package name must be the PascalCase of the npm name
// (@capacitor-community/speech-recognition -> CapacitorCommunitySpeechRecognition) so
// `npx cap sync` wires it into CapApp-SPM automatically.
let package = Package(
    name: "CapacitorCommunitySpeechRecognition",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCommunitySpeechRecognition",
            targets: ["SpeechRecognitionPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SpeechRecognitionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Plugin")
    ]
)
