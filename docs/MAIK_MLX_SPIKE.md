# MaiK on MLX (iPhone): spike, linking and go/no-go

Owner request, 2026-09-28: "ios version have MLX AND ANDROID HAVE EXISTING ONE", then "go ahead do all
phases", then **"No need phase 1. Go with phase 4"**. Android keeps llama.cpp (capacitor-llama). iOS
gets MLX as a second engine for the packs that have an MLX build, with llama.cpp as the fallback.

**Status (2026-09-28):** capacitor-mlx is LINKED and the app's iOS floor is 17.0. The Phase 1 device
measurement was skipped by the owner, so nothing about MLX speed, memory or answer quality on an iPhone
has been measured, and the Swift has not yet been compiled. Rollout is Labs-only: a tester turns on
"Faster iPhone engine (Labs)" in MaiK Settings, Advanced (flag `smd_maik_mlx`, default OFF).
Recovery point: commit `8f51b858` (before the link and the iOS 17 raise).

**Scope (owner, 2026-09-28: "Ignore 8gb model"):** only MAiK Prime (`bonsai-ternary-8b`, 2.32 GB MLX
build) has an MLX engine. The 8.62 GB MAiK Max 2 MLX build was removed from the registry, the plugin's
self-test and the Settings text; MAiK Max 2 stays on llama.cpp. Notes below about the 27B are history.

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

## Owner decisions taken, and what they cost

1. **iOS 17 floor (TAKEN).** mlx-swift and mlx-swift-lm declare `.iOS(.v17)`, and SwiftPM will not
   build a dependency whose floor is above its consumer's. The app's four iPhone
   `IPHONEOS_DEPLOYMENT_TARGET` settings moved 16.4 -> 17.0 and CapApp-SPM to `.iOS(.v17)`. Every iOS 16
   user loses app updates, not only MaiK. Capacitor's CLI regenerates CapApp-SPM's floor from the FIRST
   `IPHONEOS_DEPLOYMENT_TARGET` in project.pbxproj, so all of them must stay >= 17 (pinned by
   test/maik-mlx.test.mjs).
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
| Native plugin `Capacitor.Plugins.Mlx`: available/load/generate/cancel/release, same events as Llama, DEBUG self-benchmark | `local-plugins/capacitor-mlx/` | linked (package.json, CapApp-SPM); **not yet compiled** (no Xcode in the cloud session) |
| Labs switch "Faster iPhone engine (Labs)", shown only on an iPhone build with the plugin | `maik-engine.js` (`mlxRowHTML`, `data-me-mlx="toggle"`), `maik-models.js` (`mlxAvailable`, `setMlxEnabled`) | headless Chromium test |

Tests: `test/maik-mlx.test.mjs` (unit), `node test/run-maik-mlx-ui.mjs` (headless Chromium).

Pins (read from the repositories 2026-09-28; moved to the owner's forks 2026-10-03):

- mlx-swift-lm `7354dce7a8f62142994acd180e2dc134cb46483f` (drmanojkurmana/mlx-swift-lm `stewardmd-ios27`:
  Layr-Labs main `9f70e68dce563c90ad443fef470a713936bf6a4d` of 2026-09-27 plus one commit that only
  repoints its mlx-swift dependency at the fork below)
- mlx-swift `757b0a04aa8ee27b99b7026f6c5d7fc9629f757e` (drmanojkurmana/mlx-swift `stewardmd-ios27`:
  Layr-Labs `0f4fe403bef6899e8a72882bc6d4036a7a62ae31` plus a verbatim port of ml-explore/mlx-swift
  `ab924c8`'s jit_compiler change, so Cmlx no longer compiles `cpu/jit_compiler.cpp` on iOS. Its
  `std::system` call is unavailable in the Xcode 27.2 iOS SDK and broke every iOS build. The code is
  dead on iOS, since `compiled_conditional.cpp` already picks `no_cpu/compiled.cpp` there.) It must
  equal the revision the mlx-swift-lm commit pins. Drop both forks once Layr-Labs carries the change.
- Ternary Bonsai 2 27B MLX: HF `prism-ml/Ternary-Bonsai-2-27B-mlx-2bit` @ `fcba37d2117a7077eac6b613b2668d14d9779edd`
- Ternary Bonsai 8B MLX: HF `prism-ml/Ternary-Bonsai-8B-mlx-2bit` @ `9260b24298e4211e804663e9f519962cf59f34be`

## Phase 1: the spike (SKIPPED by the owner, 2026-09-28)

Kept as the recipe for checking MLX on a phone when that is wanted. Steps 1 and 2 (linking) are done in
the repo.

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

## Phase 4: rollout (started 2026-09-28, owner: "Go with phase 4")

Done in the repo:
1. capacitor-mlx linked: root package.json, `ios/App/CapApp-SPM/Package.swift`, app on iOS 17.0.
   `package-lock.json` is NOT updated (the cloud session could not run npm install): run `npm install`
   on the Mac before `npx cap sync ios`.
2. Flag default OFF; a Labs switch in MaiK Settings, Advanced, on iPhone builds that link the plugin.

On the owner's Mac, in order:
1. `npm install`, `scripts/build-www.sh`, `npx cap sync ios`. Confirm CapApp-SPM still reads
   `.iOS(.v17)` and lists StewardmdCapacitorMlx.
2. Build the `App` scheme (CLAUDE.md). This is the FIRST compile of capacitor-mlx; fix what Xcode
   reports. The first resolve fetches the Layr-Labs forks and swift-transformers, and MLX compiles its
   Metal library, so expect a long first build.
3. Install, verify the running bundle's `?v=` token (`mlx3`), turn the switch on, download the faster
   engine for MAiK Prime, ask a question, and read the `[MLX-PERF]` lines.
4. If the build cannot be made to work, `git revert` the phase 4 commit (the one after `8f51b858`): that restores iOS 16.4 and unlinks MLX
   while keeping the JS (inert without the plugin).

Not done, and why:
- **MTP drafter** (the source of most of the mlx.fast speed). The fork drives it only from inside its
  continuous-batching engine (`Libraries/MLXLMCommon/ContinuousBatchingV2/MTP/`), with no public
  single-stream API. Wiring it means porting that path; worth doing only once plain MLX has been seen
  working on a phone.
- **Background grace** like capacitor-llama's 25 s: deliberately not copied. MLX runs every step on
  the GPU and iOS refuses GPU work from a backgrounded app, so the answer would fail rather than
  finish. MLX cancels and releases on background.
- **KV prefix reuse** across questions: not in the plain generate path; every MLX question prefills
  in full.
- **Default on**: not before MLX has run on real phones. A recovery flag that outlives its release
  becomes a mode, so remove `smd_maik_mlx` only after MLX has been the default for one release.

## Undo

- Flag off: `smd_maik_mlx` unset or `"0"`. Nothing MLX runs; downloaded MLX files stay until removed
  from Settings.
- Unlink: `git revert` the phase 4 commit (restores iOS 16.4 and removes the package.json and CapApp-SPM
  lines), then `npm install` and `npx cap sync ios`.
