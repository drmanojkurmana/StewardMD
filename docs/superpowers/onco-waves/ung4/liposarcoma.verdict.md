# Adversarial re-verification verdict - liposarcoma.md (ung4)

Sidecar: `docs/superpowers/onco-waves/ung4/liposarcoma.md` (post-revision, R1's single blocking issue
addressed by reviser)
Verified against: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt` (DeVita 12th ed, Chapter 60
Soft Tissue Sarcoma)

## 1. DOSE LEAK
None. Grep for mg/mg-m2/Gy/AUC/qXd/cycle/schedule patterns in the sidecar body returns nothing except
the meta-statement "No specific drug doses, radiation dose numbers, or infusion schedules are given
(dose-free by design)." No numeric dose, radiation dose, or infusion schedule anywhere in the file.

## 2. UNGROUNDED / MISLABELLED CLAIMS

- **R1's blocking issue: verified fixed.** Monitoring bullet 1 previously inverted DeVita's finding
  (had claimed high-grade/dedifferentiated/retroperitoneal disease drives beyond-5-year recurrence,
  contradicting both DeVita and the sidecar's own Surgical bullet 4). It now reads: high-grade disease
  recurs earliest/most frequently, but low-grade (WD/myxoid) liposarcoma keeps accruing risk latest and
  drives the highest beyond-5-year disease-specific death, so long-term follow-up matters especially for
  that low-grade group. This matches DeVita's retroperitoneal-sarcoma section verbatim in substance:
  "The probability of disease-specific death after >5 years was highest for LMS and low-grade
  liposarcoma, emphasizing the need for long-term follow-up in these patients" (devita.txt ~L214843-846),
  and the matching local-recurrence data (high-grade 58% by 5y vs. WD/myxoid 39% by 5y -> 60% by 15y,
  ~L214826-831). It is now internally consistent with the sidecar's own Surgical-management bullet 4.

- No other new or residual issues found on this pass. Re-checked every specific claim in the file against
  devita.txt:
  - WD/ALT-of-extremity minimal-margin rule, amputation criteria, wide-en-bloc-resection description:
    verbatim/near-verbatim match (devita.txt ~L5010-5027 region of ch.60).
  - Retroperitoneal completeness-of-resection/grade as strongest independent predictors, incomplete
    resection survival parity with unresectable disease, liposarcoma's 2.6-fold higher local-recurrence
    risk vs. other histologies in the retroperitoneum: matches the 278-patient and 675-patient series
    text (~L214803-214831).
  - Myxoid radiosensitivity + investigational reduced-dose preoperative RT trial: matches DeVita's
    "exquisitely radiosensitive" / 97.7% 5-yr LRFS statement and the cited Dutch dose-reduction trial
    (~L215267-215276); sidecar correctly declines to reproduce the Gy figures.
  - Anthracycline +/- ifosfamide as first-line advanced disease; trabectedin and eribulin randomized-trial
    claims (subtype-selective response, PFS/OS benefit vs. dacarbazine, subgroup-driven approvals, less
    trabectedin benefit in DDLPS): match DeVita's systemic-therapy section (~L216830-216880) with no
    numeric endpoints reproduced.
  - Pazopanib PALETTE trial excluding adipocytic tumors: matches ("369 patients with metastatic
    nonadipocytic soft tissue sarcoma," ~L216820-216825); correctly left untagged as DeVita-sourced.
  - CDK4/MDM2 amplification in WD/DDLS + palbociclib activity, MDM2/CDK4 combined-inhibition
    investigation: matches DeVita's sarcoma-chapter-specific discussion of CDK4-amplified WDLS/DDLS
    trials (not merely the general CDK4/6-inhibitor chapter), so attributing this to DeVita's own section
    on this disease is accurate, not mislabelled.
  - Myxoid/round-cell metastatic pattern to fat-pad regions (retroperitoneum, axilla) and bone (pelvic,
    spinal) without pulmonary involvement, plus extremity->lung vs. retroperitoneal/visceral->liver
    pattern: near-verbatim match to DeVita's "Imaging Sites of Metastasis" passage (~L213215,
    ~L214828-214833).
  - Preoperative-chemo-for-high-grade claim (round-cell/pleomorphic LPS + UPS): remains correctly scoped
    per R1's prior sign-off, with the chemosensitivity/downstaging aside correctly tagged
    "(general oncology standard, not from DeVita's section on this disease)".
  - Referral criteria and routine-surveillance-cadence bullets remain correctly tagged as general
    oncology standard, not DeVita-attributed.

No em dashes/en dashes found anywhere in the file.

## 3. CITATION
Present, one line at the end: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
of Oncology, 12th ed." Name only, no page numbers. Compliant.

## 4. VERDICT
**CLEAN** - ready for R1 re-review. The sole outstanding issue from the prior pass (Monitoring bullet 1
inverting DeVita's beyond-5-year recurrence/mortality finding) is fixed and now aligned with both DeVita
and the sidecar's own Surgical-management bullet 4. No dose leaks, no unresolved mis-attributions, no
em-dash, citation format compliant.
