# Adversarial verification: folfox-4.json (v2) vs draft + schema

Compared:
- Output: `docs/superpowers/onco-protocols-v2/folfox-4.json`
- Draft: `docs/superpowers/onco-protocols-draft/folfox-4.json`
- Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity — PASS

Programmatically diffed every drug's `dosePerUnit`, `unit`, `days`, `route`, `basis`, `caps`,
`roundingRule` between draft and v2 (4/4 drugs: oxaliplatin, leucovorin, fluorouracil-bolus,
fluorouracil-infusion). Zero mismatches.

| drug | dosePerUnit | unit | days | draft==v2 |
|---|---|---|---|---|
| oxaliplatin | 85 | mg/m2 | [1] | yes |
| leucovorin | 200 | mg/m2 | [1,2] | yes |
| fluorouracil-bolus | 400 | mg/m2 | [1,2] | yes |
| fluorouracil-infusion | 600 | mg/m2 | [1,2] | yes |

`cycleLengthDays` (14) and `cycles` (null) also identical. `notes` fields (source line citations)
carried verbatim.

## 2. No invention — PASS, with one item worth a second look

Fields the draft did not source (histology, stage, treatmentSetting, lineOfTherapy) were correctly
left as `"VERIFY"` / `["VERIFY"]`, not filled with a guessed clinical value. `biomarkers: {}` and
`eligibilityCriteria: []` were left empty (draft had no biomarker/eligibility data at all) — correct,
not fabricated, and both are flagged in `verifyFields`.

One soft finding, not a hard fabrication:
- `evidence.core[0].evidenceStatus: "current"` — the draft's `source` object never asserts
  currentness/supersession status for the DeVita citation. Schema default for an unspecified
  `evidenceStatus` is `"unknown"`. Asserting `"current"` is a mild unsourced inference (low risk —
  it's a standard oncology textbook actively cited — but technically not literally in the draft).
- `disease: "Colorectal cancer"` and `evidence.core[0].version: "12th ed"` are straightforward
  derivations from existing draft fields (`diseaseId: "colorectal_cancer"`, the textbook name string)
  rather than new clinical claims. Not treated as fabrication.

No indication/eligibility field was invented with a concrete unsourced clinical value.

## 3. Schema conformance — ISSUES (schema-level, not mapping-level)

JSON is syntactically valid (parses clean). Ran `ajv-cli` (draft-2020-12) against
`standard-protocol.schema.json`:

```
docs/superpowers/onco-protocols-v2/folfox-4.json invalid
  /histology        must match exactly one schema in oneOf
  /treatmentSetting must match exactly one schema in oneOf
  /lineOfTherapy    must match exactly one schema in oneOf
```

Root cause: the schema's own `$defs/verifiable` is defined as
`oneOf: [{type:[string,...]}, {const:"VERIFY"}]`. Since `"VERIFY"` is itself a string, the literal
value `"VERIFY"` satisfies **both** branches simultaneously, which `oneOf` (exactly-one) rejects.
This is a pre-existing defect in the schema's `verifiable` definition — it would fire on *every*
correctly-produced VERIFY sentinel for a string-typed verifiable field (histology, treatmentSetting,
lineOfTherapy all trip it here; `stage` escapes it only because `stage` items are typed as plain
`string`, not `$ref verifiable`). It is not something this file's authors did wrong — using the
literal `"VERIFY"` is exactly what the schema instructs — but as literally written, the schema should
use `anyOf` here, and until it's fixed every VERIFY-valued protocol in this format will fail strict
validation. Flagging as an ISSUE against the schema, not against the mapping.

Everything else validates cleanly by hand-check against the schema:
- All required root keys present: `id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`.
- `regimen` required keys present (`drugs`, `cycleLengthDays`, `cycles`); each drug has all required
  keys (`id, name, basis, dosePerUnit, unit, days, route`) and no extra/disallowed keys.
- `evidence.core[0]` (provenance) has required `layer`+`source`, enums valid, no extra keys.
- No `additionalProperties` violations anywhere checked by hand (root, `regimen`, `drug`, `caps`,
  `roundingRule`, `provenance`).
- `status: "DRAFT"` is a valid enum value; `review` object types all match (nullable strings + bool).

Minor, non-blocking convention note: `verifyFields` includes `"biomarkers"` and `"eligibilityCriteria"`
even though those fields hold `{}` / `[]` rather than the literal string `"VERIFY"` — because their
schema types (`object`, `array`) can't structurally carry the `"VERIFY"` sentinel the way string-typed
fields can. This is a defensible way to flag "unresolved, needs clinical input" for those two
(optional, not in the root `required` list) fields, but it is a looser interpretation of "verifyFields
lists fields **set to** VERIFY" than the literal wording implies. Not treated as a failure.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, as required.
- No hospital name/ID anywhere in the file (grepped `hospital|approved by|endorsed|endorsement|nccn-approved`
  — zero matches).
- No endorsement claims; NCCN references are factual pointers ("per NCCN Antiemesis appendix D
  moderate-emetic-risk tier"), not endorsement language.
- No em-dash / en-dash anywhere in the file (checked by codepoint, 0 found).

## 5. Verdict: ISSUES (schema-level only, low severity)

- Dose integrity: CLEAN.
- No invention: CLEAN (one soft, low-risk inference: `evidenceStatus: "current"` asserted without
  explicit draft support — recommend either sourcing it or reverting to schema default `"unknown"`).
- Schema: FAILS strict ajv validation on 3 fields (`histology`, `treatmentSetting`, `lineOfTherapy`)
  due to an ambiguous `oneOf` in the schema's own `verifiable` definition (should be `anyOf`) — a
  schema bug, not a mapping bug, but as-written the file does not pass strict schema validation.
  Also note the `biomarkers`/`eligibilityCriteria` entries in `verifyFields` don't literally hold
  `"VERIFY"` (structurally can't), a looser-than-literal but defensible reading of the convention.
- Multi-tenant: CLEAN.

Recommend: fix `$defs/verifiable` in `standard-protocol.schema.json` to use `anyOf` instead of
`oneOf` (repo-wide fix, affects every protocol using the VERIFY sentinel on a string-typed field, not
just this one), and either source or soften `evidenceStatus: "current"`. No dose or fabrication
issues found in this file.
