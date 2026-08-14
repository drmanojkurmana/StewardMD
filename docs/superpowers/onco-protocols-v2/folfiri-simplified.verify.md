# Adversarial verification: folfiri-simplified (v2 vs draft vs schema)

Compared:
- Output: `docs/superpowers/onco-protocols-v2/folfiri-simplified.json`
- Input: `docs/superpowers/onco-protocols-draft/folfiri-simplified.json`
- Schema: `kb/schema/standard-protocol.schema.json`

Verified programmatically (Python `jsonschema` 4.26.0 + field-by-field diff script), not by eye alone.

## 1. Dose integrity — PASS

Field-by-field diff of all 4 drugs (`irinotecan`, `leucovorin`, `fluorouracil-bolus`, `fluorouracil-infusion`) across `basis`, `dosePerUnit`, `unit`, `days`, `route`, `caps`, `roundingRule`, `modificationRules`, `notes`: zero mismatches.

| drug | dosePerUnit | unit | days | draft == v2 |
|---|---|---|---|---|
| irinotecan | 180 | mg/m2 | [1] | yes |
| leucovorin | 400 | mg/m2 | [1] | yes |
| fluorouracil-bolus | 400 | mg/m2 | [1] | yes |
| fluorouracil-infusion | 1200 | mg/m2 | [1,2] | yes |

`cycleLengthDays` (14) and `cycles` (null) also identical. No number was changed, rounded, or reinterpreted.

## 2. No invention — PASS (2 items worth a note, not a fail)

Fields the draft did not source are correctly left `VERIFY`/empty, not filled with invented content:
- `histology`: `"VERIFY"` (draft: not present)
- `stage`: `["VERIFY"]` (draft: not present)
- `biomarkers`: `{}` (draft: not present)
- `treatmentSetting`: `"VERIFY"` (draft: not present)
- `lineOfTherapy`: `"VERIFY"` (draft: not present)
- `eligibilityCriteria`: `[]` (draft: not present)
- All six are correctly listed in `verifyFields`.

`treatmentIntent: ["palliative"]` is a legitimate carry-over of draft `intentOptions: ["palliative"]`, not an invention.

Two soft observations, neither a fabricated clinical fact:
- `disease: "Colorectal cancer"` is a required schema field the draft never had (draft only had `diseaseId: "colorectal_cancer"`). It's a mechanical humanization of the existing `diseaseId`, not new clinical content, so this is not the kind of invention the check is guarding against — but strictly it is "a required field not in the draft, filled with a concrete value instead of VERIFY." Low risk; flagging for awareness.
- `evidence.core[0].evidenceStatus: "current"` is not sourced from the draft (draft has no evidence-status concept) and the schema's own default for this enum is `"unknown"`. Asserting `"current"` is an editorial judgment call rather than a sourced fact. Low risk (it is very likely true — DeVita 12th ed. is the current edition), but a stricter reading would want `"unknown"` here, or a note on why "current" was asserted.

## 3. Schema conformance — MOSTLY PASS, with one schema-bug caveat

Valid JSON: yes.

Ran `jsonschema.Draft202012Validator` against `standard-protocol.schema.json`. Result: 3 errors, all of the same shape:

```
path: ['histology']       message: 'VERIFY' is valid under each of {'const': 'VERIFY'}, {'type': [...]}
path: ['treatmentSetting'] message: same
path: ['lineOfTherapy']    message: same
```

This is a **schema defect, not a document defect**: the `verifiable` `$defs` entry is a `oneOf` between `{"const": "VERIFY"}` and `{"type": [...string...]}`. Because the literal string `"VERIFY"` also matches the generic `"string"` type branch, `oneOf` (which requires *exactly one* match) is ambiguous and always fails for the one value the field exists to hold. Any correctly-authored document that legitimately uses `"VERIFY"` on a `$ref: verifiable` scalar field (not array/object-wrapped, like `stage`/`biomarkers`, which don't hit this because those aren't `$ref: verifiable` themselves at the top level) will fail strict validation this way. The fix belongs in the schema (`oneOf` → `anyOf`, or exclude the literal from the type branch), not in this document.

All other schema checks pass:
- Required top-level keys present: `id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`.
- No `additionalProperties` violations at top level, in `regimen`, in `evidence`, or in any drug object.
- `regimen` required keys (`drugs`, `cycleLengthDays`, `cycles`) present; `drugs` non-empty.
- Each drug has all required keys (`id, name, basis, dosePerUnit, unit, days, route`) and only schema-legal optional keys.
- `evidence.core` present and populated; `basis` enum (`bsa`), `unit` enum (`mg/m2`), `status` enum (`DRAFT`) all valid.
- `verifyFields` type/shape correct (array of strings).

## 4. Multi-tenant — PASS

- `evidence.institutional`: `[]` (empty, as required).
- No `hospitalId` string anywhere in the document (0 occurrences).
- No endorsement language (`NCCN-approved`, `endorsed`, `certified by`, etc.) — none found; `provenanceNote` correctly frames this as "textbook-grounded draft... pending" rather than a claim of endorsement.
- No em-dash (—), en-dash (–), or minus-sign character anywhere in the file (checked programmatically, not just visually).

## 5. Verdict

**CLEAN**, with one caveat to log, not to re-fix in this document:

- **Schema bug** (not a document bug): the `verifiable` `oneOf` in `standard-protocol.schema.json` makes the literal `"VERIFY"` value unsatisfiable for strict JSON Schema validation on `$ref: verifiable` scalar fields (`histology`, `treatmentSetting`, `lineOfTherapy` hit it here). Recommend the schema owner change `oneOf` to `anyOf` in `$defs.verifiable`.
- Two low-risk, non-fabricated but source-unbacked concrete values worth a second look by whoever signs off: `disease: "Colorectal cancer"` (derived, not invented) and `evidence.core[0].evidenceStatus: "current"` (editorial default, not asserted by source).

No dose was altered, no clinical field was invented in place of VERIFY, and the document is tenant-clean.
