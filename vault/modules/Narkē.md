# Narkē (Anaesthesia)

- **What:** Anaesthesia learning module for MBBS and residents, the second host on the [[Specialty Engine]] after [[Tokós]].
- **Plan:** `docs/superpowers/plans/2026-10-06-narke-anaesthesia-master-plan.md` (46 NMC AS competencies, 2018 Vol III).
- **Flag:** `smd_narke` (kill switch "0") and `?narke=0`. Home tile `act: "narke"` is ON for all
  (owner 2026-10-06). Route `stewardmd://narke`. Lidocaine plain default 3 mg/kg max 200 mg confirmed by the owner;
  clinical sign-off pending (an anaesthesiologist via the Review Desk).
- **Files:** `narke.js` (host config), `narke-loader.js` (only boot file, token `nrk5`), `narke.css` (palette on `.nrk-root`),
  `narke-explore-ui.js`/`.css` (the six explorers: ODC, MAC, TOF, dermatomes, ventilator, circle circuit; one persistent
  `#nkxSay` live region), `narke-clinic.js`/`.css` (reading clinics `capno` and `monitor`, decks `narke/decks/capno.json`,
  `monitor.json`), `narke/` (tracks, models list, reviews ledger, learn, decks, drill), `narke-models/` (window.NARKE_MODELS;
  `signals.js` is the synthetic capnogram and monitor signal model the clinics draw from).
- **Clinics:** lessons link in through `test.clinic` (`as4-monitoring` -> capno, `as6-recovery-monitoring` -> monitor), which
  also drives "Learn this" after a wrong answer. Review Desk lists them as `clinic-capno` / `clinic-monitor` (ledger only).
- **CliniX:** the anaesthesia OSCE lives in CliniX; deep link `narke-osce` -> `anaesthesia-osce` (`clinix.js` DEEP_LINKS).
  The specialty shell leaves Escape to CliniX while it is open.
- **Shared code it uses:** Review Desk Narkē tab (`review-desk.js` SPEC map), `scripts/apply-reviews.mjs` kind `narke`,
  `functions/_kits_share.js` kind whitelist, `tools/tokos-learn-index.mjs narke/learn`, `tools/tokos-build-drills.mjs --host narke`
  (copies `tokos-models/drill-core.js` into `narke-models/`).
- **Tests:** `test/narke-wiring.test.mjs` (wiring, Review Desk, apply-reviews, 450-file budget), `narke-drills`,
  `narke-signals`, `narke-explorer-*` (odc, mac, tof, dermatomes, ventilator, circuit), `narke-explore-ui`, `narke-tools`,
  `narke-tool-ui-initial`, `narke-mcq-deck`, `narke-learn-*`, `clinix-anaesthesia-osce`. Browser: `test/run-narke-app-ui.mjs`,
  `run-narke-explore-ui.mjs`, `run-narke-clinic-ui.mjs` (each with a free `PORT=` and `CHROME_PORT=`), CI `.github/workflows/narke-ui.yml`.
- **Data:** MedMCQA Anaesthesia (3,206) for the bank. VitalDB, CapnoBase, airway photo and nerve-block image sets are blocked
  (licence register in the plan); clinics use labelled synthetic signals. Doses come from `kb/clinical-protocols`.

## Ventilator Lab
- **What:** an educational ventilator simulator listed on the Narkē Test hub (`host.registerSim({id: "ventlab"})`).
  Every screen carries the "not a real ventilator" disclaimer (EN + HI). Contract: levels 1 to 4, ten scenarios,
  eight tutorials, what-if, ABG reasoning cases, dyssynchrony gallery, bedside actions, debrief score.
- **Files:** `narke-models/vent-engine.js` (physiology engine, ES5 UMD into `NARKE_MODELS["vent-engine"]`, sources and
  model choices in its header), `narke/vent/scenarios.json` (patients, goals, timelines), `narke/vent/learn.json`
  (settings and mode cards, levels, tutorials, alarm cards, dyssynchrony, ABG cases, what-if, glossary),
  `narke-vent.js` / `narke-vent.css` (all screens; loaded by `narke-loader.js`).
- **Engine API:** `init(scenario, settings)` makes a state; `step(state, settings, dt)` advances it (1 s live to 3600 s
  skips, timeline events fire on time or when `requires` is met: `{key, min}`, `{action}` or a list meaning any of);
  `readout()` gives vitals, vent, gas and flags; `breath()` one breath of waveforms; `abg()`, `alarms()`,
  `explainDelta()` (causal reasons), `whatIf()` (30 min steady state, `change.also` for combined changes),
  `dyssync(kind)`, `ACTIONS` + `act(state, id)` (decompress, suction, bag100; pure, logged in `state.acts`) and
  `score(run)` with `SCORE_MAX`.
- **Audit:** `node tools/narke-vent-audit.mjs` prints the calibration runs (t = 0 gas, good practice, typical mistake).
- **Tests:** `test/narke-vent-engine.test.mjs` (physiology properties, calibration, strategies in
  `test/narke-vent-strategies.mjs`), `test/narke-vent-content.test.mjs` (schemas, language, sources),
  browser `test/run-narke-vent-ui.mjs` (free `PORT=` and `CHROME_PORT=`, `SHOTS=` for screenshots).
- **Separation rule:** physiology and its short labels live only in the engine; numbers for patients only in
  scenarios.json; teaching prose only in learn.json; the UI reads the engine API and the two JSON files and never
  hard-codes a scenario value or a clinical number. Engine changes need an engine test.

## Gotchas
- The Pages deploy file cap (20,000) is close: about 16,850 on 2026-10-06. Keep Narkē within 450 files (test enforced).
- Never put "narke" in an engine file (`test/specialty-engine.test.mjs`).
