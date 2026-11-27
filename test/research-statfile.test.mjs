/* ResearchMD on-device SPSS (.sav, .zsav) and Stata (.dta) reader
 * (research-statfile.js). Runs without Python: the expected values below come
 * from the frames written by scripts/research-statfile-fixtures.py, not from
 * any reader. The pyreadstat comparison is test/research-statfile-parity.test.mjs.
 *
 * Run: node --test test/research-statfile.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const SF = require("../research-statfile.js");
const DIR = new URL("./fixtures/research/statfiles/", import.meta.url);
const load = (name) => readFileSync(new URL(name, DIR));
const read = (name) => SF.read(load(name), { name });
const col = (res, name) => res.columns.indexOf(name);
const cells = (res, name) => res.data.map((r) => r[col(res, name)]);

const SAV_FILES = ["rs_plain.sav", "rs_bytecode.sav", "rs_zlib.zsav"];

for (const f of SAV_FILES) {
  test(`SPSS ${f}: names, labels, value labels, missing codes and dates`, () => {
    const res = read(f);
    assert.equal(res.fileLabel, "ResearchMD statfile test");
    assert.deepEqual(res.columns, ["pid", "sex", "age_years", "hb_gdl", "smoker", "ward_name", "remarks", "admit_date", "seen_at"]);
    const v = Object.fromEntries(res.variables.map((x) => [x.name, x]));
    assert.equal(v.age_years.label, "Age (years)");
    assert.equal(v.seen_at.label, "First seen (date and time)");
    assert.deepEqual(v.sex.valueLabels, { 1: "Male", 2: "Female", 9: "Not recorded" });
    assert.deepEqual(v.smoker.valueLabels, { y: "Yes", n: "No", u: "Unknown" });
    assert.deepEqual(v.ward_name.valueLabels, { "General Medicine": "Gen Med ward", ICU: "Intensive care" });
    assert.deepEqual(v.sex.missing, { values: [9], range: null });
    assert.deepEqual(v.age_years.missing.range, [900, 999]);
    assert.deepEqual(v.hb_gdl.missing, { values: [0], range: [900, 999] });
    assert.deepEqual(v.smoker.missing.values, ["u"]);
    assert.equal(v.admit_date.kind, "date");
    assert.equal(v.seen_at.kind, "datetime");

    assert.deepEqual(cells(res, "pid"), [1, 2, 3, 4, 5, 6]);
    // 9 is a user-missing code, the last one is system missing.
    assert.deepEqual(cells(res, "sex"), [1, 2, 2, 1, null, null]);
    // 999 falls in the 900 to 999 missing range.
    assert.deepEqual(cells(res, "age_years"), [34.5, 61, null, 47.25, 0.1, 72]);
    assert.deepEqual(cells(res, "hb_gdl"), [11.2, 13.85, null, 9, null, 12]);
    assert.deepEqual(cells(res, "smoker"), ["y", "n", "n", null, "y", ""]);
    const remarks = cells(res, "remarks");
    assert.equal(remarks[0], "café au lait spots");
    assert.equal(remarks[1], "తెలుగు note");
    assert.equal(remarks[2], "x".repeat(600), "very long string kept whole");
    assert.deepEqual(cells(res, "admit_date"), ["2024-01-15", "2023-12-31", "1999-02-28", null, "2026-11-27", "2000-02-29"]);
    assert.deepEqual(cells(res, "seen_at"), ["2024-01-15 08:30:00", "2023-12-31 23:59:59", null, "2020-06-01 00:00:00", "2026-11-27 12:05:07", "1970-01-01 00:00:01"]);
    assert.equal(res.notes.missingBlanked, 4, "sex 9, age 999, hb 950, smoker u");
  });
}

test("SPSS bytecode file with many rows, times of day and an empty column", () => {
  const res = read("rs_many_bytecode.sav");
  assert.equal(res.data.length, 257);
  for (let i = 0; i < 257; i++) {
    const row = res.data[i];
    assert.equal(row[col(res, "id")], i);
    assert.equal(row[col(res, "score")], (i % 7) - 3);
    assert.ok(Math.abs(row[col(res, "ratio")] - ((i * 0.37) % 5)) < 1e-12);
    const h = (i * 7) % 24, m = (i * 13) % 60, s = (i * 29) % 60;
    const pad = (n) => String(n).padStart(2, "0");
    assert.equal(row[col(res, "clock")], `${pad(h)}:${pad(m)}:${pad(s)}`);
    assert.equal(row[col(res, "empty")], null);
    assert.equal(row[col(res, "grp")], i % 3 ? "arm A" : "arm B");
  }
});

for (const v of [8, 12, 13, 14, 15]) {
  test(`Stata from pyreadstat version ${v}: labels, dates, missing`, () => {
    const res = read(`rs_v${v}.dta`);
    assert.equal(res.format, "dta");
    assert.equal(res.version, { 8: 113, 12: 115, 13: 117, 14: 118, 15: 119 }[v]);
    assert.equal(res.fileLabel, "ResearchMD statfile test");
    const vs = Object.fromEntries(res.variables.map((x) => [x.name, x]));
    assert.equal(vs.hb_gdl.label, "Haemoglobin g/dL");
    assert.deepEqual(vs.sex.valueLabels, { 1: "Male", 2: "Female", 9: "Not recorded" });
    // Stata has no SPSS-style missing codes, so 9 and 999 stay as numbers.
    assert.deepEqual(cells(res, "sex"), [1, 2, 2, 1, 9, null]);
    assert.deepEqual(cells(res, "age_years"), [34.5, 61, 999, 47.25, 0.1, 72]);
    assert.deepEqual(cells(res, "admit_date"), ["2024-01-15", "2023-12-31", "1999-02-28", null, "2026-11-27", "2000-02-29"]);
    assert.deepEqual(cells(res, "seen_at"), ["2024-01-15 08:30:00", "2023-12-31 23:59:59", null, "2020-06-01 00:00:00", "2026-11-27 12:05:07", "1970-01-01 00:00:01"]);
    assert.equal(cells(res, "remarks")[0], "café au lait spots");
    assert.equal(cells(res, "remarks")[2], "x".repeat(200));
  });
}

for (const v of [114, 117, 118, 119]) {
  test(`Stata from pandas release ${v}: int types, float32, strL, dates`, () => {
    const res = read(`pd_${v}.dta`);
    assert.equal(res.version, v);
    assert.equal(res.fileLabel, "pandas writer test");
    assert.deepEqual(cells(res, "pid"), [1, 2, 3, 4, 5]);
    assert.deepEqual(cells(res, "arm"), [0, 1, 1, 0, 1]);
    assert.deepEqual(cells(res, "dose_mg"), [2.5, 5, 7.3, null, 10.1], "float32 written as the short decimal");
    assert.deepEqual(cells(res, "count"), [10, 2000, 30000, -5, 7]);
    assert.deepEqual(cells(res, "crp"), [1.25, null, 300.5, 0, 12]);
    assert.deepEqual(cells(res, "site"), ["Visakhapatnam", "Hyderabad", "Vijayawada", "", "Guntur"]);
    assert.deepEqual(cells(res, "visit"), ["2024-03-01", "2024-03-08", null, "1960-01-01", "1959-12-31"]);
    assert.deepEqual(cells(res, "stamp"), ["2024-03-01 09:15:00", null, "2024-03-02 18:00:30", "1960-01-01 00:00:00", "2001-09-09 01:46:40"]);
    const notes = cells(res, "notes");
    assert.equal(notes[0], "first visit, all well");
    assert.equal(notes[1], "");
    assert.equal(notes[2], v >= 117 ? "long note ".repeat(40) : "long note ".repeat(40).slice(0, 244).trimEnd());
    const vs = Object.fromEntries(res.variables.map((x) => [x.name, x]));
    assert.equal(vs.arm.label, "Study arm");
    assert.deepEqual(vs.arm.valueLabels, { 0: "Placebo", 1: "Active" });
  });
}

test("toTable writes value labels only when every value has one", () => {
  const res = read("rs_plain.sav");
  const t = SF.toTable(res);
  const at = (name) => t.rows.map((r) => r[t.columns.indexOf(name)]);
  assert.deepEqual(at("sex"), ["Male", "Female", "Female", "Male", "", ""]);
  assert.deepEqual(at("smoker"), ["Yes", "No", "No", "", "Yes", ""]);
  // Cardiology and Nephrology have no label, so ward names stay as written.
  assert.deepEqual(at("ward_name"), ["General Medicine", "ICU", "Cardiology", "General Medicine", "Nephrology", "ICU"]);
  assert.deepEqual(at("age_years"), ["34.5", "61", "", "47.25", "0.1", "72"]);
  assert.equal(t.labelsApplied, 2);
  const raw = SF.toTable(res, { applyLabels: false });
  assert.deepEqual(raw.rows.map((r) => r[raw.columns.indexOf("sex")]), ["1", "2", "2", "1", "", ""]);
  // A scale labelled only at its ends stays numeric.
  const many = SF.toTable(read("rs_many_bytecode.sav"));
  assert.equal(many.rows[0][many.columns.indexOf("score")], "-3");
  assert.equal(many.rows[3][many.columns.indexOf("score")], "0");
});

test("older Stata text: UTF-8 when valid, Windows-1252 otherwise", () => {
  const buf = Buffer.from(load("rs_v8.dta"));
  const utf8 = Buffer.from("café au lait", "utf8");
  const at = buf.indexOf(utf8);
  assert.ok(at > 0);
  // Rewrite as single-byte Windows-1252: caf + 0xE9, then pad with zeros.
  const cp = Buffer.from("café au lait spots", "latin1");
  cp.copy(buf, at);
  buf[at + cp.length] = 0;
  const res = SF.read(buf, { name: "x.dta" });
  assert.equal(res.data[0][res.columns.indexOf("remarks")], "café au lait spots");
});

test("clear errors for files that are not SPSS or Stata, or cut short", () => {
  assert.throws(() => SF.read(new Uint8Array([1, 2, 3, 4, 5]), { name: "a.csv" }), /not an SPSS \(\.sav\) or Stata \(\.dta\) file/);
  assert.throws(() => SF.read(Buffer.from("hello, this is a csv file"), { name: "a.sav" }), /not an SPSS \.sav file/);
  const full = load("rs_plain.sav");
  assert.throws(() => SF.read(full.subarray(0, 400), { name: "a.sav" }), /ends early/);
  const dta = load("pd_118.dta");
  assert.throws(() => SF.read(dta.subarray(0, 300), { name: "a.dta" }), /ends early|missing its/);
  assert.throws(() => SF.read(Buffer.from([105, 2, 1, 0, 0, 0, 0, 0]), { name: "old.dta" }), /too old/);
});

test("file name check", () => {
  for (const n of ["a.sav", "B.SAV", "c.zsav", "d.dta"]) assert.ok(SF.isStatFileName(n), n);
  for (const n of ["a.csv", "b.xlsx", "c.sav.txt", "dta", ""]) assert.ok(!SF.isStatFileName(n), n);
});

test("every committed test file is read without error", () => {
  const files = readdirSync(DIR).filter((f) => /\.(z?sav|dta)$/.test(f));
  assert.ok(files.length >= 13);
  for (const f of files) {
    const res = read(f);
    assert.ok(res.data.length > 0, f);
    for (const row of res.data) assert.equal(row.length, res.columns.length, f);
  }
});

test("pure ES5: no let, const, arrow functions or template strings", () => {
  const src = readFileSync(new URL("../research-statfile.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/\b(let|const|class)\s/.test(src), "no let/const/class");
  assert.ok(!/=>/.test(src), "no arrow functions");
  assert.ok(!/`/.test(src), "no template strings");
});
