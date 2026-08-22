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
- **Needs `wrangler deploy` of `stewardmd-api`** — until then the client degrades to the on-device
  formulary (`MEDDRUGS._list`), labelled "offline list". Test: `test/run-drugs-az.mjs`.

## Gotchas
- `resolveGeneric` matches the CLINICAL layer — `normIngredient` before grouping (product vs clinical). Compositions bake strength inline.
- run-drug-index / run-maik-explain unreliable in sandbox.
Deps: [[AI Control Center]] (ocr cap) · [[Medical Knowledge Base]].
