---
tags: [handoff, clinical-content, review]
---
# 2026-09-25 - Clinical Protocols: clinical review worklist

233 protocols across 19 subjects shipped (215 international, 18 India national; 15 topics paired across both) in `kb/clinical-protocols/` ([[Clinical Protocols]]), all
`review.status: "ai_drafted"`. Each was written by a research agent against the cited guideline on
the web. **Every agent hit the shared 200-search web limit partway**, then continued by fetching
publisher/society pages directly; several publishers (AHA, ESC/OUP, JACC, ASH, Springer, PubMed)
blocked full text, so some dose tables were written from standard references rather than read from
the guideline. The items below are what the agents themselves reported as unverified or contested.
Review these first.

## How to mark a protocol reviewed
Edit the file: `"review": { "status": "reviewed", "compiled": "2026-09-25", "reviewer": "Dr Name" }`
(`approved` likewise). The validator refuses reviewed/approved without a named reviewer. Then run
`node scripts/build-clinical-protocols.mjs` and the tests. The reader's banner changes automatically.

## Suggested review order
1. Resuscitation and dose-critical emergencies: adult-cardiac-arrest, paediatric-cardiac-arrest,
   neonatal-resuscitation, anaphylaxis, status-epilepticus, snakebite-envenomation,
   organophosphate-poisoning, aluminium-phosphide-poisoning, diabetic-ketoacidosis, paediatric-dka,
   hyperkalaemia, pre-eclampsia-eclampsia, postpartum-haemorrhage, sepsis-septic-shock,
   paediatric-septic-shock, major-haemorrhage-trauma, stemi, acute-ischaemic-stroke.
2. India national-programme protocols where national and WHO guidance differ: malaria, dengue,
   scrub-typhus, leptospirosis, enteric-fever, rabies-post-exposure-prophylaxis, tetanus,
   pulmonary-tuberculosis, tb-preventive-treatment, hiv-post-exposure-prophylaxis (cites WHO/CDC, NACO
   site was down), gestational-diabetes, anaemia-in-pregnancy.
3. Everything else.

