# Adversarial verification verdict: mesothelioma.md

Reviewer: independent verification pass (not the drafting agent).
Grounded against: /Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt,
DeVita Ch. 76 "Benign and Malignant Mesothelioma" (Treatment section onward,
approx. lines 292025-293345: Controversy Regarding Surgical Management,
Multimodality Therapy and MPM, Induction Therapy, Novel Surgical Multimodality
Therapies, Induction Checkpoint Inhibition Trials, Unresectable Systemic
Therapy, Antiangiogenic Therapies, Frontline Trial FDA Approvals, Frontline
Immunotherapy Trials, Salvage Systemic Therapy, Novel and Cellular Therapies,
The Role of Radiotherapy).

## 1. DOSE LEAK
Grepped every digit in the sidecar (`grep -nE '[0-9]'`). Hits are only:
"EPD" (line 22, not a dose), "MARS 2" (line 37, trial name), "PD-1"/"CTLA-4"
(multiple lines, receptor names), "R0" (line 22, resection grade), "12th ed"
(line 150, citation edition number).
**None** are a dose, mg, mg/m2, AUC, Gy, cycle count, or a numbered schedule.
Verdict: **no dose leak.**

Also confirmed: no em dash anywhere in the file (`grep -n '—'` = no matches).

## 2. UNGROUNDED / QUESTIONABLE CLAIMS

- **CONFIRMED grounding problem (radiotherapy section, bullet 4):** the
  sidecar states hemithoracic pleural IMRT/IMPRINT "outcomes compared with
  older techniques have not shown a clear survival difference in database
  comparisons." DeVita's own text contains two different comparisons here:
  (a) an NCDB study of 3D-CRT vs. IMRT broadly, which found no outcome
  difference (supports the sidecar); but (b) a separate MSKCC retrospective
  of 209 P/D patients comparing IMPRINT vs. conventional postoperative RT
  technique, which found "OS was significantly higher with IMPRINT versus
  conventional techniques," with trimodal P/D+chemo+IMPRINT reaching 42% OS
  at 2 years. The sidecar's blanket "no clear survival difference" claim is
  directly contradicted by this second, disease/technique-matched study in
  the same chapter. This reads as selective citation (picked the null result,
  omitted the positive one) rather than fabrication of a new fact, but it is
  not accurately grounded as written. Recommend either dropping the "no
  clear difference" framing or noting the mixed/conflicting database evidence
  explicitly (as the sidecar correctly does elsewhere, e.g. the earlier
  "definitive RT alone... conflicting results" bullet).

- **Minor compression, not fabrication:** the "Definitive radiotherapy alone
  ... conflicting results" bullet blends a SEER analysis that was actually
  about surgery-alone vs. no-treatment vs. surgery+RT (not RT-alone vs.
  no-treatment) with an NCDB analysis that was genuinely about definitive RT.
  The net claim (conflicting database evidence on RT's role) is directionally
  supported by DeVita, but the specific attribution is loosely paraphrased.
  Low severity; flagging for awareness, not blocking.

- Everything else spot-checked (MARS/MARS 2, EPP vs. P/D/EPD mortality and
  registry subgroup benefit, multimodality/induction chemo sequencing,
  intracavitary approaches as investigational, neoadjuvant checkpoint
  inhibition as trial-only, histology-driven frontline split (CheckMate 743,
  non-epithelioid benefit), antifolate-platinum doublet as SOC with
  carboplatin/single-agent substitutions, bevacizumab/MAPS trial framing
  (OS benefit, no regulatory approval, limited adoption), TTFields/STELLAR
  device approval via single-arm trial, maintenance pemetrexed/CALGB 20901
  null result, salvage sequencing by prior therapy (PD-1 +/- CTLA-4 after
  chemo; platinum-antifolate +/- anti-VEGF after frontline IO), gemcitabine/
  vinorelbine + ramucirumab RAMES trial framed as unconfirmed, single-agent
  CTLA-4/DETERMINE null result, "give everyone a checkpoint inhibitor
  eventually" statement (near-verbatim to DeVita's own conclusion), rare
  ALK-fusion and BAP1/PARP targeted-therapy caveats, CAR-T/mesothelin
  cellular-therapy limitations, RT rarely curative due to dose/toxicity
  tradeoff, EPP+adjuvant hemithoracic RT toxicity including fatal
  pneumonitis, chemo+definitive RT as experimental) all found clear,
  faithful support in the DeVita text at the cited location. No invented
  trial names, drug names, or statistics detected.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." (line 150). Name-only, no page numbers. Meets
requirement.

## 4. VERDICT
**ISSUES (minor) — not a clean pass, but not fabrication either.**

- Dose-leak check: clean (no numbers of concern).
- Em-dash check: clean.
- One radiotherapy bullet overstates a "no clear survival difference"
  finding that is contradicted by a same-chapter, technique-matched MSKCC
  study showing a significant IMPRINT survival benefit — needs a wording
  fix (acknowledge the conflicting/mixed evidence, don't flatten to "no
  difference") before this goes to R1 as-is.
- One other bullet (definitive RT alone) loosely conflates two different
  DeVita studies; low severity, optional cleanup.
- No other ungrounded regimens/trials/statistics found; citation line
  present and correctly page-number-free.

Recommendation: send back for a one-line wording fix on the IMPRINT/older-
technique bullet, then it is ready for R1. Everything else clears.
