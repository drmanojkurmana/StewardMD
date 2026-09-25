/* test/calculators-added.test.mjs: the 14 calculators added on 2026-09-25.
 *
 *   ipss, mallampati, meows, pews, lund_browder, possum, p_possum, clavien_dindo, lrinec, esas,
 *   pps, cbac, ctg, act_asthma
 *
 * Each is checked against a worked example computed by hand from its source (the numbers are
 * written out below, not recomputed with the same formula) and against its band boundaries, so a
 * transcription slip in a threshold or coefficient fails here.
 *
 * calculators.js is a browser IIFE, so it is loaded under the same minimal window shim as
 * test/calc-find.test.mjs and driven through its public API (MEDCALC.run / get / find).
 *
 * node --test test/calculators-added.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "calculators.js"), "utf8");
const g = {
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, querySelector: () => null }), addEventListener() {}, body: { classList: { add() {}, remove() {} } }, head: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {} }, location: { search: "" }, navigator: {},
};
g.window = g; g.self = g;
vm.createContext(g);
vm.runInContext(SRC, g, { filename: "calculators.js" });
const M = g.MEDCALC;

const IDS = ["ipss", "mallampati", "meows", "pews", "lund_browder", "possum", "p_possum", "clavien_dindo",
  "lrinec", "esas", "pps", "cbac", "ctg", "act_asthma"];

/* Every input at its first option / unchecked / blank, then the overrides. This is what the UI
 * submits by default (first <option> is the browser default). */