## Agent-reported flags, by batch
## haematology-oncology (10)
- Web-search budget ran out: NHLBI 2014, ICR 2019, Anaemia Mukt Bharat not linked.
- AABB 2023: 7.5 g/dL cardiac surgery (not 8). ACC 2020 4F-PCC fixed 2000 units + EHRA 25-50 units/kg. Andexanet withdrawn US Dec 2025, not in India. TLS per BSH 2025 (rasburicase 3 mg single dose).
- Unsourced: sickle cell morphine 0.1 mg/kg, CTX+azithro, transfusion 1 g/dL below baseline, O2 <95%; TTP PLEX volumes, steroid/rituximab/caplacizumab, PLASMIC; ITP methylpred 1 g, TXA, TPO-RA doses; HIT vit K 5-10 mg IV; MSCC glucose 108-180.
## nephrology (10)
- KDIGO 2026 AKI draft (public review) cited as draft. Hypernatraemia/hypomagnesaemia: no formal guideline (NEJM 2000, reviews).
- Unsourced: finerenone doses (label), torsades Mg 1-2 g, hypokalaemia ECG threshold, monitoring intervals, compartment pressures omitted.
## endocrinology (8)
- Search limit hit; later sources via PMC/Europe PMC. ATA 2016 403: thyroid storm doses via 2026 ETA/BTA consensus.
- Unsourced: D25% 80 mL (arithmetic from JBDS 20 g), octreotide (2025 SR), T2DM drug + enoxaparin doses (labels).
- Thyroid storm hydrocortisone JTA vs 2026 consensus both stated; propranolol discouraged by JTA.
- No NG levothyroxine dose given (IV often unavailable in India). Adrenal crisis taper general.
## cardiology (14)
- ESC 2026 HF (28 Aug 2026): HFrEF LVEF <50%, "decompensated HF" terminology adopted. ACC/AHA 2026 dyslipidaemia LDL goals. ACC/AHA 2026 PE not readable: PE follows ESC 2019.
- Search limit; OUP/AHA/JACC/ASH full texts blocked: most dose tables NOT verified verbatim, standard values from memory.
- Unsure: HF drug doses + diuretic algorithm (ESC 2021 tables), noradrenaline 0.2-1 mcg/kg/min, acetazolamide 500 mg IV, phentolamine 5 mg, ESC 2023 IE empirical regimens + clindamycin removal, ESC 2025 pericarditis exercise, ESC 2025 lipid update (Lp(a), SCORE2).
## syndromic ID (11)
- 200-search limit hit. NACO, ICMR/AIIMS COVID sites down (503/403): PEP cites WHO 2024 + CDC 2025, not NACO. NICE NG141, ACG 2016/2021 blocked; ESMO 2016 not attempted. Indian content from ICMR 2022 online guidelines.
- Unsure: meningitis dexamethasone >12 h cut-off (NICE), PEP follow-up HIV schedule (CDC 4-6 and 12 wk) + HCV timing, Shigella ceftriaxone 2 g single dose, COVID ICMR severity categories + SpO2 92-96 + pregnancy steroids, benzathine penicillin 1.2 MU recurrent cellulitis, fidaxomicin availability in India.
## gastroenterology (9)
- Search limit; later sources via Europe PMC/Ovid. Not reachable: ECCO 2022/2026, EASL 2017 ALF, EASL 2022 HE (not cited).
- Unsourced: King's College criteria + lactate, mannitol 0.5-1 g/kg, NAC 100 kg cap, charcoal 50 g, NIAAA criteria, Maddrey, Truelove-Witts cut-offs, valganciclovir 900 mg BD, thiamine 100 mg.
- Terlipressin HRS 1 mg q6h up to 2 mg (CONFIRM/US label, not AASLD). Variceal ceftriaxone up to 5 d (AASLD 2024) vs 7 d (2021), both stated.
## neurology (9)
- Search limit; Stroke 2026 guideline full text 403 (details from summaries). GBS EAN/PNS 2023 via Erasmus repository; AHS migraine via listing page.
- Unsourced: nimodipine 30 mg q2h if hypotensive, refractory SE anaesthetic infusions, pyridostigmine restart, intubate MG at FVC ~15 mL/kg, post-lysis cryo threshold, methylpred 125 mg angioedema, labetalol/nicardipine doses. AHS 2025 dexamethasone wording ambiguous. PCC 50 units/kg and phenytoin 20 mg/kg had no max.
## surgery-trauma (11)
- Search limit; rest via PMC/OUP/NICE/BOA/WHO/ABA fetches. ICMR not cited.
- Unsure: TG18 criteria/grading/antibiotic durations + ASGE ERCP <48 h (only WSES 2020 cited); burns 20-min cooling (up to 3 h), paeds 3 mL/kg/%TBSA + maintenance, UO 1 mL/kg/h, electrical 4 mL/kg/% + UO 75-100 mL/h, paeds 10% threshold, ABA 2022 year assumed; open fracture antibiotics/duration (EAST 2011 uncited), tetanus thresholds; TBI levetiracetam + phenytoin maintenance, 3% saline 250 mL, mannitol 320 mOsm ceiling.
## anaesthesia / ophthalmology / ENT (8)
- Search limit; DAS 2025, EMHG 2024, EGS 2025, AAO 2025, NICE NG89, CHEST 2022 read from full text/official pages.
- ASRA 5th ed (2025) not accessible: DOAC neuraxial intervals from 2018 4th ed (labelled). CHEST 2022 DOAC stop days from memory; follows CHEST page on no bridging even for mechanical valves (check).
- Unsourced: oral glycerol 1 g/kg, acetazolamide 250 mg q6h follow-on, vitamin K 1-2 mg oral for INR >1.5. Bupivacaine max 150-175 mg (labelling varies). Epistaxis compression "at least 5 min" (AAO-HNS).
## obstetrics + rheumatology/dermatology (9)
- Newer sources used: WHO/FIGO/ICM PPH 2025, NICE NG126 anti-D update Jun 2026 (no anti-D to 11+6 wk), EULAR 2025 GCA.
- Unsure (full text blocked): methylergometrine repeat/max 5 doses (1 mg), BSR 2020 GCA taper, upadacitinib 15 mg, MTX 10-15 mg weekly, EULAR 2016 colchicine after day 1, BAD 2016 room temp 25-28 C + ciclosporin taper + benzydamine, FCM limits (label), GBS antibiotic doses (ACOG 797 abstract), IADPSG cut-offs.
## emergency + critical care (11)
- AHA 2025 vs ERC 2025 differences (atropine, cardioversion energy, O2/BP targets, fever prevention) stated side by side. AHA/ERC/Springer pages blocked; checked vs AHA 2025 algorithm text and RCUK 2025 pages.
- Unsure: pacing rate ~60/min (ACLS teaching), ROX 4.88 + NIV VT >9.5 mL/kg (original studies), ICU sedation ranges, IV diltiazem/metoprolol, adenosine 3 mg, drowning 8 h observation (paediatric data), fever prevention 36-72 h vs >=72 h.
## tropical ID (9)
- Malaria: India 2013 drug policy cited as current; primaquine 0.75 mg/kg single (India) vs WHO 0.25; first-trimester quinine (India) vs AL (WHO); both stated. WHO weekly PQ for G6PD deficiency from memory.
- Leptospirosis: NCDC 2015 ceftriaxone 1 g q6h vs CDC 1 g OD used; difference flagged in file.
- Enteric: ICMR 2022 unreadable, ICMR 2019 used; azithro 7 d vs ICMR 10-14 d; dexamethasone (WHO 2003) from memory; paeds ceftriaxone from IAP 2006.
- Rabies: monoclonal antibody doses + RIG dilution omitted (unverified).
- Tetanus: WHO TIG 500 IU vs 3000-6000 IU practice noted; paeds metronidazole + India schedule from memory.
- AES: adult ceftriaxone 2 g q12h, ampicillin 2 g q4h standard, not in Indian sources.
## toxicology + psychiatry (13)
- Search limit; rest via Europe PMC/NCBI. Indian poison centre numbers omitted (unverified).
- Unsure: DT IV lorazepam 1-4 mg / diazepam 10-20 mg boluses; NMS dantrolene start 1-2.5 mg/kg, lorazepam, 2-week antipsychotic restart; cyproheptadine 2 mg q2h then 8 mg q6h; promethazine 25-50 mg + haloperidol; TCA bicarbonate targets (AHA 2023 403); paracetamol 2-bag NAC + King's criteria; methanol oral ethanol dose.
## respiratory (12)
- Newer: GINA 2026 (May 2026), GOLD 2026. ICMR 2019 cited (2022 text unavailable). ERS/ESICM 2017 HAP/VAP not cited.
- Unsure: severe CAP hydrocortisone 200 mg/day (CAPE COD; ATS 2025 no dose), COPD nebuliser mg doses (GOLD none), TB hepatotoxicity stop limits 3x/5x ALT (ATS/CDC practice), NTEP pyridoxine 10 vs 25 mg conflict, massive haemoptysis (no society guideline; Indian IR consensus 2023 + reviews; IV TXA regimen from review).
## paediatrics (11)
- Newer: Surviving Sepsis Children 2026 (no adrenaline vs noradrenaline preference; hydrocortisone only for adrenal insufficiency), GINA 2026, WHO 2024 zinc 5 mg option, WHO 2023 SAM, WHO 2024 neonatal sepsis. DKA stays ISPAD 2022.
- doi-only (publisher blocked): AAP jaundice 2022, bronchiolitis 2014, febrile seizures 2011/2008, SSC Children 2026.
- Unsure: AAP 2022 jaundice thresholds/IVIG/irradiance (from knowledge), neonatal SpO2 targets by minute (secondary), max doses ceftriaxone/ampicillin/amoxicillin, adrenaline/noradrenaline starting rates, hydrocortisone, benzodiazepines. Preterm gentamicin intervals omitted.

