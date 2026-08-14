# MaiK Ask — overnight build report (2026-08-14)

**What:** AI-guided patient history taking, extending the existing MaiK Scribe. Doctor taps
**"Let MaiK Ask"** → MaiK asks the patient the *missing* history questions in their language, extracts
findings, and fills the **existing EMR** for the doctor to review. Flag-gated `smd_maik_ask` (**default
OFF**); nothing changes until you turn it on. The existing Scribe → SMD_NLP → EMR pipeline is untouched.

Spec + plan: `docs/superpowers/specs/2026-08-14-maik-ask-design.md`, `docs/superpowers/plans/2026-08-14-maik-ask.md`.

## Status: Phases A–K built + tested (L = future benchmark)

| Phase | What | State |
|---|---|---|
| A | Reasoning provider abstraction + safety validators (`maik-reasoning.js`) | ✅ tested |
| B | Clinical pathway engine + headache/fever/cough JSON (`maik-pathways.js`, `clinical-pathways/`) | ✅ tested |
| C | "Let MaiK Ask" button + permission sheet + live patient card (`opd-emr.js`, `maik-ask.js`, `maik-ask.css`) | ✅ |
| D | Gemini/Vertex question + extraction (server kinds `maik-ask-next`/`-extract`) | ✅ **LIVE on main** |
| E | Deterministic-first answer extraction (duration / yes-no / cue words) | ✅ tested |
| F | Native TTS (`@capacitor-community/text-to-speech`, te/hi/en, graceful fallback) | ✅ |
| G | Fold findings into the existing EMR (doctor-override guard, `source:patient_spoken_via_MaiK`) | ✅ tested |
| H | Review screen (asked/updated + list + Review/Continue) | ✅ |
| I | Safety + red-flag handling (alert + stop, never diagnose) | ✅ tested |
| J/K | Multilingual + full-loop demo E2E (spec §40 headache walkthrough) | ✅ tested |
| L | Benchmark Gemini before any local Qwen | ⏳ not started (deliberately) |

**Tests:** 26 MaiK Ask tests (`test/maik-*.mjs`) + 38 existing OPD/voice tests — all green, no regressions.

## The safety contract (enforced + tested)
- **Doctor permission required** — MaiK never auto-starts; a confirm sheet gates it; Stop is always visible.
- **History aid only** — server prompts forbid diagnose/prescribe/advise/reassure; sanitizers whitelist
  `action ∈ {ask,clarify,finish,alert_doctor}` and only pathway-allowed findings. **Raw LLM text is never
  executed** as a clinical action — invalid → retry once → predefined pathway question.
- **Pathway decides WHAT, LLM only HOW** — the clinical pathway engine picks the next question; the LLM
  only words it in the patient's language.
- **Doctor override preserved** — a doctor-edited dedicated field is never overwritten; findings are
  tagged `source:"patient_spoken_via_MaiK"`, never `doctor_confirmed`.
- **Red flags** — a positive red flag STOPS routine questioning and alerts the doctor; it never diagnoses.
- **Privacy** — audio stays on device (existing on-device ASR); only the minimum text/ctx goes to the
  server, never the whole consult.
- **Nothing auto-saves** — findings land in the EMR *draft* for the doctor to review + save via the
  existing flow.

## ⚠ Before real patient use (owner action required)
1. **Clinical review of the pathways** — `clinical-pathways/*.json` are marked `"reviewed": false`. You
   (clinician) must review the question sets + **red-flag lists** for headache/fever/cough before
   production. Everything else ships the *engine*; the JSON is content you own.
2. **Rebuild the app** — client code reaches the phone only after an Xcode Clean Build → Run (the server
   kinds are already live on production).

## How to try it in the morning
1. Enable the flag: in the app console / a dev setting, `localStorage.setItem('smd_maik_ask','1')`.
2. (Optional) demo without a patient: `localStorage.setItem('smd_maik_ask_demo','1')` — scripted answers,
   labelled DEMO, never written to a record.
3. Open a patient → **Assessment** tab → document a complaint (e.g. "headache 2 days") → the
   **"Let MaiK Ask"** button appears → tap it → Start.
4. MaiK asks one question at a time (spoken via native TTS + on screen), listens, fills the EMR draft,
   and shows a review screen. Review → edit → Save via the normal flow.

## Deliberately NOT done (per directive)
- **No Qwen / local LLM** yet (Phase L is a benchmark first). Gemini/Vertex is the Phase-1 reasoning.
- **No second EMR / recorder / model manager / auth** — everything reuses MaiK Scribe infra.

## Follow-ups worth doing next
- Add the remaining 15 pathways (JSON only, no code) after clinical review.
- Optional `responseMimeType:"application/json"` on the MaiK-Ask server kinds for stricter JSON.
- On-device "Ask manually" (doctor types a one-off question) — hook exists in the plan.
