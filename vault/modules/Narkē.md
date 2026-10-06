# Narkē (Anaesthesia)

- **What:** Anaesthesia learning module for MBBS and residents, the second host on the [[Specialty Engine]] after [[Tokós]].
- **Plan:** `docs/superpowers/plans/2026-10-06-narke-anaesthesia-master-plan.md` (46 NMC AS competencies, 2018 Vol III).
- **Flag:** `smd_narke` (kill switch "0") and `?narke=0`. Home tile `act: "narke"` is `defOn: false` while it is built
  (in Add Tool); flip to ON when the module is complete. Route `stewardmd://narke`.
- **Files:** `narke.js` (host config), `narke-loader.js` (only boot file, token `nrk2`), `narke.css` (palette on `.nrk-root`),
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

## Gotchas
- The Pages deploy file cap (20,000) is close: about 16,850 on 2026-10-06. Keep Narkē within 450 files (test enforced).
- Never put "narke" in an engine file (`test/specialty-engine.test.mjs`).
