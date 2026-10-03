// swift-tools-version: 5.9
import PackageDescription

// StewardmdCapacitorMlx: MaiK's second on-device engine, iOS only (owner, 2026-09-28: "ios version
// have MLX and android have existing one"). Android keeps capacitor-llama.
//
// LINKED (owner, 2026-09-28: "No need phase 1. Go with phase 4"): root package.json and
// ios/App/CapApp-SPM list it, and the app's IPHONEOS_DEPLOYMENT_TARGET is 17.0, because mlx-swift and
// mlx-swift-lm declare .iOS(.v17) and SwiftPM refuses a dependency whose floor is above its
// consumer's. That raise dropped iOS 16 for the whole app. The pinned mlx-swift declares
// swift-tools-version 6.3: build with the Xcode on the owner's Mac (CLAUDE.md, DEVELOPER_DIR).
// Recovery: the commit before the link, 8f51b858 on branch claude/twitter-post-meaning-6h0ikw.
// docs/MAIK_MLX_SPIKE.md has the rollout notes.
//
// WHY THE LAYR-LABS FORKS, not ml-explore upstream: Ternary Bonsai 2 27B's MLX pack declares
// model_type "prism_hadamard_qwen35", which only the fork's MLXLLM registers
// (Libraries/MLXLLM/Models/PrismHadamardQwen35.swift). Its model card warns an ordinary loader
// "return[s] wrong output rather than an error". The fork also loads stock "qwen3" packs (Ternary
// Bonsai 8B MLX). 2026-09-28: the 27B MLX build was dropped (owner: "Ignore 8gb model"), so only the
// stock 8B is used now; the fork stays pinned as-is, and moving to ml-explore upstream is possible
// later but would need its own pins verified.
//
// PINS (read from the repositories on 2026-09-28, not guessed; forks added 2026-10-03):
//   mlx-swift-lm  drmanojkurmana/mlx-swift-lm branch stewardmd-ios27,
//                 7354dce7a8f62142994acd180e2dc134cb46483f = Layr-Labs main 9f70e68dce563c90ad443fef470a713936bf6a4d
//                 (2026-09-27) plus one commit that only repoints its mlx-swift dependency at the fork below.
//   mlx-swift     drmanojkurmana/mlx-swift branch stewardmd-ios27,
//                 757b0a04aa8ee27b99b7026f6c5d7fc9629f757e = Layr-Labs 0f4fe403bef6899e8a72882bc6d4036a7a62ae31
//                 plus one commit. It MUST equal the revision the mlx-swift-lm commit pins, so the graph has
//                 ONE MLX core and SwiftPM can resolve. It is declared here only because this target imports
//                 MLX directly (Memory.cacheLimit).
//   swift-transformers from 1.3.2, the floor mlx-swift-lm declares; the tokenizer macro expands
//                 to code that imports Tokenizers from the consumer.
//
// WHY THE drmanojkurmana FORKS: Xcode 27.2's iOS SDK marks std::system() unavailable, and Cmlx compiled
// mlx/backend/cpu/jit_compiler.cpp (which shells out through it) on every platform, so every iOS build
// failed with "'system' is unavailable". The mlx-swift fork commit ports ml-explore/mlx-swift ab924c8
// ("update for mlx v0.32.2", #450) verbatim for that one change: jit_compiler.cpp is excluded from
// direct compilation and included from mlx-conditional/jit_compiler_conditional.cpp only when not
// iOS/visionOS. It is dead code on iOS anyway: its only caller is cpu/compiled.cpp, and
// compiled_conditional.cpp already selects no_cpu/compiled.cpp on iOS. No behaviour change on device.
// Drop the forks once Layr-Labs/mlx-swift carries the same change (upstream PR is the owner's call).
let package = Package(
    name: "StewardmdCapacitorMlx",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "StewardmdCapacitorMlx", targets: ["MlxPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/drmanojkurmana/mlx-swift-lm.git", revision: "7354dce7a8f62142994acd180e2dc134cb46483f"),
        .package(url: "https://github.com/drmanojkurmana/mlx-swift.git", revision: "757b0a04aa8ee27b99b7026f6c5d7fc9629f757e"),
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
