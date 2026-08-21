# Handoff — MaiK Cloud outage (2026-08-21) + Android on-device vision

Written for the next agent picking this up. Everything below was measured on a Pixel 9 over CDP or
against production, not inferred. Where something is unverified it says so.

`origin/main` at handoff: **`81ebe720`**

---

## 1. The outage — RESOLVED, but read this before touching `functions/api/ai/`

**Symptom:** MaiK Cloud answered nothing. Users saw only *"MaiK took too long to respond — the
knowledge search may be busy. Tap to retry"*. That string is the client's 90 s watchdog
(`home.js`, `MAIK_TO_MS`), **not** a diagnosis — it appears for any stall and sent me looking in the
wrong place first.

**Real cause:** `POST /api/ai/explain` returned HTTP 500 `{"error":"server_error"}` in ~10 s.

Commit `6064c197` had deployed the *server half* of the MaiK scope work by **hand-copying
`functions/api/ai/[[path]].js` from a feature branch onto main**. The branch was cut before three later
main commits touched that same file, so the copy silently reverted all three:

| Reverted commit | What was lost |
| --- | --- |
| `9fb283ed` | `AI_PROVIDER` default, and the provider order's failover. Prod sets `AI_PROVIDER=developer`; the reverted code made that `["developer"]` **alone** instead of `["developer","vertex"]`. |
| `3068a6a0` | Vertex location `asia-south1` (Mumbai) → `us-central1`. |
| `44b12612` | The detailed-depth `MAIK_MAX_OUTPUT_TOKENS_DETAILED` cap and the `MAIK_LIVE_STREAM` gate. |

So the primary provider failed and had nothing to fail over to → 500.

