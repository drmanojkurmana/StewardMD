/* Neonatal layer engines against the shipped, quoted data (data/neo/*.json).
 * Where a test checks a number, the number is read from the data file, not typed here, so the test
 * proves the engine applies the source; arithmetic identities use made-up inputs.
 *
 * node --test test/neo-engines.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const load = (f) => { const m = { exports: {} }; new Function("module", "window", readFileSync(new URL("../" + f, import.meta.url), "utf8"))(m, undefined); return m.exports; };
const P = load("neo-patient.js");            // also sets globalThis.SMD_NEO_ENGINE for the others
const DOSE = load("neo-dose.js"), PREP = load("neo-prep.js"), INF = load("neo-infusions.js"), FL = load("neo-fluids.js");
const GR = load("neo-growth.js"), PROC = load("neo-proc.js"), TDM = load("neo-tdm.js"), DC = load("dose-calc.js");
const J = (f) => JSON.parse(readFileSync(new URL("../data/neo/" + f + ".json", import.meta.url), "utf8"));
const bands = DOSE.indexDrugs([J("dose-bands-ai"), J("dose-bands-other")]);
const baby = (o, now) => P.derive(Object.assign({ gaW: 30, gaD: 2, dob: "2026-06-01", tob: "08:00", weightG: 1250, birthWeightG: 1180, sex: "F" }, o), now || "2026-06-05T14:00");
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("band matching: completed weeks for GA, elapsed time for PNA, units as the band states", () => {
  const E = P;
  const d = baby({ gaW: 34, gaD: 5 });
  const ctx = E.context(d);
  assert.equal(ctx.ga_wk, 34, "34+5 is a 34 week baby (never rounded up)");
  assert.equal(E.matches({ ga_wk: { max: 34 } }, ctx).ok, true);
  assert.equal(E.matches({ ga_wk: { gt: 34 } }, ctx).ok, false);
  assert.equal(E.matches({ wt: { lt: 2, unit: "kg" } }, ctx).ok, true);
  assert.equal(E.matches({ wt: { lt: 1000 } }, ctx).ok, false);
  const d8 = baby({}, "2026-06-09T08:00");       // exactly 8 days
  assert.equal(E.matches({ pna_wk: { max: 1 } }, E.context(d8)).ok, false, "8 days is more than one week");
  assert.equal(E.matches({ life_week: "after_first" }, E.context(d8)).ok, true);
  assert.equal(E.matches({ pna_d: { max: 7 } }, E.context(baby({}, "2026-06-08T07:59"))).ok, true);
  const unknown = E.matches({ ga_wk: { max: 34 } }, E.context(P.derive({ weightG: 1000 }, "2026-06-05T14:00")));
  assert.equal(unknown.ok, null); assert.deepEqual(unknown.needs, ["gestation at birth"]);
  assert.equal(E.matches({ made_up: { max: 1 } }, ctx).ok, null, "a key the engine cannot read is never treated as a match");
});

test("dose bands: per-kg amounts come from the band row and the record weight", () => {
  const caf = DOSE.findIn(bands, "caffeine");
  assert.ok(caf, "caffeine citrate on file");
  const r = DOSE.compute(caf, baby({}));
  const hits = r.regimens.flatMap((R) => R.hits);
  assert.ok(hits.length >= 1);
  for (const h of hits) {
    const dz = h.band.dose;
    if (dz.per === "kg" && dz.lo != null && h.amt.perDose) assert.ok(close(h.amt.perDose.lo, Math.round(dz.lo * 1.25 * 100) / 100, 0.01), h.band.label);
  }
});

test("dose bands: GA/PNA table picks exactly the row the source gives (ampicillin, meropenem)", () => {
  for (const name of ["ampicillin", "meropenem"]) {
    const drug = DOSE.findIn(bands, name); assert.ok(drug, name);
    const preterm = DOSE.compute(drug, baby({ gaW: 28, gaD: 0 }, "2026-06-04T08:00"));
    const term = DOSE.compute(drug, baby({ gaW: 39, gaD: 0 }, "2026-06-04T08:00"));
    const lab = (r) => r.regimens[0].hits.map((h) => h.band.label).join("|");
    assert.notEqual(lab(preterm), lab(term), name + ": preterm and term fall in different rows");
    for (const r of [preterm, term]) for (const h of r.regimens[0].hits) assert.equal(P.matches(h.band.when, P.context(r === preterm ? baby({ gaW: 28, gaD: 0 }, "2026-06-04T08:00") : baby({ gaW: 39, gaD: 0 }, "2026-06-04T08:00"))).ok, true);
  }
});

test("a drug with no neonatal row says so; eligibility windows exclude (indomethacin, ibuprofen lysine)", () => {
  const dob = DOSE.findIn(bands, "dobutamine");
  if (dob) assert.equal(DOSE.compute(dob, baby({})).none, true);
  const ibu = DOSE.findIn(bands, "ibuprofen lysine");
  assert.ok(ibu);
  const big = DOSE.compute(ibu, baby({ gaW: 39, birthWeightG: 3400, weightG: 3300 }));
  assert.ok(big.regimens.some((R) => R.eligible === false), "a term 3.4 kg baby is outside the source's window");
  assert.equal(DOSE.NO_DOSE, "No neonatal dose on file. Do not extrapolate.");
});

test("tenfold guard: more than 2 x the band maximum is a hard stop; above the band warns", () => {
  const amt = { unit: "mg", perDose: { lo: 25, hi: 25 } };
  assert.equal(DOSE.guard(25, amt).level, "ok");
  assert.equal(DOSE.guard(30, amt).level, "warn");
  assert.equal(DOSE.guard(51, amt).level, "stop");
  assert.equal(DOSE.guard(250, amt).level, "stop", "the classic tenfold slip");
  assert.equal(DOSE.guard(2.5, amt).level, "low");
  assert.equal(DOSE.guard(10, { unit: "mg", total: true, perDose: { lo: 1, hi: 1 } }), null, "a total loading dose is not checked per dose");
  assert.equal(DOSE.GUARD_STOP, 2);
});

test("dose-calc.js with the neonatal layer on: no child or adult rows for a neonate", () => {
  const R = JSON.parse(gunzipSync(readFileSync(new URL("../data/dose-rules.json.gz", import.meta.url))).toString("utf8"));
  const withChildOnly = R.drugs.find((x) => x.rows.some((r) => r.pop === "child") && !x.rows.some((r) => r.pop === "neonate") && x.rows.some((r) => r.k === "perkg"));
  const p = { weight: 3, age: 5, ageUnit: "days", sex: "", height: "", scr: "", crcl: "", childPugh: "", dialysis: false };
  const off = DC.compute(withChildOnly, p);
  assert.ok(off.rows.length + off.other.length > 0, "flag off: unchanged (child rows with a warning)");
  const on = DC.compute(withChildOnly, Object.assign({}, p, { neoStrict: true }));
  assert.equal(on.rows.length + on.other.length, 0);
  assert.deepEqual(on.notes, [DC.NEO_NONE]);
  const withNeo = R.drugs.find((x) => x.rows.some((r) => r.pop === "neonate"));
  const on2 = DC.compute(withNeo, Object.assign({}, p, { neoStrict: true }));
  assert.ok(on2.rows.concat(on2.other).length > 0 && on2.notes.length === 0, "neonatal monograph rows still show");
});

test("preparation: reconstitution pairs with its vial, draw-up volume and rounding rule", () => {
  const drug = { presentations: [{ form: "powder", v: 500, unit: "mg", market: "US" }, { form: "powder", v: 1, unit: "g", market: "US" }],
    reconstitution: [{ vial_v: 500, vial_unit: "mg", add_ml: 4.8, final_v: 100, final_unit: "mg", final_per_ml: 1 }],
    dilution: [{ final_max_v: 50, final_max_unit: "mg", final_max_per_ml: 1 }] };
  const r = PREP.prepare(drug, { v: 125, unit: "mg" });
  assert.equal(r.pick.p.v, 500);
  assert.ok(close(r.pick.draw, 1.25)); assert.equal(r.pick.drawR.v, 1.3); assert.match(r.pick.drawR.rule, /0\.1 mL/);
  assert.equal(r.pick.vials, 1);
  assert.ok(close(r.dilute.total.v, 2.5)); assert.ok(close(r.dilute.add.v, 1.3) || close(r.dilute.add.v, 1.25, 0.06));
  assert.equal(PREP.roundVol(0.237).v, 0.24); assert.equal(PREP.roundVol(1.234).v, 1.2);
  assert.equal(PREP.prepare(drug, { v: 1.5, unit: "g" }).pick.vials, 3, "the 1 g vial has no reconstitution row, so three 500 mg vials");
  const sol = PREP.prepare({ presentations: [{ form: "solution", v: 2, unit: "mg" }] }, { v: 0.5, unit: "mg" });
  assert.ok(close(sol.pick.draw, 0.25) && sol.pick.vials === null, "v per mL with no vial volume: draw-up yes, vial count unknown");
  assert.equal(PREP.conv(1, "mg", "mcg"), 1000); assert.equal(PREP.conv(1, "mg", "units"), null);
  const IN = PREP.prepare({ presentations: [{ v: 500, unit: "mg", per_ml: 5, market: "US" }, { v: 250, unit: "mg", per_ml: 5, market: "IN" }] }, { v: 100, unit: "mg" });
  assert.equal(IN.pick.p.market, "IN", "Indian catalogue strength first");
});

test("infusions: dose to mL/h and back are inverses; unit conversion exact", () => {
  const conc = { v: 1600, unit: "mcg", per_ml: 1 };
  const r = INF.rateFromDose(5, "mcg/kg/min", 1.2, conc);
  assert.ok(close(r.mlh, 5 * 1.2 * 60 / 1600));
  const back = INF.doseFromRate(r.mlh, "mcg/kg/min", 1.2, conc);
  assert.ok(close(back.dose, 5));
  const mg = INF.rateFromDose(5, "mcg/kg/min", 1.2, { v: 1.6, unit: "mg", per_ml: 1 });
  assert.ok(close(mg.mlh, r.mlh), "1.6 mg/mL is 1600 mcg/mL");
  assert.ok(close(INF.rateFromDose(0.1, "mg/kg/h", 2, { v: 1, unit: "mg", per_ml: 1 }).mlh, 0.2));
  assert.equal(INF.rateFromDose(1, "units/kg/h", 1, { v: 1, unit: "mg", per_ml: 1 }), null, "units never mix with mg");
  assert.equal(INF.inRange(12, { lo: 5, hi: 10 }), "above");
});

test("fluids: GIR matches the quoted source example; bag mix and additives", () => {
  const F = J("fluids"), c = F.gir.formula.coef, chk = c.check;
  // Source: GIR = mL/kg/day x 100 mg/mL / 1440 for D10W; our GIR takes mL/h, %, kg.
  const wKg = 2, rate = chk.vol_ml_kg_day * wKg / 24;
  assert.ok(close(Math.round(FL.gir(rate, 10, wKg) * 10) / 10, chk.gir_mg_kg_min), "the source's worked example");
  assert.ok(close(FL.pctFor(FL.gir(3, 12.5, 1.5), 3, 1.5), 12.5));
  const m = FL.mix(12.5, 100, 50, 0, 0);
  assert.ok(close(m.hi, 25) && close(m.lo, 75), "12.5% from D50 + water: 25 + 75 mL");
  const m2 = FL.mix(12.5, 100, 50, 10, 5);
  assert.ok(close(m2.hi * 50 + m2.lo * 10, 1250) && close(m2.hi + m2.lo, 95));
  assert.ok(FL.mix(60, 100, 50, 0, 0).error);
  const a = FL.additive(3, 2, 50, 300, 2);
  assert.ok(close(a.amount, 1) && close(a.ml, 0.5));
  const rows = FL.volumesFor(F, P.derive({ dob: "2026-06-01", tob: "08:00" }, "2026-06-02T09:00")).filter((x) => x.ok === true);
  assert.ok(rows.length >= 1 && rows.every((x) => x.row.when.dol), "day of life 2 has a band");
});

test("growth: INTERGROWTH row lookup and z interpolation, velocity, milestones", () => {
  const G = J("growth-preterm");
  const vp = G.charts.find((c) => c.x === "ga_at_birth").sexes.male.weight;
  const row = vp.table[0], iz = vp.columns.indexOf("z_0");
  const at = GR.atBirth(G, row[0] * 7 + row[1], "male", "weight", row[iz]);
  assert.ok(close(at.z, 0), "the median is z 0");
  const iz1 = vp.columns.indexOf("z_plus1");
  assert.ok(close(GR.atBirth(G, row[0] * 7 + row[1], "male", "weight", (row[iz] + row[iz1]) / 2).z, 0.5));
  assert.ok(GR.atBirth(G, row[0] * 7 + row[1], "male", "weight", 0.01).below);
  assert.ok(close(GR.centile(0), 50, 0.01));
  const pn = G.charts.find((c) => c.x === "pma").sexes.female.weight, ip = pn.columns.indexOf("pma_wk");
  const r0 = pn.table[0], r1 = pn.table[1];
  const mid = GR.postnatal(G, (r0[ip] * 7 + r1[ip] * 7) / 2, "female", "weight", (r0[pn.columns.indexOf("z_0")] + r1[pn.columns.indexOf("z_0")]) / 2);
  assert.ok(close(mid.z, 0) && mid.interpolated);
  assert.ok(close(GR.velocity2pt(1000, 1100, 0, 5), 1000 * 100 / (5 * 1050)));
  const M = J("milestones"), pick = GR.milestonesFor(M, 7);
  assert.equal(GR.ageMonthsOf(pick.current.age), 6); assert.equal(GR.ageMonthsOf(pick.next.age), 9);
});

test("procedures: Shukla formulas as stored, table lookup by gestation", () => {
  const D = J("procedures"), c = (id) => D.calcs.find((x) => x.id === id);
  const uac = PROC.evaluate(c("uac-shukla"), { bw_kg: 2 }).value, uvc = PROC.evaluate(c("uvc-shukla"), { bw_kg: 2 }).value;
  assert.ok(close(uvc, uac / 2 + 1), "UVC = UAC / 2 + 1 as the source says");
  assert.deepEqual(PROC.evaluate(c("uac-shukla"), {}).needs, ["bw_kg"]);
  const erc = PROC.evaluate(c("ett-depth-ga-erc"), {}, P.context(P.derive({ gaW: 28, gaD: 3 })));
  assert.equal(erc.rows.length, 1);
  assert.equal(P.matches(erc.rows[0].when, { ga_wk: 28 }).ok, true);
  const ex = PROC.evaluate(c("exchange-volume"), { wt_kg: 3 }, {}, { maturity: "term" });
  const bv = c("exchange-volume").formula.machine.blood_volume_ml_per_kg.find((b) => b.when === "term").v;
  assert.equal(ex.value, 2 * 3 * bv);
  assert.deepEqual(PROC.evaluate(c("exchange-volume"), { wt_kg: 3 }, {}, {}).needs, ["maturity"]);
});

test("TDM: vancomycin two-level AUC is self-consistent; gentamicin trough rule from NICE", () => {
  // Build levels from a known one-compartment course, then recover it.
  const ke = 0.1, tin = 1, tau = 12, cmax = 30;
  const c = (t) => cmax * Math.exp(-ke * (t - tin));
  const r = TDM.vancoAuc({ tau, tin, c1: c(2), t1: 2, c2: c(8), t2: 8 });
  assert.ok(close(r.ke, ke, 1e-9) && close(r.cmax, cmax, 1e-9));
  assert.ok(close(r.cmin, c(tau), 1e-9));
  assert.ok(close(r.auc24, (tin * (r.cmax + r.cmin) / 2 + (r.cmax - r.cmin) / ke) * 24 / tau, 1e-9));
  assert.ok(TDM.vancoAuc({ tau, tin, c1: 5, t1: 2, c2: 10, t2: 8 }).error);
  const rule = J("tdm").aminoglycoside_ei.neonatal_gentamicin.nice.find((x) => x.id === "trough-target");
  assert.equal(TDM.gentTrough(1.5, 2, rule).ok, true);
  assert.equal(TDM.gentTrough(1.5, rule.long_course.doses_gt + 1, rule).ok, false, "past 3 doses the stricter target applies");
});

test("bilirubin: AAP hourly table, escalation = exchange minus the source's 2 mg/dL; NICE term and preterm", () => {
  const BILI = load("neo-bili.js"), D = J("bili");
  const pc = BILI.aapCurve(D, "phototherapy", false, 39);
  assert.ok(pc && P.matches(pc.when, { ga_wk: 39 }).ok, "39 weeks, no risk factor curve");
  const row1 = pc.data.table.find((r) => r[0] === 1);
  assert.equal(BILI.aapAt(pc, 30).v, row1[1 + 6], "hour 30 = day 1, column h6");
  const t = BILI.thresholds(D, "aap", 39, 30, false), esc = D.aap.rules.find((r) => r.id === "escalation");
  assert.ok(close(t.escalation, t.exchange - esc.below_exchange, 1e-9));
  assert.ok(BILI.thresholds(D, "aap", 34, 30, false).na, "AAP does not cover 34 weeks");
  const rf = BILI.thresholds(D, "aap", 39, 30, true);
  assert.ok(rf.photo < t.photo, "risk-factor curve is lower");
  const T = D.nice.term.data.table, ip = D.nice.term.data.columns.indexOf("phototherapy_gt");
  assert.equal(BILI.niceTermAt(D, "phototherapy_gt", T[1][0]), T[1][ip]);
  assert.ok(close(BILI.niceTermAt(D, "phototherapy_gt", (T[1][0] + T[2][0]) / 2), (T[1][ip] + T[2][ip]) / 2));
  const pt = D.nice.preterm.phototherapy;
  assert.equal(BILI.nicePretermAt(D, "phototherapy", 30, 0), pt.before.at_birth);
  assert.equal(BILI.nicePretermAt(D, "phototherapy", 30, pt.from_h), 30 * pt.ga_multiplier - pt.minus);
  assert.equal(BILI.nicePretermAt(D, "exchange", 30, 200), 30 * D.nice.preterm.exchange.ga_multiplier);
});

test("scores engine: sum, formula, single level, criteria groups (fixture shapes)", () => {
  const SC = load("neo-scores.js");
  const sum = { type: "sum", items: [{ id: "a", options: [{ points: 0 }, { points: 2 }] }, { id: "b", options: [{ points: 1 }, { points: 3 }] }], interpretation: [{ hi: 3, text: "low" }, { lo: 4, text: "high" }] };
  assert.equal(SC.compute(sum, { a: "1", b: "1" }).value, 5);
  assert.equal(SC.compute(sum, { a: "1", b: "1" }).band.text, "high");
  assert.deepEqual(SC.compute(sum, { a: "1" }).missing, [undefined]);
  const f = { type: "formula", items: sum.items, formula: { constant: 200, divisor: 7, unit: "weeks" } };
  assert.equal(SC.compute(f, { a: "1", b: "0" }).value, Math.round((200 + 3) / 7 * 10) / 10);
  assert.equal(SC.compute({ type: "single", levels: [{ level: 1, label: "x" }, { level: 2, label: "y" }] }, { level: "1" }).value, 2);
  const cr = { type: "criteria", groups: [{ id: "A", rule: "any", items: [{ id: "a1" }, { id: "a2" }] }, { id: "B", rule: "min", min: 2, items: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] }], eligible_if: ["A", "B"] };
  assert.equal(SC.compute(cr, { a2: true, b1: true }).eligible, false);
  assert.equal(SC.compute(cr, { a2: true, b1: true, b3: true }).eligible, true);
});
