---
tags: [plan, edge, handoff]
status: ready to paste into Claude Code on the owner's Mac (round 2, 2026-10-02)
---
# Prompt for Claude Code on the Mac, round 2 (paste everything below the line)

---

Round 2 of the StewardMD Edge work on the owner's Mac. The owner said "complete all": do every item below
that needs the Mac or a phone, in order, and stop only at the decisions listed at the end.

## 0. Get the branch (do this first)
```sh
cd <StewardMD clone>
git fetch origin ccr-fbfae7e0-rjkxxk && git checkout ccr-fbfae7e0-rjkxxk && git pull   # head 3fa1577ef or later
npm install
```
What changed since your last run:
- `scripts/fetch-needle.sh` now fetches from Hugging Face revision `27c0a9a5`. Cactus replaced every needle3
  binary on `main` on 2026-10-02, so the old URLs fail their sha256 check. It also keeps a file already on
  disk that matches its pin. The new Cactus build is unaudited: do not move the pin.
- ED provisional-MRN race fixed (1664ce08d). main merged in (3fa1577ef, `index.html` token conflict only).
- Read `vault/plans/Edge-Options-2026-10-02.md` before items 1 and 2. It has the causes, numbers and designs.
- Rules as before: `smd_edge` stays default OFF, no training, stage files explicitly, `npm test` stays
  green, no em-dash in app text, no PHI anywhere. Commit and push to `ccr-fbfae7e0-rjkxxk` after each item.
- Android worktree builds need `android/app/google-services.json` copied in (gitignored).

## 1. Fix the iOS build properly (mlx-swift `std::system`), owner-approved
Your DerivedData (and the local patch) is gone. Do NOT re-apply the local patch; do the real fix:
1. Fork both repos to the owner's account:
   ```sh
   gh repo fork Layr-Labs/mlx-swift --clone=false
   gh repo fork Layr-Labs/mlx-swift-lm --clone=false
   ```
2. In `drmanojkurmana/mlx-swift`, branch `stewardmd-ios27` from `0f4fe403bef6899e8a72882bc6d4036a7a62ae31`. Make one commit that ports ml-explore/mlx-swift `ab924c8` verbatim:
   - add `Source/Cmlx/mlx-conditional/jit_compiler_conditional.cpp`:
     ```cpp
     // Copyright © 2025 Apple Inc.

     #include <TargetConditionals.h>

     // `JitCompiler` shells out via `std::system()`, which is unavailable on iOS and
     // visionOS. It is only referenced from `backend/cpu/compiled.cpp`, and
     // `compiled_conditional.cpp` selects `no_cpu/compiled.cpp` on those platforms,
     // so it isn't needed there. Keep this condition in sync with
     // `compiled_conditional.cpp`.
     #if !(TARGET_OS_IOS || TARGET_OS_VISION)
     #include "../mlx/mlx/backend/cpu/jit_compiler.cpp"
     #endif
     ```
   - in `Package.swift`, the Apple-platform `platformExcludes` (the `#else` branch, next to
     `"mlx/mlx/backend/cpu/compiled.cpp"`), add `"mlx/mlx/backend/cpu/jit_compiler.cpp",`.

   Push the branch and note the commit SHA.
3. In `drmanojkurmana/mlx-swift-lm`, branch `stewardmd-ios27` from `9f70e68dce563c90ad443fef470a713936bf6a4d`. Make one commit that changes only the mlx-swift dependency to `url: "https://github.com/drmanojkurmana/mlx-swift.git", revision: "<sha from step 2>"`. Push it and note the SHA.
4. In `local-plugins/capacitor-mlx/Package.swift`:
   - point mlx-swift-lm and mlx-swift at the two forks and SHAs (both pins must match, or SwiftPM cannot resolve).
   - update the PINS comment: why the forks exist, the upstream commit ported, and that the change is dead code on iOS.
