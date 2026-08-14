# Adversarial verification verdict — carcinoid_tumour.md (Wave 2)

**Sidecar:** `docs/superpowers/onco-waves/wave2/carcinoid_tumour.md`
**Verified against:** DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed. (`/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`, lines ~209058–210050, Ch. 58 "Neuroendocrine Tumors")

## 1. DOSE LEAK
None. Scanned all numeric tokens in the sidecar: `Ki-67` (grade marker, not a dose), `PD-1`/`PD-L1` (receptor names), `beta-2` (drug class name), `24-hour` (urine collection duration, a lab-test protocol not a treatment dose/schedule), `5-HIAA` (metabolite name), `12th` (edition number in the citation line). No mg, mg/m2, AUC, IU, mL, frequency-of-dosing number, or numbered treatment schedule anywhere in the body text.

## 2. UNGROUNDED CLAIMS
None found that lack DeVita support or guideline-standard status. Spot-checked and confirmed directly in the DeVita chapter:
- Ki-67/mitotic-index grading tiers and poorly-differentiated NEC → platinum-based chemo (chapter lines 54–62).
- Appendiceal/duodenal/bronchial/thymic resection thresholds and right hemicolectomy triggers (lines 254–292, 475–554, 611).
- Resection of symptomatic primary despite metastatic disease (lines ~180–186 area, general text).
- Perioperative somatostatin-analogue cover to prevent carcinoid crisis, incl. dental/embolization/RFA triggers (lines 748–765) — drug/procedure list matches; specific dose (25–500 mcg) correctly omitted by the sidecar.
- Octreotide/lanreotide as first-line antitumor therapy for progressive midgut NETs, benefit greatest with low hepatic burden + resected primary — this is the PROMID trial finding (lines 707–730); sidecar correctly drops the trial name, hazard ratio, and specific mg dose.
- PRRT superior PFS/OS vs. high-dose octreotide in inoperable/progressive SSTR-positive midgut NETs (NETTER-1-type trial, lines 897–903) — sidecar omits trial name/numbers, keeps only the qualitative finding.
- Everolimus established in pancreatic NETs, uncertain/not clearly endorsed in midgut carcinoid (RADIANT-2 missed its prespecified p-value; RADIANT-4 "ongoing/expanding role" language, lines 818–834) — sidecar's hedge ("less certain... used more selectively") matches the text's own hedge.
- Sunitinib/antiangiogenic TKIs: approved in pancreatic NETs, less established in carcinoid (lines ~853–862).
- Interferon-alpha: symptomatic benefit, low antitumor response, later-line given toxicity (lines 793–801+).
- Cytotoxic chemo disappointing in small-bowel carcinoid vs. more active in pancreatic NETs; poorly differentiated NEC treated with platinum/etoposide (lines 873–885) — sidecar drops the specific response-rate percentages (45%/7%/0%/33%) and trial numbers.
- Checkpoint inhibition (pembrolizumab) modest response in PD-L1+ NETs, not an established first-line standard (KEYNOTE-028, lines 867–872) — sidecar correctly omits the 12% ORR figure.
- Telotristat added for breakthrough diarrhea on somatostatin analogues (TELESTAR, lines 651–662, 693–697) — trial name/dose (250/500 mg TID) correctly omitted.
- Bile-acid binders (cholestyramine), pancreatic enzymes, antibacterial therapy for overgrowth, anti-motility agents (lines 698–706) — matches; drug name (cholestyramine) generalized to "bile-acid binders," fine.
- Beta-2 agonists contraindicated for carcinoid bronchospasm because they provoke further mediator release (lines 737–739, "β2-agonists... lead to additional release of biogenic amines and peptides") — confirmed verbatim concept.
- Niacin for pellagra from tryptophan diversion (lines 740–747) — confirmed.
- Chromogranin A / 24-hr urinary 5-HIAA, PPI/H2-blocker false-elevation caveat (lines 190–199) — confirmed.
- Echocardiography screening for carcinoid heart disease, correlation with higher 5-HIAA, valve replacement referral (lines 159–161, 663–679) — confirmed.
- FDG-PET more useful in higher-grade/less-differentiated disease (lines 154–157, 224, 291) — confirmed.
- Liver-directed therapy toolkit (resection/ablation, RFA/microwave, TAE/TACE, liver transplantation) reserved for liver-dominant disease (lines 905–944) — confirmed, sizes/cutoffs correctly kept qualitative ("smaller lesions," not "≤3 cm" as DeVita states).
- Active surveillance in asymptomatic unresectable/metastatic low-grade disease (lines 184–186 area) — confirmed near-verbatim.

Minor note, not a fabrication: the sidecar's line "Everolimus... has a clearly established role in metastatic pancreatic NETs" is standard/uncontroversial (FDA-approved indication, well known outside this chapter too) — fine as an uncontested guideline-standard fact even though the pancreatic-NET pivotal trial isn't in the excerpted chapter range checked.

## 3. CITATION
Present. Closing line: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers, matches convention. It adds an extra clause noting NCCN was not separately grepped, which is an honest disclosure rather than a false citation, and does not attribute any specific claim to NCCN.

## 4. VERDICT
**CLEAN — ready for R1.**

No dose leak, no numbered schedule, no unsupported statistic. Every regimen/drug/trial-derived claim traced to the DeVita Ch. 58 neuroendocrine-tumor chapter (or is uncontroversial guideline-standard knowledge), consistently stripped of the specific numbers (doses, response-rate percentages, hazard ratios, trial acronyms) per the dose-free/no-invented-stat rule. Citation line correctly formatted (name only, no pages).
