/* StewardMD — Electrolyte Correction Engine (standalone full-page ICU module).
   Self-contained overlay; does NOT touch the ICU dashboard. window.ELYTE.open().
   Decision support only — conservative, guideline-referenced; verify against local
   protocol and clinical context. Pending clinician review. */
(function () {
  "use strict";

  /*ENGINE-START* (pure clinical logic — re-tested by scratchpad/engine-full test) */
  function N(x){var v=parseFloat(x);return(typeof v==="number"&&!isNaN(v)&&isFinite(v))?v:null;}
  function r1(x){return Math.round(x*10)/10;}
  function r0(x){return Math.round(x);}
  // Unit conversion: engine works in CONVENTIONAL units; SI inputs are converted to conventional.
  // canonical(conventional) = si_value * f.   si_value = canonical / f.
  var CONV={ ca:{si:"mmol/L",f:4.0}, mg:{si:"mmol/L",f:2.43}, po4:{si:"mmol/L",f:3.1}, glu:{si:"mmol/L",f:18}, creat:{si:"µmol/L",f:1/88.4}, alb:{si:"g/L",f:0.1} };
  function toCanonical(k,val,units){ if(val==null)return null; return (units==="si"&&CONV[k])? val*CONV[k].f : val; }
  function toDisplay(k,canon,units){ if(canon==null)return null; return (units==="si"&&CONV[k])? canon/CONV[k].f : canon; }
  // Physiologically PLAUSIBLE ranges in CONVENTIONAL (=canonical) units. Anything outside is a data
  // error (mis-mapped prefill, stale/tour placeholder, or a typo) and is DROPPED — never shown as a
  // real value and never fed to the engine, so it can't drive a bogus recommendation (BUG-03/04).
  var RANGES={ na:[100,190], k:[1,9.5], cl:[50,160], hco3:[3,55], ca:[2,20], ica:[0.2,3.5], alb:[0.5,7], mg:[0.2,12], po4:[0.2,20], creat:[0.1,30], egfr:[1,250], glu:[10,2000], ph:[6.5,7.9], osm:[200,450], urea:[1,400] };
  function inRange(k,canon){ if(canon==null)return false; var r=RANGES[k]; return r? (canon>=r[0]&&canon<=r[1]) : true; }
  var NAME2KEY={ Calcium:"ca", Magnesium:"mg", Phosphate:"po4" }; // result analytes that convert
  function tbwFactor(pt){var f=(pt.sex==="f")?0.5:0.6; if(N(pt.age)!=null&&pt.age>=65) f-=0.1; return f;}
  function highOdsRisk(pt,L){return !!(pt.liver||pt.dialysis||pt.malnutrition||pt.alcohol||(N(L&&L.k)!=null&&L.k<3.0));}
  function renalImp(pt,L){return !!(pt.renal||pt.dialysis)||(N(L&&L.egfr)!=null&&L.egfr<30);}

  function correctedNa(na,glu){if(na==null)return null;if(glu==null||glu<=100)return na;return r1(na+1.6*((glu-100)/100));}
  // Albumin outside its physiological range (≈1–6 g/dL) is NOT trusted for correction — fall back to
  // the measured Ca rather than applying the formula to a bad albumin. Result is clamped ≥0: a serum
  // calcium can never be negative, so we never surface an impossible value that drives treatment (BUG-04).
  function correctedCa(ca,alb){if(ca==null)return null;if(alb==null||alb<1||alb>6)return r1(ca);return r1(Math.max(0,ca+0.8*(4.0-alb)));}
  function anionGap(na,cl,hco3,alb){if(na==null||cl==null||hco3==null)return null;var ag=na-(cl+hco3);if(alb!=null)ag=ag+2.5*(4.0-alb);return r1(ag);}

  function analyzeNa(L,pt){
    var na=N(L.na); if(na==null)return null;
    var wt=N(pt.weight)||70, glu=N(L.glu), cNa=correctedNa(na,glu), tbw=tbwFactor(pt)*wt;
    var lines=[],level,sev,ev=["European hyponatraemia guideline 2014 (ESICM/ESE/ERA-EDTA)","Sterns, NEJM 2015"];
    if(na>=135&&na<=145){level="ok";sev="Normal";lines.push(["Status","Within normal range (135–145)."]);}
    else if(na<135){
      sev=na<120?"Critical hyponatraemia":na<125?"Severe hyponatraemia":na<130?"Moderate hyponatraemia":"Mild hyponatraemia";
      level=na<125?(na<120?"crit":"red"):"amber";
      var mr=highOdsRisk(pt,L)?6:8, tgt=Math.min(130,na+mr), def=r0(tbw*(tgt-na));
      lines.push(["Corrected Na (glucose)", (glu!=null&&glu>100)? cNa+" mEq/L (measured "+na+")":"n/a"]);
      lines.push(["Max correction / 24 h","≤ "+mr+" mEq/L"+(highOdsRisk(pt,L)?" (high ODS risk → conservative)":"")]);
      lines.push(["24 h target","≈ "+tgt+" mEq/L — do not exceed"]);
      lines.push(["Na deficit to target",def+" mEq (TBW "+r1(tbw)+" L)"]);
      lines.push(["First-line fluid","Assess volume: hypovolaemic → 0.9% saline; euvolaemic/SIADH → fluid restriction ± hypertonic; hypervolaemic → restrict + treat cause."]);
      lines.push(["Severe / symptomatic","3% saline 100–150 mL IV over 10 min; may repeat ×1–2 to raise Na 4–6 mEq/L, then STOP & reassess."]);
      lines.push(["Monitoring","Serum Na q2–4 h during active correction."]);
      lines.push(["ODS risk", highOdsRisk(pt,L)?"HIGH — overcorrection risk; consider DDAVP-clamp, re-lower with D5W if overcorrected.":"Standard — still avoid overcorrection."]);
      lines.push(["Likely cause (assess)","Volume status + urine Na/osm: SIADH, hypovolaemia, diuretics, heart/liver failure, adrenal/thyroid."]);
    } else {
      sev=na>160?"Critical hypernatraemia":na>155?"Severe hypernatraemia":"Hypernatraemia";
      level=na>160?"crit":na>155?"red":"amber";
      lines.push(["Free water deficit", r1(tbw*((na/140)-1))+" L (replace over 48 h)"]);
      lines.push(["Max correction / 24 h","≤ 10 mEq/L (≤0.5/h) to avoid cerebral oedema."]);
      lines.push(["Fluid","Oral/enteral water if able; else IV D5W or 0.45% saline; treat losses & cause (DI, osmotic, GI)."]);
      lines.push(["Monitoring","Serum Na q4–6 h."]);
    }
    return {name:"Sodium",value:na,unit:"mEq/L",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzeK(L,pt){
    var k=N(L.k); if(k==null)return null; var renal=renalImp(pt,L);
    var lines=[],level,sev,ev=["KDIGO","UpToDate: K disorders","Surviving Sepsis Campaign"];
    if(k>=3.5&&k<=5.0){level="ok";sev="Normal";lines.push(["Status","Within normal range (3.5–5.0)."]);}
    else if(k<3.5){
      sev=k<2.5?"Severe hypokalaemia":k<3.0?"Moderate hypokalaemia":"Mild hypokalaemia"; level=k<2.5?"red":"amber";
      lines.push(["ECG risk", k<2.5?"HIGH — U waves, ST depression, arrhythmia; continuous cardiac monitoring.":"Monitor ECG if symptomatic."]);
      lines.push(["Estimated total deficit", (k<3.0?"200–400 mEq":"100–200 mEq")+" (approx; non-linear below 3.0)"]);
      lines.push(["Route", k<2.5?"IV (severe).":"Oral KCl if tolerating & asymptomatic; IV if severe / NPO / cardiac."]);
      lines.push(["Max IV rate","Peripheral ≤10 mEq/h (≤40 mEq/L). Central ≤20 mEq/h with continuous cardiac monitoring."]);
      lines.push(["Line", k<2.5?"Central preferred for higher rate/concentration.":"Peripheral acceptable at ≤10 mEq/h."]);
      lines.push(["Expected rise","≈0.1 mEq/L per 10 mEq IV (transient; recheck)."]);
      lines.push(["Recheck","Serum K q2–4 h during IV repletion."]);
      lines.push(["Replace magnesium","Check & correct Mg — hypomagnesaemia causes refractory hypokalaemia."]);
      lines.push(["Caution", renal?"RENAL IMPAIRMENT / dialysis — reduce dose, recheck early.":"Ensure adequate urine output before aggressive IV K."]);
    } else {
      sev=k>6.5?"Critical hyperkalaemia":k>6.0?"Severe hyperkalaemia":k>5.5?"Moderate hyperkalaemia":"Mild hyperkalaemia";
      level=k>6.0?"crit":k>5.5?"red":"amber";
      lines.push(["ECG","Obtain immediately — peaked T, wide QRS, sine wave = emergency."]);
      lines.push(["Membrane stabilisation","If K >6.0 or ECG changes: IV calcium gluconate 10% 10 mL over 2–3 min (repeat if needed)."]);
      lines.push(["Shift intracellular","Insulin 10 U IV + 25 g dextrose; salbutamol 10–20 mg neb; NaHCO₃ if acidotic."]);
      lines.push(["Remove K","Loop diuretic if making urine; K-binder (patiromer/SZC); dialysis if refractory/anuric."]);
      lines.push(["Recheck","K + glucose q1 h after insulin."]);
    }
    return {name:"Potassium",value:k,unit:"mEq/L",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzeMg(L,pt){
    var mg=N(L.mg); if(mg==null)return null; var renal=renalImp(pt,L);
    var lines=[],level,sev,ev=["UpToDate: Mg disorders","Harrison's"];
    if(mg>=1.7&&mg<=2.4){level="ok";sev="Normal";lines.push(["Status","Within normal range (1.7–2.4 mg/dL)."]);}
    else if(mg<1.7){
      sev=mg<1.0?"Severe hypomagnesaemia":"Hypomagnesaemia"; level=mg<1.0?"red":"amber";
      lines.push(["MgSO₄ dose", mg<1.0?"4–6 g IV over 8–24 h (severe).":"1–2 g IV (mild–moderate)."]);
      lines.push(["Infusion duration","1–2 g over 1 h; 1–2 g over 15 min if torsades / unstable arrhythmia."]);
      lines.push(["Relationship to K & Ca","Correct Mg to enable correction of refractory hypokalaemia & hypocalcaemia."]);
      lines.push(["Monitoring", renal?"RENAL IMPAIRMENT — halve dose; monitor levels & deep-tendon reflexes for hypermagnesaemia.":"Recheck level; monitor reflexes; slow if flushing/hypotension."]);
    } else {sev="Hypermagnesaemia";level="amber";lines.push(["Management","Stop Mg sources; IV calcium gluconate if symptomatic; fluids + loop diuretic; dialysis if renal failure."]);}
    return {name:"Magnesium",value:mg,unit:"mg/dL",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzeCa(L,pt){
    var ca=N(L.ca); if(ca==null)return null; var alb=N(L.alb), c=correctedCa(ca,alb);
    var lines=[],level,sev,ev=["UpToDate: Ca disorders","Harrison's"];
    lines.push(["Corrected calcium", alb!=null? c+" mg/dL (measured "+ca+", albumin "+alb+")":"albumin not entered — using measured "+ca]);
    lines.push(["Ionised calcium","If available, ionised Ca is preferred in ICU (acid–base & albumin affect total Ca)."]);
    if(c>=8.5&&c<=10.5){level="ok";sev="Normal";lines.push(["Status","Corrected Ca normal (8.5–10.5)."]);}
    else if(c<8.5){
      sev=c<7?"Severe hypocalcaemia":"Mild–moderate hypocalcaemia"; level=c<7?"red":"amber";
      lines.push(["IV indication","Symptomatic (tetany, seizures, ↑QTc, arrhythmia) or corrected <7 mg/dL."]);
      lines.push(["Calcium gluconate","10% 10–20 mL (1–2 g) IV over 10–20 min, then infusion 0.5–1.5 mg/kg/h elemental Ca. Peripheral-safe."]);
      lines.push(["Calcium chloride","10% 5–10 mL via CENTRAL line only (3× elemental Ca; vesicant) — reserve for arrest/refractory."]);
      lines.push(["Correct magnesium","Replace Mg first/concurrently — hypomagnesaemia causes refractory hypocalcaemia."]);
      lines.push(["Monitoring","Ionised Ca q4–6 h; continuous ECG if symptomatic."]);
    } else {
      sev=c>14?"Severe hypercalcaemia":c>12?"Moderate hypercalcaemia":"Mild hypercalcaemia"; level=c>14?"red":"amber";
      lines.push(["Management","IV 0.9% saline 200–300 mL/h (volume repletion), then bisphosphonate (zoledronate) ± calcitonin for rapid effect. Treat cause."]);
      lines.push(["Monitoring","Ca, renal function, fluid status."]);
    }
    return {name:"Calcium",value:(alb!=null?c:ca),unit:"mg/dL",severity:sev,level:level,lines:lines,ev:ev};
  }
  // Ionised (free) calcium — reported natively in mmol/L; NOT in CONV, so it is never unit-converted
  // (units-agnostic) and is a SEPARATE analyte from total Ca (which is mg/dL). ICU-preferred: unaffected
  // by albumin/acid–base. Normal 1.10–1.30 mmol/L.
  function analyzeICa(L,pt){
    var ica=N(L.ica); if(ica==null)return null;
    var lines=[],level,sev,ev=["UpToDate: Ca disorders","Harrison's"];
    lines.push(["Measured ionised Ca", ica+" mmol/L (ICU-preferred — not confounded by albumin/acid–base)."]);
    if(ica>=1.10&&ica<=1.30){level="ok";sev="Normal";lines.push(["Status","Ionised Ca normal (1.10–1.30 mmol/L)."]);}
    else if(ica<1.10){
      sev=ica<0.80?"Severe hypocalcaemia":ica<1.00?"Moderate hypocalcaemia":"Mild hypocalcaemia"; level=ica<0.80?"red":"amber";
      lines.push(["IV indication","Symptomatic (tetany, seizures, ↑QTc, arrhythmia) or ionised <0.80 mmol/L."]);
      lines.push(["Calcium gluconate","10% 10–20 mL (1–2 g) IV over 10–20 min, then infusion 0.5–1.5 mg/kg/h elemental Ca. Peripheral-safe."]);
      lines.push(["Calcium chloride","10% 5–10 mL via CENTRAL line only (3× elemental Ca; vesicant) — reserve for arrest/refractory."]);
      lines.push(["Correct magnesium","Replace Mg first/concurrently — hypomagnesaemia causes refractory hypocalcaemia."]);
      lines.push(["Monitoring","Repeat ionised Ca q4–6 h; continuous ECG if symptomatic."]);
    } else {
      sev=ica>1.60?"Severe hypercalcaemia":ica>1.50?"Moderate hypercalcaemia":"Mild hypercalcaemia"; level=ica>1.60?"red":"amber";
      lines.push(["Management","IV 0.9% saline 200–300 mL/h (volume repletion), then bisphosphonate (zoledronate) ± calcitonin for rapid effect. Treat cause."]);
      lines.push(["Monitoring","Ionised Ca, renal function, fluid status."]);
    }
    return {name:"Ionised calcium",value:ica,unit:"mmol/L",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzePO4(L,pt){
    var p=N(L.po4); if(p==null)return null; var wt=N(pt.weight)||70, renal=renalImp(pt,L);
    var lines=[],level,sev,ev=["UpToDate: phosphate disorders","ASPEN refeeding 2020"];
    if(p>=2.5&&p<=4.5){level="ok";sev="Normal";lines.push(["Status","Within normal range (2.5–4.5 mg/dL)."]);}
    else if(p<2.5){
      sev=p<1.5?"Severe hypophosphataemia":"Mild–moderate hypophosphataemia"; level=p<1.5?"red":"amber";
      var dose=p<1.5?r1(0.16*wt):r1(0.08*wt);
      lines.push(["Route", p<1.5?"IV (severe / symptomatic).":"Oral phosphate preferred if mild & tolerating."]);
      lines.push(["Replacement dose", (p<1.5?"0.16 mmol/kg ≈ "+dose:"0.08 mmol/kg ≈ "+dose)+" mmol IV over 6 h (Na or K phosphate)."]);
      lines.push(["Caution", renal?"RENAL IMPAIRMENT — reduce dose; monitor Ca/PO₄.":"Watch for hypocalcaemia; do not co-infuse with calcium."]);
      lines.push(["Recheck","PO₄ + Ca q6–12 h."]);
    } else {
      sev="Hyperphosphataemia";level="amber";
      lines.push(["Treatment","Treat cause (usually renal failure / tumour lysis)."]);
      lines.push(["Phosphate binders","With meals (calcium acetate, sevelamer) for chronic/dietary load."]);
      lines.push(["Dialysis","If severe + renal failure / symptomatic / tumour lysis refractory."]);
    }
    return {name:"Phosphate",value:p,unit:"mg/dL",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzeCl(L,pt){
    var cl=N(L.cl); if(cl==null)return null; var hco3=N(L.hco3), ag=anionGap(N(L.na),cl,hco3,N(L.alb));
    var lines=[],level="ok",sev="Normal",ev=["Harrison's acid–base"];
    if(cl>=98&&cl<=107){lines.push(["Status","Within normal range (98–107)."]);}
    else if(cl>107){sev="Hyperchloraemia";level="amber";
      lines.push(["Significance", (hco3!=null&&hco3<22&&ag!=null&&ag<=12)?"Hyperchloraemic (normal-AG) metabolic acidosis — GI bicarbonate loss, RTA, or saline-related.":"Often dilutional / saline-related."]);
      lines.push(["Fluid suggestion","Prefer balanced crystalloid (Ringer's lactate / Plasma-Lyte) over 0.9% saline."]);
    } else {sev="Hypochloraemia";level="amber";
      lines.push(["Significance", (hco3!=null&&hco3>28)?"With high HCO₃ → metabolic alkalosis (vomiting, NG loss, diuretics).":"May accompany hyponatraemia or alkalosis."]);
      lines.push(["Fluid suggestion","Chloride-responsive alkalosis: 0.9% saline + KCl; treat cause."]);
    }
    return {name:"Chloride",value:cl,unit:"mEq/L",severity:sev,level:level,lines:lines,ev:ev};
  }

  function analyzeHCO3(L,pt){
    var hco3=N(L.hco3); if(hco3==null)return null;
    var ph=N(L.ph), ag=anionGap(N(L.na),N(L.cl),hco3,N(L.alb)), wt=N(pt.weight)||70;
    var lines=[],level="ok",sev="Normal",ev=["Surviving Sepsis Campaign","Harrison's acid–base"];
    if(ph!=null) lines.push(["Acid–base", ph<7.35?("Acidaemia (pH "+ph+")"):ph>7.45?("Alkalaemia (pH "+ph+")"):("Normal pH ("+ph+")")]);
    if(hco3>=22&&hco3<=26){lines.push(["Status","Bicarbonate normal (22–26)."]);}
    else if(hco3<22){
      sev=hco3<10?"Severe metabolic acidosis":"Metabolic acidosis"; level=hco3<10?"red":"amber";
      lines.push(["Type", (ag!=null&&ag>12)?"High-anion-gap (AG "+ag+") — lactate, ketones, toxins, uraemia.":"Normal-anion-gap"+(ag!=null?" (AG "+ag+")":"")+" — GI/renal HCO₃ loss, RTA, saline."]);
      lines.push(["Bicarbonate therapy","Generally treat the CAUSE. Consider IV NaHCO₃ if pH <7.1 (or severe NAGMA / hyperkalaemia / specific toxins). Avoid routine use in lactic acidosis/DKA."]);
      lines.push(["Dose if indicated","HCO₃ deficit ≈ 0.5 × wt × (target − measured) = "+(ph!=null&&ph<7.1?(r0(0.5*wt*(Math.max(0,15-hco3)))+" mEq toward HCO₃ 15; give ~½, recheck"):"calculate vs target HCO₃ ~15; give ½, recheck")+"."]);
    } else {
      sev="Metabolic alkalosis"; level="amber";
      lines.push(["Type","↑HCO₃ — vomiting/NG loss, diuretics, hypokalaemia, hypovolaemia (chloride-responsive) vs mineralocorticoid excess."]);
      lines.push(["Management","Correct volume/Cl/K (0.9% saline + KCl) if chloride-responsive; treat cause."]);
    }
    return {name:"Bicarbonate",value:hco3,unit:"mEq/L",severity:sev,level:level,lines:lines,ev:ev};
  }

  function detectWarnings(L,pt){
    var W=[], na=N(L.na),k=N(L.k),mg=N(L.mg),po4=N(L.po4),ca=correctedCa(N(L.ca),N(L.alb)),hco3=N(L.hco3);
    if(na!=null&&na<125) W.push({t:"Severe hyponatraemia",d:"If symptomatic (seizure/coma): 3% saline now; cap rise ≤6–8 mEq/L/24 h."});
    if(k!=null&&k>6.0) W.push({t:"Hyperkalaemia — ECG risk",d:"Obtain ECG NOW. If changes: IV calcium → insulin/dextrose + salbutamol → remove K."});
    if(ca!=null&&ca<7) W.push({t:"Severe hypocalcaemia",d:"Risk of tetany/seizure/arrhythmia. IV calcium gluconate; correct Mg."});
    if(k!=null&&po4!=null&&ca!=null&&k>5.5&&po4>4.5&&ca<8.5) W.push({t:"Tumour lysis pattern",d:"↑K + ↑PO₄ + ↓Ca. Aggressive hydration, rasburicase/allopurinol, treat hyperK; nephrology."});
    if(po4!=null&&po4<2.5&&((k!=null&&k<3.5)||(mg!=null&&mg<1.7))) W.push({t:"Refeeding syndrome pattern",d:"↓PO₄ ± ↓K ± ↓Mg. Replace electrolytes, give thiamine, escalate calories slowly."});
    if(na!=null&&na<130&&highOdsRisk(pt,L)) W.push({t:"High osmotic-demyelination risk",d:"Strict ≤6 mEq/L/24 h; consider DDAVP clamp; re-lower if overcorrected."});
    if((k!=null&&k>=6.5&&renalImp(pt,L))||(hco3!=null&&hco3<10&&renalImp(pt,L))||(mg!=null&&mg>4&&renalImp(pt,L))) W.push({t:"Dialysis may be required",d:"Refractory/severe derangement with renal failure — discuss urgent dialysis with nephrology."});
    return W;
  }

  function detectInsights(L,pt){
    var I=[], na=N(L.na),k=N(L.k),mg=N(L.mg),po4=N(L.po4),cl=N(L.cl),hco3=N(L.hco3),ag=anionGap(N(L.na),cl,hco3,N(L.alb));
    if(mg!=null&&k!=null&&mg<1.7&&k<3.5) I.push("Hypomagnesaemia is likely contributing to refractory hypokalaemia — correct magnesium before/with potassium.");
    if(na!=null&&k!=null&&na<135&&k>5.0) I.push("Hyponatraemia + hyperkalaemia — consider adrenal insufficiency (random cortisol, ACTH stimulation).");
    if(na!=null&&na<135) I.push("Hyponatraemia — assess volume status & urine Na/osmolality: SIADH (euvolaemic, concentrated urine) vs hypovolaemia vs hypervolaemia.");
    if(k!=null&&hco3!=null&&k<3.5&&hco3>28) I.push("Hypokalaemia with metabolic alkalosis — consider diuretics, vomiting, or renal K wasting (hyperaldosteronism, Bartter/Gitelman).");
    if(ag!=null&&hco3!=null&&ag>12&&hco3<22) I.push("High-anion-gap metabolic acidosis — consider lactate, ketones, toxins, uraemia (GOLDMARK).");
    if(po4!=null&&k!=null&&mg!=null&&po4<2.5&&k<3.5&&mg<1.7) I.push("↓PO₄ + ↓K + ↓Mg, especially after starvation/malnutrition — pattern suggests refeeding syndrome.");
    return I;
  }

  function monitoringPlan(results,L,pt){
    var worst="ok"; var rank={ok:0,amber:1,red:2,crit:3};
    results.forEach(function(r){ if(rank[r.level]>rank[worst]) worst=r.level; });
    var wt=N(pt.weight)||70, na=N(L.na), k=N(L.k);
    var labs = worst==="crit"?"1–2 h":worst==="red"?"2–4 h":worst==="amber"?"6 h":"12–24 h (routine)";
    var ecgAb = (k!=null&&(k<2.5||k>6.0)) || results.some(function(r){return r.name==="Calcium"&&r.level!=="ok";});
    var ecg = ecgAb?"Continuous monitoring; 12-lead now and after each intervention":"PRN / per unit policy";
    var plan=[];
    plan.push(["Repeat labs in", labs]);
    plan.push(["Repeat ECG", ecg]);
    plan.push(["Urine output target","≥ "+r1(0.5*wt)+" mL/h (0.5 mL/kg/h)"]);
    if(na!=null&&na<135) plan.push(["Daily Na correction goal","≤ "+(highOdsRisk(pt,L)?6:8)+" mEq/L per 24 h (hard ceiling)"]);
    plan.push(["ICU checklist","Cardiac monitor • hourly fluid balance • neuro obs (hyponatraemia) • deep-tendon reflexes (Mg) • recheck per schedule • reassess after each intervention"]);
    return plan;
  }
  /*ENGINE-END*/

  var EVIDENCE = ["European Hyponatraemia Guideline 2014 (ESICM/ESE/ERA-EDTA)","KDIGO","Surviving Sepsis Campaign","UpToDate","Harrison's Principles of Internal Medicine","ASPEN (refeeding)","ICMR / ISCCM (where applicable)"];

  /* ---------------- state ---------------- */
  var S = { pt:{}, labs:{}, analyzed:false, results:null, units:"conv" };
  var root=null;

  /* ---------------- UI ---------------- */
  var PT_FIELDS = [
    {k:"weight",l:"Weight",u:"kg",t:"num"},{k:"age",l:"Age",u:"yrs",t:"num"},
    {k:"sex",l:"Sex",t:"sel",o:[["","—"],["m","Male"],["f","Female"]]},
    {k:"diagnosis",l:"Diagnosis",t:"text"},{k:"location",l:"ICU / Ward",t:"text"},
    {k:"uo",l:"Urine output",u:"mL/h",t:"num"}
  ];
  var PT_TOGGLES = [
    {k:"renal",l:"Renal failure"},{k:"dialysis",l:"Dialysis"},{k:"liver",l:"Liver disease"},
    {k:"hf",l:"Heart failure"},{k:"pregnancy",l:"Pregnancy"},{k:"ventilator",l:"Ventilator"},
    {k:"malnutrition",l:"Malnutrition / starvation"},{k:"alcohol",l:"Alcohol use"}
  ];
  var LAB_FIELDS = [
    {k:"na",l:"Na",u:"mEq/L"},{k:"k",l:"K",u:"mEq/L"},{k:"cl",l:"Cl",u:"mEq/L"},{k:"hco3",l:"HCO₃",u:"mEq/L"},
    {k:"ca",l:"Ca",u:"mg/dL"},{k:"alb",l:"Albumin",u:"g/dL"},{k:"mg",l:"Mg",u:"mg/dL"},{k:"po4",l:"PO₄",u:"mg/dL"},
    {k:"creat",l:"Creatinine",u:"mg/dL"},{k:"egfr",l:"eGFR",u:"mL/min"},{k:"glu",l:"Glucose",u:"mg/dL"},
    {k:"ph",l:"pH (ABG)",u:""},{k:"osm",l:"Osmolality",u:"mOsm/kg"}
  ];

  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

  // open() optionally PREFILLS from a patient context (e.g. ICU dashboard). prefill:
  // { labs:{na,k,ca,alb,glu,... in CONVENTIONAL units — the same units the ICU dashboard stores},
  //   pt:{weight,age,sex,diagnosis|dx,...} }. Conventional == the engine's canonical, so values are
  // stored as-is (NOT re-converted as SI — that was BUG-03, which corrupted every prefilled value).
  // Physiologically impossible values are dropped so stale/mis-mapped placeholders never appear.
  function open(prefill){
    if(prefill && (prefill.labs || prefill.pt)){
      if(prefill.labs) Object.keys(prefill.labs).forEach(function(k){ var v=parseFloat(prefill.labs[k]); if(!isNaN(v)&&inRange(k,v)) S.labs[k]=v; });
      if(prefill.pt) Object.keys(prefill.pt).forEach(function(k){ if(prefill.pt[k]!=null&&prefill.pt[k]!=="") S.pt[(k==="dx"?"diagnosis":k)]=prefill.pt[k]; });
      S.analyzed=false; S.results=null;
      if(root){ root.innerHTML=view(); bind(); }
    }
    if(root){ root.classList.add("on"); document.body.style.overflow="hidden"; return; }
    injectCSS();
    root=document.createElement("div"); root.className="ece"; root.id="eceOverlay";
    root.innerHTML = view();
    document.body.appendChild(root); document.body.style.overflow="hidden";
    bind();
    requestAnimationFrame(function(){ root.classList.add("on"); });
  }
  function close(){ if(root){ root.classList.remove("on"); document.body.style.overflow=""; } }

  function fieldCard(f, val){
    if(f.t==="sel") return '<label class="ece-f"><span>'+esc(f.l)+'</span><select data-pt="'+f.k+'">'+f.o.map(function(o){return '<option value="'+o[0]+'"'+(val===o[0]?" selected":"")+'>'+esc(o[1])+'</option>';}).join("")+'</select></label>';
    if(f.t==="text") return '<label class="ece-f"><span>'+esc(f.l)+'</span><input type="text" data-pt="'+f.k+'" value="'+esc(val)+'"></label>';
    return '<label class="ece-f"><span>'+esc(f.l)+(f.u?' <i>'+esc(f.u)+'</i>':'')+'</span><input type="number" step="any" inputmode="decimal" data-pt="'+f.k+'" value="'+esc(val)+'"></label>';
  }
  function labCard(f){
    var unit = (S.units==="si"&&CONV[f.k])? CONV[f.k].si : f.u;
    var disp = toDisplay(f.k, S.labs[f.k], S.units);
    if(disp!=null) disp = Math.round(disp*100)/100;
    return '<label class="ece-f ece-lab"><span>'+esc(f.l)+(unit?' <i>'+esc(unit)+'</i>':'')+'</span><input type="number" step="any" inputmode="decimal" data-lab="'+f.k+'" value="'+esc(disp==null?"":disp)+'"></label>';
  }

  function view(){
    return ''
    + '<div class="ece-top">'
    +   '<button class="ece-back" data-act="close">‹ ICU Dashboard</button>'
    +   '<div class="ece-bc">ICU Dashboard › <b>Electrolyte Correction</b></div>'
    + '</div>'
    + '<div class="ece-scroll" id="eceScroll">'
    +   '<header class="ece-hero"><div class="ece-h1">Electrolyte Correction Engine</div><div class="ece-sub">Evidence-based ICU electrolyte management</div></header>'
    +   '<section class="ece-sec"><h3>Patient information</h3><div class="ece-grid">'+PT_FIELDS.map(function(f){return fieldCard(f,S.pt[f.k]);}).join("")+'</div>'
    +     '<div class="ece-toggles">'+PT_TOGGLES.map(function(t){return '<button class="ece-tog'+(S.pt[t.k]?" on":"")+'" data-tog="'+t.k+'">'+esc(t.l)+'</button>';}).join("")+'</div></section>'
    +   '<section class="ece-sec"><div class="ece-sec-h"><h3>Electrolytes & labs</h3><div class="ece-units"><button data-units="conv" class="'+(S.units!=="si"?"on":"")+'">Conventional</button><button data-units="si" class="'+(S.units==="si"?"on":"")+'">SI</button></div></div><div class="ece-grid">'+LAB_FIELDS.map(function(f){return labCard(f);}).join("")+'</div></section>'
    +   '<div id="eceResults">'+(S.analyzed?results():'')+'</div>'
    +   '<div class="ece-disc">Decision support only — conservative, guideline-referenced values. Verify every dose & rate against local protocol and the clinical context. Pending clinician review.</div>'
    + '</div>'
    + '<div class="ece-cta"><button class="ece-go" data-act="analyze">Analyze & Generate ICU Recommendations</button></div>';
  }

  function disp(r){ // headline value + unit converted to the chosen unit system
    var key=NAME2KEY[r.name];
    if(S.units==="si"&&key&&typeof r.value==="number"){ return { v:Math.round(toDisplay(key,r.value,"si")*100)/100, u:CONV[key].si }; }
    return { v:r.value, u:r.unit };
  }
  // BUG (2026-08-23, WhatsApp bug report): dot() added a red/amber/green emoji circle that was
  // pure redundant decoration — .ece-chip/.ece-card/.pill already color-code by r.level via CSS
  // (border-left-color, background) — removed rather than kept as a second, AI-flavoured way of
  // saying the same thing the color already says.
  function chip(r){ var d=disp(r); return '<div class="ece-chip '+r.level+'"><span class="nm">'+esc(r.name)+'</span><span class="vl">'+esc(d.v)+'</span><span class="sv">'+esc(r.severity)+'</span></div>'; }
  function card(r){
    var d=disp(r);
    return '<div class="ece-card '+r.level+'"><div class="ece-card-h"><span>'+esc(r.name)+'</span><b>'+esc(d.v)+' '+esc(d.u)+'</b><em class="pill '+r.level+'">'+esc(r.severity)+'</em></div>'
      + r.lines.map(function(ln){return '<div class="ece-row"><span class="k">'+esc(ln[0])+'</span><span class="v">'+ln[1]+'</span></div>';}).join("")
      + (r.ev&&r.ev.length?'<div class="ece-ev">'+r.ev.map(function(e){return '<span>'+esc(e)+'</span>';}).join("")+'</div>':'')
      + '</div>';
  }

  function results(){
    var R=S.results; if(!R) return '';
    var summary='<section class="ece-sec"><h3>Clinical summary</h3><div class="ece-chips">'+R.cards.map(chip).join("")+'</div></section>';
    var warns = R.warnings.length? '<section class="ece-sec"><h3>Clinical warnings</h3>'+R.warnings.map(function(w){return '<div class="ece-warn"><div class="wt">'+esc(w.t)+'</div><div class="wd">'+esc(w.d)+'</div></div>';}).join("")+'</section>' : '';
    var engine='<section class="ece-sec"><h3>Correction engine</h3>'+R.cards.map(card).join("")+'</section>';
    var insights = R.insights.length? '<section class="ece-sec"><h3>Smart clinical insights</h3>'+R.insights.map(function(i){return '<div class="ece-ins">'+esc(i)+'</div>';}).join("")+'</section>' : '';
    var mon='<section class="ece-sec"><h3>Monitoring plan</h3><div class="ece-card ok">'+R.monitoring.map(function(m){return '<div class="ece-row"><span class="k">'+esc(m[0])+'</span><span class="v">'+esc(m[1])+'</span></div>';}).join("")+'</div></section>';
    var ev='<section class="ece-sec"><h3>Evidence</h3><div class="ece-ev big">'+EVIDENCE.map(function(e){return '<span>'+esc(e)+'</span>';}).join("")+'</div></section>';
    return summary+warns+engine+insights+mon+ev;
  }

  function analyze(){
    readInputs();
    var L=S.labs, pt=S.pt;
    var cards=[analyzeNa(L,pt),analyzeK(L,pt),analyzeCl(L,pt),analyzeHCO3(L,pt),analyzeCa(L,pt),analyzeMg(L,pt),analyzePO4(L,pt)].filter(Boolean);
    if(!cards.length){ toast("Enter at least one electrolyte value."); return; }
    var order={crit:0,red:1,amber:2,ok:3};
    cards.sort(function(a,b){return order[a.level]-order[b.level];});
    S.results={ cards:cards, warnings:detectWarnings(L,pt), insights:detectInsights(L,pt), monitoring:monitoringPlan(cards,L,pt) };
    S.analyzed=true;
    var rEl=document.getElementById("eceResults"); if(rEl){ rEl.innerHTML=results(); var sc=document.getElementById("eceScroll"); if(sc) rEl.scrollIntoView({behavior:"smooth",block:"start"}); }
  }

  function readInputs(){
    if(!root) return;
    root.querySelectorAll("[data-pt]").forEach(function(el){ var k=el.getAttribute("data-pt"); var v=el.value; S.pt[k]=(el.type==="number")?(v===""?null:parseFloat(v)):v; });
    root.querySelectorAll("[data-lab]").forEach(function(el){ var k=el.getAttribute("data-lab"); var val=(el.value===""?null:parseFloat(el.value)); S.labs[k]=toCanonical(k, val, S.units); });
  }

  function bind(){
    root.addEventListener("click",function(e){
      var b=e.target.closest("[data-act],[data-tog],[data-units]"); if(!b) return;
      if(b.hasAttribute("data-units")){ var u=b.getAttribute("data-units"); if(u!==S.units){ readInputs(); S.units=u; root.innerHTML=view(); } return; }
      if(b.hasAttribute("data-tog")){ var k=b.getAttribute("data-tog"); S.pt[k]=!S.pt[k]; b.classList.toggle("on"); return; }
      var a=b.getAttribute("data-act");
      if(a==="close") return close();
      if(a==="analyze") return analyze();
    });
  }

  var tEl,tTimer;
  function toast(m){ if(!tEl){tEl=document.createElement("div");tEl.className="ece-toast";document.body.appendChild(tEl);} tEl.textContent=m; tEl.classList.add("on"); clearTimeout(tTimer); tTimer=setTimeout(function(){tEl.classList.remove("on");},2000); }

  function injectCSS(){
    if(document.getElementById("ece-css")) return;
    var st=document.createElement("style"); st.id="ece-css";
    st.textContent=[
      ".ece{--bg:#F4F6F9;--panel:#fff;--ink:#0F172A;--mut:#64748B;--line:#E2E8F0;--tl:#0F766E;--tls:#CCFBF1;--red:#DC2626;--reds:#FEE2E2;--amb:#B45309;--ambs:#FEF3C7;--crit:#7F1D1D;--ok:#047857;--oks:#D1FAE5;--f:'Inter',-apple-system,'SF Pro Display','Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:940;background:var(--bg);color:var(--ink);font-family:var(--f);display:flex;flex-direction:column;opacity:0;transform:translateY(8px);transition:opacity .22s,transform .22s;overflow:hidden;pointer-events:none}",
      ".ece.on{opacity:1;transform:none;pointer-events:auto}",
      "body.dark .ece,body.v3-dark .ece{--bg:#0B1220;--panel:#111B2E;--ink:#E7EDF5;--mut:#8597AD;--line:#1E2B43;--tl:#2DD4BF;--tls:#0C2E2A;--reds:#3a0d0d;--ambs:#3a2a05;--oks:#06281c}",
      ".ece *{box-sizing:border-box}",
      ".ece-top{display:flex;align-items:center;gap:12px;padding:calc(14px + env(safe-area-inset-top)) 16px 14px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0}",
      ".ece-back{border:none;background:none;color:var(--tl);font:700 14px var(--f);cursor:pointer;padding:6px 8px;border-radius:8px}",
      ".ece-bc{font:600 12.5px var(--f);color:var(--mut)}.ece-bc b{color:var(--ink)}",
      ".ece-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 14px calc(96px + env(safe-area-inset-bottom))}",
      ".ece-hero{padding:22px 4px 8px}.ece-h1{font:800 24px/1.15 var(--f);letter-spacing:-.02em}.ece-sub{font:500 14px var(--f);color:var(--mut);margin-top:4px}",
      ".ece-sec{margin-top:18px}.ece-sec>h3{font:700 12px var(--f);text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 10px 2px}",
      ".ece-sec-h{display:flex;align-items:center;justify-content:space-between;gap:10px}.ece-sec-h>h3{margin:0 0 10px 2px}",
      ".ece-units{display:inline-flex;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px}",
      ".ece-units button{border:none;background:none;color:var(--mut);font:700 11.5px var(--f);padding:6px 12px;border-radius:999px;cursor:pointer}",
      ".ece-units button.on{background:var(--tl);color:#fff}",
      ".ece-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}",
      "@media(min-width:560px){.ece-grid{grid-template-columns:repeat(3,1fr)}}",
      ".ece-f{display:flex;flex-direction:column;gap:5px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;box-shadow:0 1px 2px rgba(15,23,42,.04)}",
      ".ece-f>span{font:600 12px var(--f);color:var(--mut)}.ece-f>span i{font-style:normal;opacity:.7;font-weight:500}",
      ".ece-f input,.ece-f select{border:none;background:none;font:700 17px var(--f);color:var(--ink);width:100%;outline:none;padding:2px 0}",
      ".ece-f input:focus{color:var(--tl)}",
      /* The inputs are deliberately borderless inside their card, but focus only changed the TEXT
         colour - so before you type there was no visible focus indicator at all (WCAG 2.4.7), and
         the grid read as inert boxes. Put the ring on the CARD via :focus-within: the clean look is
         kept and the active field becomes unmistakable. */
      ".ece-f:focus-within{border-color:var(--tl);box-shadow:0 0 0 3px color-mix(in srgb, var(--tl) 18%, transparent)}",
      "@media(prefers-reduced-motion:no-preference){.ece-f{transition:border-color .15s,box-shadow .15s}}",
      ".ece-toggles{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
      ".ece-tog{border:1px solid var(--line);background:var(--panel);color:var(--mut);font:600 12.5px var(--f);padding:8px 13px;border-radius:999px;cursor:pointer;transition:.15s}",
      ".ece-tog.on{background:var(--tl);color:#fff;border-color:var(--tl)}",
      ".ece-chips{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}@media(min-width:560px){.ece-chips{grid-template-columns:repeat(3,1fr)}}",
      ".ece-chip{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--mut);border-radius:14px;padding:11px 13px;display:flex;flex-direction:column;gap:2px;box-shadow:0 1px 2px rgba(15,23,42,.04)}",
      ".ece-chip .nm{font:600 12px var(--f);color:var(--mut)}.ece-chip .vl{font:800 22px var(--f);line-height:1}.ece-chip .sv{font:700 11.5px var(--f);margin-top:2px}",
      ".ece-chip.red,.ece-chip.crit{border-left-color:var(--red)}.ece-chip.amber{border-left-color:var(--amb)}.ece-chip.ok{border-left-color:var(--ok)}",
      ".ece-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 6px 18px rgba(15,23,42,.05);border-left:4px solid var(--mut)}",
      ".ece-card.red,.ece-card.crit{border-left-color:var(--red)}.ece-card.amber{border-left-color:var(--amb)}.ece-card.ok{border-left-color:var(--ok)}",
      ".ece-card-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.ece-card-h>span{font:800 16px var(--f)}.ece-card-h>b{font:700 15px var(--f);color:var(--tl)}",
      ".ece-card-h .pill{margin-left:auto;font:700 11.5px var(--f);padding:3px 9px;border-radius:999px;background:var(--line)}",
      ".pill.red,.pill.crit{background:var(--reds);color:var(--red)}.pill.amber{background:var(--ambs);color:var(--amb)}.pill.ok{background:var(--oks);color:var(--ok)}",
      ".ece-row{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line);font:500 13px/1.5 var(--f)}",
      ".ece-row .k{flex:0 0 38%;color:var(--mut);font-weight:600}.ece-row .v{flex:1;color:var(--ink)}.ece-row .v b{color:var(--ink)}",
      ".ece-ev{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.ece-ev span{font:600 10.5px var(--f);color:var(--mut);background:var(--bg);border:1px solid var(--line);padding:3px 8px;border-radius:7px}",
      ".ece-ev.big span{font-size:12px;padding:6px 11px}",
      ".ece-warn{background:var(--reds);border:1px solid var(--red);border-radius:14px;padding:12px 14px;margin-bottom:10px}.ece-warn .wt{font:800 14px var(--f);color:var(--red)}.ece-warn .wd{font:500 12.5px/1.5 var(--f);color:var(--ink);margin-top:3px}",
      ".ece-ins{background:var(--tls);border:1px solid var(--tl);border-radius:12px;padding:11px 13px;margin-bottom:8px;font:600 13px/1.5 var(--f);color:var(--ink)}",
      ".ece-disc{margin:18px 2px 8px;font:500 11.5px/1.6 var(--f);color:var(--mut)}",
      ".ece-cta{position:absolute;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(to top,var(--bg) 70%,transparent);}",
      ".ece-go{width:100%;border:none;border-radius:15px;background:var(--tl);color:#fff;font:800 16px var(--f);padding:16px;cursor:pointer;box-shadow:0 10px 30px rgba(15,118,110,.3)}",
      ".ece-go:active{transform:scale(.99)}",
      ".ece-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%) translateY(10px);background:#0F172A;color:#fff;font:600 13px var(--f);padding:11px 18px;border-radius:12px;z-index:960;opacity:0;transition:.2s;pointer-events:none}.ece-toast.on{opacity:1;transform:translateX(-50%)}"
    ].join("\n");
    document.head.appendChild(st);
  }

  // Reusable, DOM-free analysis so other surfaces (e.g. the ICU dashboard) can
  // render electrolyte correction guidance INLINE instead of opening the overlay.
  // rawL keys: na,k,cl,hco3,ca,mg,po4,glu,creat,alb (+egfr). `units` is the unit
  // system the caller stored values in ("si" = mmol/L for ca/mg/po4, g/L alb —
  // matches the ICU labs form; "conv" = conventional mg/dL, g/dL). Values are
  // converted to the analyzers' canonical (conventional) units before scoring.
  function analyzeAll(rawL, pt, units){
    rawL = rawL || {}; pt = pt || {};
    var L = {}, k;
    for (k in rawL){ if(!Object.prototype.hasOwnProperty.call(rawL,k)) continue; var _c=toCanonical(k, N(rawL[k]), units || "conv"); L[k] = inRange(k,_c)? _c : null; }   // drop physiologically-impossible inputs
    var fns = [analyzeNa, analyzeK, analyzeMg, analyzeCa, analyzeICa, analyzePO4, analyzeCl, analyzeHCO3], out = [], i, r;
    for (i=0;i<fns.length;i++){ try { r = fns[i](L, pt); if (r) out.push(r); } catch (e) {} }
    return out;
  }

  window.ELYTE = { open:open, close:close, analyze:analyzeAll, _engines:{ correctedNa:correctedNa, correctedCa:correctedCa, anionGap:anionGap, analyzeNa:analyzeNa, analyzeK:analyzeK, analyzeMg:analyzeMg, analyzeCa:analyzeCa, analyzeICa:analyzeICa, analyzePO4:analyzePO4, analyzeCl:analyzeCl, analyzeHCO3:analyzeHCO3, detectWarnings:detectWarnings, detectInsights:detectInsights, monitoringPlan:monitoringPlan } };
})();
