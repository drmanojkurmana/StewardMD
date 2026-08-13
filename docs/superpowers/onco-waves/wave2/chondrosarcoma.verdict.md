# Verdict: chondrosarcoma.md (Wave 2, adversarial review)

## 1. DOSE LEAK
None. All digit occurrences in the file are non-dose:
- Line 17: "grade 1" (histologic grade)
- Line 24: "grade 2-3" (histologic grade)
- Line 70: "IDH1/IDH2" (gene names)
- Line 101: "12th ed." (citation edition)

No mg, mg/m2, AUC, Gy/CGE, %, cycle count, or numbered q-schedule anywhere in the document.

## 2. UNGROUNDED CLAIMS
The draft agent's own grounding report is materially wrong and undersold what's in the dump — worth
flagging to R1 even though it errs toward under- rather than over-claiming. `grep -ni chondrosarcoma`
on the DeVita dump returns ~250 hits, and far more than "1 substantive body-text line" are real
clinical body text, not index entries:
- Ch. 61 "Sarcomas of Bone" (pp. 1147-1149, ~lines 220805-221070 and 222616-222741 in the dump):
  grade-based epidemiology/survival (>90% 5-yr survival grade 1 vs. 77% grade 3 vs. 7-24% for
  dedifferentiated), IDH1/IDH2 mutation biology, and — directly on point — curettage+burring+adjuvant
  (hydrogen peroxide/argon beam)+cement packing for grade 1 lesions vs. resection for grade 2/3,
  high-grade/dedifferentiated chondrosarcoma grouped with other high-grade bone sarcomas for surgical
  planning.
- Ch. 64 "Neoplasms of the CNS" (pp. 1315-1318, ~lines 243338-243620): a dedicated skull-base
  chondrosarcoma section (surgery, proton/particle-beam RT, actuarial 8-year LC/OS 90%/94% at Paul
  Scherrer, deferred-RT-vs-immediate-RT strategy) plus a phase I ivosidenib (mutant-IDH1 inhibitor)
  trial in 21 patients with advanced IDH1-mutant chondrosarcoma (mPFS 5.6 mo).

Checking the sidecar's specific claims against this actual body text:
- Grade-based curettage (grade 1) vs. wide resection (grade 2-3) — **grounded**, matches DeVita
  ch. 61 almost exactly (adjuvant agent examples differ — phenol/cryotherapy vs. DeVita's hydrogen
  peroxide/argon beam — but these are interchangeable, uncontroversial standard adjuvants in
  orthopaedic oncology, not fabricated).
- Dedifferentiated chondrosarcoma driving prognosis, poor outcomes regardless of treatment —
  **grounded** (7-24% 5-yr survival cited in DeVita).
- Radioresistance to standard photon RT / chemoresistance of conventional low-to-intermediate-grade
  chondrosarcoma — **grounded** verbatim ("GIST, ASPS, and low- to intermediate-grade chondrosarcoma
  are notorious for their resistance to standard cytotoxic chemotherapy agents," DeVita ch. 60).
- Proton/particle-beam RT for skull-base chondrosarcoma — **grounded** (DeVita ch. 64).
- Dedifferentiated systemic therapy "extrapolating... anthracycline-based or platinum-containing
  combinations" — reasonable, hedged extrapolation from the general STS chemo section (doxorubicin/
  ifosfamide/cisplatin), explicitly flagged by the sidecar as not chondrosarcoma-specific trial
  evidence. Not fabricated.
- Mesenchymal chondrosarcoma "small-round-blue-cell/sarcoma-type regimens" — hedged, not asserted as
  sourced; DeVita does describe mesenchymal chondrosarcoma as a translocation-associated high-grade
  entity grouped conceptually with round-cell tumors, consistent with the hedge.
- IDH1/IDH2 disclaimer ("did not surface grounded evidence of an established IDH-targeted standard
  of care") — technically accurate (DeVita's only IDH1 data is a phase I dose-escalation/expansion
  trial in 21 patients, not an approved standard of care), but the sidecar is silent on the fact that
  this trial (and its PFS numbers) exists in DeVita at all. This is an **omission of available
  DeVita content**, not a fabrication — the sidecar under-claims rather than over-claims. Flag for
  R1 as a completeness gap, not a trust issue.
- Also omitted: DeVita's phase II pembrolizumab checkpoint-inhibitor data noting dedifferentiated
  chondrosarcoma as one of the more likely-to-respond histologies (ch. 60) — again an omission, not
  a fabrication.
- No specific drug/trial/statistic is asserted by the sidecar that lacks DeVita or uncontroversial-
  guideline support. Every place the sidecar reaches for a drug class or regimen, it explicitly hedges
  ("this content set did not surface trial-level evidence...", "should be treated as guideline-general
  rather than fully sourced").

Net: the sidecar text itself contains no fabricated regimen, dose, trial name, or statistic. Its
"FLAG needs manual sourcing" self-assessment (via the draft agent) is overly pessimistic about how
much of the surgical/grading content actually is grounded — that cuts in favor of trustworthiness,
not against it — but R1 should know real DeVita chapter text exists here and could tighten a few
of the sidecar's hedges (grading/curettage-vs-resection, chemoresistance, proton RT for skull base)
from "guideline-general" to "DeVita-grounded."

## 3. CITATION
Present. Closing line: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed." — name only, no page numbers. It also adds "NCCN Guidelines (bone cancer)" as a
secondary source for guideline-general statements (grading, surveillance, referral) — consistent with
the pattern seen in sibling wave-2 verdicts (e.g. chondroblastoma.md), where NCCN is cited loosely for
uncontroversial principles rather than pinned specifics. Not a fabrication risk, but same caveat as
that sibling review: treat "NCCN Guidelines (bone cancer)" as a generic/approximate attribution, not a
verified pinned source, since no specific NCCN statement/table is quoted.

## 4. VERDICT: CLEAN (ready for R1)
No dose leak. No fabricated regimen, drug, trial, or statistic — every specific claim either matches
real DeVita body text (grade-based curettage/resection, chemoresistance, proton RT for skull base,
dedifferentiated prognosis) or is explicitly and honestly hedged as guideline-general/unsourced
(dedifferentiated/mesenchymal systemic therapy, IDH-targeted therapy, surveillance interval).

Notes for R1:
- The draft agent's grounding assessment undersold real DeVita content (ch. 61 pp. 1147-1149,
  1161-1164; ch. 64 pp. 1315-1318 all have substantive body text) — R1 could upgrade several
  "guideline-general" hedges to DeVita-cited if desired, but this is an opportunity, not a defect.
- Sidecar omits two pieces of real DeVita content it could have used: (1) the phase I ivosidenib
  (mutant-IDH1 inhibitor) trial data for advanced IDH1-mutant chondrosarcoma, and (2) pembrolizumab
  checkpoint-inhibitor response signal noted specifically for dedifferentiated chondrosarcoma. Both
  omissions are conservative (under-claiming), not fabrications.
- Treat "NCCN Guidelines (bone cancer)" citation as generic/approximate, consistent with sibling
  wave-2 verdicts' treatment of NCCN attributions.