function inputs(id, over = {}) {
  const c = M.get(id);
  const v = {};
  for (const f of c.inputs) {
    if (f.type === "select") v[f.id] = f.opts[0].v;
    else if (f.type === "check") v[f.id] = false;
    else v[f.id] = NaN;
  }
  return Object.assign(v, over);
}
const run = (id, over) => M.run(id, inputs(id, over));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ~${b}, got ${a}`);

// ── registry ────────────────────────────────────────────────────────────────────────────────────
test("all 14 are registered, top-level (id then cat), unique, with a reference", () => {
  const top = new Set([...SRC.matchAll(/\{ *id:"([a-z0-9_]+)", *cat:/g)].map((m) => m[1]));
  const all = [...SRC.matchAll(/\{ *id:"([a-z0-9_]+)", *cat:/g)].map((m) => m[1]);
  for (const id of IDS) {
    assert.ok(top.has(id), `${id} missing from the catalog`);
    assert.equal(all.filter((x) => x === id).length, 1, `${id} registered more than once`);
    const c = M.get(id);
    assert.ok(c.ref && c.ref.length > 10, `${id} has no REF entry`);
    assert.ok(Array.isArray(c.kw) && c.kw.length > 0, `${id} has no search keywords`);
  }
});

test("no em dash or en dash in any app-facing text of the new calculators", () => {
  const DASH = /[‒–—―]/;
  for (const id of IDS) {
    const c = M.get(id);
    const texts = [c.title, c.desc, c.ref, ...(c.kw || [])];
    for (const f of c.inputs) {
      texts.push(f.label, f.unit || "");
      for (const o of f.opts || []) texts.push(o.t);
    }
    for (const t of texts) assert.ok(!DASH.test(t), `${id}: dash in "${t}"`);
    const r = M.run(id, inputs(id));
    const out = r.raw.err || `${r.value} ${r.unit} ${r.interpretation}`;
    assert.ok(!DASH.test(out), `${id}: dash in default output "${out}"`);
  }
});

test("find() resolves the new calculators by name", () => {
  assert.equal(M.find("lrinec score").id, "lrinec");
  assert.equal(M.find("clavien dindo").id, "clavien_dindo");
  assert.equal(M.find("mallampati").id, "mallampati");
  assert.equal(M.find("international prostate symptom score").id, "ipss");
  assert.equal(M.find("prostate symptom score").id, "ipss");
  assert.equal(M.find("possum").id, "possum");
  assert.equal(M.find("portsmouth possum").id, "p_possum");
  assert.equal(M.find("meows").id, "meows");
  assert.equal(M.find("asthma control test").id, "act_asthma");
});

// ── IPSS ────────────────────────────────────────────────────────────────────────────────────────
test("IPSS: sums the 7 symptom items; QoL is reported but not added", () => {
  // Worked example: 1+2+1+3+2+0+1 = 10 -> moderate.
  const r = run("ipss", { q1: "1", q2: "2", q3: "1", q4: "3", q5: "2", q6: "0", q7: "1", qol: "6" });
  assert.equal(r.value, 10);
  assert.match(r.interpretation, /Moderate/);
  assert.match(r.interpretation, /Quality of life score 6 \(Terrible\)/);
  assert.equal(run("ipss", { q1: "5", q2: "5", q3: "5", q4: "5", q5: "5", q6: "5", q7: "5" }).value, 35);
});
test("IPSS: bands 0 to 7 mild, 8 to 19 moderate, 20 to 35 severe", () => {
  const tot = (n) => { const o = {}; let left = n; for (let i = 1; i <= 7; i++) { const x = Math.min(5, left); o["q" + i] = String(x); left -= x; } return run("ipss", o); };
  assert.match(tot(0).interpretation, /<b>Mild/);
  assert.match(tot(7).interpretation, /<b>Mild/);
  assert.match(tot(8).interpretation, /<b>Moderate/);
  assert.match(tot(19).interpretation, /<b>Moderate/);
  assert.match(tot(20).interpretation, /<b>Severe/);
  assert.match(tot(35).interpretation, /<b>Severe/);
});

// ── Mallampati ──────────────────────────────────────────────────────────────────────────────────
test("Mallampati: four classes with the Samsoon and Young descriptions", () => {
  const c = M.get("mallampati");
  assert.equal(c.inputs[0].opts.length, 4);
  assert.match(c.inputs[0].opts[0].t, /soft palate, fauces, uvula and pillars/);
  assert.match(c.inputs[0].opts[2].t, /base of uvula/);
  assert.match(c.inputs[0].opts[3].t, /soft palate not visible/);
  assert.equal(run("mallampati", { cls: "1" }).value, "Class I");
  assert.match(run("mallampati", { cls: "2" }).interpretation, /easier laryngoscopy/);
  assert.match(run("mallampati", { cls: "3" }).interpretation, /difficult laryngoscopy/);
  assert.equal(run("mallampati", { cls: "4" }).value, "Class IV");
  // The Cochrane accuracy figures travel with every result.
  assert.match(run("mallampati", { cls: "1" }).interpretation, /0\.51.*0\.87/);
  assert.ok(run("mallampati", { cls: "9" }).raw.err);
});

// ── MEOWS (CEMACH chart, Singh 2012) ────────────────────────────────────────────────────────────
const NORMAL_OBS = { temp: 37, sbp: 120, dbp: 80, hr: 80, rr: 16, spo2: 98, pain: "0", avpu: "a" };
const meows = (over) => {
  const r = run("meows", Object.assign({}, NORMAL_OBS, over));
  const m = /^(\d+) red, (\d+) yellow$/.exec(r.value);
  assert.ok(m, `unexpected MEOWS value ${r.value}`);
  return { red: +m[1], yel: +m[2], trig: /Trigger met/.test(r.interpretation), r };
};
test("MEOWS: one red or two yellow triggers, one yellow does not", () => {
  assert.deepEqual((({ red, yel, trig }) => ({ red, yel, trig }))(meows({})), { red: 0, yel: 0, trig: false });
  assert.equal(meows({ hr: 105 }).trig, false, "a single yellow is not a trigger");
  const two = meows({ hr: 105, rr: 22 });
  assert.equal(two.yel, 2); assert.equal(two.trig, true);
  const red = meows({ spo2: 94 });
  assert.equal(red.red, 1); assert.equal(red.trig, true);
  assert.ok(run("meows", { temp: 37 }).raw.err, "missing observations are refused");
});
test("MEOWS: every red and yellow boundary on the chart", () => {
  const band = (over) => { const x = meows(over); return x.red ? "red" : x.yel ? "yellow" : "none"; };
  // Temperature: red <35 or >38, yellow 35 to 36.
  assert.equal(band({ temp: 34.9 }), "red"); assert.equal(band({ temp: 35 }), "yellow");
  assert.equal(band({ temp: 36 }), "yellow"); assert.equal(band({ temp: 36.1 }), "none");
  assert.equal(band({ temp: 38 }), "none"); assert.equal(band({ temp: 38.1 }), "red");
  // Systolic: red <90 or >160, yellow 150 to 160 or 90 to 100.
  assert.equal(band({ sbp: 89 }), "red"); assert.equal(band({ sbp: 90 }), "yellow");
  assert.equal(band({ sbp: 100 }), "yellow"); assert.equal(band({ sbp: 101 }), "none");
  assert.equal(band({ sbp: 149 }), "none"); assert.equal(band({ sbp: 150 }), "yellow");
  assert.equal(band({ sbp: 160 }), "yellow"); assert.equal(band({ sbp: 161 }), "red");
  // Diastolic: red >100, yellow 90 to 100.
  assert.equal(band({ dbp: 89 }), "none"); assert.equal(band({ dbp: 90 }), "yellow");
  assert.equal(band({ dbp: 100 }), "yellow"); assert.equal(band({ dbp: 101 }), "red");
  // Heart rate: red <40 or >120, yellow 100 to 120 or 40 to 50.
  assert.equal(band({ hr: 39 }), "red"); assert.equal(band({ hr: 40 }), "yellow");
  assert.equal(band({ hr: 50 }), "yellow"); assert.equal(band({ hr: 51 }), "none");
  assert.equal(band({ hr: 99 }), "none"); assert.equal(band({ hr: 100 }), "yellow");
  assert.equal(band({ hr: 120 }), "yellow"); assert.equal(band({ hr: 121 }), "red");
  // Respiratory rate: red <10 or >30, yellow 21 to 30.
  assert.equal(band({ rr: 9 }), "red"); assert.equal(band({ rr: 10 }), "none");
  assert.equal(band({ rr: 20 }), "none"); assert.equal(band({ rr: 21 }), "yellow");
  assert.equal(band({ rr: 30 }), "yellow"); assert.equal(band({ rr: 31 }), "red");
  // SpO2: red <95, no yellow band.
  assert.equal(band({ spo2: 95 }), "none"); assert.equal(band({ spo2: 94 }), "red");
  // Pain 2 to 3 yellow; AVPU voice yellow, pain or unresponsive red.
  assert.equal(band({ pain: "1" }), "none"); assert.equal(band({ pain: "2" }), "yellow"); assert.equal(band({ pain: "3" }), "yellow");
  assert.equal(band({ avpu: "v" }), "yellow"); assert.equal(band({ avpu: "p" }), "red"); assert.equal(band({ avpu: "u" }), "red");
});

// ── Brighton PEWS ───────────────────────────────────────────────────────────────────────────────
test("PEWS: domain sum plus 2 each for nebulisers and post-operative vomiting (0 to 13)", () => {
  assert.equal(run("pews", {}).value, 0);
  assert.equal(run("pews", { beh: "1", cvs: "2", resp: "1" }).value, 4);
  assert.equal(run("pews", { neb: true }).value, 2);
  assert.equal(run("pews", { neb: true, vom: true }).value, 4);
  assert.equal(run("pews", { beh: "3", cvs: "3", resp: "3", neb: true, vom: true }).value, 13);
});
test("PEWS: critical at a total of 4 or more, or 3 in any single domain (Akre 2010)", () => {
  assert.doesNotMatch(run("pews", { beh: "1", cvs: "1", resp: "1" }).interpretation, /Critical PEWS/, "3 spread out is not critical");
  assert.match(run("pews", { beh: "2", cvs: "1", resp: "1" }).interpretation, /Critical PEWS/, "total 4");
  assert.match(run("pews", { resp: "3" }).interpretation, /Critical PEWS/, "a lone 3 is critical even at total 3");
  assert.match(run("pews", { vom: true, neb: true }).interpretation, /Critical PEWS/, "4 from the extras alone");
  assert.doesNotMatch(run("pews", { neb: true, beh: "1" }).interpretation, /Critical PEWS/, "total 3");
});

// ── Lund and Browder + Parkland ─────────────────────────────────────────────────────────────────
const ALL_REGIONS = ["head", "neck", "atrunk", "ptrunk", "rbut", "lbut", "gen", "rua", "lua", "rfa", "lfa", "rhand", "lhand", "rthigh", "lthigh", "rleg", "lleg", "rfoot", "lfoot"];
test("Lund and Browder: every age column totals exactly 100% when every region is burned", () => {
  for (const age of ["0", "1", "5", "10", "15", "adult"]) {
    const o = { age }; for (const k of ALL_REGIONS) o[k] = 100;
    assert.equal(run("lund_browder", o).value, 100, `age column ${age}`);
  }
});
test("Lund and Browder: the age-dependent head, thigh and leg values", () => {
  // Head = 2 x A: 19, 17, 13, 11, 9, 7.
  const head = { "0": 19, "1": 17, "5": 13, "10": 11, "15": 9, adult: 7 };
  for (const [age, v] of Object.entries(head)) assert.equal(run("lund_browder", { age, head: 100 }).value, v, `head at ${age}`);
  // One thigh = 2 x B: 5.5, 6.5, 8, 8.5, 9, 9.5. One lower leg = 2 x C: 5, 5, 5.5, 6, 6.5, 7.
  const thigh = { "0": 5.5, "1": 6.5, "5": 8, "10": 8.5, "15": 9, adult: 9.5 };
  const leg = { "0": 5, "1": 5, "5": 5.5, "10": 6, "15": 6.5, adult: 7 };
  for (const age of Object.keys(thigh)) {
    assert.equal(run("lund_browder", { age, rthigh: 100 }).value, thigh[age], `thigh at ${age}`);
    assert.equal(run("lund_browder", { age, lleg: 100 }).value, leg[age], `leg at ${age}`);
  }
  // Fixed regions: a hand is 2.5% (1.25 per side, not the mis-copied 1.5), a foot 3.5%.
  assert.equal(run("lund_browder", { age: "adult", rhand: 100, lhand: 100 }).value, 5);
  assert.equal(run("lund_browder", { age: "5", rfoot: 100 }).value, 3.5);
});
test("Lund and Browder: worked example with the Parkland estimate", () => {
  // Adult, whole anterior trunk (13) + half the right upper arm (2) = 15% TBSA; 70 kg.
  // Parkland 4 x 70 x 15 = 4200 mL in 24 h, 2100 mL in the first 8 h.
  const r = run("lund_browder", { age: "adult", wt: 70, atrunk: 100, rua: 50 });
  assert.equal(r.value, 15);
  assert.match(r.interpretation, /4200 mL/);
  assert.match(r.interpretation, /half \(2100 mL\) in the first 8 h/);
  assert.match(run("lund_browder", { age: "adult", atrunk: 100 }).interpretation, /Enter weight/);
  assert.ok(run("lund_browder", { atrunk: 100 }).raw.err, "no age column chosen");
  assert.ok(run("lund_browder", { age: "adult", atrunk: 120 }).raw.err, "over 100% of a region");
});

// ── POSSUM / P-POSSUM ───────────────────────────────────────────────────────────────────────────
const FIT = { age: 45, sbp: 120, hr: 70, gcs: 15, hb: 14, wcc: 7, urea: 5, na: 140, k: 4.2, ebl: 50 };
const scores = (r) => {
  const m = /Physiological score <b>(\d+)<\/b>.*operative severity score <b>(\d+)<\/b>/.exec(r.interpretation);
  assert.ok(m, "scores not shown"); return { ps: +m[1], os: +m[2] };
};
const psOf = (over) => scores(run("possum", Object.assign({}, FIT, over))).ps;
test("POSSUM: lowest possible scores (PS 12, OS 6) and the equations", () => {
  const r = run("possum", FIT);
  assert.deepEqual(scores(r), { ps: 12, os: 6 });
  // Morbidity logit -5.91 + 0.16x12 + 0.19x6 = -2.85 -> 5.47%; mortality -7.04 + 1.56 + 0.96 = -4.52 -> 1.08%.
  near(r.value, 5.5, 0.05, "morbidity");
  assert.match(r.interpretation, /predicted mortality 1\.1%/);
  // P-POSSUM -9.065 + 0.1692x12 + 0.155x6 = -6.1046 -> 0.22%.
  near(run("p_possum", FIT).value, 0.2, 0.05, "P-POSSUM floor");
  assert.ok(run("possum", { age: 45 }).raw.err, "missing values refused");
});
test("POSSUM: worked example (hand-computed)", () => {
  // PS: age 72 (4) + cardiac 2 + resp 1 + SBP 100 (2) + pulse 105 (4) + GCS 15 (1) + Hb 11 (4)
  //     + WCC 12 (2) + urea 8 (2) + Na 134 (2) + K 3.3 (2) + ECG normal (1) = 27
  // OS: major (4) + 1 procedure (1) + 600 mL (4) + local pus (4) + primary (2) + emergency <24 h (4) = 19
  const v = { age: 72, cardiac: "2", sbp: 100, hr: 105, gcs: 15, hb: 11, wcc: 12, urea: 8, na: 134, k: 3.3,
    sev: "4", ebl: 600, soil: "4", malig: "2", mode: "4" };
  const r = run("possum", v);
  assert.deepEqual(scores(r), { ps: 27, os: 19 });
  near(r.value, 88.3, 0.05, "morbidity: logit 2.02");                         // 1/(1+e^-2.02)
  assert.match(r.interpretation, /predicted mortality 38%/);                    // logit -0.49 -> 37.99%
  near(run("p_possum", v).value, 17.5, 0.05, "P-POSSUM: logit -1.5516");     // 1/(1+e^1.5516)
});
test("POSSUM: maximum scores are 88 and 48", () => {
  const v = { age: 80, cardiac: "8", resp: "8", sbp: 80, hr: 130, gcs: 3, hb: 8, wcc: 25, urea: 20, na: 120, k: 6.5,
    ecg: "8", sev: "8", multi: "8", ebl: 1500, soil: "8", malig: "8", mode: "8" };
  assert.deepEqual(scores(run("possum", v)), { ps: 88, os: 48 });
});
test("POSSUM: physiological band edges", () => {
  const base = psOf({});
  const d = (over) => psOf(over) - base + 1;   // points for the changed variable
  assert.equal(d({ age: 60 }), 1); assert.equal(d({ age: 61 }), 2); assert.equal(d({ age: 70 }), 2); assert.equal(d({ age: 71 }), 4);
  assert.equal(d({ sbp: 130 }), 1); assert.equal(d({ sbp: 131 }), 2); assert.equal(d({ sbp: 170 }), 2); assert.equal(d({ sbp: 171 }), 4);
  assert.equal(d({ sbp: 110 }), 1); assert.equal(d({ sbp: 109 }), 2); assert.equal(d({ sbp: 100 }), 2); assert.equal(d({ sbp: 99 }), 4);
  assert.equal(d({ sbp: 90 }), 4); assert.equal(d({ sbp: 89 }), 8);
  assert.equal(d({ hr: 80 }), 1); assert.equal(d({ hr: 81 }), 2); assert.equal(d({ hr: 100 }), 2); assert.equal(d({ hr: 101 }), 4);
  assert.equal(d({ hr: 120 }), 4); assert.equal(d({ hr: 121 }), 8); assert.equal(d({ hr: 49 }), 2); assert.equal(d({ hr: 40 }), 2); assert.equal(d({ hr: 39 }), 8);
  assert.equal(d({ gcs: 14 }), 2); assert.equal(d({ gcs: 12 }), 2); assert.equal(d({ gcs: 11 }), 4); assert.equal(d({ gcs: 9 }), 4); assert.equal(d({ gcs: 8 }), 8);
  assert.equal(d({ hb: 13 }), 1); assert.equal(d({ hb: 16 }), 1); assert.equal(d({ hb: 12.9 }), 2); assert.equal(d({ hb: 11.5 }), 2);
  assert.equal(d({ hb: 16.1 }), 2); assert.equal(d({ hb: 17 }), 2); assert.equal(d({ hb: 11.4 }), 4); assert.equal(d({ hb: 10 }), 4);
  assert.equal(d({ hb: 17.1 }), 4); assert.equal(d({ hb: 18 }), 4); assert.equal(d({ hb: 9.9 }), 8); assert.equal(d({ hb: 18.1 }), 8);
  assert.equal(d({ wcc: 10 }), 1); assert.equal(d({ wcc: 10.1 }), 2); assert.equal(d({ wcc: 20 }), 2); assert.equal(d({ wcc: 20.1 }), 4);
  assert.equal(d({ wcc: 4 }), 1); assert.equal(d({ wcc: 3.1 }), 2); assert.equal(d({ wcc: 3 }), 4);
  assert.equal(d({ urea: 7.5 }), 1); assert.equal(d({ urea: 7.6 }), 2); assert.equal(d({ urea: 10 }), 2); assert.equal(d({ urea: 10.1 }), 4);
  assert.equal(d({ urea: 15 }), 4); assert.equal(d({ urea: 15.1 }), 8);
  assert.equal(d({ na: 136 }), 1); assert.equal(d({ na: 135 }), 2); assert.equal(d({ na: 131 }), 2); assert.equal(d({ na: 130 }), 4);
  assert.equal(d({ na: 126 }), 4); assert.equal(d({ na: 125 }), 8);
  assert.equal(d({ k: 3.5 }), 1); assert.equal(d({ k: 5 }), 1); assert.equal(d({ k: 3.4 }), 2); assert.equal(d({ k: 3.2 }), 2);
  assert.equal(d({ k: 5.1 }), 2); assert.equal(d({ k: 5.3 }), 2); assert.equal(d({ k: 3.1 }), 4); assert.equal(d({ k: 2.9 }), 4);
  assert.equal(d({ k: 5.4 }), 4); assert.equal(d({ k: 5.9 }), 4); assert.equal(d({ k: 2.8 }), 8); assert.equal(d({ k: 6 }), 8);
});
test("POSSUM: operative blood-loss edges and urea unit conversion", () => {
  const os = (ebl) => scores(run("possum", Object.assign({}, FIT, { ebl }))).os - 5;
  assert.equal(os(100), 1); assert.equal(os(101), 2); assert.equal(os(500), 2); assert.equal(os(501), 4);
  assert.equal(os(999), 4); assert.equal(os(1000), 8);
  // BUN 21 mg/dL = 7.5 mmol/L (1 point); BUN 22.4 = 8.0 (2). Urea 45 mg/dL = 7.49 (1); 46 = 7.66 (2).
  assert.equal(psOf({ urea: 21, urea_u: "bun" }), 12);
  assert.equal(psOf({ urea: 22.4, urea_u: "bun" }), 13);
  assert.equal(psOf({ urea: 45, urea_u: "mgdl" }), 12);
  assert.equal(psOf({ urea: 46, urea_u: "mgdl" }), 13);
});

// ── Clavien-Dindo ───────────────────────────────────────────────────────────────────────────────
test("Clavien-Dindo: grades, definitions and the d suffix", () => {
  const grades = Array.from(M.get("clavien_dindo").inputs[0].opts, (o) => o.v);
  assert.deepEqual(grades, ["I", "II", "IIIa", "IIIb", "IVa", "IVb", "V"]);
  assert.match(run("clavien_dindo", { g: "I" }).interpretation, /wound infections opened at the bedside/);
  assert.match(run("clavien_dindo", { g: "II" }).interpretation, /Blood transfusions and total parenteral nutrition/);
  assert.match(run("clavien_dindo", { g: "IIIa" }).interpretation, /not under general anaesthesia/);
  assert.match(run("clavien_dindo", { g: "IIIb" }).interpretation, /under general anaesthesia/);
  assert.match(run("clavien_dindo", { g: "IVa" }).interpretation, /single organ dysfunction \(including dialysis\)/);
  assert.match(run("clavien_dindo", { g: "IVb" }).interpretation, /multiorgan dysfunction/);
  assert.equal(run("clavien_dindo", { g: "IIIb", d: true }).value, "Grade IIIb-d");
  assert.equal(run("clavien_dindo", { g: "V", d: true }).value, "Grade V", "no suffix on death");
});

// ── LRINEC ──────────────────────────────────────────────────────────────────────────────────────
test("LRINEC: points and the 5 / 6 / 8 risk boundaries (Wong 2004)", () => {
  // Worked example: CRP >=150 (4) + WBC 15 to 25 (1) + Hb <11 (2) + Na <135 (2) = 9 -> high.
  const ex = run("lrinec", { crp: true, wbc: "1", hb: "2", na: true });
  assert.equal(ex.value, 9); assert.match(ex.interpretation, /High risk/);
  assert.equal(run("lrinec", { crp: true, wbc: "2", hb: "2", na: true, cr: true, glu: true }).value, 13);
  assert.match(run("lrinec", {}).interpretation, /Low risk/);
  assert.match(run("lrinec", { crp: true, glu: true }).interpretation, /Low risk/);            // 5
  assert.match(run("lrinec", { crp: true, na: true }).interpretation, /Intermediate risk/);    // 6
  assert.match(run("lrinec", { crp: true, na: true, glu: true }).interpretation, /Intermediate risk/); // 7
  assert.match(run("lrinec", { crp: true, na: true, cr: true }).interpretation, /High risk/);  // 8
});

// ── ESAS-r ──────────────────────────────────────────────────────────────────────────────────────
test("ESAS-r: total of 9 items and items of 7 or more flagged", () => {
  const v = { pain: 8, tired: 6, drowsy: 3, nausea: 0, appetite: 7, sob: 2, depress: 4, anx: 1, well: 5 };  // 36
  const r = run("esas", v);
  assert.equal(r.value, 36);
  assert.match(r.interpretation, /Severe \(7 or more\)<\/b>: pain 8, lack of appetite 7\./);
  assert.match(r.interpretation, /Moderate \(4 to 6\): tiredness 6, depression 4, wellbeing 5/);
  const none = run("esas", { pain: 6, tired: 0, drowsy: 0, nausea: 0, appetite: 0, sob: 0, depress: 0, anx: 0, well: 0 });
  assert.match(none.interpretation, /No item scored 7 or more/);
  assert.ok(run("esas", { pain: 3 }).raw.err, "all nine items required");
  assert.ok(run("esas", Object.assign({}, v, { pain: 11 })).raw.err, "out of range refused");
});

// ── PPSv2 ───────────────────────────────────────────────────────────────────────────────────────
test("PPSv2: 11 levels in 10% steps with the Victoria Hospice row descriptions", () => {
  const opts = Array.from(M.get("pps").inputs[0].opts, (o) => o.v);
  assert.deepEqual(opts, ["100", "90", "80", "70", "60", "50", "40", "30", "20", "10", "0"]);
  // Example 1 of the PPSv2 instructions is scored at PPS 50%.
  const r50 = run("pps", { lvl: "50" });
  assert.equal(r50.value, "PPS 50%");
  assert.match(r50.interpretation, /Ambulation: Mainly sit\/lie\. .*Self-care: Considerable assistance required/);
  assert.match(run("pps", { lvl: "10" }).interpretation, /Intake: Mouth care only\. Conscious level: Drowsy or coma \+\/- confusion/);
  assert.match(run("pps", { lvl: "60" }).interpretation, /Occasional assistance necessary/);
  assert.match(run("pps", { lvl: "0" }).interpretation, /Death/);
});

// ── CBAC Part A ─────────────────────────────────────────────────────────────────────────────────
const CB = { age: 35, sex: "f", waist: 75 };   // 1 point (age 30 to 39)
test("CBAC: worked example and the 'score above 4' threshold", () => {
  // Age 45 (2) + daily tobacco (2) + no alcohol (0) + woman waist 85 (1) + <150 min activity (1) + family history (2) = 8.
  const r = run("cbac", { age: 45, tob: "2", sex: "f", waist: 85, pa: "1", fh: "2" });
  assert.equal(r.value, 8); assert.match(r.interpretation, /Score above 4/);
  const four = run("cbac", Object.assign({}, CB, { age: 45, fh: "2" }));        // 2 + 2 = 4
  assert.equal(four.value, 4); assert.match(four.interpretation, /4 or less/);
  const five = run("cbac", Object.assign({}, CB, { age: 45, fh: "2", alc: "1" })); // 5
  assert.equal(five.value, 5); assert.match(five.interpretation, /Score above 4/);
});
test("CBAC: age and waist bands from the official form", () => {
  const ageP = (age) => run("cbac", { age, sex: "f", waist: 70 }).value;
  assert.equal(ageP(29), 0); assert.equal(ageP(30), 1); assert.equal(ageP(39), 1); assert.equal(ageP(40), 2);
  assert.equal(ageP(49), 2); assert.equal(ageP(50), 3); assert.equal(ageP(59), 3); assert.equal(ageP(60), 4);
  const w = (sex, waist) => run("cbac", { age: 20, sex, waist }).value;
  assert.equal(w("f", 80), 0); assert.equal(w("f", 81), 1); assert.equal(w("f", 90), 1); assert.equal(w("f", 91), 2);
  assert.equal(w("m", 90), 0); assert.equal(w("m", 91), 1); assert.equal(w("m", 100), 1); assert.equal(w("m", 101), 2);
  assert.ok(run("cbac", { age: 40, waist: 85 }).raw.err, "sex must be chosen: the waist bands differ");
});

// ── CTG (FIGO 2015) ─────────────────────────────────────────────────────────────────────────────
test("CTG: FIGO 2015 normal / suspicious / pathological", () => {
  const cls = (over) => run("ctg", over).value;
  assert.equal(cls({}), "Normal");
  assert.equal(cls({ acc: "n" }), "Normal", "absent accelerations alone do not change the class");
  // Suspicious: lacks a feature of normality with no pathological feature.
  assert.equal(cls({ base: "hi" }), "Suspicious");
  assert.equal(cls({ base: "lo" }), "Suspicious");
  assert.equal(cls({ vari: "s" }), "Suspicious");
  assert.equal(cls({ dec: "s" }), "Suspicious");
  // Pathological features.
  assert.equal(cls({ base: "p" }), "Pathological");
  assert.equal(cls({ vari: "red" }), "Pathological");
  assert.equal(cls({ vari: "inc" }), "Pathological");
  assert.equal(cls({ sin: true }), "Pathological");
  assert.equal(cls({ dec: "p30" }), "Pathological");
  assert.equal(cls({ dec: "p20" }), "Pathological");
  assert.equal(cls({ dec: "p5" }), "Pathological");
  assert.equal(cls({ base: "hi", dec: "p5" }), "Pathological", "any pathological feature wins");
  assert.match(run("ctg", { base: "p" }).interpretation, /high probability of having hypoxia\/acidosis/);
  assert.match(run("ctg", { base: "hi" }).interpretation, /low probability of having hypoxia\/acidosis/);
  assert.match(run("ctg", { acc: "n" }).interpretation, /uncertain significance/);
});

// ── Asthma Control Test ─────────────────────────────────────────────────────────────────────────
test("ACT: 25 total control, 20 to 24 well controlled, 19 or less not well controlled", () => {
  const act = (...q) => run("act_asthma", { q1: String(q[0]), q2: String(q[1]), q3: String(q[2]), q4: String(q[3]), q5: String(q[4]) });
  assert.equal(act(5, 5, 5, 5, 5).value, 25); assert.match(act(5, 5, 5, 5, 5).interpretation, /Total control/);
  assert.match(act(5, 5, 5, 5, 4).interpretation, /<b>Well controlled/);          // 24
  assert.match(act(4, 4, 4, 4, 4).interpretation, /<b>Well controlled/);          // 20
  const n19 = act(4, 4, 4, 4, 3);
  assert.equal(n19.value, 19); assert.match(n19.interpretation, /<b>Not well controlled/);
  assert.equal(act(1, 1, 1, 1, 1).value, 5);
  assert.ok(run("act_asthma", { q1: "0" }).raw.err, "item outside 1 to 5 refused");
});
