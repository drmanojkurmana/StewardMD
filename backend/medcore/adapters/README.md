# Adapters

One file per data source, each exporting `async function* encounters(opts)` yielding
`medcore-encounter/1` objects (see `../SCHEMA.md`). Nothing else in the pipeline changes.

`../synth/generate.mjs` is the reference implementation.

## `mimic-iv-demo.mjs` — BUILT 2026-09-20, and a correction

The MIMIC-IV **Clinical Database Demo** (100 patients, ODbL v1.0) needs **no credentialing**. An
earlier version of this file reasoned that public ICU datasets are credentialed and need a data use
agreement nobody here can sign, which is true of full MIMIC-IV and false of the demo. The demo was
available the whole time and the pipeline ran on synthetic data for longer than it needed to.

Fetch it with `./download.sh`. The data is gitignored: it is licensed, and redistributing it through
a git history is not ours to do.

**What one run on 140 real ICU stays found that synthetic data never could:**

| Finding | Why synthetic could not surface it |
|---|---|
| 13,913 respiratory rates REFUSED, unit `insp/min` | The synthetic generator emitted the unit strings the unit table already knew. A real hospital writes `insp/min`, and the most important vital for deterioration was being dropped in silence. |
| 1,013 pH results refused, unit `units` | Same: a real lab labels pH as "units". |
| 78 values refused IMPLAUSIBLE out of ~106,500 (0.07%) | Real artefact, caught at a believable rate. Synthetic noise was drawn inside the bounds by construction. |
| Three gates PASSED on a test split with zero events | The synthetic cohort always has events in every split. Real temporal splitting put all 36 pressor starts outside the test period, and the gates cleared on an absence of evidence. Fixed: an unevaluable run now FAILS every gate that depends on the missing evidence. |

The demo is far too small to train on - 36 events over 140 stays, 5 events per variable - and the
gates refuse it, correctly. Its value is that the adapter, the unit table and the gates have now met
real ITEMIDs, real unit strings, real timestamps and real missingness.

## Writing the full MIMIC-IV / eICU adapter

Full MIMIC-IV and eICU **are** credentialed, and that part stands:

1. **Access first, code second.** PhysioNet account, the required human-subjects training, and a
   signed data use agreement, all in place before any download. Verify the current requirements on
   the source's own site rather than trusting this file or any model's recollection of them.
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
