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
    } },

  /* ===== MDCalc-parity expansion — batch 2 (ai_drafted; clinician-verify) ===== */

  { id:"sgarbossa", cat:"Cardiovascular", icon:"❤️", title:"Sgarbossa Criteria (MI in LBBB/paced)",
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

  { id:"fisher", cat:"Neurology", icon:"🧠", title:"Fisher Grade (SAH on CT)",
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

  { id:"steroid_conv", cat:"Endocrine", icon:"💊", title:"Corticosteroid Conversion",
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

  { id:"mme", cat:"General", icon:"💊", title:"Morphine Milligram Equivalents (MME/day)",
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

  { id:"saag", cat:"Hepatology", icon:"🩺", title:"Serum-Ascites Albumin Gradient (SAAG)",
    desc:"Classifies ascites as portal-hypertensive vs not.",
    inputs:[
      { id:"salb", label:"Serum albumin", type:"number", unit:"g/L", step:"1" },
      { id:"aalb", label:"Ascitic fluid albumin", type:"number", unit:"g/L", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.salb)||!ok(v.aalb)) return ERR;
      var g=r1(v.salb - v.aalb);
      return { v:g, u:"g/L", i:(g>=11?"≥11 g/L — portal hypertension likely (cirrhosis, heart failure, Budd-Chiari)":"<11 g/L — non-portal cause (malignancy, TB, pancreatic, nephrotic)")+". Ref: Runyon, Ann Intern Med 1992." };
    } },

  { id:"ttkg", cat:"Renal", icon:"🩺", title:"Transtubular Potassium Gradient (TTKG)",
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

  { id:"ebv", cat:"General", icon:"🩸", title:"Estimated Blood Volume",
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

  { id:"cows", cat:"Psychiatry", icon:"💊", title:"Clinical Opiate Withdrawal Scale (COWS)",
    desc:"Severity of opioid withdrawal.",
    inputs:[
      { id:"pulse", label:"Resting pulse rate", type:"select", opts:[{v:"0",t:"≤80"},{v:"1",t:"81–100"},{v:"2",t:"101–120"},{v:"4",t:">120"}] },
      { id:"sweat", label:"Sweating", type:"select", opts:[{v:"0",t:"None"},{v:"1",t:"Subjective / flushing"},{v:"2",t:"Beads of sweat"},{v:"3",t:"Streaming"}] },
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

  { id:"gahs", cat:"Hepatology", icon:"🩺", title:"Glasgow Alcoholic Hepatitis Score (GAHS)",
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

  { id:"das28", cat:"Rheumatology", icon:"🦴", title:"DAS28-ESR (rheumatoid activity)",
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

  { id:"stopbang", cat:"Respiratory", icon:"😴", title:"STOP-BANG (obstructive sleep apnoea)",
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

  { id:"smartcop", cat:"Respiratory", icon:"🫁", title:"SMART-COP (pneumonia — intensive support)",
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

  { id:"homa_ir", cat:"Endocrine", icon:"🩸", title:"HOMA-IR (insulin resistance)",
    desc:"Homeostatic model assessment of insulin resistance.",
    inputs:[
      { id:"glu", label:"Fasting glucose", type:"number", unit:"mmol/L", step:"0.1" },
      { id:"ins", label:"Fasting insulin", type:"number", unit:"mU/L", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.glu)||!ok(v.ins)||v.glu<=0||v.ins<=0) return ERR;
      var h=r1(v.glu*v.ins/22.5);
      return { v:h, u:"", i:(h>2.5?"Suggests insulin resistance (thresholds vary by population/assay, commonly >~2.5)":"Within the usual reference range")+". Use fasting samples; not validated on insulin therapy. Ref: Matthews, Diabetologia 1985." };
    } },

  { id:"nafld_fibrosis", cat:"Hepatology", icon:"🩺", title:"NAFLD Fibrosis Score",
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

  { id:"glasgow_imrie", cat:"Critical care", icon:"🩺", title:"Glasgow-Imrie Score (pancreatitis)",
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

  { id:"4at", cat:"Neurology", icon:"🧠", title:"4AT (delirium screening)",
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

  { id:"sf_syncope", cat:"Cardiovascular", icon:"❤️", title:"San Francisco Syncope Rule (CHESS)",
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

  { id:"bode", cat:"Respiratory", icon:"🫁", title:"BODE Index (COPD)",
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

  { id:"ottawa_sah", cat:"Neurology", icon:"🚑", title:"Ottawa SAH Rule",
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

  { id:"wfns", cat:"Neurology", icon:"🧠", title:"WFNS Grade (SAH)",
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

  { id:"harvey_bradshaw", cat:"Gastroenterology", icon:"🩺", title:"Harvey-Bradshaw Index (Crohn's)",
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

  { id:"truelove_witts", cat:"Gastroenterology", icon:"🩺", title:"Truelove-Witts (UC severity)",
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

  { id:"aims65", cat:"Gastroenterology", icon:"🩸", title:"AIMS65 (upper GI bleed mortality)",
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

  { id:"air_score", cat:"General", icon:"🔪", title:"Appendicitis Inflammatory Response (AIR) Score",
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

  { id:"kocher", cat:"Paediatrics", icon:"👶", title:"Kocher Criteria (septic hip)",
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

  { id:"orbit_bleed", cat:"Cardiovascular", icon:"🩸", title:"ORBIT Bleeding Score (AF)",
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

  { id:"urr", cat:"Renal", icon:"🩺", title:"Urea Reduction Ratio (dialysis)",
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

  { id:"cdai_ra", cat:"Rheumatology", icon:"🦴", title:"CDAI (rheumatoid arthritis)",
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

  { id:"gos", cat:"Neurology", icon:"🧠", title:"Glasgow Outcome Scale (GOS)",
    desc:"Global outcome after brain injury.",
    inputs:[
      { id:"g", label:"Outcome", type:"select", opts:[
        {v:"1",t:"1 — Death"},
        {v:"2",t:"2 — Persistent vegetative state"},
        {v:"3",t:"3 — Severe disability (conscious but dependent)"},
        {v:"4",t:"4 — Moderate disability (independent but disabled)"},
        {v:"5",t:"5 — Good recovery"} ] }
    ],
    compute:function(v){
      var g=Number(v.g)||1;
      var txt=["","Death","Persistent vegetative state","Severe disability","Moderate disability","Good recovery"][g];
      return { v:g, u:"(1–5)", i:txt+". Higher is better; often dichotomised as favourable (4–5) vs unfavourable (1–3). Ref: Jennett & Bond, Lancet 1975." };
    } },

  { id:"anc", cat:"Haematology", icon:"🩸", title:"Absolute Neutrophil Count (ANC)",
    desc:"Neutrophil count and neutropenia grading.",
    inputs:[
      { id:"wbc", label:"White cell count", type:"number", unit:"×10⁹/L", step:"0.1" },
      { id:"neut", label:"Neutrophils (segmented + bands)", type:"number", unit:"%", step:"1" }
    ],
    compute:function(v){
      if(!ok(v.wbc)||!ok(v.neut)||v.wbc<0||v.neut<0) return ERR;
      var a=r1(v.wbc*v.neut/100);
      var band = a<0.5?"Severe neutropenia (high infection risk)":a<1.0?"Moderate neutropenia":a<1.5?"Mild neutropenia":"Not neutropenic";
      return { v:a, u:"×10⁹/L", i:band+" (severe <0.5, moderate <1.0, mild <1.5). Neutropenic fever is an emergency." };
    } },

  { id:"improve_vte", cat:"Haematology", icon:"🩸", title:"IMPROVE VTE Risk Score",
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

  { id:"eag", cat:"Endocrine", icon:"🩸", title:"Estimated Average Glucose (eAG) from HbA1c",
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

  { id:"rpi", cat:"Haematology", icon:"🩸", title:"Reticulocyte Production Index (RPI)",
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

  { id:"isth_dic", cat:"Haematology", icon:"🩸", title:"ISTH Overt DIC Score",
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

  { id:"sdai", cat:"Rheumatology", icon:"🦴", title:"Simplified Disease Activity Index (SDAI) — RA",
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

  { id:"braden", cat:"General", icon:"🛏️", title:"Braden Scale (Pressure Ulcer Risk)",
    desc:"Risk of pressure ulcer development in immobile or at-risk patients.",
    inputs:[
      { id:"sens", label:"Sensory perception", type:"select", opts:[{v:"1",t:"Completely limited"},{v:"2",t:"Very limited"},{v:"3",t:"Slightly limited"},{v:"4",t:"No impairment"}] },
      { id:"moist", label:"Moisture", type:"select", opts:[{v:"1",t:"Constantly moist"},{v:"2",t:"Very moist"},{v:"3",t:"Occasionally moist"},{v:"4",t:"Rarely moist"}] },
      { id:"act", label:"Activity", type:"select", opts:[{v:"1",t:"Bedfast"},{v:"2",t:"Chairfast"},{v:"3",t:"Walks occasionally"},{v:"4",t:"Walks frequently"}] },
      { id:"mob", label:"Mobility", type:"select", opts:[{v:"1",t:"Completely immobile"},{v:"2",t:"Very limited"},{v:"3",t:"Slightly limited"},{v:"4",t:"No limitation"}] },
      { id:"nut", label:"Nutrition", type:"select", opts:[{v:"1",t:"Very poor"},{v:"2",t:"Probably inadequate"},{v:"3",t:"Adequate"},{v:"4",t:"Excellent"}] },
      { id:"fric", label:"Friction and shear", type:"select", opts:[{v:"1",t:"Problem"},{v:"2",t:"Potential problem"},{v:"3",t:"No apparent problem"}] }
    ],
    compute:function(v){
      var s = Number(v.sens)+Number(v.moist)+Number(v.act)+Number(v.mob)+Number(v.nut)+Number(v.fric);
      var b = s<=9?"Very high risk":s<=12?"High risk":s<=14?"Moderate risk":s<=18?"Mild / at risk":"Minimal risk";
      return { v:s, u:"points", i:b+" (lower total = higher risk). Ref: Bergstrom, Nurs Res 1987." };
    } },

  { id:"morse_falls", cat:"General", icon:"🚶", title:"Morse Fall Scale",
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

  { id:"bap65", cat:"Respiratory", icon:"🫁", title:"BAP-65 (COPD Exacerbation Severity)",
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

  { id:"duke_treadmill", cat:"Cardiovascular", icon:"❤️", title:"Duke Treadmill Score",
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

  { id:"mayo_uc", cat:"Gastroenterology", icon:"🩹", title:"Mayo Score (Ulcerative Colitis Activity)",
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

  { id:"oxygenation_index", cat:"Critical care", icon:"🫁", title:"Oxygenation Index (OI)",
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

  { id:"schwartz", cat:"Renal", icon:"🫘", title:"Bedside Schwartz eGFR (Paediatric)",
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

  { id:"delta_ratio", cat:"Renal", icon:"🧪", title:"Delta Ratio (Delta-Delta)",
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

  { id:"naranjo", cat:"Toxicology", icon:"💊", title:"Naranjo Adverse Drug Reaction Probability Scale",
    desc:"Likelihood that a clinical event is an adverse drug reaction.",
    inputs:[
      { id:"q1", label:"Previous conclusive reports on this reaction?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q2", label:"Event appeared after the drug was given?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"2",t:"Yes"}] },
      { id:"q3", label:"Improved when drug stopped or antagonist given?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"1",t:"Yes"}] },
      { id:"q4", label:"Reappeared when drug re-administered?", type:"select", opts:[{v:"0",t:"No / unknown"},{v:"2",t:"Yes"}] },
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

  { id:"glasgow_7point", cat:"Dermatology", icon:"🩹", title:"Glasgow 7-Point Checklist (Melanoma)",
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

  { id:"dlqi", cat:"Dermatology", icon:"🩹", title:"Dermatology Life Quality Index (DLQI)",
    desc:"Impact of skin disease on quality of life over the past week.",
    inputs:[
      { id:"q1", label:"Itchy, sore, painful or stinging skin", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q2", label:"Embarrassed or self-conscious", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q3", label:"Interfered with shopping / home / garden", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q4", label:"Influenced the clothes you wore", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q5", label:"Affected social or leisure activities", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q6", label:"Made it difficult to do sport", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q7", label:"Prevented working or studying", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q8", label:"Problems with partner / friends / relatives", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q9", label:"Caused sexual difficulties", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] },
      { id:"q10", label:"Treatment was a problem (time / mess)", type:"select", opts:[{v:"0",t:"Not at all / not relevant"},{v:"1",t:"A little"},{v:"2",t:"A lot"},{v:"3",t:"Very much"}] }
    ],
    compute:function(v){
      var s=0; for(var i=1;i<=10;i++) s+=Number(v["q"+i]);
      var b=s<=1?"No effect on the patient's life":s<=5?"Small effect":s<=10?"Moderate effect":s<=20?"Very large effect":"Extremely large effect";
      return { v:s, u:"/30", i:b+". Ref: Finlay & Khan, Clin Exp Dermatol 1994." };
    } },

  { id:"bpp", cat:"Obstetrics", icon:"🤰", title:"Biophysical Profile (BPP)",
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

  { id:"calvert", cat:"Oncology", icon:"🎗️", title:"Calvert Formula (Carboplatin Dose)",
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

  { id:"mirels", cat:"Oncology", icon:"🦴", title:"Mirels Score (Pathological Fracture Risk)",
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

  { id:"epds", cat:"Psychiatry", icon:"🧠", title:"Edinburgh Postnatal Depression Scale (EPDS)",
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

  { id:"gds15", cat:"Psychiatry", icon:"🧠", title:"Geriatric Depression Scale (GDS-15)",
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

  { id:"karnofsky", cat:"Oncology", icon:"🎗️", title:"Karnofsky Performance Status",
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

  { id:"ecog", cat:"Oncology", icon:"🎗️", title:"ECOG Performance Status",
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

  { id:"logmar", cat:"Ophthalmology", icon:"👁️", title:"Snellen → logMAR Conversion",
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

  { id:"rass", cat:"Critical care", icon:"🚨", title:"Richmond Agitation-Sedation Scale (RASS)",
    desc:"Level of agitation or sedation in critically ill patients.",
    inputs:[
      { id:"rass", label:"Observed state", type:"select", opts:[
        {v:"4",t:"+4 Combative"},{v:"3",t:"+3 Very agitated"},{v:"2",t:"+2 Agitated"},{v:"1",t:"+1 Restless"},{v:"0",t:"0 Alert and calm"},
        {v:"-1",t:"−1 Drowsy (>10s eye contact to voice)"},{v:"-2",t:"−2 Light sedation (<10s eye contact)"},{v:"-3",t:"−3 Moderate sedation (movement, no eye contact)"},
        {v:"-4",t:"−4 Deep sedation (responds to physical stimulus only)"},{v:"-5",t:"−5 Unarousable"} ] }
    ],
    compute:function(v){
      var r=Number(v.rass);
      var m={"4":"Combative — immediate danger to staff","3":"Very agitated","2":"Agitated","1":"Restless","0":"Alert and calm","-1":"Drowsy","-2":"Light sedation","-3":"Moderate sedation","-4":"Deep sedation","-5":"Unarousable"};
      return { v:(r>0?"+":"")+r, u:"", i:m[String(r)]+". Target is usually 0 to −2 unless deep sedation indicated. Ref: Sessler, AJRCCM 2002." };
    } },

  { id:"downes", cat:"Paediatrics", icon:"👶", title:"Downes Score (Neonatal Respiratory Distress)",
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
      var b=s<4?"No respiratory distress":s<=6?"Moderate distress — monitor closely":"Impending respiratory failure — urgent support";
      return { v:s, u:"/10", i:b+". Ref: Downes, Clin Pediatr 1970." };
    } },

  { id:"pas", cat:"Paediatrics", icon:"👶", title:"Paediatric Appendicitis Score (PAS)",
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

  { id:"pittsburgh_knee", cat:"Musculoskeletal", icon:"🦵", title:"Pittsburgh Knee Rules",
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

  { id:"fai", cat:"Endocrine", icon:"🧬", title:"Free Androgen Index (FAI)",
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

  { id:"quicki", cat:"Endocrine", icon:"🧬", title:"QUICKI (Insulin Sensitivity)",
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
      var b=q>=0.45?"Normal insulin sensitivity":q>=0.34?"Reduced sensitivity (insulin resistance)":"Marked insulin resistance";
      return { v:qr, u:"", i:b+" (glucose entered in mg/dL). Higher = more sensitive. Ref: Katz, J Clin Endocrinol Metab 2000." };
    } },

  { id:"basdai", cat:"Rheumatology", icon:"🦴", title:"BASDAI (Ankylosing Spondylitis Activity)",
    desc:"Disease activity in axial spondyloarthritis (each item scored 0–10).",
    inputs:[
      { id:"q1", label:"Fatigue / tiredness", type:"number", step:"0.1" },
      { id:"q2", label:"Spinal pain (neck / back / hip)", type:"number", step:"0.1" },
      { id:"q3", label:"Peripheral joint pain / swelling", type:"number", step:"0.1" },
      { id:"q4", label:"Discomfort from tender areas (enthesitis)", type:"number", step:"0.1" },
      { id:"q5", label:"Morning stiffness — severity", type:"number", step:"0.1" },
      { id:"q6", label:"Morning stiffness — duration", type:"number", step:"0.1" }
    ],
    compute:function(v){
      if(!ok(v.q1)||!ok(v.q2)||!ok(v.q3)||!ok(v.q4)||!ok(v.q5)||!ok(v.q6)) return ERR;
      var s=(v.q1+v.q2+v.q3+v.q4+(v.q5+v.q6)/2)/5;
      var b=s>=4?"Active disease — consider treatment escalation":"Lower disease activity";
      return { v:r1(s), u:"/10", i:b+". Ref: Garrett, J Rheumatol 1994 (BASDAI)." };
    } },

  { id:"forrest", cat:"Gastroenterology", icon:"🩹", title:"Forrest Classification (Ulcer Bleeding)",
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

  { id:"gap_ipf", cat:"Respiratory", icon:"🫁", title:"GAP Index (IPF Mortality)",
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

  { id:"canadian_syncope", cat:"Cardiovascular", icon:"❤️", title:"Canadian Syncope Risk Score",
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

  { id:"albi", cat:"Hepatology", icon:"🩺", title:"ALBI Grade (Albumin-Bilirubin)",
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

  { id:"khorana", cat:"Oncology", icon:"🎗️", title:"Khorana Score (Chemotherapy VTE Risk)",
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

  { id:"must", cat:"General", icon:"⚖️", title:"MUST (Malnutrition Universal Screening Tool)",
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

  { id:"nyha", cat:"Cardiovascular", icon:"❤️", title:"NYHA Functional Classification",
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

  { id:"hoehn_yahr", cat:"Neurology", icon:"🧠", title:"Hoehn and Yahr Staging (Parkinson's)",
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

  { id:"epworth", cat:"Neurology", icon:"😴", title:"Epworth Sleepiness Scale",
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

  { id:"spetzler_martin", cat:"Neurology", icon:"🧠", title:"Spetzler-Martin AVM Grade",
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

  { id:"murray", cat:"Critical care", icon:"🫁", title:"Murray Lung Injury Score",
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

  { id:"kdigo_aki", cat:"Renal", icon:"🫘", title:"KDIGO AKI Staging",
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

  { id:"milan", cat:"Hepatology", icon:"🩺", title:"Milan Criteria (HCC Transplant Eligibility)",
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

  { id:"findrisc", cat:"Endocrine", icon:"🧬", title:"FINDRISC (Type 2 Diabetes Risk)",
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

  { id:"caspar", cat:"Rheumatology", icon:"🦴", title:"CASPAR Criteria (Psoriatic Arthritis)",
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

  { id:"hscore", cat:"Haematology", icon:"🩸", title:"HScore (Haemophagocytic Syndrome)",
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

  { id:"plasmic", cat:"Haematology", icon:"🩸", title:"PLASMIC Score (TTP Likelihood)",
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

  { id:"cfs", cat:"General", icon:"⚖️", title:"Clinical Frailty Scale (Rockwood)",
    desc:"Global frailty assessment in older adults.",
    inputs:[
      { id:"level", label:"Frailty level", type:"select", opts:[
        {v:"1",t:"1 — Very fit"},{v:"2",t:"2 — Well"},{v:"3",t:"3 — Managing well"},{v:"4",t:"4 — Living with very mild frailty"},
        {v:"5",t:"5 — Living with mild frailty"},{v:"6",t:"6 — Living with moderate frailty"},{v:"7",t:"7 — Living with severe frailty"},
        {v:"8",t:"8 — Living with very severe frailty"},{v:"9",t:"9 — Terminally ill"} ] }
    ],
    compute:function(v){
      var n=Number(v.level);
      var b=n<=3?"Not frail":n===4?"Vulnerable / very mild frailty":n<=6?"Mild-to-moderate frailty":n<=8?"Severe frailty":"Terminally ill";
      return { v:n, u:"/9", i:b+" (higher = more frail; correlates with adverse outcomes). Ref: Rockwood, CMAJ 2005." };
    } },

  { id:"duke_endocarditis", cat:"Infectious disease", icon:"🦠", title:"Modified Duke Criteria (Infective Endocarditis)",
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

  { id:"stess", cat:"Neurology", icon:"🧠", title:"Status Epilepticus Severity Score (STESS)",
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

  { id:"bicarb_deficit", cat:"Renal", icon:"🧪", title:"Bicarbonate Deficit",
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

  { id:"cat_copd", cat:"Respiratory", icon:"🫁", title:"COPD Assessment Test (CAT)",
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

  { id:"ibw", cat:"General", icon:"⚖️", title:"Ideal Body Weight (Devine)",
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

  { id:"adjbw", cat:"General", icon:"⚖️", title:"Adjusted Body Weight",
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

  { id:"hunter_serotonin", cat:"Toxicology", icon:"💊", title:"Hunter Serotonin Toxicity Criteria",
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

  { id:"ganzoni", cat:"Haematology", icon:"🩸", title:"Ganzoni Iron Deficit",
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

  { id:"fepo4", cat:"Renal", icon:"🫘", title:"Fractional Excretion of Phosphate (FEPO₄)",
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

  { id:"gcs_p", cat:"Neurology", icon:"🧠", title:"GCS-Pupils Score (GCS-P)",
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

  { id:"charlson", cat:"General", icon:"⚖️", title:"Charlson Comorbidity Index",
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

  { id:"add_rs", cat:"Cardiovascular", icon:"❤️", title:"Aortic Dissection Detection Risk Score (ADD-RS)",
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

  { id:"hat", cat:"Neurology", icon:"🧠", title:"HAT Score (Haemorrhage After Thrombolysis)",
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

  { id:"feua", cat:"Renal", icon:"🫘", title:"Fractional Excretion of Uric Acid (FEUA)",
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

  { id:"mdq", cat:"Psychiatry", icon:"🧠", title:"Mood Disorder Questionnaire (MDQ)",
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

  { id:"eutos", cat:"Haematology", icon:"🩸", title:"EUTOS Score (Chronic Myeloid Leukaemia)",
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

  { id:"chads2", cat:"Cardiovascular", icon:"❤️", title:"CHADS₂ Score",
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

  { id:"ca_phos_product", cat:"Renal", icon:"🦴", title:"Calcium-Phosphate Product",
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

  { id:"pecarn_head", cat:"Paediatrics", icon:"👶", title:"PECARN Paediatric Head Injury Rule",
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

  { id:"berlin_ards", cat:"Critical care", icon:"🫁", title:"Berlin Definition (ARDS)",
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

  { id:"four_score", cat:"Neurology", icon:"🧠", title:"FOUR Score (Coma)",
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

  { id:"marburg", cat:"Cardiovascular", icon:"❤️", title:"Marburg Heart Score (Chest Pain)",
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

  { id:"effective_osm", cat:"Endocrine", icon:"🧪", title:"Effective Serum Osmolality (Tonicity)",
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

  { id:"ktv", cat:"Renal", icon:"🫘", title:"Kt/V (Single-pool, Daugirdas)",
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

  { id:"audit_full", cat:"Psychiatry", icon:"🍺", title:"AUDIT (Alcohol Use Disorders Identification Test)",
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

  { id:"mews", cat:"Critical care", icon:"🚨", title:"Modified Early Warning Score (MEWS)",
    desc:"Bedside physiological track-and-trigger score.",
    inputs:[
      { id:"sbp", label:"Systolic BP", type:"select", opts:[{v:"3",t:"≤ 70"},{v:"2",t:"71–80"},{v:"1",t:"81–100"},{v:"0",t:"101–199"},{v:"2b",t:"≥ 200"}] },
      { id:"hr", label:"Heart rate", type:"select", opts:[{v:"2",t:"≤ 40"},{v:"1",t:"41–50"},{v:"0",t:"51–100"},{v:"1b",t:"101–110"},{v:"2b",t:"111–129"},{v:"3",t:"≥ 130"}] },
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"2",t:"< 9"},{v:"0",t:"9–14"},{v:"1",t:"15–20"},{v:"2b",t:"21–29"},{v:"3",t:"≥ 30"}] },
      { id:"temp", label:"Temperature", type:"select", opts:[{v:"2",t:"< 35°C"},{v:"0",t:"35–38.4°C"},{v:"2b",t:"≥ 38.5°C"}] },
      { id:"avpu", label:"Neurological (AVPU)", type:"select", opts:[{v:"0",t:"Alert"},{v:"1",t:"Reacts to voice"},{v:"2",t:"Reacts to pain"},{v:"3",t:"Unresponsive"}] }
    ],
    compute:function(v){
      function n(x){ return Math.abs(Number(String(x).replace("b",""))); }
      var s=n(v.sbp)+n(v.hr)+n(v.rr)+n(v.temp)+n(v.avpu);
      var b=s>=5?"High — urgent clinical review":s>=3?"Intermediate — increase monitoring/review":"Low";
      return { v:s, u:"points", i:b+" (a score of ≥5, or 3 in any single parameter, should prompt escalation). Ref: Subbe, QJM 2001 (MEWS)." };
    } },

  { id:"apfel", cat:"General", icon:"🤢", title:"Apfel Score (Postoperative Nausea & Vomiting)",
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

  { id:"borg", cat:"Respiratory", icon:"🫁", title:"Modified Borg Dyspnoea Scale",
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

  { id:"aar", cat:"Hepatology", icon:"🩺", title:"AST/ALT Ratio (De Ritis)",
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

  { id:"barthel", cat:"Neurology", icon:"🧠", title:"Barthel Index (Activities of Daily Living)",
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

  { id:"silverman", cat:"Paediatrics", icon:"👶", title:"Silverman-Andersen Retraction Score",
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

  { id:"ashworth", cat:"Neurology", icon:"🧠", title:"Modified Ashworth Scale (Spasticity)",
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

  { id:"abi", cat:"Cardiovascular", icon:"🦵", title:"Ankle-Brachial Index (ABI)",
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

  { id:"pack_years", cat:"General", icon:"🚬", title:"Smoking Pack-Years",
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

  { id:"phq2", cat:"Psychiatry", icon:"🧠", title:"PHQ-2 (Depression Screen)",
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

  { id:"whr", cat:"General", icon:"⚖️", title:"Waist-Hip Ratio",
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

  { id:"bristol", cat:"Gastroenterology", icon:"🩹", title:"Bristol Stool Form Scale",
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

  { id:"apache2", cat:"Critical care", icon:"🚨", title:"APACHE II Score",
    desc:"ICU severity of illness and mortality estimate (worst values in first 24 h).",
    inputs:[
      { id:"temp", label:"Temperature (°C, core)", type:"select", opts:[{v:"4",t:"≥ 41"},{v:"3",t:"39–40.9"},{v:"1",t:"38.5–38.9"},{v:"0",t:"36–38.4"},{v:"1b",t:"34–35.9"},{v:"2",t:"32–33.9"},{v:"3b",t:"30–31.9"},{v:"4b",t:"≤ 29.9"}] },
      { id:"map", label:"Mean arterial pressure (mmHg)", type:"select", opts:[{v:"4",t:"≥ 160"},{v:"3",t:"130–159"},{v:"2",t:"110–129"},{v:"0",t:"70–109"},{v:"2b",t:"50–69"},{v:"4b",t:"≤ 49"}] },
      { id:"hr", label:"Heart rate", type:"select", opts:[{v:"4",t:"≥ 180"},{v:"3",t:"140–179"},{v:"2",t:"110–139"},{v:"0",t:"70–109"},{v:"2b",t:"55–69"},{v:"3b",t:"40–54"},{v:"4b",t:"≤ 39"}] },
      { id:"rr", label:"Respiratory rate", type:"select", opts:[{v:"4",t:"≥ 50"},{v:"3",t:"35–49"},{v:"1",t:"25–34"},{v:"0",t:"12–24"},{v:"1b",t:"10–11"},{v:"2",t:"6–9"},{v:"4b",t:"≤ 5"}] },
      { id:"oxy", label:"Oxygenation", type:"select", opts:[{v:"0",t:"FiO₂≥0.5: A-a<200, or FiO₂<0.5: PaO₂>70"},{v:"1",t:"FiO₂<0.5: PaO₂ 61–70"},{v:"2",t:"FiO₂≥0.5: A-a 200–349"},{v:"3",t:"FiO₂≥0.5: A-a 350–499, or FiO₂<0.5: PaO₂ 55–60"},{v:"4",t:"FiO₂≥0.5: A-a ≥500, or FiO₂<0.5: PaO₂ <55"}] },
      { id:"ph", label:"Arterial pH", type:"select", opts:[{v:"4",t:"≥ 7.7"},{v:"3",t:"7.6–7.69"},{v:"1",t:"7.5–7.59"},{v:"0",t:"7.33–7.49"},{v:"2",t:"7.25–7.32"},{v:"3b",t:"7.15–7.24"},{v:"4b",t:"< 7.15"}] },
      { id:"na", label:"Serum sodium (mmol/L)", type:"select", opts:[{v:"4",t:"≥ 180"},{v:"3",t:"160–179"},{v:"2",t:"155–159"},{v:"1",t:"150–154"},{v:"0",t:"130–149"},{v:"2b",t:"120–129"},{v:"3b",t:"111–119"},{v:"4b",t:"≤ 110"}] },
      { id:"k", label:"Serum potassium (mmol/L)", type:"select", opts:[{v:"4",t:"≥ 7"},{v:"3",t:"6–6.9"},{v:"1",t:"5.5–5.9"},{v:"0",t:"3.5–5.4"},{v:"1b",t:"3–3.4"},{v:"2",t:"2.5–2.9"},{v:"4b",t:"< 2.5"}] },
      { id:"cr", label:"Serum creatinine (mg/dL)", type:"select", opts:[{v:"4",t:"≥ 3.5"},{v:"3",t:"2–3.4"},{v:"2",t:"1.5–1.9"},{v:"0",t:"0.6–1.4"},{v:"2b",t:"< 0.6"}] },
      { id:"arf", label:"Acute renal failure (doubles creatinine points)", type:"check" },
      { id:"hct", label:"Haematocrit (%)", type:"select", opts:[{v:"4",t:"≥ 60"},{v:"2",t:"50–59.9"},{v:"1",t:"46–49.9"},{v:"0",t:"30–45.9"},{v:"2b",t:"20–29.9"},{v:"4b",t:"< 20"}] },
      { id:"wbc", label:"White cell count (×10³/mm³)", type:"select", opts:[{v:"4",t:"≥ 40"},{v:"2",t:"20–39.9"},{v:"1",t:"15–19.9"},{v:"0",t:"3–14.9"},{v:"2b",t:"1–2.9"},{v:"4b",t:"< 1"}] },
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

  { id:"ipss_r", cat:"Haematology", icon:"🩸", title:"IPSS-R (Myelodysplastic Syndrome)",
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

  { id:"ad8", cat:"Neurology", icon:"🧠", title:"AD8 Dementia Screening Interview",
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

  { id:"rome4_ibs", cat:"Gastroenterology", icon:"🩹", title:"Rome IV Criteria (Irritable Bowel Syndrome)",
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

  { id:"dapsa", cat:"Rheumatology", icon:"🦴", title:"DAPSA (Psoriatic Arthritis Activity)",
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

  { id:"hit_4ts", cat:"Haematology", icon:"🩸", title:"4Ts Score (Heparin-Induced Thrombocytopenia)",
    desc:"Pre-test probability of heparin-induced thrombocytopenia.",
    inputs:[
      { id:"thrombocytopenia", label:"Thrombocytopenia", type:"select", opts:[{v:"2",t:"Fall > 50% and nadir ≥ 20 ×10⁹/L"},{v:"1",t:"Fall 30–50% or nadir 10–19 ×10⁹/L"},{v:"0",t:"Fall < 30% or nadir < 10 ×10⁹/L"}] },
      { id:"timing", label:"Timing of platelet fall", type:"select", opts:[{v:"2",t:"Days 5–10, or ≤1 day if heparin in past 30 days"},{v:"1",t:"Consistent but unclear, after day 10, or ≤1 day if heparin 30–100 days ago"},{v:"0",t:"Fall < 4 days without recent heparin"}] },
      { id:"thrombosis", label:"Thrombosis or other sequelae", type:"select", opts:[{v:"2",t:"New thrombosis, skin necrosis, or acute systemic reaction"},{v:"1",t:"Progressive/recurrent or suspected thrombosis"},{v:"0",t:"None"}] },
      { id:"other", label:"Other cause of thrombocytopenia", type:"select", opts:[{v:"2",t:"None apparent"},{v:"1",t:"Possible"},{v:"0",t:"Definite"}] }
    ],
    compute:function(v){
      var s=Number(v.thrombocytopenia)+Number(v.timing)+Number(v.thrombosis)+Number(v.other);
      var b=s<=3?"Low probability of HIT":s<=5?"Intermediate probability":"High probability of HIT";
      return { v:s, u:"/8", i:b+". Guides HIT antibody testing and empirical management. Ref: Lo, J Thromb Haemost 2006 (4Ts)." };
    } },

  { id:"cornell_lvh", cat:"Cardiovascular", icon:"❤️", title:"Cornell Voltage Criteria (LVH)",
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

  { id:"sarcf", cat:"General", icon:"🚶", title:"SARC-F (Sarcopenia Screen)",
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
    sarcf:["sarc-f","sarcf","sarcopenia screen","muscle loss screen"]
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
    sarcf:"Malmstrom TK, et al. J Cachexia Sarcopenia Muscle 2016;7(1):28–36 (SARC-F)."
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
