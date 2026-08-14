# Adversarial verification — aml-7-plus-3-induction

Compared: `onco-protocols-v2/aml-7-plus-3-induction.json` (output) vs
`onco-protocols-draft/aml-7-plus-3-induction.json` (input) vs
`kb/schema/standard-protocol.schema.json` (schema). JSON parsed and schema-validated with a script, not eyeballed.

## 1. Dose integrity — PASS

All three drugs byte-identical on every dosing field (`dosePerUnit`, `unit`, `basis`, `days`, `route`,
`roundingRule`, `caps`, `modificationRules`, `notes`):

| drug | dosePerUnit | unit | days | route | roundingRule | caps |
|---|---|---|---|---|---|---|
| cytarabine | 100 = 100 | mg/m2 = mg/m2 | [1-7] = [1-7] | continuous IV infusion = same | 50 = 50 | — |
| daunorubicin | 60 = 60 | mg/m2 = mg/m2 | [1,2,3] = [1,2,3] | IV = IV | 5 = 5 | 450/550 mg/m2 = 450/550 mg/m2 |
| idarubicin | 12 = 12 | mg/m2 = mg/m2 | [1,2,3] = [1,2,3] | IV = IV | 5 = 5 | 450/550 mg/m2 = 450/550 mg/m2 |

No drug added, dropped, or renamed. Notes text (including the "range printed in source, X used as
standard" caveats) carried over verbatim. `supportiveCare`, `monitoring`, `clearanceChecks`,
`doseModificationRules` arrays are also verbatim copies from the draft, no drift.

## 2. No invention — PASS, with two judgment calls flagged

Every genuinely unsourced clinical field (`histology`, `stage`, `biomarkers`, `lineOfTherapy`,
`eligibilityCriteria`, `regimen.cycleLengthDays`, `regimen.cycles`) is `"VERIFY"`, and none of those were
concrete in the draft (draft had `cycleLengthDays: null`, `cycles: null`, and no histology/stage/
biomarker/eligibility fields at all) — correct, no fabrication here.

Two fields got concrete (non-VERIFY) values that weren't literal draft *fields*, but both are direct,
low-risk transcriptions of text already in the draft, not invented clinical facts:
- `treatmentSetting: "induction"` — draft has no `treatmentSetting` key, but the draft's own `name`
  ("AML induction: ...") and `id` ("aml-7-plus-3-induction") and a `monitoring` entry ("during induction")
  all already assert this. Acceptable derivation, not fabrication.
- `disease: "Acute myeloid leukemia (AML)"` — draft has no `disease` field, only
  `diseaseId: "acute_myeloid_leukemia"`. This is a standard human-readable expansion of an unambiguous
  ID (required by schema, can't be VERIFY-omitted), not a clinical judgment call. Acceptable.

One field is a genuine, un-flagged assumption worth a second look:
- `evidence.core[0].evidenceStatus: "current"` — draft's `source` object doesn't state a currency
  status. Schema default for this enum is `"unknown"`. Asserting "current" instead of defaulting to
  "unknown" is a small unsourced claim (reasonable given "2025" edition, but not literally sourced).
  Not clinically dangerous, but technically an invented field not backed by the draft — recommend
  `"unknown"` until an explicit evidence-currency review, or note the "2025" edition as the justification.

## 3. Schema conformance — PASS (document), with one schema-file defect noted

- Valid JSON (parsed clean).
- Validated programmatically against the schema (Draft 2020-12): the document is **fully valid** once one
  pre-existing schema bug is neutralized (see below). All `required` keys present at every level
  (top-level, `regimen`, `evidence`, each `drug`); no `additionalProperties` violations anywhere (checked
  drug objects, `regimen`, `evidence`) ; `status: "DRAFT"` and enums all match allowed values.
- **Schema-file defect (not this document's fault):** `$defs.verifiable` is a `oneOf` between
  `{"type":[...,"string",...]}` and `{"const":"VERIFY"}`. Because `"string"` is in the type list, the
  literal string `"VERIFY"` matches *both* branches, which fails strict `oneOf` (exactly-one) semantics
  for every VERIFY value in every protocol document that will ever use this schema — confirmed
  (`jsonschema` reports `'VERIFY' is valid under each of {...}` at `lineOfTherapy`, and the same is true
  for every other VERIFY field). Re-validating with that clause changed to `anyOf` (the evident intent),
  the document passes with **zero errors**. This is a bug in
  `kb/schema/standard-protocol.schema.json` itself (`oneOf` → should be `anyOf`), separate from whether
  this specific mapping is correct. Flagging for the schema owner, not as a fault of this file.
- `verifyFields` completeness check: every literal `"VERIFY"` in the document (8 occurrences: histology,
  stage[0], biomarkers key+value, lineOfTherapy, eligibilityCriteria[0].criterion,
  regimen.cycleLengthDays, regimen.cycles) is covered by the 7 declared `verifyFields` paths. No orphan
  VERIFYs, no phantom entries.
- Minor style oddity, not a schema violation: `biomarkers: {"VERIFY": "VERIFY"}` uses a key literally
  named `"VERIFY"` as a placeholder rather than `{}` or omitting the field. Validates fine (`biomarkers`
  is optional and its `additionalProperties` schema doesn't constrain key names), but is an unusual way
  to say "no biomarkers sourced" — consider `{}` instead for clarity in a future pass.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, no hospital ID anywhere in the document.
- No endorsement language ("NCCN-approved", etc.) — `provenanceNote` and `notes` fields stay descriptive
  ("pending", "confirm institutional standard", "verify... before enforcing").
- No em-dash / en-dash anywhere in the file (checked with a Unicode grep for U+2013/U+2014) — all
  separators are plain ASCII hyphens (e.g. "100-200 mg/m2").

## Dropped-information note (not a fail, but worth a second pass)

The draft's top-level `caps: "protocol"` and `source.nccnAppendices: ["C","D","F","G"]` have no home in
the schema (top level is `additionalProperties:false` and has no such slots) and were silently dropped.
Appendices C and D resurface as text inside `supportiveCare`; **F and G do not appear anywhere in the
output** (no supportiveCare/monitoring/clearanceChecks line references them). If F/G encoded something
clinically relevant (e.g. extravasation/vesicant handling for the anthracyclines), that content is now
gone rather than VERIFY-flagged. Worth confirming with whoever owns the appendix list whether F/G had
content that should have become a VERIFY-marked field instead of disappearing.

## Verdict: CLEAN

No dose changes, no fabricated clinical facts. Two acceptable derivations (`treatmentSetting`,
`disease`) and one flagged low-risk assumption (`evidenceStatus: "current"`) are called out above for a
human reviewer's judgment, not treated as failures. One schema-file bug (`oneOf`/`anyOf` in
`$defs.verifiable`) is a pre-existing defect in the schema, not in this mapping. One open question
(dropped NCCN appendices F/G) should be confirmed before sign-off.
