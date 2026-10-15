/* PrepNucleus cross-listed modules (prep/taxonomy/crosslist.json + prep.js union paths).
 *
 * A cross-listed group is one disease taught in several subjects: it shows in every member subject's list under
 * its own title, and opening it from any subject loads the UNION of the members' bank files and overlays, deduped
 * by item id and normalised stem. Item ids never change, so progress (keyed by item and by the group's own id),
 * mistakes, bookmarks and share links keep working from every entry point.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-crosslist.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { overlaysOf } from "../tools/prep-overlay-counts.mjs";
import { crosslistRows } from "../tools/prep-build-bank.mjs";
const require = createRequire(import.meta.url);
const P = require("../prep.js");
const ROOT = new URL("..", import.meta.url);
const readJson = (u) => JSON.parse(fs.readFileSync(new URL(u, ROOT), "utf8"));
const headJson = (p) => JSON.parse(execFileSync("git", ["show", "HEAD:" + p], { encoding: "utf8", cwd: new URL("..", import.meta.url) }));

const XL = readJson("prep/taxonomy/crosslist.json");
const TAX = readJson("prep/taxonomy.json");
const inTax = new Set();
for (const b of TAX.branches) for (const s of b.subjects) for (const sec of s.sections || []) for (const m of sec.modules || []) inTax.add(s.id + "|" + m.id);
const groups = XL.groups || XL;

test("crosslist.json: stable unique ids, titles, and members that all exist in the taxonomy", () => {
  assert.ok(groups.length >= 20, "high-yield same-disease groups, got " + groups.length);
  const ids = groups.map((g) => g.id);
  assert.deepEqual([...new Set(ids)], ids, "group ids unique");
  for (const g of groups) {
    assert.match(g.id, /^x-[a-z0-9-]+$/, "stable id " + g.id);
    assert.ok(g.title && g.title.en, "title for " + g.id);
    assert.ok(g.members.length >= 2, g.id + " spans subjects");
    for (const [sid, mid] of g.members) assert.ok(inTax.has(sid + "|" + mid), `${g.id} member ${sid}/${mid} exists`);
  }
  const cerv = groups.find((g) => g.id === "x-cervical-cancer");
  assert.deepEqual(cerv.members.map((m) => m.join("/")).sort(), ["obstetrics-gynaecology/obg-cervical-cancer", "ss-gynaecological-oncology/gyn-cervix-endometrium", "ss-medical-oncology/son-cervix"].sort());
});

test("normStem: case, punctuation and spacing collapse", () => {
  assert.equal(P.normStem("  Cervical-Cancer:  HPV 16/18? "), "cervical cancer hpv 16 18");
  assert.equal(P.normStem("A"), "a");
  assert.equal(P.normStem(null), "");
  assert.equal(P.normStem("..."), "");
});

test("unionItems: id dedup first-wins, stem dedup across banks, empty stems never collapse", () => {
  const a = [{ id: "a1", q: "What causes cervical cancer?" }, { id: "a2", q: "HPV vaccine schedule?" }];
  const b = [{ id: "a1", q: "CHANGED TEXT SAME ID" }, { id: "b9", q: "what  causes   CERVICAL cancer!" }, { id: "b2", q: "Staging of cervical cancer?" }, { q: "No id item" }, { q: "" }, null];
  const u = P.unionItems([a, b]);
  assert.deepEqual(u.map((x) => x.id), ["a1", "a2", "b2", undefined, undefined]);
  assert.equal(u[0].q, "What causes cervical cancer?", "first file wins on id clash");
  assert.equal(u.length, 5, "same-stem cross-bank duplicate dropped once");
  assert.deepEqual(P.unionItems(null), []);
  assert.deepEqual(P.unionItems([[], []]), []);
});

test("xgroupsFor/xgroupById: every member subject lists the group; unknown ids give nothing", () => {
  assert.ok(P.xgroupsFor(groups, "ss-medical-oncology").some((g) => g.id === "x-cervical-cancer"));
  assert.ok(P.xgroupsFor(groups, "obstetrics-gynaecology").some((g) => g.id === "x-cervical-cancer"));
  assert.deepEqual(P.xgroupsFor(groups, "anatomy"), []);
  assert.deepEqual(P.xgroupsFor(null, "anatomy"), []);
  assert.equal(P.xgroupById(groups, "x-hcc").title.en, "Hepatocellular carcinoma");
  assert.equal(P.xgroupById({ groups }, "x-hcc").title.en, "Hepatocellular carcinoma");
  assert.equal(P.xgroupById(groups, "nope"), null);
});

test("xlistRow + countFor: union counts sum the members; plain rows read exactly as before", () => {
  const g = groups.find((x) => x.id === "x-hodgkin-lymphoma");
  const row = P.xlistRow(g, [{ count: 40, all: 44, usmle: 0, ov: 12 }, { count: 30, all: 31 }, null]);
  assert.equal(row.group, "xlist");
  assert.equal(row.title.en, "Hodgkin lymphoma");
  assert.equal(P.countFor(row, "neet-ss"), 40 + 30 + 12, "union count draws from every member");
  assert.equal(P.countFor({ count: 40, ov: 12 }, "neet-pg"), 52, "non-member counts unchanged");
  assert.equal(P.countFor({ count: 40, ov: 12, usmle: 9 }, "usmle"), 9);
});

test("subject list + hub: cross-listed rows filter like modules and feed solveNext once", () => {
  const row = { id: "x-hcc", title: { en: "HCC" }, group: "xlist", count: 70, ov: 8 };
  const topics = [{ id: "son-hcc", group: "s1", count: 40, ov: 0 }, row, { id: "son-empty", group: "s1", count: 0 }];
  const shown = P.filterModules(topics, {}, "all", "neet-ss");
  assert.deepEqual(shown.map((t) => t.id), ["son-hcc", "x-hcc"], "union row listed, empty module never listed");
  const nx = P.solveNext([{ id: "ss-medical-oncology" }], { "ss-medical-oncology": { topics } }, P.emptyStore(), 0, "neet-ss");
  assert.equal(nx.module, "son-hcc", "first unopened module wins either way");
  const store = P.emptyStore();
  store.cards = { "p:x-hcc:q1": [0, 0, 1, 0] };
  const prog = P.progressByModule(store, 0);
  assert.equal(prog["x-hcc"].answered, 1, "answers from either entry subject land on the one group deck");
});

test("progress carries across entry points: one deck, one star row, item-keyed mistakes and bookmarks", () => {
  assert.equal(P.deckKey("x-cervical-cancer"), "p:x-cervical-cancer", "same deck from every subject");
  const store = P.emptyStore();
  store.mod["x-cervical-cancer"] = { t: 6, ok: 5 };
  assert.equal(P.statusOf(6, 422), "paused");
  assert.equal(P.stars(store.mod["x-cervical-cancer"]), 4, "mastery shared across entry points");
  const mt = { q1: ["obstetrics-gynaecology", "x-cervical-cancer", null, 1, "prev"] };
  assert.equal(P.mistakeCounts(mt).all, 1, "mistakes stay keyed by item id");
});

test("crosslistRows (bank build): union rows per member subject, groups with no rows skipped, re-runs stable", () => {
  const gs = [{ id: "x-a", title: { en: "A" }, members: [["s1", "m1"], ["s2", "m2"]] }, { id: "x-ghost", title: { en: "G" }, members: [["s9", "m9"]] }];
  const get = (sid, mid) => ({ s1: { m1: { count: 10, all: 12, usmle: 0, ov: 3 } }, s2: { m2: { count: 7, all: 7, usmle: 2, ov: 0 } } }[sid] || {})[mid] || null;
  const out = crosslistRows(gs, get);
  assert.deepEqual([...out.keys()].sort(), ["s1", "s2"]);
  assert.deepEqual(out.get("s1")[0], { id: "x-a", title: { en: "A" }, group: "xlist", count: 17, all: 19, usmle: 2, ov: 3, file: null });
  assert.deepEqual(out.get("s2")[0].count, 17, "every member subject carries the union count");
  const again = crosslistRows([{ id: "x-a", title: { en: "A" }, members: [["s1", "m1"]] }], get);
  assert.equal(again.get("s1").length, 1, "one row per group per subject");
});

test("served indexes: every member subject carries its groups' union rows; member rows untouched", () => {
  const prepSrc = fs.readFileSync(new URL("prep.js", ROOT), "utf8");
  const VER = (/VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(prepSrc) || [])[1];
  const bv = {};
  for (const b of TAX.branches) for (const s of b.subjects) if (s.bv) bv[s.id] = s.bv;
  const setsOf = overlaysOf(prepSrc);
  const oc = readJson("prep/bank/overlay-counts.json");
  const ov = (sid, mid) => (setsOf[sid] || []).reduce((n, set) => n + (((oc.sets[set] || {})[sid] || {})[mid] || 0), 0);
  let checked = 0;
  for (const g of groups) {
    for (const [sid] of g.members) {
      const p = `prep/bank/${bv[sid] || VER}/${sid}/index.json`;
      const ix = readJson(p), old = headJson(p);
      const row = (ix.topics || []).find((t) => t.id === g.id);
      assert.ok(row && row.group === "xlist", `${sid} lists ${g.id}`);
      const members = g.members.map(([s2, m2]) => {
        const t = readJson(`prep/bank/${bv[s2] || VER}/${s2}/index.json`).topics.find((t) => t.id === m2);
        return { count: (t && t.count) || 0, ov: ov(s2, m2) };
      });
      assert.equal(row.count, members.reduce((a, x) => a + x.count, 0), `${sid}/${g.id} bank union`);
      assert.equal(row.ov, members.reduce((a, x) => a + x.ov, 0), `${sid}/${g.id} overlay union`);
      assert.deepEqual(
        (ix.topics || []).filter((t) => t.group !== "xlist"),
        (old.topics || []).filter((t) => t.group !== "xlist"),
        `${sid} non-member rows byte-identical in content`
      );
      checked++;
    }
  }
  assert.ok(checked >= 60, "every membership checked, got " + checked);
});
