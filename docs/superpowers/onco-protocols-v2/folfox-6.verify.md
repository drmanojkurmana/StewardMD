# Adversarial verification: folfox-6.json (v2 vs draft vs schema)

Files checked:
- Output: `docs/superpowers/onco-protocols-v2/folfox-6.json`
- Input: `docs/superpowers/onco-protocols-draft/folfox-6.json`
- Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity

PASS. Programmatic diff of all 4 drugs (`oxaliplatin`, `leucovorin`, `fluorouracil-bolus`, `fluorouracil-infusion`) across `dosePerUnit`, `unit`, `days`, `route`, `basis`, `caps`, `roundingRule` found zero mismatches:

| drug | dosePerUnit | unit | days |
|---|---|---|---|
| oxaliplatin | 100 = 100 | mg/m2 = mg/m2 | [1] = [1] |
| leucovorin | 400 = 400 | mg/m2 = mg/m2 | [1] = [1] |
| fluorouracil-bolus | 400 = 400 | mg/m2 = mg/m2 | [1] = [1] |
| fluorouracil-infusion | 1200 = 1200 | mg/m2 = mg/m2 | [1,2] = [1,2] |

`cycleLengthDays` (14=14) and `cycles` (null=null) also identical. `notes` text (source locators) carried verbatim. `premedications`, `supportiveCare`, `monitoring`, `clearanceChecks`, `doseModificationRules` are byte-identical to the draft (verified via `==` on parsed JSON, not just eyeball).

## 2. No invention

Mostly PASS, one real defect found.

- `histology`, `treatmentSetting`, `lineOfTherapy` -> correctly `"VERIFY"` (draft never stated these; schema permits the literal string here since these fields are typed via `$defs/verifiable`). All three are listed in `verifyFields`. Correct.
- `biomarkers: {}`, `eligibilityCriteria: []` -> draft had no biomarker/eligibility data. Schema does NOT allow the literal string `"VERIFY"` for these fields (they're hard-typed `object`/`array`, not wrapped in `$defs/verifiable`), so an empty container is the only schema-legal placeholder, and both are correctly flagged in `verifyFields`. Not fabrication — the schema itself forces this encoding. Consistent with the other 14 v2 protocols already in the folder (checked `folfiri.json`, `folfox-4.json`).
- **`stage: []` is a real problem.** Same schema constraint applies (`stage` is a plain `array<string>`, no VERIFY-typed union), and the draft says nothing about stage — but the sibling protocols already remapped in this batch (`folfiri.json`, `folfox-4.json`) encode the identical "unresolved" situation as `"stage": ["VERIFY"]`, not `[]`. Per the schema's own doc comment, `stage: []` has an actual clinical meaning ("`[]` if not stage-scoped" i.e. applies regardless of stage) — that is a concrete, resolved claim, not a placeholder, and it is not supported by the draft (draft is silent on stage-scoping entirely). Listing `"stage"` in `verifyFields` while the field itself asserts the resolved value `[]` is self-contradictory: either it's verified-empty (drop from verifyFields) or it's unverified (should be `["VERIFY"]`, matching the sibling files' convention). As written this is a quiet fabrication of "not stage-scoped" dressed up as a pending item. Should be `["VERIFY"]`.
- `disease: "Colorectal cancer"` was not a field in the draft (draft only carried `diseaseId: "colorectal_cancer"`). This is a required schema field with no VERIFY escape needed (plain string, `"VERIFY"` would have been schema-legal too). It's a direct, unambiguous display-name derivation from `diseaseId` (and confirmed by the regimen name/evidence text — Tournigand FOLFOX-6 is a colorectal-cancer regimen) rather than a clinical judgment call, so I'm not failing it, but note it is technically introduced content not present verbatim in the draft.
- `treatmentIntent: ["curative","palliative"]` — directly copied from draft's `intentOptions`. Not invented.
- No eligibility/indication field was filled with an invented concrete clinical value (no fabricated line-of-therapy, no fabricated biomarker requirement, no fabricated stage restriction beyond the `[]` issue above).

## 3. Schema conformance

PASS (valid JSON; validated by hand against every `required`/`enum`/`additionalProperties` constraint since no `ajv` was available offline in this worktree).

- Valid JSON (`python3 -m json` parse succeeded).
- Top-level `required` present: `id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`. No properties outside the schema's allowed set (checked full key list against `properties`).
- `regimen` required (`drugs, cycleLengthDays, cycles`) present; no extra keys.
- Each drug has all of `id, name, basis, dosePerUnit, unit, days, route`; `basis: "bsa"` and `unit: "mg/m2"` are valid enum members; no extra drug-level keys.
- `evidence.core[0]` has required `layer`/`source`; `layer: "core"` and `evidenceStatus: "current"` are valid enum values. `guideline`/`institutional`/`divergence` present as empty arrays (schema-legal, not required to be non-empty).
- `status: "DRAFT"` is a valid enum member; `review` object only uses allowed keys.
- `verifyFields` lists exactly the 6 fields whose value is `VERIFY`/placeholder-empty (`histology, stage, biomarkers, treatmentSetting, lineOfTherapy, eligibilityCriteria`) — count and membership match, modulo the `stage` encoding bug in #2.

## 4. Multi-tenant

PASS.

- `evidence.institutional: []` — empty, no hospital baked in.
- No hospital name, department, or clinician name anywhere in the file.
- No endorsement language (`grep -i "endors"` and `"NCCN-approved"`-style phrasing: zero hits). NCCN appendices are cited only as sourcing detail inside `notes`/`supportiveCare` text (e.g. "per NCCN Antiemesis guideline", "appendix D"), which is describing the evidentiary basis, not claiming NCCN endorsement of StewardMD — consistent with schema's guidance that `provenance.source` may legitimately say "NCCN <panel>".
- No em dash / en dash anywhere in the file or the draft (`grep -P '[\x{2013}\x{2014}]'` — zero hits in both).

## 5. Verdict: ISSUES

One defect, low-to-moderate severity, easy fix:

- **Fix required:** change `"stage": []` to `"stage": ["VERIFY"]` in `docs/superpowers/onco-protocols-v2/folfox-6.json` to match the sibling protocols' convention and to stop asserting an unsourced "not stage-scoped" claim under a field that's simultaneously listed in `verifyFields` as unresolved.

Everything else — dose numbers, units, days, cycle length, evidence layering, VERIFY discipline elsewhere, schema shape, and multi-tenant/no-endorsement/no-dash hygiene — checked out clean.
