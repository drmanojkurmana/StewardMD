# MaiK Ask — AI-Guided Patient History (design)

**Status:** spec / not started · **Flag:** `smd_maik_ask` (default OFF) · **Date:** 2026-08-14

## 1. What this is (and is not)

MaiK Ask is an **extension of the existing MaiK Scribe**, not a new system. After the doctor has
spoken the consultation and MaiK Scribe has documented it, the doctor may tap **"✦ Let MaiK Ask"** to
let MaiK ask the *patient* a few clinically relevant history questions in the patient's own language,
listen to the answers, extract structured findings, and fill the **existing EMR** for the doctor to
review and save.

- It is an AI-assisted **history-taking / documentation** aid. It is **not** a diagnostic or
  treatment agent. It never diagnoses, prescribes, orders investigations, reassures the patient, or
  overrides the doctor. See §9 Safety.
- It **reuses** MaiK Scribe's ASR, the tier/model routing, the Vertex/Gemini seam, `SMD_NLP` /
  deterministic extractors, `VOICE_MAP`, and the `_voiceMerge` doctor-override guard. It creates **no**
  second EMR, recorder, transcription engine, model manager, auth system, or backend.

## 2. What already exists (reuse map — verified in code)

| Capability | Existing artifact | How MaiK Ask reuses it |
|---|---|---|
| On-device ASR + tier routing | `voice.js` `SMD_VOICE.listen({onFinal,…})`, `whisperModel(lang)` (Telugu→specialist, Auto→specialist) | One `listen()` call **per patient answer** (turn-based), not the 15s ambient loop |
| Rolling consult capture | `voice-ambient.js` `SMD_AMBIENT` | Not used for the interview loop (that is turn-based); its structured output *seeds* known info |
| Structured consult state | `opd-emr.js` `st.assessVals` (filled by `doRefine`/`applyVoice`), `st.assessTouched` | Input = "known info"; MaiK Ask only asks for **missing** fields |
| LLM seam (Vertex primary, Gemini dev fallback, `gemini-2.5-flash`) | `functions/api/ai/[[path]].js` (`vertexProvider`/`developerProvider`, `genBody`, `parseJsonLoose`); client `reasoning.js` `SMD_AI.extract(transcript, kind)` | New server `kind`s + a client provider wrapper (§5) |
| Deterministic extraction | `voice-vitals.js` `SMD_VVITALS`, `voice-emr-map.js` `SMD_EMRMAP`, `voice-vitals` number-words | First-pass answer extraction before any LLM call (cost control §8) |
| EMR fill + doctor override | `opd-emr.js` `applyVoice()` → `_voiceMerge(assessVals, assessTouched, updates)` (skips doctor-edited fields), `VOICE_MAP`, `putVoiceDom()` | MaiK Ask findings fold in through the **same** path, tagged `source:"patient_spoken_via_MaiK"` |
| EMR schema (target fields) | `opd-emr.js` `ASSESS_SCHEMA` / `OPD_KIND` (e.g. `Chief_complaints_duration`, `History_present_illness`, `Temp`, `provisional_diagnosis`) | Pathway fields map to these keys via `VOICE_MAP` (extended, additive) |
| App AI gate + auth | `reasoning.js` `aiHeaders()` (X-SMD-App + Firebase bearer) | Reused verbatim; no new auth |

**Not present yet → must add:** a native **TTS** plugin (only `@capacitor-community/speech-recognition`
+ `sqlite` are installed). Use `@capacitor-community/text-to-speech` (wraps iOS `AVSpeechSynthesizer`
/ Android `TextToSpeech`). No cloud TTS.

## 3. Architecture

```
Existing MaiK Scribe  ──►  st.assessVals (known structured history)
                                   │  doctor taps "✦ Let MaiK Ask"  (permission gate §7)
                                   ▼
                          ┌────────────────────┐
                          │  MaiK Ask engine    │  maik-ask.js  (window.SMD_MAIKASK)
                          │  (turn-based loop)   │
                          └────────┬───────────┘
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                            ▼
 Clinical Pathway Engine     MaiKReasoningProvider        SMD_VOICE.listen (ASR)
 (WHAT to ask; §4)           (HOW to word it; §5)         + native TTS (§6)
   pathways/*.json            generateNextQuestion()        speak(question)
   known vs missing           extractPatientAnswer()        listen(answer)
   priority ordering          detectLanguage()
        │                          │                            │
        └──────────────► one natural question ◄─────────────────┘
                                   │  patient answers → ASR text
                                   ▼
              deterministic extract (SMD_VVITALS/EMRMAP) → LLM extract only if needed
                                   ▼
              update interview state · red-flag check (§9) · stop conditions (§10)
                                   ▼
        applyVoice(updates)  →  _voiceMerge (doctor-touched guard)  →  st.assessVals
                                   ▼
                       Review screen → doctor edits → Save (existing flow)
```

