/* ============================================================================
   StewardMD — Non-antibiotic Drug Doses (ward formulary)
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
    { cat:"Electrolytes", generic:"Mannitol", cls:"Osmotic diuretic", brands:["mannitol"], dose:"0.25–1 g/kg IV over 20 min for raised ICP.", notes:"Monitor osmolar gap, volume." }
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
  function findByName(name){ name=(name||"").toLowerCase(); for(var i=0;i<DRUGS.length;i++) if(DRUGS[i].generic.toLowerCase()===name) return DRUGS[i]; return null; }

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
    var realBrands=(d.brands||[]).filter(function(b){return ["ppi","h2","h2 blocker","nsaid","doac","lmwh","ufh","statin","ccb","acei","arb","bb","beta blocker","saba","ics","steroid","antiemetic","laxative","insulin","asa","ntg","gtn","txa","mgso4","kcl","nahco3","pcm","cpm"].indexOf(b.toLowerCase())<0;});
    return '<div style="font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.05em;color:var(--teal);margin-bottom:8px">'+esc(d.cls)+'</div>'+
      '<div style="background:var(--teal-soft);border:1px solid var(--teal);border-radius:10px;padding:12px 14px;margin-bottom:10px"><div style="font:700 11px var(--sans);color:var(--slate-soft);text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px">Adult dose</div><div style="font:600 14px var(--sans);color:var(--ink);line-height:1.5">'+esc(d.dose)+'</div></div>'+
      (realBrands.length?'<div style="font:500 12.5px var(--sans);color:var(--slate);margin-bottom:8px"><b style="color:var(--ink)">Common brands:</b> '+esc(realBrands.join(", "))+'</div>':"")+
      (d.notes?'<div style="font:500 12.5px var(--sans);color:var(--slate);line-height:1.55;background:var(--paper);border:1px dashed var(--line);border-radius:9px;padding:10px 12px">⚠️ '+esc(d.notes)+'</div>':"")+
      '<div style="font:500 11px var(--sans);color:var(--slate-soft);margin-top:12px;line-height:1.5">Adult dosing only — verify against the individual patient, renal/hepatic function and local protocol.</div>';
  }

  /* ---- browse overlay (reuses .mc-* styles injected by calculators.js) ---- */
  var CATS=["Gastrointestinal","Analgesia","Anticoagulation","Cardiac","Respiratory","Endocrine","Neuro/Sedation","Electrolytes","Other"];
  var CAT_ICON={"Gastrointestinal":"🩺","Analgesia":"💉","Anticoagulation":"🩸","Cardiac":"🫀","Respiratory":"🫁","Endocrine":"⚗️","Neuro/Sedation":"🧠","Electrolytes":"🧂","Other":"💊"};
  var root=null, q="", activeCat="", openName=null;

  function ensureRoot(){
    if(root) return root;
    if(!document.getElementById("mc-styles") && window.MEDCALC){ try{ window.MEDCALC.openList(); window.MEDCALC.close(); }catch(e){} }
    injectFallbackCSS();
    root=document.createElement("div");
    root.id="mdOverlay"; root.className="mc-overlay";
    root.innerHTML=
      '<div class="mc-top"><button class="mc-back" id="mdClose">‹ Close</button><div class="mc-title">Drug Doses <span class="mc-count">'+DRUGS.length+'</span></div><span style="width:64px"></span></div>'+
      '<div class="mc-body">'+
        '<input id="mdSearch" class="mc-search" type="text" placeholder="🔍 Search drug or brand (e.g. pantop, lasix, statin, ppi)…" autocomplete="off">'+
        '<div id="mdCats" class="mc-cats"></div>'+
        '<div id="mdList" class="mc-list"></div>'+
        '<button id="mdInteractionsBtn" class="mc-cat" style="margin-top:14px;width:100%;box-sizing:border-box;text-align:center">💊⚠️ Check Drug Interactions</button>'+
        '<div class="mc-disc">⚠️ Adult dosing only — verify against the patient, renal/hepatic function and local protocol. Antibiotics are in the syndrome pages / global search.</div>'+
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#mdClose").addEventListener("click", close);
    root.querySelector("#mdInteractionsBtn").addEventListener("click", openInteractions);
    var si=root.querySelector("#mdSearch");
    si.addEventListener("input", function(){ q=si.value.trim().toLowerCase(); render(); });
    si.addEventListener("keydown", function(e){ e.stopPropagation(); });
    return root;
  }
  function renderCats(){
    var el=root.querySelector("#mdCats");
    var chips=['<button class="mc-cat'+(activeCat===""?" on":"")+'" data-c="">All</button>'];
    CATS.forEach(function(c){ var n=DRUGS.filter(function(d){return d.cat===c;}).length; chips.push('<button class="mc-cat'+(activeCat===c?" on":"")+'" data-c="'+esc(c)+'">'+(CAT_ICON[c]||"")+" "+esc(c)+' <span>'+n+'</span></button>'); });
    el.innerHTML=chips.join("");
    el.querySelectorAll(".mc-cat").forEach(function(b){ b.addEventListener("click", function(){ activeCat=b.getAttribute("data-c"); openName=null; renderCats(); render(); }); });
  }
  function visible(d){ if(activeCat&&d.cat!==activeCat) return false; if(!q) return true; return (d.generic+" "+d.cls+" "+d.brands.join(" ")).toLowerCase().indexOf(q)>=0 || match(q).some(function(m){return m.drug===d.generic;}); }
  function render(){
    var el=root.querySelector("#mdList"); var list=DRUGS.filter(visible);
    if(!list.length){ el.innerHTML='<div class="mc-empty">No drugs match “'+esc(q)+'”.</div>'; return; }
    var html="";
    CATS.forEach(function(cat){
      var inc=list.filter(function(d){return d.cat===cat;}); if(!inc.length) return;
      html+='<div class="mc-grp-h">'+(CAT_ICON[cat]||"")+" "+esc(cat)+'</div><div class="mc-grid">';
      inc.forEach(function(d){
        var op=openName===d.generic;
        html+='<div class="mc-card'+(op?" open":"")+'"><button class="mc-card-head" data-n="'+esc(d.generic)+'"><span class="mc-ic">💊</span><span class="mc-card-main"><span class="mc-card-t">'+esc(d.generic)+'</span><span class="mc-card-d">'+esc(d.cls)+'</span></span><span class="mc-chev">'+(op?"▾":"▸")+'</span></button>'+(op?'<div class="mc-panel">'+detailHTML(d)+'</div>':"")+'</div>';
      });
      html+='</div>';
    });
    el.innerHTML=html;
    el.querySelectorAll("[data-n]").forEach(function(b){ b.addEventListener("click", function(){ var n=b.getAttribute("data-n"); openName=(openName===n?null:n); render(); }); });
  }
  function openList(cat){
    ensureRoot(); activeCat=(cat&&CATS.indexOf(cat)>=0)?cat:""; q=""; openName=null;
    var si=root.querySelector("#mdSearch"); if(si) si.value="";
    renderCats(); render();
    root.classList.add("on"); document.body.classList.add("mc-lock");
    setTimeout(function(){ try{ root.querySelector("#mdSearch").focus(); }catch(e){} }, 60);
  }
  function close(){ if(root){ root.classList.remove("on"); document.body.classList.remove("mc-lock"); } }
  document.addEventListener("keydown", function(e){ if(e.key==="Escape"&&root&&root.classList.contains("on")) close(); });

  /* ---- Drug Interactions entry point (mounts window.MEDLIST's med-list builder) ----
     Reuses the same mc-overlay chrome as the browse overlay above; the body is fully
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

  // minimal fallback styles in case calculators.js (mc-*) didn't load
  function injectFallbackCSS(){
    if(document.getElementById("mc-styles")||document.getElementById("md-fallback-styles")) return;
    var css=".mc-overlay{position:fixed;inset:0;z-index:872;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}.mc-overlay.on{display:flex}.mc-top{display:flex;align-items:center;gap:10px;padding:14px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0)}.mc-back{background:transparent;border:1px solid var(--teal,#0a9396);color:var(--teal,#0a9396);border-radius:9px;height:34px;padding:0 12px;font:600 13px system-ui;cursor:pointer}.mc-title{flex:1;text-align:center;font:800 16px system-ui}.mc-count{font-size:11px;background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:8px;padding:1px 7px}.mc-body{flex:1;overflow-y:auto;padding:14px;max-width:1100px;margin:0 auto;width:100%;box-sizing:border-box}.mc-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 14px;font:500 14px system-ui;margin-bottom:11px}.mc-cats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}.mc-cat{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:16px;padding:6px 12px;font:600 12px system-ui;cursor:pointer}.mc-cat.on{background:var(--teal,#0a9396);color:#fff}.mc-grp-h{font:800 12px system-ui;text-transform:uppercase;color:var(--slate-soft,#888);margin:14px 0 8px}.mc-grid{display:grid;grid-template-columns:1fr;gap:9px}@media(min-width:720px){.mc-grid{grid-template-columns:1fr 1fr}}.mc-card{border:1px solid var(--line,#e5e5e0);border-radius:12px;background:var(--panel,#fff)}.mc-card.open{grid-column:1/-1}.mc-card-head{display:flex;align-items:center;gap:11px;padding:12px 13px;cursor:pointer;width:100%;background:transparent;border:none;text-align:left}.mc-ic{font-size:20px}.mc-card-main{flex:1}.mc-card-t{display:block;font:700 13.5px system-ui}.mc-card-d{display:block;font:500 11.5px system-ui;color:var(--slate-soft,#888)}.mc-chev{color:#888}.mc-panel{padding:4px 13px 14px;border-top:1px solid var(--line,#e5e5e0)}.mc-empty{padding:30px;text-align:center;color:#888}.mc-disc{font:500 11px system-ui;color:#888;border:1px dashed var(--line,#e5e5e0);border-radius:10px;padding:10px 12px;margin-top:18px}body.mc-lock{overflow:hidden}";
    var st=document.createElement("style"); st.id="md-fallback-styles"; st.textContent=css; document.head.appendChild(st);
  }

  window.MEDDRUGS = { match: match, findByName: findByName, searchIndex: searchIndex, detailHTML: detailHTML, openList: openList, close: close, _list: DRUGS,
    openInteractions: openInteractions, closeInteractions: closeInteractions, updatePatientPill: updatePatientPill };
})();
