# PRD & Technical Specification: 5/5 Clinical Protocol & Syndrome Decision Engine

**Document ID**: PRD-SMD-KB-5STAR  
**Author**: Principal Software Engineer & Clinical Decision Support Lead  
**Target Version**: StewardMD v2.4 (Knowledge Base 5/5 Upgrade)  
**Status**: APPROVED FOR IMPLEMENTATION  

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem
The current StewardMD Knowledge Base contains 710 clinical syndromes and protocols. While rated **Grade A (4.74/5.0)** for factual clinical accuracy, its delivery model is currently an **unstructured text digest** (flat bulleted lists and paragraphs). At 3:00 AM in an emergency bay or ICU:
- Clinicians must read multiple text paragraphs to extract decision branches.
- Quantitative criteria (Hunter toxicity, Cairo-Bishop grading, ADD-RS thresholds) are embedded in sentences rather than structured tables.
- No direct pathway ties dynamic risk scores to the application's existing calculator engine (`calculators.js` / `calc-links.js`).
- Complex differential diagnoses (e.g., Serotonin Syndrome vs NMS vs Malignant Hyperthermia) lack high-contrast comparison matrices.

### 1.2 Target Vision (5/5 Standard)
Elevate the knowledge base into a **first-class multimodal clinical decision-support engine**:
1. **Interactive Decision Trees / Flowcharts**: Embedded zero-dependency SVG flowcharts directly visualizing acute diagnostic & resuscitation pathways.
2. **High-Contrast Clinical Matrix Tables**: Structured comparisons with criteria, sensitivities, specificities, and quantitative thresholds.
3. **Embedded Calculator Bridges**: Direct interactive chips launching bedside calculation tools.
4. **Subgroup Stratifications**: Dedicated tiers for renal impairment (eGFR cutoffs), hepatic insufficiency, and pregnancy safety.

---

## 2. Functional Requirements (FR)

### FR-1: Schema Extensibility & Backward Compatibility
- The clinical protocol schema validator (`scripts/build-clinical-protocols.mjs`) must support optional top-level attributes:
  - `algorithms`: Array of `{ id: string, title: string, steps: Array<{ step: string, branch?: string, action: string, critical?: boolean }> }` or SVG flowchart definitions.
  - `tables`: Array of `{ id: string, title: string, headers: string[], rows: string[][], caption?: string }`.
  - `calculators`: Array of `{ id: string, title: string, linkId: string, description?: string }`.
  - `subgroups`: Object containing `{ renal?: string[], pregnancy?: string[], hepatic?: string[] }`.
- Must strictly reject invalid schemas, prohibited characters (em/en dashes), and preserve content hash determinism.

### FR-2: Protocol Reader UI (`kb-protocols.js` & `kb-protocols.css`)
- **TOC Navigation**: Dynamically generate jump targets for `Algorithms`, `Tables`, `Drugs`, and `Sources`.
- **Table Renderer**: Mobile-first responsive card tables with sticky column headers, subtle borders, and monospace tabular alignment.
- **Flowchart Renderer**: Crisp inline SVG decision trees conforming to CSS theme variables (`--kl-paper`, `--kl-line`, `--kbp-red`, `--kbp-teal`, `--kbp-blue`).
- **Calculator Chips**: Render interactive badges with direct click hooks opening calculators (`window.CALC_LINKS` / `window.MEDCALC`).

### FR-3: Content Upgrades for Flagship Acute Syndromes
1. **Acute Aortic Syndrome (`acute-aortic-syndrome.json`)**:
   - ADD-RS + D-dimer decision tree algorithm.
   - Stanford Type A vs Type B comparison table.
   - Embedded ADD-RS calculator bridge.
2. **Serotonin Syndrome (`serotonin-syndrome.json`)**:
   - Hunter Toxicity Criteria diagnostic flowchart.
   - Differential table: Serotonin Syndrome vs NMS vs Malignant Hyperthermia vs Anticholinergic.
3. **Tumour Lysis Syndrome (`tumour-lysis-syndrome.json`)**:
   - Cairo-Bishop Laboratory vs Clinical TLS classification table.
   - Stepwise risk-stratified hydration & rasburicase/allopurinol flowchart.
4. **Acute Compartment Syndrome (`acute-compartment-syndrome.json`)**:
   - Delta pressure threshold algorithm ($\Delta P = \text{DBP} - \text{ICP} \le 30\text{ mmHg}$).
   - Clinical signs sensitivity & timeline table.

---

## 3. Implementation Plan & Execution Tasks

### Task 1: Schema Validator Extension
- Update `scripts/build-clinical-protocols.mjs`:
  - Add `tables`, `algorithms`, `calculators`, `subgroups` to `TOP_KEYS`.
  - Implement validation functions: `validateTables`, `validateAlgorithms`, `validateCalculators`.
  - Ensure string walk validates all nested text for dash/HTML restrictions.

### Task 2: UI Renderer Engine Extension
- Update `kb-protocols.js`:
  - Enhance `readerHTML()` to render `.kbp-flowchart`, `.kbp-table`, and `.kbp-calc-bridge`.
  - Update TOC generation to include `Algorithms` and `Tables`.
- Update `kb-protocols.css`:
  - Add styles for `.kbp-table-wrap`, `.kbp-tbl`, `.kbp-flowchart`, `.kbp-calc-btn`.

### Task 3: Content Transformation & Authoring
- Author structured tables, algorithms, and calculators for:
  - `acute-aortic-syndrome.json`
  - `serotonin-syndrome.json`
  - `tumour-lysis-syndrome.json`
  - `acute-compartment-syndrome.json`

### Task 4: Compilation & Test Verification
- Run `node scripts/build-clinical-protocols.mjs` to regenerate `index.json` and sync content hashes in `kb-protocols.js` and `index.html`.
- Run `node --experimental-test-module-mocks test/kb-clinical-protocols.test.mjs` to guarantee 100% test pass rate.
