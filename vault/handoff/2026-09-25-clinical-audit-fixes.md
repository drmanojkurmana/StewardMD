# 2026-09-25 - Clinical audit fixes (AI audit applied as proposals)

The owner uploaded `STEWARDMD_CLINICAL_REVIEW_FIXES_AND_EDITS.md`, an AI-written "master sign-off audit"
of the 24 review PDFs (43 review-first items, protocol packs 01 to 19, 26 kits, 8 consent forms,
Telugu and Hindi handouts), and asked for everything to be fixed.

## How it was applied
- Every finding was checked against the guideline it names or the file's own cited source (full-text
  PDFs and official pages where reachable; web search otherwise). Applied where it matched; declined
  where outdated, wrong or overstated; unverifiable points listed below for a clinician.
- `review.status` stays `ai_drafted` everywhere (no named clinician; `scripts/apply-reviews.mjs` needs a
  reviewer name and registration number). Translations stay `machine_drafted`.
- Decision logged in `vault/decisions/Decisions.md` (2026-09-25). Recovery point: main `ad26d2523`.
- Code changes: consent "risks specific to this procedure" box (`clinical-docs.js`, token docs3); LA tool
  shows a per-drug source (`laSrc()`); MCCD check flags "fever" only at the start of the lowest line and an
  arrest-type mode of dying on any Part I line (`specialty-kits.js`, token kits5); sw.js marker `clinaudit1`.
- Tests: full unit suite 10,389 of 10,399 pass; the 9 failures are `test/wardsynq-twin-predict.test.mjs`,
  which fails identically on unchanged main (401 unauthorized), plus 1 skipped. Headless Chrome:
  run-specialty-kits-ui 203 PASS (new: consent risks box in Telugu, lidocaine with adrenaline 490 mg at
  70 kg, levobupivacaine 140 mg citing BJA Education 2020, MCCD arrest on line (a)), run-kb-protocols-ui
  and run-opd-protocol-ui ALL PASS, run-kits-share-ui ALL PASS.
- The review pages and PDFs made earlier this session were generated from the pre-audit content; regenerate
  them before sending anything else for review.

## Per group: applied, already present, declined, and points for a clinician
## Resuscitation (adult-cardiac-arrest, paediatric-cardiac-arrest, neonatal-resuscitation, anaphylaxis, status-epilepticus, post-cardiac-arrest-care)
- adult-cardiac-arrest: adrenaline timing (non-shockable ASAP; shockable after 3rd shock ERC/RCUK or 2nd AHA); refractory VF neutral wording (vector change; DSED limited evidence, DOSE-VF, local protocol only; RCUK 2025 not routine); hyperkalaemic arrest per ERC (CaCl 10 mL, insulin 10 U + glucose 25 g rapid, bicarbonate 50 mmol only if severe acidosis/renal failure, separate lines); new insulin-glucose drug row; fever prevention note; lidocaine "when amiodarone unavailable".
- paediatric-cardiac-arrest: amiodarone "5 mg/kg (max 300 mg per dose), up to 3 total doses". Rest already present.
- neonatal-resuscitation: MR SOPA labelled; compressions only after 30 s effective chest-moving ventilation. Rest already present.
- anaphylaxis, status-epilepticus: already present, unchanged.
- post-cardiac-arrest-care: unchanged at the time; audit TTM 32-36 C for 72 h DECLINED (ERC-ESICM 2025: prevent fever, 37.5 C or below, 36 to 72 h; AHA 2025: 32 to 37.5 C at least 36 h).
- Declined: PPV 40-60 (AHA/AAP 2025 is 30-60, file already notes NSSK); O2 21-30% for <35 wk (file more specific); flush volume; child max 0.3 mg adrenaline (WAO: 0.5 mg max); IM midazolam 0.2 mg/kg (file AES weight bands); refractory at 30 min (AES 40 min).
- post-cardiac-arrest-care (lead): summary now '36 to 72 hours (AHA: at least 36 hours)'.