**Separation of concerns (mandatory):** the **pathway** decides WHAT must be asked; the **LLM** only
decides HOW to word it in the patient's language. The LLM never invents the interview.

## 4. Clinical Pathway Engine

`clinical-pathways/*.json` — one file per complaint, versioned, human-reviewed. Loaded by
`SMD_PATHWAYS` (new `pathways.js`). The engine is pure/deterministic and testable.

### 4.1 Pathway schema (v1)
```json
{
  "id": "headache", "version": "1.0", "label": "Headache",
  "match": ["headache", "head ache", "తలనొప్పి", "sir dard"],
  "fields": {
    "onset":    { "priority": 2, "emr": "History_present_illness", "ask": "how it started (sudden/gradual)" },
    "duration": { "priority": 2, "emr": "Chief_complaints_duration", "ask": "how long" },
    "location": { "priority": 3, "emr": "History_present_illness", "ask": "one side or both" },
    "character":{ "priority": 3, "emr": "History_present_illness", "ask": "throbbing/tight/etc" },
    "severity": { "priority": 3, "emr": "History_present_illness", "ask": "how severe / 1-10" }
  },
  "associated": {
    "nausea":     { "priority": 4, "emr": "History_present_illness" },
    "vomiting":   { "priority": 4, "emr": "History_present_illness" },
    "photophobia":{ "priority": 5, "emr": "History_present_illness" }
  },
  "redFlags": {
    "thunderclap_onset":     { "ask": "did it start suddenly like a sudden severe pain" },
    "neuro_deficit":         { "ask": "any weakness, numbness, or trouble speaking" },
    "fever_neck_stiffness":  { "ask": "any fever with neck stiffness" }
  },
  "maxQuestions": 7
}
```
`priority` (1 highest → 6 lowest): **1 red flags · 2 required core · 3 required detail · 4 associated
symptoms · 5 relevant negatives · 6 low value.** The engine returns the highest-priority **unknown**
field as the next target. Red-flag probes are interleaved by priority, not diagnosed.

### 4.2 Initial pathways (18, versioned, reviewed before production)
headache, fever, cough, breathlessness, chest_pain, abdominal_pain, vomiting, diarrhea, dysuria,
back_pain, joint_pain, dizziness, weakness_fatigue, palpitations, edema, diabetes_followup,
hypertension_followup, thyroid. Ship a subset first; the rest drop in as JSON with no code change.

> ⚠ **Clinical review gate:** pathway content (esp. red flags) MUST be reviewed by the owner-clinician
> before production. The spec ships the *engine*; pathway JSON is content, versioned separately.

### 4.3 Engine API (pure, Node-testable)
```
SMD_PATHWAYS.match(complaintText, assessVals) -> pathwayId | null
SMD_PATHWAYS.nextTarget(pathway, known)       -> { field, priority, emr, kind:"field|redflag" } | null   // null = complete
SMD_PATHWAYS.isComplete(pathway, known)       -> bool   // required (pri ≤3) sufficiently filled OR maxQuestions hit
SMD_PATHWAYS.knownFrom(assessVals, pathway)   -> { field: value }   // seed from existing Scribe state (no re-asking, §Ctx)
```

## 5. Reasoning provider abstraction

`maik-reasoning.js` — `window.SMD_MAIK_REASON`, a thin interface so the UI + pathway engine never
touch Gemini directly. Phase-1 impl (`GeminiVertexProvider`) calls the existing server via `SMD_AI`.

```
SMD_MAIK_REASON = {
  generateNextQuestion(ctx) -> Promise<{action,question,language,targetField,priority,reason}>
  extractPatientAnswer(ctx, transcript) -> Promise<{findings:[{field,value,confidence}]}>
  detectLanguage(transcript) -> {primary,secondary,style,confidence}   // local first (script detect), LLM only if unsure
}
```
- `generateNextQuestion` and `extractPatientAnswer` POST to **new** server kinds
  `maik-ask-next` / `maik-ask-extract` in `functions/api/ai/[[path]].js` (prompts in a new
  `functions/api/ai/_maik-ask.js`, mirroring `_opd-scribe.js`), through `SMD_AI` (so gate/auth/timeout
  are reused). Future `QwenLocalProvider` swaps in behind the same interface (§ Phase L; **do not add
  Qwen now**).
