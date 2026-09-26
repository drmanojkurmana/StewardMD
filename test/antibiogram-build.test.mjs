/* test/antibiogram-build.test.mjs: scripts/build-antibiogram.mjs, the step between the source
 * files (one per antibiogram, as read from the document) and the bundle the app shows.
 * Pins: the schema is strict, % resistant reports are converted and marked, derived rows are
 * only made when they are complete, a source's own tables are cross-checked, and the committed
 * bundle is fresh (the same guard CI runs).
 *
 * node --test test/antibiogram-build.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSource, checkRow, derive, countChecks, copyChecks, buildBundle, loadAll } from "../scripts/build-antibiogram.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (o) => Object.assign({ id: "T_2025", kind: "institution", inst: "T", institution: "Test Hospital", short: "Test", region: "north", sector: "government", year: 2025,
  citation: "Test antibiogram 2025.", verification: { status: "double-checked", note: "test" }, rows: [], counts: [] }, o);

test("schema: unknown keys, bad drugs, bad values and s+r together all fail", () => {
  const one = [{ spec: "blood", set: "all", org: "E. coli", n: 40, s: { amikacin: 90 } }];
  assert.deepEqual(validateSource(base({ rows: one }), "T_2025.json"), []);
  assert.ok(validateSource(base({}), "T_2025.json").some((x) => /no rows/.test(x)));          // an empty source belongs in the register
  const e = validateSource(base({ colour: "red", rows: [{ spec: "blood", set: "all", org: "E. coli", n: 40, s: { notadrug: 50, amikacin: 140 } },
    { spec: "urine", set: "all", org: "E. coli", n: 40, s: { amikacin: 90 }, r: { amikacin: 10 } }] }), "T_2025.json");
  assert.ok(e.some((x) => /unknown key "colour"/.test(x)));
  assert.ok(e.some((x) => /"notadrug" is not canonical/.test(x)));
  assert.ok(e.some((x) => /amikacin = 140/.test(x)));
  assert.ok(e.some((x) => /not both/.test(x)));
  assert.ok(validateSource(base({ rows: one }), "Other.json").some((x) => /does not match the file name/.test(x)));
  assert.ok(validateSource(base({ rows: [{ spec: "blood", set: "all", org: "E. coli", n: 40, s: {}, trend: { amikacin: [[2024, 120]] } }] }), "T_2025.json").some((x) => /trend/.test(x)));
});

test("% resistant reports become 100 - %R and are marked", () => {
  const src = base({ measure: "R" });
  const r = checkRow(src, { spec: "blood", set: "all", org: "Klebsiella pneumoniae", n: 300, s: { meropenem: 62.5 }, trend: { meropenem: [[2023, 55], [2024, 62.5]] } });
  assert.equal(r.cells.meropenem.s, 37.5);
  assert.equal(r.measure, "R");
  assert.deepEqual(r.trend.meropenem, [[2023, 45], [2024, 37.5]]);
  const r2 = checkRow(base({}), { spec: "blood", set: "all", org: "E. coli", n: 300, r: { amikacin: 20 } });
  assert.equal(r2.cells.amikacin.s, 80);
  assert.equal(r2.measure, "R");
});

test("derived S. aureus row: MRSA + MSSA, and MRSA alone only when the counts say there was no MSSA", () => {
  const src = base({ counts: [{ spec: "pus", set: "icu", org: "Staphylococcus aureus", n: 22 }, { spec: "pus", set: "ward", org: "Staphylococcus aureus", n: 30 }] });
  const rows = [
    { spec: "pus", set: "ward", org: "Staphylococcus aureus", pheno: "MRSA", n: 20, s: { vancomycin: 100 } },
    { spec: "pus", set: "ward", org: "Staphylococcus aureus", pheno: "MSSA", n: 10, s: { vancomycin: 100, cefazolin: 100 } },
    { spec: "pus", set: "icu", org: "Staphylococcus aureus", pheno: "MRSA", n: 22, s: { vancomycin: 100 } }
  ].map((r) => checkRow(src, r));
  const d = derive(rows, src);
  const ward = d.find((r) => r.spec === "pus" && r.set === "ward" && !r.pheno);
  assert.equal(ward.n, 30);
  assert.equal(ward.cells.cefoxitin.s, 33.3, "10 of 30 methicillin-susceptible");
  assert.equal(ward.cells.cefazolin.s, 33.3, "MRSA counts as 0% for beta-lactams");
  const icu = d.find((r) => r.spec === "pus" && r.set === "icu" && !r.pheno);
  assert.ok(icu, "MRSA-only ICU row combined because the count table shows 22 = 22");
  assert.equal(icu.cells.cefoxitin.s, 0);
  // Without counts, a lone MRSA row is not turned into an S. aureus row.
  const d2 = derive([rows[2]], base({}));
  assert.ok(!d2.some((r) => r.set === "icu" && !r.pheno));
});

test("derived all-settings rows need every setting (or a count of 0, or under 10% missing)", () => {
  const counts = [
    { spec: "urine", set: "ward", org: "E. coli", n: 100 }, { spec: "urine", set: "opd", org: "E. coli", n: 100 }, { spec: "urine", set: "icu", org: "E. coli", n: 40 },
    { spec: "urine", set: "ward", org: "Klebsiella pneumoniae", n: 50 }, { spec: "urine", set: "opd", org: "Klebsiella pneumoniae", n: 50 }, { spec: "urine", set: "icu", org: "Klebsiella pneumoniae", n: 0 }
  ];
  const src = base({ counts });
  const rows = [
    { spec: "urine", set: "ward", org: "E. coli", n: 100, s: { amikacin: 90 } },
    { spec: "urine", set: "opd", org: "E. coli", n: 100, s: { amikacin: 80 } },
    // E. coli ICU (40 isolates, 17%) not printed: an all-settings E. coli row would be partial.
    { spec: "urine", set: "ward", org: "Klebsiella pneumoniae", n: 50, s: { amikacin: 60 } },
    { spec: "urine", set: "opd", org: "Klebsiella pneumoniae", n: 50, s: { amikacin: 70 } }
    // Klebsiella ICU count 0: complete without it.
  ].map((r) => checkRow(src, r));
  const d = derive(rows, src);
  assert.ok(!d.some((r) => r.org === "ecoli" && r.set === "all"), "E. coli all-settings not derived (17% missing)");
  const k = d.find((r) => r.org === "klebsiella" && r.set === "all");
  assert.ok(k);
  assert.equal(k.cells.amikacin.s, 65);
  assert.match(k.derived, /no ICU isolates/);
});

test("derived all-specimens rows never double count: 'all except urine' combines only with urine", () => {
  const src = base({});
  const rows = [
    { spec: "nonurine", set: "all", org: "E. coli", n: 300, s: { amikacin: 70 } },
    { spec: "blood", set: "all", org: "E. coli", n: 100, s: { amikacin: 60 } },     // already inside nonurine
    { spec: "urine", set: "all", org: "E. coli", n: 100, s: { amikacin: 90 } }
  ].map((r) => checkRow(src, r));
  const all = derive(rows, src).find((r) => r.spec === "all" && r.set === "all");
  assert.equal(all.n, 400, "300 + 100, blood not added again");
  assert.equal(all.cells.amikacin.s, 75);
});

test("ICU device-associated infection rows are never combined with other rows", () => {
  const src = base({});
  const rows = [
    { spec: "blood", set: "icu", org: "E. coli", n: 100, s: { amikacin: 60 }, cohort: "hai" },
    { spec: "blood", set: "ward", org: "E. coli", n: 100, s: { amikacin: 80 } }
  ].map((r) => checkRow(src, r));
  assert.equal(derive(rows, src).length, 0);
});

test("count checks: a row whose isolates differ from the source's own count table is reported", () => {
  const src = base({ counts: [{ spec: "pus", set: "ward", org: "Acinetobacter spp.", n: 269 }, { spec: "pus", set: "icu", org: "Acinetobacter spp.", n: 13 }] });
  const rows = [
    { spec: "pus", set: "ward", org: "Acinetobacter spp.", n: 209, s: { amikacin: 29.6 } },
    { spec: "pus", set: "icu", org: "Acinetobacter spp.", n: 13, s: { amikacin: 10.9 } }
  ].map((r) => checkRow(src, r));
  const c = countChecks(src, rows);
  assert.equal(c.length, 1);
  assert.match(c[0].text, /269 in the organism table, 209 in the antibiogram table/);
});

test("count checks: a genus line that means 'other species', or covers species without a row, is not a disagreement", () => {
  // ICMR prints E. faecalis, E. faecium and "Enterococcus spp." (the rest) as separate lines: no genus check.
  const a = base({ counts: [{ spec: "urine", set: "all", org: "Enterococcus faecalis", n: 2000 }, { spec: "urine", set: "all", org: "Enterococcus faecium", n: 1234 }, { spec: "urine", set: "all", org: "Enterococcus spp.", n: 204 }] });
  const ra = [{ spec: "urine", set: "all", org: "Enterococcus faecalis", n: 2000, s: { vancomycin: 90 } }, { spec: "urine", set: "all", org: "Enterococcus faecium", n: 1234, s: { vancomycin: 60 } }].map((r) => checkRow(a, r));
  assert.equal(countChecks(a, ra).length, 0);
  // A typhoidal Salmonella count with only a S. Typhi row (Paratyphi counted, not tabulated) is fine...
  const b = base({ counts: [{ spec: "blood", set: "all", org: "Salmonella Typhi and Paratyphi", n: 623 }] });
  const rb = [{ spec: "blood", set: "all", org: "Salmonella Typhi", n: 537, s: { ceftriaxone: 99 } }].map((r) => checkRow(b, r));
  assert.equal(countChecks(b, rb).length, 0);
  // ...but Typhi + Paratyphi rows must add up to the group count,
  const rb2 = rb.concat([{ spec: "blood", set: "all", org: "Salmonella Paratyphi A", n: 50, s: { ceftriaxone: 99 } }].map((r) => checkRow(b, r)));
  assert.match(countChecks(b, rb2)[0].text, /623 in the organism table, 587 in the antibiogram table/);
  // and species rows can never exceed their genus count.
  const c = base({ counts: [{ spec: "pus", set: "opd", org: "Enterococcus spp.", n: 16 }] });
  const rc = [{ spec: "pus", set: "opd", org: "Enterococcus faecalis", n: 12, s: { vancomycin: 90 } }, { spec: "pus", set: "opd", org: "Enterococcus faecium", n: 8, s: { vancomycin: 60 } }].map((r) => checkRow(c, r));
  assert.match(countChecks(c, rc)[0].text, /16 in the organism table, 20 in the antibiogram table/);
});

test("count checks: an all-settings row above its summed location counts is not a disagreement (isolates without a location)", () => {
  const src = base({ counts: [{ spec: "urine", set: "ward", org: "E. coli", n: 300 }, { spec: "urine", set: "opd", org: "E. coli", n: 500 }] });
  const up = [{ spec: "urine", set: "all", org: "E. coli", n: 900, s: { amikacin: 90 } }].map((r) => checkRow(src, r));
  assert.equal(countChecks(src, up).length, 0);
  const down = [{ spec: "urine", set: "all", org: "E. coli", n: 700, s: { amikacin: 90 } }].map((r) => checkRow(src, r));
  assert.match(countChecks(src, down)[0].text, /800 in the organism table, 700 in the antibiogram table/);
});

test("a row whose isolate number its own count table contradicts is never combined", () => {
  const src = base({ counts: [{ spec: "urine", set: "ward", org: "Acinetobacter spp.", n: 33 }, { spec: "urine", set: "opd", org: "Acinetobacter spp.", n: 9 }] });
  const rows = [{ spec: "urine", set: "ward", org: "Acinetobacter spp.", n: 133, s: { amikacin: 30 } }, { spec: "urine", set: "opd", org: "Acinetobacter spp.", n: 9, s: { amikacin: 55.6 } }].map((r) => checkRow(src, r));
  const checks = countChecks(src, rows);
  assert.equal(checks.length, 1);
  assert.equal(derive(rows, src).filter((r) => r.set === "all").length, 1);                     // unguarded: n = 142
  assert.equal(derive(rows, src, new Set(checks.map((c) => c.spec + "|" + c.set + "|" + c.org))).filter((r) => r.set === "all").length, 0);
});

test("a combined row with more isolates than the source's own count for that stratum is not made", () => {
  const src = base({ counts: [{ spec: "all", set: "icu", org: "E. coli", n: 50 }] });
  const rows = [{ spec: "blood", set: "icu", org: "E. coli", n: 40, s: { amikacin: 80 } }, { spec: "respiratory", set: "icu", org: "E. coli", n: 60, s: { amikacin: 50 } }].map((r) => checkRow(src, r));
  assert.equal(derive(rows, src).filter((r) => r.spec === "all").length, 0);
  const ok = base({ counts: [{ spec: "all", set: "icu", org: "E. coli", n: 100 }] });
  assert.equal(derive(rows.map((r) => Object.assign({}, r, { src: ok.id })), ok).filter((r) => r.spec === "all").length, 1);
});

test("figures repeated value for value from an earlier edition become cautions on the later row only", () => {
  const f = { amikacin: 71, ceftriaxone: 22, meropenem: 64, ciprofloxacin: 32, gentamicin: 58, piptazo: 50 };
  const e1 = base({ id: "T_2023", year: 2023, rows: [{ spec: "urine", set: "opd", org: "E. coli", n: 400, s: Object.assign({}, f) }] });
  const e2 = base({ id: "T_2024", year: 2024, rows: [{ spec: "urine", set: "opd", org: "E. coli", n: 500, s: Object.assign({}, f) },
    { spec: "blood", set: "all", org: "Staphylococcus aureus", n: 90, s: { vancomycin: 100, linezolid: 100, teicoplanin: 100, daptomycin: 100, tigecycline: 100, cefoxitin: 60 } }] });
  const e3 = base({ id: "T_2025", year: 2025, rows: [{ spec: "blood", set: "all", org: "Staphylococcus aureus", n: 95, s: { vancomycin: 100, linezolid: 100, teicoplanin: 100, daptomycin: 100, tigecycline: 100, cefoxitin: 60 } }] });
  const by = new Map([e1, e2, e3].map((x) => [x.id, x.rows.map((r) => checkRow(x, r))]));
  const c = copyChecks([e1, e2, e3], by);
  assert.equal(c.length, 1);                                       // the S. aureus pair has 2 distinct values only
  assert.equal(c[0].src, "T_2024");
  assert.ok(Object.values(by.get("T_2024")[0].cells).every((x) => x.act === "caution" && /carried over/.test(x.why)));
  assert.ok(Object.values(by.get("T_2023")[0].cells).every((x) => x.act === "keep"));
  // Within one report, two specimens with different isolate counts printing identical figures: both flagged.
  const p = { amikacin: 71, ceftazidime: 52, meropenem: 64, ciprofloxacin: 32, gentamicin: 58, piptazo: 50 };
  const one = base({ rows: [{ spec: "respiratory", set: "all", org: "Pseudomonas aeruginosa", n: 200, s: Object.assign({}, p) }, { spec: "pus", set: "all", org: "Pseudomonas aeruginosa", n: 100, s: Object.assign({}, p) }] });
  const by2 = new Map([[one.id, one.rows.map((r) => checkRow(one, r))]]);
  assert.equal(copyChecks([one], by2).length, 2);
});

test("bundle: deterministic version, compact rows, every cell action counted", () => {
  const { sources, register, errors } = loadAll();
  assert.deepEqual(errors, [], "every committed source file validates");
  const a = buildBundle(sources, register), b = buildBundle(sources, register);
  assert.equal(a.version, b.version);
  const s = a.bundle.stats;
  assert.equal(s.cells, s.act.keep + s.act.caution + s.act.intrinsic + s.act.hide + s.act.suppress);
  assert.ok(a.bundle.rows.every((r) => Array.isArray(r) && typeof r[0] === "number" && r[0] < a.bundle.sources.length));
});

test("the committed register, bundle, index and tokens are fresh (abg-register --check, build --check)", () => {
  // The register goes into the bundle: it must be current before the bundle can be.
  const reg = execFileSync(process.execPath, [path.join(ROOT, "scripts", "abg-register.mjs"), "--check"], { encoding: "utf8" });
  assert.match(reg, /^OK: register \d+ documents/);
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-antibiogram.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, /^OK: antibiogram v [0-9a-f]{12}/);
});
