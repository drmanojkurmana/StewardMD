# Clinician review flags (collected from batch reports)

High priority (content may be outdated or misprinted):
- PULMONARY_TB, DISSEMINATED_TB: drug-resistant TB rows from Tables PDF 168-2 use an older injectable-based scheme; not checked against current WHO all-oral regimens.
- MALARIA, MIXED_MALARIA: Indian programme source (NVBDCP) is 2013; primaquine dosing differs from CDC.
- CELLULITIS: Tables PDF 135-3 prints oral clindamycin "300 to 450 mg/kg" (likely misprint; IDSA 300 to 450 mg four times daily).
- peptic_ulcer: Tables PDF prints "levofloxacin 500 mg qid" (kept as printed, flagged).
- CAP: Tables PDF puts macrolide or doxycycline first; ATS/IDSA 2019 puts amoxicillin first.
- ENTERIC_FEVER: PDF lists ciprofloxacin first line; CDC advises against empirical fluoroquinolone (resistance).
- serotonin_nms: Merck lists dantrolene; Harrison says it is ineffective.
- ischemic_stroke: PDF lysis window 3 h and BP 185/110; current practice cites 4.5 h and 185/105 pre-lysis.

- hiv_aids: Tables PDF 189-23 starts ART only below CD4 500; current WHO and Harrison 22e treat all regardless of CD4.
- helicobacter_pylori_infection / peptic_ulcer: PDF clarithromycin triple first; ACG 2024 prefers bismuth quadruple 14 days.
- infections_acquired_in_health_care: PDF uses the dropped "health care-associated pneumonia" category (IDSA/ATS 2016 removed it).
- Treatment rows with drug names but no dose (no opened source gave one): HCT GVHD steroids, HSV encephalitis duration, histoplasmosis, HIV regimen, IgG4, Campylobacter, anaerobes, pinworm, Hartnup, HACEK duration, cryptococcosis, CMV, DLB, enterococcal, gas gangrene, FMF, FTD, electrical storm, plus A01 list.
- Doses are copied as cited pages state them; not checked against drug labels.

- chronic_hepatitis: PDF hepatitis C regimens (PEG IFN, ribavirin, telaprevir, boceprevir) are superseded by AASLD-IDSA direct-acting antivirals; both kept.
- chagas_trypanosomiasis: PDF Table 213-2 sleeping-sickness drugs are older regimens; check current WHO.
- breast_cancer: TCHP regimen is flagged experimental and not clinically activated.
- COPD: prednisone dose, ICS eosinophil cutoff and oxygen PaO2 criteria missing (NICE pages blocked).

- VAP: PDF triple therapy with aminoglycoside for any MDR risk; IDSA/ATS 2016 limits double antipseudomonal cover to high risk and advises against aminoglycosides.
- A02 entries rest mostly on Merck as the single web source; check dose cells before release.

- HLH: Merck prints HLH-2004 neutrophil cutoff and ferritin conversion inconsistently; verify against the HLH-2004 paper.
- Criteria left out (could not source): King's College (acute liver failure), Graus (autoimmune encephalitis), EAN/PNS (CIDP).
- A04 ddx rows citing entry text sometimes say "separated by kidney biopsy" or "listed mimic"; firm up.

- mumps: entry lists post-exposure MMR; CDC and Harrison pitfalls say MMR is not post-exposure prophylaxis. Fix the entry text.
- monkeypox: entry calls tecovirimat first choice; WHO says no proven antiviral.
- leprosy: entry's two-drug paucibacillary MDT; WHO now uses three drugs for both forms.
- malnutrition: 60 kcal/kg/day adult figure (from Merck) looks high; check.
- legionellosis: PDF Table 147-1 prints sodium in mg/dL (should be mEq/L).
- mitral_regurgitation: entry says AF or PH alone indicates intervention; 2020 ACC/AHA says not alone.

- plasma cell disorders: PDF 111-2 is the older myeloma definition; IMWG adds biomarker-defined myeloma.
- psychiatric (eating disorders): PDF 79-2/79-3 are pre-DSM-5 (amenorrhea required); DSM-5-TR drops it.
- plague: PDF regimens differ from CDC 2024.
- RCC: Merck text "ipilimumab + cabozantinib" looked garbled and was left out.
- Many ddx/criteria conflicts are listed in each entry's footnote; see agent reports in the job log.

- B03 batch (kb/reference entries in batches/B03.txt): some early ddx rows may use general knowledge, not entry text (e.g. branch_retinal_artery_occlusion GCA row). Spot-check.

- S01 batch: some flowchart start / no-branch nodes are the writer's wording of the presentation (e.g. Morquio, Moyamoya); spot-check against entry text.
- PDF coverage pass: broad placements to prune if wanted (230-1 cath indications on 8 cardiac entries, 120-1 on 10 organisms, 113-2 incl. citrate_toxicity, 26-1 aphasias on akinetic_mutism).

- B16 batch: some truncated source sentences were completed with likely wording (e.g. "pulmonary vasodilators", "anti-CD38 agent"); spot-check against full entry text.

Library clean-up (not clinical):
- Duplicate reference entries exist (e.g. uterine_fibroid / uterine_fibroids, x_linked_hypophosphataemia / x_linked_hypophosphatemia, vocal_cord_granuloma / vocal_process_granuloma, acquired_haemophilia / acquired_hemophilia, renal_hypouricaemia / renal_hypouricemia, amatoxin_poisoning / amatoxin_mushroom_poisoning). Merge or alias.
- pituitary_tumor_syndromes and five syndromes have no reference.source string.

Renderer / data checks:
- Some numeric cells use op "=" (validator accepts; renderer shows text only, fine).
- opioid_od n8 had two exits from an action node; A06+ told to branch on decisions only.
- Some rows mix Harrison and web facts under one cite (A03 Group 1); consider splitting.

Status note: kb/diseases entries keep review.status "approved" from before; the v2 tables inside them are AI-drafted and unreviewed (the reader footer says so).
