# data/neo: neonatal layer clinical data (flag `smd_neo`)

Every number in these files was copied from a fetched source. Nothing is typed from memory.
All files ship as `review.status: "ai_drafted"` and show a Draft badge until a named neonatologist
approves them (`review.by`, `review.date`). Architecture: `vault/modules/Neonatal.md`.

## Provenance rules (enforced by `scripts/neo/validate.mjs`, run by `test/neo-data.test.mjs`)

1. Fetch the source with `python3 scripts/neo/snap.py <srcId> <url|fda:<set_id>>`. That writes
   `data/neo/sources/<srcId>.txt` (plain text, header with URL + accessed date; the folder is gitignored).
   Then `node scripts/neo/validate.mjs --pack` folds it into the committed `data/neo/sources.json.gz`
   (one file: Cloudflare Pages caps a deploy at 20,000 files). Snapshots are
   provenance only; `build-www.sh` does not ship them.
2. Register the source in the file's `sources` map:
   `"<srcId>": { "title", "publisher", "url", "licence", "accessed": "YYYY-MM-DD" }`.
   Licence examples: "Public domain (US Government work)", "CC BY 4.0", "WHO: CC BY-NC-SA 3.0 IGO",
   "NICE: UK Open Content Licence does not cover commercial reuse; permission needed". If unsure, say so.
3. Every object that carries clinical numbers carries `src` and `quote`. `quote` is copied VERBATIM
   from the snapshot (whitespace may differ). Every number in the object (and in child objects that
   have no quote of their own) must appear in the quote. "once", "twice", "one".."twelve" count.
4. Never convert units or derive numbers when storing. If the source says "2 kg", store
   `{ "lt": 2, "unit": "kg" }`, not 2000 g. The engine converts.
5. Unsourced means absent. Leave the field out; the app shows "No data on file".

## Common envelope

```json
{ "schema": 1, "kind": "neo-dose-bands", "title": "...", "compiled": "2026-09-30",
  "review": { "status": "ai_drafted", "by": null, "date": null },
  "sources": { "fda-ampicillin": { "title": "...", "publisher": "US FDA / DailyMed", "url": "...",
               "licence": "Public domain (US Government work)", "accessed": "2026-09-30" } },
  "...": "payload" }
```

## Range conditions (`when`)

Keys: `ga_wk` (gestational age at birth, weeks), `pna_d` (postnatal age, days), `pma_wk`
(postmenstrual age, weeks), `wt` (current weight, needs `unit` "g" or "kg"), `bw` (birth weight,
needs `unit`), `dol` (day of life, day 1 = first 24 h), `hours` (age in hours).
Each is an object of `min` (>=), `gt` (>), `max` (<=), `lt` (<), copied as the source words it:
"GA 34 weeks or less" -> `{ "max": 34 }`; "more than 7 days" -> `{ "gt": 7 }`.

## Files and payloads

- `dose-bands.json` (kind `neo-dose-bands`): `drugs[]` of
  `{ id, name, aliases[], class, highAlert, regimens[], notes[] }`;
  regimen `{ indication, route, bands[] }`; band
  `{ when, label, dose: { lo, hi, unit, per: "kg"|"dose", basis: "dose"|"day", divided }, every_h,
     freq, max: { v, unit, basis }, infuse, src, quote }`.
  `every_h` only when the source gives hours ("every 12 hours", "q8h"); otherwise `freq` as text.
- `prep.json` (kind `neo-prep`): `drugs[]` of `{ id, name, presentations[], reconstitution[],
  dilution[], infusion[], stability[], compatibility[] }`; presentation
  `{ form, v, unit, vol_ml, per_ml, market, src, quote }`; reconstitution
  `{ vial_v, vial_unit, diluent, add_ml, final_v, final_unit, final_per_ml, src, quote }`.
- `infusions.json` (kind `neo-infusions`): `drugs[]` of `{ id, name, highAlert, doseUnit,
  concentrations[]: { v, unit, per_ml, label, src, quote }, range: { lo, hi, unit, src, quote }, notes[] }`.
- `fluids.json`, `growth-preterm.json`, `milestones.json`, `bili.json`, `scores.json`,
  `ref-values.json`, `procedures.json`, `tdm.json`: see the header comment in each file and the
  engine that reads it (`neo-*.js`).
- Large published tables (LMS rows, hourly thresholds) go in `{ "table": [[...]], "columns": [...],
  "table_src": "<srcId>" }` blocks; the validator checks every value is present in that snapshot.
