/* Dose calculator phase 1: the dose-text parser (scripts/lib/dose-parse.mjs) and the built rules.
 * Every case here is a real sentence from our monographs, including the ones the first version got
 * wrong (per dose read as per day, a "max" ceiling read as a dose, "up to" read as a ceiling).
 *
 * node --test test/dose-parse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseRow, parseRenal, parseHepatic, parseDrug, verifyRow } from "../scripts/lib/dose-parse.mjs";

const row = (d, extra) => Object.assign({ c: "", r: "", d, t: "", n: "" }, extra || {});
const parts = (r) => r.parts.map((p) => [p.lo, p.hi, p.unit, p.per, p.time, p.label || null]);

test("per-kg per day, with a plain-amount ceiling next to it", () => {
  const r = parseRow(row("15 mg/kg/day IM/IV divided q8-12h (max 1.5 g/day)", { c: "Serious infection (adult/child)" }));
  assert.equal(r.kind, "perkg");
  assert.deepEqual(parts(r), [[15, null, "mg", "kg", "day", null]]);
  assert.deepEqual(r.caps.map((c) => [c.value, c.unit, c.per, c.time]), [[1.5, "g", null, "day"]]);
});

test("levothyroxine: 1.6 mcg/kg/day (the owner's example), mcg kept as mcg", () => {
  const r = parseRow(row("Approximately 1.6 mcg/kg/day once daily; titrate by 12.5-25 mcg every 4-6 weeks", { c: "Hypothyroidism - healthy adult", r: "Adult" }));
  assert.equal(r.kind, "perkg"); assert.equal(r.pop, "adult");
  assert.deepEqual(parts(r), [[1.6, null, "mcg", "kg", "day", null]]);
});

test("per DOSE is not per DAY (first version read 'mg/kg/dose' as '/day')", () => {
  const r = parseRow(row("10-15 mg/kg/dose every 4-6 h; max 5 doses/24h; max 75 mg/kg/day", { c: "Children" }));
  assert.deepEqual(parts(r), [[10, 15, "mg", "kg", "dose", null]]);
  assert.equal(r.pop, "child");
});

test("'max 75 mg/kg/day' is a per-kg CEILING, not a second dose", () => {
  const r = parseRow(row("10-15 mg/kg/dose every 4-6 h; max 5 doses/24h; max 75 mg/kg/day"));
  assert.equal(r.parts.length, 1);
  assert.deepEqual(r.caps.map((c) => [c.value, c.unit, c.per, c.time]), [[75, "mg", "kg", "day"]]);
});

test("'Up to 5 mg/kg/day' is the dose's upper end, not a ceiling", () => {
  const r = parseRow(row("Up to 5 mg/kg/day in 3-4 equal doses"));
  assert.equal(r.caps.length, 0);
  assert.deepEqual(parts(r), [[null, 5, "mg", "kg", "day", null]]);
  assert.equal(r.parts[0].upTo, true);
});

test("loading then maintenance are two labelled parts", () => {
  const r = parseRow(row("Loading 10 mg/kg, then 7.5 mg/kg", { c: "Neonates" }));
  assert.deepEqual(parts(r), [[10, null, "mg", "kg", null, "loading"], [7.5, null, "mg", "kg", null, "maintenance"]]);
  assert.equal(r.pop, "neonate");
});

test("a fixed-dose row with a daily ceiling written as /24h", () => {
  const r = parseRow(row("500-1000 mg every 4-6 h PRN; max 4000 mg/24h", { c: "Adult pain/fever" }));
  assert.equal(r.kind, "fixed");
  assert.deepEqual(parts(r), [[500, 1000, "mg", "fixed", null, null]]);
  assert.deepEqual(r.caps.map((c) => [c.value, c.unit, c.time]), [[4000, "mg", "day"]]);
});

test("ceilings written in the notes field are found (Max 15 mg/kg/day; not to exceed 1.5 g/day)", () => {
  const r = parseRow(row("15 mg/kg/day", { n: "Max 15 mg/kg/day; total adult dose not to exceed 1.5 g/day" }));
  assert.deepEqual(r.caps.map((c) => [c.value, c.unit, c.per || null]).sort(), [[1.5, "g", null], [15, "mg", "kg"]].sort());
});

test("per m2 is its own kind (needs height for BSA)", () => {
  const r = parseRow(row("75 mg/m2 IV every 3 weeks"));
  assert.equal(r.kind, "perm2"); assert.deepEqual(parts(r), [[75, null, "mg", "m2", null, null]]);
});

test("prose with no calculable number stays text", () => {
  assert.equal(parseRow(row("Use ideal/adjusted body weight")).kind, "text");
  assert.equal(parseRow(row("Often requires ~20-30% dose increase")).kind, "text");
});

test("weight basis switches only when the monograph says so", () => {
  assert.equal(parseRow(row("7 mg/kg once daily", { n: "Use ideal body weight in obesity" })).basis, "ideal");
  assert.equal(parseRow(row("7 mg/kg once daily", { n: "Dose on adjusted body weight" })).basis, "adjusted");
  assert.equal(parseRow(row("7 mg/kg once daily")).basis, "actual");
});

test("round-trip: every extracted number is quoted verbatim from its sentence", () => {
  const src = row("Loading 10 mg/kg, then 7.5 mg/kg (max 1.5 g/day)");
  const r = parseRow(src);
  assert.deepEqual(verifyRow(r, src), []);
  // A tampered rule is caught.
  r.parts[0].src = "11 mg/kg"; assert.ok(verifyRow(r, src).length > 0);
});

/* ── renal ─────────────────────────────────────────────────────────────────────────────────── */
test("renal bands with advice after the number (meropenem), half dose and interval read", () => {
  const R = parseRenal("Dose adjustment required for CrCl <=50 mL/min: CrCl 26-50 give recommended dose every 12 h; CrCl 10-25 give half dose every 12 h; CrCl <10 give half dose every 24 h. Meropenem is removed by hemodialysis - dose after dialysis.");
  const b = R.bands.map((x) => [x.lo, x.hi, x.factor || null, x.every || null]);
  assert.deepEqual(b, [[0, 9.9999, 0.5, 24], [10, 25, 0.5, 12], [26, 50, null, 12]]);
  assert.match(R.dialysis, /dose after dialysis/);
});

