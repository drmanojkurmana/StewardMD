# Adversarial verification verdict: desmoid_tumor.md

## 1. DOSE LEAK
None. Grepped the sidecar for digits: only hits are "CTNNB1" (line 5, "1" is part of the gene name, not a dose), "beta-catenin/CTNNB1" (line 41, same), and "12th ed." in the source line (edition number). No mg, mg/m2, AUC, Gy, %, or numbered schedule anywhere in the body text. Radiation section explicitly withholds the Gy doses DeVita gives (typically ~50 Gy adjuvant; 56-60 Gy definitive) and the local-control percentages (56%, 69%), replacing them with qualitative phrasing ("roughly half," "range typically cited"). TKI section withholds DeVita's sorafenib retrospective numbers (70% SD, 25% PR, 70% symptom improvement) and the phase III PFS numbers (81% vs 36%), replacing with qualitative language ("frequent," "meaningful," "clear ... advantage"). This is correct, deliberate de-numbering, not omission-by-accident.

## 2. UNGROUNDED CLAIMS
None found. Every specific claim traces to DeVita 12th ed., Ch. 60, p.1089 (biology) and p.1125-1126 (management):
- CTNNB1 exon-3 activation / APC-Gardner biology → p.1089.
- Active observation vs. immediate hormonal/chemo, similar PFS in mixed primary+recurrent cohort → p.1125 (142-patient series, ref 707), correctly generalized without citing the raw 50%/59% numbers.
- Recurrence-risk factors (size, extremity/chest wall site, younger age; not margin status) → p.1125, matches almost verbatim.
- Small abdominal wall desmoids favorable surgical cure; large extremity desmoids in young patients recur very frequently; intra-abdominal lesions have meaningful recurrence risk but surgery an option near resectable mesenteric vessels → p.1125-1126.
- Adjuvant RT omitted with negative margins, debated with positive margins, ~half local control with surgery alone in that setting, radiation-associated sarcoma risk → p.1126.
- Definitive RT as alternative to surgery when resection compromises function → p.1126.
- Systemic therapy ladder: NSAIDs (sulindac-class) lowest toxicity; hormonal manipulation anecdotal; anthracycline-based (single-agent/liposomal) and combination chemo; TKIs targeting PDGF/angiogenic signaling with a placebo-controlled trial in progressive disease showing clear PFS benefit, plus retrospective stabilization/PR/rapid symptom relief (<2 weeks) → p.1126, matches sorafenib/pazopanib discussion without naming drugs or numbers.
- Notch/gamma-secretase inhibitor rationale via Wnt-Notch cross-talk → p.1089 (PF-03084014 discussion), sidecar correctly keeps it generic ("an oral gamma-secretase inhibitor") and correctly frames it as not an established first-line standard.
- Slow, months-to-years response tempo; complete responses rare; don't abandon for stable disease; historic-series overestimation caveat → p.1126, close paraphrase.
- Ablative options (cryoablation, HIFU, chemoembolization) justified by lack of metastatic potential; larger tumor size → higher recurrence after ablation → p.1126 (cryoablation series, ref 717).
- Referral to sarcoma center / genetics for FAP-associated disease → reasonable extrapolation of DeVita's Gardner/APC discussion, uncontroversial standard of care, not a fabricated statistic.

No named drug, trial, or statistic in the sidecar lacks a traceable DeVita source, and no drug/trial name appears that DeVita doesn't also discuss (sidecar is in fact more conservative than DeVita, e.g. never names sorafenib, imatinib, pazopanib, doxorubicin, or PF-03084014 explicitly).

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers, matches convention.

## 4. VERDICT
CLEAN (ready for R1).

Notes for R1: the sidecar is unusually disciplined about stripping DeVita's actual numbers (Gy doses, response %, PFS %, cohort sizes) while still accurately conveying the qualitative clinical guidance those numbers support. The "Content note" section transparently flags what was omitted for lack of grounding (pediatric-specific pathway, numeric surveillance-imaging intervals). No fabrication detected.