**Fix** (`3267ffc0`): rebuilt the file from `6064c197^` (main's own version) and re-applied ONLY the two
changes that deploy existed for — `firewallBlock()` using `MaiKScope.isRefusable()`, and `MEDICAL_ONLY`
appended to the four clinician-facing prompts. Verified the diff against main's pre-deploy version
contained nothing else.

### Rules this bought

1. **Never deploy a subset of a branch by copying whole files onto main.** Cherry-pick hunks, or
   `git diff main..branch -- <file>` first and read what you are **REMOVING**. Then prove it:
   `git show <target>:<file> > /tmp/x && diff /tmp/x <file>`.
2. **`/api/ai/health` is evidence, not reassurance.** It was already reporting
   `fallback_available:false, fallback_provider:null` before I started debugging — that named the bug
   and I read past it. Read every field.
3. **Confirm a Cloudflare Pages deploy landed by polling a NEW field** the deploy introduces (here
   `ai_provider_env`), never by elapsed time. It took ~4 min.

---

## 2. The second fault — the app cached the failure

**This is the part that matters most, because it made a correct server fix look like no fix at all.**

With production verified answering 200, MaiK on the device still hung to the watchdog. Isolation:

| Call | Result |
| --- | --- |
| raw `fetch('/api/ai/explain')` from inside the app, same headers (incl. `X-SMD-Device`) + body | **200 in 9–15 s** |
| `SMD_AI.explainGrounded(...)` | **never settled** — its internal 35 s `raceTimeout` never even fired |
| `SMD_AI.explain(...)` | never settled |
| `SMD_AI.status()` | 876 ms ✓ |
| `SMD_AI.refine(...)` | 7.98 s ✓ |

Only the endpoint that had been 500ing was affected. The WebView held poisoned state for it.

**Fix — preserves login AND the ~2.5 GB on-device models. Do NOT uninstall (that wipes both):**

```bash
adb shell am force-stop in.stewardmd.app
adb shell 'run-as in.stewardmd.app rm -rf /data/data/in.stewardmd.app/cache/* \
  /data/data/in.stewardmd.app/app_webview/Default/Cache'
```

Immediately after: `explainGrounded` 14.1 s / 2920 chars, and the real UI rendered a full grounded TB
answer with page citations (p.1386, p.1389).

**Generalise it:** after any server-error window, tell users to clear app cache (Android) or reinstall
(iOS). "The server is fixed" does not fix a client that cached the failure.

**Also:** MaiK **persists failed exchanges** (`maikSaveThread`), so the old error bubble redraws every
time the sheet opens and reads as a live failure long after it isn't. Clear
`localStorage` keys matching `smd_maik_thread*` when testing.

**Red herring, so you don't repeat it:** the served `reasoning.js` was 462,646 bytes vs 464,234 in the
APK assets. That difference was NOT the bug and cost real time.

---

## 3. Android on-device vision — BUILT, NOT PROVEN

`81ebe720`. Android had no image reading at all; iOS already did (`LlamaVision.swift`).

- `llama_jni.cpp` → `generateWithImage`: mtmd projector load, bitmap decode, marker tokenise,
  `mtmd_helper_eval_chunks` into the SAME `llama_context`, then the shared sampler/decode loop.
- `CMakeLists.txt` → `add_subdirectory(llama-cpp/tools/mtmd)`. Needed explicitly because
  `LLAMA_BUILD_TOOLS` is OFF. **Do not flip `BUILD_SHARED_LIBS`** — the comment in that file explains
  the ggml `.so` name collision with capacitor-whisper.
- `LlamaEngine.generateWithImage` mirrors `generate()`. The media marker must go **inside the user turn
  BEFORE** `applyChatTemplate` — after templating it lands outside the turn markers and the model reads
  it as literal text.

Verified in the shipped APK rather than assumed: `classes12.dex` carries `generateWithImage` +
`mediaMarker`; `libllama_jni.so` (52.0 → 70.3 MB) exports `Java_..._generateWithImage`,
`_mediaMarker`, `_setThermalStatus`.

**NOT VERIFIED: the image answer itself has never run on a device.** The open question it was meant to
settle — whether MedGemma 4B produces an *Interpretation* section rather than transcribing the image —
is still open. A test image is ready at
`/data/data/in.stewardmd.app/files/lab-na118.png`: a synthetic lab report with **Na 118, serum osm 248,
urine Na 62, urine osm 480, normal TSH/cortisol** (a clean SIADH picture). A transcribing model lists
numbers; an interpreting one names severe hypotonic hyponatremia. The MedGemma Q4_K_M model
(2,489,894,976 B) and its projector (851,252,224 B) are already on the device at
`/sdcard/Android/data/in.stewardmd.app/files/maik-models/`.

### Capacitor gotcha found the hard way

**`@PluginMethod` is positional.** Inserting `generateWithImage` between the existing `@PluginMethod`
and `generate()` moved the annotation onto a *field*, so `generate()` was silently unregistered. It
compiles clean and fails at runtime. After editing any plugin class:

```bash
grep -n "@PluginMethod" -A2 LlamaPlugin.java | grep "public void"
```

All 11 methods must be listed.

---

## 4. Memory pre-flight — the number means different things per platform

A 2.5 GB model on a phone with nothing free does not fail cleanly: it load/evict cycles (Android) or
gets jetsam-killed (iOS), and both present to the clinician as the app hanging forever. So we ask
before loading — but the first version of that check **would have refused a phone that works**:

- **iOS** reports `os_proc_available_memory()` — a HARD jetsam ceiling. Requiring 1.15× the weights is
  correct there.
- **Android** reports `availMem` (free + reclaimable) and llama.cpp **mmaps** the GGUF, so a 2.5 GB
  model genuinely runs with well under 2.5 GB "available", just slower.

Each plugin now returns `memoryIsHardLimit`; the soft path only refuses where thrashing is certain
(`0.35`), calibrated on two real measurements: **176 MB free / 2.83 GB model hung forever**, and
**2.1 GB / 2.49 GB runs**. The check also **fails open** — failing to *measure* must never become a
reason not to *answer* — and the refusal is a sentence with both numbers plus a next step, never a raw
code. 8 tests in `test/maik-local.test.mjs`.

While there: that test file's summary `console.log` sat mid-file, so 17 assertions ran but were never
counted. 84 → 109 passing. Worth checking other `test/*.test.mjs` for the same shape.

---

## 5. Android debugging environment — budget for this

These two cost most of a night. Neither is a code bug.

1. **Doze fakes every hang.** A Pixel on wireless adb dozes within minutes even with
   `screen_off_timeout=1800000`; `svc power stayon true` does not hold on a non-charging wireless link.
   While dozed the WebView stops delivering timers, fetch callbacks **and Capacitor bridge
   resolutions** — so `Llama.load()`, `available()` and downloads all appear to hang forever with 0%
   CPU, an idle main thread, no crash and no ANR. It looks exactly like a native deadlock and is not.
   Keep a background `adb shell input keyevent KEYCODE_WAKEUP` loop running, and check
   `dumpsys power | grep mWakefulness` before believing any hang.
2. **logcat silently drops this app's lines** for long stretches while other tags keep flowing.
   Absence of a log line is NOT evidence the code did not run — prove it with `/proc/<pid>/stat` CPU
   ticks and `VmRSS`.

Prefer **USB** over wireless adb; wireless dropped repeatedly. With both connected, pin the target:
`export ANDROID_SERIAL=<usb-serial>` or adb refuses with "more than one device".

---

## 6. Immediate next steps

1. **Run the image test.** Load `maik-mxcore`, attach `lab-na118.png`, ask *"Read this report and tell
   me what it means."* Judge: does it interpret (severe hypotonic hyponatremia / SIADH) or merely
   transcribe? That decides whether `SYSTEM_IMAGE` needs more work.
2. **Tell anyone who hit the outage to clear app cache / reinstall.** Their client may still be
   holding the cached failure.
3. **Sweep for the same partial-deploy hazard** in the other files `6064c197` hand-copied:
   `functions/_experimental.js`, `_followcare.js`, `_onco_store.js`, `kb/ai/maik-scope.js`. I checked
   their removals and they looked like intended edits, but I did not diff them as rigorously as the AI
   endpoint.
4. `onco-p2` fails 3 tests on main. Pre-existing, verified by stashing — not from this work.
