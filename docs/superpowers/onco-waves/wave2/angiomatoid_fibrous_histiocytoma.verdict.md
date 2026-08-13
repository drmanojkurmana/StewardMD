# Adversarial verification — angiomatoid_fibrous_histiocytoma.md

## 1. DOSE LEAK
None. No mg, mg/m2, AUC, or numbered schedule anywhere in the sidecar. The only
numeric values are the "<2%" / "typically under 2 percent" metastatic-risk
statistic (matches DeVita verbatim) and the summary risk-range language, which
are epidemiology, not dosing.

## 2. UNGROUNDED CLAIMS
DeVita's *only* two AFH mentions (grep-verified, lines ~211832 and ~212058 of
devita.txt) are: (a) AFH listed as a WHO "intermediate, rarely metastasizing"
example tumor with metastatic risk "typically <2%, usually to lymph nodes or
lung," and (b) AFH's bare name in the WHO histologic classification table.
Nothing else about AFH appears in the source. Against that:

- **EWSR1/FUS molecular confirmation + Ewing sarcoma/clear cell sarcoma
  mimics** ("Preoperative or diagnostic biopsy should secure molecular
  confirmation of an EWSR1 (or FUS) rearrangement... exclude mimics such as
  Ewing sarcoma or clear cell sarcoma"): NOT supported by either DeVita AFH
  passage. This is real pathology (AFH is characteristically EWSR1-CREB1/
  EWSR1-ATF1 fusion-positive) but it is not in the source DeVita gives, and
  it is presented as a flat recommendation, not flagged as an extrapolation
  in the closing "what is deliberately not stated" section. This is the
  clearest gap.
- **Systemic/paraneoplastic symptom section** ("cytokine-mediated systemic
  symptoms, fever, anaemia, weight loss, and raised inflammatory markers...
  typically resolve after complete resection... persistence... should
  prompt a search for residual tumour"): NOT found anywhere in DeVita
  (checked "paraneoplastic," "systemic symptoms," "fever," "CREB1" near the
  AFH passages — no hits). This is a real, published clinical feature of AFH
  (the "AFH pseudocapsule + systemic inflammatory syndrome" literature) but
  it is entirely un-sourced to DeVita and, unlike the regimen/algorithm gaps,
  is not disclosed anywhere in the file as an extra-DeVita addition. It is
  also promoted to its own top-level section and reused as a "monitoring
  signal," i.e., treated as established fact rather than flagged.
- **"Wide excision... mirrors that of other intermediate, locally aggressive
  soft-tissue tumours"**: DeVita's "wide excision with a margin of normal
  tissue for good local control" statement is explicitly attached to the
  *intermediate, locally aggressive* WHO tier (desmoid-type example), which
  is a *different* WHO tier from AFH's own tier (*intermediate, rarely
  metastasizing*). The sidecar borrows that surgical principle across tiers
  and says so ("mirrors"), which is a disclosed inference rather than a
  fabricated DeVita quote — flagged here as borderline, not a hard failure.
- Radiotherapy-for-deep/truncal-location, re-excision-preferred-for-positive-
  margins, and MDT-referral triggers are general sarcoma-management
  boilerplate, not DeVita AFH-specific statements, but they are uncontroversial
  guideline-standard practice for intermediate-grade soft-tissue lesions, so
  not flagged as fabrication.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES
- Move/disclose the EWSR1/FUS molecular-confirmation-and-mimics claim into the
  "what is deliberately not stated" (or an equivalent disclosed-extrapolation)
  section, since it is not in DeVita's AFH text.
- Either cut the "Systemic symptoms as a management marker" section or
  explicitly flag it as not DeVita-sourced pathology-literature content before
  R1 review — as written it reads as a DeVita-grounded clinical fact and is
  not.
- The cross-tier "wide excision" extrapolation is acceptable as currently
  hedged ("mirrors") but should ideally also be named in the closing caveat
  section for consistency with how the file treats its other extrapolations.

Draft agent's own disclosure (systemic regimen, surveillance interval) is
accurate and matches what's in DeVita — no issue there. The problems are the
two additions (molecular workup detail, systemic-symptom syndrome) that were
not disclosed as beyond-DeVita.
