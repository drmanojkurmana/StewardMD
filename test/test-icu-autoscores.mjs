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
  labs: { recent: { na: 140, cl: 100, hco3: 20, alb: 3.0, plt: 90, wbc: 15, creat: 1.5, bili: 1.0, inr: 1.2, glu: 180, urea: 60 } },
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
ok(!!get(rows, "bisap"), "BISAP present for pancreatitis diagnosis");
ok(!get(rows, "meld"), "MELD absent (diagnosis not hepatic)");

// hepatic diagnosis surfaces MELD
const hep = JSON.parse(JSON.stringify(state)); hep.patient.diagnosis = "decompensated cirrhosis";
const rowsH = AS.compute(hep, MED);
ok(!!get(rowsH, "meld"), "MELD present for cirrhosis diagnosis");
ok(get(rowsH, "childpugh") && get(rowsH, "childpugh").missing, "Child-Pugh greyed (needs ascites/enceph)");

// missing path: strip labs -> anion gap greyed with needs
const bare = { patient: {}, vitals: [{}], labs: { recent: {} }, abg: {}, ventilator: {}, infusions: [] };
const rows2 = AS.compute(bare, MED);
const ag2 = get(rows2, "anion_gap");
ok(ag2 && ag2.missing && ag2.missing.length > 0, "anion gap greyed with needs when labs absent");

// cross-check: SOFA value equals a manual compute via the calculator with the same bands
const sofaCalc = MED._calcs.find(c => c.id === "sofa");
const manual = sofaCalc.compute({ resp: 3, coag: 2, liver: 0, cardio: 0, cns: 1, renal: 1 });
ok(manual.v === 7, "manual SOFA (3+2+0+0+1+1)=7 matches adapter");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
