# MaiK on MLX (iPhone): spike, linking and go/no-go

Owner request, 2026-09-28: "ios version have MLX AND ANDROID HAVE EXISTING ONE", then "go ahead do all
phases". Android keeps llama.cpp (capacitor-llama). iOS gets MLX as a second engine for the packs that
have an MLX build, with llama.cpp as the fallback. Everything is behind flag `smd_maik_mlx` (default
OFF), and the native plugin is not linked into the app yet (see "Blockers").

## What prompted this

The mlx.fast challenge (yukon.org/mlxfast) reported Ternary Bonsai 2 27B at 580 decode tok/s on an M5
Mac, 505% over its baseline. Read from the challenge and the engine repo
(`Layr-Labs/mlxfast-bonsai2-27b-engine`, commit c52373654fcd):

- Most of the speed is **speculative decoding**: 14.2 tokens accepted per verify round. The plain model
  on its own runs about 28.7 tok/s on an M5 Pro and about 47 tok/s on an M5 Max (model card).
- The engine is macOS only (Package.swift `.macOS(.v14)`), built on Layr-Labs forks of mlx-swift and
  mlx-swift-lm, with vendored Metal kernels. It never mentions iOS.
- Drafters: an MTP head (`EigenLabs/Qwen3.8-27B-MTP-4bit`, 238.9 MB) and DFlash 2 (3.85 GB, too big for
  a phone). The MTP head is driven by the fork's continuous-batching runner, not by the plain
  `generate()` call that capacitor-mlx uses.

A phone moves memory several times slower than an M5 Mac, and every decoded token reads the whole
model. Expect tens of tok/s on an iPhone at best, not hundreds. That is what the spike measures.

## Blockers (owner decisions, not code)

1. **iOS 17 floor.** mlx-swift and mlx-swift-lm declare `.iOS(.v17)`. The app ships
   `IPHONEOS_DEPLOYMENT_TARGET` 16.4 and CapApp-SPM declares `.iOS(.v16)`. SwiftPM will not build a
   dependency whose floor is above its consumer's, so linking capacitor-mlx means raising the WHOLE app
   to iOS 17. Every iOS 16 user loses the app, not only MaiK. Every phone the on-device models support
   (`DEVICE_SUPPORTED` in maik-models.js) already runs iOS 18 or later.
2. **The 27B MLX build is 8.62 GB**, against 5.95 GB for the GGUF MaiK uses now. Vision weights inside
   it are skipped at load (about 7.7 GB resident), plus KV cache. It may not fit in the jetsam limit of a
   12 GB iPhone. The load-time memory check decides; when it refuses, MaiK answers on llama.cpp.
3. **Toolchain.** The pinned mlx-swift declares swift-tools-version 6.3. Build with the Xcode on the
   owner's Mac (CLAUDE.md `DEVELOPER_DIR`), not CommandLineTools.
4. **The 27B needs the fork.** Its `model_type` is `prism_hadamard_qwen35`, which only the Layr-Labs
   mlx-swift-lm registers. The model card warns an ordinary MLX loader returns wrong text, not an
   error. The 8B MLX build is a stock `qwen3` model and loads anywhere.

## What is built (branch `claude/twitter-post-meaning-6h0ikw`)

| Piece | Where | State |
|---|---|---|
| MLX file registry, pinned to HF commits, sha256 per file | `maik-models.js` (`mlx:` on `bonsai-ternary-8b`, `bonsai2-27b`) | unit-tested |
| One-file sub-packs `<id>#mlx:<file>`, downloaded by the existing native downloader, hash-checked | `maik-models.js` (`ensureMlx`, `mlxReady`, `mlxPaths`) | unit + browser tested |
| Engine adapter: one `llama()` object that forwards to Llama or Mlx; MLX only when ready; images always llama.cpp; any MLX load failure answers on llama.cpp and deletes nothing | `maik-local.js` (`engineFor`, adapter, `ensureLoaded`) | unit-tested, mutation-checked |
| Settings row "Faster iPhone engine (Labs)" under Advanced, only with the flag on an iPhone | `maik-engine.js` (`mlxRowHTML`) | headless Chromium test |
| Native plugin `Capacitor.Plugins.Mlx`: available/load/generate/cancel/release, same events as Llama, DEBUG self-benchmark | `local-plugins/capacitor-mlx/` | **not compiled** (no Xcode in the cloud session); not linked |

Tests: `test/maik-mlx.test.mjs` (unit), `node test/run-maik-mlx-ui.mjs` (headless Chromium).

Pins (read from the repositories, 2026-09-28):