5. Build the App scheme with Xcode 27.2 (`DEVELOPER_DIR`, `-skipPackagePluginValidation`), with NO local patch. Then:
   - **Prove it:** the build passes where it failed before.
   - **Smoke test:** install on the iPhone (uninstall first, per CLAUDE.md), verify the running `?v=` token, and run one MaiK MLX answer to confirm it still works and gives the same answer as before.
6. Update the pin notes: `vault/modules/MaiK.md` (around line 378), `docs/MAIK_MLX_SPIKE.md` and the Build note in `vault/plans/Edge-Runbook.md`. If Xcode rewrote a tracked `Package.resolved`, commit it.
7. Optional, owner's choice later: open the same 2-file change as a PR to Layr-Labs/mlx-swift. Do not open it without asking.

## 2. FunctionGemma latency on the Pixel
1. Measure first. Build the two benches with the NDK against an arm64 build of the pinned llama.cpp:
   - **Sources:** `test/native-host/fg-sampler-bench.cpp` and `test/native-host/fg-digit-pick-bench.cpp`; llama.cpp is `local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp`. Configure it with the NDK cmake toolchain, `ANDROID_ABI=arm64-v8a`, `ANDROID_PLATFORM=android-26`, CPU only.
   - **Run:** `adb push` the binaries, `libllama.so`/`libggml*.so` and the FunctionGemma GGUF to `/data/local/tmp`, then run with `LD_LIBRARY_PATH=/data/local/tmp`. Unplug the charger and use wireless adb (charging throttles the CPU).
   - **Record** prefill, decode and sampling time per step, and the digit-pick total.
2. If the sampler column is the main cost (as on the host: about 2/3), implement option 1 from the Options note, "forced prefix + digit pick":
   - **Plugin, Android:** a new generate option, e.g. `pick: { prefix: "{\"option\":", choices: ["0","1",...] }`. With it, the engine:
     - renders the chat template,
     - appends `prefix` after the model-turn start,
     - runs ONE prefill,
     - returns `{ text: "{\"option\":N}", p: <softmax over the choice tokens> }` with no decode loop and no grammar.

     Files: `llama_jni.cpp`, `LlamaNative`, `LlamaEngine.java` and `LlamaPlugin.java`.
   - **Plugin, iOS:** the same in `LlamaEngine.swift` and `LlamaPlugin.swift`.
   - **Router:** `edge-router.js` `llamaAdapter` sends `pick` instead of `grammar` and returns `{ option, confidence: p }`. Keep the grammar path as the fallback when the plugin lacks `pick`.
   - **Tests:** update `test/edge-router.test.mjs`, and extend `test/native-host/run.sh llama` so it runs the real JNI path for `pick`. The token sequence must equal the llama-json training target (`{"option":` is tokens 14937 4485 1083).
3. Re-run the bake-off on the Pixel (`test/edge-bakeoff-device.mjs --engine llama --limit 50`) and the iPhone. Record p50 and p95 against the 1.2 s deadline in the runbook (gate A0.3).

## 3. Needle and the back-off on real phones
1. Re-time Needle on the Pixel unplugged (wireless adb): `--engine needle --limit 50`. Record it under A0.2.
2. Back-off (763f0e268), not yet run on any phone. On both phones:
   - Read `SMD_EDGE.backoff()` at rest, while MaiK is generating, and while hot (iPhone thermal Serious).
   - Confirm Edge hands typed requests to the rules layer in those states and resumes afterwards.
   - Record the readings, including iPhone `availMB` with MaiK Lite loaded (the floor is 250 MB).
3. A 4 GB Android phone, if one is available: A0.2 + A0.6 (`test/device/edge-mixed-session.mjs --android`).
   If none is available, write that in the runbook and stop this step.

## 4. MaiK's own prefill on Android (owner said complete all)
`LlamaPlugin.java:250` defaults `nThreadsBatch` to all cores, which is the same cause as Edge's 3.6 to 4.1 s.
1. On the Pixel, measure MaiK first text and total time with and without `nThreadsBatch: 4`, five questions each.
   Use the `maik-local.js` loader around line 833 (it already passes per-pack knobs).
