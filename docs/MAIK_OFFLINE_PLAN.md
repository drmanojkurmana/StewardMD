# MaiK Offline — 3-engine answer plan (KB only · Cloud · On-device)

Give the clinician an explicit choice of answer engine, so nobody pays for AI tokens they
didn't ask for and the people who want to test a local medical model can opt in.

| Engine | Tier 0 (KB) | On RAG miss | Token cost | Download | Availability |
|---|---|---|---|---|---|
| **KB only · Free** | yes | nothing — honest dead end | zero | zero | everyone |
| **MaiK Cloud · Pro** | yes | `_gemini()` (unchanged) | tokens | zero | everyone (current default) |
| **On-device · Experimental** | yes | local GGUF model | zero | ~2.5 GB | `SMD_XACCESS` code holders |

Test devices: **iPhone 15 Pro** (8 GB, A17 Pro, Metal) and **Pixel 9** (12 GB, Tensor G4, CPU).
The iPhone is the MEMORY floor; the Pixel is the SPEED floor. Both must pass §3 gates.

> **STATUS 2026-08-20 — BUILT on `feat/maik-offline-engine`.** See `MAIK_OFFLINE_RUNBOOK.md` for what
> is verified vs unverified and the steps to test on device. Resolutions since this plan was written:
> **B1** entitlements added + mmap set explicitly + n_ctx 4096 (peak memory still UNMEASURED).
> **B2** Android build verified with the proven flags (tok/s UNMEASURED).
> **B3** RESOLVED at zero cost — the XCFramework is `minos 16.4`, matching the app; no target bump.
> New constraint found: that XCFramework has **no iOS simulator slice**.
> **B4** solved with chunked HTTP Range + appendFile (resumable), not `downloadFile` (which cannot resume).
> **B6** DROPPED by owner decision.
> **B9** decided by measurement, not benchmarks: Gemma 4 E4B Q4_K_M is **4.98 GB**, not the ~2.5 GB
> quoted in secondary sources ("E" = effective params, GGUF sized by raw params), so it does NOT fit
> the 8 GB floor device. Shipping **MedGemma 1.5 4B Q4_K_M (2.49 GB)** as primary, Gemma 4 E2B
> (3.11 GB) as the A/B pack.

---

## 1. What I verified in the repo (integration points)

- `home.js:3997` — `TIER 0 — instant local KB answer (retrieval-first, NO Gemini)`. The free
  engine already exists; it just must not escalate.
- `home.js:4092` — `_gemini()` is the SINGLE escalation callee (wraps
  `SMD_AI.explainGroundedStream` / `explainGrounded`). One wrap point, not three code paths.
- `reasoning.js:3771` — `window.SMD_AI` facade; `explainGrounded` (:3799) and
  `explainGroundedStream` (:3826) both open with the same `if (!b || !aiOn())` guard.
- `reasoning.js:3826` — `replay()` already types out a whole answer via `onDelta` because
  WKWebView buffers SSE on native. A local model reuses this render path untouched.
- `image-engine.js` — EXISTING two-engine chooser (device vs cloud): `getPref`/`setPref` on a
  localStorage key, `settingsHTML()` + `wireSettings()`, central `process()` router. Clone it.
- `home.js:233` — `SMD_IMAGE_ENGINE.wireSettings(setBody)`; the settings row hook goes next to it.
- `experimental.js:242` — `window.SMD_XACCESS = { gate, openGate, ensure, activate, verify,
  status, isActiveCached, tierFor, token, clear, devBypass, onChange }`. Same gate FundX AI uses.
- `kardiox-model-manager.js` — pack registry with `bytes` + `sha256`, `installed()`, `ensure()`,
  `remove()`, `source()`, `CapacitorWebFetch` for large files. Reuse the SHAPE, not `ensure()` (§3 B4).
- `local-plugins/capacitor-whisper/` — already builds **ggml** for Android
  (`libggml-base.so`, `libggml-cpu.so`, `libggml.so`) and links a PINNED prebuilt
  **XCFramework** on iOS. llama.cpp is the same ggml core. This is a fork, not a new plugin.
