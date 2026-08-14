# Verification verdict — numb_chin_syndrome.md

1. DOSE LEAK: none. Grepped for mg, mg/m2, AUC, Gy, q#, cycle, dose, schedule
   patterns across the whole file — every hit is either the phrase "general
   oncology standard" disclaimer, the "12th ed." citation, or the sentence
   stating doses/schedules were intentionally omitted. No numeric
   dose/AUC/fractionation/cycle-count anywhere.

2. UNGROUNDED CLAIMS: none beyond what the sidecar itself already discloses.
   Verified independently: DeVita (devita.txt) has zero hits for "numb chin
   syndrome," "mental neuropathy," or "chin syndrome." The only "mental
   nerve" hits (lines ~62999, 63016) are in the lip/oral cavity cancer
   chapter, describing perineural invasion of the mental nerve by primary
   lip SCC — a different clinical entity (local tumor spread) from
   paraneoplastic/metastatic numb chin syndrome. The sidecar correctly
   excludes this as a source and labels every substantive claim "(general
   oncology standard, not from DeVita's section on this disease)." All such
   claims (breast/prostate/lymphoid causes, MRI/orthopantomogram/CSF workup,
   leptomeningeal management, gabapentinoid symptom control, referral
   triggers) are uncontroversial standard-of-care statements, not
   invented regimens, trial names, or statistics. No specific regimen name,
   response rate, or survival statistic is asserted anywhere — the sidecar
   explicitly states these were omitted for lack of grounding. Note: DeVita
   does have a real "Leptomeningeal Metastases" section (~p.1641-1642,
   107 "leptomeningeal" hits total) that could have been cited for the LM
   management bullet, but the sidecar chose not to attribute it there either
   — a conservative choice, not a fabrication risk.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer:
   Principles & Practice of Oncology, 12th ed. (searched, no dedicated
   section found for this entity)." Name only, no page numbers, correctly
   flags the absence of a dedicated source section.

4. VERDICT: CLEAN (ready for R1). No dose leak, no fabricated regimens/
   trials/statistics, honest and self-flagged grounding gap, correct
   12th-ed. citation format.
