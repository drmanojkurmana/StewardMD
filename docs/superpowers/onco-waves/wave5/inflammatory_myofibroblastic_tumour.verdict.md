# Adversarial verification — Inflammatory Myofibroblastic Tumour sidecar

Sidecar: `docs/superpowers/onco-waves/wave5/inflammatory_myofibroblastic_tumour.md`
Grounding source checked: DeVita 12th ed, dedicated "Inflammatory Myofibroblastic Tumor"
section at devita.txt line 212806–212846, plus ROS1-fusion background mention at line 22985.

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `AUC`, `q_day/week`, `cycle`, `day 1` patterns — zero hits.
The numbered "Lines of therapy" list (1–4) is a treatment-sequence outline, not a dosing
schedule — no frequencies, cycle lengths, or drug quantities anywhere in the file.

## 2. UNGROUNDED CLAIMS
All specific numeric/statistical claims trace directly to the DeVita section, near-verbatim:
- ALK rearrangement rate 50–60%, exclusively age <40 → matches DeVita "50% to 60%... almost
  exclusively in patients under 40."
- RANBP2/TPM3 N-terminal fusion partners, inflammatory cells lack ALK fusion, RANBP2/RRBP1-ALK
  → epithelioid IMT sarcoma variant → matches DeVita verbatim (refs 79–81).
- ROS1/NTRK3/rare RET/PDGFRB in ALK-negative subset → matches DeVita (ref 82).
- Curative resection ~75%, metastasis <5%, local recurrence > distant spread → matches DeVita.
- Paraneoplastic syndrome ~33% (fever, growth failure/weight loss, malaise, anemia,
  thrombocytosis) → matches DeVita's "Approximately 33%... fever, growth failure, malaise,
  weight loss, anemia, and thrombocytosis."
- Crizotinib RECIST responses in ALK-positive IMT; crizotinib activity vs ROS1; case-report-level
  responses to brigatinib/ceritinib/lorlatinib on progression → matches DeVita verbatim
  ("Case reports of IMT response to other ALK inhibitors such as brigatinib, ceritinib, and
  lorlatinib... acquired resistance to crizotinib").
- ALK-negative disease = palliative intent, rarely fatal, 5-year survival ~87% → matches DeVita
  exactly ("5-year survival of 87%").

Claims correctly self-flagged by the draft agent as NOT from DeVita's IMT section (labelled
inline as "general oncology standard, not from DeVita's section on this disease"):
- Neoadjuvant kinase-inhibitor trial before reattempting surgery for borderline-resectable
  disease (lines 28–32).
- Extending kinase-inhibitor logic to NTRK3/RET/PDGFRB-driven ALK-negative IMT beyond what
  DeVita states (lines 39–43) — DeVita only names crizotinib's activity against ALK and ROS1.
- Sarcoma MDT referral recommendation (lines 71–74).
This is honest hedging, not fabrication — the claims themselves are uncontroversial
guideline-standard oncology practice, and they are explicitly labelled as extrapolation rather
than presented as DeVita content. No claim in the file is presented as DeVita-sourced without
support.

One residual check: the sidecar states DeVita's section "does not describe a defined role for
radiotherapy in IMT" (line 50-51) — confirmed true; no RT mention appears anywhere in the
212806–212846 span (RT is discussed for the preceding, unrelated DFSP entry at line 212792, not
for IMT).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN — ready for R1. No dose leak, all specific statistics/claims are grounded in DeVita's
dedicated IMT section (verified near-verbatim above), and every extrapolation beyond that
section is explicitly self-labelled as general-standard/non-DeVita rather than misattributed.
