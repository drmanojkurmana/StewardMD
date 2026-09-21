/* ============================================================================
   StewardMD — Shared ward formulary and Drug Interactions
   A standalone, searchable reference of commonly used non-antimicrobial drugs
   (PPIs, analgesics, anticoagulants, cardiac, respiratory, endocrine, sedation,
   electrolytes). Integrates with the global search (brand & class aware) and
   provides a browse overlay. Adult dosing only — verify against the patient,
   renal/hepatic function and local protocol. Exposes window.MEDDRUGS.
   ========================================================================== */
(function () {
  "use strict";

  /* id, cat, generic, cls (pharmacologic class), brands[] (incl. class abbrevs
     for searching), dose (adult), notes */
  var DRUGS = [
    /* ---- Gastrointestinal ---- */
    { cat:"Gastrointestinal", generic:"Pantoprazole", cls:"Proton pump inhibitor (PPI)", brands:["pan","pantop","pantocid","pan-d","protonix","ppi"], dose:"40 mg IV/PO once daily. GI bleed: 80 mg IV bolus then 8 mg/h infusion.", notes:"Give before breakfast for PO. Step down to oral when tolerating." },
    { cat:"Gastrointestinal", generic:"Omeprazole", cls:"Proton pump inhibitor (PPI)", brands:["omez","omecip","omeprazole","ppi"], dose:"20–40 mg PO once daily before food.", notes:"" },
    { cat:"Gastrointestinal", generic:"Esomeprazole", cls:"Proton pump inhibitor (PPI)", brands:["nexium","esoz","esomep","ppi"], dose:"40 mg PO/IV once daily.", notes:"" },
    { cat:"Gastrointestinal", generic:"Rabeprazole", cls:"Proton pump inhibitor (PPI)", brands:["rabium","razo","rabeprazole","ppi"], dose:"20 mg PO once daily.", notes:"" },
    { cat:"Gastrointestinal", generic:"Famotidine", cls:"H2-receptor antagonist", brands:["famocid","famtac","h2 blocker","h2"], dose:"20–40 mg PO/IV twice daily.", notes:"Preferred H2 blocker (ranitidine withdrawn — NDMA)." },
    { cat:"Gastrointestinal", generic:"Ondansetron", cls:"Antiemetic (5-HT3 antagonist)", brands:["emeset","ondem","vomikind","zofran","antiemetic"], dose:"4–8 mg IV/PO every 8 h.", notes:"Caution: QT prolongation." },
    { cat:"Gastrointestinal", generic:"Metoclopramide", cls:"Prokinetic / antiemetic", brands:["perinorm","reglan","maxeron","antiemetic"], dose:"10 mg IV/PO three times daily.", notes:"Extrapyramidal effects; avoid in young/obstruction." },
    { cat:"Gastrointestinal", generic:"Domperidone", cls:"Prokinetic / antiemetic", brands:["domstal","vomistop","antiemetic"], dose:"10 mg PO three times daily before meals.", notes:"QT caution." },
    { cat:"Gastrointestinal", generic:"Lactulose", cls:"Osmotic laxative", brands:["duphalac","looz","laxative"], dose:"15–30 mL PO BD–TDS, titrate to 2–3 soft stools/day.", notes:"Mainstay for hepatic encephalopathy." },
    { cat:"Gastrointestinal", generic:"Sucralfate", cls:"Mucosal protectant", brands:["sucrafil","sucralfate"], dose:"1 g PO four times daily on empty stomach.", notes:"Separate from other drugs (binds them)." },

    /* ---- Analgesia / antipyretic ---- */
    { cat:"Analgesia", generic:"Paracetamol", cls:"Analgesic / antipyretic", brands:["crocin","dolo","calpol","pcm","acetaminophen","tylenol"], dose:"650 mg–1 g PO/IV every 6 h. Max 4 g/day (3 g if hepatic risk).", notes:"First-line antipyretic." },
    { cat:"Analgesia", generic:"Diclofenac", cls:"NSAID", brands:["voveran","dynapar","nsaid"], dose:"50 mg PO BD or 75 mg IM.", notes:"Avoid in renal impairment, GI bleed, heart failure." },
    { cat:"Analgesia", generic:"Ibuprofen", cls:"NSAID", brands:["brufen","combiflam","nsaid"], dose:"400 mg PO every 8 h.", notes:"Same NSAID cautions." },
    { cat:"Analgesia", generic:"Ketorolac", cls:"NSAID (parenteral)", brands:["ketanov","ketorol","nsaid"], dose:"30 mg IV every 6 h. Max 5 days.", notes:"Potent; high GI/renal risk." },
    { cat:"Analgesia", generic:"Tramadol", cls:"Opioid analgesic (weak)", brands:["ultracet","tramazac","tramadol"], dose:"50–100 mg PO/IV every 6–8 h. Max 400 mg/day.", notes:"Lowers seizure threshold; serotonergic." },
    { cat:"Analgesia", generic:"Morphine", cls:"Opioid analgesic", brands:["morphine"], dose:"2.5–5 mg IV every 4 h, titrate to effect.", notes:"Monitor RR/sedation; reverse with naloxone." },
    { cat:"Analgesia", generic:"Fentanyl", cls:"Opioid analgesic", brands:["fentanyl"], dose:"25–50 mcg IV bolus; infusion 25–100 mcg/h.", notes:"Preferred in renal failure / haemodynamic instability." },
    { cat:"Analgesia", generic:"Tranexamic acid", cls:"Antifibrinolytic", brands:["txa","trapic","clotonil"], dose:"1 g IV over 10 min then 1 g/8 h; or 500 mg–1 g PO TDS.", notes:"Trauma: give within 3 h." },

    /* ---- Anticoagulation / antiplatelet ---- */
    { cat:"Anticoagulation", generic:"Enoxaparin", cls:"Low-molecular-weight heparin (LMWH)", brands:["clexane","lmwh"], dose:"Treatment 1 mg/kg SC q12h. Prophylaxis 40 mg SC once daily.", notes:"Reduce/avoid if CrCl <30; anti-Xa monitoring if needed." },
    { cat:"Anticoagulation", generic:"Heparin (unfractionated)", cls:"Anticoagulant", brands:["ufh","heparin"], dose:"80 U/kg IV bolus then 18 U/kg/h, titrate to aPTT.", notes:"Reverse with protamine." },
    { cat:"Anticoagulation", generic:"Warfarin", cls:"Vitamin K antagonist", brands:["warf","uniwarfin","warfarin"], dose:"Start 5 mg PO once daily; titrate to INR (target per indication).", notes:"Bridge with heparin; many interactions." },
    { cat:"Anticoagulation", generic:"Aspirin", cls:"Antiplatelet", brands:["ecosprin","disprin","asa","aspirin"], dose:"75–150 mg PO once daily. ACS loading 300 mg.", notes:"" },
    { cat:"Anticoagulation", generic:"Clopidogrel", cls:"Antiplatelet (P2Y12)", brands:["clopilet","plavix","deplatt"], dose:"75 mg PO once daily. Loading 300–600 mg.", notes:"" },
    { cat:"Anticoagulation", generic:"Rivaroxaban", cls:"Direct oral anticoagulant (DOAC)", brands:["xarelto","doac"], dose:"20 mg PO once daily with food (15 mg if CrCl 15–50).", notes:"Avoid CrCl <15." },
    { cat:"Anticoagulation", generic:"Apixaban", cls:"Direct oral anticoagulant (DOAC)", brands:["eliquis","doac"], dose:"5 mg PO twice daily (2.5 mg if ≥2 of: age ≥80, ≤60 kg, Cr ≥1.5).", notes:"" },
    { cat:"Anticoagulation", generic:"Dabigatran", cls:"Direct oral anticoagulant (DOAC)", brands:["pradaxa","doac"], dose:"150 mg PO twice daily.", notes:"Reverse with idarucizumab." },
    { cat:"Anticoagulation", generic:"Vitamin K (Phytomenadione)", cls:"Anticoagulant reversal", brands:["phytomenadione","kapter","vitamin k"], dose:"1–10 mg IV/PO depending on INR / bleeding.", notes:"Warfarin reversal." },

    /* ---- Cardiac / vasoactive ---- */
    { cat:"Cardiac", generic:"Furosemide", cls:"Loop diuretic", brands:["lasix","frusemide","frusenex"], dose:"20–40 mg IV/PO once–twice daily; infusion 5–20 mg/h.", notes:"Monitor K+, renal function, volume." },
    { cat:"Cardiac", generic:"Spironolactone", cls:"Aldosterone antagonist", brands:["aldactone","spiractin"], dose:"25–50 mg PO once daily.", notes:"Watch hyperkalaemia." },
    { cat:"Cardiac", generic:"Metoprolol", cls:"Beta-blocker (β1-selective)", brands:["metolar","betaloc","bb","beta blocker"], dose:"25–50 mg PO BD; ACS 5 mg IV slow (up to 3 doses).", notes:"Avoid in acute decompensated HF, severe bradycardia." },
    { cat:"Cardiac", generic:"Carvedilol", cls:"Beta-blocker (non-selective)", brands:["carca","carvil","bb"], dose:"3.125–25 mg PO twice daily.", notes:"Up-titrate slowly in heart failure." },
    { cat:"Cardiac", generic:"Amlodipine", cls:"Calcium channel blocker", brands:["amlong","amlokind","ccb"], dose:"5–10 mg PO once daily.", notes:"Ankle oedema common." },
    { cat:"Cardiac", generic:"Ramipril", cls:"ACE inhibitor", brands:["cardace","ramistar","acei"], dose:"2.5–10 mg PO once daily.", notes:"Watch K+, creatinine, cough, angioedema." },
    { cat:"Cardiac", generic:"Telmisartan", cls:"Angiotensin receptor blocker (ARB)", brands:["telma","telsar","arb"], dose:"40–80 mg PO once daily.", notes:"" },
    { cat:"Cardiac", generic:"Sacubitril / Valsartan", cls:"Neprilysin inhibitor + ARB (ARNI)", brands:["entresto","sacubitril","valsartan","arni"], dose:"Start 49/51 mg PO BD; double every 2–4 wk to target 97/103 mg BD. ACE-washout 36 h.", notes:"HFrEF. Contra with ACEi (36 h washout), angioedema Hx, pregnancy (boxed fetal toxicity)." },
    { cat:"Cardiac", generic:"Atorvastatin", cls:"Statin", brands:["atorva","storvas","lipitor","statin"], dose:"10–80 mg PO at night.", notes:"Check LFTs; myopathy risk." },
    { cat:"Cardiac", generic:"Rosuvastatin", cls:"Statin", brands:["rosuvas","crestor","statin"], dose:"5–40 mg PO once daily.", notes:"" },
    { cat:"Cardiac", generic:"Nitroglycerin (GTN)", cls:"Nitrate / vasodilator", brands:["gtn","nitrocontin","angised","ntg"], dose:"Infusion 5–200 mcg/min titrated; SL 0.4 mg PRN.", notes:"Avoid if SBP <90 or recent PDE5 inhibitor." },
    { cat:"Cardiac", generic:"Digoxin", cls:"Cardiac glycoside", brands:["lanoxin","digoxin"], dose:"0.125–0.25 mg PO once daily (load 0.5 mg).", notes:"Narrow window; reduce in renal failure, watch K+." },
    { cat:"Cardiac", generic:"Amiodarone", cls:"Antiarrhythmic (class III)", brands:["cordarone","tachyra","amiodarone"], dose:"150–300 mg IV then 1 mg/min ×6 h then 0.5 mg/min; PO 200 mg.", notes:"Many long-term toxicities." },
    { cat:"Cardiac", generic:"Atropine", cls:"Antimuscarinic", brands:["atropine"], dose:"0.5–1 mg IV every 3–5 min (max 3 mg) for bradycardia.", notes:"" },
    { cat:"Cardiac", generic:"Adrenaline (Epinephrine)", cls:"Vasopressor / inotrope", brands:["adrenaline","epinephrine"], dose:"Arrest: 1 mg IV q3–5 min. Anaphylaxis: 0.5 mg IM.", notes:"Infusion 0.05–0.5 mcg/kg/min." },
    { cat:"Cardiac", generic:"Noradrenaline (Norepinephrine)", cls:"Vasopressor", brands:["levophed","norad","norepinephrine"], dose:"Infusion 0.05–0.5 mcg/kg/min, titrate to MAP ≥65.", notes:"First-line vasopressor in septic shock." },
    { cat:"Cardiac", generic:"Labetalol", cls:"Alpha/beta-blocker", brands:["labetalol"], dose:"10–20 mg IV bolus, repeat; infusion 1–2 mg/min.", notes:"Hypertensive emergency." },

    /* ---- Respiratory ---- */
    { cat:"Respiratory", generic:"Salbutamol", cls:"Short-acting β2-agonist (SABA)", brands:["asthalin","ventolin","saba"], dose:"2.5–5 mg nebulised every 4–6 h; MDI 100 mcg, 2 puffs.", notes:"Watch tachycardia, K+." },
    { cat:"Respiratory", generic:"Ipratropium", cls:"Inhaled anticholinergic", brands:["ipravent","atrovent"], dose:"500 mcg nebulised every 6 h.", notes:"Combine with salbutamol in exacerbations." },
    { cat:"Respiratory", generic:"Budesonide", cls:"Inhaled corticosteroid", brands:["budecort","pulmicort","ics"], dose:"0.5–1 mg nebulised twice daily.", notes:"" },
    { cat:"Respiratory", generic:"Montelukast", cls:"Leukotriene receptor antagonist", brands:["montair","singulair"], dose:"10 mg PO at night.", notes:"" },

    /* ---- Corticosteroids ---- */
    { cat:"Endocrine", generic:"Prednisolone", cls:"Corticosteroid (oral)", brands:["omnacortil","wysolone","steroid"], dose:"40 mg PO once daily (5–7 days for COPD/asthma).", notes:"" },
    { cat:"Endocrine", generic:"Hydrocortisone", cls:"Corticosteroid (IV)", brands:["efcorlin","solu-cortef","steroid"], dose:"100 mg IV every 6–8 h. Adrenal crisis: 100 mg stat.", notes:"" },
    { cat:"Endocrine", generic:"Methylprednisolone", cls:"Corticosteroid (IV)", brands:["solu-medrol","medrol","steroid"], dose:"40–125 mg IV.", notes:"" },
    { cat:"Endocrine", generic:"Dexamethasone", cls:"Corticosteroid", brands:["decadron","dexona","steroid"], dose:"4–8 mg IV/PO. COVID/ARDS: 6 mg once daily.", notes:"Also antiemetic, raised ICP." },

    /* ---- Endocrine / metabolic ---- */
    { cat:"Endocrine", generic:"Insulin (Regular)", cls:"Short-acting insulin", brands:["actrapid","huminsulin-r","insulin"], dose:"DKA: 0.1 U/kg/h IV infusion. Ward: SC per sliding scale.", notes:"Monitor glucose & K+ hourly in DKA." },
    { cat:"Endocrine", generic:"Metformin", cls:"Biguanide (antidiabetic)", brands:["glycomet","glucophage"], dose:"500 mg–1 g PO twice daily with meals.", notes:"Hold if eGFR <30, sepsis, contrast, acidosis." },
    { cat:"Endocrine", generic:"Glimepiride", cls:"Sulfonylurea", brands:["amaryl"], dose:"1–4 mg PO once daily before breakfast.", notes:"Hypoglycaemia risk." },
    { cat:"Endocrine", generic:"Levothyroxine", cls:"Thyroid hormone", brands:["thyronorm","eltroxin"], dose:"1.6 mcg/kg PO once daily, empty stomach.", notes:"Start low in elderly/cardiac." },
    { cat:"Endocrine", generic:"Tirzepatide", cls:"Dual GIP/GLP-1 receptor agonist", brands:["mounjaro","zepbound","tirzepatide","gip","glp1"], dose:"Start 2.5 mg SC once weekly x4 weeks; then 5 mg weekly. May increase by 2.5 mg every 4 weeks to 7.5 mg, 10 mg, 12.5 mg, max 15 mg weekly.", notes:"Boxed warning: Thyroid C-cell tumors / MTC. Contraindicated in MEN2 or personal/family Hx MTC. Delayed gastric emptying alters oral drug absorption (use barrier contraception during escalation)." },

    /* ---- Neuro / sedation ---- */
    { cat:"Neuro/Sedation", generic:"Phenytoin", cls:"Anticonvulsant", brands:["eptoin","dilantin"], dose:"Load 15–20 mg/kg IV (≤50 mg/min); maintenance 100 mg PO TDS.", notes:"Correct level for albumin; cardiac monitoring on IV load." },
    { cat:"Neuro/Sedation", generic:"Levetiracetam", cls:"Anticonvulsant", brands:["levipil","keppra"], dose:"500–1500 mg PO/IV twice daily (load 60 mg/kg in status).", notes:"Renal dose adjustment." },
    { cat:"Neuro/Sedation", generic:"Sodium valproate", cls:"Anticonvulsant", brands:["valparin","encorate","valproate"], dose:"Load 20–40 mg/kg IV; 500 mg BD maintenance.", notes:"Avoid in pregnancy / hepatic disease." },
    { cat:"Neuro/Sedation", generic:"Lorazepam", cls:"Benzodiazepine", brands:["ativan","lorazepam"], dose:"Status epilepticus: 4 mg IV (repeat once). Anxiety 1–2 mg.", notes:"" },
    { cat:"Neuro/Sedation", generic:"Midazolam", cls:"Benzodiazepine", brands:["midazolam","fulsed"], dose:"1–2 mg IV bolus; infusion for sedation.", notes:"Reverse with flumazenil." },
    { cat:"Neuro/Sedation", generic:"Diazepam", cls:"Benzodiazepine", brands:["valium","calmpose"], dose:"5–10 mg IV/PR for seizures.", notes:"" },
    { cat:"Neuro/Sedation", generic:"Haloperidol", cls:"Antipsychotic (typical)", brands:["haldol","serenace"], dose:"2.5–5 mg IM/IV for agitation/delirium.", notes:"QT, EPS; avoid in Parkinson's." },
    { cat:"Neuro/Sedation", generic:"Naloxone", cls:"Opioid antagonist", brands:["narcan","naloxone"], dose:"0.4–2 mg IV/IM, repeat every 2–3 min.", notes:"Opioid overdose reversal; short half-life." },

    /* ---- Antihistamines ---- */
    { cat:"Other", generic:"Pheniramine", cls:"Antihistamine (sedating)", brands:["avil"], dose:"22.75–45.5 mg IV/IM (allergic reactions).", notes:"" },
    { cat:"Other", generic:"Cetirizine", cls:"Antihistamine (non-sedating)", brands:["cetzine","zyrtec","alerid"], dose:"10 mg PO once daily.", notes:"" },
    { cat:"Other", generic:"Chlorpheniramine", cls:"Antihistamine (sedating)", brands:["cpm","piriton"], dose:"4 mg PO every 6 h.", notes:"" },

    /* ---- Electrolytes / emergency ---- */
    { cat:"Electrolytes", generic:"Calcium gluconate", cls:"Electrolyte", brands:["calcium gluconate"], dose:"10 mL of 10% IV slow — hyperkalaemia (cardioprotection), hypocalcaemia.", notes:"Cardiac monitoring." },
    { cat:"Electrolytes", generic:"Magnesium sulfate", cls:"Electrolyte", brands:["magsulf","mgso4"], dose:"1–2 g IV (arrhythmia). Eclampsia: 4 g load then 1 g/h.", notes:"Monitor reflexes/RR." },
    { cat:"Electrolytes", generic:"Potassium chloride", cls:"Electrolyte", brands:["kcl","potklor"], dose:"20–40 mmol IV in fluids. Peripheral max 10 mmol/h.", notes:"Never IV push. Central line for high rates." },
    { cat:"Electrolytes", generic:"Sodium bicarbonate", cls:"Alkalinising agent", brands:["nahco3","sodabicarb"], dose:"50–100 mEq IV for severe metabolic acidosis / hyperkalaemia.", notes:"" },
    { cat:"Electrolytes", generic:"Mannitol", cls:"Osmotic diuretic", brands:["mannitol"], dose:"0.25–1 g/kg IV over 20 min for raised ICP.", notes:"Monitor osmolar gap, volume." },

    /* ---- Antimicrobial (reserve agents also in the gold monograph library) ---- */
    { cat:"Antimicrobial", generic:"Cefiderocol", cls:"Siderophore cephalosporin", brands:["fetroja","cefiderocol"], dose:"2 g IV every 8 h infused over 3 h.", notes:"Reserve siderophore cephalosporin for carbapenem-resistant Gram-negatives (CRE, CRAB, DTR-P. aeruginosa). Dose adjust in renal impairment." },

    /* ---- Vaccines & Immunobiologicals ---- */
    { cat:"Vaccine", generic:"Rabies Vaccine", cls:"Inactivated cell-culture viral vaccine", brands:["rabipur","verorab","abhayrab","indirab","rabivax","berab","human rabies vaccine","human + rabies vaccine"], dose:"PEP (Essen): 1 vial IM on Days 0, 3, 7, 14, 28 (deltoid; never gluteal). Updated Thai Red Cross: 2-site ID (0.1 mL left & right deltoid) on Days 0, 3, 7. PrEP: Days 0, 7, 21/28.", notes:"Wound wash >=15 min with soap & water. Category III bites require RIG (HRIG 20 IU/kg or ERIG 40 IU/kg) infiltrated into wound on Day 0. Rabies is 100% fatal: NO contraindications to PEP, pregnancy included." },
    { cat:"Vaccine", generic:"Tetanus Toxoid", cls:"Inactivated bacterial toxoid (TT / Td / Tdap)", brands:["tetvac","bett","boostrix","adacel","dual antigen","tt","td","tdap"], dose:"0.5 mL IM (deltoid). Primary: 3 doses (0, 1-2, 6-12 mo). Routine adult booster every 10 yr. Clean minor wound: booster if >=10 yr. Dirty/tetanus-prone: booster if >=5 yr + TIG 250-500 IU if unimmunized.", notes:"Maternal immunization in pregnancy (2 doses Td/TT or 1 dose Tdap at 27-36 weeks) prevents neonatal tetanus." },
    { cat:"Vaccine", generic:"Hepatitis B Vaccine", cls:"Recombinant viral surface antigen (HBsAg)", brands:["engerix-b","genevac-b","shanvac-b","elovac-b","hep b"], dose:"Adults (>=20 yr): 1 mL (20 mcg) IM at 0, 1, 6 months (deltoid). Infants/children: 0.5 mL (10 mcg) IM at birth, 6, 10, 14 weeks. Dialysis/immunocompromised: 40 mcg at 0, 1, 2, 6 months.", notes:"Universal infant birth dose within 24 hours. Anti-HBs titer >=10 mIU/mL indicates seroprotection." },
    { cat:"Vaccine", generic:"Hepatitis A Vaccine", cls:"Inactivated viral vaccine", brands:["havrix","avaxim","biovac-a","hep a"], dose:"Adults (>=19 yr): 1.0 mL (1440 EL.U) IM at 0 and 6–12 months. Children (1-18 yr): 0.5 mL (720 EL.U) IM at 0 and 6–12 months.", notes:"Pre-exposure prophylaxis for travel, chronic liver disease, MSM, clotting factor disorders. Post-exposure within 14 days of contact." },
    { cat:"Vaccine", generic:"Influenza Vaccine", cls:"Inactivated quadrivalent influenza vaccine", brands:["vaxigrip","fluarix","influvac","fluquadri","flu"], dose:"0.5 mL IM once annually (deltoid). Children 6 mo–8 yr receiving first-ever flu vaccine require 2 doses >=4 weeks apart.", notes:"Annual vaccination recommended for pregnant women, elderly >=65 yr, chronic pulmonary/cardiac disease, healthcare workers. Safe in pregnancy." },
    { cat:"Vaccine", generic:"Pneumococcal Conjugate Vaccine", cls:"Bacterial capsular polysaccharide conjugate (PCV13 / PCV15 / PCV20)", brands:["prevenar","prevenar-13","vaxneuvance","synflorix","pcv"], dose:"Infants: 0.5 mL IM at 6, 10, 14 weeks + booster at 9-12 months. Adults >=65 yr or high-risk (asplenia, CKD, CSF leak, immunocompromise): single dose PCV20 IM (or PCV15 followed by PPSV23 >=1 yr later).", notes:"Prevents invasive pneumococcal disease (meningitis, bacteremia, bacteremic pneumonia). Deltoid injection." },
    { cat:"Vaccine", generic:"Pneumococcal Polysaccharide Vaccine", cls:"Bacterial capsular polysaccharide vaccine (PPSV23)", brands:["pneumovax","pneumovax-23","ppsv23"], dose:"0.5 mL IM or SC single dose in adults >=65 yr, or adults 19-64 with chronic medical conditions (DM, COPD, cirrhosis, heart failure).", notes:"If PCV was given first, give PPSV23 >=1 year later (>=8 weeks in immunocompromised/asplenia). Revaccination after 5 years for asplenia/immunocompromise." },
    { cat:"Vaccine", generic:"Typhoid Vaccine", cls:"Conjugate / Vi polysaccharide vaccine (TCV / Vi-PS)", brands:["typbar","typbar-tcv","typhivax","typhoid"], dose:"Typhoid Conjugate (TCV): single 0.5 mL IM dose from 6 months of age. Vi Polysaccharide: single 0.5 mL IM/SC dose (>=2 yr), booster every 2-3 years.", notes:"TCV provides superior immunogenicity and long-lasting T-cell dependent memory in young infants and adults." },
    { cat:"Vaccine", generic:"MMR Vaccine", cls:"Live attenuated viral vaccine (Measles, Mumps, Rubella)", brands:["tresivac","priorix","m-vac","mmr"], dose:"0.5 mL SC. Children: 2 doses (first at 9-12 months, second at 15-18 months). Non-immune adults: 1 or 2 doses SC >=4 weeks apart.", notes:"Live vaccine: CONTRAINDICATED in pregnancy and severe immunocompromise. Avoid pregnancy for 1 month after vaccination." },
    { cat:"Vaccine", generic:"Varicella Vaccine", cls:"Live attenuated viral vaccine", brands:["varilrix","variped","varicella"], dose:"0.5 mL SC as a 2-dose series separated by 4-8 weeks (first dose at 12-15 months, second at 4-6 years; or unimmunized adolescents/adults).", notes:"Live vaccine: CONTRAINDICATED in pregnancy and severe cell-mediated immunocompromise. Avoid salicylates for 6 weeks (Reye syndrome risk)." },
    { cat:"Vaccine", generic:"Human Papillomavirus Vaccine", cls:"Recombinant viral capsid L1 VLP vaccine (Gardasil / Cervavac)", brands:["gardasil","gardasil-9","cervavac","hpv"], dose:"Age 9-14 yr: 2 doses (0, 6 months) 0.5 mL IM. Age >=15 yr or immunocompromised: 3 doses (0, 1-2, 6 months) 0.5 mL IM.", notes:"Prevents cervical, anogenital, and oropharyngeal cancers. Observe seated for 15 min post-injection (syncope precaution). Defer in pregnancy." },
    { cat:"Vaccine", generic:"Herpes Zoster Vaccine", cls:"Recombinant adjuvanted subunit vaccine (Shingrix)", brands:["shingrix","zoster"], dose:"0.5 mL IM as a 2-dose series (Month 0 and Month 2 to 6). Reconstitute antigen with AS01B adjuvant liquid.", notes:"Indicated for adults >=50 yr and immunocompromised >=19 yr to prevent shingles and postherpetic neuralgia. Non-live; safe in immunocompromised." },
    { cat:"Vaccine", generic:"Rotavirus Vaccine", cls:"Live attenuated oral viral vaccine", brands:["rotavac","rotasiil","rotateq","rotarix"], dose:"STRICTLY ORAL: 3 doses at 6, 10, 14 weeks (Rotavac/Rotasiil/Rotateq) or 2 doses at 6, 10 weeks (Rotarix). Finish series by 8 months (32 weeks).", notes:"NEVER INJECT. Contraindicated in history of intussusception, uncorrected GI malformation, or SCID. Warn parents of intussusception signs." },
    { cat:"Vaccine", generic:"BCG Vaccine", cls:"Live attenuated bacterial vaccine (Mycobacterium bovis)", brands:["bcg","tubervac"], dose:"STRICTLY INTRADERMAL into left deltoid: neonates <1 mo: 0.05 mL; infants >=1 mo: 0.1 mL as single dose at birth or first contact.", notes:"Prevents TB meningitis and miliary TB. Pale wheal must appear. Never give SC (causes cold abscesses/lymphadenitis). Normal scar evolves by 8-12 weeks." },

    /* ---- Oncology (targeted / immunotherapy reference) ---- */
    { cat:"Oncology", generic:"Trastuzumab deruxtecan", cls:"HER2-directed antibody-drug conjugate", brands:["enhertu","her2 adc"], dose:"5.4 mg/kg IV q3w (breast/NSCLC); 6.4 mg/kg IV q3w (gastric).", notes:"Boxed: ILD/pneumonitis (fatal risk, hold early), LVEF decline, embryo-fetal toxicity. Not interchangeable with trastuzumab." },
    { cat:"Oncology", generic:"Zanubrutinib", cls:"BTK inhibitor (2nd generation, covalent)", brands:["brukinsa","btk"], dose:"160 mg PO BD or 320 mg PO once daily.", notes:"B-cell malignancies (MCL, CLL, Waldenstrom, MZL). Bleeding, AF, cytopenias; hold peri-operatively." },
    { cat:"Oncology", generic:"Cemiplimab", cls:"Anti-PD-1 monoclonal antibody", brands:["libtayo","pd1"], dose:"350 mg IV every 3 weeks.", notes:"Cutaneous SCC, basal cell, NSCLC. Immune-mediated toxicities (colitis, pneumonitis, hepatitis, endocrinopathies)." },
    { cat:"Oncology", generic:"Daraxonrasib", cls:"Pan-RAS inhibitor (KRAS G12 / multi-RAS)", brands:["rasonque","daraxonrasib","ras","kras","pancreatic"], dose:"Oral tablet once daily as monotherapy in metastatic pancreatic adenocarcinoma.", notes:"Targeted pan-RAS(ON) inhibitor for KRAS-mutated pancreatic adenocarcinoma (RASolute 302). Rash, GI, LFT monitoring." },
    { cat:"Oncology", generic:"Cisplatin", cls:"Platinum alkylating-like (DNA cross-linker)", brands:["cismap","platinex","cisplatin"], dose:"50–100 mg/m² IV q3–4w; radiosensitising 40 mg/m² weekly.", notes:"Hydration protocol mandatory. High emetogenic risk (NK1+5-HT3+dex); nephrotoxicity and ototoxicity." },
    { cat:"Oncology", generic:"Carboplatin", cls:"Platinum alkylating-like (DNA cross-linker)", brands:["carboplatin","paraplatin"], dose:"Dosed by Calvert formula: Target AUC 4–6 × (GFR + 25) mg IV q3–4w.", notes:"Dose based on GFR (CrCl). Myelosuppression (nadir day 21)." },
    { cat:"Oncology", generic:"Oxaliplatin", cls:"Platinum alkylating-like (DNA cross-linker)", brands:["eloxatin","oxaltor"], dose:"85 mg/m² IV q2w (FOLFOX) or 130 mg/m² IV q3w (CAPOX).", notes:"Acute cold-induced dysesthesia/pharyngolaryngeal dysesthesia; avoid cold drinks/exposure." },
    { cat:"Oncology", generic:"Paclitaxel", cls:"Taxane microtubule inhibitor", brands:["taxol","paclitaxel"], dose:"175 mg/m² IV q3w or 80 mg/m² IV weekly.", notes:"Mandatory premedication (dexamethasone, H1, H2 blockers) for hypersensitivity. Peripheral neuropathy." },
    { cat:"Oncology", generic:"Docetaxel", cls:"Taxane microtubule inhibitor", brands:["taxotere","docetaxel"], dose:"60–75–100 mg/m² IV q3w.", notes:"Mandatory oral dexamethasone premedication for fluid retention and hypersensitivity." },
    { cat:"Oncology", generic:"Doxorubicin", cls:"Anthracycline topoisomerase II inhibitor", brands:["adriamycin","doxorubicin"], dose:"60 mg/m² IV q3w (max lifetime cumulative dose 450–550 mg/m²).", notes:"Cardiotoxicity: baseline LVEF required; vesicant (dexrazoxane for extravasation); red urine discoloration." },
    { cat:"Oncology", generic:"Fluorouracil (5-FU)", cls:"Antimetabolite (pyrimidine analogue)", brands:["5-fu","fluorouracil","flurox"], dose:"400 mg/m² IV bolus then 2400–3000 mg/m² 46-hour IV infusion.", notes:"DPD deficiency risk. Stomatitis, diarrhea, hand-foot syndrome, coronary vasospasm." },
    { cat:"Oncology", generic:"Capecitabine", cls:"Antimetabolite (oral 5-FU prodrug)", brands:["xeloda","capnat","capecitabine"], dose:"1000–1250 mg/m² PO twice daily on days 1–14 of 21-day cycle.", notes:"Oral 5-FU prodrug. Take with water within 30 min after meals. Hand-foot syndrome, diarrhea." },
    { cat:"Oncology", generic:"Gemcitabine", cls:"Antimetabolite (nucleoside analogue)", brands:["gemzar","gemtaz"], dose:"1000 mg/m² IV over 30 min on days 1, 8, 15 of 28-day cycle.", notes:"Infusion rate control (fixed dose rate 10 mg/m²/min optimizes intracellular activation). Flu-like symptoms." },
    { cat:"Oncology", generic:"Irinotecan", cls:"Topoisomerase I inhibitor (camptothecin)", brands:["camptosar","irinotecan"], dose:"180 mg/m² IV q2w (FOLFIRI) or 350 mg/m² IV q3w.", notes:"Early acute cholinergic syndrome: treat with Atropine 0.25-1 mg IV/SC. Late delayed diarrhea: high-dose Loperamide." },
    { cat:"Oncology", generic:"Methotrexate", cls:"Antimetabolite (antifolate)", brands:["folitrax","methotrexate"], dose:"Rheumatoid: 7.5–25 mg PO weekly. High-dose chemo: 1–12 g/m² IV with mandatory Leucovorin rescue.", notes:"Never daily for RA/psoriasis (fatal toxicity). High-dose chemo requires urine alkalinization (pH >=7) and hydration." },
    { cat:"Oncology", generic:"Pembrolizumab", cls:"Anti-PD-1 checkpoint inhibitor", brands:["keytruda","pembrolizumab"], dose:"200 mg IV q3w or 400 mg IV q6w.", notes:"Immune checkpoint inhibitor (anti-PD-1). Monitor for immune-related adverse events (irAEs: pneumonitis, colitis, hepatitis, endocrinopathies)." },
    { cat:"Oncology", generic:"Nivolumab", cls:"Anti-PD-1 checkpoint inhibitor", brands:["opdivo","nivolumab"], dose:"240 mg IV q2w or 480 mg IV q4w.", notes:"Anti-PD-1 checkpoint inhibitor. Immune-related adverse events; manage with corticosteroids." },
    { cat:"Oncology", generic:"Osimertinib", cls:"EGFR tyrosine kinase inhibitor (3rd generation)", brands:["tagrisso","osimertinib"], dose:"80 mg PO once daily.", notes:"3rd-gen EGFR TKI (Exon 19 del, L858R, T790M). QTc prolongation, cardiomyopathy, ILD/pneumonitis." },
    { cat:"Oncology", generic:"Tarlatamab", cls:"DLL3 x CD3 bispecific T-cell engager", brands:["imdelltra","tarlatamab"], dose:"Step-up day 1 (1 mg), day 8 (10 mg), then 10 mg IV q2w.", notes:"DLL3-targeted bispecific for ES-SCLC. Hospitalization and monitoring for cytokine release syndrome (CRS) and ICANS." },
    { cat:"Oncology", generic:"Vorasidenib", cls:"Dual IDH1/IDH2 inhibitor", brands:["voranigo","vorasidenib"], dose:"40 mg PO once daily on empty stomach.", notes:"Dual IDH1/IDH2 inhibitor for IDH-mutant grade 2 diffuse glioma. LFT elevation monitoring." },
    { cat:"Oncology", generic:"Zolbetuximab", cls:"Claudin-18.2-directed cytolytic antibody", brands:["vyloy","zolbetuximab"], dose:"800 mg/m² loading, then 600 mg/m² IV q3w or 600 mg/m² q2w.", notes:"CLDN18.2-targeted antibody for gastric/GEJ adenocarcinoma with chemotherapy. Nausea/vomiting premedication." }
  ];

  /* ---- search helpers (self-contained fuzzy) ---- */
  function lev(a,b){if(a===b)return 0;var m=a.length,n=b.length;if(!m)return n;if(!n)return m;var d=[];for(var i=0;i<=n;i++)d[i]=i;for(var i2=1;i2<=m;i2++){var prev=d[0];d[0]=i2;for(var j=1;j<=n;j++){var t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a.charAt(i2-1)===b.charAt(j-1)?0:1));prev=t;}}return d[n];}
  function fuzzy(q,gen){if(gen.indexOf(q)>=0)return true;var toks=gen.split(/[^a-z0-9]+/);for(var i=0;i<toks.length;i++){var w=toks[i];if(w.length<3)continue;var max=q.length<=5?1:2;if(Math.abs(w.length-q.length)<=max&&lev(q,w)<=max)return true;}return false;}

  function toResult(d){ return { drug:d.generic, dose:d.dose, route:"", frequency:"", duration:"", why:d.cls, syndromes:[d.cls], _med:true }; }

  // returns search-result-shaped entries for the global search
  function match(q){
    q=(q||"").toLowerCase().trim(); if(q.length<2) return [];
    var out=[];
    DRUGS.forEach(function(d){
      var hay=(d.generic+" "+d.cls+" "+d.brands.join(" ")).toLowerCase();
      var hit=hay.indexOf(q)>=0;
      if(!hit) hit=d.brands.some(function(b){b=b.toLowerCase();return b===q||(q.length>=3&&(b.indexOf(q)===0||q.indexOf(b)===0));});
      if(!hit&&q.length>=4) hit=fuzzy(q,d.generic.toLowerCase());
      if(hit) out.push(toResult(d));
    });
    return out;
  }
  function findByName(name){
    if(!name) return null;
    var n=String(name).toLowerCase().trim();
    if (/rabies\s*vaccine|human\s*\+\s*rabies|rabies.*human/i.test(n)) n = "rabies vaccine";
    else if (/tetanus\s*toxoid|tdap|\btt\b|adsorbed\s*tetanus/i.test(n)) n = "tetanus toxoid";
    else if (/rotavirus\s*vaccine/i.test(n)) n = "rotavirus vaccine";
    else if (/typhoid\s*vaccine|salmonella\s*typhi|purified\s*vi.*typhoid/i.test(n)) n = "typhoid vaccine";
    else if (/hepatitis\s*b\s*vaccine|aluminium.*hepatitis\s*b/i.test(n)) n = "hepatitis b vaccine";
    else if (/hepatitis\s*a\s*vaccine/i.test(n)) n = "hepatitis a vaccine";
    else if (/influenza\s*vaccine/i.test(n)) n = "influenza vaccine";
    else if (/pneumococc\w*\s*(?:polysaccharide\s*)?conjugate\s*vaccine/i.test(n)) n = "pneumococcal conjugate vaccine";
    else if (/pneumococc\w*\s*polysaccharide\s*vaccine/i.test(n)) n = "pneumococcal polysaccharide vaccine";
    else if (/measles.*mumps.*rubella|mmr/i.test(n)) n = "mmr vaccine";
    else if (/varicella\s*vaccine/i.test(n)) n = "varicella vaccine";
    else if (/human\s*papilloma\w*|hpv/i.test(n)) n = "human papillomavirus vaccine";
    else if (/herpes\s*zoster|shingles/i.test(n)) n = "herpes zoster vaccine";
    else if (/\bbcg\b/i.test(n)) n = "bcg vaccine";
    for(var i=0;i<DRUGS.length;i++) if(DRUGS[i].generic.toLowerCase()===n) return DRUGS[i];
    var baseName=n.replace(/\s*\([^)]*\)/g," ").replace(/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|l|%|iu|units?|meq|mmol)\b/gi," ").trim();
    if(baseName&&baseName!==n){
      for(var j=0;j<DRUGS.length;j++) if(DRUGS[j].generic.toLowerCase()===baseName) return DRUGS[j];
    }
    return null;
  }

  /* ---- structured on-device index search (powers the Drug Index sheet) ----
     Returns ranked rows shaped for the medication-list UI:
       { generic, cls, brands:[realBrandsOnly], form, dose }
     Pure, synchronous, offline. Real curated data — never fabricated. */
  var CLASS_ABBR = { ppi:1,h2:1,"h2 blocker":1,nsaid:1,doac:1,lmwh:1,ufh:1,statin:1,ccb:1,acei:1,
    arb:1,bb:1,"beta blocker":1,saba:1,ics:1,steroid:1,antiemetic:1,laxative:1,insulin:1,asa:1,
    ntg:1,gtn:1,txa:1,mgso4:1,kcl:1,nahco3:1,pcm:1,cpm:1 };
  function realBrands(d){ return (d.brands||[]).filter(function(b){ return !CLASS_ABBR[String(b).toLowerCase()]; }); }
  // Coarse formulation hint parsed from the adult-dose string (display only).
  function formHint(dose){
    var s=(dose||"").toLowerCase(), f=[];
    if(/\biv\b|infusion|bolus|\bim\b/.test(s)) f.push("Injection");
    if(/\bpo\b|oral|tablet|before food|before breakfast|once daily|twice daily|\bod\b|\bbd\b|\btds\b/.test(s)) f.push("Tablet");
    if(/neb/.test(s)) f.push("Nebule");
    if(/\bsc\b/.test(s)) f.push("SC");
    if(/\bsl\b|sublingual/.test(s)) f.push("SL");
    if(!f.length) f.push("—");
    return f.slice(0,2).join(" / ");
  }
  // q==="" returns the whole formulary (caller shows it as "common medicines").
  function searchIndex(q){
    q=(q||"").toLowerCase().trim();
    var out=[];
    DRUGS.forEach(function(d){
      var gen=d.generic.toLowerCase(), cls=(d.cls||"").toLowerCase();
      var brs=realBrands(d), brsL=brs.map(function(b){return b.toLowerCase();});
      var rank=-1;
      if(!q) rank=5;
      else if(gen===q||brsL.indexOf(q)>=0) rank=0;
      else if(gen.indexOf(q)===0||brsL.some(function(b){return b.indexOf(q)===0;})) rank=1;
      else if(gen.indexOf(q)>=0||cls.indexOf(q)>=0||brsL.some(function(b){return b.indexOf(q)>=0;})) rank=2;
      else if(q.length>=4&&fuzzy(q,gen)) rank=3;
      if(rank>=0) out.push({ rank:rank, generic:d.generic, cls:d.cls, brands:brs, form:formHint(d.dose), dose:d.dose });
    });
    out.sort(function(a,b){ return a.rank-b.rank || a.generic.localeCompare(b.generic); });
    return out;
  }

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function detailHTML(d){
    // Legacy formulary card retired — all drugs display the Gold-Standard clinical monograph
    return "";
  }

  /* The Drugs Database is the single browse/dosing surface. Keep the old API
     as a redirect for callers such as Oncology; shared formulary data stays local. */
  function dIco(n,c){ return (window.ICONS&&ICONS.get)?ICONS.get(n,c||"mc-ico"):""; }
  function openList(){
    if(window.MEDDB && window.MEDDB.openList) return window.MEDDB.openList();
    if(window.toast) window.toast("Drugs Database loading…");
  }
  function close(){ if(window.MEDDB && window.MEDDB.close) window.MEDDB.close(); }

  /* ---- Drug Interactions entry point (mounts window.MEDLIST's med-list builder) ----
     Uses the shared mc-overlay chrome; the body is fully
     owned/rendered by MEDLIST.mount (medlist.js), not by this file. */
  var interactionsRoot = null;
  function ensureInteractionsRoot(){
    if(interactionsRoot) return interactionsRoot;
    injectFallbackCSS();
    interactionsRoot=document.createElement("div");
    interactionsRoot.id="miOverlay"; interactionsRoot.className="mc-overlay ddi-overlay";
    // One clean sticky header (no duplicated title): back · title/subtitle · patient pill,
    // then a thin advisory line, then the workspace body owned by MEDLIST.mount.
    interactionsRoot.innerHTML=
      '<header class="ddi-head">'+
        '<button class="ddi-back" id="miClose" aria-label="Back" title="Back">‹</button>'+
        '<div class="ddi-head-titles"><div class="ddi-head-title">Drug Interactions</div>'+
        '<div class="ddi-head-sub">Medication safety check</div></div>'+
        '<div class="ddi-patient" id="ddiPatientPill">No patient selected</div>'+
      '</header>'+
      '<div class="ddi-advisory">Clinical decision support — verify important decisions with local protocol.</div>'+
      '<div class="ddi-body" id="miBody"></div>';
    document.body.appendChild(interactionsRoot);
    interactionsRoot.querySelector("#miClose").addEventListener("click", closeInteractions);
    return interactionsRoot;
  }
  function ptInitials(name){
    name=String(name||"").trim(); if(!name) return "PT";
    return name.split(/\s+/).map(function(p){return p.charAt(0).toUpperCase();}).join("").slice(0,3) || "PT";
  }
  // Patient pill = initials only (never full identifiers), reflecting Ward-Sync selection.
  function updatePatientPill(){
    var pill=interactionsRoot&&interactionsRoot.querySelector("#ddiPatientPill"); if(!pill) return;
    var pt=null; try{ pt=window.GHISMEDS&&window.GHISMEDS.getSelectedPatient&&window.GHISMEDS.getSelectedPatient(); }catch(e){}
    if(pt&&pt.patientId){ pill.textContent="● "+ptInitials(pt.name); pill.className="ddi-patient ddi-patient-on"; pill.title="Ward Sync patient selected"; }
    else { pill.textContent="No patient selected"; pill.className="ddi-patient"; pill.title=""; }
  }
  function openInteractions(){
    ensureInteractionsRoot();
    interactionsRoot.classList.add("on");
    document.body.classList.add("mc-lock","smd-ddi-open");   // smd-ddi-open hides the floating Home/ICU FABs
    updatePatientPill();
    if(window.MEDLIST && window.MEDLIST.mount) window.MEDLIST.mount(interactionsRoot.querySelector("#miBody"));
  }
  function closeInteractions(){ if(interactionsRoot){ interactionsRoot.classList.remove("on"); document.body.classList.remove("mc-lock","smd-ddi-open"); } }
  document.addEventListener("keydown", function(e){ if(e.key==="Escape"&&interactionsRoot&&interactionsRoot.classList.contains("on")) closeInteractions(); });

  function injectFallbackCSS(){
    if(document.getElementById("mc-styles")||document.getElementById("md-fallback-styles")) return;
    var css=".mc-overlay{position:fixed;inset:0;z-index:872;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}.mc-overlay.on{display:flex}.mc-top{display:flex;align-items:center;gap:10px;padding:14px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0)}.mc-back{background:transparent;border:1px solid var(--teal,#0a9396);color:var(--teal,#0a9396);border-radius:9px;height:34px;padding:0 12px;font:600 13px system-ui;cursor:pointer}.mc-title{flex:1;text-align:center;font:800 16px system-ui}.mc-count{font-size:11px;background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:8px;padding:1px 7px}.mc-body{flex:1;overflow-y:auto;padding:14px;max-width:1100px;margin:0 auto;width:100%;box-sizing:border-box}.mc-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 14px;font:500 14px system-ui;margin-bottom:11px}.mc-cats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}.mc-cat{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:16px;padding:6px 12px;font:600 12px system-ui;cursor:pointer}.mc-cat.on{background:var(--teal,#0a9396);color:#fff}.mc-grp-h{font:800 12px system-ui;text-transform:uppercase;color:var(--slate-soft,#888);margin:14px 0 8px}.mc-grid{display:grid;grid-template-columns:1fr;gap:9px}@media(min-width:720px){.mc-grid{grid-template-columns:1fr 1fr}}.mc-card{border:1px solid var(--line,#e5e5e0);border-radius:12px;background:var(--panel,#fff)}.mc-card.open{grid-column:1/-1}.mc-card-head{display:flex;align-items:center;gap:11px;padding:12px 13px;cursor:pointer;width:100%;background:transparent;border:none;text-align:left}.mc-ic{font-size:20px}.mc-card-main{flex:1}.mc-card-t{display:block;font:700 13.5px system-ui}.mc-card-d{display:block;font:500 11.5px system-ui;color:var(--slate-soft,#888)}.mc-chev{color:#888}.mc-panel{padding:4px 13px 14px;border-top:1px solid var(--line,#e5e5e0)}.mc-empty{padding:30px;text-align:center;color:#888}.mc-disc{font:500 11px system-ui;color:#888;border:1px dashed var(--line,#e5e5e0);border-radius:10px;padding:10px 12px;margin-top:18px}.mc-ico{width:14px;height:14px;vertical-align:-2px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.mc-ic svg{width:20px;height:20px;color:var(--teal,#0a9396)}.mc-cat svg,.mc-grp-h svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px}.mc-grp-h svg{color:var(--teal,#0a9396)}.mc-disc svg,#mdInteractionsBtn svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px}body.mc-lock{overflow:hidden}";
    var st=document.createElement("style"); st.id="md-fallback-styles"; st.textContent=css; document.head.appendChild(st);
  }

  window.MEDDRUGS = { match: match, findByName: findByName, searchIndex: searchIndex, detailHTML: detailHTML, openList: openList, close: close, _list: DRUGS,
    openInteractions: openInteractions, closeInteractions: closeInteractions, updatePatientPill: updatePatientPill };
})();
