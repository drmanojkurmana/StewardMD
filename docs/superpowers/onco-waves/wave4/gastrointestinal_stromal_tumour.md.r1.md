# R1 Clinical-Safety Review — gastrointestinal_stromal_tumour

VERDICT: APPROVE

goldens changed: no (intended: n/a — narrative content, no engine/rule change)

## 1. SAFETY — pass
No unsafe, misleading, or harm-inducing statement. Every directive is hedged and
matches how a GIST-literate clinician would act:
- "All GISTs 2 cm or larger should generally be resected" — softened with "generally";
  matches standard of care (no reliably-benign 2 cm+ GIST).
- Adjuvant/first-line therapy explicitly gated on an imatinib-sensitive genotype, with
  PDGFRA D842V and related exon 18 variants correctly excluded as resistant — this is a
  genuine safety guard (prevents giving an ineffective TKI to a resistant genotype).
- D842V correctly routed to avapritinib, with its cognitive-neurotoxicity caveat flagged.
- "Continue TKI after metastasectomy regardless of how complete the resection appears" —
  correct and safety-positive (off-therapy relapse risk).
No false-negative risk: no missed contraindication, no wrong line-of-therapy ordering.

## 2. GROUNDING — pass
Consistent with DeVita 12th ed / NCCN standard of care:
- Line sequencing imatinib -> sunitinib -> regorafenib -> ripretinib, with avapritinib for
  D842V/exon 18 — correct and current.
- Genotype-driven biology (KIT/PDGFRA/SDH-deficient/NF-1), AFIP/MSKCC/contour risk tools,
  R0 goal with narrower-than-adenocarcinoma margins, no routine lymphadenectomy,
  tumor-rupture definition, 3-year adjuvant framing — all standard.
- No fabricated or outdated regimen found. No claim mis-attributed to DeVita: the one prior
  blocking item (neoadjuvant PET-timing on line 21) is corrected to DeVita's own
  neoadjuvant "matter of weeks" wording, and the advanced-disease "matter of days" wording
  (line 55) is context-correct. Independently confirmed against the adversarial .verdict.md,
  which returns CLEAN.

## 3. DOSE-FREE — pass
No numeric drug dose. Grep-confirmed no mg, mg/m2, AUC, or numbered schedule. All numerics
present are clinical thresholds/durations (2 cm cutoff, 1-2 cm observation band, 30-50% risk
framing, 3-yr adjuvant, 6-12 mo neoadjuvant window, 2-3 yr peak-relapse window), which
belong in the narrative, not in the dose-template layer.

## 4. SCOPE — pass
Appropriately decision-support, not directive: pervasive hedging ("considered",
"reasonable", "should be individualized", "unresolved", "unproven"), unproven
metastasectomy and limited-progression approaches explicitly flagged as non-prospective,
and an explicit MDT/sarcoma-referral section. Genotype-first gating throughout.

## 5. ADVERSARIAL FLAGS — cleared
.verdict.md present, returns CLEAN. The single prior blocking flag (PET-timing mis-sourcing)
is resolved and re-verified. No flagged issue remains in the sidecar; nothing requires
relabelling away from DeVita.

Minor advisory (non-blocking): line 34 lists imatinib targets as
"KIT/PDGFRA/PDGFR/ABL" — "PDGFR" is redundant alongside "PDGFRA"; cosmetic only.
