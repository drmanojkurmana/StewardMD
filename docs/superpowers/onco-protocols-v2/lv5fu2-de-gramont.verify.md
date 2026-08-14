# Adversarial verification — lv5fu2-de-gramont (Standard Protocol v2)

Compared: `docs/superpowers/onco-protocols-v2/lv5fu2-de-gramont.json` (output) vs
`docs/superpowers/onco-protocols-draft/lv5fu2-de-gramont.json` (input draft) vs
`kb/schema/standard-protocol.schema.json` (schema).

## 1. Dose integrity — PASS

Programmatically diffed every drug's `dosePerUnit` / `unit` / `days` / `route` / `roundingRule` /
`modificationRules` / `notes` field-by-field between draft and v2 (script run, not eyeballed).

| drug | dosePerUnit | unit | days | route | roundingRule |
|---|---|---|---|---|---|
| leucovorin | 200 = 200 | mg/m2 = mg/m2 | [1,2] = [1,2] | "IV over 2 hr" = "IV over 2 hr" | {increment:50} = {increment:50} |
| fluorouracil-bolus | 400 = 400 | mg/m2 = mg/m2 | [1,2] = [1,2] | "IV bolus" = "IV bolus" | {increment:50} = {increment:50} |
| fluorouracil-infusion | 600 = 600 | mg/m2 = mg/m2 | [1,2] = [1,2] | "IV over 22 hr" = "IV over 22 hr" | {increment:50} = {increment:50} |

All identical. `notes` (source citation text) byte-identical for all three drugs. `cycleLengthDays`
(14), `cycles` (null), `premedications` ([]), `supportiveCare`, `monitoring`, `clearanceChecks`,
`doseModificationRules` all byte-identical between draft and v2. No number was touched.

## 2. No invention — PASS, with two soft-inconsistency findings

Fields absent from the draft and correctly left as `VERIFY` (or a VERIFY-sentinel array element,
which is the only schema-legal encoding for `stage`):
- `histology` → `"VERIFY"` — correct, not in draft.
- `stage` → `["VERIFY"]` — correct; schema types `stage` as a plain string array (no literal
  `"VERIFY"` const allowed at top level), so a sentinel array element is the only compliant way to
  flag it unresolved.
- `treatmentSetting` → `"VERIFY"` — correct, not in draft.
- `lineOfTherapy` → `"VERIFY"` — correct, not in draft.

