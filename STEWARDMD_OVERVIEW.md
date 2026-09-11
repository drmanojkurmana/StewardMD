# StewardMD — Codebase Overview

Factual inventory of the repository as it exists on disk. Written from the code, not from
comments, vault notes, or README claims (those were cross-checked, and discrepancies are called
out explicitly). StewardMD is a clinician-only, mobile-only (Capacitor iOS/Android) medical
decision-support app; the web bundle at the repo root **is** the app — there is no separate build
step beyond concatenation/copying into `www/`.

---

## 1. MODULES

Every distinct feature area found in the codebase, what a clinician does with it, and where it lives.

| Module | What a clinician does with it | Key files |
|---|---|---|
| **Core app shell / auth** | Signs in (Google, Apple, email+OTP, guest, tester login), gets a doctor-verification check (NMC/State register cross-check), gets a universal `SMD-XXXXXX` StewardMD ID | `index.html`, `app.js`, `home.js`, `native-auth.js`, `email-auth.js`, `verify.js`, `steward-id*.js`, `app-check-init.js`, `id-token.js` |
| **Clinical calculators** | Runs any of 420 named bedside scores/calculators (MELD, SOFA, CHA₂DS₂-VASc, etc.) | `calculators.js`, `calc-links.js` |
| **Drug interaction checker** | Checks a patient's med list against 330 interaction rules over ~1,452 drugs | `interactions.js`, `interaction-rules.js` |
| **Scan-Meds / Drug Index** | Looks up a drug/brand, scans a prescription photo, browses formulary A–Z or by class, works offline (downloaded SQLite DB) | `medlist.js`, `offline-db.js`, `api.js`, `kb/ai/drug-fuzzy.js`, Cloudflare Worker `worker/src/` |
| **Ward formulary (non-antibiotic)** | Looks up adult dosing for 71 common ward drugs | `drugs.js` |
| **Renal dose adjustment** | Gets CrCl-adjusted antibiotic dosing (auto-fetches labs from Ward Sync) | `renal-dose.js`, tables in `reasoning.js` |
| **Electrolyte correction engine** | Enters labs, gets a guideline-referenced correction plan for Na/K/Mg/Ca/PO4/Cl/HCO3 | `electrolytes.js` |
| **Insulin dosing** | Computes correction/meal/basal/DKA/paediatric insulin doses, converts between 29 named insulin products | `insulin.js`, `insulin-engine.js`, `insulin-db.js`, `insulin-convert.js`, `insulin-safety.js` |
| **Antibiogram / antibiotic coverage** | Views regional (India, 5 regions) resistance-rate heatmaps and a spectrum-of-activity grid | `antibiogram.js`, `antibiogram-data.js` |
| **Antibiotic decision wizard** | Walks a 5-step guided flow (vitals→systems→differential→decision→plan) to pick an antibiotic | `abx-wizard.js`, `abx-redesign.js` |
| **Diagnosis & management (dx-mgmt)** | Looks up management briefs for 327 non-infective diagnoses (Harrison's 22e aligned) | `dxmgmt.js` |
| **Clinical Reasoning engine** | Enters symptoms, gets a live-updating infective + non-infective differential (98 non-infective entries) with a confidence score | `reasoning.js`, `clinical-nlp.js` |
| **ICU workstation** | Runs a 13-tab ICU dashboard (Overview/Hemo/Fluids/Lytes/ABG/Infusions/Protocols/Vent/Trends/Rounds/Goals/Documents/More), auto-scores SOFA/qSOFA/APACHE II/NEWS2/BISAP/Child-Pugh from charted data, collaborates with a unit team | `icu.js`, `icu-autoscores.js`, `icu-collab.js`, `icu-crypto.js`, `infusion-actions.js` |
| **KardiQ X (ECG)** | Photographs/uploads an ECG, gets rhythm classification + deterministic STEMI/Sgarbossa detection, plus a 1,041-lesson ECG learning atlas | `kardiox*.js`, `backend/kardiox/` |
| **ThoreX (chest X-ray)** | Uploads a CXR, gets an 18-finding clinical classification + structured report + AI narrative explanation | `thorex*.js`, `backend/thorex/` |
| **FundX (fundus imaging)** | Captures a smartphone retinal photo with AI alignment coaching, gets DR/glaucoma/hypertensive-retinopathy considerations | `fundx*.js` |
| **SknX (dermatology imaging)** | Photographs a skin lesion, gets a 7-class (on-device) or 59-condition (cloud, opt-in) classification with a hard "never mask malignancy" guardrail | `sknx*.js` |
| **MaiK (AI assistant)** | Asks a clinical-knowledge question in 3 selectable tiers (KB-only free / MaiK Cloud Pro / on-device beta), gets a grounded, cited answer restricted to medical topics | `maik-engine.js`, `maik-local.js`, `maik-models.js`, `kb/ai/*`, `functions/api/ai/[[path]].js` |
| **MaiK Ask** | Runs an AI-guided voice patient-history interview that autofills the EMR | `maik-ask.js`, `maik-pathways.js`, `maik-reasoning.js` |
| **MaiK Scribe / ambient voice** | Dictates a consult; on-device Whisper (or cloud fallback) transcribes and extracts structured findings for clinician review | `voice.js`, `voice-ambient.js`, `voice-vitals.js`, `voice-emr-map.js`, `voice-diarize.js`, `voice-service/` (Python), `voice-worker/` |
| **Oncology / OncoTree** | Navigates 25 cancer types to a treatment pathway, executes any of 267 chemo regimen protocols with dose calculation, stages (TNM, 17 sites), grades toxicity (CTCAE/irAE), tracks RECIST response | `onco-*.js`, `oncotree*.js`, `kb/onco/`, `kb/oncotree/`, `kb/protocols/` |
| **Custom Protocol Maker / Protocol Sheet** | Authors a custom chemo protocol, prints a formal dosed treatment sheet with sign-off | `protocol-maker.js`, `protocol-sheet.js` |
| **SURGX (surgical intelligence)** | Takes AES-256-encrypted device-local operative notes, browses 8 protocols/5 procedures/3 cases/15 evidence records, projects the existing `ws-surgery.js` decision engine | `surgx*.js`, `surgx/**` |
| **CliniX (student teaching)** | Works through a 22-disease bedside-skills curriculum (history→exam→reasoning→Ix→Dx→Tx→case→OSCE→viva) with an MaiK tutor that refuses to give doses | `clinix*.js`, `clinix/**` |
| **RadioAnatome / Atlas** | Scrolls a cross-sectional CT/MRI slice stack (30 modules, 10 regions × up to 3 planes) and taps a structure for its label | `atlas.js`, `atlas/**`, `atlas-pipeline/` (dev tooling, not shipped) |
| **Prescription writer (Rx)** | Generates a printable, DB-verified prescription, gated to verified doctors | `prescription.js`, `rx-build.mjs` |
| **OPD / Smart Queue** | Runs a front-desk ticket queue, registration, multi-clinic/white-label routing, WhatsApp auto-notify, staff roles | `queue.js`, `queue.html`, `patient-register.js`, `opd-display.html` |
| **OPD EMR overlay** | Opens a patient chart (Profile/Investigations/Medications/Assessment/Protocol/ONCqis tabs), orders investigations, prescribes, writes to GHIS | `opd-emr.js`, `opd.html` |
| **Personal / Shared Clinic** | Runs a lightweight offline (localStorage) or multi-device (Drive-synced, AES-GCM-encrypted) clinic EMR outside any hospital system | `personal-clinic.js`, `shared-clinic.js`, `clinic-model.js`, `clinic-store.js`, `clinic-sync.js`, `clinic-drive.js`, `clinic-crypto.js` |
| **Clinic billing** | Looks up a patient, lists unbilled orders, generates/marks-paid an invoice | `clinic-billing.html`, `functions/_clinic_billing_store.js` |
| **GHIS / Ward Sync** | Reads a live hospital ward roster, labs, radiology, meds from GITAM's GHIS; writes back assessment notes and investigation orders | `ghis-ward.js`, `ghis-meds.js`, `ghis-proxy.js`, `functions/api/ghis/[[path]].js` |
| **StewardMD Connect** | Onboards a generic hospital's FHIR/HL7/CSV EMR as a read-only worklist feed | `connect-patient.js`, `connect-source.js`, `functions/_connect/**` |
| **FollowCare** | Enrolls a discharged patient on a recovery pathway, reviews deterministic recovery-score check-ins, sends SMS/WhatsApp/voice-call follow-ups via a Doctor Action Center | `followcare*.js`, `followcare.html`, `functions/_followcare_*.js` |
| **Watch companion (iOS/Wear OS)** | Glances at a patient watchlist, gets critical-lab alerts, runs a Code Blue/sepsis/procedure timer with CPR-compression feedback, looks up drugs/calculators on the wrist | `native-watch.js`, `watch-lab.js`, `watch-settings.js`, `wear-bridge.js`, `Packages/StewardMDWatchCore`, `ios/StewardMDWatch*`, `android/wear/` |
| **Specialty Workspaces** | Switches to a specialty-specific case engine (Surgery is the only fully built one; ENT/Ophthal/O&G/Urology/Dentistry/Paediatrics are early-access scaffolds) | `workspaces.js`, `ws-*.js` |
| **StewardMD ID / referrals** | Gets a universal SMD-XXXXXX handle for colleague-to-colleague referrals and ICU "Group mode" directories | `steward-id.js`, `steward-id-onboard.js`, `referrals.js` |
| **AI Control Center** | (Owner-only) monitors/caps per-module AI usage, switches models, views the doctor usage dashboard | `functions/_ai_usage.js`, `functions/_credits.js`, `home.js` (owner console) |
| **OTA Updates** | (Owner-only) stages and pushes a JS-bundle update to installed devices without an app-store release | `functions/_ota.js`, `functions/api/ota/[[path]].js`, `native-ota.js`, `scripts/ota-stage.mjs` |
| **Subscription / paywall** | Subscribes to a tier (Razorpay web/Android, StoreKit 2 iOS), redeems institution coupons, buys AI-token top-ups | `pro-paywall.js`, `iap.js` |

---

## 2. CLINICAL SCOPE

### Calculators / scores (`calculators.js` — 420 total, by category)

- **Cardiovascular (56):** CHA₂DS₂-VASc, CHADS₂, HAS-BLED, QTc (Bazett/Fridericia/Framingham/Hodges), Mean Arterial Pressure, TIMI (UA/NSTEMI and STEMI), Wells (PE and DVT), PERC, Shock Index (+ modified), LDL (Friedewald), Non-HDL Cholesterol, HEART score, sPESI, PESI, Killip classification, Geneva score (revised), RCRI (Lee), Sgarbossa (+ modified Smith), ASCVD Pooled Cohort Equations, Framingham Risk (General CVD), San Francisco/Canadian Syncope Rules, ORBIT/ATRIA Bleeding Risk, Caprini VTE, Duke Treadmill Score, DASI, NYHA class, Cornell/Romhilt-Estes/Sokolow-Lyon LVH voltage criteria, H₂FPEF, EDACS, ADD-RS, Pulse Pressure, Rate-Pressure Product, ABI, Fontaine/Rutherford classification, Fick cardiac output, cardiac output/index, stroke volume/index, cardiac power output, RVSP (TR jet), mitral valve area (PHT), aortic valve area (continuity), LV mass (ASE cube), E/e′, Teichholz EF, fractional shortening, mean PAP, PVR, transpulmonary gradient, QRS axis, DAPT score.
- **Critical care / ICU (42):** SOFA, qSOFA, APACHE II, NEWS2, MEWS, CURB-65, CRB-65, Rockall (UGIB), BISAP, Glasgow-Imrie/Ranson's (pancreatitis), PaO₂/FiO₂, A–a gradient, anion gap (± albumin-corrected), Winter's formula, serum osmolality/gap, Parkland burns formula, ROX index, Berlin ARDS, Murray Lung Injury Score, Oxygenation Index, SF ratio, O₂ extraction ratio, minute ventilation, static compliance, Bohr-Enghoff dead space, ARDSnet predicted body weight/tidal volume, Rapid Shallow Breathing Index, Vasoactive-Inotropic Score, SVR, cerebral perfusion pressure, nitrogen balance, mNUTRIC, max allowable blood loss, Padua VTE, Revised Trauma Score, RASS, CaO₂, DO₂, Glasgow-Blatchford.
- **Renal (28):** CrCl (Cockcroft-Gault), eGFR (CKD-EPI 2021, MDRD race-free, cystatin C, bedside Schwartz paediatric), FENa/FEUrea/FEMg/FEPO₄/FEUA/FEHCO3, corrected Na, free-water deficit, sodium deficit, corrected calcium, maintenance fluids (Holliday-Segar), urine anion gap, TTKG, urea reduction ratio, Kt/V (Daugirdas), KDIGO AKI staging, bicarbonate deficit, BUN/Cr ratio, Adrogué-Madias, uACR/uPCR, total body water (Watson), STONE score, Mehran score, Ca-PO4 product, delta-delta ratio.
- **Hepatology (17):** MELD, MELD-Na, MELD 3.0, Child-Pugh, Maddrey's DF, FIB-4, APRI, King's College criteria, SAAG, Glasgow Alcoholic Hepatitis Score, NAFLD Fibrosis Score, ALBI grade, Milan criteria, BARD score, Fatty Liver Index, Hepatic Steatosis Index, De Ritis ratio, West Haven grade.
- **Neurology (39):** GCS (+ pupils), FOUR score, NIHSS, A2DS2, ABCD², ICH score, modified Rankin, Hunt & Hess, Fisher/modified Fisher grade, WFNS grade, Ottawa SAH rule, CIWA-Ar, NEXUS/Canadian C-Spine rules, Canadian CT Head Rule, 4AT, CAM, MMSE, MoCA, AMTS, AD8, Barthel Index, Rancho Los Amigos, ASIA impairment, House-Brackmann, modified JOA, GOS (+ extended), Epworth Sleepiness Scale, Hoehn & Yahr, Spetzler-Martin AVM grade, DN4, STESS, ABC/2, Cincinnati/LAMS/ROSIER stroke scales, Clinical Dementia Rating, DRAGON/THRIVE scores, MIDAS, HIT-6, modified Ashworth.
- **Toxicology (5):** Rumack-Matthew nomogram, Naranjo ADR scale, Hunter Serotonin Toxicity Criteria, Widmark blood alcohol estimate, elemental iron ingestion.
- **Dermatology (6):** SCORTEN, Glasgow 7-point checklist (melanoma), DLQI, SCORAD, UAS7, Fitzpatrick phototype.
- **Infectious disease (8):** SIRS, MASCC febrile neutropenia, DRIP, Pitt bacteraemia, FeverPAIN, modified Duke criteria, CPIS, Kawasaki criteria.
- **Respiratory (13):** STOP-BANG, SMART-COP, BODE index, BAP-65, GAP index (IPF), CAT, mMRC, GOLD ABE, YEARS algorithm, Hestia criteria, NEXUS Chest, ISARIC 4C, modified Borg.
- **Gastroenterology (10):** Harvey-Bradshaw Index, Truelove-Witts, AIMS65, Mayo score (UC), Forrest classification, Rome IV (IBS), Bristol Stool Scale, stool osmotic gap, PUCAI, Wexner incontinence score.
- **Rheumatology (9):** DAS28-ESR, CDAI, SDAI, BASDAI, BASFI, DAPSA, CASPAR criteria, ACR/EULAR RA 2010, ASDAS-CRP.
- **Haematology (24):** ANC, IMPROVE VTE, ISTH DIC score, RPI, NLR, PLR, AEC, ALC, Ganzoni iron deficit, HScore (HLH), PLASMIC score, Sokal/EUTOS index, IPSS-R, Rai/Binet staging (CLL), IPI/FLIPI/MIPI (lymphoma), R-ISS/ISS (myeloma), DIPSS, corrected count increment, corrected WBC, Green & King Index, absolute reticulocyte count.
- **Oncology (20):** Calvert formula, Mirels score, NCCN-IPI, R-IPI, Nottingham Prognostic Index, modified Glasgow Prognostic Score, PSA doubling time, BED/EQD2, CLL-IPI, CNS-IPI, IMDC (Heng), MSKCC (Motzer), Fong clinical risk, IGCCCG, MGUS risk (Mayo), Manchester score (SCLC), SINS, Karnofsky, ECOG, Khorana score, Ann Arbor staging.
- **Endocrine (10):** Burch-Wartofsky, HbA1c→eAG, HOMA-IR/%B, QUICKI, free androgen index, Ferriman-Gallwey score, FINDRISC, steroid/corticosteroid conversion, insulin dosing (TDD/basal-bolus/ICR/correction).
- **Obstetrics (6):** Bishop score, APGAR, biophysical profile, amniotic fluid index, gestational age from CRL, IOM pregnancy weight-gain target, Robson 10-group classification.
- **Paediatrics (13):** Westley croup score, Kocher criteria, PECARN head injury rule, paediatric appendicitis score, Downes score, New Ballard score, Silverman-Andersen score, bacterial meningitis score, Rochester criteria, Braden Q, corrected age for prematurity, APLS weight estimate, paediatric ETT size/depth.
- **Psychiatry (23):** PHQ-9/2/15, GAD-7/2, AUDIT/AUDIT-C, CAGE, COWS, MDQ, Edinburgh Postnatal Depression Scale, GDS-15/30, HAM-D/HAM-A, YMRS, Y-BOCS, HADS, Zarit Burden Interview, BDI, BAI, PSQI, Insomnia Severity Index, Fagerström test, PCL-5.
- **Musculoskeletal (13):** Ottawa Ankle/Foot/Knee, Pittsburgh Knee Rules, Salter-Harris classification, Oswestry Disability Index, Neck Disability Index, WOMAC, Lysholm Knee Score, Harris Hip Score, Tampa Scale of Kinesiophobia, Constant-Murley score, Oxford Knee/Hip score, QuickDASH.
- **General / nutrition / geriatrics (~35):** BMI/IBW/AdjBW, BSA, Devine IBW, Mifflin-St Jeor, Harris-Benedict, lean body mass (Boer), body fat % (Deurenberg), waist-hip/waist-height ratio, MUST, NRS-2002, mNA-SF, Braden Scale, Norton pressure-sore risk, Morse Fall Scale, Charlson Comorbidity Index, Clinical Frailty Scale, FRAIL scale, Timed Up and Go, PRISMA-7, Katz ADL, Lawton IADL, burn TBSA (rule of nines), morphine milligram equivalents, Apfel PONV score, 4Ts score (HIT), Light's criteria, Alvarado/Air score (appendicitis), DECAF (COPD), SARC-F.
- **Ophthalmology (3):** Snellen→logMAR, spherical equivalent, IOL power (SRK II).

### Drug interaction rules (`interaction-rules.js`)
330 class/mechanism-level rules (8 contraindicated, 47 major, 14 moderate, 257 monitor-level), sourced from ONC/NLM High-Priority DDI list, openFDA SPL, CredibleMeds QTdrugs List, RxNorm/RxClass, spanning ~1,452 individual drug names mapped to pharmacologic class.

### Antibiotic / antimicrobial stewardship
- Antibiogram susceptibility data for **Staphylococcus aureus, E. coli, Klebsiella pneumoniae, Pseudomonas aeruginosa, Acinetobacter baumannii, Enterococcus faecalis/faecium, Proteus mirabilis, Citrobacter, Enterobacter cloacae, Salmonella Typhi** across 5 Indian regions (east/west/north/south/national), sourced from ICMR-AMRSN + 20 individual hospital antibiogram studies.
- Renal-dose-adjusted antibiotics (~22–32 named agents): ceftazidime, cefotaxime, cefuroxime, cefazolin, cephalexin, cefixime, ceftazidime-avibactam, cefiderocol, aztreonam, doripenem, imipenem, ertapenem, ampicillin, amoxicillin, amoxicillin-clavulanate, cotrimoxazole, acyclovir, norfloxacin, daptomycin, pyrazinamide, ethambutol, plus a separately verified 10-drug table.

### Diagnosis & management KB (`dxmgmt.js`, 327 non-infective entries)
Covers essentially every internal-medicine system: cardiology (aortic/mitral valve disease, dilated cardiomyopathy, pulmonary hypertension, arrhythmias, pericardial disease, ARDS), endocrinology (diabetes, thyroid disease, adrenal disease, MEN, osteoporosis, metabolic syndrome), gastroenterology/hepatology (cirrhosis, coeliac disease, IBD, pancreatitis, Wilson's disease, haemochromatosis), nephrology (glomerular diseases, PKD), neurology (Alzheimer's, ALS, Parkinson's, myasthenia gravis, prion disease, autoimmune encephalitis), rheumatology/immunology (SLE, vasculitis syndromes, IgG4-related disease, familial Mediterranean fever), haematology-oncology (leukaemias, lymphomas, myeloma, sickle cell disease), toxicology (paracetamol/methanol poisoning, snakebite envenomation), and a large infectious-disease chapter list (aspergillosis, candidiasis, melioidosis, brucellosis, leptospirosis-adjacent rickettsial disease, HIV/AIDS, tuberculosis-adjacent NTM, rabies, dengue/viral haemorrhagic fever, etc. — ~60+ ID entries).

### Clinical reasoning engine (`reasoning.js`, 98 non-infective differentials)
Symptom-driven differential generator spanning emergencies (ACS, aortic dissection, PE, DKA/HHS, status epilepticus, anaphylaxis, cardiac tamponade, SAH, ruptured AAA), toxidromes (opioid/salicylate/organophosphate poisoning, serotonin syndrome/NMS), and chronic-disease flares (CKD, RA, IBD, MS relapse), each schema-matched to a management brief in `dxmgmt.js`.

### ICU protocols (`icu.js`)
Built-in emergency protocol set: sepsis/septic shock, undifferentiated shock, DKA/HHS, major GI bleed, ACS, acute stroke, ARDS, hyperkalaemia, status epilepticus, PE, anaphylaxis. Auto-scored: SOFA, qSOFA, APACHE II, NEWS2, BISAP, Child-Pugh.

### Insulin products (`insulin-db.js`, 29 named brands)
Actrapid, Admelog, Apidra, Basaglar, Basalog, Fiasp, Glaritus, Humalog (+ Mix 25, Mix 75/25), Humulin 70/30/N/R (+ U-500), Insulatard, Lantus, Levemir, Lyumjev, Mixtard 30, NovoMix 30, NovoRapid, Novolin 70/30/N/R, Novolog (+ Mix 70/30), Semglee, Toujeo, Tresiba.

### Oncology (production module, not teaching content)
- **25 cancer types** in OncoTree: AML, anal, bladder, breast, cervical, CLL, CNS, colorectal, DLBCL, GIST, HCC, head & neck, Hodgkin, lung, melanoma, myeloma, ovarian, pancreatic, prostate, RCC, sarcoma, testicular, thyroid, upper-GI, uterine.
- **267 chemo regimen protocols** (e.g. AML-7+3, FLAG-IDA, gilteritinib; breast AC-TH, TCHP, T-DXd, pembro-chemo TNBC; CLL FCR, acalabrutinib; CNS TMZ concurrent; DLBCL DA-EPOCH-R, epcoritamab; FOLFIRINOX, FOLFIRI; R-CHOP; plus GU/gyn/GI/sarcoma/thyroid groups).
- **TNM staging for 17 sites** (bladder, breast, cervix, colorectal, endometrium, oesophagus, gastric, kidney, liver, lung, melanoma, ovary, pancreas, prostate, testis, thyroid).
- CTCAE toxicity grading and immune-related-AE (irAE) catalogues; RECIST response criteria.

### RadioAnatome (education, not diagnosis)
30 cross-sectional imaging modules: CT abdomen/thorax/pelvis/head/hand/foot/knee/live-torso/whole-body (axial/coronal/sagittal, real Visible Human data, 1,249/1,249 pins verified) plus brain T1 MRI (real images, unverified auto-generated labels, zero pins — a documented data gap, not a bug).

### SURGX content
8 protocols (ATLS primary survey, burns, chest trauma, haemorrhagic shock, head injury, post-op deterioration, surgical sepsis, upper-GI bleed), 5 procedures (abscess drainage, appendicectomy, hernia repair, lap cholecystectomy, laparotomy), 3 cases, 15 evidence records — all `ai_drafted`, none clinically signed off yet.

### CliniX content
22 diseases (anaemia, ascites, ataxia, bronchial asthma, chronic liver disease, congenital heart disease, CCF, COPD, cord compression, cranial nerve palsy, hepatomegaly, infective endocarditis, IHD, jaundice, parkinsonism, peripheral neuropathy, pleural effusion, pneumonia, rheumatic heart disease, splenomegaly, stroke, tuberculosis) across 6 skill packs (abdomen, cardiovascular, core, general, neurology, respiratory) — `ai_drafted`, pending clinical sign-off.

### Imaging AI findings detected
- **KardiQ X:** AFib/flutter, sinus tachy/bradycardia, 1st-degree AV block, complete/incomplete RBBB, LBBB, PVC/PAC, prolonged QTc, STEMI by territory (inferior/lateral/anteroseptal/anterior/anterolateral) with reciprocal changes and Sgarbossa/modified-Sgarbossa criteria; optional HEART/TIMI ACS scoring.
- **ThoreX (clinical, 18-class):** atelectasis, consolidation, infiltration, pneumothorax, oedema, emphysema, fibrosis, effusion, pneumonia, pleural thickening, cardiomegaly, nodule, mass, hernia, lung lesion, fracture, lung opacity, enlarged cardiomediastinum. **Educational (38-class, X-Raydar):** adds aortic calcification, bulla, cavity, rib/clavicle fracture, pneumomediastinum, dextrocardia, etc.
- **FundX:** proliferative/moderate/mild diabetic retinopathy features, glaucoma suspicion (cup-disc ratio), hypertensive retinopathy features — framed as "considerations," not diagnoses.
- **SknX (on-device, 7-class HAM10000):** actinic keratosis, BCC, benign keratosis, dermatofibroma, melanoma, melanocytic naevus, vascular lesion. **Cloud (opt-in, 59-class):** broader general dermatology set (psoriasis, eczema, BCC, SCC/SCCis, etc.).

---

## 3. EMR / HIS

### Authentication / login gate
Firebase Auth (compat SDK) is the identity provider. Sign-in methods: Google (native OAuth via `@capacitor-firebase/authentication`, exchanged into the web SDK session), Apple (required by App Store Guideline 4.8), email+password with 6-digit OTP verification, and a 5-minute guest trial. A **separate, additional** doctor-verification gate (`verify.js`) sits on top: uploads an NMC/State registration certificate or ID, cross-checked server-side against a live NMC register mirror; sets a `verified:true` Firebase custom claim on approval; states are `verified` / `pending` (manual review) / `trial` (7-day self-serve) / `rejected` / `unverified`. Firebase App Check (native-only) attests device integrity, fail-open by design.

### GHIS (GITAM Institute of Medical Sciences hospital system) — **LIVE**
`functions/api/ghis/[[path]].js` hardcodes real hospital hosts (`ghis.gitam.edu`, `gimsrlogin.gitam.edu`) and does per-doctor SSO login with cookie-jar session storage in Cloudflare KV. This is a reverse-engineered integration against one specific hospital's ASP.NET MVC endpoints, not a demo.
- **Reads (live, enabled):** inpatient ward roster/worklist, lab results, radiology reports, medication list.
- **Writes (live, enabled via `QUEUE_EMR_WRITE=1` in `wrangler.toml`):** clinical assessment notes, investigation orders.
- **Writes (built, hard-blocked server-side):** prescribing — requires `QUEUE_EMR_PRESCRIBE_OK=1`, which is **not set anywhere** in the deploy config; code comment: "CreateDrugs payload not verified."
- **Writes (planned, not wired):** discharge summary — `discharge-ghis.js` builds the HTML payload and a confirmation UI but explicitly states the network call itself has not been added yet, pending the hospital's request spec.
- Currently single-hospital: the UI hardcodes GIMSR as the only wired option; other hospitals go through an "Add your hospital" request form.

### StewardMD Connect (generic hospital FHIR onboarding) — **LIVE, read-only**
`functions/_connect/onboard/*` lets any hospital self-onboard a FHIR/HL7/CSV connector (SSRF-guarded, credential-sealed, RBAC-hardened). `functions/_connect/onboard/pull.js` and `_opd_connect_connector.js` do real `fetch()` calls against a hospital's FHIR `/Encounter` endpoint, feeding the OPD worklist and ICU/ward dashboards **read-only** — "no write-back here" (explicit code comment).

### ABDM (India's Ayushman Bharat Digital Mission health-data exchange) — **PLANNED / SCAFFOLDING**
`functions/_connect/abdm/*` implements a real consent state machine (JWS signature verification, monotonic status transitions) and real crypto (Fidelius sealing), but the actual gateway endpoint paths and field names are explicitly marked `// VERIFY` / "corroborated-not-official — research was WAF-blocked" throughout. `abdm/connector.js` is an explicit skeleton (stub no-ops for authenticate/validate/initiate). Feature flags (`CONNECT_FLAG`, `CONNECT_HIP_FLAG`, `CONNECT_MASTER_KEY`) are not set anywhere in `wrangler.toml`, so this defaults OFF in production.

### SMART on FHIR Backend Services — **PLANNED / SCAFFOLDING**
`functions/_connect/smart/*` implements RS384/ES384 JWT client-credential auth, but the host allow-list is currently limited to sandbox hosts (`launch.smarthealthit.org`), with a code comment "VERIFY: the real hospital FHIR base host(s)." Flag-gated off (`CONNECT_FHIR_FLAG`, unset in deploy config).

### What's read vs written, in one line
Read (live): GHIS ward roster, labs, radiology, meds; Connect FHIR encounters. Written (live): GHIS assessment notes, investigation orders. Written (blocked): GHIS prescriptions. Written (not wired): GHIS discharge summary. ABDM/SMART: neither reads nor writes live data yet — infrastructure only.

---

## 4. DATA

### What's captured
Patient name, mobile number, MRN/ABHA number, age/DOB, gender, vitals, labs, medications, assessment notes, prescriptions, ECG/CXR/fundus/skin images, operative notes, discharge summaries, follow-up check-in responses (symptom severity, photos of wounds/rashes).

### Where it's stored
- **Device-local, unencrypted-in-plaintext-index (metadata) but Firestore-mediated for real records:** the app has no direct client read/write on any PHI-bearing Firestore collection — `firestore.rules` sets `allow read, write: if false` on `q_patients`, `q_tickets`, `q_timeline`, `fc_episodes`, `fc_comms`, `icuGroups/*/patients`, `referrals`, `sharedCases`, etc., forcing all access through server-side Cloudflare Pages Functions.
- **Server (Firestore, via `functions/_opd_patient_store.js`):** OPD patient registry — PHI fields (name, mobile, address) are encrypted at rest (`encPHI`/`decPHI`) before being written.
- **Server (R2):** FollowCare patient photos, 7-day lifecycle expiry, view-once.
- **Server (D1):** drug database, NMC register mirror, Connect tenant/connector configs, audit logs — no PHI found in D1.
- **Device-local only, single-clinic mode:** `personal-clinic.js` stores all patient/consult data purely in `localStorage`, "no server, fully offline" (its own header comment), password-protected via native Keychain/SecureStorage.
- **Device-local, encrypted, multi-device sync:** `shared-clinic.js` + `clinic-sync.js` + `clinic-drive.js` sync AES-256-GCM-encrypted deltas (PBKDF2-SHA256, 200k iterations, WebCrypto) through the clinic's own Google Drive folder — StewardMD's servers never see the plaintext.
- **Device-local, encrypted, no server copy at all:** SURGX operative notes — AES-256-GCM, device-local only; "there is no SURGX note endpoint, by design" (vault doc, confirmed in code by the absence of any note-upload route).
- **Device-local, offline reference data (not patient data):** the downloaded drug SQLite DB and clinical-monograph bundle (`offline-db.js`, `offline-clinical.js`) — these are shared reference content, not per-patient records.

### Does data leave the device?
Yes, for OPD/Queue/ICU-group/FollowCare/Connect patient records — these are server-mediated (Firestore/R2/D1) with encryption at rest and no direct client access. Personal Clinic mode keeps data on-device only by design; Shared Clinic mode leaves the device only as encrypted ciphertext to the clinic's own Drive; SURGX notes never leave the device at all.

### Identifiability
Names, mobile numbers, MRNs, and ABHA numbers are captured and are directly identifiable. The code encrypts these fields before persistence in shared/synced paths and blocks direct client-side Firestore reads on PHI collections, but the data itself (once decrypted server-side or on an authorized device) is fully identifiable — this is not a de-identified/anonymized dataset.

---

## 5. AI

**Providers actually called** (all confirmed by literal endpoint URLs in `functions/api/ai/[[path]].js` and related files):
- **Google Vertex AI** — primary, `https://{region}-aiplatform.googleapis.com/.../publishers/google/models/{model}:generateContent`, keyless via Workload Identity Federation. Default model `gemini-2.5-flash`; vision calls are hard-pinned to `gemini-2.5-flash` regardless of admin overrides.
- **Google AI Studio (Developer API)** — automatic fallback if Vertex fails, `generativelanguage.googleapis.com`.
- **Azure OpenAI (Foundry)** — optional alternate primary (`AI_PROVIDER=azure`), not default.
- **Groq** — used only by ThoreX's "explain & correlate" feature, tried before Gemini for latency/cost.
- **Cloudflare Workers AI + Vectorize** — embedding (`bge-base-en-v1.5`) and semantic search only, for retrieval grounding, not generation.
- **No direct Anthropic/Claude or direct OpenAI usage anywhere in the product.**

**What the model is asked to do, per module:**
| Module | Task |
|---|---|
| MaiK Cloud (`/api/ai/explain*`) | Explain an already-computed differential, or answer a general clinical-knowledge question grounded in retrieved KB chunks — never makes the diagnosis itself (a separate deterministic engine does that) |
| MaiK Vision (`/api/ai/vision`) | Read a captured clinical image (monitor, labs, ventilator screen, ABG, med list) and return structured fields only, app-validated before use |
| MaiK Scribe | Extract structured EMR fields from dictated/OCR'd text |
| MaiK Ask | Word the next pathway-selected history question naturally; extract structured findings from the patient's spoken answer (deterministic parsing tried first) |
| CliniX tutor | Teach a med student bedside skills; hard-coded rule never to emit a drug dose/regimen |
| FollowCare voice check-in | Speech-understanding only of a patient's spoken reply during an automated call — explicitly "not a clinical decision" |
| SknX rerank/report | Re-rank an already-computed differential and write educational discussion text; the image itself is never sent to this call |
| ThoreX explain/correlate | Explain a CXR finding / write an impression narrative / correlate with clinical data; the image itself is never sent |
| KB retrieval (`/api/retrieve`) | Not generative — semantic search over KB chunks to build the grounding package for the calls above |

**MaiK Intent Firewall:** a two-layer, allow-list (not block-list) gate — client-side (`kb/ai/maik-scope.js`) and server-side (`functions/api/ai/[[path]].js`, `firewallBlock()`, described in code as defense-in-depth: "system prompts are not a security boundary") — requires a positive medical signal before any query reaches an LLM or web search; a third layer is a `MEDICAL_ONLY` system-prompt instruction catching the uncertain tail the deterministic firewall deliberately lets through.

**Local model tier:** MaiK offers a fully offline "on-device" tier via a local GGUF model (`maik-local.js`, `capacitor-llama` native plugin) — explicitly ungrounded (answers from model weights alone, no KB context injected) and documented in code as "CAN BE WRONG (accepted tradeoff)."

**Patient-record-to-AI bridge:** `functions/_connect/maik-bridge/*` can fold a real hospital patient's problem list/meds/allergies/labs into a MaiK prompt, but only text derived from structured data (never raw documents/images), gated behind an explicit clinician "attach" action plus a tenant consent/BAA check; currently double flag-gated off by default (`smd_connect` + `smd_connect_maik`).

---

## 6. TEACHING / EDUCATION

- **CliniX** — the dedicated teaching module: 22-disease bedside-skills curriculum for medical students (history-taking → examination → clinical reasoning → investigations → diagnosis → treatment → case simulation → OSCE → viva voce), with a deterministic (no-LLM-hallucination) scripted patient simulator and a dose-guard tutor that sanitizes out any drug-dose-shaped reply. Content is `ai_drafted`, not yet clinically signed off.
- **RadioAnatome / Atlas** — a cross-sectional anatomy learning atlas (30 modules), modeled on e-Anatomy/IMAIOS-style tap-to-label study.
- **KardiQ X Learn** — a 1,041-lesson ECG interpretation atlas bundled alongside the diagnostic module.
- **SknX educational report** — Phase 2 (merged, flag-gated) generates an educational discussion of a skin lesion's differential with citations, explicitly "no Rx" at that phase.
- **OncoTree home** — functions partly as a reference workbench (links into the calculator library, KB, and formulary) alongside its clinical-execution role.

---

## 7. SAFETY

- **Doctor Verification gate** — blocks/limits app features until NMC/State medical-registration proof is uploaded and reviewed; a self-serve 7-day trial exists as a fallback, not a bypass of the requirement long-term.
- **MaiK Intent Firewall** — refuses to engage with non-medical queries (see AI section); designed to fail toward answering a genuine clinical question rather than over-refusing.
- **Prescription writer never invents a dose** — `rx-build.mjs` explicitly flags any unresolved dose `unverified:true` rather than fabricating a value; output is framed as "a DRAFT the prescriber reviews, edits and signs."
- **FollowCare guardrail (matches CLAUDE.md requirement)** — `followcare-engine.js` header states the deterministic engine "owns every clinical decision. The LLM may later PHRASE/translate this, but must NEVER change it." Medication side-effect reports route to `notify_doctor`, never to an auto-adjustment; every AI-drafted outbound message requires explicit doctor approval before send; a `video_consult` message type is marked `comingSoon` and rejected server-side.
- **SknX malignancy guardrail** — canonicalizes ~15+ malignant-lesion label synonyms and forces mandatory referral (never a prescribe path) whenever a malignant or pigmented-ambiguous differential tops the list, regardless of which inference tier ran.
- **SURGX / CliniX content-review gate** — every protocol/case/lesson is tagged `ai_drafted` and hidden from testers/students until the owner flips a per-item `review.status` to `approved`; a fail-closed licence gate additionally blocks unreviewed content.
- **Firestore fail-closed rules** — direct client access to any PHI collection is denied by rule (`allow read, write: if false`); all access is server-mediated.
- **Vision model pinning** — the OCR/image-read model is hard-pinned to a fixed model regardless of admin cost-saving overrides, "to protect handwriting OCR safety" (Decisions log).
- **GHIS prescribing write-back hard-blocked** server-side pending payload verification, independent of the client-side confirm dialog.
- **App Check fail-open by design** — deliberately does not block usage on attestation failure, to avoid a prior incident where a retry storm starved the AI endpoint; this is a stated tradeoff (availability over strict device attestation), not an oversight.
- Standard clinician-facing disclaimers exist as static pages (`disclaimer.html`, `terms.html`, `privacy.html`) but their in-app enforcement (e.g., a mandatory acknowledgement gate before first clinical use) was not verified in this pass.

---

## 8. TECH STACK and DEPLOYMENT

**Frontend:** Buildless static ES5 IIFEs at the repo root — no bundler, no framework, no build compilation step for the JS itself. `scripts/build-www.sh` only copies/filters files into `www/` and stamps a build-number marker (from `git rev-list --count HEAD`) into `index.html`; it does not transpile or bundle. Cache-busting is via `?v=goldNNN` query tokens tied to the service-worker cache key.

**Native wrapper:** Capacitor 8 (`@capacitor/core ^8.4.1`), appId `in.stewardmd.app`. A large first-party native plugin surface under `local-plugins/@stewardmd/*`: ECG digitiser, FundX depth (ARKit/ARCore), SknX vision (Core ML), vision OCR, Whisper (on-device STT), llama (on-device LLM), IAP (StoreKit 2), watch bridge, app orientation — plus community plugins for SQLite, speech-recognition, secure storage, push/local notifications, camera, filesystem, file-picker, haptics. CapacitorUpdater (Capgo) is configured with `autoUpdate: "off"` (OTA staged, not auto-pushed). Android: `minSdkVersion 24`, `compileSdk/targetSdk 36`, current `versionCode 13`/`versionName "7"`. iOS: standard Xcode project (no CocoaPods workspace — Capacitor SPM).

**Backend:** Cloudflare Pages Functions (`functions/`) for the main API surface, plus a separate Cloudflare Worker (`worker/`) serving the drug database at `api.stewardmd.in`, deployed independently via `wrangler deploy`. Server-side resources declared in `wrangler.toml`: Workers AI binding, Vectorize index (`stewardmd-kb`), 3 D1 databases (`stewardmd_nmc`, Medical Updates, StewardMD Connect), KV namespaces (GHIS sessions, MaiK cache, Updates cache), 2 R2 buckets (FollowCare media, offline/OTA bundle storage).

**Firebase:** Auth, Firestore (PHI datastore, server-only access), FCM push notifications, App Check.

**Hosting:** Cloudflare Pages, custom domain `stewardmd.in` (via `CNAME`), site-wide security headers (`_headers`: HSTS, X-Frame-Options SAMEORIGIN, Referrer-Policy) with one scoped CSP-frame exception for a YouTube-embed shim needed inside the Capacitor WebView origin.

**Watch companion:** native SwiftUI (watchOS, `Packages/StewardMDWatchCore` + `ios/StewardMDWatch*`) and Kotlin/Compose (Wear OS, `android/wear/`), each with their own test suites, bridged from the phone app's session token — not independently authenticated on iOS.

**CI/CD:** 5 GitHub Actions workflows — `ci.yml` (unit tests, atlas content checks, MaiK regression eval, syntax preflight on push/PR to `main`), `deploy-worker.yml` (drug API Worker deploy, gated by a `production` environment approval), `embed-kb.yml` (pushes KB content into the Vectorize index), `ota-stage.yml` (builds and stages `www/` to R2 as an OTA candidate — never auto-pushes to devices), `terraform-cloudflare.yml` (Cloudflare security-header IaC).

---

## 9. BUILD STATUS

Judged from actual code substance (real logic vs. mocks/stubs/unwired flags), not from comments or vault-note headers — several vault notes were found to be stale (e.g. CliniX's "flag OFF" header contradicts its `def:true` code) and are noted below.

| Module | Status | Basis |
|---|---|---|
| Clinical calculators (420) | **FULLY WORKING** | Real formulas, generic renderer, no stubs found |
| Drug interaction checker | **FULLY WORKING** | 330 real rules over 1,452 drugs, machine-built from cited public sources |
| Scan-Meds / Drug Index | **PARTIAL** | Core lookup live; A-Z/by-class browse tabs degrade to on-device formulary until the drug-API Worker's D1 index is deployed |
| Ward formulary / renal dosing / electrolytes | **FULLY WORKING** | Pure, complete, tested logic |
| Insulin dosing | **PARTIAL** | Core engine + safety (31 tests) done; DKA and paediatric sub-workflows deliberately deferred, flags default OFF pending sign-off |
| Antibiogram / abx wizard | **FULLY WORKING** | Real regional data (20 studies), functioning wizard UI over existing engines |
| Diagnosis & management KB (327 entries) | **FULLY WORKING** | Static curated content, cited, in production |
| Clinical Reasoning engine | **FULLY WORKING** | Live differential generator, in production |
| ICU workstation | **PARTIAL** | Core dashboard/auto-scores/collab live; v2 redesign built but undeployed (flags off); imaging-import only Phase 1 of 4 shipped |
| KardiQ X (ECG) | **PARTIAL / STAGED** | Real on-device ORT ensemble + real Python backend, but flag default OFF pending clinician sign-off and regulatory review |
| ThoreX (chest X-ray) | **PARTIAL / STAGED** | Real on-device + backend inference, real report generator; usage-cap wiring incomplete (roadmap item) |
| FundX (fundus) | **PARTIAL / STAGED** | Real capture-quality heuristics on-device; actual disease detection is a cloud Gemini call defaulting to a mock, live-retina-presence signal explicitly simulated; flag OFF |
| SknX (dermatology) | **PARTIAL / STAGED** | Phase 1–2 (classification + educational report) merged; Phase 3 (clinician Rx) built but flag OFF, gated on multiple sign-offs; on-device model explicitly marked "experimental/uncalibrated" in code |
| MaiK (AI assistant) | **FULLY WORKING** | 3-tier routing live, streaming confirmed working natively as of 2026-08-24 |
| MaiK Ask | **PARTIAL** | Functional but gated behind a "public-release" flag pending clinician sign-off on pathway content |
| MaiK Scribe / ambient voice | **FULLY WORKING** | Real on-device Whisper + cloud fallback, documented bugs since fixed |
| Oncology / OncoTree | **FULLY WORKING** | Owner-approved production go-live (2026-08-15), real multi-level approval workflow, 267 protocols, extensive test suite |
| Protocol Maker / Protocol Sheet | **FULLY WORKING** | Complete, tested, decision-support-framed |
| SURGX | **PARTIAL (MVP)** | Real architecture, real encryption, small `ai_drafted` content set (8 protocols/5 procedures/3 cases), gated by a draft flag pending clinical review |
| CliniX | **PARTIAL** | Real architecture, 22-disease `ai_drafted` content, media mostly unsourced; flag is effectively ON in code despite stale "OFF" documentation |
| RadioAnatome / Atlas | **FULLY WORKING** (CT) / **PARTIAL** (brain MRI) | CT modules fully verified (1,249/1,249 pins); brain MRI ships images with unverified auto-generated labels, zero pins, an acknowledged data gap |
| Prescription writer | **FULLY WORKING** | Complete, tested, verification-gated |
| OPD / Smart Queue | **FULLY WORKING** | Live in production since 2026-08-10 per code/tests, multi-clinic, WhatsApp notify, billing MVP |
| OPD EMR overlay | **FULLY WORKING** | Live; write-back to GHIS confirmed enabled |
| Personal / Shared Clinic | **FULLY WORKING** | Real crypto/sync, extensive test coverage, two working storage modes |
| GHIS integration | **PARTIAL** | Reads and assessment/order writes are live; prescribing write hard-blocked; discharge-summary write not wired; single-hospital only |
| StewardMD Connect (generic FHIR) | **PARTIAL** | Real, functioning, but read-only |
| ABDM integration | **PLANNED-NOT-BUILT** (as a working connection) | Real crypto/consent-machine code exists, but gateway contract is unverified and flags are unprovisioned/off |
| SMART on FHIR | **PLANNED-NOT-BUILT** | Auth machinery real; allow-list is sandbox-only, flag off |
| FollowCare | **FULLY WORKING** | Deterministic engine + Doctor Action Center live; SMS/voice channels present in code but flagged OFF pending provider/hospital configuration |
| Watch companion | **FULLY WORKING** | Mature dual-platform native app with real business logic and test suites |
| Specialty Workspaces | **PARTIAL** | Surgery fully built; ENT/Ophthal/O&G/Urology/Dentistry/Paediatrics are early-access scaffolds |
| StewardMD ID | **FULLY WORKING** (mint) / **PARTIAL** (anchor-email capture UI, flag OFF) | Universal mint live since 2026-08-22; verified-email capture UI still gated |
| AI Control Center | **PARTIAL** | Usage tracking/dashboard live; hard cost-cap enforcement (`MAIK_ENFORCE_CAPS`, `AI_COST_CAP_ON`) explicitly OFF in production |
| OTA Updates | **PARTIAL** | Server staging + native client both built and armed; the "one native release" needed to fully activate the pipeline on devices had not happened as of the last recorded status |
| Subscription / paywall | **PARTIAL** | Web/Android (Razorpay) live server-verified; iOS (StoreKit 2) present but shows a "coming soon" state when the native IAP plugin isn't wired, per code |