# INTERNATIONAL WAVE (2026-09-25)
## gastroenterology (8, international)
- Newer: ACG July 2026 diverticulitis (cited from summaries; paywalled), ASCRS 2026 update not cited (unread). AASLD/IDSA 2025 HBV cited with WHO 2024.
- Unsure: AGA diverticulitis antibiotic cut-offs (CRP >140, WBC >15) from memory; vonoprazan GERD + resmetirom statin limits from FDA labels; RYGB preferred for GERD in obesity (ACG 2022) from memory; Rome IV/alarm features standard references; HBIG within 12 h (CDC practice).
## cardio-respiratory (7, international)
- Bronchiectasis on ERS 2025 (replaced ERS 2017). ESC/ERS 2022 PH full text unread: echo probability thresholds, 4-strata cut-offs and PH drug doses from knowledge/labels.
- Unsure: antianginal doses (GTN, bisoprolol, ranolazine, ivabradine) label/standard; heparin ALI 80 units/kg then 18 units/kg/h (standard nomogram); nerandomilast 18 mg BD (secondary source); OSA driving/perioperative advice and tirzepatide titration not from cited guidelines. Nebulised antibiotic doses omitted.
## malaria (WHO) counterpart
- Checked: WHO 2025 AL weight bands, DHA-PPQ, PQ 0.25 mg/kg single (Pf), radical cure 0.5 mg/kg x14 d or 1 mg/kg x7 d (G6PD >=70%), tafenoquine bands.
## women's health + urology (8, international)
- Stones cite AUA 2026 (not 2016). ED cites EAU 2025 x3 (no AUA 2018). NG118 URL fetched via NICE standard address.
- From standard prescribing references: HRT + vaginal oestradiol doses, bladder antimuscarinic/mirabegron doses, TXA max 4 g/day, DMPA 13-weekly, implant 3 years, FSRH contraception-to-menopause rule, nitrates 24/48 h after PDE5i, morphine titration. Check UKMEC migraine without aura (CHC category 2 to start) and centchroman dosing.
## endocrine (7, international)
- Unsure: PCOS letrozole 2.5-7.5 mg d3-7 and clomiphene 50-150 mg (standard, not guideline text); vitamin D UK loading examples (50,000 IU weekly x6 or 4,000 IU daily x10 wk) from memory (only ~300,000 IU total + 800-2000 IU maintenance checked); ATA 2016 methimazole-by-FT4 doses via search summaries; ATA 2026 pregnancy details via secondary summaries; T1D sick-day uses ketones >=3.0 only; semaglutide stop 2 months pre-pregnancy + liraglutide titration from labels.
## neurology + psychiatry (9, international)
- Depression cites NICE NG222 + CANMAT 2023 (APA page failed). Migraine prevention uses AAN/AHS 2026 (summary only).
- From memory: Bell's aciclovir 400 mg 5x/day 10 d, propranolol 40 mg BD-TDS start, amitriptyline titration, venlafaxine max 375 mg, pregabalin titration (GAD), crisis diazepam 2 mg up to TDS, galcanezumab 240 mg load then 120 mg. Epilepsy folic acid deliberately soft.
## rheumatology + dermatology + B12 (9, international)
- Newer editions: EULAR RA 2025 update, ACR 2026 OA (summary), ACR SLE 2025, AAD AD 2025 focused update, NICE NG198 Aug 2026.
- Unsure: folic acid 5 mg weekly with MTX (UK), no RA bridge steroid dose, IA steroid 3-monthly limit, paeds flucloxacillin 12.5-25 mg/kg, IV aciclovir 5 mg/kg (no paeds dose), spironolactone 50-100 mg acne, cyanocobalamin regimen, hydroxocobalamin regimens per BNF (not opened).
## paediatrics + ENT + eye (8, international)
- Newer: AAO-HNS 2025 sinusitis update, IDSA 2025 pharyngitis Part 1 (scoring only; 2012 for treatment), NICE NG250 (2025) pneumonia, NICE NG254 (2025) sepsis doses.
- Unsure: amoxicillin max 2 g/dose (US high-dose practice; WHO none), AOM ceftriaxone max 2 g (AAP) vs 1 g (CHOP), adult gonococcal conjunctivitis ceftriaxone 1 g (CDC) vs 500 mg (AAO) both stated; from BNF/labels: ampicillin 50 mg/kg q6h (1-3 months), pre-hospital benzylpenicillin, aciclovir, eye-drop doses, cefpodoxime 200 mg BD, sinusitis amoxicillin regimens, prochlorperazine short course.
## international counterparts: tropical (7)
- Enteric: BIA 2022 paywalled; azithro 20 mg/kg x7 d, paeds ceftriaxone 50-80 mg/kg, paeds meropenem, 10-14 d total are standard values. Encephalitis: BIA/ABN + Kneen cited by DOI only; 6-h LP/aciclovir targets, 21 d children, stop criteria, MRI 24-48 h from memory. Chikungunya: MTX/HCQ are RA doses; prednisolone range from a 2022 SR. Rabies: immunocompromised schedule omitted (WHO wording ambiguous); US schedule note unsourced. Malaria: artesunate 0/12/24 h timing from CDC; CDC 5-day AL for travellers noted.
## HIV / STI / OI (6, international)
- PCP doses from the 2009 MMWR NIH/CDC/HIVMA-IDSA edition (clinicalinfo.hiv.gov blocked); current edition may differ (e.g. primaquine flat 30 mg). ART within 2 weeks of PCP treatment rests on WHO rapid-ART, not the 2009 source. DHHS cited as Sept 2024 (May 2026 update unread).
- Not checked: 3HP doses (INH 900 + rifapentine 900 weekly), early syphilis partner 90-day rule, RCOG/BASHH caesarean after third-trimester first-episode HSV. CDC Aug 2026 change: AL 5 days for Pf (noted in traveller protocol).
## international counterparts: TB, flu, heat, tox, obstetric (8)
- AHA 2023 poisoning update + 2026 charcoal paper cited by doi.org (publisher blocked). AHA 2023, BSH 2020, ACOG 2021, WMS 2024 full texts not read (abstracts/summaries).
- WHO 2025 TB weight bands: HRZE 4 tabs 35-64 kg; TPT rifampicin 750 mg (INH 375 mg) >=65 kg (two WHO documents agree). WHO 2024 6Lfx 500 mg 25-49.9 kg, 750 mg >=50 kg.
- From standard references: antidote doses (HDI, lipid emulsion, calcium, naloxone, digoxin Fab), heat-stroke benzodiazepine + fluid doses, metformin max 2-2.5 g/day.

