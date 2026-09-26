/* test/antibiogram-store.test.mjs: antibiogram-store.js, the data layer the Antibiogram screen,
 * the stewardship console and syndrome reasoning read. Runs on a small synthetic bundle built
 * with the real build script, so the assertions do not move when real sources are added.
 * Pins: pooling (latest edition, n >= 30, networks apart), the stratum a syndrome gets (never a
 * different specimen), intrinsic and low-n handling, species standing in for a genus, the
 * older-consumer shape, the hospital's own import, and cache invalidation.
 *
 * node --test test/antibiogram-store.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundle } from "../scripts/build-antibiogram.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V = { status: "double-checked", note: "test" };
const src = (o) => Object.assign({ kind: "institution", sector: "government", citation: "c", verification: V, counts: [] }, o);
const SOURCES = [
  src({ id: "A_2023", inst: "A", institution: "Alpha Hospital", short: "Alpha", region: "north", year: 2023, rows: [
    { spec: "blood", set: "all", org: "E. coli", n: 80, s: { meropenem: 90, ceftriaxone: 30 } }] }),
  src({ id: "A_2024", inst: "A", institution: "Alpha Hospital", short: "Alpha", region: "north", year: 2024, rows: [
    { spec: "blood", set: "all", org: "E. coli", n: 100, s: { meropenem: 80, ceftriaxone: 20, amikacin: 85 } },
    { spec: "blood", set: "all", org: "Klebsiella pneumoniae", n: 60, s: { meropenem: 40, ampicillin: 5 } },
    { spec: "blood", set: "all", org: "Enterococcus faecalis", n: 40, s: { vancomycin: 100, ampicillin: 90 } },
    { spec: "blood", set: "all", org: "Enterococcus faecium", n: 40, s: { vancomycin: 60, ampicillin: 10 } },
    { spec: "urine", set: "opd", org: "E. coli", n: 200, s: { nitrofurantoin: 90, ceftriaxone: 40 } },
    { spec: "blood", set: "all", org: "Salmonella Typhi", n: 50, s: { ceftriaxone: 99, ciprofloxacin: 10 } }] }),
  src({ id: "B_2024", inst: "B", institution: "Beta College", short: "Beta", region: "north", year: 2024, rows: [
    { spec: "blood", set: "all", org: "E. coli", n: 300, s: { meropenem: 60, ceftriaxone: 10 } },
    { spec: "blood", set: "all", org: "Klebsiella pneumoniae", n: 20, s: { meropenem: 10 } }] }),
  src({ id: "C_2024", inst: "C", institution: "Gamma Study", short: "Gamma", region: "south", kind: "study", year: 2024, rows: [
    { spec: "urine", set: "all", org: "E. coli", n: 150, s: { ceftriaxone: 50, cefotaxime: 90 } }] }),   // pair check: caution
  src({ id: "N_2024", inst: "N", institution: "National Network", short: "NatNet", region: "national", kind: "network", sector: "network", measure: "R", year: 2024, rows: [
    { spec: "blood", set: "all", org: "E. coli", n: 5000, s: { meropenem: 30 } }] })
];

function load() {
  const store = {};
  const g = { console, setTimeout: () => 0, CustomEvent: function () {}, document: { dispatchEvent() {}, addEventListener() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  g.window = g; g.self = g;
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "antibiogram-rules.js"), "utf8"), g, { filename: "antibiogram-rules.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "antibiogram-store.js"), "utf8"), g, { filename: "antibiogram-store.js" });
  g.ABG_STORE._set(buildBundle(SOURCES, []).bundle);
  return g.ABG_STORE;
}
const S = load();

test("scopes: India, regions with institutions, networks apart, latest edition per institution", () => {
  const ids = S.scopes().map((x) => x.id);
  ["india", "region:north", "region:south", "src:N_2024", "inst:A", "inst:B", "inst:C"].forEach((id) => assert.ok(ids.includes(id), id));
  assert.ok(!ids.includes("region:national"));
  assert.ok(!ids.includes("src:A_2023"), "older editions are reached from the source list, not the picker");
});

test("pooled table: latest edition only, rows under 30 left out, networks never mixed in", () => {
  const t = S.table("india", "blood", "all");
  const ec = t.orgs.find((o) => o.org === "ecoli");
  assert.equal(ec.cells.meropenem.s, 65, "(100*80 + 300*60)/400; A_2023 and the network ignored");
  assert.equal(ec.cells.meropenem.k, 2);
  const kp = t.orgs.find((o) => o.org === "klebsiella");
  assert.equal(kp.cells.meropenem.s, 40, "Beta's 20-isolate row is not pooled");
  assert.equal(kp.cells.ampicillin.act, "intrinsic", "intrinsic shows even when pooled");
});

test("single-source table keeps flagged cells with their reason", () => {
  const t = S.table("inst:C", "urine", "all"), ec = t.orgs[0];
  assert.equal(ec.cells.ceftriaxone.act, "caution");
  assert.match(ec.cells.ceftriaxone.why, /should give nearly the same result/);
  const pooled = S.table("india", "urine", "all").orgs.find((o) => o.org === "ecoli");
  assert.ok(!pooled || !pooled.cells.ceftriaxone, "a caution cell is never pooled");
});

test("% resistant network rows are converted and marked", () => {
  const t = S.table("src:N_2024", "blood", "all"), c = t.orgs[0].cells.meropenem;
  assert.equal(c.s, 70);
  assert.equal(c.fromR, true);
});

test("syndrome strata: urine for cystitis, never urine for cholecystitis, nothing rather than the wrong specimen", () => {
  assert.equal(S.specimenFor("CYSTITIS"), "urine");
  assert.notEqual(S.specimenFor("CHOLECYSTITIS"), "urine");
  assert.equal(S.specimenFor("IE"), "blood");
  assert.equal(S.specimenFor("MENINGITIS"), "csf");
  const cys = S.pickStratum("inst:A", S.specimenChain("CYSTITIS"), S.settingFor("CYSTITIS"));
  assert.deepEqual([cys.spec, cys.set], ["urine", "opd"]);
  const chole = S.pickStratum("inst:A", S.specimenChain("CHOLECYSTITIS"), S.settingFor("CHOLECYSTITIS"));
  assert.equal(chole.spec, "blood", "sterile fluids absent: blood, the next in the chain");
  const sepsisC = S.pickStratum("inst:C", S.specimenChain("SEPSIS"), S.settingFor("SEPSIS"));
  assert.ok(sepsisC.empty, "a urine-only study gives no sepsis figures");
  assert.equal(S.susceptibility("E. coli", "ceftriaxone", { scope: "inst:C", spec: S.specimenChain("SEPSIS"), set: "inpatient" }), null);
});

test("susceptibility: intrinsic, low n, species for a genus, group for a species", () => {
  const k = S.susceptibility("Klebsiella pneumoniae", "ampicillin", { scope: "inst:A", spec: ["blood"] });
  assert.equal(k.intrinsic, true);
  const low = S.susceptibility("Klebsiella pneumoniae", "meropenem", { scope: "inst:B", spec: ["blood"] });
  assert.equal(low.lowN, true, "20 isolates: returned but flagged");
  const ent = S.susceptibility("Enterococcus species", "vancomycin", { scope: "inst:A", spec: ["blood"] });
  assert.equal(ent.s, 80, "E. faecalis 100 and E. faecium 60, 40 isolates each");
  assert.deepEqual(Array.from(ent.combined), ["E. faecalis", "E. faecium"]);
  const typhi = S.susceptibility("S. Typhi", "ciprofloxacin", { scope: "inst:A", spec: ["blood"] });
  assert.equal(typhi.s, 10);
  const ec = S.susceptibility("E. coli", "meropenem", { scope: "india", spec: ["blood"] });
  assert.equal(ec.s, 65);
  assert.equal(ec.pooled, true);
});

test("older consumers: legacyAbg returns {source, note, org:{name:{n, specimen, d}}} without low-n rows", () => {
  const a = S.legacyAbg("inst:B", "blood", "all");
  assert.ok(a.org["Escherichia coli"]);
  assert.equal(a.org["Escherichia coli"].d.meropenem.s, 60);
  assert.ok(!Object.keys(a.org).some((k) => /Klebsiella/.test(k)), "20-isolate row left out");
});

test("half-yearly editions: the later half is the latest edition and both are labelled", () => {
  const S2 = (() => {
    const extra = [
      src({ id: "H_2024_H1", inst: "H", institution: "Half Hospital", short: "Half", region: "west", year: 2024, end: "2024-06", rows: [{ spec: "blood", set: "all", org: "E. coli", n: 60, s: { meropenem: 70 } }] }),
      src({ id: "H_2024_H2", inst: "H", institution: "Half Hospital", short: "Half", region: "west", year: 2024, end: "2024-12", rows: [{ spec: "blood", set: "all", org: "E. coli", n: 60, s: { meropenem: 50 } }] })
    ];
    const s = load(); s._set(buildBundle(SOURCES.concat(extra), []).bundle); return s;
  })();
  assert.equal(S2.table("inst:H", "blood", "all").orgs[0].cells.meropenem.s, 50, "H2 is the latest edition");
  assert.deepEqual(JSON.parse(JSON.stringify(S2.trend("H", "blood", "all", "ecoli", null, "meropenem").map((p) => [p.label, p.s]))), [["2024 H1", 70], ["2024 H2", 50]]);
  assert.ok(S2.scopes().some((x) => x.id === "inst:H" && /2024 H2/.test(x.label)));
});

test("trend across editions of one institution", () => {
  const tr = S.trend("A", "blood", "all", "ecoli", null, "meropenem");
  assert.deepEqual(JSON.parse(JSON.stringify(tr.map((p) => [p.label, p.s]))), [["2023", 90], ["2024", 80]]);
  assert.ok(tr[0].year < tr[1].year, "ordered by the end of the data period");
});

test("the hospital's own antibiogram: saved on the device, checked by the same rules, cache refreshed", () => {
  assert.ok(!S.scopes().some((x) => x.id === "local"));
  S.localSave({ name: "My Hospital", rows: [{ org: "ecoli", pheno: null, spec: "urine", set: "all", n: 90, s: { meropenem: 95, vancomycin: 0 } }] });
  assert.ok(S.scopes().some((x) => x.id === "local"));
  const t = S.table("local", "urine", "all");
  assert.equal(t.orgs[0].cells.meropenem.s, 95);
  assert.equal(t.orgs[0].cells.vancomycin.act, "intrinsic");
  assert.ok(S.table("india", "urine", "all").orgs.every((o) => o.rows.every((r) => !r.src.local)), "never pooled into India");
  S.localClear();
  assert.equal(S.table("local", "urine", "all").orgs.length, 0, "memoised tables dropped on change");
});

test("WISCA and ranking on a stratum", () => {
  const w = S.wisca("inst:A", "blood", "all", ["meropenem"], {});
  assert.ok(w.coverage > 0 && w.knownPct > 0);
  const rk = S.rank("inst:A", "blood", "all", { noReserve: true, minKnown: 1 });
  assert.ok(rk.length > 0);
  assert.ok(rk.every((x) => x.aware !== "R"));
});
