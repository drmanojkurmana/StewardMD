/* Kardia stable deep links + Teach pack: link build/parse, catalogue output,
 * teach data, and router behaviour (every catalogue entry resolves to an
 * existing item). Run: node --test --experimental-test-module-mocks
 * --experimental-sqlite test/kardia-links.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const LINKS = require("../kardia-links.js");
const TEACH = require("../kardia-teach.js");
const { build } = await import("../scripts/kardia-catalogue.mjs");

const ROOT = new URL("../", import.meta.url).pathname;
const readJSON = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const DASH = /[—–]/;

/* ---------- 1. link build + parse (pure, no DOM) ---------- */
test("link builds one stable link per kind; parse round trips it", () => {
  assert.equal(LINKS.link("view", "tte_plax"), "stewardmd://kardia/view/tte_plax");
  assert.equal(LINKS.link("calc", "lv-ef"), "stewardmd://kardia/calc/lv-ef");
  assert.equal(LINKS.link("lesson", "meas_simpson_ef"), "stewardmd://kardia/lesson/meas_simpson_ef");
  assert.equal(LINKS.link("case", "kd11a_as_severe_01"), "stewardmd://kardia/case/kd11a_as_severe_01");
  assert.deepEqual(LINKS.parse("stewardmd://kardia/calc/lv-ef"), { kind: "calc", id: "lv-ef" });
  assert.deepEqual(LINKS.parse("stewardmd://kardia/view/tte_plax?utm=x"), { kind: "view", id: "tte_plax" });
  assert.equal(LINKS.link("banana", "x"), "", "unknown kind builds nothing");
  assert.equal(LINKS.link("view", ""), "", "empty id builds nothing");
  assert.equal(LINKS.link("view", "a/b"), "", "slash in id builds nothing");
  assert.equal(LINKS.parse("stewardmd://kardia/banana/x"), null, "unknown kind parses to null");
  assert.equal(LINKS.parse("https://stewardmd.in/kardia/calc/lv-ef"), null, "web URL is not a deep link");
  assert.equal(LINKS.parse(""), null, "empty parses to null");
  assert.deepEqual(LINKS.KINDS, ["view", "calc", "lesson", "case"], "exactly the four promised kinds");
});

test("copy uses the clipboard when present and speaks the link otherwise", async () => {
  const said = [];
  let written = "";
  const clip = { writeText: (t) => { written = t; return Promise.resolve(); } };
  LINKS.copy.call(null, "stewardmd://kardia/calc/lv-ef", (m) => said.push(m));
  // No navigator/document in node: the fallback speaks the text itself.
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(said.includes("stewardmd://kardia/calc/lv-ef"), "offline failure still hands over the link: " + said.join("|"));
  assert.equal(written, "", "node has no clipboard to write");
  void clip;
});

/* ---------- 2. teach pack data ---------- */
test("teach pack: five bedside units, ai_drafted, plain short sentences", () => {
  assert.equal(TEACH.review, "ai_drafted", "teach content is draft until the owner reviews it");
  assert.deepEqual(TEACH.UNITS.map((u) => u.id), ["views", "lv", "valves", "right", "pocus"]);
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") { strings.push(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const u of TEACH.UNITS) {
    assert.ok(u.objectives.length >= 3, u.id + " needs aims");
    assert.ok(u.links.length >= 5, u.id + " needs links to use");
    assert.ok(u.desc && u.desc.en && u.desc.en.length > 40, u.id + " needs a course note to copy");
    walk(u);
    for (const l of u.links) {
      assert.ok(LINKS.KINDS.includes(l.kind), u.id + ": bad kind " + l.kind);
      assert.ok(LINKS.link(l.kind, l.id), u.id + ": bad link " + l.kind + "/" + l.id);
    }
  }
  const bad = strings.filter((s) => DASH.test(s));
  assert.deepEqual(bad.slice(0, 3), [], "no em or en dashes in teach text: " + bad.slice(0, 3).join(" | "));
});

/* ---------- 3. committed catalogue matches a fresh build ---------- */
test("kardia/catalogue.json is the generator output with a link per item", () => {
  const doc = readJSON("kardia/catalogue.json");
  const fresh = build();
  assert.deepEqual(fresh.errors, [], "generator is clean: " + fresh.errors.slice(0, 3).join(" | "));
  assert.deepEqual(doc.entries, fresh.entries, "committed catalogue matches the generator");
  assert.equal(doc.review, "ai_drafted");
  assert.deepEqual(doc.counts, { calc: 74, case: 30, lesson: 88, view: 43 });
  for (const e of doc.entries) {
    assert.ok(e.title && e.title.length > 0, e.kind + "/" + e.id + " needs a title");
    assert.equal(e.link, LINKS.link(e.kind, e.id), e.id + " link follows the scheme");
    assert.deepEqual(LINKS.parse(e.link), { kind: e.kind, id: e.id }, e.id + " link parses back");
    assert.ok(!DASH.test(e.title), e.id + " title carries a dash: " + e.title);
  }
});