# Specialty kits (8, added 2026-09-25) - what a reviewer must check
Kits hold no drug doses. Review the red-flag thresholds, the alert wording, the advice texts and the
field lists. Sources are listed in each kit; all are `ai_drafted`. See [[Specialty Kits]].
## Computed tools (tested against oracles; review the interpretation text, not the maths)
- Pregnancy dating: ACOG CO 700 thresholds (5/7/7/10/14/21 days). Milestone windows use NICE/WHO timing (GDM test 24+0 to 28+0, anti-D 28+0, induction offer 41+0): confirm against local practice.
- Growth: WHO method reproduces WHO's own outputs exactly. Review the labels ("Possible risk of overweight" above +1 SD for weight-for-length, WHO; BMI-for-age 5 to 19 y: overweight above +1 SD, obesity above +2 SD).
- Vision: WHO ICD-11 categories from presenting VA in the better eye; IOP above 21 mmHg flag. Hearing: WHO 2021 grades; tuning-fork interpretation text is generic.
## Per kit, open points from the authors
- O&G: risk-factor list and "high-risk pregnancy" alert; antenatal advice texts (MoHFW/WHO wording).
- Paediatrics: ETAT and IMCI sign wording (WHO 2013 pocket book, IMCI 2014); fast-breathing thresholds; feeding advice from the WHO fact sheet (dated 2026).
- Orthopaedics: compartment syndrome and cauda equina alerts (BOAST 2025, GIRFT 2026 pathway "MRI within 4 hours"); cast advice from BOA casting standards 2015; NICE NG59 not readable (only CES warning signs used); investigation search terms ("X-ray LS spine", "RA factor") may not match a hospital catalogue.
- Ophthalmology: red flags (giant cell arteritis, third nerve palsy with dilated pupil, retinal detachment, orbital cellulitis) added by the author; RCOphth guidance not cited (PDFs 404).
- ENT: extra laryngeal section; sudden hearing loss (NICE NG98) and mucormycosis red flags; 2-week referral wording from NICE NG12.
- Dermatology: ticking "Fever" alone shows the SJS/TEN or DRESS alert (wording is conditional); leprosy content from the 2012 NLEP guideline; ringworm advice follows ECTODERM India 2018.
- Psychiatry: Mental Healthcare Act 2017 section numbers checked against the Gazette text (India Code refused the PDF); insight grades 1 to 6 are a textbook convention, uncited; no low/medium/high risk label (NICE NG225); Tele MANAS 14416 / 1800-89-14416.
- Dental: anticoagulant alert follows SDCEP 2022 (INR within 24 h, 72 h if stable; delay if 4 or above; DOAC morning dose rule); ulcer/patch threshold 2 weeks (MoHFW) where SDCEP says 3; tooth mobility grades uncited.
