# Adversarial verification — laryngeal_cancer.md (wave 5)

Reviewer method: read sidecar in full; grepped DeVita 12th ed extracted text
(`/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`) for "larynx"/"laryngeal"
(Ch. 25, "Cancer of the Larynx and Hypopharynx," lines ~60163-60960) plus the two
flagged general-HN sections: chemoradiation/cetuximab (~13900-13970) and the
"Recurrent or Metastatic Disease" head-and-neck section (~58152-58910, incl.
cetuximab/pembrolizumab/nivolumab/PD-L1 studies).

## 1. DOSE LEAK
None. Grepped the sidecar for all digit occurrences (`grep -nE "[0-9]"`); every hit
is a T/N-stage label (T1-T4, T4a/T4b, N2b, N3), the "12th ed" citation, or a tumor
*volume* threshold ("roughly under 6 mL", matching DeVita's ≤6 mL supraglottic
cut-off) — not a drug dose, mg, mg/m2, AUC, or a numbered fractionation schedule.
Notably the sidecar correctly *omits* several numbers that ARE in DeVita's chapter
for these same claims: the RT fractionation schedules (63/65.25/74.4 Gy etc.), the
"5.5 weeks" TLM-vs-RT duration figure, the University of Florida 3.5 cm3 T3
volume cut-off, the cisplatin "30 mg/m2 weekly or 100 mg/m2 every 3 weeks" adjuvant
regimen, and the voice-rehab outcome percentages (27%/19% TE speech, 50%/57%
electric larynx) — all correctly abstracted to prose ("a meaningful proportion...",
"some centres use a tumour-volume cut-off...").

## 2. UNGROUNDED CLAIMS
None found unsupported and uncontroversial-standard claims are appropriately
flagged inline. Spot-checked against DeVita Ch. 25 and cross-references:
- CIS/early vocal cord TLM vs RT, multiple-recurrence → favor RT: matches text
  ("We recommend RT for patients with multiple recurrences").
- Verrucous carcinoma management: near-verbatim match.
- Early supraglottic ≤6 mL threshold, PET-CT ~3 months post-CRT before neck
  dissection, N2b-N3 combined approach: matches text closely.
- T4a → primary total laryngectomy + adjuvant RT/CRT as consensus-preferred:
  matches ("General consensus guidelines advise primary surgical management...
  for treatment of T4a disease").
- T3 organ preservation vs. laryngectomy "less clear-cut," volume-based
  center-specific cut-offs: matches ("For T3 laryngeal cancers the lines are
  more blurred... tumor volume" — sidecar omits the actual 3.5 cm3 number).
- Postop RT/CRT after total laryngectomy, chemo added for positive
  margins/ENE: matches (numeric cisplatin dose correctly dropped).
- Voice rehab options (TEP/electric larynx/esophageal speech), second-primary
  field-effect risk, laryngeal edema/cord fixation as recurrence signs: all
  match DeVita text closely.
- The two explicitly-flagged claims (concurrent platinum radiosensitization for
  advanced disease; platinum+EGFR-antibody / anti-PD-1 checkpoint inhibition for
  recurrent/metastatic HNSCC) are correctly sourced to DeVita's *other* HN
  chapters, not Ch. 25 — verified: DeVita has a dedicated "Recurrent or
  Metastatic Disease" HN section (~58152-58910) covering cetuximab, pembrolizumab,
  nivolumab, and PD-L1-based selection, and a chemoradiation chapter section on
  cetuximab-radiation combinations (~13930-13970). Both flags are accurate and the
  claims are uncontroversial guideline-standard, not inventions.
- Draft agent's stated omission (no specific R/M systemic sequencing) is the
  right call — DeVita's laryngeal chapter doesn't cover distant metastatic
  disease, and no sequencing claim was fabricated to fill the gap.
- Airway obstruction / tracheostomy as a laryngeal-cancer complication is
  loosely supported (DeVita Ch. 25 mentions "airway obstruction requiring a
  tracheotomy" as a complication elsewhere in the chapter) and is otherwise
  uncontroversial safety guidance.

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's
Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers.

## 4. VERDICT: CLEAN (ready for R1)

No numeric dose/regimen leak. No fabricated regimens, trials, or statistics.
Two general-oncology-standard claims outside the laryngeal-specific chapter are
correctly flagged as such and are verifiably grounded in DeVita's other
head-and-neck sections. Citation format correct. Recommend proceeding to R1.
