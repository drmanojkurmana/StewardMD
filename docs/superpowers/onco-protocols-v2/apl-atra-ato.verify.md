# Adversarial verification: apl-atra-ato.json (v2)

Compared against: `docs/superpowers/onco-protocols-draft/apl-atra-ato.json`
Schema: `kb/schema/standard-protocol.schema.json`

## 1. Dose integrity — PASS

Byte-for-byte check of both drugs, draft vs v2:

| drug | field | draft | v2 |
|---|---|---|---|
| tretinoin | dosePerUnit | 45 | 45 |
| tretinoin | unit | mg/m2 | mg/m2 |
| tretinoin | basis | bsa | bsa |
| tretinoin | route | PO | PO |
| tretinoin | roundingRule.increment | 10 | 10 |
| arsenic-trioxide | dosePerUnit | 0.15 | 0.15 |
| arsenic-trioxide | unit | mg/kg | mg/kg |
| arsenic-trioxide | basis | weight | weight |
| arsenic-trioxide | route | IV | IV |
| arsenic-trioxide | roundingRule.increment | 0.01 | 0.01 |

No number changed. `days` moved from draft's `null` (schema does not accept null for
`days`, only `array<number>`) to v2's `[]`, which is a type-only renormalization, not a
dose/day fabrication — both drugs' `days[]` are explicitly listed in `verifyFields`
(`regimen.drugs[0].days`, `regimen.drugs[1].days`) and the omission is explained in
`provenanceNote`. Per-drug `notes` and `name` are byte-identical to the draft.

Also byte-identical between draft and v2: `monitoring`, `clearanceChecks`,
`doseModificationRules`, `supportiveCare`, `premedications`. Nothing was silently
edited while being "carried forward."

## 2. No invention — PASS, with two judgment calls flagged

Genuinely unsourced fields are correctly left as `"VERIFY"` / `VERIFY`-sentinel objects:
`lineOfTherapy`, `eligibilityCriteria: [{"criterion":"VERIFY"}]`,
`regimen.cycleLengthDays`, `regimen.cycles`. All four (plus the two `days[]` arrays) are
listed in `verifyFields` — nothing VERIFY-shaped was left off that list.

Two fields were filled with concrete values that don't exist as distinct fields in the
draft. Traced both back to the draft text; neither is invented out of nothing, but both
are worth flagging:

- `treatmentSetting: "induction"` — the word "induction" doesn't appear as a discrete
  attribute in the draft, but it's used descriptively three times in the draft's own
  prose (monitoring: "before and during induction"; doseModificationRules: "APL
  induction"). Reasonable extraction, not fabrication.
- `histology: "Acute promyelocytic leukemia (APL), low-risk"` — derived from the
  draft's own `name` field ("ATRA + ATO (acute promyelocytic leukemia, low-risk)").
  APL is a legitimate AML histologic subtype, so the disease portion is fine, but
  appending "low-risk" (a risk-stratum, not a histology) into the histology field is a
  mild field-semantics mismatch. Not a clinical fabrication (the words come straight
  from the draft's title) but arguably belongs in `eligibilityCriteria` instead of
  being asserted as histology. Not blocking, but flag for the next pass.

`disease: "Acute promyelocytic leukemia (APL)"` is likewise lifted directly from the
draft's `name` parenthetical — not invented.

Pre-existing gap carried over unchanged (not introduced by the remapping): draft's
`diseaseId` is the generic `acute_myeloid_leukemia`, not an APL-specific id, even though
the whole protocol is APL-specific. v2 keeps this as-is, correctly, since fixing the KB
disease-id taxonomy is out of scope for a field remap.

`exclusionCriteria` is correctly omitted rather than populated with an invented empty
array or guess — matches the schema's "omit rather than invent" guidance.

## 3. Schema conformance — ISSUE (schema bug, not authoring bug)

Ran the file through `jsonschema` (Draft 2020-12) against
`kb/schema/standard-protocol.schema.json`. Valid JSON. **3 validation errors**, all of
the same shape:

```
lineOfTherapy -> 'VERIFY' is valid under each of {'const': 'VERIFY'}, {'type': [...]}
regimen.cycleLengthDays -> same
regimen.cycles -> same
```

Root cause is a defect in the schema's own `$defs.verifiable`:

```json
"oneOf": [{ "type": ["string", ...] }, { "const": "VERIFY" }]
```

`oneOf` requires *exactly one* branch to match. The literal string `"VERIFY"` matches
both the `type: string` branch and the `const: "VERIFY"` branch simultaneously, so
every legitimate use of the VERIFY sentinel anywhere in the schema fails strict
validation. This is a schema authoring bug (should be `anyOf`, or the string branch
should exclude `"VERIFY"`) — it will fire on *any* standard-protocol file that uses
VERIFY for a `verifiable`-typed field, not something specific to this remap. Recommend
fixing `standard-protocol.schema.json` (`oneOf` → `anyOf` in `$defs.verifiable`)
separately; not a defect to hold this file's remap on.

Everything else validates cleanly: required keys present (`id`, `name`, `disease`,
`diseaseId`, `regimen`, `evidence`, `protocolVersion`, `status`); `regimen` has its
required `drugs`/`cycleLengthDays`/`cycles`; both drug objects have all required
keys (`id`, `name`, `basis`, `dosePerUnit`, `unit`, `days`, `route`) with no
extraneous properties; `basis` (`bsa`, `weight`) and `unit` (`mg/m2`, `mg/kg`) values
are valid enum members; `treatmentIntent: ["curative"]` is a valid enum array;
`evidence.core[0]` is a well-formed `provenance` object; `status: "DRAFT"` is a valid
enum value and is consistent with the unresolved `verifyFields` (schema note: ACTIVE
would be blocked while VERIFY items remain — correctly not claimed here). No
`additionalProperties` violations anywhere in the document.

## 4. Multi-tenant — PASS

- `evidence.institutional: []` — empty, no hospital baked in.
- Draft's original `institution: { provenance: "...", approval: null }` object (which
  is not part of this schema's top-level shape at all) was correctly dropped rather
  than mapped 1:1; its substance was folded into `provenanceNote` without naming any
  hospital.
- No hospital name, no "NCCN-approved"/"endorsed" language anywhere in the file
  (grepped for `hospital`, `endors`, `approved by` — zero hits). Locator/source
  references to Harrison/NCCN Appendices are citations, not endorsement claims, and
  match language already present in the draft.
- No em dash or en dash anywhere in the file (regex-scanned for U+2013/U+2014 — zero
  hits).

## 5. Verdict: ISSUES (minor, non-blocking)

No dose was changed, no clinical value was fabricated in place of VERIFY, and the
multi-tenant/no-endorsement/no-dash rules are all clean. Two things to fix or
consciously accept before calling this file done:

1. **Schema bug** (not this file's fault): `$defs.verifiable`'s `oneOf` rejects the
   literal `"VERIFY"` sentinel it's designed to allow, causing 3 validation errors
   (`lineOfTherapy`, `regimen.cycleLengthDays`, `regimen.cycles`). Fix
   `standard-protocol.schema.json` (`oneOf` → `anyOf`), then re-validate — this file
   needs no changes for that fix to take effect.
2. **Minor field-semantics nit**: `histology` was given the value "Acute promyelocytic
   leukemia (APL), low-risk", mixing a risk-stratum descriptor into a histology field.
   Sourced from the draft's own title text, not invented, but consider moving
   "low-risk" into `eligibilityCriteria` instead on the next pass.
