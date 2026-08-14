# R1 Clinical-Safety Review — malignant_rhabdoid_tumor

VERDICT: APPROVE

goldens changed: no (intended: n/a — narrative content, no engine/rule/calculator change)
adversarial .verdict.md: NOT PRESENT (no flagged issues to re-check)

## 1. Safety
No unsafe, misleading, or absolute statements. Every therapeutic claim is framed as decision-support and individualised to the treating team (surgery "where feasible without unacceptable functional loss"; RT "individualised against the risk of under-treating"; trial enrolment "should be considered"). No directive dosing, no definitive prognostic promise, no stop/start-med instruction. Nothing here would cause harm if followed by a clinician as a map to standard care.

## 2. Grounding (DeVita/NCCN standard of care)
- MRT biology (biallelic SMARCB1/INI1 loss, SWI/SNF subunit; SMARCA4-deficient subset; renal/CNS[AT/RT]/soft-tissue sites; rhabdoid tumour predisposition syndrome) — accurate, standard.
- Multimodality curative-intent therapy (maximal safe resection + multi-agent chemo + site/age-directed RT; intensified systemic + intrathecal therapy for CNS/disseminated disease; HDC + autologous stem-cell rescue for high-risk/relapse) — consistent with standard extracranial rhabdoid / AT/RT protocols. Correctly labelled as general oncology standard, NOT attributed to DeVita.
- The single DeVita-attributed claim — EZH2-targeting agents in clinical trials for SMARCB1-deficient neoplasms explicitly naming MRT (alongside epithelioid sarcoma / poorly differentiated chordoma), on the polycomb/EZH2-dependence rationale — is a real and uncontroversial fact (cf. EZH2 inhibition in SMARCB1-deficient tumours) and is scoped as investigational/trial-only, not as recommended therapy. No fabricated or outdated regimen. No claim is mis-attributed to DeVita: everything not in DeVita's text is explicitly flagged as such.

## 3. Dose-free
Confirmed. No mg, mg/m2, AUC, numbered schedule, cycle count, or efficacy percentage anywhere. Content-gaps section explicitly states doses/schedules were omitted. Drug classes/combinations deferred to protocol templates.

## 4. Scope
Appropriately hedged throughout. Attribution discipline is exemplary: each statement carries its provenance (DeVita-grounded vs general standard needing paediatric-specific sourcing). Refer-to-paediatric-oncology-centre and clinical-genetics pathways are correctly emphasised.

## 5. Adversarial flags
No .verdict.md present, so the "still-present flagged claim" gate does not trigger. The one DeVita citation is correctly confined to the EZH2/SMARCB1-deficient-neoplasm statement, which is genuinely the appropriate scope for that source.

## Critical
None.

## Important
None blocking. Note (advisory→important for downstream): the draft self-flags that all non-EZH2 claims still need manual sourcing against a paediatric-oncology-specific reference (current AT/RT / extracranial rhabdoid protocols) before clinical reliance. That labelling is present and honest; ensure it survives into the KB management field rather than being stripped.

## Advisory
- "tumour"/"rhabdoid tumour" British spelling is fine; keep consistent with KB house style.
- Consider that the parenthetical provenance tags are verbose for an end-user reading pane; acceptable to compress at render time, but do not drop the DeVita-vs-general distinction.

Confidence: 90