## Resp/GI/haem/rheum (asthma-long-term-management, copd-stable-management, acute-variceal-bleeding, acute-pancreatitis, anticoagulant-associated-bleeding, giant-cell-arteritis, sjs-ten)
- acute-variceal-bleeding: octreotide 50 mcg/h (was 25 to 50); transfusion threshold about Hb 7 g/dL, target 7 to 8 (AASLD 2016, Baveno VII).
- anticoagulant-associated-bleeding: Xa inhibitor 4F-PCC 50 units/kg (EHRA 2021), drug entry cites ACC 2020 fixed 2000 units / EHRA.
- giant-cell-arteritis: IV methylprednisolone "for up to 3 days" (BSR 2020).
- sjs-ten: immunomodulation controversial, specialist skin-failure MDT; steroids short and early, avoid late start in extensive TEN and prolonged high doses.
- Already present: GINA Track 1 ICS-formoterol / no SABA-only; GOLD group E LABA+LAMA (+ICS if eos 300+); terlipressin schedule, endoscopy within 12 h, ceftriaxone; pancreatitis moderate fluids (WATERFALL, ACG 2024); warfarin/dabigatran reversal; andexanet US withdrawal noted.
- Declined: pancreatitis RL 5 to 10 mL/kg/h (WATERFALL, ACG 2024); vitamin K fixed 10 mg (ACC 2020 5 to 10 mg); GCA prednisolone 60 mg fixed (BSR 40 to 60 mg); terlipressin 1 to 2 mg (Baveno 2 mg then 1 mg).
- For clinician look: SJS/TEN Latin American 2025 guideline conditionally suggests steroids plus IVIG (very low certainty); GCA EULAR 2025 source not checkable.

## Endocrine/renal (diabetic-ketoacidosis, paediatric-dka, hyperkalaemia, hyperosmolar-hyperglycaemic-state, adrenal-crisis, hyponatraemia, acute-kidney-injury)
- hyponatraemia: added US expert panel alternative (100 mL 3% over 10 min, up to 3 boluses); 150 mL regimen marked ESE.
- acute-kidney-injury: fluid only if hypovolaemic/fluid responsive; never hydroxyethyl starch (was "avoid as first-line").
- Already present: DKA (K below 3.5 hold insulin, dextrose below 250, ADA 2024 resolution, basal overlap 1 to 2 h); paediatric DKA all ISPAD 2022 points; hyperkalaemia all UKKA 2023 points; HHS insulin 0.05 U/kg/h; adrenal crisis hydrocortisone.
- Declined: KCl 20 to 30 mEq/h (2009 ADA; 2024 = 10 mmol/h start); 0.14 U/kg/h; anion gap resolution; paed "over 1 h"/"48 h not 24"/mannitol over 20 min/hypertension as warning sign (ISPAD says not); hyperkalaemia 6.6 mmol, 15 to 30 min infusion, furosemide acute, polystyrene; HHS 250 to 300 target (JBDS 2022 180 to 270).
- For clinician look: HHS file says "(consensus: 200 to 250 mg/dL until resolution)", range not found in the consensus text.