- `ios/Sources/WhisperPlugin/ModelStore.swift` — Application Support cache,
  `isExcludedFromBackup = true`, CryptoKit sha256, and error codes already including
  `insufficientStorage` / `lowMemory` / `modelCorrupted` / `modelMissing`.
- `node_modules/@capacitor/filesystem/dist/esm/definitions.d.ts:626` — `downloadFile()` EXISTS
  on the installed `@capacitor/filesystem` ^8.1.2.
- `ios/App/App/App.entitlements` — **`com.apple.developer.kernel.increased-memory-limit` is
  ABSENT**. Must be added (§3 B1).
- `ios/App/App.xcodeproj/project.pbxproj` — `IPHONEOS_DEPLOYMENT_TARGET = 16.4`, pinned by the
  whisper.cpp XCFramework's own min-OS (§3 B3).

---

## 2. Architecture

`maik-engine.js` (new, ~120 lines, mirrors `image-engine.js`):

```js
var KEY_ENGINE = "stewardmd.maikEngine";   // "rag" | "cloud" | "local"   default "cloud"

function escalate(pkg, opts, onDelta) {
  switch (getPref()) {
    case "rag":   return Promise.resolve({ error: "rag-only" });
    case "local": return window.SMD_MAIK_LOCAL.answer(pkg, opts, onDelta);
    default:      return _gemini(pkg, opts, onDelta);        // body UNCHANGED
  }
}
```

`_gemini()` is not modified — only its call site is wrapped. `maikRenderAnswer` already handles
`{error}`, so `rag-only` needs one new error string; the Tier 0 answer stays on screen with a
"switch to Cloud for a full answer" line. Local returns `{text, sources}`, the same shape every
downstream consumer already reads.

The `local` option is only OFFERED when `SMD_XACCESS.ensure("maik_local")` reports active AND the
model pack is installed. Otherwise the picker shows two engines.

> **SUPERSEDED 2026-08-27** - the access-code gate is gone. The `local` option is offered when
> `SMD_PRO.isProSync()` is true AND the model pack is installed. See `vault/decisions/Decisions.md`.

---

## 3. BLOCKERS AND SOLUTIONS

### B1 — iPhone 15 Pro (8 GB) jetsam kill  ·  HIGH
A 2.5 GB model plus KV cache exceeds the per-app footprint iOS allows before jetsam.

**Solution, in order of effect:**
1. Add to `ios/App/App/App.entitlements` (currently absent):
   ```xml
   <key>com.apple.developer.kernel.increased-memory-limit</key><true/>
   <key>com.apple.developer.kernel.extended-virtual-addressing</key><true/>
   ```
2. **mmap the GGUF** (llama.cpp `use_mmap` default true). Weights become file-backed CLEAN pages
   the kernel can evict; dirty RSS becomes KV cache + activations, not 2.5 GB. This is the single
   biggest lever — do not `read()` the file into a buffer.
3. **Clamp `n_ctx` to 4096**, not the model's 128K. KV cache is the dirty allocation that actually
   kills you, and it scales linearly with context. 4096 covers a grounded package + answer.
4. Text-only quant (no vision tower).
5. Release the context on Capacitor `pause`, re-init on `resume`. iOS kills large-footprint
   backgrounded apps first; mmap makes the reload cheap. (Same class of problem as the
   documented native resume-to-Home fix.)

**Gate:** peak `phys_footprint` under ~2.5 GB in Xcode's memory graph during a 512-token
generation on a 15 Pro. **Escape hatch:** if E4B won't hold, drop to the ~1.3 GB E2B pack — one
registry row, no code change.

### B2 — Pixel 9 inference speed (Tensor G4, no Snapdragon)  ·  HIGH
Tensor G4 is weaker for LLM matmul than Snapdragon 8 Gen 3, and the published tok/s figures are
Snapdragon figures.

**Solution:** copy the CMake flags already proven in `capacitor-whisper/android/build.gradle`
verbatim — they were bought with real debugging:
- `-DCMAKE_BUILD_TYPE=Release` — their own comment records ggml at `-O0` being ~50x slower.
- `-DGGML_NATIVE=OFF` plus `-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` — without this ggml builds
  baseline armv8-a with NO int8 dot-product kernels.
