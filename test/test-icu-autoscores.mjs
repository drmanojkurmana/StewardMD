import { readFileSync } from "node:fs";
const src = p => readFileSync(new URL(p, import.meta.url), "utf8");
const window = {};
const document = {
  createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  getElementById: () => null, addEventListener() {}, body: { appendChild() {} }
};
new Function("window", "document", src("../calculators.js"))(window, document);
new Function("window", "document", src("../icu-autoscores.js"))(window, document);
const AS = window.ICU_AUTOSCORES, MED = window.MEDCALC;
let fail = 0;
const ok = (c, m) => { if (!c) { console.log("FAIL " + m); fail++; } else console.log("PASS " + m); };
const get = (rows, id) => rows.find(r => r.id === id);

const state = {
  patient: { age: 60, diagnosis: "severe acute pancreatitis" },
  vitals: [{ hr: 110, sbp: 95, dbp: 60, map: 72, rr: 24, spo2: 95, temp: 38.5, gcs: 14 }],
  labs: { recent: { na: 140, cl: 100, hco3: 20, alb: 3.0, plt: 90, wbc: 15, creat: 1.5, bili: 1.0, inr: 1.2, glu: 180, urea: 60, ca: 8.5, ast: 50, alt: 40 } },
  abg: { pao2: 80, fio2: 0.5 }, ventilator: { fio2: 0.5, peep: 5 }, infusions: []
};
const rows = AS.compute(state, MED);

ok(get(rows, "qsofa") && get(rows, "qsofa").value === 3, "qSOFA=3");
const bun = 60 / 2.14; ok(Math.abs(bun - 28.037) < 0.01, "BUN conversion 60/2.14");
ok(get(rows, "anion_gap") && typeof get(rows, "anion_gap").value === "number", "anion gap computed");
ok(get(rows, "corr_na") && typeof get(rows, "corr_na").value === "number", "corr_na computed");
ok(get(rows, "pf_ratio") && get(rows, "pf_ratio").value === 160, "P/F=160 (fio2 fraction->%)");
// SOFA bands: resp(P/F160,vent)=3, coag(plt90 <100)=2, liver(bili1.0)=0, cardio(MAP72,no pressor)=0, cns(GCS14)=1, renal(creat1.5)=1 => 7
ok(get(rows, "sofa") && get(rows, "sofa").value === 7, "SOFA=7 for vector");
ok(get(rows, "sofa").inputs && get(rows, "sofa").inputs.coag === 2, "computed row carries inputs (SOFA coag band=2) for pre-fill");
ok(!!get(rows, "bisap"), "BISAP present for pancreatitis diagnosis");
ok(!get(rows, "meld"), "MELD absent (diagnosis not hepatic)");

// corrected calcium (always-on): 8.5 + 0.8*(4-3.0) = 9.3
ok(get(rows, "corr_ca") && Math.abs(get(rows, "corr_ca").value - 9.3) < 0.05, "corrected calcium = 9.3");
// FIB-4 is dx-gated to liver -> absent on a pancreatitis diagnosis
ok(!get(rows, "fib4"), "FIB-4 absent (non-liver diagnosis)");

// hepatic diagnosis surfaces MELD + FIB-4
const hep = JSON.parse(JSON.stringify(state)); hep.patient.diagnosis = "decompensated cirrhosis";
const rowsH = AS.compute(hep, MED);
ok(!!get(rowsH, "meld"), "MELD present for cirrhosis diagnosis");
ok(get(rowsH, "childpugh") && get(rowsH, "childpugh").missing, "Child-Pugh greyed (needs ascites/enceph)");
// FIB-4 = (age*AST)/(plt*sqrt(ALT)) = (60*50)/(90*sqrt(40)) = 5.3
ok(get(rowsH, "fib4") && Math.abs(get(rowsH, "fib4").value - 5.3) < 0.05, "FIB-4 = 5.3 on hepatic diagnosis");

// missing path: strip labs -> anion gap greyed with needs
const bare = { patient: {}, vitals: [{}], labs: { recent: {} }, abg: {}, ventilator: {}, infusions: [] };
const rows2 = AS.compute(bare, MED);
const ag2 = get(rows2, "anion_gap");
ok(ag2 && ag2.missing && ag2.missing.length > 0, "anion gap greyed with needs when labs absent");

