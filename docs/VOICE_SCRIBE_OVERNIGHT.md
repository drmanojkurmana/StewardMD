# MaiK Scribe / Voice Consult — overnight work report

Branch: **`feat/voice-tiers`** (recovery tag `pre-voice-tiers-20260812` at the prior main HEAD).
Everything below is committed. Nothing is on `main` / deployed yet.

---

## ⚠️ READ FIRST — one thing blocks the Telugu→English fix from working in your app

The translation fix (Telugu/Hindi speech → **English** in GHIS + MaiK) is **server-side**
(`functions/api/ai/`). Your phone calls the **live `stewardmd.in` API**, so:

- **Client changes** (the UI, capture, routing) reach the app when you **rebuild in Xcode**.
- **Server changes** (the translation prompts + the new `translate` endpoint) only take effect
  after the **`functions/` are deployed to production** (push to `main` → Cloudflare Pages).

So after you rebuild, the app will *look* right but **EMR will still fill in Telugu until the
functions are deployed.** Tell me "deploy the functions" and I'll cherry-pick just the
`functions/api/ai/*` changes to `main` and push (or you do it). I did **not** auto-deploy —
production is behind the coming-soon gate and it's your call.

---

## What I fixed / built tonight

### 1. Safety: Telugu/Hindi was filling the EMR in native script and misguiding MaiK
- `_opd-scribe.js` + `_assessment-extract.js` prompts now **force clinical English output**
  (translate faithfully; keep drug/dose/unit/abbrev exact; never emit Telugu/Devanagari).
- New `/api/ai/extract` **`kind:"translate"`** + `SMD_AI.translate()` — the **field-dictation mic**
  now translates non-English dictation to English before it touches a GHIS field.
- Both ambient LLM extractors now translate; `assessLLM` was trimmed to only `provisionalDx`/
  `managementPlan` so it no longer races the opd-scribe refine over the same narrative fields.

### 2. The "nothing gets transcribed" bug (very likely the root cause)
`voice-ambient.js`: the 15-second chunk timer started **immediately**, before the model finished
downloading (tier models are 252–547 MB; first-use download > 15 s). The timer aborted the
recording mid-download and orphaned the session so the loop never re-armed. **Fixed:** the window
timer now starts only once the engine reports it is actually *recording*, with a fallback for
engines that don't emit a state, and it defers while a download is in flight.

### 3. Other confirmed bugs (from two code-review passes)
- **Pause** now actually stops the mic (was recording up to a full chunk after you tapped pause).
- On **Stop**, if the last chunk errors instead of finalizing, the final AI note-draft still runs.
- The **field-dictation mic is disabled while the Voice Consult is running** (they shared one global
  capture session and killed each other — tapping a field mic mid-consult broke both).
- **Accept** on a MaiK diagnosis now force-applies (it was silently no-op'ing when you'd typed in
  the field, while still showing "Added").

### 4. Models & routing
- **Tiers** (Base / Pro / Ultimate) with StewardVoice-branded names (no Whisper/quant names shown).
- **Auto mode is now adaptive**: it detects each 15 s chunk's script and routes the next chunk's
  model — **Telugu → the specialist**, Hindi/English → turbo/multilingual — instead of locking to one
  weak multilingual model (that's why "Telugu sucked in Auto").
- A **live model chip** in the panel shows exactly which model is transcribing (SV-Telugu / SV-Ultra…).
- All 3 tier model files hosted + verified on `models.stewardmd.in` (SHA + byte-length matched); the
  Telugu specialist was converted from the benchmark winner (te WER 14.7%).

### 5. UI/UX
- **Voice Consult** panel: dark cyan instrument look, breathing mic orb, **live transcript box**
  (streams each 15 s chunk), Stitch-style listening pill (dot · LISTENING · timer · lang · pause/stop),
  a **"Finishing your dictation…" processing state** (spinner + shimmer) after Stop.
- **Recording disclaimer / consent**: on-device privacy note ("processed on this phone only, never
  recorded/saved/sent to cloud; tell the patient") in the idle state + a compact tag while listening.
- **Ask MaiK** button de-uglified (was a muddy rainbow wash) — clean AI badge + readable text.
- MaiK suggestions no longer auto-pop after a consult — surfaced on demand via Ask MaiK.

### 6. Tests
- New `test/voice-lang-route.test.mjs` (script→language routing); updated `opd-voice` render test.
- Full voice suite green (47 tests). `detectScript`, `accumulate`, `whisperModel` tiering all covered.

Diagnostics (`[SV-amb]` / `[SV-native]` console traces) are still in the build so you can confirm the
capture path on-device; say the word and I'll strip them before merge.

---

## Your action items (in order)
1. **Rebuild** `feat/voice-tiers` in Xcode (⌘R) → the UI + capture fixes go live on the phone.
2. **Deploy the functions** (say "deploy functions") → the Telugu→English EMR fix goes live.
3. **Test**: Voice Consult → **తె** → speak ~20 s → confirm the transcript streams and English fills
   the fields; then Ask MaiK. Send the `[SV-…]` console if anything's still off.

---

## Personal-clinic mode (local EMR + Google Drive sync) — plan, not yet built

Requested: clinics without a hospital EMR get the **same assessment template**, saved **locally on the
phone**, syncable to **Google Drive**. Scoping it so it's built right rather than half-shipped:

- **Reuse the template**: `ASSESS_SCHEMA` in `opd-emr.js` is already the form; a `source: "local"`
  alongside the existing GHIS/Connect sources keeps the whole overlay + Voice Consult unchanged.
- **Local store**: `@capacitor/preferences` (already a dependency) or the Filesystem plugin — one
  JSON record per patient/consult, plus a patient index. No server, fully offline.
- **"Save" for local mode**: writes the assessment JSON locally instead of POSTing to GHIS; the same
  Voice Consult + MaiK flow feeds it.
- **Google Drive sync**: needs an **owner infra step** — a Google Cloud OAuth client + Drive API +
  consent screen (app folder scope `drive.file`). Once those creds exist, the client uploads the
  local JSON (and a PDF export) to a `StewardMD/` Drive folder and pulls on another device.
- **Deliverable split**: local-EMR mode is a self-contained module I can build + unit-test; Drive
  sync is gated on the OAuth creds. Give me the go-ahead + a Google OAuth client and I'll build both.

This is a genuinely new module (new files, a mode switch, a local store) — I've left it as a plan
rather than shipping it untested tonight. Say "build personal clinic" and I'll start it.
