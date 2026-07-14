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
  { id:"meld3", cat:"Hepatology", icon:"🩺", title:"MELD 3.0",
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
  { id:"egfr_cysc", cat:"Renal", icon:"🩺", title:"eGFR (cystatin C, CKD-EPI)",
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
  { id:"burch", cat:"Endocrine", icon:"🦋", title:"Burch-Wartofsky (thyroid storm)",
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
  { id:"rumack", cat:"Toxicology", icon:"💊", title:"Rumack-Matthew (paracetamol)",
    desc:"Is the paracetamol (acetaminophen) level above the NAC treatment line? Single acute ingestion, 4–24 h.",
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
      var line = 150 * Math.pow(2, -(t-4)/4);   // 150 µg/mL at 4 h, t½≈4 h (UK/US treatment line, 25% below the original 200 line)
      var treat = lvl >= line;
      return { v:Math.round(line), u:"µg/mL (line at "+t+" h)", i: treat
        ? "<b>Level "+lvl+" ≥ line ("+line.toFixed(0)+") — ABOVE the treatment line: start N-acetylcysteine.</b>"
        : "Level "+lvl+" &lt; line ("+line.toFixed(0)+") — below the treatment line. Treat anyway if staggered/unknown-time ingestion or clinical concern." };
    }
  },
  { id:"scorten", cat:"Dermatology", icon:"🩹", title:"SCORTEN (SJS/TEN)",
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
  { id:"kings", cat:"Hepatology", icon:"🩺", title:"King's College criteria (ALF)",
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
  { id:"psi", cat:"Respiratory", icon:"🫁", title:"PSI / PORT (pneumonia)",
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
      { id:"cardio", label:"Cardiovascular (pressor µg/kg/min)", type:"select", opts:[{v:"0",t:"MAP ≥70 (0)"},{v:"1",t:"MAP <70, no pressor (1)"},{v:"2",t:"Dopamine ≤5 or any dobutamine (2)"},{v:"3",t:"Dopamine >5, or epi ≤0.1, or norepi ≤0.1 (3)"},{v:"4",t:"Dopamine >15, or epi >0.1, or norepi >0.1 (4)"}] },
      { id:"cns", label:"CNS (GCS)", type:"select", opts:[{v:"0",t:"15 (0)"},{v:"1",t:"13–14 (1)"},{v:"2",t:"10–12 (2)"},{v:"3",t:"6–9 (3)"},{v:"4",t:"<6 (4)"}] },
      { id:"renal", label:"Renal (creatinine mg/dL)", type:"select", opts:[{v:"0",t:"<1.2 (0)"},{v:"1",t:"1.2–1.9 (1)"},{v:"2",t:"2.0–3.4 (2)"},{v:"3",t:"3.5–4.9 (3)"},{v:"4",t:"≥5.0 (4)"}] }
    ],
    compute:function(v){
      var s=Number(v.resp)+Number(v.coag)+Number(v.liver)+Number(v.cardio)+Number(v.cns)+Number(v.renal);
      var mort=band(s,[[6,"predicted hospital mortality <10%"],[9,"~15–20%"],[12,"~40–50%"],[14,"~50–60%"],[24,"~80% or higher"]]);
      return { v:s, u:"/24", i:mort+". Trend (ΔSOFA over 24–48 h) predicts outcome better than a single reading; an acute rise of ≥2 from baseline with suspected infection defines sepsis (Sepsis-3)." };
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

  { id:"winters", cat:"Critical care", icon:"🌡️", title:"Winter's formula",
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

  { id:"osm", cat:"Critical care", icon:"💧", title:"Serum osmolality & gap",
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

  { id:"parkland", cat:"Critical care", icon:"🔥", title:"Parkland (burns)",
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

  { id:"ckdepi", cat:"Renal", icon:"🫘", title:"eGFR (CKD-EPI 2021)",
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

  { id:"mdrd", cat:"Renal", icon:"🫘", title:"eGFR (MDRD, race-free)",
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

  { id:"fena", cat:"Renal", icon:"💧", title:"FENa",
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

  { id:"feurea", cat:"Renal", icon:"💧", title:"FEUrea",
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
      return { v:r1(fe), u:"%", i:(fe<35?"<35% → pre-renal.":">50% → intrinsic (ATN).")+" More reliable than FENa when diuretics have been given." };
    } },

  { id:"corr_na", cat:"Renal", icon:"🧂", title:"Corrected Na (hyperglycaemia)",
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

  { id:"fw_deficit", cat:"Renal", icon:"🚰", title:"Free water deficit",
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

  { id:"na_deficit", cat:"Renal", icon:"🧂", title:"Sodium deficit (hyponatraemia)",
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

  { id:"corr_ca", cat:"Renal", icon:"🦴", title:"Corrected calcium",
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
      { id:"pt", label:"Patient PT", type:"number", unit:"sec", lab:"pt" },
      { id:"ctrl", label:"Control PT", type:"number", unit:"sec", lab:"ptctrl" },
      { id:"bili", label:"Bilirubin", type:"number", unit:"mg/dL", step:"0.1", lab:"bili" }
    ],
    compute:function(v){
      if(!ok(v.pt)||!ok(v.ctrl)||!ok(v.bili)) return ERR;
      var df=4.6*(v.pt-v.ctrl)+v.bili;
      return { v:r1(df), u:"", i:(df>=32?"≥32 — severe alcoholic hepatitis; high short-term mortality. Consider corticosteroids (assess infection, calculate Lille at day 7).":"<32 — non-severe.") };
    } },

  { id:"fib4", cat:"Hepatology", icon:"🔬", title:"FIB-4 index",
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

  { id:"apri", cat:"Hepatology", icon:"🔬", title:"APRI score",
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
      return { v:Math.round(mos*100)/100, u:"m² (Mosteller)", i:"DuBois = <b>"+(Math.round(du*100)/100)+" m²</b>. Used for chemotherapy and cardiac-index dosing." };
    } },

  { id:"hba1c", cat:"General", icon:"🍬", title:"HbA1c → eAG",
    desc:"Estimated average glucose from HbA1c.",
    inputs:[ { id:"a1c", label:"HbA1c", type:"number", unit:"%", step:"0.1", lab:"a1c" } ],
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
      { id:"retic", label:"Reticulocyte", type:"number", unit:"%", step:"0.1", lab:"retic" },
      { id:"hct", label:"Measured haematocrit", type:"number", unit:"%", lab:"hct" }
    ],
    compute:function(v){
      if(!ok(v.retic)||!ok(v.hct)) return ERR;
      var c=v.retic*(v.hct/45);
      return { v:r1(c), u:"%", i:"Corrected retic <b>"+r1(c)+"%</b>. >2% suggests adequate marrow response (haemolysis/blood loss); <2% suggests hypoproliferation." };
    } },

  { id:"tsat", cat:"General", icon:"🧲", title:"Transferrin saturation",
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

  { id:"phenytoin", cat:"General", icon:"💊", title:"Corrected phenytoin",
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

  { id:"mentzer", cat:"General", icon:"🔴", title:"Mentzer index",
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
  { id:"sirs", cat:"Infectious disease", icon:"🦠", title:"SIRS criteria",
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

  { id:"mascc", cat:"Infectious disease", icon:"🦠", title:"MASCC febrile neutropenia",
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

  { id:"drip", cat:"Infectious disease", icon:"🦠", title:"DRIP score (drug-resistant pneumonia)",
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
  { id:"news2", cat:"Critical care", icon:"🚨", title:"NEWS2 (early warning)",
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

  { id:"padua", cat:"Critical care", icon:"🚨", title:"Padua VTE prediction",
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
  { id:"heart", cat:"Cardiovascular", icon:"🫀", title:"HEART score (chest pain)",
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
  { id:"fourts", cat:"General", icon:"⚖️", title:"4Ts score (HIT)",
    desc:"Pre-test probability of heparin-induced thrombocytopenia.",
    kw:["hit","heparin","thrombocytopenia","platelet","4t"],
    inputs:[
      { id:"thrombo", label:"Thrombocytopenia", type:"select", opts:[{v:"2",t:"Fall >50% & nadir ≥20 (2)"},{v:"1",t:"Fall 30–50% or nadir 10–19 (1)"},{v:"0",t:"Fall <30% or nadir <10 (0)"}] },
      { id:"timing", label:"Timing of platelet fall", type:"select", opts:[{v:"2",t:"Clear onset day 5–10, or ≤1 day if heparin ≤30 d (2)"},{v:"1",t:"Consistent but unclear / onset after day 10 (1)"},{v:"0",t:"Fall <4 days, no recent heparin (0)"}] },
      { id:"thrombosis", label:"Thrombosis / sequelae", type:"select", opts:[{v:"2",t:"New thrombosis, skin necrosis, anaphylaxis (2)"},{v:"1",t:"Progressive/recurrent or erythematous skin (1)"},{v:"0",t:"None (0)"}] },
      { id:"other", label:"Other cause of thrombocytopenia", type:"select", opts:[{v:"2",t:"None apparent (2)"},{v:"1",t:"Possible (1)"},{v:"0",t:"Definite (0)"}] }
    ],
    compute:function(v){
      if(!v.thrombo||!v.timing||!v.thrombosis||!v.other) return ERR;
      var s=(+v.thrombo)+(+v.timing)+(+v.thrombosis)+(+v.other);
      var band = s<=3?"<b>Low</b> (0–3): HIT very unlikely (~&lt;5%).":s<=5?"<b>Intermediate</b> (4–5): ~14% — send HIT antibody, consider stopping heparin.":"<b>High</b> (6–8): ~64% — stop heparin, start non-heparin anticoagulant, test.";
      return { v:s, u:"/8", i:band+" Ref: Lo, Warkentin, J Thromb Haemost 2006." };
    } },

  { id:"lights", cat:"General", icon:"⚖️", title:"Light's criteria (pleural fluid)",
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

  { id:"alvarado", cat:"General", icon:"⚖️", title:"Alvarado score (appendicitis)",
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

  { id:"pitt", cat:"Infectious disease", icon:"🦠", title:"Pitt bacteraemia score",
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

  { id:"rockall", cat:"Critical care", icon:"🚨", title:"Rockall score (UGIB)",
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

  { id:"ciwa", cat:"Neurology", icon:"🧠", title:"CIWA-Ar (alcohol withdrawal)",
    desc:"Severity of alcohol withdrawal; guides symptom-triggered benzodiazepines.",
    kw:["alcohol","withdrawal","ciwa","detox","dts"],
    inputs:[
      { id:"nau", label:"Nausea / vomiting (0–7)", type:"number" },
      { id:"tre", label:"Tremor (0–7)", type:"number" },
      { id:"swe", label:"Paroxysmal sweats (0–7)", type:"number" },
      { id:"anx", label:"Anxiety (0–7)", type:"number" },
      { id:"agi", label:"Agitation (0–7)", type:"number" },
      { id:"tac", label:"Tactile disturbances (0–7)", type:"number" },
      { id:"aud", label:"Auditory disturbances (0–7)", type:"number" },
      { id:"vis", label:"Visual disturbances (0–7)", type:"number" },
      { id:"hea", label:"Headache / fullness (0–7)", type:"number" },
      { id:"ori", label:"Orientation / clouding (0–4)", type:"number" }
    ],
    compute:function(v){
      var ks=["nau","tre","swe","anx","agi","tac","aud","vis","hea","ori"];
      for(var i=0;i<ks.length;i++){ if(!ok(v[ks[i]])) return ERR; }
      function cl(x,mx){return Math.max(0,Math.min(mx,Math.round(x)));}
      var s=0; for(var j=0;j<9;j++){ s+=cl(v[ks[j]],7); } s+=cl(v.ori,4);
      var band=s<=8?"<b>Minimal / absent</b> (≤8) — usually no medication.":s<=15?"<b>Mild–moderate</b> (9–15).":s<=20?"<b>Moderate–severe</b> (16–20) — treat.":"<b>Severe</b> (&gt;20) — high risk of seizures / DTs; treat promptly.";
      return { v:s, u:"/67", i:band+" Use symptom-triggered benzodiazepine dosing per protocol; reassess hourly. Ref: Sullivan et al, Br J Addict 1989." };
    } },

  { id:"crb65", cat:"Infectious disease", icon:"🦠", title:"CRB-65 (CAP, no labs)",
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

  { id:"bisap", cat:"Critical care", icon:"🚨", title:"BISAP (pancreatitis severity)",
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

  { id:"spesi", cat:"Cardiovascular", icon:"🫀", title:"sPESI (PE severity)",
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

  { id:"killip", cat:"Cardiovascular", icon:"🫀", title:"Killip classification",
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
      var mort={1:"~6%",2:"~17%",3:"~38%",4:"~67%"}[v.cls];
      return { v:"Class "+({1:"I",2:"II",3:"III",4:"IV"}[v.cls]), u:"", i:"Approx. historical in-hospital mortality "+mort+" (lower with modern reperfusion). Higher class → worse prognosis. Ref: Killip & Kimball, Am J Cardiol 1967." };
    } },

  { id:"decaf", cat:"General", icon:"⚖️", title:"DECAF (COPD exacerbation)",
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

  { id:"phq9", cat:"General", icon:"⚖️", title:"PHQ-9 (depression)",
    desc:"Depression severity screen. Each item 0–3 over the last 2 weeks.",
    kw:["phq","depression","mood","screen","mental health"],
    inputs:[
      { id:"q1", label:"Little interest / pleasure", type:"number" },
      { id:"q2", label:"Feeling down / depressed / hopeless", type:"number" },
      { id:"q3", label:"Sleep problems", type:"number" },
      { id:"q4", label:"Tired / little energy", type:"number" },
      { id:"q5", label:"Appetite change", type:"number" },
      { id:"q6", label:"Feeling bad about yourself", type:"number" },
      { id:"q7", label:"Trouble concentrating", type:"number" },
      { id:"q8", label:"Slow / restless (psychomotor)", type:"number" },
      { id:"q9", label:"Thoughts of self-harm", type:"number" }
    ],
    compute:function(v){
      var ks=["q1","q2","q3","q4","q5","q6","q7","q8","q9"];
      for(var i=0;i<ks.length;i++){ if(!ok(v[ks[i]])) return ERR; }
      var s=0; for(var j=0;j<ks.length;j++){ s+=Math.max(0,Math.min(3,Math.round(v[ks[j]]))); }
      var band=s<=4?"Minimal (0–4).":s<=9?"Mild (5–9).":s<=14?"Moderate (10–14).":s<=19?"Moderately severe (15–19).":"Severe (20–27).";
      var flag=(ok(v.q9)&&v.q9>=1)?" ⚠ Item 9 positive — assess suicide risk.":"";
      return { v:s, u:"/27", i:"<b>"+band+"</b>"+flag+" ≥10 has good sensitivity/specificity for major depression. Ref: Kroenke, J Gen Intern Med 2001." };
    } },

  { id:"gad7", cat:"General", icon:"⚖️", title:"GAD-7 (anxiety)",
    desc:"Generalised anxiety severity screen. Each item 0–3 over the last 2 weeks.",
    kw:["gad","anxiety","screen","mental health"],
    inputs:[
      { id:"q1", label:"Feeling nervous / anxious / on edge (0–3)", type:"number" },
      { id:"q2", label:"Not able to stop / control worrying (0–3)", type:"number" },
      { id:"q3", label:"Worrying too much about things (0–3)", type:"number" },
      { id:"q4", label:"Trouble relaxing (0–3)", type:"number" },
      { id:"q5", label:"Restless, hard to sit still (0–3)", type:"number" },
      { id:"q6", label:"Easily annoyed / irritable (0–3)", type:"number" },
      { id:"q7", label:"Feeling afraid something awful might happen (0–3)", type:"number" }
    ],
    compute:function(v){
      var ks=["q1","q2","q3","q4","q5","q6","q7"];
      for(var i=0;i<ks.length;i++){ if(!ok(v[ks[i]])) return ERR; }
      var s=0; for(var j=0;j<ks.length;j++){ s+=Math.max(0,Math.min(3,Math.round(v[ks[j]]))); }
      var band=s<=4?"Minimal (0–4).":s<=9?"Mild (5–9).":s<=14?"Moderate (10–14).":"Severe (15–21).";
      return { v:s, u:"/21", i:"<b>"+band+"</b> ≥10 warrants further assessment / treatment. Ref: Spitzer, Arch Intern Med 2006." };
    } },

  { id:"auditc", cat:"General", icon:"⚖️", title:"AUDIT-C (alcohol)",
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

  { id:"rox", cat:"Critical care", icon:"🚨", title:"ROX index (HFNC)",
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

  { id:"uag", cat:"Renal", icon:"🫘", title:"Urine anion gap",
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

  { id:"timistemi", cat:"Cardiovascular", icon:"🫀", title:"TIMI risk (STEMI)",
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

  { id:"geneva", cat:"Cardiovascular", icon:"🫀", title:"Geneva score (revised, PE)",
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

  { id:"rcri", cat:"Cardiovascular", icon:"❤️", title:"Revised Cardiac Risk Index (RCRI / Lee)",
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

  { id:"ottawa_ankle", cat:"Musculoskeletal", icon:"🦴", title:"Ottawa Ankle & Foot Rules",
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

  { id:"ottawa_knee", cat:"Musculoskeletal", icon:"🦴", title:"Ottawa Knee Rule",
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

  { id:"nexus_cspine", cat:"Neurology", icon:"🚑", title:"NEXUS C-Spine Criteria",
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

  { id:"canadian_ct_head", cat:"Neurology", icon:"🧠", title:"Canadian CT Head Rule",
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

  { id:"bishop", cat:"Obstetrics", icon:"🤰", title:"Bishop Score",
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

  { id:"apgar", cat:"Obstetrics", icon:"👶", title:"APGAR Score",
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

  { id:"westley_croup", cat:"Paediatrics", icon:"👶", title:"Westley Croup Score",
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

  { id:"mrs", cat:"Neurology", icon:"🧠", title:"Modified Rankin Scale (mRS)",
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

  { id:"hunt_hess", cat:"Neurology", icon:"🧠", title:"Hunt & Hess Grade (SAH)",
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

  { id:"cage", cat:"Psychiatry", icon:"🍷", title:"CAGE Questionnaire",
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

  { id:"feverpain", cat:"Infectious disease", icon:"🦠", title:"FeverPAIN Score",
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
    feverpain:["feverpain score","sore throat","strep throat","pharyngitis","antibiotic sore throat"]
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
  var CAT_ORDER = ["Cardiovascular","Critical care","Infectious disease","Renal","Hepatology","Neurology","General"];
  var CAT_ICON = { "Cardiovascular":"🫀","Critical care":"🚨","Infectious disease":"🦠","Renal":"🫘","Hepatology":"🫁","Neurology":"🧠","General":"⚖️" };
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
        '<button id="mcInteractionsBtn" class="mc-cat" style="margin-top:14px;width:100%;box-sizing:border-box;text-align:center">💊⚠️ Check Drug Interactions</button>'+
        '<div class="mc-disc">⚠️ Decision support only — verify formulas and thresholds against the individual patient and local protocol.</div>'+
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
        filled.push({ label:f.label, val:parseFloat(photoRec[f.lab]), units:"", src:"📷 Imported report" });
      } else { missing.push(f.label); }
    });
    return { filled:filled, missing:missing };
  }
  function afNoteRows(r){
    var h="";
    if(r.filled.length) h+='<div class="mc-af-ok">'+r.filled.map(function(x){ return '✓ '+esc(x.label)+': <b>'+esc(x.val)+'</b>'+(x.units?" "+esc(x.units):"")+' <span>'+esc(x.src)+'</span>'; }).join("")+'</div>';
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
    function photoBtnHTML(){ return photoHasNeeds()?'<button class="mc-af-photo" id="mcAFph_'+c.id+'">📷 Use last imported report'+(photoName()?' ('+esc(photoName())+')':'')+'</button>':""; }
    function wirePhotoBtn(){
      var b=document.getElementById("mcAFph_"+c.id); if(!b) return;
      b.addEventListener("click", function(){
        var pt=(window.ICU_STATE && ICU_STATE.patient)||{};
        var r=fillFields(c, {}, photo(), { age:pt.age, sex:pt.sex, src:"📷 Imported" }); run();
        body.innerHTML='<div class="mc-af-note"><div class="mc-af-note-h">📷 From imported report'+(photoName()?' · '+esc(photoName()):'')+'</div>'+afNoteRows(r)+'<div class="mc-af-verify">⚠️ Verify against the source report before relying on the result.</div></div>';
      });
    }
    function pick(p){
      if(!p||!window.GHIS||!GHIS.fetchLabTests) return;
      body.innerHTML='<div class="mc-af-msg">Fetching labs for <b>'+esc(p.patientFirstName||p.patientId)+'</b>…</div>';
      GHIS.fetchLabTests(p.patientId).then(function(rows){
        var ageP=parseInt(p.dob,10);
        var demo={ age:(!isNaN(ageP)&&ageP>0&&ageP<130)?ageP:null, sex:p.gender, src:"Ward Sync" };
        var r=fillFields(c, extractAnalytes(rows), photo(), demo); run();
        body.innerHTML='<div class="mc-af-note"><div class="mc-af-note-h">☁ '+esc(p.patientFirstName||p.patientId)+' · Ward Sync</div>'+afNoteRows(r)+'<div class="mc-af-verify">⚠️ Auto-filled from the hospital record — verify each value before relying on the result.</div></div>';
      }).catch(function(){ body.innerHTML='<div class="mc-af-msg">Couldn’t fetch labs — check the Ward Sync connection and try again.</div>'; });
    }
    function renderPicker(){
      var connected = window.GHIS && GHIS.isConnected && GHIS.isConnected();
      if(!connected){
        body.innerHTML='<div class="mc-af-msg">Ward Sync isn’t connected. Open 🏥 <b>Ward</b> and sign in to fetch a patient’s labs.<button class="mc-af-open" id="mcAFopen_'+c.id+'">Open Ward Sync</button></div>'+photoBtnHTML();
        var o=document.getElementById("mcAFopen_"+c.id); if(o) o.addEventListener("click", function(){ try{ window.openGHIS && openGHIS(); }catch(e){} });
        wirePhotoBtn(); return;
      }
      var pts = (GHIS.getPatients && GHIS.getPatients()) || [];
      body.innerHTML='<input class="mc-af-search" id="mcAFq_'+c.id+'" placeholder="🔍 Select patient — name or ID…" autocomplete="off"><div class="mc-af-list" id="mcAFlist_'+c.id+'"></div>'+photoBtnHTML();
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
      (hasLab?'<div class="mc-af"><button class="mc-af-btn" id="mcAFbtn_'+id+'">🔬 Auto-fill labs from patient</button><div class="mc-af-body" id="mcAFbody_'+id+'"></div></div>':"")+
      '<div class="mc-inputs">'+inputHTML(c)+'</div>'+
      '<button class="mc-calc-btn" id="mcCalc_'+id+'">Calculate</button>'+
      '<div class="mc-result" id="mcRes_'+id+'"></div>'+
      (c.ref?'<div class="mc-ref">📚 <b>Reference:</b> '+esc(c.ref)+'</div>':"");
    function run(){
      var out; try { out=c.compute(readValues(c)); } catch(e){ out={err:"Could not compute — check the inputs."}; }
      var res=document.getElementById("mcRes_"+id);
      if(!out){ res.innerHTML=""; return; }
      if(out.err){ res.innerHTML='<div class="mc-res-err">'+esc(out.err)+'</div>'; return; }
      try { if (window.SMD_KU) SMD_KU.emit("calc", id); } catch(e){}   // KU: used a calculator (deduped per day server-side)
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
    if(hasLab) wireAutofill(c, run);
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
