---
tags: [plan, edge, runbook]
status: ready for the owner (2026-10-01)
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
CudaBuild plugin), about 6 GB free disk for a worktree build, an iPhone on USB (`idevice_id -l`).
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
- **To send to Cactus** (owner): "Needle 3 android-arm64 `fast_core_mask()` counts cores at >= 75% of
  the max `cpu_capacity`; on SoCs with one prime core (Tensor G4: 1 X4 + 3 A720 + 4 A520) that is 1,
  so `Engine()` falls back to `hardware_concurrency()` (8) and spins threads on the little cores: ~9 s
  per call vs ~0.15 s on an iPhone 15 Pro. Please count cores at, say, >= 50% of the max (or take the
  top two capacity tiers), respect `sched_getaffinity` (an app's background/foreground cpuset excludes
  the prime core), and expose a thread-count setting in `needle.h`."

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
