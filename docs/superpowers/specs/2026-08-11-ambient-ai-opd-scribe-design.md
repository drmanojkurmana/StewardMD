# Ambient AI OPD Scribe ("AI OPD Doctor") — Design Spec

**Date:** 2026-08-11
**Status:** Approved for planning

## Goal
In the OPD Assessment tab, the doctor taps **Voice Consultation** and conducts the visit normally
(English / Telugu / mixed). The app records the whole conversation in **rolling 15-second chunks**,
transcribes each **on-device** (multilingual), accumulates the transcript, **fills the existing GHIS
assessment fields live** (vitals + examination deterministically), and at the end runs one **LLM
"refine" pass over the full transcript** that produces:
1. **EMR autofill** (review-first): chief complaint, history of present illness, past history, comorbids.
2. An **AI suggestions panel** (separate, labelled, never auto-written): **provisional diagnosis +
   differential (DD) + investigations**, grounded on StewardMD's own clinical engine/KB where possible.

The doctor reviews, edits, accepts, and saves. Nothing auto-commits.

## Context — extends, does not rebuild
This builds on shipped pieces: `SMD_VOICE` (on-device Whisper, multilingual — Telugu shipped in #643),
`SMD_AMBIENT` (voice-ambient.js chunk controller), `SMD_VVITALS` + `SMD_EMRMAP` (deterministic
vitals/exam extractor + safety gate), `opd-emr.js` (the real GHIS assessment form + `VOICE_MAP` +
`assessLLM`), `/api/ai/extract` (`assessment` kind), and StewardMD's clinical reasoning engine
(`reasoning.js` findingCatalog/differential, `SMD_NLP`) + KB investigations.

## Decisions (locked with the owner)
- **D1 — AI suggestions: suggest-only, review-first, grounded.** Dx/DD/investigations appear in a
  SEPARATE, clearly-labelled panel; never auto-written into the EMR; doctor taps each to accept.
  Grounded on the StewardMD DX engine / KB where possible, LLM elsewhere. (Respects R1/FollowCare:
  "decision support, not a diagnosis".)
- **D2 — Capture: rolling 15s chunks + accumulate + end/periodic LLM refine.** Continuous recording;
  every ~15s a chunk is cut and transcribed on-device; the transcript accumulates; the LLM refine
  pass runs over the FULL accumulated transcript (on stop, and optionally every N chunks).
- **D3 — Attribution: content-based (LLM infers doctor vs patient).** No acoustic diarization. The
  LLM classifies by clinical content: patient-reported complaints/history → History (tagged
  "patient-reported"); the clinician's measured vitals + stated exam findings → Vitals/Exam. Anything
  ambiguous is flagged for review, never auto-confirmed.
- **D4 — Language: multilingual on-device Whisper** (`base-q5_1`), `language` = auto/te/en (shipped #643).

## Architecture & data flow
```
mic (continuous)
  → 15s chunk  → on-device Whisper (multilingual)  → transcript delta
       │                                                  │
       │                                                  ├─► DETERMINISTIC (per chunk, no LLM, offline):
       │                                                  │     SMD_VVITALS + SMD_NLP → vitals/exam
       │                                                  │     → SMD_EMRMAP (safety gate) → opd-emr VOICE_MAP
       │                                                  │     → live EMR field fill (review-first)
       │                                                  └─► accumulate into full transcript
  → (on STOP, and every N chunks): LLM REFINE over the FULL transcript
       → { emrFields:{cc,hpi,past,comorbs...}, suggestions:{ provisionalDx, ddx[], investigations[] } }
       → EMR narrative fields fill (review-first) + AI SUGGESTIONS PANEL (accept-each)
  → doctor reviews / edits / accepts → Save (local) / Save & sign off (GHIS)
```

### Grounding (D1)
The `ddx` + `investigations` are grounded, not raw LLM guesses, where possible:
1. `SMD_NLP.extract(transcript)` → canonical findings (present, review-first).
2. Feed findings to the existing DX reasoning (`reasoning.js` / `DX.findingCatalog` + differential) →
   a ranked differential the app already computes deterministically.
3. Map differential → suggested investigations from the KB (`kb/` disease → investigations) + calculators.
4. The LLM adds phrasing + fills gaps the deterministic layer can't (e.g. narrative HPI, an explicitly
   stated provisional Dx), but the DDx list is anchored to the engine's output. The LLM never invents
   a diagnosis not supported by stated findings; provisionalDx is emitted ONLY if the clinician stated it.

## Components (files)
- **`voice-ambient.js`** (extend `SMD_AMBIENT`): rolling 15s chunk cadence + transcript accumulation
  + end/periodic LLM-refine trigger. Pure helpers stay unit-testable (accumulate/needsRefine reducers).
- **`local-plugins/capacitor-whisper`** (native): continuous **segmented capture** — record without
  gaps while emitting ~15s windows for transcription. See "Open decision" below.
- **`functions/api/ai/_opd-scribe.js`** (pure, testable) + **`/api/ai/extract` `opd-scribe` kind**:
  prompt + `sanitizeScribeOutput()` whitelisting output to `{emrFields{…}, suggestions{provisionalDx,
  ddx[], investigations[]}}` — strings/arrays only, capped, no injected keys, no invented dose/finding.
- **`voice-scribe-ground.js`** (pure, testable): findings → differential + investigations adapter
  reusing `SMD_NLP` + the DX engine + KB; merges with the LLM suggestions, dedupes, ranks.
- **`opd-emr.js`**: the **AI Suggestions panel** (Dx/DD/investigations, confidence, accept-each into
  the assessment/orders) + consultation UI (start/pause/stop/cancel, elapsed timer, language toggle
  [shipped], detected-language, optional live transcript, "filled N fields · N suggestions") + the
  existing live EMR fill.

## Safety (R1 clinical / FollowCare / DPDP)
- AI Dx/DD/investigations are **suggestions only**, in a labelled panel, **never** written to the EMR
  without an explicit doctor tap. UI copy: "AI decision support — review before use. Not a diagnosis."
- Deterministic vitals/exam remain review-first + manual-override protected (`SMD_EMRMAP`); a
  doctor-edited field is never overwritten.
- **Patient-reported → History (tagged), never a confirmed finding or a measured vital.** ("my BP is
  150" never fills the measured BP.)
- **Never invent** a diagnosis, symptom, finding, dose, or investigation not supported by the transcript.
- Privacy: raw audio stays on-device and is discarded after transcription; only the **text transcript**
  goes to the LLM refine pass (same posture as today's `assessment` kind). No "DPDP compliant" claim;
  designed to support it (consent, minimisation, retention follow existing EMR policy).
- Offline: capture + deterministic vitals/exam fill work with no network; the LLM refine + AI
  suggestions require connectivity (degrade cleanly to "suggestions unavailable offline").

## Error handling
- Whisper/model unavailable → clear "download the multilingual model" / "on-device voice unavailable"
  (no silent English fallback for a Telugu consult).
- LLM refine failure/timeout → deterministic EMR fill still stands; suggestions panel shows "couldn't
  generate — retry"; never blocks saving.
- 15-min cap: hard stop + final refine at 15 min (configurable); memory-bounded by chunking.

## Testing
- **Unit:** chunk accumulation + needsRefine reducer (voice-ambient); `sanitizeScribeOutput`
  (whitelist, no injected keys, no invented dose, arrays capped); grounding adapter (findings →
  DD/investigations, dedupe/rank); the PRD transcripts (EN, Telugu-EN, mixed) → expected EMR fields;
  hallucination-resistance ("fever+cough" ↛ pneumonia unless stated; "start metformin" → no dose;
  patient "my BP 150" ↛ measured BP).
- **CDP (real browser):** suggestions panel renders, accept-into-EMR works, live deterministic fill,
  review-first + manual-override intact.
- **Device-gated (documented, owner runs):** rolling 15s on-device capture; Telugu clinical ASR
  accuracy benchmark; latency/RAM on a mid-range Android + iPhone.

## Open decision (surface in the plan, not blocking the rest)
**Continuous 15s capture mechanism** — today's Whisper plugin is record→stop→transcribe (one shot):
- (a) **Native ring-buffer** continuous capture emitting 15s windows (best quality, no gaps; most native work, iOS + Android).
- (b) **JS re-arm** every 15s (simplest; small audio gap at each boundary; no native change).
- (c) **Hybrid**: native continuous record with a 15s "flush" callback (moderate native work).
Recommendation: start with (b) to ship the pipeline end-to-end, then upgrade to (a)/(c) if boundary
gaps hurt accuracy. The rest of the feature (extraction, grounding, suggestions, UI) is independent
of this choice.

## Success criterion
Doctor opens a patient's OPD Assessment, taps Voice Consultation, speaks EN/Telugu/mixed with the
patient for a real visit; the assessment fills (history + vitals + exam) live and review-first; at the
end an AI panel proposes a grounded provisional Dx + differential + investigations to accept or reject;
the doctor edits and saves. On-device, ₹0 STT, patient data safe, existing app unbroken.

## Out of scope (this iteration)
Acoustic diarization; auto-committing Dx/investigations; prescribing from voice (server-hard-blocked);
non-OPD surfaces; a standalone transcript archive beyond the EMR record.
