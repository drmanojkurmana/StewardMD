# Adversarial verification: fufox.json (v2) vs draft + schema

Compared:
- Output: `docs/superpowers/onco-protocols-v2/fufox.json`
- Draft: `docs/superpowers/onco-protocols-draft/fufox.json`
- Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity — PASS

Programmatically diffed every drug's `dosePerUnit`, `unit`, `days`, `route`, `basis`, `roundingRule`,
`modificationRules`, `notes` between draft and v2 (3/3 drugs: oxaliplatin, leucovorin,
5-fluorouracil). Zero mismatches.

| drug | dosePerUnit | unit | days | draft==v2 |
|---|---|---|---|---|
| oxaliplatin | 50 | mg/m2 | [1,8,15,22,29] | yes |
| leucovorin | 500 | mg/m2 | [1,8,15,22,29] | yes |
| 5-fluorouracil | 2000 | mg/m2 | [1,8,15,22,29] | yes |

`cycleLengthDays` (42) and `cycles` (null) identical. `premedications`, `supportiveCare`,
`monitoring`, `clearanceChecks`, `doseModificationRules` are byte-identical arrays between draft and
v2 (verified programmatically, not just eyeballed). Citation `notes` carried verbatim.

## 2. No invention — PASS

Fields the draft did not source (`histology`, `stage`, `treatmentSetting`, `lineOfTherapy`,
`eligibilityCriteria`) were correctly left as `"VERIFY"` / `["VERIFY"]` / `[{"criterion":"VERIFY"}]`,
not filled with a guessed clinical value. `biomarkers: {}` left empty — draft had no biomarker data,
correctly not fabricated. `treatmentIntent: ["palliative"]` matches the draft's
`intentOptions: ["palliative"]` exactly — sourced, not invented.

Two soft findings, neither a hard fabrication:
- `disease: "Colorectal cancer"` is a mechanical title-case derivation of the draft's existing
  `diseaseId: "colorectal_cancer"`, not a new clinical claim. Not treated as fabrication.
- `evidence.core[0].evidenceStatus: "current"` — the draft's `source` object never asserts
  currentness of the DeVita citation; schema default for unspecified `evidenceStatus` is `"unknown"`.
  Mild unsourced inference (low clinical risk, standard oncology textbook), but technically not
  literally present in the draft.

No indication/eligibility field was invented with a concrete unsourced clinical value.
`verifyFields: ["histology","stage","treatmentSetting","lineOfTherapy","eligibilityCriteria"]`
correctly enumerates every `"VERIFY"` sentinel actually present in the document (checked by
recursive walk, no `VERIFY` occurrence outside this list, no listed field missing a `VERIFY`).

## 3. Schema conformance — ISSUES (schema-level, not mapping-level)

JSON is syntactically valid (parses clean, `python3 -m json.tool` and `ajv-cli` both load it).
Ran `ajv-cli` (draft 2020-12) and Python `jsonschema` (Draft202012Validator) against
`standard-protocol.schema.json`:

```
docs/superpowers/onco-protocols-v2/fufox.json invalid
  /histology         must match exactly one schema in oneOf
  /treatmentSetting  must match exactly one schema in oneOf
  /lineOfTherapy     must match exactly one schema in oneOf
```

Root cause: `$defs/verifiable` is `oneOf: [{type:[string,number,boolean,array,object,null]}, {const:"VERIFY"}]`.
Since `"VERIFY"` is itself a string, the literal value `"VERIFY"` satisfies **both** branches
simultaneously, which `oneOf` (exactly-one) rejects. This is a pre-existing defect in the schema's
`verifiable` definition, confirmed to fire identically across essentially every other v2 protocol
file in this directory that uses the VERIFY convention (folfox-4, folfox-6, folfiri, folfirinox,
lv5fu2-de-gramont, roswell-park, etc. all reproduce the same 3 errors) — it is not something specific
to this mapping. `stage` escapes it only because `stage` items are typed as plain `string`, not
`$ref verifiable`; `eligibilityCriteria` escapes it because it's a plain object array, not
`$ref verifiable`. Using the literal `"VERIFY"` string is exactly what the schema's own description
instructs authors to do — the schema should use `anyOf` (or drop the redundant string branch from the
`oneOf`) to fix this. Flagging as an ISSUE against the schema definition, not against this file.

Everything else validates cleanly:
- All required root keys present: `id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`.
- No disallowed top-level keys (schema `additionalProperties: false`) — every key in the output
  (`id, name, disease, diseaseId, histology, stage, biomarkers, treatmentSetting, treatmentIntent,
  lineOfTherapy, eligibilityCriteria, regimen, monitoring, clearanceChecks, doseModificationRules,
  evidence, protocolVersion, status, clinicalApprovalStatus, review, verifyFields`) is a declared
  schema property.
- `regimen` has required keys (`drugs`, `cycleLengthDays`, `cycles`) plus only allowed optional keys
  (`premedications`, `supportiveCare`); no disallowed keys.
- Each drug has all required keys (`id, name, basis, dosePerUnit, unit, days, route`) and no
  extra/disallowed keys (`caps`, `roundingRule`, `modificationRules`, `notes` are all schema-allowed).
  `basis: "bsa"` and `unit: "mg/m2"` are valid enum values.
- `evidence.core[0]` (provenance) has required `layer`+`source`; `layer: "core"` and
  `evidenceStatus: "current"` are valid enum values; no extra keys.
- `status: "DRAFT"` is a valid enum value; `review` object types all match (nullable strings + bool);
  `clinicalApprovalStatus: null` matches type.

## 4. Multi-tenant — PASS

`evidence.institutional: []` (empty, no hospital hard-coded). No hospital name, "endorsed by",
"NCCN-approved", or similar endorsement string anywhere in the file — the NCCN Appendix references
(C, D, F, G) are descriptive citations of where the emetogenicity/FN-risk/sequencing/tall-man
guidance comes from, carried verbatim from the draft, not endorsement claims. No em-dash or en-dash
found anywhere in the file (checked with a Unicode grep for U+2013/U+2014).

## 5. Verdict: ISSUES

- **Blocking-in-principle, but schema's fault, not the mapping's**: 3 `oneOf` validation failures
  (`histology`, `treatmentSetting`, `lineOfTherapy`) caused by a pre-existing ambiguity in
  `$defs/verifiable`'s `oneOf` (the string-type branch and the `const:"VERIFY"` branch both match the
  literal `"VERIFY"`). This affects nearly every VERIFY-using protocol in `onco-protocols-v2/`
  identically, so it is a schema-definition bug (`oneOf` should be `anyOf`), not a defect introduced
  by this remapping. Recommend fixing the schema once, not re-mapping this file.
- Everything else — dose integrity, no-invention, VERIFY/verifyFields consistency, multi-tenant
  neutrality, no dashes — is clean. `disease` and `evidenceStatus:"current"` are minor,
  low-risk derivations worth a clinician's eye but not fabrications.
