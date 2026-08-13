# Verdict: radiation_pneumonitis.md (Wave 8)

## 1. DOSE LEAK
No chemo drug dose (mg / mg-m2 / AUC) or numbered chemo schedule anywhere.

One radiotherapy planning metric is present and should be called out for R1's judgment:
- "the volume of lung receiving 20 Gy or more (V20) ... keep V20 below roughly 30% to 35% to keep pneumonitis risk under about 20%" — contains a specific radiation dose (**20 Gy**) plus two percentages. This is verbatim-supported by DeVita (line ~72998, "V20 be kept below 30% to 35% in order to keep the risk of pneumonitis <20%") and is a radiation-oncology planning/consensus (QUANTEC-style) parameter, not a prescribable drug dose — but it is technically a numeric dose value, so flagging rather than silently passing it.

All other numbers in the doc (5%-50% incidence, 0-18 months onset, peak ~2 months, ~10% or lower in recent series, imaging timeline 1-6/4-12/6mo-years) are epidemiology/timing figures, not treatment doses.

## 2. UNGROUNDED CLAIMS
None found that lack DeVita support or an explicit "general oncology standard" disclosure. Checked against DeVita lines 68408-68429 (Radiation Pneumonitis and Pulmonary Fibrosis, lung chapter), 72992-72999 (RP rate / V20 dose-limit data), and 98341-98351 (esophageal-chapter toxicity section):
- Incidence 5%-50%, onset 0-18mo/peak 2mo, presentation (cough/dyspnea/fever/fatigue), imaging timeline, SBRT vs conventional volume risk, lower-lung-field risk, age/concurrent-chemo risk (docetaxel, gemcitabine, carboplatin+paclitaxel) — all verbatim/near-verbatim matches to DeVita text.
- Glucocorticoid first-line, taper slowly, rule out infection first, no proven fibrosis-reversing therapy, prophylactic antibiotics/anticoagulants ineffective — all matched.
- ~10%-or-lower recent-series rate and V20 <30-35% / risk <20% — matched to the supplementary passage (lines 72992-72999).
- Every claim NOT in DeVita (mild-disease observation, steroid-sparing immunosuppression as an escalation class, distinguishing immune-related pneumonitis on checkpoint inhibitors, tracking oxygenation/pulse-ox) is explicitly labeled "(general oncology standard, not from DeVita's section on this disease)" — correctly disclosed, not passed off as DeVita content.
- No specific trial names, response-rate statistics, or fibrosis-reversal/mortality numbers are asserted — consistent with the draft agent's stated omissions.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1), with one flag for R1 to sign off on:
- The V20/20 Gy dose-volume metric (see DOSE LEAK section above) is DeVita-sourced and is radiotherapy planning data rather than a prescribable drug dose, but it is a literal numeric dose — R1 should confirm this class of number is acceptable for the KB sidecar or should be stripped/generalized (e.g., "keep lung volume receiving high-dose radiation below the consensus threshold") if the no-numeric-dose rule is meant to be absolute.
