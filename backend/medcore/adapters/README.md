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

## Two populations, both first-class

StewardMD is built for the US and for India. Neither is "the real population" and neither is the
exception, so external validity is not a caveat about one of them - it is a measurement, and the
pipeline takes it as one.

**Site and region are gated subgroups.** Every extract row carries `site` and `region`, they flow
into `strata`, and the subgroup gate covers them exactly as it covers age and sex: no subgroup may
sit more than 0.10 AUROC below overall. A model that works in one country's ICUs and fails in the
other's wards does not pass, and it fails for the same reason and through the same mechanism as a
model that works for men and fails for women.

What still differs between sources, and what an adapter must therefore preserve rather than smooth
over: case mix, staffing ratios (which is the measurement-frequency shortcut's fuel), assay methods
and reference ranges, charting habits, and which events are even recorded. Those are why the
subgroup gate exists. They are not a reason to prefer one source.

**The clinical gate is unchanged and applies to both.** A model validated on US ICU data is
evidence about US ICU patients until it has been validated on Indian ward data, and the reverse
holds exactly as strongly. Nothing reaches a clinician in either country without local validation
and a named approver there.
