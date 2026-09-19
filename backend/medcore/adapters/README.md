# Adapters

One file per data source, each exporting `async function* encounters(opts)` yielding
`medcore-encounter/1` objects (see `../SCHEMA.md`). Nothing else in the pipeline changes.

`../synth/generate.mjs` is the reference implementation.

## Writing the MIMIC-IV / eICU adapter

The owner chose (2026-09-19) to build the pipeline on a credentialed public ICU dataset alongside
the synthetic cohort. That work is an adapter and nothing else. What it must do:

1. **Access first, code second.** These datasets are credentialed: PhysioNet account, the required
   human-subjects training, and a signed data use agreement, all in place before any download.
   Verify the current requirements on the source's own site rather than trusting this file or any
   model's recollection of them.
2. **Map to the schema, refuse what does not map.** ITEMIDs to the parameters in
   `medcore/data/units.json`, units to that table's allow-list. A code you cannot map with certainty
   is LEFT OUT and counted in the dataset card. Guessing an ITEMID into the wrong parameter is
   silent and unrecoverable; an omission is visible.
3. **`ageYears` only.** The schema has no date-of-birth field and must not gain one (HAZ-ML-04).
   Resolve age on the adapter side, and note that some public datasets shift dates deliberately.
4. **Events are timestamps, not flags.** MC-1 to MC-5 each need the instant the event happened.
   A dataset that only records "this patient was ever ventilated" cannot label MC-4 and must say so
   rather than approximating.
5. **Context or nothing.** `inIcu`, `dnr`, `creatinineBaseline` and the rest gate the risk set. A
   field you cannot establish is OMITTED, not defaulted: `medcore-outcomes.js` then refuses the
   question instead of asking it on a guess.

## External validity, stated once so it is not forgotten

A model trained on a US ICU dataset is a model about US ICU patients, their case mix, their staffing
ratios, their assays and their charting habits. It is a fine way to prove this pipeline and a poor
way to predict deterioration on an Indian ward. Nothing trained on such an extract may go in front
of a clinician here without revalidation on local data; that is the same gate the plan already sets,
and a public dataset does not move it.