- `ctx` sent to the server is the **minimum**: complaint, pathway id, `targetField`, the known
  fields already collected, and the patient language profile — **never** the whole consult, never audio.

### 5.1 Structured output contract (validated before execution)
Question response (allowed `action` ∈ `ask | clarify | finish | alert_doctor`, nothing else):
```json
{ "action":"ask",
  "question":"మీకు తలనొప్పి ఒక వైపు మాత్రమే ఉందా, లేక రెండు వైపులా ఉందా?",
  "language":"te-en", "targetField":"location", "priority":"high",
  "reason":"Location has not yet been documented." }
```
Answer-extraction response (only explicitly-stated info; never inferred):
```json
{ "findings":[
   { "field":"location", "value":"right-sided", "confidence":0.96 },
   { "field":"nausea",   "value":"present",     "confidence":0.91 } ] }
```
**Validation (client, before any action):** reject on invalid JSON / unknown `action` / `targetField`
not in the pathway / value type mismatch. On reject: retry once with a constrained re-prompt; if still
invalid, fall back to a **predefined pathway question** for `targetField`. The app never executes raw
LLM text as a clinical action (§9). We add `responseMimeType:"application/json"` to `genBody` for these
kinds to tighten JSON (optional hardening; `parseJsonLoose` + sanitize remain the safety net).

## 6. TTS (native, ₹0)

`@capacitor-community/text-to-speech` → `TextToSpeech.speak({ text, lang })`. Language map:
`te → te-IN`, `hi → hi-IN`, `en → en-IN` (fallback `en-US`). For code-switched questions, speak with
the **dominant** language voice. If the requested voice/lang is unavailable, fall back to any available
local voice, else **display the question on screen** — never crash. iOS `AVSpeechSynthesizer` /
Android `TextToSpeech` under the hood; no cloud, no key. Web build: TTS is a no-op → on-screen only.

## 7. Permission + control (doctor stays in charge)

- MaiK Ask **never** auto-starts. The doctor taps **✦ Let MaiK Ask** (a button in the Voice Consult /
  Assessment panel, shown only when `smd_maik_ask` is on and a complaint is known).
- Compact confirm sheet: *"MaiK will ask a few relevant history questions and add the answers to the
  clinical record."* → **Start** / **Cancel**.
- During the interview: **Pause · Stop · Skip question · Ask manually · Return to consultation**,
  always visible. Stop returns control to the doctor immediately.

## 8. The interview loop (turn-based; cost-controlled)

```
START (complaint known) → load pathway → known = knownFrom(assessVals)  (no re-asking, §Ctx)
loop (guard: asked < maxQuestions, no stop condition):
  target = nextTarget(pathway, known)            # pure/local
  if !target: finish
  q = cachedTemplate(target) OR generateNextQuestion(ctx)   # LLM only when wording needs it (§ cost)
  speak(q) (native TTS)  →  listen() (SMD_VOICE, one answer)  →  transcript
  findings = SMD_VVITALS/SMD_EMRMAP(transcript)             # deterministic FIRST
  if ambiguous/none: findings = extractPatientAnswer(ctx, transcript)   # LLM only if needed
  known ← findings ; applyVoice(updates → _voiceMerge)      # EMR fill, doctor-guard
  redFlagCheck(findings) → maybe alert_doctor + stop (§9)
  if isComplete: finish
finish → Review screen (§ review) → doctor
```
**Cost control (§27/§42):** local ASR + `SMD_NLP` + pathway engine do the work; Gemini/Vertex is called
**only** for (a) natural question wording when no cached template fits, (b) ambiguous answer
extraction, (c) language phrasing help. Cache question templates per `{pathway, field, language}`.
Never call the LLM per audio chunk; send only the minimum delta context. `maxQuestions` default 5–8;
`clarify` capped at 2 attempts then "Unable to capture" → doctor.

## 9. Safety (hard rules)

MaiK Ask **MUST NOT**: diagnose · prescribe · recommend or change treatment · order investigations ·
make clinical decisions · tell the patient they have a disease · reassure about serious symptoms ·
override the doctor. It **ONLY** asks history questions, records answers, structures them, and **alerts
the doctor** to potentially important reported findings.

- **Red flags:** MaiK may *ask* red-flag history questions. If a red flag is reported it does **not**
  diagnose — it stops routine questioning (if appropriate), shows *"⚠ Possible important finding —
  Patient reports sudden severe onset of headache. [Review]"*, and hands to the doctor.
