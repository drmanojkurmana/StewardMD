---
tags: [module, clinical]
status: live
flag: default-on
---
# Scan-Meds and Drug Index

Drug Interactions screen: search the drug index, type/paste a list, **scan a prescription/case sheet**,
or import from Ward Sync → interaction/duplicate/QT/renal/bleeding checks.

## Key files
- `medlist.js` (`window.MEDLIST`) — the list UI, `scanExtract()`, `parseEntry`/`resolveGeneric` (mapping), `normalizeScanRow`
- `kb/ai/drug-fuzzy.js` (`window.DrugFuzzy`) — OCR/handwriting near-miss → generic
- `functions/api/ai/[[path]].js` `/vision` — cloud OCR (text mode from on-device OCR, or image mode)
- `MEDDRUGS._list` — the drug DB · `INTERACTION_RULES` · `ASP_DRUGS`

## The scan flow (gold1047 fix)
1. **On-device OCR first** (iOS Apple Vision `SMD_NATIVE.ocr`, image stays local) → scrubbed text → `/vision` text mode.
2. **No on-device OCR (Android) or it fails** → cloud image OCR: `SMD_AI.vision(image)` → `/vision` image mode.
3. OCR names → `resolveGeneric`: exact/brand, else **[[drug-fuzzy]]** at MEDIUM confidence (clinician confirms) → editable review rows.

## Fixes (2026-07-30)
- Android was on-device-OCR-**required** (iOS-only plugin) → instant "could not read (0.0s)". Now cloud-image fallback.
- iPhone mapped wrong: `/vision` used the global model = `gemini-3.5-flash-lite` (weak OCR). Now pinned to a strong `VISION_MODEL` — see [[Decisions]].
- Handwriting near-miss ("Atorvastain"→atorvastatin) → drug-fuzzy.

## Drugs Database A-Z browse (2026-08-22)
- `api.js` (`window.MEDDB`, `#dbOverlay`) used to land on a bare search box ("Type at least 3 letters…")
  and read as empty. It now lands on an **A-Z browse of molecule names** (composition only, no brands).
- Served by a NEW worker endpoint `GET /compositions?letter=&limit=&offset=` (`worker/src/index.js`):
  index-ranged on `idx_drugs_comp` (both case ranges, so no full-table LIKE scan), `NOT LIKE '%(%'`
  drops the per-strength variants ("Amoxycillin (500mg)") and keeps the molecules + combos, 24h TTL.
- Second browse tab **By class** (mechanism/class, the way a doctor groups drugs): endpoints
  `GET /classes` (index of `action_class` + molecule counts) and `GET /class?name=` (molecules in one
  class). `action_class` is the mechanism column — "Cephalosporins: 1st generation", "Beta blocker-
  Cardioselective", "Calcium channel blockers- Dihydropyridines (DHP)"; `chem_class` is the chemical
  family and is NOT used for browsing. Coverage is good but not total (a few molecules have NULL
  action_class, e.g. Metoprolol at the time of writing) — those simply don't appear under a class.
- **Needs `wrangler deploy` of `stewardmd-api`**, plus (for class-page speed) one D1 index:
  `wrangler d1 execute stewardmd-prod --remote --command "CREATE INDEX IF NOT EXISTS idx_drugs_action ON drugs(action_class);"`
  Until deployed, BOTH browse tabs degrade to the on-device formulary (`MEDDRUGS._list`, grouped by
  its own `cls` labels), marked "offline list". Test: `test/run-drugs-az.mjs`.

## The bundled monograph library became searchable (2026-09-25, BUG-002)

QA searched **Cefiderocol** and got "No drugs match" although we ship a full authored monograph for
it. Three separate things were true, and only the third was the real fault:

1. The worker's `/search` runs `drugs_fts JOIN drugs`, i.e. the Indian **brand** catalogue. A molecule
   nobody sells here has no row, so the server can never find it. `worker/scripts/import_gold_to_d1.mjs`
   has its own hardcoded list of 68 such molecules, Cefiderocol among them.
2. `/monograph` answers `found:false` for **everything**, including Amoxicillin: the `monographs` table
   was never loaded in prod. Verified against `https://api.stewardmd.in` directly.
3. `api.js` `goldFor()` reads `window.SMD_GOLD_MONOGRAPHS`, sourced from `data/gold-monographs.js`.
   **That file has never existed in this repo** (no git history for it), so `goldFor()` always returned
   null and was dead code. The only client fallback left was `MEDDRUGS.searchIndex`, which knows
   **109 molecules**.

The data was never missing. `data/offline-clinical.json.gz` already held 1,541 molecules with full
gold records and `offline-clinical.js` already rendered them. Nothing could **search** them.

### What now ships
- `data/clinical-index.js` (`window.SMD_CLINICAL_INDEX`, 1,645 molecules, 331 KB) — name, class and
  the full tag list, nothing else. Loaded lazily by `offline-clinical.js` on the first search, so
  searching costs 331 KB rather than the 6 MB bundle. Built by `scripts/build-clinical-index.mjs`
  FROM the shipped gz, so the index can never list a molecule the app cannot then open.
