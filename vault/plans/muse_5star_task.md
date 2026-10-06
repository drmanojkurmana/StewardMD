# Task: Implement 5/5 Clinical Protocol & Syndrome Upgrade for StewardMD

You are working in `/Users/diwakarkumar/Developer/StewardMD`.
Your goal is to execute the complete implementation of the 5/5 Knowledge Base Decision Engine upgrade as specified in `vault/plans/PRD-KB-5STAR-ENGINE.md`.

## Target Objectives

### 1. Extend Protocol Validator: `scripts/build-clinical-protocols.mjs`
- Allow optional `algorithms`, `tables`, and `calculators` in `TOP_KEYS`.
- In `validateProtocol(p, fileId)`:
  - If `p.tables != null`: validate array of objects with `id`, `title`, `headers` (array of non-empty strings), `rows` (array of array of non-empty strings), optional `caption`. Ensure row cell count matches headers length.
  - If `p.algorithms != null`: validate array of objects with `id`, `title`, `steps` (array of objects with `step` and `action`).
  - If `p.calculators != null`: validate array of objects with `id`, `title`, `linkId`.
- Ensure all nested strings pass the existing `textErrors` check (no em/en dashes, no html markup, no TODO/TBD).
- Ensure `buildIndex(protocols)` preserves existing schema contract.

### 2. Update UI Renderer Engine: `kb-protocols.js` & `kb-protocols.css`
- In `kb-protocols.js` `readerHTML(p, opts)`:
  - Render `p.algorithms`: An interactive or clean visual flowchart/decision-tree block with `.kbp-flowchart` and SVG/step badges.
  - Render `p.tables`: Responsive mobile-first data tables inside `.kbp-table-wrap` with `.kbp-tbl` styling.
  - Render `p.calculators`: Clickable button chips `.kbp-calc-btn` with `data-kbp-calc="${c.linkId}"` that trigger calculation links.
  - In TOC: if `p.algorithms` or `p.tables` exist, add jump targets for them.
- In `kb-protocols.css`:
  - Add styles for `.kbp-table-wrap`, `.kbp-tbl`, `.kbp-tbl th`, `.kbp-tbl td`, `.kbp-flowchart`, `.kbp-flow-step`, `.kbp-calc-btn`.
  - Ensure dark-mode and mobile responsiveness.

### 3. Upgrade Flagship Acute Syndromes
Enrich the following clinical protocol files with comprehensive, accurate, high-yield `tables`, `algorithms`, and `calculators`:
1. `kb/clinical-protocols/acute-aortic-syndrome.json`:
   - `algorithms`: ADD-RS and D-dimer diagnostic triage algorithm.
   - `tables`: Stanford Type A vs Type B classification, management, and surgical mortality comparison table.
   - `calculators`: ADD-RS risk score.
2. `kb/clinical-protocols/serotonin-syndrome.json`:
   - `algorithms`: Hunter Toxicity Criteria evaluation flowchart.
   - `tables`: High-contrast differential table comparing Serotonin Syndrome vs NMS vs Malignant Hyperthermia.
3. `kb/clinical-protocols/tumour-lysis-syndrome.json`:
   - `tables`: Cairo-Bishop Laboratory vs Clinical TLS classification with specific electrolyte thresholds.
   - `algorithms`: Risk-stratified prevention and treatment algorithm (hydration + rasburicase/allopurinol).
4. `kb/clinical-protocols/acute-compartment-syndrome.json`:
   - `algorithms`: Delta pressure evaluation and emergency surgical decompression pathway.
   - `tables`: Physical findings sensitivity, specificity, and timeline matrix (pain on passive stretch vs pulselessness).

### 4. Build, Sync & Test
- Run `node scripts/build-clinical-protocols.mjs` to rebuild `kb/clinical-protocols/index.json` and sync version tokens.
- Run `node --experimental-test-module-mocks test/kb-clinical-protocols.test.mjs`.
- ALL 14 TESTS MUST PASS WITH ZERO ERRORS.