- `-DGGML_OPENMP=OFF`, `-DANDROID_STL=c++_shared`, `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`
  (Android 15 16 KB pages + Play compliance), `abiFilters 'arm64-v8a'`.
- `n_threads = 4`, big cores only. Tensor G4 is 1x X4 + 3x A720 + 4x A520; scheduling onto the
  A520s makes it slower, not faster.

**Gate:** >= 6 tok/s sustained on Pixel 9. Below that, ship E2B on Android and E4B on iOS — that
is two registry rows, not a code branch. Vulkan backend is a LATER optimisation; start on CPU.

### B3 — the runtime plugin does not exist  ·  MEDIUM (de-risked)
**Solution:** fork `local-plugins/capacitor-whisper` to `capacitor-llama`. It already builds ggml.
- **iOS:** swap the `Package.swift` `binaryTarget` URL + checksum from the whisper.cpp XCFramework
  release to the llama.cpp one; regenerate with `swift package compute-checksum`.
- **Android:** swap `add_subdirectory(whisper-cpp)` for a vendored `llama-cpp` submodule in
  `android/src/main/cpp/CMakeLists.txt`; keep every flag; rename `whisper_jni.cpp` to `llama_jni.cpp`.

**Known trap:** the whisper XCFramework's `IOS_MIN_OS_VERSION=16.4` is why the app is pinned to
16.4. If llama.cpp's official XCFramework has a HIGHER floor, either raise the app floor (drops
iOS 16 users) or build a custom XCFramework with `build-xcframework.sh` and host it — the whisper
README already documents that exact procedure. **Check this before writing any Swift.**

### B4 — 2.5 GB download will OOM the existing downloader  ·  HIGH
`kardiox-model-manager.js` `ensure()` does `r.arrayBuffer()` then base64-encodes the whole file for
`Filesystem.writeFile`. Fine at 22 MB per ONNX head; at 2.5 GB it is a 2.5 GB buffer plus a
~3.3 GB base64 string. Instant jetsam.

**Solution:** never base64 a model.
- Use `Filesystem.downloadFile()` (present in the installed 8.1.2) or the native side's
  `URLSession` download task / OkHttp sink — both stream straight to disk.
- **Split the GGUF into ~500 MB shards** (`model-00001-of-0000N.gguf`, which llama.cpp loads
  natively) so a dropped connection on an Indian mobile network resumes instead of restarting.
- Keep the registry's per-file `bytes` + `sha256`; `ModelStore.swift` already verifies with CryptoKit.
- Pre-flight free-space check; the `insufficientStorage` error code already exists.

### B5 — reinstall wipes the model  ·  MEDIUM, unavoidable
App data dies with an uninstall; this is the same behaviour already documented for the 264 MB
Whisper model. **Solution:** mitigate, don't fight it. Warn before uninstall/delete, make shards
resumable, keep a visible "Delete model (frees 2.5 GB)" row, and use `adb install -r` for our own
Pixel 9 testing so the pack survives test builds.

### B6 — ungrounded answers going to doctors  ·  HIGH (safety)
**Solution:** the local engine runs the SAME gates as cloud, before generation:
- `MaiKScope` intent firewall and the never-guess gate (`home.js:3856`) are already on-device.
- Distinct answer chrome: "On-device model · no source · verify before acting".
- No answer-feedback upload and no telemetry while offline — the tier exists partly for privacy.
- Refuse rather than guess on dose/paediatric/pregnancy queries when Tier 0 missed: those route to
  Cloud or to nothing. A 4 B model must never be the sole source for a dose.

### B7 — store review  ·  LOW
- iOS: GGUF weights are DATA, not executable code, so 2.5.2 is fine. Needs Wi-Fi-only default and
  a user-initiated download. Never bundle the model (app-size limits).
- Android: `allowBackup=false` is already set; the 16 KB page-alignment flag is already in use.
- Both: existing medical disclaimer covers the tier; add the "no source" line to it.

