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
