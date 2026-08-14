# Adversarial re-verification verdict: dysgerminoma.md (rewrite pass)

## 1. DOSE LEAK
None. Grepped for mg / mg-m2 / AUC / cycle-numbers / schedule tokens (`mg`, `AUC`, `cycle 1/2`,
`q3w`, `q21`, `dose`) — zero hits. Stage labels ("stage IA") are not dosing.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Verified all three reviser-claimed fixes directly against DeVita ovarian germ-cell passage
(Ch. 52, ~line 178368-178383) and the testicular cross-reference sections (Ch. 47):

- **Beta-hCG / syncytiotrophoblast-like giant cells** — now correctly labelled
  `(general oncology standard, not from DeVita's section on this disease)`. Confirmed the raw claim
  is lifted from Ch. 47's TESTICULAR seminoma passage (~line 166494), not the ovarian dysgerminoma
  passage. Fix verified correct.
- **Alkaline phosphatase marker** — restored alongside LDH in "Monitoring." Confirmed this matches
  DeVita's actual dysgerminoma sentence verbatim ("elaborates lactate dehydrogenase and alkaline
  phosphatase"). Fix verified correct.
- **Gonadoblastoma / Y-chromosome karyotype / bilateral gonadectomy** — now labelled in both
  locations (Treatment approach bullet, When-to-refer bullet). Confirmed the specific
  karyotype/gonadectomy elaboration is not in DeVita's ovarian dysgerminoma passage; the nearest
  DeVita gonadoblastoma content is the TESTICULAR entry (Ch. 47, Table 47.6, ~line 168204) plus a
  one-line mention in the ovarian sex-cord-stromal-tumor paragraph (~line 178416) that names
  gonadoblastoma but never elaborates karyotype/gonadectomy. Label is appropriate either way. Fix
  verified correct.

No new dangerous fabrications introduced by the rewrite. Two pre-existing, non-blocking items
noted for completeness (not new to this pass, not flagged by the prior R1 verdict, and not
therapeutic/regimen claims):
- Opening sentence "the most common malignant ovarian germ-cell tumour" is a true but
  DeVita-unstated ranking; DeVita's passage lists dysgerminoma first among subtypes but never ranks
  by frequency. Cosmetic, not a regimen/drug/trial/statistic claim — optional polish only.
- "When to refer" high-volume-surgeon/guideline-adherence sentence is grounded in DeVita's ovarian
  chapter (Bristow et al. SEER data, epithelial-ovarian-cancer staging section, same chapter) rather
  than the germ-cell passage specifically — same disposition as R1's prior verdict, which already
  accepted this as "checks out against ... the surrounding ovarian-cancer chapter text." Not
  cross-organ contamination like the testicular items, so not re-flagged as a blocker.

Everything else (unilateral/bilateral-in-a-minority phrasing, chemosensitivity/radiosensitivity,
fertility-sparing surgery even with metastases, FIGO stage IA exception, adjuvant
bleomycin-etoposide-cisplatin extrapolated from testicular experience, menstrual-function/pregnancy
prognosis, explicit "DeVita is silent on second-line/cycle-count/surveillance schedule" disclosure)
re-checks out against the cited passage.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." Name only, no page numbers. Correct.

## 4. VERDICT: CLEAN (ready for R1 re-review)
All three previously-held issues are correctly resolved and correctly labelled; no dose leak, no
new fabrication, no mis-attribution to DeVita, citation format correct. Two pre-existing cosmetic
items noted above are optional polish, not blockers.
