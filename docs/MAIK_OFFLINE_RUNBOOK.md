# MaiK Offline — wake-up runbook

Branch: **`feat/maik-offline-engine`** (5 commits, NOT pushed, NOT merged).
Plan: `docs/MAIK_OFFLINE_PLAN.md`. Built overnight 2026-08-20.

---

## TL;DR — the 4 steps to test on your iPhone 15 Pro

**There is no Xcode on this Mac** (`xcode-select -p` → CommandLineTools only), so I could not build
or install the iOS app. Everything else is done. You need to do this much:

```bash
cd ~/Developer/StewardMD
git checkout feat/maik-offline-engine
git submodule update --init --recursive        # pulls llama.cpp b10502 (Android only; iOS uses the pinned XCFramework)
npm install                                    # links @stewardmd/capacitor-llama
npm run build:www && npx cap sync ios
open ios/App/App.xcworkspace                   # then Run on the device
```

Then **on the phone**, in Settings → AI Assistant you will see the new **Answer engine** picker with
three options. To unlock the third one without waiting for a server deploy, run this once in the
WebView console (Safari → Develop → your iPhone → the app):

```js
localStorage.setItem("smd_maik_local_bypass", "1"); location.reload();
```

Now: **Settings → AI Assistant → Answer engine → On-device model → Download model (2.49 GB)**.
When it finishes, ask MaiK something the KB does not cover and the answer comes from the phone.

Tap the download row again if it stops — it resumes from where it got to.

---

## What is verified vs what is not

| Thing | Status |
|---|---|
| Engine picker + router (`maik-engine.js`) | **VERIFIED** — 49 unit tests + 19 real-Chrome checks |
| Router attaches in the live script order | **VERIFIED** in headless Chrome (this was the main design risk) |
| KB-only mode makes ZERO `/api/ai` calls | **VERIFIED** in Chrome via CDP network capture |
| Resumable download logic (`maik-models.js`) | **VERIFIED** — 40 unit tests incl. resume, truncation, corrupt-body, oversize restart |
| Prompt builder + streaming contract (`maik-local.js`) | **VERIFIED** — 38 unit tests |
| HuggingFace serves Range + exact byte count | **VERIFIED** against the live URL (`206`, `content-range: .../2489894976`) |
| Android native llama.cpp build | **VERIFIED** — compiles clean, NDK 27.2, arm64-v8a, 16 KB-aligned `.so` |
| No ggml `.so` collision with capacitor-whisper | **VERIFIED** — clean static build emits ONE `.so`; filename overlap with whisper is empty |
| iOS XCFramework min-OS matches the app | **VERIFIED** — `vtool` says `minos 16.4`, app is already 16.4 |
| `www/` bundle assembles with the new files | **VERIFIED** |
| **Offline inference on a real Pixel 9** | **VERIFIED 2026-08-20** — see the measured numbers below |
| **Streaming onDelta accumulation contract** | **VERIFIED on-device** — 54 deltas for 54 tokens, `accumulated === final` |
| **Swift code compiles** | **NOT VERIFIED** — no Xcode on this machine. Expect to fix small Swift errors. |
| **Peak memory on the 8 GB iPhone** | **NOT MEASURED** — still the open question for iOS |
| **tok/s on iPhone (Metal)** | **NOT MEASURED** |

---

## MEASURED on a real Pixel 9 (Android 17, Tensor G4, WiFi OFF)

Proven offline from inside the app: `navigator.onLine === false` and a fetch to
`stewardmd.in/api/ai/health` threw "Failed to fetch". Engine `local`, MedGemma 1.5 4B Q4_K_M.

| | cold | warm 1 | warm 2 |
|---|---|---|---|
| total | 27.1 s | 19.9 s | 24.5 s |
| first token | - | 9.3 s | 11.8 s |
| generation | - | 10.6 s | 12.7 s |
| tokens | ~20 | 54 | 50 |
| **tok/s** | - | **5.11** | **3.94** |

**This MISSES the >= 6 tok/s gate** this plan set for Android. Usable but slow. The bigger UX
problem is the 9-12 s of silence before the first token: the answer bubble needs an explicit
"thinking on device" state, not a spinner that looks hung.

### Answer quality: one good, one clinically WRONG

Both asked with EMPTY grounding on purpose (the worst case; in the app Tier 0 supplies KB chunks).

- "Severe CAP needing ICU, empiric regimen?" -> *"Vancomycin plus a beta-lactam"*.
  **WRONG.** Severe CAP needs a beta-lactam PLUS a macrolide (or a fluoroquinolone) for atypical
  cover. Vancomycin is for suspected MRSA, not routine empiric therapy. It both adds an
  inappropriate drug and omits atypical cover, stated confidently with no hedge.
- "IV magnesium dose in severe asthma?" -> *"2 g over 20 min, repeat after 20 min, max 4 g"*. Correct.

That is what a 4B model does. B6 (safety gating on dose/antibiotic answers) was dropped by owner
decision, so nothing currently stops an ungrounded wrong regimen reaching a clinician. Recorded
here as evidence, not as an argument to re-litigate it.