### B8 — thermal throttling and battery  ·  LOW
**Solution:** cap `n_predict` at ~512, stream tokens, always-visible Stop button, and warn (not
block) when the device is in Low Power Mode.

### B9 — model choice is still open  ·  MEDIUM
Published benchmarks disagree: MedGemma 1.5 4B wins MedQA (69%), Gemma 4 E4B wins the harder,
less-contaminated reasoning benchmarks and has official QAT Q4 checkpoints (better Q4 quality).

**Solution:** decide with our own data, not a leaderboard. Ship both as registry rows, pull 100
real RAG-miss questions from the MaiK logs, run both on-device, grade by hand. The experimental
tier is exactly the right place to A/B this, and the engine label shows the model name so testers
know what they graded.

---

## 4. Model strategy

Registry rows in the `kardiox-model-manager.js` style, one per candidate. Host on the existing
`models.stewardmd.in` R2 bucket (new `/maik` prefix).

```
maik-medgemma15-4b   MedGemma 1.5 4B-it   Q4_K_M   ~2.5 GB   5 shards
maik-gemma4-e4b      Gemma 4 E4B-it       Q4 QAT   ~2.5 GB   5 shards
maik-gemma4-e2b      Gemma 4 E2B-it       Q4 QAT   ~1.3 GB   3 shards   (fallback pack, B1/B2)
```

Model is a data row, not an abstraction. Adding one later is a registry entry.

---

## 5. Delivery order (separate PRs)

1. **PR1 — JS only, no model.** `maik-engine.js` + 3-way picker + `escalate()` wrap +
   `rag-only` copy. The KB-only engine delivers the whole no-token promise on its own and ships
   this week. `local` is hidden (no plugin yet).
2. **PR2 — spike, throwaway.** llama.cpp + one pack on both devices. Measure tok/s and peak
   footprint. This decides B1, B2 and B9. Nothing else starts until it passes.
3. **PR3 — `capacitor-llama` plugin** (fork of capacitor-whisper) + entitlements.
4. **PR4 — pack download + `SMD_MAIK_LOCAL.answer()` + `SMD_XACCESS` gate + delete-model row.**

---

## 6. Tests

- Unit (`test/`): `escalate()` returns `rag-only` for "rag", calls `_gemini` for "cloud", calls
  `SMD_MAIK_LOCAL.answer` for "local"; `getPref` defaults to "cloud"; unknown value falls back to
  "cloud"; `local` is not offered when `SMD_XACCESS` is inactive or the pack is missing.
- Unit: registry `totalBytes`, shard sha256 mismatch rejects, free-space pre-flight.
- Manual, both devices: cold download over mobile data with airplane-mode interruption; peak
  footprint during generation; tok/s; background/foreground cycle; delete-and-redownload.

## 7. Rollback

Pref default is `"cloud"`, so an untouched install behaves exactly as today. Kill switch:
`localStorage.setItem("stewardmd.maikEngine","cloud")` plus hiding the picker. `remove()` frees
the pack. PR1 is independently revertable from PR3/PR4.

## 8. Licenses to document

Gemma Terms of Use (permits commercial redistribution, requires passing the use restrictions
downstream) or HAI-DEF terms for MedGemma; llama.cpp MIT. Bundle the notices with the model pack,
not just in the repo.

---

## DECISIONS NEEDED BEFORE NATIVE CODE

1. **Model pack v1** — MedGemma 1.5 4B (medical-tuned, wins MedQA) or Gemma 4 E4B (newer base,
   QAT Q4, wins hard reasoning)? PR2 can answer this empirically if you'd rather not pick now.
2. **iOS floor** — if llama.cpp's XCFramework needs > 16.4, raise the app floor or build a custom
   XCFramework? (Whisper's README documents the custom path.)
3. **Wi-Fi-only download** — hard requirement, or warn-and-allow on mobile data?
4. **Default engine for non-Pro users** — leave at `cloud` (server gates them anyway) or default
   them to `rag` so they never hit a paywall mid-answer?
