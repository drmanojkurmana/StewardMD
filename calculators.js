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

  /* ===== ICU-flagship additions — verified published formulas (ai_drafted; clinician-verify) ===== */
  { id:"meld3", cat:"Hepatology", icon:"", title:"MELD 3.0",
    desc:"90-day mortality in chronic liver disease & transplant priority (2021; replaces MELD-Na).",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"creat", label:"Creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"inr", label:"INR", type:"number", step:"0.1" },
      { id:"na", label:"Sodium", type:"number", unit:"mEq/L", step:"1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"hd", label:"≥2 haemodialysis / 24 h CVVHD in the past week", type:"check" }
    ],
    compute:function(v){
      // Guard: never score on defaulted normals — a blank lab must NOT silently become a normal
      // value (would understate MELD / 90-day mortality / transplant priority).
      if(!ok(v.bili)||!ok(v.creat)||!ok(v.inr)||!ok(v.na)||!ok(v.alb)) return ERR;
      var bili=Math.max(1,+v.bili||1), inr=Math.max(1,+v.inr||1);
      var creat=Math.max(1,+v.creat||1); if(v.hd) creat=3.0; creat=Math.min(creat,3.0);
      var na=Math.min(137,Math.max(125,+v.na||137)), alb=Math.min(3.5,Math.max(1.5,+v.alb||3.5));
      var female=v.sex==="f"?1:0;
      var s = 1.33*female + 4.56*Math.log(bili) + 0.82*(137-na) - 0.24*(137-na)*Math.log(bili)
            + 9.09*Math.log(inr) + 11.14*Math.log(creat) + 1.85*(3.5-alb) - 1.83*(3.5-alb)*Math.log(creat) + 6;
      s = Math.round(Math.min(40, Math.max(6, s)));
      var mort = s<=9?"~1.9%":s<=19?"~6.0%":s<=29?"~19.6%":s<=39?"~52.6%":"~71.3%";
      return { v:s, u:"points", i:"Approx. 90-day mortality "+mort+". Higher = greater transplant priority (range 6–40)." };
    }
  },
  { id:"egfr_cysc", cat:"Renal", icon:"", title:"eGFR (cystatin C, CKD-EPI)",
    desc:"Race-free estimated GFR from serum cystatin C (CKD-EPI cystatin C) — useful when creatinine is confounded.",
    inputs:[
      { id:"cysc", label:"Cystatin C", type:"number", unit:"mg/L", step:"0.01" },
      { id:"age", label:"Age", type:"number", unit:"yrs", step:"1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      var sc=+v.cysc||0, age=+v.age||0;
      if(sc<=0||age<=0) return { v:"—", u:"", i:"Enter cystatin C and age." };
      var r=sc/0.8;
      var e = 133 * Math.pow(Math.min(r,1),-0.499) * Math.pow(Math.max(r,1),-1.328) * Math.pow(0.996,age) * (v.sex==="f"?0.932:1);
      e = Math.round(e);
      var stage = band(e,[[14,"G5 (failure)"],[29,"G4 (severe ↓)"],[44,"G3b (moderate–severe ↓)"],[59,"G3a (mild–moderate ↓)"],[89,"G2 (mild ↓)"],[1e9,"G1 (normal/high)"]]);
      return { v:e, u:"mL/min/1.73m²", i:"CKD stage <b>"+stage+"</b>. Race-free; helpful in low muscle mass / amputees where creatinine misleads." };
    }
  },
  { id:"burch", cat:"Endocrine", icon:"", title:"Burch-Wartofsky (thyroid storm)",
    desc:"Likelihood of thyroid storm in thyrotoxicosis (point scale).",
    inputs:[
      { id:"temp", label:"Temperature", type:"select", opts:[{v:"0",t:"<37.2 °C"},{v:"5",t:"37.2–37.7"},{v:"10",t:"37.8–38.2"},{v:"15",t:"38.3–38.8"},{v:"20",t:"38.9–39.2"},{v:"25",t:"39.3–39.9"},{v:"30",t:"≥40 °C"}] },
      { id:"cns", label:"CNS effects", type:"select", opts:[{v:"0",t:"Absent"},{v:"10",t:"Mild (agitation)"},{v:"20",t:"Moderate (delirium/psychosis/lethargy)"},{v:"30",t:"Severe (seizure/coma)"}] },
      { id:"gi", label:"GI–hepatic dysfunction", type:"select", opts:[{v:"0",t:"Absent"},{v:"10",t:"Moderate (diarrhoea/vomiting/abdo pain)"},{v:"20",t:"Severe (unexplained jaundice)"}] },
      { id:"hr", label:"Tachycardia", type:"select", opts:[{v:"0",t:"<90 bpm"},{v:"5",t:"90–109"},{v:"10",t:"110–119"},{v:"15",t:"120–129"},{v:"20",t:"130–139"},{v:"25",t:"≥140"}] },
      { id:"chf", label:"Congestive heart failure", type:"select", opts:[{v:"0",t:"Absent"},{v:"5",t:"Mild (pedal oedema)"},{v:"10",t:"Moderate (bibasal crepitations)"},{v:"15",t:"Severe (pulmonary oedema)"}] },
      { id:"af", label:"Atrial fibrillation", type:"select", opts:[{v:"0",t:"Absent"},{v:"10",t:"Present"}] },
      { id:"precip", label:"Precipitant history", type:"select", opts:[{v:"0",t:"Absent"},{v:"10",t:"Present"}] }
    ],
    compute:function(v){
      var s=(+v.temp||0)+(+v.cns||0)+(+v.gi||0)+(+v.hr||0)+(+v.chf||0)+(+v.af||0)+(+v.precip||0);
      var i = s>=45?"<b>≥45 — highly suggestive of thyroid storm</b>":s>=25?"25–44 — impending storm; treat aggressively":"<25 — thyroid storm unlikely";
      return { v:s, u:"points", i:i+"." };
    }
  },
  { id:"rumack", cat:"Toxicology", icon:"", title:"Rumack-Matthew (paracetamol)",
    desc:"Is the paracetamol (acetaminophen) level above the NAC treatment line? Single acute ingestion, 4–24 h. Uses the US 150 mg/L line; UK/MHRA uses a single 100 mg/L line (since 2012).",
    inputs:[
      { id:"t", label:"Time since ingestion", type:"number", unit:"h", step:"0.5" },
      { id:"lvl", label:"Paracetamol level", type:"number", unit:"µg/mL (=mg/L)", step:"1" }
    ],
    compute:function(v){
      // Guard: a blank level must NOT read as 0 (below the line) — that could contribute to
      // withholding N-acetylcysteine. Require both time and level.
      if(!ok(v.t)||!ok(v.lvl)) return { v:"—", u:"", i:"Enter time since ingestion and paracetamol level." };
      var t=+v.t||0, lvl=+v.lvl||0;
      if(t<4) return { v:"—", u:"", i:"Levels before 4 h are uninterpretable — repeat at 4 h post-ingestion." };
      if(t>24) return { v:"—", u:"", i:"Nomogram not validated beyond 24 h — treat with NAC if any detectable level or hepatotoxicity; seek toxicology advice." };
      var line = 150 * Math.pow(2, -(t-4)/4);   // 150 µg/mL at 4 h, t½≈4 h (US treatment line; UK/MHRA uses a single 100 mg/L line since 2012)
      var treat = lvl >= line;
      return { v:Math.round(line), u:"µg/mL (line at "+t+" h)", i: treat
        ? "<b>Level "+lvl+" ≥ line ("+line.toFixed(0)+") — ABOVE the treatment line: start N-acetylcysteine.</b>"
        : "Level "+lvl+" &lt; line ("+line.toFixed(0)+") — below the treatment line. Treat anyway if staggered/unknown-time ingestion or clinical concern." };
    }
  },
  { id:"scorten", cat:"Dermatology", icon:"", title:"SCORTEN (SJS/TEN)",
    desc:"Mortality in Stevens-Johnson syndrome / toxic epidermal necrolysis (assess at 24 h & day 3).",
    inputs:[
      { id:"age", label:"Age ≥40 years", type:"check" },
      { id:"malig", label:"Malignancy", type:"check" },
      { id:"hr", label:"Heart rate ≥120/min", type:"check" },
      { id:"bsa", label:"Epidermal detachment >10% BSA", type:"check" },
      { id:"urea", label:"Serum urea >10 mmol/L (BUN >28 mg/dL)", type:"check" },
      { id:"gluc", label:"Glucose >14 mmol/L (>252 mg/dL)", type:"check" },
      { id:"bicarb", label:"Bicarbonate <20 mmol/L", type:"check" }
    ],
    compute:function(v){
      var s=["age","malig","hr","bsa","urea","gluc","bicarb"].reduce(function(a,k){return a+(v[k]?1:0);},0);
      var mort = s<=1?"3.2%":s===2?"12.1%":s===3?"35.3%":s===4?"58.3%":"≥90%";
      return { v:s, u:"points", i:"Predicted mortality ≈ <b>"+mort+"</b>." };
    }
  },
  { id:"kings", cat:"Hepatology", icon:"", title:"King's College criteria (ALF)",
    desc:"Liver-transplant criteria in acute liver failure. Choose aetiology, tick the features present.",
    inputs:[
      { id:"aeti", label:"Aetiology", type:"select", opts:[{v:"para",t:"Paracetamol"},{v:"non",t:"Non-paracetamol"}] },
      { id:"ph", label:"[Paracetamol] Arterial pH <7.30 after resuscitation", type:"check" },
      { id:"inr65", label:"[Paracetamol] INR >6.5 (PT >100 s)", type:"check" },
      { id:"cr34", label:"[Paracetamol] Creatinine >3.4 mg/dL (>300 µmol/L)", type:"check" },
      { id:"enceph34", label:"[Paracetamol] Grade III–IV encephalopathy", type:"check" },
      { id:"ninr", label:"[Non-para] INR >6.5 (PT >100 s)", type:"check" },
      { id:"nage", label:"[Non-para] Age <10 or >40 years", type:"check" },
      { id:"naeti", label:"[Non-para] Unfavourable aetiology (non-A–E hepatitis, idiosyncratic drug/halothane)", type:"check" },
      { id:"njaun", label:"[Non-para] Jaundice→encephalopathy interval >7 days", type:"check" },
      { id:"ninr35", label:"[Non-para] INR >3.5 (PT >50 s)", type:"check" },
      { id:"nbili", label:"[Non-para] Bilirubin >17.5 mg/dL (>300 µmol/L)", type:"check" }
    ],
    compute:function(v){
      if(v.aeti==="para"){
        var met = !!v.ph || (v.inr65 && v.cr34 && v.enceph34);
        return { v: met?"Met":"Not met", u:"", i: met
          ? "<b>Meets King's College criteria — refer for emergency liver-transplant assessment.</b>"
          : "Not met (need pH <7.30, OR all of INR >6.5 + creatinine >3.4 + grade III–IV encephalopathy)." };
      }
      var n5=["nage","naeti","njaun","ninr35","nbili"].reduce(function(a,k){return a+(v[k]?1:0);},0);
      var met2 = !!v.ninr || n5>=3;
      return { v: met2?"Met":"Not met", u:"", i: met2
        ? "<b>Meets King's College criteria — refer for emergency liver-transplant assessment.</b> (INR >6.5 alone, or ≥3 of 5 minor criteria — "+n5+"/5.)"
        : "Not met (need INR >6.5 alone, or ≥3 of 5 minor criteria — currently "+n5+"/5)." };
    }
  },
  { id:"psi", cat:"Respiratory", icon:"", title:"PSI / PORT (pneumonia)",
    desc:"30-day mortality risk in community-acquired pneumonia; guides admission vs outpatient.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs", step:"1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"nh", label:"Nursing-home resident", type:"check" },
      { id:"neo", label:"Neoplastic disease", type:"check" },
      { id:"liver", label:"Liver disease", type:"check" },
      { id:"chf", label:"Congestive heart failure", type:"check" },
      { id:"cva", label:"Cerebrovascular disease", type:"check" },
      { id:"renal", label:"Renal disease", type:"check" },
      { id:"ams", label:"Altered mental status", type:"check" },
      { id:"rr", label:"Respiratory rate ≥30/min", type:"check" },
      { id:"sbp", label:"Systolic BP <90 mmHg", type:"check" },
      { id:"temp", label:"Temp <35 or ≥40 °C", type:"check" },
      { id:"pulse", label:"Pulse ≥125/min", type:"check" },
      { id:"ph", label:"Arterial pH <7.35", type:"check" },
      { id:"bun", label:"BUN ≥30 mg/dL (urea ≥11 mmol/L)", type:"check" },
      { id:"na", label:"Sodium <130 mmol/L", type:"check" },
      { id:"gluc", label:"Glucose ≥250 mg/dL (≥14 mmol/L)", type:"check" },
      { id:"hct", label:"Haematocrit <30%", type:"check" },
      { id:"hypox", label:"PaO₂ <60 mmHg or SpO₂ <90%", type:"check" },
      { id:"eff", label:"Pleural effusion", type:"check" }
    ],
    compute:function(v){
      // Guard: age is the dominant term — a blank age must NOT score as 0 (falsely "class I–II,
      // outpatient"). Require age before computing.
      if(!ok(v.age)) return ERR;
      var age=+v.age||0;
      var s = age - (v.sex==="f"?10:0)
        + (v.nh?10:0)+(v.neo?30:0)+(v.liver?20:0)+(v.chf?10:0)+(v.cva?10:0)+(v.renal?10:0)
        + (v.ams?20:0)+(v.rr?20:0)+(v.sbp?20:0)+(v.temp?15:0)+(v.pulse?10:0)
        + (v.ph?30:0)+(v.bun?20:0)+(v.na?20:0)+(v.gluc?10:0)+(v.hct?10:0)+(v.hypox?10:0)+(v.eff?10:0);
      var cls, mort, dispo;
      if(s<=70){ cls="I–II"; mort="0.6–0.9%"; dispo="outpatient"; }
      else if(s<=90){ cls="III"; mort="0.9–2.8%"; dispo="brief admission / observation"; }
      else if(s<=130){ cls="IV"; mort="8.2–9.3%"; dispo="admit"; }
      else { cls="V"; mort="27–31%"; dispo="admit; consider ICU"; }
      return { v:s, u:"points", i:"Risk class <b>"+cls+"</b> · 30-day mortality ≈ "+mort+" · "+dispo+"." };
    }
  },

  /* ----------------------------- CARDIOVASCULAR ----------------------------- */
  { id:"chadsvasc", cat:"Cardiovascular", icon:"", title:"CHA₂DS₂-VASc",
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

  { id:"hasbled", cat:"Cardiovascular", icon:"", title:"HAS-BLED bleeding risk",
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

  { id:"qtc", cat:"Cardiovascular", icon:"", title:"Corrected QT (QTc)",
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
      var flag=baz>500?"markedly prolonged — high torsades-de-pointes risk":baz>=(v.sex==="f"?480:470)?"prolonged":baz>lim?"borderline prolonged":"normal";
      return { v:r0(baz), u:"ms (Bazett)", i:"Fridericia QTc = <b>"+r0(fri)+" ms</b>. QTc is <b>"+flag+"</b> (sex threshold "+lim+" ms; torsades risk rises sharply above 500 ms). Bazett over-corrects at high rates — prefer Fridericia if HR >100." };
    } },

  { id:"map", cat:"Cardiovascular", icon:"", title:"Mean Arterial Pressure",
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

  { id:"timi_nstemi", cat:"Cardiovascular", icon:"", title:"TIMI risk (UA/NSTEMI)",
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

  { id:"wells_pe", cat:"Cardiovascular", icon:"", title:"Wells score — PE",
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

  { id:"wells_dvt", cat:"Cardiovascular", icon:"", title:"Wells score — DVT",
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

  { id:"perc", cat:"Cardiovascular", icon:"", title:"PERC rule (PE rule-out)",
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

  { id:"shock_index", cat:"Cardiovascular", icon:"", title:"Shock Index",
    desc:"Heart rate / systolic BP — occult shock marker.",
    inputs:[
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" }
    ],
    compute:function(v){
      if(!ok(v.hr)||!ok(v.sbp)||v.sbp<=0) return ERR;
      var si=v.hr/v.sbp;
      return { v:r1(si), u:"", i:(si>=0.9?"Elevated (≥0.9) — suggests haemodynamic compromise / occult hypoperfusion.":si>=0.7?"Borderline (0.7–0.9) — recheck and monitor.":"Normal (≤0.7).") };
    } },

  { id:"ldl", cat:"Cardiovascular", icon:"", title:"LDL (Friedewald)",
    desc:"Estimated LDL cholesterol.",
    inputs:[
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mg/dL", lab:"chol" },
      { id:"hdl", label:"HDL", type:"number", unit:"mg/dL", lab:"hdl" },
      { id:"tg", label:"Triglycerides", type:"number", unit:"mg/dL", lab:"tg" }
    ],
    compute:function(v){
      if(!ok(v.tc)||!ok(v.hdl)||!ok(v.tg)) return ERR;
      if(v.tg>400) return { v:"n/a", u:"", i:"Friedewald is invalid when triglycerides >400 mg/dL — measure LDL directly." };
      var ldl=v.tc-v.hdl-v.tg/5;
      return { v:r0(ldl), u:"mg/dL", i:"Estimated LDL-C. Treatment targets depend on ASCVD risk category." };
    } },

  /* ----------------------------- CRITICAL CARE ----------------------------- */
  { id:"curb65", cat:"Critical care", icon:"", title:"CURB-65 (pneumonia)",
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

  { id:"qsofa", cat:"Critical care", icon:"", title:"qSOFA",
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

  { id:"sofa", cat:"Critical care", icon:"", title:"SOFA score",
    desc:"Sequential Organ Failure Assessment (0–4 per system).",
    inputs:[
      { id:"resp", label:"Respiration (PaO₂/FiO₂)", type:"select", opts:[{v:"0",t:"≥400 (0)"},{v:"1",t:"<400 (1)"},{v:"2",t:"<300 (2)"},{v:"3",t:"<200 + support (3)"},{v:"4",t:"<100 + support (4)"}] },
      { id:"coag", label:"Coagulation (platelets ×10³)", type:"select", opts:[{v:"0",t:"≥150 (0)"},{v:"1",t:"<150 (1)"},{v:"2",t:"<100 (2)"},{v:"3",t:"<50 (3)"},{v:"4",t:"<20 (4)"}] },
      { id:"liver", label:"Liver (bilirubin mg/dL)", type:"select", opts:[{v:"0",t:"<1.2 (0)"},{v:"1",t:"1.2–1.9 (1)"},{v:"2",t:"2.0–5.9 (2)"},{v:"3",t:"6.0–11.9 (3)"},{v:"4",t:"≥12 (4)"}] },
      { id:"cardio", label:"Cardiovascular (pressor µg/kg/min)", type:"select", opts:[{v:"0",t:"MAP ≥70 (0)"},{v:"1",t:"MAP <70, no pressor (1)"},{v:"2",t:"Dopamine ≤5 or any dobutamine (2)"},{v:"3",t:"Dopamine >5, or epi ≤0.1, or norepi ≤0.1 (3)"},{v:"4",t:"Dopamine >15, or epi >0.1, or norepi >0.1 (4)"}] },
      { id:"cns", label:"CNS (GCS)", type:"select", opts:[{v:"0",t:"15 (0)"},{v:"1",t:"13–14 (1)"},{v:"2",t:"10–12 (2)"},{v:"3",t:"6–9 (3)"},{v:"4",t:"<6 (4)"}] },
      { id:"renal", label:"Renal (creatinine mg/dL)", type:"select", opts:[{v:"0",t:"<1.2 (0)"},{v:"1",t:"1.2–1.9 (1)"},{v:"2",t:"2.0–3.4 (2)"},{v:"3",t:"3.5–4.9 (3)"},{v:"4",t:"≥5.0 (4)"}] }
    ],
    compute:function(v){
      var s=Number(v.resp)+Number(v.coag)+Number(v.liver)+Number(v.cardio)+Number(v.cns)+Number(v.renal);
      var mort=band(s,[[6,"predicted hospital mortality <10%"],[9,"~15–20%"],[12,"~40–50%"],[14,"~50–60%"],[24,"~80% or higher"]]);
      return { v:s, u:"/24", i:mort+". Trend (ΔSOFA over 24–48 h) predicts outcome better than a single reading; an acute rise of ≥2 from baseline with suspected infection defines sepsis (Sepsis-3)." };
    } },

  { id:"pf_ratio", cat:"Critical care", icon:"", title:"PaO₂/FiO₂ ratio",
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

  { id:"aa_gradient", cat:"Critical care", icon:"", title:"A–a oxygen gradient",
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

  { id:"anion_gap", cat:"Critical care", icon:"", title:"Anion gap (corrected)",
    desc:"Serum anion gap with albumin correction.",
    inputs:[
      { id:"na", label:"Sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"cl", label:"Chloride", type:"number", unit:"mEq/L", lab:"cl" },
      { id:"hco3", label:"Bicarbonate", type:"number", unit:"mEq/L", lab:"hco3" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", def:"4", lab:"alb" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.cl)||!ok(v.hco3)) return ERR;
      var ag=v.na-(v.cl+v.hco3);
      var cag=ok(v.alb)?ag+2.5*(4-v.alb):ag;
      return { v:r1(ag), u:"mEq/L", i:"Albumin-corrected AG = <b>"+r1(cag)+" mEq/L</b> (normal 8–12). High AG → MUDPILES; correct for low albumin to avoid masking." };
    } },

  { id:"winters", cat:"Critical care", icon:"", title:"Winter's formula",
    desc:"Expected PaCO₂ in metabolic acidosis.",
    inputs:[
      { id:"hco3", label:"Bicarbonate", type:"number", unit:"mEq/L", lab:"hco3" },
      { id:"paco2", label:"Measured PaCO₂ (optional)", type:"number", unit:"mmHg" }
    ],
    compute:function(v){
      if(!ok(v.hco3)) return ERR;
      var exp=1.5*v.hco3+8;
      var msg="Expected PaCO₂ = <b>"+r1(exp-2)+"–"+r1(exp+2)+" mmHg</b>.";
      if(ok(v.paco2)) msg+=v.paco2>exp+2?" Measured higher → concurrent respiratory acidosis.":v.paco2<exp-2?" Measured lower → concurrent respiratory alkalosis.":" Measured within expected range → appropriate respiratory compensation.";
      return { v:r0(exp), u:"mmHg (target)", i:msg };
    } },

  { id:"osm", cat:"Critical care", icon:"", title:"Serum osmolality & gap",
    desc:"Calculated osmolality and osmolar gap.",
    inputs:[
      { id:"na", label:"Sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"glu", label:"Glucose", type:"number", unit:"mg/dL", lab:"glu" },
      { id:"bun", label:"BUN", type:"number", unit:"mg/dL", lab:"bun" },
      { id:"meas", label:"Measured osmolality (optional)", type:"number", unit:"mOsm/kg" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.glu)||!ok(v.bun)) return ERR;
      var calc=2*v.na+v.glu/18+v.bun/2.8;
      var msg="Calculated osmolality.";
      if(ok(v.meas)){var gap=v.meas-calc; msg="Osmolar gap = <b>"+r1(gap)+"</b> (normal <10). High gap → toxic alcohols (methanol, ethylene glycol), mannitol.";}
      return { v:r0(calc), u:"mOsm/kg", i:msg };
    } },

  { id:"parkland", cat:"Critical care", icon:"", title:"Parkland (burns)",
    desc:"24-hour fluid resuscitation for major burns.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"tbsa", label:"% TBSA burned", type:"number", unit:"%" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.tbsa)) return ERR;
      if(v.wt<=0||v.tbsa<0||v.tbsa>100) return { v:"—", u:"", i:"Enter a plausible weight and %TBSA (0–100)." };  // guard impossible TBSA
      var total=4*v.wt*v.tbsa;
      return { v:r0(total), u:"mL / 24 h (Ringer's lactate)", i:"Give <b>"+r0(total/2)+" mL over first 8 h</b> (from time of burn), remainder over next 16 h. Titrate to urine output 0.5–1 mL/kg/h." };
    } },

  { id:"ranson", cat:"Critical care", icon:"", title:"Ranson's criteria (admission)",
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

  { id:"gbs", cat:"Critical care", icon:"", title:"Glasgow-Blatchford (GI bleed)",
    desc:"Need for intervention in upper GI bleeding.",
    inputs:[
      { id:"bun", label:"Blood urea nitrogen (mg/dL)", type:"select", opts:[{v:"0",t:"<18.2 (0)"},{v:"2",t:"18.2–22.3 (2)"},{v:"3",t:"22.4–28 (3)"},{v:"4",t:"28–70 (4)"},{v:"6",t:">70 (6)"}] },
      { id:"hb", label:"Haemoglobin (g/dL)", type:"select", opts:[{v:"0",t:"Men ≥13 / Women ≥12 (0)"},{v:"1",t:"Men 12–13 / Women 10–12 (1)"},{v:"3",t:"Men 10–12 (3)"},{v:"6",t:"<10 (6)"}] },
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
  { id:"crcl", cat:"Renal", icon:"", title:"CrCl (Cockcroft-Gault)",
    desc:"Creatinine clearance for drug dosing.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" },
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1", lab:"creat" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}], demo:"sex" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.wt)||!ok(v.scr)||v.scr<=0) return ERR;
      if(v.age<=0||v.age>120||v.wt<=0) return { v:"—", u:"", i:"Enter a plausible age (1–120 y) and weight." };  // guard outliers → no negative CrCl
      var crcl=(140-v.age)*v.wt/(72*v.scr); if(v.sex==="f")crcl*=0.85;
      return { v:r0(crcl), u:"mL/min", i:"Use actual body weight unless obese (use adjusted). Renal dosing thresholds typically at <50, <30, <15 mL/min." };
    } },

  { id:"ckdepi", cat:"Renal", icon:"", title:"eGFR (CKD-EPI 2021)",
    desc:"Race-free creatinine eGFR.",
    inputs:[
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1", lab:"creat" },
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}], demo:"sex" }
    ],
    compute:function(v){
      if(!ok(v.scr)||!ok(v.age)||v.scr<=0) return ERR;
      var f=v.sex==="f", k=f?0.7:0.9, a=f?-0.241:-0.302;
      var egfr=142*Math.pow(Math.min(v.scr/k,1),a)*Math.pow(Math.max(v.scr/k,1),-1.200)*Math.pow(0.9938,v.age)*(f?1.012:1);
      var stage=egfr>=90?"G1 (normal/high)":egfr>=60?"G2 (mildly decreased)":egfr>=45?"G3a":egfr>=30?"G3b":egfr>=15?"G4 (severe)":"G5 (kidney failure)";
      return { v:r0(egfr), u:"mL/min/1.73m²", i:"CKD stage <b>"+stage+"</b>. 2021 equation omits the race coefficient." };
    } },

  { id:"mdrd", cat:"Renal", icon:"", title:"eGFR (MDRD, race-free)",
    desc:"4-variable MDRD eGFR.",
    inputs:[
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.1", lab:"creat" },
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}], demo:"sex" }
    ],
    compute:function(v){
      if(!ok(v.scr)||!ok(v.age)||v.scr<=0) return ERR;
      var egfr=175*Math.pow(v.scr,-1.154)*Math.pow(v.age,-0.203)*(v.sex==="f"?0.742:1);
      return { v:r0(egfr), u:"mL/min/1.73m²", i:"CKD-EPI 2021 is preferred over MDRD for accuracy, especially at higher GFR." };
    } },

  { id:"fena", cat:"Renal", icon:"", title:"FENa",
    desc:"Fractional excretion of sodium — pre-renal vs ATN.",
    inputs:[
      { id:"una", label:"Urine sodium", type:"number", unit:"mEq/L" },
      { id:"pna", label:"Plasma sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"mg/dL" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"mg/dL", lab:"creat" }
    ],
    compute:function(v){
      if(!ok(v.una)||!ok(v.pna)||!ok(v.ucr)||!ok(v.pcr)||v.pna<=0||v.ucr<=0) return ERR;
      var fe=(v.una*v.pcr)/(v.pna*v.ucr)*100;
      return { v:r1(fe), u:"%", i:(fe<1?"<1% → pre-renal (or contrast/glomerular).":fe>2?">2% → intrinsic (ATN).":"1–2% → indeterminate.")+" Unreliable on diuretics — use FEUrea instead." };
    } },

  { id:"feurea", cat:"Renal", icon:"", title:"FEUrea",
    desc:"Fractional excretion of urea (valid on diuretics).",
    inputs:[
      { id:"uurea", label:"Urine urea", type:"number", unit:"mg/dL" },
      { id:"bun", label:"Serum BUN", type:"number", unit:"mg/dL", lab:"bun" },
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"mg/dL" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"mg/dL", lab:"creat" }
    ],
    compute:function(v){
      if(!ok(v.uurea)||!ok(v.bun)||!ok(v.ucr)||!ok(v.pcr)||v.bun<=0||v.ucr<=0) return ERR;
      var fe=(v.uurea*v.pcr)/(v.bun*v.ucr)*100;
      return { v:r1(fe), u:"%", i:(fe<35?"<35% → pre-renal.":fe<=50?"35–50% → indeterminate.":">50% → intrinsic (ATN).")+" More reliable than FENa when diuretics have been given." };
    } },

  { id:"corr_na", cat:"Renal", icon:"", title:"Corrected Na (hyperglycaemia)",
    desc:"Sodium corrected for serum glucose.",
    inputs:[
      { id:"na", label:"Measured sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"glu", label:"Glucose", type:"number", unit:"mg/dL", lab:"glu" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.glu)) return ERR;
      var corr=v.na+1.6*((v.glu-100)/100);
      var katz=v.na+2.4*((v.glu-100)/100);
      return { v:r1(corr), u:"mEq/L", i:"Katz (×1.6). Hillier/Adrogué (×2.4) = <b>"+r1(katz)+" mEq/L</b>. Corrected value reflects true sodium once glucose is normalised." };
    } },

  { id:"fw_deficit", cat:"Renal", icon:"", title:"Free water deficit",
    desc:"Water deficit in hypernatraemia.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"na", label:"Current sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}], demo:"sex" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.na)) return ERR;
      var tbw=(v.sex==="f"?0.5:0.6)*v.wt;
      var def=tbw*((v.na/140)-1);
      return { v:r1(def), u:"L", i:"Replace slowly — lower serum Na by ≤10 mEq/L/24 h (cerebral oedema risk). Add ongoing losses." };
    } },

  { id:"na_deficit", cat:"Renal", icon:"", title:"Sodium deficit (hyponatraemia)",
    desc:"Na needed to reach a target.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg" },
      { id:"cur", label:"Current sodium", type:"number", unit:"mEq/L", lab:"na" },
      { id:"tgt", label:"Target sodium", type:"number", unit:"mEq/L", def:"130" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}], demo:"sex" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.cur)||!ok(v.tgt)) return ERR;
      var tbw=(v.sex==="f"?0.5:0.6)*v.wt;
      var def=tbw*(v.tgt-v.cur);
      return { v:r0(def), u:"mEq Na", i:"Correct ≤8 mEq/L per 24 h (osmotic demyelination risk). Use Adrogué-Madias to predict the rise per litre of infusate." };
    } },

  { id:"corr_ca", cat:"Renal", icon:"", title:"Corrected calcium",
    desc:"Calcium corrected for albumin.",
    inputs:[
      { id:"ca", label:"Measured calcium", type:"number", unit:"mg/dL", step:"0.1", lab:"ca" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", step:"0.1", lab:"alb" }
    ],
    compute:function(v){
      if(!ok(v.ca)||!ok(v.alb)) return ERR;
      var c=v.ca+0.8*(4-v.alb);
      return { v:r1(c), u:"mg/dL", i:(c>10.5?"Corrected calcium high — investigate hypercalcaemia.":c<8.5?"Corrected calcium low.":"Within normal range (8.5–10.5).")+" Ionised calcium is definitive if acid-base disturbed." };
    } },

  { id:"holliday", cat:"Renal", icon:"", title:"Maintenance fluids (4-2-1)",
    desc:"Holliday-Segar hourly maintenance fluid.",
    inputs:[ { id:"wt", label:"Weight", type:"number", unit:"kg" } ],
    compute:function(v){
      if(!ok(v.wt)) return ERR;
      var w=v.wt, rate;
      if(w<=10)rate=4*w; else if(w<=20)rate=40+2*(w-10); else rate=60+1*(w-20);
      return { v:r0(rate), u:"mL/hr", i:"Daily volume ≈ <b>"+r0(rate*24)+" mL/24h</b> (4 mL/kg/h first 10 kg, +2 next 10, +1 thereafter)." };
    } },

  /* ----------------------------- HEPATOLOGY ----------------------------- */
  { id:"meld", cat:"Hepatology", icon:"", title:"MELD & MELD-Na",
    desc:"End-stage liver disease 90-day mortality.",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1", lab:"bili" },
      { id:"inr", label:"INR", type:"number", step:"0.1", lab:"inr" },
      { id:"cr", label:"Creatinine", type:"number", unit:"mg/dL", step:"0.1", lab:"creat" },
      { id:"na", label:"Sodium (for MELD-Na)", type:"number", unit:"mEq/L", lab:"na" },
      { id:"dial", label:"Dialysis ≥2× in past week", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.bili)||!ok(v.inr)||!ok(v.cr)) return ERR;
      var bili=Math.max(1,v.bili), inr=Math.max(1,v.inr);
      var cr=v.dial?4:Math.max(1,Math.min(4,v.cr));
      var meld=Math.round(3.78*ln(bili)+11.2*ln(inr)+9.57*ln(cr)+6.43);
      meld=Math.max(6,Math.min(40,meld));
      var out="MELD = <b>"+meld+"</b>.", head=meld, hu="MELD";
      if(ok(v.na)){
        var na=Math.max(125,Math.min(137,v.na));
        var meldna=meld; if(meld>11) meldna=Math.round(meld+1.32*(137-na)-(0.033*meld*(137-na)));
        meldna=Math.max(6,Math.min(40,meldna));
        out="MELD-Na = <b>"+meldna+"</b> (MELD "+meld+").";
        head=meldna; hu="MELD-Na";
      }
      var mort=meld<=9?"~1.9%":meld<=19?"~6%":meld<=29?"~19.6%":meld<=39?"~52.6%":"~71.3%";
      return { v:head, u:hu, i:out+" 3-month mortality ≈ "+mort+"." };
    } },

  { id:"childpugh", cat:"Hepatology", icon:"", title:"Child-Pugh",
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

  { id:"maddrey", cat:"Hepatology", icon:"", title:"Maddrey's DF",
    desc:"Discriminant function in alcoholic hepatitis.",
    inputs:[
      { id:"pt", label:"Patient PT", type:"number", unit:"sec", lab:"pt" },
      { id:"ctrl", label:"Control PT", type:"number", unit:"sec", lab:"ptctrl" },
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1", lab:"bili" }
    ],
    compute:function(v){
      if(!ok(v.pt)||!ok(v.ctrl)||!ok(v.bili)) return ERR;
      var df=4.6*(v.pt-v.ctrl)+v.bili;
      return { v:r1(df), u:"", i:(df>=32?"≥32 — severe alcoholic hepatitis; high short-term mortality. Consider corticosteroids (assess infection, calculate Lille at day 7).":"<32 — non-severe.") };
    } },

  { id:"fib4", cat:"Hepatology", icon:"", title:"FIB-4 index",
    desc:"Non-invasive liver fibrosis estimate.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" },
      { id:"ast", label:"AST", type:"number", unit:"U/L", lab:"ast" },
      { id:"alt", label:"ALT", type:"number", unit:"U/L", lab:"alt" },
      { id:"plt", label:"Platelets", type:"number", unit:"×10⁹/L", lab:"plt" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.ast)||!ok(v.alt)||!ok(v.plt)||v.plt<=0||v.alt<=0) return ERR;
      var f=(v.age*v.ast)/(v.plt*Math.sqrt(v.alt));
      return { v:r1(f), u:"", i:(f<1.3?"<1.3 — advanced fibrosis unlikely (use 2.0 if age >65).":f<=2.67?"1.3–2.67 — indeterminate; consider elastography.":">2.67 — advanced fibrosis likely.") };
    } },

  { id:"apri", cat:"Hepatology", icon:"", title:"APRI score",
    desc:"AST-to-platelet ratio index for fibrosis.",
    inputs:[
      { id:"ast", label:"AST", type:"number", unit:"U/L", lab:"ast" },
      { id:"uln", label:"AST upper limit of normal", type:"number", unit:"U/L", def:"40" },
      { id:"plt", label:"Platelets", type:"number", unit:"×10⁹/L", lab:"plt" }
    ],
    compute:function(v){
      if(!ok(v.ast)||!ok(v.uln)||!ok(v.plt)||v.uln<=0||v.plt<=0) return ERR;
      var a=(v.ast/v.uln)/v.plt*100;
      return { v:r1(a), u:"", i:(a>1?">1.0 — significant fibrosis/cirrhosis likely.":a<0.5?"<0.5 — significant fibrosis unlikely.":"0.5–1.0 — indeterminate.") };
    } },

  /* ----------------------------- NEUROLOGY ----------------------------- */
  { id:"gcs", cat:"Neurology", icon:"", title:"Glasgow Coma Scale",
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

  { id:"nihss", cat:"Neurology", icon:"", title:"NIHSS (stroke severity)",
    desc:"NIH Stroke Scale — select the finding for each item; the score is calculated for you.",
    inputs:[
      { id:"loc", label:"1a Level of consciousness", type:"select", opts:[{v:"0",t:"Alert, keenly responsive"},{v:"1",t:"Drowsy — arousable by minor stimulation"},{v:"2",t:"Obtunded — needs repeated/painful stimulation"},{v:"3",t:"Unresponsive, or reflex responses only"}] },
      { id:"locq", label:"1b LOC questions (month, age)", type:"select", opts:[{v:"0",t:"Both answered correctly"},{v:"1",t:"One answered correctly (or intubated/dysarthric)"},{v:"2",t:"Neither correct (or aphasic/stuporous)"}] },
      { id:"locc", label:"1c LOC commands (open eyes, grip)", type:"select", opts:[{v:"0",t:"Performs both tasks correctly"},{v:"1",t:"Performs one task"},{v:"2",t:"Performs neither"}] },
      { id:"gaze", label:"2 Best gaze (horizontal)", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Partial gaze palsy (overcome by oculocephalic)"},{v:"2",t:"Forced deviation / total gaze paresis"}] },
      { id:"vis", label:"3 Visual fields", type:"select", opts:[{v:"0",t:"No visual loss"},{v:"1",t:"Partial hemianopia"},{v:"2",t:"Complete hemianopia"},{v:"3",t:"Bilateral hemianopia / cortical blindness"}] },
      { id:"face", label:"4 Facial palsy", type:"select", opts:[{v:"0",t:"Normal, symmetrical"},{v:"1",t:"Minor (flattened nasolabial fold)"},{v:"2",t:"Partial (lower face)"},{v:"3",t:"Complete (upper + lower face, one or both sides)"}] },
      { id:"larm", label:"5a Left arm motor drift", type:"select", opts:[{v:"0",t:"No drift (holds 10 s)"},{v:"1",t:"Drift, does not hit bed"},{v:"2",t:"Some effort against gravity, falls to bed"},{v:"3",t:"No effort against gravity, limb falls"},{v:"4",t:"No movement"},{v:"0",t:"Amputation / joint fusion (not scored)"}] },
      { id:"rarm", label:"5b Right arm motor drift", type:"select", opts:[{v:"0",t:"No drift (holds 10 s)"},{v:"1",t:"Drift, does not hit bed"},{v:"2",t:"Some effort against gravity, falls to bed"},{v:"3",t:"No effort against gravity, limb falls"},{v:"4",t:"No movement"},{v:"0",t:"Amputation / joint fusion (not scored)"}] },
      { id:"lleg", label:"6a Left leg motor drift", type:"select", opts:[{v:"0",t:"No drift (holds 5 s)"},{v:"1",t:"Drift, hits bed before 5 s"},{v:"2",t:"Some effort against gravity"},{v:"3",t:"No effort against gravity, falls immediately"},{v:"4",t:"No movement"},{v:"0",t:"Amputation / joint fusion (not scored)"}] },
      { id:"rleg", label:"6b Right leg motor drift", type:"select", opts:[{v:"0",t:"No drift (holds 5 s)"},{v:"1",t:"Drift, hits bed before 5 s"},{v:"2",t:"Some effort against gravity"},{v:"3",t:"No effort against gravity, falls immediately"},{v:"4",t:"No movement"},{v:"0",t:"Amputation / joint fusion (not scored)"}] },
      { id:"ataxia", label:"7 Limb ataxia", type:"select", opts:[{v:"0",t:"Absent"},{v:"1",t:"Present in one limb"},{v:"2",t:"Present in two limbs"},{v:"0",t:"Amputation / fusion / cannot test (not scored)"}] },
      { id:"sens", label:"8 Sensory", type:"select", opts:[{v:"0",t:"Normal, no sensory loss"},{v:"1",t:"Mild–moderate loss (pinprick less sharp)"},{v:"2",t:"Severe–total loss (unaware of touch)"}] },
      { id:"lang", label:"9 Best language / aphasia", type:"select", opts:[{v:"0",t:"No aphasia, normal"},{v:"1",t:"Mild–moderate aphasia"},{v:"2",t:"Severe aphasia"},{v:"3",t:"Mute / global aphasia / coma"}] },
      { id:"dys", label:"10 Dysarthria", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Mild–moderate (slurs some words)"},{v:"2",t:"Severe (unintelligible) or mute/anarthric"},{v:"0",t:"Intubated / cannot test (not scored)"}] },
      { id:"ext", label:"11 Extinction / inattention (neglect)", type:"select", opts:[{v:"0",t:"No abnormality"},{v:"1",t:"Inattention to one modality"},{v:"2",t:"Profound hemi-inattention to >1 modality"}] }
    ],
    compute:function(v){
      var keys=["loc","locq","locc","gaze","vis","face","larm","rarm","lleg","rleg","ataxia","sens","lang","dys","ext"];
      var s=0; for(var i=0;i<keys.length;i++){ s += Number(v[keys[i]])||0; }
      var sev=s===0?"no stroke symptoms":s<=4?"minor":s<=15?"moderate":s<=20?"moderate–severe":"severe";
      return { v:s, u:"/42", i:"<b>"+sev+"</b> stroke. Higher scores predict larger infarcts and worse outcome; informs thrombolysis/thrombectomy decisions. Ref: NIH Stroke Scale." };
    } },

  { id:"a2ds2", cat:"Neurology", icon:"", title:"A2DS2 (stroke-associated pneumonia)",
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

  { id:"abcd2", cat:"Neurology", icon:"", title:"ABCD² (TIA stroke risk)",
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

  { id:"ich", cat:"Neurology", icon:"", title:"ICH score",
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

  { id:"centor", cat:"Neurology", icon:"", title:"Centor / McIsaac (pharyngitis)",
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
  { id:"bmi", cat:"General", icon:"", title:"BMI · IBW · AdjBW",
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

  { id:"bsa", cat:"General", icon:"", title:"Body Surface Area",
    desc:"Mosteller & DuBois BSA.",
    inputs:[
      { id:"ht", label:"Height", type:"number", unit:"cm" },
      { id:"wt", label:"Weight", type:"number", unit:"kg" }
    ],
    compute:function(v){
      if(!ok(v.ht)||!ok(v.wt)) return ERR;
      var mos=Math.sqrt(v.ht*v.wt/3600);
      var du=0.007184*Math.pow(v.ht,0.725)*Math.pow(v.wt,0.425);
      return { v:Math.round(mos*100)/100, u:"m² (Mosteller)", i:"DuBois = <b>"+(Math.round(du*100)/100)+" m²</b>. Used for chemotherapy and cardiac-index dosing." };
    } },

  { id:"hba1c", cat:"General", icon:"", title:"HbA1c → eAG",
    desc:"Estimated average glucose from HbA1c.",
    inputs:[ { id:"a1c", label:"HbA1c", type:"number", unit:"%", step:"0.1", lab:"a1c" } ],
    compute:function(v){
      if(!ok(v.a1c)) return ERR;
      var eag=28.7*v.a1c-46.7;
      return { v:r0(eag), u:"mg/dL", i:"= "+r1((eag)/18*10)/10+" mmol/L. ADA diabetes diagnosis at HbA1c ≥6.5%; typical target <7% (individualise)." };
    } },

  { id:"edd", cat:"General", icon:"", title:"EDD (Naegele's rule)",
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

  { id:"retic", cat:"General", icon:"", title:"Corrected reticulocyte",
    desc:"Reticulocyte count adjusted for anaemia.",
    inputs:[
      { id:"retic", label:"Reticulocyte", type:"number", unit:"%", step:"0.1", lab:"retic" },
      { id:"hct", label:"Measured haematocrit", type:"number", unit:"%", lab:"hct" }
    ],
    compute:function(v){
      if(!ok(v.retic)||!ok(v.hct)) return ERR;
      var c=v.retic*(v.hct/45);
      return { v:r1(c), u:"%", i:"Corrected retic <b>"+r1(c)+"%</b>. >2% suggests adequate marrow response (haemolysis/blood loss); <2% suggests hypoproliferation." };
    } },

  { id:"tsat", cat:"General", icon:"", title:"Transferrin saturation",
    desc:"Iron status — serum iron / TIBC.",
    inputs:[
      { id:"iron", label:"Serum iron", type:"number", unit:"µg/dL", lab:"iron" },
      { id:"tibc", label:"TIBC", type:"number", unit:"µg/dL", lab:"tibc" }
    ],
    compute:function(v){
      if(!ok(v.iron)||!ok(v.tibc)||v.tibc<=0) return ERR;
      var t=v.iron/v.tibc*100;
      return { v:r0(t), u:"%", i:(t<20?"<20% — iron deficiency.":t>45?">45% — iron overload / haemochromatosis screening.":"Normal (20–45%).") };
    } },

  { id:"phenytoin", cat:"General", icon:"", title:"Corrected phenytoin",
    desc:"Albumin-corrected phenytoin level.",
    inputs:[
      { id:"level", label:"Measured phenytoin", type:"number", unit:"µg/mL", step:"0.1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/dL", step:"0.1", lab:"alb" },
      { id:"renal", label:"CrCl <20 / dialysis", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.level)||!ok(v.alb)) return ERR;
      var factor=v.renal?0.1:0.2;
      var corr=v.level/(factor*v.alb+0.1);
      return { v:r1(corr), u:"µg/mL", i:"Sheiner-Tozer corrected level (therapeutic 10–20). Uses factor "+factor+" "+(v.renal?"(renal impairment)":"(normal renal function)")+"." };
    } },

  { id:"mentzer", cat:"General", icon:"", title:"Mentzer index",
    desc:"Microcytosis — thalassaemia trait vs iron deficiency.",
    inputs:[
      { id:"mcv", label:"MCV", type:"number", unit:"fL", lab:"mcv" },
      { id:"rbc", label:"RBC count", type:"number", unit:"×10¹²/L", step:"0.1", lab:"rbc" }
    ],
    compute:function(v){
      if(!ok(v.mcv)||!ok(v.rbc)||v.rbc<=0) return ERR;
      var idx=v.mcv/v.rbc;
      return { v:r1(idx), u:"", i:(idx<13?"<13 — favours β-thalassaemia trait.":">13 — favours iron-deficiency anaemia.")+" Confirm with ferritin / Hb electrophoresis." };
    } },

  /* ----------------------------- INFECTIOUS DISEASE ----------------------------- */
  { id:"sirs", cat:"Infectious disease", icon:"", title:"SIRS criteria",
    desc:"Systemic inflammatory response syndrome — ≥2 of 4 criteria.",
    kw:["sepsis","infection","systemic","inflammatory"],
    inputs:[
      { id:"temp", label:"Temperature", type:"number", unit:"°C" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min" },
      { id:"paco2", label:"PaCO₂ (optional)", type:"number", unit:"mmHg" },
      { id:"wbc", label:"WBC", type:"number", unit:"×10⁹/L", lab:"wbc" },
      { id:"bands", label:">10% immature neutrophils (bands)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.temp)||!ok(v.hr)||!ok(v.rr)||!ok(v.wbc)) return ERR;
      var s=0;
      if(v.temp>38||v.temp<36)s++;
      if(v.hr>90)s++;
      if(v.rr>20||(ok(v.paco2)&&v.paco2<32))s++;
      if(v.wbc>12||v.wbc<4||v.bands)s++;
      return { v:s, u:"/4", i:(s>=2?"<b>SIRS positive</b> (≥2 criteria). ":"<b>SIRS not met.</b> ")+"Sensitive but non-specific — for sepsis use organ-dysfunction scores (qSOFA / SOFA). Ref: ACCP/SCCM 1992; Sepsis-3, JAMA 2016." };
    } },

  { id:"mascc", cat:"Infectious disease", icon:"", title:"MASCC febrile neutropenia",
    desc:"Identifies low-risk febrile neutropenia (candidate for oral/outpatient therapy).",
    kw:["febrile","neutropenia","cancer","chemo","risk"],
    inputs:[
      { id:"burden", label:"Burden of illness", type:"select", opts:[{v:"none",t:"None / mild symptoms (+5)"},{v:"mod",t:"Moderate symptoms (+3)"},{v:"sev",t:"Severe symptoms (0)"}] },
      { id:"hypo", label:"Hypotension (SBP <90 mmHg)", type:"check" },
      { id:"copd", label:"Active COPD", type:"check" },
      { id:"tumor", label:"Solid tumour, or no previous fungal infection", type:"check" },
      { id:"dehyd", label:"Dehydration requiring parenteral fluids", type:"check" },
      { id:"inpt", label:"Inpatient at onset of fever", type:"check" },
      { id:"age", label:"Age", type:"number", unit:"yrs" }
    ],
    compute:function(v){
      if(!v.burden||!ok(v.age)) return ERR;
      var s=0;
      s += (v.burden==="none"?5:(v.burden==="mod"?3:0));
      if(!v.hypo)s+=5;
      if(!v.copd)s+=4;
      if(v.tumor)s+=4;
      if(!v.dehyd)s+=3;
      if(!v.inpt)s+=3;
      if(v.age<60)s+=2;
      return { v:s, u:"/26", i:(s>=21?"<b>Low risk</b> (≥21) — consider oral / outpatient antibiotics per protocol.":"<b>High risk</b> (&lt;21) — IV antibiotics & admission.")+" Ref: Klastersky, MASCC, J Clin Oncol 2000; IDSA FN 2010." };
    } },

  { id:"drip", cat:"Infectious disease", icon:"", title:"DRIP score (drug-resistant pneumonia)",
    desc:"Predicts pneumonia due to drug-resistant pathogens. High risk ≥4.",
    kw:["pneumonia","resistant","mrsa","pseudomonas","hcap"],
    inputs:[
      { id:"abx", label:"Antibiotic use within 60 days (+2)", type:"check" },
      { id:"ltc", label:"Long-term care resident (+2)", type:"check" },
      { id:"tube", label:"Tube feeding (+2)", type:"check" },
      { id:"priordr", label:"Prior drug-resistant infection ≤1 yr (+2)", type:"check" },
      { id:"hosp", label:"Hospitalisation within 60 days (+1)", type:"check" },
      { id:"pulm", label:"Chronic pulmonary disease (+1)", type:"check" },
      { id:"func", label:"Poor functional status (+1)", type:"check" },
      { id:"ppi", label:"H₂-blocker / PPI within 2 weeks (+1)", type:"check" },
      { id:"wound", label:"Wound care (+1)", type:"check" },
      { id:"mrsa", label:"MRSA colonisation ≤1 yr (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0;
      if(v.abx)s+=2; if(v.ltc)s+=2; if(v.tube)s+=2; if(v.priordr)s+=2;
      if(v.hosp)s++; if(v.pulm)s++; if(v.func)s++; if(v.ppi)s++; if(v.wound)s++; if(v.mrsa)s++;
      return { v:s, u:"points", i:(s>=4?"<b>High risk</b> (≥4) of drug-resistant pathogen — consider broader empiric cover.":"<b>Low risk</b> (&lt;4) — standard CAP cover usually adequate.")+" Ref: Webb et al, Antimicrob Agents Chemother 2016." };
    } },

  /* ----------------------------- CRITICAL CARE (additions) ----------------------------- */
  { id:"news2", cat:"Critical care", icon:"", title:"NEWS2 (early warning)",
    desc:"National Early Warning Score 2 — deterioration / sepsis screening (Scale 1).",
    kw:["news","deterioration","sepsis","early warning","track trigger"],
    inputs:[
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min" },
      { id:"spo2", label:"SpO₂ (Scale 1)", type:"number", unit:"%" },
      { id:"o2", label:"On supplemental oxygen", type:"check" },
      { id:"temp", label:"Temperature", type:"number", unit:"°C" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"acvpu", label:"Consciousness", type:"select", opts:[{v:"a",t:"Alert"},{v:"x",t:"New confusion / V / P / U"}] }
    ],
    compute:function(v){
      if(!ok(v.rr)||!ok(v.spo2)||!ok(v.temp)||!ok(v.sbp)||!ok(v.hr)||!v.acvpu) return ERR;
      var s=0, mx=0;
      function add(p){ s+=p; if(p>mx)mx=p; }
      add(v.rr<=8?3:v.rr<=11?1:v.rr<=20?0:v.rr<=24?2:3);
      add(v.spo2<=91?3:v.spo2<=93?2:v.spo2<=95?1:0);
      add(v.o2?2:0);
      add(v.temp<=35?3:v.temp<=36?1:v.temp<=38?0:v.temp<=39?1:2);
      add(v.sbp<=90?3:v.sbp<=100?2:v.sbp<=110?1:v.sbp<=219?0:3);
      add(v.hr<=40?3:v.hr<=50?1:v.hr<=90?0:v.hr<=110?1:v.hr<=130?2:3);
      add(v.acvpu==="a"?0:3);
      var band = s>=7?"<b>High</b> — emergency assessment, consider critical care.":(s>=5||mx===3)?"<b>Medium</b> — urgent review (or any single parameter scoring 3).":"<b>Low</b> — routine monitoring.";
      return { v:s, u:"points", i:band+" Ref: Royal College of Physicians, NEWS2, 2017." };
    } },

  { id:"padua", cat:"Critical care", icon:"", title:"Padua VTE prediction",
    desc:"VTE risk in hospitalised medical patients. High risk ≥4 (consider prophylaxis).",
    kw:["vte","dvt","thromboprophylaxis","clot","padua"],
    inputs:[
      { id:"cancer", label:"Active cancer (+3)", type:"check" },
      { id:"prior", label:"Previous VTE (+3)", type:"check" },
      { id:"mob", label:"Reduced mobility ≥3 days (+3)", type:"check" },
      { id:"thromb", label:"Known thrombophilia (+3)", type:"check" },
      { id:"trauma", label:"Recent (≤1 mo) trauma/surgery (+2)", type:"check" },
      { id:"age70", label:"Age ≥70 (+1)", type:"check" },
      { id:"cardresp", label:"Heart and/or respiratory failure (+1)", type:"check" },
      { id:"mistroke", label:"Acute MI or ischaemic stroke (+1)", type:"check" },
      { id:"infl", label:"Acute infection / rheumatologic disorder (+1)", type:"check" },
      { id:"obese", label:"Obesity (BMI ≥30) (+1)", type:"check" },
      { id:"horm", label:"Ongoing hormonal treatment (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0;
      if(v.cancer)s+=3; if(v.prior)s+=3; if(v.mob)s+=3; if(v.thromb)s+=3;
      if(v.trauma)s+=2;
      if(v.age70)s++; if(v.cardresp)s++; if(v.mistroke)s++; if(v.infl)s++; if(v.obese)s++; if(v.horm)s++;
      return { v:s, u:"points", i:(s>=4?"<b>High risk</b> (≥4) — pharmacologic thromboprophylaxis if no contraindication.":"<b>Low risk</b> (&lt;4).")+" Ref: Barbar et al, J Thromb Haemost 2010." };
    } },

  /* ----------------------------- CARDIOVASCULAR (addition) ----------------------------- */
  { id:"heart", cat:"Cardiovascular", icon:"", title:"HEART score (chest pain)",
    desc:"Risk of major adverse cardiac event (MACE) at 6 weeks in undifferentiated chest pain.",
    kw:["chest pain","mace","acs","troponin","heart"],
    inputs:[
      { id:"hist", label:"History", type:"select", opts:[{v:"0",t:"Slightly suspicious (0)"},{v:"1",t:"Moderately suspicious (1)"},{v:"2",t:"Highly suspicious (2)"}] },
      { id:"ecg", label:"ECG", type:"select", opts:[{v:"0",t:"Normal (0)"},{v:"1",t:"Non-specific repolarisation (1)"},{v:"2",t:"Significant ST deviation (2)"}] },
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"rf", label:"Risk factors", type:"select", opts:[{v:"0",t:"None (0)"},{v:"1",t:"1–2 factors (1)"},{v:"2",t:"≥3 factors or known atherosclerosis (2)"}] },
      { id:"trop", label:"Troponin", type:"select", opts:[{v:"0",t:"≤ normal limit (0)"},{v:"1",t:"1–3× normal (1)"},{v:"2",t:"> 3× normal (2)"}] }
    ],
    compute:function(v){
      if(!v.hist||!v.ecg||!v.rf||!v.trop||!ok(v.age)) return ERR;
      var s=(+v.hist)+(+v.ecg)+(+v.rf)+(+v.trop)+(v.age>=65?2:v.age>=45?1:0);
      var band = s<=3?"<b>Low</b> (0–3): ~1.7% 6-week MACE — consider early discharge.":s<=6?"<b>Moderate</b> (4–6): ~16.6% — admit / observe.":"<b>High</b> (7–10): ~50% — early invasive strategy.";
      return { v:s, u:"/10", i:band+" Ref: Six/Backus, Neth Heart J 2008; Crit Pathw Cardiol 2013." };
    } },

  /* ----------------------------- GENERAL (additions) ----------------------------- */
  { id:"fourts", cat:"General", icon:"", title:"4Ts score (HIT)",
    desc:"Pre-test probability of heparin-induced thrombocytopenia.",
    kw:["hit","heparin","thrombocytopenia","platelet","4t"],
    inputs:[
      { id:"thrombo", label:"Thrombocytopenia", type:"select", opts:[{v:"0",t:"Fall <30% or nadir <10 (0)"},{v:"1",t:"Fall 30–50% or nadir 10–19 (1)"},{v:"2",t:"Fall >50% & nadir ≥20 (2)"}] },
      { id:"timing", label:"Timing of platelet fall", type:"select", opts:[{v:"0",t:"Fall <4 days, no recent heparin (0)"},{v:"1",t:"Consistent but unclear / onset after day 10 (1)"},{v:"2",t:"Clear onset day 5–10, or ≤1 day if heparin ≤30 d (2)"}] },
      { id:"thrombosis", label:"Thrombosis / sequelae", type:"select", opts:[{v:"0",t:"None (0)"},{v:"1",t:"Progressive/recurrent or erythematous skin (1)"},{v:"2",t:"New thrombosis, skin necrosis, anaphylaxis (2)"}] },
      { id:"other", label:"Other cause of thrombocytopenia", type:"select", opts:[{v:"0",t:"Definite (0)"},{v:"1",t:"Possible (1)"},{v:"2",t:"None apparent (2)"}] }
    ],
    compute:function(v){
      if(!v.thrombo||!v.timing||!v.thrombosis||!v.other) return ERR;
      var s=(+v.thrombo)+(+v.timing)+(+v.thrombosis)+(+v.other);
      var band = s<=3?"<b>Low</b> (0–3): HIT very unlikely (~&lt;5%).":s<=5?"<b>Intermediate</b> (4–5): ~14% — send HIT antibody, consider stopping heparin.":"<b>High</b> (6–8): ~64% — stop heparin, start non-heparin anticoagulant, test.";
      return { v:s, u:"/8", i:band+" Ref: Lo, Warkentin, J Thromb Haemost 2006." };
    } },

  { id:"lights", cat:"General", icon:"", title:"Light's criteria (pleural fluid)",
    desc:"Distinguishes pleural exudate from transudate.",
    kw:["pleural","effusion","exudate","transudate","light"],
    inputs:[
      { id:"pprot", label:"Pleural fluid protein", type:"number", unit:"g/dL" },
      { id:"sprot", label:"Serum protein", type:"number", unit:"g/dL" },
      { id:"pldh", label:"Pleural fluid LDH", type:"number", unit:"U/L" },
      { id:"sldh", label:"Serum LDH", type:"number", unit:"U/L" },
      { id:"uln", label:"Upper limit normal serum LDH", type:"number", unit:"U/L" }
    ],
    compute:function(v){
      if(!ok(v.pprot)||!ok(v.sprot)||!ok(v.pldh)||!ok(v.sldh)||!ok(v.uln)||v.sprot<=0||v.sldh<=0||v.uln<=0) return ERR;
      var pr=v.pprot/v.sprot, lr=v.pldh/v.sldh, c3=v.pldh>(2/3)*v.uln;
      var ex=(pr>0.5)||(lr>0.6)||c3;
      return { v:ex?"Exudate":"Transudate", u:"", i:"Protein ratio "+r1(pr)+" (>0.5), LDH ratio "+r1(lr)+" (>0.6), pleural LDH "+(c3?"&gt;":"≤")+" ⅔ ULN. <b>"+(ex?"Exudate":"Transudate")+"</b> — exudate if ANY criterion met. Ref: Light et al, Ann Intern Med 1972." };
    } },

  { id:"alvarado", cat:"General", icon:"", title:"Alvarado score (appendicitis)",
    desc:"Likelihood of acute appendicitis (MANTRELS).",
    kw:["appendicitis","abdominal","rlq","mantrels","alvarado"],
    inputs:[
      { id:"mig", label:"Migration of pain to RLQ (+1)", type:"check" },
      { id:"ano", label:"Anorexia (+1)", type:"check" },
      { id:"nau", label:"Nausea / vomiting (+1)", type:"check" },
      { id:"tend", label:"Tenderness in RLQ (+2)", type:"check" },
      { id:"reb", label:"Rebound tenderness (+1)", type:"check" },
      { id:"temp", label:"Temperature", type:"number", unit:"°C" },
      { id:"wbc", label:"WBC", type:"number", unit:"×10⁹/L", lab:"wbc" },
      { id:"shift", label:"Neutrophils (left shift)", type:"number", unit:"%" }
    ],
    compute:function(v){
      if(!ok(v.temp)||!ok(v.wbc)||!ok(v.shift)) return ERR;
      var s=0;
      if(v.mig)s++; if(v.ano)s++; if(v.nau)s++; if(v.tend)s+=2; if(v.reb)s++;
      if(v.temp>=37.3)s++;
      if(v.wbc>=10)s+=2;
      if(v.shift>=75)s++;
      var band = s<=4?"<b>Unlikely</b> (≤4) — appendicitis improbable.":s<=6?"<b>Possible</b> (5–6) — observe / imaging.":"<b>Probable</b> (7–10) — surgical consult.";
      return { v:s, u:"/10", i:band+" Ref: Alvarado, Ann Emerg Med 1986." };
    } },

  { id:"pitt", cat:"Infectious disease", icon:"", title:"Pitt bacteraemia score",
    desc:"Mortality risk severity in bloodstream infection.",
    kw:["bacteremia","bacteraemia","sepsis","bsi","mortality"],
    inputs:[
      { id:"temp", label:"Temperature band", type:"select", opts:[{v:"0",t:"36.1–38.9 °C (0)"},{v:"1",t:"35.1–36 or 39–39.9 °C (1)"},{v:"2",t:"≤35 or ≥40 °C (2)"}] },
      { id:"hypo", label:"Acute hypotension / pressors (+2)", type:"check" },
      { id:"vent", label:"Mechanical ventilation (+2)", type:"check" },
      { id:"arrest", label:"Cardiac arrest (+4)", type:"check" },
      { id:"mental", label:"Mental status", type:"select", opts:[{v:"0",t:"Alert (0)"},{v:"1",t:"Disoriented (1)"},{v:"2",t:"Stuporous (2)"},{v:"4",t:"Comatose (4)"}] }
    ],
    compute:function(v){
      if(!v.temp||!v.mental) return ERR;
      var s=(+v.temp)+(+v.mental);
      if(v.hypo)s+=2; if(v.vent)s+=2; if(v.arrest)s+=4;
      return { v:s, u:"points", i:(s>=4?"<b>High acuity</b> (≥4) — markedly increased mortality.":"<b>Lower acuity</b> (&lt;4).")+" Useful for risk-adjustment in bacteraemia. Ref: Paterson, Ann Intern Med 2004 (Pitt bacteraemia score)." };
    } },

  { id:"rockall", cat:"Critical care", icon:"", title:"Rockall score (UGIB)",
    desc:"Rebleeding & mortality risk after upper-GI bleed (post-endoscopy).",
    kw:["gi bleed","ugib","rebleed","endoscopy","rockall"],
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"shock", label:"Shock", type:"select", opts:[{v:"0",t:"None — SBP ≥100, HR <100 (0)"},{v:"1",t:"Tachycardia — SBP ≥100, HR ≥100 (1)"},{v:"2",t:"Hypotension — SBP <100 (2)"}] },
      { id:"comorb", label:"Comorbidity", type:"select", opts:[{v:"0",t:"None (0)"},{v:"2",t:"CHF / IHD / major (2)"},{v:"3",t:"Renal/liver failure or metastatic Ca (3)"}] },
      { id:"dx", label:"Diagnosis", type:"select", opts:[{v:"0",t:"Mallory-Weiss / no lesion (0)"},{v:"1",t:"All other diagnoses (1)"},{v:"2",t:"Upper-GI malignancy (2)"}] },
      { id:"srh", label:"Stigmata of recent haemorrhage", type:"select", opts:[{v:"0",t:"None / dark spot (0)"},{v:"2",t:"Blood, clot, visible/spurting vessel (2)"}] }
    ],
    compute:function(v){
      if(!ok(v.age)||!v.shock||!v.comorb||!v.dx||!v.srh) return ERR;
      var ap=v.age>=80?2:v.age>=60?1:0;
      var s=ap+(+v.shock)+(+v.comorb)+(+v.dx)+(+v.srh);
      var band=s<=2?"<b>Low risk</b> (0–2) — good prognosis, consider early discharge.":s<=4?"<b>Intermediate</b> (3–4).":"<b>High risk</b> (≥5) — high rebleed/mortality.";
      return { v:s, u:"/11", i:band+" (Pre-endoscopy 'clinical' Rockall = age + shock + comorbidity.) Ref: Rockall et al, Gut 1996." };
    } },

  { id:"ciwa", cat:"Neurology", icon:"", title:"CIWA-Ar (alcohol withdrawal)",
    desc:"Severity of alcohol withdrawal; guides symptom-triggered benzodiazepines.",
    kw:["alcohol","withdrawal","ciwa","detox","dts"],
    inputs:[
      { id:"nau", label:"Nausea / vomiting", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild nausea, no vomiting"},{v:"4",t:"Intermittent nausea with dry heaves"},{v:"7",t:"Constant nausea, frequent dry heaves & vomiting"}] },
      { id:"tre", label:"Tremor (arms extended)", type:"select", opts:[{v:"0",t:"No tremor"},{v:"1",t:"Not visible, felt fingertip to fingertip"},{v:"4",t:"Moderate, with arms extended"},{v:"7",t:"Severe, even with arms not extended"}] },
      { id:"swe", label:"Paroxysmal sweats", type:"select", opts:[{v:"0",t:"No sweat visible"},{v:"1",t:"Barely perceptible, palms moist"},{v:"4",t:"Beads of sweat obvious on forehead"},{v:"7",t:"Drenching sweats"}] },
      { id:"anx", label:"Anxiety", type:"select", opts:[{v:"0",t:"None, at ease"},{v:"1",t:"Mildly anxious"},{v:"4",t:"Moderately anxious or guarded"},{v:"7",t:"Acute panic state"}] },
      { id:"agi", label:"Agitation", type:"select", opts:[{v:"0",t:"Normal activity"},{v:"1",t:"Somewhat more than normal"},{v:"4",t:"Moderately fidgety and restless"},{v:"7",t:"Paces or constantly thrashes about"}] },
      { id:"tac", label:"Tactile disturbances", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Very mild itch / pins & needles / numbness"},{v:"2",t:"Mild"},{v:"3",t:"Moderate"},{v:"4",t:"Moderately severe hallucinations"},{v:"5",t:"Severe hallucinations"},{v:"6",t:"Extremely severe hallucinations"},{v:"7",t:"Continuous hallucinations"}] },
      { id:"aud", label:"Auditory disturbances", type:"select", opts:[{v:"0",t:"Not present"},{v:"1",t:"Very mild harshness / ability to frighten"},{v:"2",t:"Mild"},{v:"3",t:"Moderate"},{v:"4",t:"Moderately severe hallucinations"},{v:"5",t:"Severe hallucinations"},{v:"6",t:"Extremely severe hallucinations"},{v:"7",t:"Continuous hallucinations"}] },
      { id:"vis", label:"Visual disturbances", type:"select", opts:[{v:"0",t:"Not present"},{v:"1",t:"Very mild sensitivity"},{v:"2",t:"Mild"},{v:"3",t:"Moderate"},{v:"4",t:"Moderately severe hallucinations"},{v:"5",t:"Severe hallucinations"},{v:"6",t:"Extremely severe hallucinations"},{v:"7",t:"Continuous hallucinations"}] },
      { id:"hea", label:"Headache / fullness in head", type:"select", opts:[{v:"0",t:"Not present"},{v:"1",t:"Very mild"},{v:"2",t:"Mild"},{v:"3",t:"Moderate"},{v:"4",t:"Moderately severe"},{v:"5",t:"Severe"},{v:"6",t:"Very severe"},{v:"7",t:"Extremely severe"}] },
      { id:"ori", label:"Orientation / clouding of sensorium", type:"select", opts:[{v:"0",t:"Oriented, can do serial additions"},{v:"1",t:"Cannot do serial additions / uncertain about date"},{v:"2",t:"Disoriented for date by ≤2 calendar days"},{v:"3",t:"Disoriented for date by >2 days"},{v:"4",t:"Disoriented for place and/or person"}] }
    ],
    compute:function(v){
      var ks=["nau","tre","swe","anx","agi","tac","aud","vis","hea","ori"];
      var s=0; for(var i=0;i<ks.length;i++){ s += Number(v[ks[i]])||0; }
      var band=s<=8?"<b>Minimal / absent</b> (≤8) — usually no medication.":s<=15?"<b>Mild–moderate</b> (9–15).":s<=20?"<b>Moderate–severe</b> (16–20) — treat.":"<b>Severe</b> (&gt;20) — high risk of seizures / DTs; treat promptly.";
      return { v:s, u:"/67", i:band+" Use symptom-triggered benzodiazepine dosing per protocol; reassess hourly. Ref: Sullivan et al, Br J Addict 1989." };
    } },

  { id:"crb65", cat:"Infectious disease", icon:"", title:"CRB-65 (CAP, no labs)",
    desc:"Community-acquired pneumonia severity without urea — primary-care friendly.",
    kw:["pneumonia","cap","severity","outpatient","crb"],
    inputs:[
      { id:"conf", label:"New confusion", type:"check" },
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" },
      { id:"dbp", label:"Diastolic BP", type:"number", unit:"mmHg" },
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" }
    ],
    compute:function(v){
      if(!ok(v.rr)||!ok(v.sbp)||!ok(v.dbp)||!ok(v.age)) return ERR;
      var s=0;
      if(v.conf)s++;
      if(v.rr>=30)s++;
      if(v.sbp<90||v.dbp<=60)s++;
      if(v.age>=65)s++;
      var band=s===0?"<b>Low</b> (0) — consider home treatment.":s<=2?"<b>Intermediate</b> (1–2) — consider hospital assessment.":"<b>High</b> (3–4) — urgent admission, assess for ICU.";
      return { v:s, u:"/4", i:band+" Ref: Lim et al, Thorax 2003 (BTS)." };
    } },

  { id:"bisap", cat:"Critical care", icon:"", title:"BISAP (pancreatitis severity)",
    desc:"Early mortality risk in acute pancreatitis (first 24 h).",
    kw:["pancreatitis","bisap","severity","mortality"],
    inputs:[
      { id:"bun", label:"BUN", type:"number", unit:"mg/dL", lab:"bun" },
      { id:"ams", label:"Impaired mental status (GCS <15)", type:"check" },
      { id:"sirs", label:"SIRS (≥2 criteria)", type:"check" },
      { id:"age", label:"Age", type:"number", unit:"yrs", demo:"age" },
      { id:"eff", label:"Pleural effusion on imaging", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.bun)||!ok(v.age)) return ERR;
      var s=0;
      if(v.bun>25)s++; if(v.ams)s++; if(v.sirs)s++; if(v.age>60)s++; if(v.eff)s++;
      var band=s<=2?"<b>Lower risk</b> (0–2): mortality &lt;2%.":"<b>Higher risk</b> (≥3): mortality ~5–22% — consider HDU/ICU.";
      return { v:s, u:"/5", i:band+" Ref: Wu et al, Gut 2008 (BISAP)." };
    } },

  { id:"spesi", cat:"Cardiovascular", icon:"", title:"sPESI (PE severity)",
    desc:"Simplified Pulmonary Embolism Severity Index — 30-day risk.",
    kw:["pe","pulmonary embolism","spesi","outpatient","risk"],
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"cancer", label:"History of cancer", type:"check" },
      { id:"cardiopulm", label:"Chronic cardiopulmonary disease", type:"check" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" },
      { id:"sao2", label:"SaO₂", type:"number", unit:"%" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.hr)||!ok(v.sbp)||!ok(v.sao2)) return ERR;
      var s=0;
      if(v.age>80)s++; if(v.cancer)s++; if(v.cardiopulm)s++;
      if(v.hr>=110)s++; if(v.sbp<100)s++; if(v.sao2<90)s++;
      var band=s===0?"<b>Low risk</b> (0): ~1% 30-day mortality — consider outpatient management.":"<b>High risk</b> (≥1): ~10.9% 30-day mortality.";
      return { v:s, u:"points", i:band+" Ref: Jiménez et al, Arch Intern Med 2010." };
    } },

  { id:"killip", cat:"Cardiovascular", icon:"", title:"Killip classification",
    desc:"Heart-failure severity in acute coronary syndrome.",
    kw:["killip","acs","mi","heart failure","class"],
    inputs:[
      { id:"cls", label:"Clinical findings", type:"select", opts:[
        {v:"1",t:"I — no clinical heart failure"},
        {v:"2",t:"II — rales / S₃ / raised JVP"},
        {v:"3",t:"III — frank pulmonary oedema"},
        {v:"4",t:"IV — cardiogenic shock"} ] }
    ],
    compute:function(v){
      if(!v.cls) return ERR;
      var mort={1:"~6%",2:"~17%",3:"~38%",4:"~81%"}[v.cls];
      return { v:"Class "+({1:"I",2:"II",3:"III",4:"IV"}[v.cls]), u:"", i:"Approx. historical in-hospital mortality "+mort+" (lower with modern reperfusion). Higher class → worse prognosis. Ref: Killip & Kimball, Am J Cardiol 1967." };
    } },

  { id:"decaf", cat:"General", icon:"", title:"DECAF (COPD exacerbation)",
    desc:"In-hospital mortality in acute COPD exacerbation.",
    kw:["copd","aecopd","decaf","exacerbation","mortality"],
    inputs:[
      { id:"dys", label:"Dyspnoea (eMRCD)", type:"select", opts:[
        {v:"0",t:"Not too breathless to leave house (0)"},
        {v:"1",t:"5a — too breathless, independent washing/dressing (1)"},
        {v:"2",t:"5b — too breathless, needs help (2)"} ] },
      { id:"eos", label:"Eosinopenia (<0.05 ×10⁹/L)", type:"check" },
      { id:"cons", label:"Consolidation on CXR", type:"check" },
      { id:"acid", label:"Acidaemia (pH <7.30)", type:"check" },
      { id:"af", label:"Atrial fibrillation", type:"check" }
    ],
    compute:function(v){
      if(!v.dys) return ERR;
      var s=(+v.dys);
      if(v.eos)s++; if(v.cons)s++; if(v.acid)s++; if(v.af)s++;
      var band=s<=1?"<b>Low risk</b> (0–1): mortality ~1–4%.":s===2?"<b>Intermediate</b> (2): ~8–14%.":"<b>High risk</b> (3–6): ~24–70% — consider escalation / ceiling-of-care discussion.";
      return { v:s, u:"/6", i:band+" Ref: Steer et al, Thorax 2012 (DECAF)." };
    } },

  { id:"phq9", cat:"General", icon:"", title:"PHQ-9 (depression)",
    desc:"Depression severity. Over the last 2 weeks, how often bothered by each problem?",
    kw:["phq","depression","mood","screen","mental health"],
    inputs:[
      { id:"q1", label:"Little interest or pleasure in doing things", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q2", label:"Feeling down, depressed or hopeless", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q3", label:"Trouble falling/staying asleep, or sleeping too much", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q4", label:"Feeling tired or having little energy", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q5", label:"Poor appetite or overeating", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q6", label:"Feeling bad about yourself / a failure", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q7", label:"Trouble concentrating", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q8", label:"Moving/speaking slowly, or being restless/fidgety", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q9", label:"Thoughts of being better off dead or self-harm", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] }
    ],
    compute:function(v){
      var ks=["q1","q2","q3","q4","q5","q6","q7","q8","q9"];
      var s=0; for(var j=0;j<ks.length;j++){ s += Number(v[ks[j]])||0; }
      var band=s<=4?"Minimal (0–4).":s<=9?"Mild (5–9).":s<=14?"Moderate (10–14).":s<=19?"Moderately severe (15–19).":"Severe (20–27).";
      var flag=(Number(v.q9)>=1)?" ⚠ Item 9 positive — assess suicide risk.":""; // @emoji-ok clinical safety flag in PHQ-9 result
      return { v:s, u:"/27", i:"<b>"+band+"</b>"+flag+" ≥10 has good sensitivity/specificity for major depression. Ref: Kroenke, J Gen Intern Med 2001." };
    } },

  { id:"gad7", cat:"General", icon:"", title:"GAD-7 (anxiety)",
    desc:"Generalised anxiety severity. Over the last 2 weeks, how often bothered by each problem?",
    kw:["gad","anxiety","screen","mental health"],
    inputs:[
      { id:"q1", label:"Feeling nervous, anxious or on edge", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q2", label:"Not being able to stop or control worrying", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q3", label:"Worrying too much about different things", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q4", label:"Trouble relaxing", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q5", label:"Being so restless it is hard to sit still", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q6", label:"Becoming easily annoyed or irritable", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q7", label:"Feeling afraid as if something awful might happen", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] }
    ],
    compute:function(v){
      var ks=["q1","q2","q3","q4","q5","q6","q7"];
      var s=0; for(var j=0;j<ks.length;j++){ s += Number(v[ks[j]])||0; }
      var band=s<=4?"Minimal (0–4).":s<=9?"Mild (5–9).":s<=14?"Moderate (10–14).":"Severe (15–21).";
      return { v:s, u:"/21", i:"<b>"+band+"</b> ≥10 warrants further assessment / treatment. Ref: Spitzer, Arch Intern Med 2006." };
    } },

  { id:"auditc", cat:"General", icon:"", title:"AUDIT-C (alcohol)",
    desc:"Brief alcohol-use screen (3 items).",
    kw:["audit","alcohol","screen","drinking"],
    inputs:[
      { id:"freq", label:"How often do you drink?", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"≤Monthly (1)"},{v:"2",t:"2–4 / month (2)"},{v:"3",t:"2–3 / week (3)"},{v:"4",t:"≥4 / week (4)"}] },
      { id:"qty", label:"Drinks on a typical drinking day", type:"select", opts:[{v:"0",t:"1–2 (0)"},{v:"1",t:"3–4 (1)"},{v:"2",t:"5–6 (2)"},{v:"3",t:"7–9 (3)"},{v:"4",t:"≥10 (4)"}] },
      { id:"binge", label:"How often ≥6 drinks on one occasion?", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"<Monthly (1)"},{v:"2",t:"Monthly (2)"},{v:"3",t:"Weekly (3)"},{v:"4",t:"Daily / almost (4)"}] },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] }
    ],
    compute:function(v){
      if(!v.freq||!v.qty||!v.binge||!v.sex) return ERR;
      var s=(+v.freq)+(+v.qty)+(+v.binge);
      var thr=v.sex==="f"?3:4;
      return { v:s, u:"/12", i:(s>=thr?"<b>Positive</b> (≥"+thr+" for "+(v.sex==="f"?"women":"men")+") — likely hazardous use; assess further.":"<b>Negative</b> (&lt;"+thr+").")+" Ref: Bush, Arch Intern Med 1998." };
    } },

  { id:"rox", cat:"Critical care", icon:"", title:"ROX index (HFNC)",
    desc:"Predicts high-flow nasal cannula success. ROX = (SpO₂/FiO₂)/RR.",
    kw:["rox","hfnc","high flow","oxygen","niv","respiratory"],
    inputs:[
      { id:"spo2", label:"SpO₂", type:"number", unit:"%" },
      { id:"fio2", label:"FiO₂", type:"number", unit:"%" },
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min" }
    ],
    compute:function(v){
      if(!ok(v.spo2)||!ok(v.fio2)||!ok(v.rr)||v.fio2<=0||v.rr<=0) return ERR;
      var rox=(v.spo2/v.fio2*100)/v.rr; // FiO2 entered as %
      rox=r1(rox);
      var band=rox>=4.88?"<b>≥4.88</b> — lower risk of HFNC failure (esp. at 2–12 h).":"<b>&lt;4.88</b> — higher risk of HFNC failure; reassess, consider escalation.";
      return { v:rox, u:"", i:band+" Validate at 2, 6 and 12 h. Ref: Roca et al, Am J Respir Crit Care Med 2019." };
    } },

  { id:"uag", cat:"Renal", icon:"", title:"Urine anion gap",
    desc:"Assesses urinary NH₄⁺ excretion in normal-anion-gap metabolic acidosis.",
    kw:["urine anion gap","rta","nagma","ammonium","acidosis"],
    inputs:[
      { id:"una", label:"Urine Na", type:"number", unit:"mEq/L" },
      { id:"uk", label:"Urine K", type:"number", unit:"mEq/L" },
      { id:"ucl", label:"Urine Cl", type:"number", unit:"mEq/L" }
    ],
    compute:function(v){
      if(!ok(v.una)||!ok(v.uk)||!ok(v.ucl)) return ERR;
      var uag=r1(v.una+v.uk-v.ucl);
      var i = uag<0 ? "<b>Negative</b> — appropriate ↑NH₄⁺ excretion; suggests GI bicarbonate loss (e.g. diarrhoea)." : "<b>Positive / zero</b> — impaired NH₄⁺ excretion; suggests renal tubular acidosis (distal RTA).";
      return { v:uag, u:"mEq/L", i:i+" Interpret only in hyperchloraemic (normal-AG) metabolic acidosis. Ref: Goldstein, Am J Nephrol 1986." };
    } },

  { id:"timistemi", cat:"Cardiovascular", icon:"", title:"TIMI risk (STEMI)",
    desc:"30-day mortality risk in ST-elevation MI.",
    kw:["timi","stemi","mi","mortality","acs"],
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs" },
      { id:"risk", label:"DM or HTN or angina history (+1)", type:"check" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"killip", label:"Killip II–IV (+2)", type:"check" },
      { id:"wt", label:"Weight <67 kg (+1)", type:"check" },
      { id:"ant", label:"Anterior STEMI or LBBB (+1)", type:"check" },
      { id:"time", label:"Time to treatment >4 h (+1)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.sbp)||!ok(v.hr)) return ERR;
      var s=0;
      s += v.age>=75?3:(v.age>=65?2:0);
      if(v.risk)s++;
      if(v.sbp<100)s+=3;
      if(v.hr>100)s+=2;
      if(v.killip)s+=2;
      if(v.wt)s++;
      if(v.ant)s++;
      if(v.time)s++;
      var band=s<=3?"Lower risk":s<=6?"Intermediate":"High risk";
      return { v:s, u:"/14", i:"<b>"+band+"</b> — 30-day mortality rises steeply with score (≈0.8% at 0 to >35% at ≥8). Ref: Morrow, Circulation 2000." };
    } },

  { id:"geneva", cat:"Cardiovascular", icon:"", title:"Geneva score (revised, PE)",
    desc:"Clinical pre-test probability of pulmonary embolism.",
    kw:["geneva","pe","pulmonary embolism","pretest","probability"],
    inputs:[
      { id:"age", label:"Age >65 (+1)", type:"check" },
      { id:"prev", label:"Previous DVT / PE (+3)", type:"check" },
      { id:"surg", label:"Surgery or fracture ≤1 month (+2)", type:"check" },
      { id:"malig", label:"Active malignancy (+2)", type:"check" },
      { id:"pain", label:"Unilateral lower-limb pain (+3)", type:"check" },
      { id:"hemo", label:"Haemoptysis (+2)", type:"check" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm" },
      { id:"palp", label:"Pain on leg palpation + unilateral oedema (+4)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.hr)) return ERR;
      var s=0;
      if(v.age)s++; if(v.prev)s+=3; if(v.surg)s+=2; if(v.malig)s+=2;
      if(v.pain)s+=3; if(v.hemo)s+=2; if(v.palp)s+=4;
      s += v.hr>=95?5:(v.hr>=75?3:0);
      var band=s<=3?"<b>Low</b> probability (0–3)":s<=10?"<b>Intermediate</b> (4–10)":"<b>High</b> probability (≥11)";
      return { v:s, u:"points", i:band+". Combine with D-dimer / imaging per pathway. Ref: Le Gal, Ann Intern Med 2006 (revised Geneva)." };
    } },

  /* ===== MDCalc-parity expansion — batch 1 (ai_drafted; clinician-verify) ===== */

  { id:"rcri", cat:"Cardiovascular", icon:"", title:"Revised Cardiac Risk Index (RCRI / Lee)",
    desc:"Peri-operative risk of major cardiac events in non-cardiac surgery.",
    inputs:[
      { id:"surg", label:"High-risk surgery (intraperitoneal, intrathoracic or suprainguinal vascular)", type:"check" },
      { id:"ihd", label:"History of ischaemic heart disease", type:"check" },
      { id:"chf", label:"History of congestive heart failure", type:"check" },
      { id:"cva", label:"History of cerebrovascular disease (stroke/TIA)", type:"check" },
      { id:"dm", label:"Insulin-treated diabetes mellitus", type:"check" },
      { id:"cr", label:"Preoperative creatinine >177 µmol/L (>2.0 mg/dL)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.surg)s++; if(v.ihd)s++; if(v.chf)s++; if(v.cva)s++; if(v.dm)s++; if(v.cr)s++;
      var risk = s===0?"~3.9%":s===1?"~6.0%":s===2?"~10.1%":"~15%";
      return { v:s, u:"predictors", i:"Estimated risk of major cardiac event "+risk+" (0, 1, 2, ≥3 predictors). Ref: Lee, Circulation 1999." };
    } },

  { id:"ottawa_ankle", cat:"Musculoskeletal", icon:"", title:"Ottawa Ankle & Foot Rules",
    desc:"Whether ankle/foot radiographs are needed after acute injury (adults).",
    inputs:[
      { id:"mall_pain", label:"Pain in the malleolar zone", type:"check" },
      { id:"lat", label:"Bone tenderness — posterior edge/tip of lateral malleolus", type:"check" },
      { id:"med", label:"Bone tenderness — posterior edge/tip of medial malleolus", type:"check" },
      { id:"mid_pain", label:"Pain in the midfoot zone", type:"check" },
      { id:"mt5", label:"Bone tenderness — base of 5th metatarsal", type:"check" },
      { id:"navic", label:"Bone tenderness — navicular", type:"check" },
      { id:"noweight", label:"Unable to bear weight 4 steps (both immediately and in ED)", type:"check" }
    ],
    compute:function(v){
      var ankle = v.mall_pain && (v.lat||v.med||v.noweight);
      var foot  = v.mid_pain && (v.mt5||v.navic||v.noweight);
      var out = ankle&&foot ? "Ankle AND foot X-ray series indicated"
              : ankle ? "Ankle X-ray series indicated"
              : foot ? "Foot X-ray series indicated"
              : "No X-ray required by the rule";
      return { v:out, i:"Near-100% sensitive for clinically significant fractures; use to reduce unnecessary imaging. Ref: Stiell, JAMA 1993/1994." };
    } },

  { id:"ottawa_knee", cat:"Musculoskeletal", icon:"", title:"Ottawa Knee Rule",
    desc:"Whether a knee radiograph is needed after acute injury (adults).",
    inputs:[
      { id:"age55", label:"Age ≥55 years", type:"check" },
      { id:"fib", label:"Tenderness at the head of the fibula", type:"check" },
      { id:"pat", label:"Isolated tenderness of the patella", type:"check" },
      { id:"flex", label:"Unable to flex the knee to 90°", type:"check" },
      { id:"noweight", label:"Unable to bear weight 4 steps (both immediately and in ED)", type:"check" }
    ],
    compute:function(v){
      var pos = v.age55||v.fib||v.pat||v.flex||v.noweight;
      return { v: pos?"Knee X-ray indicated":"No X-ray required by the rule", i:"Any positive criterion indicates radiography; highly sensitive for fracture. Ref: Stiell, Ann Emerg Med 1995." };
    } },

  { id:"nexus_cspine", cat:"Neurology", icon:"", title:"NEXUS C-Spine Criteria",
    desc:"Whether cervical-spine imaging can be safely avoided after blunt trauma.",
    inputs:[
      { id:"midline", label:"Posterior midline cervical tenderness", type:"check" },
      { id:"deficit", label:"Focal neurological deficit", type:"check" },
      { id:"alert", label:"Altered level of alertness", type:"check" },
      { id:"intox", label:"Evidence of intoxication", type:"check" },
      { id:"distract", label:"Distracting painful injury", type:"check" }
    ],
    compute:function(v){
      var anyPos = v.midline||v.deficit||v.alert||v.intox||v.distract;
      return { v: anyPos?"Imaging indicated":"No imaging — can clear clinically", i: anyPos?"One or more criteria present — image the cervical spine.":"All five low-risk criteria absent — cervical spine can be cleared clinically. Ref: Hoffman, NEJM 2000." };
    } },

  { id:"canadian_ct_head", cat:"Neurology", icon:"", title:"Canadian CT Head Rule",
    desc:"Need for CT after minor head injury (GCS 13–15 with witnessed LOC, amnesia or confusion).",
    inputs:[
      { id:"gcs2h", label:"GCS <15 at 2 hours after injury", type:"check" },
      { id:"openfx", label:"Suspected open or depressed skull fracture", type:"check" },
      { id:"basalfx", label:"Any sign of basal skull fracture", type:"check" },
      { id:"vomit", label:"≥2 episodes of vomiting", type:"check" },
      { id:"age65", label:"Age ≥65 years", type:"check" },
      { id:"amnesia", label:"Retrograde amnesia ≥30 minutes", type:"check" },
      { id:"mechanism", label:"Dangerous mechanism (pedestrian, ejection, fall >3 ft/5 stairs)", type:"check" }
    ],
    compute:function(v){
      var high = v.gcs2h||v.openfx||v.basalfx||v.vomit||v.age65;
      var med = v.amnesia||v.mechanism;
      var ct = high||med;
      return { v: ct?"CT head indicated":"CT not required by the rule", i: (high?"High-risk criterion present. ":(med?"Medium-risk criterion present. ":""))+"Applies only to minor head injury (GCS 13–15). Ref: Stiell, Lancet 2001." };
    } },

  { id:"bishop", cat:"Obstetrics", icon:"", title:"Bishop Score",
    desc:"Cervical favourability for induction of labour.",
    inputs:[
      { id:"dil", label:"Cervical dilation", type:"select", opts:[{v:"0",t:"Closed"},{v:"1",t:"1–2 cm"},{v:"2",t:"3–4 cm"},{v:"3",t:"≥5 cm"}] },
      { id:"eff", label:"Effacement", type:"select", opts:[{v:"0",t:"0–30%"},{v:"1",t:"40–50%"},{v:"2",t:"60–70%"},{v:"3",t:"≥80%"}] },
      { id:"sta", label:"Fetal station", type:"select", opts:[{v:"0",t:"−3"},{v:"1",t:"−2"},{v:"2",t:"−1 / 0"},{v:"3",t:"+1 / +2"}] },
      { id:"con", label:"Cervical consistency", type:"select", opts:[{v:"0",t:"Firm"},{v:"1",t:"Medium"},{v:"2",t:"Soft"}] },
      { id:"pos", label:"Cervical position", type:"select", opts:[{v:"0",t:"Posterior"},{v:"1",t:"Mid"},{v:"2",t:"Anterior"}] }
    ],
    compute:function(v){
      var s = (Number(v.dil)||0)+(Number(v.eff)||0)+(Number(v.sta)||0)+(Number(v.con)||0)+(Number(v.pos)||0);
      var band = s>=8?"Favourable cervix — high likelihood of successful induction":s>=5?"Intermediate favourability":"Unfavourable cervix — consider cervical ripening";
      return { v:s, u:"points", i:band+" (range 0–13). Ref: Bishop, Obstet Gynecol 1964." };
    } },

  { id:"apgar", cat:"Obstetrics", icon:"", title:"APGAR Score",
    desc:"Rapid assessment of newborn status at 1 and 5 minutes.",
    inputs:[
      { id:"col", label:"Appearance (colour)", type:"select", opts:[{v:"0",t:"Blue/pale all over"},{v:"1",t:"Body pink, extremities blue"},{v:"2",t:"Pink all over"}] },
      { id:"hr", label:"Pulse (heart rate)", type:"select", opts:[{v:"0",t:"Absent"},{v:"1",t:"<100/min"},{v:"2",t:"≥100/min"}] },
      { id:"gri", label:"Grimace (reflex irritability)", type:"select", opts:[{v:"0",t:"No response"},{v:"1",t:"Grimace"},{v:"2",t:"Cry / cough / sneeze"}] },
      { id:"act", label:"Activity (muscle tone)", type:"select", opts:[{v:"0",t:"Limp"},{v:"1",t:"Some flexion"},{v:"2",t:"Active motion"}] },
      { id:"res", label:"Respiration", type:"select", opts:[{v:"0",t:"Absent"},{v:"1",t:"Slow / irregular"},{v:"2",t:"Good / crying"}] }
    ],
    compute:function(v){
      var s = (Number(v.col)||0)+(Number(v.hr)||0)+(Number(v.gri)||0)+(Number(v.act)||0)+(Number(v.res)||0);
      var band = s>=7?"Reassuring":s>=4?"Moderately abnormal — may need intervention":"Low — resuscitation usually required";
      return { v:s, u:"/10", i:band+". A low or falling score guides resuscitation; it does not by itself define asphyxia. Ref: Apgar, 1953." };
    } },

  { id:"westley_croup", cat:"Paediatrics", icon:"", title:"Westley Croup Score",
    desc:"Severity of croup (laryngotracheobronchitis).",
    inputs:[
      { id:"loc", label:"Level of consciousness", type:"select", opts:[{v:"0",t:"Normal"},{v:"5",t:"Disoriented / altered"}] },
      { id:"cya", label:"Cyanosis", type:"select", opts:[{v:"0",t:"None"},{v:"4",t:"With agitation"},{v:"5",t:"At rest"}] },
      { id:"str", label:"Stridor", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"With agitation"},{v:"2",t:"At rest"}] },
      { id:"air", label:"Air entry", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Decreased"},{v:"2",t:"Markedly decreased"}] },
      { id:"ret", label:"Retractions", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] }
    ],
    compute:function(v){
      var s = (Number(v.loc)||0)+(Number(v.cya)||0)+(Number(v.str)||0)+(Number(v.air)||0)+(Number(v.ret)||0);
      var band = s<=2?"Mild":s<=5?"Moderate":s<=11?"Severe":"Impending respiratory failure";
      return { v:s, u:"points", i:band+" croup (range 0–17). Ref: Westley, Am J Dis Child 1978." };
    } },

  { id:"mrs", cat:"Neurology", icon:"", title:"Modified Rankin Scale (mRS)",
    desc:"Global disability/dependence after stroke.",
    inputs:[
      { id:"g", label:"Functional status", type:"select", opts:[
        {v:"0",t:"0 — No symptoms"},
        {v:"1",t:"1 — No significant disability despite symptoms"},
        {v:"2",t:"2 — Slight disability; independent"},
        {v:"3",t:"3 — Moderate disability; needs some help, walks unaided"},
        {v:"4",t:"4 — Moderately severe; unable to walk/attend needs unassisted"},
        {v:"5",t:"5 — Severe disability; bedridden, incontinent"},
        {v:"6",t:"6 — Dead"} ] }
    ],
    compute:function(v){
      var g = Number(v.g)||0;
      var txt = ["No symptoms","No significant disability","Slight disability (independent)","Moderate disability","Moderately severe disability","Severe disability","Dead"][g];
      return { v:g, u:"(0–6)", i:txt+". mRS 0–2 is commonly used as a favourable outcome after stroke." };
    } },

  { id:"hunt_hess", cat:"Neurology", icon:"", title:"Hunt & Hess Grade (SAH)",
    desc:"Clinical severity and surgical risk in aneurysmal subarachnoid haemorrhage.",
    inputs:[
      { id:"g", label:"Clinical grade", type:"select", opts:[
        {v:"1",t:"I — Asymptomatic or mild headache"},
        {v:"2",t:"II — Moderate–severe headache, nuchal rigidity, no deficit (± cranial nerve palsy)"},
        {v:"3",t:"III — Drowsiness/confusion or mild focal deficit"},
        {v:"4",t:"IV — Stupor, moderate–severe hemiparesis"},
        {v:"5",t:"V — Coma, decerebrate posturing"} ] }
    ],
    compute:function(v){
      var g = Number(v.g)||1;
      var mort = ["","~1–5%","~5–10%","~15–20%","~30–40%","~50–80%"][g];
      return { v:g, u:"(I–V)", i:"Higher grade indicates worse clinical state and prognosis; approximate mortality "+mort+". Ref: Hunt & Hess, J Neurosurg 1968." };
    } },

  { id:"cage", cat:"Psychiatry", icon:"", title:"CAGE Questionnaire",
    desc:"Screening for problem alcohol use.",
    inputs:[
      { id:"cut", label:"Felt you should Cut down on drinking", type:"check" },
      { id:"ann", label:"Annoyed by people criticising your drinking", type:"check" },
      { id:"gui", label:"Felt Guilty about drinking", type:"check" },
      { id:"eye", label:"Eye-opener: drink first thing in the morning", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.cut)s++; if(v.ann)s++; if(v.gui)s++; if(v.eye)s++;
      return { v:s, u:"/4", i:(s>=2?"≥2 is clinically significant — suggests problem drinking; assess further":"Below the usual threshold of 2")+". Screening only. Ref: Ewing, JAMA 1984." };
    } },

  { id:"feverpain", cat:"Infectious disease", icon:"", title:"FeverPAIN Score",
    desc:"Likelihood of streptococcal sore throat to guide antibiotic use.",
    inputs:[
      { id:"fev", label:"Fever in the past 24 hours", type:"check" },
      { id:"pus", label:"Purulence (pus on tonsils)", type:"check" },
      { id:"att", label:"Attend rapidly — symptom onset ≤3 days", type:"check" },
      { id:"inf", label:"Severely Inflamed tonsils", type:"check" },
      { id:"noc", label:"No cough or coryza", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.fev)s++; if(v.pus)s++; if(v.att)s++; if(v.inf)s++; if(v.noc)s++;
      var band = s<=1?"Low (~13–18% streptococcus) — antibiotics not usually needed":s<=3?"Moderate (~34–40%) — consider delayed prescription":"High (~62–65%) — consider antibiotics";
      return { v:s, u:"/5", i:band+". Ref: Little, BMJ Open 2013 / NICE." };
    } },

  /* ===== MDCalc-parity expansion — batch 2 (ai_drafted; clinician-verify) ===== */

  { id:"sgarbossa", cat:"Cardiovascular", icon:"", title:"Sgarbossa Criteria (MI in LBBB/paced)",
    desc:"Identifies acute MI in the presence of left bundle branch block or ventricular pacing.",
    inputs:[
      { id:"conc_ste", label:"Concordant ST elevation ≥1 mm in ≥1 lead", type:"check" },
      { id:"conc_std", label:"Concordant ST depression ≥1 mm in V1–V3", type:"check" },
      { id:"disc_ste", label:"Discordant ST elevation ≥5 mm", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.conc_ste)s+=5; if(v.conc_std)s+=3; if(v.disc_ste)s+=2;
      return { v:s, u:"points", i:(s>=3?"≥3 is specific for acute MI in LBBB/paced rhythm":"Below 3 — not specific; consider the modified Sgarbossa (proportional) criteria and clinical context")+". Ref: Sgarbossa, NEJM 1996." };
    } },

  { id:"fisher", cat:"Neurology", icon:"", title:"Fisher Grade (SAH on CT)",
    desc:"Amount/pattern of subarachnoid blood on CT; relates to vasospasm risk.",
    inputs:[
      { id:"g", label:"CT appearance", type:"select", opts:[
        {v:"1",t:"1 — No subarachnoid blood detected"},
        {v:"2",t:"2 — Diffuse or thin layer (<1 mm)"},
        {v:"3",t:"3 — Localised clot or thick layer (≥1 mm)"},
        {v:"4",t:"4 — Intracerebral or intraventricular blood with diffuse/absent SAH"} ] }
    ],
    compute:function(v){
      var g=Number(v.g)||1;
      var vs = g===3?"highest":g===4?"variable":"lower";
      return { v:g, u:"(1–4)", i:"Grade "+g+"; symptomatic vasospasm risk is "+vs+" (classically greatest with grade 3 thick clot). Ref: Fisher, Neurosurgery 1980." };
    } },

  { id:"steroid_conv", cat:"Endocrine", icon:"", title:"Corticosteroid Conversion",
    desc:"Glucocorticoid dose equivalence (anti-inflammatory potency).",
    inputs:[
      { id:"drug", label:"Current glucocorticoid", type:"select", opts:[
        {v:"20",t:"Hydrocortisone"},{v:"25",t:"Cortisone"},{v:"5",t:"Prednisolone"},{v:"5p",t:"Prednisone"},
        {v:"4",t:"Methylprednisolone"},{v:"4t",t:"Triamcinolone"},{v:"0.75",t:"Dexamethasone"},{v:"0.6",t:"Betamethasone"} ] },
      { id:"dose", label:"Dose", type:"number", unit:"mg", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.dose)) return ERR;
      var pot=parseFloat(v.drug)||5;
      var pred=r1(v.dose*5/pot), hc=r1(v.dose*20/pot), dex=r1(v.dose*0.75/pot);
      return { v:pred, u:"mg prednisolone-equiv", i:"≈ "+hc+" mg hydrocortisone or "+dex+" mg dexamethasone (anti-inflammatory equivalence). Does not account for mineralocorticoid effect or duration of action; taper and stress-dosing per clinical context." };
    } },

  { id:"mme", cat:"General", icon:"", title:"Morphine Milligram Equivalents (MME/day)",
    desc:"Converts an oral opioid to daily oral morphine equivalents.",
    inputs:[
      { id:"drug", label:"Opioid (oral)", type:"select", opts:[
        {v:"1",t:"Morphine"},{v:"1.5",t:"Oxycodone"},{v:"1",t:"Hydrocodone"},{v:"4",t:"Hydromorphone"},
        {v:"3",t:"Oxymorphone"},{v:"0.15",t:"Codeine"},{v:"0.1",t:"Tramadol"},{v:"0.4",t:"Tapentadol"} ] },
      { id:"dose", label:"Total dose in 24 h", type:"number", unit:"mg/day", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.dose)) return ERR;
      var f=parseFloat(v.drug)||1; var mme=r1(v.dose*f);
      var band = mme>=90?"≥90 MME/day — high risk; specialist review advised":mme>=50?"≥50 MME/day — increased overdose risk; use caution":"Lower range";
      return { v:mme, u:"MME/day", i:band+". Methadone and transdermal fentanyl are NOT included (non-linear / route-specific). Ref: CDC opioid guidance." };
    } },

  { id:"saag", cat:"Hepatology", icon:"", title:"Serum-Ascites Albumin Gradient (SAAG)",
    desc:"Classifies ascites as portal-hypertensive vs not.",
    inputs:[
      { id:"salb", label:"Serum albumin", type:"number", unit:"g/dL", step:"0.1", lab:"alb" },
      { id:"aalb", label:"Ascitic fluid albumin", type:"number", unit:"g/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.salb)||!ok(v.aalb)) return ERR;
      var g=r1(v.salb - v.aalb);
      return { v:g, u:"g/dL", i:(g>=1.1?"≥1.1 g/dL — portal hypertension likely (cirrhosis, heart failure, Budd-Chiari)":"<1.1 g/dL — non-portal cause (malignancy, TB, pancreatic, nephrotic)")+". Ref: Runyon, Ann Intern Med 1992." };
    } },

  { id:"ttkg", cat:"Renal", icon:"", title:"Transtubular Potassium Gradient (TTKG)",
    desc:"Assesses renal potassium handling in dyskalaemia.",
    inputs:[
      { id:"uk", label:"Urine potassium", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"pk", label:"Plasma potassium", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"uosm", label:"Urine osmolality", type:"number", unit:"mOsm/kg", step:"1" },
      { id:"posm", label:"Plasma osmolality", type:"number", unit:"mOsm/kg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.uk)||!ok(v.pk)||!ok(v.uosm)||!ok(v.posm)||v.pk<=0||v.posm<=0||v.uosm<v.posm) return { err:"Enter valid values (urine osmolality must exceed plasma; requires urine Na adequate)." };
      var t=r1((v.uk/v.pk)/(v.uosm/v.posm));
      return { v:t, u:"", i:"In hyperkalaemia TTKG <7 suggests hypoaldosteronism (expected >7); in hypokalaemia >3 suggests renal potassium wasting. Valid only when urine osmolality > plasma and urine Na is adequate. Interpretation is debated." };
    } },

  { id:"ebv", cat:"General", icon:"", title:"Estimated Blood Volume",
    desc:"Weight-based estimate of total blood volume.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.5" },
      { id:"grp", label:"Patient group", type:"select", opts:[
        {v:"75",t:"Adult male"},{v:"65",t:"Adult female"},{v:"70",t:"Child (1–12 y)"},{v:"80",t:"Infant (<1 y)"},{v:"85",t:"Term neonate"},{v:"95",t:"Premature neonate"} ] }
    ],
    compute:function(v){
      if(!ok(v.wt)||v.wt<=0) return ERR;
      var f=parseFloat(v.grp)||70; var ml=r0(v.wt*f);
      return { v:ml, u:"mL", i:"≈ "+f+" mL/kg for this group. Useful for transfusion, exchange and blood-loss estimates." };
    } },

  { id:"cows", cat:"Psychiatry", icon:"", title:"Clinical Opiate Withdrawal Scale (COWS)",
    desc:"Severity of opioid withdrawal.",
    inputs:[
      { id:"pulse", label:"Resting pulse rate", type:"select", opts:[{v:"0",t:"≤80"},{v:"1",t:"81–100"},{v:"2",t:"101–120"},{v:"4",t:">120"}] },
      { id:"sweat", label:"Sweating", type:"select", opts:[{v:"0",t:"No chills or flushing"},{v:"1",t:"Subjective chills or flushing"},{v:"2",t:"Flushed or moist face"},{v:"3",t:"Beads of sweat on brow/face"},{v:"4",t:"Sweat streaming off face"}] },
      { id:"restless", label:"Restlessness", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Fidgety"},{v:"3",t:"Frequent shifting"},{v:"5",t:"Unable to sit still"}] },
      { id:"pupil", label:"Pupil size", type:"select", opts:[{v:"0",t:"Normal/pinned"},{v:"1",t:"Possibly larger"},{v:"2",t:"Moderately dilated"},{v:"5",t:"So dilated only rim visible"}] },
      { id:"ache", label:"Bone/joint aches", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Severe diffuse"},{v:"4",t:"Rubbing joints, cannot sit still"}] },
      { id:"nose", label:"Runny nose / tearing", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Stuffiness/moist eyes"},{v:"2",t:"Running nose/tearing"},{v:"4",t:"Streaming"}] },
      { id:"gi", label:"GI upset", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Cramps"},{v:"2",t:"Nausea/loose stool"},{v:"3",t:"Vomiting/diarrhoea"},{v:"5",t:"Multiple episodes"}] },
      { id:"tremor", label:"Tremor", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Felt not seen"},{v:"2",t:"Slight"},{v:"4",t:"Gross"}] },
      { id:"yawn", label:"Yawning", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Once or twice"},{v:"2",t:"≥3 times"},{v:"4",t:"Several times/minute"}] },
      { id:"anx", label:"Anxiety/irritability", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Obvious"},{v:"4",t:"So severe participation difficult"}] },
      { id:"skin", label:"Gooseflesh skin", type:"select", opts:[{v:"0",t:"Smooth"},{v:"3",t:"Piloerection felt"},{v:"5",t:"Prominent piloerection"}] }
    ],
    compute:function(v){
      var s=["pulse","sweat","restless","pupil","ache","nose","gi","tremor","yawn","anx","skin"].reduce(function(a,k){return a+(Number(v[k])||0);},0);
      var band = s<=4?"Minimal":s<=12?"Mild":s<=24?"Moderate":s<=36?"Moderately severe":"Severe";
      return { v:s, u:"points", i:band+" withdrawal (5–12 mild, 13–24 moderate, 25–36 moderately severe, >36 severe). Ref: Wesson & Ling, J Psychoactive Drugs 2003." };
    } },

  { id:"gahs", cat:"Hepatology", icon:"", title:"Glasgow Alcoholic Hepatitis Score (GAHS)",
    desc:"Prognosis in alcoholic hepatitis (day 1 or day 6–9).",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs", step:"1" },
      { id:"wcc", label:"White cell count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"urea", label:"Urea", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"inr", label:"INR (or PT ratio)", type:"number", step:"0.1" },
      { id:"bili", label:"Bilirubin", type:"number", unit:"µmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.wcc)||!ok(v.urea)||!ok(v.inr)||!ok(v.bili)) return ERR;
      var s=0;
      s += v.age<50?1:2;
      s += v.wcc<15?1:2;
      s += v.urea<5?1:2;
      s += v.inr<1.5?1:(v.inr<=2.0?2:3);
      s += v.bili<125?1:(v.bili<=250?2:3);
      return { v:s, u:"points", i:(s>=9?"≥9 — poor prognosis; corticosteroids may be considered (with Maddrey/MELD and after excluding sepsis/GI bleed)":"<9 — better prognosis")+" (range 5–12). Ref: Forrest, Gut 2005." };
    } },

  { id:"das28", cat:"Rheumatology", icon:"", title:"DAS28-ESR (rheumatoid activity)",
    desc:"Composite disease-activity score in rheumatoid arthritis.",
    inputs:[
      { id:"tjc", label:"Tender joint count (of 28)", type:"number", step:"1", min:"0" },
      { id:"sjc", label:"Swollen joint count (of 28)", type:"number", step:"1", min:"0" },
      { id:"esr", label:"ESR", type:"number", unit:"mm/h", step:"1" },
      { id:"gh", label:"Patient global health (VAS 0–100)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.tjc)||!ok(v.sjc)||!ok(v.esr)||!ok(v.gh)||v.esr<=0) return ERR;
      var d = 0.56*Math.sqrt(Math.max(0,v.tjc)) + 0.28*Math.sqrt(Math.max(0,v.sjc)) + 0.70*Math.log(v.esr) + 0.014*v.gh;
      d = r1(d);
      var band = d<2.6?"Remission":d<=3.2?"Low activity":d<=5.1?"Moderate activity":"High activity";
      return { v:d, u:"", i:band+" (remission <2.6, low ≤3.2, moderate ≤5.1, high >5.1). Ref: Prevoo, Arthritis Rheum 1995." };
    } },

  /* ===== MDCalc-parity expansion — batch 3 (ai_drafted; clinician-verify) ===== */

  { id:"stopbang", cat:"Respiratory", icon:"", title:"STOP-BANG (obstructive sleep apnoea)",
    desc:"Screening risk of obstructive sleep apnoea.",
    inputs:[
      { id:"s1", label:"Snoring loudly", type:"check" },
      { id:"t", label:"Tiredness / daytime sleepiness", type:"check" },
      { id:"o", label:"Observed apnoea", type:"check" },
      { id:"p", label:"Pressure (treated hypertension)", type:"check" },
      { id:"b", label:"BMI >35 kg/m²", type:"check" },
      { id:"a", label:"Age >50 years", type:"check" },
      { id:"n", label:"Neck circumference >40 cm", type:"check" },
      { id:"g", label:"Male sex", type:"check" }
    ],
    compute:function(v){
      var s=0; ["s1","t","o","p","b","a","n","g"].forEach(function(k){ if(v[k])s++; });
      var band = s<=2?"Low risk":s<=4?"Intermediate risk":"High risk of OSA";
      return { v:s, u:"/8", i:band+" (0–2 low, 3–4 intermediate, 5–8 high). Consider sleep study for higher scores. Ref: Chung, Anesthesiology 2008." };
    } },

  { id:"smartcop", cat:"Respiratory", icon:"", title:"SMART-COP (pneumonia — intensive support)",
    desc:"Predicts need for intensive respiratory or vasopressor support in community-acquired pneumonia.",
    inputs:[
      { id:"sbp", label:"Systolic BP <90 mmHg", type:"check" },
      { id:"multi", label:"Multilobar infiltrates on CXR", type:"check" },
      { id:"alb", label:"Albumin <3.5 g/dL (35 g/L)", type:"check" },
      { id:"rr", label:"High respiratory rate (age-adjusted)", type:"check" },
      { id:"tachy", label:"Tachycardia ≥125/min", type:"check" },
      { id:"conf", label:"New confusion", type:"check" },
      { id:"ox", label:"Low oxygen (age-adjusted)", type:"check" },
      { id:"ph", label:"Arterial pH <7.35", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.sbp)s+=2; if(v.multi)s+=1; if(v.alb)s+=1; if(v.rr)s+=1; if(v.tachy)s+=1; if(v.conf)s+=1; if(v.ox)s+=2; if(v.ph)s+=2;
      var band = s<=2?"Low risk":s<=4?"Moderate risk (~1 in 8)":s<=6?"High risk (~1 in 3)":"Very high risk (~2 in 3)";
      return { v:s, u:"points", i:band+" of needing intensive respiratory/vasopressor support. Ref: Charles, Clin Infect Dis 2008." };
    } },

  { id:"homa_ir", cat:"Endocrine", icon:"", title:"HOMA-IR (insulin resistance)",
    desc:"Homeostatic model assessment of insulin resistance.",
    inputs:[
      { id:"glu", label:"Fasting glucose", type:"number", unit:"mg/dL", step:"1" },
      { id:"ins", label:"Fasting insulin", type:"number", unit:"µU/mL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.glu)||!ok(v.ins)||v.glu<=0||v.ins<=0) return ERR;
      var h=r1(v.glu*v.ins/405);
      return { v:h, u:"", i:(h>2.5?"Suggests insulin resistance (thresholds vary by population/assay, commonly >~2.5)":"Within the usual reference range")+". Use fasting samples; not validated on insulin therapy. Ref: Matthews, Diabetologia 1985." };
    } },

  { id:"nafld_fibrosis", cat:"Hepatology", icon:"", title:"NAFLD Fibrosis Score",
    desc:"Estimates advanced fibrosis in non-alcoholic fatty liver disease.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"yrs", step:"1" },
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"dm", label:"Impaired fasting glucose or diabetes", type:"check" },
      { id:"ast", label:"AST", type:"number", unit:"U/L", step:"1" },
      { id:"alt", label:"ALT", type:"number", unit:"U/L", step:"1" },
      { id:"plt", label:"Platelets", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.bmi)||!ok(v.ast)||!ok(v.alt)||!ok(v.plt)||!ok(v.alb)||v.alt<=0||v.plt<=0) return ERR;
      var s = -1.675 + 0.037*v.age + 0.094*v.bmi + 1.13*(v.dm?1:0) + 0.99*(v.ast/v.alt) - 0.013*v.plt - 0.66*(v.alb/10);
      s=r1(s*100)/100;
      var band = s < -1.455 ? "Advanced fibrosis unlikely (F0–F2)" : s > 0.676 ? "Advanced fibrosis likely (F3–F4)" : "Indeterminate — consider further assessment (e.g. elastography)";
      return { v:s, u:"", i:band+" (low <−1.455, high >0.676). Ref: Angulo, Hepatology 2007." };
    } },

  { id:"glasgow_imrie", cat:"Critical care", icon:"", title:"Glasgow-Imrie Score (pancreatitis)",
    desc:"Severity of acute pancreatitis at 48 hours (PANCREAS criteria).",
    inputs:[
      { id:"po2", label:"PaO₂ <8 kPa (<60 mmHg)", type:"check" },
      { id:"age", label:"Age >55 years", type:"check" },
      { id:"wcc", label:"White cell count >15 ×10⁹/L", type:"check" },
      { id:"ca", label:"Calcium <2 mmol/L", type:"check" },
      { id:"urea", label:"Urea >16 mmol/L", type:"check" },
      { id:"ldh", label:"LDH >600 U/L (or AST >200 U/L)", type:"check" },
      { id:"alb", label:"Albumin <32 g/L", type:"check" },
      { id:"glu", label:"Glucose >10 mmol/L", type:"check" }
    ],
    compute:function(v){
      var s=0; ["po2","age","wcc","ca","urea","ldh","alb","glu"].forEach(function(k){ if(v[k])s++; });
      return { v:s, u:"points", i:(s>=3?"≥3 — predicts severe pancreatitis; consider HDU/ICU care":"<3 — predicts milder course")+". Best applied at 48 h. Ref: Blamey/Imrie, Gut 1984." };
    } },

  { id:"4at", cat:"Neurology", icon:"", title:"4AT (delirium screening)",
    desc:"Rapid bedside screen for delirium and cognitive impairment.",
    inputs:[
      { id:"alert", label:"Alertness", type:"select", opts:[{v:"0",t:"Normal"},{v:"4",t:"Clearly abnormal (drowsy/agitated)"}] },
      { id:"amt4", label:"AMT4 (age, DOB, place, current year)", type:"select", opts:[{v:"0",t:"No mistakes"},{v:"1",t:"1 mistake"},{v:"2",t:"≥2 mistakes / untestable"}] },
      { id:"att", label:"Attention (months of year backwards)", type:"select", opts:[{v:"0",t:"≥7 correct"},{v:"1",t:"<7 / refuses"},{v:"2",t:"Untestable"}] },
      { id:"acute", label:"Acute change or fluctuating course", type:"select", opts:[{v:"0",t:"No"},{v:"4",t:"Yes"}] }
    ],
    compute:function(v){
      var s=(Number(v.alert)||0)+(Number(v.amt4)||0)+(Number(v.att)||0)+(Number(v.acute)||0);
      var band = s>=4?"Possible delirium ± cognitive impairment":s>=1?"Possible cognitive impairment":"Delirium/cognitive impairment unlikely";
      return { v:s, u:"points", i:band+" (≥4 delirium likely, 1–3 possible cognitive impairment, 0 unlikely). Ref: MacLullich, 4AT (the4at.com)." };
    } },

  { id:"sf_syncope", cat:"Cardiovascular", icon:"", title:"San Francisco Syncope Rule (CHESS)",
    desc:"Risk-stratifies syncope for serious short-term outcomes.",
    inputs:[
      { id:"chf", label:"History of congestive heart failure", type:"check" },
      { id:"hct", label:"Haematocrit <30%", type:"check" },
      { id:"ecg", label:"Abnormal ECG (new changes / non-sinus rhythm)", type:"check" },
      { id:"sob", label:"Shortness of breath", type:"check" },
      { id:"sbp", label:"Systolic BP <90 mmHg at triage", type:"check" }
    ],
    compute:function(v){
      var pos = v.chf||v.hct||v.ecg||v.sob||v.sbp;
      return { v: pos?"High risk":"Low risk", i: pos?"Any CHESS factor present — higher risk of serious 7-day outcome; consider admission/workup.":"No CHESS factor — low risk of serious short-term outcome. Ref: Quinn, Ann Emerg Med 2004." };
    } },

  { id:"bode", cat:"Respiratory", icon:"", title:"BODE Index (COPD)",
    desc:"Multidimensional COPD prognosis (mortality).",
    inputs:[
      { id:"bmi", label:"BMI", type:"select", opts:[{v:"0",t:">21 kg/m²"},{v:"1",t:"≤21 kg/m²"}] },
      { id:"fev1", label:"FEV₁ (% predicted)", type:"select", opts:[{v:"0",t:"≥65%"},{v:"1",t:"50–64%"},{v:"2",t:"36–49%"},{v:"3",t:"≤35%"}] },
      { id:"mmrc", label:"mMRC dyspnoea grade", type:"select", opts:[{v:"0",t:"0–1"},{v:"1",t:"2"},{v:"2",t:"3"},{v:"3",t:"4"}] },
      { id:"walk", label:"6-minute walk distance", type:"select", opts:[{v:"0",t:"≥350 m"},{v:"1",t:"250–349 m"},{v:"2",t:"150–249 m"},{v:"3",t:"≤149 m"}] }
    ],
    compute:function(v){
      var s=(Number(v.bmi)||0)+(Number(v.fev1)||0)+(Number(v.mmrc)||0)+(Number(v.walk)||0);
      var band = s<=2?"Lower quartile — better 4-year survival":s<=4?"Second quartile":s<=6?"Third quartile":"Highest quartile — worst prognosis";
      return { v:s, u:"/10", i:band+". Higher BODE predicts higher mortality than FEV₁ alone. Ref: Celli, NEJM 2004." };
    } },

  { id:"ottawa_sah", cat:"Neurology", icon:"", title:"Ottawa SAH Rule",
    desc:"Rule-out for subarachnoid haemorrhage in alert adults with acute severe headache.",
    inputs:[
      { id:"age40", label:"Age ≥40 years", type:"check" },
      { id:"neck", label:"Neck pain or stiffness", type:"check" },
      { id:"los", label:"Witnessed loss of consciousness", type:"check" },
      { id:"exert", label:"Onset during exertion", type:"check" },
      { id:"thunder", label:"Thunderclap (instantly peaking pain)", type:"check" },
      { id:"flex", label:"Limited neck flexion on examination", type:"check" }
    ],
    compute:function(v){
      var pos = v.age40||v.neck||v.los||v.exert||v.thunder||v.flex;
      return { v: pos?"Investigate for SAH":"No investigation required by the rule", i:"Applies ONLY to alert patients ≥15 y with new severe atraumatic headache peaking within 1 h and no neurological deficit. Highly sensitive (rule-out). Ref: Perry, JAMA 2013." };
    } },

  { id:"wfns", cat:"Neurology", icon:"", title:"WFNS Grade (SAH)",
    desc:"World Federation of Neurosurgical Societies grade for subarachnoid haemorrhage.",
    inputs:[
      { id:"g", label:"Grade (GCS ± motor deficit)", type:"select", opts:[
        {v:"1",t:"I — GCS 15, no motor deficit"},
        {v:"2",t:"II — GCS 13–14, no motor deficit"},
        {v:"3",t:"III — GCS 13–14 with motor deficit"},
        {v:"4",t:"IV — GCS 7–12"},
        {v:"5",t:"V — GCS 3–6"} ] }
    ],
    compute:function(v){
      var g=Number(v.g)||1;
      return { v:g, u:"(I–V)", i:"Higher grade correlates with worse outcome after aneurysmal SAH; based mainly on the Glasgow Coma Scale. Ref: WFNS, J Neurosurg 1988." };
    } },

  /* ===== MDCalc-parity expansion — batch 4 (ai_drafted; clinician-verify) ===== */

  { id:"harvey_bradshaw", cat:"Gastroenterology", icon:"", title:"Harvey-Bradshaw Index (Crohn's)",
    desc:"Simple clinical activity index for Crohn's disease.",
    inputs:[
      { id:"well", label:"General wellbeing", type:"select", opts:[{v:"0",t:"Very well"},{v:"1",t:"Slightly below par"},{v:"2",t:"Poor"},{v:"3",t:"Very poor"},{v:"4",t:"Terrible"}] },
      { id:"pain", label:"Abdominal pain", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"stool", label:"Liquid stools per day", type:"number", step:"1", min:"0" },
      { id:"mass", label:"Abdominal mass", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Dubious"},{v:"2",t:"Definite"},{v:"3",t:"Definite and tender"}] },
      { id:"comp", label:"Number of complications (arthralgia, uveitis, erythema nodosum, aphthae, pyoderma, fissure, fistula, abscess)", type:"number", step:"1", min:"0" }
    ],
    compute:function(v){
      if(!ok(v.stool)) return ERR;
      var s = (Number(v.well)||0)+(Number(v.pain)||0)+Math.max(0,v.stool)+(Number(v.mass)||0)+(ok(v.comp)?Math.max(0,v.comp):0);
      var band = s<5?"Clinical remission":s<=7?"Mild":s<=16?"Moderate":"Severe";
      return { v:r0(s), u:"points", i:band+" (remission <5, mild 5–7, moderate 8–16, severe >16). Ref: Harvey & Bradshaw, Lancet 1980." };
    } },

  { id:"truelove_witts", cat:"Gastroenterology", icon:"", title:"Truelove-Witts (UC severity)",
    desc:"Severity classification of an ulcerative colitis flare.",
    inputs:[
      { id:"stool", label:"Bloody stools per day", type:"number", step:"1", min:"0" },
      { id:"temp", label:"Temperature >37.8 °C", type:"check" },
      { id:"hr", label:"Heart rate >90/min", type:"check" },
      { id:"anaemia", label:"Anaemia (Hb <105 g/L)", type:"check" },
      { id:"esr", label:"ESR >30 mm/h", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.stool)) return ERR;
      var sys=0; if(v.temp)sys++; if(v.hr)sys++; if(v.anaemia)sys++; if(v.esr)sys++;
      var cls = (v.stool>=6 && sys>=1) ? "Severe" : (v.stool<4 && sys===0) ? "Mild" : "Moderate";
      return { v:cls, i:"Severe = ≥6 bloody stools/day plus ≥1 systemic feature (fever, tachycardia, anaemia, raised ESR); mild = <4 stools with no systemic upset. Severe colitis needs inpatient care. Ref: Truelove & Witts, BMJ 1955." };
    } },

  { id:"aims65", cat:"Gastroenterology", icon:"", title:"AIMS65 (upper GI bleed mortality)",
    desc:"Predicts in-hospital mortality in acute upper GI bleeding.",
    inputs:[
      { id:"alb", label:"Albumin <30 g/L (3.0 g/dL)", type:"check" },
      { id:"inr", label:"INR >1.5", type:"check" },
      { id:"ams", label:"Altered mental status", type:"check" },
      { id:"sbp", label:"Systolic BP ≤90 mmHg", type:"check" },
      { id:"age", label:"Age >65 years", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.alb)s++; if(v.inr)s++; if(v.ams)s++; if(v.sbp)s++; if(v.age)s++;
      var band = s<=1?"Lower mortality risk":s===2?"Intermediate risk":"High mortality risk";
      return { v:s, u:"/5", i:band+"; mortality rises steeply with each additional factor. Ref: Saltzman, Gastrointest Endosc 2011." };
    } },

  { id:"air_score", cat:"General", icon:"", title:"Appendicitis Inflammatory Response (AIR) Score",
    desc:"Risk stratification for acute appendicitis.",
    inputs:[
      { id:"vom", label:"Vomiting", type:"check" },
      { id:"rif", label:"Right iliac fossa pain", type:"check" },
      { id:"reb", label:"Rebound tenderness / guarding", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Light"},{v:"2",t:"Medium"},{v:"3",t:"Strong"}] },
      { id:"temp", label:"Temperature ≥38.5 °C", type:"check" },
      { id:"poly", label:"Polymorphonuclear leukocytes", type:"select", opts:[{v:"0",t:"<70%"},{v:"1",t:"70–84%"},{v:"2",t:"≥85%"}] },
      { id:"wcc", label:"White cell count", type:"select", opts:[{v:"0",t:"<10 ×10⁹/L"},{v:"1",t:"10–14.9"},{v:"2",t:"≥15"}] },
      { id:"crp", label:"C-reactive protein", type:"select", opts:[{v:"0",t:"<10 mg/L"},{v:"1",t:"10–49"},{v:"2",t:"≥50"}] }
    ],
    compute:function(v){
      var s = (v.vom?1:0)+(v.rif?1:0)+(Number(v.reb)||0)+(v.temp?1:0)+(Number(v.poly)||0)+(Number(v.wcc)||0)+(Number(v.crp)||0);
      var band = s<=4?"Low probability — outpatient observation may be appropriate":s<=8?"Indeterminate — active observation / imaging":"High probability — surgical assessment";
      return { v:s, u:"/12", i:band+". Ref: Andersson, World J Surg 2008." };
    } },

  { id:"kocher", cat:"Paediatrics", icon:"", title:"Kocher Criteria (septic hip)",
    desc:"Differentiates septic arthritis from transient synovitis of the paediatric hip.",
    inputs:[
      { id:"nwb", label:"Non-weight-bearing on affected side", type:"check" },
      { id:"fever", label:"Temperature >38.5 °C", type:"check" },
      { id:"esr", label:"ESR >40 mm/h", type:"check" },
      { id:"wcc", label:"White cell count >12 ×10⁹/L", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.nwb)s++; if(v.fever)s++; if(v.esr)s++; if(v.wcc)s++;
      var prob = ["<0.2%","~3%","~40%","~93%","~99%"][s];
      return { v:s, u:"/4", i:"Approximate probability of septic arthritis "+prob+" — a high score warrants joint aspiration. Ref: Kocher, J Bone Joint Surg 1999." };
    } },

  { id:"orbit_bleed", cat:"Cardiovascular", icon:"", title:"ORBIT Bleeding Score (AF)",
    desc:"Major bleeding risk on anticoagulation for atrial fibrillation.",
    inputs:[
      { id:"age", label:"Age ≥74 years", type:"check" },
      { id:"anaemia", label:"Reduced haemoglobin/haematocrit or anaemia", type:"check" },
      { id:"bleed", label:"History of bleeding", type:"check" },
      { id:"renal", label:"Renal impairment (eGFR <60)", type:"check" },
      { id:"antiplt", label:"Treatment with an antiplatelet agent", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.age)s++; if(v.anaemia)s+=2; if(v.bleed)s+=2; if(v.renal)s++; if(v.antiplt)s++;
      var band = s<=2?"Low bleeding risk":s===3?"Medium risk":"High bleeding risk";
      return { v:s, u:"points", i:band+" (0–2 low, 3 medium, ≥4 high). Weigh against stroke risk rather than withholding anticoagulation. Ref: O'Brien, Eur Heart J 2015." };
    } },

  { id:"urr", cat:"Renal", icon:"", title:"Urea Reduction Ratio (dialysis)",
    desc:"Adequacy of a haemodialysis session.",
    inputs:[
      { id:"pre", label:"Pre-dialysis urea", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"post", label:"Post-dialysis urea", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.pre)||!ok(v.post)||v.pre<=0) return ERR;
      var u=r0((v.pre - v.post)/v.pre*100);
      return { v:u, u:"%", i:(u>=65?"≥65% — generally adequate for thrice-weekly haemodialysis":"<65% — below the usual adequacy target")+". Kt/V is the preferred measure. Ref: NKF-KDOQI." };
    } },

  { id:"cdai_ra", cat:"Rheumatology", icon:"", title:"CDAI (rheumatoid arthritis)",
    desc:"Clinical Disease Activity Index — no laboratory value required.",
    inputs:[
      { id:"tjc", label:"Tender joint count (of 28)", type:"number", step:"1", min:"0" },
      { id:"sjc", label:"Swollen joint count (of 28)", type:"number", step:"1", min:"0" },
      { id:"pga", label:"Patient global assessment (0–10)", type:"number", step:"0.1" },
      { id:"ega", label:"Evaluator global assessment (0–10)", type:"number", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.tjc)||!ok(v.sjc)||!ok(v.pga)||!ok(v.ega)) return ERR;
      var s=r1(Math.max(0,v.tjc)+Math.max(0,v.sjc)+v.pga+v.ega);
      var band = s<=2.8?"Remission":s<=10?"Low activity":s<=22?"Moderate activity":"High activity";
      return { v:s, u:"", i:band+" (remission ≤2.8, low ≤10, moderate ≤22, high >22). Ref: Aletaha, Arthritis Res Ther 2005." };
    } },

  { id:"gos", cat:"Neurology", icon:"", title:"Glasgow Outcome Scale (GOS)",
    desc:"Global outcome after brain injury.",
    inputs:[
      { id:"g", label:"Outcome", type:"select", opts:[
        {v:"5",t:"5 — Good recovery"},
        {v:"4",t:"4 — Moderate disability (independent but disabled)"},
        {v:"3",t:"3 — Severe disability (conscious but dependent)"},
        {v:"2",t:"2 — Persistent vegetative state"},
        {v:"1",t:"1 — Death"} ] }
    ],
    compute:function(v){
      var g=Number(v.g)||1;
      var txt=["","Death","Persistent vegetative state","Severe disability","Moderate disability","Good recovery"][g];
      return { v:g, u:"(1–5)", i:txt+". Higher is better; often dichotomised as favourable (4–5) vs unfavourable (1–3). Ref: Jennett & Bond, Lancet 1975." };
    } },

  { id:"anc", cat:"Haematology", icon:"", title:"Absolute Neutrophil Count (ANC)",
    desc:"Neutrophil count and neutropenia grading.",
    inputs:[
      { id:"wbc", label:"White cell count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"neut", label:"Neutrophils (segmented + bands)", type:"number", unit:"%", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.wbc)||!ok(v.neut)||v.wbc<0||v.neut<0) return ERR;
      var raw=v.wbc*v.neut/100, a=r1(raw);
      var band = raw<0.5?"Severe neutropenia (high infection risk)":raw<1.0?"Moderate neutropenia":raw<1.5?"Mild neutropenia":"Not neutropenic";
      return { v:a, u:"×10⁹/L", i:band+" (severe <0.5, moderate <1.0, mild <1.5). Neutropenic fever is an emergency." };
    } },

  { id:"improve_vte", cat:"Haematology", icon:"", title:"IMPROVE VTE Risk Score",
    desc:"Venous thromboembolism risk in hospitalised medical patients.",
    inputs:[
      { id:"prev", label:"Previous VTE", type:"check" },
      { id:"throm", label:"Known thrombophilia", type:"check" },
      { id:"paral", label:"Lower-limb paralysis", type:"check" },
      { id:"cancer", label:"Current cancer", type:"check" },
      { id:"immob", label:"Immobilised ≥7 days", type:"check" },
      { id:"icu", label:"ICU/CCU stay", type:"check" },
      { id:"age60", label:"Age >60 years", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.prev)s+=3; if(v.throm)s+=2; if(v.paral)s+=2; if(v.cancer)s+=2; if(v.immob)s++; if(v.icu)s++; if(v.age60)s++;
      var band = s<=1?"Low VTE risk — pharmacological prophylaxis often not warranted":s<=3?"Moderate risk — consider prophylaxis":"High risk — prophylaxis generally indicated (weigh bleeding risk)";
      return { v:s, u:"points", i:band+". Ref: Spyropoulos, Chest 2011 (IMPROVE)." };
    } },

  { id:"eag", cat:"Endocrine", icon:"", title:"Estimated Average Glucose (eAG) from HbA1c",
    desc:"Converts HbA1c to an estimated average glucose (ADAG study).",
    inputs:[
      { id:"a1c", label:"HbA1c", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.a1c)) return ERR;
      var mg = 28.7*v.a1c - 46.7;
      var mmol = 1.59*v.a1c - 2.59;
      if(mg<0) return { err:"HbA1c value too low to estimate an average glucose" };
      return { v:r0(mg), u:"mg/dL", i:"Estimated average glucose ≈ "+r1(mmol)+" mmol/L, reflecting mean glucose over the preceding ~8–12 weeks. Ref: Nathan, Diabetes Care 2008 (ADAG)." };
    } },

  { id:"rpi", cat:"Haematology", icon:"", title:"Reticulocyte Production Index (RPI)",
    desc:"Corrects reticulocyte % for anaemia and maturation to assess marrow response.",
    inputs:[
      { id:"retic", label:"Reticulocyte count", type:"number", unit:"%", step:"0.1" },
      { id:"hct", label:"Haematocrit", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.retic)||!ok(v.hct)||v.hct<=0) return ERR;
      var mf = v.hct>=35?1.0 : v.hct>=25?1.5 : v.hct>=20?2.0 : 2.5;
      var rpi = (v.retic*(v.hct/45))/mf;
      var b = rpi>=3?"Adequate marrow response (e.g. haemolysis or blood loss)":rpi<2?"Inadequate response — suggests a hypoproliferative/marrow cause":"Borderline response";
      return { v:r1(rpi), u:"index", i:b+" (maturation factor "+mf+"). Ref: standard haematology." };
    } },

  { id:"isth_dic", cat:"Haematology", icon:"", title:"ISTH Overt DIC Score",
    desc:"Diagnoses overt disseminated intravascular coagulation (requires a compatible underlying disorder).",
    inputs:[
      { id:"plt", label:"Platelet count", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"marker", label:"Fibrin-related marker (D-dimer/FDP)", type:"select", opts:[{v:"0",t:"No increase"},{v:"2",t:"Moderate increase"},{v:"3",t:"Strong increase"}] },
      { id:"ptp", label:"PT prolongation", type:"number", unit:"sec", step:"0.1" },
      { id:"fib", label:"Fibrinogen", type:"number", unit:"g/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.plt)||!ok(v.ptp)||!ok(v.fib)) return ERR;
      var s=0;
      s += v.plt>100?0 : v.plt>=50?1 : 2;
      s += Number(v.marker);
      s += v.ptp>6?2 : v.ptp>=3?1 : 0;
      s += v.fib<1?1:0;
      var b = s>=5?"Compatible with overt DIC — repeat scoring daily":"Not suggestive of overt DIC — repeat if clinical suspicion persists";
      return { v:s, u:"points", i:b+". Ref: Taylor, Thromb Haemost 2001 (ISTH)." };
    } },

  { id:"sdai", cat:"Rheumatology", icon:"", title:"Simplified Disease Activity Index (SDAI) — RA",
    desc:"Rheumatoid arthritis disease activity from joint counts, global assessments and CRP.",
    inputs:[
      { id:"tjc", label:"Tender joint count (of 28)", type:"number", step:"1" },
      { id:"sjc", label:"Swollen joint count (of 28)", type:"number", step:"1" },
      { id:"pga", label:"Patient global assessment (0–10)", type:"number", step:"0.1" },
      { id:"ega", label:"Evaluator global assessment (0–10)", type:"number", step:"0.1" },
      { id:"crp", label:"CRP", type:"number", unit:"mg/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.tjc)||!ok(v.sjc)||!ok(v.pga)||!ok(v.ega)||!ok(v.crp)) return ERR;
      var s = v.tjc+v.sjc+v.pga+v.ega+v.crp;
      var b = s<=3.3?"Remission":s<=11?"Low disease activity":s<=26?"Moderate disease activity":"High disease activity";
      return { v:r1(s), u:"points", i:b+". Note: CRP entered in mg/dL. Ref: Smolen, Rheumatology 2003." };
    } },

  { id:"braden", cat:"General", icon:"", title:"Braden Scale (Pressure Ulcer Risk)",
    desc:"Risk of pressure ulcer development in immobile or at-risk patients.",
    inputs:[
      { id:"sens", label:"Sensory perception", type:"select", opts:[{v:"4",t:"No impairment"},{v:"3",t:"Slightly limited"},{v:"2",t:"Very limited"},{v:"1",t:"Completely limited"}] },
      { id:"moist", label:"Moisture", type:"select", opts:[{v:"4",t:"Rarely moist"},{v:"3",t:"Occasionally moist"},{v:"2",t:"Very moist"},{v:"1",t:"Constantly moist"}] },
      { id:"act", label:"Activity", type:"select", opts:[{v:"4",t:"Walks frequently"},{v:"3",t:"Walks occasionally"},{v:"2",t:"Chairfast"},{v:"1",t:"Bedfast"}] },
      { id:"mob", label:"Mobility", type:"select", opts:[{v:"4",t:"No limitation"},{v:"3",t:"Slightly limited"},{v:"2",t:"Very limited"},{v:"1",t:"Completely immobile"}] },
      { id:"nut", label:"Nutrition", type:"select", opts:[{v:"4",t:"Excellent"},{v:"3",t:"Adequate"},{v:"2",t:"Probably inadequate"},{v:"1",t:"Very poor"}] },
      { id:"fric", label:"Friction and shear", type:"select", opts:[{v:"3",t:"No apparent problem"},{v:"2",t:"Potential problem"},{v:"1",t:"Problem"}] }
    ],
    compute:function(v){
      var s = Number(v.sens)+Number(v.moist)+Number(v.act)+Number(v.mob)+Number(v.nut)+Number(v.fric);
      var b = s<=9?"Very high risk":s<=12?"High risk":s<=14?"Moderate risk":s<=18?"Mild / at risk":"Minimal risk";
      return { v:s, u:"points", i:b+" (lower total = higher risk). Ref: Bergstrom, Nurs Res 1987." };
    } },

  { id:"morse_falls", cat:"General", icon:"", title:"Morse Fall Scale",
    desc:"Likelihood of an inpatient fall.",
    inputs:[
      { id:"hist", label:"History of falling (this admission or ≤3 months)", type:"check" },
      { id:"dx", label:"Secondary diagnosis (≥2 medical diagnoses)", type:"check" },
      { id:"aid", label:"Ambulatory aid", type:"select", opts:[{v:"0",t:"None / bed rest / nurse assist"},{v:"15",t:"Crutches / cane / walker"},{v:"30",t:"Furniture"}] },
      { id:"iv", label:"IV therapy / heparin lock", type:"check" },
      { id:"gait", label:"Gait", type:"select", opts:[{v:"0",t:"Normal / bed rest / immobile"},{v:"10",t:"Weak"},{v:"20",t:"Impaired"}] },
      { id:"mental", label:"Mental status", type:"select", opts:[{v:"0",t:"Oriented to own ability"},{v:"15",t:"Overestimates / forgets limitations"}] }
    ],
    compute:function(v){
      var s=0; if(v.hist)s+=25; if(v.dx)s+=15; s+=Number(v.aid); if(v.iv)s+=20; s+=Number(v.gait)+Number(v.mental);
      var b = s>=45?"High fall risk":s>=25?"Moderate fall risk":"Low fall risk";
      return { v:s, u:"points", i:b+". Ref: Morse, 1989." };
    } },

  { id:"bap65", cat:"Respiratory", icon:"", title:"BAP-65 (COPD Exacerbation Severity)",
    desc:"Risk stratification for an acute exacerbation of COPD.",
    inputs:[
      { id:"bun", label:"BUN ≥ 25 mg/dL (urea ≥ ~9 mmol/L)", type:"check" },
      { id:"ams", label:"Altered mental status", type:"check" },
      { id:"pulse", label:"Pulse ≥ 109 bpm", type:"check" },
      { id:"age65", label:"Age ≥ 65 years", type:"check" }
    ],
    compute:function(v){
      var n=0; if(v.bun)n++; if(v.ams)n++; if(v.pulse)n++;
      var cls;
      if(n===0) cls = v.age65?"II":"I";
      else if(n===1) cls="III"; else if(n===2) cls="IV"; else cls="V";
      var risk = cls==="I"?"Lowest mortality/ventilation risk":cls==="II"?"Low risk (age ≥65, no variables)":cls==="III"?"Intermediate risk":cls==="IV"?"High risk":"Highest risk";
      return { v:"Class "+cls, u:"", i:risk+". Ref: Shorr, Chest 2011 (BAP-65)." };
    } },

  { id:"duke_treadmill", cat:"Cardiovascular", icon:"", title:"Duke Treadmill Score",
    desc:"Prognosis after an exercise (Bruce protocol) treadmill test.",
    inputs:[
      { id:"time", label:"Exercise time (Bruce protocol)", type:"number", unit:"min", step:"0.1" },
      { id:"st", label:"Maximum ST-segment deviation", type:"number", unit:"mm", step:"0.1" },
      { id:"angina", label:"Exercise angina", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Non-limiting"},{v:"2",t:"Exercise-limiting"}] }
    ],
    compute:function(v){
      if(!ok(v.time)||!ok(v.st)) return ERR;
      var dts = v.time - 5*v.st - 4*Number(v.angina);
      var b = dts>=5?"Low risk (excellent 5-year survival)":dts>=-10?"Moderate risk":"High risk (poor prognosis — consider angiography)";
      return { v:r1(dts), u:"", i:b+". Ref: Mark, N Engl J Med 1991." };
    } },

  { id:"mayo_uc", cat:"Gastroenterology", icon:"", title:"Mayo Score (Ulcerative Colitis Activity)",
    desc:"Disease activity in ulcerative colitis (full Mayo score).",
    inputs:[
      { id:"stool", label:"Stool frequency", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"1–2 more/day than normal"},{v:"2",t:"3–4 more/day"},{v:"3",t:"≥5 more/day"}] },
      { id:"bleed", label:"Rectal bleeding", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Streaks < half the time"},{v:"2",t:"Obvious blood most times"},{v:"3",t:"Blood passed alone"}] },
      { id:"endo", label:"Endoscopy findings", type:"select", opts:[{v:"0",t:"Normal / inactive"},{v:"1",t:"Mild (erythema, reduced vascular pattern)"},{v:"2",t:"Moderate (marked erythema, erosions)"},{v:"3",t:"Severe (spontaneous bleeding, ulceration)"}] },
      { id:"pga", label:"Physician global assessment", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] }
    ],
    compute:function(v){
      var s = Number(v.stool)+Number(v.bleed)+Number(v.endo)+Number(v.pga);
      var b = s<=2?"Clinical remission":s<=5?"Mild activity":s<=10?"Moderate activity":"Severe activity";
      return { v:s, u:"points", i:b+". Ref: Schroeder, N Engl J Med 1987." };
    } },

  { id:"oxygenation_index", cat:"Critical care", icon:"", title:"Oxygenation Index (OI)",
    desc:"Severity of hypoxaemic respiratory failure (paediatric ARDS grading).",
    inputs:[
      { id:"fio2", label:"FiO₂", type:"number", unit:"%", step:"1" },
      { id:"map", label:"Mean airway pressure", type:"number", unit:"cmH₂O", step:"0.1" },
      { id:"pao2", label:"PaO₂", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.fio2)||!ok(v.map)||!ok(v.pao2)||v.pao2<=0) return ERR;
      var oi = (v.fio2*v.map)/v.pao2;
      var b = oi<4?"No / mild":oi<8?"Mild paediatric ARDS":oi<16?"Moderate paediatric ARDS":"Severe paediatric ARDS";
      return { v:r1(oi), u:"", i:b+" (higher = worse). Ref: PALICC 2015." };
    } },

  { id:"schwartz", cat:"Renal", icon:"", title:"Bedside Schwartz eGFR (Paediatric)",
    desc:"Estimated GFR in children from height and serum creatinine.",
    inputs:[
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" },
      { id:"scr", label:"Serum creatinine", type:"number", unit:"mg/dL", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.ht)||!ok(v.scr)||v.scr<=0) return ERR;
      var egfr = 0.413*v.ht/v.scr;
      var b = egfr>=90?"Normal / high":egfr>=60?"Mildly reduced":egfr>=30?"Moderately reduced":egfr>=15?"Severely reduced":"Kidney failure";
      return { v:r0(egfr), u:"mL/min/1.73m²", i:b+" (creatinine in mg/dL). Ref: Schwartz, J Am Soc Nephrol 2009." };
    } },

  { id:"delta_ratio", cat:"Renal", icon:"", title:"Delta Ratio (Delta-Delta)",
    desc:"Detects a mixed metabolic acid-base disorder in a high anion gap acidosis.",
    inputs:[
      { id:"ag", label:"Anion gap", type:"number", unit:"mEq/L", step:"0.1" },
      { id:"hco3", label:"Bicarbonate", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ag)||!ok(v.hco3)) return ERR;
      if(v.ag<=12) return { err:"Applies only to a high anion gap acidosis (AG > 12)" };
      if(v.hco3>=24) return { err:"Applies only when bicarbonate is below normal (metabolic acidosis)" };
      var dr = (v.ag - 12)/(24 - v.hco3);
      var b = dr<0.4?"Suggests a concurrent normal anion gap metabolic acidosis":dr<=1?"Combined high- and normal-AG metabolic acidosis":dr<=2?"Pure high anion gap metabolic acidosis":"Suggests a concurrent metabolic alkalosis or chronic respiratory acidosis";
      return { v:r1(dr), u:"", i:b+". Ref: standard acid-base." };
    } },

  { id:"naranjo", cat:"Toxicology", icon:"", title:"Naranjo Adverse Drug Reaction Probability Scale",
    desc:"Likelihood that a clinical event is an adverse drug reaction.",
    inputs:[
      { id:"q1", label:"Previous conclusive reports on this reaction?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q2", label:"Event appeared after the drug was given?", type:"select", opts:[{v:"0",t:"Do not know / not documented"},{v:"2",t:"Yes"},{v:"-1",t:"No"}] },
      { id:"q3", label:"Improved when drug stopped or antagonist given?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q4", label:"Reappeared when drug re-administered?", type:"select", opts:[{v:"0",t:"Do not know / not done"},{v:"2",t:"Yes"},{v:"-1",t:"No"}] },
      { id:"q5", label:"Alternative causes could explain it?", type:"select", opts:[{v:"2",t:"No"},{v:"0",t:"Unknown"},{v:"-1",t:"Yes"}] },
      { id:"q6", label:"Reappeared on placebo?", type:"select", opts:[{v:"1",t:"No"},{v:"0",t:"Unknown"},{v:"-1",t:"Yes"}] },
      { id:"q7", label:"Drug detected in toxic concentration?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q8", label:"More severe with higher dose / less with lower?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q9", label:"Similar reaction to the same/similar drug before?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q10", label:"Confirmed by any objective evidence?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] }
    ],
    compute:function(v){
      var s=Number(v.q1)+Number(v.q2)+Number(v.q3)+Number(v.q4)+Number(v.q5)+Number(v.q6)+Number(v.q7)+Number(v.q8)+Number(v.q9)+Number(v.q10);
      var b=s>=9?"Definite ADR":s>=5?"Probable ADR":s>=1?"Possible ADR":"Doubtful ADR";
      return { v:s, u:"points", i:b+". Ref: Naranjo, Clin Pharmacol Ther 1981." };
    } },

  { id:"glasgow_7point", cat:"Dermatology", icon:"", title:"Glasgow 7-Point Checklist (Melanoma)",
    desc:"Screening of a pigmented skin lesion for referral.",
    inputs:[
      { id:"size", label:"Major: change in size", type:"check" },
      { id:"shape", label:"Major: irregular shape", type:"check" },
      { id:"colour", label:"Major: irregular colour", type:"check" },
      { id:"diam", label:"Minor: diameter ≥ 7 mm", type:"check" },
      { id:"inflam", label:"Minor: inflammation", type:"check" },
      { id:"ooze", label:"Minor: oozing / crusting", type:"check" },
      { id:"sensory", label:"Minor: change in sensation", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.size)s+=2; if(v.shape)s+=2; if(v.colour)s+=2; if(v.diam)s++; if(v.inflam)s++; if(v.ooze)s++; if(v.sensory)s++;
      var b=s>=3?"Refer for specialist assessment (suspicious for melanoma)":"Lower suspicion — assess clinically and safety-net";
      return { v:s, u:"points", i:b+". Any major feature warrants concern. Ref: MacKie (Glasgow 7-point)." };
    } },

  { id:"dlqi", cat:"Dermatology", icon:"", title:"DLQI — Score Interpreter",
    desc:"Interprets a Dermatology Life Quality Index total. Administer the official DLQI (© Cardiff University, free for clinical use from cardiff.ac.uk) and enter the total here.",
    inputs:[
      { id:"total", label:"DLQI total (0–30)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>30) return ERR;
      var s=Math.round(v.total);
      var b=s<=1?"No effect on the patient's life":s<=5?"Small effect":s<=10?"Moderate effect":s<=20?"Very large effect":"Extremely large effect";
      return { v:s, u:"/30", i:b+". Obtain the validated questionnaire from Cardiff University. Banding ref: Hongbo, J Invest Dermatol 2005." };
    } },

  { id:"bpp", cat:"Obstetrics", icon:"", title:"Biophysical Profile (BPP)",
    desc:"Fetal wellbeing from ultrasound components plus the non-stress test.",
    inputs:[
      { id:"breath", label:"Fetal breathing movements present", type:"check" },
      { id:"move", label:"Gross body movements present", type:"check" },
      { id:"tone", label:"Fetal tone (flexion/extension) present", type:"check" },
      { id:"fluid", label:"Adequate amniotic fluid volume", type:"check" },
      { id:"nst", label:"Reactive non-stress test", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.breath)s+=2; if(v.move)s+=2; if(v.tone)s+=2; if(v.fluid)s+=2; if(v.nst)s+=2;
      var b=s>=8?"Normal (low risk of fetal asphyxia)":s===6?"Equivocal — repeat / further assessment":"Abnormal — consider delivery per obstetric judgement";
      return { v:s, u:"/10", i:b+". Ref: Manning, Am J Obstet Gynecol 1980." };
    } },

  { id:"calvert", cat:"Oncology", icon:"", title:"Calvert Formula (Carboplatin Dose)",
    desc:"Carboplatin dose from target AUC and GFR.",
    inputs:[
      { id:"auc", label:"Target AUC", type:"number", unit:"mg/mL·min", step:"0.1" },
      { id:"gfr", label:"GFR", type:"number", unit:"mL/min", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.auc)||!ok(v.gfr)||v.auc<=0||v.gfr<0) return ERR;
      var g=v.gfr, note="";
      if(g>125){ g=125; note=" (GFR capped at 125 mL/min to avoid overdosing)"; }
      var dose=v.auc*(g+25);
      return { v:r0(dose), u:"mg", i:"Total carboplatin dose"+note+". Always verify against local chemotherapy protocol. Ref: Calvert, J Clin Oncol 1989." };
    } },

  { id:"mirels", cat:"Oncology", icon:"", title:"Mirels Score (Pathological Fracture Risk)",
    desc:"Fracture risk of a long-bone metastasis.",
    inputs:[
      { id:"site", label:"Site", type:"select", opts:[{v:"1",t:"Upper limb"},{v:"2",t:"Lower limb"},{v:"3",t:"Peritrochanteric"}] },
      { id:"pain", label:"Pain", type:"select", opts:[{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Functional / severe"}] },
      { id:"lesion", label:"Lesion type", type:"select", opts:[{v:"1",t:"Blastic"},{v:"2",t:"Mixed"},{v:"3",t:"Lytic"}] },
      { id:"size", label:"Size (fraction of cortex involved)", type:"select", opts:[{v:"1",t:"< 1/3"},{v:"2",t:"1/3–2/3"},{v:"3",t:"> 2/3"}] }
    ],
    compute:function(v){
      var s=Number(v.site)+Number(v.pain)+Number(v.lesion)+Number(v.size);
      var b=s>=9?"Impending fracture — prophylactic fixation generally recommended":s===8?"Borderline — consider fixation":"Lower risk — radiotherapy/observation may be appropriate";
      return { v:s, u:"points", i:b+". Ref: Mirels, Clin Orthop Relat Res 1989." };
    } },

  { id:"epds", cat:"Psychiatry", icon:"", title:"Edinburgh Postnatal Depression Scale (EPDS)",
    desc:"Screens for perinatal depression (past 7 days).",
    inputs:[
      { id:"q1", label:"Able to laugh and see the funny side", type:"select", opts:[{v:"0",t:"As much as always"},{v:"1",t:"Not quite so much"},{v:"2",t:"Definitely less"},{v:"3",t:"Not at all"}] },
      { id:"q2", label:"Looked forward to things with enjoyment", type:"select", opts:[{v:"0",t:"As much as ever"},{v:"1",t:"Rather less"},{v:"2",t:"Definitely less"},{v:"3",t:"Hardly at all"}] },
      { id:"q3", label:"Blamed myself unnecessarily when things went wrong", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Not very often"},{v:"2",t:"Yes, some of the time"},{v:"3",t:"Yes, most of the time"}] },
      { id:"q4", label:"Anxious or worried for no good reason", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Hardly ever"},{v:"2",t:"Yes, sometimes"},{v:"3",t:"Yes, very often"}] },
      { id:"q5", label:"Scared or panicky for no good reason", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"No, not much"},{v:"2",t:"Yes, sometimes"},{v:"3",t:"Yes, quite a lot"}] },
      { id:"q6", label:"Things have been getting on top of me", type:"select", opts:[{v:"0",t:"Coping as well as ever"},{v:"1",t:"Mostly coping"},{v:"2",t:"Not coping at times"},{v:"3",t:"Not coping at all"}] },
      { id:"q7", label:"So unhappy I had difficulty sleeping", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Not very often"},{v:"2",t:"Yes, sometimes"},{v:"3",t:"Yes, most of the time"}] },
      { id:"q8", label:"Felt sad or miserable", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Not very often"},{v:"2",t:"Yes, quite often"},{v:"3",t:"Yes, most of the time"}] },
      { id:"q9", label:"So unhappy that I have been crying", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Only occasionally"},{v:"2",t:"Yes, quite often"},{v:"3",t:"Yes, most of the time"}] },
      { id:"q10", label:"Thought of harming myself", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Hardly ever"},{v:"2",t:"Sometimes"},{v:"3",t:"Yes, quite often"}] }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=10;i++) s+=Number(v["q"+i]);
      var self=Number(v.q10)>0;
      var b=s>=13?"Probable depression — further assessment indicated":s>=10?"Possible depression — consider follow-up":"Lower likelihood of depression";
      return { v:s, u:"/30", i:b+(self?". POSITIVE self-harm item — assess safety urgently":"")+". Ref: Cox, Br J Psychiatry 1987." };
    } },

  { id:"gds15", cat:"Psychiatry", icon:"", title:"Geriatric Depression Scale (GDS-15)",
    desc:"Depression screen in older adults. Tick each item that is TRUE for the patient.",
    inputs:[
      { id:"ga", label:"NOT satisfied with your life", type:"check" },
      { id:"gb", label:"Dropped many activities and interests", type:"check" },
      { id:"gc", label:"Feel that your life is empty", type:"check" },
      { id:"gd", label:"Often get bored", type:"check" },
      { id:"ge", label:"NOT in good spirits most of the time", type:"check" },
      { id:"gf", label:"Afraid something bad will happen to you", type:"check" },
      { id:"gg", label:"NOT feeling happy most of the time", type:"check" },
      { id:"gh", label:"Often feel helpless", type:"check" },
      { id:"gi", label:"Prefer to stay in rather than go out", type:"check" },
      { id:"gj", label:"More problems with memory than most", type:"check" },
      { id:"gk", label:"NOT think it wonderful to be alive now", type:"check" },
      { id:"gl", label:"Feel worthless the way you are now", type:"check" },
      { id:"gm", label:"NOT feeling full of energy", type:"check" },
      { id:"gn", label:"Feel your situation is hopeless", type:"check" },
      { id:"go", label:"Think most people are better off than you", type:"check" }
    ],
    compute:function(v){
      var s=0; ["ga","gb","gc","gd","ge","gf","gg","gh","gi","gj","gk","gl","gm","gn","go"].forEach(function(k){ if(v[k]) s++; });
      var b=s<=4?"Normal":s<=8?"Mild depression":s<=11?"Moderate depression":"Severe depression";
      return { v:s, u:"/15", i:b+". Ref: Sheikh & Yesavage, 1986 (GDS-15)." };
    } },

  { id:"karnofsky", cat:"Oncology", icon:"", title:"Karnofsky Performance Status",
    desc:"Functional status in cancer / palliative care.",
    inputs:[
      { id:"kps", label:"Performance status", type:"select", opts:[
        {v:"100",t:"100 — Normal, no complaints"},{v:"90",t:"90 — Minor symptoms"},{v:"80",t:"80 — Normal activity with effort"},
        {v:"70",t:"70 — Cares for self, cannot work"},{v:"60",t:"60 — Needs occasional assistance"},{v:"50",t:"50 — Needs considerable assistance"},
        {v:"40",t:"40 — Disabled, needs special care"},{v:"30",t:"30 — Severely disabled"},{v:"20",t:"20 — Very sick, active support needed"},
        {v:"10",t:"10 — Moribund"},{v:"0",t:"0 — Dead"} ] }
    ],
    compute:function(v){
      var k=Number(v.kps);
      var b=k>=80?"Able to carry on normal activity; no special care needed":k>=50?"Unable to work; lives at home, varying assistance needed":"Unable to care for self; institutional or hospital care needed";
      return { v:k, u:"%", i:b+". Ref: Karnofsky & Burchenal 1949." };
    } },

  { id:"ecog", cat:"Oncology", icon:"", title:"ECOG Performance Status",
    desc:"Functional status grade used in oncology.",
    inputs:[
      { id:"ps", label:"ECOG grade", type:"select", opts:[
        {v:"0",t:"0 — Fully active"},{v:"1",t:"1 — Restricted in strenuous activity, ambulatory"},{v:"2",t:"2 — Ambulatory, self-care, up >50% of waking hours"},
        {v:"3",t:"3 — Limited self-care, confined to bed/chair >50%"},{v:"4",t:"4 — Completely disabled, no self-care"},{v:"5",t:"5 — Dead"} ] }
    ],
    compute:function(v){
      var e=Number(v.ps);
      var m={0:"Fully active, able to carry on all pre-disease activity",1:"Restricted in strenuous activity but ambulatory and able to do light work",2:"Ambulatory and capable of self-care but unable to work; up >50% of waking hours",3:"Capable of only limited self-care; confined to bed or chair >50% of waking hours",4:"Completely disabled; cannot carry on any self-care; totally confined",5:"Dead"};
      return { v:e, u:"", i:m[e]+". Ref: Oken, Am J Clin Oncol 1982 (ECOG)." };
    } },

  { id:"logmar", cat:"Ophthalmology", icon:"", title:"Snellen → logMAR Conversion",
    desc:"Converts imperial Snellen acuity (20/D) to a logMAR value.",
    inputs:[
      { id:"d", label:"Snellen denominator (the D in 20/D)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.d)||v.d<=0) return ERR;
      var lm=Math.log10(v.d/20);
      var metric=r0(v.d*0.3);
      return { v:r1(lm), u:"logMAR", i:"Metric equivalent ≈ 6/"+metric+". Higher logMAR = worse acuity (0.0 = 20/20). Ref: standard optotype conversion." };
    } },

  { id:"rass", cat:"Critical care", icon:"", title:"Richmond Agitation-Sedation Scale (RASS)",
    desc:"Level of agitation or sedation in critically ill patients.",
    inputs:[
      { id:"rass", label:"Observed state", type:"select", opts:[
        {v:"0",t:"0 Alert and calm"},{v:"1",t:"+1 Restless"},{v:"2",t:"+2 Agitated"},{v:"3",t:"+3 Very agitated"},{v:"4",t:"+4 Combative"},
        {v:"-1",t:"−1 Drowsy (>10s eye contact to voice)"},{v:"-2",t:"−2 Light sedation (<10s eye contact)"},{v:"-3",t:"−3 Moderate sedation (movement, no eye contact)"},
        {v:"-4",t:"−4 Deep sedation (responds to physical stimulus only)"},{v:"-5",t:"−5 Unarousable"} ] }
    ],
    compute:function(v){
      var r=Number(v.rass);
      var m={"4":"Combative — immediate danger to staff","3":"Very agitated","2":"Agitated","1":"Restless","0":"Alert and calm","-1":"Drowsy","-2":"Light sedation","-3":"Moderate sedation","-4":"Deep sedation","-5":"Unarousable"};
      return { v:(r>0?"+":"")+r, u:"", i:m[String(r)]+". Target is usually 0 to −2 unless deep sedation indicated. Ref: Sessler, AJRCCM 2002." };
    } },

  { id:"downes", cat:"Paediatrics", icon:"", title:"Downes Score (Neonatal Respiratory Distress)",
    desc:"Severity of respiratory distress in neonates.",
    inputs:[
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"0",t:"< 60/min"},{v:"1",t:"60–80/min"},{v:"2",t:"> 80/min"}] },
      { id:"cyan", label:"Cyanosis", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"In room air"},{v:"2",t:"Persists in supplemental O₂"}] },
      { id:"air", label:"Air entry", type:"select", opts:[{v:"0",t:"Good"},{v:"1",t:"Decreased"},{v:"2",t:"Barely audible"}] },
      { id:"grunt", label:"Grunting", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Audible with stethoscope"},{v:"2",t:"Audible without stethoscope"}] },
      { id:"retr", label:"Retractions", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Severe"}] }
    ],
    compute:function(v){
      var s=Number(v.rr)+Number(v.cyan)+Number(v.air)+Number(v.grunt)+Number(v.retr);
      var b=s===0?"No respiratory distress":s<4?"Mild respiratory distress":s<=6?"Moderate distress — monitor closely":"Impending respiratory failure — urgent support";
      return { v:s, u:"/10", i:b+". Ref: Downes, Clin Pediatr 1970." };
    } },

  { id:"pas", cat:"Paediatrics", icon:"", title:"Paediatric Appendicitis Score (PAS)",
    desc:"Likelihood of appendicitis in children with abdominal pain.",
    inputs:[
      { id:"cough", label:"Cough / percussion / hopping tenderness in RLQ", type:"check" },
      { id:"rlq", label:"Right lower quadrant tenderness", type:"check" },
      { id:"anorexia", label:"Anorexia", type:"check" },
      { id:"fever", label:"Pyrexia", type:"check" },
      { id:"nausea", label:"Nausea or vomiting", type:"check" },
      { id:"migration", label:"Migration of pain to RLQ", type:"check" },
      { id:"leuko", label:"Leucocytosis", type:"check" },
      { id:"neutro", label:"Neutrophilia (left shift)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.cough)s+=2; if(v.rlq)s+=2; if(v.anorexia)s++; if(v.fever)s++; if(v.nausea)s++; if(v.migration)s++; if(v.leuko)s++; if(v.neutro)s++;
      var b=s<=3?"Low probability — appendicitis unlikely":s<=6?"Indeterminate — observe / consider imaging":"High probability — surgical assessment";
      return { v:s, u:"/10", i:b+". Ref: Samuel, J Pediatr Surg 2002." };
    } },

  { id:"pittsburgh_knee", cat:"Musculoskeletal", icon:"", title:"Pittsburgh Knee Rules",
    desc:"Whether a knee X-ray is indicated after injury.",
    inputs:[
      { id:"mech", label:"Blunt trauma or a fall (mechanism)", type:"check" },
      { id:"young", label:"Age < 12 years", type:"check" },
      { id:"old", label:"Age > 50 years", type:"check" },
      { id:"walk", label:"Unable to walk 4 weight-bearing steps", type:"check" }
    ],
    compute:function(v){
      var xr = v.mech && (v.young || v.old || v.walk);
      return { v: xr?"X-ray indicated":"X-ray not indicated", u:"", i:(xr?"Meets Pittsburgh criteria — radiograph the knee":"Does not meet criteria — imaging can usually be deferred")+". Requires a fall/blunt-trauma mechanism. Ref: Seaberg, Ann Emerg Med 1998." };
    } },

  { id:"fai", cat:"Endocrine", icon:"", title:"Free Androgen Index (FAI)",
    desc:"Estimate of bioavailable testosterone.",
    inputs:[
      { id:"testo", label:"Total testosterone", type:"number", unit:"nmol/L", step:"0.1" },
      { id:"shbg", label:"SHBG", type:"number", unit:"nmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.testo)||!ok(v.shbg)||v.shbg<=0) return ERR;
      var fai=(v.testo/v.shbg)*100;
      return { v:r1(fai), u:"", i:"Raised values support hyperandrogenism (e.g. PCOS); interpret against sex-specific reference ranges. Ref: standard endocrinology." };
    } },

  { id:"quicki", cat:"Endocrine", icon:"", title:"QUICKI (Insulin Sensitivity)",
    desc:"Quantitative insulin-sensitivity check index from fasting values.",
    inputs:[
      { id:"ins", label:"Fasting insulin", type:"number", unit:"µU/mL", step:"0.1" },
      { id:"glu", label:"Fasting glucose", type:"number", unit:"mg/dL", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.ins)||!ok(v.glu)||v.ins<=0||v.glu<=0) return ERR;
      var d=Math.log10(v.ins)+Math.log10(v.glu);
      if(!isFinite(d)||d===0) return ERR;
      var q=1/d, qr=Math.round(q*1000)/1000;
      var b=q>=0.37?"Within the insulin-sensitive range":q>=0.33?"Reduced insulin sensitivity":"Marked insulin resistance";
      return { v:qr, u:"", i:b+" (glucose mg/dL; higher = more sensitive). No universal cut-off — healthy mean ≈0.38, obese ≈0.33, type-2 diabetes ≈0.30; interpret against local reference. Ref: Katz, J Clin Endocrinol Metab 2000." };
    } },

  { id:"basdai", cat:"Rheumatology", icon:"", title:"BASDAI — Score Interpreter",
    desc:"Interprets a Bath Ankylosing Spondylitis Disease Activity Index result. Administer the official BASDAI and enter the 0–10 score.",
    inputs:[
      { id:"score", label:"BASDAI score (0–10)", type:"number", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.score)||v.score<0||v.score>10) return ERR;
      var b=v.score>=4?"Active disease — consider treatment escalation":"Lower disease activity";
      return { v:r1(v.score), u:"/10", i:b+" (≥4 indicates active disease). Ref: Garrett, J Rheumatol 1994 (BASDAI)." };
    } },

  { id:"forrest", cat:"Gastroenterology", icon:"", title:"Forrest Classification (Ulcer Bleeding)",
    desc:"Endoscopic appearance of a peptic ulcer and rebleeding risk.",
    inputs:[
      { id:"cls", label:"Endoscopic appearance", type:"select", opts:[
        {v:"ia",t:"Ia — active spurting"},{v:"ib",t:"Ib — active oozing"},{v:"iia",t:"IIa — non-bleeding visible vessel"},
        {v:"iib",t:"IIb — adherent clot"},{v:"iic",t:"IIc — flat pigmented spot"},{v:"iii",t:"III — clean base"} ] }
    ],
    compute:function(v){
      var m={ia:"High rebleed risk — endoscopic haemostasis indicated",ib:"High rebleed risk — endoscopic haemostasis indicated",iia:"High rebleed risk — endoscopic haemostasis indicated",iib:"Intermediate risk — consider clot removal and treatment",iic:"Low rebleed risk",iii:"Low rebleed risk"};
      return { v:"Forrest "+v.cls.toUpperCase(), u:"", i:m[v.cls]+". Ref: Forrest, Lancet 1974." };
    } },

  { id:"gap_ipf", cat:"Respiratory", icon:"", title:"GAP Index (IPF Mortality)",
    desc:"Mortality staging in idiopathic pulmonary fibrosis.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"0",t:"Female"},{v:"1",t:"Male"}] },
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" },
      { id:"fvc", label:"FVC (% predicted)", type:"number", unit:"%", step:"1" },
      { id:"nodlco", label:"DLCO cannot be performed", type:"check" },
      { id:"dlco", label:"DLCO (% predicted)", type:"number", unit:"%", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.fvc)) return ERR;
      if(!v.nodlco && !ok(v.dlco)) return ERR;
      var s=Number(v.sex);
      s += v.age<=60?0 : v.age<=65?1 : 2;
      s += v.fvc>75?0 : v.fvc>=50?1 : 2;
      s += v.nodlco?3 : (v.dlco>55?0 : v.dlco>=36?1 : 2);
      var stage=s<=3?"I":s<=5?"II":"III";
      var b=stage==="I"?"Stage I — lowest mortality":stage==="II"?"Stage II — intermediate mortality":"Stage III — highest mortality";
      return { v:"Stage "+stage+" ("+s+" pts)", u:"", i:b+". Ref: Ley, Ann Intern Med 2012 (GAP)." };
    } },

  { id:"canadian_syncope", cat:"Cardiovascular", icon:"", title:"Canadian Syncope Risk Score",
    desc:"30-day risk of a serious adverse event after emergency-department syncope.",
    inputs:[
      { id:"vaso", label:"Predisposition to vasovagal symptoms", type:"check" },
      { id:"heart", label:"History of heart disease", type:"check" },
      { id:"bp", label:"Any SBP < 90 or > 180 mmHg", type:"check" },
      { id:"trop", label:"Elevated troponin (> 99th percentile)", type:"check" },
      { id:"axis", label:"Abnormal QRS axis", type:"check" },
      { id:"qrs", label:"QRS duration > 130 ms", type:"check" },
      { id:"qtc", label:"Corrected QT > 480 ms", type:"check" },
      { id:"dx", label:"ED probable diagnosis", type:"select", opts:[{v:"0",t:"Neither"},{v:"-2",t:"Vasovagal syncope"},{v:"2",t:"Cardiac syncope"}] }
    ],
    compute:function(v){
      var s=0; if(v.vaso)s-=1; if(v.heart)s+=1; if(v.bp)s+=2; if(v.trop)s+=2; if(v.axis)s+=1; if(v.qrs)s+=1; if(v.qtc)s+=2; s+=Number(v.dx);
      var b=s<=-2?"Very low risk":s<=0?"Low risk":s<=3?"Medium risk":s<=5?"High risk":"Very high risk";
      return { v:s, u:"points", i:b+" of a 30-day serious adverse event. Ref: Thiruganasambandamoorthy, JAMA Intern Med 2016." };
    } },

  { id:"albi", cat:"Hepatology", icon:"", title:"ALBI Grade (Albumin-Bilirubin)",
    desc:"Liver-function grade (e.g. in hepatocellular carcinoma).",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"number", unit:"µmol/L", step:"1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.bili)||!ok(v.alb)||v.bili<=0||v.alb<=0) return ERR;
      var score=(Math.log10(v.bili)*0.66)+(v.alb*-0.085);
      var grade=score<=-2.60?"1":score<=-1.39?"2":"3";
      var b=grade==="1"?"Grade 1 — best liver function / prognosis":grade==="2"?"Grade 2 — intermediate":"Grade 3 — worst liver function / prognosis";
      return { v:"Grade "+grade, u:"", i:b+" (bilirubin µmol/L, albumin g/L). Ref: Johnson, J Clin Oncol 2015 (ALBI)." };
    } },

  { id:"khorana", cat:"Oncology", icon:"", title:"Khorana Score (Chemotherapy VTE Risk)",
    desc:"Venous thromboembolism risk in ambulatory cancer patients starting chemotherapy.",
    inputs:[
      { id:"site", label:"Cancer site", type:"select", opts:[{v:"0",t:"Other"},{v:"1",t:"High risk (lung, lymphoma, gynae, bladder, testicular)"},{v:"2",t:"Very high risk (stomach, pancreas)"}] },
      { id:"plt", label:"Platelet count ≥ 350 ×10⁹/L", type:"check" },
      { id:"hb", label:"Haemoglobin < 10 g/dL or using an ESA", type:"check" },
      { id:"wbc", label:"Leukocyte count > 11 ×10⁹/L", type:"check" },
      { id:"bmi", label:"BMI ≥ 35 kg/m²", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.site); if(v.plt)s++; if(v.hb)s++; if(v.wbc)s++; if(v.bmi)s++;
      var b=s===0?"Low VTE risk":s<=2?"Intermediate VTE risk":"High VTE risk — consider thromboprophylaxis";
      return { v:s, u:"points", i:b+". Ref: Khorana, Blood 2008." };
    } },

  { id:"must", cat:"General", icon:"", title:"MUST (Malnutrition Universal Screening Tool)",
    desc:"Malnutrition risk in adults.",
    inputs:[
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"loss", label:"Unplanned weight loss (past 3–6 months)", type:"select", opts:[{v:"0",t:"< 5%"},{v:"1",t:"5–10%"},{v:"2",t:"> 10%"}] },
      { id:"acute", label:"Acutely ill AND no nutritional intake for > 5 days", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.bmi)) return ERR;
      var s=0; s += v.bmi>20?0 : v.bmi>=18.5?1 : 2; s+=Number(v.loss); if(v.acute)s+=2;
      var b=s===0?"Low malnutrition risk — routine care":s===1?"Medium risk — observe and document intake":"High risk — treat / refer to dietitian";
      return { v:s, u:"points", i:b+". Ref: BAPEN (MUST)." };
    } },

  { id:"nyha", cat:"Cardiovascular", icon:"", title:"NYHA Functional Classification",
    desc:"Symptom-based functional class in heart failure.",
    inputs:[
      { id:"cls", label:"Functional status", type:"select", opts:[
        {v:"1",t:"I — no limitation of ordinary activity"},{v:"2",t:"II — slight limitation; symptoms with ordinary activity"},
        {v:"3",t:"III — marked limitation; symptoms with less-than-ordinary activity"},{v:"4",t:"IV — symptoms at rest"} ] }
    ],
    compute:function(v){
      var m={1:"Class I — no limitation of physical activity",2:"Class II — slight limitation; comfortable at rest",3:"Class III — marked limitation; comfortable only at rest",4:"Class IV — symptoms at rest, worsened by any activity"};
      return { v:"Class "+["","I","II","III","IV"][Number(v.cls)], u:"", i:m[Number(v.cls)]+". Ref: New York Heart Association." };
    } },

  { id:"hoehn_yahr", cat:"Neurology", icon:"", title:"Hoehn and Yahr Staging (Parkinson's)",
    desc:"Clinical staging of Parkinson's disease severity.",
    inputs:[
      { id:"stage", label:"Stage", type:"select", opts:[
        {v:"1",t:"1 — unilateral involvement only"},{v:"2",t:"2 — bilateral, no balance impairment"},
        {v:"3",t:"3 — bilateral with postural instability; physically independent"},{v:"4",t:"4 — severe disability; still able to walk/stand unassisted"},
        {v:"5",t:"5 — wheelchair-bound or bedridden unless aided"} ] }
    ],
    compute:function(v){
      var m={1:"Unilateral disease — minimal functional impairment",2:"Bilateral disease without balance impairment",3:"Bilateral disease with postural instability; remains independent",4:"Severe disability but still able to walk or stand unassisted",5:"Wheelchair-bound or bedridden without assistance"};
      return { v:"Stage "+v.stage, u:"", i:m[Number(v.stage)]+". Ref: Hoehn & Yahr, Neurology 1967." };
    } },

  { id:"epworth", cat:"Neurology", icon:"", title:"Epworth Sleepiness Scale",
    desc:"Daytime sleepiness from the chance of dozing in 8 situations.",
    inputs:[
      { id:"s1", label:"Sitting and reading", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s2", label:"Watching television", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s3", label:"Sitting inactive in a public place", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s4", label:"Passenger in a car for an hour without a break", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s5", label:"Lying down to rest in the afternoon", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s6", label:"Sitting and talking to someone", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s7", label:"Sitting quietly after lunch (no alcohol)", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] },
      { id:"s8", label:"In a car, stopped in traffic", type:"select", opts:[{v:"0",t:"Would never doze"},{v:"1",t:"Slight chance"},{v:"2",t:"Moderate chance"},{v:"3",t:"High chance"}] }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=8;i++) s+=Number(v["s"+i]);
      var b=s<=5?"Lower normal daytime sleepiness":s<=10?"Higher normal daytime sleepiness":s<=12?"Mild excessive daytime sleepiness":s<=15?"Moderate excessive daytime sleepiness":"Severe excessive daytime sleepiness";
      return { v:s, u:"/24", i:b+". Ref: Johns, Sleep 1991." };
    } },

  { id:"spetzler_martin", cat:"Neurology", icon:"", title:"Spetzler-Martin AVM Grade",
    desc:"Surgical risk grade for a brain arteriovenous malformation.",
    inputs:[
      { id:"size", label:"Size of nidus", type:"select", opts:[{v:"1",t:"Small (< 3 cm)"},{v:"2",t:"Medium (3–6 cm)"},{v:"3",t:"Large (> 6 cm)"}] },
      { id:"eloq", label:"Adjacent eloquent brain", type:"select", opts:[{v:"0",t:"Non-eloquent"},{v:"1",t:"Eloquent"}] },
      { id:"venous", label:"Venous drainage", type:"select", opts:[{v:"0",t:"Superficial only"},{v:"1",t:"Deep component"}] }
    ],
    compute:function(v){
      var s=Number(v.size)+Number(v.eloq)+Number(v.venous);
      var b=s<=2?"Lower surgical risk":s===3?"Intermediate surgical risk":"Higher surgical risk";
      return { v:"Grade "+["","I","II","III","IV","V"][s], u:"", i:b+" (higher grade = greater operative morbidity). Ref: Spetzler & Martin, J Neurosurg 1986." };
    } },

  { id:"murray", cat:"Critical care", icon:"", title:"Murray Lung Injury Score",
    desc:"Severity of acute lung injury / ARDS.",
    inputs:[
      { id:"cxr", label:"Chest X-ray (quadrants with consolidation)", type:"select", opts:[{v:"0",t:"No consolidation"},{v:"1",t:"1 quadrant"},{v:"2",t:"2 quadrants"},{v:"3",t:"3 quadrants"},{v:"4",t:"4 quadrants"}] },
      { id:"hypox", label:"Hypoxaemia (PaO₂/FiO₂)", type:"select", opts:[{v:"0",t:"≥ 300"},{v:"1",t:"225–299"},{v:"2",t:"175–224"},{v:"3",t:"100–174"},{v:"4",t:"< 100"}] },
      { id:"peep", label:"PEEP (if ventilated)", type:"select", opts:[{v:"0",t:"≤ 5"},{v:"1",t:"6–8"},{v:"2",t:"9–11"},{v:"3",t:"12–14"},{v:"4",t:"≥ 15"}] },
      { id:"comp", label:"Compliance (mL/cmH₂O)", type:"select", opts:[{v:"0",t:"≥ 80"},{v:"1",t:"60–79"},{v:"2",t:"40–59"},{v:"3",t:"20–39"},{v:"4",t:"≤ 19"}] }
    ],
    compute:function(v){
      var s=(Number(v.cxr)+Number(v.hypox)+Number(v.peep)+Number(v.comp))/4;
      var b=s===0?"No lung injury":s<=2.5?"Mild-to-moderate lung injury":"Severe lung injury (ARDS)";
      return { v:r1(s), u:"", i:b+". Ref: Murray, Am Rev Respir Dis 1988." };
    } },

  { id:"kdigo_aki", cat:"Renal", icon:"", title:"KDIGO AKI Staging",
    desc:"Stages acute kidney injury by creatinine and urine output.",
    inputs:[
      { id:"cr", label:"Creatinine criterion", type:"select", opts:[
        {v:"0",t:"No significant rise"},{v:"1",t:"1.5–1.9× baseline or ≥0.3 mg/dL rise"},{v:"2",t:"2.0–2.9× baseline"},{v:"3",t:"≥3× baseline, ≥4.0 mg/dL, or on RRT"} ] },
      { id:"uo", label:"Urine output criterion", type:"select", opts:[
        {v:"0",t:"Adequate"},{v:"1",t:"< 0.5 mL/kg/h for 6–12 h"},{v:"2",t:"< 0.5 mL/kg/h for ≥12 h"},{v:"3",t:"< 0.3 mL/kg/h for ≥24 h or anuria ≥12 h"} ] }
    ],
    compute:function(v){
      var s=Math.max(Number(v.cr),Number(v.uo));
      return { v:s===0?"No AKI":"Stage "+s, u:"", i:(s===0?"Does not meet KDIGO AKI criteria":"AKI stage "+s+" (highest of the creatinine and urine-output criteria)")+". Ref: KDIGO 2012." };
    } },

  { id:"milan", cat:"Hepatology", icon:"", title:"Milan Criteria (HCC Transplant Eligibility)",
    desc:"Whether hepatocellular carcinoma meets Milan criteria for transplantation.",
    inputs:[
      { id:"single", label:"Single tumour ≤ 5 cm", type:"check" },
      { id:"multi", label:"Up to 3 nodules, each ≤ 3 cm", type:"check" },
      { id:"novasc", label:"No macrovascular invasion", type:"check" },
      { id:"noextra", label:"No extrahepatic spread", type:"check" }
    ],
    compute:function(v){
      var within=(v.single||v.multi)&&v.novasc&&v.noextra;
      return { v: within?"Within Milan criteria":"Outside Milan criteria", u:"", i:(within?"Generally eligible for liver transplantation on tumour burden":"Exceeds Milan tumour burden — standard criteria not met (consider extended criteria)")+". Ref: Mazzaferro, N Engl J Med 1996." };
    } },

  { id:"findrisc", cat:"Endocrine", icon:"", title:"FINDRISC (Type 2 Diabetes Risk)",
    desc:"10-year risk of developing type 2 diabetes.",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"< 45"},{v:"2",t:"45–54"},{v:"3",t:"55–64"},{v:"4",t:"> 64"}] },
      { id:"bmi", label:"BMI", type:"select", opts:[{v:"0",t:"< 25"},{v:"1",t:"25–30"},{v:"3",t:"> 30"}] },
      { id:"waist", label:"Waist circumference", type:"select", opts:[{v:"0",t:"Men <94 / Women <80 cm"},{v:"3",t:"Men 94–102 / Women 80–88 cm"},{v:"4",t:"Men >102 / Women >88 cm"}] },
      { id:"active", label:"≥ 30 min physical activity daily", type:"select", opts:[{v:"0",t:"Yes"},{v:"2",t:"No"}] },
      { id:"veg", label:"Eats vegetables/fruit daily", type:"select", opts:[{v:"0",t:"Yes"},{v:"1",t:"No"}] },
      { id:"bpmed", label:"On blood-pressure medication", type:"select", opts:[{v:"0",t:"No"},{v:"2",t:"Yes"}] },
      { id:"gluc", label:"History of high blood glucose", type:"select", opts:[{v:"0",t:"No"},{v:"5",t:"Yes"}] },
      { id:"fhx", label:"Family history of diabetes", type:"select", opts:[{v:"0",t:"None"},{v:"3",t:"Grandparent / aunt / uncle / cousin"},{v:"5",t:"Parent / sibling / own child"}] }
    ],
    compute:function(v){
      var s=Number(v.age)+Number(v.bmi)+Number(v.waist)+Number(v.active)+Number(v.veg)+Number(v.bpmed)+Number(v.gluc)+Number(v.fhx);
      var b=s<7?"Low risk":s<=11?"Slightly elevated risk":s<=14?"Moderate risk":s<=20?"High risk":"Very high risk";
      return { v:s, u:"points", i:b+" of type 2 diabetes over 10 years. Ref: Lindström & Tuomilehto, Diabetes Care 2003 (FINDRISC)." };
    } },

  { id:"caspar", cat:"Rheumatology", icon:"", title:"CASPAR Criteria (Psoriatic Arthritis)",
    desc:"Classification of psoriatic arthritis (requires inflammatory articular disease).",
    inputs:[
      { id:"entry", label:"Inflammatory articular disease (joint / spine / entheseal)", type:"check" },
      { id:"pso", label:"Psoriasis status", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Personal or family history"},{v:"2",t:"Current psoriasis"}] },
      { id:"nail", label:"Psoriatic nail dystrophy", type:"check" },
      { id:"rf", label:"Negative rheumatoid factor", type:"check" },
      { id:"dactyl", label:"Current or prior dactylitis", type:"check" },
      { id:"xray", label:"Juxta-articular new bone formation on X-ray", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.pso); if(v.nail)s++; if(v.rf)s++; if(v.dactyl)s++; if(v.xray)s++;
      var meets=v.entry && s>=3;
      return { v: meets?"Meets CASPAR ("+s+" pts)":"Does not meet ("+s+" pts)", u:"", i:(v.entry?(meets?"Classifiable as psoriatic arthritis":"Inflammatory articular disease present but < 3 criteria points"):"Entry requirement (inflammatory articular disease) not met")+". Ref: Taylor, Arthritis Rheum 2006 (CASPAR)." };
    } },

  { id:"hscore", cat:"Haematology", icon:"", title:"HScore (Haemophagocytic Syndrome)",
    desc:"Probability of reactive haemophagocytic lymphohistiocytosis (HLH).",
    inputs:[
      { id:"immuno", label:"Known underlying immunosuppression", type:"select", opts:[{v:"0",t:"No"},{v:"18",t:"Yes"}] },
      { id:"temp", label:"Temperature", type:"select", opts:[{v:"0",t:"< 38.4°C"},{v:"33",t:"38.4–39.4°C"},{v:"49",t:"> 39.4°C"}] },
      { id:"organ", label:"Organomegaly", type:"select", opts:[{v:"0",t:"None"},{v:"23",t:"Hepatomegaly or splenomegaly"},{v:"38",t:"Both"}] },
      { id:"cyto", label:"Cytopenias (lineages affected)", type:"select", opts:[{v:"0",t:"1 lineage"},{v:"24",t:"2 lineages"},{v:"34",t:"3 lineages"}] },
      { id:"ferr", label:"Ferritin", type:"select", opts:[{v:"0",t:"< 2000 ng/mL"},{v:"35",t:"2000–6000 ng/mL"},{v:"50",t:"> 6000 ng/mL"}] },
      { id:"trig", label:"Triglycerides", type:"select", opts:[{v:"0",t:"< 1.5 mmol/L"},{v:"44",t:"1.5–4 mmol/L"},{v:"64",t:"> 4 mmol/L"}] },
      { id:"fib", label:"Fibrinogen", type:"select", opts:[{v:"0",t:"> 2.5 g/L"},{v:"30",t:"≤ 2.5 g/L"}] },
      { id:"ast", label:"AST", type:"select", opts:[{v:"0",t:"< 30 IU/L"},{v:"19",t:"≥ 30 IU/L"}] },
      { id:"marrow", label:"Haemophagocytosis on marrow aspirate", type:"select", opts:[{v:"0",t:"No"},{v:"35",t:"Yes"}] }
    ],
    compute:function(v){
      var s=Number(v.immuno)+Number(v.temp)+Number(v.organ)+Number(v.cyto)+Number(v.ferr)+Number(v.trig)+Number(v.fib)+Number(v.ast)+Number(v.marrow);
      var b=s<=90?"Low probability of HLH":s<=168?"Intermediate probability":"High probability of HLH";
      return { v:s, u:"points", i:b+" (~169 approximates 50% probability). Ref: Fardet, Arthritis Rheumatol 2014 (HScore)." };
    } },

  { id:"plasmic", cat:"Haematology", icon:"", title:"PLASMIC Score (TTP Likelihood)",
    desc:"Predicts severe ADAMTS13 deficiency (TTP) in thrombotic microangiopathy.",
    inputs:[
      { id:"plt", label:"Platelet count < 30 ×10⁹/L", type:"check" },
      { id:"hemol", label:"Haemolysis (retic >2.5%, undetectable haptoglobin, or raised indirect bilirubin)", type:"check" },
      { id:"nocancer", label:"No active cancer", type:"check" },
      { id:"notransplant", label:"No solid-organ or stem-cell transplant", type:"check" },
      { id:"mcv", label:"MCV < 90 fL", type:"check" },
      { id:"inr", label:"INR < 1.5", type:"check" },
      { id:"cr", label:"Creatinine < 2.0 mg/dL", type:"check" }
    ],
    compute:function(v){
      var s=0; ["plt","hemol","nocancer","notransplant","mcv","inr","cr"].forEach(function(k){ if(v[k])s++; });
      var b=s<=4?"Low probability of severe ADAMTS13 deficiency":s===5?"Intermediate probability":"High probability — consider urgent plasma exchange and ADAMTS13 testing";
      return { v:s, u:"/7", i:b+". Ref: Bendapudi, Lancet Haematol 2017 (PLASMIC)." };
    } },

  { id:"cfs", cat:"General", icon:"", title:"Clinical Frailty Scale — Level Interpreter",
    desc:"Assign the CFS level (1–9) using the official Rockwood scale (© Dalhousie University; free for non-commercial clinical use), then enter it here for outcome context.",
    inputs:[
      { id:"level", label:"CFS level (1–9)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.level)||v.level<1||v.level>9) return ERR;
      var n=Math.round(v.level);
      var b=n<=3?"Not frail":n===4?"Vulnerable":n<=6?"Mild-to-moderate frailty":n<=8?"Severe frailty":"Terminally ill";
      return { v:n, u:"/9", i:b+" (higher = more frail; correlates with adverse outcomes). Use the official illustrated scale from Dalhousie University for level definitions. Ref: Rockwood, CMAJ 2005." };
    } },

  { id:"duke_endocarditis", cat:"Infectious disease", icon:"", title:"Modified Duke Criteria (Infective Endocarditis)",
    desc:"Diagnostic likelihood of infective endocarditis (clinical criteria).",
    inputs:[
      { id:"maj_micro", label:"Major: typical blood cultures for IE", type:"check" },
      { id:"maj_endo", label:"Major: endocardial involvement (vegetation/abscess/new regurgitation)", type:"check" },
      { id:"min_predispose", label:"Minor: predisposing heart condition or IV drug use", type:"check" },
      { id:"min_fever", label:"Minor: fever ≥ 38°C", type:"check" },
      { id:"min_vascular", label:"Minor: vascular phenomena (emboli, mycotic aneurysm, Janeway lesions)", type:"check" },
      { id:"min_immuno", label:"Minor: immunologic phenomena (glomerulonephritis, Osler nodes, Roth spots)", type:"check" },
      { id:"min_micro", label:"Minor: microbiological evidence not meeting a major criterion", type:"check" }
    ],
    compute:function(v){
      var maj=(v.maj_micro?1:0)+(v.maj_endo?1:0);
      var min=(v.min_predispose?1:0)+(v.min_fever?1:0)+(v.min_vascular?1:0)+(v.min_immuno?1:0)+(v.min_micro?1:0);
      var def=(maj>=2)||(maj===1&&min>=3)||(min>=5);
      var poss=!def&&((maj===1&&min>=1)||(min>=3));
      var r=def?"Definite IE (clinical criteria)":poss?"Possible IE":"IE unlikely by clinical criteria";
      return { v:r, u:"", i:maj+" major, "+min+" minor. Combine with pathological criteria where available. Ref: Li, Clin Infect Dis 2000 (modified Duke)." };
    } },

  { id:"stess", cat:"Neurology", icon:"", title:"Status Epilepticus Severity Score (STESS)",
    desc:"Prognosis in status epilepticus (assessed before treatment).",
    inputs:[
      { id:"loc", label:"Level of consciousness", type:"select", opts:[{v:"0",t:"Alert or somnolent/confused"},{v:"1",t:"Stuporous or comatose"}] },
      { id:"type", label:"Worst seizure type", type:"select", opts:[{v:"0",t:"Simple partial, complex partial or absence"},{v:"1",t:"Generalised convulsive"},{v:"2",t:"Nonconvulsive SE in coma"}] },
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"< 65 years"},{v:"2",t:"≥ 65 years"}] },
      { id:"prior", label:"History of prior seizures", type:"select", opts:[{v:"0",t:"Yes"},{v:"1",t:"No or unknown"}] }
    ],
    compute:function(v){
      var s=Number(v.loc)+Number(v.type)+Number(v.age)+Number(v.prior);
      var b=s>=3?"Unfavourable outcome more likely":"Favourable outcome more likely";
      return { v:s, u:"/6", i:b+". Ref: Rossetti, J Neurol 2008 (STESS)." };
    } },

  { id:"bicarb_deficit", cat:"Renal", icon:"", title:"Bicarbonate Deficit",
    desc:"Estimated bicarbonate deficit in metabolic acidosis.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"measured", label:"Measured bicarbonate", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"target", label:"Target bicarbonate", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.measured)||!ok(v.target)||v.wt<=0) return ERR;
      var d=0.5*v.wt*(v.target-v.measured);
      if(d<=0) return { err:"Measured bicarbonate already at or above target" };
      return { v:r0(d), u:"mmol", i:"Estimated total bicarbonate deficit; replace cautiously and reassess (avoid rapid full correction). Ref: standard acid-base." };
    } },

  { id:"cat_copd", cat:"Respiratory", icon:"", title:"COPD Assessment Test (CAT)",
    desc:"Health-status impact of COPD (each item 0–5).",
    inputs:[
      { id:"c1", label:"Cough (0 never – 5 all the time)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c2", label:"Phlegm (0 none – 5 completely full)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c3", label:"Chest tightness (0 none – 5 very tight)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c4", label:"Breathlessness on hills/stairs (0 none – 5 very breathless)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c5", label:"Limitation of home activities (0 none – 5 very limited)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c6", label:"Confidence leaving home (0 confident – 5 not at all)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c7", label:"Sleep (0 sound – 5 very poor)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"c8", label:"Energy (0 lots – 5 none)", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=8;i++) s+=Number(v["c"+i]);
      var b=s<10?"Low impact":s<=20?"Medium impact":s<=30?"High impact":"Very high impact";
      return { v:s, u:"/40", i:b+" of COPD on health status. Ref: Jones, Eur Respir J 2009 (CAT)." };
    } },

  { id:"ibw", cat:"General", icon:"", title:"Ideal Body Weight (Devine)",
    desc:"Ideal body weight for drug dosing and ventilation.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ht)||v.ht<=0) return ERR;
      var inch=v.ht/2.54, base=v.sex==="f"?45.5:50;
      var ibw=base+2.3*(inch-60);
      if(ibw<30) return { err:"Height too low for the Devine formula" };
      return { v:r1(ibw), u:"kg", i:"Devine ideal body weight. Adjusted body weight (obesity) = IBW + 0.4×(actual − IBW). Ref: Devine 1974." };
    } },

  { id:"adjbw", cat:"General", icon:"", title:"Adjusted Body Weight",
    desc:"Adjusted body weight in obesity (from ideal and actual weight).",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" },
      { id:"wt", label:"Actual body weight", type:"number", unit:"kg", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ht)||!ok(v.wt)||v.ht<=0||v.wt<=0) return ERR;
      var inch=v.ht/2.54, base=v.sex==="f"?45.5:50;
      var ibw=base+2.3*(inch-60);
      if(ibw<30) return { err:"Height too low for the Devine formula" };
      var adj=ibw+0.4*(v.wt-ibw);
      return { v:r1(adj), u:"kg", i:"Adjusted body weight (IBW "+r1(ibw)+" kg). Used for dosing some drugs in obesity. Ref: standard pharmacokinetics." };
    } },

  { id:"hunter_serotonin", cat:"Toxicology", icon:"", title:"Hunter Serotonin Toxicity Criteria",
    desc:"Diagnoses serotonin toxicity in a patient taking a serotonergic agent.",
    inputs:[
      { id:"spont", label:"Spontaneous clonus", type:"check" },
      { id:"induce", label:"Inducible clonus", type:"check" },
      { id:"ocular", label:"Ocular clonus", type:"check" },
      { id:"agit", label:"Agitation", type:"check" },
      { id:"diaph", label:"Diaphoresis", type:"check" },
      { id:"tremor", label:"Tremor", type:"check" },
      { id:"hyperref", label:"Hyperreflexia", type:"check" },
      { id:"hypertonia", label:"Hypertonia", type:"check" },
      { id:"hyperthermia", label:"Temperature > 38°C", type:"check" }
    ],
    compute:function(v){
      var pos = v.spont
        || (v.induce && (v.agit||v.diaph))
        || (v.ocular && (v.agit||v.diaph))
        || (v.tremor && v.hyperref)
        || (v.hypertonia && v.hyperthermia && (v.ocular||v.induce));
      return { v: pos?"Meets serotonin toxicity criteria":"Does not meet criteria", u:"", i:(pos?"Consistent with serotonin toxicity in the context of a serotonergic agent — stop the agent and treat supportively":"Hunter criteria not met; reassess if the picture evolves")+". Ref: Dunkley, QJM 2003 (Hunter)." };
    } },

  { id:"ganzoni", cat:"Haematology", icon:"", title:"Ganzoni Iron Deficit",
    desc:"Total iron deficit for iron-replacement dosing.",
    inputs:[
      { id:"wt", label:"Body weight", type:"number", unit:"kg", step:"0.1" },
      { id:"hb", label:"Actual haemoglobin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"target", label:"Target haemoglobin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"stores", label:"Iron stores to replace", type:"number", unit:"mg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.hb)||!ok(v.target)||!ok(v.stores)||v.wt<=0||v.stores<0) return ERR;
      if(v.target<=v.hb) return { err:"Actual haemoglobin already at or above target" };
      var d=v.wt*(v.target-v.hb)*2.4+v.stores;
      return { v:r0(d), u:"mg", i:"Total iron deficit (Ganzoni). Adult iron stores typically ~500 mg. Verify against the chosen iron product. Ref: Ganzoni 1970." };
    } },

  { id:"fepo4", cat:"Renal", icon:"", title:"Fractional Excretion of Phosphate (FEPO₄)",
    desc:"Distinguishes renal phosphate wasting from appropriate conservation.",
    inputs:[
      { id:"upo4", label:"Urine phosphate", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"ppo4", label:"Plasma phosphate", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"ucr", label:"Urine creatinine (same units as plasma)", type:"number", unit:"µmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.upo4)||!ok(v.pcr)||!ok(v.ppo4)||!ok(v.ucr)||v.ppo4<=0||v.ucr<=0) return ERR;
      var fe=(v.upo4*v.pcr)/(v.ppo4*v.ucr)*100;
      var b=fe>20?"Elevated — suggests renal phosphate wasting":"Lower — suggests appropriate renal conservation";
      return { v:r1(fe), u:"%", i:b+" (enter both creatinines in the same unit). Ref: standard nephrology." };
    } },

  { id:"gcs_p", cat:"Neurology", icon:"", title:"GCS-Pupils Score (GCS-P)",
    desc:"Glasgow Coma Scale combined with pupil reactivity.",
    inputs:[
      { id:"gcs", label:"GCS total (3–15)", type:"number", step:"1" },
      { id:"pupils", label:"Unreactive pupils", type:"select", opts:[{v:"0",t:"Both reactive"},{v:"1",t:"One unreactive"},{v:"2",t:"Both unreactive"}] }
    ],
    compute:function(v){
      if(!ok(v.gcs)||v.gcs<3||v.gcs>15) return ERR;
      var s=v.gcs-Number(v.pupils);
      return { v:s, u:"", i:"GCS-Pupils score (range 1–15); lower values indicate greater severity and worse prognosis. Ref: Brennan & Murray, J Neurosurg 2018." };
    } },

  { id:"charlson", cat:"General", icon:"", title:"Charlson Comorbidity Index",
    desc:"Comorbidity burden and 10-year survival estimate (age-adjusted).",
    inputs:[
      { id:"mi", label:"Myocardial infarction", type:"check" },
      { id:"chf", label:"Congestive heart failure", type:"check" },
      { id:"pvd", label:"Peripheral vascular disease", type:"check" },
      { id:"cvd", label:"Cerebrovascular disease (stroke/TIA)", type:"check" },
      { id:"dementia", label:"Dementia", type:"check" },
      { id:"copd", label:"Chronic pulmonary disease", type:"check" },
      { id:"ctd", label:"Connective tissue disease", type:"check" },
      { id:"pud", label:"Peptic ulcer disease", type:"check" },
      { id:"hemi", label:"Hemiplegia (+2)", type:"check" },
      { id:"renal", label:"Moderate–severe renal disease (+2)", type:"check" },
      { id:"aids", label:"AIDS (+6)", type:"check" },
      { id:"dm", label:"Diabetes", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Uncomplicated"},{v:"2",t:"With end-organ damage"}] },
      { id:"liver", label:"Liver disease", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"3",t:"Moderate–severe"}] },
      { id:"malig", label:"Malignancy", type:"select", opts:[{v:"0",t:"None"},{v:"2",t:"Localised solid tumour, leukaemia or lymphoma"},{v:"6",t:"Metastatic solid tumour"}] },
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"< 50"},{v:"1",t:"50–59"},{v:"2",t:"60–69"},{v:"3",t:"70–79"},{v:"4",t:"≥ 80"}] }
    ],
    compute:function(v){
      var s=0; ["mi","chf","pvd","cvd","dementia","copd","ctd","pud"].forEach(function(k){ if(v[k])s++; });
      if(v.hemi)s+=2; if(v.renal)s+=2; if(v.aids)s+=6;
      s+=Number(v.dm)+Number(v.liver)+Number(v.malig)+Number(v.age);
      var surv=s===0?"~98%":s<=2?"~90%":s<=4?"~50%":"~20% or lower";
      return { v:s, u:"points", i:"Estimated 10-year survival "+surv+" (age-adjusted CCI; higher = greater comorbidity). Ref: Charlson, J Chronic Dis 1987." };
    } },

  { id:"add_rs", cat:"Cardiovascular", icon:"", title:"Aortic Dissection Detection Risk Score (ADD-RS)",
    desc:"Pre-test risk of acute aortic dissection.",
    inputs:[
      { id:"predispose", label:"High-risk condition (Marfan, family history, known aortic/valve disease, recent aortic manipulation, thoracic aneurysm)", type:"check" },
      { id:"pain", label:"High-risk pain (abrupt onset, severe, or ripping/tearing chest/back/abdominal pain)", type:"check" },
      { id:"exam", label:"High-risk exam (pulse deficit / SBP differential, focal neurological deficit with pain, new aortic regurgitation murmur, hypotension/shock)", type:"check" }
    ],
    compute:function(v){
      var s=(v.predispose?1:0)+(v.pain?1:0)+(v.exam?1:0);
      var b=s===0?"Low risk — consider D-dimer / alternative diagnoses":s===1?"Intermediate risk — D-dimer or imaging per pathway":"High risk — proceed to definitive aortic imaging";
      return { v:s, u:"/3", i:b+". Ref: Rogers, Circulation 2011 (ADD-RS)." };
    } },

  { id:"hat", cat:"Neurology", icon:"", title:"HAT Score (Haemorrhage After Thrombolysis)",
    desc:"Risk of symptomatic intracranial haemorrhage after IV thrombolysis.",
    inputs:[
      { id:"nihss", label:"NIHSS", type:"select", opts:[{v:"0",t:"< 10"},{v:"1",t:"10–19"},{v:"2",t:"≥ 20"}] },
      { id:"glu", label:"Glucose > 200 mg/dL (> 11.1 mmol/L) or known diabetes", type:"check" },
      { id:"ct", label:"Hypodensity on baseline CT", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"< 1/3 MCA territory"},{v:"2",t:"≥ 1/3 MCA territory"}] }
    ],
    compute:function(v){
      var s=Number(v.nihss)+(v.glu?1:0)+Number(v.ct);
      var b=s<=1?"Lower risk of symptomatic haemorrhage":s<=2?"Intermediate risk":"High risk of symptomatic haemorrhage";
      return { v:s, u:"/5", i:b+". Ref: Lou, Neurology 2008 (HAT)." };
    } },

  { id:"feua", cat:"Renal", icon:"", title:"Fractional Excretion of Uric Acid (FEUA)",
    desc:"Renal urate handling (e.g. in the work-up of hyponatraemia).",
    inputs:[
      { id:"uua", label:"Urine uric acid", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"pua", label:"Plasma uric acid", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"ucr", label:"Urine creatinine (same units as plasma)", type:"number", unit:"µmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.uua)||!ok(v.pcr)||!ok(v.pua)||!ok(v.ucr)||v.pua<=0||v.ucr<=0) return ERR;
      var fe=(v.uua*v.pcr)/(v.pua*v.ucr)*100;
      var b=fe>11?"Elevated — seen in SIADH and renal urate wasting":"Normal or low fractional excretion";
      return { v:r1(fe), u:"%", i:b+" (enter both creatinines in the same unit). Ref: standard nephrology." };
    } },

  { id:"mdq", cat:"Psychiatry", icon:"", title:"Mood Disorder Questionnaire (MDQ)",
    desc:"Screens for a lifetime history of bipolar spectrum disorder.",
    inputs:[
      { id:"q1", label:"Felt so good/hyper others thought you were not normal, or got into trouble", type:"check" },
      { id:"q2", label:"So irritable you shouted or started fights", type:"check" },
      { id:"q3", label:"Felt much more self-confident than usual", type:"check" },
      { id:"q4", label:"Got much less sleep and did not miss it", type:"check" },
      { id:"q5", label:"Much more talkative or spoke faster than usual", type:"check" },
      { id:"q6", label:"Thoughts raced or you could not slow your mind", type:"check" },
      { id:"q7", label:"So easily distracted you had trouble concentrating", type:"check" },
      { id:"q8", label:"Much more energy than usual", type:"check" },
      { id:"q9", label:"Much more active or did many more things", type:"check" },
      { id:"q10", label:"Much more social or outgoing", type:"check" },
      { id:"q11", label:"Much more interested in sex", type:"check" },
      { id:"q12", label:"Did things unusual, excessive or risky for you", type:"check" },
      { id:"q13", label:"Spending money got you or your family into trouble", type:"check" },
      { id:"same", label:"Several of these ever happened during the SAME time period", type:"check" },
      { id:"problem", label:"Problem severity caused", type:"select", opts:[{v:"0",t:"No problem"},{v:"1",t:"Minor problem"},{v:"2",t:"Moderate problem"},{v:"3",t:"Serious problem"}] }
    ],
    compute:function(v){
      var n=0; for(var i=1;i<=13;i++) if(v["q"+i]) n++;
      var pos=n>=7 && v.same && Number(v.problem)>=2;
      return { v: pos?"Positive screen ("+n+"/13)":"Negative screen ("+n+"/13)", u:"", i:(pos?"Suggestive of a bipolar spectrum disorder — warrants clinical evaluation":"Below the MDQ threshold (needs ≥7 symptoms, same time period, and at least moderate problems)")+". A screen, not a diagnosis. Ref: Hirschfeld, Am J Psychiatry 2000 (MDQ)." };
    } },

  { id:"eutos", cat:"Haematology", icon:"", title:"EUTOS Score (Chronic Myeloid Leukaemia)",
    desc:"Predicts response and progression-free survival in CML at diagnosis.",
    inputs:[
      { id:"baso", label:"Peripheral blood basophils", type:"number", unit:"%", step:"0.1" },
      { id:"spleen", label:"Spleen size below costal margin", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.baso)||!ok(v.spleen)||v.baso<0||v.spleen<0) return ERR;
      var s=7*v.baso+4*v.spleen;
      var b=s>87?"High risk":"Low risk";
      return { v:r0(s), u:"", i:b+" (threshold 87). Ref: Hasford, Blood 2011 (EUTOS)." };
    } },

  { id:"chads2", cat:"Cardiovascular", icon:"", title:"CHADS₂ Score",
    desc:"Stroke risk in non-valvular atrial fibrillation (predecessor of CHA₂DS₂-VASc).",
    inputs:[
      { id:"chf", label:"Congestive heart failure", type:"check" },
      { id:"htn", label:"Hypertension", type:"check" },
      { id:"age75", label:"Age ≥ 75 years", type:"check" },
      { id:"dm", label:"Diabetes mellitus", type:"check" },
      { id:"stroke", label:"Prior stroke / TIA / thromboembolism (2 points)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.chf)s++; if(v.htn)s++; if(v.age75)s++; if(v.dm)s++; if(v.stroke)s+=2;
      var b=s===0?"Low risk":s===1?"Low–moderate risk":"Moderate–high risk — anticoagulation usually indicated";
      return { v:s, u:"points", i:b+". CHA₂DS₂-VASc is now generally preferred. Ref: Gage, JAMA 2001." };
    } },

  { id:"ca_phos_product", cat:"Renal", icon:"", title:"Calcium-Phosphate Product",
    desc:"Calcium × phosphate product (CKD-mineral and bone disorder).",
    inputs:[
      { id:"ca", label:"Calcium (corrected)", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"phos", label:"Phosphate", type:"number", unit:"mmol/L", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.ca)||!ok(v.phos)||v.ca<0||v.phos<0) return ERR;
      var p=v.ca*v.phos;
      var b=p>4.4?"Elevated — increased risk of vascular / soft-tissue calcification":"Within the usually acceptable range";
      return { v:r1(p), u:"mmol²/L²", i:b+" (units mmol²/L²). Ref: KDIGO CKD-MBD guidance." };
    } },

  { id:"pecarn_head", cat:"Paediatrics", icon:"", title:"PECARN Paediatric Head Injury Rule",
    desc:"Need for CT after minor head trauma (GCS ≥ 14). Use the row for the child's age.",
    inputs:[
      { id:"age", label:"Age group", type:"select", opts:[{v:"lt2",t:"< 2 years"},{v:"ge2",t:"≥ 2 years"}] },
      { id:"high", label:"High-risk: GCS ≤14, altered mental status, or (<2y) palpable skull fracture / (≥2y) signs of basilar skull fracture", type:"check" },
      { id:"inter", label:"Intermediate: (<2y) occipital/parietal/temporal haematoma, LOC ≥5s, severe mechanism, not acting normally per parent; (≥2y) any LOC, vomiting, severe mechanism, or severe headache", type:"check" }
    ],
    compute:function(v){
      if(v.high) return { v:"CT recommended", u:"", i:"High-risk predictor present — head CT recommended (higher risk of clinically important TBI). Ref: Kuppermann, Lancet 2009 (PECARN)." };
      if(v.inter) return { v:"Observation vs CT", u:"", i:"Intermediate risk — observation or CT via shared decision-making (clinician experience, clinical worsening, parental preference, multiple findings). Ref: PECARN 2009." };
      return { v:"CT not recommended", u:"", i:"No PECARN predictors — very low risk of clinically important TBI; CT not routinely recommended. Ref: PECARN 2009." };
    } },

  { id:"berlin_ards", cat:"Critical care", icon:"", title:"Berlin Definition (ARDS)",
    desc:"Diagnosis and severity grading of acute respiratory distress syndrome.",
    inputs:[
      { id:"timing", label:"Onset within 1 week of insult / worsening symptoms", type:"check" },
      { id:"imaging", label:"Bilateral opacities not fully explained by effusions/collapse/nodules", type:"check" },
      { id:"origin", label:"Not fully explained by cardiac failure / fluid overload", type:"check" },
      { id:"peep", label:"PEEP / CPAP ≥ 5 cmH₂O", type:"check" },
      { id:"pf", label:"PaO₂/FiO₂ ratio", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.pf)||v.pf<=0) return ERR;
      if(!(v.timing&&v.imaging&&v.origin&&v.peep)) return { v:"Criteria not met", u:"", i:"All of: acute timing, bilateral opacities, non-cardiac origin, and PEEP ≥5 are required to define ARDS. Ref: ARDS Definition Task Force, JAMA 2012." };
      if(v.pf>300) return { v:"Does not meet ARDS", u:"", i:"PaO₂/FiO₂ > 300 on PEEP ≥5 is above the ARDS threshold. Ref: Berlin 2012." };
      var sev=v.pf>200?"Mild ARDS":v.pf>100?"Moderate ARDS":"Severe ARDS";
      return { v:sev, u:"", i:"ARDS confirmed on PEEP ≥5. Mild 200–300, moderate 100–200, severe ≤100. Ref: Berlin 2012." };
    } },

  { id:"four_score", cat:"Neurology", icon:"", title:"FOUR Score (Coma)",
    desc:"Level of consciousness (alternative to GCS; usable in intubated patients).",
    inputs:[
      { id:"eye", label:"Eye response", type:"select", opts:[{v:"4",t:"Eyelids open, tracking or blinking to command"},{v:"3",t:"Open but not tracking"},{v:"2",t:"Open to loud voice"},{v:"1",t:"Open to pain"},{v:"0",t:"Remain closed to pain"}] },
      { id:"motor", label:"Motor response", type:"select", opts:[{v:"4",t:"Thumbs-up/fist/peace sign to command"},{v:"3",t:"Localising to pain"},{v:"2",t:"Flexion to pain"},{v:"1",t:"Extension to pain"},{v:"0",t:"No response or myoclonus status"}] },
      { id:"brainstem", label:"Brainstem reflexes", type:"select", opts:[{v:"4",t:"Pupil and corneal reflexes present"},{v:"3",t:"One pupil wide and fixed"},{v:"2",t:"Pupil or corneal absent"},{v:"1",t:"Pupil and corneal absent"},{v:"0",t:"Pupil, corneal and cough absent"}] },
      { id:"resp", label:"Respiration", type:"select", opts:[{v:"4",t:"Not intubated, regular pattern"},{v:"3",t:"Not intubated, Cheyne-Stokes"},{v:"2",t:"Not intubated, irregular"},{v:"1",t:"Breathes above ventilator rate"},{v:"0",t:"Breathes at ventilator rate or apnoea"}] }
    ],
    compute:function(v){
      var s=Number(v.eye)+Number(v.motor)+Number(v.brainstem)+Number(v.resp);
      var b=s>=13?"Mild impairment of consciousness":s>=7?"Moderate impairment":"Severe impairment of consciousness";
      return { v:s, u:"/16", i:b+" (lower = worse; 0 suggests brain death evaluation). Ref: Wijdicks, Ann Neurol 2005 (FOUR)." };
    } },

  { id:"marburg", cat:"Cardiovascular", icon:"", title:"Marburg Heart Score (Chest Pain)",
    desc:"Likelihood that chest pain in primary care is due to coronary artery disease.",
    inputs:[
      { id:"agesex", label:"Female ≥ 65 or male ≥ 55 years", type:"check" },
      { id:"cad", label:"Known CAD, cerebrovascular or peripheral vascular disease", type:"check" },
      { id:"exercise", label:"Pain worse with exercise", type:"check" },
      { id:"notpalp", label:"Pain NOT reproducible by palpation", type:"check" },
      { id:"cardiac", label:"Patient assumes the pain is cardiac", type:"check" }
    ],
    compute:function(v){
      var s=(v.agesex?1:0)+(v.cad?1:0)+(v.exercise?1:0)+(v.notpalp?1:0)+(v.cardiac?1:0);
      var b=s<=2?"CAD unlikely — low probability":"Higher probability — consider further cardiac evaluation";
      return { v:s, u:"/5", i:b+". Ref: Bösner, CMAJ 2010 (Marburg Heart Score)." };
    } },

  { id:"effective_osm", cat:"Endocrine", icon:"", title:"Effective Serum Osmolality (Tonicity)",
    desc:"Effective osmolality (excludes urea) — e.g. in hyperglycaemic emergencies.",
    inputs:[
      { id:"na", label:"Sodium", type:"number", unit:"mmol/L", step:"1" },
      { id:"glu", label:"Glucose", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.glu)) return ERR;
      var e=2*v.na+v.glu;
      var b=e>320?"Markedly raised (as in hyperosmolar hyperglycaemic state)":e>295?"Raised":"Within/near the usual range";
      return { v:r0(e), u:"mmol/kg", i:b+" (glucose entered in mmol/L; urea excluded). Ref: standard biochemistry." };
    } },

  { id:"ktv", cat:"Renal", icon:"", title:"Kt/V (Single-pool, Daugirdas)",
    desc:"Haemodialysis adequacy from pre/post urea.",
    inputs:[
      { id:"pre", label:"Pre-dialysis urea", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"post", label:"Post-dialysis urea", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"t", label:"Dialysis session length", type:"number", unit:"h", step:"0.1" },
      { id:"uf", label:"Ultrafiltration volume", type:"number", unit:"L", step:"0.1" },
      { id:"wt", label:"Post-dialysis weight", type:"number", unit:"kg", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.pre)||!ok(v.post)||!ok(v.t)||!ok(v.uf)||!ok(v.wt)||v.pre<=0||v.wt<=0||v.t<0) return ERR;
      var R=v.post/v.pre;
      var inner=R-0.008*v.t;
      if(inner<=0) return { err:"Inputs give an invalid logarithm — check urea and time values" };
      var ktv=-Math.log(inner)+(4-3.5*R)*(v.uf/v.wt);
      var b=ktv>=1.2?"Adequate single-pool Kt/V (target ≥ 1.2)":"Below target — review dialysis prescription";
      return { v:r1(ktv*100)/100, u:"", i:b+". Ref: Daugirdas, J Am Soc Nephrol 1993." };
    } },

  { id:"audit_full", cat:"Psychiatry", icon:"", title:"AUDIT (Alcohol Use Disorders Identification Test)",
    desc:"10-item screen for hazardous and harmful alcohol use.",
    inputs:[
      { id:"q1", label:"How often do you have a drink containing alcohol?", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Monthly or less"},{v:"2",t:"2–4×/month"},{v:"3",t:"2–3×/week"},{v:"4",t:"≥4×/week"}] },
      { id:"q2", label:"Drinks on a typical drinking day", type:"select", opts:[{v:"0",t:"1–2"},{v:"1",t:"3–4"},{v:"2",t:"5–6"},{v:"3",t:"7–9"},{v:"4",t:"≥10"}] },
      { id:"q3", label:"How often ≥6 drinks on one occasion?", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q4", label:"Unable to stop drinking once started", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q5", label:"Failed to do what was expected because of drinking", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q6", label:"Needed a drink in the morning", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q7", label:"Guilt or remorse after drinking", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q8", label:"Unable to remember the night before", type:"select", opts:[{v:"0",t:"Never"},{v:"1",t:"Less than monthly"},{v:"2",t:"Monthly"},{v:"3",t:"Weekly"},{v:"4",t:"Daily/almost daily"}] },
      { id:"q9", label:"You or someone injured due to your drinking", type:"select", opts:[{v:"0",t:"No"},{v:"2",t:"Yes, but not in the last year"},{v:"4",t:"Yes, in the last year"}] },
      { id:"q10", label:"Others concerned or suggested you cut down", type:"select", opts:[{v:"0",t:"No"},{v:"2",t:"Yes, but not in the last year"},{v:"4",t:"Yes, in the last year"}] }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=10;i++) s+=Number(v["q"+i]);
      var b=s<8?"Low risk":s<=15?"Hazardous drinking":s<=19?"Harmful drinking":"Possible alcohol dependence";
      return { v:s, u:"/40", i:b+". Ref: Saunders, Addiction 1993 (WHO AUDIT)." };
    } },

  { id:"mews", cat:"Critical care", icon:"", title:"Modified Early Warning Score (MEWS)",
    desc:"Bedside physiological track-and-trigger score.",
    inputs:[
      { id:"sbp", label:"Systolic BP", type:"select", opts:[{v:"0",t:"101–199"},{v:"1",t:"81–100"},{v:"2",t:"71–80"},{v:"3",t:"≤ 70"},{v:"2b",t:"≥ 200"}] },
      { id:"hr", label:"Heart rate", type:"select", opts:[{v:"0",t:"51–100"},{v:"1",t:"41–50"},{v:"2",t:"≤ 40"},{v:"1b",t:"101–110"},{v:"2b",t:"111–129"},{v:"3",t:"≥ 130"}] },
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"0",t:"9–14"},{v:"1",t:"15–20"},{v:"2",t:"< 9"},{v:"2b",t:"21–29"},{v:"3",t:"≥ 30"}] },
      { id:"temp", label:"Temperature", type:"select", opts:[{v:"0",t:"35–38.4°C"},{v:"2",t:"< 35°C"},{v:"2b",t:"≥ 38.5°C"}] },
      { id:"avpu", label:"Neurological (AVPU)", type:"select", opts:[{v:"0",t:"Alert"},{v:"1",t:"Reacts to voice"},{v:"2",t:"Reacts to pain"},{v:"3",t:"Unresponsive"}] }
    ],
    compute:function(v){
      function n(x){ return Math.abs(Number(String(x).replace("b",""))); }
      var s=n(v.sbp)+n(v.hr)+n(v.rr)+n(v.temp)+n(v.avpu);
      var b=s>=5?"High — urgent clinical review":s>=3?"Intermediate — increase monitoring/review":"Low";
      return { v:s, u:"points", i:b+" (a score of ≥5, or 3 in any single parameter, should prompt escalation). Ref: Subbe, QJM 2001 (MEWS)." };
    } },

  { id:"apfel", cat:"General", icon:"", title:"Apfel Score (Postoperative Nausea & Vomiting)",
    desc:"Risk of postoperative nausea and vomiting.",
    inputs:[
      { id:"female", label:"Female sex", type:"check" },
      { id:"nonsmoker", label:"Non-smoker", type:"check" },
      { id:"history", label:"History of PONV or motion sickness", type:"check" },
      { id:"opioids", label:"Expected postoperative opioids", type:"check" }
    ],
    compute:function(v){
      var s=(v.female?1:0)+(v.nonsmoker?1:0)+(v.history?1:0)+(v.opioids?1:0);
      var risk=["~10%","~20%","~40%","~60%","~80%"][s];
      var b=s>=2?"Consider prophylactic antiemetics":"Low baseline risk";
      return { v:s, u:"/4", i:"Approximate PONV risk "+risk+". "+b+". Ref: Apfel, Anesthesiology 1999." };
    } },

  { id:"borg", cat:"Respiratory", icon:"", title:"Modified Borg Dyspnoea Scale",
    desc:"Patient-rated breathlessness intensity.",
    inputs:[
      { id:"score", label:"Breathlessness rating", type:"select", opts:[
        {v:"0",t:"0 — Nothing at all"},{v:"0.5",t:"0.5 — Very, very slight"},{v:"1",t:"1 — Very slight"},{v:"2",t:"2 — Slight"},{v:"3",t:"3 — Moderate"},
        {v:"4",t:"4 — Somewhat severe"},{v:"5",t:"5 — Severe"},{v:"6",t:"6"},{v:"7",t:"7 — Very severe"},{v:"8",t:"8"},{v:"9",t:"9 — Very, very severe"},{v:"10",t:"10 — Maximal"} ] }
    ],
    compute:function(v){
      var s=Number(v.score);
      var b=s<=1?"Minimal breathlessness":s<=3?"Mild-to-moderate breathlessness":s<=5?"Severe breathlessness":"Very severe breathlessness";
      return { v:s, u:"/10", i:b+". Useful for tracking change over time. Ref: Borg, Med Sci Sports Exerc 1982 (modified)." };
    } },

  { id:"aar", cat:"Hepatology", icon:"", title:"AST/ALT Ratio (De Ritis)",
    desc:"Ratio of aminotransferases, a clue to the type of liver injury.",
    inputs:[
      { id:"ast", label:"AST", type:"number", unit:"IU/L", step:"1" },
      { id:"alt", label:"ALT", type:"number", unit:"IU/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.ast)||!ok(v.alt)||v.alt<=0) return ERR;
      var r=v.ast/v.alt;
      var b=r>=2?"Ratio ≥ 2 — suggests alcoholic liver disease or advanced fibrosis/cirrhosis":r>=1?"Ratio ≥ 1 — may indicate cirrhosis; interpret with context":"Ratio < 1 — typical of viral hepatitis or non-alcoholic fatty liver disease";
      return { v:r1(r*100)/100, u:"", i:b+". Ref: De Ritis ratio (standard hepatology)." };
    } },

  { id:"barthel", cat:"Neurology", icon:"", title:"Barthel Index (Activities of Daily Living)",
    desc:"Functional independence in basic activities of daily living.",
    inputs:[
      { id:"feed", label:"Feeding", type:"select", opts:[{v:"0",t:"Unable"},{v:"5",t:"Needs help"},{v:"10",t:"Independent"}] },
      { id:"bathe", label:"Bathing", type:"select", opts:[{v:"0",t:"Dependent"},{v:"5",t:"Independent"}] },
      { id:"groom", label:"Grooming", type:"select", opts:[{v:"0",t:"Needs help"},{v:"5",t:"Independent"}] },
      { id:"dress", label:"Dressing", type:"select", opts:[{v:"0",t:"Dependent"},{v:"5",t:"Needs help"},{v:"10",t:"Independent"}] },
      { id:"bowels", label:"Bowels", type:"select", opts:[{v:"0",t:"Incontinent"},{v:"5",t:"Occasional accident"},{v:"10",t:"Continent"}] },
      { id:"bladder", label:"Bladder", type:"select", opts:[{v:"0",t:"Incontinent/catheter"},{v:"5",t:"Occasional accident"},{v:"10",t:"Continent"}] },
      { id:"toilet", label:"Toilet use", type:"select", opts:[{v:"0",t:"Dependent"},{v:"5",t:"Needs some help"},{v:"10",t:"Independent"}] },
      { id:"transfer", label:"Transfers (bed to chair)", type:"select", opts:[{v:"0",t:"Unable"},{v:"5",t:"Major help"},{v:"10",t:"Minor help"},{v:"15",t:"Independent"}] },
      { id:"mobility", label:"Mobility on level surfaces", type:"select", opts:[{v:"0",t:"Immobile"},{v:"5",t:"Wheelchair independent"},{v:"10",t:"Walks with help"},{v:"15",t:"Independent"}] },
      { id:"stairs", label:"Stairs", type:"select", opts:[{v:"0",t:"Unable"},{v:"5",t:"Needs help"},{v:"10",t:"Independent"}] }
    ],
    compute:function(v){
      var s=Number(v.feed)+Number(v.bathe)+Number(v.groom)+Number(v.dress)+Number(v.bowels)+Number(v.bladder)+Number(v.toilet)+Number(v.transfer)+Number(v.mobility)+Number(v.stairs);
      var b=s<=20?"Total dependence":s<=60?"Severe dependence":s<=90?"Moderate dependence":s<=99?"Slight dependence":"Independent";
      return { v:s, u:"/100", i:b+" (higher = more independent). Ref: Mahoney & Barthel, Md State Med J 1965." };
    } },

  { id:"silverman", cat:"Paediatrics", icon:"", title:"Silverman-Andersen Retraction Score",
    desc:"Work of breathing in the newborn (higher = worse; opposite of Apgar).",
    inputs:[
      { id:"chest", label:"Upper chest movement", type:"select", opts:[{v:"0",t:"Synchronised"},{v:"1",t:"Lag on inspiration"},{v:"2",t:"See-saw"}] },
      { id:"intercostal", label:"Lower chest (intercostal retraction)", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Just visible"},{v:"2",t:"Marked"}] },
      { id:"xiphoid", label:"Xiphoid retraction", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Just visible"},{v:"2",t:"Marked"}] },
      { id:"nares", label:"Nares dilatation", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Minimal"},{v:"2",t:"Marked"}] },
      { id:"grunt", label:"Expiratory grunt", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Audible with stethoscope"},{v:"2",t:"Audible unaided"}] }
    ],
    compute:function(v){
      var s=Number(v.chest)+Number(v.intercostal)+Number(v.xiphoid)+Number(v.nares)+Number(v.grunt);
      var b=s===0?"No respiratory distress":s<=3?"Mild respiratory distress":s<=6?"Moderate respiratory distress":"Severe respiratory distress";
      return { v:s, u:"/10", i:b+". Ref: Silverman & Andersen, Pediatrics 1956." };
    } },

  { id:"ashworth", cat:"Neurology", icon:"", title:"Modified Ashworth Scale (Spasticity)",
    desc:"Muscle tone / spasticity on passive movement.",
    inputs:[
      { id:"grade", label:"Tone", type:"select", opts:[
        {v:"0",t:"0 — No increase in tone"},{v:"1",t:"1 — Slight (catch and release, or minimal resistance at end of ROM)"},{v:"1p",t:"1+ — Slight increase, minimal resistance through < half ROM"},
        {v:"2",t:"2 — More marked through most of ROM, part still moved easily"},{v:"3",t:"3 — Considerable increase, passive movement difficult"},{v:"4",t:"4 — Rigid in flexion or extension"} ] }
    ],
    compute:function(v){
      var m={"0":"No increase in muscle tone","1":"Slight increase (catch and release)","1p":"Slight increase, resistance through less than half the range","2":"Marked increase through most of the range, but limb moved easily","3":"Considerable increase, passive movement difficult","4":"Rigid in flexion or extension"};
      return { v:v.grade==="1p"?"1+":v.grade, u:"", i:m[v.grade]+". Ref: Bohannon & Smith, Phys Ther 1987 (Modified Ashworth)." };
    } },

  { id:"abi", cat:"Cardiovascular", icon:"", title:"Ankle-Brachial Index (ABI)",
    desc:"Screens for peripheral arterial disease.",
    inputs:[
      { id:"ankle", label:"Higher ankle systolic pressure (that leg)", type:"number", unit:"mmHg", step:"1" },
      { id:"brachial", label:"Higher brachial systolic pressure", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.ankle)||!ok(v.brachial)||v.brachial<=0||v.ankle<0) return ERR;
      var abi=v.ankle/v.brachial;
      var b=abi>1.4?"Non-compressible / calcified vessels":abi>=1.0?"Normal":abi>=0.9?"Borderline":abi>=0.4?"Mild-to-moderate peripheral arterial disease":"Severe peripheral arterial disease";
      return { v:r1(abi*100)/100, u:"", i:b+". Ref: standard vascular assessment." };
    } },

  { id:"pack_years", cat:"General", icon:"", title:"Smoking Pack-Years",
    desc:"Cumulative cigarette exposure.",
    inputs:[
      { id:"cpd", label:"Cigarettes per day", type:"number", step:"1" },
      { id:"years", label:"Years smoked", type:"number", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.cpd)||!ok(v.years)||v.cpd<0||v.years<0) return ERR;
      var py=(v.cpd/20)*v.years;
      return { v:r1(py), u:"pack-years", i:"Cumulative smoking exposure (1 pack-year = 20 cigarettes/day for 1 year). ≥ ~20–30 pack-years markedly raises lung-cancer and COPD risk. Ref: standard definition." };
    } },

  { id:"phq2", cat:"Psychiatry", icon:"", title:"PHQ-2 (Depression Screen)",
    desc:"Ultra-brief screen for depression over the past 2 weeks.",
    inputs:[
      { id:"q1", label:"Little interest or pleasure in doing things", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q2", label:"Feeling down, depressed or hopeless", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] }
    ],
    compute:function(v){
      var s=Number(v.q1)+Number(v.q2);
      var b=s>=3?"Positive screen — proceed to a full assessment (e.g. PHQ-9)":"Negative screen";
      return { v:s, u:"/6", i:b+". Ref: Kroenke, Med Care 2003 (PHQ-2)." };
    } },

  { id:"whr", cat:"General", icon:"", title:"Waist-Hip Ratio",
    desc:"Central adiposity and cardiometabolic risk.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"waist", label:"Waist circumference", type:"number", unit:"cm", step:"0.1" },
      { id:"hip", label:"Hip circumference", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.waist)||!ok(v.hip)||v.hip<=0||v.waist<=0) return ERR;
      var r=v.waist/v.hip;
      var thr=v.sex==="f"?0.85:0.90;
      var b=r>thr?"Above the threshold — increased cardiometabolic risk":"Within the lower-risk range";
      return { v:r1(r*100)/100, u:"", i:b+" (threshold "+thr+" for the selected sex). Ref: WHO waist-hip ratio guidance." };
    } },

  { id:"bristol", cat:"Gastroenterology", icon:"", title:"Bristol Stool Form Scale",
    desc:"Classifies stool form as a marker of transit.",
    inputs:[
      { id:"type", label:"Stool appearance", type:"select", opts:[
        {v:"1",t:"Type 1 — separate hard lumps"},{v:"2",t:"Type 2 — lumpy sausage"},{v:"3",t:"Type 3 — sausage with cracks"},{v:"4",t:"Type 4 — smooth soft sausage"},
        {v:"5",t:"Type 5 — soft blobs with clear edges"},{v:"6",t:"Type 6 — mushy, ragged edges"},{v:"7",t:"Type 7 — entirely liquid"} ] }
    ],
    compute:function(v){
      var n=Number(v.type);
      var b=n<=2?"Suggests constipation / slow transit":n<=4?"Normal stool form":n===5?"Tending towards loose / lacking fibre":"Suggests diarrhoea / rapid transit";
      return { v:"Type "+n, u:"", i:b+". Ref: Lewis & Heaton, Scand J Gastroenterol 1997 (Bristol)." };
    } },

  { id:"apache2", cat:"Critical care", icon:"", title:"APACHE II Score",
    desc:"ICU severity of illness and mortality estimate (worst values in first 24 h).",
    inputs:[
      { id:"temp", label:"Temperature (°C, core)", type:"select", opts:[{v:"0",t:"36–38.4"},{v:"1",t:"38.5–38.9"},{v:"3",t:"39–40.9"},{v:"4",t:"≥ 41"},{v:"1b",t:"34–35.9"},{v:"2",t:"32–33.9"},{v:"3b",t:"30–31.9"},{v:"4b",t:"≤ 29.9"}] },
      { id:"map", label:"Mean arterial pressure (mmHg)", type:"select", opts:[{v:"0",t:"70–109"},{v:"2",t:"110–129"},{v:"3",t:"130–159"},{v:"4",t:"≥ 160"},{v:"2b",t:"50–69"},{v:"4b",t:"≤ 49"}] },
      { id:"hr", label:"Heart rate", type:"select", opts:[{v:"0",t:"70–109"},{v:"2",t:"110–139"},{v:"3",t:"140–179"},{v:"4",t:"≥ 180"},{v:"2b",t:"55–69"},{v:"3b",t:"40–54"},{v:"4b",t:"≤ 39"}] },
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"0",t:"12–24"},{v:"1",t:"25–34"},{v:"3",t:"35–49"},{v:"4",t:"≥ 50"},{v:"1b",t:"10–11"},{v:"2",t:"6–9"},{v:"4b",t:"≤ 5"}] },
      { id:"oxy", label:"Oxygenation", type:"select", opts:[{v:"0",t:"FiO₂≥0.5: A-a<200, or FiO₂<0.5: PaO₂>70"},{v:"1",t:"FiO₂<0.5: PaO₂ 61–70"},{v:"2",t:"FiO₂≥0.5: A-a 200–349"},{v:"3",t:"FiO₂≥0.5: A-a 350–499, or FiO₂<0.5: PaO₂ 55–60"},{v:"4",t:"FiO₂≥0.5: A-a ≥500, or FiO₂<0.5: PaO₂ <55"}] },
      { id:"ph", label:"Arterial pH", type:"select", opts:[{v:"0",t:"7.33–7.49"},{v:"1",t:"7.5–7.59"},{v:"3",t:"7.6–7.69"},{v:"4",t:"≥ 7.7"},{v:"2",t:"7.25–7.32"},{v:"3b",t:"7.15–7.24"},{v:"4b",t:"< 7.15"}] },
      { id:"na", label:"Serum sodium (mmol/L)", type:"select", opts:[{v:"0",t:"130–149"},{v:"1",t:"150–154"},{v:"2",t:"155–159"},{v:"3",t:"160–179"},{v:"4",t:"≥ 180"},{v:"2b",t:"120–129"},{v:"3b",t:"111–119"},{v:"4b",t:"≤ 110"}] },
      { id:"k", label:"Serum potassium (mmol/L)", type:"select", opts:[{v:"0",t:"3.5–5.4"},{v:"1",t:"5.5–5.9"},{v:"3",t:"6–6.9"},{v:"4",t:"≥ 7"},{v:"1b",t:"3–3.4"},{v:"2",t:"2.5–2.9"},{v:"4b",t:"< 2.5"}] },
      { id:"cr", label:"Serum creatinine (mg/dL)", type:"select", opts:[{v:"0",t:"0.6–1.4"},{v:"2",t:"1.5–1.9"},{v:"3",t:"2–3.4"},{v:"4",t:"≥ 3.5"},{v:"2b",t:"< 0.6"}] },
      { id:"arf", label:"Acute renal failure (doubles creatinine points)", type:"check" },
      { id:"hct", label:"Haematocrit (%)", type:"select", opts:[{v:"0",t:"30–45.9"},{v:"1",t:"46–49.9"},{v:"2",t:"50–59.9"},{v:"4",t:"≥ 60"},{v:"2b",t:"20–29.9"},{v:"4b",t:"< 20"}] },
      { id:"wbc", label:"White cell count (×10³/mm³)", type:"select", opts:[{v:"0",t:"3–14.9"},{v:"1",t:"15–19.9"},{v:"2",t:"20–39.9"},{v:"4",t:"≥ 40"},{v:"2b",t:"1–2.9"},{v:"4b",t:"< 1"}] },
      { id:"gcs", label:"Glasgow Coma Scale (3–15)", type:"number", step:"1" },
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"≤ 44"},{v:"2",t:"45–54"},{v:"3",t:"55–64"},{v:"5",t:"65–74"},{v:"6",t:"≥ 75"}] },
      { id:"chronic", label:"Severe organ insufficiency / immunocompromise", type:"select", opts:[{v:"0",t:"None"},{v:"2",t:"Present, elective postoperative"},{v:"5",t:"Present, non-operative or emergency postoperative"}] }
    ],
    compute:function(v){
      if(!ok(v.gcs)||v.gcs<3||v.gcs>15) return ERR;
      function P(x){ return Math.abs(Number(String(x).replace(/b/g,""))); }
      var crPts=P(v.cr)*(v.arf?2:1);
      var s=P(v.temp)+P(v.map)+P(v.hr)+P(v.rr)+P(v.oxy)+P(v.ph)+P(v.na)+P(v.k)+crPts+P(v.hct)+P(v.wbc)+(15-v.gcs)+Number(v.age)+Number(v.chronic);
      var mort=s<=4?"~4%":s<=9?"~8%":s<=14?"~15%":s<=19?"~25%":s<=24?"~40%":s<=29?"~55%":s<=34?"~73%":"~85%";
      return { v:s, u:"points", i:"Approximate non-operative hospital mortality "+mort+" (also depends on diagnosis). Ref: Knaus, Crit Care Med 1985 (APACHE II)." };
    } },

  { id:"ipss_r", cat:"Haematology", icon:"", title:"IPSS-R (Myelodysplastic Syndrome)",
    desc:"Revised International Prognostic Scoring System for MDS.",
    inputs:[
      { id:"cyto", label:"Cytogenetic risk group", type:"select", opts:[{v:"0",t:"Very good"},{v:"1",t:"Good"},{v:"2",t:"Intermediate"},{v:"3",t:"Poor"},{v:"4",t:"Very poor"}] },
      { id:"blasts", label:"Bone marrow blasts", type:"select", opts:[{v:"0",t:"≤ 2%"},{v:"1",t:"> 2% to < 5%"},{v:"2",t:"5–10%"},{v:"3",t:"> 10%"}] },
      { id:"hb", label:"Haemoglobin", type:"select", opts:[{v:"0",t:"≥ 10 g/dL"},{v:"1",t:"8 to < 10 g/dL"},{v:"1.5",t:"< 8 g/dL"}] },
      { id:"plt", label:"Platelets", type:"select", opts:[{v:"0",t:"≥ 100 ×10⁹/L"},{v:"0.5",t:"50 to < 100 ×10⁹/L"},{v:"1",t:"< 50 ×10⁹/L"}] },
      { id:"anc", label:"Absolute neutrophil count", type:"select", opts:[{v:"0",t:"≥ 0.8 ×10⁹/L"},{v:"0.5",t:"< 0.8 ×10⁹/L"}] }
    ],
    compute:function(v){
      var s=Number(v.cyto)+Number(v.blasts)+Number(v.hb)+Number(v.plt)+Number(v.anc);
      var b=s<=1.5?"Very low risk":s<=3?"Low risk":s<=4.5?"Intermediate risk":s<=6?"High risk":"Very high risk";
      return { v:r1(s), u:"points", i:b+" (IPSS-R prognostic category). Ref: Greenberg, Blood 2012 (IPSS-R)." };
    } },

  { id:"ad8", cat:"Neurology", icon:"", title:"AD8 Dementia Screening Interview",
    desc:"Informant-rated screen for cognitive change. Tick each item that represents a CHANGE.",
    inputs:[
      { id:"q1", label:"Problems with judgment (bad decisions, finances)", type:"check" },
      { id:"q2", label:"Reduced interest in hobbies/activities", type:"check" },
      { id:"q3", label:"Repeats questions, stories or statements", type:"check" },
      { id:"q4", label:"Trouble learning to use a tool/appliance/gadget", type:"check" },
      { id:"q5", label:"Forgets the correct month or year", type:"check" },
      { id:"q6", label:"Difficulty handling complex financial affairs", type:"check" },
      { id:"q7", label:"Difficulty remembering appointments", type:"check" },
      { id:"q8", label:"Daily problems with thinking and/or memory", type:"check" }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=8;i++) if(v["q"+i]) s++;
      var b=s>=2?"Suggests cognitive impairment — further assessment indicated":"Cognitive impairment unlikely on this screen";
      return { v:s, u:"/8", i:b+". Ref: Galvin, Neurology 2005 (AD8)." };
    } },

  { id:"rome4_ibs", cat:"Gastroenterology", icon:"", title:"Rome IV Criteria (Irritable Bowel Syndrome)",
    desc:"Diagnostic criteria for IBS (apply after excluding alarm features / organic disease).",
    inputs:[
      { id:"pain", label:"Recurrent abdominal pain, on average ≥ 1 day/week in the last 3 months", type:"check" },
      { id:"onset", label:"Symptom onset ≥ 6 months ago", type:"check" },
      { id:"defaec", label:"Pain related to defaecation", type:"check" },
      { id:"freq", label:"Associated with a change in stool frequency", type:"check" },
      { id:"form", label:"Associated with a change in stool form/appearance", type:"check" }
    ],
    compute:function(v){
      var assoc=(v.defaec?1:0)+(v.freq?1:0)+(v.form?1:0);
      var meets=v.pain && v.onset && assoc>=2;
      return { v: meets?"Meets Rome IV IBS criteria":"Does not meet criteria", u:"", i:(meets?"Consistent with IBS (subtype by predominant stool form)":"Requires abdominal pain ≥1 day/week for 3 months, onset ≥6 months ago, plus ≥2 of the 3 associations")+". Exclude alarm features. Ref: Rome IV, Gastroenterology 2016." };
    } },

  { id:"dapsa", cat:"Rheumatology", icon:"", title:"DAPSA (Psoriatic Arthritis Activity)",
    desc:"Disease Activity in Psoriatic Arthritis.",
    inputs:[
      { id:"tjc", label:"Tender joint count (of 68)", type:"number", step:"1" },
      { id:"sjc", label:"Swollen joint count (of 66)", type:"number", step:"1" },
      { id:"pain", label:"Patient pain (0–10 VAS)", type:"number", step:"0.1" },
      { id:"global", label:"Patient global activity (0–10 VAS)", type:"number", step:"0.1" },
      { id:"crp", label:"CRP", type:"number", unit:"mg/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.tjc)||!ok(v.sjc)||!ok(v.pain)||!ok(v.global)||!ok(v.crp)) return ERR;
      var s=v.tjc+v.sjc+v.pain+v.global+v.crp;
      var b=s<=4?"Remission":s<=14?"Low disease activity":s<=28?"Moderate disease activity":"High disease activity";
      return { v:r1(s), u:"", i:b+". Note: CRP entered in mg/dL. Ref: Schoels, Ann Rheum Dis 2010 (DAPSA)." };
    } },

  { id:"hit_4ts", cat:"Haematology", icon:"", title:"4Ts Score (Heparin-Induced Thrombocytopenia)",
    desc:"Pre-test probability of heparin-induced thrombocytopenia.",
    inputs:[
      { id:"thrombocytopenia", label:"Thrombocytopenia", type:"select", opts:[{v:"0",t:"Fall < 30% or nadir < 10 ×10⁹/L"},{v:"1",t:"Fall 30–50% or nadir 10–19 ×10⁹/L"},{v:"2",t:"Fall > 50% and nadir ≥ 20 ×10⁹/L"}] },
      { id:"timing", label:"Timing of platelet fall", type:"select", opts:[{v:"0",t:"Fall < 4 days without recent heparin"},{v:"1",t:"Consistent but unclear, after day 10, or ≤1 day if heparin 30–100 days ago"},{v:"2",t:"Days 5–10, or ≤1 day if heparin in past 30 days"}] },
      { id:"thrombosis", label:"Thrombosis or other sequelae", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Progressive/recurrent or suspected thrombosis"},{v:"2",t:"New thrombosis, skin necrosis, or acute systemic reaction"}] },
      { id:"other", label:"Other cause of thrombocytopenia", type:"select", opts:[{v:"0",t:"Definite"},{v:"1",t:"Possible"},{v:"2",t:"None apparent"}] }
    ],
    compute:function(v){
      var s=Number(v.thrombocytopenia)+Number(v.timing)+Number(v.thrombosis)+Number(v.other);
      var b=s<=3?"Low probability of HIT":s<=5?"Intermediate probability":"High probability of HIT";
      return { v:s, u:"/8", i:b+". Guides HIT antibody testing and empirical management. Ref: Lo, J Thromb Haemost 2006 (4Ts)." };
    } },

  { id:"cornell_lvh", cat:"Cardiovascular", icon:"", title:"Cornell Voltage Criteria (LVH)",
    desc:"ECG voltage criteria for left ventricular hypertrophy.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"ravl", label:"R wave in aVL", type:"number", unit:"mm", step:"0.5" },
      { id:"sv3", label:"S wave in V3", type:"number", unit:"mm", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.ravl)||!ok(v.sv3)||v.ravl<0||v.sv3<0) return ERR;
      var sum=v.ravl+v.sv3;
      var thr=v.sex==="f"?20:28;
      var b=sum>thr?"Meets Cornell voltage criteria for LVH":"Does not meet Cornell voltage criteria";
      return { v:r1(sum), u:"mm", i:b+" (threshold "+thr+" mm for the selected sex). Ref: Casale, Circulation 1987 (Cornell)." };
    } },

  { id:"sarcf", cat:"General", icon:"", title:"SARC-F (Sarcopenia Screen)",
    desc:"Screens for sarcopenia (self-reported functional decline).",
    inputs:[
      { id:"strength", label:"Difficulty lifting/carrying ~4.5 kg", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Some"},{v:"2",t:"A lot / unable"}] },
      { id:"walk", label:"Difficulty walking across a room", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Some"},{v:"2",t:"A lot / unable / use aids"}] },
      { id:"chair", label:"Difficulty transferring from a chair/bed", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Some"},{v:"2",t:"A lot / unable without help"}] },
      { id:"stairs", label:"Difficulty climbing a flight of 10 stairs", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Some"},{v:"2",t:"A lot / unable"}] },
      { id:"falls", label:"Falls in the past year", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"1–3 falls"},{v:"2",t:"≥ 4 falls"}] }
    ],
    compute:function(v){
      var s=Number(v.strength)+Number(v.walk)+Number(v.chair)+Number(v.stairs)+Number(v.falls);
      var b=s>=4?"Suggestive of sarcopenia — assess muscle strength/mass":"Lower likelihood of sarcopenia";
      return { v:s, u:"/10", i:b+". Ref: Malmstrom, J Cachexia Sarcopenia Muscle 2016 (SARC-F)." };
    } },

  { id:"cam", cat:"Neurology", icon:"", title:"Confusion Assessment Method (CAM)",
    desc:"Bedside diagnosis of delirium.",
    inputs:[
      { id:"acute", label:"Feature 1: acute onset AND fluctuating course", type:"check" },
      { id:"inattention", label:"Feature 2: inattention", type:"check" },
      { id:"disorganized", label:"Feature 3: disorganised thinking", type:"check" },
      { id:"loc", label:"Feature 4: altered level of consciousness", type:"check" }
    ],
    compute:function(v){
      var pos=v.acute && v.inattention && (v.disorganized || v.loc);
      return { v: pos?"Delirium likely (CAM positive)":"CAM negative", u:"", i:(pos?"Meets CAM criteria — features 1 and 2 plus 3 or 4":"Does not meet CAM criteria; reassess as delirium fluctuates")+". Ref: Inouye, Ann Intern Med 1990 (CAM)." };
    } },

  { id:"meld_na", cat:"Hepatology", icon:"", title:"MELD-Na Score",
    desc:"Liver disease severity incorporating sodium (transplant prioritisation).",
    inputs:[
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"inr", label:"INR", type:"number", step:"0.1" },
      { id:"creat", label:"Creatinine", type:"number", unit:"mg/dL", step:"0.1" },
      { id:"dialysis", label:"Dialysis ≥ twice in the past week", type:"check" },
      { id:"na", label:"Sodium", type:"number", unit:"mmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.bili)||!ok(v.inr)||!ok(v.creat)||!ok(v.na)) return ERR;
      var b=Math.max(v.bili,1), i=Math.max(v.inr,1);
      var c=v.dialysis?4:Math.min(Math.max(v.creat,1),4);
      var meld=Math.round(3.78*Math.log(b)+11.2*Math.log(i)+9.57*Math.log(c)+6.43);
      var na=Math.min(Math.max(v.na,125),137);
      var mn=meld>11 ? Math.round(meld + 1.32*(137-na) - (0.033*meld*(137-na))) : meld;
      mn=Math.max(6,Math.min(40,mn));   // UNOS bounds MELD-Na to 6–40
      var band=mn<=9?"Lower 3-month mortality":mn<=19?"Moderate":mn<=29?"High":"Very high 3-month mortality";
      return { v:mn, u:"", i:band+" (MELD-Na; sodium bounded 125–137, creatinine capped at 4). Ref: Kim, N Engl J Med 2008." };
    } },

  { id:"rts", cat:"Critical care", icon:"", title:"Revised Trauma Score (RTS)",
    desc:"Physiological severity in trauma triage.",
    inputs:[
      { id:"gcs", label:"Glasgow Coma Scale (3–15)", type:"number", step:"1" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg", step:"1" },
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.gcs)||!ok(v.sbp)||!ok(v.rr)||v.gcs<3||v.gcs>15||v.sbp<0||v.rr<0) return ERR;
      var g=v.gcs>=13?4:v.gcs>=9?3:v.gcs>=6?2:v.gcs>=4?1:0;
      var s=v.sbp>89?4:v.sbp>=76?3:v.sbp>=50?2:v.sbp>=1?1:0;
      var r=(v.rr>=10&&v.rr<=29)?4:v.rr>29?3:v.rr>=6?2:v.rr>=1?1:0;
      var rts=0.9368*g+0.7326*s+0.2908*r;
      var band=rts>=7?"Low mortality risk":rts>=4?"Intermediate":"High mortality risk";
      return { v:r1(rts*100)/100, u:"", i:band+" (range 0–7.84; higher = better). Ref: Champion, J Trauma 1989 (RTS)." };
    } },

  { id:"hestia", cat:"Respiratory", icon:"", title:"Hestia Criteria (Outpatient PE)",
    desc:"Whether pulmonary embolism can be managed as an outpatient. Any 'yes' excludes outpatient care.",
    inputs:[
      { id:"unstable", label:"Haemodynamically unstable", type:"check" },
      { id:"thrombolysis", label:"Thrombolysis or embolectomy needed", type:"check" },
      { id:"bleeding", label:"Active bleeding or high bleeding risk", type:"check" },
      { id:"oxygen", label:"Needs supplemental oxygen to maintain saturations", type:"check" },
      { id:"anticoag_fail", label:"PE while already on anticoagulation", type:"check" },
      { id:"pain", label:"Severe pain needing intravenous analgesia", type:"check" },
      { id:"social", label:"Medical or social reason for admission > 24 h", type:"check" },
      { id:"renal", label:"Creatinine clearance markedly reduced", type:"check" },
      { id:"liver", label:"Severe liver impairment", type:"check" },
      { id:"pregnant", label:"Pregnant", type:"check" },
      { id:"hit", label:"History of heparin-induced thrombocytopenia", type:"check" }
    ],
    compute:function(v){
      var keys=["unstable","thrombolysis","bleeding","oxygen","anticoag_fail","pain","social","renal","liver","pregnant","hit"];
      var n=keys.filter(function(k){return v[k];}).length;
      return { v: n===0?"May be suitable for outpatient care":n+" criterion/criteria present — admit", u:"", i:(n===0?"No Hestia criteria met — consider outpatient PE management with anticoagulation":"One or more Hestia criteria present — outpatient management not advised")+". Ref: Zondag, J Thromb Haemost 2011 (Hestia)." };
    } },

  { id:"sokal", cat:"Haematology", icon:"", title:"Sokal Index (Chronic Myeloid Leukaemia)",
    desc:"Prognostic index at diagnosis of chronic-phase CML.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" },
      { id:"spleen", label:"Spleen below costal margin", type:"number", unit:"cm", step:"0.1" },
      { id:"plt", label:"Platelet count", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"blasts", label:"Blasts in peripheral blood", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.spleen)||!ok(v.plt)||!ok(v.blasts)||v.age<0||v.spleen<0||v.plt<0||v.blasts<0) return ERR;
      var e=0.0116*(v.age-43.4)+0.0345*(v.spleen-7.51)+0.188*(Math.pow(v.plt/700,2)-0.563)+0.0887*(v.blasts-2.10);
      var s=Math.exp(e);
      var band=s<0.8?"Low risk":s<=1.2?"Intermediate risk":"High risk";
      return { v:r1(s*100)/100, u:"", i:band+". Ref: Sokal, Blood 1984." };
    } },

  { id:"nlr", cat:"Haematology", icon:"", title:"Neutrophil-Lymphocyte Ratio (NLR)",
    desc:"Marker of systemic inflammation and physiological stress.",
    inputs:[
      { id:"neut", label:"Neutrophil count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"lymph", label:"Lymphocyte count", type:"number", unit:"×10⁹/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.neut)||!ok(v.lymph)||v.lymph<=0||v.neut<0) return ERR;
      var r=v.neut/v.lymph;
      var b=r>=3?"Raised — associated with inflammation, infection or worse prognosis":"Within the usual range";
      return { v:r1(r), u:"", i:b+". Interpret with the clinical picture. Ref: standard haematology." };
    } },

  { id:"plr", cat:"Haematology", icon:"", title:"Platelet-Lymphocyte Ratio (PLR)",
    desc:"Inflammatory and prognostic marker.",
    inputs:[
      { id:"plt", label:"Platelet count", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"lymph", label:"Lymphocyte count", type:"number", unit:"×10⁹/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.plt)||!ok(v.lymph)||v.lymph<=0||v.plt<0) return ERR;
      var r=v.plt/v.lymph;
      return { v:r0(r), u:"", i:"Higher values are associated with systemic inflammation and, in some cancers, a worse prognosis. Interpret with context. Ref: standard haematology." };
    } },

  { id:"aec", cat:"Haematology", icon:"", title:"Absolute Eosinophil Count",
    desc:"Absolute eosinophils from white cell count and differential.",
    inputs:[
      { id:"wbc", label:"White cell count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"eos", label:"Eosinophils", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wbc)||!ok(v.eos)||v.wbc<0||v.eos<0) return ERR;
      var aec=v.wbc*v.eos/100;
      var b=aec>=1.5?"Marked eosinophilia":aec>=0.5?"Eosinophilia":"Normal range";
      return { v:r1(aec*100)/100, u:"×10⁹/L", i:b+". Ref: standard haematology." };
    } },

  { id:"alc", cat:"Haematology", icon:"", title:"Absolute Lymphocyte Count",
    desc:"Absolute lymphocytes from white cell count and differential.",
    inputs:[
      { id:"wbc", label:"White cell count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"lymph", label:"Lymphocytes", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wbc)||!ok(v.lymph)||v.wbc<0||v.lymph<0) return ERR;
      var alc=v.wbc*v.lymph/100;
      var b=alc<1.0?"Lymphopenia":alc>4.0?"Lymphocytosis":"Normal range";
      return { v:r1(alc*100)/100, u:"×10⁹/L", i:b+". Ref: standard haematology." };
    } },

  { id:"bun_cr_ratio", cat:"Renal", icon:"", title:"BUN/Creatinine Ratio",
    desc:"Helps distinguish prerenal from intrinsic renal azotaemia.",
    inputs:[
      { id:"bun", label:"BUN", type:"number", unit:"mg/dL", step:"1" },
      { id:"cr", label:"Creatinine", type:"number", unit:"mg/dL", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.bun)||!ok(v.cr)||v.cr<=0||v.bun<0) return ERR;
      var r=v.bun/v.cr;
      var b=r>20?"Elevated — suggests a prerenal cause or GI bleeding":r<10?"Low — may reflect intrinsic renal disease or low-protein/low-urea states":"Within the usual range";
      return { v:r0(r), u:"", i:b+" (uses BUN, not urea). Ref: standard nephrology." };
    } },

  { id:"modified_shock_index", cat:"Critical care", icon:"", title:"Modified Shock Index",
    desc:"Heart rate divided by mean arterial pressure.",
    inputs:[
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg", step:"1" },
      { id:"dbp", label:"Diastolic BP", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.hr)||!ok(v.sbp)||!ok(v.dbp)||v.hr<0||v.sbp<=0||v.dbp<0) return ERR;
      var map=v.dbp+(v.sbp-v.dbp)/3;
      if(map<=0) return ERR;
      var msi=v.hr/map;
      var b=msi>1.3?"Elevated — associated with hypovolaemia / haemodynamic stress":msi<0.7?"Low":"Within the usual range";
      return { v:r1(msi*100)/100, u:"", i:b+" (MAP "+r0(map)+" mmHg). Ref: standard critical care." };
    } },

  { id:"pulse_pressure", cat:"Cardiovascular", icon:"", title:"Pulse Pressure",
    desc:"Difference between systolic and diastolic blood pressure.",
    inputs:[
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg", step:"1" },
      { id:"dbp", label:"Diastolic BP", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.sbp)||!ok(v.dbp)) return ERR;
      var pp=v.sbp-v.dbp;
      if(pp<0) return { err:"Systolic pressure should exceed diastolic" };
      var b=pp<25?"Narrow — may reflect low stroke volume, tamponade or severe heart failure":pp>100?"Wide — may reflect aortic regurgitation, stiff vessels or a high-output state":"Within the usual range";
      return { v:r0(pp), u:"mmHg", i:b+". Ref: standard cardiovascular physiology." };
    } },

  { id:"corrected_anion_gap", cat:"Renal", icon:"", title:"Albumin-Corrected Anion Gap",
    desc:"Adjusts the anion gap for hypoalbuminaemia.",
    inputs:[
      { id:"ag", label:"Measured anion gap", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"alb", label:"Albumin", type:"number", unit:"g/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.ag)||!ok(v.alb)||v.alb<0) return ERR;
      var c=v.ag+0.25*(40-v.alb);
      var b=c>16?"Raised corrected anion gap — investigate for a high anion gap acidosis":"Corrected anion gap not raised";
      return { v:r1(c), u:"mmol/L", i:b+" (adds ~0.25 mmol/L per g/L of albumin below 40). Ref: Figge, 1998." };
    } },

  { id:"caprini", cat:"Cardiovascular", icon:"", title:"Caprini VTE Risk Score (2005)",
    desc:"Venous thromboembolism risk in surgical and medical patients.",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"≤ 40"},{v:"1",t:"41–60"},{v:"2",t:"61–74"},{v:"3",t:"≥ 75"}] },
      { id:"minor_surgery", label:"Minor surgery", type:"check" },
      { id:"bmi25", label:"BMI > 25", type:"check" },
      { id:"swollen_legs", label:"Swollen legs", type:"check" },
      { id:"varicose", label:"Varicose veins", type:"check" },
      { id:"sepsis", label:"Sepsis (< 1 month)", type:"check" },
      { id:"lung", label:"Serious lung disease / pneumonia (< 1 month)", type:"check" },
      { id:"pft", label:"Abnormal pulmonary function (COPD)", type:"check" },
      { id:"mi", label:"Acute myocardial infarction", type:"check" },
      { id:"chf", label:"Congestive heart failure (< 1 month)", type:"check" },
      { id:"ibd", label:"History of inflammatory bowel disease", type:"check" },
      { id:"bedrest", label:"Medical patient on bed rest", type:"check" },
      { id:"ocp", label:"Oral contraceptives or HRT", type:"check" },
      { id:"pregnancy", label:"Pregnancy or postpartum (< 1 month)", type:"check" },
      { id:"miscarriage", label:"History of unexplained / recurrent miscarriage", type:"check" },
      { id:"arthroscopic", label:"Arthroscopic surgery", type:"check" },
      { id:"major_surgery", label:"Major open surgery > 45 min", type:"check" },
      { id:"laparoscopic", label:"Laparoscopic surgery > 45 min", type:"check" },
      { id:"malignancy", label:"Malignancy (present or previous)", type:"check" },
      { id:"bedrest72", label:"Confined to bed > 72 h", type:"check" },
      { id:"cast", label:"Immobilising plaster cast (< 1 month)", type:"check" },
      { id:"cvc", label:"Central venous access", type:"check" },
      { id:"hx_vte", label:"History of VTE", type:"check" },
      { id:"fhx_vte", label:"Family history of VTE", type:"check" },
      { id:"fvl", label:"Factor V Leiden", type:"check" },
      { id:"pt20210", label:"Prothrombin 20210A", type:"check" },
      { id:"lupus_ac", label:"Lupus anticoagulant", type:"check" },
      { id:"acl", label:"Anticardiolipin antibodies", type:"check" },
      { id:"homocysteine", label:"Elevated serum homocysteine", type:"check" },
      { id:"hit", label:"Heparin-induced thrombocytopenia", type:"check" },
      { id:"thrombophilia", label:"Other congenital/acquired thrombophilia", type:"check" },
      { id:"stroke", label:"Stroke (< 1 month)", type:"check" },
      { id:"arthroplasty", label:"Elective major lower-limb arthroplasty", type:"check" },
      { id:"fracture", label:"Hip, pelvis or leg fracture", type:"check" },
      { id:"sci", label:"Acute spinal cord injury (< 1 month)", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.age)||0;   // unselected age must not become NaN → silent "High risk"
      ["minor_surgery","bmi25","swollen_legs","varicose","sepsis","lung","pft","mi","chf","ibd","bedrest","ocp","pregnancy","miscarriage"].forEach(function(k){ if(v[k])s+=1; });
      ["arthroscopic","major_surgery","laparoscopic","malignancy","bedrest72","cast","cvc"].forEach(function(k){ if(v[k])s+=2; });
      ["hx_vte","fhx_vte","fvl","pt20210","lupus_ac","acl","homocysteine","hit","thrombophilia"].forEach(function(k){ if(v[k])s+=3; });
      ["stroke","arthroplasty","fracture","sci"].forEach(function(k){ if(v[k])s+=5; });
      var b=s===0?"Lowest risk":s<=2?"Low risk":s<=4?"Moderate risk":"High risk — pharmacological prophylaxis usually indicated";
      return { v:s, u:"points", i:b+" (weigh against bleeding risk). Ref: Caprini, Dis Mon 2005." };
    } },

  { id:"ldl_friedewald", cat:"Cardiovascular", icon:"", title:"LDL Cholesterol (Friedewald)",
    desc:"Estimates LDL cholesterol from a fasting lipid profile.",
    inputs:[
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"hdl", label:"HDL cholesterol", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"tg", label:"Triglycerides", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.tc)||!ok(v.hdl)||!ok(v.tg)||v.tc<0||v.hdl<0||v.tg<0) return ERR;
      if(v.tg>4.5) return { err:"Not valid when triglycerides exceed ~4.5 mmol/L — measure LDL directly" };
      var ldl=v.tc-v.hdl-v.tg/2.2;
      if(ldl<0) return { err:"Calculation gives a negative value — check inputs or measure directly" };
      return { v:r1(ldl), u:"mmol/L", i:"Estimated LDL cholesterol (Friedewald); invalid in non-fasting samples or high triglycerides. Ref: Friedewald 1972." };
    } },

  { id:"non_hdl", cat:"Cardiovascular", icon:"", title:"Non-HDL Cholesterol",
    desc:"Total minus HDL cholesterol; a lipid treatment target valid non-fasting.",
    inputs:[
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"hdl", label:"HDL cholesterol", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.tc)||!ok(v.hdl)||v.tc<0||v.hdl<0) return ERR;
      var n=v.tc-v.hdl;
      if(n<0) return { err:"HDL should not exceed total cholesterol" };
      return { v:r1(n), u:"mmol/L", i:"Non-HDL cholesterol (valid in non-fasting samples); a target in lipid guidelines. Ref: standard lipidology." };
    } },

  { id:"blood_volume", cat:"General", icon:"", title:"Estimated Blood Volume",
    desc:"Total blood volume from weight and patient group.",
    inputs:[
      { id:"group", label:"Patient group", type:"select", opts:[{v:"75",t:"Adult male (75 mL/kg)"},{v:"65",t:"Adult female (65 mL/kg)"},{v:"80",t:"Child (80 mL/kg)"},{v:"85",t:"Infant (85 mL/kg)"},{v:"90",t:"Neonate (90 mL/kg)"},{v:"95",t:"Premature neonate (95 mL/kg)"}] },
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||v.wt<=0) return ERR;
      var vol=Number(v.group)*v.wt;
      return { v:r0(vol), u:"mL", i:"Estimated total blood volume ("+Number(v.group)+" mL/kg). Useful for exchange transfusion and maximal allowable blood loss. Ref: standard reference." };
    } },

  { id:"femg", cat:"Renal", icon:"", title:"Fractional Excretion of Magnesium (FEMg)",
    desc:"Assesses renal magnesium handling in hypomagnesaemia.",
    inputs:[
      { id:"umg", label:"Urine magnesium", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"pmg", label:"Plasma magnesium", type:"number", unit:"mmol/L", step:"0.01" },
      { id:"ucr", label:"Urine creatinine (same units as plasma)", type:"number", unit:"µmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.umg)||!ok(v.pcr)||!ok(v.pmg)||!ok(v.ucr)||v.pmg<=0||v.ucr<=0) return ERR;
      var fe=(v.umg*v.pcr)/(0.7*v.pmg*v.ucr)*100;
      var b=fe>4?"Elevated — suggests renal magnesium wasting":"Low — suggests appropriate renal conservation (extrarenal loss or low intake)";
      return { v:r1(fe), u:"%", i:b+" (0.7 factor corrects for protein-bound magnesium; use consistent creatinine units). Ref: standard nephrology." };
    } },

  { id:"gad2", cat:"Psychiatry", icon:"", title:"GAD-2 (Anxiety Screen)",
    desc:"Ultra-brief screen for generalised anxiety over the past 2 weeks.",
    inputs:[
      { id:"q1", label:"Feeling nervous, anxious or on edge", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] },
      { id:"q2", label:"Not being able to stop or control worrying", type:"select", opts:[{v:"0",t:"Not at all"},{v:"1",t:"Several days"},{v:"2",t:"More than half the days"},{v:"3",t:"Nearly every day"}] }
    ],
    compute:function(v){
      var s=Number(v.q1)+Number(v.q2);
      var b=s>=3?"Positive screen — consider GAD-7 and further assessment":"Negative screen";
      return { v:s, u:"/6", i:b+". Ref: Kroenke, Ann Intern Med 2007 (GAD-2)." };
    } },

  { id:"fagerstrom", cat:"Psychiatry", icon:"", title:"Fagerström Test for Nicotine Dependence",
    desc:"Severity of physical nicotine dependence.",
    inputs:[
      { id:"time", label:"Time to first cigarette after waking", type:"select", opts:[{v:"0",t:"> 60 min"},{v:"1",t:"31–60 min"},{v:"2",t:"6–30 min"},{v:"3",t:"≤ 5 min"}] },
      { id:"refrain", label:"Difficulty not smoking where it is forbidden", type:"select", opts:[{v:"0",t:"No"},{v:"1",t:"Yes"}] },
      { id:"giveup", label:"Cigarette you would most hate to give up", type:"select", opts:[{v:"0",t:"Any other"},{v:"1",t:"The first in the morning"}] },
      { id:"cpd", label:"Cigarettes per day", type:"select", opts:[{v:"0",t:"≤ 10"},{v:"1",t:"11–20"},{v:"2",t:"21–30"},{v:"3",t:"≥ 31"}] },
      { id:"morning", label:"Smoke more during the first hours after waking", type:"select", opts:[{v:"0",t:"No"},{v:"1",t:"Yes"}] },
      { id:"ill", label:"Smoke even when ill in bed", type:"select", opts:[{v:"0",t:"No"},{v:"1",t:"Yes"}] }
    ],
    compute:function(v){
      var s=Number(v.time)+Number(v.refrain)+Number(v.giveup)+Number(v.cpd)+Number(v.morning)+Number(v.ill);
      var b=s<=2?"Very low dependence":s<=4?"Low dependence":s===5?"Medium dependence":s<=7?"High dependence":"Very high dependence";
      return { v:s, u:"/10", i:b+". Ref: Heatherton, Br J Addict 1991 (FTND)." };
    } },

  { id:"qtcf", cat:"Cardiovascular", icon:"", title:"Corrected QT — Fridericia (QTcF)",
    desc:"Rate-corrected QT using the Fridericia (cube-root) formula.",
    inputs:[
      { id:"qt", label:"Measured QT interval", type:"number", unit:"ms", step:"1" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.qt)||!ok(v.hr)||v.qt<=0||v.hr<=0) return ERR;
      var rr=60/v.hr;
      var qtcf=v.qt/Math.pow(rr,1/3);
      var b=qtcf>=500?"Markedly prolonged — high torsades risk":qtcf>=470?"Prolonged":"Within the usual range";
      return { v:r0(qtcf), u:"ms", i:b+" (Fridericia; more reliable than Bazett at extremes of heart rate). Ref: Fridericia 1920." };
    } },

  { id:"nrs2002", cat:"General", icon:"", title:"Nutritional Risk Screening (NRS-2002)",
    desc:"Screens hospitalised adults for nutritional risk.",
    inputs:[
      { id:"nut", label:"Impaired nutritional status", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Mild — wt loss >5% in 3 months or intake 50–75%"},{v:"2",t:"Moderate — wt loss >5% in 2 months, BMI 18.5–20.5 + impaired condition, or intake 25–50%"},{v:"3",t:"Severe — wt loss >5% in 1 month, BMI <18.5 + impaired condition, or intake 0–25%"}] },
      { id:"dis", label:"Severity of disease (increased requirements)", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild — chronic illness, hip fracture, cirrhosis, COPD, diabetes, cancer"},{v:"2",t:"Moderate — major abdominal surgery, stroke, severe pneumonia, haematological malignancy"},{v:"3",t:"Severe — head injury, bone-marrow transplant, ICU (APACHE >10)"}] },
      { id:"age70", label:"Age ≥ 70 years", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.nut)+Number(v.dis)+(v.age70?1:0);
      var b=s>=3?"At nutritional risk — start a nutritional care plan":"Not currently at risk — rescreen weekly";
      return { v:s, u:"points", i:b+". Ref: Kondrup, Clin Nutr 2003 (NRS-2002)." };
    } },

  { id:"harris_benedict", cat:"General", icon:"", title:"Harris-Benedict Equation (Energy Needs)",
    desc:"Basal metabolic rate and estimated daily energy requirement.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" },
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" },
      { id:"activity", label:"Activity / stress factor", type:"select", opts:[{v:"1.2",t:"Sedentary (×1.2)"},{v:"1.375",t:"Light activity (×1.375)"},{v:"1.55",t:"Moderate (×1.55)"},{v:"1.725",t:"Very active (×1.725)"},{v:"1.9",t:"Extra active / high stress (×1.9)"}] }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.ht)||!ok(v.age)||v.wt<=0||v.ht<=0||v.age<0) return ERR;
      var bmr=v.sex==="f" ? 447.593+9.247*v.wt+3.098*v.ht-4.330*v.age : 88.362+13.397*v.wt+4.799*v.ht-5.677*v.age;
      var tdee=bmr*Number(v.activity);
      return { v:r0(bmr), u:"kcal/day", i:"Basal metabolic rate; estimated total daily energy ≈ "+r0(tdee)+" kcal/day at the selected factor. Ref: Roza & Shizgal 1984 (revised Harris-Benedict)." };
    } },

  { id:"stool_osmotic_gap", cat:"Gastroenterology", icon:"", title:"Stool Osmotic Gap",
    desc:"Distinguishes osmotic from secretory diarrhoea.",
    inputs:[
      { id:"na", label:"Stool sodium", type:"number", unit:"mmol/L", step:"1" },
      { id:"k", label:"Stool potassium", type:"number", unit:"mmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.k)||v.na<0||v.k<0) return ERR;
      var gap=290-2*(v.na+v.k);
      var b=gap>100?"Wide gap — suggests osmotic diarrhoea":gap<50?"Narrow gap — suggests secretory diarrhoea":"Indeterminate range";
      return { v:r0(gap), u:"mOsm/kg", i:b+" (assumes a stool osmolality of ~290). Ref: standard gastroenterology." };
    } },

  { id:"abc2_ich_volume", cat:"Neurology", icon:"", title:"ABC/2 Intracerebral Haemorrhage Volume",
    desc:"Estimates haematoma volume from CT dimensions.",
    inputs:[
      { id:"a", label:"Greatest diameter (A)", type:"number", unit:"cm", step:"0.1" },
      { id:"b", label:"Diameter perpendicular to A (B)", type:"number", unit:"cm", step:"0.1" },
      { id:"c", label:"Vertical extent (C = slices with blood × slice thickness)", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.a)||!ok(v.b)||!ok(v.c)||v.a<0||v.b<0||v.c<0) return ERR;
      var vol=(v.a*v.b*v.c)/2;
      var big=vol>=30?"Large volume — associated with worse outcome. ":"";
      return { v:r1(vol), u:"mL", i:big+"Ellipsoid approximation of intracerebral haematoma volume. Ref: Kothari, Stroke 1996 (ABC/2)." };
    } },

  { id:"whtr", cat:"General", icon:"", title:"Waist-to-Height Ratio",
    desc:"Central adiposity relative to height.",
    inputs:[
      { id:"waist", label:"Waist circumference", type:"number", unit:"cm", step:"0.1" },
      { id:"height", label:"Height", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.waist)||!ok(v.height)||v.height<=0||v.waist<=0) return ERR;
      var r=v.waist/v.height;
      var b=r>=0.6?"High central adiposity / increased cardiometabolic risk":r>=0.5?"Increased risk — consider lifestyle action":"Within the lower-risk range";
      return { v:r1(r*100)/100, u:"", i:b+" (a simple rule: keep waist under half of height). Ref: Ashwell, standard reference." };
    } },

  { id:"pbw_ardsnet", cat:"Critical care", icon:"", title:"Predicted Body Weight & Lung-Protective Tidal Volume",
    desc:"ARDSNet predicted body weight and 6 mL/kg tidal-volume target.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ht)||v.ht<=0) return ERR;
      var base=v.sex==="f"?45.5:50;
      var pbw=base+0.91*(v.ht-152.4);
      if(pbw<20) return { err:"Height too low for the formula" };
      return { v:r1(pbw), u:"kg", i:"Predicted body weight; lung-protective tidal volume ≈ "+r0(6*pbw)+" mL (6 mL/kg PBW). Ref: ARDSNet, N Engl J Med 2000." };
    } },

  { id:"fractional_shortening", cat:"Cardiovascular", icon:"", title:"LV Fractional Shortening",
    desc:"Echocardiographic measure of left-ventricular systolic function.",
    inputs:[
      { id:"lvedd", label:"LV end-diastolic diameter", type:"number", unit:"mm", step:"0.1" },
      { id:"lvesd", label:"LV end-systolic diameter", type:"number", unit:"mm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.lvedd)||!ok(v.lvesd)||v.lvedd<=0||v.lvesd<0) return ERR;
      if(v.lvesd>=v.lvedd) return { err:"End-systolic diameter should be smaller than end-diastolic" };
      var fs=(v.lvedd-v.lvesd)/v.lvedd*100;
      var b=fs>=25?"Normal fractional shortening":"Reduced — suggests impaired LV systolic function";
      return { v:r1(fs), u:"%", i:b+" (normal ~25–45%). Ref: standard echocardiography." };
    } },

  { id:"mifflin", cat:"General", icon:"", title:"Mifflin-St Jeor Equation (Energy Needs)",
    desc:"Basal metabolic rate and estimated daily energy requirement.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" },
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" },
      { id:"activity", label:"Activity / stress factor", type:"select", opts:[{v:"1.2",t:"Sedentary (×1.2)"},{v:"1.375",t:"Light (×1.375)"},{v:"1.55",t:"Moderate (×1.55)"},{v:"1.725",t:"Very active (×1.725)"},{v:"1.9",t:"Extra active / high stress (×1.9)"}] }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.ht)||!ok(v.age)||v.wt<=0||v.ht<=0||v.age<0) return ERR;
      var bmr=10*v.wt+6.25*v.ht-5*v.age+(v.sex==="f"?-161:5);
      var tdee=bmr*Number(v.activity);
      return { v:r0(bmr), u:"kcal/day", i:"Basal metabolic rate; total daily energy ≈ "+r0(tdee)+" kcal/day at the selected factor (often preferred over Harris-Benedict). Ref: Mifflin, Am J Clin Nutr 1990." };
    } },

  { id:"body_fat", cat:"General", icon:"", title:"Body Fat Percentage (Deurenberg)",
    desc:"Estimates body fat from BMI, age and sex.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.bmi)||!ok(v.age)||v.bmi<=0||v.age<0) return ERR;
      var bf=1.20*v.bmi+0.23*v.age-10.8*(v.sex==="m"?1:0)-5.4;
      return { v:r1(bf), u:"%", i:"Estimated body fat (Deurenberg); a population estimate, less accurate at extremes of physique. Ref: Deurenberg, Br J Nutr 1991." };
    } },

  { id:"sgarbossa_smith", cat:"Cardiovascular", icon:"", title:"Modified Sgarbossa Criteria (MI in LBBB/Paced)",
    desc:"Diagnoses acute MI in left bundle branch block or ventricular pacing.",
    inputs:[
      { id:"concordant_ste", label:"Concordant ST elevation ≥ 1 mm in ≥ 1 lead", type:"check" },
      { id:"concordant_std", label:"Concordant ST depression ≥ 1 mm in V1–V3", type:"check" },
      { id:"discordant_ratio", label:"Discordant ST elevation with ST/S ratio ≤ −0.25 in ≥ 1 lead", type:"check" }
    ],
    compute:function(v){
      var pos=v.concordant_ste||v.concordant_std||v.discordant_ratio;
      return { v: pos?"Positive — acute MI likely":"Negative", u:"", i:(pos?"At least one modified Sgarbossa criterion met — consistent with acute coronary occlusion":"No criterion met; does not exclude MI — correlate clinically and with serial ECG/troponin")+". Ref: Smith, Ann Emerg Med 2012." };
    } },

  { id:"cao2", cat:"Critical care", icon:"", title:"Arterial Oxygen Content (CaO₂)",
    desc:"Total oxygen carried in arterial blood.",
    inputs:[
      { id:"hb", label:"Haemoglobin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"sao2", label:"Arterial oxygen saturation", type:"number", unit:"%", step:"0.1" },
      { id:"pao2", label:"PaO₂", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.hb)||!ok(v.sao2)||!ok(v.pao2)||v.hb<0||v.sao2<0||v.sao2>100||v.pao2<0) return ERR;
      var cao2=1.34*v.hb*(v.sao2/100)+0.003*v.pao2;
      return { v:r1(cao2), u:"mL O₂/dL", i:"Arterial oxygen content (haemoglobin-bound plus dissolved). Multiply by cardiac output ×10 for oxygen delivery. Ref: standard physiology." };
    } },

  { id:"green_king", cat:"Haematology", icon:"", title:"Green & King Index (Thalassaemia vs Iron Deficiency)",
    desc:"Discriminates beta-thalassaemia trait from iron deficiency in microcytosis.",
    inputs:[
      { id:"mcv", label:"MCV", type:"number", unit:"fL", step:"0.1" },
      { id:"rdw", label:"RDW", type:"number", unit:"%", step:"0.1" },
      { id:"hb", label:"Haemoglobin", type:"number", unit:"g/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.mcv)||!ok(v.rdw)||!ok(v.hb)||v.hb<=0||v.mcv<0||v.rdw<=0) return ERR;
      var idx=(v.mcv*v.mcv*v.rdw)/(v.hb*100);
      var b=idx<65?"Favours beta-thalassaemia trait":"Favours iron-deficiency anaemia";
      return { v:r1(idx), u:"", i:b+" (cut-off ~72; confirm with ferritin and haemoglobin studies). Ref: Green & King 1989." };
    } },

  { id:"qtc_fram", cat:"Cardiovascular", icon:"", title:"Corrected QT — Framingham (QTcFram)",
    desc:"Linear heart-rate correction of the QT interval.",
    inputs:[
      { id:"qt", label:"Measured QT interval", type:"number", unit:"ms", step:"1" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.qt)||!ok(v.hr)||v.qt<=0||v.hr<=0) return ERR;
      var rr=60/v.hr;
      var qtc=v.qt+154*(1-rr);
      var b=qtc>=500?"Markedly prolonged":qtc>=470?"Prolonged":"Within the usual range";
      return { v:r0(qtc), u:"ms", i:b+" (Framingham linear correction). Ref: Sagie, Am J Cardiol 1992." };
    } },

  { id:"qtc_hodges", cat:"Cardiovascular", icon:"", title:"Corrected QT — Hodges (QTcH)",
    desc:"Heart-rate correction of the QT interval (Hodges).",
    inputs:[
      { id:"qt", label:"Measured QT interval", type:"number", unit:"ms", step:"1" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.qt)||!ok(v.hr)||v.qt<=0||v.hr<=0) return ERR;
      var qtc=v.qt+1.75*(v.hr-60);
      var b=qtc>=500?"Markedly prolonged":qtc>=470?"Prolonged":"Within the usual range";
      return { v:r0(qtc), u:"ms", i:b+" (Hodges correction; performs consistently across heart rates). Ref: Hodges 1983." };
    } },

  { id:"minute_ventilation", cat:"Critical care", icon:"", title:"Minute Ventilation",
    desc:"Total volume of gas moved by the lungs per minute.",
    inputs:[
      { id:"rr", label:"Respiratory rate", type:"number", unit:"/min", step:"1" },
      { id:"vt", label:"Tidal volume", type:"number", unit:"mL", step:"10" }
    ],
    compute:function(v){
      if(!ok(v.rr)||!ok(v.vt)||v.rr<0||v.vt<0) return ERR;
      var mv=v.rr*v.vt/1000;
      var b=mv>10?"High — seen in metabolic acidosis, sepsis or anxiety":mv<5?"Low — hypoventilation":"Within the usual adult range";
      return { v:r1(mv), u:"L/min", i:b+". Ref: standard respiratory physiology." };
    } },

  { id:"ferriman_gallwey", cat:"Endocrine", icon:"", title:"Ferriman-Gallwey Hirsutism Score",
    desc:"Grades terminal hair in 9 androgen-sensitive areas (each 0–4).",
    inputs:[
      { id:"lip", label:"Upper lip", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"chin", label:"Chin", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"chest", label:"Chest", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"upper_abdo", label:"Upper abdomen", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"lower_abdo", label:"Lower abdomen", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"arm", label:"Upper arm", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"thigh", label:"Thigh", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"upper_back", label:"Upper back", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"lower_back", label:"Lower back", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] }
    ],
    compute:function(v){
      var keys=["lip","chin","chest","upper_abdo","lower_abdo","arm","thigh","upper_back","lower_back"];
      var s=keys.reduce(function(a,k){return a+Number(v[k]);},0);
      var b=s>=8?"Suggests hirsutism — evaluate for androgen excess (e.g. PCOS)":"Below the usual hirsutism threshold";
      return { v:s, u:"/36", i:b+" (threshold ~8 in many populations; lower in some East Asian groups). Ref: Ferriman & Gallwey 1961." };
    } },

  { id:"rancho", cat:"Neurology", icon:"", title:"Rancho Los Amigos Cognitive Scale",
    desc:"Level of cognitive functioning after brain injury.",
    inputs:[
      { id:"level", label:"Level", type:"select", opts:[{v:"I",t:"I — No response"},{v:"II",t:"II — Generalised response"},{v:"III",t:"III — Localised response"},{v:"IV",t:"IV — Confused, agitated"},{v:"V",t:"V — Confused, inappropriate, non-agitated"},{v:"VI",t:"VI — Confused, appropriate"},{v:"VII",t:"VII — Automatic, appropriate"},{v:"VIII",t:"VIII — Purposeful, appropriate"},{v:"IX",t:"IX — Purposeful with standby assistance"},{v:"X",t:"X — Purposeful, modified independent"}] }
    ],
    compute:function(v){
      var m={I:"No response to stimuli",II:"Inconsistent, non-purposeful generalised responses",III:"Localised responses to specific stimuli",IV:"Confused and agitated; bizarre behaviour",V:"Confused, inappropriate, non-agitated; needs structure",VI:"Confused but appropriate; follows simple commands",VII:"Automatic-appropriate; robot-like, poor insight",VIII:"Purposeful-appropriate; recalls and integrates, needs some cueing",IX:"Purposeful; independent with standby assistance on request",X:"Purposeful; modified independent with extra time/aids"};
      return { v:"Level "+v.level, u:"", i:m[v.level]+". Ref: Hagen et al. (Rancho Los Amigos)." };
    } },

  { id:"asia_impairment", cat:"Neurology", icon:"", title:"ASIA Impairment Scale (Spinal Cord Injury)",
    desc:"Grades severity of spinal cord injury.",
    inputs:[
      { id:"grade", label:"Grade", type:"select", opts:[{v:"A",t:"A — Complete: no motor or sensory function in S4–S5"},{v:"B",t:"B — Sensory incomplete"},{v:"C",t:"C — Motor incomplete: majority of key muscles below level grade < 3"},{v:"D",t:"D — Motor incomplete: majority grade ≥ 3"},{v:"E",t:"E — Normal motor and sensory"}] }
    ],
    compute:function(v){
      var m={A:"Complete injury",B:"Sensory incomplete, motor complete",C:"Motor incomplete, weaker (most key muscles < grade 3)",D:"Motor incomplete, stronger (most key muscles ≥ grade 3)",E:"Normal sensory and motor function"};
      return { v:"AIS "+v.grade, u:"", i:m[v.grade]+". Ref: ASIA / ISNCSCI standards." };
    } },

  { id:"house_brackmann", cat:"Neurology", icon:"", title:"House-Brackmann Facial Nerve Grading",
    desc:"Severity of facial nerve dysfunction.",
    inputs:[
      { id:"grade", label:"Grade", type:"select", opts:[{v:"I",t:"I — Normal"},{v:"II",t:"II — Mild dysfunction"},{v:"III",t:"III — Moderate dysfunction"},{v:"IV",t:"IV — Moderately severe dysfunction"},{v:"V",t:"V — Severe dysfunction"},{v:"VI",t:"VI — Total paralysis"}] }
    ],
    compute:function(v){
      var m={I:"Normal facial function",II:"Slight weakness on close inspection; normal symmetry at rest",III:"Obvious but not disfiguring difference; complete eye closure with effort",IV:"Obvious weakness/disfiguring asymmetry; incomplete eye closure",V:"Barely perceptible motion; asymmetry at rest",VI:"No movement (total paralysis)"};
      return { v:"Grade "+v.grade, u:"", i:m[v.grade]+". Ref: House & Brackmann 1985." };
    } },

  { id:"rai", cat:"Haematology", icon:"", title:"Rai Staging (Chronic Lymphocytic Leukaemia)",
    desc:"Prognostic staging of CLL (lymphocytosis assumed present).",
    inputs:[
      { id:"nodes", label:"Lymphadenopathy", type:"check" },
      { id:"organo", label:"Splenomegaly and/or hepatomegaly", type:"check" },
      { id:"anaemia", label:"Anaemia (Hb < 11 g/dL)", type:"check" },
      { id:"thrombocytopenia", label:"Thrombocytopenia (platelets < 100 ×10⁹/L)", type:"check" }
    ],
    compute:function(v){
      var stage=v.thrombocytopenia?"IV":v.anaemia?"III":v.organo?"II":v.nodes?"I":"0";
      var risk=stage==="0"?"Low risk":(stage==="I"||stage==="II")?"Intermediate risk":"High risk";
      return { v:"Stage "+stage, u:"", i:risk+" (lymphocytosis assumed; stage set by the highest feature present). Ref: Rai, Blood 1975." };
    } },

  { id:"binet", cat:"Haematology", icon:"", title:"Binet Staging (Chronic Lymphocytic Leukaemia)",
    desc:"European prognostic staging of CLL.",
    inputs:[
      { id:"areas", label:"Involved lymphoid areas (of 5: cervical, axillary, inguinal nodes, spleen, liver)", type:"number", step:"1" },
      { id:"anaemia", label:"Anaemia (Hb < 10 g/dL)", type:"check" },
      { id:"thrombocytopenia", label:"Thrombocytopenia (platelets < 100 ×10⁹/L)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.areas)||v.areas<0||v.areas>5) return ERR;
      var stage=(v.anaemia||v.thrombocytopenia)?"C":(v.areas>=3)?"B":"A";
      var m={A:"Stage A — good prognosis",B:"Stage B — intermediate prognosis",C:"Stage C — poorer prognosis"};
      return { v:"Stage "+stage, u:"", i:m[stage]+". Ref: Binet, Cancer 1981." };
    } },

  { id:"ann_arbor", cat:"Oncology", icon:"", title:"Ann Arbor Staging (Lymphoma)",
    desc:"Anatomical staging of Hodgkin and non-Hodgkin lymphoma.",
    inputs:[
      { id:"stage", label:"Extent of disease", type:"select", opts:[{v:"1",t:"I — one node region or single extralymphatic site"},{v:"2",t:"II — ≥2 node regions, same side of diaphragm"},{v:"3",t:"III — node regions both sides of the diaphragm"},{v:"4",t:"IV — diffuse extralymphatic involvement"}] },
      { id:"bsymptoms", label:"B symptoms (fever, night sweats, >10% weight loss)", type:"check" },
      { id:"extranodal", label:"Localised extranodal extension (E)", type:"check" }
    ],
    compute:function(v){
      var roman=["","I","II","III","IV"][Number(v.stage)];
      var suffix=(v.extranodal&&Number(v.stage)<4?"E":"")+(v.bsymptoms?"B":"A");
      return { v:"Stage "+roman+suffix, u:"", i:"Ann Arbor (Cotswolds-modified); B symptoms and bulky/extranodal disease refine prognosis and treatment. Ref: Carbone 1971." };
    } },

  { id:"iss_myeloma", cat:"Oncology", icon:"", title:"ISS (Multiple Myeloma Staging)",
    desc:"International Staging System for multiple myeloma.",
    inputs:[
      { id:"b2m", label:"Serum beta-2 microglobulin", type:"number", unit:"mg/L", step:"0.1" },
      { id:"alb", label:"Serum albumin", type:"number", unit:"g/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.b2m)||!ok(v.alb)||v.b2m<0||v.alb<0) return ERR;
      var stage=v.b2m>=5.5?"III":(v.b2m<3.5&&v.alb>=35)?"I":"II";
      var m={I:"Stage I — best median survival",II:"Stage II — intermediate",III:"Stage III — poorest median survival"};
      return { v:"Stage "+stage, u:"", i:m[stage]+" (albumin in g/L). Consider R-ISS adding LDH and cytogenetics. Ref: Greipp, J Clin Oncol 2005 (ISS)." };
    } },

  { id:"katz_adl", cat:"General", icon:"", title:"Katz Index of Independence in ADL",
    desc:"Independence in six basic activities of daily living. Tick each performed INDEPENDENTLY.",
    inputs:[
      { id:"bathing", label:"Bathing", type:"check" },
      { id:"dressing", label:"Dressing", type:"check" },
      { id:"toileting", label:"Toileting", type:"check" },
      { id:"transferring", label:"Transferring", type:"check" },
      { id:"continence", label:"Continence", type:"check" },
      { id:"feeding", label:"Feeding", type:"check" }
    ],
    compute:function(v){
      var s=["bathing","dressing","toileting","transferring","continence","feeding"].filter(function(k){return v[k];}).length;
      var b=s===6?"Full function":s>=4?"Moderate impairment":"Severe functional impairment";
      return { v:s, u:"/6", i:b+" (higher = more independent). Ref: Katz, JAMA 1963." };
    } },

  { id:"lawton_iadl", cat:"General", icon:"", title:"Lawton Instrumental ADL Scale",
    desc:"Independence in eight instrumental activities of daily living. Tick each performed INDEPENDENTLY.",
    inputs:[
      { id:"phone", label:"Using the telephone", type:"check" },
      { id:"shopping", label:"Shopping", type:"check" },
      { id:"food", label:"Food preparation", type:"check" },
      { id:"housekeeping", label:"Housekeeping", type:"check" },
      { id:"laundry", label:"Laundry", type:"check" },
      { id:"transport", label:"Mode of transport", type:"check" },
      { id:"meds", label:"Responsibility for own medication", type:"check" },
      { id:"finances", label:"Ability to handle finances", type:"check" }
    ],
    compute:function(v){
      var s=["phone","shopping","food","housekeeping","laundry","transport","meds","finances"].filter(function(k){return v[k];}).length;
      var b=s>=8?"Independent":s>=4?"Moderate dependence":"High dependence";
      return { v:s, u:"/8", i:b+" (higher = more independent; some versions score 5 items for men). Ref: Lawton & Brody 1969." };
    } },

  { id:"mjoa", cat:"Neurology", icon:"", title:"modified JOA Score (Cervical Myelopathy)",
    desc:"Severity of degenerative cervical myelopathy.",
    inputs:[
      { id:"upper", label:"Motor — upper extremity", type:"select", opts:[{v:"5",t:"5 — normal"},{v:"4",t:"4 — slight clumsiness"},{v:"3",t:"3 — mild clumsiness"},{v:"2",t:"2 — uses knife/fork with difficulty"},{v:"1",t:"1 — cannot use knife/fork, feeds with spoon"},{v:"0",t:"0 — cannot feed self"}] },
      { id:"lower", label:"Motor — lower extremity", type:"select", opts:[{v:"7",t:"7 — normal"},{v:"6",t:"6 — walks with slight difficulty"},{v:"5",t:"5 — mild clumsiness walking"},{v:"4",t:"4 — walks with mild deficit"},{v:"3",t:"3 — lacks stability"},{v:"2",t:"2 — needs rail on stairs"},{v:"1",t:"1 — needs aid on flat ground"},{v:"0",t:"0 — unable to walk"}] },
      { id:"sensory", label:"Sensory — upper extremity", type:"select", opts:[{v:"3",t:"3 — normal"},{v:"2",t:"2 — minimal loss"},{v:"1",t:"1 — mild loss"},{v:"0",t:"0 — severe sensory loss"}] },
      { id:"sphincter", label:"Sphincter function", type:"select", opts:[{v:"3",t:"3 — normal"},{v:"2",t:"2 — mild difficulty"},{v:"1",t:"1 — marked difficulty"},{v:"0",t:"0 — unable to void"}] }
    ],
    compute:function(v){
      var s=Number(v.upper)+Number(v.lower)+Number(v.sensory)+Number(v.sphincter);
      var b=s>=15?"Mild myelopathy":s>=12?"Moderate myelopathy":"Severe myelopathy";
      return { v:s, u:"/18", i:b+" (lower = worse; informs surgical decision-making). Ref: modified JOA (Benzel)." };
    } },

  { id:"dasi", cat:"Cardiovascular", icon:"", title:"Duke Activity Status Index (DASI)",
    desc:"Functional capacity from activities the patient can do; estimates peak VO₂ / METs.",
    inputs:[
      { id:"a1", label:"Take care of yourself (eat, dress, bathe, use toilet)", type:"check" },
      { id:"a2", label:"Walk indoors, e.g. around your house", type:"check" },
      { id:"a3", label:"Walk a block or two on level ground", type:"check" },
      { id:"a4", label:"Climb a flight of stairs or walk up a hill", type:"check" },
      { id:"a5", label:"Run a short distance", type:"check" },
      { id:"a6", label:"Light housework (dusting, washing dishes)", type:"check" },
      { id:"a7", label:"Moderate housework (vacuuming, carrying groceries)", type:"check" },
      { id:"a8", label:"Heavy housework (scrubbing floors, moving furniture)", type:"check" },
      { id:"a9", label:"Yard work (raking, weeding, mowing)", type:"check" },
      { id:"a10", label:"Sexual relations", type:"check" },
      { id:"a11", label:"Moderate recreation (golf, bowling, dancing, doubles tennis)", type:"check" },
      { id:"a12", label:"Strenuous sport (swimming, singles tennis, football, skiing)", type:"check" }
    ],
    compute:function(v){
      var w={a1:2.75,a2:1.75,a3:2.75,a4:5.50,a5:8.00,a6:2.70,a7:3.50,a8:8.00,a9:4.50,a10:5.25,a11:6.00,a12:7.50};
      var s=0; for(var k in w) if(v[k]) s+=w[k];
      var mets=(0.43*s+9.6)/3.5;
      return { v:r1(s), u:"points", i:"Estimated peak VO₂ ≈ "+r1(mets)+" METs (max DASI 58.2; higher = better functional capacity). Ref: Hlatky, Am J Cardiol 1989 (DASI)." };
    } },

  { id:"basfi", cat:"Rheumatology", icon:"", title:"BASFI — Score Interpreter",
    desc:"Interprets a Bath Ankylosing Spondylitis Functional Index result. Administer the official BASFI and enter the 0–10 score.",
    inputs:[
      { id:"score", label:"BASFI score (0–10)", type:"number", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.score)||v.score<0||v.score>10) return ERR;
      var b=v.score>=5?"Marked functional limitation":"Lesser functional limitation";
      return { v:r1(v.score), u:"/10", i:b+" (higher = worse; track alongside BASDAI). Ref: Calin, J Rheumatol 1994 (BASFI)." };
    } },

  { id:"ballard", cat:"Paediatrics", icon:"", title:"New Ballard Score (Gestational Age)",
    desc:"Estimates gestational age from neuromuscular and physical maturity (scores per the Ballard figure).",
    inputs:[
      { id:"posture", label:"Posture", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"square_window", label:"Square window (wrist)", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"arm_recoil", label:"Arm recoil", type:"select", opts:[{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"popliteal_angle", label:"Popliteal angle", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"scarf_sign", label:"Scarf sign", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"heel_to_ear", label:"Heel to ear", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"skin", label:"Skin", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"},{v:"5",t:"5"}] },
      { id:"lanugo", label:"Lanugo", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"plantar", label:"Plantar surface", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"breast", label:"Breast", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"eye_ear", label:"Eye / ear", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] },
      { id:"genitals", label:"Genitals", type:"select", opts:[{v:"-1",t:"-1"},{v:"0",t:"0"},{v:"1",t:"1"},{v:"2",t:"2"},{v:"3",t:"3"},{v:"4",t:"4"}] }
    ],
    compute:function(v){
      var keys=["posture","square_window","arm_recoil","popliteal_angle","scarf_sign","heel_to_ear","skin","lanugo","plantar","breast","eye_ear","genitals"];
      var s=keys.reduce(function(a,k){return a+Number(v[k]);},0);
      var weeks=24+0.4*s;
      return { v:r0(weeks), u:"weeks", i:"Estimated gestational age (maturity score "+s+", range −10 to 50). Ref: Ballard, J Pediatr 1991 (New Ballard Score)." };
    } },

  { id:"burn_tbsa", cat:"General", icon:"", title:"Burn TBSA (Rule of Nines, adult)",
    desc:"Estimates total body surface area burned in adults.",
    inputs:[
      { id:"head", label:"Head and neck", type:"select", opts:[{v:"0",t:"None"},{v:"4.5",t:"Half"},{v:"9",t:"Full (9%)"}] },
      { id:"ant_trunk", label:"Anterior trunk", type:"select", opts:[{v:"0",t:"None"},{v:"9",t:"Half"},{v:"18",t:"Full (18%)"}] },
      { id:"post_trunk", label:"Posterior trunk", type:"select", opts:[{v:"0",t:"None"},{v:"9",t:"Half"},{v:"18",t:"Full (18%)"}] },
      { id:"right_arm", label:"Right arm", type:"select", opts:[{v:"0",t:"None"},{v:"4.5",t:"Half"},{v:"9",t:"Full (9%)"}] },
      { id:"left_arm", label:"Left arm", type:"select", opts:[{v:"0",t:"None"},{v:"4.5",t:"Half"},{v:"9",t:"Full (9%)"}] },
      { id:"right_leg", label:"Right leg", type:"select", opts:[{v:"0",t:"None"},{v:"9",t:"Half"},{v:"18",t:"Full (18%)"}] },
      { id:"left_leg", label:"Left leg", type:"select", opts:[{v:"0",t:"None"},{v:"9",t:"Half"},{v:"18",t:"Full (18%)"}] },
      { id:"perineum", label:"Perineum/genitalia", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Full (1%)"}] }
    ],
    compute:function(v){
      var keys=["head","ant_trunk","post_trunk","right_arm","left_arm","right_leg","left_leg","perineum"];
      var s=keys.reduce(function(a,k){return a+(Number(v[k])||0);},0);
      return { v:r1(s), u:"% TBSA", i:"Adult rule of nines (children differ — larger head, smaller legs). For patchy burns the patient's palm ≈ 1% TBSA. Ref: Wallace rule of nines." };
    } },

  { id:"amts", cat:"Neurology", icon:"", title:"Abbreviated Mental Test Score (AMTS, 10-item)",
    desc:"Rapid screen for cognitive impairment in older adults. Tick each answered correctly.",
    inputs:[
      { id:"age", label:"States their age", type:"check" },
      { id:"time", label:"States the time (to nearest hour)", type:"check" },
      { id:"address", label:"Recalls the address given (42 West Street) at the end", type:"check" },
      { id:"year", label:"States the current year", type:"check" },
      { id:"place", label:"Names the current place/hospital", type:"check" },
      { id:"persons", label:"Recognises two persons (e.g. doctor, nurse)", type:"check" },
      { id:"dob", label:"States their date of birth", type:"check" },
      { id:"history", label:"Names the year of a well-known historical event", type:"check" },
      { id:"monarch", label:"Names the current monarch / head of state", type:"check" },
      { id:"count", label:"Counts backwards from 20 to 1", type:"check" }
    ],
    compute:function(v){
      var s=["age","time","address","year","place","persons","dob","history","monarch","count"].filter(function(k){return v[k];}).length;
      var b=s<=6?"Suggests cognitive impairment — consider formal assessment":"Normal range";
      return { v:s, u:"/10", i:b+" (a score of ≤ 6 is the usual cut-off). Ref: Hodkinson, Age Ageing 1972 (AMTS)." };
    } },

  { id:"hama", cat:"Psychiatry", icon:"", title:"Hamilton Anxiety Rating Scale (HAM-A)",
    desc:"Clinician-rated severity of anxiety (14 domains, each 0–4).",
    inputs:[
      { id:"anxious_mood", label:"Anxious mood", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"tension", label:"Tension", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"fears", label:"Fears", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"insomnia", label:"Insomnia", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"intellectual", label:"Intellectual (cognitive)", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"depressed_mood", label:"Depressed mood", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"somatic_muscular", label:"Somatic (muscular)", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"somatic_sensory", label:"Somatic (sensory)", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"cardiovascular", label:"Cardiovascular symptoms", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"respiratory", label:"Respiratory symptoms", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"gastrointestinal", label:"Gastrointestinal symptoms", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"genitourinary", label:"Genitourinary symptoms", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"autonomic", label:"Autonomic symptoms", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] },
      { id:"behaviour", label:"Behaviour at interview", type:"select", opts:[{v:"0",t:"0 — absent"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"},{v:"4",t:"4 — very severe"}] }
    ],
    compute:function(v){
      var keys=["anxious_mood","tension","fears","insomnia","intellectual","depressed_mood","somatic_muscular","somatic_sensory","cardiovascular","respiratory","gastrointestinal","genitourinary","autonomic","behaviour"];
      var s=keys.reduce(function(a,k){return a+(Number(v[k])||0);},0);
      var b=s<18?"Mild anxiety":s<=24?"Mild-to-moderate anxiety":s<=30?"Moderate-to-severe anxiety":"Severe anxiety";
      return { v:s, u:"/56", i:b+". Ref: Hamilton, Br J Med Psychol 1959 (HAM-A)." };
    } },

  { id:"mna_sf", cat:"General", icon:"", title:"MNA-SF — Score Interpreter",
    desc:"Interprets a Mini Nutritional Assessment — Short Form total. Administer the official MNA®-SF (© Société des Produits Nestlé; free for clinical use from mna-elderly.com) and enter the total.",
    inputs:[
      { id:"total", label:"MNA-SF total (0–14)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>14) return ERR;
      var s=Math.round(v.total);
      var b=s>=12?"Normal nutritional status":s>=8?"At risk of malnutrition":"Malnourished";
      return { v:s, u:"/14", i:b+". Obtain the validated MNA-SF from mna-elderly.com. Banding ref: Rubenstein, J Gerontol 2001. For a fully free alternative, see MUST or NRS-2002." };
    } },

  { id:"absolute_retic", cat:"Haematology", icon:"", title:"Absolute Reticulocyte Count",
    desc:"Converts a reticulocyte percentage to an absolute count.",
    inputs:[
      { id:"retic", label:"Reticulocyte percentage", type:"number", unit:"%", step:"0.1" },
      { id:"rbc", label:"Red cell count", type:"number", unit:"×10¹²/L", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.retic)||!ok(v.rbc)||v.retic<0||v.rbc<0) return ERR;
      var arc=v.retic/100*v.rbc*1000;
      var b=arc>100?"Elevated — active erythropoiesis (haemolysis, blood loss, treatment response)":arc<25?"Low — inadequate marrow response":"Within the usual range";
      return { v:r0(arc), u:"×10⁹/L", i:b+". Ref: standard haematology." };
    } },

  { id:"uacr", cat:"Renal", icon:"", title:"Urine Albumin-to-Creatinine Ratio (uACR)",
    desc:"Screens for and quantifies albuminuria.",
    inputs:[
      { id:"alb", label:"Urine albumin", type:"number", unit:"mg/L", step:"0.1" },
      { id:"cr", label:"Urine creatinine", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.alb)||!ok(v.cr)||v.cr<=0||v.alb<0) return ERR;
      var acr=v.alb/v.cr;
      var b=acr<3?"A1 — normal to mildly increased":acr<=30?"A2 — moderately increased (microalbuminuria)":"A3 — severely increased (macroalbuminuria)";
      return { v:r1(acr), u:"mg/mmol", i:b+" (KDIGO albuminuria category). Ref: KDIGO CKD guideline." };
    } },

  { id:"upcr", cat:"Renal", icon:"", title:"Urine Protein-to-Creatinine Ratio (uPCR)",
    desc:"Quantifies proteinuria from a spot urine sample.",
    inputs:[
      { id:"prot", label:"Urine protein", type:"number", unit:"mg/L", step:"1" },
      { id:"cr", label:"Urine creatinine", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.prot)||!ok(v.cr)||v.cr<=0||v.prot<0) return ERR;
      var pcr=v.prot/v.cr;
      var b=pcr<15?"Normal-range":pcr<100?"Mild-to-moderate proteinuria":pcr<300?"Heavy proteinuria":"Nephrotic-range proteinuria";
      return { v:r1(pcr), u:"mg/mmol", i:b+" (nephrotic range roughly ≥ 300 mg/mmol). Ref: standard nephrology." };
    } },

  { id:"west_haven", cat:"Hepatology", icon:"", title:"West Haven Grade (Hepatic Encephalopathy)",
    desc:"Severity of overt hepatic encephalopathy.",
    inputs:[
      { id:"grade", label:"Clinical grade", type:"select", opts:[{v:"0",t:"0 — Minimal (covert); no clinical signs"},{v:"1",t:"I — Trivial lack of awareness, altered sleep, mild disorientation"},{v:"2",t:"II — Lethargy, disorientation to time, obvious personality change"},{v:"3",t:"III — Somnolence to stupor, gross disorientation, confusion"},{v:"4",t:"IV — Coma"}] }
    ],
    compute:function(v){
      var m={"0":"Minimal/covert HE — detectable only on specialised testing","1":"Grade I — trivial lack of awareness","2":"Grade II — lethargy and disorientation to time (asterixis usually present)","3":"Grade III — marked confusion and somnolence, rousable","4":"Grade IV — coma, unresponsive"};
      return { v:"Grade "+(v.grade==="0"?"0":["","I","II","III","IV"][Number(v.grade)]), u:"", i:m[v.grade]+". Ref: Conn / West Haven criteria." };
    } },

  { id:"cpss", cat:"Neurology", icon:"", title:"Cincinnati Prehospital Stroke Scale",
    desc:"Rapid prehospital screen for stroke.",
    inputs:[
      { id:"face", label:"Facial droop (asymmetry on smiling/showing teeth)", type:"check" },
      { id:"arm", label:"Arm drift (one arm drifts down)", type:"check" },
      { id:"speech", label:"Abnormal speech (slurred / wrong words / unable)", type:"check" }
    ],
    compute:function(v){
      var n=(v.face?1:0)+(v.arm?1:0)+(v.speech?1:0);
      var b=n>=1?"Any abnormality — stroke likely; activate stroke pathway urgently":"No CPSS abnormality (does not fully exclude stroke)";
      return { v:n, u:"/3", i:b+". Ref: Kothari, Ann Emerg Med 1999 (CPSS)." };
    } },

  { id:"rosier", cat:"Neurology", icon:"", title:"ROSIER Scale (Stroke Recognition in ED)",
    desc:"Distinguishes acute stroke from mimics in the emergency department.",
    inputs:[
      { id:"loc", label:"Loss of consciousness or syncope", type:"check" },
      { id:"seizure", label:"Seizure activity", type:"check" },
      { id:"face", label:"Asymmetric facial weakness", type:"check" },
      { id:"arm", label:"Asymmetric arm weakness", type:"check" },
      { id:"leg", label:"Asymmetric leg weakness", type:"check" },
      { id:"speech", label:"Speech disturbance", type:"check" },
      { id:"visual", label:"Visual field defect", type:"check" }
    ],
    compute:function(v){
      var s=(v.face?1:0)+(v.arm?1:0)+(v.leg?1:0)+(v.speech?1:0)+(v.visual?1:0)-(v.loc?1:0)-(v.seizure?1:0);
      var b=s>0?"Stroke likely — assess for acute stroke pathway":"Stroke less likely (score ≤ 0) — consider a mimic, but clinical judgement overrides";
      return { v:s, u:"points", i:b+". Ref: Nor, Lancet Neurol 2005 (ROSIER)." };
    } },

  { id:"fick_co", cat:"Cardiovascular", icon:"", title:"Cardiac Output (Fick, estimated)",
    desc:"Estimates cardiac output from oxygen consumption and arteriovenous O₂ difference.",
    inputs:[
      { id:"vo2", label:"O₂ consumption (≈125 × BSA, or measured)", type:"number", unit:"mL/min", step:"1" },
      { id:"hb", label:"Haemoglobin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"sao2", label:"Arterial O₂ saturation", type:"number", unit:"%", step:"0.1" },
      { id:"svo2", label:"Mixed venous O₂ saturation", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.vo2)||!ok(v.hb)||!ok(v.sao2)||!ok(v.svo2)||v.hb<=0||v.vo2<0) return ERR;
      var avd=13.4*v.hb*((v.sao2-v.svo2)/100);
      if(avd<=0) return { err:"Arterial saturation must exceed venous saturation" };
      var co=v.vo2/avd;
      var b=co<4?"Low cardiac output":co>8?"High cardiac output":"Within the usual range";
      return { v:r1(co), u:"L/min", i:b+" (Fick principle). Ref: standard cardiovascular physiology." };
    } },

  { id:"fontaine", cat:"Cardiovascular", icon:"", title:"Fontaine Classification (Peripheral Arterial Disease)",
    desc:"Clinical stage of lower-limb peripheral arterial disease.",
    inputs:[
      { id:"stage", label:"Stage", type:"select", opts:[{v:"1",t:"I — Asymptomatic"},{v:"2a",t:"IIa — Mild claudication (>200 m)"},{v:"2b",t:"IIb — Moderate–severe claudication (<200 m)"},{v:"3",t:"III — Ischaemic rest pain"},{v:"4",t:"IV — Ulceration or gangrene"}] }
    ],
    compute:function(v){
      var m={"1":"Asymptomatic disease","2a":"Mild intermittent claudication","2b":"Moderate-to-severe claudication","3":"Ischaemic rest pain (critical limb ischaemia)","4":"Tissue loss — ulceration or gangrene (critical limb ischaemia)"};
      var lab={"1":"I","2a":"IIa","2b":"IIb","3":"III","4":"IV"};
      return { v:"Stage "+lab[v.stage], u:"", i:m[v.stage]+". Stages III–IV = critical limb ischaemia. Ref: Fontaine classification." };
    } },

  { id:"rutherford", cat:"Cardiovascular", icon:"", title:"Rutherford Classification (Peripheral Arterial Disease)",
    desc:"Category of chronic limb ischaemia.",
    inputs:[
      { id:"cat", label:"Category", type:"select", opts:[{v:"0",t:"0 — Asymptomatic"},{v:"1",t:"1 — Mild claudication"},{v:"2",t:"2 — Moderate claudication"},{v:"3",t:"3 — Severe claudication"},{v:"4",t:"4 — Ischaemic rest pain"},{v:"5",t:"5 — Minor tissue loss"},{v:"6",t:"6 — Major tissue loss"}] }
    ],
    compute:function(v){
      var n=Number(v.cat);
      var m=["Asymptomatic","Mild claudication","Moderate claudication","Severe claudication","Ischaemic rest pain","Minor tissue loss (non-healing ulcer, focal gangrene)","Major tissue loss (extending above transmetatarsal, functional foot no longer salvageable)"];
      return { v:"Category "+n, u:"", i:m[n]+(n>=4?" — critical limb ischaemia":"")+". Ref: Rutherford, J Vasc Surg 1997." };
    } },

  { id:"salter_harris", cat:"Musculoskeletal", icon:"", title:"Salter-Harris Classification (Physeal Fracture)",
    desc:"Classifies growth-plate (physeal) fractures in children.",
    inputs:[
      { id:"type", label:"Type", type:"select", opts:[{v:"1",t:"I — through the physis only"},{v:"2",t:"II — physis + metaphysis"},{v:"3",t:"III — physis + epiphysis (intra-articular)"},{v:"4",t:"IV — epiphysis + physis + metaphysis"},{v:"5",t:"V — crush injury of the physis"}] }
    ],
    compute:function(v){
      var m={"1":"Type I — fracture through the growth plate only (often radiographically occult)","2":"Type II — through the physis and metaphysis (commonest)","3":"Type III — through the physis into the epiphysis; intra-articular","4":"Type IV — across metaphysis, physis and epiphysis; intra-articular","5":"Type V — crush of the physis; high risk of growth arrest"};
      return { v:"Type "+["","I","II","III","IV","V"][Number(v.type)], u:"", i:m[v.type]+" (higher types carry greater growth-disturbance risk). Ref: Salter & Harris 1963." };
    } },

  { id:"fitzpatrick", cat:"Dermatology", icon:"", title:"Fitzpatrick Skin Phototype",
    desc:"Classifies skin type by response to ultraviolet light.",
    inputs:[
      { id:"type", label:"Phototype", type:"select", opts:[{v:"1",t:"I — always burns, never tans (pale white)"},{v:"2",t:"II — usually burns, tans minimally"},{v:"3",t:"III — sometimes burns, tans uniformly"},{v:"4",t:"IV — burns minimally, tans easily (olive)"},{v:"5",t:"V — rarely burns, tans profusely (brown)"},{v:"6",t:"VI — never burns (deeply pigmented)"}] }
    ],
    compute:function(v){
      var n=Number(v.type);
      var b=n<=2?"Higher photosensitivity and skin-cancer risk; counsel strict photoprotection":n<=4?"Intermediate photosensitivity":"Lower burn risk but still counsel photoprotection; higher risk of dyspigmentation";
      return { v:"Type "+["","I","II","III","IV","V","VI"][n], u:"", i:b+". Ref: Fitzpatrick 1988." };
    } },

  { id:"lams", cat:"Neurology", icon:"", title:"Los Angeles Motor Scale (LAMS)",
    desc:"Prehospital motor severity; screens for large-vessel occlusion.",
    inputs:[
      { id:"face", label:"Facial droop", type:"select", opts:[{v:"0",t:"Absent"},{v:"1",t:"Present"}] },
      { id:"arm", label:"Arm drift", type:"select", opts:[{v:"0",t:"Absent"},{v:"1",t:"Drifts down"},{v:"2",t:"Falls rapidly"}] },
      { id:"grip", label:"Grip strength", type:"select", opts:[{v:"0",t:"Normal"},{v:"1",t:"Weak"},{v:"2",t:"No grip"}] }
    ],
    compute:function(v){
      var s=Number(v.face)+Number(v.arm)+Number(v.grip);
      var b=s>=4?"High — suggests large-vessel occlusion; consider a thrombectomy-capable centre":"Lower likelihood of large-vessel occlusion";
      return { v:s, u:"/5", i:b+". Ref: Nazliel, Stroke 2008 (LAMS)." };
    } },

  { id:"robson", cat:"Obstetrics", icon:"", title:"Robson Ten-Group Classification (Caesarean)",
    desc:"Assigns the Robson group for auditing caesarean-section rates.",
    inputs:[
      { id:"fetuses", label:"Number of fetuses", type:"select", opts:[{v:"single",t:"Single"},{v:"multiple",t:"Multiple"}] },
      { id:"lie", label:"Lie / presentation", type:"select", opts:[{v:"cephalic",t:"Cephalic"},{v:"breech",t:"Breech"},{v:"transverse",t:"Transverse / oblique"}] },
      { id:"gestation", label:"Gestation", type:"select", opts:[{v:"term",t:"≥ 37 weeks"},{v:"preterm",t:"< 37 weeks"}] },
      { id:"parity", label:"Parity", type:"select", opts:[{v:"nulliparous",t:"Nulliparous"},{v:"multiparous",t:"Multiparous"}] },
      { id:"prevcs", label:"Previous caesarean", type:"select", opts:[{v:"no",t:"No"},{v:"yes",t:"Yes"}] },
      { id:"onset", label:"Onset of labour", type:"select", opts:[{v:"spontaneous",t:"Spontaneous"},{v:"induced",t:"Induced"},{v:"prelabour",t:"Caesarean before labour"}] }
    ],
    compute:function(v){
      var g;
      if(v.fetuses==="multiple") g=8;
      else if(v.lie==="transverse") g=9;
      else if(v.lie==="breech") g=(v.parity==="nulliparous")?6:7;
      else { if(v.gestation==="preterm") g=10; else if(v.prevcs==="yes") g=5; else if(v.parity==="nulliparous") g=(v.onset==="spontaneous")?1:2; else g=(v.onset==="spontaneous")?3:4; }
      var m={1:"Nulliparous, single cephalic, ≥37wk, spontaneous labour",2:"Nulliparous, single cephalic, ≥37wk, induced or pre-labour CS",3:"Multiparous (no prior CS), single cephalic, ≥37wk, spontaneous",4:"Multiparous (no prior CS), single cephalic, ≥37wk, induced or pre-labour CS",5:"Previous caesarean, single cephalic, ≥37wk",6:"Nulliparous, single breech",7:"Multiparous, single breech (incl. prior CS)",8:"Multiple pregnancy (incl. prior CS)",9:"Transverse or oblique lie (incl. prior CS)",10:"Single cephalic, <37wk (incl. prior CS)"};
      return { v:"Group "+g, u:"", i:m[g]+". Ref: Robson 2001 (WHO-endorsed CS audit)." };
    } },

  { id:"acr_eular_ra", cat:"Rheumatology", icon:"", title:"ACR/EULAR Rheumatoid Arthritis Classification (2010)",
    desc:"Classification of RA (requires ≥1 joint with definite clinical synovitis not better explained by another disease).",
    inputs:[
      { id:"joints", label:"Joint involvement", type:"select", opts:[{v:"0",t:"1 large joint"},{v:"1",t:"2–10 large joints"},{v:"2",t:"1–3 small joints"},{v:"3",t:"4–10 small joints"},{v:"5",t:">10 joints (≥1 small)"}] },
      { id:"serology", label:"Serology (RF and anti-CCP)", type:"select", opts:[{v:"0",t:"Both negative"},{v:"2",t:"Low-positive RF or anti-CCP"},{v:"3",t:"High-positive RF or anti-CCP"}] },
      { id:"acute", label:"Acute-phase reactants", type:"select", opts:[{v:"0",t:"Normal CRP and ESR"},{v:"1",t:"Abnormal CRP or ESR"}] },
      { id:"duration", label:"Duration of symptoms", type:"select", opts:[{v:"0",t:"< 6 weeks"},{v:"1",t:"≥ 6 weeks"}] }
    ],
    compute:function(v){
      var s=Number(v.joints)+Number(v.serology)+Number(v.acute)+Number(v.duration);
      var b=s>=6?"Definite rheumatoid arthritis (score ≥ 6/10)":"Does not meet classification (may still be RA — reassess over time)";
      return { v:s, u:"/10", i:b+". Ref: Aletaha, Arthritis Rheum 2010 (ACR/EULAR)." };
    } },

  { id:"corrected_age", cat:"Paediatrics", icon:"", title:"Corrected Age for Prematurity",
    desc:"Adjusts a premature infant's age for the degree of prematurity.",
    inputs:[
      { id:"chrono", label:"Chronological age", type:"number", unit:"weeks", step:"1" },
      { id:"ga", label:"Gestational age at birth", type:"number", unit:"weeks", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.chrono)||!ok(v.ga)||v.chrono<0||v.ga<=0||v.ga>42) return ERR;
      var corr=v.chrono-(40-v.ga);
      if(corr<0) corr=0;
      var wk=Math.floor(corr), d=Math.round((corr-wk)*7);
      return { v:r1(corr), u:"weeks", i:"Corrected age ≈ "+wk+" wk "+d+" d (chronological age minus weeks of prematurity). Use until ~2–3 years for growth/development assessment. Ref: standard neonatology." };
    } },

  { id:"rate_pressure_product", cat:"Cardiovascular", icon:"", title:"Rate-Pressure Product (Double Product)",
    desc:"Estimate of myocardial oxygen demand.",
    inputs:[
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" },
      { id:"sbp", label:"Systolic BP", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.hr)||!ok(v.sbp)||v.hr<0||v.sbp<0) return ERR;
      var rpp=v.hr*v.sbp;
      var b=rpp>25000?"Very high myocardial oxygen demand":rpp>15000?"Elevated demand":"Within the usual resting range";
      return { v:r0(rpp), u:"mmHg·bpm", i:b+" (rises with exertion; the ischaemic threshold is patient-specific). Ref: standard cardiovascular physiology." };
    } },

  { id:"corrected_wbc", cat:"Haematology", icon:"", title:"Corrected WBC for Nucleated RBCs",
    desc:"Corrects an automated white cell count when nucleated red cells are present.",
    inputs:[
      { id:"wbc", label:"Measured (uncorrected) WBC", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"nrbc", label:"Nucleated RBCs per 100 WBC", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.wbc)||!ok(v.nrbc)||v.wbc<0||v.nrbc<0) return ERR;
      var c=v.wbc*100/(100+v.nrbc);
      return { v:r1(c), u:"×10⁹/L", i:"True white cell count after removing nucleated red cells that were counted as leukocytes. Ref: standard haematology." };
    } },

  { id:"gose", cat:"Neurology", icon:"", title:"Glasgow Outcome Scale — Extended (GOS-E)",
    desc:"Functional outcome after traumatic brain injury.",
    inputs:[
      { id:"grade", label:"Outcome category", type:"select", opts:[{v:"8",t:"8 — Upper good recovery"},{v:"7",t:"7 — Lower good recovery"},{v:"6",t:"6 — Upper moderate disability"},{v:"5",t:"5 — Lower moderate disability"},{v:"4",t:"4 — Upper severe disability"},{v:"3",t:"3 — Lower severe disability"},{v:"2",t:"2 — Vegetative state"},{v:"1",t:"1 — Dead"}] }
    ],
    compute:function(v){
      var m={"1":"Dead","2":"Vegetative state — unresponsive","3":"Lower severe disability — dependent for daily support","4":"Upper severe disability — dependent but some independence at home","5":"Lower moderate disability — independent but cannot resume prior work/social life","6":"Upper moderate disability — some reduction in work/social capacity","7":"Lower good recovery — minor deficits affecting daily life","8":"Upper good recovery — full recovery or minor residual symptoms"};
      return { v:"GOS-E "+v.grade, u:"", i:m[v.grade]+". Ref: Wilson, J Neurotrauma 1998 (GOS-E)." };
    } },

  { id:"paeds_weight", cat:"Paediatrics", icon:"", title:"Paediatric Weight Estimate (APLS)",
    desc:"Estimates a child's weight when it cannot be measured (emergencies).",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"years", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.age)||v.age<0||v.age>12) return { err:"For age > 12 use measured or adult weight (APLS estimate validated 1–12 y)" };
      if(v.age<1) return { err:"Use a length-based method (e.g. Broselow tape) for infants < 1 year" };
      var wt=(v.age<=5)?2*v.age+8:3*v.age+7;
      return { v:r1(wt), u:"kg", i:"Estimated weight (APLS: 1–5y = 2×age+8; 6–12y = 3×age+7). An emergency estimate — weigh the child as soon as feasible. Ref: APLS." };
    } },

  { id:"ett_size", cat:"Paediatrics", icon:"", title:"Paediatric ETT Size & Depth",
    desc:"Estimates endotracheal tube size and insertion depth by age.",
    inputs:[
      { id:"age", label:"Age", type:"number", unit:"years", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.age)||v.age<1||v.age>14) return ERR;
      var uncuffed=v.age/4+4, cuffed=v.age/4+3.5, depth=v.age/2+12;
      return { v:r1(uncuffed), u:"mm ID (uncuffed)", i:"Cuffed internal diameter ≈ "+r1(cuffed)+" mm; oral insertion depth ≈ "+r1(depth)+" cm. For age ≥ 1 year (neonates/infants need dedicated sizing). Ref: standard paediatric airway (age/4 + 4)." };
    } },

  { id:"ga_crl", cat:"Obstetrics", icon:"", title:"Gestational Age from Crown-Rump Length",
    desc:"First-trimester gestational age from CRL (Robinson-Fleming).",
    inputs:[
      { id:"crl", label:"Crown-rump length", type:"number", unit:"mm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.crl)||v.crl<2||v.crl>120) return ERR;
      var days=8.052*Math.sqrt(v.crl)+23.73;
      var wk=Math.floor(days/7), d=Math.round(days-wk*7);
      return { v:wk+"+"+d, u:"weeks+days", i:"Estimated gestational age ("+r0(days)+" days); most accurate for CRL ~10–84 mm. Ref: Robinson & Fleming 1975." };
    } },

  { id:"cardiac_index", cat:"Cardiovascular", icon:"", title:"Cardiac Index",
    desc:"Cardiac output normalised to body surface area.",
    inputs:[
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" },
      { id:"bsa", label:"Body surface area", type:"number", unit:"m²", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.co)||!ok(v.bsa)||v.bsa<=0||v.co<0) return ERR;
      var ci=v.co/v.bsa;
      var b=ci<2.2?"Low — consistent with a cardiogenic-shock / low-output state":ci>4?"High-output state":"Within the usual range";
      return { v:r1(ci), u:"L/min/m²", i:b+" (normal ~2.5–4.0). Ref: standard haemodynamics." };
    } },

  { id:"stroke_volume", cat:"Cardiovascular", icon:"", title:"Stroke Volume & Index",
    desc:"Blood ejected per beat, from cardiac output and heart rate.",
    inputs:[
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" },
      { id:"hr", label:"Heart rate", type:"number", unit:"bpm", step:"1" },
      { id:"bsa", label:"Body surface area (optional, for index)", type:"number", unit:"m²", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.co)||!ok(v.hr)||v.hr<=0||v.co<0) return ERR;
      var sv=v.co*1000/v.hr;
      var svi=(ok(v.bsa)&&v.bsa>0)?"; stroke volume index ≈ "+r1(sv/v.bsa)+" mL/m²":"";
      var b=sv<60?"Low stroke volume":sv>100?"High stroke volume":"Within the usual range";
      return { v:r1(sv), u:"mL", i:b+" (normal ~60–100 mL"+svi+"). Ref: standard haemodynamics." };
    } },

  { id:"homa_b", cat:"Endocrine", icon:"", title:"HOMA-%B (Beta-Cell Function)",
    desc:"Estimates pancreatic beta-cell function from fasting values.",
    inputs:[
      { id:"ins", label:"Fasting insulin", type:"number", unit:"µU/mL", step:"0.1" },
      { id:"glu", label:"Fasting glucose", type:"number", unit:"mmol/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.ins)||!ok(v.glu)||v.ins<0||v.glu<=3.5) return { err:"Fasting glucose must exceed 3.5 mmol/L for this formula" };
      var b=20*v.ins/(v.glu-3.5);
      return { v:r0(b), u:"%", i:"Beta-cell function relative to a normal reference (~100%). Interpret alongside HOMA-IR. Ref: Matthews, Diabetologia 1985 (HOMA)." };
    } },

  { id:"asdas_crp", cat:"Rheumatology", icon:"", title:"ASDAS-CRP (Axial Spondyloarthritis Activity)",
    desc:"Ankylosing Spondylitis Disease Activity Score using CRP.",
    inputs:[
      { id:"backpain", label:"Back pain (BASDAI Q2, 0–10)", type:"number", step:"0.1" },
      { id:"stiffness", label:"Morning stiffness duration (BASDAI Q6, 0–10)", type:"number", step:"0.1" },
      { id:"global", label:"Patient global (0–10)", type:"number", step:"0.1" },
      { id:"peripheral", label:"Peripheral pain/swelling (BASDAI Q3, 0–10)", type:"number", step:"0.1" },
      { id:"crp", label:"CRP", type:"number", unit:"mg/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.backpain)||!ok(v.stiffness)||!ok(v.global)||!ok(v.peripheral)||!ok(v.crp)||v.crp<0) return ERR;
      function c10(x){return Math.max(0,Math.min(10,x));} var crp=Math.max(v.crp,2);
      var s=0.12*c10(v.backpain)+0.06*c10(v.stiffness)+0.11*c10(v.global)+0.07*c10(v.peripheral)+0.58*Math.log(crp+1);
      var b=s<1.3?"Inactive disease":s<2.1?"Low disease activity":s<=3.5?"High disease activity":"Very high disease activity";
      return { v:Math.round(s*100)/100, u:"", i:b+" (CRP in mg/L). Ref: Lukas, Ann Rheum Dis 2009 (ASDAS)." };
    } },

  { id:"ava_continuity", cat:"Cardiovascular", icon:"", title:"Aortic Valve Area (Continuity Equation)",
    desc:"Echocardiographic aortic valve area in aortic stenosis.",
    inputs:[
      { id:"lvot_d", label:"LVOT diameter", type:"number", unit:"cm", step:"0.1" },
      { id:"lvot_vti", label:"LVOT velocity-time integral", type:"number", unit:"cm", step:"0.1" },
      { id:"av_vti", label:"Aortic-valve velocity-time integral", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.lvot_d)||!ok(v.lvot_vti)||!ok(v.av_vti)||v.lvot_d<=0||v.lvot_vti<=0||v.av_vti<=0) return ERR;
      var lvotArea=Math.PI*Math.pow(v.lvot_d/2,2);
      var ava=(lvotArea*v.lvot_vti)/v.av_vti;
      var b=ava<1?"Severe aortic stenosis":ava<1.5?"Moderate aortic stenosis":ava<2?"Mild aortic stenosis":"Normal valve area";
      return { v:Math.round(ava*100)/100, u:"cm²", i:b+" (severe <1.0, moderate 1.0–1.5, mild 1.5–2.0 cm²). Ref: continuity equation (ASE)." };
    } },

  { id:"svr", cat:"Critical care", icon:"", title:"Systemic Vascular Resistance (SVR)",
    desc:"Afterload estimate from mean arterial pressure, CVP and cardiac output.",
    inputs:[
      { id:"map", label:"Mean arterial pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"cvp", label:"Central venous pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.map)||!ok(v.cvp)||!ok(v.co)||v.co<=0) return ERR;
      var svr=(v.map-v.cvp)/v.co*80;
      var b=svr<800?"Low SVR — vasodilatory (e.g. sepsis, anaphylaxis)":svr>1200?"High SVR — vasoconstriction (e.g. cardiogenic/hypovolaemic shock)":"Within the usual range";
      return { v:r0(svr), u:"dyn·s·cm⁻⁵", i:b+" (normal ~800–1200). Ref: standard haemodynamics." };
    } },

  { id:"mmrc_dyspnoea", cat:"Respiratory", icon:"", title:"mMRC Dyspnoea Scale",
    desc:"Modified Medical Research Council breathlessness grade.",
    inputs:[
      { id:"grade", label:"Breathlessness", type:"select", opts:[
        {v:"0",t:"Grade 0 — only with strenuous exercise"},
        {v:"1",t:"Grade 1 — hurrying on the level or up a slight hill"},
        {v:"2",t:"Grade 2 — walks slower than peers, or stops for breath at own pace"},
        {v:"3",t:"Grade 3 — stops for breath after ~100 m or a few minutes on the level"},
        {v:"4",t:"Grade 4 — too breathless to leave the house / breathless when dressing"}
      ] }
    ],
    compute:function(v){
      var g=Number(v.grade)||0;
      var b=g>=2?"More symptoms (mMRC ≥2) — higher symptom-burden category in COPD assessment":"Fewer symptoms (mMRC 0–1)";
      return { v:g, u:"grade", i:b+". Ref: Fletcher CM; mMRC scale (GOLD)." };
    } },

  { id:"canadian_cspine", cat:"Neurology", icon:"", title:"Canadian C-Spine Rule",
    desc:"Need for cervical-spine imaging after trauma (alert, stable, GCS 15).",
    inputs:[
      { id:"hr_age", label:"High-risk: age ≥65", type:"check" },
      { id:"hr_mech", label:"High-risk: dangerous mechanism", type:"check" },
      { id:"hr_paraes", label:"High-risk: paraesthesiae in the extremities", type:"check" },
      { id:"lr_rearend", label:"Low-risk: simple rear-end collision", type:"check" },
      { id:"lr_sitting", label:"Low-risk: sitting position in the department", type:"check" },
      { id:"lr_ambulatory", label:"Low-risk: ambulatory at any time", type:"check" },
      { id:"lr_delayed", label:"Low-risk: delayed onset of neck pain", type:"check" },
      { id:"lr_no_tenderness", label:"Low-risk: no midline cervical tenderness", type:"check" },
      { id:"rotate", label:"Able to actively rotate neck 45° left and right", type:"check" }
    ],
    compute:function(v){
      var highRisk = v.hr_age||v.hr_mech||v.hr_paraes;
      var anyLowRisk = v.lr_rearend||v.lr_sitting||v.lr_ambulatory||v.lr_delayed||v.lr_no_tenderness;
      if(highRisk) return { v:"Imaging indicated", u:"", i:"A high-risk factor is present — radiography is recommended before assessing neck movement." };
      if(!anyLowRisk) return { v:"Imaging indicated", u:"", i:"No low-risk factor permits safe assessment of movement — radiography is recommended." };
      if(!v.rotate) return { v:"Imaging indicated", u:"", i:"Low-risk factor present but unable to rotate the neck 45° both ways — radiography is recommended." };
      return { v:"No imaging", u:"", i:"No high-risk factor, a low-risk factor allows safe assessment, and the neck rotates 45° both ways — imaging can be safely deferred. Applies only when GCS 15 and haemodynamically stable. Ref: Stiell IG, JAMA 2001." };
    } },

  { id:"nutric", cat:"Critical care", icon:"", title:"mNUTRIC Score (Nutrition Risk)",
    desc:"Modified NUTRIC nutritional-risk score for critically ill adults (IL-6 omitted).",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"<50"},{v:"1",t:"50–74"},{v:"2",t:"≥75"}] },
      { id:"apache", label:"APACHE II", type:"select", opts:[{v:"0",t:"<15"},{v:"1",t:"15–19"},{v:"2",t:"20–27"},{v:"3",t:"≥28"}] },
      { id:"sofa", label:"SOFA", type:"select", opts:[{v:"0",t:"<6"},{v:"1",t:"6–9"},{v:"2",t:"≥10"}] },
      { id:"comorb", label:"Number of comorbidities", type:"select", opts:[{v:"0",t:"0–1"},{v:"1",t:"≥2"}] },
      { id:"days", label:"Days from hospital to ICU admission", type:"select", opts:[{v:"0",t:"<1"},{v:"1",t:"≥1"}] }
    ],
    compute:function(v){
      var s=(Number(v.age)||0)+(Number(v.apache)||0)+(Number(v.sofa)||0)+(Number(v.comorb)||0)+(Number(v.days)||0);
      var b=s>=5?"High nutritional risk (5–9) — associated with worse outcomes; likely to benefit from aggressive nutrition support":"Low nutritional risk (0–4)";
      return { v:s, u:"/9", i:b+". Modified NUTRIC. Ref: Heyland, Crit Care 2011; Rahman, Clin Nutr 2016." };
    } },

  { id:"lbm", cat:"General", icon:"", title:"Lean Body Mass (Boer)",
    desc:"Estimated lean body mass from weight, height and sex.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.ht)||v.wt<=0||v.ht<=0) return ERR;
      var lbm = v.sex==="f" ? 0.252*v.wt+0.473*v.ht-48.3 : 0.407*v.wt+0.267*v.ht-19.2;
      if(lbm<=0) return { err:"Inputs give a non-physiological result — check weight and height" };
      return { v:r1(lbm), u:"kg", i:"Estimated lean body mass (Boer formula); useful for weight-based drug dosing. Ref: Boer P, Am J Physiol 1984." };
    } },

  { id:"tbw_watson", cat:"Renal", icon:"", title:"Total Body Water (Watson)",
    desc:"Estimated total body water from age, sex, height and weight.",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"age", label:"Age", type:"number", unit:"years", step:"1" },
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"ht", label:"Height", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.ht)||v.wt<=0||v.ht<=0) return ERR;
      var tbw;
      if(v.sex==="f"){ tbw = -2.097 + 0.1069*v.ht + 0.2466*v.wt; }
      else { if(!ok(v.age)||v.age<=0) return ERR; tbw = 2.447 - 0.09156*v.age + 0.1074*v.ht + 0.3362*v.wt; }
      if(tbw<=0) return { err:"Inputs give a non-physiological result — check entries" };
      return { v:r1(tbw), u:"L", i:"Estimated total body water (Watson formula); used in Kt/V and free-water calculations. Ref: Watson PE, Am J Clin Nutr 1980." };
    } },

  { id:"nitrogen_balance", cat:"Critical care", icon:"", title:"Nitrogen Balance",
    desc:"Daily nitrogen balance from protein intake and urinary urea nitrogen.",
    inputs:[
      { id:"protein", label:"Protein intake (24 h)", type:"number", unit:"g/day", step:"1" },
      { id:"uun", label:"Urinary urea nitrogen (24 h)", type:"number", unit:"g/day", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.protein)||!ok(v.uun)||v.protein<0||v.uun<0) return ERR;
      var nb = v.protein/6.25 - (v.uun + 4);
      var b = nb>0 ? "Positive balance (anabolic) — intake exceeds estimated losses" : nb<0 ? "Negative balance (catabolic) — losses exceed intake" : "Neutral balance";
      return { v:r1(nb), u:"g N/day", i:b+". The constant of 4 g approximates non-urea and non-urinary losses. Ref: standard clinical-nutrition reference." };
    } },

  { id:"pcl5", cat:"Psychiatry", icon:"", title:"PCL-5 (PTSD Checklist) — score interpreter",
    desc:"Interprets a PCL-5 total for provisional DSM-5 PTSD.",
    inputs:[
      { id:"total", label:"PCL-5 total (0–80)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>80) return ERR;
      var s=Math.round(v.total);
      var b = s>=33 ? "At or above the common provisional-PTSD cut-off (~31–33) — a diagnostic interview is warranted" : "Below the common provisional-PTSD cut-off (~31–33)";
      return { v:s, u:"/80", i:b+". Administer the full instrument from the US National Center for PTSD (public domain). Ref: Blevins, J Trauma Stress 2015." };
    } },

  { id:"allowable_blood_loss", cat:"Critical care", icon:"", title:"Maximum Allowable Blood Loss",
    desc:"Estimated allowable blood loss before a chosen haematocrit threshold.",
    inputs:[
      { id:"wt", label:"Weight", type:"number", unit:"kg", step:"0.1" },
      { id:"ebv", label:"Estimated blood volume", type:"select", opts:[{v:"75",t:"Adult male (75 mL/kg)"},{v:"65",t:"Adult female (65 mL/kg)"},{v:"80",t:"Child (80 mL/kg)"},{v:"85",t:"Infant (85 mL/kg)"},{v:"90",t:"Neonate (90 mL/kg)"}] },
      { id:"hi", label:"Initial haematocrit", type:"number", unit:"%", step:"0.1" },
      { id:"hf", label:"Lowest acceptable haematocrit", type:"number", unit:"%", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.wt)||!ok(v.hi)||!ok(v.hf)||v.wt<=0||v.hi<=0||v.hf<=0) return ERR;
      if(v.hf>=v.hi) return { err:"Lowest acceptable haematocrit must be below the initial value" };
      var ebv=Number(v.ebv)*v.wt;
      var abl=ebv*(v.hi-v.hf)/v.hi;
      return { v:r0(abl), u:"mL", i:"Estimated maximum allowable blood loss before reaching the chosen haematocrit. Ref: Gross JB, Anesthesiology 1983." };
    } },

  { id:"sokolow_lyon", cat:"Cardiovascular", icon:"", title:"Sokolow-Lyon LVH Criteria",
    desc:"ECG voltage criteria for left ventricular hypertrophy.",
    inputs:[
      { id:"sv1", label:"S wave in V1", type:"number", unit:"mm", step:"0.5" },
      { id:"rv5", label:"R wave in V5", type:"number", unit:"mm", step:"0.5" },
      { id:"rv6", label:"R wave in V6", type:"number", unit:"mm", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.sv1)||!ok(v.rv5)||!ok(v.rv6)||v.sv1<0||v.rv5<0||v.rv6<0) return ERR;
      var sum=v.sv1+Math.max(v.rv5,v.rv6);
      var b=sum>=35?"Meets Sokolow-Lyon voltage criteria for LVH":"Does not meet voltage criteria";
      return { v:r1(sum), u:"mm", i:b+" (threshold ≥35 mm; 10 mm = 1 mV at standard calibration). Ref: Sokolow & Lyon, Am Heart J 1949." };
    } },

  { id:"pesi", cat:"Cardiovascular", icon:"", title:"PESI (Pulmonary Embolism Severity Index)",
    desc:"30-day mortality risk class in acute pulmonary embolism.",
    inputs:[
      { id:"age", label:"Age (years, added as points)", type:"number", step:"1" },
      { id:"male", label:"Male sex (+10)", type:"check" },
      { id:"cancer", label:"History of cancer (+30)", type:"check" },
      { id:"chf", label:"Chronic heart failure (+10)", type:"check" },
      { id:"lung", label:"Chronic lung disease (+10)", type:"check" },
      { id:"hr110", label:"Pulse ≥110/min (+20)", type:"check" },
      { id:"sbp100", label:"Systolic BP <100 mmHg (+30)", type:"check" },
      { id:"rr30", label:"Respiratory rate ≥30/min (+20)", type:"check" },
      { id:"temp36", label:"Temperature <36°C (+20)", type:"check" },
      { id:"ams", label:"Altered mental status (+60)", type:"check" },
      { id:"sat90", label:"Oxygen saturation <90% (+20)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.age)||v.age<0) return ERR;
      var s=Math.round(v.age);
      if(v.male)s+=10; if(v.cancer)s+=30; if(v.chf)s+=10; if(v.lung)s+=10; if(v.hr110)s+=20;
      if(v.sbp100)s+=30; if(v.rr30)s+=20; if(v.temp36)s+=20; if(v.ams)s+=60; if(v.sat90)s+=20;
      var cls=s<=65?"Class I — very low 30-day mortality":s<=85?"Class II — low":s<=105?"Class III — intermediate":s<=125?"Class IV — high":"Class V — very high";
      return { v:s, u:"points", i:cls+". Classes I–II may be considered for outpatient management. Ref: Aujesky, Am J Respir Crit Care Med 2005." };
    } },

  { id:"gold_group", cat:"Respiratory", icon:"", title:"GOLD ABE Assessment (COPD)",
    desc:"2023 GOLD symptom/exacerbation group for stable COPD.",
    inputs:[
      { id:"exac", label:"≥2 moderate exacerbations, or ≥1 needing hospitalisation, in the past year", type:"check" },
      { id:"symp", label:"More symptoms (mMRC ≥2 or CAT ≥10)", type:"check" }
    ],
    compute:function(v){
      var g = v.exac ? "E" : (v.symp ? "B" : "A");
      var d = g==="E" ? "Group E — high exacerbation risk; consider LABA+LAMA (add ICS if blood eosinophilia)" : g==="B" ? "Group B — more symptoms, low exacerbation risk; LABA+LAMA" : "Group A — few symptoms, low exacerbation risk; a bronchodilator";
      return { v:"Group "+g, u:"", i:d+". Ref: GOLD 2023 report." };
    } },

  { id:"scorad", cat:"Dermatology", icon:"", title:"SCORAD (Atopic Dermatitis Severity)",
    desc:"SCORing Atopic Dermatitis index (extent + intensity + subjective symptoms).",
    inputs:[
      { id:"extent", label:"Extent — % body surface affected (rule of nines)", type:"number", unit:"%", step:"1" },
      { id:"erythema", label:"Erythema (redness)", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"oedema", label:"Oedema / papulation", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"oozing", label:"Oozing / crusting", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"excoriation", label:"Excoriation (scratch marks)", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"lichen", label:"Lichenification (skin thickening)", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"dryness", label:"Dryness of uninvolved skin", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Mild"},{v:"2",t:"Moderate"},{v:"3",t:"Severe"}] },
      { id:"pruritus", label:"Pruritus — patient VAS last 3 days", type:"number", unit:"0–10", step:"1" },
      { id:"sleep", label:"Sleeplessness — patient VAS last 3 days", type:"number", unit:"0–10", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.extent)||v.extent<0||v.extent>100||!ok(v.pruritus)||v.pruritus<0||v.pruritus>10||!ok(v.sleep)||v.sleep<0||v.sleep>10) return ERR;
      var B=(Number(v.erythema)||0)+(Number(v.oedema)||0)+(Number(v.oozing)||0)+(Number(v.excoriation)||0)+(Number(v.lichen)||0)+(Number(v.dryness)||0);
      var C=v.pruritus+v.sleep;
      var score=v.extent/5 + 7*B/2 + C;
      var b=score<25?"Mild":score<=50?"Moderate":"Severe";
      return { v:r1(score), u:"/103", i:b+" atopic dermatitis (mild <25, moderate 25–50, severe >50). Ref: European Task Force on Atopic Dermatitis, Dermatology 1993." };
    } },

  { id:"afi", cat:"Obstetrics", icon:"", title:"Amniotic Fluid Index (AFI)",
    desc:"Sum of the deepest vertical pocket in four uterine quadrants.",
    inputs:[
      { id:"q1", label:"Quadrant 1 pocket", type:"number", unit:"cm", step:"0.1" },
      { id:"q2", label:"Quadrant 2 pocket", type:"number", unit:"cm", step:"0.1" },
      { id:"q3", label:"Quadrant 3 pocket", type:"number", unit:"cm", step:"0.1" },
      { id:"q4", label:"Quadrant 4 pocket", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.q1)||!ok(v.q2)||!ok(v.q3)||!ok(v.q4)||v.q1<0||v.q2<0||v.q3<0||v.q4<0) return ERR;
      var afi=v.q1+v.q2+v.q3+v.q4;
      var b=afi<5?"Oligohydramnios":afi<=25?"Normal":"Polyhydramnios";
      return { v:r1(afi), u:"cm", i:b+" (oligohydramnios <5, normal 5–25, polyhydramnios >25 cm at term). Ref: Phelan, J Reprod Med 1987." };
    } },

  { id:"iom_weight_gain", cat:"Obstetrics", icon:"", title:"Pregnancy Weight-Gain Target (IOM)",
    desc:"Recommended total gestational weight gain (singleton) by pre-pregnancy BMI.",
    inputs:[
      { id:"bmi", label:"Pre-pregnancy BMI", type:"number", unit:"kg/m²", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.bmi)||v.bmi<10||v.bmi>80) return ERR;
      var r;
      if(v.bmi<18.5) r="12.5–18 kg (underweight)";
      else if(v.bmi<25) r="11.5–16 kg (normal weight)";
      else if(v.bmi<30) r="7–11.5 kg (overweight)";
      else r="5–9 kg (obese)";
      return { v:r, u:"", i:"Recommended total weight gain for a singleton pregnancy. Ref: Institute of Medicine 2009." };
    } },

  { id:"flacc", cat:"Paediatrics", icon:"", title:"FLACC Pain Scale",
    desc:"Behavioural pain assessment for young or non-verbal children.",
    inputs:[
      { id:"face", label:"Face", type:"select", opts:[{v:"0",t:"0 — no expression/smile"},{v:"1",t:"1 — occasional grimace, withdrawn"},{v:"2",t:"2 — frequent/constant frown, clenched jaw"}] },
      { id:"legs", label:"Legs", type:"select", opts:[{v:"0",t:"0 — normal/relaxed"},{v:"1",t:"1 — uneasy, restless, tense"},{v:"2",t:"2 — kicking or legs drawn up"}] },
      { id:"activity", label:"Activity", type:"select", opts:[{v:"0",t:"0 — lying quietly, moves easily"},{v:"1",t:"1 — squirming, tense"},{v:"2",t:"2 — arched, rigid or jerking"}] },
      { id:"cry", label:"Cry", type:"select", opts:[{v:"0",t:"0 — no cry"},{v:"1",t:"1 — moans/whimpers, occasional complaint"},{v:"2",t:"2 — steady crying, screams, frequent complaints"}] },
      { id:"consol", label:"Consolability", type:"select", opts:[{v:"0",t:"0 — content, relaxed"},{v:"1",t:"1 — reassured by touch/talk"},{v:"2",t:"2 — difficult to console"}] }
    ],
    compute:function(v){
      var s=(Number(v.face)||0)+(Number(v.legs)||0)+(Number(v.activity)||0)+(Number(v.cry)||0)+(Number(v.consol)||0);
      var b=s===0?"Relaxed and comfortable":s<=3?"Mild discomfort":s<=6?"Moderate pain":"Severe discomfort/pain";
      return { v:s, u:"/10", i:b+". Ref: Merkel S, Pediatr Nurs 1997 (FLACC)." };
    } },

  { id:"bacterial_meningitis_score", cat:"Paediatrics", icon:"", title:"Bacterial Meningitis Score (Children)",
    desc:"Risk of bacterial (vs aseptic) meningitis in children with CSF pleocytosis.",
    inputs:[
      { id:"gram", label:"Positive CSF Gram stain", type:"check" },
      { id:"csf_anc", label:"CSF absolute neutrophil count ≥1000/µL", type:"check" },
      { id:"csf_protein", label:"CSF protein ≥80 mg/dL", type:"check" },
      { id:"blood_anc", label:"Peripheral blood ANC ≥10 000/µL", type:"check" },
      { id:"seizure", label:"Seizure at or before presentation", type:"check" }
    ],
    compute:function(v){
      var s=0;["gram","csf_anc","csf_protein","blood_anc","seizure"].forEach(function(k){if(v[k])s++;});
      var b=s===0?"Very low risk of bacterial meningitis — bacterial meningitis is very unlikely":"Not very low risk — a predictor is present; manage for possible bacterial meningitis";
      return { v:s, u:"/5", i:b+". Validated in children >2 months, not critically ill and not pre-treated with antibiotics. Ref: Nigrovic, JAMA 2007." };
    } },

  { id:"modified_fisher", cat:"Neurology", icon:"", title:"Modified Fisher Scale (SAH)",
    desc:"CT grading of subarachnoid haemorrhage to estimate vasospasm risk.",
    inputs:[
      { id:"sah", label:"Subarachnoid blood", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Thin (<1 mm)"},{v:"2",t:"Thick (≥1 mm)"}] },
      { id:"ivh", label:"Intraventricular haemorrhage present", type:"check" }
    ],
    compute:function(v){
      var sah=Number(v.sah)||0; var ivh=v.ivh?1:0; var g;
      if(sah===0) g=0;
      else if(sah===1) g=ivh?2:1;
      else g=ivh?4:3;
      var risk=g===0?"Minimal":g<=2?"Low–moderate":g===3?"Higher":"Highest";
      return { v:g, u:"grade", i:risk+" symptomatic vasospasm risk (grade "+g+"). Ref: Frontera, Neurosurgery 2006 (modified Fisher)." };
    } },

  { id:"widmark", cat:"Toxicology", icon:"", title:"Widmark Blood Alcohol Estimate",
    desc:"Estimated blood alcohol concentration (forensic approximation).",
    inputs:[
      { id:"grams", label:"Alcohol ingested", type:"number", unit:"g", step:"1" },
      { id:"wt", label:"Body weight", type:"number", unit:"kg", step:"0.1" },
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male (r≈0.68)"},{v:"f",t:"Female (r≈0.55)"}] },
      { id:"hours", label:"Hours since drinking", type:"number", unit:"h", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.grams)||!ok(v.wt)||!ok(v.hours)||v.grams<0||v.wt<=0||v.hours<0) return ERR;
      var r=v.sex==="f"?0.55:0.68;
      var c=v.grams/(r*v.wt) - 0.15*v.hours;
      if(c<0) c=0;
      var pct=Math.round(c/10*1000)/1000;
      return { v:r1(c), u:"g/L", i:"≈ "+pct+" g/100 mL (%). Forensic approximation only; individual clearance varies widely. One UK unit ≈ 8 g ethanol. Ref: Widmark 1932." };
    } },

  { id:"dipss", cat:"Haematology", icon:"", title:"DIPSS (Myelofibrosis Prognosis)",
    desc:"Dynamic International Prognostic Scoring System for primary myelofibrosis.",
    inputs:[
      { id:"age", label:"Age >65 (+1)", type:"check" },
      { id:"wbc", label:"WBC >25 ×10⁹/L (+1)", type:"check" },
      { id:"hb", label:"Haemoglobin <100 g/L (+2)", type:"check" },
      { id:"blasts", label:"Peripheral blood blasts ≥1% (+1)", type:"check" },
      { id:"symptoms", label:"Constitutional symptoms (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.age)s++; if(v.wbc)s++; if(v.hb)s+=2; if(v.blasts)s++; if(v.symptoms)s++;
      var b=s===0?"Low risk":s<=2?"Intermediate-1 risk":s<=4?"Intermediate-2 risk":"High risk";
      return { v:s, u:"/6", i:b+" (anaemia is weighted 2 points in DIPSS). Ref: Passamonti, Blood 2010 (DIPSS)." };
    } },

  { id:"r_iss", cat:"Haematology", icon:"", title:"R-ISS (Revised ISS, Myeloma)",
    desc:"Revised International Staging System for multiple myeloma.",
    inputs:[
      { id:"iss", label:"ISS stage", type:"select", opts:[{v:"1",t:"Stage I (β2M <3.5 mg/L & albumin ≥35 g/L)"},{v:"2",t:"Stage II"},{v:"3",t:"Stage III (β2M >5.5 mg/L)"}] },
      { id:"ldh", label:"Serum LDH", type:"select", opts:[{v:"0",t:"Normal (< upper limit)"},{v:"1",t:"Elevated (≥ upper limit)"}] },
      { id:"cyto", label:"High-risk cytogenetics — del(17p), t(4;14) or t(14;16)", type:"select", opts:[{v:"0",t:"Absent (standard risk)"},{v:"1",t:"Present (high risk)"}] }
    ],
    compute:function(v){
      var iss=Number(v.iss)||1; var highLDH=Number(v.ldh)===1; var highCyto=Number(v.cyto)===1;
      var stage;
      if(iss===1 && !highLDH && !highCyto) stage="I";
      else if(iss===3 && (highLDH || highCyto)) stage="III";
      else stage="II";
      var b=stage==="I"?"best prognosis":stage==="III"?"poorest prognosis":"intermediate prognosis";
      return { v:"R-ISS "+stage, u:"", i:"Revised ISS stage "+stage+" ("+b+"). Ref: Palumbo, J Clin Oncol 2015 (R-ISS)." };
    } },

  { id:"rvsp", cat:"Cardiovascular", icon:"", title:"RV Systolic Pressure (TR Jet)",
    desc:"Estimated right-ventricular systolic pressure from tricuspid regurgitation velocity.",
    inputs:[
      { id:"trv", label:"Peak TR velocity", type:"number", unit:"m/s", step:"0.1" },
      { id:"rap", label:"Estimated right atrial pressure", type:"select", opts:[{v:"3",t:"3 mmHg (IVC small, collapses)"},{v:"8",t:"8 mmHg (intermediate)"},{v:"15",t:"15 mmHg (IVC dilated, fixed)"}] }
    ],
    compute:function(v){
      if(!ok(v.trv)||v.trv<=0) return ERR;
      var p=4*v.trv*v.trv + Number(v.rap);
      var b=p<36?"Normal estimated systolic pulmonary pressure":p<50?"Mildly elevated":p<70?"Moderately elevated":"Severely elevated";
      return { v:r0(p), u:"mmHg", i:b+" (equals systolic pulmonary artery pressure in the absence of RVOT obstruction/pulmonary stenosis). Ref: simplified Bernoulli equation." };
    } },

  { id:"mva_pht", cat:"Cardiovascular", icon:"", title:"Mitral Valve Area (Pressure Half-Time)",
    desc:"Estimated mitral valve area in mitral stenosis.",
    inputs:[
      { id:"pht", label:"Pressure half-time", type:"number", unit:"ms", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.pht)||v.pht<=0) return ERR;
      var mva=220/v.pht;
      var b=mva<1?"Severe mitral stenosis":mva<=1.5?"Moderate mitral stenosis":mva<2?"Mild mitral stenosis":"Normal valve area";
      return { v:Math.round(mva*100)/100, u:"cm²", i:b+" (severe <1.0, moderate 1.0–1.5, mild 1.5–2.0 cm²). The empirical constant 220 is unreliable soon after valvuloplasty or with significant aortic regurgitation. Ref: Hatle, Circulation 1979." };
    } },

  { id:"cardiac_power", cat:"Cardiovascular", icon:"", title:"Cardiac Power Output",
    desc:"Cardiac pumping capability; a strong predictor in cardiogenic shock.",
    inputs:[
      { id:"map", label:"Mean arterial pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.map)||!ok(v.co)||v.map<0||v.co<0) return ERR;
      var cpo=v.map*v.co/451;
      var b=cpo<0.6?"Low — associated with high mortality in cardiogenic shock":"Above the common cardiogenic-shock threshold";
      return { v:Math.round(cpo*100)/100, u:"W", i:b+" (a value <0.6 W predicts worse outcomes in cardiogenic shock). Ref: Fincke, J Am Coll Cardiol 2004." };
    } },

  { id:"do2", cat:"Critical care", icon:"", title:"Oxygen Delivery (DO₂)",
    desc:"Systemic oxygen delivery from cardiac output and arterial oxygen content.",
    inputs:[
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" },
      { id:"hb", label:"Haemoglobin", type:"number", unit:"g/dL", step:"0.1" },
      { id:"sao2", label:"Arterial O₂ saturation", type:"number", unit:"%", step:"1" },
      { id:"pao2", label:"PaO₂ (optional)", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.co)||!ok(v.hb)||!ok(v.sao2)||v.co<0||v.hb<0||v.sao2<0||v.sao2>100) return ERR;
      var dissolved = (ok(v.pao2)&&v.pao2>=0) ? 0.003*v.pao2 : 0;
      var cao2=1.34*v.hb*(v.sao2/100)+dissolved;
      var do2=v.co*cao2*10;
      var b=do2<600?"Below the usual target range":do2>1400?"Above the usual range":"Within the usual range";
      return { v:r0(do2), u:"mL O₂/min", i:b+" (CaO₂ ≈ "+r1(cao2)+" mL/dL; normal DO₂ ~950–1150). Ref: standard oxygen-transport physiology." };
    } },

  { id:"lung_compliance", cat:"Critical care", icon:"", title:"Static Lung Compliance",
    desc:"Respiratory-system compliance during mechanical ventilation.",
    inputs:[
      { id:"vt", label:"Tidal volume", type:"number", unit:"mL", step:"10" },
      { id:"pplat", label:"Plateau pressure", type:"number", unit:"cmH₂O", step:"1" },
      { id:"peep", label:"PEEP", type:"number", unit:"cmH₂O", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.vt)||!ok(v.pplat)||!ok(v.peep)||v.vt<0) return ERR;
      var dp=v.pplat-v.peep;
      if(dp<=0) return { err:"Plateau pressure must exceed PEEP (driving pressure > 0)" };
      var c=v.vt/dp;
      var b=c<30?"Reduced compliance (stiff lungs)":"Within/above the usual range";
      return { v:r1(c), u:"mL/cmH₂O", i:b+" (driving pressure "+r0(dp)+" cmH₂O; normal static compliance ~50–100). Ref: standard ventilator physiology." };
    } },

  { id:"bohr_deadspace", cat:"Critical care", icon:"", title:"Dead Space Fraction (Bohr-Enghoff)",
    desc:"Physiological dead space as a fraction of tidal volume.",
    inputs:[
      { id:"paco2", label:"Arterial PaCO₂", type:"number", unit:"mmHg", step:"1" },
      { id:"peco2", label:"Mixed expired PECO₂", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.paco2)||!ok(v.peco2)||v.paco2<=0||v.peco2<0) return ERR;
      if(v.peco2>v.paco2) return { err:"Mixed expired CO₂ cannot exceed arterial CO₂" };
      var f=(v.paco2-v.peco2)/v.paco2;
      var b=f>0.4?"Elevated dead space":"Within the usual range";
      return { v:Math.round(f*100)/100, u:"Vd/Vt", i:b+" ("+r0(f*100)+"% of each breath; normal ~0.2–0.35). Ref: Bohr equation, Enghoff modification." };
    } },

  { id:"adrogue_madias", cat:"Renal", icon:"", title:"Adrogué-Madias (Na Change per Litre)",
    desc:"Predicted change in serum sodium from one litre of a chosen infusate.",
    inputs:[
      { id:"na", label:"Current serum sodium", type:"number", unit:"mmol/L", step:"1" },
      { id:"fluid", label:"Infusate", type:"select", opts:[{v:"154",t:"0.9% saline (Na 154)"},{v:"513",t:"3% saline (Na 513)"},{v:"134",t:"Ringer’s lactate (Na+K ≈134)"},{v:"77",t:"0.45% saline (Na 77)"},{v:"0",t:"5% dextrose (Na 0)"}] },
      { id:"wt", label:"Body weight", type:"number", unit:"kg", step:"0.1" },
      { id:"sex", label:"TBW fraction", type:"select", opts:[{v:"0.6",t:"Adult male / child (0.6)"},{v:"0.5",t:"Adult female / elderly male (0.5)"},{v:"0.45",t:"Elderly female (0.45)"}] }
    ],
    compute:function(v){
      if(!ok(v.na)||!ok(v.wt)||v.na<=0||v.wt<=0) return ERR;
      var tbw=Number(v.sex)*v.wt;
      var change=(Number(v.fluid)-v.na)/(tbw+1);
      var dir=change>0?"rise":change<0?"fall":"no change";
      return { v:Math.round(change*100)/100, u:"mmol/L per L", i:"Estimated "+dir+" in serum sodium per litre infused (TBW ≈ "+r1(tbw)+" L). Correct hyponatraemia slowly — generally no more than ~8–10 mmol/L in 24 h. Ref: Adrogué & Madias, N Engl J Med 2000." };
    } },

  { id:"measured_crcl", cat:"Renal", icon:"", title:"Measured Creatinine Clearance",
    desc:"Creatinine clearance from a timed urine collection.",
    inputs:[
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"uvol", label:"Urine volume collected", type:"number", unit:"mL", step:"1" },
      { id:"pcr", label:"Serum creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"hours", label:"Collection duration", type:"number", unit:"h", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.ucr)||!ok(v.uvol)||!ok(v.pcr)||!ok(v.hours)||v.ucr<0||v.uvol<0||v.pcr<=0||v.hours<=0) return ERR;
      var mins=v.hours*60;
      var crcl=(v.ucr*v.uvol)/(v.pcr*mins);
      return { v:r1(crcl), u:"mL/min", i:"Measured creatinine clearance (units cancel provided urine and serum creatinine are in the same units). Consider indexing to body surface area. Ref: standard clearance formula." };
    } },

  { id:"bard", cat:"Hepatology", icon:"", title:"BARD Score (NAFLD Fibrosis)",
    desc:"Predicts advanced fibrosis in non-alcoholic fatty liver disease.",
    inputs:[
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"ast", label:"AST", type:"number", unit:"U/L", step:"1" },
      { id:"alt", label:"ALT", type:"number", unit:"U/L", step:"1" },
      { id:"dm", label:"Type 2 diabetes mellitus", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.bmi)||!ok(v.ast)||!ok(v.alt)||v.bmi<=0||v.ast<0||v.alt<=0) return ERR;
      var ratio=v.ast/v.alt;
      var s=(v.bmi>=28?1:0)+(ratio>=0.8?2:0)+(v.dm?1:0);
      var b=s>=2?"Higher risk of advanced fibrosis — consider further assessment":"Low risk — advanced fibrosis unlikely (high negative predictive value)";
      return { v:s, u:"/4", i:b+" (AST/ALT ratio "+(Math.round(ratio*100)/100)+"). Ref: Harrison, Gut 2008 (BARD)." };
    } },

  { id:"cpis", cat:"Infectious disease", icon:"", title:"Clinical Pulmonary Infection Score (CPIS)",
    desc:"Bedside score suggesting ventilator-associated pneumonia.",
    inputs:[
      { id:"temp", label:"Temperature", type:"select", opts:[{v:"0",t:"36.5–38.4 °C"},{v:"1",t:"38.5–38.9 °C"},{v:"2",t:"≥39 or ≤36 °C"}] },
      { id:"wbc", label:"Blood leucocytes", type:"select", opts:[{v:"0",t:"4–11 ×10⁹/L"},{v:"1",t:"<4 or >11 ×10⁹/L"},{v:"2",t:"<4 or >11 with ≥50% band forms"}] },
      { id:"secretions", label:"Tracheal secretions", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Non-purulent"},{v:"2",t:"Purulent"}] },
      { id:"oxy", label:"Oxygenation (PaO₂/FiO₂)", type:"select", opts:[{v:"0",t:">240 or ARDS"},{v:"2",t:"≤240 and no ARDS"}] },
      { id:"cxr", label:"Chest radiograph", type:"select", opts:[{v:"0",t:"No infiltrate"},{v:"1",t:"Diffuse/patchy infiltrate"},{v:"2",t:"Localised infiltrate"}] },
      { id:"culture", label:"Tracheal aspirate culture", type:"select", opts:[{v:"0",t:"No/light growth"},{v:"1",t:"Moderate/heavy growth"},{v:"2",t:"Moderate/heavy + same organism on Gram stain"}] }
    ],
    compute:function(v){
      var s=(Number(v.temp)||0)+(Number(v.wbc)||0)+(Number(v.secretions)||0)+(Number(v.oxy)||0)+(Number(v.cxr)||0)+(Number(v.culture)||0);
      var b=s>6?"Score >6 supports investigation/treatment for VAP":"Score ≤6 — pneumonia less likely";
      return { v:s, u:"/12", i:b+". A guide only, with modest accuracy. Ref: Pugin, Am Rev Respir Dis 1991 (CPIS)." };
    } },

  { id:"kawasaki", cat:"Paediatrics", icon:"", title:"Kawasaki Disease Criteria",
    desc:"Clinical criteria for complete Kawasaki disease (AHA).",
    inputs:[
      { id:"fever", label:"Fever ≥5 days", type:"check" },
      { id:"conj", label:"Bilateral non-exudative conjunctival injection", type:"check" },
      { id:"oral", label:"Oral mucosal changes (red/cracked lips, strawberry tongue)", type:"check" },
      { id:"nodes", label:"Cervical lymphadenopathy (≥1.5 cm, usually unilateral)", type:"check" },
      { id:"extremity", label:"Extremity changes (erythema/oedema, later desquamation)", type:"check" },
      { id:"rash", label:"Polymorphous rash", type:"check" }
    ],
    compute:function(v){
      var f=0;["conj","oral","nodes","extremity","rash"].forEach(function(k){if(v[k])f++;});
      var complete = v.fever && f>=4;
      var b = complete ? "Meets criteria for complete Kawasaki disease ("+f+"/5 principal features with fever)" : v.fever ? "Does not meet complete criteria ("+f+"/5 features) — consider incomplete Kawasaki disease, especially in infants; check CRP/ESR and echocardiography" : "Fever ≥5 days is generally required (diagnosis is possible on day 4 with ≥4 features)";
      return { v:(complete?"Complete KD":f+"/5 features"), u:"", i:b+". Ref: McCrindle, Circulation 2017 (AHA)." };
    } },

  { id:"cci_platelet", cat:"Haematology", icon:"", title:"Corrected Count Increment (Platelets)",
    desc:"Assesses response to platelet transfusion / refractoriness.",
    inputs:[
      { id:"pre", label:"Pre-transfusion platelet count", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"post", label:"Post-transfusion platelet count", type:"number", unit:"×10⁹/L", step:"1" },
      { id:"bsa", label:"Body surface area", type:"number", unit:"m²", step:"0.01" },
      { id:"dose", label:"Platelets transfused", type:"number", unit:"×10¹¹", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.pre)||!ok(v.post)||!ok(v.bsa)||!ok(v.dose)||v.bsa<=0||v.dose<=0) return ERR;
      var inc=v.post-v.pre;
      var cci=(inc*1000)*v.bsa/v.dose;
      var b=cci<7500?"Low increment — suggests refractoriness if measured ~10–60 min post-transfusion (consider immune and non-immune causes)":"Adequate increment";
      return { v:r0(cci), u:"", i:b+" (increment "+r0(inc)+" ×10⁹/L). A 10–60 min CCI <7500 (or 1 h <5000) suggests refractoriness. Ref: standard transfusion reference." };
    } },

  { id:"dvi_aortic", cat:"Cardiovascular", icon:"", title:"Dimensionless Index (Aortic Stenosis)",
    desc:"Velocity ratio for aortic stenosis, independent of LVOT diameter.",
    inputs:[
      { id:"lvot", label:"LVOT VTI (or peak velocity)", type:"number", step:"0.1" },
      { id:"av", label:"Aortic-valve VTI (or peak velocity)", type:"number", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.lvot)||!ok(v.av)||v.lvot<=0||v.av<=0) return ERR;
      var dvi=v.lvot/v.av;
      var b=dvi<=0.25?"Severe aortic stenosis":dvi<0.5?"Non-severe / moderate range":"Unlikely severe stenosis";
      return { v:Math.round(dvi*100)/100, u:"", i:b+" (DVI ≤0.25 indicates severe AS; use the same measure — VTI or peak velocity — for both). Ref: ASE valve-stenosis guideline." };
    } },

  { id:"lv_mass", cat:"Cardiovascular", icon:"", title:"LV Mass (ASE Cube Formula)",
    desc:"Left-ventricular mass from linear dimensions (Devereux).",
    inputs:[
      { id:"lvidd", label:"LV internal diameter, diastole", type:"number", unit:"cm", step:"0.1" },
      { id:"ivsd", label:"Interventricular septum, diastole", type:"number", unit:"cm", step:"0.1" },
      { id:"pwtd", label:"Posterior wall thickness, diastole", type:"number", unit:"cm", step:"0.1" },
      { id:"bsa", label:"Body surface area (optional, for index)", type:"number", unit:"m²", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.lvidd)||!ok(v.ivsd)||!ok(v.pwtd)||v.lvidd<=0||v.ivsd<0||v.pwtd<0) return ERR;
      var sum=v.lvidd+v.pwtd+v.ivsd;
      var mass=0.8*(1.04*(Math.pow(sum,3)-Math.pow(v.lvidd,3)))+0.6;
      var idx = (ok(v.bsa)&&v.bsa>0) ? "; LV mass index ≈ "+r0(mass/v.bsa)+" g/m²" : "";
      return { v:r0(mass), u:"g", i:"Estimated LV mass"+idx+". Compare with sex-specific reference ranges for LVH. Ref: Devereux, Am J Cardiol 1986 (ASE cube)." };
    } },

  { id:"e_over_e_prime", cat:"Cardiovascular", icon:"", title:"E/e′ Ratio (LV Filling Pressure)",
    desc:"Estimates left-atrial pressure from mitral inflow and tissue Doppler.",
    inputs:[
      { id:"e", label:"Mitral E velocity", type:"number", unit:"cm/s", step:"1" },
      { id:"eprime", label:"Average e′ velocity (septal + lateral)/2", type:"number", unit:"cm/s", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.e)||!ok(v.eprime)||v.e<0||v.eprime<=0) return ERR;
      var r=v.e/v.eprime;
      var b=r>14?"Elevated — suggests raised LV filling pressure/LAP":r<8?"Normal LV filling pressure":"Indeterminate — use additional diastolic parameters";
      return { v:Math.round(r*10)/10, u:"", i:b+" (average E/e′ >14 suggests elevated filling pressure; <8 normal). Ref: ASE/EACVI diastolic-function guideline 2016." };
    } },

  { id:"rsbi", cat:"Critical care", icon:"", title:"Rapid Shallow Breathing Index (RSBI)",
    desc:"Weaning-readiness index during a spontaneous breathing trial.",
    inputs:[
      { id:"rr", label:"Respiratory rate", type:"number", unit:"breaths/min", step:"1" },
      { id:"vt", label:"Tidal volume", type:"number", unit:"mL", step:"10" }
    ],
    compute:function(v){
      if(!ok(v.rr)||!ok(v.vt)||v.rr<0||v.vt<=0) return ERR;
      var rsbi=v.rr/(v.vt/1000);
      var b=rsbi>105?"High — predicts a higher chance of weaning/extubation failure":"≤105 — more consistent with successful weaning";
      return { v:r0(rsbi), u:"breaths/min/L", i:b+" (threshold ~105). Ref: Yang & Tobin, N Engl J Med 1991." };
    } },

  { id:"vis_score", cat:"Critical care", icon:"", title:"Vasoactive-Inotropic Score (VIS)",
    desc:"Cumulative intensity of vasoactive/inotrope support.",
    inputs:[
      { id:"dopamine", label:"Dopamine", type:"number", unit:"µg/kg/min", step:"0.1" },
      { id:"dobutamine", label:"Dobutamine", type:"number", unit:"µg/kg/min", step:"0.1" },
      { id:"milrinone", label:"Milrinone", type:"number", unit:"µg/kg/min", step:"0.1" },
      { id:"adrenaline", label:"Adrenaline (epinephrine)", type:"number", unit:"µg/kg/min", step:"0.01" },
      { id:"noradrenaline", label:"Noradrenaline (norepinephrine)", type:"number", unit:"µg/kg/min", step:"0.01" },
      { id:"vasopressin", label:"Vasopressin", type:"number", unit:"U/kg/min", step:"0.0001" }
    ],
    compute:function(v){
      var dop=Number(v.dopamine)||0, dob=Number(v.dobutamine)||0, mil=Number(v.milrinone)||0, adr=Number(v.adrenaline)||0, nor=Number(v.noradrenaline)||0, vaso=Number(v.vasopressin)||0;
      if(dop<0||dob<0||mil<0||adr<0||nor<0||vaso<0) return ERR;
      var vis=dop+dob+10*mil+100*adr+100*nor+10000*vaso;
      var b=vis>=20?"High vasoactive support — associated with worse outcomes":vis>0?"Moderate/low support":"No vasoactive support";
      return { v:Math.round(vis*10)/10, u:"", i:b+" (a VIS ≥20–25 has been linked to poorer outcomes). Ref: Gaies, Pediatr Crit Care Med 2010 (VIS)." };
    } },

  { id:"fli", cat:"Hepatology", icon:"", title:"Fatty Liver Index (FLI)",
    desc:"Predicts hepatic steatosis from routine measurements.",
    inputs:[
      { id:"tg", label:"Triglycerides", type:"number", unit:"mg/dL", step:"1" },
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"ggt", label:"Gamma-GT", type:"number", unit:"U/L", step:"1" },
      { id:"waist", label:"Waist circumference", type:"number", unit:"cm", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.tg)||!ok(v.bmi)||!ok(v.ggt)||!ok(v.waist)||v.tg<=0||v.bmi<=0||v.ggt<=0||v.waist<=0) return ERR;
      var L=0.953*Math.log(v.tg)+0.139*v.bmi+0.718*Math.log(v.ggt)+0.053*v.waist-15.745;
      var fli=Math.exp(L)/(1+Math.exp(L))*100;
      var b=fli<30?"Steatosis unlikely (FLI <30)":fli>=60?"Steatosis likely (FLI ≥60)":"Indeterminate (FLI 30–60)";
      return { v:r0(fli), u:"/100", i:b+" (triglycerides in mg/dL). Ref: Bedogni, BMC Gastroenterol 2006 (FLI)." };
    } },

  { id:"ipi", cat:"Haematology", icon:"", title:"IPI (Lymphoma Prognostic Index)",
    desc:"International Prognostic Index for aggressive non-Hodgkin lymphoma.",
    inputs:[
      { id:"age", label:"Age >60 years", type:"check" },
      { id:"ldh", label:"LDH above normal", type:"check" },
      { id:"ecog", label:"ECOG performance status ≥2", type:"check" },
      { id:"stage", label:"Ann Arbor stage III–IV", type:"check" },
      { id:"extranodal", label:">1 extranodal site", type:"check" }
    ],
    compute:function(v){
      var s=0;["age","ldh","ecog","stage","extranodal"].forEach(function(k){if(v[k])s++;});
      var b=s<=1?"Low risk":s===2?"Low-intermediate risk":s===3?"High-intermediate risk":"High risk";
      return { v:s, u:"/5", i:b+". Ref: International NHL Prognostic Factors Project, N Engl J Med 1993." };
    } },

  { id:"flipi", cat:"Haematology", icon:"", title:"FLIPI (Follicular Lymphoma IPI)",
    desc:"Prognostic index for follicular lymphoma.",
    inputs:[
      { id:"age", label:"Age ≥60 years", type:"check" },
      { id:"stage", label:"Ann Arbor stage III–IV", type:"check" },
      { id:"hb", label:"Haemoglobin <120 g/L", type:"check" },
      { id:"nodal", label:">4 nodal areas involved", type:"check" },
      { id:"ldh", label:"LDH above normal", type:"check" }
    ],
    compute:function(v){
      var s=0;["age","stage","hb","nodal","ldh"].forEach(function(k){if(v[k])s++;});
      var b=s<=1?"Low risk":s===2?"Intermediate risk":"High risk";
      return { v:s, u:"/5", i:b+". Ref: Solal-Céligny, Blood 2004 (FLIPI)." };
    } },

  { id:"mipi", cat:"Haematology", icon:"", title:"Simplified MIPI (Mantle Cell Lymphoma)",
    desc:"Simplified Mantle Cell Lymphoma International Prognostic Index.",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"<50"},{v:"1",t:"50–59"},{v:"2",t:"60–69"},{v:"3",t:"≥70"}] },
      { id:"ecog", label:"ECOG performance status", type:"select", opts:[{v:"0",t:"0–1"},{v:"2",t:"2–4"}] },
      { id:"ldh", label:"LDH / upper limit of normal", type:"select", opts:[{v:"0",t:"<0.67"},{v:"1",t:"0.67–0.99"},{v:"2",t:"1.00–1.49"},{v:"3",t:"≥1.50"}] },
      { id:"wbc", label:"WBC (×10⁹/L)", type:"select", opts:[{v:"0",t:"<6.7"},{v:"1",t:"6.7–9.99"},{v:"2",t:"10–14.99"},{v:"3",t:"≥15"}] }
    ],
    compute:function(v){
      var s=(Number(v.age)||0)+(Number(v.ecog)||0)+(Number(v.ldh)||0)+(Number(v.wbc)||0);
      var b=s<=3?"Low risk":s<=5?"Intermediate risk":"High risk";
      return { v:s, u:"/11", i:b+". Ref: Hoster, Blood 2008 (MIPI)." };
    } },

  { id:"iron_ingestion", cat:"Toxicology", icon:"", title:"Elemental Iron Ingestion",
    desc:"Estimated elemental iron dose after ingestion.",
    inputs:[
      { id:"mg", label:"Total elemental iron ingested", type:"number", unit:"mg", step:"1" },
      { id:"wt", label:"Body weight", type:"number", unit:"kg", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.mg)||!ok(v.wt)||v.mg<0||v.wt<=0) return ERR;
      var dose=v.mg/v.wt;
      var b=dose<20?"Minimal toxicity expected":dose<40?"Mild — usually gastrointestinal symptoms":dose<60?"Moderate — systemic toxicity possible":"Potentially serious/lethal — urgent assessment";
      return { v:r1(dose), u:"mg/kg", i:b+" (<20 minimal, 20–60 mild–moderate, >60 potentially serious). Ferrous sulfate is ~20% elemental iron. Ref: standard toxicology reference." };
    } },

  { id:"mmse", cat:"Neurology", icon:"", title:"MMSE — score interpreter",
    desc:"Interprets a Mini-Mental State Examination total.",
    inputs:[
      { id:"total", label:"MMSE total (0–30)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>30) return ERR;
      var s=Math.round(v.total);
      var b=s>=24?"No / borderline impairment (adjust for age and education)":s>=19?"Mild cognitive impairment":s>=10?"Moderate cognitive impairment":"Severe cognitive impairment";
      return { v:s, u:"/30", i:b+". The MMSE is copyrighted (PAR Inc.) — administer the official form; banding here is indicative only. Ref: Folstein, J Psychiatr Res 1975." };
    } },

  { id:"insulin_rules", cat:"Endocrine", icon:"", title:"Insulin Dosing Rules (500 / 1800)",
    desc:"Estimates carbohydrate ratio and correction factor from total daily dose.",
    inputs:[
      { id:"tdd", label:"Total daily insulin dose", type:"number", unit:"units/day", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.tdd)||v.tdd<=0) return ERR;
      var icr=500/v.tdd;
      var cf_mgdl=1800/v.tdd;
      var cf_mmol=100/v.tdd;
      return { v:r1(icr), u:"g carb/unit", i:"Insulin-to-carbohydrate ratio ≈ 1 unit per "+r1(icr)+" g carbohydrate (500 rule). Correction factor ≈ "+r0(cf_mgdl)+" mg/dL ("+r1(cf_mmol)+" mmol/L) per unit (1800 rule, rapid-acting). A starting estimate only — titrate to the individual. Ref: standard diabetes reference." };
    } },

  { id:"romhilt_estes", cat:"Cardiovascular", icon:"", title:"Romhilt-Estes LVH Point Score",
    desc:"Point score for left ventricular hypertrophy on ECG.",
    inputs:[
      { id:"voltage", label:"Voltage: limb R/S ≥20 mm, or S in V1–V2 ≥30 mm, or R in V5–V6 ≥30 mm (+3)", type:"check" },
      { id:"strain", label:"ST-T (strain) pattern", type:"select", opts:[{v:"0",t:"Absent (0)"},{v:"3",t:"Present, no digitalis (+3)"},{v:"1",t:"Present, on digitalis (+1)"}] },
      { id:"la", label:"Left atrial abnormality (P terminal force V1 ≥0.04 mm·s) (+3)", type:"check" },
      { id:"lad", label:"Left axis deviation ≥ −30° (+2)", type:"check" },
      { id:"qrs", label:"QRS duration ≥90 ms (+1)", type:"check" },
      { id:"intrins", label:"Intrinsicoid deflection V5/V6 ≥50 ms (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.voltage)s+=3; s+=Number(v.strain)||0; if(v.la)s+=3; if(v.lad)s+=2; if(v.qrs)s+=1; if(v.intrins)s+=1;
      var b=s>=5?"Definite LVH (≥5 points)":s===4?"Probable LVH (4 points)":"LVH not diagnosed by these criteria";
      return { v:s, u:"points", i:b+". Ref: Romhilt & Estes, Am Heart J 1968." };
    } },

  { id:"dapt", cat:"Cardiovascular", icon:"", title:"DAPT Score",
    desc:"Benefit vs bleeding of prolonged dual antiplatelet therapy after PCI.",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"<65 (0)"},{v:"-1",t:"65–74 (−1)"},{v:"-2",t:"≥75 (−2)"}] },
      { id:"smoker", label:"Current cigarette smoker (+1)", type:"check" },
      { id:"dm", label:"Diabetes mellitus (+1)", type:"check" },
      { id:"mi", label:"MI at presentation (+1)", type:"check" },
      { id:"priorpci", label:"Prior PCI or prior MI (+1)", type:"check" },
      { id:"smallstent", label:"Stent diameter <3 mm (+1)", type:"check" },
      { id:"paclitaxel", label:"Paclitaxel-eluting stent (+1)", type:"check" },
      { id:"chf", label:"CHF or LVEF <30% (+2)", type:"check" },
      { id:"vein", label:"Saphenous vein graft stent (+2)", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.age)||0;
      if(v.smoker)s++; if(v.dm)s++; if(v.mi)s++; if(v.priorpci)s++; if(v.smallstent)s++; if(v.paclitaxel)s++;
      if(v.chf)s+=2; if(v.vein)s+=2;
      var b=s>=2?"Score ≥2 — favourable benefit/risk for prolonged DAPT":"Score <2 — prolonged DAPT less likely to be beneficial (bleeding risk may outweigh)";
      return { v:s, u:"points", i:b+". Applies to patients who completed 12 months of DAPT without event/bleed. Ref: Yeh, JAMA 2016 (DAPT score)." };
    } },

  { id:"mehran", cat:"Renal", icon:"", title:"Mehran Score (Contrast Nephropathy Risk)",
    desc:"Risk of contrast-induced nephropathy after percutaneous coronary intervention.",
    inputs:[
      { id:"hypotension", label:"Hypotension (+5)", type:"check" },
      { id:"iabp", label:"Intra-aortic balloon pump (+5)", type:"check" },
      { id:"chf", label:"Congestive heart failure (+5)", type:"check" },
      { id:"age75", label:"Age >75 (+4)", type:"check" },
      { id:"anaemia", label:"Anaemia (+3)", type:"check" },
      { id:"dm", label:"Diabetes mellitus (+3)", type:"check" },
      { id:"egfr", label:"eGFR (mL/min/1.73 m²)", type:"select", opts:[{v:"0",t:"≥60 (0)"},{v:"2",t:"40 to <60 (+2)"},{v:"4",t:"20 to <40 (+4)"},{v:"6",t:"<20 (+6)"}] },
      { id:"contrast", label:"Contrast volume", type:"number", unit:"mL", step:"10" }
    ],
    compute:function(v){
      if(!ok(v.contrast)||v.contrast<0) return ERR;
      var s=0; if(v.hypotension)s+=5; if(v.iabp)s+=5; if(v.chf)s+=5; if(v.age75)s+=4; if(v.anaemia)s+=3; if(v.dm)s+=3;
      s+=Number(v.egfr)||0;
      s+=Math.round(v.contrast/100);
      var b=s<=5?"Low risk (~7.5% CIN)":s<=10?"Moderate risk (~14%)":s<=15?"High risk (~26%)":"Very high risk (~57%)";
      return { v:s, u:"points", i:b+" (contrast scored ≈1 point per 100 mL). Ref: Mehran, J Am Coll Cardiol 2004." };
    } },

  { id:"dragon", cat:"Neurology", icon:"", title:"DRAGON Score (Stroke Thrombolysis Outcome)",
    desc:"Predicts 3-month functional outcome after IV thrombolysis for ischaemic stroke.",
    inputs:[
      { id:"ct", label:"Hyperdense artery / early infarct on CT", type:"select", opts:[{v:"0",t:"Neither (0)"},{v:"1",t:"Either one (+1)"},{v:"2",t:"Both (+2)"}] },
      { id:"mrs", label:"Pre-stroke mRS >1 (+1)", type:"check" },
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"<65 (0)"},{v:"1",t:"65–79 (+1)"},{v:"2",t:"≥80 (+2)"}] },
      { id:"glucose", label:"Baseline glucose >8 mmol/L (>144 mg/dL) (+1)", type:"check" },
      { id:"time", label:"Onset-to-treatment >90 min (+1)", type:"check" },
      { id:"nihss", label:"Baseline NIHSS", type:"select", opts:[{v:"0",t:"0–4 (0)"},{v:"1",t:"5–9 (+1)"},{v:"2",t:"10–15 (+2)"},{v:"3",t:">15 (+3)"}] }
    ],
    compute:function(v){
      var s=(Number(v.ct)||0)+(Number(v.age)||0)+(Number(v.nihss)||0); if(v.mrs)s++; if(v.glucose)s++; if(v.time)s++;
      var b=s<=1?"Very likely good outcome (~90–96%)":s<=3?"Favourable":s<=7?"Intermediate":"High likelihood of poor outcome";
      return { v:s, u:"/10", i:b+". Ref: Strbian, Neurology 2012 (DRAGON)." };
    } },

  { id:"isaric_4c", cat:"Respiratory", icon:"", title:"ISARIC 4C Mortality Score (COVID-19)",
    desc:"In-hospital mortality risk in adults admitted with COVID-19.",
    inputs:[
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"<50 (0)"},{v:"2",t:"50–59 (+2)"},{v:"4",t:"60–69 (+4)"},{v:"6",t:"70–79 (+6)"},{v:"7",t:"≥80 (+7)"}] },
      { id:"male", label:"Male sex (+1)", type:"check" },
      { id:"comorb", label:"Comorbidities", type:"select", opts:[{v:"0",t:"None (0)"},{v:"1",t:"1 (+1)"},{v:"2",t:"≥2 (+2)"}] },
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"0",t:"<20 (0)"},{v:"1",t:"20–29 (+1)"},{v:"2",t:"≥30 (+2)"}] },
      { id:"spo2", label:"SpO₂ <92% on room air (+2)", type:"check" },
      { id:"gcs", label:"Glasgow Coma Scale <15 (+2)", type:"check" },
      { id:"urea", label:"Urea", type:"select", opts:[{v:"0",t:"≤7 mmol/L (0)"},{v:"1",t:">7 to 14 (+1)"},{v:"3",t:">14 (+3)"}] },
      { id:"crp", label:"CRP", type:"select", opts:[{v:"0",t:"<50 mg/L (0)"},{v:"1",t:"50–99 (+1)"},{v:"2",t:"≥100 (+2)"}] }
    ],
    compute:function(v){
      var s=(Number(v.age)||0)+(Number(v.comorb)||0)+(Number(v.rr)||0)+(Number(v.urea)||0)+(Number(v.crp)||0);
      if(v.male)s++; if(v.spo2)s+=2; if(v.gcs)s+=2;
      var b=s<=3?"Low risk (~1–2% mortality)":s<=8?"Intermediate (~10%)":s<=14?"High (~30%)":"Very high (~60%+)";
      return { v:s, u:"/21", i:b+". Ref: Knight, BMJ 2020 (ISARIC 4C)." };
    } },

  { id:"rochester_criteria", cat:"Paediatrics", icon:"", title:"Rochester Criteria (Febrile Infant)",
    desc:"Identifies young febrile infants at low risk of serious bacterial infection.",
    inputs:[
      { id:"well", label:"Well-appearing", type:"check" },
      { id:"healthy", label:"Previously healthy (term, no perinatal/chronic problems)", type:"check" },
      { id:"noinfection", label:"No skin, soft-tissue, bone/joint or ear infection", type:"check" },
      { id:"wbc", label:"WBC 5–15 ×10⁹/L", type:"check" },
      { id:"bands", label:"Absolute band count ≤1.5 ×10⁹/L", type:"check" },
      { id:"urine", label:"Urine ≤10 WBC/hpf", type:"check" },
      { id:"stool", label:"Stool ≤5 WBC/hpf (if diarrhoea)", type:"check" }
    ],
    compute:function(v){
      var all=v.well&&v.healthy&&v.noinfection&&v.wbc&&v.bands&&v.urine&&v.stool;
      var b=all?"LOW risk of serious bacterial infection — all Rochester criteria met":"NOT low risk — one or more criteria unmet; manage per protocol for possible serious bacterial infection";
      return { v:(all?"Low risk":"Not low risk"), u:"", i:b+". A decision aid, not a rule-out; use with clinical judgement and local pathways. Ref: Jaskiewicz, Pediatrics 1994 (Rochester)." };
    } },

  { id:"hamd", cat:"Psychiatry", icon:"", title:"HAM-D (Hamilton Depression) — interpreter",
    desc:"Interprets a 17-item Hamilton Depression Rating Scale total.",
    inputs:[
      { id:"total", label:"HAM-D 17-item total (0–52)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>52) return ERR;
      var s=Math.round(v.total);
      var b=s<=7?"Normal / no depression":s<=13?"Mild depression":s<=18?"Moderate depression":s<=22?"Severe depression":"Very severe depression";
      return { v:s, u:"/52", i:b+". Common severity bands for the 17-item HDRS. Ref: Hamilton, J Neurol Neurosurg Psychiatry 1960." };
    } },

  { id:"moca", cat:"Neurology", icon:"", title:"MoCA — score interpreter",
    desc:"Interprets a Montreal Cognitive Assessment total.",
    inputs:[
      { id:"total", label:"MoCA total (0–30)", type:"number", step:"1" },
      { id:"lowedu", label:"≤12 years of education (add 1 point)", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>30) return ERR;
      var s=Math.round(v.total)+(v.lowedu?1:0); if(s>30)s=30;
      var b=s>=26?"Normal range (≥26)":"Below the usual normal threshold — suggests possible cognitive impairment";
      return { v:s, u:"/30", i:b+" (education-adjusted). MoCA is copyrighted — administer the official version and complete required training. Ref: Nasreddine, J Am Geriatr Soc 2005." };
    } },

  { id:"madrs", cat:"Psychiatry", icon:"", title:"MADRS — score interpreter",
    desc:"Interprets a Montgomery-Åsberg Depression Rating Scale total.",
    inputs:[
      { id:"total", label:"MADRS total (0–60)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>60) return ERR;
      var s=Math.round(v.total);
      var b=s<=6?"Normal / symptom absent":s<=19?"Mild depression":s<=34?"Moderate depression":"Severe depression";
      return { v:s, u:"/60", i:b+". Administer the full clinician-rated instrument. Ref: Montgomery & Åsberg, Br J Psychiatry 1979." };
    } },

  { id:"sf_ratio", cat:"Respiratory", icon:"", title:"SpO₂/FiO₂ (S/F) Ratio",
    desc:"Non-invasive surrogate for the PaO₂/FiO₂ ratio.",
    inputs:[
      { id:"spo2", label:"SpO₂", type:"number", unit:"%", step:"1" },
      { id:"fio2", label:"FiO₂", type:"number", unit:"fraction 0.21–1.0", step:"0.01" }
    ],
    compute:function(v){
      if(!ok(v.spo2)||!ok(v.fio2)||v.spo2<=0||v.spo2>100||v.fio2<0.21||v.fio2>1) return ERR;
      var sf=v.spo2/v.fio2;
      var b=sf<235?"Corresponds to roughly P/F <200 (moderate–severe range)":sf<315?"Corresponds to roughly P/F <300 (ARDS range)":"Above the ARDS surrogate threshold";
      return { v:r0(sf), u:"", i:b+" (S/F 235 ≈ P/F 200; S/F 315 ≈ P/F 300). Most reliable when SpO₂ ≤97%. Ref: Rice, Chest 2007." };
    } },

  { id:"o2er", cat:"Critical care", icon:"", title:"Oxygen Extraction Ratio (O₂ER)",
    desc:"Fraction of delivered oxygen extracted by the tissues.",
    inputs:[
      { id:"sao2", label:"Arterial O₂ saturation (SaO₂)", type:"number", unit:"%", step:"1" },
      { id:"svo2", label:"Mixed venous O₂ saturation (SvO₂)", type:"number", unit:"%", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.sao2)||!ok(v.svo2)||v.sao2<=0||v.sao2>100||v.svo2<0||v.svo2>100) return ERR;
      if(v.svo2>v.sao2) return { err:"Venous saturation cannot exceed arterial saturation" };
      var er=(v.sao2-v.svo2)/v.sao2;
      var b=er>0.35?"High extraction — suggests inadequate delivery relative to demand":er<0.2?"Low extraction — impaired utilisation or high delivery (e.g. sepsis, shunt)":"Within the usual range";
      return { v:Math.round(er*100)/100, u:"O₂ER", i:b+" ("+r0(er*100)+"%; normal ~0.25–0.30). Ref: standard oxygen-transport physiology." };
    } },

  { id:"h2fpef", cat:"Cardiovascular", icon:"", title:"H₂FPEF Score (HFpEF Probability)",
    desc:"Probability of heart failure with preserved ejection fraction.",
    inputs:[
      { id:"heavy", label:"BMI >30 kg/m² (+2)", type:"check" },
      { id:"htn", label:"≥2 antihypertensive medications (+1)", type:"check" },
      { id:"af", label:"Atrial fibrillation (+3)", type:"check" },
      { id:"ph", label:"Pulmonary hypertension (PASP >35 mmHg) (+1)", type:"check" },
      { id:"elder", label:"Age >60 (+1)", type:"check" },
      { id:"filling", label:"Doppler E/e′ >9 (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.heavy)s+=2; if(v.htn)s++; if(v.af)s+=3; if(v.ph)s++; if(v.elder)s++; if(v.filling)s++;
      var b=s<=1?"Low probability of HFpEF":s<=5?"Intermediate probability — consider further testing":"High probability of HFpEF";
      return { v:s, u:"/9", i:b+". Ref: Reddy, Circulation 2018 (H₂FPEF)." };
    } },

  { id:"atria_bleed", cat:"Cardiovascular", icon:"", title:"ATRIA Bleeding Risk (AF)",
    desc:"Major-haemorrhage risk on anticoagulation for atrial fibrillation.",
    inputs:[
      { id:"anaemia", label:"Anaemia (Hb <13 g/dL men, <12 women) (+3)", type:"check" },
      { id:"renal", label:"Severe renal disease (eGFR <30 or dialysis) (+3)", type:"check" },
      { id:"age75", label:"Age ≥75 (+2)", type:"check" },
      { id:"bleed", label:"Prior haemorrhage (+1)", type:"check" },
      { id:"htn", label:"Hypertension (+1)", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.anaemia)s+=3; if(v.renal)s+=3; if(v.age75)s+=2; if(v.bleed)s++; if(v.htn)s++;
      var b=s<=3?"Low risk (~0.8%/yr major bleeding)":s===4?"Intermediate risk (~2.6%/yr)":"High risk (~5.8%/yr)";
      return { v:s, u:"/10", i:b+". Ref: Fang, J Am Coll Cardiol 2011 (ATRIA)." };
    } },

  { id:"edacs", cat:"Cardiovascular", icon:"", title:"EDACS (ED Chest Pain Score)",
    desc:"Emergency Department Assessment of Chest pain Score for risk stratification.",
    inputs:[
      { id:"age", label:"Age band", type:"select", opts:[{v:"2",t:"18–45 (+2)"},{v:"4",t:"46–50 (+4)"},{v:"6",t:"51–55 (+6)"},{v:"8",t:"56–60 (+8)"},{v:"10",t:"61–65 (+10)"},{v:"12",t:"66–70 (+12)"},{v:"14",t:"71–75 (+14)"},{v:"16",t:"76–80 (+16)"},{v:"18",t:"81–85 (+18)"},{v:"20",t:"≥86 (+20)"}] },
      { id:"male", label:"Male sex (+6)", type:"check" },
      { id:"riskyoung", label:"Age 18–50 with known CAD or ≥3 risk factors (+4)", type:"check" },
      { id:"diaphoresis", label:"Diaphoresis (+3)", type:"check" },
      { id:"radiates", label:"Pain radiates to arm/shoulder/neck/jaw (+5)", type:"check" },
      { id:"inspiration", label:"Pain occurred/worsened with inspiration (−4)", type:"check" },
      { id:"palpation", label:"Pain reproduced by palpation (−6)", type:"check" }
    ],
    compute:function(v){
      var s=Number(v.age)||0;
      if(v.male)s+=6; if(v.riskyoung)s+=4; if(v.diaphoresis)s+=3; if(v.radiates)s+=5; if(v.inspiration)s-=4; if(v.palpation)s-=6;
      var b=s<16?"Low risk (EDACS <16) — with a non-ischaemic ECG and negative troponins, a low-risk pathway may apply":"Not low risk (EDACS ≥16) — further assessment indicated";
      return { v:s, u:"points", i:b+". Ref: Than, Emerg Med Australas 2014 (EDACS)." };
    } },

  { id:"years_pe", cat:"Respiratory", icon:"", title:"YEARS Algorithm (Pulmonary Embolism)",
    desc:"Simplified diagnostic algorithm to rule out pulmonary embolism.",
    inputs:[
      { id:"dvt", label:"Clinical signs of DVT", type:"check" },
      { id:"haemoptysis", label:"Haemoptysis", type:"check" },
      { id:"pemostlikely", label:"PE is the most likely diagnosis", type:"check" },
      { id:"ddimer", label:"D-dimer", type:"number", unit:"ng/mL (FEU)", step:"10" }
    ],
    compute:function(v){
      if(!ok(v.ddimer)||v.ddimer<0) return ERR;
      var items=(v.dvt?1:0)+(v.haemoptysis?1:0)+(v.pemostlikely?1:0);
      var threshold = items===0 ? 1000 : 500;
      var excluded = v.ddimer < threshold;
      var b = excluded ? "PE considered excluded — D-dimer below the applicable threshold ("+threshold+" ng/mL for "+items+" YEARS item"+(items===1?"":"s")+")" : "PE not excluded — CT pulmonary angiography indicated (D-dimer ≥ "+threshold+" ng/mL)";
      return { v:(excluded?"PE excluded":"CTPA indicated"), u:"", i:b+". Use an FEU-calibrated D-dimer; not validated in haemodynamic instability. Ref: van der Hulle, Lancet 2017 (YEARS)." };
    } },

  { id:"thrive", cat:"Neurology", icon:"", title:"THRIVE Score (Stroke Outcome)",
    desc:"Predicts outcome and mortality after acute ischaemic stroke.",
    inputs:[
      { id:"nihss", label:"NIHSS", type:"select", opts:[{v:"0",t:"0–10 (0)"},{v:"2",t:"11–20 (+2)"},{v:"4",t:"≥21 (+4)"}] },
      { id:"age", label:"Age", type:"select", opts:[{v:"0",t:"≤59 (0)"},{v:"1",t:"60–79 (+1)"},{v:"2",t:"≥80 (+2)"}] },
      { id:"htn", label:"Hypertension (+1)", type:"check" },
      { id:"dm", label:"Diabetes mellitus (+1)", type:"check" },
      { id:"af", label:"Atrial fibrillation (+1)", type:"check" }
    ],
    compute:function(v){
      var s=(Number(v.nihss)||0)+(Number(v.age)||0); if(v.htn)s++; if(v.dm)s++; if(v.af)s++;
      var b=s<=2?"Lower risk — better chance of good outcome":s<=4?"Intermediate":"Higher risk — greater mortality and disability";
      return { v:s, u:"/9", i:b+". Ref: Flint AC, et al. (THRIVE)." };
    } },

  { id:"stone_score", cat:"Renal", icon:"", title:"STONE Score (Ureteric Stone)",
    desc:"Predicts uncomplicated ureteric stone in patients with flank pain.",
    inputs:[
      { id:"male", label:"Male sex (+2)", type:"check" },
      { id:"timing", label:"Duration of pain", type:"select", opts:[{v:"0",t:">24 h (0)"},{v:"1",t:"6–24 h (+1)"},{v:"3",t:"<6 h (+3)"}] },
      { id:"nonblack", label:"Non-black race/ethnicity (+3)", type:"check" },
      { id:"nausea", label:"Nausea / vomiting", type:"select", opts:[{v:"0",t:"None (0)"},{v:"1",t:"Nausea alone (+1)"},{v:"2",t:"Vomiting (+2)"}] },
      { id:"haematuria", label:"Microscopic haematuria (+3)", type:"check" }
    ],
    compute:function(v){
      var s=(Number(v.timing)||0)+(Number(v.nausea)||0); if(v.male)s+=2; if(v.nonblack)s+=3; if(v.haematuria)s+=3;
      var b=s<=5?"Low probability of ureteric stone":s<=9?"Moderate probability":"High probability of ureteric stone";
      return { v:s, u:"/13", i:b+". Ref: Moore CL, et al. BMJ 2014 (STONE score)." };
    } },

  { id:"nexus_chest", cat:"Respiratory", icon:"", title:"NEXUS Chest (Blunt Trauma Imaging)",
    desc:"Identifies blunt-trauma patients at very low risk of thoracic injury.",
    inputs:[
      { id:"age60", label:"Age >60", type:"check" },
      { id:"decel", label:"Rapid deceleration (fall >6 m or MVC >64 km/h)", type:"check" },
      { id:"chestpain", label:"Chest pain", type:"check" },
      { id:"intox", label:"Intoxication", type:"check" },
      { id:"ams", label:"Altered alertness / mental status", type:"check" },
      { id:"distracting", label:"Distracting painful injury", type:"check" },
      { id:"tenderness", label:"Chest-wall tenderness", type:"check" }
    ],
    compute:function(v){
      var any=v.age60||v.decel||v.chestpain||v.intox||v.ams||v.distracting||v.tenderness;
      var b=any?"NOT very low risk — a criterion is present; chest imaging may be indicated":"Very low risk of thoracic injury — imaging can reasonably be deferred";
      return { v:(any?"Imaging may be indicated":"Very low risk"), u:"", i:b+". Applies to blunt trauma; use with clinical judgement. Ref: Rodriguez RM, et al. PLoS Med 2015 (NEXUS Chest)." };
    } },

  { id:"hsi", cat:"Hepatology", icon:"", title:"Hepatic Steatosis Index (HSI)",
    desc:"Screening index for non-alcoholic fatty liver disease.",
    inputs:[
      { id:"alt", label:"ALT", type:"number", unit:"U/L", step:"1" },
      { id:"ast", label:"AST", type:"number", unit:"U/L", step:"1" },
      { id:"bmi", label:"BMI", type:"number", unit:"kg/m²", step:"0.1" },
      { id:"female", label:"Female sex", type:"check" },
      { id:"dm", label:"Diabetes mellitus", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.alt)||!ok(v.ast)||!ok(v.bmi)||v.alt<=0||v.ast<=0||v.bmi<=0) return ERR;
      var hsi=8*(v.alt/v.ast)+v.bmi+(v.female?2:0)+(v.dm?2:0);
      var b=hsi<30?"NAFLD unlikely (HSI <30)":hsi>36?"NAFLD likely (HSI >36)":"Indeterminate (HSI 30–36)";
      return { v:r1(hsi), u:"", i:b+". Ref: Lee JH, et al. Dig Liver Dis 2010 (HSI)." };
    } },

  { id:"ybocs", cat:"Psychiatry", icon:"", title:"Y-BOCS — score interpreter",
    desc:"Interprets a Yale-Brown Obsessive Compulsive Scale total.",
    inputs:[
      { id:"total", label:"Y-BOCS total (0–40)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>40) return ERR;
      var s=Math.round(v.total);
      var b=s<=7?"Subclinical":s<=15?"Mild":s<=23?"Moderate":s<=31?"Severe":"Extreme";
      return { v:s, u:"/40", i:b+" OCD symptom severity. Administer the full clinician-rated scale. Ref: Goodman WK, et al. Arch Gen Psychiatry 1989." };
    } },

  { id:"ymrs", cat:"Psychiatry", icon:"", title:"YMRS — score interpreter",
    desc:"Interprets a Young Mania Rating Scale total.",
    inputs:[
      { id:"total", label:"YMRS total (0–60)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>60) return ERR;
      var s=Math.round(v.total);
      var b=s<=12?"Remission / euthymic range":s<=20?"Mild manic symptoms":s<=30?"Moderate mania":"Severe mania";
      return { v:s, u:"/60", i:b+". Thresholds vary between studies; administer the full clinician-rated scale. Ref: Young RC, et al. Br J Psychiatry 1978 (YMRS)." };
    } },

  { id:"odi", cat:"Musculoskeletal", icon:"", title:"Oswestry Disability Index — interpreter",
    desc:"Interprets an Oswestry Disability Index percentage for low-back disability.",
    inputs:[
      { id:"pct", label:"ODI (%)", type:"number", unit:"%", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.pct)||v.pct<0||v.pct>100) return ERR;
      var s=Math.round(v.pct);
      var b=s<=20?"Minimal disability":s<=40?"Moderate disability":s<=60?"Severe disability":s<=80?"Crippled — back pain impinges on all aspects of life":"Bed-bound or symptom magnification — reassess";
      return { v:s, u:"%", i:b+". Ref: Fairbank JCT, et al. (ODI)." };
    } },

  { id:"ndi", cat:"Musculoskeletal", icon:"", title:"Neck Disability Index — interpreter",
    desc:"Interprets a Neck Disability Index total for neck-related disability.",
    inputs:[
      { id:"total", label:"NDI total (0–50)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>50) return ERR;
      var s=Math.round(v.total);
      var b=s<=4?"No disability":s<=14?"Mild disability":s<=24?"Moderate disability":s<=34?"Severe disability":"Complete disability";
      return { v:s, u:"/50", i:b+" ("+(s*2)+"%). Ref: Vernon H, Mior S. J Manipulative Physiol Ther 1991 (NDI)." };
    } },

  { id:"wexner", cat:"Gastroenterology", icon:"", title:"Wexner Faecal Incontinence Score",
    desc:"Cleveland Clinic score for severity of faecal incontinence.",
    inputs:[
      { id:"solid", label:"Incontinence to solid stool", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"Rarely, <1/month (1)"},{v:"2",t:"Sometimes, <1/week (2)"},{v:"3",t:"Usually, <1/day (3)"},{v:"4",t:"Always, ≥1/day (4)"}] },
      { id:"liquid", label:"Incontinence to liquid stool", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"Rarely (1)"},{v:"2",t:"Sometimes (2)"},{v:"3",t:"Usually (3)"},{v:"4",t:"Always (4)"}] },
      { id:"gas", label:"Incontinence to gas", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"Rarely (1)"},{v:"2",t:"Sometimes (2)"},{v:"3",t:"Usually (3)"},{v:"4",t:"Always (4)"}] },
      { id:"pad", label:"Wears a pad", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"Rarely (1)"},{v:"2",t:"Sometimes (2)"},{v:"3",t:"Usually (3)"},{v:"4",t:"Always (4)"}] },
      { id:"lifestyle", label:"Lifestyle alteration", type:"select", opts:[{v:"0",t:"Never (0)"},{v:"1",t:"Rarely (1)"},{v:"2",t:"Sometimes (2)"},{v:"3",t:"Usually (3)"},{v:"4",t:"Always (4)"}] }
    ],
    compute:function(v){
      var s=(Number(v.solid)||0)+(Number(v.liquid)||0)+(Number(v.gas)||0)+(Number(v.pad)||0)+(Number(v.lifestyle)||0);
      var b=s===0?"Perfect continence":s<=9?"Mild–moderate incontinence":s<=15?"Moderate–severe incontinence":"Severe incontinence";
      return { v:s, u:"/20", i:b+". Ref: Jorge JMN, Wexner SD. Dis Colon Rectum 1993." };
    } },

  { id:"qrs_axis", cat:"Cardiovascular", icon:"", title:"QRS Axis (Frontal Plane)",
    desc:"Estimates the frontal-plane QRS axis from net deflections in leads I and aVF.",
    inputs:[
      { id:"lead1", label:"Net QRS in lead I (R minus S)", type:"number", unit:"mm", step:"0.5" },
      { id:"avf", label:"Net QRS in lead aVF (R minus S)", type:"number", unit:"mm", step:"0.5" }
    ],
    compute:function(v){
      if(!ok(v.lead1)||!ok(v.avf)) return ERR;
      if(v.lead1===0&&v.avf===0) return { err:"Both leads isoelectric — axis indeterminate" };
      var deg=Math.atan2(v.avf, v.lead1)*180/Math.PI;
      var cls=(deg>=-30&&deg<=90)?"Normal axis":(deg<-30&&deg>=-90)?"Left axis deviation":(deg>90&&deg<=180)?"Right axis deviation":"Extreme axis (northwest)";
      return { v:r0(deg), u:"°", i:cls+" (normal −30° to +90°). Ref: standard vectorcardiographic convention." };
    } },

  { id:"teichholz_ef", cat:"Cardiovascular", icon:"", title:"LV Ejection Fraction (Teichholz)",
    desc:"Estimates LVEF from M-mode/2D LV diameters.",
    inputs:[
      { id:"lvidd", label:"LV internal diameter, diastole", type:"number", unit:"cm", step:"0.1" },
      { id:"lvids", label:"LV internal diameter, systole", type:"number", unit:"cm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.lvidd)||!ok(v.lvids)||v.lvidd<=0||v.lvids<=0) return ERR;
      if(v.lvids>=v.lvidd) return { err:"Systolic diameter must be smaller than diastolic diameter" };
      var edv=7*Math.pow(v.lvidd,3)/(2.4+v.lvidd);
      var esv=7*Math.pow(v.lvids,3)/(2.4+v.lvids);
      var ef=(edv-esv)/edv*100;
      var b=ef>=55?"Normal":ef>=45?"Mildly reduced":ef>=30?"Moderately reduced":"Severely reduced";
      return { v:r0(ef), u:"%", i:b+" LV systolic function. Teichholz is unreliable with regional wall-motion abnormalities. Ref: Teichholz, Am J Cardiol 1976." };
    } },

  { id:"mpap", cat:"Cardiovascular", icon:"", title:"Mean Pulmonary Artery Pressure",
    desc:"Mean PA pressure from systolic and diastolic pulmonary pressures.",
    inputs:[
      { id:"spap", label:"Systolic PAP", type:"number", unit:"mmHg", step:"1" },
      { id:"dpap", label:"Diastolic PAP", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.spap)||!ok(v.dpap)||v.spap<0||v.dpap<0) return ERR;
      if(v.dpap>v.spap) return { err:"Diastolic pressure cannot exceed systolic pressure" };
      var mpap=(v.spap+2*v.dpap)/3;
      var b=mpap>20?"Elevated — meets the current haemodynamic threshold for pulmonary hypertension (>20 mmHg)":"Within normal limits";
      return { v:r0(mpap), u:"mmHg", i:b+". Ref: standard formula; ESC/ERS 2022 pulmonary hypertension definition." };
    } },

  { id:"midas", cat:"Neurology", icon:"", title:"MIDAS — migraine disability interpreter",
    desc:"Interprets a MIDAS total (days lost over 3 months).",
    inputs:[
      { id:"total", label:"MIDAS total (sum of Q1–Q5, days)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0) return ERR;
      var s=Math.round(v.total);
      var b=s<=5?"Grade I — little or no disability":s<=10?"Grade II — mild disability":s<=20?"Grade III — moderate disability":"Grade IV — severe disability";
      return { v:s, u:"days", i:b+". Ref: Stewart WF, et al. Neurology 2001 (MIDAS)." };
    } },

  { id:"isi", cat:"Psychiatry", icon:"", title:"Insomnia Severity Index — interpreter",
    desc:"Interprets an Insomnia Severity Index total.",
    inputs:[
      { id:"total", label:"ISI total (0–28)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>28) return ERR;
      var s=Math.round(v.total);
      var b=s<=7?"No clinically significant insomnia":s<=14?"Subthreshold insomnia":s<=21?"Moderate clinical insomnia":"Severe clinical insomnia";
      return { v:s, u:"/28", i:b+". Ref: Bastien CH, et al. Sleep Med 2001 (ISI)." };
    } },

  { id:"hit6", cat:"Neurology", icon:"", title:"HIT-6 — headache impact interpreter",
    desc:"Interprets a Headache Impact Test-6 total.",
    inputs:[
      { id:"total", label:"HIT-6 total (36–78)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<36||v.total>78) return ERR;
      var s=Math.round(v.total);
      var b=s<=49?"Little or no impact":s<=55?"Some impact":s<=59?"Substantial impact":"Severe impact";
      return { v:s, u:"/78", i:b+". HIT-6 is copyrighted (QualityMetric) — administer the official form. Ref: Kosinski M, et al. Qual Life Res 2003." };
    } },

  { id:"hads", cat:"Psychiatry", icon:"", title:"HADS — score interpreter",
    desc:"Interprets Hospital Anxiety and Depression Scale subscale totals.",
    inputs:[
      { id:"anx", label:"Anxiety subscale (0–21)", type:"number", step:"1" },
      { id:"dep", label:"Depression subscale (0–21)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.anx)||!ok(v.dep)||v.anx<0||v.anx>21||v.dep<0||v.dep>21) return ERR;
      function band(x){return x<=7?"normal":x<=10?"borderline":"abnormal (probable case)";}
      return { v:Math.round(v.anx)+" / "+Math.round(v.dep), u:"A / D", i:"Anxiety "+Math.round(v.anx)+" — "+band(v.anx)+"; Depression "+Math.round(v.dep)+" — "+band(v.dep)+" (each subscale: 0–7 normal, 8–10 borderline, 11–21 case). Ref: Zigmond AS, Snaith RP. Acta Psychiatr Scand 1983." };
    } },

  { id:"womac", cat:"Musculoskeletal", icon:"", title:"WOMAC — osteoarthritis index interpreter",
    desc:"Interprets a total WOMAC (Likert 3.1) score for hip/knee osteoarthritis.",
    inputs:[
      { id:"total", label:"WOMAC total (0–96)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>96) return ERR;
      var s=Math.round(v.total); var pct=s/96*100;
      var b=pct<25?"Mild symptoms":pct<50?"Moderate symptoms":pct<75?"Severe symptoms":"Very severe symptoms";
      return { v:s, u:"/96", i:b+" (~"+r0(pct)+"% of maximum; higher = worse; bands approximate — no validated cut-offs). WOMAC is a copyrighted, licence-required instrument — administer the official version. Subscales: pain 0–20, stiffness 0–8, function 0–68. Ref: Bellamy N, et al. J Rheumatol 1988 (WOMAC)." };
    } },

  { id:"zarit", cat:"Psychiatry", icon:"", title:"Zarit Burden Interview — interpreter",
    desc:"Interprets a Zarit caregiver-burden total.",
    inputs:[
      { id:"total", label:"Zarit total (0–88)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>88) return ERR;
      var s=Math.round(v.total);
      var b=s<=20?"Little or no burden":s<=40?"Mild to moderate burden":s<=60?"Moderate to severe burden":"Severe burden";
      return { v:s, u:"/88", i:b+". Ref: Zarit SH, et al. Gerontologist 1980 (22-item ZBI)." };
    } },

  { id:"pucai", cat:"Gastroenterology", icon:"", title:"PUCAI (Paediatric UC Activity Index)",
    desc:"Disease activity in paediatric ulcerative colitis.",
    inputs:[
      { id:"pain", label:"Abdominal pain", type:"select", opts:[{v:"0",t:"None (0)"},{v:"5",t:"Can be ignored (5)"},{v:"10",t:"Cannot be ignored (10)"}] },
      { id:"bleeding", label:"Rectal bleeding", type:"select", opts:[{v:"0",t:"None (0)"},{v:"10",t:"Small, <50% of stools (10)"},{v:"20",t:"Small, most stools (20)"},{v:"30",t:"Large, >50% of stool (30)"}] },
      { id:"consistency", label:"Stool consistency (of most)", type:"select", opts:[{v:"0",t:"Formed (0)"},{v:"5",t:"Partially formed (5)"},{v:"10",t:"Completely unformed (10)"}] },
      { id:"number", label:"Stools per 24 h", type:"select", opts:[{v:"0",t:"0–2 (0)"},{v:"5",t:"3–5 (5)"},{v:"10",t:"6–8 (10)"},{v:"15",t:">8 (15)"}] },
      { id:"nocturnal", label:"Nocturnal stools (waking)", type:"select", opts:[{v:"0",t:"No (0)"},{v:"10",t:"Yes (10)"}] },
      { id:"activity", label:"Activity level", type:"select", opts:[{v:"0",t:"No limitation (0)"},{v:"5",t:"Occasional limitation (5)"},{v:"10",t:"Severe restriction (10)"}] }
    ],
    compute:function(v){
      var s=(Number(v.pain)||0)+(Number(v.bleeding)||0)+(Number(v.consistency)||0)+(Number(v.number)||0)+(Number(v.nocturnal)||0)+(Number(v.activity)||0);
      var b=s<10?"Remission":s<=34?"Mild activity":s<=64?"Moderate activity":"Severe activity";
      return { v:s, u:"/85", i:b+" (remission <10, mild 10–34, moderate 35–64, severe ≥65). Ref: Turner D, et al. Gastroenterology 2007 (PUCAI)." };
    } },

  { id:"braden_q", cat:"Paediatrics", icon:"", title:"Braden Q Scale (Paediatric Pressure Injury)",
    desc:"Pressure-injury risk in paediatric patients (lower total = higher risk).",
    inputs:[
      { id:"mobility", label:"Mobility", type:"select", opts:[{v:"4",t:"No limitation (4)"},{v:"3",t:"Slightly limited (3)"},{v:"2",t:"Very limited (2)"},{v:"1",t:"Completely immobile (1)"}] },
      { id:"activity", label:"Activity", type:"select", opts:[{v:"4",t:"Walks frequently (4)"},{v:"3",t:"Walks occasionally (3)"},{v:"2",t:"Chairfast (2)"},{v:"1",t:"Bedfast (1)"}] },
      { id:"sensory", label:"Sensory perception", type:"select", opts:[{v:"4",t:"No impairment (4)"},{v:"3",t:"Slightly limited (3)"},{v:"2",t:"Very limited (2)"},{v:"1",t:"Completely limited (1)"}] },
      { id:"moisture", label:"Moisture", type:"select", opts:[{v:"4",t:"Rarely moist (4)"},{v:"3",t:"Occasionally moist (3)"},{v:"2",t:"Often moist (2)"},{v:"1",t:"Constantly moist (1)"}] },
      { id:"friction", label:"Friction & shear", type:"select", opts:[{v:"4",t:"No apparent problem (4)"},{v:"3",t:"Potential problem (3)"},{v:"2",t:"Problem (2)"},{v:"1",t:"Significant problem (1)"}] },
      { id:"nutrition", label:"Nutrition", type:"select", opts:[{v:"4",t:"Excellent (4)"},{v:"3",t:"Adequate (3)"},{v:"2",t:"Inadequate (2)"},{v:"1",t:"Very poor (1)"}] },
      { id:"perfusion", label:"Tissue perfusion & oxygenation", type:"select", opts:[{v:"4",t:"Excellent (4)"},{v:"3",t:"Adequate (3)"},{v:"2",t:"Compromised (2)"},{v:"1",t:"Extremely compromised (1)"}] }
    ],
    compute:function(v){
      var s=(Number(v.mobility)||1)+(Number(v.activity)||1)+(Number(v.sensory)||1)+(Number(v.moisture)||1)+(Number(v.friction)||1)+(Number(v.nutrition)||1)+(Number(v.perfusion)||1);
      var b=s<=16?"At risk of pressure injury (≤16) — institute prevention":"Lower risk";
      return { v:s, u:"/28", i:b+" (lower total = higher risk). Ref: Curley MAQ, et al. Nurs Res 2003 (Braden Q)." };
    } },

  { id:"norton", cat:"General", icon:"", title:"Norton Pressure Sore Risk Scale",
    desc:"Pressure-ulcer risk, mainly in elderly inpatients (lower total = higher risk).",
    inputs:[
      { id:"physical", label:"Physical condition", type:"select", opts:[{v:"4",t:"Good (4)"},{v:"3",t:"Fair (3)"},{v:"2",t:"Poor (2)"},{v:"1",t:"Very bad (1)"}] },
      { id:"mental", label:"Mental condition", type:"select", opts:[{v:"4",t:"Alert (4)"},{v:"3",t:"Apathetic (3)"},{v:"2",t:"Confused (2)"},{v:"1",t:"Stuporous (1)"}] },
      { id:"activity", label:"Activity", type:"select", opts:[{v:"4",t:"Ambulant (4)"},{v:"3",t:"Walks with help (3)"},{v:"2",t:"Chairbound (2)"},{v:"1",t:"Bed (1)"}] },
      { id:"mobility", label:"Mobility", type:"select", opts:[{v:"4",t:"Full (4)"},{v:"3",t:"Slightly limited (3)"},{v:"2",t:"Very limited (2)"},{v:"1",t:"Immobile (1)"}] },
      { id:"incontinence", label:"Incontinence", type:"select", opts:[{v:"4",t:"None (4)"},{v:"3",t:"Occasional (3)"},{v:"2",t:"Usually urine (2)"},{v:"1",t:"Doubly incontinent (1)"}] }
    ],
    compute:function(v){
      var s=(Number(v.physical)||1)+(Number(v.mental)||1)+(Number(v.activity)||1)+(Number(v.mobility)||1)+(Number(v.incontinence)||1);
      var b=s<=14?"At risk of pressure ulceration (≤14) — institute prevention":"Lower risk";
      return { v:s, u:"/20", i:b+" (≤14 at risk, ≤12 high risk). Ref: Norton D, et al. 1962." };
    } },

  { id:"pvr", cat:"Cardiovascular", icon:"", title:"Pulmonary Vascular Resistance (PVR)",
    desc:"Resistance across the pulmonary circulation.",
    inputs:[
      { id:"mpap", label:"Mean pulmonary artery pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"pcwp", label:"Pulmonary capillary wedge pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"co", label:"Cardiac output", type:"number", unit:"L/min", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.mpap)||!ok(v.pcwp)||!ok(v.co)||v.co<=0) return ERR;
      if(v.pcwp>v.mpap) return { err:"Wedge pressure cannot exceed mean PA pressure" };
      var wu=(v.mpap-v.pcwp)/v.co;
      var b=wu>2?"Elevated PVR (>2 Wood units) — supports pre-capillary pulmonary vascular disease":"Normal PVR";
      return { v:Math.round(wu*100)/100, u:"Wood units", i:b+" ("+r0(wu*80)+" dyn·s·cm⁻⁵). Ref: standard haemodynamics; 2022 PH definition uses PVR >2 WU." };
    } },

  { id:"tpg", cat:"Cardiovascular", icon:"", title:"Transpulmonary Gradient",
    desc:"Pressure gradient across the pulmonary vascular bed.",
    inputs:[
      { id:"mpap", label:"Mean pulmonary artery pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"pcwp", label:"Mean pulmonary capillary wedge pressure", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.mpap)||!ok(v.pcwp)) return ERR;
      if(v.pcwp>v.mpap) return { err:"Wedge pressure cannot exceed mean PA pressure" };
      var tpg=v.mpap-v.pcwp;
      var b=tpg>12?"Elevated (>12 mmHg) — suggests a pulmonary vascular (pre-capillary) component":"Not elevated";
      return { v:r0(tpg), u:"mmHg", i:b+". The diastolic pulmonary gradient (diastolic PAP − wedge) is now often preferred. Ref: standard haemodynamics." };
    } },

  { id:"cpp", cat:"Critical care", icon:"", title:"Cerebral Perfusion Pressure (CPP)",
    desc:"Net pressure driving cerebral blood flow.",
    inputs:[
      { id:"map", label:"Mean arterial pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"icp", label:"Intracranial pressure", type:"number", unit:"mmHg", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.map)||!ok(v.icp)) return ERR;
      var cpp=v.map-v.icp;
      var b=cpp<60?"Below the usual target — risk of cerebral ischaemia":cpp>70?"Above the usual target range":"Within the common target range (~60–70)";
      return { v:r0(cpp), u:"mmHg", i:b+" (typical traumatic-brain-injury target ~60–70 mmHg). Ref: Brain Trauma Foundation guidelines." };
    } },

  { id:"bdi", cat:"Psychiatry", icon:"", title:"Beck Depression Inventory — interpreter",
    desc:"Interprets a BDI / BDI-II total.",
    inputs:[
      { id:"total", label:"BDI-II total (0–63)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>63) return ERR;
      var s=Math.round(v.total);
      var b=s<=13?"Minimal depression":s<=19?"Mild depression":s<=28?"Moderate depression":"Severe depression";
      return { v:s, u:"/63", i:b+". BDI is copyrighted (Pearson) — administer the official form. Ref: Beck AT, et al. 1996 (BDI-II)." };
    } },

  { id:"bai", cat:"Psychiatry", icon:"", title:"Beck Anxiety Inventory — interpreter",
    desc:"Interprets a Beck Anxiety Inventory total.",
    inputs:[
      { id:"total", label:"BAI total (0–63)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>63) return ERR;
      var s=Math.round(v.total);
      var b=s<=7?"Minimal anxiety":s<=15?"Mild anxiety":s<=25?"Moderate anxiety":"Severe anxiety";
      return { v:s, u:"/63", i:b+". BAI is copyrighted (Pearson) — administer the official form. Ref: Beck AT, et al. 1988 (BAI)." };
    } },

  { id:"psqi", cat:"Psychiatry", icon:"", title:"PSQI — sleep quality interpreter",
    desc:"Interprets a Pittsburgh Sleep Quality Index global score.",
    inputs:[
      { id:"total", label:"PSQI global score (0–21)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>21) return ERR;
      var s=Math.round(v.total);
      var b=s>5?"Poor sleep quality (>5)":"Good sleep quality (≤5)";
      return { v:s, u:"/21", i:b+". Ref: Buysse DJ, et al. Psychiatry Res 1989 (PSQI)." };
    } },

  { id:"uas7", cat:"Dermatology", icon:"", title:"UAS7 (Urticaria Activity Score)",
    desc:"Weekly urticaria activity from daily wheal and itch scores.",
    inputs:[
      { id:"total", label:"UAS7 total (sum of 7 daily scores, 0–42)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>42) return ERR;
      var s=Math.round(v.total);
      var b=s===0?"Urticaria-free":s<=6?"Well-controlled":s<=15?"Mild activity":s<=27?"Moderate activity":"Severe activity";
      return { v:s, u:"/42", i:b+" (each day scores wheals 0–3 + itch 0–3). Ref: EAACI/GA²LEN urticaria guideline (Zuberbier)." };
    } },

  { id:"fe_bicarb", cat:"Renal", icon:"", title:"Fractional Excretion of Bicarbonate",
    desc:"Helps classify renal tubular acidosis.",
    inputs:[
      { id:"ubic", label:"Urine bicarbonate", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"pbic", label:"Plasma bicarbonate", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"ucr", label:"Urine creatinine", type:"number", unit:"µmol/L", step:"1" },
      { id:"pcr", label:"Plasma creatinine", type:"number", unit:"µmol/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.ubic)||!ok(v.pbic)||!ok(v.ucr)||!ok(v.pcr)||v.pbic<=0||v.ucr<=0||v.pcr<0||v.ubic<0) return ERR;
      var fe=(v.ubic*v.pcr)/(v.pbic*v.ucr)*100;
      var b=fe>15?">15% — consistent with proximal (type 2) RTA during bicarbonate loading":fe<5?"<5% — consistent with distal (type 1) RTA":"Intermediate";
      return { v:Math.round(fe*10)/10, u:"%", i:b+". Interpret during a bicarbonate load / with a normal plasma bicarbonate. Ref: standard nephrology reference." };
    } },

  { id:"lysholm", cat:"Musculoskeletal", icon:"", title:"Lysholm Knee Score — interpreter",
    desc:"Interprets a Lysholm knee score.",
    inputs:[
      { id:"total", label:"Lysholm total (0–100)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>100) return ERR;
      var s=Math.round(v.total);
      var b=s>=95?"Excellent":s>=84?"Good":s>=65?"Fair":"Poor";
      return { v:s, u:"/100", i:b+" knee function (higher = better). Ref: Lysholm J, Gillquist J. Am J Sports Med 1982." };
    } },

  { id:"harris_hip", cat:"Musculoskeletal", icon:"", title:"Harris Hip Score — interpreter",
    desc:"Interprets a Harris Hip Score.",
    inputs:[
      { id:"total", label:"Harris Hip Score (0–100)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>100) return ERR;
      var s=Math.round(v.total);
      var b=s>=90?"Excellent":s>=80?"Good":s>=70?"Fair":"Poor";
      return { v:s, u:"/100", i:b+" hip function (higher = better). Ref: Harris WH. J Bone Joint Surg Am 1969." };
    } },

  { id:"tampa", cat:"Musculoskeletal", icon:"", title:"Tampa Scale of Kinesiophobia — interpreter",
    desc:"Interprets a Tampa Scale of Kinesiophobia (TSK-17) total.",
    inputs:[
      { id:"total", label:"TSK-17 total (17–68)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<17||v.total>68) return ERR;
      var s=Math.round(v.total);
      var b=s>37?"High degree of kinesiophobia (fear of movement)":"Low degree of kinesiophobia";
      return { v:s, u:"/68", i:b+" (a common cut-off is >37). Ref: Miller RP, et al. 1991 (TSK)." };
    } },

  { id:"constant_shoulder", cat:"Musculoskeletal", icon:"", title:"Constant-Murley Shoulder Score — interpreter",
    desc:"Interprets a Constant-Murley shoulder score.",
    inputs:[
      { id:"total", label:"Constant-Murley total (0–100)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>100) return ERR;
      var s=Math.round(v.total);
      var b=s>=90?"Excellent":s>=80?"Good":s>=70?"Fair":"Poor";
      return { v:s, u:"/100", i:b+" shoulder function (higher = better; ideally compared with the age/sex-adjusted normal). Ref: Constant CR, Murley AHG. Clin Orthop 1987." };
    } },

  { id:"ascvd", cat:"Cardiovascular", icon:"", title:"ASCVD Risk (Pooled Cohort Equations)",
    desc:"10-year atherosclerotic cardiovascular disease risk (ACC/AHA 2013).",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"race", label:"Race", type:"select", opts:[{v:"white",t:"White / other"},{v:"aa",t:"African American"}] },
      { id:"age", label:"Age", type:"number", unit:"years (40–79)", step:"1" },
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mg/dL", step:"1" },
      { id:"hdl", label:"HDL cholesterol", type:"number", unit:"mg/dL", step:"1" },
      { id:"sbp", label:"Systolic blood pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"treated", label:"On blood-pressure treatment", type:"check" },
      { id:"smoker", label:"Current smoker", type:"check" },
      { id:"diabetes", label:"Diabetes mellitus", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.tc)||!ok(v.hdl)||!ok(v.sbp)||v.tc<=0||v.hdl<=0||v.sbp<=0) return ERR;
      if(v.age<40||v.age>79) return { err:"Validated for ages 40–79 only" };
      var lnA=Math.log(v.age), lnT=Math.log(v.tc), lnH=Math.log(v.hdl), lnS=Math.log(v.sbp);
      var smk=v.smoker?1:0, dm=v.diabetes?1:0, trt=v.treated?1:0;
      var white=v.race!=="aa", sum, S0, mean;
      if(v.sex==="f"){
        if(white){
          sum=-29.799*lnA+4.884*lnA*lnA+13.540*lnT-3.114*lnA*lnT-13.578*lnH+3.149*lnA*lnH+(trt?2.019*lnS:1.957*lnS)+7.574*smk-1.665*lnA*smk+0.661*dm;
          S0=0.9665; mean=-29.18;
        } else {
          sum=17.114*lnA+0.940*lnT-18.920*lnH+4.475*lnA*lnH+(trt?29.291*lnS-6.432*lnA*lnS:27.820*lnS-6.087*lnA*lnS)+0.691*smk+0.874*dm;
          S0=0.9533; mean=86.61;
        }
      } else {
        if(white){
          sum=12.344*lnA+11.853*lnT-2.664*lnA*lnT-7.990*lnH+1.769*lnA*lnH+(trt?1.797*lnS:1.764*lnS)+7.837*smk-1.795*lnA*smk+0.658*dm;
          S0=0.9144; mean=61.18;
        } else {
          sum=2.469*lnA+0.302*lnT-0.307*lnH+(trt?1.916*lnS:1.809*lnS)+0.549*smk+0.645*dm;
          S0=0.8954; mean=19.54;
        }
      }
      var risk=(1-Math.pow(S0,Math.exp(sum-mean)))*100;
      if(risk<0)risk=0; if(risk>100)risk=100;
      var b=risk<5?"Low risk":risk<7.5?"Borderline risk":risk<20?"Intermediate risk":"High risk";
      return { v:r1(risk), u:"% (10-yr)", i:b+" (ACC/AHA: <5% low, 5–7.5% borderline, 7.5–20% intermediate, ≥20% high). Validated ages 40–79, no prior ASCVD, not on a statin; cholesterol in mg/dL (mmol/L × 38.67). Ref: Goff DC, et al. ACC/AHA 2013." };
    } },

  { id:"spherical_equivalent", cat:"Ophthalmology", icon:"", title:"Spherical Equivalent",
    desc:"Combines sphere and cylinder into a single spherical value.",
    inputs:[
      { id:"sphere", label:"Sphere", type:"number", unit:"D", step:"0.25" },
      { id:"cylinder", label:"Cylinder", type:"number", unit:"D", step:"0.25" }
    ],
    compute:function(v){
      if(!ok(v.sphere)||!ok(v.cylinder)) return ERR;
      var se=v.sphere+v.cylinder/2;
      return { v:Math.round(se*100)/100, u:"D", i:"Spherical equivalent = sphere + cylinder/2. Ref: standard optics." };
    } },

  { id:"srk2_iol", cat:"Ophthalmology", icon:"", title:"IOL Power (SRK II)",
    desc:"Intraocular lens power for cataract surgery (SRK II regression).",
    inputs:[
      { id:"a", label:"A-constant", type:"number", step:"0.1" },
      { id:"k", label:"Average keratometry", type:"number", unit:"D", step:"0.1" },
      { id:"axial", label:"Axial length", type:"number", unit:"mm", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.a)||!ok(v.k)||!ok(v.axial)||v.k<=0||v.axial<=0) return ERR;
      var L=v.axial, a1=v.a;
      if(L<20) a1=v.a+3; else if(L<21) a1=v.a+2; else if(L<22) a1=v.a+1; else if(L<=24.5) a1=v.a; else a1=v.a-0.5;
      var p=a1-0.9*v.k-2.5*L;
      return { v:r1(p), u:"D", i:"Estimated emmetropic IOL power (SRK II). Modern eyes are better served by newer formulae (SRK/T, Barrett). Ref: Sanders, Retzlaff & Kraff (SRK II)." };
    } },

  { id:"oxford_knee", cat:"Musculoskeletal", icon:"", title:"Oxford Knee Score — interpreter",
    desc:"Interprets an Oxford Knee Score.",
    inputs:[
      { id:"total", label:"Oxford Knee Score (0–48)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>48) return ERR;
      var s=Math.round(v.total);
      var b=s>=40?"Satisfactory joint function":s>=30?"Mild to moderate knee arthritis":s>=20?"Moderate to severe knee arthritis":"Severe knee arthritis";
      return { v:s, u:"/48", i:b+" (higher = better; bands indicative). Oxford Knee Score is copyrighted (Oxford University Innovation) — administer the official licensed form. Ref: Dawson J, et al. J Bone Joint Surg Br 1998." };
    } },

  { id:"oxford_hip", cat:"Musculoskeletal", icon:"", title:"Oxford Hip Score — interpreter",
    desc:"Interprets an Oxford Hip Score.",
    inputs:[
      { id:"total", label:"Oxford Hip Score (0–48)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>48) return ERR;
      var s=Math.round(v.total);
      var b=s>=40?"Satisfactory joint function":s>=30?"Mild to moderate hip arthritis":s>=20?"Moderate to severe hip arthritis":"Severe hip arthritis";
      return { v:s, u:"/48", i:b+" (higher = better; bands indicative). Oxford Hip Score is copyrighted (Oxford University Innovation) — administer the official licensed form. Ref: Dawson J, et al. J Bone Joint Surg Br 1996." };
    } },

  { id:"quickdash", cat:"Musculoskeletal", icon:"", title:"QuickDASH — interpreter",
    desc:"Interprets a QuickDASH upper-limb disability score.",
    inputs:[
      { id:"total", label:"QuickDASH score (0–100)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>100) return ERR;
      var s=Math.round(v.total);
      var b=s<20?"Little disability":s<40?"Mild disability":s<60?"Moderate disability":"Severe disability";
      return { v:s, u:"/100", i:b+" (higher = more upper-limb disability; bands indicative). QuickDASH is owned by the Institute for Work & Health. Ref: Beaton DE, et al. (QuickDASH)." };
    } },

  { id:"dn4", cat:"Neurology", icon:"", title:"DN4 (Neuropathic Pain)",
    desc:"Screens for a neuropathic component to pain.",
    inputs:[
      { id:"burning", label:"Burning", type:"check" },
      { id:"cold", label:"Painful cold", type:"check" },
      { id:"shocks", label:"Electric shocks", type:"check" },
      { id:"tingling", label:"Tingling", type:"check" },
      { id:"pins", label:"Pins and needles", type:"check" },
      { id:"numbness", label:"Numbness", type:"check" },
      { id:"itching", label:"Itching", type:"check" },
      { id:"touch", label:"Hypoaesthesia to touch", type:"check" },
      { id:"prick", label:"Hypoaesthesia to pinprick", type:"check" },
      { id:"brushing", label:"Pain provoked/increased by brushing", type:"check" }
    ],
    compute:function(v){
      var keys=["burning","cold","shocks","tingling","pins","numbness","itching","touch","prick","brushing"];
      var s=0; keys.forEach(function(k){if(v[k])s++;});
      var b=s>=4?"Suggests a neuropathic component (≥4/10)":"Neuropathic pain less likely (<4/10)";
      return { v:s, u:"/10", i:b+". Ref: Bouhassira D, et al. Pain 2005 (DN4)." };
    } },

  { id:"phq15", cat:"Psychiatry", icon:"", title:"PHQ-15 — somatic symptom interpreter",
    desc:"Interprets a PHQ-15 somatic symptom severity total.",
    inputs:[
      { id:"total", label:"PHQ-15 total (0–30)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>30) return ERR;
      var s=Math.round(v.total);
      var b=s<=4?"Minimal somatic symptoms":s<=9?"Low":s<=14?"Medium":"High somatic symptom burden";
      return { v:s, u:"/30", i:b+". Ref: Kroenke K, et al. Psychosom Med 2002 (PHQ-15)." };
    } },

  { id:"framingham", cat:"Cardiovascular", icon:"", title:"Framingham Risk (General CVD, 2008)",
    desc:"10-year general cardiovascular disease risk (D'Agostino 2008).",
    inputs:[
      { id:"sex", label:"Sex", type:"select", opts:[{v:"m",t:"Male"},{v:"f",t:"Female"}] },
      { id:"age", label:"Age", type:"number", unit:"years (30–74)", step:"1" },
      { id:"tc", label:"Total cholesterol", type:"number", unit:"mg/dL", step:"1" },
      { id:"hdl", label:"HDL cholesterol", type:"number", unit:"mg/dL", step:"1" },
      { id:"sbp", label:"Systolic blood pressure", type:"number", unit:"mmHg", step:"1" },
      { id:"treated", label:"On blood-pressure treatment", type:"check" },
      { id:"smoker", label:"Current smoker", type:"check" },
      { id:"diabetes", label:"Diabetes mellitus", type:"check" }
    ],
    compute:function(v){
      if(!ok(v.age)||!ok(v.tc)||!ok(v.hdl)||!ok(v.sbp)||v.tc<=0||v.hdl<=0||v.sbp<=0) return ERR;
      if(v.age<30||v.age>74) return { err:"Validated for ages 30–74" };
      var lnA=Math.log(v.age), lnT=Math.log(v.tc), lnH=Math.log(v.hdl), lnS=Math.log(v.sbp);
      var smk=v.smoker?1:0, dm=v.diabetes?1:0, trt=v.treated?1:0, sum, S0, mean;
      if(v.sex==="f"){
        sum=2.32888*lnA+1.20904*lnT-0.70833*lnH+(trt?2.82263:2.76157)*lnS+0.52873*smk+0.69154*dm;
        S0=0.95012; mean=26.1931;
      } else {
        sum=3.06117*lnA+1.12370*lnT-0.93263*lnH+(trt?1.99881:1.93303)*lnS+0.65451*smk+0.57367*dm;
        S0=0.88936; mean=23.9802;
      }
      var risk=(1-Math.pow(S0,Math.exp(sum-mean)))*100;
      if(risk<0)risk=0; if(risk>100)risk=100;
      var b=risk<10?"Low risk":risk<20?"Intermediate risk":"High risk";
      return { v:r1(risk), u:"% (10-yr)", i:b+" of a general cardiovascular event (includes coronary, cerebrovascular, heart failure and peripheral disease — runs higher than hard-ASCVD estimates). Cholesterol in mg/dL (mmol/L × 38.67). Ref: D'Agostino, Circulation 2008." };
    } },

  { id:"epvs", cat:"Cardiovascular", icon:"", title:"Estimated Plasma Volume Status (ePVS)",
    desc:"Relative plasma volume from haematocrit and haemoglobin (a congestion marker).",
    inputs:[
      { id:"hct", label:"Haematocrit", type:"number", unit:"%", step:"0.1" },
      { id:"hb", label:"Haemoglobin", type:"number", unit:"g/dL", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.hct)||!ok(v.hb)||v.hct<=0||v.hct>=100||v.hb<=0) return ERR;
      var epvs=(100-v.hct)/v.hb;
      var b=epvs>5.5?"Elevated — suggests plasma-volume expansion/congestion":"Within the usual range";
      return { v:Math.round(epvs*100)/100, u:"mL/g", i:b+" (Duarte ratio; higher values track congestion in heart failure). Ref: Duarte K, et al. JACC Heart Fail 2015 (ePVS)." };
    } },

  { id:"frail_scale", cat:"General", icon:"", title:"FRAIL Scale",
    desc:"Rapid frailty screen (Fatigue, Resistance, Ambulation, Illnesses, Loss of weight).",
    inputs:[
      { id:"fatigue", label:"Fatigue (tired most of the time)", type:"check" },
      { id:"resistance", label:"Resistance (difficulty climbing a flight of stairs)", type:"check" },
      { id:"ambulation", label:"Ambulation (difficulty walking ~100 m)", type:"check" },
      { id:"illness", label:"Illnesses (≥5 chronic illnesses)", type:"check" },
      { id:"weight", label:"Loss of weight (>5% in the past year)", type:"check" }
    ],
    compute:function(v){
      var s=0;["fatigue","resistance","ambulation","illness","weight"].forEach(function(k){if(v[k])s++;});
      var b=s===0?"Robust":s<=2?"Pre-frail":"Frail";
      return { v:s, u:"/5", i:b+" (0 robust, 1–2 pre-frail, ≥3 frail). Ref: Morley JE, et al. J Nutr Health Aging 2012 (FRAIL)." };
    } },

  { id:"tug", cat:"General", icon:"", title:"Timed Up and Go (TUG)",
    desc:"Interprets a Timed Up and Go time for mobility and fall risk.",
    inputs:[
      { id:"secs", label:"Time to complete", type:"number", unit:"seconds", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.secs)||v.secs<=0) return ERR;
      var b=v.secs>=30?"Markedly impaired mobility — often dependent for transfers/ADLs":v.secs>=13.5?"Increased fall risk":v.secs>=12?"Borderline — possible increased fall risk":"Within the usual range for independent adults";
      return { v:r1(v.secs), u:"s", i:b+" (a common fall-risk cut-off is ≥12–13.5 s). Ref: Podsiadlo D, Richardson S. J Am Geriatr Soc 1991 (TUG)." };
    } },

  { id:"prisma7", cat:"General", icon:"", title:"PRISMA-7 (Frailty Screen)",
    desc:"Seven-item screen for frailty/disability in older adults.",
    inputs:[
      { id:"age85", label:"Age >85 years", type:"check" },
      { id:"male", label:"Male sex", type:"check" },
      { id:"health", label:"Health problems that limit activities", type:"check" },
      { id:"help", label:"Needs someone to help regularly", type:"check" },
      { id:"home", label:"Health problems that require staying at home", type:"check" },
      { id:"nosupport", label:"No one to count on for help if needed", type:"check" },
      { id:"walkaid", label:"Regularly uses a stick / walker / wheelchair", type:"check" }
    ],
    compute:function(v){
      var s=0; if(v.age85)s++; if(v.male)s++; if(v.health)s++; if(v.help)s++; if(v.home)s++; if(v.nosupport)s++; if(v.walkaid)s++;
      var b=s>=3?"Positive screen (≥3) — further frailty assessment recommended":"Negative screen (<3)";
      return { v:s, u:"/7", i:b+". Ref: Raîche M, et al. Arch Gerontol Geriatr 2008 (PRISMA-7)." };
    } },

  { id:"gds30", cat:"Psychiatry", icon:"", title:"Geriatric Depression Scale (GDS-30) — interpreter",
    desc:"Interprets a 30-item Geriatric Depression Scale total.",
    inputs:[
      { id:"total", label:"GDS-30 total (0–30)", type:"number", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.total)||v.total<0||v.total>30) return ERR;
      var s=Math.round(v.total);
      var b=s<=9?"Normal range":s<=19?"Mild depression":"Moderate to severe depression";
      return { v:s, u:"/30", i:b+". Ref: Yesavage JA, et al. J Psychiatr Res 1982 (GDS)." };
    } },

  { id:"cdr", cat:"Neurology", icon:"", title:"Clinical Dementia Rating (global)",
    desc:"Interprets a Clinical Dementia Rating global score.",
    inputs:[
      { id:"score", label:"CDR global score", type:"select", opts:[{v:"0",t:"0 — none"},{v:"0.5",t:"0.5 — very mild / questionable"},{v:"1",t:"1 — mild"},{v:"2",t:"2 — moderate"},{v:"3",t:"3 — severe"}] }
    ],
    compute:function(v){
      var s=v.score||"0"; var map={"0":"No dementia","0.5":"Questionable / very mild impairment (often MCI)","1":"Mild dementia","2":"Moderate dementia","3":"Severe dementia"};
      return { v:"CDR "+s, u:"", i:(map[s]||"")+". Derived from the standard box-scoring algorithm across six domains. Ref: Morris JC. Neurology 1993 (CDR)." };
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
    mentzer:["mentzer index","thalassaemia iron deficiency","microcytosis"],
    rcri:["revised cardiac risk index","lee index","perioperative cardiac risk","preop cardiac"],
    ottawa_ankle:["ottawa ankle rule","ottawa foot rule","ankle x-ray","foot fracture rule"],
    ottawa_knee:["ottawa knee rule","knee x-ray","knee fracture rule"],
    nexus_cspine:["nexus criteria","cervical spine clearance","c-spine rule","neck imaging"],
    canadian_ct_head:["canadian ct head rule","cchr","head injury ct","minor head injury"],
    bishop:["bishop score","cervix favourability","induction of labour","cervical ripening"],
    apgar:["apgar score","newborn assessment","neonatal score"],
    westley_croup:["westley croup score","croup severity","laryngotracheobronchitis"],
    mrs:["modified rankin scale","rankin","stroke disability","functional outcome"],
    hunt_hess:["hunt hess","sah grade","subarachnoid haemorrhage grade","aneurysm grade"],
    cage:["cage questionnaire","alcohol screening","problem drinking"],
    feverpain:["feverpain score","sore throat","strep throat","pharyngitis","antibiotic sore throat"],
    sgarbossa:["sgarbossa","mi in lbbb","paced rhythm mi","stemi lbbb"],
    fisher:["fisher grade","sah ct","subarachnoid vasospasm","fisher scale"],
    steroid_conv:["steroid conversion","glucocorticoid equivalent","prednisolone equivalent","dexamethasone equivalent","corticosteroid dose"],
    mme:["morphine milligram equivalents","mme","opioid conversion","morphine equivalent"],
    saag:["serum ascites albumin gradient","saag","ascites","portal hypertension ascites"],
    ttkg:["transtubular potassium gradient","ttkg","potassium handling","hyperkalaemia aldosterone"],
    ebv:["estimated blood volume","blood volume","transfusion volume","exchange transfusion"],
    cows:["clinical opiate withdrawal scale","cows","opioid withdrawal"],
    gahs:["glasgow alcoholic hepatitis score","gahs","alcoholic hepatitis prognosis"],
    das28:["das28","disease activity score","rheumatoid arthritis activity","das 28 esr"],
    stopbang:["stop bang","stop-bang","sleep apnoea screening","osa screen"],
    smartcop:["smart cop","pneumonia icu","cap severity","respiratory support pneumonia"],
    homa_ir:["homa ir","insulin resistance","homa"],
    nafld_fibrosis:["nafld fibrosis score","nafld","fatty liver fibrosis","nfs"],
    glasgow_imrie:["glasgow imrie","imrie score","pancreatitis severity","pancreas score"],
    "4at":["4at","delirium screen","confusion assessment","cognitive screen"],
    sf_syncope:["san francisco syncope rule","chess","syncope risk"],
    bode:["bode index","copd prognosis","copd mortality"],
    ottawa_sah:["ottawa sah rule","subarachnoid rule","thunderclap headache rule","sah rule out"],
    wfns:["wfns grade","subarachnoid grade","sah grade"],
    harvey_bradshaw:["harvey bradshaw index","crohn activity","hbi","crohn disease activity"],
    truelove_witts:["truelove witts","ulcerative colitis severity","uc flare severity"],
    aims65:["aims65","upper gi bleed mortality","gi bleed risk"],
    air_score:["appendicitis inflammatory response","air score","appendicitis risk"],
    kocher:["kocher criteria","septic hip","septic arthritis child","transient synovitis"],
    orbit_bleed:["orbit bleeding score","af bleeding risk","anticoagulation bleeding orbit"],
    urr:["urea reduction ratio","dialysis adequacy","haemodialysis adequacy"],
    cdai_ra:["cdai","clinical disease activity index","rheumatoid activity"],
    gos:["glasgow outcome scale","gos","brain injury outcome"],
    anc:["absolute neutrophil count","neutropenia","neutrophil count"],
    improve_vte:["improve vte","vte risk medical","thromboprophylaxis risk"],
    eag:["estimated average glucose","eag","a1c to glucose","adag","hba1c average glucose","glucose from hba1c"],
    rpi:["reticulocyte production index","rpi","corrected reticulocyte","reticulocyte index","retic index"],
    isth_dic:["disseminated intravascular coagulation","dic score","isth dic","overt dic","dic"],
    sdai:["simplified disease activity index","sdai","rheumatoid arthritis activity","ra disease activity"],
    braden:["braden scale","pressure ulcer risk","pressure sore","bedsore risk","pressure injury"],
    morse_falls:["morse fall scale","fall risk","falls assessment","inpatient fall"],
    bap65:["bap-65","bap65","copd exacerbation mortality","copd severity"],
    duke_treadmill:["duke treadmill score","dts","exercise stress test","treadmill score","exercise ecg prognosis"],
    mayo_uc:["mayo score","ulcerative colitis activity","mayo clinic score uc","uc disease activity","partial mayo"],
    oxygenation_index:["oxygenation index","oi","paediatric ards","pediatric ards severity","palicc"],
    schwartz:["schwartz equation","bedside schwartz","paediatric egfr","pediatric gfr","child gfr","childhood kidney function"],
    delta_ratio:["delta ratio","delta gap","delta-delta","mixed acid base","delta delta"],
    naranjo:["naranjo","adverse drug reaction","adr probability","drug causality"],
    glasgow_7point:["7 point checklist","glasgow melanoma","pigmented lesion referral","mole check","melanoma screen"],
    dlqi:["dermatology life quality index","dlqi","skin quality of life"],
    bpp:["biophysical profile","bpp","fetal wellbeing","manning score"],
    calvert:["calvert formula","carboplatin dose","carboplatin auc","chemotherapy dosing"],
    mirels:["mirels score","pathological fracture risk","bone metastasis fracture","impending fracture"],
    epds:["edinburgh postnatal depression","epds","perinatal depression","postnatal depression screen"],
    gds15:["geriatric depression scale","gds","gds-15","elderly depression screen"],
    karnofsky:["karnofsky performance status","kps","performance status"],
    ecog:["ecog performance status","ecog","zubrod","performance status oncology"],
    logmar:["logmar","snellen conversion","visual acuity conversion","acuity"],
    rass:["richmond agitation sedation scale","rass","sedation scale","agitation score"],
    downes:["downes score","neonatal respiratory distress","newborn respiratory score"],
    pas:["paediatric appendicitis score","pediatric appendicitis","pas","child appendicitis"],
    pittsburgh_knee:["pittsburgh knee rules","knee x-ray rule","knee radiograph decision"],
    fai:["free androgen index","fai","bioavailable testosterone","pcos androgen"],
    quicki:["quicki","insulin sensitivity","insulin resistance index"],
    basdai:["basdai","ankylosing spondylitis activity","axial spondyloarthritis activity","spondylitis disease activity"],
    forrest:["forrest classification","ulcer bleeding","peptic ulcer rebleeding","endoscopic bleeding stigmata"],
    gap_ipf:["gap index","ipf mortality","pulmonary fibrosis prognosis","gap score"],
    canadian_syncope:["canadian syncope risk score","csrs","syncope risk","fainting risk"],
    albi:["albi grade","albumin bilirubin","liver function hcc","albi score"],
    khorana:["khorana score","cancer vte risk","chemotherapy thrombosis risk","cancer thromboprophylaxis"],
    must:["malnutrition universal screening tool","must score","nutrition screen","malnutrition risk"],
    nyha:["nyha","new york heart association","heart failure class","functional class"],
    hoehn_yahr:["hoehn yahr","parkinson staging","parkinsons disease stage"],
    epworth:["epworth sleepiness scale","ess","daytime sleepiness","sleepiness score"],
    spetzler_martin:["spetzler martin","avm grade","arteriovenous malformation grade"],
    murray:["murray lung injury score","lung injury score","lis","ards severity"],
    kdigo_aki:["kdigo","aki staging","acute kidney injury stage","aki criteria"],
    milan:["milan criteria","hcc transplant","hepatocellular carcinoma transplant","liver transplant tumour"],
    findrisc:["findrisc","diabetes risk score","type 2 diabetes risk","t2dm risk"],
    caspar:["caspar criteria","psoriatic arthritis classification","psa classification"],
    hscore:["hscore","hlh probability","haemophagocytic","macrophage activation syndrome","hemophagocytic"],
    plasmic:["plasmic score","ttp likelihood","adamts13","thrombotic thrombocytopenic purpura","thrombotic microangiopathy"],
    cfs:["clinical frailty scale","rockwood frailty","frailty score","cfs"],
    duke_endocarditis:["duke criteria","modified duke","infective endocarditis diagnosis","endocarditis criteria"],
    stess:["status epilepticus severity score","stess","status epilepticus prognosis"],
    bicarb_deficit:["bicarbonate deficit","hco3 deficit","base deficit replacement","bicarbonate replacement"],
    cat_copd:["copd assessment test","cat score","copd symptom burden"],
    ibw:["ideal body weight","devine formula","ibw","dosing weight"],
    adjbw:["adjusted body weight","adjbw","obesity dosing weight"],
    hunter_serotonin:["hunter criteria","serotonin syndrome","serotonin toxicity","serotonin"],
    ganzoni:["ganzoni","iron deficit","total iron dose","iron replacement dose"],
    fepo4:["fractional excretion of phosphate","fepo4","phosphate wasting","renal phosphate"],
    gcs_p:["gcs pupils","gcs-p","glasgow coma pupils","gcsp"],
    charlson:["charlson comorbidity index","cci","comorbidity index","10 year survival"],
    add_rs:["aortic dissection detection","add-rs","aortic dissection risk","dissection score"],
    hat:["hat score","haemorrhage after thrombolysis","hemorrhage after thrombolysis","sich risk tpa"],
    feua:["fractional excretion of uric acid","feua","urate excretion","siadh urate"],
    mdq:["mood disorder questionnaire","mdq","bipolar screen","bipolar screening"],
    eutos:["eutos score","cml prognosis","chronic myeloid leukaemia risk","chronic myeloid leukemia score"],
    chads2:["chads2","cha ds2","af stroke risk","atrial fibrillation stroke"],
    ca_phos_product:["calcium phosphate product","ca x po4","calcium phosphorus product","ckd mbd"],
    pecarn_head:["pecarn","paediatric head injury","pediatric head ct","child head trauma ct"],
    berlin_ards:["berlin definition","ards","ards severity","acute respiratory distress syndrome"],
    four_score:["four score","full outline of unresponsiveness","coma scale","consciousness score"],
    marburg:["marburg heart score","chest pain primary care","cad probability","chest pain rule"],
    effective_osm:["effective osmolality","tonicity","serum tonicity","hyperosmolar"],
    ktv:["kt/v","ktv","dialysis adequacy","urea reduction dialysis","haemodialysis adequacy"],
    audit_full:["audit","alcohol use disorders identification test","alcohol screen","hazardous drinking"],
    mews:["modified early warning score","mews","track and trigger","early warning"],
    apfel:["apfel score","ponv","postoperative nausea vomiting","nausea risk"],
    borg:["borg scale","dyspnoea scale","breathlessness score","modified borg"],
    aar:["ast alt ratio","de ritis ratio","aar","transaminase ratio"],
    barthel:["barthel index","activities of daily living","adl score","functional independence"],
    silverman:["silverman andersen","retraction score","neonatal respiratory distress","newborn work of breathing"],
    ashworth:["modified ashworth","spasticity scale","muscle tone","ashworth"],
    abi:["ankle brachial index","abi","peripheral arterial disease","abpi"],
    pack_years:["pack years","pack-years","smoking history","cigarette exposure"],
    phq2:["phq-2","phq2","depression screen","brief depression"],
    whr:["waist hip ratio","waist-to-hip","central obesity","whr"],
    bristol:["bristol stool","stool chart","stool form","bristol scale"],
    apache2:["apache ii","apache 2","icu severity","acute physiology chronic health","critical illness mortality"],
    ipss_r:["ipss-r","ipss r","myelodysplastic syndrome prognosis","mds risk","revised ipss"],
    ad8:["ad8","dementia screen","cognitive impairment screen","informant dementia"],
    rome4_ibs:["rome iv","rome 4","irritable bowel syndrome criteria","ibs diagnosis"],
    dapsa:["dapsa","psoriatic arthritis activity","psa disease activity"],
    hit_4ts:["4ts","4 t score","heparin induced thrombocytopenia","hit probability"],
    cornell_lvh:["cornell voltage","cornell criteria","left ventricular hypertrophy ecg","lvh voltage"],
    sarcf:["sarc-f","sarcf","sarcopenia screen","muscle loss screen"],
    cam:["confusion assessment method","cam","delirium","delirium screen"],
    meld_na:["meld-na","meld sodium","meld na","liver transplant score"],
    rts:["revised trauma score","rts","trauma triage"],
    hestia:["hestia criteria","outpatient pe","pulmonary embolism outpatient","home treatment pe"],
    sokal:["sokal index","sokal score","cml prognosis","chronic myeloid leukaemia risk"],
    nlr:["neutrophil lymphocyte ratio","nlr","neutrophil to lymphocyte"],
    plr:["platelet lymphocyte ratio","plr","platelet to lymphocyte"],
    aec:["absolute eosinophil count","aec","eosinophilia"],
    alc:["absolute lymphocyte count","alc","lymphopenia","lymphocytosis"],
    bun_cr_ratio:["bun creatinine ratio","bun/cr","urea creatinine ratio","prerenal"],
    modified_shock_index:["modified shock index","msi","shock index map"],
    pulse_pressure:["pulse pressure","widened pulse pressure","narrow pulse pressure"],
    corrected_anion_gap:["albumin corrected anion gap","corrected anion gap","albumin adjusted anion gap"],
    caprini:["caprini score","vte risk surgical","venous thromboembolism risk","dvt prophylaxis risk"],
    ldl_friedewald:["ldl cholesterol","friedewald","calculated ldl","ldl estimate"],
    non_hdl:["non hdl cholesterol","non-hdl","atherogenic cholesterol"],
    blood_volume:["estimated blood volume","total blood volume","ebv","allowable blood loss"],
    femg:["fractional excretion of magnesium","femg","magnesium wasting","renal magnesium"],
    gad2:["gad-2","gad2","anxiety screen","brief anxiety"],
    fagerstrom:["fagerstrom","nicotine dependence","ftnd","smoking dependence"],
    qtcf:["qtcf","fridericia","corrected qt fridericia","qt correction"],
    nrs2002:["nrs-2002","nrs2002","nutritional risk screening","malnutrition screen hospital"],
    harris_benedict:["harris benedict","basal metabolic rate","bmr","energy requirement","calorie needs"],
    stool_osmotic_gap:["stool osmotic gap","faecal osmotic gap","osmotic vs secretory diarrhoea"],
    abc2_ich_volume:["abc/2","abc2","ich volume","haematoma volume","intracerebral haemorrhage volume"],
    whtr:["waist to height ratio","waist height ratio","whtr","central obesity"],
    pbw_ardsnet:["predicted body weight","ardsnet","tidal volume","lung protective ventilation","pbw"],
    fractional_shortening:["fractional shortening","lv function","fs echo","left ventricular shortening"],
    mifflin:["mifflin st jeor","bmr","basal metabolic rate","calorie needs","energy requirement"],
    body_fat:["body fat percentage","deurenberg","body fat estimate"],
    sgarbossa_smith:["modified sgarbossa","smith sgarbossa","mi in lbbb","occlusion mi lbbb"],
    cao2:["arterial oxygen content","cao2","oxygen content","oxygen delivery"],
    green_king:["green king index","thalassaemia iron deficiency","microcytosis discriminant"],
    qtc_fram:["qtc framingham","framingham qt","corrected qt framingham"],
    qtc_hodges:["qtc hodges","hodges qt","corrected qt hodges"],
    minute_ventilation:["minute ventilation","minute volume","ve","respiratory minute volume"],
    ferriman_gallwey:["ferriman gallwey","hirsutism score","hirsutism","pcos hair"],
    rancho:["rancho los amigos","cognitive recovery","brain injury cognition","lcfs"],
    asia_impairment:["asia impairment scale","ais","spinal cord injury grade","isncsci"],
    house_brackmann:["house brackmann","facial nerve grade","facial palsy grading"],
    rai:["rai staging","cll staging","chronic lymphocytic leukaemia stage"],
    binet:["binet staging","cll staging","chronic lymphocytic leukaemia stage europe"],
    ann_arbor:["ann arbor","lymphoma staging","hodgkin staging","cotswolds"],
    iss_myeloma:["iss","international staging system myeloma","multiple myeloma stage"],
    katz_adl:["katz adl","activities of daily living","basic adl","katz index"],
    lawton_iadl:["lawton iadl","instrumental activities of daily living","iadl"],
    mjoa:["mjoa","modified japanese orthopaedic association","cervical myelopathy score","myelopathy severity"],
    dasi:["duke activity status index","dasi","functional capacity","mets estimate","perioperative functional capacity"],
    basfi:["basfi","ankylosing spondylitis function","axial spondyloarthritis function"],
    ballard:["ballard score","new ballard","gestational age estimate","neonatal maturity"],
    burn_tbsa:["rule of nines","burn surface area","tbsa","total body surface area burn","wallace"],
    amts:["abbreviated mental test","amts","amt10","cognitive screen elderly","hodkinson"],
    hama:["hamilton anxiety","ham-a","hars","anxiety rating scale"],
    mna_sf:["mini nutritional assessment","mna-sf","mna","nutrition screen elderly"],
    absolute_retic:["absolute reticulocyte count","arc","reticulocyte number"],
    uacr:["urine albumin creatinine ratio","uacr","acr","albuminuria","microalbuminuria"],
    upcr:["urine protein creatinine ratio","upcr","pcr","proteinuria","spot protein"],
    west_haven:["west haven","hepatic encephalopathy grade","he grade","conn score"],
    cpss:["cincinnati prehospital stroke scale","cpss","stroke screen","face arm speech"],
    rosier:["rosier","stroke recognition","recognition of stroke emergency room"],
    fick_co:["fick cardiac output","cardiac output","fick principle"],
    fontaine:["fontaine classification","peripheral arterial disease stage","claudication stage","critical limb ischaemia"],
    rutherford:["rutherford classification","peripheral arterial disease category","limb ischaemia category"],
    salter_harris:["salter harris","physeal fracture","growth plate fracture"],
    fitzpatrick:["fitzpatrick skin type","skin phototype","photosensitivity type"],
    lams:["los angeles motor scale","lams","large vessel occlusion screen","lvo screen"],
    robson:["robson classification","ten group classification","caesarean audit","robson group"],
    acr_eular_ra:["acr eular","rheumatoid arthritis classification","ra classification 2010"],
    corrected_age:["corrected age","adjusted age prematurity","premature infant age"],
    rate_pressure_product:["rate pressure product","double product","myocardial oxygen demand"],
    corrected_wbc:["corrected wbc","nucleated rbc correction","nrbc wbc"],
    gose:["glasgow outcome scale extended","gos-e","tbi outcome"],
    paeds_weight:["paediatric weight estimate","apls weight","child weight formula","pediatric weight"],
    ett_size:["ett size","endotracheal tube size","paediatric airway","tube depth"],
    ga_crl:["gestational age crl","crown rump length","robinson fleming","dating scan"],
    cardiac_index:["cardiac index","ci","cardiac output bsa","haemodynamics"],
    stroke_volume:["stroke volume","sv","stroke volume index","svi"],
    homa_b:["homa b","homa beta","beta cell function","insulin secretion","homa-%b"],
    asdas_crp:["asdas","asdas-crp","ankylosing spondylitis disease activity","axial spondyloarthritis activity"],
    ava_continuity:["aortic valve area","continuity equation","ava","aortic stenosis echo","lvot vti"],
    svr:["systemic vascular resistance","svr","afterload","vascular resistance"],
    mmrc_dyspnoea:["mmrc","dyspnoea scale","breathlessness grade","mrc dyspnea","copd symptoms"],
    canadian_cspine:["canadian c-spine","cervical spine rule","c-spine imaging","neck trauma","ccr"],
    nutric:["nutric","mnutric","nutrition risk critically ill","icu nutrition score"],
    lbm:["lean body mass","boer formula","fat free mass","lbm"],
    tbw_watson:["total body water","watson formula","tbw","body water"],
    nitrogen_balance:["nitrogen balance","protein balance","uun","urea nitrogen","catabolic anabolic"],
    pcl5:["pcl-5","ptsd checklist","post traumatic stress","pcl5"],
    allowable_blood_loss:["allowable blood loss","abl","maximum blood loss","transfusion threshold","gross formula"],
    sokolow_lyon:["sokolow lyon","lvh","left ventricular hypertrophy","ecg voltage","sv1 rv5"],
    pesi:["pesi","pulmonary embolism severity index","pe mortality","aujesky"],
    gold_group:["gold group","gold abe","copd assessment","gold 2023","abcd copd"],
    scorad:["scorad","atopic dermatitis","eczema severity","scoring atopic dermatitis"],
    afi:["amniotic fluid index","afi","oligohydramnios","polyhydramnios","four quadrant"],
    iom_weight_gain:["pregnancy weight gain","iom","gestational weight","weight gain pregnancy"],
    flacc:["flacc","paediatric pain","non verbal pain","face legs activity cry consolability"],
    bacterial_meningitis_score:["bacterial meningitis score","nigrovic","csf pleocytosis","meningitis children"],
    modified_fisher:["modified fisher","sah grading","vasospasm","subarachnoid ct grade"],
    widmark:["widmark","blood alcohol","bac","alcohol concentration","ethanol"],
    dipss:["dipss","myelofibrosis prognosis","primary myelofibrosis","passamonti"],
    r_iss:["r-iss","revised iss","myeloma staging","multiple myeloma prognosis"],
    rvsp:["rvsp","pasp","pulmonary artery pressure","tricuspid regurgitation","tr jet","pulmonary hypertension echo"],
    mva_pht:["mitral valve area","pressure half time","mitral stenosis","pht","hatle"],
    cardiac_power:["cardiac power output","cpo","cardiogenic shock","fincke"],
    do2:["oxygen delivery","do2","oxygen transport","cao2 delivery"],
    lung_compliance:["static compliance","lung compliance","driving pressure","respiratory compliance"],
    bohr_deadspace:["dead space","bohr","enghoff","vd vt","dead space fraction"],
    adrogue_madias:["adrogue madias","sodium correction","hyponatraemia infusate","na change per litre"],
    measured_crcl:["measured creatinine clearance","timed urine","24 hour urine creatinine","clearance"],
    bard:["bard score","nafld fibrosis","nonalcoholic fatty liver","advanced fibrosis"],
    cpis:["cpis","clinical pulmonary infection score","ventilator associated pneumonia","vap"],
    kawasaki:["kawasaki disease","mucocutaneous lymph node","kd criteria","coronary aneurysm children"],
    cci_platelet:["corrected count increment","cci","platelet refractoriness","platelet transfusion response"],
    dvi_aortic:["dimensionless index","velocity ratio","aortic stenosis","dvi","lvot av vti"],
    lv_mass:["lv mass","left ventricular mass","devereux","ase cube","lvh mass"],
    e_over_e_prime:["e/e prime","e over e","filling pressure","diastolic function","tissue doppler","lap"],
    rsbi:["rapid shallow breathing index","rsbi","weaning","yang tobin","sbt"],
    vis_score:["vasoactive inotropic score","vis","inotrope score","vasopressor score"],
    fli:["fatty liver index","fli","hepatic steatosis","nafld screen"],
    ipi:["international prognostic index","ipi","dlbcl","aggressive lymphoma prognosis"],
    flipi:["flipi","follicular lymphoma","lymphoma prognosis"],
    mipi:["mipi","mantle cell lymphoma","mantle cell prognosis"],
    iron_ingestion:["iron ingestion","elemental iron","iron overdose","iron poisoning"],
    mmse:["mmse","mini mental","folstein","cognitive screen","dementia score"],
    insulin_rules:["insulin dosing","500 rule","1800 rule","carb ratio","correction factor","insulin sensitivity factor"],
    romhilt_estes:["romhilt estes","lvh point score","left ventricular hypertrophy ecg"],
    dapt:["dapt score","dual antiplatelet","stent duration","yeh score"],
    mehran:["mehran score","contrast induced nephropathy","cin","contrast nephropathy"],
    dragon:["dragon score","stroke thrombolysis outcome","tpa outcome","ischaemic stroke prognosis"],
    isaric_4c:["isaric 4c","4c mortality","covid mortality","covid-19 score"],
    rochester_criteria:["rochester criteria","febrile infant","serious bacterial infection","low risk infant"],
    hamd:["ham-d","hamilton depression","hdrs","depression scale"],
    moca:["moca","montreal cognitive assessment","cognitive screen","dementia"],
    madrs:["madrs","montgomery asberg","depression rating"],
    sf_ratio:["s/f ratio","spo2 fio2","sf ratio","oxygenation surrogate"],
    o2er:["oxygen extraction ratio","o2er","oxygen extraction","svo2"],
    h2fpef:["h2fpef","hfpef probability","preserved ejection fraction","diastolic heart failure"],
    atria_bleed:["atria bleeding","anticoagulation bleeding","af bleeding risk","fang score"],
    edacs:["edacs","chest pain score","acs risk","emergency chest pain"],
    years_pe:["years algorithm","pulmonary embolism rule out","years pe","d-dimer pe"],
    thrive:["thrive score","stroke outcome","stroke mortality","vascular events"],
    stone_score:["stone score","ureteric stone","renal colic","flank pain stone","kidney stone probability"],
    nexus_chest:["nexus chest","blunt trauma imaging","thoracic injury","chest ct trauma"],
    hsi:["hepatic steatosis index","hsi","nafld screen","fatty liver screen"],
    ybocs:["ybocs","yale brown","obsessive compulsive","ocd severity"],
    ymrs:["ymrs","young mania rating","mania scale","bipolar mania"],
    odi:["oswestry","odi","low back disability","back pain disability"],
    ndi:["neck disability index","ndi","neck pain disability"],
    wexner:["wexner","faecal incontinence","cleveland clinic incontinence","fecal incontinence"],
    qrs_axis:["qrs axis","frontal axis","ecg axis","left axis deviation","right axis deviation"],
    teichholz_ef:["teichholz","ejection fraction","lvef","ef from diameters","fractional shortening ef"],
    mpap:["mean pulmonary artery pressure","mpap","pulmonary hypertension","pa pressure"],
    midas:["midas","migraine disability","headache disability"],
    isi:["insomnia severity index","isi","insomnia","sleep"],
    hit6:["hit-6","headache impact test","migraine impact"],
    hads:["hads","hospital anxiety depression","anxiety depression scale"],
    womac:["womac","osteoarthritis index","hip knee oa","arthritis function"],
    zarit:["zarit","caregiver burden","carer burden","zbi"],
    pucai:["pucai","paediatric ulcerative colitis","pediatric uc activity"],
    braden_q:["braden q","paediatric pressure injury","pressure ulcer children"],
    norton:["norton scale","pressure sore risk","pressure ulcer risk"],
    pvr:["pulmonary vascular resistance","pvr","wood units","pulmonary hypertension"],
    tpg:["transpulmonary gradient","tpg","pulmonary gradient"],
    cpp:["cerebral perfusion pressure","cpp","map icp","brain perfusion"],
    bdi:["beck depression","bdi","bdi-ii","depression inventory"],
    bai:["beck anxiety","bai","anxiety inventory"],
    psqi:["pittsburgh sleep quality","psqi","sleep quality"],
    uas7:["urticaria activity score","uas7","chronic urticaria","hives"],
    fe_bicarb:["fractional excretion bicarbonate","fe hco3","renal tubular acidosis","rta"],
    lysholm:["lysholm","knee score","knee function"],
    harris_hip:["harris hip score","hip function","hip replacement outcome"],
    tampa:["tampa scale","kinesiophobia","fear of movement","tsk"],
    constant_shoulder:["constant murley","shoulder score","constant score"],
    ascvd:["ascvd","pooled cohort","10 year cardiovascular risk","cardiovascular risk","statin risk","acc aha risk"],
    spherical_equivalent:["spherical equivalent","refraction","sphere cylinder","spectacle power"],
    srk2_iol:["iol power","srk ii","intraocular lens","cataract lens power","a-constant"],
    oxford_knee:["oxford knee score","knee arthroplasty outcome","knee replacement score"],
    oxford_hip:["oxford hip score","hip arthroplasty outcome","hip replacement score"],
    quickdash:["quickdash","dash","upper limb disability","arm shoulder hand"],
    dn4:["dn4","neuropathic pain","douleur neuropathique","neuropathic screen"],
    phq15:["phq-15","somatic symptom","somatization","physical symptoms"],
    framingham:["framingham risk","general cvd risk","d'agostino","10 year cvd","cardiovascular risk score"],
    epvs:["estimated plasma volume","epvs","plasma volume status","congestion","duarte"],
    frail_scale:["frail scale","frailty screen","morley frail"],
    tug:["timed up and go","tug","fall risk mobility","gait speed"],
    prisma7:["prisma-7","frailty screen","older adult frailty","disability screen"],
    gds30:["geriatric depression scale","gds-30","gds 30","elderly depression"],
    cdr:["clinical dementia rating","cdr","dementia staging","dementia severity"]
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
    mentzer:"Mentzer WC. Lancet 1973;1(7808):882.",
    eag:"Nathan DM, et al. Diabetes Care 2008;31(8):1473–8 (ADAG Study).",
    rpi:"Standard haematology reference (corrected reticulocyte / maturation factor).",
    isth_dic:"Taylor FB, et al. Thromb Haemost 2001;86(5):1327–30 (ISTH SSC).",
    sdai:"Smolen JS, et al. Rheumatology (Oxford) 2003;42(2):244–57.",
    braden:"Bergstrom N, et al. Nurs Res 1987;36(4):205–10.",
    morse_falls:"Morse JM, et al. Can J Aging 1989;8(4):366–77.",
    bap65:"Shorr AF, et al. Chest 2011;140(5):1177–83 (BAP-65).",
    duke_treadmill:"Mark DB, et al. N Engl J Med 1991;325(12):849–53.",
    mayo_uc:"Schroeder KW, et al. N Engl J Med 1987;317(26):1625–9.",
    oxygenation_index:"PALICC. Pediatr Crit Care Med 2015;16(5):428–39.",
    schwartz:"Schwartz GJ, et al. J Am Soc Nephrol 2009;20(3):629–37.",
    delta_ratio:"Standard acid-base physiology reference (delta-delta gap).",
    naranjo:"Naranjo CA, et al. Clin Pharmacol Ther 1981;30(2):239–45.",
    glasgow_7point:"MacKie RM. Glasgow 7-point checklist; NICE melanoma referral guidance.",
    dlqi:"Finlay AY, Khan GK. Clin Exp Dermatol 1994;19(3):210–6.",
    bpp:"Manning FA, et al. Am J Obstet Gynecol 1980;136(6):787–95.",
    calvert:"Calvert AH, et al. J Clin Oncol 1989;7(11):1748–56.",
    mirels:"Mirels H. Clin Orthop Relat Res 1989;(249):256–64.",
    epds:"Cox JL, et al. Br J Psychiatry 1987;150:782–6.",
    gds15:"Sheikh JI, Yesavage JA. Clin Gerontol 1986 (GDS-15).",
    karnofsky:"Karnofsky DA, Burchenal JH. 1949.",
    ecog:"Oken MM, et al. Am J Clin Oncol 1982;5(6):649–55 (ECOG).",
    logmar:"Standard optotype (Snellen → logMAR) conversion.",
    rass:"Sessler CN, et al. Am J Respir Crit Care Med 2002;166(10):1338–44.",
    downes:"Downes JJ, et al. Clin Pediatr 1970;9(6):325–31.",
    pas:"Samuel M. J Pediatr Surg 2002;37(6):877–81 (PAS).",
    pittsburgh_knee:"Seaberg DC, et al. Ann Emerg Med 1998;32(1):8–13.",
    fai:"Standard endocrinology reference (free androgen index).",
    quicki:"Katz A, et al. J Clin Endocrinol Metab 2000;85(7):2402–10.",
    basdai:"Garrett S, et al. J Rheumatol 1994;21(12):2286–91 (BASDAI).",
    forrest:"Forrest JA, et al. Lancet 1974;2(7877):394–7.",
    gap_ipf:"Ley B, et al. Ann Intern Med 2012;156(10):684–91 (GAP).",
    canadian_syncope:"Thiruganasambandamoorthy V, et al. JAMA Intern Med 2016;176(6):737–43.",
    albi:"Johnson PJ, et al. J Clin Oncol 2015;33(6):550–8 (ALBI).",
    khorana:"Khorana AA, et al. Blood 2008;111(10):4902–7.",
    must:"BAPEN Malnutrition Universal Screening Tool (MUST).",
    nyha:"The Criteria Committee of the New York Heart Association, 1994.",
    hoehn_yahr:"Hoehn MM, Yahr MD. Neurology 1967;17(5):427–42.",
    epworth:"Johns MW. Sleep 1991;14(6):540–5.",
    spetzler_martin:"Spetzler RF, Martin NA. J Neurosurg 1986;65(4):476–83.",
    murray:"Murray JF, et al. Am Rev Respir Dis 1988;138(3):720–3.",
    kdigo_aki:"KDIGO AKI Work Group. Kidney Int Suppl 2012;2(1):1–138.",
    milan:"Mazzaferro V, et al. N Engl J Med 1996;334(11):693–9.",
    findrisc:"Lindström J, Tuomilehto J. Diabetes Care 2003;26(3):725–31.",
    caspar:"Taylor W, et al. Arthritis Rheum 2006;54(8):2665–73 (CASPAR).",
    hscore:"Fardet L, et al. Arthritis Rheumatol 2014;66(9):2613–20 (HScore).",
    plasmic:"Bendapudi PK, et al. Lancet Haematol 2017;4(4):e157–64 (PLASMIC).",
    cfs:"Rockwood K, et al. CMAJ 2005;173(5):489–95.",
    duke_endocarditis:"Li JS, et al. Clin Infect Dis 2000;30(4):633–8 (modified Duke).",
    stess:"Rossetti AO, et al. J Neurol 2008;255(10):1561–6 (STESS).",
    bicarb_deficit:"Standard acid-base reference (0.5 × weight × base deficit).",
    cat_copd:"Jones PW, et al. Eur Respir J 2009;34(3):648–54 (CAT).",
    ibw:"Devine BJ. Drug Intell Clin Pharm 1974.",
    adjbw:"Standard clinical pharmacokinetics reference.",
    hunter_serotonin:"Dunkley EJC, et al. QJM 2003;96(9):635–42 (Hunter).",
    ganzoni:"Ganzoni AM. Schweiz Med Wochenschr 1970;100(7):301–3.",
    fepo4:"Standard nephrology reference (fractional excretion).",
    gcs_p:"Brennan PM, Murray GD, Teasdale GM. J Neurosurg 2018;128(6):1612–20.",
    charlson:"Charlson ME, et al. J Chronic Dis 1987;40(5):373–83.",
    add_rs:"Rogers AM, et al. Circulation 2011;123(20):2213–8 (ADD-RS).",
    hat:"Lou M, et al. Neurology 2008;71(18):1417–23 (HAT).",
    feua:"Standard nephrology reference (fractional excretion of urate).",
    mdq:"Hirschfeld RMA, et al. Am J Psychiatry 2000;157(11):1873–5 (MDQ).",
    eutos:"Hasford J, et al. Blood 2011;118(3):686–92 (EUTOS).",
    chads2:"Gage BF, et al. JAMA 2001;285(22):2864–70.",
    ca_phos_product:"KDIGO CKD-MBD Work Group. Kidney Int Suppl 2009/2017.",
    pecarn_head:"Kuppermann N, et al. Lancet 2009;374(9696):1160–70 (PECARN).",
    berlin_ards:"ARDS Definition Task Force. JAMA 2012;307(23):2526–33 (Berlin).",
    four_score:"Wijdicks EFM, et al. Ann Neurol 2005;58(4):585–93 (FOUR).",
    marburg:"Bösner S, et al. CMAJ 2010;182(12):1295–300 (Marburg Heart Score).",
    effective_osm:"Standard biochemistry reference (effective osmolality/tonicity).",
    ktv:"Daugirdas JT. J Am Soc Nephrol 1993;4(5):1205–13.",
    audit_full:"Saunders JB, et al. Addiction 1993;88(6):791–804 (WHO AUDIT).",
    mews:"Subbe CP, et al. QJM 2001;94(10):521–6 (MEWS).",
    apfel:"Apfel CC, et al. Anesthesiology 1999;91(3):693–700.",
    borg:"Borg GA. Med Sci Sports Exerc 1982;14(5):377–81 (modified scale).",
    aar:"De Ritis F. Standard hepatology reference (AST/ALT ratio).",
    barthel:"Mahoney FI, Barthel DW. Md State Med J 1965;14:61–5.",
    silverman:"Silverman WA, Andersen DH. Pediatrics 1956;17(1):1–10.",
    ashworth:"Bohannon RW, Smith MB. Phys Ther 1987;67(2):206–7 (Modified Ashworth).",
    abi:"Standard vascular assessment reference (ankle-brachial index).",
    pack_years:"Standard definition (cigarettes/day ÷ 20 × years).",
    phq2:"Kroenke K, et al. Med Care 2003;41(11):1284–92 (PHQ-2).",
    whr:"WHO. Waist Circumference and Waist-Hip Ratio, 2008.",
    bristol:"Lewis SJ, Heaton KW. Scand J Gastroenterol 1997;32(9):920–4.",
    apache2:"Knaus WA, et al. Crit Care Med 1985;13(10):818–29 (APACHE II).",
    ipss_r:"Greenberg PL, et al. Blood 2012;120(12):2454–65 (IPSS-R).",
    ad8:"Galvin JE, et al. Neurology 2005;65(4):559–64 (AD8).",
    rome4_ibs:"Lacy BE, et al. Gastroenterology 2016;150(6):1393–407 (Rome IV).",
    dapsa:"Schoels M, et al. Ann Rheum Dis 2010;69(8):1441–7 (DAPSA).",
    hit_4ts:"Lo GK, et al. J Thromb Haemost 2006;4(4):759–65 (4Ts).",
    cornell_lvh:"Casale PN, et al. Circulation 1987;75(3):565–72 (Cornell).",
    sarcf:"Malmstrom TK, et al. J Cachexia Sarcopenia Muscle 2016;7(1):28–36 (SARC-F).",
    cam:"Inouye SK, et al. Ann Intern Med 1990;113(12):941–8 (CAM).",
    meld_na:"Kim WR, et al. N Engl J Med 2008;359(10):1018–26 (MELD-Na).",
    rts:"Champion HR, et al. J Trauma 1989;29(5):623–9 (RTS).",
    hestia:"Zondag W, et al. J Thromb Haemost 2011;9(8):1500–7 (Hestia).",
    sokal:"Sokal JE, et al. Blood 1984;63(4):789–99.",
    nlr:"Standard haematology reference (neutrophil-lymphocyte ratio).",
    plr:"Standard haematology reference (platelet-lymphocyte ratio).",
    aec:"Standard haematology reference (WBC × eosinophil fraction).",
    alc:"Standard haematology reference (WBC × lymphocyte fraction).",
    bun_cr_ratio:"Standard nephrology reference (BUN/creatinine ratio).",
    modified_shock_index:"Standard critical-care reference (HR/MAP).",
    pulse_pressure:"Standard cardiovascular physiology reference.",
    corrected_anion_gap:"Figge J, et al. 1998 (albumin-corrected anion gap).",
    caprini:"Caprini JA. Dis Mon 2005;51(2-3):70–8.",
    ldl_friedewald:"Friedewald WT, et al. Clin Chem 1972;18(6):499–502.",
    non_hdl:"Standard lipidology reference (total − HDL cholesterol).",
    blood_volume:"Standard reference (weight-based blood volume estimation).",
    femg:"Standard nephrology reference (fractional excretion of magnesium).",
    gad2:"Kroenke K, et al. Ann Intern Med 2007;146(5):317–25 (GAD-2).",
    fagerstrom:"Heatherton TF, et al. Br J Addict 1991;86(9):1119–27 (FTND).",
    qtcf:"Fridericia LS. 1920 (cube-root QT correction).",
    nrs2002:"Kondrup J, et al. Clin Nutr 2003;22(3):321–36 (NRS-2002).",
    harris_benedict:"Roza AM, Shizgal HM. Am J Clin Nutr 1984;40(1):168–82.",
    stool_osmotic_gap:"Standard gastroenterology reference (stool osmotic gap).",
    abc2_ich_volume:"Kothari RU, et al. Stroke 1996;27(8):1304–5 (ABC/2).",
    whtr:"Ashwell M, et al. Standard reference (waist-to-height ratio).",
    pbw_ardsnet:"ARDS Network. N Engl J Med 2000;342(18):1301–8.",
    fractional_shortening:"Standard echocardiography reference (fractional shortening).",
    mifflin:"Mifflin MD, et al. Am J Clin Nutr 1990;51(2):241–7.",
    body_fat:"Deurenberg P, et al. Br J Nutr 1991;65(2):105–14.",
    sgarbossa_smith:"Smith SW, et al. Ann Emerg Med 2012;60(6):766–76.",
    cao2:"Standard physiology reference (arterial oxygen content).",
    green_king:"Green R, King R. Blood Cells 1989 (Green & King index).",
    qtc_fram:"Sagie A, et al. Am J Cardiol 1992;70(7):797–801 (Framingham).",
    qtc_hodges:"Hodges M, et al. 1983 (Hodges QT correction).",
    minute_ventilation:"Standard respiratory physiology reference.",
    ferriman_gallwey:"Ferriman D, Gallwey JD. J Clin Endocrinol Metab 1961;21:1440–7.",
    rancho:"Hagen C, et al. Rancho Los Amigos Levels of Cognitive Functioning.",
    asia_impairment:"ASIA/ISCoS. International Standards for Neurological Classification of SCI.",
    house_brackmann:"House JW, Brackmann DE. Otolaryngol Head Neck Surg 1985;93(2):146–7.",
    rai:"Rai KR, et al. Blood 1975;46(2):219–34.",
    binet:"Binet JL, et al. Cancer 1981;48(1):198–206.",
    ann_arbor:"Carbone PP, et al. Cancer Res 1971;31(11):1860–1 (Cotswolds-modified).",
    iss_myeloma:"Greipp PR, et al. J Clin Oncol 2005;23(15):3412–20 (ISS).",
    katz_adl:"Katz S, et al. JAMA 1963;185:914–9.",
    lawton_iadl:"Lawton MP, Brody EM. Gerontologist 1969;9(3):179–86.",
    mjoa:"Modified Japanese Orthopaedic Association score (Benzel et al.).",
    dasi:"Hlatky MA, et al. Am J Cardiol 1989;64(10):651–4 (DASI).",
    basfi:"Calin A, et al. J Rheumatol 1994;21(12):2281–5 (BASFI).",
    ballard:"Ballard JL, et al. J Pediatr 1991;119(3):417–23 (New Ballard Score).",
    burn_tbsa:"Wallace AB. Lancet 1951 (rule of nines).",
    amts:"Hodkinson HM. Age Ageing 1972;1(4):233–8 (AMTS).",
    hama:"Hamilton M. Br J Med Psychol 1959;32(1):50–5 (HAM-A).",
    mna_sf:"Rubenstein LZ, et al. J Gerontol A Biol Sci Med Sci 2001;56(6):M366–72.",
    absolute_retic:"Standard haematology reference (retic% × RBC).",
    uacr:"KDIGO 2012 CKD guideline (albuminuria categories).",
    upcr:"Standard nephrology reference (spot protein:creatinine ratio).",
    west_haven:"Conn HO. West Haven criteria; AASLD/EASL HE guideline.",
    cpss:"Kothari RU, et al. Ann Emerg Med 1999;33(4):373–8 (CPSS).",
    rosier:"Nor AM, et al. Lancet Neurol 2005;4(11):727–34 (ROSIER).",
    fick_co:"Standard cardiovascular physiology reference (Fick principle).",
    fontaine:"Fontaine R, et al. 1954 (PAD classification).",
    rutherford:"Rutherford RB, et al. J Vasc Surg 1997;26(3):517–38.",
    salter_harris:"Salter RB, Harris WR. J Bone Joint Surg Am 1963;45:587–622.",
    fitzpatrick:"Fitzpatrick TB. Arch Dermatol 1988;124(6):869–71.",
    lams:"Nazliel B, et al. Stroke 2008;39(8):2264–7 (LAMS).",
    robson:"Robson MS. Fetal Matern Med Rev 2001;12(1):23–39 (WHO-endorsed).",
    acr_eular_ra:"Aletaha D, et al. Arthritis Rheum 2010;62(9):2569–81.",
    corrected_age:"Standard neonatology reference (age corrected for prematurity).",
    rate_pressure_product:"Standard cardiovascular physiology reference (HR × SBP).",
    corrected_wbc:"Standard haematology reference (WBC × 100/(100+nRBC)).",
    gose:"Wilson JTL, et al. J Neurotrauma 1998;15(8):573–85 (GOS-E).",
    paeds_weight:"Advanced Paediatric Life Support (APLS) weight formulae.",
    ett_size:"Standard paediatric airway reference (age/4 + 4).",
    ga_crl:"Robinson HP, Fleming JEE. Br J Obstet Gynaecol 1975;82(9):702–10.",
    cardiac_index:"Standard haemodynamic formula (cardiac output ÷ body surface area).",
    stroke_volume:"Standard haemodynamic formula (cardiac output ÷ heart rate).",
    homa_b:"Matthews DR, et al. Diabetologia 1985;28(7):412–9 (HOMA model).",
    asdas_crp:"Lukas C, et al. Ann Rheum Dis 2009;68(1):18–24 (ASDAS).",
    ava_continuity:"Baumgartner H, et al. Recommendations on the echocardiographic assessment of aortic valve stenosis (ASE/EACVI).",
    svr:"Standard haemodynamic formula ((MAP − CVP) ÷ CO × 80).",
    mmrc_dyspnoea:"Fletcher CM, et al. BMJ 1959; modified MRC scale (adopted by GOLD).",
    canadian_cspine:"Stiell IG, et al. JAMA 2001;286(15):1841–8 (Canadian C-Spine Rule).",
    nutric:"Heyland DK, et al. Crit Care 2011;15:R268; Rahman A, et al. Clin Nutr 2016 (mNUTRIC).",
    lbm:"Boer P. Am J Physiol 1984;247(4):F632–6 (lean body mass).",
    tbw_watson:"Watson PE, et al. Am J Clin Nutr 1980;33(1):27–39 (total body water).",
    nitrogen_balance:"Standard clinical-nutrition reference (protein intake ÷ 6.25 − (UUN + 4)).",
    pcl5:"Blevins CA, et al. J Trauma Stress 2015;28(6):489–98 (PCL-5); US National Center for PTSD.",
    allowable_blood_loss:"Gross JB. Anesthesiology 1983;58(3):277–80 (allowable blood loss).",
    sokolow_lyon:"Sokolow M, Lyon TP. Am Heart J 1949;37(2):161–86.",
    pesi:"Aujesky D, et al. Am J Respir Crit Care Med 2005;172(8):1041–6 (PESI).",
    gold_group:"Global Initiative for Chronic Obstructive Lung Disease (GOLD) 2023 report.",
    scorad:"European Task Force on Atopic Dermatitis. Dermatology 1993;186(1):23–31 (SCORAD).",
    afi:"Phelan JP, et al. J Reprod Med 1987;32(7):540–2 (amniotic fluid index).",
    iom_weight_gain:"Institute of Medicine. Weight Gain During Pregnancy: Reexamining the Guidelines. 2009.",
    flacc:"Merkel SI, et al. Pediatr Nurs 1997;23(3):293–7 (FLACC).",
    bacterial_meningitis_score:"Nigrovic LE, et al. JAMA 2007;297(1):52–60 (Bacterial Meningitis Score).",
    modified_fisher:"Frontera JA, et al. Neurosurgery 2006;59(1):21–7 (modified Fisher scale).",
    widmark:"Widmark EMP. Die theoretischen Grundlagen … der Alkoholbestimmung. 1932.",
    dipss:"Passamonti F, et al. Blood 2010;115(9):1703–8 (DIPSS).",
    r_iss:"Palumbo A, et al. J Clin Oncol 2015;33(26):2863–9 (R-ISS).",
    rvsp:"Simplified Bernoulli equation; ASE guidelines on echocardiographic assessment of pulmonary pressures.",
    mva_pht:"Hatle L, et al. Circulation 1979;60(5):1096–104 (pressure half-time).",
    cardiac_power:"Fincke R, et al. J Am Coll Cardiol 2004;44(2):340–8 (cardiac power).",
    do2:"Standard oxygen-transport physiology (DO₂ = CO × CaO₂ × 10).",
    lung_compliance:"Standard ventilator mechanics (Vt ÷ (Pplat − PEEP)).",
    bohr_deadspace:"Bohr equation with Enghoff modification (Vd/Vt = (PaCO₂ − PECO₂)/PaCO₂).",
    adrogue_madias:"Adrogué HJ, Madias NE. N Engl J Med 2000;342(21):1581–9.",
    measured_crcl:"Standard timed-urine clearance formula (UCr × V ÷ (PCr × time)).",
    bard:"Harrison SA, et al. Gut 2008;57(10):1441–7 (BARD score).",
    cpis:"Pugin J, et al. Am Rev Respir Dis 1991;143(5):1121–9 (CPIS).",
    kawasaki:"McCrindle BW, et al. Circulation 2017;135(17):e927–99 (AHA Kawasaki).",
    cci_platelet:"Standard transfusion-medicine reference (corrected count increment).",
    dvi_aortic:"Baumgartner H, et al. ASE/EACVI recommendations on aortic stenosis assessment.",
    lv_mass:"Devereux RB, et al. Am J Cardiol 1986;57(6):450–8 (ASE cube formula).",
    e_over_e_prime:"Nagueh SF, et al. J Am Soc Echocardiogr 2016;29(4):277–314 (diastolic function).",
    rsbi:"Yang KL, Tobin MJ. N Engl J Med 1991;324(21):1445–50 (RSBI).",
    vis_score:"Gaies MG, et al. Pediatr Crit Care Med 2010;11(2):234–8 (VIS).",
    fli:"Bedogni G, et al. BMC Gastroenterol 2006;6:33 (Fatty Liver Index).",
    ipi:"The International NHL Prognostic Factors Project. N Engl J Med 1993;329(14):987–94.",
    flipi:"Solal-Céligny P, et al. Blood 2004;104(5):1258–65 (FLIPI).",
    mipi:"Hoster E, et al. Blood 2008;111(2):558–65 (MIPI).",
    iron_ingestion:"Standard toxicology reference (elemental iron dose thresholds).",
    mmse:"Folstein MF, et al. J Psychiatr Res 1975;12(3):189–98 (MMSE; © PAR Inc.).",
    insulin_rules:"Standard diabetes reference (500 rule and 1800/1500 rule).",
    romhilt_estes:"Romhilt DW, Estes EH. Am Heart J 1968;75(6):752–8.",
    dapt:"Yeh RW, et al. JAMA 2016;315(16):1735–49 (DAPT score).",
    mehran:"Mehran R, et al. J Am Coll Cardiol 2004;44(7):1393–9 (contrast nephropathy).",
    dragon:"Strbian D, et al. Neurology 2012;78(6):427–32 (DRAGON).",
    isaric_4c:"Knight SR, et al. BMJ 2020;370:m3339 (ISARIC 4C Mortality Score).",
    rochester_criteria:"Jaskiewicz JA, et al. Pediatrics 1994;94(3):390–6 (Rochester criteria).",
    hamd:"Hamilton M. J Neurol Neurosurg Psychiatry 1960;23:56–62 (HDRS).",
    moca:"Nasreddine ZS, et al. J Am Geriatr Soc 2005;53(4):695–9 (MoCA; © MoCA Clinic).",
    madrs:"Montgomery SA, Åsberg M. Br J Psychiatry 1979;134:382–9 (MADRS).",
    sf_ratio:"Rice TW, et al. Chest 2007;132(2):410–7 (SpO₂/FiO₂).",
    o2er:"Standard oxygen-transport physiology ((SaO₂ − SvO₂)/SaO₂).",
    h2fpef:"Reddy YNV, et al. Circulation 2018;138(9):861–70 (H₂FPEF).",
    atria_bleed:"Fang MC, et al. J Am Coll Cardiol 2011;58(4):395–401 (ATRIA bleeding).",
    edacs:"Than M, et al. Emerg Med Australas 2014;26(1):34–44 (EDACS).",
    years_pe:"van der Hulle T, et al. Lancet 2017;390(10091):289–97 (YEARS).",
    thrive:"Flint AC, et al. Stroke 2010–2013 (THRIVE score).",
    stone_score:"Moore CL, et al. BMJ 2014;348:g2191 (STONE score).",
    nexus_chest:"Rodriguez RM, et al. PLoS Med 2015;12(10):e1001883 (NEXUS Chest).",
    hsi:"Lee JH, et al. Dig Liver Dis 2010;42(7):503–8 (HSI).",
    ybocs:"Goodman WK, et al. Arch Gen Psychiatry 1989;46(11):1006–11 (Y-BOCS).",
    ymrs:"Young RC, et al. Br J Psychiatry 1978;133:429–35 (YMRS).",
    odi:"Fairbank JCT, Pynsent PB. Spine 2000;25(22):2940–52 (ODI).",
    ndi:"Vernon H, Mior S. J Manipulative Physiol Ther 1991;14(7):409–15 (NDI).",
    wexner:"Jorge JMN, Wexner SD. Dis Colon Rectum 1993;36(1):77–97.",
    qrs_axis:"Standard vectorcardiographic convention (frontal-plane axis from leads I and aVF).",
    teichholz_ef:"Teichholz LE, et al. Am J Cardiol 1976;37(1):7–11.",
    mpap:"Standard formula ((SPAP + 2·DPAP)/3); ESC/ERS 2022 pulmonary hypertension guideline.",
    midas:"Stewart WF, et al. Neurology 2001;56(6 Suppl 1):S20–8 (MIDAS).",
    isi:"Bastien CH, et al. Sleep Med 2001;2(4):297–307 (ISI).",
    hit6:"Kosinski M, et al. Qual Life Res 2003;12(8):963–74 (HIT-6; © QualityMetric).",
    hads:"Zigmond AS, Snaith RP. Acta Psychiatr Scand 1983;67(6):361–70 (HADS).",
    womac:"Bellamy N, et al. J Rheumatol 1988;15(12):1833–40 (WOMAC).",
    zarit:"Zarit SH, et al. Gerontologist 1980;20(6):649–55 (ZBI).",
    pucai:"Turner D, et al. Gastroenterology 2007;133(2):423–32 (PUCAI).",
    braden_q:"Curley MAQ, et al. Nurs Res 2003;52(1):22–33 (Braden Q).",
    norton:"Norton D, McLaren R, Exton-Smith AN. 1962 (Norton scale).",
    pvr:"Standard haemodynamics ((mPAP − PCWP)/CO); ESC/ERS 2022 PH guideline.",
    tpg:"Standard haemodynamics (mPAP − mean PCWP).",
    cpp:"Brain Trauma Foundation guidelines (CPP = MAP − ICP).",
    bdi:"Beck AT, Steer RA, Brown GK. BDI-II manual, 1996 (© Pearson).",
    bai:"Beck AT, et al. J Consult Clin Psychol 1988;56(6):893–7 (© Pearson).",
    psqi:"Buysse DJ, et al. Psychiatry Res 1989;28(2):193–213 (PSQI).",
    uas7:"Zuberbier T, et al. EAACI/GA²LEN/EDF/WAO urticaria guideline (UAS7).",
    fe_bicarb:"Standard nephrology reference (fractional excretion of bicarbonate).",
    lysholm:"Lysholm J, Gillquist J. Am J Sports Med 1982;10(3):150–4.",
    harris_hip:"Harris WH. J Bone Joint Surg Am 1969;51(4):737–55.",
    tampa:"Miller RP, Kori SH, Todd DD. 1991 (Tampa Scale of Kinesiophobia).",
    constant_shoulder:"Constant CR, Murley AHG. Clin Orthop Relat Res 1987;(214):160–4.",
    ascvd:"Goff DC, et al. 2013 ACC/AHA Guideline on the Assessment of Cardiovascular Risk. Circulation 2014;129(25 Suppl 2):S49–73.",
    spherical_equivalent:"Standard optics (sphere + cylinder/2).",
    srk2_iol:"Sanders DR, Retzlaff J, Kraff MC. J Cataract Refract Surg 1988 (SRK II).",
    oxford_knee:"Dawson J, et al. J Bone Joint Surg Br 1998;80(1):63–9 (Oxford Knee Score).",
    oxford_hip:"Dawson J, et al. J Bone Joint Surg Br 1996;78(2):185–90 (Oxford Hip Score).",
    quickdash:"Beaton DE, et al. J Bone Joint Surg Am 2005 (QuickDASH).",
    dn4:"Bouhassira D, et al. Pain 2005;114(1–2):29–36 (DN4).",
    phq15:"Kroenke K, et al. Psychosom Med 2002;64(2):258–66 (PHQ-15).",
    framingham:"D'Agostino RB, et al. Circulation 2008;117(6):743–53 (General CVD risk).",
    epvs:"Duarte K, et al. JACC Heart Fail 2015;3(11):886–93 (ePVS).",
    frail_scale:"Morley JE, et al. J Nutr Health Aging 2012;16(7):601–8 (FRAIL).",
    tug:"Podsiadlo D, Richardson S. J Am Geriatr Soc 1991;39(2):142–8 (TUG).",
    prisma7:"Raîche M, et al. Arch Gerontol Geriatr 2008;47(1):9–18 (PRISMA-7).",
    gds30:"Yesavage JA, et al. J Psychiatr Res 1982;17(1):37–49 (GDS).",
    cdr:"Morris JC. Neurology 1993;43(11):2412–4 (Clinical Dementia Rating)."
  };
  CALCS.forEach(function(c){ c.ref=REF[c.id]||""; });

  /* ====================================================================== *
   * RENDERING — full-screen browser overlay + per-calculator panel
   * ====================================================================== */
  var CAT_ORDER = ["Cardiovascular","Critical care","Infectious disease","Renal","Hepatology","Neurology","Respiratory","Endocrine","Gastroenterology","Haematology","Oncology","Rheumatology","Musculoskeletal","Dermatology","Psychiatry","Paediatrics","Obstetrics","Ophthalmology","Toxicology","General"];
  // Category → shared line-icon NAME (window.ICONS catalog). Each calculator inherits its
  // category's icon (no per-calc emoji). Replaces the old emoji map for a consistent, pro look.
  var CAT_ICON = { "Cardiovascular":"heart","Critical care":"siren","Infectious disease":"microbe","Renal":"kidney","Hepatology":"liver","Neurology":"brain","General":"scales","Respiratory":"lungs","Endocrine":"endocrine","Gastroenterology":"stomach","Haematology":"droplet","Oncology":"ribbon","Rheumatology":"joint","Musculoskeletal":"bone","Dermatology":"skin","Psychiatry":"psych","Paediatrics":"baby","Obstetrics":"pregnant","Ophthalmology":"eye","Toxicology":"skull" };
  // Icon accessor — guarded for load order; falls back to empty string (never a crash / emoji).
  function mcIco(name, cls){ return (window.ICONS && ICONS.get) ? ICONS.get(name, cls || "mc-ico") : ""; }
  function mcCatIco(cat, cls){ return mcIco(CAT_ICON[cat] || "calc", cls); }
  // Guarantee every category actually used by a calculator appears (CAT_ORDER sets priority;
  // any not listed above are appended). Without this, calcs in an unlisted category are silently
  // absent from the list AND search. Future-proof: a brand-new category auto-appears at the end.
  (function(){ var seen={}; CAT_ORDER.forEach(function(c){ seen[c]=1; }); CALCS.forEach(function(c){ if(c.cat && !seen[c.cat]){ seen[c.cat]=1; CAT_ORDER.push(c.cat); } }); })();
  var root = null, q = "", activeCat = "", openId = null, favOnly = false;
  var _resultCb = null, _resultCbId = null, _suppressCb = false;   // opener write-back: fired on an explicit Calculate (see open()/run())

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
        '<input id="mcSearch" class="mc-search" type="text" placeholder="Search calculators (e.g. MELD, sepsis, sodium, stroke)…" autocomplete="off">'+
        '<div id="mcCats" class="mc-cats"></div>'+
        '<div id="mcList" class="mc-list"></div>'+
        '<button id="mcInteractionsBtn" class="mc-cat" style="margin-top:14px;width:100%;box-sizing:border-box;text-align:center">'+mcIco("interact")+' Check Drug Interactions</button>'+
        '<div class="mc-disc">'+mcIco("warn")+' Decision-support only — not a substitute for clinical judgement. These tools are AI-generated and not yet clinician-verified: confirm every formula, threshold and result against the individual patient and your local protocol. Copyright-restricted instruments (e.g. DLQI, MNA-SF, Clinical Frailty Scale, BASDAI/BASFI) must be administered using the official questionnaire from the rights-holder — this app only interprets the score.</div>'+
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#mcClose").addEventListener("click", close);
    root.querySelector("#mcInteractionsBtn").addEventListener("click", openInteractions);
    var si=root.querySelector("#mcSearch");
    si.addEventListener("input", function(){ q=si.value.trim().toLowerCase(); renderList(); });
    si.addEventListener("keydown", function(e){ e.stopPropagation(); });
    return root;
  }

  function renderCats(){
    var el=root.querySelector("#mcCats");
    // Starred chip: quick-access to the calculators the user has starred (same list the Apple Watch
    // uses — smd_watch_calc_favs), so no need to search every time. Toggles a favourites-only view.
    var nFav=watchFavs().length;
    var chips=['<button class="mc-cat mc-cat-fav'+(favOnly?" on":"")+'" data-favchip="1" aria-pressed="'+(favOnly?"true":"false")+'">'+mcIco("star")+' Starred'+(nFav?' <span>'+nFav+'</span>':'')+'</button>'];
    chips.push('<button class="mc-cat'+((!favOnly&&activeCat==="")?" on":"")+'" data-cat="">All</button>');
    CAT_ORDER.forEach(function(c){
      var n=CALCS.filter(function(x){return x.cat===c;}).length;
      chips.push('<button class="mc-cat'+((!favOnly&&activeCat===c)?" on":"")+'" data-cat="'+esc(c)+'">'+mcCatIco(c)+" "+esc(c)+' <span>'+n+'</span></button>');
    });
    el.innerHTML=chips.join("");
    var favBtn=el.querySelector("[data-favchip]");
    if(favBtn) favBtn.addEventListener("click", function(){ favOnly=!favOnly; openId=null; renderCats(); renderList(); });
    el.querySelectorAll(".mc-cat[data-cat]").forEach(function(b){
      b.addEventListener("click", function(){ favOnly=false; activeCat=b.getAttribute("data-cat"); openId=null; renderCats(); renderList(); });
    });
  }

  function matches(c){
    if(favOnly && !isWatchFav(c.id)) return false;      // Starred chip → favourites-only (spans all categories)
    if(!favOnly && activeCat && c.cat!==activeCat) return false;
    if(!q) return true;
    return (c.title+" "+c.desc+" "+c.cat+" "+c.id+" "+(c.kw||[]).join(" ")).toLowerCase().indexOf(q)>=0;
  }

  // Apple Watch favourites: which calculators to relay to the wrist. Stored as a
  // localStorage id list; toggling triggers an immediate watch re-sync (native only).
  function watchFavs(){ try{ var a=JSON.parse(localStorage.getItem("smd_watch_calc_favs")||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
  function isWatchFav(id){ return watchFavs().indexOf(id)>=0; }
  function toggleWatchFav(id){
    var a=watchFavs(), i=a.indexOf(id);
    if(i>=0) a.splice(i,1); else a.push(id);
    try{ localStorage.setItem("smd_watch_calc_favs", JSON.stringify(a)); }catch(e){}
    try{ if(window.SMD_APPLE_WATCH_SYNC) window.SMD_APPLE_WATCH_SYNC(); }catch(e){}
  }

  function renderList(){
    var el=root.querySelector("#mcList");
    var list=CALCS.filter(matches);
    if(!list.length){ el.innerHTML='<div class="mc-empty">'+(favOnly&&!q&&!watchFavs().length?'No starred calculators yet — tap the '+mcIco("star")+' on any calculator to pin it here (and to your Apple Watch).':'No calculators match “'+esc(q)+'”.')+'</div>'; return; }
    // group by category preserving order
    var html="";
    CAT_ORDER.forEach(function(cat){
      var inCat=list.filter(function(c){return c.cat===cat;});
      if(!inCat.length) return;
      html+='<div class="mc-grp-h">'+mcCatIco(cat)+" "+esc(cat)+'</div><div class="mc-grid">';
      inCat.forEach(function(c){
        var favOn=isWatchFav(c.id);
        html+='<div class="mc-card'+(openId===c.id?" open":"")+'" data-id="'+c.id+'" style="position:relative">'+
          '<button data-fav="'+c.id+'" aria-label="'+(favOn?"Remove from":"Add to")+' Apple Watch" title="Show on Apple Watch" style="position:absolute;top:6px;right:8px;background:none;border:none;cursor:pointer;color:'+(favOn?"#e0a800":"#c2c2c2")+';z-index:2;padding:2px;line-height:0">'+mcIco("star","mc-fav"+(favOn?" on":""))+'</button>'+
          '<button class="mc-card-head" data-open="'+c.id+'" style="padding-right:34px"><span class="mc-ic">'+mcCatIco(c.cat)+'</span><span class="mc-card-main"><span class="mc-card-t">'+esc(c.title)+'</span><span class="mc-card-d">'+esc(c.desc)+'</span></span><span class="mc-chev">'+(openId===c.id?"▾":"▸")+'</span></button>'+
          (openId===c.id?'<div class="mc-panel" id="mcPanel_'+c.id+'"></div>':"")+
        '</div>';
      });
      html+='</div>';
    });
    el.innerHTML=html;
    el.querySelectorAll("[data-open]").forEach(function(b){
      b.addEventListener("click", function(){ var id=b.getAttribute("data-open"); openId=(openId===id?null:id); renderList(); });
    });
    el.querySelectorAll("[data-fav]").forEach(function(b){
      b.addEventListener("click", function(ev){ ev.stopPropagation(); toggleWatchFav(b.getAttribute("data-fav")); renderList(); });
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
        // First listed option is the default (browser-native). Author responsibility: order each
        // select so the FIRST option is the clinically-sensible default (normal band for additive
        // severity scores; best/alert for inverted coma/functional scales).
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

  /* ---- Ward Sync / imported-report auto-fill (gold136) --------------------
   * A calculator input can opt in with a `lab:"<analyte>"` hint. The auto-fill
   * bar then pulls that value from the selected patient's Ward Sync (GHIS) labs,
   * or from a photo/PDF report already imported into the ICU dashboard. Every
   * value is prefilled AND attributed to its source; the clinician verifies
   * before relying on the result (decision support only). Test-name matching
   * mirrors the exclusion-guarded map in icu.js to avoid dangerous mis-files. */
  var LAB_RX = {
    bili:  { kw:/bilirubin/i, ex:/direct|indirect|conjugat|neonat/i },   // total only
    pt:    { kw:/prothrombin|(^|[^a-z])pt([^a-z]|$|\/)/i, ex:/aptt|partial|activated|control/i, unit:/sec/i },
    ptctrl:{ kw:/\bcontrol\b/i, ex:/internal|quality|\bqc\b|glyc/i, unit:/sec/i },   // explicit "CONTROL." row in the PT/INR panel (seconds)
    inr:   { kw:/\binr\b/i, ex:null },
    creat: { kw:/creatinine/i, ex:/urin|clearance|ratio/i },
    na:    { kw:/\bsodium\b|serum na\b/i, ex:/urin|spot|fractional|excretion/i },
    k:     { kw:/\bpotassium\b|serum k\b/i, ex:/urin/i },
    cl:    { kw:/\bchloride\b/i, ex:/urin/i },
    hco3:  { kw:/bicarbonate|\bhco3\b|\btco2\b|carbon dioxide/i, ex:/partial|pco2|paco2/i },
    ca:    { kw:/\bcalcium\b/i, ex:/urin|ioni|24/i },                   // total; ionised tracked elsewhere
    glu:   { kw:/glucose|blood sugar|\brbs\b|\bfbs\b|\bcbg\b/i, ex:/urin|csf|tolerance|dipsi/i },
    bun:   { kw:/blood urea nitrogen|\bbun\b/i, ex:/urin/i },           // BUN only — NOT plain "Urea" (scale differs ~2.14x)
    alb:   { kw:/\balbumin\b/i, ex:/globulin|ratio|urin|micro/i },
    ast:   { kw:/\bast\b|sgot|aspartate/i, ex:null },
    alt:   { kw:/\balt\b|sgpt|alanine/i, ex:null },
    wbc:   { kw:/\bwbc\b|leucocyte|leukocyte|total leu|\btlc\b/i, ex:/differential|urin|csf/i },
    hb:    { kw:/haemoglobin|hemoglobin/i, ex:/corpuscular|\bmch\b|\bmchc\b|a1c|glycated|glycosylated|equivalent|reticulocyte/i },
    hct:   { kw:/h[ae]matocrit|\bpcv\b|packed cell/i, ex:null },
    plt:   { kw:/platelet/i, ex:/immature|fraction/i },
    mcv:   { kw:/\bmcv\b|mean corpuscular volume|mean cell volume/i, ex:null },
    rbc:   { kw:/\brbc\b|red blood cell count|red cell count|total rbc/i, ex:/width|\brdw\b|nucleated|\bmch\b|distribution/i },
    retic: { kw:/reticulocyte/i, ex:/absolute|immature|equivalent|fraction|index|h[ae]moglobin/i },   // Reticulocyte % only
    iron:  { kw:/serum iron|\biron\b/i, ex:/binding|tibc|\buibc\b|saturation|ferritin/i },
    tibc:  { kw:/\btibc\b|total iron.?binding/i, ex:/\buibc\b|unsaturated/i },
    a1c:   { kw:/hba1c|glycated h|glycosylated h|\ba1c\b/i, ex:/estimated|\beag\b/i },
    chol:  { kw:/total cholesterol|cholesterol.*total|\btc\b/i, ex:/hdl|ldl|non.?hdl|ratio|vldl/i },
    hdl:   { kw:/\bhdl\b/i, ex:/non.?hdl|ratio/i },
    tg:    { kw:/triglyceride/i, ex:null }
  };
  function num(x){ var n=parseFloat(x); return isNaN(n)?null:n; }
  // Unit normalisation for count analytes whose calculator field expects ×10⁹/L.
  // The live GHIS lab reports platelets in "Lakhs/cumm" (e.g. 2.5 → 250 ×10⁹/L)
  // and WBC as an absolute "/cumm" count (e.g. 8000 → 8 ×10⁹/L), so the raw number
  // must be scaled or the score would be wildly wrong. Microscopy units ("hpf" —
  // urine leucocytes/RBCs) have no valid conversion and are rejected.
  var UNIT_FIX = {
    plt: [ {rx:/lakh/i, f:100}, {rx:/10\s*\^?\s*9|×?10⁹|10e9|g\/l/i, f:1}, {rx:/cumm|cmm|cell|\/[uµ]l|mm\s*3|mm³/i, f:0.001} ],
    wbc: [ {rx:/10\s*\^?\s*9|×?10⁹|10e9|g\/l/i, f:1}, {rx:/cumm|cmm|cell|\/[uµ]l|mm\s*3|mm³/i, f:0.001} ]
  };
  // Returns {value, unit, note} after unit fix, or null if the unit can't be
  // reconciled to the calculator's expected scale (→ leave the field for manual entry).
  function fixUnit(key, value, rawUnit){
    var rules=UNIT_FIX[key];
    if(!rules) return { value:value, unit:rawUnit||"", note:"" };
    var u=String(rawUnit||"");
    if(/hpf/i.test(u)) return null;                         // urine microscopy — not a blood count
    for(var i=0;i<rules.length;i++){ if(rules[i].rx.test(u)){
      if(rules[i].f===1) return { value:value, unit:"×10⁹/L", note:"" };
      return { value:Math.round(value*rules[i].f*10)/10, unit:"×10⁹/L", note:"converted from "+u };
    }}
    return null;                                            // unknown unit for a count analyte — don't guess
  }
  // Rows are newest-first; first usable hit for each analyte wins. Returns
  // { <analyte>: {value, units, order, date, derived?, note?} }.
  function extractAnalytes(rows){
    var out={}, ptLo=null, ptHi=null, ptRange="", ptUnit="";
    (rows||[]).forEach(function(r){
      var name=String(r.test||"");
      Object.keys(LAB_RX).forEach(function(key){
        if(out[key]!=null) return;
        var m=LAB_RX[key];
        if(!m.kw.test(name)) return;
        if(m.ex && m.ex.test(name)) return;
        // PT-in-seconds (and its CONTROL) must carry a "sec" unit — in the units
        // column or the name — so they are never confused with the unitless INR row.
        if(m.unit && !(r.units && m.unit.test(String(r.units))) && !m.unit.test(name)) return;
        var v=num(r.result); if(v==null) return;
        var fx=fixUnit(key, v, r.units);
        if(!fx) return;   // incompatible unit (e.g. urine hpf, unknown count scale) — keep scanning
        out[key]={ value:fx.value, units:fx.unit||r.units||"", order:r.order||"", date:r.date||"", note:fx.note||"" };
        if(key==="pt"){ ptLo=num(r.low); ptHi=num(r.high); ptRange=r.range||""; ptUnit=r.units||"sec"; }
      });
    });
    // Control PT: prefer the explicit "CONTROL" row captured above; only if the lab
    // reports no control fall back to the Patient-PT reference-range midpoint.
    if(out.ptctrl==null && ptLo!=null && ptHi!=null)
      out.ptctrl={ value:Math.round(((ptLo+ptHi)/2)*10)/10, units:ptUnit, order:"ref-range midpoint "+(ptRange||(ptLo+"–"+ptHi)), derived:true };
    return out;
  }
  function calcLabKeys(c){ var s={}; c.inputs.forEach(function(f){ if(f.lab && f.type==="number") s[f.lab]=1; }); return Object.keys(s); }
  function calcHasLab(c){ return c.inputs.some(function(f){ return (f.lab && f.type==="number") || f.demo; }); }
  // Write values into the calculator's inputs. Lab analytes: Ward Sync wins, then a
  // photo/PDF imported value (ICU dashboard) when Ward has none. Demographics
  // (demo:"age"|"sex") come from the selected patient / ICU patient. Everything is
  // attributed and left for the clinician to verify.
  function fillFields(c, analytes, photoRec, demo){
    var filled=[], missing=[];
    demo=demo||{};
    c.inputs.forEach(function(f){
      var inp=document.getElementById("mc_"+c.id+"_"+f.id); if(!inp) return;
      // demographics (age number / sex select) from the patient record
      if(f.demo==="age" && f.type==="number"){
        if(demo.age!=null && !isNaN(parseFloat(demo.age))){ inp.value=parseFloat(demo.age); filled.push({ label:f.label, val:parseFloat(demo.age), units:"yrs", src:demo.src||"Patient" }); }
        else missing.push(f.label);
        return;
      }
      if(f.demo==="sex" && f.type==="select"){
        var ch=String(demo.sex||"").trim().toLowerCase().charAt(0);   // 'm' / 'f'
        var opt=ch && Array.prototype.slice.call(inp.options).filter(function(o){ return o.value.toLowerCase()===ch; })[0];
        if(opt){ inp.value=opt.value; filled.push({ label:f.label, val:opt.textContent, units:"", src:demo.src||"Patient" }); }
        else missing.push(f.label);
        return;
      }
      if(!f.lab || f.type!=="number") return;
      var got=analytes && analytes[f.lab];
      if(got && got.value!=null){
        inp.value=got.value;
        var src=got.derived?"Ward · "+(got.order||"ref-range"):"Ward Sync"+(got.order?" · "+got.order:"");
        if(got.note) src+=" · "+got.note;
        filled.push({ label:f.label, val:got.value, units:got.units, src:src });
      } else if(photoRec && photoRec[f.lab]!=null && !isNaN(parseFloat(photoRec[f.lab]))){
        inp.value=parseFloat(photoRec[f.lab]);
        filled.push({ label:f.label, val:parseFloat(photoRec[f.lab]), units:"", src:"Imported report" });
      } else { missing.push(f.label); }
    });
    return { filled:filled, missing:missing };
  }
  function afNoteRows(r){
    var h="";
    if(r.filled.length) h+='<div class="mc-af-ok">'+r.filled.map(function(x){ return mcIco("check")+' '+esc(x.label)+': <b>'+esc(x.val)+'</b>'+(x.units?" "+esc(x.units):"")+' <span>'+esc(x.src)+'</span>'; }).join("")+'</div>';
    if(r.missing.length) h+='<div class="mc-af-miss">Not found — enter manually: '+r.missing.map(esc).join(", ")+'</div>';
    if(!r.filled.length && !r.missing.length) h+='<div class="mc-af-miss">No matching lab values found for this patient.</div>';
    return h;
  }
  // Wire the auto-fill bar for one calculator panel. `run` recomputes the result.
  function wireAutofill(c, run){
    var btn=document.getElementById("mcAFbtn_"+c.id), body=document.getElementById("mcAFbody_"+c.id);
    if(!btn||!body) return;
    var open=false;
    function photo(){ return window.ICU_STATE && ICU_STATE.labs && ICU_STATE.labs.recent; }
    function photoName(){ return (window.ICU_STATE && ICU_STATE.patient && ICU_STATE.patient.name) || ""; }
    function photoHasNeeds(){ var p=photo(); if(!p) return false; return calcLabKeys(c).some(function(k){ return p[k]!=null && !isNaN(parseFloat(p[k])); }); }
    function photoBtnHTML(){ return photoHasNeeds()?'<button class="mc-af-photo" id="mcAFph_'+c.id+'">'+mcIco("camera")+' Use last imported report'+(photoName()?' ('+esc(photoName())+')':'')+'</button>':""; }
    function wirePhotoBtn(){
      var b=document.getElementById("mcAFph_"+c.id); if(!b) return;
      b.addEventListener("click", function(){
        var pt=(window.ICU_STATE && ICU_STATE.patient)||{};
        var r=fillFields(c, {}, photo(), { age:pt.age, sex:pt.sex, src:"Imported" }); run();
        body.innerHTML='<div class="mc-af-note"><div class="mc-af-note-h">'+mcIco("camera")+' From imported report'+(photoName()?' · '+esc(photoName()):'')+'</div>'+afNoteRows(r)+'<div class="mc-af-verify">'+mcIco("warn")+' Verify against the source report before relying on the result.</div></div>';
      });
    }
    function pick(p){
      if(!p||!window.GHIS||!GHIS.fetchLabTests) return;
      body.innerHTML='<div class="mc-af-msg">Fetching labs for <b>'+esc(p.patientFirstName||p.patientId)+'</b>…</div>';
      GHIS.fetchLabTests(p.patientId).then(function(rows){
        var ageP=parseInt(p.dob,10);
        var demo={ age:(!isNaN(ageP)&&ageP>0&&ageP<130)?ageP:null, sex:p.gender, src:"Ward Sync" };
        var r=fillFields(c, extractAnalytes(rows), photo(), demo); run();
        body.innerHTML='<div class="mc-af-note"><div class="mc-af-note-h">'+mcIco("cloud")+' '+esc(p.patientFirstName||p.patientId)+' · Ward Sync</div>'+afNoteRows(r)+'<div class="mc-af-verify">'+mcIco("warn")+' Auto-filled from the hospital record — verify each value before relying on the result.</div></div>';
      }).catch(function(){ body.innerHTML='<div class="mc-af-msg">Couldn’t fetch labs — check the Ward Sync connection and try again.</div>'; });
    }
    function renderPicker(){
      var connected = window.GHIS && GHIS.isConnected && GHIS.isConnected();
      if(!connected){
        body.innerHTML='<div class="mc-af-msg">Ward Sync isn’t connected. Open '+mcIco("hospital")+' <b>Ward</b> and sign in to fetch a patient’s labs.<button class="mc-af-open" id="mcAFopen_'+c.id+'">Open Ward Sync</button></div>'+photoBtnHTML();
        var o=document.getElementById("mcAFopen_"+c.id); if(o) o.addEventListener("click", function(){ try{ window.openGHIS && openGHIS(); }catch(e){} });
        wirePhotoBtn(); return;
      }
      var pts = (GHIS.getPatients && GHIS.getPatients()) || [];
      body.innerHTML='<input class="mc-af-search" id="mcAFq_'+c.id+'" placeholder="Select patient — name or ID…" autocomplete="off"><div class="mc-af-list" id="mcAFlist_'+c.id+'"></div>'+photoBtnHTML();
      var q=document.getElementById("mcAFq_"+c.id);
      q.addEventListener("keydown", function(e){ e.stopPropagation(); });
      q.addEventListener("input", function(){ list(q.value); });
      wirePhotoBtn();
      function list(term){
        term=(term||"").toLowerCase().trim();
        var f=pts.filter(function(p){ return !term || String(p.patientFirstName||"").toLowerCase().indexOf(term)>=0 || String(p.patientId||"").toLowerCase().indexOf(term)>=0; }).slice(0,40);
        var lst=document.getElementById("mcAFlist_"+c.id);
        if(!f.length){ lst.innerHTML='<div class="mc-af-empty">No patients — refresh Ward Sync.</div>'; return; }
        lst.innerHTML=f.map(function(p){ return '<button class="mc-af-pt" data-i="'+pts.indexOf(p)+'"><b>'+esc(p.patientFirstName||"—")+'</b><span>· '+esc(p.patientId||"")+(p.deptDescription?" · "+esc(p.deptDescription):"")+'</span></button>'; }).join("");
        lst.querySelectorAll(".mc-af-pt").forEach(function(b){ b.addEventListener("click", function(){ pick(pts[+b.getAttribute("data-i")]); }); });
      }
      list("");
    }
    btn.addEventListener("click", function(){ open=!open; btn.classList.toggle("on", open); if(!open){ body.innerHTML=""; } else renderPicker(); });
  }

  function renderPanel(id){
    var c=byId(id); if(!c) return;
    var el=document.getElementById("mcPanel_"+id); if(!el) return;
    var hasLab=calcHasLab(c);
    el.innerHTML=
      (hasLab?'<div class="mc-af"><button class="mc-af-btn" id="mcAFbtn_'+id+'">'+mcIco("flask")+' Auto-fill labs from patient</button><div class="mc-af-body" id="mcAFbody_'+id+'"></div></div>':"")+
      '<div class="mc-inputs">'+inputHTML(c)+'</div>'+
      '<button class="mc-calc-btn" id="mcCalc_'+id+'">Calculate</button>'+
      '<div class="mc-result" id="mcRes_'+id+'"></div>'+
      (c.ref?'<div class="mc-ref">'+mcIco("book")+' <b>Reference:</b> '+esc(c.ref)+'</div>':"");
    function run(fromBtn){
      var out; try { out=c.compute(readValues(c)); } catch(e){ out={err:"Could not compute — check the inputs."}; }
      var res=document.getElementById("mcRes_"+id);
      if(!out){ res.innerHTML=""; return; }
      if(out.err){ res.innerHTML='<div class="mc-res-err">'+esc(out.err)+'</div>'; return; }
      try { if (window.SMD_KU) SMD_KU.emit("calc", id); } catch(e){}   // KU: used a calculator (deduped per day server-side)
      if(out.html){ res.innerHTML=out.html; return; }
      res.innerHTML='<div class="mc-res-box"><div class="mc-res-num">'+esc(out.v)+(out.u?' <small>'+esc(out.u)+'</small>':"")+'</div>'+(out.i?'<div class="mc-res-i">'+out.i+'</div>':"")+'</div>';
      // Write-back: report a scalar result to the opener ONLY on an explicit user Calculate (fromBtn),
      // never on the auto-prefill click (_suppressCb) or per-keystroke change.
      if(fromBtn && !_suppressCb && _resultCb && id===_resultCbId){ try { _resultCb(id, out); } catch(e){} }
    }
    el.querySelector("#mcCalc_"+id).addEventListener("click", function(){ run(true); });
    el.querySelectorAll(".mc-input").forEach(function(inp){
      inp.addEventListener("keydown", function(e){ e.stopPropagation(); if(e.key==="Enter") run(true); });
    });
    // auto-calc on change for instant feedback (no write-back)
    el.querySelectorAll(".mc-input, .mc-check input").forEach(function(inp){
      inp.addEventListener("change", function(){ run(false); });
    });
    if(hasLab) wireAutofill(c, function(){ run(false); });
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
  // Prefill a calculator's inputs from a {inputId:value} map, then compute.
  // Values must match the input type: checkbox->boolean, select->option value
  // (exact string), number->number. Unknown/blank/NaN values are skipped.
  function applyPrefill(id, prefill){
    var c=byId(id); if(!c || !prefill || typeof prefill!=="object") return;
    c.inputs.forEach(function(f){
      if(!Object.prototype.hasOwnProperty.call(prefill, f.id)) return;
      var val=prefill[f.id];
      if(val==null || (typeof val==="number" && isNaN(val))) return;
      var el=document.getElementById("mc_"+c.id+"_"+f.id);
      if(!el) return;
      if(f.type==="check") el.checked=!!val;
      else el.value=String(val);
    });
    var btn=document.getElementById("mcCalc_"+id);
    if(btn){ _suppressCb=true; try { btn.click(); } finally { _suppressCb=false; } }   // render the prefilled result WITHOUT reporting it back — only an explicit user Calculate writes to the opener
  }
  // open(id, prefill, onResult): onResult(scoreId, out) is called when the user hits Calculate, so
  // an opener (e.g. the ICU dashboard) can store the computed result back on the patient.
  function open(id, prefill, onResult){
    _resultCb = (typeof onResult === "function") ? onResult : null; _resultCbId = _resultCb ? id : null;
    openList();
    var c=byId(id); if(!c) return;
    activeCat=""; openId=id; renderCats(); renderList();
    if(prefill) applyPrefill(id, prefill);
    setTimeout(function(){ var el=document.getElementById("mcPanel_"+id); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); }, 80);
  }
  function close(){ _resultCb=null; _resultCbId=null; if(root){ root.classList.remove("on"); document.body.classList.remove("mc-lock"); } }

  /* ---- Drug Interactions entry point (Tools) — delegates to drugs.js's
     window.MEDDRUGS.openInteractions, the single shared MEDLIST overlay (Task 5/6). ---- */
  function openInteractions(){
    if(window.MEDDRUGS && window.MEDDRUGS.openInteractions) window.MEDDRUGS.openInteractions();
  }

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
      ".mc-ic{font-size:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center}",
      ".mc-ico{width:15px;height:15px;vertical-align:-2px;display:inline-block;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      ".mc-fav{width:17px;height:17px;display:block;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round}",
      ".mc-fav.on{fill:currentColor;stroke:currentColor}",
      ".mc-ic svg{width:22px;height:22px;color:var(--teal,#0a9396)}",
      ".mc-cat svg,.mc-grp-h svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px}",
      ".mc-grp-h svg{color:var(--teal,#0a9396)}",
      ".mc-ref svg,.mc-af-btn svg,.mc-af-note-h svg,.mc-af-verify svg,.mc-af-ok svg,.mc-af-photo svg,.mc-af-msg svg,.mc-disc svg,#mcInteractionsBtn svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px;flex:0 0 auto}",
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
      ".mc-ref b{color:var(--slate,#555);font-weight:700}",
      /* Ward Sync / imported-report auto-fill */
      ".mc-af{margin:12px 0 2px;border:1px dashed var(--teal,#0a9396);border-radius:11px;background:var(--teal-soft,#e0f2f1);padding:8px}",
      ".mc-af-btn{width:100%;border:none;border-radius:8px;padding:9px 11px;font:800 12.5px var(--sans,system-ui);cursor:pointer;color:#fff;background:var(--teal,#0a9396)}",
      ".mc-af-btn.on{background:var(--slate,#555)}",
      ".mc-af-body:not(:empty){margin-top:8px}",
      ".mc-af-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:8px;padding:9px 11px;font:500 13px var(--sans,system-ui);background:var(--panel,#fff);color:var(--ink,#1a1a1a)}",
      ".mc-af-search:focus{outline:none;border-color:var(--teal,#0a9396)}",
      ".mc-af-list{max-height:240px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:7px;display:flex;flex-direction:column;gap:5px}",
      ".mc-af-pt{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;text-align:left;width:100%;border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:9px 11px;background:var(--panel,#fff);color:var(--ink,#1a1a1a);cursor:pointer;font:600 13px var(--sans,system-ui)}",
      ".mc-af-pt:hover{border-color:var(--teal,#0a9396)}",
      ".mc-af-pt span{font-weight:500;font-size:11.5px;color:var(--slate-soft,#888)}",
      ".mc-af-empty,.mc-af-msg{font:500 12.5px var(--sans,system-ui);color:var(--slate,#555);padding:9px 4px;line-height:1.5}",
      ".mc-af-open,.mc-af-photo{display:block;width:100%;margin-top:8px;border:1px solid var(--teal,#0a9396);border-radius:8px;padding:9px;font:700 12px var(--sans,system-ui);cursor:pointer;color:var(--teal,#0a9396);background:var(--panel,#fff)}",
      ".mc-af-note{font:500 12px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.55}",
      ".mc-af-note-h{font-weight:800;color:var(--teal,#0a9396);margin-bottom:5px}",
      ".mc-af-ok{display:flex;flex-direction:column;gap:3px}",
      ".mc-af-ok b{color:var(--teal,#0a9396)}",
      ".mc-af-ok span{color:var(--slate-soft,#888);font-size:10.5px}",
      ".mc-af-miss{color:#b45309;margin-top:6px}",
      ".mc-af-verify{margin-top:7px;font-size:10.5px;color:var(--slate-soft,#888)}"
    ].join("");
    var st=document.createElement("style"); st.id="mc-styles"; st.textContent=css; document.head.appendChild(st);
  }

  window.MEDCALC = { openList: openList, open: open, close: close, openInteractions: openInteractions, _calcs: CALCS };
})();
