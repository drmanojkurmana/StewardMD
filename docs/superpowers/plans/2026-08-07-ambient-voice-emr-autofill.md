# Ambient Voice → GHIS Initial Assessment Autofill — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Doctor opens a patient, taps **🎙️ Start Voice Consultation**, speaks (English / Telugu / mixed); a StewardMD **Initial Assessment form that mirrors GHIS** auto-fills in near-real-time; **Save** = local; **Save & sign off** = write into GHIS (the real EMR). No typing.

**EMR TARGET (resolved):** StewardMD has no OPD case-sheet of its own — **the EMR is GHIS**. Target = the GHIS **Initial Assessment** form (`/Doctor/Home/GetInitialAssessmentnew`), which the app ALREADY fetches (`ghis-proxy.js:341`, `functions/api/ghis` `GetInitial`). We build a StewardMD form mirroring it, prefill from that fetch, voice-autofill, save local, and write back to GHIS on sign-off.

**Architecture:** Extend existing pieces — `SMD_VOICE` (on-device Whisper, download-on-first-use), `SMD_NLP` (deterministic findings) + a NEW numeric-vitals/exam extractor, `/api/ai/extract` (LLM only for complex chunks), `ghis-ward.js`/`ghis-proxy.js` (GHIS read; add write). Buildless ES5 IIFE, no new deps.

## SCOPE NOTE — 2026-08-10 (reconciled with `main`)
`main` independently shipped the OPD assessment **form UI** (`opd-emr.js`/`opd-emr.css`) and the GHIS
**write-back** (`saveAssessment` → `/Doctor/Home/CreateinitialAssessmentnew`, real captured field names,
gated `QUEUE_EMR_WRITE=1`) + `getAssessmentForm` read + OPD Queue. To avoid a parallel implementation,
**THIS PR ships only the additive VOICE ENGINE** — `voice-vitals.js`, `voice-emr-map.js`,
`voice-ambient.js`, `assessment-schema.js` (its field vocabulary) + unit tests. The form, the GHIS
proxy write route, the Ward Sync drawer entry and the home tile from the original plan are **dropped**
(covered by `opd-emr.js` + `saveAssessment`). Follow-up: wire `SMD_AMBIENT` to fill `opd-emr.js` and
sign off via the existing `assessment-save` endpoint. Tasks below are the original design record.