- **LLM failure:** invalid JSON → reject → retry once constrained → else predefined pathway question.
  Arbitrary LLM text is never executed as a clinical action.
- **Doctor override (reuse):** `_voiceMerge` already skips any `assessTouched` field — a MaiK Ask
  finding can **never** silently overwrite a doctor edit; doctor's value wins.
- **Provenance:** MaiK Ask findings are tagged `source:"patient_spoken_via_MaiK"` with `confidence` +
  `timestamp`; they are **never** marked `doctor_confirmed` unless the doctor confirms. (Requires
  extending the update record + `_voiceMerge` to carry a `source` per field — additive, see plan.)

## 10. Stop conditions
required fields sufficiently complete · `maxQuestions` reached · patient repeatedly can't answer (2
clarifications) · doctor stops · possible urgent red flag · patient asks to stop · ASR confidence
unreliable · language not understood. On any stop → return control to the doctor. **Never loop forever.**

## 11. Language
Patient language is **inferred from the consultation** (reuse `voice-diarize`/`detectScript` +
`patientLanguage/languageConfidence/mixedLanguage` profile) — the patient never selects a language.
Supports EN / TE / HI and natural code-switching ("Patient ki three days nundi fever undi"). Only if
confidence is low does MaiK ask *"Would you prefer English, Telugu, or Hindi?"*. Questions are phrased
**naturally** (like a real Indian clinician), **not** literal translations, matching the patient's
code-switch style.

## 12. UI
- **Doctor-side:** an "✦ Let MaiK Ask" button + the confirm sheet + the live interview controls
  (Pause/Stop/Skip/Ask manually), rendered in the existing OPD-EMR overlay (`opd-emr.js`), reusing the
  Voice Consult CSS + the motion system.
- **Patient-facing live card:** large question text (patient's language), "Question N of ~M",
  🔴 Listening indicator, and a persistent **Stop Interview** button. Compact, legible at arm's length.
- **Review screen:** *"MaiK Ask Complete — N questions asked, M fields updated"* + a list of the new
  patient-reported history + **[Review Changes] [Continue Consultation]**. Doctor edits/saves via the
  existing EMR save flow.

## 13. New files (all additive, flag-gated)
```
maik-ask.js               window.SMD_MAIKASK  — the turn-based interview controller + UI
maik-reasoning.js         window.SMD_MAIK_REASON — provider interface + GeminiVertexProvider
pathways.js               window.SMD_PATHWAYS — pure pathway engine
clinical-pathways/*.json  content (versioned, clinician-reviewed): headache, fever, cough, …
functions/api/ai/_maik-ask.js   server prompts + sanitizers for the 2 new kinds
maik-ask.css              patient card + doctor controls (reuses motion.css tokens)
test/maik-ask-pathways.test.mjs, test/maik-ask-extract.test.mjs, test/maik-ask-flow.test.mjs
```
Touched (additive only): `functions/api/ai/[[path]].js` (+2 kinds), `opd-emr.js` (Let-MaiK-Ask button
+ wiring into `applyVoice`), `voice-emr-map.js`/`VOICE_MAP` (+ new pathway→EMR keys), `index.html`
(script/style tags + tokens), `package.json`+cap sync (TTS plugin).

## 14. Test matrix (§39/§40)
Inputs across EN / TE / TE-EN / Hinglish / TE-HI-EN (e.g. "Two days nundi headache hai, right side lo
ekkuva undi"): verify language handling, extraction, next-question selection, **no duplicate question**
(already-known field skipped), correct `targetField`, `source`, `confidence`, and EMR mapping. Plus the
full clinical walkthrough (§40 headache case) end-to-end in the demo harness. **Demo/Test mode** (§38):
scripted patient answers, clearly labelled DEMO, never saved to a real record unless explicitly chosen.

## 15. Success criterion
The full loop works: Doctor → MaiK Scribe → Let MaiK Ask → Patient → local ASR → Gemini/Vertex →
question → native TTS → patient → answer → deterministic/LLM extraction → **existing EMR** → doctor
review → save. The doctor should feel *"MaiK helped me take the history,"* not just transcribe it.
Not "done" until that loop runs (demo mode acceptable for validation before live patient use).

## Open questions (for the owner)
1. **Pathway content sign-off** — who reviews/owns the red-flag lists before production?
2. **TTS in a shared exam room** — speak aloud vs on-screen-only default? (privacy/consent)
3. **`responseMimeType:"application/json"`** on the shared `genBody` — apply only to MaiK-Ask kinds, or
   globally (could affect existing kinds)?
4. **Consent** — does asking the patient directly need a spoken/visible consent line first?
