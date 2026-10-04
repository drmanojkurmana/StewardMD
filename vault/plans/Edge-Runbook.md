---
tags: [plan, edge, runbook]
status: round 2 done (2026-10-03); Pixel 22:30 round: renderer-gone edge8 PASS, Needle p95 797 ms / +123 MB PASS, FunctionGemma p95 395 ms PASS but +575 MB MISS, 30-min unplugged session no SEVERE, battery -8 points, Needle 22/150 timeouts under MaiK load MISS; iPhone back-off during real MaiK Lite generation PASS, availMB with MaiK Lite 5,349 min PASS; real iPhone Serious still open
---
# StewardMD Edge: owner runbook (sprint days 2 to 5)

Plan: [[Edge-Master-Plan]] (gates A0, section 7 pass marks, section 16 sprint). Module: [[StewardMD Edge]].
Everything here needs a Mac, a phone, an account or a doctor. Claude's side (JS, dataset, scorer,
plugin source) is done and tested in Node and headless Chrome. **Nothing native has been built
or run on a device yet**: each gate below is the first real test of that part.

Rules that still hold: flag `smd_edge` stays OFF by default; no patient data anywhere in training;
a failed gate drops that model from v1, it is not worked around.

## 0. Setup (once)
```sh
git checkout ccr-fbfae7e0-rjkxxk && npm install
node scripts/edge/generate.mjs     # ~3 min; train/val + checks the frozen test hash
node scripts/edge/export.mjs       # dataset/export/{cactus,needle-local,llama-json,bakeoff}
node scripts/edge/score.mjs        # baselines; must print rules PASS before anything else
```
If `generate.mjs` changes `test.jsonl`, stop: the frozen test set moved (`npm test` also fails
`edge-dataset.test.mjs`). That needs a new `schema_version`, not a silent overwrite.

## 1. Gate A0.1: 16 KB pages (Android)
**Build half PASSED in the cloud container (2026-10-01):** NDK r27.2 + AGP 8.13 built both plugin
modules against Capacitor core. `libneedle_jni.so` and `libllama_jni.so`: every LOAD segment `0x4000`;
the five Needle JNI exports and `LlamaNative_setGrammar` present; no socket/HTTP/TLS symbols in the
Needle `.so`; the AAR manifest declares `NeedleService` in `:edge`. Still open: steps 3 and 4 below
on the full APK, and the run on an Android 15 16 KB emulator and the phone (no KVM in the container).

1. `cd local-plugins/capacitor-needle && scripts/fetch-needle.sh` (fails loudly on a hash change).
2. Add `"@stewardmd/capacitor-needle": "file:local-plugins/capacitor-needle"` to `package.json`,
   `npm install && npm run sync`, build a debug APK.
3. `unzip -o app-debug.apk 'lib/arm64-v8a/libneedle_jni.so' -d /tmp/apk && readelf -lW /tmp/apk/lib/arm64-v8a/libneedle_jni.so | grep LOAD`
   Every LOAD line must show `0x4000` alignment.
4. Run step 3 of gate A0.2 on an **Android 15 emulator with the 16 KB system image** and on the
   real 4 GB phone. Pass = load and one call succeed on both.
Fail: report to Cactus, drop Needle from v1, FunctionGemma alone goes forward.


**Android (2026-10-02):** step 3 PASSED on the full debug APK (build of 874fa71f3 + Needle in package.json,
locally): all 20 `.so` in `lib/arm64-v8a` have every LOAD segment at `0x4000`; the merged manifest has
`NeedleService` in `android:process=":edge"`. Step 4 on the real phone (Pixel 9, which runs 4 KB pages):
Needle loads and calls complete with valid envelopes (slow until the thread fix; re-test under gate A0.2 below). Step 4 on the 16 KB emulator PASSED (2026-10-02,
`system-images;android-35;google_apis_ps16k;arm64-v8a`, AVD `smd16k`, `getconf PAGE_SIZE` = 16384, the
Pixel debug APK): app launched with no load errors; `:edge` loaded `libneedle_jni.so` and the weights,
configure rc 111, one call `success:true` (`engine threads 4 (cpu_capacity, 4 cpus, 4 allowed)`);
llama.cpp loaded FunctionGemma and returned `{"option":1}`. Emulator timings mean nothing for phones. Needs
~7.4 GB free disk to create its userdata.

**Needle linked into the app (Mac prompt 2, item 6), 2026-10-03.** `package.json` has
`"@stewardmd/capacitor-needle": "file:local-plugins/capacitor-needle"`; `npm install` + `npm run sync`
added it to `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` and
`ios/App/CapApp-SPM/Package.swift` (relative `../../../local-plugins/...` paths, not the main checkout).
The tracked `Package.resolved` also took the mlx-swift fork pins and their dependencies, which Xcode
wrote during item 1. `smd_edge` stays default OFF: nothing calls the plugin and no `:edge` process starts
while it is off (`ps` on the Pixel after launch).
- Android (Pixel 9, `install -r`): the APK has `lib/arm64-v8a/libneedle_jni.so` and the `NeedlePlugin`
  entry in `capacitor.plugins.json`. In the live WebView (OTA bundle 167) `Capacitor.Plugins.Needle.available()`
  answered `{available:true, isolated:true, killable:true, defaultWeightsPresent:false, lowMemory:false,
  thermal:0, availMB:2424}`; an unknown method name threw "is not a function".
- **iOS (iPhone 15 Pro, iOS 27.0, 2026-10-03 12:00): item 6.2 PASSED.** A clean Xcode 27.2 build of this
  branch (App scheme, signed; `App.debug.dylib` defines the `needle_*` symbols and `NeedlePlugin` and has the
  llama `pickTokens` code), uninstalled then installed over Wi-Fi (`devicectl` works on a paired phone with
  no cable; `ios_webkit_debug_proxy` 1.9.2 also attached over Wi-Fi). Live WebView: bundle `builtin`,
  `edge-router.js?v=edge5`, `voice.js ...-ondev4`, `SMD_EDGE.llamaAdapter` contains `pick`;
  `Capacitor.Plugins.Needle.available()` answered `{available:true, isolated:false, killable:false,
  lowMemory:false, thermal:0, availMB:6118, defaultWeightsPresent:false}`.
- **Token note:** every `edge5` in this file is historical (the build each run used). Later commits on the
  branch moved `edge-router.js` to `edge6`, then `edge7` (the renderer-gone clause below), and `voice.js` to
  `-ondev4-nodash1`. The device results above were taken on `edge5`.
- **Every native build now needs the engine first.** A clean checkout must run
  `local-plugins/capacitor-needle/scripts/fetch-needle.sh` (and `scripts/make-xcframework.sh` for iOS)
  before Gradle or Xcode, or CMake (`android/libs/arm64-v8a/libneedle.a`) and SwiftPM
  (`ios/Frameworks/CNeedle.xcframework`) fail. CI builds no native app, so CI is unaffected.
- Mac note: a Gradle cache cleared by a disk clean-up made the first build fail in `checkDebugAarMetadata`
  (a missing transform file); `./gradlew --stop` and a rebuild fixed it, and re-downloaded ~1.6 GB.