## Toxicology (snakebite-envenomation(+international), organophosphate-poisoning, aluminium-phosphide-poisoning, paracetamol-overdose, methanol-poisoning, poisoning-general-approach(+international))
- snakebite (India): 20WBCT repeat 6 h after each ASV dose, re-dose only if incoagulable, 1 to 2 h only for brisk bleeding (MoHFW 2016 5.7); pitfall "re-testing at 2 h"; do-not list adds chemicals (KMnO4), electric shock, IM injections; neostigmine "1.5 mg IV (or IM)". File never said 2 h.
- organophosphate: pralidoxime not for pure carbamates; targets "no crepitations, dry axillae, clear chest matters most"; pupils late sign.
- aluminium phosphide: ISCCM "advises against routine lavage"; KMnO4 not routine (local protocol, within 1 h, airway protected; haemolysis/methaemoglobinaemia); fluid overload warning (toxic myocarditis); early noradrenaline.
- poisoning-general-approach (India): CCB/beta-blocker antidote item: IV calcium, vasopressors, glucagon, high-dose insulin 1 U/kg bolus then 1 U/kg/h up to 10 U/kg/h with dextrose, glucose every 15 to 30 min, K hourly (AHA 2023); matching drug entries. International: oxime "(not for pure carbamate poisoning)".
- Already present: international snakebite; paracetamol 3-bag/2-bag/SNAP; methanol fomepizole/ethanol/EXTRIP/folinic acid.
- Declined: atropine 2 to 4 mg and every 5 to 10 min (Lancet 2008: 1 to 3 mg, every 5 min); pralidoxime 8 to 10 mg/kg/h (WHO 8); pupils as endpoint; MgSO4 3 to 4 g then 1 g/h, pH below 7.1 cut-off, routine dobutamine/adrenaline (not in sources); neostigmine response within 30 min (source 1 h); fixed 500 mL ASV dilution.
- For clinician look: MoHFW 2016 calcium gluconate for unresponsive krait bite (not in file); 20WBCT schedule MoHFW 2016 vs NAPSE 2024; first ASV infusion 30 vs 30 to 90 min.

## Obstetrics/paeds (pre-eclampsia-eclampsia(+india), postpartum-haemorrhage(+india), gestational-diabetes, anaemia-in-pregnancy, ectopic-pregnancy, neonatal-sepsis, acute-asthma-child)
- pre-eclampsia (intl): nifedipine swallowed whole, never sublingual/bitten/crushed; Pritchard IV load slowly over 5 to 15 min (never faster than 1 g/min); pre-dose checks (reflexes, RR 16+, urine 30 mL/h or 100 mL/4 h); calcium gluconate at bedside, over 10 min.
- pre-eclampsia (India): same nifedipine wording, checks (hourly on Zuspan), calcium gluconate at bedside; never delay treating 160/110, treat within 1 h (FOGSI).
- PPH (intl): E-MOTIVE named; oxytocin never rapid undiluted IV bolus, 10 IU IM if no IV; methylergometrine contraindicated in any hypertension/pre-eclampsia/heart disease; carboprost contraindicated in asthma.
- PPH (India): TXA slow IV over 10 min; methylergometrine contraindication names pre-eclampsia/eclampsia.
- neonatal-sepsis: late-onset/hospital-acquired from local antibiogram (examples; vancomycin only for MRSA/line infection).
- Already present: labetalol regimen, Pritchard/Zuspan, TXA within 3 h with repeat, misoprostol 800, UBT; GDM (DIPSI); AMB anaemia; ectopic MTX/NICE criteria; paediatric asthma.
- Declined/modified: Pritchard IV 15 to 20 min (used WHO/NICE 5 to 15 min in intl; India keeps FOGSI 1 g/min); India labetalol/nifedipine keep FOGSI schedule; ectopic anti-D: file cites NICE NG126 current update rather than the older surgical-only rule (owner confirmed 2026-09-26 and supplied the wording: none at 11+6 weeks or under for ectopic, miscarriage or threatened miscarriage, ultrasound to guide dating; offer at 12+0 to 12+6 weeks for medical or surgical management; discuss that anti-D is a blood product; no Kleihauer test at these gestations; the 'earlier guidance, unit policy' line was removed); GDM fasting below 90 and venous-only (MoHFW 2018: below 95, calibrated glucometer); AMB severe anaemia Hb 7 to 8.9, iron sucrose alternate days, transfusion only below 5 in 3rd trimester (AMB differs); TXA "risk after 3 h"; UBT volumes; India TXA 24 h repeat (ICMR says 30 min only).
- For clinician look: Zuspan loading 5 to 15 vs ACOG 20 to 30 min; India file lists labetalol contraindicated in diabetes (FOGSI verbatim, unusual); carboprost 15 vs 20 min interval.