341 test files in the repo pass. Three fail — `onco-emr`, `sknx-flags`, `followcare-voice-server` —
and all three fail **identically on the branch base**, so they are not from this work.

---

## The one number that decides the feature

Peak memory on the iPhone 15 Pro. Everything is set up to survive it, but it is unmeasured:

- `App.entitlements` now has `increased-memory-limit` + `extended-virtual-addressing` (both were absent).
- The model is mmap'd (`LLAMA_LOAD_MODE_MMAP`, set explicitly, not left to `_AUTO`).
- `n_ctx` is clamped to **4096**, not the model's full context, because the KV cache is the dirty
  allocation that gets you killed.
- The plugin releases the model on app pause and reloads on demand.

**Watch it in Xcode's memory gauge during a generation.** If it crowds the ceiling, the knob is
`nGpuLayers` in `LlamaPlugin.load` — it defaults to `-1` (all layers on Metal, fastest) and stepping
it down toward `0` trades speed for resident memory. Do not guess this; the phone will tell you.

---

## The model choice changed, and this matters

I recommended Gemma 4 E4B earlier on benchmark grounds. **That was wrong for your device**, and I
only found out by reading the real file sizes off the HuggingFace API:

| Model | Q4_K_M size | Fits 8 GB iPhone? |
|---|---|---|
| **MedGemma 1.5 4B** | **2.49 GB** | yes, comfortably — **shipped as primary** |
| Gemma 4 E2B | 3.11 GB | tight; shipped as the A/B pack |
| Gemma 4 E4B | 4.98 GB | **no** (smallest sane quant, Q3_K_S, is still 3.86 GB) |

The "E" in E2B/E4B is *effective* parameters (Per-Layer Embeddings), but a GGUF is sized by **raw**
parameters. The ~2.5 GB figure I quoted for E4B came from a secondary blog and does not survive
contact with the actual file. So your instinct to use MedGemma was right, for a reason neither of us
had: it is the one that fits.

Both packs are registry rows in `maik-models.js`. Switch with
`SMD_MAIK_LOCAL.answer(pkg, { pack: "maik-local-e2b" })`, or add a picker inside the beta tier when
you want to grade them side by side.

---

## Android / Pixel 9

The native side is the part I could actually verify, and it builds. To try it:

```bash
npm run build:www && npx cap sync android
npx cap run android          # or ./gradlew assembleDebug
```

Use `adb install -r` for reinstalls so the 2.49 GB model is not wiped (your documented gotcha).

Two Android notes:
- The native payload is **~48 MB** added to the arm64 APK — one statically-linked `libllama_jni.so`
  (llama.cpp compiles every model architecture). Whisper only added ~6 MB. Trimming architectures is
  a later optimisation, not a blocker.
- **ggml is linked STATICALLY, deliberately.** capacitor-whisper ships `libggml.so`,
  `libggml-base.so` and `libggml-cpu.so` from whisper.cpp v1.9.1. A shared llama build emits the
  SAME THREE FILENAMES from llama.cpp b10502's different ggml. Both land in one APK's jniLibs, so one
  silently overwrites the other and the loser gets an ABI-mismatched ggml — a runtime crash, not a
  build error. `BUILD_SHARED_LIBS=OFF` folds everything into one `.so`. Do not flip it back.
- Threads default to `min(4, cores/2)` — big cores only. Tensor G4 is 1×X4 + 3×A720 + 4×A520, and
  scheduling matmul onto the A520s makes generation slower, not faster.

---

## What I did NOT do

- **B6 (safety gating) — dropped, as you said.** No refusal routing on dose/paediatric questions, no
  forced "no source" banner. The result still carries `engine: "local"` so you can label it later if
  you change your mind; nothing is gated on it.
- **No Wi-Fi-only gate, no confirmation wall** on the download. Tap it, get it.
- **Nothing pushed or merged.** Branch only.
- **Models are served from HuggingFace**, not your R2. Fine for a beta; move them to
  `models.stewardmd.in` before real users so a third party cannot rate-limit a clinician mid-download.
- **No full SHA-256 check on device.** Size + GGUF magic + llama.cpp's own loader validation. The
  published hashes are in the registry so a desktop can verify the same bytes if corruption ever
  shows up. Marked with a `ponytail:` comment.

---

## If something breaks

| Symptom | Likely cause |
|---|---|
| Simulator build fails to link | The b10502 XCFramework has **no simulator slice**. Build for the device. |
| Whisper dictation crashes after adding this | ggml collision — check `BUILD_SHARED_LIBS=OFF` is still set in the plugin's CMakeLists. |
| Swift compile errors | Expected — unverifiable here. The llama.cpp C API is imported directly; `LlamaEngine.swift` is where to look. |
| Third option missing in Settings | Bypass not set, or the app is the web build (the plugin is native-only by design). |
| `low-memory` on load | Reduce `nGpuLayers`, then `n_ctx`. |
| Download stalls | Tap the row again; it resumes. |
| Answers look like `aababcabcd` | The onDelta contract flipped to deltas; it must be **accumulated** text. |

Rollback is trivial: the pref defaults to `cloud`, so an untouched install behaves exactly as it does
today. `git revert` the two feature commits, or just leave the branch unmerged.
