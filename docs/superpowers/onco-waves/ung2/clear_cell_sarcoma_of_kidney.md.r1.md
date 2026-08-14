# R1 CLINICAL-SAFETY REVIEW — clear_cell_sarcoma_of_kidney

VERDICT: APPROVE

goldens changed: no (intended: n/a) — narrative content for a reference disease
management field; no engine/dose/interaction/calculator logic touched.

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive. Every clinical statement is hedged
("usual approach", "may have a role case by case", "generally", "where available")
and framed as protocol/MDT-directed, not as a clinician-executable order. The one
potentially harm-adjacent line — "New bone pain, a pathological fracture, or new
neurological symptoms ... should prompt urgent metastatic work-up rather than being
attributed to benign causes" — errs toward safety (lowers the miss threshold for
CCSK's known late bone/brain relapse). No false-negative risk introduced.

## 2. GROUNDING — PASS (clinical), with sourcing caveat (non-blocking)
All specific claims are standard-of-care pediatric renal-tumour oncology and are
clinically uncontroversial:
- Radical nephrectomy as surgical mainstay — standard.
- Upfront nephrectomy vs. neoadjuvant chemo — correct for the COG/North-American
  approach; appropriately hedged as "in contrast to some other paediatric renal
  tumour protocols" (acknowledges the SIOP preoperative-chemo divergence).
- Anthracycline (doxorubicin) + alkylator + vinca-alkaloid backbone, chemo for ALL
  stages incl. stage I, anthracycline cardiac surveillance — standard CCSK regimen
  and monitoring.
- Flank/whole-abdomen RT by stage/spill, RT to bone metastases — standard.
- BCOR internal tandem duplication / YWHAE-NUTM2 molecular confirmation — correct.
- Late bone/brain relapse tropism and surveillance beyond the Wilms window — a
  well-recognised, defining CCSK feature.

## 3. DOSE-FREE — PASS
No mg, mg/m2, AUC, Gy, cycle numbers, or numbered schedules. Confirmed against the
adversarial sweep; the only digits are gene/fusion names and the "12th ed." citation.

## 4. SCOPE — PASS
Consistently decision-support, not directive: everything routes through "refer to a
paediatric oncology centre ... before any treatment is started" and cooperative-group
protocol/MDT assignment. Correct for a rare paediatric malignancy.

## 5. ADVERSARIAL FLAGS — resolved, exception satisfied
The .verdict.md flagged ISSUES: it rated grounding "FAIL as a DeVita-wave
deliverable" because DeVita has no CCSK-of-kidney section and no secondary citation
(NCCN/COG) backs the specific claims. Critically, the verdict also confirmed:
DOSE LEAK = PASS, and FALSE DeVITA ATTRIBUTION = PASS — every claim is explicitly
disclaimed as "(general oncology standard, not from DeVita's section on this
disease)" and the Sources line honestly reports the negative DeVita search.

Per the R1 rule, the "you MUST return REVISE" trigger is overridden here because both
exception conditions are met: (a) the flagged claims are clinically uncontroversial
standard-of-care, and (b) they are already relabelled as general-standard, NOT
DeVita-specific — no claim is mis-attributed to DeVita. The adversarial FAIL is a
corpus-sourcing/process question (should an uncited general-knowledge sidecar enter a
DeVita-labelled corpus), not a clinical-safety, mis-attribution, or dose defect. That
is outside R1's blocking scope and does not warrant blocking merge on safety grounds.

## Advisory (non-blocking)
- Sourcing: add a real pediatric source to the Sources line (NCCN Pediatric/Wilms &
  other renal tumours, or a COG/AREN protocol reference) to convert this from
  "correctly-labelled uncited general standard" to properly cited. Recommend the wave
  owner explicitly accept uncited general-knowledge sidecars for DeVita-uncovered
  diseases, or supply the alternate citation, as the verdict recommended.
- Consider trimming the ~15x repeated disclaimer to a single header-level statement
  for readability; the current repetition is safe but noisy for the end reader.
