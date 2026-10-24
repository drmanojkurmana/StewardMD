# Kardia: plan v1 (2026-10-25)

Owner request: an echocardiography trainer like echosuite.app but ten times better, in a new module named **Kardia** that also contains **Learn ECG** and **KardiQ X**. Owner decisions (2026-10-25):

| Decision | Choice |
|---|---|
| Echo image source | Simulated live from our own 3D beating heart, plus real CC BY clips as a "compare with a real patient" layer |
| Scope of first release | Full TTE views, POCUS and FAST, pathology library, TEE basics (all four) |
| KardiQ X | Learn ECG and the echo trainer open to all Kardia users; KardiQ X AI reading stays behind its access code until clinical sign-off |
| Audience | Everyone: MBBS, residents and fellows, sonographers (levels inside the module) |

## 1. What EchoSuite does, and where Kardia beats it

EchoSuite: a desktop web page with a 3D chest (skin, ribs, vessels, liver), a probe with depth, rotation, fan, rock and tilt, a target-ghost practice mode, 15 reviewed views and a fixed real cine per view. No pathology, no measurements, no Doppler, no ECG, no sound, no grading beyond plane matching, no phone app.

Kardia does ten things it cannot:
1. **The image is computed, not looked up.** The ultrasound sector is rendered live from the probe plane cutting a beating 3D heart, so every angle (including a bad one) shows what a real probe would show. Foreshortening, off-axis cuts and rib shadows appear exactly as they would on a real probe.
2. **Phone as the probe.** On iPhone and iPad the device's own tilt and rotation (gyroscope) drive the probe, as an option alongside touch controls. Holding the phone becomes holding the probe.
3. **One heart, three signals.** Echo, a 12-lead or monitor ECG and the heart sounds (with phonocardiogram) all run off the same simulated cardiac cycle, so mitral valve closure lines up with S1 and the QRS. When a disease is switched on, all three change together. For example, mitral stenosis gives a large left atrium, a doming mitral valve, an opening snap and AF on the ECG.
4. **Pathology switchboard.** The same heart can be switched to MS, AS, MR, AR, TR, HCM (with SAM), DCM, LV hypertrophy, pericardial effusion and tamponade (diastolic RV collapse), regional wall motion abnormality by coronary territory after MI, ASD, VSD, PDA, tetralogy, pulmonary hypertension (D-shaped septum), LV thrombus, vegetation and aortic dissection flap. Severity is a slider.
5. **Measurements with a known right answer.** Because the model is ours, the true LVEF, LV dimensions, valve areas and gradients are known. The student measures with calipers, Simpson's biplane, LVOT VTI and continuous-wave Doppler, and the app grades the measurement against ground truth with a tolerance. Real clips cannot do this.
6. **Doppler that obeys physics.** Colour flow, pulsed and continuous-wave spectra come from the flow model. The Bernoulli gradient, regurgitant jets, aliasing and angle error behave correctly, and changing the sample volume or angle changes the trace.
7. **Knobology.** Gain, depth, focus, time-gain compensation, frequency and sector width change the simulated image the way they change a real one. Sonographers and residents practise optimising an image, not only finding it.
8. **Graded acquisition.** Each view has a target plane and a quality score: plane distance, angle error, foreshortening and the presence of the landmark structures. A timed "get the A4C in 20 seconds" drill and an exam mode, using the same examiner-marked approach as the new CliniX OSCE.
9. **Protocols, not just views.** POCUS and resuscitation protocols run as timed scenarios: FAST, eFAST, RUSH, BLUE lung, IVC collapsibility, and the 10-second pulse-check echo in cardiac arrest. They link to Code Blue and Narkē, so a Code Blue practice case can call up the echo at the pulse check.
10. **Whole-patient cases.** A case runs history, examination with heart sounds, ECG, echo acquisition and measurement, a structured report, then diagnosis and management. MaiK acts as tutor, and FSRS spaced repetition (the Specialty Engine) schedules each weak view, sign and measurement to come back.

Also: TEE basics (probe in the oesophagus, mid-oesophageal 4-chamber, 2-chamber, long-axis, bicaval, transgastric short-axis), offline use, phone-first with a two-pane iPad layout, and an ASE-style structured report writer that is marked.

## 2. Module layout

New Home tile **Kardia** (replaces the KardiQ X tile). Tabs:

1. **Echo Lab.** Probe Lab: the 3D chest with a TTE or TEE probe, a live sector image, the ECG strip, heart sound playback, knobs, and view targets.
2. **Learn.** Echo lessons (views, anatomy, measurements, Doppler, each pathology) plus Learn ECG (the existing 1,041-lesson KardiQ X atlas, moved under Kardia unchanged).
3. **Practice.** View drills, measurement drills, Doppler drills, knobology drills, POCUS protocols, ECG drills, spot diagnosis (real CC BY clips and simulated).
4. **Cases.** Whole-patient cases with the structured report.
5. **KardiQ X** (AI ECG reading). Visible but behind the existing access code `SMD_XACCESS.gate("kardiox")` until clinical sign-off. Unchanged otherwise.