## Vector-borne/zoonoses (malaria, dengue, scrub-typhus, leptospirosis, enteric-fever, rabies-post-exposure-prophylaxis, tetanus)
- dengue: platelets + FFP in massive bleeding not controlled by transfusion with count below 50,000 and coagulopathy (NCVBDC 2023 5.5b); recovery phase: stop IV fluids, watch overload, consider diuretic (NCVBDC 7.5).
- rabies PEP: dilute RIG 2 to 3 fold with saline for severe/multiple wounds, full dose; no IM at distant site (WHO 2018), leftover RIG reuse same day aseptically; never gluteal (section + ERIG/HRIG notes); WHO 2018 position paper source added.
- tetanus: TIG 500 IU if more than 24 h, heavy contamination or burns (UKHSA); separate syringe and site; UKHSA source added.
- Already present: malaria (AL in NE, AS+SP elsewhere, PQ Pf/Pv, G6PD weekly, IV artesunate); scrub typhus; leptospirosis; enteric fever (no empirical FQ, azithro/cefixime/ceftriaxone, blood culture, Widal).
- Declined: PQ contraindicated below 6 months (NDP 2013: below 1 year kept); nationwide AL (not verifiable); dengue fluid taper (NCVBDC flowcharts already in file); azithromycin preferred in young children (IAP: doxycycline any age); leptospirosis amoxicillin (NCDC: ampicillin); child ceftriaxone 75 to 100 (file IAP 50 to 75); remaining RIG IM distant (WHO 2018 no); tetanus metronidazole 8-hourly, labetalol, Mg target (WHO technical note differs).
- For clinician look: enteric fever co-trimoxazole wording vs ICMR 2019; leptospirosis penicillin sensitivity test / ceftriaxone 1 g 6-hourly in NCDC; rabies dilution wording vs printed NCDC 2019 (scanned PDF); child ceftriaxone dose.

## Consent forms (8, trilingual)
- anaesthesia: new risks-local section; PDPH described (uncommon); nerve damage incl. epidural (RCoA 8 to 10 in 20,000 temporary, 1 in 20,000 permanent); nerve-block numbness; LA toxicity (rare); malignant hyperthermia; family anaesthetic history.
- blood-transfusion: TRALI; TACO label; new your-choice section (refusal incl. religious, acceptable components, recorded wishes, alternatives, risks without blood); cell salvage where available.
- caesarean: emergency higher risk; baby breathing 1 in 24 at 38 wk vs 1 in 56 after 39 wk (RCOG leaflet); placenta praevia in future pregnancy.
- cataract: vitreous loss. dental: nerve injury cause, usually temporary; root fracture/retained root. endoscopy: bleeding incl. polyp removal; higher risk with dilatation. hiv-test: Act short name, s.5 consent/counselling, s.8 confidentiality, s.3 anti-discrimination. surgery-general: anaesthesia has its own risks.
- Declined: "<1 in millions" viral risk (NAT not universal in India; "very low, not zero"); UGI perforation 1 in 2,500 (file source 1 in 15,000); colonoscopy figures (form is gastroscopy only).
- For clinician look: CS scar rupture 1 in 98 (NICE pooled) vs about 1 in 200 (RCOG GTG45); transfusion bacterial contamination not listed; endoscopy teeth/aspiration not listed.

