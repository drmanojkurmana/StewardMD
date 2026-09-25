---
tags: [roadmap]
---
# Roadmap

Pending / deferred, by area. `- [ ]` so Obsidian renders checkboxes (Tasks/Dataview can query them).

## App-store release
- [ ] Install a **release Xcode** (beta was removed) → rebuild + install iPhone (scan-fix client bits, [[Scan-Meds and Drug Index]])
- [ ] iOS TestFlight archive (Product ▸ Archive; needs Apple ID at archive time). See `docs/PRODUCTION-RELEASE-RUNBOOK.md` C.1
- [ ] Android: Play Developer API service-account key → `node scripts/play-upload.mjs` one-command uploads
- [ ] Enable Firebase **App Check** (console + native) once a TestFlight/release build shows verified tokens
- [ ] Cloudflare WAF / Bot Fight / rate-limit (dashboard)

## Install size (on-demand assets) — see [[Decisions]]
- [x] MediaPipe / [[FundX]] stripped (~22 MB) → gold1048
- [ ] ONNX runtime ([[KardiQ X]]) → remote (~11 MB, flag-gated)
- [ ] KardiQ X Learn images/content → remote (~8 MB, non-clinical; needs `onerror` fallback)
- [ ] ML Kit face detector → Google **downloadable** model (~8 MB/device)
- [ ] offline clinical KB → download on first launch (biggest ~46 MB; touches offline-first core)

## [[AI Control Center]]
- [ ] X-ray ([[ThoreX]]) daily cap — cap belongs at the IMAGE-analysis entry (on-device), not the text `thorex/llm`
- [ ] Per-endpoint precise per-module token cost (currently counts requests, rough cost)

## Modules
- [ ] **[[RadioAnatome 3D]] device run** — browser-verified only (SwiftShader). Run on the iPhone + Pixel:
      load time over cellular for the LOD default (~12 MB of the 19.6 MB LOD set for the default systems, from R2),
      frame rate with muscles ON, pinch/pan feel, the living-CT cut plane + slice slider.
- [ ] **[[RadioAnatome]] living-torso images are NOT in radiological orientation** — the three
      `ct-live-torso-*` modules display the patient's right on the image's right (liver at column 205/277
      of the displayed coronal slab; `orient.to_display` keeps X unflipped for this RAS volume). Pins are
      unaffected and no side is asserted, but a radiologist expects the liver on the image LEFT. Decide with
      the owner: mirror the images + pins (re-run the pipeline) or label the convention. Found 2026-09-06
      while registering the 3D cut planes; the Visible Human modules should be checked the same way.
- [ ] **[[RadioAnatome 3D]] R2 upload in CI** — chunks are pushed to `stewardmd-models/atlas3d/` by hand
      (`wrangler r2 object put`) after each pipeline run; a Pages/Actions step should diff `manifest.json` sha256s.
- [ ] **[[RadioAnatome 3D]] sheet drag** — reuse/extract atlas.js `bindSheetDrag` so the 3D sheet resizes by swipe (today: tap the handle).
- [ ] **[[RadioAnatome 3D]] coverage** — 7 canonical structures have no BodyParts3D counterpart
      (cerebellar cortex/WM, corona radiata, nucleus accumbens, paranasal sinus, subarachnoid space,
      vertebral canal). LIVER/LUNG/lobes/HEART are now real surfaces on the living-CT body (torso only);
      the brain/head structures would need a second living subject (e.g. the OpenNeuro MRI + SynthSeg masks).
- [ ] **[[SURGX]] clinical sign-off** — 8 authored protocols, 13 engine overlays, 5 procedures,
      3 cases and 15 evidence records are all `ai_drafted`. Flip `review.status` per item after
      review, then set `smd_surgx_draft` to 0. This is the ONLY thing between the module and use.
- [ ] **[[SURGX]] media sourcing** — 3 uncleared entries in `surgx/media/manifest.json`, each with a
      work order. One (`abscess-deloculation`) is authorable in-house as an inline SVG.