- mlx-swift-lm `9f70e68dce563c90ad443fef470a713936bf6a4d` (Layr-Labs main, 2026-09-27)
- mlx-swift `0f4fe403bef6899e8a72882bc6d4036a7a62ae31` (the revision that mlx-swift-lm commit pins)
- Ternary Bonsai 2 27B MLX: HF `prism-ml/Ternary-Bonsai-2-27B-mlx-2bit` @ `fcba37d2117a7077eac6b613b2668d14d9779edd`
- Ternary Bonsai 8B MLX: HF `prism-ml/Ternary-Bonsai-8B-mlx-2bit` @ `9260b24298e4211e804663e9f519962cf59f34be`

## Phase 1: the spike (owner's Mac + a 12 GB iPhone)

Do this before anything ships. Everything below is on a throwaway branch or a local build.

1. **Recovery point.** `git tag pre-mlx-ios17` on the commit you build from.
2. **Link the plugin (local build only).**
   - Add `"@stewardmd/capacitor-mlx": "file:local-plugins/capacitor-mlx"` to package.json and run
     `npm install`.
   - Raise `IPHONEOS_DEPLOYMENT_TARGET` to 17.0 in `ios/App/App.xcodeproj`.
   - `scripts/build-www.sh`, then `npx cap sync ios`. Check that
     `ios/App/CapApp-SPM/Package.swift` now lists the Mlx plugin and declares an iOS 17 floor. If
     sync regenerated it at `.v16`, the build fails with a platform-version error; raise it there too.
   - Build the `App` scheme as CLAUDE.md describes. The first resolve fetches the MLX forks and
     swift-transformers; expect a long first build (MLX compiles its Metal library).
3. **Install and verify the running bundle** (CLAUDE.md: installing wipes app data, and read the `?v=`
   token from the live WebView). The token for this change is `mlx1` on maik-engine.js, maik-models.js
   and maik-local.js.
4. **Baseline on llama.cpp first.** With the flag OFF, download MAiK Prime (`bonsai-ternary-8b`) and,
   on a 12 GB phone, MAiK Max 2 (`bonsai2-27b`). Run `test/device/maik-bench.html` for both. Record
   tok/s, prefill, time to first token and total time.
5. **Turn the flag on** through the iOS WebView debugger (CLAUDE.md, `test/ios-webkit-cdp.mjs`):
   `localStorage.setItem("smd_maik_mlx","1")`, then reopen Settings. Download the faster engine for
   MAiK Prime from Advanced (2.32 GB), then for MAiK Max 2 (8.62 GB) on the 12 GB phone.
6. **MLX self-benchmark (DEBUG build).** Drop the marker, then relaunch the app:
   `Capacitor.Plugins.Filesystem.writeFile({ path: "maik-mlx-selftest", data: "", directory: "DATA" })`
   (Directory.Data is the app's Documents on iOS). Read the `[MLX-PERF] SELFTEST` lines from the
   device console: `load_ms`, `avail_before` / `avail_after` (jetsam headroom), `tok_s`,
   `prefill_tok_s`, `peak`, and the first 300 characters of each answer.
7. **The same questions through the app.** Ask 5 real questions per pack with the flag on, then with it
   off. Record the `perf` line (engine, tok/s, prefill, peak memory) and keep both answers.

### Go / no-go

Continue to Phase 4 only if ALL hold, per pack:

- **Speed:** MLX decode tok/s at least 1.5x llama.cpp on the same phone, and time to first token no
  worse.
- **Memory:** loads without a jetsam kill, three times in a row, with `avail_after` above 500 MB.
- **Answers:** the grounded answers pass the same claim check (`kb/ai/maik-grounding.js`) at the same
  rate as llama.cpp on the 5 questions, and no answer is garbled (the 27B's wrong-loader failure mode
  is fluent-looking nonsense, so read them).
- **Fallback:** with the MLX files deleted from Documents by hand, the next question still answers
  (on llama.cpp).

If the 8B passes and the 27B does not fit, ship MLX for the 8B only: drop the `mlx:` block from
`bonsai2-27b` in maik-models.js.

## Phase 4: rollout (after a GO and owner approval)

1. Owner approves the iOS 17 floor. Link capacitor-mlx in the real package.json and the Xcode project.
2. Keep the flag default OFF for one release; turn it on for Labs testers only.
3. Then: the MTP drafter (238.9 MB, 4% of the 27B, under `DRAFT_MAX_RATIO`) through the fork's
   runner, the 25 s background grace that capacitor-llama has, and KV prefix reuse across questions.
   Each of these is measured on a phone before it is kept.
4. After one release in production with no MLX-caused failures: consider making MLX the default for
   packs that passed, and remove the recovery flag after that (a recovery switch that outlives its
   release becomes a mode).

## Undo

- Flag off: `smd_maik_mlx` unset or `"0"`. Nothing MLX runs; downloaded MLX files stay until removed
  from Settings.
- Unlink: remove the package.json line, `npx cap sync ios`, restore the deployment target from the
  `pre-mlx-ios17` tag.