## Anaesthesia/surgery/ENT (rapid-sequence-intubation, malignant-hyperthermia, local-anaesthetic-systemic-toxicity, acute-agitation, acute-appendicitis, acute-compartment-syndrome, renal-colic-and-kidney-stones, acute-angle-closure-glaucoma, epistaxis)
- RSI: rocuronium 1.2 mg/kg when suxamethonium contraindicated (list), sugammadex available; sugammadex 2 to 4 mg/kg routine; pitfall timing aligned to 24 to 48 h (lead).
- MH: dantrolene 2.5 mg/kg rapid bolus, then 1 mg/kg every 5 min (Association of Anaesthetists 2020) or full dose every 10 min (EMHG 2024); Association source added.
- LAST: lipid 1.5 mL/kg over 1 min, 15 mL/kg/h, 2 repeat boluses, double to 30 mL/kg/h, max 12 mL/kg; ASRA 2020 over-70 kg shortcut.
- acute agitation: never IM haloperidol alone, ECG first where possible; oral promethazine alternative.
- appendicitis: APPAC 39% 5-year recurrence labelled; CODA 90-day figures (29%; 41% with appendicolith vs 25%); CODA NEJM 2020 source.
- compartment syndrome: clinical diagnosis; delta P below 30 supports, not absolute (BOAST 2025).
- renal colic: ketorolac 30 mg IV/IM (15 mg if 65+, under 50 kg or renal impairment) + drug entry; tamsulosin for stones over 5 mm (up to 10 mm).
- angle closure: pilocarpine 1 to 2%; mannitol 20% 1 to 2 g/kg over 30 to 60 min (lower in elderly/cardiac/renal).
- epistaxis: 10 to 15 min continuous pressure; Foley improvised; vasovagal watch.
- Declined: MH "every 5 to 10 min"; agitation oral lorazepam+haloperidol combo; "1 in 3 at 5 years"; compartment "absolute indication".
- For clinician look: mannitol range (EGS may say 1 to 1.5 g/kg); MH recurrence dosing (EMHG vs Association); LAST prevention bupivacaine wording vs LA dose table.

## TB/HIV/meningitis/FN (pulmonary-tuberculosis, tb-preventive-treatment, hiv-post-exposure-prophylaxis, acute-bacterial-meningitis, febrile-neutropenia)
- pulmonary TB: fluoroquinolone pitfall covers any undiagnosed/non-resolving chest infection when TB not excluded (levofloxacin, moxifloxacin; masks TB, FQ resistance harms DR-TB regimens).
- HIV PEP: ideally within 2 h (NACO; WHO 2024 within 24 h), never after 72 h; renal line: TLD unsuitable below CrCl 50 (TDF and 3TC need adjustment), expert advice; free PEP at government hospitals is for occupational exposure and sexual assault (NACO 2021); NACO 2021 source added.
- Already present: NTEP weight bands, NAAT, Ni-kshay; TPT 6H/3HP/1HP (1HP adopted by NTEP 2024 addendum), symptom screen + CXR; TLD 28 days, HBIG + vaccine; meningitis regimen with dexamethasone; febrile neutropenia regimens.
- Declined: "never FQ for CAP" (kept "when TB not excluded"); 1HP HIV-only; CXR mandatory (NTEP: not mandatory); 3HP age wording; universal pyridoxine; AZT+3TC+DTG renal regimen (not in NACO/WHO/CDC); HBIG 500 IU; accelerated HBV schedule; vancomycin twice daily.
- For clinician look: NACO allows PEP after 72 h with expert opinion; NACO HBV table (vaccine only) and HIV follow-up 6 wk/3 mo/6 mo differ from CDC-based file.