test("renal bands inside one sentence with severity words (levetiracetam)", () => {
  const R = parseRenal("Dose adjustment is required and individualized by creatinine clearance (mL/min/1.73 m2): normal (>80) 500-1500 mg q12h; mild (50-80) 500-1000 mg q12h; moderate (30-50) 250-750 mg q12h; severe (<30) 250-500 mg q12h. ESRD patients on dialysis: 500-1000 mg q24h.");
  assert.equal(R.bands.length, 4);
  assert.equal(R.bands.find((x) => x.lo === 30).advice, "250-750 mg q12h");
  assert.match(R.dialysis, /500-1000 mg q24h/);
});

test("advice before the number, in words (metformin 'eGFR is below 30')", () => {
  const R = parseRenal("Assess eGFR before initiation. Contraindicated when eGFR is below 30 mL/min/1.73 m2. Initiation is not recommended when eGFR is 30 to 45 mL/min/1.73 m2.");
  const low = R.bands.find((x) => x.lo === 0);
  assert.ok(low && low.avoid && /Contraindicated/.test(low.advice), JSON.stringify(R.bands));
  assert.equal(R.measure, "eGFR");
});

test("a semicolon inside the advice does not cut it off (enoxaparin)", () => {
  const R = parseRenal("For severe impairment (CrCl <30 mL/min) reduce the dose: prophylaxis 30 mg SC once daily; treatment 1 mg/kg SC once daily. Monitor closely.");
  assert.equal(R.bands.length, 1);
  assert.match(R.bands[0].advice, /treatment 1 mg\/kg SC once daily/);
});

test("a band whose advice still names a clearance is marked mixed (the app shows the whole note)", () => {
  const R = parseRenal("Reduce dose for CrCl <60 mL/min: CrCl >30-59 give BID, CrCl >15-29 give QD, CrCl 15 give lower QD doses, and for CrCl <15 reduce in proportion to CrCl.");
  assert.ok(R.bands.some((x) => x.mixed));
});

test("no numbers in the renal note: no bands (vancomycin says 'by CrCl and levels')", () => {
  assert.equal(parseRenal("Dose adjustment is required in renal impairment - reduce the dose or extend the interval based on CrCl and serum levels.").bands.length, 0);
});

/* ── hepatic ───────────────────────────────────────────────────────────────────────────────── */
test("Child-Pugh classes get the clause that names them", () => {
  const H = parseHepatic("Do not use in baseline severe hepatic impairment (Child-Pugh C). For moderate impairment (Child-Pugh B), reduce to 250 mg once daily and monitor liver tests.");
  assert.ok(H.classes.C.avoid);
  assert.match(H.classes.B.advice, /250 mg once daily/);
  const H2 = parseHepatic("No dose adjustment is needed for mild (Child-Pugh A) or moderate (Child-Pugh B) hepatic impairment. For severe hepatic impairment (Child-Pugh C), reduce the dosing frequency to once daily.");
  assert.ok(H2.classes.A.none && H2.classes.B.none);
  assert.match(H2.classes.C.advice, /once daily/);
});

/* ── the built file ────────────────────────────────────────────────────────────────────────── */
test("the shipped rules: every monograph present, the owner's example calculable, nothing fails the round-trip", async () => {
  const { gunzipSync } = await import("node:zlib");
  const p = new URL("../data/dose-rules.json.gz", import.meta.url);
  assert.ok(existsSync(p), "run node scripts/build-dose-rules.mjs");
  const R = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));
  assert.ok(R.drugs.length >= 1500);
  const levo = R.drugs.find((d) => /^Levothyroxine/.test(d.n));
  assert.ok(levo && levo.k === "perkg");
  assert.ok(levo.rows.some((r) => r.pop === "adult" && r.p.some((q) => q.lo === 1.6 && q.u === "mcg" && q.per === "kg")));
  // Round-trip over every monograph, fresh from source (not from a generated report).
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../worker/data/gold/", import.meta.url);
  let rejected = 0;
  for (const f of readdirSync(dir)) { if (!f.endsWith(".json")) continue; const d = parseDrug(JSON.parse(readFileSync(new URL(f, dir), "utf8"))); d.rows.forEach((r) => { if (r.rejected) rejected++; }); }
  assert.equal(rejected, 0, "a rule failed the round-trip check");
});

test("parseDrug on a real monograph", () => {
  const g = JSON.parse(readFileSync(new URL("../worker/data/gold/Amikacin.json", import.meta.url), "utf8"));
  const d = parseDrug(g);
  assert.equal(d.kind, "perkg");
  assert.ok(d.rows.some((r) => r.basis !== "actual"), "the obesity row asks for ideal/adjusted weight");
});
