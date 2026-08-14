# Verdict: giant_cell_tumour_of_bone.md

## 1. DOSE LEAK
None. Grepped the full sidecar for mg/AUC/numbered-schedule patterns — no drug dose, interval, or loading schedule appears anywhere. The sidecar explicitly states "No specific drug dose, interval, or loading schedule is reproduced here." This is notable because DeVita's own source paragraph (line ~32095-32106) DOES contain a dose ("subcutaneous administration of 120 mg every 4 weeks with additional loading doses on days 8 and 15 of the first cycle") — the sidecar correctly omitted it rather than leaking it.

The trial statistics "187 patients" / "47 (25 percent)" objective partial response are outcome/efficacy numbers from the approval trial, not a dose or schedule — these match DeVita verbatim (see below) and are not a dosing leak.

## 2. UNGROUNDED CLAIMS
None found. Checked each specific/quantitative claim against DeVita (12th ed) text at /Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt:
- "Denosumab (Xgeva)... fully human IgG2... neutralises RANK ligand (RANKL)" — matches DeVita verbatim (line ~32095).
- "FDA approved for adults and skeletally mature adolescents whose GCTB is surgically unsalvageable, or where resection would be expected to cause severe morbidity" — matches DeVita verbatim (line ~32096-32098).
- "Approval rested in part on open-label phase II trial data... 187 patients, 47 (25 percent) achieved an objective partial response by modified RECIST" — matches DeVita verbatim (line ~32103-32106): "two open-label phase II trials... Of 187 patients, 47 (25%) exhibited objective partial responses based on modified Response Evaluation Criteria in Solid Tumors."
- "stopping denosumab has been associated with a higher rate of subsequent local recurrence" — matches DeVita (line ~32106-32107).
- "questions remain open around long-term safety, optimal maintenance dosing frequency, and overall therapeutic strategy" — matches DeVita (line ~32107-32109).
- "giant cell tumour of bone, malignant" as a distinct WHO-style entity — confirmed present in DeVita's bone-sarcoma classification list (line 220417, under "Osteoclastic-giant cell rich").
- Denosumab/GCTB/2013 approval-timeline table entry — confirmed at line ~31218-31220.

All other claims (surgery as first-line, curettage vs. en-bloc resection, MDT referral, radiographic surveillance, pulmonary-deposit screening, pre-op downstaging use of denosumab) are explicitly and correctly labeled inline by the draft agent as "general oncology standard, not from DeVita's section on this disease" — not misattributed to DeVita, and each is uncontroversial standard-of-care, not a specific/fabricated regimen or statistic. No invented trial names/numbers, no fabricated statistics.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers, as required.

## 4. VERDICT
CLEAN (ready for R1). No dose leak, no unsupported/fabricated regimen or statistic, correct DeVita-vs-general-standard attribution throughout, citation format correct.
