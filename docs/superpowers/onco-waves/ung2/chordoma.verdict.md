# Verdict: chordoma.md (re-review, adversarial, round 3)

## 1. DOSE LEAK
None. Grepped the sidecar for digits: only "10-year" (survival timeframe, line 7 — matches
DeVita's "10-year DFS of 95%" with the percentage stripped), "IDH1" (gene name, line 25), and
"12th ed." (citation edition, line 43). No mg / mg-m2 / mg-kg / Gy / CGE / AUC / % / numbered
schedule anywhere. Every dose-bearing figure DeVita's chapter actually gives (74 CGE, GTV
<25 cc, 7-yr LC 71%/OS 92%, proton 57 Gy vs photon 63 Gy brainstem dose, imatinib CBR 64%,
ivosidenib PFS 5.6 mo/40% at 6 mo, chondrosarcoma 10-yr DFS 95%, SRS 10-yr PFS 35%/OS 70%,
20 Gy/24 Gy SRS marginal doses, GTR rates 43-72%) remains correctly stripped. Clean.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-read the full grounded chapter verbatim (DeVita 12th ed., Ch. 64 "Chordomas and
Chondrosarcomas," pp. 1315-1318, at line ~243360 of devita.txt) and re-cross-checked every
clinical claim against it, focusing on the two fixes just applied.

**Fix 1 (line 17, prognostic-factor mis-attribution) verified correct.** Sidecar now reads:
"Favourable prognostic factors for local control include a smaller residual tumour volume,
adequate target dose coverage, and absence of optic apparatus compression" — "or brain stem"
has been deleted. This now matches DeVita's chordoma-specific sentence exactly: "extent of
residual tumor (GTV <25 cc, adequate target dose coverage and absence of optic apparatus
compression." Confirmed that "brain stem abutment" appears in DeVita only in the separate,
chondrosarcoma-specific sentence ("prognostic factors for local control for skull base
chondrosarcoma include tumor volume..., without optic apparatus/brain stem abutment and
younger age"), so removing it from the chordoma list is the correct fix, not a new omission
of a real chordoma factor. PASS.

**Fix 2 (line 33, chest-imaging logic) verified correct.** Sidecar now reads: "...together
with a routine baseline chest x-ray; ... further staging imaging beyond the primary site and
the chest x-ray is not typically required unless metastatic disease is suspected clinically."
This now matches DeVita's actual construction: "imaging beyond the primary site other than a
chest x-ray is typically not indicated unless metastatic disease is suspected clinically" —
chest x-ray is the routine/baseline study; only additional imaging beyond it is conditional
on suspicion. The previous inversion (chest imaging itself contingent on suspicion) is gone.
PASS.

**Everything else re-checked clean, no new issues found:** overview/no-validated-prognostic-
factors framing, chondrosarcoma-vs-chordoma IHC distinction (keratin/EMA vs S100, exact %s
correctly stripped), chondrosarcoma more-favourable-outcome + MRI-surveillance-vs-immediate-RT
equivalence, surgery/GTR rationale, dural invasion ~50% + reoperation-on-recurrence (correctly
scoped to chordoma, not chondrosarcoma), chondrosarcoma paramedian surgical strategy,
particle-beam (proton/carbon-ion) superiority rationale, SRS role for skull-base and spinal
disease, imatinib clinical-benefit-rate framing + imatinib/sirolimus salvage on progression,
ivosidenib phase I correctly scoped to IDH1-mutant chondrosarcoma only (not chordoma),
PARP/HR-deficiency rationale, PD-L1/TIL checkpoint rationale, brachyury/TBXT
drug-in-clinical-use hedge (line 29), germline-TBXT hedge (line 41), natural-history hedge on
recurrence/late metastasis (line 33) — all textually supported or correctly labelled
"(general oncology standard, not from DeVita's section on this disease: ...)". No claim is
mis-attributed to DeVita.

## 3. CITATION
Present (line 43): "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
of Oncology, 12th ed." — name only, no page numbers. PASS.

## 4. VERDICT
**CLEAN — ready for R1 re-review.** Both issues from the prior round (chondrosarcoma-borrowed
"brain stem" prognostic factor at line 17; chest-imaging suspicion-logic inversion at line 33)
are verified fixed against the DeVita source text. Dose-free, citation format correct, no new
fabrication or mislabelling introduced by the two surgical edits.
