# Adversarial verification verdict — radiation_proctitis

Sidecar: `docs/superpowers/onco-waves/wave9/radiation_proctitis.md`
DeVita grep hits used: lines ~159877–159930 (prostate-RT "Side Effects Post Radiotherapy" — acute urethritis/cystitis/proctitis mgmt, late rectal toxicity, argon-beam coagulation, hyperbaric O2, rectal spacer/ASCENDE-RT) and ~327179–327190 ("Radiotherapy-Induced Diarrhea" — acute vs. late radiation enteritis/proctitis timing).

## 1. DOSE LEAK
None. Grepped all digit runs in the file: only "3" in "grade 3 or higher" (a toxicity-grade classifier, not a dose) and "12th" in the citation (edition number, permitted). No mg, Gy/cGy, mg/m2, AUC, or numbered fraction/session schedule anywhere. Notably the sidecar correctly *omits* DeVita's own numeric details it could have leaked (hyperbaric O2 "2.4 atmospheres, median 36 sessions, 90 min/session"; ASCENDE-RT's "350%/216% increase" toxicity figures; "≤1%–2%" severe toxicity rates) — these were paraphrased qualitatively instead.

## 2. UNGROUNDED CLAIMS
- "Radiotherapy itself is generally continued through mild-to-moderate acute proctitis; treatment breaks are reserved for more severe symptoms, decided jointly with the treating radiation oncologist" (line 12) — not found verbatim in DeVita's proctitis-specific passages (DeVita discusses treatment breaks/interruptions elsewhere, e.g. oxaliplatin CFI, split-course historical RT, but not this specific proctitis-continuation statement). It is standard radiation-oncology practice and uncontroversial, but it is not directly traceable to the grepped DeVita text — flagging as a minor unsourced-but-plausible generalization rather than a fabrication.
- All other non-DeVita-sourced items (sucralfate, formalin, iron studies/transfusion, surgical referral threshold, DDx exclusion list, endoscopic follow-up favoring visual over biopsy) are explicitly self-labeled in the sidecar as "general oncology standard, not from DeVita's section on this disease" — each is uncontroversial guideline-standard management, so the labeling is honest and appropriate rather than a silent fabrication.
- No invented trial names, statistics, or regimens found. ASCENDE-RT is named and matches DeVita's own description of that trial (dose-escalated EBRT vs. EBRT + LDR brachy boost, increased late GI/GU toxicity) without borrowing its specific percentages.

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers.

## 4. VERDICT: CLEAN (ready for R1)

Rationale: zero numeric dose/schedule leakage (and demonstrable deliberate omission of DeVita's own leakable numbers); core claims (acute proctitis timing/management, late rectal toxicity mechanism and timing, argon-beam coagulation, hyperbaric O2 rationale, biopsy/fistula-risk caution, rectal spacer and brachy-boost toxicity trade-off) are well grounded in the two DeVita passages; non-DeVita claims are transparently self-labeled as general-standard rather than passed off as text-sourced. One minor unlabeled generalization (RT continuation through mild-moderate proctitis) is clinically uncontroversial and not a fabrication risk — worth a one-line label fix but not blocking.
