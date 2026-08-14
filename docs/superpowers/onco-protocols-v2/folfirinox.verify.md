# Adversarial verification: folfirinox.json (v2) vs draft + schema

Compared:
- `docs/superpowers/onco-protocols-v2/folfirinox.json` (output)
- `docs/superpowers/onco-protocols-draft/folfirinox.json` (input draft)
- `kb/schema/standard-protocol.schema.json` (schema)

## 1. Dose integrity — PASS

Programmatic diff of all 5 drugs (`dosePerUnit`, `unit`, `days`, `route`, `basis`), draft vs v2: zero mismatches.

| drug | dosePerUnit | unit | days | route |
|---|---|---|---|---|
| oxaliplatin | 85 | mg/m2 | [1] | IV |
| irinotecan | 180 | mg/m2 | [1] | IV |
| leucovorin | 400 | mg/m2 | [1] | IV |
| fluorouracil-bolus | 400 | mg/m2 | [1] | IV bolus |
| fluorouracil-infusion | 2400 | mg/m2 | [1,2] | IV continuous infusion over 46 hours |

All identical draft to v2. `roundingRule.increment` (50), `caps.perDose` (null) and per-drug `modificationRules` ([]) also unchanged. `notes` strings are byte-identical. `cycleLengthDays` (14) and `cycles` (null) carried over unchanged. Top-level `monitoring`, `clearanceChecks`, and `doseModificationRules` arrays, and `regimen.premedications`/`regimen.supportiveCare`, are byte-identical to the draft.

No invented or altered number anywhere in the regimen.

## 2. No invention — PASS with two low/medium notes

Correctly VERIFY'd (not in draft, not fabricated): `histology`, `stage: ["VERIFY"]`, `treatmentSetting`, `lineOfTherapy`. `biomarkers: {}` and `eligibilityCriteria: []` are empty (not invented content) and are still listed in `verifyFields`, the correct way to flag them since their schema types (object / array-of-objects) cannot literally hold the string `"VERIFY"`. `treatmentIntent: ["palliative"]` correctly carries over the draft's `intentOptions: ["palliative"]` (not upgraded to "curative" or otherwise altered — FOLFIRINOX here is unambiguously palliative per PRODIGE 4/ACCORD 11, matching source).

Two things worth flagging under "skeptical" review, neither a dosing/eligibility fabrication:

- **`disease: "Pancreatic cancer"`** is a display-name string not present verbatim anywhere in the draft (draft only has `diseaseId: "pancreatic_cancer"`). It's a mechanical humanization of the existing id, not a new clinical claim, and `disease` is a plain-`string`-typed required schema field (not wrapped in `$ref: verifiable`), so `"VERIFY"` was also a technically-legal alternative. Low severity — same pattern already accepted in the sibling `folfiri.json` review (`disease: "Colorectal cancer"` from `diseaseId: "colorectal_cancer"`).
- **`evidence.core[0].evidenceStatus: "current"`** is asserted with no support in the draft. The draft doesn't state edition currency, and the schema's own default for this enum is `"unknown"`. Given the field exists specifically to flag potentially-superseded evidence, defaulting to an unjustified `"current"` is a mild instance of "filled instead of left unresolved." Same issue already present in `folfiri.json`'s prior review — should probably be `"unknown"` until an editor confirms it, across both files.

The draft's top-level `"caps": "protocol"` (a document-type tag, unrelated to per-drug dose caps) and `"institution"` object were dropped, which is correct: neither field exists in the schema (`additionalProperties: false`), and `institution.provenance`/`institution.approval` being pending/null is exactly what `evidence.institutional: []` + `status: "DRAFT"` already represent without inventing an approval record.

## 3. Schema conformance — ISSUE (schema defect, not a mapping error)

Valid JSON: yes. Ran against the schema with `jsonschema` (Draft 2020-12): **3 failures**, all on `histology`, `treatmentSetting`, `lineOfTherapy` — each rejected with "'VERIFY' is valid under each of {const: VERIFY}, {type: [string,...]}" (i.e. `must match exactly one schema in oneOf`).