Fields absent from the draft and left as empty containers rather than a concrete value:
- `biomarkers` → `{}` — no biomarker value was invented. Defensible for a non-biomarker-selected
  regimen (LV5FU2 isn't biomarker-gated), but schema types `biomarkers` strictly as an object with
  no `VERIFY` const option, so `{}` is the closest compliant "unresolved" encoding.
- `eligibilityCriteria` → `[]` — same reasoning; schema types it strictly as an array of objects
  with no `VERIFY` option.

**Finding A (minor, inconsistency not fabrication):** `biomarkers` and `eligibilityCriteria` are
both listed in `verifyFields`, but neither field's actual value contains the literal string
`"VERIFY"` (unlike `stage`, which does via `["VERIFY"]`). The schema's `verifyFields` description
says it lists fields "currently set to VERIFY" — `{}` and `[]` are not literally that. This is a
presentational/consistency gap in how "unresolved, needs source" is signaled across fields with
different JSON types, not an invented clinical value. Recommend either (a) also using a sentinel
element/marker consistently (e.g. an object `{"_verify": true}` isn't valid per
`additionalProperties: true`... simplest: leave a code comment/convention doc that empty
object/array + presence in `verifyFields` = unresolved) or (b) note this explicitly in a README so
downstream consumers of `verifyFields` know to also check for empty containers.

**Finding B (minor, unsupported currency claim):** `evidence.core[0].evidenceStatus` is set to
`"current"`. Nothing in the draft or its `source` block asserts that the DeVita 12th-ed citation is
still the current standard-of-care reference (the draft's own `source.nccnGuideline: "pending"` and
`nccnTemplate: "pending..."` signal the currency/guideline-alignment check has *not* been done yet).
Per schema, `evidenceStatus` defaults to `"unknown"` when unestablished. Setting it to `"current"`
is a small unsourced upgrade from the draft's own stated "pending" posture — should be `"unknown"`
until the NCCN guideline/appendix cross-check actually happens.

**Not a violation, just noted:** `disease: "Colorectal cancer"` is a required schema field with no
literal equivalent in the draft (draft only has `diseaseId: "colorectal_cancer"`). This is a
straightforward title-cased derivation of the existing `diseaseId`, not a new clinical claim, so it
does not count as fabrication.

**Informational gap (not fabrication):** the draft's `source.nccnAppendices` (`["C","D","F","G"]`),
`source.nccnTemplate` ("pending..."), and `source.nccnGuideline` ("pending") are not carried into
any structured field in v2 — `evidence.guideline` is simply `[]`. The appendix references survive
only inside the free-text `supportiveCare` notes (which do mention "NCCN Appendix D" / "Appendix
C"). Nothing is invented, but the explicit "guideline check is pending" signal from the draft is
weaker in v2 than in the draft (empty array reads as "no guideline evidence" rather than "guideline
evidence not yet gathered"). Low priority; worth a follow-up if the guideline layer is populated
later.

## 3. Schema conformance — PASS

- Valid JSON (parsed with `JSON.parse`, no errors).
- All required top-level keys present: `id`, `name`, `disease`, `diseaseId`, `regimen`, `evidence`,
  `protocolVersion`, `status`.
- `regimen` required keys present: `drugs`, `cycleLengthDays`, `cycles`.
- Each drug object has all required keys (`id`, `name`, `basis`, `dosePerUnit`, `unit`, `days`,
  `route`); `basis: "bsa"` and `unit: "mg/m2"` are valid enum members.
- `evidence.core[0]` has required `layer`/`source`; `layer: "core"` and `evidenceStatus: "current"`
  are valid enum members (see Finding B on the *value* choice, not validity).
- `treatmentIntent: ["palliative","curative"]` — both valid enum members, carried over verbatim
  from the draft's `intentOptions`.
- `status: "DRAFT"` is a valid enum member, correctly mapped from the draft's
  `lifecycleState: "draft"`.
- No stray top-level or nested properties beyond what each `additionalProperties: false` schema
  object allows (checked `regimen`, `evidence`, `review`, `provenance` entries, and all three drug
  objects against the schema's property lists).
- `verifyFields` array only lists paths that are genuinely unresolved (see Finding A on how that
  unresolved-ness is *encoded*, not whether the list is accurate).

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, no hospital hard-coded.
- No hospital/institution name anywhere in the file (`grep -i hospital|apollo|fortis|aiims|max` →
  no hits).
- No endorsement language ("NCCN-approved" etc.) — the source string is a neutral citation
  ("DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."), not a
  claim of endorsement.
- No em dash / en dash anywhere in the file (checked with a Unicode grep for U+2013/U+2014) — plain
  hyphens only, consistent with house style.
- `clinicalApprovalStatus: null`, `review.*: null` — no institutional approval fabricated; matches
  draft's `institution.approval: null`.

## 5. Verdict: ISSUES (minor, non-blocking)

No dose was altered, no invented clinical value replaced a `VERIFY`, and the file is schema-valid
and tenant-neutral. Two soft issues to fix before this leaves draft status:

1. **Finding A** — `biomarkers`/`eligibilityCriteria` are listed in `verifyFields` but hold empty
   containers rather than a `"VERIFY"` sentinel like `stage` does. Pick one convention and apply it
   consistently (or document that "listed in verifyFields + empty container" is the intended
   pattern for object/array-typed fields).
2. **Finding B** — `evidence.core[0].evidenceStatus` should be `"unknown"`, not `"current"`; the
   draft itself flags the NCCN guideline/appendix cross-check as still pending, so nothing supports
   asserting currency yet.

Neither finding is a dose error, a schema violation, or a multi-tenant leak — both are corrigible
in a follow-up edit to the v2 file.