/* ---------- 4. behaviour: links resolve through the router to real items ---------- */
function sandbox(pro) {
  const store = {}, prefs = {};
  let html = "";
  const classes = new Set();
  const root = {
    _sp: 0, className: "", innerHTML: "",
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    appendChild() {}, contains: () => false, focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const doc = {
    activeElement: null,
    head: { appendChild() {} },
    body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    createElement: () => ({ rel: "", href: "", async: false, setAttribute() {}, style: {}, onload: null, onerror: null }),
    getElementById: (id) => (id === "smdKardia" ? root : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    execCommand: () => false,
  };
  const calls = { openLearn: [], gate: [], paywall: 0, toast: [] };
  const fileFor = (url) => {
    const m = /\/kardia\/(.*)$/.exec(String(url).split("?")[0]);
    if (!m) return null;
    const p = ROOT + "kardia/" + m[1];
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const G = {
    SPECIALTY: undefined, SPECIALTY_CORE: undefined, SPECIALTY_DATA: undefined,
    document: doc, location: { search: "" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: (url) => {
      const t = fileFor(url);
      if (t == null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("404")) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(t)) });
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    setInterval: () => 0, clearInterval: () => {},
    toast: (m) => calls.toast.push(m),
    SMD_PRO: { isProSync: () => !!pro, openPaywall: () => { calls.paywall++; } },
    SMD_PRO_NOTICE: { show: () => { calls.paywall++; } },
    SMD_XACCESS: { gate: (f, go) => { calls.gate.push(f); } },
    KARDIOX: { openLearn: (id) => { calls.openLearn.push(id); }, open: () => {} },
    SMD_KARDIOX_CONTENT: { ecgs: [{ id: "l1", title: "First", category: "Normal" }] },
    ICONS: { get: () => "", has: () => false },
    navigator: {},
  };
  const ctx = vm.createContext(G);
  for (const f of ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js",
    "specialty-learn.js", "specialty-bank.js", "kardia-flags.js", "kardia-links.js",
    "kardia-calc-data.js", "kardia.js", "kardia-calc.js", "kardia-cases.js", "kardia-teach.js"])
    vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
  return { G, store, calls, painted: () => root.innerHTML };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("every catalogue entry resolves through openDeep to an existing item", async () => {
  const doc = readJSON("kardia/catalogue.json");
  const s = sandbox(true);
  s.store.smd_kardia = "1";
  assert.equal(s.G.KARDIA.open(), true);
  await tick(60);
  // A closed module opens first, then routes: one representative link.
  s.G.KARDIA.close();
  assert.equal(s.G.KARDIA.openDeep("stewardmd://kardia/calc/bsa"), true, "closed module accepts the link");
  await tick(60);
  assert.equal(s.G.KARDIA_CALC._state.cur, "bsa", "closed open lands on the calculator");
  let bad = [];
  for (const e of doc.entries) {
    let ok = false;
    try { ok = s.G.KARDIA.openDeep(e.link); } catch (err) { bad.push(e.link + " threw"); }
    if (!ok) bad.push(e.link);
    if (bad.length > 4) break;
  }
  await tick(120);
  assert.deepEqual(bad, [], "every catalogue link resolves: " + bad.slice(0, 4).join(" | "));
});

test("openDeep lands on the exact item per kind", async () => {
  const s = sandbox(true);
  s.store.smd_kardia = "1";
  s.G.KARDIA.open();
  await tick(60);
  assert.equal(s.G.KARDIA.openDeep("view", "tte_plax"), true);
  await tick(60);
  assert.equal(s.G.KARDIA._kardia.echoLab.viewId, "tte_plax", "view target selected");
  assert.equal(s.G.KARDIA.openDeep("calc", "lv-ef"), true);
  assert.equal(s.G.KARDIA_CALC._state.cur, "lv-ef", "calculator selected");
  assert.equal(s.G.KARDIA.openDeep("lesson", "view_a4c"), true);
  await tick(60);
  assert.equal(s.G.KARDIA._learn._w.les.id, "view_a4c", "lesson opened");
  assert.equal(s.G.KARDIA.openDeep("case", "kd11a_as_severe_01"), true);
  await tick(60);
  assert.equal(s.G.KARDIA_CASES._state.curId, "kd11a_as_severe_01", "case opened");
  assert.equal(s.G.KARDIA.openDeep("view", "no_such_view"), false, "unknown view returns false");
  assert.equal(s.G.KARDIA.openDeep("calc", "no_such_calc"), false, "unknown calculator returns false");
  assert.equal(s.G.KARDIA.openDeep("lesson", "no_such_lesson"), false, "unknown lesson returns false");
  assert.equal(s.G.KARDIA.openDeep("case", "no_such_case"), false, "unknown case returns false");
  assert.equal(s.G.KARDIA.openDeep("banana", "x"), false, "unknown kind returns false");
  assert.equal(s.G.KARDIA.openDeep("stewardmd://kardia/lesson/nope"), false, "bad full link returns false");
});

test("a locked item routes to the paywall, exactly like a tap", async () => {
  const s = sandbox(false);
  s.store.smd_kardia = "1";
  s.G.KARDIA.open();
  await tick(60);
  // kd11a_pda_moderate_01 is the third MBBS case: past the two free cases.
  assert.equal(s.G.KARDIA.openDeep("case", "kd11a_pda_moderate_01"), true, "locked case still resolves");
  await tick(60);
  assert.equal(s.calls.paywall, 1, "locked case shows the paywall");
  assert.equal(s.G.KARDIA_CASES._state.curId, null, "locked case does not open");
});

test("the new screens paint through the real engine: headers, copy buttons, teach rows", async () => {
  const s = sandbox(true);
  s.store.smd_kardia = "1";
  s.G.KARDIA.open();
  await tick(80);
  const A = s.G.KARDIA._internal.ACTIONS;
  const btn = (o) => ({ getAttribute: (a) => (a === "data-t" ? o.t : a === "data-u" ? o.u : a === "data-k" ? o.k : a === "data-id" ? o.id : null) });
  A.ktab(btn({ t: "learn" }));
  assert.ok(s.painted().includes("Teach pack"), "Learn tab lists the Teach pack");
  assert.ok(s.painted().includes("For teachers"), "Learn tab carries the teacher section");
  A.kteach(btn({ u: "lv" }));
  await tick(80);
  let h = s.painted();
  assert.ok(h.includes("LV function"), "teach unit paints its name");
  assert.ok(h.includes("Aims"), "teach unit paints its aims");
  assert.ok(h.includes("Links to use"), "teach unit paints its links");
  assert.ok(h.includes("Course note"), "teach unit paints the course note");
  assert.ok(h.includes("Copy course note"), "teach unit offers the copy");
  assert.ok(h.includes("stewardmd://kardia/lesson/meas_simpson_ef"), "teach rows print the stable links");
  assert.ok(h.includes("Draft teaching content"), "teach screen carries the draft note");
  A.kteach(btn({ u: "" }));
  assert.ok(s.painted().includes("Five 30 minute bedside sessions"), "teach list paints all five units");
  A.ktab(btn({ t: "calc" }));
  s.G.KARDIA_CALC.openCalc("lv-ef");
  h = s.painted();
  assert.ok(h.includes('data-act="kcalc-copylink"'), "calculator header paints the copy button");
  assert.ok(h.includes('aria-label="Copy link to LV ejection fraction (Simpson)"'), "copy button names its target");
  s.G.KARDIA.openDeep("lesson", "view_a4c");
  await tick(80);
  h = s.painted();
  assert.ok(h.includes('data-act="lncopylink"'), "lesson header paints the copy button");
  s.G.KARDIA.openDeep("view", "tte_a4c");
  await tick(80);
  h = s.painted();
  assert.ok(h.includes("krd-target-row"), "view header paints the copy row");
  assert.ok(h.includes("Copy link to view"), "view copy button names its target");
  assert.ok(h.includes("Back to Probe Lab"), "deep view keeps a way back");
  s.G.KARDIA.openDeep("case", "kd11a_as_severe_01");
  await tick(80);
  h = s.painted();
  assert.ok(h.includes('data-act="kcase-copylink"'), "case header paints the copy button");
  for (const needle of ["Copy link", "Teach pack", "stewardmd://kardia/"]) assert.ok(!DASH.test(needle), "needles carry no dashes");
});

test("router entry points forward the deep link (source checks)", () => {
  const nb = readFileSync(ROOT + "native-bridge.js", "utf8");
  assert.ok(/stewardmd:\\?\/\\?\/kardia\\?\/\(\[A-Za-z\]\+\)/.test(nb), "native-bridge parses stewardmd://kardia/<kind>/<id>");
  assert.ok(/deep: \{ kind: km\[1\]\.toLowerCase\(\), id: km\[2\] \}/.test(nb), "parse result travels as opts.deep");
  const home = readFileSync(ROOT + "home.js", "utf8");
  assert.ok(/key === "prep" \|\| key === "kardia"/.test(home), "SMD_openRoute forwards opts to Kardia");
  assert.ok(/kardia: function \(opts\)/.test(home) && /KARDIA\.open\(opts\)/.test(home), "ACT.kardia passes opts to KARDIA.open");
  const loader = readFileSync(ROOT + "kardia-loader.js", "utf8");
  assert.ok(loader.includes('"kardia-links.js"') && loader.includes('"kardia-teach.js"'), "loader ships the new files");
  assert.ok(/t\.open\.apply\(t, args\)/.test(loader), "loader stub forwards open args");
});
