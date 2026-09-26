# StewardMD — MAIK Scribe OPD EMR Population

## What This Is

StewardMD is an offline-first clinical decision support, surgical intelligence, and hospital rounding platform. This milestone focuses on **MAIK Scribe in OPD**: ensuring whole doctor-patient consultations are faithfully extracted and populated into the exact corresponding EMR initial assessment columns and forms (Chief Complaints, History of Present Illness, Past History, Vitals, General Examination, Systemic Examination, and Co-morbidities like Diabetes & Hypertension).

## Core Value

Every clinically meaningful finding spoken during an OPD consultation—symptoms, chronological history, vital signs, physical exam findings, and chronic disease history—is reliably populated into its exact EMR assessment field without clinical hallucination or dropped context.

## Requirements

### Active

- [ ] **Comprehensive EMR Extraction Schema**: Expand `functions/api/ai/_opd-scribe.js` and `maik-local.js` to extract and whitelist all EMR assessment categories:
  - Complaints & History (`cc`, `presentHx`, `pastHx`)
  - Vitals (`temp`, `bpSys`, `bpDia`, `pulse`, `rr`, `heightCm`, `weightKg`)
  - Co-morbidities & details (`dm`, `dmDetails`, `htn`, `htnDetails`, `cardiac`, `asthma`, `tb`, `thyroid`, `epilepsy`)
  - Physical Examination (`pallor`, `icterus`, `cyanosis`, `clubbing`, `oedema`, `lymphadenopathy`, `rash`, `goitre`, `systemicExam`, `cardiacSounds`, `breathSounds`, `tenderness`, `abdoMass`)
  - Habits & Lifestyle (`habits`, `alcohol`, `alcoholDetail`, `smoking`, `tobacco`, `recDrug`)
- [ ] **EMR Wire Mapping (`VOICE_MAP` & `_voiceMerge`)**: Map the newly extracted keys in `opd-emr.js` to their wire names (`Diabetes_yesNo`, `Diabetes_details`, `Hypertension_yesNo`, `Hypertension_details`, `BP_SYS`, `BP_dia`, etc.).
- [ ] **Dual-Pass Extraction Pipeline**:
  - Live First-Pass: Real-time deterministic vitals/exam extraction during dictation via `voice-vitals.js`.
  - Final Refine Pass: Full-consultation LLM synthesis on Stop/Refine that translates code-switched narrative into clear English, extracts the full clinical timeline, and preserves clinical numbers.
- [ ] **Live DOM Synchronization**: Ensure `_applyRefine` updates both `st.assessVals` and the live DOM elements so the doctor immediately sees the assessment fields populated upon stopping the scribe.
- [ ] **Safety & Audit Gates**: Maintain doctor-override protection (never overwrite a doctor-edited field), patient-speech safety gating, and zero clinical hallucination.

### Out of Scope

- Modifying the underlying Whisper ASR speech recognition model.
- Changing GHIS server API schemas.

## Context

- `assessment-schema.js` defines the GHIS Initial Assessment form fields.
- `opd-emr.js` renders the OPD consultation interface and handles `_voiceMerge` and `_applyRefine`.
- `functions/api/ai/_opd-scribe.js` (cloud) and `maik-local.js` (on-device) handle the scribe extraction prompts.
- `voice-vitals.js` handles real-time regex extraction of vitals and examination cues.

---
*Last updated: 2026-09-11*
