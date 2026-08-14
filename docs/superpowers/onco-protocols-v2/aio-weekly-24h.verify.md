# Adversarial verification: aio-weekly-24h.json (v2)

Compared: `docs/superpowers/onco-protocols-v2/aio-weekly-24h.json` against
`docs/superpowers/onco-protocols-draft/aio-weekly-24h.json` and
`kb/schema/standard-protocol.schema.json`.

## 1. Dose integrity — PASS

Programmatic field-by-field diff of both drugs (`basis`, `dosePerUnit`, `unit`, `route`, `days`,
`roundingRule`, `modificationRules`, `notes`) against the draft: every value is byte-identical.

- Leucovorin: 500 mg/m2, IV over 2 hr, day 1, rounding increment 50 — unchanged.
- 5-Fluorouracil: 2600 mg/m2, IV over 24 hr, day 1, rounding increment 50 — unchanged.
- `cycleLengthDays` (7), `cycles` (null), `premedications`, `supportiveCare`, `monitoring`,
  `clearanceChecks`, `doseModificationRules`, `id`, `diseaseId`, `name`, and
  `protocolVersion`/draft `version` ("0.1-draft") all match exactly.

No dose, unit, day, or rounding number was altered anywhere in the regimen.

## 2. No invention — ISSUE (one dropped, sourced value; one derived-but-unflagged value)

- All schema-required indication/eligibility fields absent from the draft
  (`histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`)
  are correctly `"VERIFY"` / `["VERIFY"]` / `[{"VERIFY":"VERIFY"}]` — no fabricated concrete
  values. Good.
- **`treatmentIntent` regression**: the draft *did* carry a sourced value —
  `"intentOptions": ["palliative"]` — but v2 discarded it and wrote `"treatmentIntent": ["VERIFY"]`.
  This isn't fabrication, it's the opposite defect: a value the source draft already supplied was
  dropped and replaced with a VERIFY placeholder. Should be `["palliative"]`, not `["VERIFY"]`.
- **`disease` display name**: the draft never had a human-readable disease name, only
  `diseaseId: "colorectal_cancer"`. v2 fills `"disease": "Colorectal cancer"`. This is a
  deterministic, unambiguous derivation (`diseaseId` only maps to one disease), so it isn't
  clinical fabrication — but it doesn't exactly match the canonical name in
  `kb/reference/colorectal_cancer.json` (`"Colorectal Cancer"`, capital C). Cosmetic, but worth
  aligning to the KB's canonical string rather than free-typing a variant.

## 3. Schema conformance — ISSUE (schema defect, not content defect) + otherwise valid

Ran the file through `jsonschema` (Draft 2020-12) against `standard-protocol.schema.json`.
Required top-level keys (`id`, `name`, `disease`, `diseaseId`, `regimen`, `evidence`,
`protocolVersion`, `status`) are present; `regimen.drugs[].{id,name,basis,dosePerUnit,unit,days,route}`
all present; enums (`basis: "bsa"`, `unit: "mg/m2"`, `status: "DRAFT"`) are valid; `additionalProperties`
constraints are respected throughout (no stray keys).

However, strict validation reports 4 errors, all on fields typed via `$defs/verifiable`:

```
['histology']              'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
['biomarkers','VERIFY']    'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
['treatmentSetting']       'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
['lineOfTherapy']          'VERIFY' is valid under each of {'const':'VERIFY'}, {'type':[...]}
```

Root cause: `$defs/verifiable` is a `oneOf` between `{const:"VERIFY"}` and
`{type:[..."string"...]}`. Since `"VERIFY"` is itself a valid string, it satisfies *both* branches,
which `oneOf` forbids (exactly-one match required). This is a bug in the schema itself
(should be `anyOf`, not `oneOf`) — it means *any* conforming document that uses the VERIFY sentinel
on `histology`, `treatmentSetting`, `lineOfTherapy`, or a `biomarkers` value will fail strict
validation, not just this file. Not something the protocol author could have avoided while
following the spec's own instruction to write the literal string `"VERIFY"`. Flag for the schema
owner to change `oneOf` → `anyOf` in `$defs/verifiable`; content-wise this file does the right thing.

`verifyFields` correctly lists all 7 VERIFY occurrences (`histology`, `stage`, `biomarkers`,
`treatmentSetting`, `treatmentIntent`, `lineOfTherapy`, `eligibilityCriteria`) — matches 1:1 with
what's actually set to VERIFY in the body (net of the `treatmentIntent` regression noted above,
which is now VERIFY and correctly listed, but shouldn't have needed to be).

`evidence.core` is populated with the DeVita 12th-ed. source + line locators; `evidence.guideline`
and `evidence.institutional` are both empty, consistent with the draft's "NCCN template pending" /
"hospital approval pending" notes — correctly not fabricated.

Valid JSON: yes (parses cleanly).

## 4. Multi-tenant — PASS

- `evidence.institutional`: `[]` — no hospital hard-coded.
- No hospital name, department, or institution string anywhere in the file.
- `provenanceNote` explicitly states "no endorsement is implied" and names only the textbook
  source (DeVita) — no "NCCN-approved" or similar endorsement claim.
- No em dash / en dash anywhere in the file (grep clean).

## 5. Verdict: ISSUES

Not clean. Two findings, both real but non-critical:

1. **Dropped sourced value** — `treatmentIntent` should be `["palliative"]` (carried from the
   draft's `intentOptions`), not `["VERIFY"]`. Fix: re-map `intentOptions` → `treatmentIntent`
   instead of discarding it, and remove `treatmentIntent` from `verifyFields`.
2. **Schema bug surfaced by this file** — `$defs/verifiable` uses `oneOf` where `anyOf` is needed;
   strict validation currently fails on `histology`, `treatmentSetting`, `lineOfTherapy`, and the
   `biomarkers` VERIFY placeholder. Not a defect in this specific protocol file's content, but the
   file as written does not pass strict schema validation until the schema is fixed.

Everything else (dose integrity, no fabricated indication/eligibility values, multi-tenant
isolation, no dashes, required-key presence, enum validity) checks out clean.
