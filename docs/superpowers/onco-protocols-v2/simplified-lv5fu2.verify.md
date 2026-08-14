# Adversarial verification: simplified-lv5fu2.json (v2) vs draft + schema

Compared:
- Output: `docs/superpowers/onco-protocols-v2/simplified-lv5fu2.json`
- Draft: `docs/superpowers/onco-protocols-draft/simplified-lv5fu2.json`
- Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity — PASS

Programmatically diffed every drug's `dosePerUnit`, `unit`, `basis`, `route`, `days`,
`roundingRule`, `modificationRules`, `notes` between draft and v2 (3/3 drugs). Zero mismatches.

| drug | dosePerUnit | unit | days | route | draft==v2 |
|---|---|---|---|---|---|
| leucovorin | 400 | mg/m2 | [1] | IV over 2 hr | yes |
| fluorouracil-bolus | 400 | mg/m2 | [1] | IV bolus | yes |
| fluorouracil-infusion | 1200 | mg/m2 | [1,2] | IV over 46-48 hr | yes |

`cycleLengthDays` (14), `cycles` (null), `monitoring`, `clearanceChecks`,
`doseModificationRules`, `supportiveCare`, `premedications` are all byte-identical to the draft.
Citation `notes` (DeVita line numbers) carried verbatim. Added `caps: {perDose: null}` per drug is
schema boilerplate (all-null), not a dose value.

## 2. No invention — PASS

Fields the draft never sourced (`histology`, `stage`, `biomarkers`, `treatmentSetting`,
`lineOfTherapy`, `eligibilityCriteria`) are correctly left as `"VERIFY"` / `["VERIFY"]` / `{}` / `[]`
(object/array-typed fields can't literally hold the string `"VERIFY"` under the schema's own type
constraints, so empty + a `verifyFields` listing is the only schema-legal way to flag them
unsourced) — all six are listed in `verifyFields`. No clinical value was guessed for any of them.

Two soft, non-fabrication items, both traceable to data already in the draft:
- `disease: "Colorectal cancer"` — required top-level field, not present verbatim in the draft, but
  it is a direct rendering of the draft's own `diseaseId: "colorectal_cancer"` and matches
  `kb/reference/colorectal_cancer.json`'s `name: "Colorectal Cancer"` exactly (case aside). Not a
  new clinical claim.
- `evidence.core[0].evidenceStatus: "current"` — the draft's `source` block never asserts
  currentness. Mild unsourced inference (schema default would be `"unknown"`); low clinical risk
  since it's a standard textbook citation, but technically not literal from the draft. Same pattern
  already flagged in the sibling `folfox-4.verify.md` for this batch, so it's a systemic mapping
  choice, not unique to this file.

The draft's `nccnAppendices` (`["C","D","F","G"]`), `nccnTemplate`, and `nccnGuideline: "pending"`
fields have no home in the target schema and are dropped rather than invented into `evidence.guideline`
(which is correctly left `[]` since no NCCN guideline was actually available) — consistent with how
the same source shape was handled in `folfox-4.json`. Not a fabrication, but worth flagging as
literal information loss (the appendix letters used to justify the antiemetic/G-CSF tiering in
`supportiveCare` are no longer traceable to a structured field, only to prose inside the
`supportiveCare` strings).

## 3. Schema conformance — ISSUES (pre-existing schema defect, not this file's fault)

Valid JSON. Ran `ajv-cli` (draft 2020-12) against `standard-protocol.schema.json`:

```
/histology         must match exactly one schema in oneOf
/treatmentSetting   must match exactly one schema in oneOf
/lineOfTherapy      must match exactly one schema in oneOf
```

Root cause: `$defs/verifiable` is `oneOf: [{type:[string,...]}, {const:"VERIFY"}]`. The literal
string `"VERIFY"` satisfies both branches at once (it's a string, and it equals the const), so
`oneOf` (exactly-one) rejects every correctly-produced `VERIFY` sentinel on a string-typed
`verifiable` field. `stage` escapes it only because `stage` items are typed as plain `string`, not
`$ref verifiable`. This is the identical defect already documented in
`docs/superpowers/onco-protocols-v2/folfox-4.verify.md` for the same batch — a bug in the schema,
not something introduced by this mapping. All other required keys (`id`, `name`, `disease`,
`diseaseId`, `regimen{drugs,cycleLengthDays,cycles}`, `evidence.core`, `protocolVersion`, `status`)
are present, correctly typed, and correctly derived (`status: "DRAFT"` from draft's
`lifecycleState: "draft"`, `protocolVersion: "0.1-draft"` from draft's `version`).

`verifyFields` completely and exactly enumerates the six VERIFY'd paths; no VERIFY sentinel is
missing from the list and no non-VERIFY field is falsely listed.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty.
- No `hospitalId`, hospital name, or "hospital" string anywhere in the file.
- No top-level `institution` object carried over (draft's `institution.provenance` /
  `institution.approval: null` is correctly represented instead via `status: "DRAFT"` and
  `clinicalApprovalStatus: null`, matching schema shape — `institution` isn't a valid top-level key
  under `additionalProperties: false`).
- No endorsement language ("NCCN-approved", "certified", etc.) anywhere.
- No em dash or en dash anywhere in the file (checked programmatically).

## 5. Verdict: CLEAN

No dose value was altered, no indication/eligibility field was fabricated with a concrete value in
place of VERIFY, and the file is multi-tenant-safe. The only defects found are (a) a pre-existing
schema bug in `$defs/verifiable`'s `oneOf` that rejects every valid `VERIFY` string (affects the
whole protocol batch, not unique to this file, and is a schema fix, not a re-mapping fix), and (b)
two low-risk, already-precedented soft inferences (`disease` name rendering, `evidenceStatus:
"current"`) that are traceable derivations of draft data rather than invented clinical facts.
