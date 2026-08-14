# Adversarial verification: fufiri.json (v2)

Compared: `docs/superpowers/onco-protocols-v2/fufiri.json` against
`docs/superpowers/onco-protocols-draft/fufiri.json` and
`kb/schema/standard-protocol.schema.json`.

## 1. Dose integrity — PASS

Programmatic field-by-field diff of all three drugs (`basis`, `dosePerUnit`, `unit`, `route`,
`days`, `caps`, `roundingRule`, `modificationRules`, `notes`) against the draft: every value is
byte-identical.

- Irinotecan: 80 mg/m2, IV, days 1/8/15/22/29/36, rounding increment 50 — unchanged.
- Leucovorin: 500 mg/m2, IV, days 1/8/15/22/29/36, rounding increment 50 — unchanged.
- Fluorouracil: 2300 mg/m2, IV, days 1/8/15/22/29/36, rounding increment 50 — unchanged.
- `cycleLengthDays` (49), `cycles` (null), `premedications`, `supportiveCare`, `monitoring`,
  `clearanceChecks`, `doseModificationRules`, `id`, `diseaseId`, `name`, and
  `protocolVersion`/draft `version` ("0.1-draft") all match exactly.

No dose, unit, day, or rounding number was altered anywhere in the regimen. (Key order within
each drug object was reshuffled — `route` moved before `caps` — but that's cosmetic; values are
identical.)

## 2. No invention — mostly clean, one representation inconsistency

- All schema-required indication/eligibility fields absent from the draft (`histology`, `stage`,
  `treatmentSetting`, `lineOfTherapy`) are correctly the literal `"VERIFY"` / `["VERIFY"]` — no
  fabricated concrete clinical values. Good.
- `treatmentIntent: ["palliative"]` is correctly carried forward from the draft's
  `"intentOptions": ["palliative"]` — not dropped, not fabricated. (This is actually more
  faithful than the sibling `aio-weekly-24h.json` v2 file, which discarded the equivalent
  sourced value and wrote `["VERIFY"]` instead.)
- `disease: "Colorectal cancer"` — the draft never had a human-readable disease name, only
  `diseaseId: "colorectal_cancer"`. This is a deterministic 1:1 derivation from `diseaseId`, not
  clinical fabrication, but it doesn't match the canonical string in
  `kb/reference/colorectal_cancer.json`, which is `"Colorectal Cancer"` (capital C). Cosmetic,
  same casing slip already flagged in `aio-weekly-24h.verify.md`.
- **`biomarkers: {}` and `eligibilityCriteria: []`** — both are silently empty rather than
  carrying an explicit VERIFY sentinel, yet `verifyFields` lists both `"biomarkers"` and
  `"eligibilityCriteria"` as fields "currently set to VERIFY" (per the schema's own field
  description). Neither field actually contains the string `"VERIFY"` anywhere. This is
  inconsistent with the established convention in the sibling v2 file (`aio-weekly-24h.json`),
  which represents the same "unknown" case as `biomarkers: {"VERIFY":"VERIFY"}` and
  `eligibilityCriteria: [{"VERIFY":"VERIFY"}]` so the sentinel is actually present at the path
  `verifyFields` claims. Not fabrication (no invented clinical content), but a spec/data mismatch
  worth fixing for consistency: either add the placeholder key/object, or drop `biomarkers` and
  `eligibilityCriteria` from `verifyFields` since nothing is literally set to VERIFY there.

## 3. Schema conformance

Required top-level keys (`id`, `name`, `disease`, `diseaseId`, `regimen`, `evidence`,
`protocolVersion`, `status`) are present; `regimen` has `drugs`/`cycleLengthDays`/`cycles`; every
drug has `id`/`name`/`basis`/`dosePerUnit`/`unit`/`days`/`route`; enums (`basis: "bsa"`,
`unit: "mg/m2"`, `status: "DRAFT"`) are valid; no stray top-level keys (`additionalProperties:
false` respected). Valid JSON (parses cleanly).

Ran through `jsonschema` Draft 2020-12 validator against `standard-protocol.schema.json`:

```
['histology']         'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
['treatmentSetting']  'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
['lineOfTherapy']     'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
```

Same pre-existing schema bug already documented in `aio-weekly-24h.verify.md`: `$defs/verifiable`
is a `oneOf` between `{const:"VERIFY"}` and a type union that includes `"string"`, so the literal
`"VERIFY"` satisfies both branches and `oneOf` (exactly-one) rejects it. This is a defect in the
schema (`oneOf` → `anyOf`), not something this protocol file did wrong — any conforming document
using the mandated VERIFY sentinel on a scalar field fails strict validation today. Not counted
against this file.

`verifyFields` lists 6 entries: `histology`, `stage`, `biomarkers`, `treatmentSetting`,
`lineOfTherapy`, `eligibilityCriteria`. Of these, 4 (`histology`, `stage`, `treatmentSetting`,
`lineOfTherapy`) genuinely contain the VERIFY sentinel; 2 (`biomarkers`, `eligibilityCriteria`) do
not, per finding #2 above — treat `verifyFields` as slightly over-claiming what's literally marked.

`evidence.core` is populated with the DeVita 12th-ed. source + line locators (123599, 123603);
`evidence.guideline` and `evidence.institutional` are both empty, consistent with the draft's
"NCCN per-disease template not yet provided" / "hospital approval pending" notes — correctly not
fabricated rather than guessed.

## 4. Multi-tenant — PASS

- `evidence.institutional`: `[]` — no hospital hard-coded anywhere.
- No hospital name, department, or institution string in the file.
- No endorsement language (no "NCCN-approved" or equivalent claim) — grep clean.
- No em dash / en dash anywhere in the file — grep clean.

## 5. Verdict: ISSUES (minor, non-critical)

Not clean, but nothing rises to dose corruption or clinical fabrication:

1. **`biomarkers`/`eligibilityCriteria` VERIFY-representation mismatch** — both fields are plain
   empty (`{}` / `[]`) rather than carrying an explicit VERIFY placeholder, yet `verifyFields`
   asserts they are "currently set to VERIFY." Fix: either write `{"VERIFY":"VERIFY"}` /
   `[{"VERIFY":"VERIFY"}]` (matching the convention already used in `aio-weekly-24h.json` v2) or
   remove these two entries from `verifyFields`.
2. **`disease` casing** — `"Colorectal cancer"` vs. the canonical `"Colorectal Cancer"` in
   `kb/reference/colorectal_cancer.json`. Cosmetic; align to the KB's canonical string.
3. **Schema bug surfaced again** — `$defs/verifiable`'s `oneOf` should be `anyOf`; strict
   validation fails on `histology`, `treatmentSetting`, `lineOfTherapy` through no fault of this
   file's content (already flagged against the schema in a prior verification, reproduced here
   for the record).

Everything else — dose integrity (all three drugs, byte-identical to the draft), no fabricated
indication/eligibility values, `treatmentIntent` correctly preserved (no regression, unlike the
sibling `aio-weekly-24h` file), multi-tenant isolation, no dashes, required-key presence, enum
validity — checks out clean.