- `data/clinical-supplement.json.gz` (104 molecules, 271 KB) — authored gold records that were in **no**
  bundle, because the bundle is keyed by the SQL `composition` string while `worker/data/gold/` is keyed
  by `generic`. Among them **Atropine sulfate, Enoxaparin sodium, Clopidogrel bisulfate, Caspofungin
  acetate, Fludrocortisone acetate**. Built by `scripts/build-clinical-supplement.mjs`; merged UNDER the
  bundle at load, so a bundled record always wins. Optional: if the fetch fails the app is exactly as before.
- `SMD_OFFLINE_CLINICAL.search(q, limit)` — what `api.js` calls.
- `api.js` `goldSearch()` / `goldHitsHTML()` / `exactish()`: a "Clinical monographs" section appended
  when the server returns nothing, and (for an exact or prefix name match only) when it returns
  something that does not include the molecule the doctor typed.

### Gotchas
- **`goldFor()` / `SMD_GOLD_MONOGRAPHS` in api.js is still dead code.** It was left alone rather than
  deleted in the same change; the working path is `SMD_OFFLINE_CLINICAL`. Remove it or build the file.
- The supplement leaves ~68 salt-form pairs visible as two rows ("Atropine" and "Atropine sulfate").
  Deliberate: collapsing on a salt suffix would also merge Calcium Acetate / Chloride / Gluconate,
  which are different products. Two accurate rows beats one hidden monograph.
- `test/serve.mjs` now falls back to `data/` for a root-level request, because `build-www.sh` copies
  these payloads to the bundle root. Before this, every UI test 404'd the gz and silently ran with the
  offline clinical library switched off.
- `build-www.sh` must copy both new files, or the phone 404s them.
- Tests: `test/clinical-index.test.mjs` (15), `test/run-drug-gold-ui.mjs` (browser, search + open).

## Gotchas
- `resolveGeneric` matches the CLINICAL layer — `normIngredient` before grouping (product vs clinical). Compositions bake strength inline.
- run-drug-index / run-maik-explain unreliable in sandbox.
Deps: [[AI Control Center]] (ocr cap) · [[Medical Knowledge Base]].

## Single drug lookup surface (2026-09-10)
- Removed the separate Drug Doses overlay. Drugs Database (`MEDDB`) is the single browse/dosing module.
- `MEDDRUGS.openList/close` remain compatibility redirects for existing callers (including Oncology). Shared formulary data, matching, detail helpers, offline fallback, and Drug Interactions remain available.

## Drug Interactions review (2026-09-25, branch codex/drug-interactions-medapi-openmed)
- `ddi-catalog.js` routes interaction search through both existing MEDAPI methods, preserving offline DB wrappers. Local vocabulary/fuzzy suggestions appear immediately; remote requests are debounced and bounded. Confirm spelling suggestions explicitly.
- `medlist.js` now preserves a medicine when Edit is cancelled, requires explicit fuzzy confirmation in typed/pasted entries, restores eager interaction rules, shows progress/error feedback, and rejects prefix-only automatic brand mapping.
- `interactions.js` enumerates all distinct matching product sets per rule. Verified browser example: warfarin + ibuprofen + naproxen now shows both warfarin pairs rather than only the first.
- Per-card severity pills and colored edge bars removed at owner's request. Subtle glows, textual section headings, and severity in clinical details remain.
- The optional OpenMed button in paste review uses a pinned, verified PharmaDetect pack defined in `ddi-catalog.js`; it does not enable the separate global disease/grounding flags. Exact upstream model SHA/revision and all artifact hashes are pinned. Download only on tap. NER identifies candidate names, not doses, negation, or interaction severity. Results start unchecked; clinician review required.
- Real PharmaDetect weights ran through the browser WASM runtime and extracted metformin + atorvastatin from synthetic text. This is a functional smoke check, not a clinical accuracy benchmark or phone performance validation.
- Patient-context rules remain unwired in this standalone screen; wording now states this honestly. Catalogue coverage is not interaction coverage.
- ARTEMIS device QA blocked: missing provider key and no active Android device. Do not claim native release validation.

### 2026-09-25 coverage audit and GLP-1 repair

- Added a label-sourced tirzepatide × GLP-1 rule using the curated runtime tag, including semaglutide and liraglutide. Direct source and evidence are displayed in Clinical details.
- Browser audit: 257 EPC duplicate rules are intentionally excluded by the browser engine; 70 rules are eligible there. Retain all 327 source rules and both consumers' original classifications because WardSynq also consumes the JSON pack. The browser and WardSynq assets have pre-existing differences; do not overwrite one with the other. No claim of 327 active browser rules is made.
- Removed the ingredient-overlap suppression between distinct products; distinct assignment already prevents self-matching. Shared ingredients must not suppress an independent warfarin/NSAID finding.
- Empty results explicitly start with “Safety not established”. Moderate/monitor findings are grouped as “Review required”, not permission to coadminister with monitoring.
- Audit limitations: 69 existing rules lack direct source URLs, 33 curated classification tags are not referenced by class rules (some have generic-specific rules), patient-context inputs remain unwired, and single-product internal interactions are outside distinct-product matching. Existing signoff validation reports 19 high-severity rules without a signed entry when reconstructed from committed sources. These are pre-existing provenance gaps; no reviewer approval was invented.
- Verification: 81 existing focused unit checks pass after integrating current main; browser interaction harness passes; manual browser review of semaglutide + tirzepatide shows the new label warning. ARTEMIS unavailable; no new test files authored. This is not comprehensive clinical validation.