## Critical care/cardio/neuro (sepsis-septic-shock, paediatric-septic-shock, major-haemorrhage-trauma, stemi, acute-ischaemic-stroke, acute-heart-failure, pulmonary-embolism, subarachnoid-haemorrhage, myasthenic-crisis)
- stemi: tenecteplase weight bands in the fibrinolysis item; stroke dose is different (item, drug note, pitfall); clopidogrel no loading dose in older patients (ESC 2023: older than 75); no ticagrelor/prasugrel with lysis; enoxaparin CrCl below 30 any age 1 mg/kg every 24 h.
- stroke: never use STEMI weight-band dose; DAWN (to 24 h)/DEFUSE 3 (to 16 h); ESCAPE-MeVO and DISTAL no benefit, MeVO case by case with newer data; no antithrombotics 24 h after lysis.
- sepsis: SSC 2026 source + alias; at least 30 mL/kg using adjusted/ideal weight if BMI above 30; initial MAP 60 to 65 at 65 or older; source control ideally within 6 h.
- major haemorrhage: TXA do not start after 3 h (removed hyperfibrinolysis exception); calcium when ionised Ca below 1.1 mmol/L (European 2023 R31, CaCl preferred).
- acute heart failure: warm-wet, cold-wet (split by SBP 90), cold-dry, warm-dry with treatment.
- PE: surgical embolectomy or catheter-directed therapy as alternatives to rescue lysis (ESC 2019); reduced-dose alteplase not an ESC 2019 regimen, specialist only.
- SAH: routine antifibrinolytics not recommended (AHA/ASA 2023), short course only if securing unavoidably delayed (specialist).
- Already present: sepsis timing etc; paediatric septic shock (SSC Children 2026); 1:1:1, TXA, targets; STEMI 120 min, pharmaco-invasive; stroke doses, BP; myasthenic crisis.
- Declined: mL volumes of TNK; hydrocortisone refractory trigger; cold/warm mandatory split and 10 to 20 min bolus timing (not SSC); TBI SBP 110 (file sources MAP 80); fixed CaCl per 4 units; 50 mg alteplase as recommended; SAH "beyond 72 h" (2012 framing).
- For clinician look: albumin after large volumes vs SSC 2026 crystalloid-only suggestion; clopidogrel age cut-off (older than 75 vs 75 or older); AHA/ACC 2026 PE guideline 2a for CDT; ORIENTAL-MeVO.

## Lead: consent form "risks specific to this procedure" field
- clinical-docs.js: new textarea on the consent form; prints under a heading in the form language (en/te/hi) before the declaration; FORMS exported as _forms for tests; index.html token docs3. Unit test + browser test (run-specialty-kits-ui) added.

## Specialty kits x10 (obgyn, psychiatry, emergency, general-surgery, community-medicine, cancer-screening, cardiology, pulmonology, neurology, nephrology-urology)
- obgyn: "Pre-eclampsia screening and aspirin" section (NICE NG133 high/moderate factors, MAP, UtA-PI, PlGF, combined risk, sFlt-1/PlGF 20 to 36+6 wk per DG49; aspirin 75 to 150 mg from 12 wk; FIGO night dosing); map calculator; NG133, DG49, FIGO 2019 sources.
- psychiatry: C-SSRS screener section (6 questions verified against official Screen Version, alert on yes to 4 or 5 or behaviour in 3 months); "NMS or serotonin syndrome" differential section.
- general-surgery: WHO Surgical Safety Checklist Sign In / Time Out / Sign Out sections; WHO source.
- community-medicine: immunisation tool linked; immunisation record (MCP card/U-WIN), missed doses, AEFI; NCD screening 30+ (CBE/VIA 30 to 65 every 5 years per NP-NCD 2025); WHO 2021 source.
- cancer-screening: HPV DNA section (WHO 2021: from 30 every 5 to 10 y; WLHIV from 25 every 3 to 5 y) + India VIA rule.
- cardiology: hs-troponin 0/1 h or 0/2 h section (ESC 2023; no hard-coded cut-offs).
- pulmonology: SpO2 rest on air / on oxygen / exertion; CRB-65/CURB-65 section with NICE bands; NG250 source.
- neurology: LAMS field (4 or more suggests LVO).
- nephrology-urology: eGFR CKD-EPI 2021, uACR, KDIGO A1/A2/A3.
- Already present: emergency calculators (canadian_cspine, ottawa_ankle, qsofa, news2); LCG tool; hunter_serotonin; curb65/crb65; nihss/lams/cpss/rosier; ckdepi/uacr/ckd-grid; CBAC.
- Declined: RACE (no calculator; LAMS used); HPV "every 5 years 30 to 65" (replaced with WHO + India VIA); C-SSRS low/moderate/high labels (NICE NG225); mandatory checklist enforcement (no schema support).
- Lead follow-up: pre-eclampsia-eclampsia moderate factors now attributed (ACOG/USPSTF vs NICE NG133).
- For clinician look: CBAC threshold ("above 4" vs NP-NCD 2025 "4 or more"); CRB-65 bands under NG250.

