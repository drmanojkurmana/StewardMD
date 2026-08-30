// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1"),
        .package(name: "AparajitaCapacitorBiometricAuth", path: "../../../node_modules/@aparajita/capacitor-biometric-auth"),
        .package(name: "CapacitorCommunitySpeechRecognition", path: "../../../local-plugins/capacitor-community-speech-recognition"),
        .package(name: "CapacitorCommunitySqlite", path: "../../../node_modules/@capacitor-community/sqlite"),
        .package(name: "CapacitorCommunityTextToSpeech", path: "../../../node_modules/@capacitor-community/text-to-speech"),
        .package(name: "CapacitorFirebaseAppCheck", path: "symlinks/CapacitorFirebaseAppCheck"),
        .package(name: "CapacitorFirebaseAuthentication", path: "../../../node_modules/@capacitor-firebase/authentication"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorBarcodeScanner", path: "../../../node_modules/@capacitor/barcode-scanner"),
        .package(name: "CapacitorCamera", path: "../../../node_modules/@capacitor/camera"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorHaptics", path: "../../../node_modules/@capacitor/haptics"),
        .package(name: "CapacitorLocalNotifications", path: "../../../node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorPreferences", path: "../../../node_modules/@capacitor/preferences"),
        .package(name: "CapacitorPushNotifications", path: "../../../node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "CapacitorSplashScreen", path: "../../../node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../node_modules/@capacitor/status-bar"),
        .package(name: "CapawesomeCapacitorFilePicker", path: "../../../node_modules/@capawesome/capacitor-file-picker"),
        .package(name: "CapgoCapacitorUpdater", path: "../../../node_modules/@capgo/capacitor-updater"),
        .package(name: "StewardmdCapacitorAppOrientation", path: "../../../local-plugins/capacitor-app-orientation"),
        .package(name: "StewardmdCapacitorEcgDigitiser", path: "../../../local-plugins/capacitor-ecg-digitiser"),
        .package(name: "StewardmdCapacitorFundxDepth", path: "../../../local-plugins/capacitor-fundx-depth"),
        .package(name: "StewardmdCapacitorIap", path: "../../../local-plugins/capacitor-iap"),
        .package(name: "StewardmdCapacitorLlama", path: "../../../local-plugins/capacitor-llama"),
        .package(name: "StewardmdCapacitorSknxVision", path: "../../../local-plugins/capacitor-sknx-vision"),
        .package(name: "StewardmdCapacitorVisionOcr", path: "../../../local-plugins/capacitor-vision-ocr"),
        .package(name: "StewardmdCapacitorWatchBridge", path: "../../../local-plugins/capacitor-watch-bridge"),
        .package(name: "StewardmdCapacitorWhisper", path: "../../../local-plugins/capacitor-whisper"),
        .package(name: "CapacitorSecureStoragePlugin", path: "../../../node_modules/capacitor-secure-storage-plugin")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorBiometricAuth", package: "AparajitaCapacitorBiometricAuth"),
                .product(name: "CapacitorCommunitySpeechRecognition", package: "CapacitorCommunitySpeechRecognition"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorCommunityTextToSpeech", package: "CapacitorCommunityTextToSpeech"),
                .product(name: "CapacitorFirebaseAppCheck", package: "CapacitorFirebaseAppCheck"),
                .product(name: "CapacitorFirebaseAuthentication", package: "CapacitorFirebaseAuthentication"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBarcodeScanner", package: "CapacitorBarcodeScanner"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapawesomeCapacitorFilePicker", package: "CapawesomeCapacitorFilePicker"),
                .product(name: "CapgoCapacitorUpdater", package: "CapgoCapacitorUpdater"),
                .product(name: "StewardmdCapacitorAppOrientation", package: "StewardmdCapacitorAppOrientation"),
                .product(name: "StewardmdCapacitorEcgDigitiser", package: "StewardmdCapacitorEcgDigitiser"),
                .product(name: "StewardmdCapacitorFundxDepth", package: "StewardmdCapacitorFundxDepth"),
                .product(name: "StewardmdCapacitorIap", package: "StewardmdCapacitorIap"),
                .product(name: "StewardmdCapacitorLlama", package: "StewardmdCapacitorLlama"),
                .product(name: "StewardmdCapacitorSknxVision", package: "StewardmdCapacitorSknxVision"),
                .product(name: "StewardmdCapacitorVisionOcr", package: "StewardmdCapacitorVisionOcr"),
                .product(name: "StewardmdCapacitorWatchBridge", package: "StewardmdCapacitorWatchBridge"),
                .product(name: "StewardmdCapacitorWhisper", package: "StewardmdCapacitorWhisper"),
                .product(name: "CapacitorSecureStoragePlugin", package: "CapacitorSecureStoragePlugin")
            ]
        )
    ]
)