// cross-check: SOFA value equals a manual compute via the calculator with the same bands
const sofaCalc = MED._calcs.find(c => c.id === "sofa");
const manual = sofaCalc.compute({ resp: 3, coag: 2, liver: 0, cardio: 0, cns: 1, renal: 1 });
ok(manual.v === 7, "manual SOFA (3+2+0+0+1+1)=7 matches adapter");

// ---- APACHE II (Phase 1b): full vector, PaO2 path ----
// temp38.5=1, MAP72=0, HR110=2, RR24=0, oxy(FiO2<.5,PaO2 80>70)=0, pH7.30=2, Na140=0, K4=0,
// creat1.5=2, Hct40=0, WBC15=1, GCS14->(15-14)=1, age60=3, chronic0 => 12
const apState = {
  patient: { age: 60, diagnosis: "pneumonia" },
  vitals: [{ temp: 38.5, map: 72, hr: 110, rr: 24, gcs: 14 }],
  labs: { recent: { na: 140, k: 4.0, creat: 1.5, hct: 40, wbc: 15 } },
  abg: { ph: 7.30, pao2: 80, fio2: 0.4, paco2: 40 }, ventilator: {}, infusions: []
};
const apRows = AS.compute(apState, MED);
ok(apRows.find(r => r.id === "apache2") && apRows.find(r => r.id === "apache2").value === 12, "APACHE II = 12 (PaO2 oxygenation path)");
ok((apRows.find(r => r.id === "apache2").interp || "").indexOf("chronic organ") >= 0, "APACHE II note about chronic health/ARF present");
// pre-fill faithfulness: rows carry exact select option values + raw numbers
const apInp = apRows.find(r => r.id === "apache2").inputs;
ok(apInp && apInp.temp === "1" && apInp.gcs === 14, "APACHE inputs carry option value (temp '1') + raw GCS");
// hypothermia must map to the CORRECT band option '1b' (34-35.9), not the other 1-point band ('1')
const apHypo = JSON.parse(JSON.stringify(apState)); apHypo.vitals[0].temp = 34.5;
const apHypoRow = AS.compute(apHypo, MED).find(r => r.id === "apache2");
ok(apHypoRow && apHypoRow.inputs.temp === "1b", "APACHE hypothermia -> temp band '1b' (faithful pre-fill)");
ok(apHypoRow && apHypoRow.value === 12, "APACHE score unchanged by b-suffix (P() collapses -> still 12)");

// A-a path: FiO2 0.6, PaO2 90, PaCO2 40 -> A-a = 0.6*713 - 40/0.8 - 90 = 287.8 -> 2 pts => 14
const apState2 = JSON.parse(JSON.stringify(apState)); apState2.abg = { ph: 7.30, pao2: 90, fio2: 0.6, paco2: 40 };
const ap2 = AS.compute(apState2, MED).find(r => r.id === "apache2");
ok(ap2 && ap2.value === 14, "APACHE II = 14 (A-a gradient oxygenation path)");

// sparse data -> concise "full physiology panel" needs summary (not a 14-item list)
const apBare = AS.compute({ patient: {}, vitals: [{}], labs: { recent: {} }, abg: {}, ventilator: {}, infusions: [] }, MED).find(r => r.id === "apache2");
ok(apBare && apBare.missing && apBare.missing.length === 1 && /physiology panel/.test(apBare.missing[0]), "APACHE II sparse -> concise needs summary");

// ---- Child-Pugh (Phase 1b): computes when ascites+enceph explicitly absent ----
// bili1.0=1, alb3.0=2, inr1.2=1, ascites none=1, enceph none=1 => 6 (Class A)
const cpState = {
  patient: { diagnosis: "decompensated cirrhosis, no ascites, no encephalopathy" },
  vitals: [{}], labs: { recent: { bili: 1.0, alb: 3.0, inr: 1.2 } }, abg: {}, ventilator: {}, infusions: [], findings: []
};
const cp = AS.compute(cpState, MED).find(r => r.id === "childpugh");
ok(cp && cp.value === 6, "Child-Pugh = 6 when ascites/enceph explicitly absent");
// ungraded ascites -> stays "needs" (no fabrication)
const cpUn = AS.compute({ patient: { diagnosis: "cirrhosis with ascites" }, vitals: [{}], labs: { recent: { bili: 1.0, alb: 3.0, inr: 1.2 } }, abg: {}, ventilator: {}, infusions: [], findings: [] }, MED).find(r => r.id === "childpugh");
ok(cpUn && cpUn.missing && cpUn.missing.indexOf("ascites grade") >= 0, "Child-Pugh ungraded ascites -> needs ascites grade");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
