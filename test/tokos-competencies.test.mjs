/* test/tokos-competencies.test.mjs - NMC CBME 2024 OG competency list and its Tokos map.
 *
 * competencies.json is extracted from the NMC document; competency-map.json maps each code to Tokos unit
 * ids (master plan Section 5), contract items and OSCE stations (plan Task 7.17).
 *
 * Run: node --experimental-test-module-mocks --test test/tokos-competencies.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = new URL("../tokos/learn/", import.meta.url);
const rawComp = readFileSync(new URL("competencies.json", dir), "utf8");
const rawMap = readFileSync(new URL("competency-map.json", dir), "utf8");
const comp = JSON.parse(rawComp);
const cmap = JSON.parse(rawMap);

const range = (p, n) => Array.from({ length: n }, (_, i) => p + (i + 1));
const UNITS = new Set([...range("ob", 12), ...range("obr", 8), ...range("gy", 12), ...range("gyr", 8)]);
const isMbbs = (u) => /^(ob|gy)\d+$/.test(u);
const ITEMS = new Set([
  ...["ctg", "fetal-planes", "hc-biometry"].map((x) => "clinic:" + x),
  ...["labour", "pph", "eclampsia", "shoulder", "breech", "twins", "collapse", "ovulation", "hrt", "pmb", "steroids"].map((x) => "drill:" + x),
  ...["mechanism", "cycle", "palm-coein", "popq", "ovarian-triage", "cervical-screening"].map((x) => "explorer:" + x),
  ...["edd", "bishop", "mgso4", "antid", "dipsi", "apgar", "efw", "weightgain", "vbac", "ganzoni", "rmi", "meows", "mec"].map((x) => "tool:" + x),
]);
const OSCE = new Set(["obstetric-history", "exam-in-pregnancy", "gynae-history", "speculum-bimanual", "breaking-bad-news",
  "contraception-counselling", "consent-caesarean", "pph-team", "eclampsia-team", "cervical-screening-counselling"]);
const codes = comp.items.map((i) => i.code);

test("source is recorded", () => {
  assert.ok(comp.source.title && comp.source.year === 2024 && /^https:\/\/.*nmc\.org\.in\//.test(comp.source.url));
});

test("competency codes are unique and well formed", () => {
  assert.equal(new Set(codes).size, codes.length);
  for (const i of comp.items) {
    assert.match(i.code, /^OG\d+\.\d+$/);
    assert.ok(i.text.length > 5, i.code);
    assert.match(i.domain, /^[KSAC](\/[KSAC])*$/, i.code);
    assert.ok(["K", "KH", "SH", "P", "K/KH", "K/SH", "KH/SH"].includes(i.level), i.code + " " + i.level);
    assert.equal(typeof i.core, "boolean", i.code);
    assert.ok(comp.topics.some((t) => t.n === i.topic), i.code);
  }
});

test("counts match the NMC document (38 topics, 142 listed, 16 certifiable)", () => {
  assert.equal(comp.topics.length, 38);
  assert.equal(codes.length, 142);
  assert.equal(comp.items.filter((i) => i.certify != null).length, 16);
});

test("every map target is a valid unit, contract item or OSCE station", () => {
  for (const [code, e] of Object.entries(cmap.map)) {
    assert.ok(codes.includes(code), "unknown code " + code);
    assert.ok(e.units.length || e.items?.length || e.osce?.length, code + " has no target");
    for (const u of e.units) assert.ok(UNITS.has(u), code + " unit " + u);
    for (const x of e.items || []) assert.ok(ITEMS.has(x), code + " item " + x);
    for (const s of e.osce || []) assert.ok(OSCE.has(s), code + " osce " + s);
    if (!e.units.some(isMbbs)) assert.ok(isMbbs(e.suggestedUnit) && UNITS.has(e.suggestedUnit), code + " needs an MBBS suggestedUnit");
  }
  for (const u of cmap.unmapped) {
    assert.ok(codes.includes(u.code), "unknown code " + u.code);
    assert.ok(isMbbs(u.suggestedUnit) && UNITS.has(u.suggestedUnit), u.code + " suggestedUnit");
  }
});

test("each competency is in map or unmapped, exactly once", () => {
  const seen = [...Object.keys(cmap.map), ...cmap.unmapped.map((u) => u.code)];
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual([...seen].sort(), [...codes].sort());
});

test("coverage block matches the map", () => {
  const es = codes.map((c) => cmap.map[c] || { units: [] });
  const n = codes.length;
  assert.equal(cmap.coverage.total, n);
  assert.equal(cmap.coverage.unmapped, cmap.unmapped.length);
  assert.equal(cmap.coverage.withUnit, es.filter((e) => e.units.length).length);
  assert.equal(cmap.coverage.withUnitOrItem, es.filter((e) => e.units.length || e.items?.length).length);
  assert.equal(cmap.coverage.withUnitItemOrOsce, n - cmap.unmapped.length);
  assert.equal(cmap.coverage.withMbbsUnit, es.filter((e) => e.units.some(isMbbs)).length);
});

test("no em-dash or en-dash in the data", () => {
  assert.ok(!/[—–]/.test(rawComp + rawMap));
});
