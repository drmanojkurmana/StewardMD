# Adversarial verification: folfiri.json (v2) vs draft + schema

Compared:
- `docs/superpowers/onco-protocols-v2/folfiri.json` (output)
- `docs/superpowers/onco-protocols-draft/folfiri.json` (input draft)
- `kb/schema/standard-protocol.schema.json` (schema)

## 1. Dose integrity — PASS

Programmatic diff of all 4 drugs (`dosePerUnit`, `unit`, `days`, `route`, `basis`), draft vs v2: zero mismatches.

| drug | dosePerUnit | unit | days | route |
|---|---|---|---|---|
| irinotecan | 180 | mg/m2 | [1] | IV over 2 hr |
| leucovorin | 200 | mg/m2 | [1,2] | IV |
| fluorouracil-bolus | 400 | mg/m2 | [1,2] | IV bolus |
| fluorouracil-infusion | 600 | mg/m2 | [1,2] | IV over 22 hr |

All identical draft to v2. `roundingRule.increment` (50), `caps.perDose` (null) and per-drug `modificationRules` ([]) also unchanged. `notes` strings are byte-identical. `cycleLengthDays` (14) and `cycles` (null) carried over unchanged. Top-level `monitoring`, `clearanceChecks`, and `doseModificationRules` arrays are also byte-identical to the draft, just left in place.

No invented or altered number anywhere in the regimen.

## 2. No invention — PASS with two low/medium notes

Correctly VERIFY'd (not in draft, not fabricated): `histology`, `stage: ["VERIFY"]`, `treatmentSetting`, `lineOfTherapy`. `biomarkers: {}` and `eligibilityCriteria: []` are empty (not invented content) and are still listed in `verifyFields`, which is the correct way to flag them since their schema types (object / array-of-objects) cannot literally hold the string `"VERIFY"`. `treatmentIntent: ["palliative"]` correctly carries over draft's `intentOptions`.

Two things worth flagging under "skeptical" review, neither a dosing/eligibility fabrication:

- **`disease: "Colorectal cancer"`** is a display-name string not present verbatim anywhere in the draft (draft only has `diseaseId: "colorectal_cancer"`). It's a mechanical humanization of the existing id, not a new clinical claim, and `disease` is a plain-`string`-typed required schema field (not wrapped in `$ref: verifiable`), so `"VERIFY"` was also a legal option here. Low severity, but strictly it is a concrete value the draft didn't literally contain.
- **`evidence.core[0].evidenceStatus: "current"`** is asserted with no support in the draft. The draft doesn't state edition currency, and the schema's own default for this enum is `"unknown"`. Given the whole point of this field is to flag evidence that may be superseded, defaulting to an unjustified `"current"` is a mild instance of "filled instead of left unresolved." Should probably be `"unknown"` until an editor confirms it.

## 3. Schema conformance — ISSUE (schema defect, not a mapping error)

Valid JSON: yes. Ran against the schema with ajv (2020-12 draft): **3 failures**, all on `histology`, `treatmentSetting`, `lineOfTherapy` — each rejected with `must match exactly one schema in oneOf`.

Root cause is in the schema itself, not the mapping: `$defs/verifiable` is `oneOf[{type: [string,...]}, {const: "VERIFY"}]`. Since `"VERIFY"` is a string, it satisfies *both* branches, so `oneOf` (which requires exactly one match) always fails whenever a document actually uses the documented `"VERIFY"` sentinel on a field that is directly `$ref`'d to `verifiable` (as opposed to embedded inside an array/object like `stage`/`biomarkers`, which don't hit this bug). This will fail for every protocol document that ever uses `"VERIFY"` on `histology`/`treatmentSetting`/`lineOfTherapy`/`treatmentIntent` item-level, etc. It should be `anyOf`, or branch 0 should exclude the literal `"VERIFY"`. Flagging for the schema owner; the v2 document is doing exactly what the schema's prose says to do.

Everything else validates: all required top-level keys present (`id`, `name`, `disease`, `diseaseId`, `regimen`, `evidence`, `protocolVersion`, `status`); `regimen` has its required `drugs`/`cycleLengthDays`/`cycles`; every drug has its required `id`/`name`/`basis`/`dosePerUnit`/`unit`/`days`/`route`; `status: "DRAFT"` and `basis: "bsa"` are valid enum values; `evidence.core[0]` has required `layer`+`source`; `verifyFields` is a superset/exact match of every field actually set to `"VERIFY"` (`histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`) — none omitted, none extra.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, no hospital-specific overlay leaked into the global protocol.
- No hospital name anywhere in the file (grepped for hospital/apollo/fortis/max/aiims/endors* — zero hits).
- `clinicalApprovalStatus: null` correctly mirrors draft's unresolved `institution.approval: null` without inventing an approval.
- No em dash / en dash anywhere in the file (checked draft too — neither uses one; plain hyphens throughout, matching house style).
- No "NCCN-approved"/endorsement-style language.

## 5. Verdict: ISSUES (both minor, neither a dose/fabrication failure)

- **Schema defect** (not this file's fault): `$defs/verifiable`'s `oneOf` is unsatisfiable for a bare `"VERIFY"` string value, so ajv strict-fails `histology`/`treatmentSetting`/`lineOfTherapy` even though the document correctly follows the schema's documented intent. Fix belongs in `standard-protocol.schema.json` (`oneOf` → `anyOf`, or exclude `"VERIFY"` from branch 0), not in this instance file.
- **Unsourced `evidenceStatus: "current"`**: should be `"unknown"` (the schema's own default) absent a reason to assert currency of the 12th-edition DeVita citation.
- Minor/non-blocking: `disease: "Colorectal cancer"` is a mechanical label derived from `diseaseId`, not sourced verbatim, but not a clinical fabrication.

No dose numbers changed, no eligibility/indication fact fabricated in place of VERIFY, no hospital hard-coding, no endorsement language, no em/en dashes.
