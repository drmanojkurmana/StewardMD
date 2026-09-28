// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorMlx: MaiK's second on-device engine, iOS only (owner, 2026-09-28: "ios version
// have MLX and android have existing one"). Android keeps capacitor-llama.
//
// NOT LINKED INTO THE APP YET. This package is deliberately absent from the root package.json, so
// `npx cap sync` does not pull it and today's iOS build is unchanged. Two reasons, both owner calls:
//   1. PLATFORM FLOOR. mlx-swift and mlx-swift-lm declare .iOS(.v17). The app ships
//      IPHONEOS_DEPLOYMENT_TARGET 16.4 and ios/App/CapApp-SPM declares .iOS(.v16); SwiftPM refuses a
//      dependency whose floor is above its consumer's. Linking this means raising the whole app to
//      iOS 17, which drops every iOS 16 user, not only MaiK users.
//   2. TOOLCHAIN. The pinned mlx-swift declares swift-tools-version 6.3. Build with the Xcode on the
//      owner's Mac (CLAUDE.md, DEVELOPER_DIR), not CommandLineTools.
// docs/MAIK_MLX_SPIKE.md has the exact linking steps and the go/no-go measurements.
//
// WHY THE LAYR-LABS FORKS, not ml-explore upstream: Ternary Bonsai 2 27B's MLX pack declares
// model_type "prism_hadamard_qwen35", which only the fork's MLXLLM registers
// (Libraries/MLXLLM/Models/PrismHadamardQwen35.swift). Its model card warns an ordinary loader
// "return[s] wrong output rather than an error". The fork also loads stock "qwen3" packs (Ternary
// Bonsai 8B MLX), so one dependency serves both.
//
// PINS (read from the repositories on 2026-09-28, not guessed):
//   mlx-swift-lm  main 9f70e68dce563c90ad443fef470a713936bf6a4d (2026-09-27)
//   mlx-swift     0f4fe403bef6899e8a72882bc6d4036a7a62ae31, the revision that mlx-swift-lm commit
//                 itself pins, so the graph has ONE MLX core. It is declared here only because this
//                 target imports MLX directly (Memory.cacheLimit).
//   swift-transformers from 1.3.2, the floor mlx-swift-lm declares; the tokenizer macro expands
//                 to code that imports Tokenizers from the consumer.
let package = Package(
    name: "StewardmdCapacitorMlx",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "StewardmdCapacitorMlx", targets: ["MlxPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/Layr-Labs/mlx-swift-lm.git", revision: "9f70e68dce563c90ad443fef470a713936bf6a4d"),
        .package(url: "https://github.com/Layr-Labs/mlx-swift.git", revision: "0f4fe403bef6899e8a72882bc6d4036a7a62ae31"),
        .package(url: "https://github.com/huggingface/swift-transformers.git", from: "1.3.2")
    ],
    targets: [
        .target(
            name: "MlxPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "MLXHuggingFace", package: "mlx-swift-lm"),
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "Tokenizers", package: "swift-transformers")
            ],
            path: "ios/Sources/MlxPlugin")
    ]
)