Root cause is in the schema itself, not the mapping: `$defs/verifiable` is `oneOf[{type: [string,number,boolean,array,object,null]}, {const: "VERIFY"}]`. Since `"VERIFY"` is a string, it satisfies *both* branches, so `oneOf` (which requires exactly one match) always fails whenever a document puts the documented `"VERIFY"` sentinel directly on a field typed `$ref: verifiable` (as opposed to nested inside an array/object like `stage`/`biomarkers`, which don't hit this bug because the outer container type is fixed, not `verifiable`, at that level). This is the identical pre-existing defect already flagged in the `folfiri.json` verification — reproduced here on a second file, confirming it's a schema-wide issue affecting every protocol that uses `"VERIFY"` on a directly-`$ref`'d field, not something specific to this mapping. Flagging for the schema owner; the v2 document is doing exactly what the schema's own prose says to do (`oneOf` should be `anyOf`, or branch 0 should explicitly exclude the literal `"VERIFY"`).

Everything else validates: all required top-level keys present (`id`, `name`, `disease`, `diseaseId`, `regimen`, `evidence`, `protocolVersion`, `status`); no additional/undeclared top-level properties (schema is `additionalProperties: false` and every v2 key — `biomarkers`, `clearanceChecks`, `clinicalApprovalStatus`, `disease`, `diseaseId`, `doseModificationRules`, `eligibilityCriteria`, `evidence`, `histology`, `id`, `lineOfTherapy`, `monitoring`, `name`, `protocolVersion`, `regimen`, `review`, `stage`, `status`, `treatmentIntent`, `treatmentSetting`, `verifyFields` — is a declared schema property); `regimen` has its required `drugs`/`cycleLengthDays`/`cycles` and no extraneous keys; every drug has its required `id`/`name`/`basis`/`dosePerUnit`/`unit`/`days`/`route`, `basis: "bsa"` and `unit: "mg/m2"` are valid enum values for all 5 drugs; `status: "DRAFT"` is a valid enum value; `evidence.core[0]` has required `layer`+`source` with valid enum values (`layer: "core"`, `evidenceStatus: "current"`); `verifyFields` exactly matches the set of fields actually set to `"VERIFY"` (`histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`) — none omitted, none extra.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, no hospital hard-coded anywhere in the document.
- No hospital name, "approved by", or institution string of any kind (grepped: zero hits for `hospital`/`approved by`/`endorse`).
- No endorsement claims ("NCCN-approved", etc.) — the only NCCN references were in the draft's `source.nccnAppendices`/`nccnTemplate`/`nccnGuideline` block, which itself was dropped from v2 (not required by schema, no `source` top-level property exists in the schema; the underlying textbook citation survives correctly inside `evidence.core[0]`).
- No em-dash or en-dash characters anywhere in the file (grepped for U+2014/U+2013: zero hits). All hyphens are plain ASCII `-`.

## 5. Verdict: CLEAN

No dose value was altered (all 5 drugs byte-identical to the draft), no indication/eligibility field was fabricated with a concrete value where the source was silent (all unsourced fields are `VERIFY`/empty + correctly enumerated in `verifyFields`), the document is valid JSON, and the multi-tenant/no-endorsement/no-dash constraints all hold.

Two low-severity notes carried over from the same defect class already found in `folfiri.json` (not new to this file, so likely systemic across the whole v2 batch — worth a one-time fix rather than a per-file fix):
1. `disease` display-name string is a mechanical, non-clinical derivation from `diseaseId`, not sourced verbatim — acceptable but technically "filled, not VERIFY."
2. `evidence.core[0].evidenceStatus: "current"` is unsupported by the draft; schema default is `"unknown"` — should arguably be `"unknown"` until an editor confirms currency, here and in every other v2 file that shares this pattern.

One schema-level defect (not a document defect, and not new — already identified against `folfiri.json`): `$defs/verifiable`'s `oneOf` always rejects the literal `"VERIFY"` sentinel it exists to document, because `"VERIFY"` matches both `oneOf` branches. Recommend the schema owner change it to `anyOf`. This will make `histology`/`treatmentSetting`/`lineOfTherapy` fail strict schema validation on every protocol file that uses `"VERIFY"` there, not just this one.
