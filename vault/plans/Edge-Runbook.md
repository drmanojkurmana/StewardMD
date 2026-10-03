---
tags: [plan, edge, runbook]
status: round 2 done (2026-10-03); Pixel renderer-gone run (first request missed, fixed in edge8, not re-run); Pixel bake-offs with PSS and the 30-minute session not run (phone locked); iPhone back-off during real MaiK generation, real Serious and availMB with MaiK Lite pending
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
  > linker wrap. We have not yet checked whether your 2026-10-02 build changes this.

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

**Pixel 9 (12 GB, Android 17), 2026-10-02, same conditions as A0.2 Android: stability PASSED, latency
FAILED.** 50 back to back: Needle 50/50 `timeout` (p50 4.1 s incl. kill + reload), FunctionGemma 50/50
`timeout` (p50 1.23 s). Mixed session (`test/device/edge-mixed-session.mjs --android`, 11 cycles in
~28 minutes, then the phone was unplugged): same app process throughout, dictation 11/11 on-device,
MaiK 11/11 local (first text p50 5.6 s, max 20.8 s; full answer p50 97 s, max 141 s, slowing as it
heated), Needle 110/110 `timeout`. App PSS 2.5-3.0 GB with MaiK Lite loaded. Battery 37.3 -> 40.0 C,
thermal status 1 (light) throughout, on the charger at 100%. Not the 4 GB phone the gate names.

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
  `smd_edge` "1" for the test only): mechanism PASSED, first request MISSED, fixed in `edge8` (not re-run).**
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
    request; later requests keep the one-request-stale refresh. Unit test fails without it. The `edge8` APK
    is installed on the Pixel but the re-test did not run: the phone stayed locked (below).
  - Seen on the way: with the screen locked the app sits in the `background` cpuset (cores 0-3, the A520s);
    logcat `NeedleJNI: engine threads 4 (cpu_capacity, 8 cpus, 4 allowed)` and every Needle call timed out
    (routes 4.0-5.7 s). Any Edge timing needs the phone unlocked with the app in front.
- **Pixel round of 2026-10-03 afternoon: NOT RUN, all PENDING.** The phone stayed behind its lock screen (PIN set)
  from 13:34 to 19:50; it was not bypassed (locked, the app runs on the A520s only, so numbers would be
  invalid). PENDING: the renderer-gone re-test on `edge8`, the Needle and
  FunctionGemma `--limit 50` bake-offs with peak PSS, the 30-minute A0.6 mixed session, the MaiK Lite
  `nThreadsBatch` re-measure with the book linked (optional). Also PENDING on the iPhone: the MaiK Lite
  readings (real MaiK-busy back-off, availMB with MaiK Lite loaded); MaiK Lite is staged on the Mac. The earlier Pixel mixed-session result below (2026-10-02,
  charging, before the thread fix) is still the only one, and it is stale. Ready for the next window: the
  harness now runs its Edge step under the production back-off (e13344cf5, skips counted), and
  `/tmp/edge-pixel/sampler.sh` (Mac scratch) logs app and `:edge` PSS, thermal status, skin and battery
  temperature, level and power every N seconds. Phone left clean (OTA 167 current, `smd_edge` unset,
  `smd_maik_rag_linked` "0", no test weights, stay-awake off, no forwards, no thermal override).
- Why simulated: MaiK Lite had to be re-downloaded after the reinstall, and the phone's own network gave
  0.01-0.05 MB/s (the Mac got ~0.9 MB/s from the same R2 file); a Mac side-load did not finish before the
  owner had to take the phone. Real Serious was not attempted (it needs sustained MaiK load).
- **Memory (availMB, `os_proc_available_memory`, as a peak-memory proxy):** fresh launch 6,120 MB; Needle
  loaded 6,073 (-47); after one Needle call 6,065; FunctionGemma loaded on top 5,958 (-107); after three picks
  5,953; after `release()` 5,953. Far above the 250 MB floor. Round 1's A0.6 footprint (630-665 MiB with
  MaiK Lite loaded) is still the only MaiK-loaded figure.
- **Pending (iPhone):** back-off while MaiK Lite really generates, real thermal Serious, and availMB with
  MaiK Lite loaded.
  MaiK Lite (`maik-lite-q4_k_m.gguf`, sha verified) is staged on the Mac for the next iPhone window, with
  side-load steps in its `SIDELOAD.md` (job scratch folder, not in git).
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
