# Medical Core extract schema (`medcore-encounter/1`)

The ONE format every dataset is mapped into before anything else happens. A public ICU dataset
(MIMIC-IV, eICU) and the synthetic cohort both produce this; nothing downstream knows which it got,
except through `provenance`, which it must never ignore.

One JSON object per line (JSONL), one line per encounter.

```jsonc
{
  "schema": "medcore-encounter/1",
  "encounterId": "e-0001",
  "subjectKey": "s-0001",          // opaque. NEVER an MRN, a name or a hospital number.
  "admittedAt": "2026-01-04T08:00:00Z",
  "dischargedAt": "2026-01-07T11:00:00Z",
  "site": "US-2",                  // the unit or hospital. Gated as a subgroup, so it is required.
  "region": "US",                  // "US" | "IN". StewardMD is built for both; neither is the
  //                                  exception, and a model that works in one and fails in the
  //                                  other fails the subgroup gate like any other collapse.

  "demographics": { "ageYears": 68, "sex": "M", "weightKg": 74 },
  //                ^ ageYears ONLY. There is no dob field in this schema and there must never be
  //                  one: the adapter resolves age on its side and this format cannot carry the
  //                  0000-00-00 sentinel into the pipeline (HAZ-ML-04).

  "observations": [
    { "param": "hr", "value": 96, "unit": "bpm", "at": "2026-01-04T08:00:00Z", "source": "extract" }
    // param must be a medcore/data/units.json parameter; unit must be an allowed unit for it.
    // An adapter that cannot map a code leaves it out and counts it. It never guesses.
  ],

  "interventions": [
    { "kind": "vasopressor", "startedAt": "2026-01-05T02:10:00Z", "agents": ["noradrenaline"] }
    // kind: vasopressor | ventilation | rrt | oxygen. Absent means NOT CHARTED, which is unknown,
    // not absent-therefore-no (medcore-state.js rule 4).
  ],

  "context": {
    "inIcu": false, "electivePostOp": false, "admissionPlanned": false,
    "dnr": false, "creatinineBaseline": 0.9, "aki2OrWorse": false
    // Encounter-level truth the risk-set rules ask for. A field the adapter cannot establish is
    // OMITTED, never defaulted to false: medcore-outcomes.js then refuses the question
    // (UNKNOWN_STATUS) rather than asking it on a guess.
  },

  "events": [
    { "id": "MC-3", "at": "2026-01-05T02:10:00Z" }
    // Outcome events with timestamps. Absent = did not happen inside this encounter.
  ],

  "provenance": {
    "dataset": "medcore-synth-v1",
    "synthetic": true,               // LOAD-BEARING. See below.
    "generator": "backend/medcore/synth/generate.mjs@1.0.0",
    "seed": 20260919
  }
}
```

## `provenance.synthetic` is a safety control, not a label

It propagates: extract -> feature matrix -> trained artifact -> `medcore/medcore-models.js`, which
REFUSES to load a synthetic-provenance artifact for any clinical path. A model whose training data
had no patients in it cannot be allowed to reach a clinician by forgetting where it came from, so
forgetting is made structurally impossible rather than left to discipline. Pinned by
`test/medcore-models.test.mjs`.

## Adapter contract (the same one every WardSynQ adapter meets)

1. **Stable ids** built only from source-stable parts, never from ingestion time.
2. **Nothing silently dropped.** An unmappable code or unit is counted and reported in the dataset
   card, never guessed into a parameter.
3. **The raw survives** where a value is refused: keep the source value and unit.
4. **No invented clinical values.** A field that cannot be established is omitted, not defaulted.
5. **No identifiers.** De-identification happens on the hospital's side of the boundary, before
   the extract exists.

## Writing a real adapter

`backend/medcore/adapters/` is where one goes, named for its source (e.g. `mimic-iv.mjs`), exporting
`async function* encounters(opts)` yielding objects of this shape. Nothing else in the pipeline
changes. `backend/medcore/synth/generate.mjs` is the reference implementation and is deliberately
the simplest possible one.
