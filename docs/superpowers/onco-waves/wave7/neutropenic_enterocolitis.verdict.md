# Adversarial verification verdict — neutropenic_enterocolitis.md

Checked against: DeVita 12th ed., Chapter 92 "Diarrhea and Constipation" — "NEUTROPENIC COLITIS" (Clinical Presentation/Pathogenesis/Diagnostic Investigations, pp.1729) + "MANAGEMENT OF NEUTROPENIC ENTEROCOLITIS" (pp.1732-1733).

## 1. DOSE LEAK
Grepped the sidecar for mg/mcg/µg/g/AUC/%/mm/hour/"q"-schedule numbers. Two numeric hits, neither is a drug dose:
- Line 18/54: "96 hours" — this is the fluoropyrimidine-exposure *trigger window* ("if neutropenic enterocolitis develops within about 96 hours of a fluoropyrimidine dose"), directly mirroring DeVita's own diagnostic/applicability criterion ("If neutropenic enterocolitis occurs within 96 hours of administration of fluoropyrimidines..."). It is not the antidote's dose or schedule — DeVita's actual antidote dose/schedule ("uridine triacetate ... 10 g orally every 6 hours for 20 doses") is correctly and explicitly omitted (line 18: "schedule/dose intentionally omitted here"). Borderline but acceptable — it's a clinical-trigger fact, not a dosing instruction.
- Line 28: "10 mm" — bowel-wall-thickness imaging threshold tied to a surgical indication ("Bowel wall thickness greater than roughly 10 mm ... has been proposed as an added indication"), matches DeVita verbatim ("Patients with bowel thickness >10 mm are at high risk of mortality, and this has been proposed as an additional indication for surgery"). This is a diagnostic/imaging cutoff, not a drug dose/mg/AUC/schedule.

No antibiotic mg doses, no antifungal doses, no uridine-triacetate dose/schedule, no octreotide doses, no chemo doses anywhere in the file. Drug names for the antibiotic regimen were even abstracted to drug *classes* (e.g. "antipseudomonal beta-lactam/beta-lactamase-inhibitor," "carbapenem," "antipseudomonal cephalosporin," "anti-anaerobic agent") rather than naming piperacillin-tazobactam/imipenem-cilastatin/cefepime/ceftazidime/metronidazole explicitly — a conservative, correct paraphrase of DeVita's actual named drugs.

**Conclusion: no numeric drug-dose leak.** The two numeric occurrences (96h window, 10mm imaging cutoff) are clinical-criterion/imaging facts, not doses, and are consistent with the dose-free rule's intent.

## 2. UNGROUNDED CLAIMS
Cross-checked every specific claim against DeVita pp.1729/1732-1733:
- Causative organisms (Pseudomonas, S. aureus, E. coli, group A Streptococcus) — verbatim match.
- Antibiotic class choices (antipseudomonal beta-lactam/BLI or carbapenem monotherapy; antipseudomonal cephalosporin + anti-anaerobic dual therapy) — correctly generalizes DeVita's named agents (piperacillin-tazobactam/imipenem-cilastatin; cefepime or ceftazidime + metronidazole).
- G-CSF, NG decompression, IV fluids, bowel rest, serial abdominal exams — verbatim match.
- "In most patients these measures are sufficient... resolve as neutropenia corrects" — verbatim match.
- Amphotericin for fungemia after antibacterial failure — verbatim match.
- Blood transfusion (bloody diarrhea), avoid anticholinergic/antidiarrheal/opioid agents (ileus risk) — verbatim match.
- Fluoropyrimidine 96h antidote trigger — verbatim match (dose/schedule correctly withheld).
- All 4 classic surgical indications + the >10mm bowel-wall-thickness addendum — verbatim match, including the framing that indications/timing are "controversial" and the mortality gradient at >10mm (DeVita gives 60% vs 4.2%; sidecar correctly omits these percentages, consistent with its stated omission policy).
- Right hemicolectomy + ileostomy + mucous fistula, anastomosis avoided (leak risk), "failure to remove necrotic focus is often fatal" — verbatim match.
- Direct quote "may not be salvageable" — verbatim, correctly quoted.
- Ultrasound as a follow-up tool for bowel-wall thickness — matches the Diagnostic Investigations passage (correctly flagged by the sidecar as "elsewhere in the source," since it's not in the Management section proper).
- Claim that DeVita's section is silent on radiotherapy/targeted/immunotherapy role in acute typhlitis management — confirmed accurate; the Management-of-Neutropenic-Enterocolitis section discusses only antibiotics/G-CSF/supportive care/surgery.
- Two claims are explicitly self-labeled "general oncology standard, not from DeVita's section" (resuming chemo after resolution; ID consult for persistent fever) — properly disclosed as extrapolation, not attributed to DeVita.

No unsupported regimen, trial, or statistic found. Everything either traces to the cited DeVita passage or is explicitly flagged as outside it.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN — ready for R1.

No dose leak, no fabricated regimens/statistics, every clinical claim traced to the cited DeVita passage (or explicitly flagged as outside it), citation line present in required format.