- [ ] [[SURGX]] voice → note: `SMD_VOICE` target + the `/extract` kind `surgx-note` are built and
      tested but not wired to a mic. Per-SECTION mic, not one global one (the opd-emr PR #648 rule).
- [ ] [[SURGX]] Senior Surgeon Mode: `surgx_case` bucket + `mode:"surgx-mentor"` remap exist;
      `MENTOR_SYS` still to be written. Cases are fully playable without it.
- [ ] Missing surgical calculators for `calculators.js` (NOT for SURGX): POSSUM / P-POSSUM,
      Clavien-Dindo, Tokyo Guidelines grading, LRINEC, Boey, Mannheim Peritonitis Index.
- [x] Apply SURGX's `?v=<contentVersion>` content-fetch fix to [[CliniX]] — done 2026-08-26.
      `clinix-content.js` now fetches the manifest `no-store` and everything else with
      `?v=<contentVersion>`; pinned by `test/clinix-content-version.test.mjs`.
- [ ] **[[CliniX]] clinical sign-off** — content is `ai_drafted` and the review gate hides ALL of it
      from students. Flip `review.status` to `approved` per skill after review. This is the ONLY
      thing between the module and student testing.
- [ ] **[[CliniX]] media sourcing** — 10 uncleared entries in `clinix/media/manifest.json`, each with
      what is needed and where to look. Openly-licensed or permitted embeds only; the 3 that render
      today are self-authored diagrams.
- [ ] [[CliniX]] decide whether the exam-vocabulary firewall widening should apply app-wide (it would
      fix the two-token clarify trap for doctors typing "JVP" too, not just students)
- [ ] [[ICU]] v2 redesign deploy (rules+indexes, emulator + 2-device test); alert-safety push
- [ ] [[KardiQ X]] photo-dx pivot (image-based model) — ≤$35 GPU-VM overnight build
- [ ] [[Medical Knowledge Base]] — Obsidian → build pipeline for clinical content; dx-mgmt enrichment merge
- [ ] [[FollowCare]] owner TODOs (clinician thresholds, translations, R2 bind, WhatsApp BSP)
- [ ] [[RxChoice]] Phase 2 — pharmacy availability + live prices (MRP is a list price today), patient
      selection (`smd_rxchoice_patient_selection`), refill savings. Also: per-brand strength is only
      recoverable from the brand NAME for most combination rows, so a `strength_mg` column on `drugs`
      would let RxChoice match combinations on the composition instead of on naming convention.

## [[Medical Core]] — blocked on data and people, not on code

Phase 1 (deterministic: patient state, what changed, missing information, unit and freshness checks)
is BUILT behind `smd_medcore`, default OFF, with the four ML hazards in the executable safety case.
Steps 12 onward of `vault/modules/Medical Core.md` cannot start until these exist. They are NOT
engineering tasks.

- [ ] **A dataset.** Retrospective ICU/ward data from a named hospital, under a written agreement,
      de-identified before it leaves the hospital boundary. Nothing from step 13 on can begin
      without it, and no amount of engineering substitutes for it.
- [ ] **Ethics / institutional approval** for the retrospective analysis, and a named data custodian.
- [ ] **A clinician to own the label definitions.** `medcore/data/outcomes.json` has five outcomes
      written so they can be argued with; each needs its risk-set entry rule, exclusions and
      censoring confirmed by the Critical Care lead before any labelling.
- [ ] **An adjudication process.** At least 200 positives and 200 near-misses per outcome reviewed,
      with inter-rater agreement reported in the dataset card.
- [ ] **A named approver** who can move anything from VERIFIED (software) to CLINICALLY APPROVED.
      Nothing in Medical Core has that status and nothing in the repo can grant it.
- [ ] Clinical sign-off on the three unapproved packs: `units.json` (conversion factors and
      plausibility bounds), `freshness.json` (staleness windows), `change-bands.json` (what size of
      change is worth a clinician's attention).

- [x] The missing **CAM-ICU** calculator in `calculators.js` — added 2026-09-19 (Ely, JAMA 2001;
      SCCM PADIS 2018). Distinct from the general CAM (Inouye 1990) already under Neurology, which
      needs a patient who can be interviewed. Test: `test/camicu.test.mjs`.

## [[WardSynQ]] — blocked on people, not on code

Recorded 2026-09-05 after the notification chain was completed and demonstrated on a device. These
are NOT engineering tasks and should not be picked up as if they were.

- [ ] **Resuscitation committee: approve the escalation policy** — response windows and responder
      tiers. This is the sole remaining blocker on HAZ-DET-01. The chain is built and demonstrated on
      hardware; the policy it carries is unapproved seed content.
- [ ] **Clinical sign-off on every threshold pack** — MEOWS cut-offs (obstetric lead), PEWS bands
      (paediatric lead), critical-result limits including paediatric ranges, interaction/allergy/dose
      packs (pharmacy). ZERO of 16 hazards have sign-off today.
- [ ] Carry a REAL patient's escalation end to end. The 2026-09-05 demonstration used `DEMO-PAT-1`.
- [ ] A pager/SMS/phone vendor, if the ward wants a channel that reaches somebody not already at a
      screen. Mobile push is shipped and proven; the ladder below it is not.

Engineering that is deliberately NOT started:
- [ ] **CTG / fetal monitoring** — a large separate hazard under HAZ-MAT-01. Needs clinical scoping
      before a line is written; an unapproved implementation here would be worse than none.
- [ ] Service worker for the WardSynQ surfaces; barcode hardware; replace the secops content digest
      with real asymmetric signing.

## Security / ops
- [ ] Rotate: Mac pw, admin token (done?), 2Factor, Green-API, GHIS, Resend, keystore; move+rotate the Firebase-admin JSON out of ~/Downloads
- [ ] Gemini model migration before 2027-01-28 (env-swappable)

## MaiK Local/Cloud policy (added 2026-09-11, PR #1072)
- [ ] Remove the `smd_maik_hard_local="0"` recovery switch in maik-engine.js after one release in production (it restores the pre-2026-09-11 cloud fall-through; a recovery switch that survives becomes a mode)
- [ ] Native `totalMemory` + `freeDisk` in capacitor-llama available() (Android StatFs/MemoryInfo.totalMem, iOS physicalMemory/volumeAvailableCapacityForImportantUsage); the JS already reads both
- [ ] Run test/run-local-translate-eval.mjs against MAiK Horizon (Gemma 4 E2B) and fill CAPS.lang only from a passing run

## On-device engine concurrency (2026-09-11, from a real consult)
- [ ] The 4B packs take tens of seconds per structured pass on an iPhone 15 Pro. Measure Scribe refine latency on device and consider raising refineEveryChunks (or drafting only on Stop) for packs above ~2 GB
- [ ] MedGemma 4B returned prose instead of JSON for a Telugu Scribe dictation in at least one run; measure the JSON-adherence rate per pack and record it as a caps.json score rather than the current 0/1/2 guess

- **Bonsai 2 27B (PrismML, 2026-09-17):** needs PrismML's llama.cpp fork (PTQ1_0/PQ2_0 + Hadamard runtime); mainline b10502 in `capacitor-llama` rejects the files. Adopt by moving the plugin to the fork (iOS xcframework + Android submodule) or when mainline carries the types. See Decisions 2026-09-19.

## MaiK Scribe quota accounting (2026-09-19, server side landed)
- [x] **opd-emr.js sends `sec`** on the opd-scribe refine — `scribeSendPrep` -> `scribeSec()`, the delta
      since the last refine actually SENT (test/opd-emr-scribe-sec.test.mjs). The server's 45s-per-call
      floor now only applies to a caller that omits it.
- [ ] `assessment` (assessLLM) currently charges 0 because it re-reads the same ambient audio the
      opd-scribe refine already charged. If it ever runs standalone, it must send its own `sec`.
- [ ] No client reads the new `contradictions` array in the opd-scribe response yet.

## Universal Search phase 2 (added 2026-09-21)
- [ ] Scheme Search provider (`/api/schemes/search`), CliniX/SURGX content providers (manifest is lazy; needs a cached title index), OPD/ICU patient jump (PHI review first).

## Every branch, wave 2: needs the server (owner's ticked list, 2026-09-25)
Wave 1 is built and ON: [[Specialty Kits]] (26), [[Clinical Documents]], [[Review Desk]], source watch.
Wave 2 is **built and ON** since 2026-09-25 ([[Colleagues]]): B1 referral, B2 case room, B3 handover sync,
B7 hospital kit versions, E3/E4 kit history, F1 review sync. Native users get it with the next build.
Follow-ups: an in-app badge for new items; a per-uid push token directory instead of
the token scan; unit-level (not per-doctor) history if hospitals ask for it.
Not ticked (owner left them out): B4 audit dashboard, B5 case library.
Also pending on people, not code: clinical review of all ai_drafted content (use the Review Desk),
native-speaker check of the Telugu and Hindi consent forms and handouts.