## Data tables + anaesthesia/dental/forensic kits
- data-la-doses: levobupivacaine 2 mg/kg max 150 mg (BJA Educ 2020; UK SmPC, 400 mg/24 h); bupivacaine with adrenaline ceiling 150 mg (UK SmPC); lipid rescue note (AAGBI 2010 exact numbers); IBW note; source list expanded (BJA Educ, 3 emc SmPCs, AAGBI 2010).
- specialty-kits.js: laSrc() shows per-drug ref; LA tool keywords (levobupivacaine, lipid emulsion); MCCD vagueAtStart list (fever flagged only at line start).
- data-mccd: modes of dying (cardiopulmonary arrest, multiple organ failure/dysfunction, MODS) and vague terms (pyrexia, PUO/FUO, febrile illness, abdominal/chest pain, altered sensorium/mental status); "name the disease" and Form 4 vs 4A tips.
- data-notifiable: scrub typhus, kala-azar, KFD, Nipah (IDSP P form case definitions 2024); SARI merged into ARI/ILI (no "sari" keyword); leprosy (PIB 5 Oct 2025, check state order); snakebite state orders + viper/krait/cobra keywords.
- anaesthesia kit: LEMON fields (L, E 3-3-2, O; Mallampati and neck existed); LAST check with lipid hint; AAGBI 2010 and Reed 2005 LEMON sources.
- forensic kit: two-finger test alert cites Supreme Court 2013 and 2022; custody fields (designated person, place); receiver signature hint.
- Already present: LCG WHO values; dental Ludwig's red flags and SDCEP INR rule; heatstroke, rabies/animal bite notifiable; MCCD tool.
- Declined: snakebite "March 2024" (request was Nov 2024); COVID-19 as separate notifiable (not in 2024 P form list); LCG epidural second-stage limits (not WHO LCG); bupivacaine 175 to 200 mg.
- Test: kit-tools-docs test for LA numbers, MCCD flags, notifiable keywords incl. false positives (NIV, "sari caught fire", insect bite).
- Lead follow-ups: lidocaine with adrenaline 7 mg/kg, max 500 mg (audit; BJA Educ 2020 + UK SmPC), note explains 2014 nomogram used 6; ropivacaine with adrenaline 3 mg/kg (BJA Educ 2020: adrenaline does not raise it; was 4); MCCD check flags an arrest-type mode of dying on ANY Part I line (heart failure due to a named disease on an upper line still allowed); specialty-kits.js token kits5; tests updated (490 mg / 49 mL, ropivacaine 120 mg / 16 mL, line (a) arrest).
- For clinician look: prilocaine with adrenaline has no mg ceiling (8 mg/kg, 560 mg at 70 kg; common ceiling 600 mg).

