# Adversarial verification: roswell-park.json (v2) vs draft vs schema

Files compared:
- Output: `docs/superpowers/onco-protocols-v2/roswell-park.json`
- Input draft: `docs/superpowers/onco-protocols-draft/roswell-park.json`
- Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity - PASS

Both drugs, byte-for-byte identical to the draft:

| drug | dosePerUnit | unit | days | route | roundingRule |
|---|---|---|---|---|---|
| leucovorin | 500 (draft: 500) | mg/m2 (draft: mg/m2) | [1,8,15,22,29,36] (draft: same) | IV (draft: IV) | increment 50 (draft: 50) |
| 5-fluorouracil | 500 (draft: 500) | mg/m2 (draft: mg/m2) | [1,8,15,22,29,36] (draft: same) | IV bolus (draft: IV bolus) | increment 50 (draft: 50) |

`cycleLengthDays` (56), `cycles` (null), `modificationRules` ([]), drug notes text - all unchanged from draft. No number was altered.

## 2. No invention - PASS, with two notes

Fields absent from the draft were correctly set to `VERIFY` / empty rather than a concrete guess, and all are listed in `verifyFields`: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`. `treatmentIntent` (`["curative","palliative"]`) is a direct carry-over of the draft's `intentOptions`, not invented. `disease: "Colorectal cancer"` is a straight label-ification of the draft's existing `diseaseId: "colorectal_cancer"`, not new clinical information.

Two things worth flagging, neither a hard fabrication but both are unsourced concrete-ish values:

- `evidence.core[0].evidenceStatus: "current"` - the draft never states the DeVita 12th-ed table is current; the schema's own default for this enum is `"unknown"`. Asserting "current" is a mild, undeclared assumption rather than a sourced fact.
- `biomarkers: {}` and `eligibilityCriteria: []` are listed in `verifyFields` but contain no literal `"VERIFY"` marker inside them (they're just empty containers). That's a structural necessity - `eligibilityCriteria`'s items must be objects, so the literal string `"VERIFY"` can't be placed inside the array - but it means "unresolved, needs data" is only recoverable by cross-referencing `verifyFields`, not by inspecting the field's own value. Acceptable given the schema's type constraints, but worth knowing this is convention-by-list, not self-evident-by-value.

The draft's `source.nccnTemplate: "pending - ..."` and `source.nccnGuideline: "pending"` (i.e. NCCN guideline-layer sourcing was explicitly not yet available) were silently dropped - `evidence.guideline` is just `[]` with no `divergence` note flagging that a guideline-layer check is outstanding. Not fabrication, but it's a loss of a signal the draft was explicit about.

## 3. Schema conformance - FAILS strict validation (ajv), root cause is a schema bug, not a mapping error

JSON is valid, and every `required` key at every level (`id/name/disease/diseaseId/regimen/evidence/protocolVersion/status`, `regimen.{drugs,cycleLengthDays,cycles}`, each `drug.{id,name,basis,dosePerUnit,unit,days,route}`, `evidence.core`) is present with allowed enum values (`status: "DRAFT"`, `basis: "bsa"`, `unit: "mg/m2"`, `evidence.core[0].layer: "core"`), and there are no stray `additionalProperties`.

However, running the file through `ajv-cli` (draft2020) against this schema produces 3 errors, all `oneOf` violations at `$defs/verifiable`:

```
/histology         must match exactly one schema in oneOf
/treatmentSetting   must match exactly one schema in oneOf
/lineOfTherapy      must match exactly one schema in oneOf
```

This is because `$defs.verifiable` is defined as:
```json
"oneOf": [{ "type": [...,"string",...] }, { "const": "VERIFY" }]
```
Any literal `"VERIFY"` string matches BOTH branches (it's a string, and it's also the const), so `oneOf` (exactly-one) rejects it every time it's used correctly. This is a defect in `kb/schema/standard-protocol.schema.json` itself (should be `anyOf`, not `oneOf`) - it means every field in the entire schema family that legitimately uses the literal `"VERIFY"` marker as instructed will fail strict validation. `stage: ["VERIFY"]` and `biomarkers: {}` don't hit this because they aren't declared via `$ref: verifiable` at the top level (they're a plain string-array and a plain object respectively), so only the three scalar `$ref: verifiable` fields (`histology`, `treatmentSetting`, `lineOfTherapy`) are hit.

Net: the mapping itself is schema-compliant in intent; the schema is unsatisfiable as written for its own core "unsourced -> VERIFY" convention. Recommend fixing the schema's `oneOf` to `anyOf` rather than changing the data.

## 4. Multi-tenant - PASS

- `evidence.institutional: []` - empty, as required.
- No hospital name, department, or institution anywhere in the file (checked by grep).
- No endorsement claims (`approved`/`endorsed`/`certified`/`official` all absent; `clinicalApprovalStatus` is a schema field name set to `null`, not an endorsement string).
- No em dash / en dash characters anywhere in the file (checked by regex).

## 5. Verdict: ISSUES

- **Schema (blocking on paper):** `histology`, `treatmentSetting`, `lineOfTherapy` fail strict ajv validation against `$defs.verifiable`'s `oneOf`. This is a pre-existing bug in `standard-protocol.schema.json` (`oneOf` should be `anyOf`) surfaced by this file, not something the mapping got wrong - fix the schema, not the data.
- **Minor/non-blocking:** `evidence.core[0].evidenceStatus: "current"` is an assumed value with no support in the draft (schema default is `"unknown"`); consider using `"unknown"` unless there's a reason to assert currency. The draft's "NCCN template/guideline pending" signal was dropped rather than surfaced (e.g. via a `divergence` entry or a guideline-layer placeholder).
- Dose numbers, units, days, routes, rounding, and all copied narrative fields (monitoring, clearanceChecks, doseModificationRules, supportiveCare, drug notes) are verified identical to the draft - no dose fabrication or drift found.
- Multi-tenant hygiene (empty institutional layer, no hospital name, no endorsement language, no em/en dash) is clean.
