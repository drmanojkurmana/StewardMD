---
tags: [plan, ai, needle]
status: proposal
---
# Needle x StewardMD: flagship features (CTO proposal)

Companion to [[Needle-Audit]]. Every feature follows the same rule: **Needle turns speech or text into
an action; deterministic SMD code decides; the clinician confirms.** Needle never produces a dose, a
score or a diagnosis. All features assume an SMD fine-tune that passes the Phase 1 gate in the audit.

## The category: Clinical Action Model

LLMs answer. StewardMD would be the first clinical app that **acts**: 36 MB, offline, under a second,
on a phone or a watch, with no cloud call and no PHI leaving the device. Pitch line:
"The only clinical app you can run by voice, offline, on a Rs 6,000 phone and a watch."

## 1. Code Blue Black Box
Voice-logged resuscitation. Nobody touches a screen during a code; the record writes itself.
- "Adrenaline given", "shock 200", "VF", "ROSC" become `logDrug` / `logShock(energyJ:)` /
  `logRhythm` / `logROSC` (`CodeBlueLiveModel.swift:108-116`) with the existing closed choices from
  `CommandCenterView.swift` (Epinephrine/Amiodarone/Other, 150/200/360 J). Name only, never a dose.
- Deterministic timers speak back: "adrenaline due in 40 seconds", "rhythm check in 20".
- Post-code: auto-built Utstein-style timeline plus a debrief (drug intervals, pause lengths).
- Runs on the watch: `watchos-arm64/libneedle.a` (1.1 MB). Offline.
- Same engine, a product line: Sepsis Hour-1 (`SepsisTimerView.swift`: "cultures sent", "lactate
  sent", "30 ml/kg started"), stroke door-to-needle, STEMI door-to-balloon, WHO surgical checklist.
- Why only Needle: always-on, sub-second, closed set, works in a basement resus bay with no signal.

## 2. Live Score Radar
Scores assemble themselves while the doctor talks.
- The ambient scribe already chunks audio every 15 s (`voice-ambient.js tick()`). Split each chunk
  into sentences, run Needle per sentence into a `ClinicalFacts` record, validate (bounds, units,
  label adjacency, negation), merge with `voice-vitals.js`.
- A computability engine walks `MEDCALC._calcs` (446 calculators, 1,913 inputs) and lights up every
  score whose inputs are now complete: CURB-65, qSOFA, NEWS2, Wells, CHA2DS2-VASc, CrCl. Each
  criterion shows the sentence it came from. Pattern already exists in `icu-autoscores.js`.
- Why only Needle: the LLM refine runs every 45 s on the whole transcript and is cloud; Needle works
  per sentence, locally, continuously. It fails on long text but is built for short text.

## 3. Silent Safety Net
The same live facts are cross-checked against the Rx pad before print.
- Spoken "creatinine 2.8" plus metformin on the pad: renal flag via `SMD_SAFETY.renalDoseFor`.
- Spoken "penicillin allergic" plus amoxicillin: hard stop via `scribe-safety.check`.
- Spoken "on warfarin" plus clarithromycin: `INTERACTIONS.checkInteractions`.
- Needle only supplies facts. Rules decide. The doctor never typed anything.

## 4. Answer-as-you-type
Spotlight for medicine. Needle WASM runs on each debounced keystroke in Universal Search.
- Type "crcl 72f 58 1.4": "CrCl 38 mL/min" appears as ghost text before Enter.
- Type "vanc 70kg crcl 40": dose rows from `SMD_DOSECALC.engine.compute`.
- Fixes `search.js calcsProvider`, which today matches nothing for numeric queries.

## 5. Round Mode: speak the ward round
Needle emits multiple calls in order, so one sentence becomes an ordered order-set.
- "Bed 12: stop ceftriaxone, start pip-taz 4.5 six hourly, repeat CBC tomorrow, get an echo" becomes
  four DRAFT items on bed 12. WardSynQ already caps AI writes at DRAFT (`wardsynq-actors.js`).
- The resident sees a checklist per bed, confirms each, and handover pre-fills.
- Stop/start pairs feed medication reconciliation as proposals, never decisions.

## 6. Say-it Logbook (NMC PG logbook)
Every PG in India must log procedures. Nobody does it on time.
- "Did two central lines and an ICD today, supervised by Dr Rao" becomes pglog entries with
  competency codes from the closed catalog (`pglog-quick.js templatesFor/suggestions`,
  `pglog-curriculum.js`).
- Closed catalog, short sentences, English: the best Needle fit in the whole app. A resident-market
  wedge on its own.

## 7. Offline OSCE Examiner
Students narrate their exam aloud; Needle maps each utterance to the station checklist.
- "Inspecting the precordium", "palpating the apex, 5th space mid-clavicular": items tick live
  (`clinix-examiner.js`, `clinix-content.js`). Score and missed steps at the end. Works in a hostel
  with no Wi-Fi. Replaces full-Gemini viva calls for checklist stations.

## 8. PHI Shield (the surprise)
Needle was trained on contacts, bookings, phone numbers, addresses and dates. Those are exactly the
patient identifiers.
- A `redact` extraction tool pulls name, phone, address and date spans on device before any Gemini
  call, layered on top of `phi-india.js` (which handles Aadhaar/ABHA/phone patterns but not free-text
  names).
- Fails closed: if either layer flags, the span is masked. Recall must be measured before relying on it.

## 9. Natural-language follow-up
Date grounding is Needle's most engineered area (`date:` system fact, relative dates, year checks).
- "Review next Tuesday with fasting sugar", "call her in 3 days if fever persists" become real dates
  and a reason, feeding FollowCare scheduling and the queue. Fixes the missing follow-up field.

## 10. Wrist-only doctor
Raise to speak on the watch: "Wells, heart rate 110, prior DVT". Score on the wrist, no phone, no
network. Uses the existing watch Calculators view plus the watchOS engine.

## 11. Sterile Mode (OT / SURGX)
Gloved surgeon dictates short lines: "drain placed right flank", "blood loss 200". Needle maps each
to a SURGX note field (closed set), replacing a cloud call for field placement. Encrypted notes stay
device-local as today.

## 12. Every screen gets a voice (the moat)
A build step, not a feature. CI exports tool schemas from `MEDCALC._calcs`, the 83 `ws-*` syndromes,
the 15 specialty-kit tools and insulin modes; generates synthetic data; fine-tunes on the Cactus
platform (synthetic only, no PHI); ships the new `.cact` as a model download. Ship a calculator, get
its voice and natural-language interface for free. Competitors must rebuild this per feature.

## 13. MaiK Mini for the next 500 million phones
3 to 4 GB Android, zero internet: Needle plus engines plus KB plus Whisper tiny, about 70 MB of models.
Today these phones get cloud or nothing. This is the India-scale distribution story.

## 14. Edge boxes
Needle ships linux-armv7/mipsel/riscv engines. A Rs 4,000 board behind the OPD display
(`opd-display.html`): "token 23 to room 4" by voice, offline.

## Investor demo (90 seconds)
1. Airplane mode on. Say "crcl 72 female 58 kilo creat 1.4": answer in under a second.
2. Ambient consult: speak "BP 88 by 50, RR 32, confused, 78 years": CURB-65 5/5 lights up with quotes.
3. Say "start amoxicillin" after "penicillin allergy": safety net fires before print.
4. Watch: "adrenaline given", "shock 200", "ROSC": the code record prints itself.
5. Show the phone: 36 MB model, nothing sent to the network.

## Build order
1. Phase 0 from the audit (parser unification, calculator prefill). Needed by everything.
2. Answer-as-you-type + Live Score Radar (WASM, OTA, flag `smd_needle`): biggest demo per effort.
3. Code Blue Black Box + Sepsis Hour-1 (native, watch).
4. Say-it Logbook + OSCE Examiner (market wedges).
5. Round Mode, PHI Shield, the build-time compiler.

## Honest limits
English only (tokenizer has no Devanagari/Telugu). Base model fails clinical input; every feature
waits on the fine-tune gate. Needle never refuses on MaiK's behalf and never writes without a tap.