Levels (Specialty Engine pattern): **MBBS** (views, normal anatomy, obvious pathology, ECG basics), **Resident** (measurements, Doppler, grading, POCUS protocols, TEE basics), **Fellow** (full ASE quantification, diastolic function, valve area by PISA and continuity), **Sonographer** (acquisition quality, knobology, protocol order, report). The user picks a level; content and drills filter by it.

## 3. Architecture

- **Host:** a Specialty Engine host (`specialty-shell.js`, `SPECIALTY.createHost`) for Learn, the question bank, clinics, FSRS, notes and levels. Echo Lab and the simulators register as `registerSim` and `registerExplorer`. This is the same engine as Tokós, so most screens already exist.
- **Echo simulator (new):** `kardia-sim-heart.js` (cardiac cycle model), `kardia-sim-geom.js` (meshes and deformation), `kardia-sim-us.js` (ultrasound renderer), `kardia-sim-doppler.js`, `kardia-sim-probe.js` (touch and gyroscope probe), `kardia-sim-measure.js` (calipers, Simpson, VTI, ground-truth grading). ES5 IIFEs, WebGL 1, no three.js, matching `atlas3d.js` (whose loader, picking and context-restore code is reused).
- **Heart geometry:** BodyParts3D 4.0 heart and great-vessel meshes (CC BY 4.0, already in `atlas/3d`, 91 cardiac parts), plus chest wall, ribs, lungs and liver for acoustic windows and shadows.
  - The static meshes are rigged with a cycle-driven deformation (chamber volumes from the cycle model, valve leaflets as hinged surfaces).
  - Where BodyParts3D lacks a part (leaflet detail, chordae), parametric geometry is built.
- **Ultrasound rendering:** cut the deformed meshes with the probe's fan plane in a shader. Tissue echogenicity comes from per-structure acoustic properties: blood dark, myocardium mid-grey, pericardium and valves bright, calcium very bright with shadowing. Then apply speckle (Rayleigh noise advected with tissue so it moves with the wall), depth attenuation, TGC and gain, lateral resolution blur by depth, rib and lung shadowing along beam lines, and reverberation. Target 30 fps on an iPhone 12-class device.
- **Cycle model:** one clock drives a time-varying elastance model of the four chambers and valves, which produces volumes, pressures, flows and valve timing. ECG timing comes from the same clock:
  - `codeblue-ecg.js` and `kardiox-ecgwave.js` generate the ECG.
  - The heart sounds and phonocardiogram reuse the CliniX audio engine (`clinix-audio.js`: synthesized models plus the recorded set).
- **Pathology:** each disease is a parameter set (geometry, elastance, valve area or regurgitant orifice, shunt, effusion volume, wall-motion map by segment) plus its ECG and sound changes, authored as data in `kardia/pathology/*.json` and validated by a test.
- **Real clips:** only CC BY, CC0 or public domain, each with a credit line. They live in `kardia/media/` with `credits.json`, served from R2 like the RadioAnatome 3D chunks (content-hashed names).
- **Content:** `kardia/learn/*` (lessons), `kardia/decks/*` (drills and MCQs), `kardia/cases/*`, `kardia/views.json` (view definitions: target plane, landmarks, tolerances, level).

## 4. Data sources (only what can legally ship in a paid app)

| Source | What | Licence | Status |
|---|---|---|---|
| BodyParts3D 4.0 (Human Atlas package) | heart, vessels, chest wall meshes | CC BY 4.0 | in repo already |
| PTB-XL (PhysioNet) | real 12-lead ECGs for Learn and drills | CC BY 4.0 | verify version, then import |
| CAMEO (Cardiac Multi-View Echo) | real echo images, 9 standard views | listed as CC BY 4.0 | verify licence and whether it has video |
| CirCor DigiScope (PhysioNet) | real heart sounds | verify | check before use |
| Owner heart-sound recordings | already in CliniX | owner-supplied, provenance pending | in app |
| ASE 2019 TTE guideline, ASE and EACVI chamber quantification, BSE minimum dataset | view definitions, normal values, measurement method | facts only, cited, own words | reference |
| EchoNet-Dynamic, EchoNet-Pediatric, EchoNet-LVH | echo video | Stanford research use agreement, non-commercial | **cannot ship** |
| EchoXFlow | echo beamspace | CC BY-NC-SA | **cannot ship** |
| CAMUS, HMC-QU | echo sequences | no clear licence | do not ship unless written permission |
| MIMIC-IV-ECHO | echo video | PhysioNet credentialed | **cannot ship** |

"All the data is open source" holds for meshes, ECGs and guidelines. Most echo video is not open for commercial use, which is why the simulated heart is the core and real clips are only a supplement.

## 5. Work packages

