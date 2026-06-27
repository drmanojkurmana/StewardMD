/* ============================================================================
   StewardMD — Clinical Calculators (50 bedside tools)
   Self-contained, data-driven module. Each calculator declares its inputs and
   a pure compute() — the renderer is generic, so adding a calculator is one
   object. Formulas are transcribed from the standard published sources
   (UNOS/OPTN, CKD-EPI 2021, Surviving Sepsis, AHA/ACC, WHO, etc.).
   Decision support only — verify against the individual patient and local
   policy. Exposes window.MEDCALC.{openList, open}.
   ========================================================================== */
(function () {
  "use strict";

  /* ---- small helpers usable inside compute() ---------------------------- */
  function ok(x) { return typeof x === "number" && !isNaN(x) && isFinite(x); }
  function ln(x) { return Math.log(x); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r0(x) { return Math.round(x); }
  function band(score, bands) {            // bands: [[max,label],...] inclusive
    for (var i = 0; i < bands.length; i++) if (score <= bands[i][0]) return bands[i][1];
    return bands[bands.length - 1][1];
  }
  var ERR = { err: "Enter all required values." };

  /* ====================================================================== *
   * CALCULATOR REGISTRY
   * Each: { id, cat, title, icon, desc, inputs:[...], compute:function(v){} }
   * input: { id, label, type:"number"|"select"|"check"|"date", unit?, step?,
   *          min?, def?, opts:[{v,t}] }
   * compute returns { v:headline, u:unit, i:interpHTML } or { err } or { html }
   * For checks v[id] is boolean; numbers are parsed (NaN if blank); selects are
   * strings (use Number(v[id]) for scored options).
   * ====================================================================== */
  var CALCS = [

  /* ----------------------------- CARDIOVASCULAR ----------------------------- */
  { id:"chadsvasc", cat:"Cardiovascular", icon:"🫀", title:"CHA₂DS₂-VASc",
    desc:"Stroke risk in non-valvular atrial fibrillation.",
    inputs:[
      { id:"chf", label:"Congestive heart failure / LV dysfunction", type:"check" },
      { id:"htn", label:"Hypertension", type:"check" },
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"dm", label:"Diabetes mellitus", type:"check" },
      { id:"stroke", label:"Prior stroke / TIA / thromboembolism", type:"check" },
      { id:"vasc", label:"Vascular disease (MI, PAD, aortic plaque)", type:"check" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.age)) return ERR;
      var s=0;
      if(v.chf)s++; if(v.htn)s++; if(v.dm)s++; if(v.vasc)s++;
      if(v.stroke)s+=2;
      if(v.age>=75)s+=2; else if(v.age>=65)s++;
      if(v.sex==="f")s++;
      var rate=["0.2","0.6","2.2","3.2","4.8","7.2","9.7","11.2","10.8","12.2"][Math.min(s,9)];
      return { v:s, u:"points", i:"Adjusted annual stroke/TE risk ≈ <b>"+rate+"%</b>. Oral anticoagulation recommended at ≥2 (men) / ≥3 (women); consider at 1 (men) / 2 (women)." };
    } },

  { id:"hasbled", cat:"Cardiovascular", icon:"🩸", title:"HAS-BLED bleeding risk",
    desc:"Major bleeding risk on anticoagulation in AF.",
    inputs:[
      { id:"htn", label:"Uncontrolled hypertension (SBP >160)", type:"check" },
      { id:"renal", label:"Abnormal renal function (dialysis, transplant, Cr >2.26 mg/dL)", type:"check" },
      { id:"liver", label:"Abnormal liver function", type:"check" },
      { id:"stroke", label:"Prior stroke", type:"check" },
      { id:"bleed", label:"Prior major bleeding / predisposition", type:"check" },
      { id:"inr", label:"Labile INR (unstable/high, TTR <60%)", type:"check" },
      { id:"elderly", label:"Elderly (age >65)", type:"check" },
      { id:"drugs", label:"Antiplatelet / NSAID use", type:"check" },
      { id:"alcohol", label:"Alcohol ≥8 units/week", type:"check" }
    ],
    compute:function(v){
      var s=0;["htn","renal","liver","stroke","bleed","inr","elderly","drugs","alcohol"].forEach(function(k){if(v[k])s++;});
      var risk=s>=3?"High — major-bleed risk ~3.7–8.7%/yr; review reversible factors, do not withhold anticoagulation on score alone":"Low–moderate — major-bleed risk ~1.0–1.9%/yr";
      return { v:s, u:"points", i:risk+"." };
    } },

  { id:"qtc", cat:"Cardiovascular", icon:"📈", title:"Corrected QT (QTc)",
    desc:"Rate-correct the QT interval (Bazett & Fridericia).",
    inputs:[
      { id:"qt", label:"QT interval", type:"number", unit:"ms", step:"1" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.qt)||!ok(v.hr)||v.hr<=0) return ERR;
      var rr=60/v.hr;
      var baz=v.qt/Math.sqrt(rr), fri=v.qt/Math.cbrt(rr);
      var lim=v.sex==="f"?470:450;
      var flag=baz>=(v.sex==="f"?480:470)?"prolonged — torsades risk":baz>lim?"borderline prolonged":"normal";
      return { v:r0(baz), u:"ms (Bazett)", i:"Fridericia QTc = <b>"+r0(fri)+" ms</b>. QTc is <b>"+flag+"</b> (sex threshold "+lim+" ms). Bazett over-corrects at high rates — prefer Fridericia if HR >100." };
    } },

  { id:"map", cat:"Cardiovascular", icon:"🩺", title:"Mean Arterial Pressure",
    desc:"MAP from systolic and diastolic BP.",
    inputs:[
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" },
      { id:"dbp", label:"Diastolic BP", type:"number", unit:"mmHg" }
    ],
    compute:function(v){
      if(!ok(v.sbp)||!ok(v.dbp)) return ERR;
      var map=(v.sbp+2*v.dbp)/3;
      return { v:r0(map), u:"mmHg", i:(map<65?"Below 65 mmHg — inadequate organ perfusion; resuscitate.":"≥65 mmHg — usual resuscitation target in sepsis/shock.") };
    } },

  { id:"timi_nstemi", cat:"Cardiovascular", icon:"❤️", title:"TIMI risk (UA/NSTEMI)",
    desc:"14-day risk of death/MI/urgent revascularisation.",
    inputs:[
      { id:"age", label:"Age ≥65", type:"check" },
      { id:"risk3", label:"≥3 CAD risk factors", type:"check" },
      { id:"cad", label:"Known CAD (stenosis ≥50%)", type:"check" },
      { id:"asa", label:"Aspirin use in prior 7 days", type:"check" },
      { id:"angina", label:"≥2 anginal episodes in 24 h", type:"check" },
      { id:"st", label:"ST deviation ≥0.5 mm", type:"check" },
      { id:"marker", label:"Positive cardiac marker", type:"check" }
    ],
    compute:function(v){
      var s=0;["age","risk3","cad","asa","angina","st","marker"].forEach(function(k){if(v[k])s++;});
      var rate=["4.7","4.7","8.3","13.2","19.9","26.2","40.9","40.9"][s];
      return { v:s, u:"/7", i:"14-day risk of death / MI / urgent revascularisation ≈ <b>"+rate+"%</b>. Score ≥3 favours early invasive strategy." };
    } },

  { id:"wells_pe", cat:"Cardiovascular", icon:"🫁", title:"Wells score — PE",
    desc:"Pre-test probability of pulmonary embolism.",
    inputs:[
      { id:"dvt", label:"Clinical signs of DVT", type:"check" },
      { id:"alt", label:"PE is the most likely diagnosis", type:"check" },
      { id:"hr", label:"Heart rate >100", type:"check" },
      { id:"immob", label:"Immobilisation/surgery in prior 4 weeks", type:"check" },
      { id:"prev", label:"Previous DVT/PE", type:"check" },
      { id:"hemo", label:"Haemoptysis", type:"check" },
      { id:"malig", label:"Active malignancy", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.dvt)s+=3; if(v.alt)s+=3; if(v.hr)s+=1.5; if(v.immob)s+=1.5; if(v.prev)s+=1.5; if(v.hemo)s+=1; if(v.malig)s+=1;
      var tier=s>6?"High":s>=2?"Moderate":"Low";
      var two=s<=4?"PE unlikely — use D-dimer (or PERC) to exclude":"PE likely — proceed to CT pulmonary angiography";
      return { v:s, u:"points", i:"3-tier: <b>"+tier+"</b> probability. 2-tier: <b>"+two+"</b>." };
    } },

  { id:"wells_dvt", cat:"Cardiovascular", icon:"🦵", title:"Wells score — DVT",
    desc:"Pre-test probability of deep vein thrombosis.",
    inputs:[
      { id:"cancer", label:"Active cancer", type:"check" },
      { id:"paralysis", label:"Paralysis/paresis or recent immobilisation of leg", type:"check" },
      { id:"bed", label:"Bedridden >3 days or major surgery <12 weeks", type:"check" },
      { id:"tender", label:"Localised tenderness along deep veins", type:"check" },
      { id:"swollen", label:"Entire leg swollen", type:"check" },
      { id:"calf", label:"Calf swelling >3 cm vs other leg", type:"check" },
      { id:"edema", label:"Pitting oedema (symptomatic leg)", type:"check" },
      { id:"veins", label:"Collateral superficial veins (non-varicose)", type:"check" },
      { id:"prev", label:"Previously documented DVT", type:"check" },
      { id:"alt", label:"Alternative diagnosis at least as likely (−2)", type:"check" }
    ],
    compute:function(v){
      var s=0;["cancer","paralysis","bed","tender","swollen","calf","edema","veins","prev"].forEach(function(k){if(v[k])s++;});
      if(v.alt)s-=2;
      var tier=s>=3?"High":s>=1?"Moderate":"Low";
      var two=s<=1?"DVT unlikely — D-dimer to exclude":"DVT likely — proceed to compression ultrasound";
      return { v:s, u:"points", i:"3-tier: <b>"+tier+"</b> probability. 2-tier: <b>"+two+"</b>." };
    } },

  { id:"perc", cat:"Cardiovascular", icon:"✅", title:"PERC rule (PE rule-out)",
    desc:"Rule out PE in low pre-test probability without testing.",
    inputs:[
      { id:"age", label:"Age <50", type:"check" },
      { id:"hr", label:"Heart rate <100", type:"check" },
      { id:"spo2", label:"SaO₂ ≥95% on room air", type:"check" },
      { id:"hemo", label:"No haemoptysis", type:"check" },
      { id:"estrogen", label:"No exogenous oestrogen", type:"check" },
      { id:"prior", label:"No prior DVT/PE", type:"check" },
      { id:"leg", label:"No unilateral leg swelling", type:"check" },
      { id:"surg", label:"No surgery/trauma needing hospitalisation <4 weeks", type:"check" }
    ],
    compute:function(v){
      var met=0;["age","hr","spo2","hemo","estrogen","prior","leg","surg"].forEach(function(k){if(v[k])met++;});
      var neg=met===8;
      return { v:met, u:"/8 criteria met", i:neg?"<b>PERC negative</b> — in a low pre-test-probability patient, PE is excluded; no D-dimer needed.":"<b>PERC positive</b> — cannot exclude PE on PERC; pursue D-dimer/imaging." };
    } },

  { id:"shock_index", cat:"Cardiovascular", icon:"⚡", title:"Shock Index",
    desc:"Heart rate / systolic BP — occult shock marker.",
    inputs:[
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" }
    ],
    compute:function(v){
      if(!ok(v.hr)||!ok(v.sbp)||v.sbp<=0) return ERR;
      var si=v.hr/v.sbp;
      return { v:r1(si), u:"", i:(si>=0.9?"Elevated (≥0.9) — suggests haemodynamic compromise / occult hypoperfusion.":"Normal (0.5–0.7).") };
    } },

  { id:"ldl", cat:"Cardiovascular", icon:"🧈", title:"LDL (Friedewald)",
    desc:"Estimated LDL cholesterol.",
    inputs:[
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mg/dL" },
      { id:"hdl", label:"HDL", type:"number", unit:"mg/dL" },
      { id:"tg", label:"Triglycerides", type:"number", unit:"mg/dL" }
    ],
    compute:function(v){
      if(!ok(v.tc)||!ok(v.hdl)||!ok(v.tg)) return ERR;
      if(v.tg>400) return { v:"n/a", u:"", i:"Friedewald is invalid when triglycerides >400 mg/dL — measure LDL directly." };
      var ldl=v.tc-v.hdl-v.tg/5;
      return { v:r0(ldl), u:"mg/dL", i:"Estimated LDL-C. Treatment targets depend on ASCVD risk category." };
    } },

  /* ----------------------------- CRITICAL CARE ----------------------------- */
  { id:"curb65", cat:"Critical care", icon:"🫁", title:"CURB-65 (pneumonia)",
    desc:"Community-acquired pneumonia severity / disposition.",
    inputs:[
      { id:"conf", label:"Confusion (new disorientation)", type:"check" },
      { id:"urea", label:"Urea >7 mmol/L (BUN >19 mg/dL)", type:"check" },
      { id:"rr", label:"Respiratory rate ≥30", type:"check" },
      { id:"bp", label:"SBP <90 or DBP ≤60 mmHg", type:"check" },
      { id:"age", label:"Age ≥65", type:"check" }
    ],
    compute:function(v){
      var s=0;["conf","urea","rr","bp","age"].forEach(function(k){if(v[k])s++;});
      var d=s<=1?"Low severity — consider outpatient management":s===2?"Moderate — consider short-stay/inpatient":"Severe — admit; assess for ICU";
      return { v:s, u:"/5", i:"<b>"+d+"</b>. 30-day mortality rises steeply at ≥3." };
    } },

  { id:"qsofa", cat:"Critical care", icon:"🚨", title:"qSOFA",
    desc:"Bedside screen for sepsis with poor outcome.",
    inputs:[
      { id:"rr", label:"Respiratory rate ≥22", type:"check" },
      { id:"ams", label:"Altered mentation (GCS <15)", type:"check" },
      { id:"sbp", label:"Systolic BP ≤100 mmHg", type:"check" }
    ],
    compute:function(v){
      var s=0;["rr","ams","sbp"].forEach(function(k){if(v[k])s++;});
      return { v:s, u:"/3", i:(s>=2?"<b>≥2 — high risk</b>: assess for organ dysfunction, escalate, consider sepsis.":"Low risk by qSOFA — does not rule out sepsis; reassess.") };
    } },

  { id:"sofa", cat:"Critical care", icon:"📊", title:"SOFA score",
    desc:"Sequential Organ Failure Assessment (0–4 per system).",
    inputs:[
      { id:"resp", label:"Respiration (PaO₂/FiO₂)", type:"select", opts:[{v:"0",t:"≥400 (0)"},{v:"1",t:"<400 (1)"},{v:"2",t:"<300 (2)"},{v:"3",t:"<200 + support (3)"},{v:"4",t:"<100 + support (4)"}] },
      { id:"coag", label:"Coagulation (platelets ×10³)", type:"select", opts:[{v:"0",t:"≥150 (0)"},{v:"1",t:"<150 (1)"},{v:"2",t:"<100 (2)"},{v:"3",t:"<50 (3)"},{v:"4",t:"<20 (4)"}] },
      { id:"liver", label:"Liver (bilirubin mg/dL)", type:"select", opts:[{v:"0",t:"<1.2 (0)"},{v:"1",t:"1.2–1.9 (1)"},{v:"2",t:"2.0–5.9 (2)"},{v:"3",t:"6.0–11.9 (3)"},{v:"4",t:"≥12 (4)"}] },
      { id:"cardio", label:"Cardiovascular", type:"select", opts:[{v:"0",t:"MAP ≥70 (0)"},{v:"1",t:"MAP <70 (1)"},{v:"2",t:"Low-dose pressor (2)"},{v:"3",t:"Mod-dose pressor (3)"},{v:"4",t:"High-dose pressor (4)"}] },
      { id:"cns", label:"CNS (GCS)", type:"select", opts:[{v:"0",t:"15 (0)"},{v:"1",t:"13–14 (1)"},{v:"2",t:"10–12 (2)"},{v:"3",t:"6–9 (3)"},{v:"4",t:"<6 (4)"}] },
      { id:"renal", label:"Renal (creatinine mg/dL)", type:"select", opts:[{v:"0",t:"<1.2 (0)"},{v:"1",t:"1.2–1.9 (1)"},{v:"2",t:"2.0–3.4 (2)"},{v:"3",t:"3.5–4.9 (3)"},{v:"4",t:"≥5.0 (4)"}] }
    ],
    compute:function(v){
      var s=Number(v.resp)+Number(v.coag)+Number(v.liver)+Number(v.cardio)+Number(v.cns)+Number(v.renal);
      return { v:s, u:"/24", i:"Mortality rises with score; an acute rise of ≥2 from baseline defines sepsis (Sepsis-3)." };
    } },

  { id:"pf_ratio", cat:"Critical care", icon:"🌬️", title:"PaO₂/FiO₂ ratio",
    desc:"Oxygenation / ARDS severity (Berlin).",
    inputs:[
      { id:"pao2", label:"PaO₂", type:"number", unit:"mmHg" },
      { id:"fio2", label:"FiO₂", type:"number", unit:"%", def:"21" }
    ],
    compute:function(v){
      if(!ok(v.pao2)||!ok(v.fio2)||v.fio2<=0) return ERR;
      var pf=v.pao2/(v.fio2/100);
      var berlin=pf>300?"Normal/above ARDS range":pf>200?"Mild ARDS":pf>100?"Moderate ARDS":"Severe ARDS";
      return { v:r0(pf), u:"mmHg", i:"Berlin (with PEEP ≥5): <b>"+berlin+"</b>." };
    } },

  { id:"aa_gradient", cat:"Critical care", icon:"💨", title:"A–a oxygen gradient",
    desc:"Alveolar-arterial O₂ difference.",
    inputs:[
      { id:"fio2", label:"FiO₂", type:"number", unit:"%", def:"21" },
      { id:"pao2", label:"PaO₂ (arterial)", type:"number", unit:"mmHg" },
      { id:"paco2", label:"PaCO₂", type:"number", unit:"mmHg" },
      { id:"age", label:"Age", type:"number", unit:"yrs" }
    ],
    compute:function(v){
      if(!ok(v.fio2)||!ok(v.pao2)||!ok(v.paco2)) return ERR;
      var PAO2=(v.fio2/100)*(760-47)-v.paco2/0.8;
      var aa=PAO2-v.pao2;
      var exp=ok(v.age)?(2.5+0.21*v.age):null;
      return { v:r0(aa), u:"mmHg", i:(exp!=null?"Expected for age ≈ "+r0(exp)+" mmHg. ":"")+(exp!=null&&aa>exp?"Elevated — V/Q mismatch, shunt, or diffusion defect.":"Within expected range — consider hypoventilation/low FiO₂ if hypoxic.") };
    } },

  { id:"anion_gap", cat:"Critical care", icon:"🧮", title:"Anion gap (corrected)",
    desc:"Serum anion gap with albumin correction.",
    inputs:[
      { id:"na", label:"Sodium", type:"number", unit:"mmol/L" },
      { id:"cl", label:"Chloride", type:"number", unit:"mmol/L" },
      { id:"hco3", label:"Bicarbonate", type:"number", unit:"mmol/L" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", def:"4" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.cl)||!ok(v.hco3)) return ERR;
      var ag=v.na-(v.cl+v.hco3);
      var cag=ok(v.alb)?ag+2.5*(4-v.alb):ag;
      return { v:r1(ag), u:"mmol/L", i:"Albumin-corrected AG = <b>"+r1(cag)+" mmol/L</b> (normal 8–12). High AG → MUDPILES; correct for low albumin to avoid masking." };
    } },

  { id:"winters", cat:"Critical care", icon:"🌡️", title:"Winter's formula",
    desc:"Expected PaCO₂ in metabolic acidosis.",
    inputs:[
      { id:"hco3", label:"Bicarbonate", type:"number", unit:"mmol/L" },
      { id:"paco2", label:"Measured PaCO₂ (optional)", type:"number", unit:"mmHg" }
    ],
    compute:function(v){
      if(!ok(v.hco3)) return ERR;
      var exp=1.5*v.hco3+8;
      var msg="Expected PaCO₂ = <b>"+r1(exp-2)+"–"+r1(exp+2)+" mmHg</b>.";
      if(ok(v.paco2)) msg+=v.paco2>exp+2?" Measured higher → concurrent respiratory acidosis.":v.paco2<exp-2?" Measured lower → concurrent respiratory alkalosis.":" Measured within expected range → appropriate respiratory compensation.";
      return { v:r0(exp), u:"mmHg (target)", i:msg };
    } },

  { id:"osm", cat:"Critical care", icon:"💧", title:"Serum osmolality & gap",
    desc:"Calculated osmolality and osmolar gap.",
    inputs:[
      { id:"na", label:"Sodium", type:"number", unit:"mmol/L" },
      { id:"glu", label:"Glucose", type:"number", unit:"mg/dL" },
      { id:"bun", label:"BUN", type:"number", unit:"mg/dL" },
      { id:"meas", label:"Measured osmolality (optional)", type:"number", unit:"mOsm/kg" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.glu)||!ok(v.bun)) return ERR;
      var calc=2*v.na+v.glu/18+v.bun/2.8;
      var msg="Calculated osmolality.";
      if(ok(v.meas)){var gap=v.meas-calc; msg="Osmolar gap = <b>"+r1(gap)+"</b> (normal <10). High gap → toxic alcohols (methanol, ethylene glycol), mannitol.";}
      return { v:r0(calc), u:"mOsm/kg", i:msg };
    } },

  { id:"parkland", cat:"Critical care", icon:"🔥", title:"Parkland (burns)",
    desc:"24-hour fluid resuscitation for major burns.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"tbsa", label:"% TBSA burned", type:"number", unit:"%" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.tbsa)) return ERR;
      var total=4*v.wt*v.tbsa;
      return { v:r0(total), u:"mL / 24 h (Ringer's lactate)", i:"Give <b>"+r0(total/2)+" mL over first 8 h</b> (from time of burn), remainder over next 16 h. Titrate to urine output 0.5–1 mL/kg/h." };
    } },

  { id:"ranson", cat:"Critical care", icon:"🩻", title:"Ranson's criteria (admission)",
    desc:"Admission severity of acute pancreatitis (non-gallstone).",
    inputs:[
      { id:"age", label:"Age >55", type:"check" },
      { id:"wbc", label:"WBC >16,000/µL", type:"check" },
      { id:"glu", label:"Glucose >200 mg/dL", type:"check" },
      { id:"ast", label:"AST >250 U/L", type:"check" },
      { id:"ldh", label:"LDH >350 U/L", type:"check" }
    ],
    compute:function(v){
      var s=0;["age","wbc","glu","ast","ldh"].forEach(function(k){if(v[k])s++;});
      return { v:s, u:"/5 (admission)", i:"Admission component only — 48-hour criteria add to the total. ≥3 of the full 11 suggests severe pancreatitis." };
    } },

  { id:"gbs", cat:"Critical care", icon:"🩸", title:"Glasgow-Blatchford (GI bleed)",
    desc:"Need for intervention in upper GI bleeding.",
    inputs:[
      { id:"bun", label:"BUN", type:"select", opts:[{v:"0",t:"<18.2 (0)"},{v:"2",t:"18.2–22.3 (2)"},{v:"3",t:"22.4–28 (3)"},{v:"4",t:"28–70 (4)"},{v:"6",t:">70 (6)"}] },
      { id:"hb", label:"Haemoglobin", type:"select", opts:[{v:"0",t:"Men ≥13 / Women ≥12 (0)"},{v:"1",t:"Men 12–13 (1)"},{v:"3",t:"Men 10–12 / Women 10–12 (3)"},{v:"6",t:"<10 (6)"}] },
      { id:"sbp", label:"Systolic BP", type:"select", opts:[{v:"0",t:"≥110 (0)"},{v:"1",t:"100–109 (1)"},{v:"2",t:"90–99 (2)"},{v:"3",t:"<90 (3)"}] },
      { id:"other", label:"Pulse ≥100", type:"check" },
      { id:"melena", label:"Melena present", type:"check" },
      { id:"syncope", label:"Syncope", type:"check" },
      { id:"liver", label:"Hepatic disease", type:"check" },
      { id:"cardiac", label:"Cardiac failure", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.bun)+Number(v.hb)+Number(v.sbp);
      if(v.other)s+=1; if(v.melena)s+=1; if(v.syncope)s+=2; if(v.liver)s+=2; if(v.cardiac)s+=2;
      return { v:s, u:"points", i:(s===0?"Score 0 — very low risk; consider outpatient management.":"Score ≥1 — increased risk; admit and arrange endoscopy.") };
    } },

  /* ----------------------------- RENAL / ELECTROLYTES ----------------------------- */
  { id:"crcl", cat:"Renal", icon:"🧮", title:"CrCl (Cockcroft-Gault)",
    desc:"Creatinine clearance for drug dosing.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.wt)||!ok(v.scr)||v.scr<=0) return ERR;
      var crcl=(140-v.age)*v.wt/(72*v.scr); if(v.sex==="f")crcl*=0.85;
      return { v:r0(crcl), u:"mL/min", i:"Use actual body weight unless obese (use adjusted). Renal dosing thresholds typically at <50, <30, <15 mL/min." };
    } },

  { id:"ckdepi", cat:"Renal", icon:"🫘", title:"eGFR (CKD-EPI 2021)",
    desc:"Race-free creatinine eGFR.",
    inputs:[
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.scr)||!ok(v.age)||v.scr<=0) return ERR;
      var f=v.sex==="f", k=f?0.7:0.9, a=f?-0.241:-0.302;
      var egfr=142*Math.pow(Math.min(v.scr/k,1),a)*Math.pow(Math.max(v.scr/k,1),-1.200)*Math.pow(0.9938,v.age)*(f?1.012:1);
      var stage=egfr>=90?"G1 (normal/high)":egfr>=60?"G2 (mildly decreased)":egfr>=45?"G3a":egfr>=30?"G3b":egfr>=15?"G4 (severe)":"G5 (kidney failure)";
      return { v:r0(egfr), u:"mL/min/1.73m²", i:"CKD stage <b>"+stage+"</b>. 2021 equation omits the race coefficient." };
    } },

  { id:"mdrd", cat:"Renal", icon:"🫘", title:"eGFR (MDRD, race-free)",
    desc:"4-variable MDRD eGFR.",
    inputs:[
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.scr)||!ok(v.age)||v.scr<=0) return ERR;
      var egfr=175*Math.pow(v.scr,-1.154)*Math.pow(v.age,-0.203)*(v.sex==="f"?0.742:1);
      return { v:r0(egfr), u:"mL/min/1.73m²", i:"CKD-EPI 2021 is preferred over MDRD for accuracy, especially at higher GFR." };
    } },

  { id:"fena", cat:"Renal", icon:"💧", title:"FENa",
    desc:"Fractional excretion of sodium — pre-renal vs ATN.",
    inputs:[
      { id:"una", label:"Urine sodium", type:"number", unit:"mmol/L" },
      { id:"pna", label:"Plasma sodium", type:"number", unit:"mmol/L" },
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"mg/dL" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"mg/dL" }
    ],
    compute:function(v){
      if(!ok(v.una)||!ok(v.pna)||!ok(v.ucr)||!ok(v.pcr)||v.pna<=0||v.ucr<=0) return ERR;
      var fe=(v.una*v.pcr)/(v.pna*v.ucr)*100;
      return { v:r1(fe), u:"%", i:(fe<1?"<1% → pre-renal (or contrast/glomerular).":fe>2?">2% → intrinsic (ATN).":"1–2% → indeterminate.")+" Unreliable on diuretics — use FEUrea instead." };
    } },

  { id:"feurea", cat:"Renal", icon:"💧", title:"FEUrea",
    desc:"Fractional excretion of urea (valid on diuretics).",
    inputs:[
      { id:"uurea", label:"Urine urea", type:"number", unit:"mg/dL" },
      { id:"bun", label:"Serum BUN", type:"number", unit:"mg/dL" },
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"mg/dL" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"mg/dL" }
    ],
    compute:function(v){
      if(!ok(v.uurea)||!ok(v.bun)||!ok(v.ucr)||!ok(v.pcr)||v.bun<=0||v.ucr<=0) return ERR;
      var fe=(v.uurea*v.pcr)/(v.bun*v.ucr)*100;
      return { v:r1(fe), u:"%", i:(fe<35?"<35% → pre-renal.":">50% → intrinsic (ATN).")+" More reliable than FENa when diuretics have been given." };
    } },

  { id:"corr_na", cat:"Renal", icon:"🧂", title:"Corrected Na (hyperglycaemia)",
    desc:"Sodium corrected for serum glucose.",
    inputs:[
      { id:"na", label:"Measured sodium", type:"number", unit:"mmol/L" },
      { id:"glu", label:"Glucose", type:"number", unit:"mg/dL" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.glu)) return ERR;
      var corr=v.na+1.6*((v.glu-100)/100);
      var katz=v.na+2.4*((v.glu-100)/100);
      return { v:r1(corr), u:"mmol/L", i:"Katz (×1.6). Hillier/Adrogué (×2.4) = <b>"+r1(katz)+" mmol/L</b>. Corrected value reflects true sodium once glucose is normalised." };
    } },

  { id:"fw_deficit", cat:"Renal", icon:"🚰", title:"Free water deficit",
    desc:"Water deficit in hypernatraemia.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"na", label:"Current sodium", type:"number", unit:"mmol/L" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.na)) return ERR;
      var tbw=(v.sex==="f"?0.5:0.6)*v.wt;
      var def=tbw*((v.na/140)-1);
      return { v:r1(def), u:"L", i:"Replace slowly — lower serum Na by ≤10 mmol/L/24 h (cerebral oedema risk). Add ongoing losses." };
    } },

  { id:"na_deficit", cat:"Renal", icon:"🧂", title:"Sodium deficit (hyponatraemia)",
    desc:"Na needed to reach a target.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"cur", label:"Current sodium", type:"number", unit:"mmol/L" },
      { id:"tgt", label:"Target sodium", type:"number", unit:"mmol/L", def:"130" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.cur)||!ok(v.tgt)) return ERR;
      var tbw=(v.sex==="f"?0.5:0.6)*v.wt;
      var def=tbw*(v.tgt-v.cur);
      return { v:r0(def), u:"mmol Na", i:"Correct ≤8 mmol/L per 24 h (osmotic demyelination risk). Use Adrogué-Madias to predict the rise per litre of infusate." };
    } },

  { id:"corr_ca", cat:"Renal", icon:"🦴", title:"Corrected calcium",
    desc:"Calcium corrected for albumin.",
    inputs:[
      { id:"ca", label:"Measured calcium", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ca)||!ok(v.alb)) return ERR;
      var c=v.ca+0.8*(4-v.alb);
      return { v:r1(c), u:"mg/dL", i:(c>10.5?"Corrected calcium high — investigate hypercalcaemia.":c<8.5?"Corrected calcium low.":"Within normal range (8.5–10.5).")+" Ionised calcium is definitive if acid-base disturbed." };
    } },

  { id:"holliday", cat:"Renal", icon:"🍼", title:"Maintenance fluids (4-2-1)",
    desc:"Holliday-Segar hourly maintenance fluid.",
    inputs:[ { id:"wt", label:"Weight", type:"number", unit:"kg" } ],
    compute:function(v){
      if(!ok(v.wt)) return ERR;
      var w=v.wt, rate;
      if(w<=10)rate=4*w; else if(w<=20)rate=40+2*(w-10); else rate=60+1*(w-20);
      return { v:r0(rate), u:"mL/hr", i:"Daily volume ≈ <b>"+r0(rate*24)+" mL/24h</b> (4 mL/kg/h first 10 kg, +2 next 10, +1 thereafter)." };
    } },

  /* ----------------------------- HEPATOLOGY ----------------------------- */
  { id:"meld", cat:"Hepatology", icon:"🫀", title:"MELD & MELD-Na",
    desc:"End-stage liver disease 90-day mortality.",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"inr", label:"INR", type:"number", step:"0.1" },
      { id:"cr", label:"Creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"na", label:"Sodium (for MELD-Na)", type:"number", unit:"mmol/L" },
      { id:"dial", label:"Dialysis ≥2× in past week", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.bili)||!ok(v.inr)||!ok(v.cr)) return ERR;
      var bili=Math.max(1,v.bili), inr=Math.max(1,v.inr);
      var cr=v.dial?4:Math.max(1,Math.min(4,v.cr));
      var meld=Math.round(3.78*ln(bili)+11.2*ln(inr)+9.57*ln(cr)+6.43);
      meld=Math.max(6,Math.min(40,meld));
      var out="MELD = <b>"+meld+"</b>.";
      if(ok(v.na)){
        var na=Math.max(125,Math.min(137,v.na));
        var meldna=meld; if(meld>11) meldna=Math.round(meld+1.32*(137-na)-(0.033*meld*(137-na)));
        meldna=Math.max(6,Math.min(40,meldna));
        out="MELD-Na = <b>"+meldna+"</b> (MELD "+meld+").";
      }
      var mort=meld<=9?"~1.9%":meld<=19?"~6%":meld<=29?"~19.6%":meld<=39?"~52.6%":"~71.3%";
      return { v:meld, u:"MELD", i:out+" 3-month mortality ≈ "+mort+"." };
    } },

  { id:"childpugh", cat:"Hepatology", icon:"🫁", title:"Child-Pugh",
    desc:"Cirrhosis severity classification.",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"select", opts:[{v:"1",t:"<2 mg/dL (1)"},{v:"2",t:"2–3 mg/dL (2)"},{v:"3",t:">3 mg/dL (3)"}] },
      { id:"alb", label:"Albumin", type:"select", opts:[{v:"1",t:">3.5 g/dL (1)"},{v:"2",t:"2.8–3.5 g/dL (2)"},{v:"3",t:"<2.8 g/dL (3)"}] },
      { id:"inr", label:"INR", type:"select", opts:[{v:"1",t:"<1.7 (1)"},{v:"2",t:"1.7–2.3 (2)"},{v:"3",t:">2.3 (3)"}] },
      { id:"ascites", label:"Ascites", type:"select", opts:[{v:"1",t:"None (1)"},{v:"2",t:"Mild/controlled (2)"},{v:"3",t:"Moderate–severe (3)"}] },
      { id:"enceph", label:"Encephalopathy", type:"select", opts:[{v:"1",t:"None (1)"},{v:"2",t:"Grade I–II (2)"},{v:"3",t:"Grade III–IV (3)"}] }
    ],
    compute:function(v){
      var s=Number(v.bili)+Number(v.alb)+Number(v.inr)+Number(v.ascites)+Number(v.enceph);
      var cls=s<=6?"A (well-compensated)":s<=9?"B (significant compromise)":"C (decompensated)";
      return { v:s, u:"/15", i:"Class <b>"+cls+"</b>. 1-yr survival ≈ A 100%, B 80%, C 45%." };
    } },

  { id:"maddrey", cat:"Hepatology", icon:"🍺", title:"Maddrey's DF",
    desc:"Discriminant function in alcoholic hepatitis.",
    inputs:[
      { id:"pt", label:"Patient PT", type:"number", unit:"sec" },
      { id:"ctrl", label:"Control PT", type:"number", unit:"sec" },
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.pt)||!ok(v.ctrl)||!ok(v.bili)) return ERR;
      var df=4.6*(v.pt-v.ctrl)+v.bili;
      return { v:r1(df), u:"", i:(df>=32?"≥32 — severe alcoholic hepatitis; high short-term mortality. Consider corticosteroids (assess infection, calculate Lille at day 7).":"<32 — non-severe.") };
    } },

  { id:"fib4", cat:"Hepatology", icon:"🔬", title:"FIB-4 index",
    desc:"Non-invasive liver fibrosis estimate.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"ast", label:"AST", type:"number", unit:"U/L" },
      { id:"alt", label:"ALT", type:"number", unit:"U/L" },
      { id:"plt", label:"Platelets", type:"number", unit:"×10⁹/L" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.ast)||!ok(v.alt)||!ok(v.plt)||v.plt<=0||v.alt<=0) return ERR;
      var f=(v.age*v.ast)/(v.plt*Math.sqrt(v.alt));
      return { v:r1(f? f : NaN), u:"", i:(f<1.3?"<1.3 — advanced fibrosis unlikely (use 2.0 if age >65).":f<=2.67?"1.3–2.67 — indeterminate; consider elastography.":">2.67 — advanced fibrosis likely.") };
    } },

  { id:"apri", cat:"Hepatology", icon:"🔬", title:"APRI score",
    desc:"AST-to-platelet ratio index for fibrosis.",
    inputs:[
      { id:"ast", label:"AST", type:"number", unit:"U/L" },
      { id:"uln", label:"AST upper limit of normal", type:"number", unit:"U/L", def:"40" },
      { id:"plt", label:"Platelets", type:"number", unit:"×10⁹/L" }
    ],
    compute:function(v){
      if(!ok(v.ast)||!ok(v.uln)||!ok(v.plt)||v.uln<=0||v.plt<=0) return ERR;
      var a=(v.ast/v.uln)/v.plt*100;
      return { v:r1(a), u:"", i:(a>1?">1.0 — significant fibrosis/cirrhosis likely.":a<0.5?"<0.5 — significant fibrosis unlikely.":"0.5–1.0 — indeterminate.") };
    } },

  /* ----------------------------- NEUROLOGY ----------------------------- */
  { id:"gcs", cat:"Neurology", icon:"🧠", title:"Glasgow Coma Scale",
    desc:"Level of consciousness (E+V+M).",
    inputs:[
      { id:"e", label:"Eye opening", type:"select", opts:[{v:"4",t:"Spontaneous (4)"},{v:"3",t:"To speech (3)"},{v:"2",t:"To pain (2)"},{v:"1",t:"None (1)"}] },
      { id:"vrb", label:"Verbal response", type:"select", opts:[{v:"5",t:"Oriented (5)"},{v:"4",t:"Confused (4)"},{v:"3",t:"Inappropriate words (3)"},{v:"2",t:"Incomprehensible (2)"},{v:"1",t:"None (1)"}] },
      { id:"m", label:"Motor response", type:"select", opts:[{v:"6",t:"Obeys commands (6)"},{v:"5",t:"Localises pain (5)"},{v:"4",t:"Withdraws (4)"},{v:"3",t:"Abnormal flexion (3)"},{v:"2",t:"Extension (2)"},{v:"1",t:"None (1)"}] }
    ],
    compute:function(v){
      var s=Number(v.e)+Number(v.vrb)+Number(v.m);
      var sev=s>=13?"mild":s>=9?"moderate":"severe";
      return { v:s, u:"/15", i:"E"+v.e+" V"+v.vrb+" M"+v.m+" — <b>"+sev+"</b> brain injury. GCS ≤8 → consider airway protection." };
    } },

  { id:"nihss", cat:"Neurology", icon:"🧠", title:"NIHSS (stroke severity)",
    desc:"NIH Stroke Scale — enter each item's points.",
    inputs:[
      { id:"loc", label:"1a LOC (0–3)", type:"number", min:"0" },
      { id:"locq", label:"1b LOC questions (0–2)", type:"number", min:"0" },
      { id:"locc", label:"1c LOC commands (0–2)", type:"number", min:"0" },
      { id:"gaze", label:"2 Best gaze (0–2)", type:"number", min:"0" },
      { id:"vis", label:"3 Visual fields (0–3)", type:"number", min:"0" },
      { id:"face", label:"4 Facial palsy (0–3)", type:"number", min:"0" },
      { id:"larm", label:"5a Left arm motor (0–4)", type:"number", min:"0" },
      { id:"rarm", label:"5b Right arm motor (0–4)", type:"number", min:"0" },
      { id:"lleg", label:"6a Left leg motor (0–4)", type:"number", min:"0" },
      { id:"rleg", label:"6b Right leg motor (0–4)", type:"number", min:"0" },
      { id:"ataxia", label:"7 Limb ataxia (0–2)", type:"number", min:"0" },
      { id:"sens", label:"8 Sensory (0–2)", type:"number", min:"0" },
      { id:"lang", label:"9 Language/aphasia (0–3)", type:"number", min:"0" },
      { id:"dys", label:"10 Dysarthria (0–2)", type:"number", min:"0" },
      { id:"ext", label:"11 Extinction/neglect (0–2)", type:"number", min:"0" }
    ],
    compute:function(v){
      var keys=["loc","locq","locc","gaze","vis","face","larm","rarm","lleg","rleg","ataxia","sens","lang","dys","ext"];
      var s=0; for(var i=0;i<keys.length;i++){ var x=v[keys[i]]; if(ok(x)) s+=x; }
      var sev=s===0?"no stroke symptoms":s<=4?"minor":s<=15?"moderate":s<=20?"moderate–severe":"severe";
      return { v:s, u:"/42", i:"<b>"+sev+"</b> stroke. Higher scores predict larger infarcts and worse outcome; informs thrombolysis/thrombectomy decisions." };
    } },

  { id:"a2ds2", cat:"Neurology", icon:"🫁", title:"A2DS2 (stroke-associated pneumonia)",
    desc:"Risk of pneumonia after acute ischaemic stroke.",
    inputs:[
      { id:"age", label:"Age ≥75", type:"check" },
      { id:"af", label:"Atrial fibrillation", type:"check" },
      { id:"dysphagia", label:"Dysphagia", type:"check" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"nihss", label:"NIHSS severity", type:"select", opts:[{v:"0",t:"0–4 (0)"},{v:"3",t:"5–15 (3)"},{v:"5",t:"≥16 (5)"}] }
    ],
    compute:function(v){
      var s=0; if(v.age)s+=1; if(v.af)s+=1; if(v.dysphagia)s+=2; if(v.sex==="m")s+=1; s+=Number(v.nihss);
      return { v:s, u:"/10", i:(s>=5?"Higher score — substantially increased stroke-associated pneumonia risk; heighten aspiration precautions and monitoring.":"Lower score — lower pneumonia risk.") };
    } },

  { id:"abcd2", cat:"Neurology", icon:"⏱️", title:"ABCD² (TIA stroke risk)",
    desc:"Early stroke risk after TIA.",
    inputs:[
      { id:"age", label:"Age ≥60", type:"check" },
      { id:"bp", label:"BP ≥140/90 at presentation", type:"check" },
      { id:"clin", label:"Clinical features", type:"select", opts:[{v:"2",t:"Unilateral weakness (2)"},{v:"1",t:"Speech disturbance without weakness (1)"},{v:"0",t:"Other (0)"}] },
      { id:"dur", label:"Duration", type:"select", opts:[{v:"2",t:"≥60 min (2)"},{v:"1",t:"10–59 min (1)"},{v:"0",t:"<10 min (0)"}] },
      { id:"dm", label:"Diabetes", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.age)s++; if(v.bp)s++; if(v.dm)s++; s+=Number(v.clin)+Number(v.dur);
      var risk=s>=6?"high (8.1% at 2 days)":s>=4?"moderate (4.1% at 2 days)":"low (1.0% at 2 days)";
      return { v:s, u:"/7", i:"2-day stroke risk <b>"+risk+"</b>. Many units admit/expedite ≥4." };
    } },

  { id:"ich", cat:"Neurology", icon:"🩸", title:"ICH score",
    desc:"30-day mortality after intracerebral haemorrhage.",
    inputs:[
      { id:"gcs", label:"GCS", type:"select", opts:[{v:"0",t:"13–15 (0)"},{v:"1",t:"5–12 (1)"},{v:"2",t:"3–4 (2)"}] },
      { id:"vol", label:"ICH volume ≥30 cm³", type:"check" },
      { id:"ivh", label:"Intraventricular haemorrhage", type:"check" },
      { id:"infra", label:"Infratentorial origin", type:"check" },
      { id:"age", label:"Age ≥80", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.gcs); if(v.vol)s++; if(v.ivh)s++; if(v.infra)s++; if(v.age)s++;
      var mort=["0%","13%","26%","72%","97%","100%","100%"][Math.min(s,6)];
      return { v:s, u:"/6", i:"30-day mortality ≈ <b>"+mort+"</b>." };
    } },

  { id:"centor", cat:"Neurology", icon:"👄", title:"Centor / McIsaac (pharyngitis)",
    desc:"Likelihood of streptococcal pharyngitis.",
    inputs:[
      { id:"exudate", label:"Tonsillar exudate", type:"check" },
      { id:"nodes", label:"Tender anterior cervical nodes", type:"check" },
      { id:"fever", label:"History of fever >38°C", type:"check" },
      { id:"cough", label:"Absence of cough", type:"check" },
      { id:"age", label:"Age", type:"select", opts:[{v:"1",t:"3–14 (+1)"},{v:"0",t:"15–44 (0)"},{v:"-1",t:"≥45 (−1)"}] }
    ],
    compute:function(v){
      var s=0;["exudate","nodes","fever","cough"].forEach(function(k){if(v[k])s++;}); s+=Number(v.age);
      var d=s<=0?"~1–2.5% — no testing/antibiotics":s<=2?"~5–17% — consider rapid antigen test":s===3?"~28–35% — test; treat if positive":"~51% — test; empirical antibiotics reasonable";
      return { v:s, u:"points", i:"Strep probability <b>"+d+"</b>." };
    } },

  /* ----------------------------- GENERAL / METABOLIC ----------------------------- */
  { id:"bmi", cat:"General", icon:"⚖️", title:"BMI · IBW · AdjBW",
    desc:"Body mass index and dosing body weights.",
    inputs:[
      { id:"ht", label:"Height", type:"number", unit:"cm" },
      { id:"wt", label:"Weight (optional — for BMI/AdjBW)", type:"number", unit:"kg" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!ok(v.ht)||v.ht<=0) return ERR;
      var inch=v.ht/2.54, over=inch-60;
      var ibw=(v.sex==="f"?45.5:50)+(over>0?2.3*over:0);
      // Height alone is enough for ideal body weight (Devine)
      if(!ok(v.wt)){
        return { v:r1(ibw), u:"kg (ideal body weight)", i:"Devine IBW for a "+(v.sex==="f"?"female":"male")+" of "+r0(v.ht)+" cm. Add weight to also get BMI and adjusted body weight." };
      }
      var m=v.ht/100, bmi=v.wt/(m*m);
      var cat=bmi<18.5?"underweight":bmi<25?"normal":bmi<30?"overweight":bmi<35?"obese I":bmi<40?"obese II":"obese III";
      var adj=ibw+0.4*(v.wt-ibw);
      return { v:r1(bmi), u:"kg/m²", i:"<b>"+cat+"</b>. IBW (Devine) = "+r1(ibw)+" kg; adjusted BW = "+r1(adj)+" kg (use AdjBW for hydrophilic drug dosing when obese)." };
    } },

  { id:"bsa", cat:"General", icon:"📐", title:"Body Surface Area",
    desc:"Mosteller & DuBois BSA.",
    inputs:[
      { id:"ht", label:"Height", type:"number", unit:"cm" },
      { id:"wt", label:"Weight", type:"number", unit:"kg" }
    ],
    compute:function(v){
      if(!ok(v.ht)||!ok(v.wt)) return ERR;
      var mos=Math.sqrt(v.ht*v.wt/3600);
      var du=0.007184*Math.pow(v.ht,0.725)*Math.pow(v.wt,0.425);
      return { v:r1(mos*100)/100, u:"m² (Mosteller)", i:"DuBois = <b>"+(r1(du*100)/100)+" m²</b>. Used for chemotherapy and cardiac-index dosing." };
    } },

  { id:"hba1c", cat:"General", icon:"🍬", title:"HbA1c → eAG",
    desc:"Estimated average glucose from HbA1c.",
    inputs:[ { id:"a1c", label:"HbA1c", type:"number", unit:"%", step:"0.1" } ],
    compute:function(v){
      if(!ok(v.a1c)) return ERR;
      var eag=28.7*v.a1c-46.7;
      return { v:r0(eag), u:"mg/dL", i:"= "+r1((eag)/18*10)/10+" mmol/L. ADA diabetes diagnosis at HbA1c ≥6.5%; typical target <7% (individualise)." };
    } },

  { id:"edd", cat:"General", icon:"🤰", title:"EDD (Naegele's rule)",
    desc:"Estimated due date from LMP.",
    inputs:[ { id:"lmp", label:"First day of last menstrual period", type:"date" } ],
    compute:function(v){
      if(!v.lmp) return ERR;
      var d=new Date(v.lmp); if(isNaN(d.getTime())) return ERR;
      var edd=new Date(d.getTime()+280*86400000);
      var now=new Date(); var ga=Math.floor((now-d)/86400000);
      var wks=Math.floor(ga/7), days=ga%7;
      return { v:edd.toLocaleDateString(), u:"EDD", i:"≈ 40 weeks from LMP. Current gestational age ≈ <b>"+(ga>=0?wks+" wk "+days+" d":"pre-LMP date")+"</b> (assumes regular 28-day cycle)." };
    } },

  { id:"retic", cat:"General", icon:"🩸", title:"Corrected reticulocyte",
    desc:"Reticulocyte count adjusted for anaemia.",
    inputs:[
      { id:"retic", label:"Reticulocyte", type:"number", unit:"%", step:"0.1" },
      { id:"hct", label:"Measured haematocrit", type:"number", unit:"%" }
    ],
    compute:function(v){
      if(!ok(v.retic)||!ok(v.hct)) return ERR;
      var c=v.retic*(v.hct/45);
      return { v:r1(c), u:"%", i:"Corrected retic <b>"+r1(c)+"%</b>. >2% suggests adequate marrow response (haemolysis/blood loss); <2% suggests hypoproliferation." };
    } },

  { id:"tsat", cat:"General", icon:"🧲", title:"Transferrin saturation",
    desc:"Iron status — serum iron / TIBC.",
    inputs:[
      { id:"iron", label:"Serum iron", type:"number", unit:"µg/dL" },
      { id:"tibc", label:"TIBC", type:"number", unit:"µg/dL" }
    ],
    compute:function(v){
      if(!ok(v.iron)||!ok(v.tibc)||v.tibc<=0) return ERR;
      var t=v.iron/v.tibc*100;
      return { v:r0(t), u:"%", i:(t<20?"<20% — iron deficiency.":t>45?">45% — iron overload / haemochromatosis screening.":"Normal (20–45%).") };
    } },

  { id:"phenytoin", cat:"General", icon:"💊", title:"Corrected phenytoin",
    desc:"Albumin-corrected phenytoin level.",
    inputs:[
      { id:"level", label:"Measured phenytoin", type:"number", unit:"µg/mL", step:"0.1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"renal", label:"CrCl <20 / dialysis", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.level)||!ok(v.alb)) return ERR;
      var factor=v.renal?0.1:0.2;
      var corr=v.level/(factor*v.alb+0.1);
      return { v:r1(corr), u:"µg/mL", i:"Sheiner-Tozer corrected level (therapeutic 10–20). Uses factor "+factor+" "+(v.renal?"(renal impairment)":"(normal renal function)")+"." };
    } },

  { id:"mentzer", cat:"General", icon:"🔴", title:"Mentzer index",
    desc:"Microcytosis — thalassaemia trait vs iron deficiency.",
    inputs:[
      { id:"mcv", label:"MCV", type:"number", unit:"fL" },
      { id:"rbc", label:"RBC count", type:"number", unit:"×10¹²/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.mcv)||!ok(v.rbc)||v.rbc<=0) return ERR;
      var idx=v.mcv/v.rbc;
      return { v:r1(idx), u:"", i:(idx<13?"<13 — favours β-thalassaemia trait.":">13 — favours iron-deficiency anaemia.")+" Confirm with ferritin / Hb electrophoresis." };
    } }

  ];

  /* search keywords / synonyms per calculator id, so common phrases
     (e.g. "ideal body weight", "creatinine clearance", "egfr") find the calc */
  var KW={
    chadsvasc:["cha2ds2 vasc","chads vasc","af stroke risk","atrial fibrillation stroke","anticoagulation af"],
    hasbled:["bleeding risk","has bled","anticoagulation bleeding"],
    qtc:["corrected qt","prolonged qt","qt interval","bazett","fridericia"],
    map:["mean arterial pressure"],
    timi_nstemi:["timi","acs risk","unstable angina","nstemi risk"],
    wells_pe:["wells","pulmonary embolism probability","pe score"],
    wells_dvt:["wells","dvt probability","leg clot","deep vein thrombosis"],
    perc:["perc rule","pe rule out"],
    shock_index:["shock index","hr sbp ratio"],
    ldl:["friedewald","ldl cholesterol","calculated ldl"],
    curb65:["curb 65","pneumonia severity","cap severity"],
    qsofa:["quick sofa","sepsis screen"],
    sofa:["organ failure","sequential organ failure"],
    pf_ratio:["pao2 fio2","p/f ratio","ards","oxygenation"],
    aa_gradient:["a-a gradient","alveolar arterial","aa gradient"],
    anion_gap:["anion gap","corrected anion gap","metabolic acidosis"],
    winters:["winters formula","expected pco2","respiratory compensation"],
    osm:["serum osmolality","osmolar gap","calculated osmolality"],
    parkland:["burns fluid","parkland formula","burn resuscitation"],
    ranson:["pancreatitis severity","ranson criteria"],
    gbs:["glasgow blatchford","gi bleed score","upper gi bleed"],
    crcl:["creatinine clearance","cockcroft gault","cockcroft","renal dosing"],
    ckdepi:["egfr","gfr","kidney function","ckd epi","ckd stage"],
    mdrd:["egfr","mdrd","gfr"],
    fena:["fractional excretion sodium","fena","prerenal atn"],
    feurea:["fractional excretion urea","feurea"],
    corr_na:["corrected sodium","hyperglycemia sodium","sodium correction glucose"],
    fw_deficit:["free water deficit","hypernatremia water"],
    na_deficit:["sodium deficit","hyponatremia correction"],
    corr_ca:["corrected calcium","albumin calcium","calcium correction"],
    holliday:["maintenance fluid","holliday segar","4-2-1","iv fluid rate","pediatric fluids"],
    meld:["meld na","model end stage liver","liver transplant score","cirrhosis mortality"],
    childpugh:["child pugh","cirrhosis class","liver severity"],
    maddrey:["maddrey","discriminant function","alcoholic hepatitis"],
    fib4:["fib 4","liver fibrosis","fibrosis index"],
    apri:["ast platelet ratio","apri","fibrosis"],
    gcs:["glasgow coma scale","coma score","consciousness"],
    nihss:["nih stroke scale","stroke severity"],
    a2ds2:["a2ds2","stroke associated pneumonia","post stroke pneumonia"],
    abcd2:["abcd2","tia stroke risk","tia score"],
    ich:["ich score","intracerebral hemorrhage mortality"],
    centor:["centor","mcisaac","strep throat","pharyngitis score"],
    bmi:["body mass index","ideal body weight","ibw","lean body weight","adjusted body weight","adjusted body wt","abw","devine","dosing weight","obesity"],
    bsa:["body surface area","mosteller","dubois"],
    hba1c:["estimated average glucose","eag","a1c","glycated haemoglobin","glycated hemoglobin","diabetes control"],
    edd:["due date","naegele","gestational age","pregnancy dating","expected delivery"],
    retic:["corrected reticulocyte","reticulocyte index","anaemia marrow"],
    tsat:["transferrin saturation","iron studies","iron saturation"],
    phenytoin:["corrected phenytoin","sheiner tozer","phenytoin level","albumin phenytoin"],
    mentzer:["mentzer index","thalassaemia iron deficiency","microcytosis"]
  };
  CALCS.forEach(function(c){ c.kw=KW[c.id]||[]; });

  /* primary literature reference per calculator id */
  var REF={
    chadsvasc:"Lip GYH et al. Chest 2010;137(2):263–72.",
    hasbled:"Pisters R et al. Chest 2010;138(5):1093–100.",
    qtc:"Bazett HC. Heart 1920; Fridericia LS. Acta Med Scand 1920.",
    map:"Standard haemodynamic formula (DBP + ⅓ pulse pressure).",
    timi_nstemi:"Antman EM et al. JAMA 2000;284(7):835–42.",
    wells_pe:"Wells PS et al. Thromb Haemost 2000;83(3):416–20.",
    wells_dvt:"Wells PS et al. Lancet 1997;350(9094):1795–8.",
    perc:"Kline JA et al. J Thromb Haemost 2004;2(8):1247–55.",
    shock_index:"Allgöwer M, Burri C. Dtsch Med Wochenschr 1967.",
    ldl:"Friedewald WT et al. Clin Chem 1972;18(6):499–502.",
    curb65:"Lim WS et al. Thorax 2003;58(5):377–82.",
    qsofa:"Singer M et al. (Sepsis-3) JAMA 2016;315(8):801–10.",
    sofa:"Vincent JL et al. Intensive Care Med 1996;22(7):707–10.",
    pf_ratio:"ARDS Definition Task Force (Berlin). JAMA 2012;307(23):2526–33.",
    aa_gradient:"Alveolar gas equation (standard respiratory physiology).",
    anion_gap:"Emmett M, Narins RG. Medicine 1977; albumin correction Figge J et al. 1998.",
    winters:"Albert MS, Dell RB, Winters RW. Ann Intern Med 1967;66(2):312–22.",
    osm:"Osmolar gap: Smithline N, Gardner KD. JAMA 1976;236(14):1594–7.",
    parkland:"Baxter CR, Shires T. Ann N Y Acad Sci 1968;150(3):874–94.",
    ranson:"Ranson JHC et al. Surg Gynecol Obstet 1974;139(1):69–81.",
    gbs:"Blatchford O et al. Lancet 2000;356(9238):1318–21.",
    crcl:"Cockcroft DW, Gault MH. Nephron 1976;16(1):31–41.",
    ckdepi:"Inker LA et al. (CKD-EPI 2021) N Engl J Med 2021;385:1737–49.",
    mdrd:"Levey AS et al. (MDRD) Ann Intern Med 1999;130(6):461–70.",
    fena:"Espinel CH. JAMA 1976;236(6):579–81.",
    feurea:"Carvounis CP et al. Kidney Int 2002;62(6):2223–9.",
    corr_na:"Katz MA. N Engl J Med 1973 (×1.6); Hillier TA et al. Am J Med 1999 (×2.4).",
    fw_deficit:"Adrogué HJ, Madias NE. N Engl J Med 2000;342(20):1493–9.",
    na_deficit:"Adrogué HJ, Madias NE. N Engl J Med 2000;342(21):1581–9.",
    corr_ca:"Payne RB et al. Br Med J 1973;4(5893):643–6.",
    holliday:"Holliday MA, Segar WE. Pediatrics 1957;19(5):823–32.",
    meld:"Kamath PS et al. Hepatology 2001;33(2):464–70; MELD-Na: Kim WR et al. NEJM 2008.",
    childpugh:"Pugh RNH et al. Br J Surg 1973;60(8):646–9.",
    maddrey:"Maddrey WC et al. Gastroenterology 1978;75(2):193–9.",
    fib4:"Sterling RK et al. Hepatology 2006;43(6):1317–25.",
    apri:"Wai CT et al. Hepatology 2003;38(2):518–26.",
    gcs:"Teasdale G, Jennett B. Lancet 1974;2(7872):81–4.",
    nihss:"Brott T et al. Stroke 1989;20(7):864–70.",
    a2ds2:"Hoffmann S et al. Stroke 2012;43(10):2617–23.",
    abcd2:"Johnston SC et al. Lancet 2007;369(9558):283–92.",
    ich:"Hemphill JC et al. Stroke 2001;32(4):891–7.",
    centor:"Centor RM et al. Med Decis Making 1981; McIsaac WJ et al. CMAJ 1998.",
    bmi:"WHO Technical Report 2000 (BMI); Devine BJ. Drug Intell Clin Pharm 1974 (IBW).",
    bsa:"Mosteller RD. N Engl J Med 1987;317(17):1098; Du Bois D & Du Bois EF. 1916.",
    hba1c:"Nathan DM et al. (ADAG) Diabetes Care 2008;31(8):1473–8.",
    edd:"Naegele's rule (standard obstetric dating; assumes 28-day cycle).",
    retic:"Reticulocyte production index (Hillman RS, Finch CA).",
    tsat:"Standard iron studies (serum iron ÷ TIBC).",
    phenytoin:"Sheiner LB, Tozer TN. 1978; Winter ME. Basic Clinical Pharmacokinetics.",
    mentzer:"Mentzer WC. Lancet 1973;1(7808):882."
  };
  CALCS.forEach(function(c){ c.ref=REF[c.id]||""; });

  /* ====================================================================== *
   * RENDERING — full-screen browser overlay + per-calculator panel
   * ====================================================================== */
  var CAT_ORDER = ["Cardiovascular","Critical care","Renal","Hepatology","Neurology","General"];
  var CAT_ICON = { "Cardiovascular":"🫀","Critical care":"🚨","Renal":"🫘","Hepatology":"🫁","Neurology":"🧠","General":"⚖️" };
  var root = null, q = "", activeCat = "", openId = null;

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function byId(id){ for(var i=0;i<CALCS.length;i++) if(CALCS[i].id===id) return CALCS[i]; return null; }

  function ensureRoot(){
    if(root) return root;
    injectCSS();
    root=document.createElement("div");
    root.id="mcOverlay"; root.className="mc-overlay";
    root.innerHTML=
      '<div class="mc-top">'+
        '<button class="mc-back" id="mcClose" aria-label="Close calculators">‹ Close</button>'+
        '<div class="mc-title">Clinical Calculators <span class="mc-count">'+CALCS.length+'</span></div>'+
        '<span style="width:64px"></span>'+
      '</div>'+
      '<div class="mc-body">'+
        '<input id="mcSearch" class="mc-search" type="text" placeholder="🔍 Search calculators (e.g. MELD, sepsis, sodium, stroke)…" autocomplete="off">'+
        '<div id="mcCats" class="mc-cats"></div>'+
        '<div id="mcList" class="mc-list"></div>'+
        '<div class="mc-disc">⚠️ Decision support only — verify formulas and thresholds against the individual patient and local protocol.</div>'+
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#mcClose").addEventListener("click", close);
    var si=root.querySelector("#mcSearch");
    si.addEventListener("input", function(){ q=si.value.trim().toLowerCase(); renderList(); });
    si.addEventListener("keydown", function(e){ e.stopPropagation(); });
    return root;
  }

  function renderCats(){
    var el=root.querySelector("#mcCats");
    var chips=['<button class="mc-cat'+(activeCat===""?" on":"")+'" data-cat="">All</button>'];
    CAT_ORDER.forEach(function(c){
      var n=CALCS.filter(function(x){return x.cat===c;}).length;
      chips.push('<button class="mc-cat'+(activeCat===c?" on":"")+'" data-cat="'+esc(c)+'">'+(CAT_ICON[c]||"")+" "+esc(c)+' <span>'+n+'</span></button>');
    });
    el.innerHTML=chips.join("");
    el.querySelectorAll(".mc-cat").forEach(function(b){
      b.addEventListener("click", function(){ activeCat=b.getAttribute("data-cat"); openId=null; renderCats(); renderList(); });
    });
  }

  function matches(c){
    if(activeCat && c.cat!==activeCat) return false;
    if(!q) return true;
    return (c.title+" "+c.desc+" "+c.cat+" "+c.id+" "+(c.kw||[]).join(" ")).toLowerCase().indexOf(q)>=0;
  }

  function renderList(){
    var el=root.querySelector("#mcList");
    var list=CALCS.filter(matches);
    if(!list.length){ el.innerHTML='<div class="mc-empty">No calculators match “'+esc(q)+'”.</div>'; return; }
    // group by category preserving order
    var html="";
    CAT_ORDER.forEach(function(cat){
      var inCat=list.filter(function(c){return c.cat===cat;});
      if(!inCat.length) return;
      html+='<div class="mc-grp-h">'+(CAT_ICON[cat]||"")+" "+esc(cat)+'</div><div class="mc-grid">';
      inCat.forEach(function(c){
        html+='<div class="mc-card'+(openId===c.id?" open":"")+'" data-id="'+c.id+'">'+
          '<button class="mc-card-head" data-open="'+c.id+'"><span class="mc-ic">'+(c.icon||"🧮")+'</span><span class="mc-card-main"><span class="mc-card-t">'+esc(c.title)+'</span><span class="mc-card-d">'+esc(c.desc)+'</span></span><span class="mc-chev">'+(openId===c.id?"▾":"▸")+'</span></button>'+
          (openId===c.id?'<div class="mc-panel" id="mcPanel_'+c.id+'"></div>':"")+
        '</div>';
      });
      html+='</div>';
    });
    el.innerHTML=html;
    el.querySelectorAll("[data-open]").forEach(function(b){
      b.addEventListener("click", function(){ var id=b.getAttribute("data-open"); openId=(openId===id?null:id); renderList(); });
    });
    if(openId) renderPanel(openId);
  }

  function inputHTML(c){
    return c.inputs.map(function(f){
      var fid="mc_"+c.id+"_"+f.id;
      var unit=f.unit?'<span class="mc-unit">'+esc(f.unit)+'</span>':"";
      if(f.type==="check"){
        return '<label class="mc-check"><input type="checkbox" id="'+fid+'"><span>'+esc(f.label)+'</span></label>';
      }
      if(f.type==="select"){
        var opts=(f.opts||[]).map(function(o){return '<option value="'+esc(o.v)+'">'+esc(o.t)+'</option>';}).join("");
        return '<div class="mc-field"><label class="mc-lbl" for="'+fid+'">'+esc(f.label)+'</label><select class="mc-input" id="'+fid+'">'+opts+'</select></div>';
      }
      var typ=f.type==="date"?"date":"number";
      var step=f.step?' step="'+esc(f.step)+'"':(typ==="number"?' step="any"':"");
      var def=f.def!=null?' value="'+esc(f.def)+'"':"";
      var min=f.min!=null?' min="'+esc(f.min)+'"':"";
      return '<div class="mc-field"><label class="mc-lbl" for="'+fid+'">'+esc(f.label)+unit+'</label><input class="mc-input" id="'+fid+'" type="'+typ+'"'+step+min+def+' placeholder=""></div>';
    }).join("");
  }

  function readValues(c){
    var v={};
    c.inputs.forEach(function(f){
      var el=document.getElementById("mc_"+c.id+"_"+f.id);
      if(!el) return;
      if(f.type==="check") v[f.id]=el.checked;
      else if(f.type==="select") v[f.id]=el.value;
      else if(f.type==="date") v[f.id]=el.value;
      else v[f.id]=el.value===""?NaN:parseFloat(el.value);
    });
    return v;
  }

  function renderPanel(id){
    var c=byId(id); if(!c) return;
    var el=document.getElementById("mcPanel_"+id); if(!el) return;
    el.innerHTML=
      '<div class="mc-inputs">'+inputHTML(c)+'</div>'+
      '<button class="mc-calc-btn" id="mcCalc_'+id+'">Calculate</button>'+
      '<div class="mc-result" id="mcRes_'+id+'"></div>'+
      (c.ref?'<div class="mc-ref">📚 <b>Reference:</b> '+esc(c.ref)+'</div>':"");
    function run(){
      var out; try { out=c.compute(readValues(c)); } catch(e){ out={err:"Could not compute — check the inputs."}; }
      var res=document.getElementById("mcRes_"+id);
      if(!out){ res.innerHTML=""; return; }
      if(out.err){ res.innerHTML='<div class="mc-res-err">'+esc(out.err)+'</div>'; return; }
      if(out.html){ res.innerHTML=out.html; return; }
      res.innerHTML='<div class="mc-res-box"><div class="mc-res-num">'+esc(out.v)+(out.u?' <small>'+esc(out.u)+'</small>':"")+'</div>'+(out.i?'<div class="mc-res-i">'+out.i+'</div>':"")+'</div>';
    }
    el.querySelector("#mcCalc_"+id).addEventListener("click", run);
    el.querySelectorAll(".mc-input").forEach(function(inp){
      inp.addEventListener("keydown", function(e){ e.stopPropagation(); if(e.key==="Enter") run(); });
    });
    // auto-calc on change for instant feedback
    el.querySelectorAll(".mc-input, .mc-check input").forEach(function(inp){
      inp.addEventListener("change", run);
    });
  }

  /* ---- open/close + public API ---- */
  function openList(cat){
    ensureRoot();
    activeCat = (cat && CAT_ORDER.indexOf(cat)>=0) ? cat : "";
    q=""; openId=null;
    var si=root.querySelector("#mcSearch"); if(si) si.value="";
    renderCats(); renderList();
    root.classList.add("on"); document.body.classList.add("mc-lock");
    setTimeout(function(){ try{ root.querySelector("#mcSearch").focus(); }catch(e){} }, 60);
  }
  function open(id){
    openList();
    var c=byId(id); if(!c) return;
    activeCat=""; openId=id; renderCats(); renderList();
    setTimeout(function(){ var el=document.getElementById("mcPanel_"+id); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); }, 80);
  }
  function close(){ if(root){ root.classList.remove("on"); document.body.classList.remove("mc-lock"); } }

  document.addEventListener("keydown", function(e){
    if(e.key==="Escape" && root && root.classList.contains("on")) close();
  });

  function injectCSS(){
    if(document.getElementById("mc-styles")) return;
    var css=[
      ".mc-overlay{position:fixed;inset:0;z-index:870;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}",
      ".mc-overlay.on{display:flex;animation:mcIn .25s ease}",
      "@keyframes mcIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.mc-lock{overflow:hidden}",
      ".mc-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0);z-index:3}",
      ".mc-back{background:transparent;border:1px solid var(--teal,#0a9396);color:var(--teal,#0a9396);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans,system-ui);cursor:pointer}",
      ".mc-title{flex:1;text-align:center;font:800 16px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".mc-count{font-size:11px;background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:8px;padding:1px 7px;vertical-align:middle;font-weight:800}",
      ".mc-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:1100px;margin:0 auto;width:100%;box-sizing:border-box;padding-bottom:calc(48px + env(safe-area-inset-bottom))}",
      ".mc-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 14px;font:500 14px var(--sans,system-ui);background:var(--panel,#fff);color:var(--ink,#1a1a1a);margin-bottom:11px}",
      ".mc-search:focus{outline:none;border-color:var(--teal,#0a9396)}",
      ".mc-cats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}",
      ".mc-cat{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:16px;padding:6px 12px;font:600 12px var(--sans,system-ui);color:var(--slate,#555);cursor:pointer}",
      ".mc-cat.on{background:var(--teal,#0a9396);border-color:var(--teal,#0a9396);color:#fff}",
      ".mc-cat span{opacity:.7;font-weight:700;margin-left:2px}",
      ".mc-grp-h{font:800 12px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888);margin:14px 0 8px}",
      ".mc-grid{display:grid;grid-template-columns:1fr;gap:9px}",
      "@media(min-width:720px){.mc-grid{grid-template-columns:1fr 1fr}}",
      ".mc-card{border:1px solid var(--line,#e5e5e0);border-radius:12px;background:var(--panel,#fff);overflow:hidden}",
      ".mc-card.open{border-color:var(--teal,#0a9396);grid-column:1/-1}",
      ".mc-card-head{display:flex;align-items:center;gap:11px;padding:12px 13px;cursor:pointer;width:100%;background:transparent;border:none;text-align:left}",
      ".mc-ic{font-size:20px;flex:0 0 auto}",
      ".mc-card-main{flex:1;min-width:0}",
      ".mc-card-t{display:block;font:700 13.5px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".mc-card-d{display:block;font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:2px}",
      ".mc-chev{color:var(--slate-soft,#888);font-size:13px;flex:0 0 auto}",
      ".mc-panel{padding:4px 13px 14px;border-top:1px solid var(--line,#e5e5e0)}",
      ".mc-inputs{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0}",
      "@media(min-width:560px){.mc-inputs{grid-template-columns:1fr 1fr}}",
      ".mc-field{display:flex;flex-direction:column;gap:4px}",
      ".mc-lbl{font:600 12px var(--sans,system-ui);color:var(--slate,#555)}",
      ".mc-unit{color:var(--slate-soft,#888);font-weight:500;margin-left:4px}",
      ".mc-input{border:1.5px solid var(--line,#e5e5e0);border-radius:9px;padding:9px 11px;font:500 13.5px var(--sans,system-ui);background:var(--paper,#f7f7f5);color:var(--ink,#1a1a1a);box-sizing:border-box;width:100%}",
      ".mc-input:focus{outline:none;border-color:var(--teal,#0a9396)}",
      ".mc-check{display:flex;align-items:center;gap:9px;font:600 12.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);background:var(--paper,#f7f7f5);border:1px solid var(--line,#e5e5e0);border-radius:9px;padding:9px 11px;cursor:pointer}",
      ".mc-check input{width:17px;height:17px;flex:0 0 auto}",
      ".mc-calc-btn{width:100%;border:none;border-radius:10px;padding:12px;font:800 13.5px var(--sans,system-ui);cursor:pointer;color:#fff;background:var(--teal,#0a9396);margin-top:4px}",
      ".mc-result{margin-top:12px}",
      ".mc-res-box{border:1px solid var(--teal,#0a9396);background:var(--teal-soft,#e0f2f1);border-radius:12px;padding:14px}",
      ".mc-res-num{font:800 26px var(--sans,system-ui);color:var(--teal,#0a9396)}",
      ".mc-res-num small{font-size:13px;font-weight:700;color:var(--slate,#555)}",
      ".mc-res-i{font:500 12.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.55;margin-top:7px}",
      ".mc-res-i b{color:var(--teal,#0a9396)}",
      ".mc-res-err{font:600 12.5px var(--sans,system-ui);color:var(--slate-soft,#888);padding:11px;border:1px dashed var(--line,#e5e5e0);border-radius:10px;text-align:center}",
      ".mc-empty{font:500 13px var(--sans,system-ui);color:var(--slate-soft,#888);padding:30px;text-align:center}",
      ".mc-disc{font:500 11px var(--sans,system-ui);color:var(--slate-soft,#888);background:var(--panel,#fff);border:1px dashed var(--line,#e5e5e0);border-radius:10px;padding:10px 12px;margin-top:18px;line-height:1.5}",
      ".mc-ref{font:500 11px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:12px;line-height:1.5;border-top:1px solid var(--line,#e5e5e0);padding-top:10px}",
      ".mc-ref b{color:var(--slate,#555);font-weight:700}"
    ].join("");
    var st=document.createElement("style"); st.id="mc-styles"; st.textContent=css; document.head.appendChild(st);
  }

  window.MEDCALC = { openList: openList, open: open, close: close, _calcs: CALCS };
})();