## 2. Gate A0.2: process isolation (Android) / serial queue (iOS)
1. Copy weights (README of the plugin: `run-as ... files/needle/needle3.cact`). Base model is fine here.
2. Open the app, attach CDP (`adb shell pidof in.stewardmd.app`, then
   `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
3. `node test/edge-bakeoff-device.mjs --engine needle --limit 20`: 20 lines, statuses `ok`.
4. `adb shell ps -A | grep in.stewardmd.app` shows a separate `in.stewardmd.app:edge` process.
5. Kill test: during a run, `adb shell kill -9 <edge pid>`; the app must stay up, the run must
   continue with `error`/`timeout` lines, then recover to `ok` after the next cold load.
iOS: `scripts/make-xcframework.sh`, build, same step 3 through `ios_webkit_debug_proxy` (`--ios --ws`).
iOS has no kill: confirm a long call shows `busy` and then recovers, and the app never freezes.

**iOS compile half PASSED on the Mac (2026-10-02, Xcode 27.2 beta 27B5019j, arm64 device, App scheme):**
`fetch-needle.sh` matched all four pinned sha256s; `make-xcframework.sh` built `CNeedle.xcframework`.
With the plugin added to `package.json` on a local branch only, `cap sync` registered `NeedlePlugin`.
`NeedlePlugin.swift`, `LlamaPlugin.swift` and `LlamaEngine.swift` compiled with 0 errors and 0
warnings; no Swift change was needed. `NeedlePlugin.o` imports exactly `needle_init/complete/load/
reset/last_error`, all five defined in `libneedle.a`; `LlamaPlugin.o` imports `llama_sampler_init_grammar`.
**Build:** no local patch any more (2026-10-03). `capacitor-mlx` pins the owner's forks, branch `stewardmd-ios27`:
mlx-swift `757b0a0` (Layr-Labs `0f4fe40` + a port of ml-explore/mlx-swift `ab924c8`, so Cmlx no longer compiles
`cpu/jit_compiler.cpp`, whose `std::system` the iOS 27.2 SDK marks unavailable; dead code on iOS) and
mlx-swift-lm `7354dce` (Layr-Labs `9f70e68` repointed at that mlx-swift). A clean Xcode 27.2 build passes. Also needed: the Metal Toolchain
component (`xcodebuild -downloadComponent MetalToolchain`), `-skipPackagePluginValidation` (mlx-swift's
CudaBuild plugin), about 6 GB free disk for a worktree build, and the iPhone on USB or paired over Wi-Fi (2026-10-03: `devicectl` install and `ios_webkit_debug_proxy` 1.9.2 both worked over Wi-Fi with `idevice_id -l` empty).
**Item 1 smoke test (2026-10-03, from commits 6e2e3ad7b / afa03b119):** iPhone 15 Pro, signed Debug build with
Xcode 27.2 and no local patch, uninstalled then installed, live bundle `builtin` (`gold363`). MaiK answered on
the MLX plugin (engine `mlx`, Ternary Bonsai 8B MLX): prefill 920 tokens at 31.6 tok/s, decode 6.4 tok/s, peak
3.0 GB; "The target INR ... mechanical mitral valve is 2.5-3.5", the same answer llama.cpp gave on 2026-10-02.
Verified in the built app: `App.debug.dylib` defines the five `needle_*` symbols and NeedlePlugin,
references `llama_sampler_init_grammar` (exported by the embedded `llama.framework`); the live
WebView ran this bundle (`?v=clog2/gold476/gold1057`, `edge-router.js?v=edge3`), `Capacitor.Plugins.Needle` present.

**A0.2 iOS PASSED (2026-10-02, iPhone 15 Pro, iOS 27.0 24A437, base `needle3.cact`, app build from 6da7a4763):**
- `--limit 20`: 20/20 `ok`, p50 161 ms, p95 329 ms. Base Needle gave option 0 at confidence 0.01-0.08
  on every row, so all pass to MaiK (same as the host run).
- `--limit 50` three times: 150/150 `ok`; p50 157 ms, p95 259 ms, max 386 ms.
- Stuck call: `--deadline 60` gave 20/20 `timeout` at 61-65 ms each, WebView responsive throughout; the
  next normal run was 20/20 `ok`. Driving the runtime directly with a 30 ms deadline, calls made while
  the engine was stuck resolved `busy` at once (137 ms, 178 ms) and the runtime took work again once the
  call returned. `bakeoff()` itself waits out a stuck call, so it never prints `busy`.
- Thermal: iOS 27 exposes no battery temperature over USB; `ChargerData.TimeChargingThermallyLimited`
  stayed 0 after ~210 Needle + 40 llama calls (phone charging on USB, 46% to 52%). Peak memory NOT
  measured: `xctrace` (Activity Monitor) on this beta lost the device or could not find the app pid.
- Not done: Android (no phone attached), the 30-minute mixed session (A0.6).

**A0.2 Android: mechanism PASSED, latency FAILED (2026-10-02, Pixel 9 "tokay", Android 17 / SDK 37,
12 GB, base `needle3.cact`).** Test conditions, for every Android number in this file: phone charging on
USB from the Mac, CPU capped by Pixel charging thermal mitigation (X4 1.40 of 3.11 GHz, A720 1.80 of
2.60, A520 1.70 of 1.95; `VIRTUAL-SKIN-CHARGE-PERSIST` flagged), heavy background load at the start
(WhatsApp 158% CPU, swap 93% full; `am kill-all` freed it to 1.6 GB free). Re-time unplugged (wireless
adb) before a final drop decision.
- Build notes: the worktree needs `android/app/google-services.json` (gitignored; copied from the main
  checkout) or the app dies at launch (`PushNotifications.register`: FirebaseApp not initialized). The
  phone was serving OTA bundle 167 (`CapacitorUpdater`); `reset()` switched it to the APK's bundle.
- `adb shell ps -A`: `in.stewardmd.app:edge` runs as its own process. Kill test: `kill -9` of `:edge`
  mid-call (via `run-as`; shell may not) -> the call rejected "the edge engine process ended" in 2.1 s,
  the app kept its pid, Android restarted `:edge`. The app also survived ~180 runtime kills (every timed-out Needle call).
- Latency: `Needle.complete` 8.5-10.0 s per call (load 0.7-0.9 s, configure 0.7-0.8 s); iPhone 15 Pro
  ~0.15 s, x86 host ~0.5 s. Bake-off 20/20 and 50/50 `timeout` under the 1,200 ms deadline.
- What is known: the engine runs 8 `needle-engine` threads, all spinning, in `:edge` whose cpuset is
  `foreground` (cores 0-6: four A520, three A720; the X4 is excluded). Same SIMD as the iOS build (187
  `sdot` in both archives). A local, uncommitted test that pinned `:edge` to cores 4-6 before loading made
  it slower (14-17 s), so the pool is a fixed 8 threads and fewer cores hurt. `needle.h` has no thread
  knob. ~~Under the plan's rule Needle is out for Android until then.~~ Owner, 2026-10-02: Needle stays.
- **Root cause (disassembly of the pinned `libneedle.a`, android-arm64):** `Engine::Engine()` sizes the
  pool with `fast_core_mask()`: it reads `/sys/devices/system/cpu/cpuN/cpu_capacity` (else
  `cpufreq/cpuinfo_max_freq`) and counts the cores at >= 75% of the strongest (>= 70% for frequency).
  With >= 2 such cores and fewer than all, it uses min(count, 4) pinned threads; otherwise it falls back to
  `std::thread::hardware_concurrency()` clamped to 1-12. Tensor G4 has ONE core at the top (X4), so the
  fast path is skipped and the engine spins 8 threads across the efficiency cores, in a process whose
  cpuset excludes the X4 anyway. An iPhone has 2 performance cores and takes the fast path.
- **Fix (commit after this note, built, NOT yet run on the Pixel):** `needle_jni.cpp` answers the
  fallback instead: CMake links with `-Wl,--wrap=_ZNSt6__ndk16thread20hardware_concurrencyEv`, and
  `engine_threads()` returns the cores this process may use whose capacity is at least half the
  strongest's, capped at 4 (Pixel `:edge`: the three A720s). Phones the engine already handles never call
  it. Checked in the APK: no `hardware_concurrency` import left in `libneedle_jni.so`, still 16 KB aligned.
  To verify on the phone: logcat `NeedleJNI: engine threads N`, then the A0.2 runs again.
- **Re-test with the fix, 2026-10-02 22:17 (Pixel 9, on USB but cool: full clocks, thermal 0, 31.7 C at
  the start): A0.2 Android latency PASSED.** logcat `NeedleJNI: engine threads 3 (cpu_capacity, 8 cpus,
  7 allowed)`. Direct calls 171-208 ms (load 735 ms, configure 261 ms). Bake-off 20/20 `ok` (p50 402 ms,
  p95 696 ms) and 50/50 `ok` (p50 393 ms, p95 617 ms, max 881 ms). Back-off reading: availMB 2,099,
  thermal 0, all clear. The phone heated to 37-38 C and the clocks were capped again by the llama runs.
- **Re-time UNPLUGGED, 2026-10-03 00:41 (wireless adb, no charger, APK bundle `edge-router.js?v=edge5`):
  A0.2 Android latency PASSED.** Start: thermal 0, battery 37.1 C, 94%, caps cpu0 1.95/1.95, cpu4
  2.37/2.60, cpu7 2.91/3.11 GHz. logcat `NeedleJNI: engine threads 3 (cpu_capacity, 8 cpus, 7 allowed)`.
  `--limit 50`: 50/50 `ok`, **p50 370 ms, p95 747 ms, max 1,428 ms** (the max is row 1, cold load
  included; the rest max 767 ms). End: thermal 0, 37.7 C, caps cpu0 1.70, cpu4 1.80, cpu7 2.80 GHz
  (Pixel trims clocks below thermal status 1). Close to the plugged-but-cool run (p50 393, p95 617 ms): unplugging
  changes little; the thread count was the cause.
- **Re-run with peak memory, 2026-10-03 22:35 (APK of 6b347d25e, `edge8`, bundle `builtin`; on the charger
  at 100% but cool: thermal 0, battery 33.7-35.5 C, skin 35.1-36.2 C, caps at max 1.95/2.6/3.105 GHz; app in
  front, `top-app` cpuset): A0.2 Android PASSED, warm p95 inside the 800 ms budget by 3 ms.** logcat
  `NeedleJNI: engine threads 3 (cpu_capacity, 8 cpus, 7 allowed)`. `--limit 50`: 50/50 `ok`, **p50 547 ms,
  p95 797 ms, max 1,280 ms** (`score.mjs --pred` latency line; row 1 is the cold load, warm max 815 ms). Base
  model: all 50 confidences below 0.5, so every row passes to the safe path. **Peak PSS** (`dumpsys meminfo`
  every ~2 s, 47 samples): app 437 MB, `:edge` 112 MB, app + `:edge` 547 MB. Baseline (fresh launch, same
  bundle, no `:edge`, 48 samples): app 411-424 MB. **Needle adds ~123 MB: inside the plan's +150 MB budget.**
  Slower than the 00:41 unplugged run (p50 370, p95 747 ms); same thread count.
- **Report for Cactus, final text (the owner sends it; not sent):**

  > Subject: Needle 3 on Android picks 8 threads on one-prime-core SoCs (about 25x slower than needed)
  >
  > We run Needle 3 (android-arm64 `libneedle.a` from Hugging Face `Cactus-Compute/needle3`, revision
  > 27c0a9a5, the files of 2026-09-28) in an Android app on a Pixel 9 (Tensor G4: 1 Cortex-X4, 3 A720,
  > 4 A520). Every `needle_complete` call took 8.5 to 10 s; an iPhone 15 Pro takes about 0.15 s.
  >
  > Cause, from the disassembly: `Engine::Engine()` sizes its pool with `fast_core_mask()`, which counts the
  > cores whose `cpu_capacity` is at least 75% of the largest (70% when it falls back to
  > `cpuinfo_max_freq`). With one prime core that count is 1, so the fast path is skipped and the engine
  > uses `std::thread::hardware_concurrency()`, 8 here. The threads spin on the efficiency cores, and an
  > app's foreground cpuset excludes the prime core anyway, so they oversubscribe 7 allowed cores.
  >
  > Our workaround: we link with `-Wl,--wrap` on `hardware_concurrency` and return the cores this process
  > may use (`sched_getaffinity`) whose capacity is at least half the largest, capped at 4 (3 on the
  > Pixel). Same weights, unplugged, 50 router prompts: p50 370 ms, p95 747 ms (was 8.5 to 10 s per call).
  >
  > Requests: (1) count fast cores at a lower threshold (say 50% of the max) or take the top two capacity
  > tiers; (2) respect `sched_getaffinity`; (3) expose a thread count in `needle.h` so apps do not need a
  > linker wrap. Your 2026-10-02 build (3.1.0, f84005f8) does not change this: `fast_core_mask()` and
  > `Engine::Engine()` disassemble identically.
  >
  > Separately: a loaded engine that only gets `needle_complete` (no `needle_init` in between) never
  > returns from about its 49th-57th call (Pixel 9; also on macOS arm64, call 56, both 27c0a9a5 and
  > f84005f8). `needle_reset` does not help; `needle_init` before each call does.

## 3. Gate A0.3: FunctionGemma + grammar (llama.cpp)
**Latency options (2026-10-02):** [[Edge-Options-2026-10-02]]. On a host CPU the grammar sampler over the
262,144-token vocabulary is about two thirds of each call; a forced `{"option":` prefix plus a digit pick
removes it (about 300 ms to 60-90 ms, same answer). Measure the same split on the Pixel before choosing.
That note also has the mlx-swift `std::system` fix for iOS builds (item 5).
**Mechanism PASSED on a host CPU (2026-10-01, `test/native-host/run.sh llama`):** the real
`llama_jni.cpp` + `LlamaEngine` with ggml-org FunctionGemma 270M Q8_0 (rev 2566ce14, sha256 83940d4d):
grammar on, 1,512/1,512 replies valid `{"option":n}`; grammar off, 0/60 (prose refusals). Base model
routing: 7.7% wrong overall, 20.8% on model-routed rows, so fine-tuning is required. Still open: steps
1 to 3 on the phone (real latency and memory), the template check (step 4) and the GGUF pipeline (step 5).

The llama plugin now takes an opt-in `grammar` (GBNF, root `root`) on both platforms
(`local-plugins/capacitor-llama`, C++ syntax-checked against the pinned prism-b10685 headers,
Java engine compiled; iOS built and run on a phone 2026-10-02, below). With no grammar nothing changes.

**A0.3 iOS grammar PASSED (2026-10-02, iPhone 15 Pro, iOS 27.0, ggml-org FunctionGemma 270M Q8_0 rev 2566ce14,
sha256 83940d4d, Metal):** every reply that came back was a valid integer option (38/38).
Run 1 (first load after install): 18 `ok`, 2 `unavailable`: the first load took about 19 s, past the
runtime's 8 s cold budget, so rows 1-2 went to the safe path. Run 2: 20/20 `ok`, p50 146 ms, p95 409 ms
(cold load inside the first call). Read: the one-off first load (likely Metal shader compile) must be
warmed before a user's first request, or the cold budget raised for the first load only. App relaunched
after.

**A0.3 step 1 PASSED (2026-10-02, same iPhone, build of 8ebb70c60 web code):** MaiK's pack re-downloaded
through the app's own installer (`SMD_MAIK_MODELS.ensure("maik-lite")`, the first-run pick for this
8 GB phone: MAiK Lite, 1.11 GB, 1,130 s on home Wi-Fi, about 1 MB/s; the "Stalled on a slow connection"
note stayed up after the speed recovered). Then `SMD_MAIK_LOCAL.answer()` (what the picker calls for
On-device) with no grammar: `engine:"local"`, plugin `llama`. Cold call (load + retrieval): first text
43.8 s, done 47.0 s. Warm call: first text 1.6 s, done 6.3 s. Both answers cited the KB ([1]).
For clinical review (not a regression): the CAP answer gave azithromycin alone as first line and printed
"500 mg PO? [1] 1, then 250 mg"; the INR answer (mechanical mitral valve 2.5-3.5) was right.
1. Build the app with this branch; confirm a normal MaiK local answer still works (regression).
2. Base FunctionGemma GGUF on the phone; `node test/edge-bakeoff-device.mjs --engine llama --model <gguf path> --limit 20`.
   Every line must be `ok` with an integer `option`; the grammar admits nothing else.
3. **Relaunch the app afterwards**: the llama plugin holds one model and MaiK's pack was evicted.
4. Confirm FunctionGemma's chat template before training: `scripts/edge/export.mjs` writes
   `llama-json` as plain system/user/assistant turns with `{"option":n}`; if FunctionGemma expects
   its own function-calling format, change the exporter first (one function, the tests cover it).
   **DONE 2026-10-02 (Mac):** FunctionGemma's GGUF template (rev 2566ce14) has its own format: system
   becomes a `developer` turn, tools are `<start_function_declaration>declaration:...`, calls are
   `<start_function_call>call:name{...}<end_function_call>`. The phone uses none of it: the plugin sends
   system + user with no tools, the grammar forces `{"option":n}`, and llama.cpp's `llama_chat_apply_template`
   does not run the Jinja; it detects Gemma and uses its built-in formatter, which folds the system text
   into the user turn (`<start_of_turn>user\n{system}\n\n{user}<end_of_turn>\n<start_of_turn>model\n`,
   pinned prism-b10685 `src/llama-chat.cpp`). A GPU trainer running the Jinja would have put the system
   line in a `developer` turn: train != serve. Fixed in the exporter: `llama-json` rows are
   `[user: SYSTEM + "\n\n" + prompt, assistant: {"option":n}]`; rendered by the Jinja they equal the
   phone's prompt byte for byte (checked on an exported row). Trainer note: the Jinja emits `<bos>`
   itself, so do not let the trainer add a second one.
5. Pipeline proof: a tiny fine-tune (any 50 rows), convert with llama.cpp `convert_hf_to_gguf.py`,
   quantise with `llama-quantize` to Q8_0 and Q4_K_M, load both on the phone.

**A0.3 Android re-test, 2026-10-02 evening:** the plugin prefills on EVERY core (`threads_batch=8`, its
default `availableProcessors()`), efficiency cores included. Same calls, decode/prefill threads: 4/8 3.6-4.1 s,
4/4 1.2-1.4 s, 3/3 1.1-1.4 s, 2/2 1.1-1.2 s (clocks capped, 37 C). `llamaAdapter` now loads with
`nThreadsBatch: 4` (Edge only; MaiK keeps the plugin default: changing MaiK's prefill threads is an owner
call, and it likely explains MaiK's slow first text on this phone). Bake-off with 4/4: 2/20 then 0/50 `ok`,
calls ~1.1-1.4 s against the 1,200 ms deadline while capped. FunctionGemma on this phone's CPU is
borderline-over when warm; it needs a cool-phone run, the GPU/NPU, or a smaller prompt.
**A0.3 Android (2026-10-02, Pixel 9, same conditions as A0.2 Android):** grammar works (every reply that
returned was `{"option":n}`), latency fails: bake-off 20/20 and 50/50 `timeout` at 1,200 ms; direct
`generate` 2.5-4.8 s (load 1.3 s). llama.cpp log: 54 new prompt tokens in ~3.0-3.4 s (~18 tok/s),
decode 4.6-5.9 tok/s, CPU only (`n_gpu_layers=0`, Release build, dotprod on). Step 1 PASSED on content:
`SMD_MAIK_LOCAL.answer` ran on llama with MAiK Lite (already installed under
`/sdcard/Android/data/in.stewardmd.app/files/maik-models/`). **Safety note:** this phone has the
clinician switch "book linked" OFF (`smd_maik_rag_linked = "0"`), so answers were ungrounded and wrong
(mechanical mitral INR "2.0-3.0"; an invented artemether-lumefantrine dose). With the book linked for the
test (then set back to "0"): INR 2.5-3.5 [1] and ACT [1], first text ~32 s, total 39-59 s.

**A0.3 Android latency PASSED with forced prefix + digit pick (2026-10-03, Pixel 9, wireless adb, charger
unplugged: AC and USB powered false; ggml-org FunctionGemma 270M Q8_0 rev 2566ce14, sha256 83940d4d).**
- **Benches first** (`test/native-host/fg-*.cpp`, NDK r27c, arm64-v8a, android-26, the plugin's flags:
  Release, `armv8.2-a+dotprod+fp16`, CPU only, 4 threads; 117-token prompt; thermal status 0, caps at max
  1.95/2.6/3.105 GHz on cpu0/4/7). Two runs each:

  | step | grammar over full vocab | no grammar | greedy, then check |
  |---|---|---|---|
  | prefill, 117 tokens | 191-221 ms | 236-241 ms | 186-242 ms |
  | sampling, 8 steps | **368-381 ms (46-48 ms/step)** | 13 ms (1.7 ms/step) | 290-295 ms (36 ms/step) |
  | decode, 7-8 tokens | 126-154 ms | 212-217 ms | 125-131 ms |

  The grammar sampler is the largest single cost (about half of the ~0.75 s call; host was 2/3), and it
  also forces 8 steps where the trained reply needs 6. Greedy-then-check does not help the base model (the
  grammar rejected the greedy pick 6/6). Digit pick (prompt + `{"option":`, ONE prefill, argmax over the
  digit tokens): **244-279 ms total**, p 0.77. Note the grammar run answered option 3 on this prompt and
  the pick answered option 1 (eGFR CKD-EPI 2021, the right one): the grammar path tokenises
  `{"option":` differently from the training text, the pick does not.
- **Implemented:** `capacitor-llama` `generate({ pick: { prefix, choices, suffix } })` on Android
  (`llama_jni.cpp` `pick`, `LlamaNative.pick`, `LlamaEngine.pick`, `LlamaPlugin.generate`) and iOS
  (`LlamaEngine.swift` `Pick`, `LlamaPlugin.swift`). Template, then the prefix after the model turn opens,
  tokenised as one string like the training text, one prefill with KV prefix reuse, softmax over the
  single-token choices; resolves `{ text: prefix + choice + suffix, p }`, `perf.pickTokens` = last 3 prompt
  tokens + the chosen token. A choice that is not one token falls back to grammar generation.
  `llamaAdapter` sends `pick` (choices `"0"`..n) plus the old `grammar`: a plugin without `pick` ignores
  the key and runs the grammar, so it is the fallback with no version check. The router gets
  `{ option, confidence: p }`, so the 0.5 floor can now pass low-confidence picks to the rules layer.
- **Host check** (`test/native-host/run.sh llama`, now also runs on macOS arm64; 60 rows): pick 60/60
  end in `{"option":` = 14937 4485 1083 with one token per digit (`3` = 236800), the llama-json target;
  same option as the grammar run 58/60; p50 54 ms vs 269 ms with the grammar (Mac CPU).
- **Bake-off, before** (old APK, grammar path, nThreadsBatch 4; unplugged, thermal 0 at start, cpu4/7
  caps 2.367/3.015 GHz, battery 36.4 C; thermal LIGHT and cpu7 capped at 1.396 GHz after): 0/50 `ok`,
  50/50 `timeout`, p50 1,224 ms, p95 1,270 ms (the 1.2 s deadline).
- **Bake-off, after** (APK of this branch, `--engine llama --limit 50`; unplugged, thermal 0 before and
  after, caps at max before and 2.45/3.015 GHz after, battery 35.6-35.9 C): **50/50 `ok`, p50 120 ms,
  p95 171 ms, max 1,274 ms** (row 1, the cold load inside the first call; warm max 172 ms). Every row had
  a confidence (none below 0.5); scored 100% accurate, 0 wrong on the 50 predicted rows (base model, small
  sample: fine-tuning is still required per the host result). **Gate A0.3 Android latency: PASS, p95 171
  ms against 1,200 ms.**
- **Re-run with peak memory, 2026-10-03 22:36 (APK of 6b347d25e, same conditions as the A0.2 re-run above:
  charger, thermal 0, skin 37.0-37.3 C): latency PASSED, memory MISSED.** `--engine llama --limit 50`
  (`llama_jni newContext ... threads=4 threads_batch=4`): 50/50 `ok`, **p50 271 ms, p95 395 ms, max 1,222 ms**
  (row 1, cold load; warm max 445 ms); no confidence below 0.5; scored 100% accurate, 0 wrong on the 50 rows
  (coverage 65.5% -> 66.7% with them). Slower than the unplugged 120/171 ms of the morning, but well inside
  the 1,500 ms warm budget and the 5 s cold budget. **Peak PSS:** FunctionGemma runs in the app process; with
  it loaded and held (`llamaAdapter.load()`, 29 samples) the app is **996-1,000 MB** against the 411-424 MB
  baseline: **about +575 MB, over the plan's +400 MB budget (MISS)**. It drops back to ~405 MB after
  `release()`. The app was relaunched after (the llama plugin had evicted MaiK's pack).
- **Memory fix, 2026-10-04 (branch `fg-memory`, `edge15`): FunctionGemma load args cut, AFTER MEASUREMENT
  PENDING.** `llamaAdapter` now loads with `nCtx 512, nBatch 64, nUbatch 64, nThreadsBatch 4, kvQ8 true`
  (was `nCtx 1024`, plugin defaults `nBatch/nUbatch 512`). Why: the pick prompt is at most ~300 tokens + 4
  output; the compute buffer holds logits over the 262k vocabulary for every token of a ubatch (512 x 262k
  x f32 = 512 MB reserved; 64 -> 64 MB); Gemma 3 270M KV is small (18 layers x 1 KV head x 256, q8: ~10 KB
  a token). Both platforms chunk prefill to `n_batch`. MaiK's loads (`maik-local.js`) are unchanged.
  **Before** (Pixel 9, APK `edge11` adapter, `llama_jni newContext: n_ctx=1024 n_batch=512 n_ubatch=512
  threads_batch=4 kv_q8=1 flash_attn=1`, 05:13): app PSS **189 MB** idle (no MaiK pack resident) ->
  **612-614 MB** with FunctionGemma loaded, before any pick: **+425 MB at load**. The pick and both
  bake-offs could not run: StewardMD went to the background (another app in front) and its WebView JS
  froze, so every CDP call timed out; the app was not brought back for 30 min. **After: pending** (inject
  this `edge-router.js` over CDP, load + one pick, `dumpsys meminfo`, then `--engine llama --limit 50`
  before and after: must stay 50/50 valid, same picks, p95 not worse).
- **iPhone 15 Pro, 2026-10-03 (build above, over Wi-Fi, ggml-org FunctionGemma 270M Q8_0 rev 2566ce14,
  sha256 83940d4d, copied to `Documents/edge/`; Metal): A0.3 iOS latency PASSED with the pick.**
  - Run 1 (first load after install): 48 `ok`, 2 `unavailable`. Rows 1-2 hit the 8 s cold budget (the
    first load, likely Metal shader compile, as in round 1); row 3 finished the load in 2,620 ms. The other
    47 rows: p50 31 ms, p95 34 ms, max 198 ms.
  - Run 2 (`--limit 50`, app relaunched): **50/50 `ok`, every option an integer, p50 33 ms, p95 37 ms,
    max 350 ms** (row 1, cold load included; warm max 40 ms), against the 1,200 ms deadline. No confidence
    below 0.5. Scored: 100% accurate, 0 wrong on the predicted rows (base model, small sample).
  - Direct `generate({pick})`: `{"option":1}`, p 0.78-0.79, `perf.pickTokens` = **14937 4485 1083 236770**
    (the llama-json target `{"option":` plus one digit token, as on Android); 99 prompt tokens, 18-44 ms warm.
  - Still open on iOS: the one-off first load past the 8 s cold budget (warm-up or a larger first-load budget).
  - **Full iOS compile check, 2026-10-03 14:25 (commit 6b347d25e: edge8 + the LlamaEngine.swift short-pick
    fallback):** Xcode 27.2, `App` scheme, `generic/platform=iOS`, `CODE_SIGNING_ALLOWED=NO`,
    `-skipPackagePluginValidation -skipMacroValidation`, after `cap sync ios`: **BUILD SUCCEEDED**, 0 errors,
    no warnings in LlamaEngine/LlamaPlugin/NeedlePlugin; ~5 min; lowest free disk 1.77 GB (started at 7.8 GB);
    derived data deleted after. No Package.swift change. Not run on a phone.
  - Likely cause (code read, 2026-10-03; a guess, NOT timed on the device): the 8 s cold budget only stops
    waiting (`edge-runtime.js` line 48, the `coldMs` timer); the native load keeps going on the serial queue.
    `llama.xcframework` ships no `.metallib`, so Metal compiles its shaders from source on the first load
    after an install (about 16-19 s); iOS caches them per install, so later loads take ~350 ms. Row 3 joins
    the load already in flight. No user impact today: `llamaAdapter` is bake-off only and `autoEngine()`
    picks Needle. No code change: a prewarm would hide the cold-load cost from the bake-off numbers.
- **Seen on the way:** on the APK bundle the idle app held ~200% CPU (WebView compositor `VizWebView` +
  GPU thread, home screen in front) and heated the phone from 36 C to 42 C (thermal MODERATE) in ~20
  minutes; backgrounding the app cooled it. Bundle 167 was not checked for the same. Worth a look before
  any battery claim.

## 4. Gate A0.6: sustained load (4 GB phone, each model)
`--limit 50` back to back, then a 30-minute mixed session (MaiK, Scribe, Edge). Record peak memory,
temperature, battery drop and the latency line `score.mjs --pred` prints (p50, p95, max).
Pass: no crash, no thermal shutdown, p95 within the 1,200 ms deadline after the cold load.

**iPhone 15 Pro (8 GB, iOS 27.0), 2026-10-02: runbook marks PASSED (no crash, no thermal shutdown, p95 in deadline); plan section 7 thermal mark NOT met ("no SEVERE status in the sustained test": iOS .serious, Android SEVERE's analog, from minute 2, driven by back-to-back MaiK generation):**
- `--limit 50` back to back: Needle 3 x 50, all `ok`, p50 157 ms, p95 259 ms, max 386 ms (gate A0.2).
  FunctionGemma Q8_0 + grammar: 50/50 `ok` with an integer option, p50 147 ms, p95 221 ms, max 1,280 ms
  (the first call, cold load included; after a reinstall the first load took 1.3 s this time, 19 s once).
- 30-minute mixed session (`test/device/edge-mixed-session.mjs` over the WebKit proxy, MAiK Lite installed): 72 cycles of
  noCloud dictation (speech from the Mac speaker), one `SMD_MAIK_LOCAL.answer`, and 10 Needle routings
  under the 1,200 ms deadline. Same app process all 30 minutes (no crash). Dictation 72/72 on-device.
  MaiK 72/72 local answers, first text p50 1.6 s / p95 2.3 s, full answer p50 12.8 s / p95 21.5 s /
  max 25.5 s. Needle 719 `ok` + 1 `timeout` of 720: p50 162 ms, p95 356 ms, max 1,201 ms.
- Memory: app physical footprint 630-665 MiB in 79 samples over the session, flat (resident ~1.7 GiB
  including the mmapped weights). `xctrace` drops the device a second after it starts on this beta, so
  memory was sampled with a 6 s Activity Monitor trace every 2 minutes.
- Thermal: iOS thermal state went Fair -> **Serious** within 2 minutes and stayed there; never Critical.
  `ChargerData.TimeChargingThermallyLimited` 0 -> 1,640. The llama engine throttles itself at Serious
  (yield per token, budget cap 1,024) and stops at Critical (`LlamaEngine.swift`). Battery drop not
  measurable: on USB the phone held 80% (charge limit) throughout.
- **Gap found, then fixed (2026-10-02):** nothing defined `SMD_EDGE_ENV`, so the runtime's back-off never ran.
  `edge-router.js` now has the plan's A0.5 contract as its default env: skip Edge (rules answer) when
  memory is low (`lowMemory`, or under 250 MB available), thermal is SEVERE or above (iOS .serious maps
  to 3), MaiK is generating (`SMD_MAIK_LOCAL.queueState().running`) or Whisper is decoding
  (`SMD_NATIVE.whisperBusy()`). `Needle.available()` reports `lowMemory` / `availMB` / `thermal` on both
  platforms. Unit-tested (`test/edge-router.test.mjs`); both plugins compile; not yet run on a phone. With
  this, the mixed session above would have skipped Edge for most of its 28 Serious minutes.

**Pixel 9 (12 GB, Android 17), 2026-10-03 22:45-23:16, UNPLUGGED (AC and USB powered false, wireless adb):
stability PASSED, thermal PASSED, Needle latency under load MISSED, battery mark not judgeable.** Replaces the
2026-10-02 run (charging, before the Needle thread fix, Needle 110/110 `timeout`). What changed: the JNI thread
fix (3 threads on the A720s), `edge8`, the phone off the charger, and the harness now runs its Edge step
under the production back-off (e13344cf5) with app and `:edge` PSS, thermal status, skin and battery
temperature sampled every ~10 s (206 samples). APK of 6b347d25e, bundle `builtin`, base `needle3.cact`,
MaiK Lite (`smd_maik_rag_linked` "0" as the phone is set), `smd_edge` "1" for the test only.
- `test/device/edge-mixed-session.mjs 30 <dir> --android`: 15 cycles in 31.5 minutes (each: noCloud
  dictation from the Mac speaker, one `SMD_MAIK_LOCAL.answer`, 10 Needle routings at 1,200 ms).
- Start: thermal 0, skin 38.2 C, battery 36.9 C, 100%. It reached thermal 1 (LIGHT) at 22:46:44 and stayed
  there; **never SEVERE**. Peak skin 40.96 C, battery 40.0 C. End: 92%.
- **Battery: 100% -> 92% in 31.5 minutes (8 points), unplugged.** MaiK Lite was generating for most of the
  session (answers 71-141 s back to back). No baseline-app run under the same load, so the plan's "within
  3% (Needle) / 5% (FunctionGemma) of baseline" mark cannot be judged from this run.
- Same app process (pid 30461) all session; `onRenderProcessGone` 0. The `:edge` process was started 15
  times: the runtime kills it on every timed-out call, by design (A0.2). Read strictly, the plan's "process
  deaths: 0" mark counts these.
- **Peak PSS:** app 2,985 MB during the first MaiK Lite load (22:45:30-49), then a flat 1,976-1,989 MB with
  MaiK Lite loaded; `:edge` 76-119 MB when up. Lowest availMB seen by the back-off: 975 MB (floor 250 MB).
- **Edge (Needle):** 150 rows: **127 `ok`, 22 `timeout`, 1 `unavailable`** (one cold reload past the 8 s
  budget, 8,001 ms). Row times p50 1,090 ms, p95 3,438 ms: the slow `ok` rows (2.0-4.1 s) are cold reloads
  after a timeout kill. Timeouts came in runs right after MaiK answers (cycles 6 and 10: 5 of 10 each).
  **MISS** against the 800 ms warm p95 under mixed load (the standalone run above passes at 797 ms).
- **Back-off skips: 0.** The verdict was all clear on every cycle (thermal 1, availMB 975-1,364, MaiK not
  generating while the Edge step ran: the steps are sequential).
- MaiK: 15/15 local answers, first text p50 2.0 s (cold first 13.8 s), full answer p50 96.9 s, max 141 s.
- Dictation: 15/15 on-device, but only 8/15 returned text (7 empty finals; the 2026-10-02 run got 11/11).
  Not investigated: the phrases came from the Mac speaker, which is placement-sensitive.
- Not the 4 GB phone the gate names.

**Needle timeouts after MaiK, root-cause pass, 2026-10-04 00:14-01:50 (Pixel 9, unplugged, bundle `builtin`):**
- **Engine hang (new bug, found here):** a loaded Needle engine that only gets `needle_complete` calls
  never returns from its ~49th-57th call. Reproduced at rest with no MaiK at all: fresh `:edge`, rows 0..,
  hang at call 55, 55 and 49 (one run with `needle_reset` before each call). Two cores spin for 10+ minutes
  (caller and one pool worker in `R`, the other worker cycling into `futex_wait_queue`). `needle_init`
  (configure) before each call: 80/80, flat latency, 2-10 ms per init. iOS uses the same engine and has no
  kill, so a hang there would leave Edge `busy` until the app restarts (not run on the iPhone).
  The 30-min session above re-inits every cycle (10 calls), so this hang is NOT what caused its 22 timeouts.
- **What did cause them (measured with an on-device sampler: clocks, per-core load, `:edge` major
  faults, per-thread CPU):**
  - Clock caps. After MaiK the A720s (cores 4-6, the only cores Needle had in the `foreground` cpuset)
    ran capped at 1.33-1.80 of 2.60 GHz, the X4 at 1.16-1.40 of 3.1 GHz, at thermal status 0-1. Warm calls
    were 600-1,250 ms against 290-720 ms at rest. Calls 40 s after MaiK were as slow as calls right after
    it (one run: slower), so the slowness is heat, not a transient right after the answer.
  - Paging right after MaiK. The first call after an answer took 4,709 and 12,070 major faults (weights
    evicted by MaiK Lite's ~2 GB); later calls 0-700. That call took 956 and 1,245 ms.
  - Not llama threads: GGML_OPENMP is OFF and llama.cpp builds a throwaway threadpool for each graph, so
    its threads are joined when a decode ends; app CPU was back to its idle level within the sampling step.
    The idle level itself is ~1.2 cores (RenderThread + Viz drawing the home screen's 13 running CSS
    animations), and it shares the A720s with Needle.
  - Cascade: a timeout kills `:edge`, so the next call is a cold load (2.8-4.4 s, `ok`). It does not cause
    further timeouts on its own.
- **Fix (edge9):** `needleAdapter.complete()` runs `configure` before every call (the hang; shared JS,
  both platforms); `needle_jni.cpp` asks for the weights back with `madvise(MADV_WILLNEED)` before each
  call (mlock is not possible: RLIMIT_MEMLOCK is 64 KB); `NeedlePlugin` binds with `BIND_IMPORTANT`, so
  `:edge` gets the app's `top-app` cpuset (verified: `cpuset:/top-app`, logcat `engine threads 4 (cpu_capacity,
  8 cpus, 8 allowed)`; was `foreground`, 3 threads).
- **10-min unplugged mixed session on edge9 (00:56-01:07, battery 66 -> 62%, thermal 1):** Needle 47 `ok`,
  3 `timeout`, 0 `unavailable` of 50 (6%; was 22 + 1 of 150, 15%). Every warm call under 1,200 ms (488-1,143 ms
  outside the first call). All 3 timeouts were the first call after a MaiK answer of 108-140 s.
- **Still open:** on a hot phone (A720 1.3-1.8 GHz, X4 1.2-1.4 GHz) one test after a 113 s answer gave 6 warm
  calls of 1,112-1,393 ms. That is the heat ceiling of this phone, not fixed here. The back-off only skips
  at SEVERE, so it never fires at LIGHT. `BIND_IMPORTANT` (4 threads incl. the X4) was not A/B-tested on
  its own. NOT run: standalone `--limit 50` bake-off on edge9, MaiK byte-identity check (MaiK code is
  untouched; Q0 was byte-identical across two old-APK runs, hash 290753865), iPhone run of the hang fix,
  30-minute session.

**Back-off (763f0e268) on the Pixel 9, 2026-10-03, unplugged, APK bundle: PASSED.** Typed request
"show me the resistance patterns antibiogram" (model-routed: 5 candidates, first `tool:antibiogram`,
not exact), `smd_edge` = "1" in localStorage only for the test (removed after, read back `null`), the
Needle adapter wrapped to count engine calls.
| State | `SMD_EDGE.backoff()` | Engine called | route() |
|---|---|---|---|
| At rest (thermal 0, 37.7 C) | all ok, availMB 1,469-1,490 (2,100 before the first MaiK load) | yes | 983 / 457 ms, null (base model abstains) |
| MaiK Lite generating (`queueState().running`) | `othersBusy:true`, availMB 1,197-1,230, thermal 1 | **no** | 211 / 233 ms, null |
| After the answer | all ok, availMB 859-862, thermal 1 | yes (resumed) | 1,344 ms (timeout), then 4,287 ms (cold reload after the kill), null |
| Thermal SEVERE (simulated) | `thermalOk:false`, thermal 3 | **no** | 107 / 97 ms, null |
| After `cmd thermalservice reset` | all ok, thermal 1 | yes (resumed) | 1,835 / 1,119 ms, null |
A Layer 0 request ("antibiogram kholo") at simulated SEVERE still answered `rules:tool:antibiogram`.
- SEVERE was **simulated** with `adb shell cmd thermalservice override-status 3` (it locks the status
  that `PowerManager.getCurrentThermalStatus()` returns, which is what `Needle.available()` reads), then
  `cmd thermalservice reset`. A real SEVERE was not reachable safely: one MaiK answer took the phone from
  38.2 to 39.8 C and only to thermal 1 (cpu7 capped to 1.40 GHz).
- The MaiK answer used for the busy state (unplugged, phone already 38.2 C): first text 18.0 s, total
  96.4 s (297 stream events). Lowest availMB seen with MaiK Lite loaded: **859 MB** (floor 250 MB).
- Edge after MaiK on a warm phone missed the 1,200 ms deadline (clocks capped); the runtime killed and
  reloaded `:edge` as designed.
- **iPhone 15 Pro, 2026-10-03 (build above, base `needle3.cact` copied in, same typed request, engine calls
  counted, `smd_edge` "1" for the test only, then removed): back-off PASSED, busy states SIMULATED.**
| State | `SMD_EDGE.backoff()` / `Needle.available()` | Engine called | route() | Layer 0 "antibiogram kholo" |
|---|---|---|---|---|
| At rest | all ok, availMB 6,120, thermal 1 (iOS .fair) | yes | 407 / 182 ms; 375 ms, null (base model abstains) | `rules:antibiogram` |
| MaiK generating, **simulated** (`SMD_MAIK_LOCAL.queueState()` forced `running:true`) | `othersBusy:true`, availMB 6,065 | **no** | 41 ms, null | `rules:antibiogram` |
| After (real `queueState` back) | all ok | yes (resumed) | 214 ms, null | `rules:antibiogram` |
| Thermal Serious, **simulated** (`SMD_EDGE_ENV` with `thermalOk` false, engine re-set) | runtime env says not ok (`backoff()` still shows the default env: thermal 1) | **no** | 41 ms, null | `rules:antibiogram` |
| After (`SMD_EDGE_ENV` removed, engine re-set) | all ok | yes (resumed) | 320 ms, null | `rules:antibiogram` |
- **A0.5 renderer-gone clause (after these runs, `edge7`, Android only):** when the WebView render process
  dies, `MainActivity.onRenderProcessGone` marks it, `Needle.available()` reports `rendererGone:true`, and
  `edge-router.js` skips the model for the rest of the session through `memoryOk` (rules still answer).
  iOS has no app-side hook for the web-content process (Capacitor handles it), so iOS has no such clause.
- **Renderer-gone on the Pixel 9, 2026-10-03 13:34 (APK of 7e28af40a, `edge7`, on USB, base `needle3.cact`,
  `smd_edge` "1" for the test only): mechanism PASSED, first request MISSED, fixed in `edge8` (re-test PASSED below).**
  - `adb shell kill <renderer pid>` is refused (the renderer runs under an isolated uid: "Operation not
    permitted"). CDP `Page.crash` on the app's page killed it instead.
  - logcat: `W StewardMD: WebView render process gone (didCrash=true); recovering by recreating the activity`.
    Same app pid; a new renderer started; no crash.
  - After the recreate, `Needle.available()` gave `rendererGone:true` and `backoff()` gave `memoryOk:false`.
    The FIRST model-routed request ("show me the resistance patterns antibiogram") still called Needle: the
    router's device state starts at `rendererGone:false` and was refreshed only after the check. The second
    request skipped the engine (468 ms, null); "antibiogram kholo" still answered `rules:tool:antibiogram`.
  - `am force-stop` and a relaunch: `rendererGone:false`, the engine is called again.
  - Fix (6b347d25e, `edge8`): `route()` waits for one `Needle.available()` reading on the first model-routed
    request; later requests keep the one-request-stale refresh. Unit test fails without it.
  - **Re-test on `edge8`, 2026-10-03 22:34 (APK of 6b347d25e, phone unlocked, app `top-app`, on the
    charger): PASSED.** Before: two routes called Needle (1,182 ms cold, 484 ms). `Page.crash` -> logcat
    `render process gone (didCrash=true)`, same app pid 10243. After the recreate the router started with
    `rendererGone:false, availMB:null` and the **FIRST** model-routed request skipped the engine (164 ms,
    null; only `available()` called, no `load`/`complete`); the second skipped too (74 ms); "antibiogram
    kholo" answered `rules:tool:antibiogram`. `am force-stop` + relaunch: `rendererGone:false`, the engine
    is called again (1,256 ms cold).
  - Seen on the way: with the screen locked the app sits in the `background` cpuset (cores 0-3, the A520s);
    logcat `NeedleJNI: engine threads 4 (cpu_capacity, 8 cpus, 4 allowed)` and every Needle call timed out
    (routes 4.0-5.7 s). Any Edge timing needs the phone unlocked with the app in front.
- **Pixel round, 2026-10-03:** the phone stayed behind its lock screen (PIN set) from 13:34 to 19:50 and
  was not bypassed; the owner unlocked it at 22:33 and the round ran then (renderer-gone re-test above,
  A0.2/A0.3 re-runs with peak PSS, A0.6 Pixel below). The MaiK Lite `nThreadsBatch` re-measure with the book
  linked (optional) was NOT run: its condition was that everything else pass, and FunctionGemma memory and
  the mixed-session Needle latency missed. The iPhone MaiK Lite readings were taken the same
  evening (iPhone section below). Phone left clean
  (OTA 167 current, `smd_edge` unset, `smd_maik_rag_linked` "0", no test weights, stay-awake off, screen
  timeout back to 30 min, no forwards, no thermal override).
- Why simulated: MaiK Lite had to be re-downloaded after the reinstall, and the phone's own network gave
  0.01-0.05 MB/s (the Mac got ~0.9 MB/s from the same R2 file); a Mac side-load did not finish before the
  owner had to take the phone. Real Serious was not attempted (it needs sustained MaiK load).
- **Memory (availMB, `os_proc_available_memory`, as a peak-memory proxy):** fresh launch 6,120 MB; Needle
  loaded 6,073 (-47); after one Needle call 6,065; FunctionGemma loaded on top 5,958 (-107); after three picks
  5,953; after `release()` 5,953. Far above the 250 MB floor. Round 1's A0.6 footprint (630-665 MiB with
  MaiK Lite loaded) is the A0.6 session figure.
- **iPhone 15 Pro, 2026-10-03 evening: back-off during REAL MaiK Lite generation PASSED; availMB with MaiK Lite
  PASSED; real Serious still NOT reached.** MaiK Lite side-loaded from the Mac with `devicectl` (46 s, sha
  verified) and LEFT installed as a user pack. Raw log kept on the Mac (job scratch, not in git).
  - availMB (`os_proc_available_memory`, floor 250 MB): fresh 6,102-6,117; Llama loaded 5,795; MaiK Lite
    idle 5,539; **minimum during an answer 5,349**. PASS.
  - Back-off: 12 routes over 2 runs, made during prefill and while streaming: `othersBusy:true`, **engine
    not called (0 calls)**, null in 19-38 ms (168-390 ms at rest); "antibiogram kholo" still answered from the
    rules (13-20 ms); the engine resumed after the answer (4 calls per run: 2 at rest, 2 after). PASS (A0.5).
  - MaiK Lite: the malaria question, first text 3.1-3.5 s, total 3.9-4.5 s (fresh load included); the DKA
    question, first text 1.24 s, total 13.25 s.
  - Thermal stayed at 1 (.fair) throughout, so a real Serious was NOT reached; Serious is still covered only
    by the simulation above. **Still open.**
  - Watch item: the first MaiK answer right after the side-load failed once with `model-missing` after 174 s
    (the WebKit inspector disconnected; cause unknown). A direct load then worked, and every later answer did.
- Clean-up: both test weights overwritten with 0-byte files (`devicectl` cannot delete), the app's own
  background MaiK download cancelled and its partial file removed, `smd_edge` unset.
- **4 GB Android phone (step 3): none available on 2026-10-03.** A0.2 and A0.6 on a 4 GB phone not run.

**MaiK prefill threads on Android (Mac prompt 2, item 4), 2026-10-03, Pixel 9, unplugged: APPLIED.**
`LlamaPlugin.java` defaults `nThreadsBatch` to all 8 cores (the same cause as Edge's slow prefill).
MaiK Lite (llama.cpp, `smd_maik_rag_linked` "0" as set on this phone), five questions, each asked once
with the default and once with `nThreadsBatch: 4`, ABBA order, greedy (temperature 0), model warmed
before the timer, app in the foreground, phone cooled to thermal 0 (35.4-36.1 C) before every run;
logcat `newContext ... threads=4 ... threads_batch=8|4`.
| | first text median (range) | total median (range) | prefill, ~278 tokens | decode |
|---|---|---|---|---|
| default (8 threads) | **9.05 s** (8.75-9.09) | 45.5 s (39.2-56.3) | 8.7-9.1 s | 7.0-7.8 tok/s |
| `nThreadsBatch: 4` | **5.44 s** (5.32-5.48) | 39.7 s (35.6-49.8) | 5.3-5.4 s | 7.3-7.8 tok/s |
- Answers: all five byte-identical between the two settings (same length and text hash; 975-1,442 chars).
- First text 40% faster on every question; total 3.6-6.6 s shorter (decode unchanged, so the saving is the prefill).
- Applied as a pack knob: `maik-models.js` `maik-lite.nThreadsBatch: 4`; `maik-local.js` sends
  `nThreadsBatch` only when a pack sets it, so the plugin default and every other pack are unchanged; iOS
  and MLX ignore the key. Rebuilt APK checked on the phone: `newContext ... threads_batch=4`.
- Not measured: the other llama packs (Apex, MxCore); they keep the plugin default until measured.
- iPhone: not applicable (iOS uses `nThreads` for the batch already).

## 4b. On-device speech (A1.2, flag `smd_speech_ondevice`)
Build with this branch (the speech plugin changed on both platforms; Android compiles, Swift untested).
On each phone (the flag is ON by default; `localStorage.setItem("smd_speech_ondevice","0")` is the kill switch):
1. `await SMD_NATIVE.speechOnDevice("en-IN")` and `("en-US")`: record `onDevice` per language and phone
   (Android needs 12+ and an installed on-device model; iOS depends on the language).
2. OPD field dictation (a noCloud caller): with on-device available the strip label reads "On-device";
   in Airplane mode it must still transcribe. On a phone without it, the doctor sees "This phone can't
   recognise speech without sending the audio off the device..." and nothing is sent.
3. MaiK Scribe Fast mode (prefer): the label reads "On-device" or "Device speech (cloud)", matching
   `SMD_NATIVE.lastSpeechMode`.
Pass: no noCloud session ever runs a cloud recognizer; labels match reality on both phones.

**iOS PASSED (2026-10-02, iPhone 15 Pro, iOS 27.0, build of 1c8d2e29e, flag at its default ON):**
the speech plugin's new Swift compiled with 0 errors/warnings. Speech was played from the Mac speaker
("blood pressure one forty over ninety", synthetic, no patient data); `SMD_VOICE.listen` was driven
over the WebKit proxy with the same options as the OPD field mic.
1. `speechOnDevice`: en-IN `onDevice:true`, en-US `true`, te-IN `true`, hi-IN `false` ("no on-device model").
2. noCloud (OPD): label went "Device speech" -> "On-device" within 98-133 ms, `lastSpeechMode`
   `{onDevice:true, how:"requiresOnDeviceRecognition"}`, final "Blood pressure 140/90". **Airplane mode
   (navigator.onLine false, fetch to stewardmd.in failed): same, transcribed on-device.** hi-IN with
   `require`: refused in 5 ms with `on-device-unavailable`, no mode event, no partials, so no recognizer
   ran (voice.js maps it to `stt-unavailable-ondevice`, the "This phone can't recognise speech..." text).
3. Scribe Fast (`prefer`, en-IN): label "On-device", matches `lastSpeechMode`. hi-IN `prefer` reports
   `onDevice:false` ("Apple speech service (may use Apple servers)"), which voice.js labels
   "Device speech (cloud)".
Findings, and what became of them (2026-10-02, same phone):
- FIXED: the OPD field strip now names the engine voice.js reports ("Listening 0:03 - BP systolic,
  On-device. Tap the mic again to stop."; `opd-emr.js` reads `onState(state, engine)`; headless check in
  `test/run-opd-flow-ui.mjs`).
- FIXED: with the flag ON, `voice.js` passes the doctor's language to the native recognizer
  (`nativeLang`: "hi" -> hi-IN, "te" -> te-IN, "en" -> the device's English, "auto"/unset -> device
  language); the kill switch keeps the old start() call byte for byte. On the phone, Hindi picked gave
  Devanagari ("ब्लड प्रेशर 149"), before it was always en-IN. Test: `test/speech-ondevice.test.mjs`.
- WITHDRAWN: the cache tokens were bumped in A1.2 (`-ondev2`); my check had cut the token at the first
  "-". This fix bumps them again (voice.js `-ondev3`, opd-emr.js `-ondev2`).
- WITHDRAWN: "Ongoing speech recognition" came from my harness (a leftover timer ended a run early while
  its session was still listening, so the next start met a live session and was rightly refused).
  Sequenced back to back, start/stop are clean every time.
- Note: after the earlier online `prefer` session, iOS downloaded its on-device Hindi model: `hi-IN` now
  reports `onDevice:true` on this phone, and noCloud Hindi dictation runs on the phone.
Not done: Android (no phone attached).

**Android PASSED (2026-10-02, Pixel 9, Android 17, flag default ON):** `speechOnDevice` en-IN, en-US,
hi-IN, te-IN all `onDevice:true` (`createOnDeviceSpeechRecognizer`). noCloud (OPD options): en on-device
("blood pressure 90"), hi on-device (Devanagari "ब्लड प्रेशर 140 ओवर 90", so the language fix works here
too), te refused in 162 ms with `stt-unavailable-ondevice` (no Telugu on-device model installed), no
cloud. **Airplane mode** (`adb shell cmd connectivity airplane-mode enable`, navigator.onLine false):
noCloud en transcribed on-device ("blood pressure 140 over 90"). Scribe Fast (`prefer`): en "On-device";
te switched to "Device speech (cloud)" at 99 ms with reason "language not available on-device".
Findings: Android `speechOnDevice()` says `onDevice:true` for a language whose model is not installed
(it checks the API, not the language pack); the label shows "On-device" for 20-60 ms before the
plugin's real mode arrives. Neither sends audio anywhere; both make the first label briefly wrong.

**Both findings FIXED and verified on the Pixel 9 (2026-10-03, Android 17, wireless adb, unplugged):**
- Fix 1 (`SpeechRecognition.java`): on API 33+ `available({language})` asks the on-device recognizer
  (`checkRecognitionSupport`) about that language and adds `onDeviceLanguage` ("installed" /
  "downloading" / "downloadable" / "no", "unknown" if the check fails or takes over 3 s); `onDevice` is true
  only when installed. `SMD_NATIVE.speechOnDevice()` passes the field through.
- Fix 2: an on-device session now sends its `recognitionMode` from `onReadyForSpeech`, not at `start()`, so
  a language the on-device model lacks fails (and, for `prefer`, falls back and says "cloud") before any
  "On-device" claim. The dictation sheet's first paint is the neutral "Device speech" too (it said
  "On-device" until `listen()` returned). `test/speech-ondevice.test.mjs` pins `prefer` (15 tests).
- `speechOnDevice`: en-IN `installed`, en-US `installed`, hi-IN `installed`, **te-IN `no`** ("te-IN not
  supported on-device"; it used to say `onDevice:true`). 54-148 ms per call.
- Dictation (`SMD_VOICE.listen`, the OPD/Scribe options, speech from the Mac speaker), label sampled at
  5/30/60/120/250/500 ms:
| Language | noCloud (`require`) | Scribe Fast (`prefer`) |
|---|---|---|
| en | "Device speech" -> "On-device" at 222-252 ms; "blood pressure 140 over 90" | "Device speech" -> "On-device" at 2.7 s (a second session started 3 s after the last); on-device |
| hi | -> "On-device" at 548 ms; "ब्लड प्रेशर 140/90" | -> "On-device" at 537 ms; same text |
| te | stays "Device speech", then `stt-unavailable-ondevice` at 3.2 s; no mode event, nothing sent | "Device speech" -> "Device speech (cloud)" at 408 ms, reason "language not available on-device"; never "On-device" |
- **Airplane mode, fully offline:** `cmd connectivity airplane-mode enable` and then `svc wifi disable` for
  45 s from a detached on-phone script, the dictation scheduled inside the app and its result read back after
  Wi-Fi returned (wireless adb cannot stay up offline; the `adb-tls-connect` mDNS serial reconnects by
  itself, `192.168.1.24:5555` did not). `navigator.onLine` false, fetch to stewardmd.in failed;
  noCloud en: "Device speech" -> "On-device" at 545 ms, transcribed on-device ("blood pressure 140
  overnight"; the same mishearing happened online). Airplane with Wi-Fi back on is NOT offline
  (`navigator.onLine` true, fetch 200), so it proves nothing on its own.
- Recognition quality from the Mac speaker varies: with the en_US voice "over ninety" came out as
  "overnight" in 3 of the 4 runs that produced text; the en_IN voice gave no text or a wrong transcription.
  The labels were right in every run.
- iPhone: pending (the Swift side is unchanged by these fixes; the iPhone result above stands).

## 5. Training
**Needle on the Cactus platform** (synthetic data only; commands from `cactus-needle` 3.0.6 `llms.txt`):
```sh
pip install cactus-needle
export NEEDLE_API_KEY=...            # dashboard; never commit or paste it anywhere
cd vault/plans/edge-data/dataset/export/cactus
needle platform finetune train.jsonl validation.jsonl test.jsonl --suffix smd-router --out ./models
```
4,214 train rows (limit 100 to 10,000). Platform training keeps the confidence head calibrated;
a local LoRA (`needle finetune`) does not, so its builds run with `--uncalibrated`.
Download every depth; the bake-off picks the smallest one that passes.

**FunctionGemma on a rented GPU:** supervised fine-tune on `export/llama-json/train.jsonl`
(validation for early stopping), after step 3.4 settled the template. Then GGUF + Q8_0/Q4_K_M as in
step 3.5. Record the base model id, the trainer and its version, and the hyperparameters in this file.

### 5a. Needle local LoRA, 2026-10-04: FAIL on the frozen test set (not shipped)
No Cactus platform key exists, so this used the other official route: `needle finetune` (LoRA) +
build, from `cactus-needle` 3.0.6. Script: `scripts/edge/train-needle.sh` (setup, up, train, build,
predict, down). Base: `checkpoints/needle3.safetensors` and `needle3.cact` at the pinned revision
`27c0a9a5` (both files are byte-identical on `main`).

**Compute and cost.** An M1 Mac (8 GB, CPU only; JAX has no M1 GPU path here) took over 55 s per step,
which is 9+ hours for one 579-step run, so training ran on GCP: one on-demand `g2-standard-4` + L4,
us-central1, list price about 0.72 USD/h (2026-10-04 billing catalog). The VM is created with
`--max-run-duration 4h --instance-termination-action DELETE`. It ran 22:56 to 01:57 UTC (3.0 h),
**about 2.17 USD**. It was deleted after the runs, and no instances or disks were left. Only
`export/needle-local/train.jsonl` (generated, no PHI) was uploaded. The adapters came back to the Mac;
builds and scoring ran on the Mac. The needle CLI ran with `NEEDLE_TELEMETRY=0`.

**Scoring.** `scripts/edge/needle-host.cpp` links the pinned macOS engine (`macos-arm64/libneedle.a`,
same revision) and repeats the app's call sequence: mmap + `needle_load` once, then `needle_init`
before every call (edge9) and `needle_complete` with 48 tokens. Replies are parsed by the router's own
`optionFrom()` (`needle-pred.mjs`) and scored with `score.mjs --pred`. `needle-calibrate.mjs` sweeps
the threshold on val. This is a Mac CPU, not the Pixel; the Android binary was not run.

**Findings**
- **The engine opens a `<think>` block before every call.** Trained on targets with no reasoning, the
  tuned model kept writing base-style reasoning and answered "option 1" for nearly everything (val
  77/135 exact; train rows only 54% in the engine). Adding the line `option K` (`none fits` for an
  empty call list) in front of each target (`needle-pred.mjs think`) fixed it: val 130/135.
- **A local LoRA has no usable confidence.** `needle build` drops the head. The engine then reports
  `confidence: 1.0000`, not None, so the app's 0.5 floor never filters anything. Keeping the
  untrained base head in the build (`build --keep-head`) gives a number, but on the tuned weights it
  does not separate right from wrong: every val error scored 0.97 to 0.995.
- Cactus's own held-out check (`--val-split`) recompiles JAX for every prompt length (about 40 min on
  the L4 for 161 rows). Use `--val-split 0` and score with the engine instead.
- The W4 build is 63 MB (base 35 MB, 2-bit). Host latency is unchanged (M1 p50 43-65 ms).

**Runs** (3,237 train rows; batch 16; seq 512)
| Run | Settings | Val exact (model rows) | Val result |
|---|---|---|---|
| r1 | 3 ep, lr 1e-4, rank 16 (package defaults), no reasoning | 77/135 | passes only at t 0.89+, coverage = rules |
| r2 | 6 ep, lr 3e-4, rank 32, no reasoning | 82/135 | fail at every t up to 0.95 |
| r3 | as r2 + `option K` reasoning | 130/135 | 0.7% wrong; passes only at t 0.99 |
| r4 | 8 ep, lr 5e-4, rank 32 + reasoning | 132/135 | PASS: coverage 90.5% (rules 74.9%), 0.4% wrong |

**Threshold (val only).** The rule was fixed before test was opened: take the lowest t where val wrong
is at most half the mark (0.25%), because val has only 135 model rows. For r4 that is **t = 0.98**
(val: coverage 86.8%, wrong 0.2%). The official build (head dropped) has no threshold.

**Frozen test set (4,077 rows), scored once**
| Build | Coverage | Accepted acc. | Wrong shown | Danger | en / hi-Latn / te-Latn wrong | Verdict |
|---|---|---|---|---|---|---|
| rules | 65.5% | 100% | 0.0% | 100% | 0 / 0 / 0 | PASS |
| r4, head dropped (official) | 88.2% | 98.3% | **1.5%** (60 rows) | 99.6% | 1.1% / 1.4% / 8.1% | **FAIL** |
| r4 + base head, t 0.98 (val-chosen) | 85.7% | 98.5% | **1.3%** | 99.6% | 0.9% / 1.4% / 8.1% | **FAIL** |
Coverage by language (r4 official): en 88.7%, hi-Latn 81.3%, te-Latn 86.1%. Recall@5 is 99.4%. Model
rows alone: coverage 81.3%, accuracy 93.5%. Most errors are near neighbours and held-out targets
(TIMI NSTEMI vs STEMI, P/F vs S/F, FENa vs Na deficit, APRI vs PLR, QTcF vs QTc, MRC vs mMRC). One
danger row was opened wrongly. Diagnostic only (chosen by looking at test, so not a valid pick): test
passes only at t 0.995, with 66.8% coverage, +1.3 points over rules.

**Verdict.** The marks (wrong shown under 0.5%, accepted accuracy at least 99%, danger 100%) are not
met, so the build is not shipped and nothing went to the Pixel. Val (135 model rows) was much easier
than test. A larger, harder calibration split, or a calibrated confidence head, is needed before
another attempt. Only the Cactus platform trains that head: platform key and owner decision.
Weights are kept off the repo; see the PR for paths and sha256.

### 5b. Needle local LoRA, round 2, 2026-10-04

**Selection rule (fixed before any round-2 model was scored on test).** Val (135 model rows) was too
easy in round 1, so round 2 picks on a larger **dev** split built by `scripts/edge/needle-r2.mjs build`
from the TRAIN side only: val, plus train rows whose target (12%) or condition (12%) is held out, plus
every row of one held-out template per group, plus augmented rows for those held-out keys. Dev keeps
the real labels. Each run is scored on dev in two configurations: single call, and two calls with the
options rotated by one where the router acts only if both pick the same option (`engine.agree`). The
dev mark is **wrong opens at most 0.9% of dev model-routed rows**: the test mark (0.5% of ALL rows)
equals 1.79% of model rows at test's 28% model share, halved for safety as in round 1. Among the
run x configuration pairs that meet it, the one with the highest dev coverage is the final candidate,
and only it is scored on test, once. If none meets it, the round FAILS; the best dev pair is still
scored on test once, for the record.

**What changed (train side only; `needle-r2.mjs build`).** No test row or test text is trained on: any
generated text equal to a test text is dropped (224), and test-only targets are never augmented.
1. Abstain targets. A train request whose words fit the target's title AND a title that is not
   accepted (TIMI UA/NSTEMI vs TIMI STEMI for "timi", drug Insulin vs tool Insulin) is relabelled 0.
   So is a calculator request that only describes the target instead of naming it ("pancreatitis
   severity", "delirium"): named = words fit the title, or initials match ("ast platelet ratio" ->
   APRI, "ci" -> Cardiac Index). 2,526 of 9,337 train model rows end as 0.
2. Augmentation: every calculator keyword (round 1 used only the first), title stems and
   parentheses, Hinglish/Tenglish calculator and brand templates, 17 question templates (en/hi/te)
   over 84 conditions, and hard negatives: questions about conditions that calculators are named after
   ("how to manage hepatic encephalopathy" vs West Haven) give 0. 24,195 rows with 2 shuffled copies.
3. Calibration: the engine has no logprobs (`needle.h` exposes only init/complete/embed/reset/load,
   and replies carry no token scores), so the only engine-side check is self-consistency: a second
   call with the options rotated by one must pick the same option. It is in `route()` behind
   `engine.agree` (`needleAdapter(p, { agree: true })`); `autoEngine()` does not turn it on.
4. Hyperparameters unchanged from r4 except epochs (3, as the set is 7x larger).

**Runs** (L4, 3 epochs, lr 5e-4, LoRA r32/a64; dev model rows 2,151)
| Run | Data | Dev wrong (model rows), 1 call / agree | Dev coverage (all rows), 1 call / agree |
|---|---|---|---|
| r5 | augmentation + ambiguity relabel | 9.1% / 5.1% | 85.7% / 74.2% |
| r6 | + description relabel | 2.4% / 1.2% | 63.6% / 60.4% |
| r7 | + condition hard negatives | **0.7%** / 0.3% | **60.6%** / 57.7% |
Dev is harder than test (descriptive keywords, held-out conditions): r5's errors were mostly
keyword rows several calculators answer. Only r7 met the dev mark; by the rule, **r7 with ONE call**
(higher dev coverage) is the candidate. Host latency on the M1 is not a device number.

**Frozen test set (4,077 rows), r7 single call, scored once**
| Build | Coverage | Accepted acc. | Wrong shown | Danger | en / hi-Latn / te-Latn wrong | Verdict |
|---|---|---|---|---|---|---|
| rules | 65.5% | 100% | 0.0% | 100% | 0 / 0 / 0 | PASS |
| r4 (round 1) | 88.2% | 98.3% | 1.5% (60) | 99.6% | 1.1% / 1.4% / 8.1% | FAIL |
| **r7** | **83.8%** | **99.7%** | **0.3%** (11) | **99.6%** (252/253) | 0.3% / 0.0% / 0.5% | **FAIL (danger)** |
Coverage by language: en 84.5%, hi-Latn 79.0%, te-Latn 77.5% (rules 67.0 / 71.8 / 32.1). Held-out
targets: 93.5% coverage, 1 wrong of 630. Model rows: coverage 65.6%, 1.0% wrong. The 11 wrong opens:
"go to timi" (STEMI), "go to fractional excretion urea" (FE bicarb), "ast platelet ratio score" (PLR),
"can you pull up glasgow outcome scale" (tool Insulin), "go to ninds reflex" (burn TBSA), "go to
international prognostic index" (IPSS), "warf details" (tool Ward), "entresto details" and "entresto
chupinchu" (valsartan alone), "red flags in typhoid" (typhoid vaccine), and the danger row "wells
score" (opened Wells DVT; the label is "ambiguous, pass").

**Verdict.** Wrong shown (0.3% < 0.5%), accepted accuracy (99.7% >= 99%) and coverage (83.8% > 65.5%)
pass; **danger is 99.6%, not 100%**, so the build FAILS the marks and is not shipped. Nothing went to
the Pixel. Cost: three VMs, about 4.04 USD list price (round 1 + 2: about 6.21 of the 20 USD cap).
The test set has now been seen by r7; a different operating point chosen on it would not be valid.
Next lever: the rotated-agreement check (dev 0.3% wrong) on r7, judged on a NEW frozen test set
(new `schema_version`), or on the owner's 150-request human set, with the same marks.

### 5c. New frozen test set `edge-router-3`, r7 scored once, 2026-10-04

**Why a new set.** r7 was scored on `edge-router-2`, so that set can no longer judge r7 or pick its
setting. `scripts/edge/generate-test3.mjs` writes `dataset/test3.jsonl` + `manifest3.json` (committed,
like `test.jsonl`; sha256 `eae452d5...b7fe`). This section was written and committed BEFORE any model
was run on the new set.

**How it is unseen (each point is checked in the script, which throws otherwise).**
- New templates only: none of the calculator, tool, drug, ICD, question and negation templates is a
  `generate.mjs` or `needle-r2.mjs` template (e.g. "could you open the {t}", "{a} calculator chalao",
  "naaku {a} kavali", "{t} pe le chalo", "{b} leaflet", "{g} card teruvu", "{d} ka icd code").
- No row text equals a train, val, dev, old-test or r7-training text. r7's training file is read from
  `needle-r2.mjs build` output and pinned by sha256 (`3520ce49...`, byte-identical to the file r7 was
  trained on). 9 generated texts were dropped as seen, then the script asserts none is left.
- Held-out targets: 664 rows (tag `heldout-target`) name a target that never appears as the answered
  option of any r7 training row (424 targets did) and is not a dev target. They get every English
  template and one Hinglish and one Tenglish.
- **KB disease pages are on.** The app offers a `reference` option from `MaiKKB.resolveTarget` +
  `SMD_REASON.hasDiseaseRef`; the old generator ran without the KB, so no train/dev/old-test row ever
  had one. The script loads the KB stores; Node's `hasDiseaseRef` checks `KB_ENRICHMENT` only (the app
  also checks SYNDROMES and DDX_NI), so Node offers a KB option only where the app does. 192 page
  requests (target `kb:<id>`, where the bare name resolves to that page) and 102 questions about the
  same diseases (label none: a question goes to MaiK, as in `generate.mjs`).
- Danger (199): 161 negations (138 English forms the guard knows, 23 Hinglish/Tenglish forms it does
  not: "{t} mat kholo", "{t} nahi chahiye", "{t} teravaddu", "{t} vaddu", which reach the model), 28
  ambiguous names in new forms ("wells pls", "need the timi", "insulin wala kholo", "mrc kavalandi";
  label pass), 9 clinical orders ("start heparin", "heparin chalu karo"; label pass), and "qtc" (any
  QTc calculator is accepted). 61 danger rows are model-routed (edge-router-2: 7).

**Shape.** 2,562 rows: en 2,137 (83%), hi-Latn 224 (9%), te-Latn 201 (8%) (edge-router-2: 90/5/5).
Kinds: calculator 1,256, drug 444, none 319, tool 200, kb 192, icd 150. Routes: model 1,503 (59%;
edge-router-2: 28%), rules 902, negated 141, empty 16. Recall@5 97.5%. Because the model share is
higher, the plan's mark (wrong shown under 0.5% of ALL rows, i.e. at most 12 rows) is 0.85% of model
rows here, close to the 0.9% dev mark; the marks are not changed.

**Pre-registered choice (dev only, rule of 5b).** r7 on dev (2,151 model rows, 3,339 rows):
single call wrong 0.65% of model rows, coverage 60.6%; agree wrong 0.28%, coverage 57.7%. Both meet
the 0.9% dev mark, so the highest dev coverage wins: **r7 single call** is the setting scored, once,
with `needle-host` (pinned macOS engine, the app's call sequence) and `score.mjs --split test3 --pred`.
r7 + agree is run on the same set as a diagnostic only and is never used to pick.
Marks: wrong shown under 0.5%, accepted accuracy at least 99%, danger 100%, coverage above rules.

**Result (scored once, after the commit above; M1 host, pinned engine)**
| Build | Coverage | Accepted acc. | Wrong shown | Danger | en / hi-Latn / te-Latn wrong | Verdict |
|---|---|---|---|---|---|---|
| rules | 35.2% | 99.5% | 0.2% (5) | 100% (199/199) | 0.1% / 0.4% / 0.5% | PASS |
| **r7, single call (pre-registered)** | **72.4%** | **96.2%** | **2.8%** (71) | **85.9%** (171/199) | 2.0% / 6.3% / 7.5% | **FAIL** |
| r7 + agree (diagnostic only, not a pick) | 69.2% | 97.1% | 2.0% (52) | 89.5% (178/199) | 1.3% / 5.4% / 6.0% | FAIL |
Coverage by language, r7 single: en 75.3%, hi-Latn 57.1%, te-Latn 59.2% (rules 40.0 / 13.8 / 8.0).
Model rows (1,503): coverage 63.4%, 4.4% wrong (agree 58.0%, 3.1%). Held-out targets: 72.4% coverage,
1.2% wrong. KB page requests: 56.3% coverage, 98.2% accepted. Host latency p50 58 / p95 167 ms
(agree, both calls: 146 / 291 ms).

The 71 wrong opens (single): 16 model picks for a named target (near neighbours: GOS vs GOSE, ISS vs
R-ISS, "disseminated intravascular coagulation" -> the DIC KB page instead of ISTH DIC, Entresto ->
valsartan, "about heparin" -> HIT 4Ts); 22 questions about a disease that opened its KB page ("how is
acute coronary syndrome diagnosed"); 28 danger rows: 14 Hinglish/Tenglish negations ("adrenaline mat
kholo", "oncotree teravaddu"), 9 ambiguous names ("wells pls", "need the mrc" opened one of two), 5
clinical orders ("continue metformin", "increase lasix to 40" opened the drug card); and 5 RULES
errors: "navigate to search icd", "search icd section" and three more open an ICD lookup for the words
"navigate to" / "section" instead of the Search ICD tool (Layer 0: the ICD cue fires on the tool's own
title). Without the KB questions, orders and unguarded negations (the parts r7 never saw any form of),
r7 single still has 30 wrong (1.2%) and 9 ambiguous danger misses, so the verdict does not hinge on
them.

**Verdict: FAIL, not shipped, nothing went to the Pixel.** Danger is 85.9% and wrong shown 2.8% (mark
under 0.5%); agree does not pass either. r7 does not generalise to new phrasings, Hinglish/Tenglish
negations, or the KB option it never saw. Separate from the model, two rules fixes are indicated by
this set: the negation guard knows no Hinglish/Tenglish forms (mat, nahi chahiye, vaddu, teravaddu),
and the ICD cue should not fire on the "Search ICD" tool title. Both change rows outside the model and
need their own review; the marks were not changed. Raw host output and scores:
`$WORK/r7.test3{,rot}.raw.jsonl`, `r7.test3{,sc}.score.json` (not in the repo).

### 5d. Re-audit of upstream Needle 3.1.0 (f84005f8), 2026-10-04: pin NOT moved
Cactus's `main` is `c7c415a3` (README only) over `f84005f8` ("Replace binaries from production build",
2026-10-02). The binaries are engine 3.1.0 (`config.json` engine_version 3.0.2 -> 3.1.0): the Whistle
speech model (GitHub cactus-compute/needle `bb665fc1` "Whistle (#163)", 2026-10-01) linked into the same
library. Compared with our pin `27c0a9a5` on the Mac (M1, CPU), no phone:
| Check | 27c0a9a5 (pin) | f84005f8 (3.1.0) | Verdict |
|---|---|---|---|
| Weights `needle3.cact`, `LICENSE`, tokenizer | weights sha256 c9d915ec..., LICENSE git blob d6456956... | identical | equal |
| Header | 1,187 B, `needle_complete(input, max, out, cap)` | 3,322 B; **`needle_complete` and `needle_embed` gain `pcm, samples`**; new `needle_models`, `needle_set_audio`, `needle_transcribe` | **API break**: JNI, `NeedlePlugin.swift` and `needle-host.cpp` must change to move |
| Size | android-arm64 1.66 MB, ios-arm64 1.14 MB, macos 1.16 MB | 2.13 / 1.47 / 1.50 MB (+28%, speech code we do not use) | **worse** |
| Imports (`nm -u`) | android 124 | 131: only `cos sin sincos log10`, `__memset_chk __strlen_chk`, one libc++ sort | equal: no socket/connect/getaddrinfo/curl/SSL/dlopen, no URL or host string |
| Thread fallback | `fast_core_mask` + `hardware_concurrency()` in `needle::Engine()` | disassembly of `fast_core_mask`, `Engine::Engine()` and `ThreadPool(int)` identical (only string-table offsets moved); `whistle::Engine()` is a second caller | unchanged: our `--wrap` is still needed and still links |
| Hang (init once, then only complete; `NEEDLE_INIT_ONCE=1 needle-host`, 150 test3 rows) | **hangs at call 56** (no return in 60 s; calls take ~65 ms) | **hangs at call 56** | not fixed upstream; first host repro (was Pixel only). With init before every call: 2,644/2,644 on both |
| Base model, frozen `test` (1,141 model rows) | PASS, coverage 65.5%, wrong 0.0%, danger 100% | same | equal: all 1,141 decisions byte-identical |
| Base model, `test3` (1,503 model rows) | PASS, coverage 35.3%, wrong 0.2%, danger 100% | same | equal: all 1,503 decisions byte-identical |
| Host latency p50 / p95 (init + complete) | test 63 / 95 ms, test3 65 / 82 ms | test 62 / 81, test3 65 / 80 ms | equal or better (one run each, M1) |
| Peak RAM (engine's own field) | 99 MB | 98 MB | equal |
| Android link (NDK 27.2 clang, API 26, the plugin's flags) | links; LOAD align 0x4000; wrap in place; no network imports | as-is **fails to compile** (needle_complete takes 6 args); with `nullptr, 0` added it links, align 0x4000, wrap in place, no network imports | needs a code change |

`test/native-host/run.sh android` itself was not run: it is Linux-only (linux-x86_64 NDK path, gradle +
the llama submodule) and the Mac had about 2.5 GB free. The NDK link above replaces its Needle half.

**Decision: keep `27c0a9a5`.** The new build is the same text engine with speech added: identical
decisions, the same thread fallback and the same hang, so it fixes nothing we need, while it is 28% larger
and breaks the `needle_complete` ABI (three call sites). It is not at least as good on every check.
Move only if we want Whistle (on-device speech to tool calls) or a later build fixes the hang or the
thread count; then change the three call sites to `needle_complete(text, nullptr, 0, max, out, cap)`
(`needle-host.cpp` already builds against both headers) and re-run this table.
Repro: `clang++ -std=c++17 -O2 -I<dir with needle.h> scripts/edge/needle-host.cpp <macos-arm64/libneedle.a>
-framework Accelerate -o needle-host`; rows from `node scripts/edge/needle-r2.mjs rows test|test3`;
`node scripts/edge/needle-pred.mjs pred raw.jsonl > pred.jsonl`; `node scripts/edge/score.mjs --split
test|test3 --pred pred.jsonl`. Binaries were deleted after the run.

## 6. Bake-off (day 5)
For each candidate (Needle depth N, FunctionGemma Q8_0, FunctionGemma Q4_K_M), on the 4 GB phone:
```sh
node test/edge-bakeoff-device.mjs --engine needle --weights <device path to tuned.cact>
node test/edge-bakeoff-device.mjs --engine llama --model <device path to .gguf>    # relaunch app after
node scripts/edge/score.mjs --pred edge-bakeoff-needle-android.jsonl --json needle.json
```
Human set: put the 150 typed requests in `vault/plans/edge-data/owner-requests.txt` (one per line,
no patient data), `node scripts/edge/score.mjs --draft vault/plans/edge-data/owner-requests.txt`,
fill the empty label column (`calculator:<id>`, `tool:<id>`, `drug:<generic>`, `icd`, `kb:<id>`,
`none`), then `node scripts/edge/score.mjs --human vault/plans/edge-data/owner-requests.labels.tsv`.

**Decision (plan 7.5):** a model ships only if it beats the **rules** line at the same marks:
accepted-route accuracy at least 99%, wrong tool shown under 0.5%, danger 100%, 0 dead ends, AND a
real gain (today rules cover 56.4%; Hinglish/Tenglish 0%; the ceiling with these options is 88.3%).
If no candidate clears it, Edge stays rules-only and the flag stays OFF.

## 7. Doctor review (owner + 2 doctors)
Each reviewer reads every row of `errors` in the winning model's `--json` report (wrong opens and,
with `--errors`, misses) plus the human-set errors, and marks each: harmless / needs a fix / unsafe.
Any "unsafe" blocks release. Log names, date and verdict in [[Decisions]].
