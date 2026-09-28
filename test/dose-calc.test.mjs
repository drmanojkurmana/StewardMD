/* Dose calculator engine (dose-calc.js, pure part) against the real shipped rules.
 *
 * node --test test/dose-calc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const SRC = readFileSync(new URL("../dose-calc.js", import.meta.url), "utf8");
const mod = { exports: {} };
new Function("module", "window", SRC)(mod, undefined);
const E = mod.exports;
const R = JSON.parse(gunzipSync(readFileSync(new URL("../data/dose-rules.json.gz", import.meta.url))).toString("utf8"));
const drug = (re) => { const d = R.drugs.find((x) => re.test(x.n)); assert.ok(d, "no drug " + re); return d; };
const P = (o) => Object.assign({ weight: "", age: "", ageUnit: "years", sex: "", height: "", scr: "", crcl: "", childPugh: "", dialysis: false }, o);

test("the owner's example: levothyroxine, 55 kg adult = 1.6 mcg/kg x 55 kg = 88 mcg per day", () => {
  const r = E.compute(drug(/^Levothyroxine/), P({ weight: 55, age: 40, sex: "F" }));
  const line = r.rows.flatMap((x) => x.lines)[0];
  assert.equal(line.value, "88 mcg per day");
  assert.equal(line.working, "1.6 mcg/kg × 55 kg");
  assert.equal(line.practical, "88 mcg");
});

test("weight is required and bounded; nonsense values are refused, never calculated", () => {
  assert.ok(E.compute(drug(/^Amikacin$/), P({})).errors[0].match(/weight/i));
  assert.ok(E.compute(drug(/^Amikacin$/), P({ weight: 550 })).errors.length);
  assert.ok(E.compute(drug(/^Amikacin$/), P({ weight: 60, scr: 90 })).errors.some((e) => /Creatinine/.test(e)));
});

test("a ceiling is applied: amikacin 15 mg/kg/day at 120 kg is capped at 1.5 g/day", () => {
  const r = E.compute(drug(/^Amikacin$/), P({ weight: 120, age: 50 }));
  const line = r.rows[0].lines[0];
  assert.match(line.value, /^1,500 mg per day$/);
  assert.match(line.capped, /Capped/);
});

test("obese patient on an aminoglycoside uses adjusted body weight when height and sex are known", () => {
  const r = E.compute(drug(/^Amikacin$/), P({ weight: 110, age: 50, sex: "M", height: 170 }));
  const ib = E.ibw("M", 170), adj = E.adjbw(110, ib);
  const first = r.rows[0];
  assert.ok(first.notes.some((n) => /adjusted body weight/.test(n)), JSON.stringify(first.notes));
  assert.equal(first.lines[0].working, "15 mg/kg × " + adj + " kg");
});

test("a child gets the children's row; paracetamol 15 kg child = 150-225 mg per dose", () => {
  const r = E.compute(drug(/^Paracetamol$/), P({ weight: 15, age: 4 }));
  const l = r.rows.flatMap((x) => x.lines).find((x) => /per dose/.test(x.value));
  assert.equal(l.value, "150-225 mg per dose");
  assert.equal(r.derived.group, "child");
});

test("an adult is never shown a paediatric per-kg row", () => {
  const r = E.compute(drug(/^Paracetamol$/), P({ weight: 70, age: 30 }));
  assert.equal(r.rows.length, 0, "paracetamol adult rows are fixed doses");
  assert.ok(r.other.some((o) => o.fixed));
});

test("a neonate gets the neonatal row (amikacin loading 10 mg/kg then 7.5 mg/kg)", () => {
  const r = E.compute(drug(/^Amikacin$/), P({ weight: 3, age: 5, ageUnit: "days" }));
  assert.equal(r.derived.group, "neonate");
  const vals = r.rows.flatMap((x) => x.lines.map((l) => l.label + ":" + l.value));
  assert.ok(vals.includes("loading:30 mg") && vals.includes("maintenance:22.5 mg"), vals.join(" | "));
});

test("Cockcroft-Gault: 60 y male, 70 kg, 170 cm, creatinine 1.2 -> ideal weight 65.9 kg used, 61 mL/min", () => {
  const d = E.derive(P({ weight: 70, age: 60, sex: "M", height: 170, scr: 1.2 }));
  // IBW 65.9 kg (70 is within 120%), (140-60)*65.9/(72*1.2) = 61
  assert.equal(d.ibw, 65.9);
  assert.equal(d.renal.value, 61);
  assert.match(d.renal.how, /ideal weight/);
});

test("renal band applied: meropenem at CrCl 20 -> half dose every 12 h", () => {
  const r = E.compute(drug(/^Meropenem$/), P({ weight: 70, age: 70, crcl: 20 }));
  assert.equal(r.renal.band.factor, 0.5);
  assert.match(r.renal.band.advice, /half dose every 12 h/);
});

test("renal: above every band means no adjustment; dialysis shows the dialysis note", () => {
  const r = E.compute(drug(/^Meropenem$/), P({ weight: 70, age: 30, crcl: 110 }));
  assert.ok(r.renal.normal);
  const dia = E.compute(drug(/^Levetiracetam$/), P({ weight: 70, age: 30, dialysis: true }));
  assert.match(dia.renal.advice, /dialysis/i);
});

test("renal: contraindication is flagged (metformin, eGFR 20)", () => {
  const r = E.compute(drug(/^Metformin hydrochloride$/), P({ weight: 70, age: 60, crcl: 20 }));
  assert.ok(r.avoid);
});

test("liver: Child-Pugh class advice (abiraterone B -> 250 mg once daily; C -> avoid)", () => {
  const b = E.compute(drug(/^Abiraterone Acetate$/), P({ weight: 70, age: 60, childPugh: "B" }));
  assert.match(b.hepatic.cls.advice, /250 mg once daily/);
  const c = E.compute(drug(/^Abiraterone Acetate$/), P({ weight: 70, age: 60, childPugh: "C" }));
  assert.ok(c.avoid);
});

test("a fixed-dose drug says so and still shows its doses", () => {
  const r = E.compute(drug(/^Amlodipine/), P({ weight: 70, age: 50 }));
  assert.equal(r.weightBased, false);
  assert.ok(r.other.length > 0);
});

test("per m2 needs height; with height it uses BSA", () => {
  const d = R.drugs.find((x) => x.k === "perm2");
  const no = E.compute(d, P({ weight: 70, age: 50 }));
  assert.ok(no.rows.some((x) => x.notes.some((n) => /per m² of body surface/.test(n))));
  const yes = E.compute(d, P({ weight: 70, age: 50, height: 170 }));
  assert.ok(yes.rows.some((x) => x.lines.some((l) => /m² × 1\.82 m²/.test(l.working))), JSON.stringify(yes.rows.map((x) => x.lines.map((l) => l.working))));
});

test("practical rounding steps", () => {
  assert.equal(E.practical(88), 88); assert.equal(E.practical(825), 825); assert.equal(E.practical(837), 825); assert.equal(E.practical(4.3), 4.5); assert.equal(E.practical(0.33), 0.35);
});

test("no em dash anywhere in the calculator's text", () => {
  assert.equal(/—/.test(SRC), false);
});