## Translations (handouts-te.json, handouts-hi.json, English advice where needed)
- English changed, then te/hi to match: ent/nosebleed-first-aid (15 min continuous pinch, never let go; emergency if still bleeding after 15 min); cardiology/heart-failure-self-care ("lying flat makes you breathless"; avoid salt substitutes/low-sodium salt unless the doctor agrees: potassium); cardiology/after-heart-attack (mustard, groundnut, sunflower or sesame oil, avoid vanaspati/Dalda); neurology/seizure-safety (bucket and mug or shower, never bathe or swim alone in river/pond/pool); neurology/headache-warning (standalone emergencies; fits, confusion, speech trouble, one-sided weakness with or without headache); nephrology-urology/stone-prevention (drink about 2.5 to 3 L to pass 2 to 2.5 L urine; lead added "unless a doctor has told you to limit fluids"); palliative/when-to-call (each cord-compression sign on its own); cancer-screening/cervical-screening (women living with HIV from 25, every 3 to 5 years); forensic/cause-of-death-certificate (lead applied: Form 4 in hospital, Form 4A outside, family takes it to the Registrar; RBD Amendment Act 2023 s.10).
- te/hi only: scabies titles (TE gajji (scabies); HI scabies (khaj)), anaesthesia/before-anaesthetic (sleep vs numbing medicine, no "behoshi" alone), urology warning signs (PD glossed, cloudy = dhundhla (matmaila)), gout titles glossed.
- Already right: ringworm titles; sepsis "pale" (HI safed (pheeki), TE paalipoyi); ANC quarter more food.
- Declined: nosebleed "5 then 15 minutes"; TE "durada" for scabies (means any itch); adding reasons the English does not give; "Form 6" (not verified in an official source).
- For clinician look: ANC food advice differs between community-medicine ("a quarter more food") and obgyn ("one extra meal a day").

## Owner source check, 2026-09-26 (resolves the clinician-review points above)
The owner checked ten open points against primary or high-authority sources and supplied the wording:
1. Clopidogrel with fibrinolysis: 300 mg load if under 75; at 75 or older, 75 mg with no load (ACC/AHA 2025;
   ESC 2023 says older than 75). `stemi.json` item and drug entry.
2. Albumin in sepsis: SSC 2026 suggests crystalloids alone over crystalloids plus albumin (conditional,
   moderate certainty), a change from 2021; selected roles after large volumes or in cirrhosis; avoid in TBI.
3. HHS: the "200 to 250 mg/dL until resolution" phrase is a secondary adaptation (Endotext), not a consensus
   sentence; removed. Kept JBDS 180 to 270 first 24 h; below 250 add dextrose and continue insulin;
   resolution includes glucose below 250 (2024 consensus).
4. CBAC: national MoHFW wording is above 4 (5 or more); some state documents (e.g. Maharashtra) use 4 or
   more. Kit hint and the `cbac` calculator say so (calculators.js token cbac2).
5. Caesarean consent: scar rupture with planned vaginal birth after caesarean is about 1 in 200 (RCOG
   "Birth after previous caesarean", checked); 1 in 1,000 with planned repeat caesarean. The old "1 in 98"
   came from a different RCOG context. te/hi updated; source added.
6. Mannitol in angle closure: 1 to 2 g/kg IV over about 30 minutes (EGS; 350 to 700 mL of 20% for 70 kg).
7. Labetalol and diabetes (India pre-eclampsia): kept as FOGSI's listing, labelled; NICE and AHA/ACC 2025 do
   not treat diabetes as a contraindication, so it reads as a caution (masked hypoglycaemia).
8. Enteric fever: co-trimoxazole 960 mg twice daily for 2 weeks is a first-line oral option in the NCDC
   2025 national guideline (owner's reading; the 2025 PDF URL returned 404 from the build environment; the
   2016 edition, which was read, lists it as the alternative); also an oral step-down. NCDC 2025 source added.
9. Prilocaine with adrenaline: 8 mg/kg, not more than 600 mg (Citanest Forte label on DailyMed, checked).
   Only ropivacaine now has no mg ceiling.
10. Pregnancy food: community-medicine ANC advice now reads "one extra nutritious meal a day (about a quarter
    more food than usual)", matching the obgyn kit's "extra meal"; te/hi updated.
Tests after these: unit suite 10,389 of 10,399 (the same 9 pre-existing twin-predict failures, 1 skipped);
run-specialty-kits-ui 203 PASS; run-kb-protocols-ui ALL PASS; bundle checks OK.