| WP | Work | Worker | Depends on |
|---|---|---|---|
| 0 | This plan, view catalogue (`views.json`: ~25 TTE, 8 TEE, 10 POCUS views with planes, landmarks, tolerances), pathology catalogue, licence check of PTB-XL, CAMEO, CirCor | lead + agy | |
| 1 | Cycle model (elastance, valves, flows, timing) with unit tests against textbook pressure-volume loops and timings | muse wonder | 0 |
| 2 | Heart geometry: BodyParts3D cardiac meshes extracted, rigged, deformed by the cycle; parametric valves | muse wonder + lead | 1 |
| 3 | Ultrasound renderer (cut, echogenicity, speckle, attenuation, shadows, knobs) at 30 fps on phone | muse wonder | 2 |
| 4 | Probe: touch controls (slide, rotate, tilt, rock, fan), gyroscope mode, TTE windows, TEE probe path | muse spark | 2 |
| 5 | Doppler: colour, PW, CW from the flow model; Bernoulli; aliasing | muse wonder | 1, 3 |
| 6 | Measurement lab with ground-truth grading | muse spark | 3, 5 |
| 7 | Pathology library: 20 parameter sets with ECG and sound changes | agy (data) + muse spark (hooks) | 1, 2 |
| 8 | Kardia host on the Specialty Engine; KardiQ X and Learn ECG moved in; Home tile swap; access gate kept on AI reading | lead + muse spark | |
| 9 | Learn content: echo lessons per view, measurement, Doppler topic and pathology (4 levels), MCQ bank, drills | agy in batches (as CliniX tier 1/2) | 0 |
| 10 | Practice: view acquisition drill and exam, knobology drills, POCUS protocols (FAST, eFAST, RUSH, BLUE, IVC, arrest pulse check) with Code Blue and Narkē links | muse spark | 3, 4, 6 |
| 11 | Cases: 30 whole-patient cases (history, sounds, ECG, echo, report, management); structured report marker | agy (data) + lead | 7, 9 |
| 12 | Real CC BY clips layer with credits, R2 hosting | lead | 0 licence check |
| 13 | QA: unit tests per engine, headless WebGL runner (SwiftShader, like `run-atlas3d-ui.mjs`) at 390/820/1194, frame-rate check on a real phone, independent fact-check of every number against the cited guideline | lead + agy | all |
| 14 | Delivery: behind flag `smd_kardia` (default off for everyone except testers), one PR per WP, owner review, then OTA | lead | 13 |

## 6. Phases

- **Phase 1 (core, about 4 to 5 days of worker time):** WP 0 to 4 and 8. A beating normal heart, the live sector image for the main TTE views, touch probe, view targets and quality score, and the Kardia shell containing Learn ECG and gated KardiQ X. This is already beyond EchoSuite (computed image, phone, ECG in sync).
- **Phase 2:** WP 5 to 7 and 10. Doppler, measurements with grading, pathology library, drills, POCUS protocols, gyroscope probe.
- **Phase 3:** WP 9, 11, 12. TEE basics, full Learn content for all four levels, cases with report writing, real CC BY clips.
- **Phase 4:** WP 13 to 14, clinical review, OTA.

## 7. Validation gates

1. Cycle model: ejection fraction, stroke volume, pressures and valve timings within normal ranges for the normal heart and within published ranges for each pathology (unit tests, numbers cited).
2. View catalogue: every view reachable from its window, and its target plane shows its required landmarks (automated test sweeps the probe).
3. Renderer: 30 fps or better on an iPhone 12-class device and the iPad mini 6; no WebGL context loss crash (restore path tested).
4. Measurements: each drill's ground truth computed from the model and checked by a test; the grading tolerance matches the guideline's reproducibility.
5. Doppler: Bernoulli gradients and aliasing verified numerically.
6. Content: British spelling, no em or en dashes, every number cited, `ai_drafted` until the owner (or a cardiologist) reviews; the existing KardiQ X gate untouched.
7. Licences: every real clip and recording has a credit and a licence that allows commercial use, recorded in `kardia/media/credits.json`; non-commercial datasets never enter the repo.

## 8. Risks

- **Realism of the simulated image:** a simulator can look synthetic. Mitigation: per-structure acoustic properties, speckle moving with tissue, side-by-side comparison with real CC BY clips in review, owner sign-off on screenshots before phase 2.
- **Phone performance:** WebGL in the WebView. Mitigation: low-poly cardiac meshes (atlas3d LOD path), renderer resolution scaling, frame budget test.
- **Clinical accuracy of numbers:** guideline-sourced, cited, verified by a second model, owner review.
- **Scope:** four scopes in one module is large. Phases ship independently behind the flag.
- **Worker quotas:** muse and agy limits hit during the CliniX run. The queue runner retries and work packages are independent.

## 9. Owner decisions (2026-10-25)

1. **Pro lock:** Kardia is Pro. A free preview of about 5 to 10 percent: a few Echo Lab views and lessons, and a few Learn ECG lessons. Everything else is Pro.
2. **Home tile:** Kardia replaces the KardiQ X tile; KardiQ X becomes a tab inside Kardia, still code-gated.
3. **Gyroscope probe:** opt-in toggle ("Use phone as probe"); touch controls by default.
4. **Start:** plan only for now; building starts after the owner reviews this plan.

Still open: who reviews the echo content clinically (owner, or a cardiologist the owner names).