2. Apply it only if the first text is clearly faster and the greedy answers are unchanged. Pass it as a pack knob
   from `maik-local.js`, the way `nBatch`/`nUbatch` already are, and keep the plugin default as it is so iOS and
   other callers are unaffected. Record before and after in the runbook.

## 5. On-device speech, Android label fixes
1. `speechOnDevice()` reports `onDevice:true` for a language whose on-device model is not installed. In
   `local-plugins/capacitor-community-speech-recognition/android/.../SpeechRecognition.java`, on API 33+ use
   `SpeechRecognizer.checkRecognitionSupport` and report a per-language answer (installed / downloadable / no).
2. The label shows "On-device" for 20 to 60 ms before the plugin's `recognitionMode` arrives. Show the neutral
   "Device speech" until the mode event lands (`voice.js`; `test/speech-ondevice.test.mjs` already pins this
   for `require`, so extend it to `prefer`).
3. Verify on the Pixel: en, hi and te, plus Airplane mode. Record the results under runbook section 4b.

## 6. Link Needle into the app (owner said complete all)
After items 1 to 3 pass:
1. Add `"@stewardmd/capacitor-needle": "file:local-plugins/capacitor-needle"` to `package.json` for real, then `npm install` and `npm run sync`.
2. Build both platforms and verify `Capacitor.Plugins.Needle` is present in both live WebViews.
3. `smd_edge` stays default OFF.
4. Commit `package.json`, the lockfile and the native project changes `cap sync` makes. Never commit the weights or the binaries.

## 7. Report back
- Write every result into `vault/plans/Edge-Runbook.md` under its gate, and update `vault/modules/StewardMD Edge.md` (status, gotchas).
- Finalise the Cactus report text in the runbook (A0.2 Android) for the owner to send. Do not send it.
- If a gate fails: stop, report, and drop that model from v1 rather than working around it.

## 8. Take over from the cloud session (it has stopped)
The cloud session that was driving PR #1342 handed everything to you on 2026-10-02 and stopped.
- **Own PR #1342** (https://github.com/drmanojkurmana/StewardMD/pull/1342) until it is merged:
  - watch CI and reviews, fix red CI on this branch, and merge main in again when it conflicts (last time it was only `index.html` cache tokens: keep main's and add our suffix).
  - `replay` fails on `heldout3.txt.abxSens: 125 (floor 126)`, red on main too. It is reported in PR comment 5940838154. Never lower the floor.
  - Keep the PR description current.
- **ABDM pending-link false positive** (not started):
  - **Bug:** `functions/_wardsynq/abdm-hip.js:355-358` stores `sha10(ref)`. About 0.35% are 10 digits starting 6-9, which `MOBILE_EMBED` in `functions/_connect/abdm/no-phi.js` blocks, so `/ward/abdm-link-stay` returns 502.
  - **Fix:** store a digit-free form of the same hash and accept the old form on read; keep `sha10` itself, because it builds the `DR-`/`INV-` refs:
    `const pendTok = async (ref) => (await sha10(ref)).replace(/[0-9]/g, (d) => "ghijklmnop"[d]);`
    Use it at the write (line 355) and the read (line 385): `pending.includes(await pendTok(r.ref)) || pending.includes(await sha10(r.ref))`.
  - **Test:** add a regression test pinning a ref whose `sha10` is all digits starting 6-9, then run the full suite with `npm test`.
- **Benches:** the host build of llama.cpp and both benches are documented in `test/native-host/fg-*.cpp`.

## Still the owner's call (do NOT do these)
- MaiK Lite answering with "book linked" OFF gave wrong answers (mechanical mitral INR 2.0-3.0, an invented artemether dose). Whether to block or label those answers.
- Whether a hot iPhone (thermal Serious) should keep handing all typed requests to the rules layer.
- Auditing Cactus's 2026-10-02 needle3 build before moving the pin.
- The `replay` Dx floor (`heldout3.txt.abxSens` 125 < 126), red on main too. Never lower a floor.
- Training and the doctor review.
