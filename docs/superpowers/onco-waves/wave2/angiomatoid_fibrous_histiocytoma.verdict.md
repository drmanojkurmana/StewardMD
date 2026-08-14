# Adversarial RE-verification — angiomatoid_fibrous_histiocytoma.md (rewrite)

## 1. DOSE LEAK
None. Grepped for mg/mg-m2/AUC/numbered schedules: zero hits. Only numeric
value in the file is the "<2%"/"typically under 2 percent" metastatic-risk
statistic, which is epidemiology and matches DeVita verbatim (line ~211830:
"typically <2%, ... usually to lymph nodes or lung").

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-grepped devita.txt for "angiomatoid" and "AFH" — DeVita's AFH content is
still confirmed to be exactly two mentions: the WHO "intermediate, rarely
metastasizing" tier listing (with plexiform fibrohistiocytic tumour, <2% met
risk, nodal/pulmonary) and the bare name in the classification table. No
dedicated AFH management section exists in the source — this matches the
sidecar's own closing disclosure.

All three items R1 required are now fixed:
- **EWSR1/FUS + Ewing/clear-cell-sarcoma mimic-exclusion claim** (line 11):
  now tagged inline "(general oncology standard, not from DeVita's section on
  this disease)". No longer attributed to DeVita. The parallel referral bullet
  (line 40) carries the same tag.
- **Systemic-symptom ("cytokine-mediated") section** (line 28) and its reuse
  as a monitoring signal (line 34): both now carry "(general oncology
  literature, not from DeVita's section on this disease)". No longer presented
  as DeVita-grounded fact.
- **Cross-tier "wide excision... mirrors" inference** (line 10, minor item):
  now named explicitly in the sentence itself and repeated in the closing
  "What is deliberately not stated here" caveat, which now also explicitly
  discloses the molecular-confirmation and systemic-symptom content as
  non-DeVita additions.

Spot-checked the rest of the file against the source: the WHO-tier framing,
the <2% statistic, and the "no established systemic regimen for AFH" /
"DeVita does not describe a chemotherapy or targeted-therapy pathway for AFH"
statements all match what DeVita actually says (or explicitly says it does
NOT say). The anthracycline-based-regimen mention (line 21) is used only as a
negative example ("do not extrapolate... onto AFH") — it does not assert
AFH is treated this way, so no tag is needed there. No new fabrications were
introduced by the rewrite; no specific drug names, trial names, or regimens
are asserted as AFH-specific anywhere in the file.

## 3. CITATION
Present, unchanged: "Sources: DeVita, Hellman, and Rosenberg's Cancer:
Principles & Practice of Oncology, 12th ed." — name only, no page numbers.
Correct format.

## Other hard-rule check
Em dash in title: fixed. Title now reads "Angiomatoid fibrous histiocytoma
(AFH): Management" (colon, not em dash). Grepped whole file for em/en dashes —
zero hits.

## 4. VERDICT: CLEAN (ready for R1 re-review)
All three R1-required changes (2 required + 1 minor) are correctly applied,
grounded content still checks out against devita.txt, no dose numerics, no
new fabrications, citation intact, em-dash rule satisfied.
