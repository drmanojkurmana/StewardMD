---
tags: [handoff, clinical-content, review]
---
# 2026-09-25 - Clinical Protocols: clinical review worklist

156 protocols across 18 subjects shipped in `kb/clinical-protocols/` ([[Clinical Protocols]]), all
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