## STATUS — 2026-08-10
- **Task 1 DONE + tested** (11 unit): `assessment-schema.js` (66 GHIS fields, validated against both PDFs), `voice-vitals.js` (deterministic numeric-vitals + exam-phrase → GHIS enums, clause-scoped negation, never invents), `voice-emr-map.js` (patient-speech + manual-override safety gate).
- **Task 2 DONE + tested** (6 unit): `voice-ambient.js` — thin controller over `SMD_VOICE.listen(engine:clinical, model:base-q5_1, language:auto)` = Telugu/code-switch multilingual; deterministic-first, throttled LLM escalation only for genuine narrative; offline when no LLM injected.
- **Task 3 DONE + tested** (15 checks, REAL headless Chrome/CDP): `assessment.js` renders the GHIS-mirrored form; scripted voice fills BP/pulse/temp/abdomen/CVS/resp/CNS boxes with source chips; manual edit not overwritten (conflict shown); patient-reported BP dropped. Wired into `index.html`. **← the user's bar (real EMR boxes populating) is met.**
- **Task 4 GHIS write-back — ROUTE DRAFTED + tested (3 unit), fail-closed; only the field map is gated.** `functions/api/ghis/_assessment.js` (config + `buildAssessmentBody` + `parseFormInputs`) + two routes in `[[path]].js`: `POST /save-assessment` (writes via `ghisReq`+CSRF, refuses with `ghis_mapping_not_configured` until configured — the app then keeps the local save), and `GET /assessment-form?patientId=` (returns every GHIS input's name/type/label/options for mapping). Client `GHIS.saveAssessment` already targets it. **Remaining = one live-session step:** call `assessment-form`, paste each input `name` into `_assessment.js` `GHIS_FIELD_MAP`, set `GHIS_SAVE_PATH`. Then sign-off writes for real.
- **Task 2b Android whisper.cpp bridge — GATED on Android NDK build** (device). iOS on-device works today via the existing plugin; ambient already passes the multilingual model. Recipe below.
- **Task 5 on-device Telugu benchmark — GATED on a physical watch/phone + Telugu audio samples.** Text-level extraction (incl. code-switch) is covered by the Task 1/2 suites.

### Task 4 discovery recipe (owner, one-time, live GHIS session)
1. Connect GHIS in the app, then `GET /api/ghis/raw?path=/Doctor/Home/GetInitialAssessmentnew/?id=<MR>` (the passthrough already exists in `ghis-proxy.js`).
2. From that HTML read each field's `name`/`id` and the Submit handler's POST URL (likely `/Doctor/Home/Save…`).
3. Put each `name` into the matching `assessment-schema.js` field's `ghis:`; add a `save-assessment` route: `ghisReq(env, token, 'POST', SAVE_PATH, '__RequestVerificationToken='+csrf+'&'+encoded(map(payload)), {'X-Requested-With':'XMLHttpRequest'})`.
4. Set the form's `onSignOff` to POST the payload to that route. Save (local) already works offline.

## Global Constraints
- Reuse, don't rebuild. Extend `SMD_VOICE`/`SMD_NLP`/`/api/ai/extract`/GHIS proxy. No new ASR stack, no new provider, no bundled model (Whisper stays download-on-first-use; base multilingual ~57 MB). Base app +0 MB.
- Both platforms: on-device Whisper — iOS via the existing whisper.cpp plugin; **Android needs the native whisper.cpp bridge** (build it; do NOT substitute cloud STT). If Android native genuinely can't compile in-scope, document precisely and ship iOS on-device + Android interim = on-device OS STT (audio-on-device), never a paid cloud STT.
- Deterministic-first (BP/pulse/SpO2/temp/RR/exam phrases via regex + `SMD_NLP`); LLM only for complex language; extract ONLY explicitly-stated values; never invent dx/finding/dose/result.
- Never overwrite a field the doctor manually edited this session; conflicts show a lightweight "Voice X vs existing Y" chip. Source/confidence/timestamp tracked; `speaker=doctor|patient|unknown` in the data model (patient-reported never becomes a confirmed finding).
- Offline: Whisper + `SMD_NLP` + local save work with no internet; GHIS sign-off + LLM are online-only. ₹0 recurring STT. Privacy: raw audio on-device, deleted after transcription.

## GHIS Initial Assessment field inventory (from the form; the autofill target)
- **Narrative:** Chief complaints*, Present history*, Past history*; Provisional diagnosis, Management plan, Referred-to & management plan.
- **Vitals\*:** Temperature (°F), BP (sys/dia), Pulse rate (Regular/Irregular + n/min), Respiratory rate (Regular/Irregular + n/min); Nutrition, Hydration; General-exam checkboxes: Pallor/Icterus/Cyanosis/Clubbing/Oedema/Lymphadenopathy/Rash/Goitre; General condition (Fair/Poor/Moribund).
- **CNS:** Level of consciousness (Conscious/Drowsy/Stuporous/Coma), Orientation (Y/N), Cranial nerves, Sensory, Gait, Motor, Speech, Reflexes, Plantars, GCS, Cerebellar, Neck stiffness (Y/N), Kernig's (Y/N).
- **CVS:** Cardiac sounds, JVP, Cardiac murmurs (Y/N), Thrills (Y/N).
- **Respiratory:** Dyspnoea (Y/N), Breath sounds (Vesicular/Tubular/Amphoric), Wheeze (Y/N), Adventitious (Rhonchi/Rales/Pleural rub).
- **Abdomen:** Shape (Scaphoid/Flat/Distended), Tenderness (Y/N+txt), Palpable mass (Y/N+txt), Bowel sounds (Normal/Absent/Exaggerated), Free fluid (Y/N), Liver/Spleen (Palpable/Not), Bruits (Y/N), Hernial orifices, Genital, P/R.
- **Other exam:** MSK, Skin, Breast, ENT, Teeth/oral, Head/neck; Systemic examination (free text); Pain scale (0-10).
- **History blocks:** Co-morbids (DM/HTN/Cardiac/Asthma/TB/Thyroid/Epilepsy/Others, Y/N+details); Immunisation; Personal history (Marital/Children/Consanguinity/Appetite/Bowels/Micturition/Allergies/Habits); Family history; Menstrual/Obstetric/HRT; Nutritional screening (Diet, Height cm, Weight kg, BMI/BSA); Informant + relation.

**Voice-priority subset (MVP fill targets):** Chief complaints, Present/Past history, all Vitals, General-exam checkboxes, CNS LOC/Orientation/Neck-stiffness, CVS sounds/murmurs, Respiratory dyspnoea/breath-sounds/wheeze/adventitious, Abdomen shape/tenderness/bowel-sounds/organs, Systemic examination, Provisional diagnosis + Management plan (only if explicitly stated). History blocks: manual/prefill (rarely dictated).

## Files
- Create: `assessment.js` (StewardMD Initial Assessment form UI mirroring GHIS + local save), `assessment-schema.js` (field ids + types + GHIS mapping), `voice-vitals.js` (deterministic numeric-vitals + exam-phrase extractor), `voice-ambient.js` (streaming controller + consultation UI), `voice-emr-map.js` (entity → assessment field), tests `test/run-voice-vitals.mjs`, `test/run-voice-emr-map.mjs`, `test/run-assessment-schema.mjs`
- Modify: `voice.js` (chunked ambient listen + multilingual/lang-auto), `native-bridge.js` (multilingual model + model manager), `functions/api/ghis/[[path]].js` + `ghis-proxy.js` (add assessment READ-prefill parse + WRITE/sign-off route), `index.html` (script tags)
- Android: `android/app/.../WhisperPlugin` (native whisper.cpp bridge — see Task 2b)

---

### Task 1 — Assessment schema + deterministic vitals/exam extractor (testable core; no ASR)
**Files:** `assessment-schema.js`, `voice-vitals.js`, `voice-emr-map.js`; tests.
- [ ] Schema: encode the GHIS fields above as `{id, type:'text|num|radio|checkbox|select', options?, ghis?}`. Pure data.
- [ ] `voice-vitals.js`: regex extractors → BP `100/60`→{sbp:100,dbp:60}; pulse/HR→num; RR→num; SpO2→num; Temp (°F/°C)→num; Ht/Wt→num; afebrile→temp-status; plus exam phrases → the GHIS enums: "soft, non-tender"→abdomen.tenderness=No; "S1 S2 normal"→cvs.sounds="S1S2 normal", murmurs=No; "bilateral air entry equal"→resp.breathSounds=Vesicular; "no pedal edema"→oedema=off; "conscious, oriented"→cns.loc=Conscious, orientation=Yes; "P/A soft"→abdomen. Each returns `{field,value,source:'doctor_spoken',confidence}`.
- [ ] `voice-emr-map.js`: merge deterministic + `SMD_NLP` finding output → assessment field updates; drop unmapped.
- [ ] **Tests (the PRD examples, transcript→fields):** English + Telugu-English + shorthand + all the Priority-4 clinical phrases; **safety:** "fever and cough"↛pneumonia; "start metformin"→no dose; patient "my BP was 150"↛vitals.bp; manual-edited field not overwritten. `node --test` green.
- [ ] Commit `feat(voice): assessment schema + deterministic vitals/exam extractor + map (GHIS-targeted)`.

### Task 2 — Ambient streaming controller (reuse SMD_VOICE) + Telugu
- [ ] `voice-ambient.js`: chunk→`SMD_VOICE.listen({engine:'clinical',language:'auto',model:multilingual})`→transcript delta→`voice-vitals`+`SMD_NLP` (always)→LLM `/api/ai/extract` only on complex chunks (throttled, opt-out)→emit field updates. Pause/resume/stop/cancel. Offline = deterministic-only.
- [ ] Telugu: base multilingual model + `language:'auto'` + Telugu-augmented `initial_prompt`.
- [ ] Test the pure reducer (scripted transcript → incremental field emissions, dedupe). Commit.

### Task 2b — Android on-device Whisper bridge (native)
- [ ] Inspect the iOS whisper.cpp plugin; build the Android Capacitor plugin wrapping whisper.cpp (NDK/JNI, reuse the same downloaded `base-q5_1` multilingual model + `WHISPER_MODELS`). Expose `Whisper.startTranscribe` matching the iOS contract so `voice.js` works unchanged.
- [ ] If NDK build is out-of-scope this pass: document the exact integration (CMake/whisper.cpp sources, JNI surface) and ship Android interim = existing on-device OS STT (audio-on-device), never cloud STT. Commit.

### Task 3 — StewardMD Initial Assessment form + prefill + local save
- [ ] `assessment.js`: render the form from `assessment-schema.js` in the StewardMD design system; entry from a patient (🎙️ + the form). Prefill from the existing GHIS `GetInitialAssessmentnew` fetch (parse into schema).
- [ ] Voice updates write into this form live (via `voice-emr-map`), conflict-safe + manual-override guard + source chips.
- [ ] **Save** = local (encrypted app storage, existing pattern). Commit.

### Task 4 — GHIS write-back (Save & sign off)
- [ ] Discover the GHIS save endpoint + input names from the live `GetInitialAssessmentnew` form HTML (needs a GHIS session; parse `<input name=…>`). Map schema→GHIS names in `assessment-schema.js` `ghis:`.
- [ ] Add a `ghis-proxy`/`functions/api/ghis` WRITE route (POST the assessment). "Save & sign off" → local save + GHIS POST; handle auth/expiry (reuse `setToken`/refresh). Never lose the local copy if GHIS is down.
- [ ] Commit. (This task is the one gated on a live GHIS session for field-name discovery.)

### Task 5 — Consultation UI + review + safety/benchmark
- [ ] 🎙️ control, 🔴 Listening, timer, detected language, optional transcript, "filled N fields"; accept/edit/reject; save/sign-off.
- [ ] Telugu clinical ASR benchmark on device (base vs tiny; add small multilingual to a **Model Manager** only if base underperforms). Record matrix.
- [ ] Full safety suite green. Commit.

## Deliverable report (fill after build): iOS/Android status · base 57 MB / small optional / +0 MB base app · RAM · latency · Telugu/English/code-switch benchmark · GHIS field coverage · offline · ₹0 STT · privacy · limits · how to activate.

## Success criterion
Doctor opens a patient, taps 🎙️, speaks EN/TE/mixed, sees the GHIS-mirrored Initial Assessment fill (vitals + exam + complaints + dx-if-stated), edits, Saves locally, and Signs off to GHIS. Not a transcript, not a demo.
