# Adversarial verification: aml-hidac-idac-consolidation

Compared: `docs/superpowers/onco-protocols-v2/aml-hidac-idac-consolidation.json` (output)
against `docs/superpowers/onco-protocols-draft/aml-hidac-idac-consolidation.json` (input)
and `kb/schema/standard-protocol.schema.json` (schema).

## 1. Dose integrity - PASS

Programmatic diff of both drug entries (`cytarabine-hidac`, `cytarabine-idac`) confirms
byte-identical values for every dose-bearing field, no rounding/rewording:

| drug | dosePerUnit | unit | days | route | roundingRule | modificationRules |
|---|---|---|---|---|---|---|
| cytarabine-hidac | 3000 = 3000 | mg/m2 = mg/m2 | [1,3,5] = [1,3,5] | identical string | {"increment":50} = same | [] = [] |
| cytarabine-idac | 1500 = 1500 | mg/m2 = mg/m2 | [1,2,3] = [1,2,3] | identical string | {"increment":50} = same | [] = [] |

No extra or dropped drug-level keys. The free-text `notes` on both drugs (which carry the
critical caveats: HiDAC-vs-IDAC is a mutually-exclusive physician choice; IDAC dose is the
upper bound of a printed 1-1.5 g/m2 range and must be confirmed; the older-patient attenuated
0.5-1 g/m2 dose was deliberately NOT encoded as a discrete value) are copied verbatim,
character-for-character. `premedications`, `supportiveCare`, `monitoring`, `clearanceChecks`,
and `doseModificationRules` are also verbatim matches to the draft.

## 2. No invention - PASS, with one item worth flagging

- `histology`, `stage`, `biomarkers.molecularProfile`, `lineOfTherapy`, `eligibilityCriteria`
  are all correctly left as `"VERIFY"` (none of these existed in the draft) - no fabrication.
- `treatmentIntent: ["curative"]` - directly copied from draft's `intentOptions`. Fine.
- `disease: "Acute Myeloid Leukemia"` - derived from the draft's own `diseaseId` /
  protocol name, not a new clinical fact. Fine.
- `treatmentSetting: "consolidation"` - **not VERIFY, and this field did not exist in the
  draft.** It is defensible (the draft's own protocol `name` literally says "AML
  postremission consolidation," so the mapper is quoting the draft's title, not inventing
  a new clinical claim), but it is technically a concrete value filled in for a field the
  source never explicitly populated as a structured field, and it was NOT added to
  `verifyFields`. This is borderline, not the same severity as inventing a dose or an
  eligibility criterion, but flag it: either mark `treatmentSetting` as `"VERIFY"` for
  strict source-fidelity, or keep it and document in `provenanceNote`/`notes` that it was
  inferred from the protocol title. Recommend the latter (one-line addition) rather than
  reverting to VERIFY, since the source text is unambiguous.
- No other indication/eligibility field carries an invented concrete value.

## 3. Schema conformance - MOSTLY PASS, one schema-level defect surfaced

- Valid JSON: yes.
- All required top-level keys present (`id, name, disease, diseaseId, regimen, evidence,
  protocolVersion, status`).
- `regimen` required keys present (`drugs, cycleLengthDays, cycles`); no keys outside the
  schema's `additionalProperties:false` allow-list at top level, in `regimen`, or in any
  `drug` object.
- `drug` required keys present (`id, name, basis, dosePerUnit, unit, days, route`); `basis:
  "bsa"` and `unit: "mg/m2"` are valid enum values.
- `evidence.core[0]` provenance object has required `layer`+`source`, plus `version`,
  `date`, `locator`, `evidenceStatus` all schema-valid keys/types.
- `evidence.institutional: []` and `evidence.guideline: []` - both correctly empty (no
  guideline overlay or institutional data exists yet per the draft).
- `verifyFields` lists exactly the 5 dotted paths where `"VERIFY"` literally appears in the
  document (`histology, stage, biomarkers.molecularProfile, lineOfTherapy,
  eligibilityCriteria`) - confirmed by grepping the file for every `"VERIFY"` occurrence;
  none missing, none extra.
- Ran the document through `jsonschema.validate()` against the actual schema file: **it
  fails.** Root cause is a schema authoring defect, not a mapping error: the `verifiable`
  `$def` is a `oneOf` between `{"type": [...,"string",...]}` and `{"const": "VERIFY"}`.
  Because the generic string branch also matches the literal string `"VERIFY"`, any field
  using `$ref: "#/$defs/verifiable"` that is set to `"VERIFY"` matches BOTH oneOf branches
  simultaneously and fails strict `oneOf` (exactly-one-match) semantics. This trips on
  `histology`, `biomarkers.molecularProfile`, and `lineOfTherapy` in this document (all
  correctly-used VERIFY placeholders). It does not affect `stage` (plain string array, not
  `$ref verifiable`) or `eligibilityCriteria` (free-form object, not `$ref verifiable`).
  This is a pre-existing bug in `standard-protocol.schema.json` itself (should be
  `anyOf`, not `oneOf`) that will break every protocol in this family that legitimately
  uses "VERIFY" on a single-value verifiable field - not something the mapping agent did
  wrong, and not fixable by editing this protocol file. Flagging for the schema owner.

## 4. Multi-tenant - PASS

- `evidence.institutional: []` - empty, no hospital hard-coded.
- No hospital name, "approved by," or endorsement string anywhere in the file (grepped for
  hospital/endorse/approved by/certified/official - zero hits).
- No em dash or en dash anywhere in the file (regex-checked).
- `provenanceNote` explicitly states no institutional approval has been sought/granted and
  that NCCN template/guideline overlay are pending - consistent with the draft, no
  overreach.

## 5. Verdict: ISSUES (minor, none dose-related)

1. **Schema bug (not this file's fault):** `standard-protocol.schema.json`'s `verifiable`
   `$def` uses `oneOf` where `anyOf` is needed; the literal `"VERIFY"` placeholder value
   fails strict schema validation on `histology`, `biomarkers.molecularProfile`, and
   `lineOfTherapy`. Fix belongs in the schema, not in this protocol document.
2. **Minor/borderline invention:** `treatmentSetting: "consolidation"` is a concrete value
   for a field absent from the draft's structured data, not listed in `verifyFields`.
   Traceable to the draft's own protocol title ("AML postremission consolidation") so it
   is not a fabricated clinical fact, but recommend adding a one-line provenance note (or
   downgrading to VERIFY) for strict auditability.

No dose, route, day, rounding, or modification-rule value was altered anywhere. All
narrative caveats from the draft (mutually-exclusive HiDAC/IDAC choice, IDAC dose-range
ambiguity, unencoded older-patient attenuated dose) survived verbatim into the mapped
output.
