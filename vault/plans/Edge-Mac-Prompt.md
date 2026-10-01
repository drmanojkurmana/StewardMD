---
tags: [plan, edge, handoff]
status: ready to paste into Claude Code on the owner's Mac
---
# Prompt for Claude Code on the Mac (paste everything below the line)

---

You are continuing the StewardMD Edge sprint on the owner's Mac. The cloud session did everything that
does not need a Mac, a phone, Cactus or a GPU. Your job is ONLY the parts that need Xcode and the
attached phones. Read `CLAUDE.md` first (especially the iOS build, install and WebView-debug sections),
then `vault/plans/Edge-Runbook.md` and `vault/modules/StewardMD Edge.md`.

## 0. Get the branch (the llama.cpp submodule blocks a plain stash)
```sh
cd <StewardMD clone>
git submodule status local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp   # '+' = moved, '-' = not checked out
git submodule update --init --force local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp
git status --short                         # must be clean; commit or stash anything else first
git fetch origin ccr-fbfae7e0-rjkxxk && git checkout ccr-fbfae7e0-rjkxxk && git pull
npm install
```
If the submodule holds work the owner wants, `git -C <that path> stash -u` before the update.

## What is already verified (do not redo)
- Android: both plugins build with NDK r27.2; `libneedle_jni.so` and `libllama_jni.so` have every LOAD
  segment at 0x4000, the expected JNI exports, every import resolvable at API 26, no network symbols in
  the Needle library. Re-run any time: `test/native-host/run.sh android` (needs ANDROID_HOME).
- The REAL `llama_jni.cpp` + `LlamaEngine` ran FunctionGemma 270M Q8_0 on a Linux CPU: with the router
  grammar 1,512/1,512 replies were valid `{"option":n}`, without it 0/60. Base FunctionGemma routes
  badly (20.8% wrong on model-routed rows): it must be fine-tuned before the bake-off means anything.
- The REAL `needle_jni.cpp` + `NeedleNative` ran base Needle on a Linux CPU: load/configure/complete work;
  base Needle reports low confidence on everything, so the router passes it all to MaiK (safe).
- NOT verified anywhere: any Swift. `local-plugins/capacitor-needle/ios/Sources/NeedlePlugin/NeedlePlugin.swift`
  is new, and `local-plugins/capacitor-llama/ios/Sources/LlamaPlugin/LlamaEngine.swift` +
  `LlamaPlugin.swift` gained a `grammar` parameter. Expect to fix compile errors; keep the JS contract
  (`edge-router.js` needleAdapter / llamaAdapter) unchanged.

## 1. iOS build with both plugins (gates A0.1/A0.2 for iOS)
1. `cd local-plugins/capacitor-needle && scripts/fetch-needle.sh && scripts/make-xcframework.sh` (pinned sha256s;
   a mismatch means upstream changed: stop and tell the owner).
2. On a LOCAL branch only (`edge-device-test`, not pushed): add
   `"@stewardmd/capacitor-needle": "file:local-plugins/capacitor-needle"` to `package.json`, `npm install`,
   `npm run sync`. Adding it for real is the owner's call after the gates pass.
3. Build the `App` scheme of `ios/App/App.xcodeproj` with the real Xcode via `DEVELOPER_DIR` (see CLAUDE.md:
   no .xcworkspace, do not `xcode-select -s`). Fix Swift errors in the two plugins; nothing else.
4. Check `App.app/App.debug.dylib` (not the main binary) for `NeedlePlugin` and `needle_complete` symbols.
5. Install on the iPhone exactly as CLAUDE.md says (uninstall first; it WIPES app data, including SURGX notes;
   ask the owner before installing if they have notes on that phone). Verify the running `?v=` token in the
   live WebView, not the install message.
6. AFTER installing, copy weights into the app container: base `local-plugins/capacitor-needle/build/weights/needle3.cact`
   to `Library/Application Support/needle/needle3.cact` (`xcrun devicectl device copy to --help` for the flags).

## 2. On-device runs (iPhone, then the Android phone if attached)
```sh
ios_webkit_debug_proxy -c null:9221,:9222-9250 &     # USB, unlocked, app freshly launched
curl -s localhost:9222/json                          # take the page's webSocketDebuggerUrl
node scripts/edge/export.mjs                         # if dataset/export is missing
node test/edge-bakeoff-device.mjs --ios --ws <url> --engine needle --limit 20
```
- Pass for A0.2 (iOS): 20 lines, statuses `ok`, the app never freezes; a long call shows `busy` then recovers.
- Grammar (A0.3): copy `functiongemma-270m-it-q8_0.gguf` (ggml-org, revision 2566ce14, sha256 83940d4d...)
  into the app container, then `--engine llama --model <container path> --limit 20`: every line `ok` with an
  integer option. RELAUNCH the app afterwards (MaiK's pack was evicted).
- Android phone (adb): `adb shell pidof in.stewardmd.app`, `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`,
  the same two runs without `--ios`, plus `adb shell ps -A | grep :edge` (separate process) and the kill test
  from the runbook (A0.2 step 5).
- Record for each run: p50/p95 latency (`node scripts/edge/score.mjs --pred <file>` prints it), peak memory,
  phone temperature after 50 calls. Real phone latency is the number that decides the 1,200 ms deadline.

## 3. Report and commit
- Write the results into `vault/plans/Edge-Runbook.md` under each gate (pass/fail, device, iOS/Android
  version, numbers). Commit ONLY Swift fixes and the runbook to `ccr-fbfae7e0-rjkxxk` (stage files
  explicitly; never the `package.json` change, never weights or binaries). Push.
- Do not train anything, do not flip any flag default, do not touch MaiK behaviour.
- If a gate fails, stop and report: the failing model is dropped from v1, not worked around.
