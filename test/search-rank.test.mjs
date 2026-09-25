// test/search-rank.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = globalThis;
const mod = await import("../search.js");
const S = globalThis.SMD_SEARCH || mod.default;

test("terms: lowercases, trims, splits, drops empties", () => {
  assert.deepEqual(S.terms("  MELD  score "), ["meld", "score"]);
  assert.deepEqual(S.terms(""), []);
});

test("score: exact > prefix > word-prefix > substring > keyword > none", () => {
  const t = ["meld"];
  assert.equal(S.score(t, { title: "MELD", sub: "", kw: "" }), 100);
  assert.equal(S.score(t, { title: "MELD-Na", sub: "", kw: "" }), 90);
  assert.equal(S.score(t, { title: "Liver MELD", sub: "", kw: "" }), 80);
  assert.equal(S.score(t, { title: "Unmelded", sub: "", kw: "" }), 60);
  assert.equal(S.score(t, { title: "Liver score", sub: "", kw: "meld cirrhosis" }), 40);
  assert.equal(S.score(t, { title: "CrCl", sub: "", kw: "" }), 0);
});

test("score: every term must hit (AND), score is the mean of per-term bests", () => {
  const item = { title: "Insulin sliding scale", sub: "", kw: "" };
  assert.equal(S.score(["insulin", "scale"], item), 85);   // (90 + 80) / 2
  assert.equal(S.score(["insulin", "kidney"], item), 0);
});

test("score: fuzzy only for terms of 4+ chars, 1 edit for <=5 chars", () => {
  assert.equal(S.score(["menigitis"], { title: "Meningitis", sub: "", kw: "" }), 25);
  assert.equal(S.score(["mel"], { title: "Mld", sub: "", kw: "" }), 0);
});

test("rank: sorts by score then category weight then title, applies limit", () => {
  const items = [
    { cat: "kb",    title: "Insulinoma", sub: "", kw: "" },
    { cat: "tools", title: "Insulin",    sub: "", kw: "" },
    { cat: "calcs", title: "Insulin",    sub: "", kw: "" },
    { cat: "calcs", title: "CrCl",       sub: "", kw: "" },
  ];
  const out = S.rank("insulin", items, { limit: 3 });
  assert.deepEqual(out.map(i => i.cat + ":" + i.title), ["tools:Insulin", "calcs:Insulin", "kb:Insulinoma"]);
});

test("CATS is ordered and every entry has key, label, icon", () => {
  assert.deepEqual(S.CATS.map(c => c.key), ["tools", "calcs", "drugs", "kb", "proto", "syn", "icd", "settings"]);
  for (const c of S.CATS) { assert.ok(c.label && c.icon); }
});

test("providers: tools provider maps SMD_HOME_TOOLS and adds aliases", () => {
  globalThis.SMD_HOME_TOOLS = () => [{ act: "kardiox", tt: "KardiQ X AI", sub: "ECG", ic: "" }];
  const p = S.providers().find(p => p.cat === "tools");
  const it = p.items().find(i => i.id === "kardiox");
  assert.equal(it.title, "KardiQ X AI");
  assert.match(it.kw, /electrocardiogram/);
  assert.equal(S.rank("ecg", p.items())[0].id, "kardiox");
});

test("providers: settings items carry the toggle title", () => {
  globalThis.SMD_SETTINGS_INDEX = () => [{ id: "maikperf", title: "Show AI response time", sub: "x", key: "smd_maik_perf", group: "exp" }];
  const p = S.providers().find(p => p.cat === "settings");
  assert.equal(p.items()[0].title, "Show AI response time");
});

test("providers: every provider is sync (items) or async (query), never both", () => {
  for (const p of S.providers()) assert.ok((typeof p.items === "function") !== (typeof p.query === "function"), p.cat);
});

test("askItem: always produced, carries the query", () => {
  assert.equal(S.askItem("dka").title, 'Ask MaiK about "dka"');
});
