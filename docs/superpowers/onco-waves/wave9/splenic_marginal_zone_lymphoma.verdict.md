# Adversarial verification — splenic_marginal_zone_lymphoma.md

1. DOSE LEAK: none. Grepped for mg, mg/m2, mg/kg, AUC, cGy, Gy — no drug-dose or radiation-dose figures found. The source's radiation dose ("150 cGy... three times per week") is correctly omitted, matching the draft's stated intent. The numbered "Lines of therapy" list (1–5) is a sequence-of-care ordering, not an administration schedule — acceptable.

   HOWEVER — flag for R1: the "Role of surgery (splenectomy)" section retains exact numeric response/survival statistics: "overall response rate of 85%, with estimated progression-free and overall survival at 5 years of 58% and 77%, respectively." These are not doses, but they directly contradict the draft agent's own report, which claims "Deliberately omitted: all numeric response-rate/survival-percentage figures... from the source." That claim is false — this is the one place those figures were NOT omitted, while the parallel rituximab-induction sentence (RR 95%, OS/PFS 92%/73% in source) was correctly de-numbered a few lines later. Internally inconsistent application of the same rule within one document. The retained numbers are accurate/grounded (verbatim match to DeVita), so this is not a fabrication, but it is a process-honesty and consistency issue R1 should resolve (strip the splenectomy percentages for consistency, or explicitly decide survival stats are in-scope-to-keep and fix the draft's self-report).

2. UNGROUNDED CLAIMS: none found. Checked against DeVita 12th ed., "Splenic Marginal Zone Lymphoma" section (Ch. 67) plus the general "Marginal Zone Lymphomas" intro and "Nodal Marginal Zone Lymphomas" treatment subsection:
   - Hep C association + antiviral-induced regression — matches source verbatim intent.
   - Observation for asymptomatic disease; treatment triggers (symptomatic splenomegaly/cytopenias) — matches.
   - Splenectomy relief of symptoms/cytopenias — matches (numbers discussed above).
   - Splenic radiation for non-surgical candidates, left kidney in field / renal tolerance — matches source; renal-tolerance dose-planning generality correctly flagged as "general oncology standard, not from DeVita's section on this disease" rather than misattributed.
   - Single-agent rituximab improving splenomegaly/cytopenias in "great majority" of patients — matches source's ">90% of patients."
   - Relapse options (retreatment anti-CD20, alkylating agents, purine analogs + anti-CD20, ibrutinib) — matches source's splenic MZL therapy paragraph exactly (rituximab, alkylating agents, purine analogs + rituximab, ibrutinib).
   - Broader MZL relapsed/refractory extrapolations (BTK inhibitor activity, PI3K inhibitor activity, CD19 CAR-T exploration) — matches the Nodal MZL/general MZL treatment subsection (ibrutinib RR, zanubrutinib/MAGNOLIA, umbralisib PI3K FDA approval, axi-cel ZUMA-5), and is explicitly and correctly flagged in the sidecar as class-level extrapolation rather than splenic-MZL-specific evidence.
   - Transformation red-flag triad and referral triggers — correctly flagged as general oncology standard, not attributed to DeVita's disease-specific text.
   No invented drug names, trial names, or regimens outside what DeVita states for this disease or the class-level MZL discussion it explicitly borrows from with attribution.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: ISSUES (minor, non-blocking-severity but should be resolved before R1 sign-off)
   - Internal inconsistency: splenectomy section retains exact numeric response-rate/PFS/OS percentages (85%, 58%, 77%) while the parallel rituximab-induction sentence a few lines later correctly strips the equivalent numbers (RR 95%, OS 92%, PFS 73% in source). Same rule applied inconsistently within one file.
   - The draft agent's self-report ("Deliberately omitted: all numeric response-rate/survival-percentage figures... from the source") is factually inaccurate for this sidecar — the splenectomy percentages were not omitted. Recommend R1 either strip those three numbers for consistency, or explicitly correct the draft's report if survival stats are intended to be in-scope.
   - No dose leak, no fabricated/ungrounded clinical claims, citation format correct — content is otherwise clean and well-grounded.
