# Code Blue v2 spec (StewardMD)

Goal: bring StewardMD Code Blue (Apple Watch + Wear OS + phone) to feature parity with the CodeTick app (CPR/BLS/ACLS code timer, Megacode practice, ECG rhythm course) while keeping what we already do better (watch-motion compression rate, patient-record link, ward integration).

## Hard rules (every job)
- It is a timer, reminder, documentation and practice aid. It never diagnoses a rhythm, never interprets a patient ECG, never confirms a pulse, never decides treatment, never CALCULATES doses. Show this disclaimer wherever the feature is entered: "Timer, reminder, documentation and practice aid only. Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol."
- Drug doses: v3 owner override (2026-10-18): adult reference dose text is allowed on the adult drug buttons only (see DESIGN.md v3). Paediatric and neonatal: no doses. Never calculate a dose.
- Guideline basis: AHA 2020 ACLS/PALS/NRP plus 2025 AHA update where you are certain; where guidelines differ from ERC/Indian Resuscitation Council say nothing rather than guess. When unsure of a clinical fact, leave it out and list it in your final report under UNSURE.
- Training mode is always labelled TRAINING, runs on a sped-up clock, and never writes to a patient record.
- No emojis, no em-dashes in any user-visible text. British spelling for new strings (paediatric, oesophageal).
- No real patient ECGs or images. Rhythm graphics are drawn procedurally and labelled "schematic".
- Never weaken, skip or delete existing tests. Never edit security-scan, CI workflows or wrangler.toml.
- Commit your work on your branch (do not push, do not open a PR; the lead does that). Commit message ends with:
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Final message: what you built, files, how you verified (exact commands and pass counts), what you could NOT verify, UNSURE list.

## Shared domain model (Swift and Kotlin must match behaviour, and the JS code sheet must read the same payload)

CodeMode: adult | paediatric | neonatal.
Config per mode:
- rhythm check interval: adult 120 s, paediatric 120 s, neonatal 60 s (heart-rate check).
- compression:ventilation labels: adult "30:2 (100 to 120 per min)", paediatric "15:2 with two rescuers, 30:2 alone", neonatal "3:1 (90 compressions and 30 breaths per min)". With an advanced airway (adult/paediatric): continuous compressions, 1 breath every 6 s.
- epinephrine interval reminder: due 180 s after the last epinephrine, overdue 300 s after it (3 to 5 min rule), all modes. Before the first dose the guide prompt says when it is indicated (see AlgorithmGuide), the countdown starts when the first dose is logged.

CodeEventKind (existing: cprStart, shock, drug, pauseStart, resume, switchCompressor, rosc, cprEnd, rhythm). ADD, additive and backward compatible (old JSON must still decode): procedure, reArrest, note, modeSet. CodeEvent gains `edited: Bool` (default false; absent in old JSON decodes as false) and `deleted` is NOT stored: deletion removes the event.
Procedure labels (fixed vocabulary): "IV access", "IO access", "Advanced airway", "ETCO2 on", "Pads on", "Central line", "Arterial line". Free text goes in `note`.

Rhythm labels (fixed): "VF", "VT (pulseless)", "PEA", "Asystole", "Sinus rhythm (pulse)", "Bradycardia (pulse)", "Tachycardia (pulse)".

AlgorithmGuide (pure, text only). Input: mode, last logged rhythm, shockCount, epinephrine count, seconds since last epinephrine, rosc. Output: ordered list of prompts {id, text, urgency: info|due|overdue}. Four tracks:
1. Cardiac arrest. Shockable (VF, pulseless VT): shock, CPR 2 min (neonatal: as per NRP, 60 s), after 2nd shock epinephrine, after 3rd shock amiodarone (or lidocaine), treat reversible causes (Hs and Ts list). Non-shockable (PEA, asystole): epinephrine as soon as possible, CPR 2 min cycles, reversible causes. Paediatric: shock energy and dosing are NOT shown. Neonatal: ventilation first; compressions start if heart rate below 60 after 30 s of effective ventilation; then 3:1.
2. Bradycardia with a pulse (adult and paediatric): assess for poor perfusion, support airway and oxygen, monitor, atropine/pacing/infusion considered, paediatric: compressions if heart rate below 60 with poor perfusion despite oxygenation and ventilation. Prompts only.
3. Tachycardia with a pulse: stable vs unstable, narrow vs wide, regular vs irregular branches; unstable: synchronised cardioversion; stable narrow regular: vagal manoeuvres then adenosine; stable wide: expert consultation. Prompts only.
4. Post-ROSC.
Each prompt cites its source as a short string ("AHA 2020 adult cardiac arrest algorithm").

Post-ROSC checklist (adult/paediatric): secure airway and titrate oxygen to SpO2 92 to 98 percent; ventilate to normal CO2; avoid hypotension (systolic at least 90, MAP at least 65 in adults); 12-lead ECG; blood glucose; temperature control (avoid fever); find and treat the cause (Hs and Ts); neuro assessment; transfer to ICU. Neonatal: post-resuscitation care (monitor, glucose, temperature, consider therapeutic hypothermia criteria, parental communication). Items are ticked in order or freely; each tick logs a note event.

Re-arrest: one action after ROSC. Clears rosc, appends reArrest, starts a new CPR cycle at the same mode, epinephrine timer continues from the last dose.

Resume: session snapshot (Codable) {version, mode, startedAtWallClock, elapsedAtSave, events, adrenalineCount, shockCount, rosc, checklistTicks, savedAtWallClock}. Saved on every event and at most every 5 s on tick. restore(now): if now - savedAt > 6 h discard; else elapsed = elapsedAtSave + (now - savedAt) while running. UI offers "Resume code in progress?" with Resume and Discard.

Editable log: edit an event label, delete an event, undo last delete; counts (epinephrine, shocks) are recomputed from the event list after any edit. Events keep their elapsed time.

Code sheet payload (JSON, same on all platforms): {"v":2,"mode":"adult","startedAt":"ISO-8601","durationSeconds":N,"cycles":N,"events":[{"id","elapsed","kind","label","edited"}],"summary":{"compressions":N,"averageRateCPM":N,"compressionFractionPct":N,"targetRatePct":N,"shockCount":N,"adrenalineCount":N,"rosc":bool},"disclaimer":"..."}. Plain-text rendering is the shared fallback.

Existing disclaimer in summary: "Motion-based estimates, not a measure of CPR quality or depth." Keep.
