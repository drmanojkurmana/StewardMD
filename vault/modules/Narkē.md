# Narkē (Anaesthesia)

- **What:** Anaesthesia learning module for MBBS and residents, the second host on the [[Specialty Engine]] after [[Tokós]].
- **Plan:** `docs/superpowers/plans/2026-10-06-narke-anaesthesia-master-plan.md` (46 NMC AS competencies, 2018 Vol III).
- **Flag:** `smd_narke` (kill switch "0") and `?narke=0`. Home tile `act: "narke"` is `defOn: false` while it is built
  (in Add Tool); flip to ON when the module is complete. Route `stewardmd://narke`.
- **Files:** `narke.js` (host config), `narke-loader.js` (only boot file, token `nrk1`), `narke.css` (palette on `.nrk-root`),
  `narke/` (tracks, models list, reviews ledger, learn, decks, drill), `narke-models/` (window.NARKE_MODELS).
- **Shared code it uses:** Review Desk Narkē tab (`review-desk.js` SPEC map), `scripts/apply-reviews.mjs` kind `narke`,
  `functions/_kits_share.js` kind whitelist, `tools/tokos-learn-index.mjs narke/learn`, `tools/tokos-build-drills.mjs --host narke`
  (copies `tokos-models/drill-core.js` into `narke-models/`).
- **Tests:** `test/narke-wiring.test.mjs` (wiring, Review Desk, apply-reviews, 450-file budget), `test/run-narke-app-ui.mjs`
  (run with a free `PORT=`), CI `.github/workflows/narke-ui.yml`.
- **Data:** MedMCQA Anaesthesia (3,206) for the bank. VitalDB, CapnoBase, airway photo and nerve-block image sets are blocked
  (licence register in the plan); clinics use labelled synthetic signals. Doses come from `kb/clinical-protocols`.

## Gotchas
- The Pages deploy file cap (20,000) is close: about 16,850 on 2026-10-06. Keep Narkē within 450 files (test enforced).
- Never put "narke" in an engine file (`test/specialty-engine.test.mjs`).
