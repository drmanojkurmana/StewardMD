# Adversarial verification: modified-folfox-6 (v2 remap)

Compared: `docs/superpowers/onco-protocols-v2/modified-folfox-6.json` (output) vs
`docs/superpowers/onco-protocols-draft/modified-folfox-6.json` (input) vs
`kb/schema/standard-protocol.schema.json` (schema).

## 1. Dose integrity - PASS

All 4 drugs checked field-by-field (`dosePerUnit`, `unit`, `days`, `route`, `roundingRule.increment`,
`caps.perDose`, `notes`) - byte-identical to the draft, only property order changed (harmless):

| drug | draft dosePerUnit/unit/days | v2 dosePerUnit/unit/days | match |
|---|---|---|---|
| oxaliplatin | 85 mg/m2, [1] | 85 mg/m2, [1] | yes |
| leucovorin | 400 mg/m2, [1] | 400 mg/m2, [1] | yes |
| fluorouracil-bolus | 400 mg/m2, [1] | 400 mg/m2, [1] | yes |
| fluorouracil-infusion | 1200 mg/m2, [1,2] | 1200 mg/m2, [1,2] | yes |

No number was changed. `cycleLengthDays` (14) and `cycles` (null) also unchanged.

## 2. No invention - PASS, with one soft spot

- `histology`, `treatmentSetting`, `lineOfTherapy` correctly set to literal `"VERIFY"` - none of
  these were stated in the draft, and none were given a fabricated concrete value.
- `stage: []`, `biomarkers: {}`, `eligibilityCriteria: []` - not present in the draft either; left
  empty rather than invented. Correct restraint. (See schema note in section 3 re: `verifyFields`.)
- `evidence.guideline: []` - correctly left empty even though the draft's `source.nccnAppendices`
  existed, because the draft explicitly says NCCN guideline/template is "pending" - the mapper did
  not promote the pending NCCN appendix list into a guideline-layer evidence claim. Good.
- `treatmentIntent: ["curative","palliative"]` - carried over verbatim from draft's `intentOptions`,
  not invented.
- Soft spot: `evidence.core[0].evidenceStatus` was set to `"current"`. The draft never asserts the
  DeVita 12th ed. citation is current (vs. superseded), and the schema's own default for this field
  is `"unknown"`. Asserting `"current"` is a small unsourced judgment call, not a wild fabrication,
  but it isn't drawn from the draft either. Minor - recommend `"unknown"` until R1 confirms edition
  currency.
- Soft spot: `disease: "Colorectal cancer"` is not a field that existed in the draft (draft only had
  `diseaseId: "colorectal_cancer"`). It's a mechanical, uncontroversial derivation (schema requires
  `disease` as a required string) rather than a clinical judgment, so not flagged as fabrication -
  but note the casing doesn't match `kb/reference/colorectal_cancer.json`'s `name` field, which is
  `"Colorectal Cancer"` (title case). Cosmetic, but should match the KB's canonical disease name.

## 3. Schema conformance - ISSUES

- **Valid JSON**: yes (`python3 -m json.tool` parses clean).
- **Required top-level keys** (`id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`):
  all present.
- **additionalProperties**: no stray top-level or per-drug keys beyond the schema's property list
  (draft's top-level `caps: "protocol"` and `source`/`institution` objects were correctly dropped/
  remapped rather than carried through as illegal extra keys).
- **Drug objects**: all required keys present (`id, name, basis, dosePerUnit, unit, days, route`); no
  extra keys.
- **Ran the document through `jsonschema.validate()` against the actual schema file**: it currently
  **fails** validation - but the bug is in the schema, not the document. `$defs/verifiable` is a
  `oneOf` with two branches: `{type: [string,...]}` and `{const: "VERIFY"}`. Because `"VERIFY"` is
  itself a string, it matches *both* branches of the `oneOf`, which `oneOf` semantics reject (must
  match exactly one). This trips on every field that legitimately uses `$ref: verifiable` with the
  literal `"VERIFY"` sentinel: `histology`, `treatmentSetting`, `lineOfTherapy`. Confirmed by
  re-running validation with those three swapped to `null` - the rest of the document validates
  clean with zero other errors. **This means the schema as currently written cannot accept its own
  documented convention ("required fields the source does not support MUST be the literal string
  VERIFY") without failing strict validation.** Recommend fixing the schema (e.g. `anyOf` instead of
  `oneOf` for `$defs/verifiable`), separately from this document.
- **`verifyFields` inconsistency**: `verifyFields` lists `["histology", "stage", "biomarkers",
  "treatmentSetting", "lineOfTherapy", "eligibilityCriteria"]`. Only 3 of those 6
  (`histology`, `treatmentSetting`, `lineOfTherapy`) actually hold the literal sentinel `"VERIFY"`.
  The other 3 (`stage`, `biomarkers`, `eligibilityCriteria`) are typed as plain `array`/`object` in
  the schema (not `$ref: verifiable`), so they *cannot* legally hold the string `"VERIFY"` - they're
  set to `[]`/`{}` instead. The instruction says "verifyFields lists all VERIFYs"; strictly, half the
  list isn't a literal VERIFY. This is a defensible workaround given the schema's own type
  constraints (there's no way to mark an array/object field as VERIFY without violating its type),
  but it is an inconsistency in what `verifyFields` means field-to-field and should be called out
  rather than silently accepted - either loosen those three fields' schema types to `$ref: verifiable`
  so they can genuinely hold `"VERIFY"`, or document that an empty array/object also counts as
  "unresolved" for `verifyFields` purposes.
- `regimen` required subkeys (`drugs, cycleLengthDays, cycles`) present; `evidence` required `core`
  present.

## 4. Multi-tenant - PASS

- `evidence.institutional: []` - empty, no hospital hard-coded.
- No hospital name, department, or "approved by <hospital>" string anywhere in the file.
- No endorsement claims (no "NCCN-approved", "per <hospital> policy", etc.) - `provenanceNote` and
  `supportiveCare` text carefully attribute to "NCCN Chemotherapy Order Template Appendix D/C" as a
  sourcing reference only, matching the draft's own phrasing, not an endorsement claim.
- No em dash / en dash characters found in either file (`grep -P '[\x{2013}\x{2014}]'` - zero hits).

## Verdict: ISSUES (minor, none dose-affecting)

Dose integrity is clean and no fabricated clinical content was found - the mapper's use of `VERIFY`
is properly conservative. The problems are all in the schema-conformance layer, not clinical safety:

1. The schema's `$defs/verifiable` `oneOf` is unsatisfiable for its own documented `"VERIFY"`
   sentinel (schema bug, not a document bug, but the document as given does not pass strict
   `jsonschema.validate()` against it).
2. `verifyFields` mixes literal-VERIFY fields with empty-array/object fields under one list; the
   claim "all VERIFYs are listed" is only true for 3 of the 6 entries.
3. `evidence.core[0].evidenceStatus: "current"` is an unsourced assertion; schema default is
   `"unknown"` and nothing in the draft supports "current" over "unknown".
4. `disease: "Colorectal cancer"` casing doesn't match the KB's canonical `"Colorectal Cancer"`
   (cosmetic).

None of these require re-doing the dosing work; recommend fixing the schema's `oneOf`, changing
`evidenceStatus` to `"unknown"`, and normalizing the `disease` casing before this leaves DRAFT status.
