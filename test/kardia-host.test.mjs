/* Kardia host unit test (WP8): the flag, the loader, the Home tile swap, the host tabs and the
 * untouched KardiQ X gate. Modelled on test/tokos-wiring.test.mjs (source checks) plus a real
 * behavioural check: the REAL specialty engine (specialty-core/data/shell) with kardia.js on top,
 * driven in a vm sandbox with stubbed DOM/storage/network.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-host.test.mjs
 * (bare `node --test` is NOT the suite: 143 files need --experimental-test-module-mocks).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);

/* ---------- 1. the flag: DEFAULT OFF, tester mechanism only, no early-access tier ---------- */
test("smd_kardia defaults ON for everyone (owner 2026-10-26); 0 or ?kardia=0 turns it off on a device", () => {
  const FLAGS = require("../kardia-flags.js");
  assert.equal(FLAGS.DEFS.smd_kardia.def, true, "default on for everyone");
  assert.equal(FLAGS.DEFS.smd_kardia.query, "kardia", "tester query param");

  const g = globalThis;
  const keepLS = g.localStorage, keepLoc = g.location;
  try {
    const mem = {};
    g.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    g.location = { search: "" };
    assert.equal(FLAGS.bool("smd_kardia"), true, "on with nothing set");
    mem.smd_kardia = "1";
    assert.equal(FLAGS.bool("smd_kardia"), true, "localStorage 1 turns it on");
    mem.smd_kardia = "0";
    assert.equal(FLAGS.bool("smd_kardia"), false, "explicit 0 stays off");
    delete mem.smd_kardia;
    g.location = { search: "?kardia=1" };
    assert.equal(FLAGS.bool("smd_kardia"), true, "?kardia=1 turns it on");
    g.location = { search: "?kardia=0" };
    mem.smd_kardia = "1";
    assert.equal(FLAGS.bool("smd_kardia"), false, "?kardia=0 wins over localStorage");
  } finally {
    if (keepLS === undefined) delete g.localStorage; else g.localStorage = keepLS;
    if (keepLoc === undefined) delete g.location; else g.location = keepLoc;
  }
});

/* ---------- 2. boot loads only kardia-loader.js; the loader lists the engine + Kardia at one token ---------- */
test("app boot loads only kardia-loader.js; the loader lists the engine and Kardia files at one version token", () => {
  const html = readFileSync("index.html", "utf8");
  assert.ok(html.includes('<script src="/kardia-loader.js?v=krd16" defer></script>'), "loader tag at krd16");
  const eng = /(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?|kardia[-.\w]*)\.(js|css)\?v=\w+/g;
  const got = (html.match(eng) || []).filter((s) => !/kardiox/i.test(s));
  assert.deepEqual(got, ["kardia-loader.js?v=krd16"], "boot requests no engine or Kardia file but the loader, and no KardiQ X file is mistaken for Kardia: " + got.join(","));
  const L = readFileSync("kardia-loader.js", "utf8"), v = /var V = "(\w+)"/.exec(L)[1];
  assert.equal(v, "krd16", "the loader injects at the same token as its own tag");
  for (const f of ["specialty.css", "kardia.css", "specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "kardia-flags.js", "kardia-links.js", "kardia.js", "kardia-teach.js"]) assert.ok(L.includes('"' + f + '"'), f);
  assert.ok(L.indexOf('"specialty-shell.js"') < L.indexOf('"kardia.js"'), "engine, then the host");
  assert.ok(L.indexOf('"kardia-links.js"') < L.indexOf('"kardia.js"'), "deep links load before the host reads them");
});

test("the loader follows the on-for-everyone flag (owner 2026-10-26): on unless the device stored 0", () => {
  const t = readFileSync("kardia-loader.js", "utf8");
  assert.ok(/getItem\("smd_kardia"\) !== "0"/.test(t), "before kardia-flags.js loads, the loader treats Kardia as on unless 0");
  assert.ok(!/hasEarlyAccess|earlyAccess/.test(t), "no early-access tier");
});

test("build-www.sh ships the kardia data directory; root kardia files ride the root globs", () => {
  const b = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(/cp -R kardia\/\./.test(b), "kardia/ (tracks.json) ships like tokos/");
});

/* ---------- 3. Home: flag off = unchanged; flag on = Kardia replaces the KardiQ X tile ---------- */
test("home tile: Kardia is on for everyone (owner 2026-10-26) and replaces the KardiQ X tile while on", () => {
  const h = readFileSync("home.js", "utf8");
  const i = h.indexOf('act: "kardia"');
  assert.ok(i > 0, "kardia tile entry exists");
  const tile = h.slice(i, i + 400);
  assert.ok(!/defOn: false/.test(tile.slice(0, tile.indexOf("eligible"))), "no defOn:false, so a tester with the flag on sees it like the KardiQ X tile");
  assert.ok(/kardiaOn\(\)/.test(tile), "eligible() reads the tester flag");
  assert.ok(/getItem\("smd_kardia"\) !== "0"/.test(h), "before kardia-flags.js loads, Home treats Kardia as on unless the device stored 0");
  assert.ok(!/hasEarlyAccess/.test(h.slice(h.indexOf("function kardiaOn"), h.indexOf("function kardiaOn") + 600)), "kardiaOn has no early-access tier");
  const kx = h.slice(h.indexOf('act: "kardiox"'), h.indexOf('act: "kardiox"') + 500);
  assert.ok(/&& !kardiaOn\(\)/.test(kx), "KardiQ X tile hides while Kardia is on");
  // The Learn ECG tile (atlas + quiz, no AI) is untouched: open to every user with its own kill switch.
  const kxl = h.slice(h.indexOf('act: "kxlearn"'), h.indexOf('act: "kxlearn"') + 600);
  assert.ok(!/kardia/i.test(kxl), "Learn ECG tile has no Kardia condition");
  // ACT.kardia: quiet no-op when the flag is off, opens KARDIA when on.
  const a = h.indexOf("kardia: function");
  assert.ok(a > 0, "ACT.kardia exists");
  const act = h.slice(a, a + 400);
  assert.ok(/homeToolEligible/.test(act) && /KARDIA\.open/.test(act), "kill switch first, then KARDIA.open");
});

test("swipe-back wires KARDIA and yields while the KardiQ X overlay is above it", () => {
  const s = readFileSync("swipe-back.js", "utf8");
  assert.ok(/KARDIA\.isOpen\(\)\) return true/.test(s), "canGoBack sees Kardia");
  assert.ok(/KARDIA\.back\(\) !== false/.test(s), "goBack unwinds Kardia");
  assert.ok(/kardioxRoot/.test(s), "back belongs to Learn ECG / KardiQ X while its overlay is open");
});

test("tool-groups and search know the Kardia tool (repo test enforces one section + a description)", () => {
  const tg = readFileSync("tool-groups.js", "utf8");
  assert.ok(tg.includes('"kardia"'), "kardia sits in exactly one GROUPS section");
  assert.ok(/kardia: "Echo and ECG learning/.test(tg), "one-line DESC");
  assert.ok(readFileSync("search.js", "utf8").includes('kardia: "kardia echo'), "search keywords");
});

/* ---------- 4. kardia.js source: engine host, seven tabs, four levels, free preview constant ---------- */
test("kardia.js: Specialty Engine host with seven tabs, four levels and a free-preview constant", () => {
  const src = readFileSync("kardia.js", "utf8");
  assert.ok(/SPECIALTY;[^]*createHost|createHost\(cfg\)/.test(src), "built on SPECIALTY.createHost");
  assert.ok(/id: "kardia"/.test(src) && /flag: "smd_kardia"/.test(src), "host id + kill switch");
  assert.ok(/proFeature: "kardia"/.test(src), "Pro lock names the kardia feature");
  assert.ok(/\["mbbs", "resident", "fellow", "sonographer"\]/.test(src), "levels picker: MBBS, Resident, Fellow, Sonographer");
  assert.ok(/var FREE_LESSONS = 5/.test(src), "free preview count is a named constant");
  for (const t of ["echo", "angio", "learn", "practice", "cases", "calc", "kardiox"]) assert.ok(src.includes('"' + t + '"'), "tab " + t);
  assert.ok(!/registerSim|registerClinic|registerExplorer/.test(src), "WP8 registers no sims/clinics/explorers: coming soon states only");
  assert.ok(/SMD_XACCESS\.gate\("kardiox"/.test(src), "KardiQ X tab goes through the untouched access gate");
  assert.ok(/KARDIOX\.openLearn/.test(src), "Learn tab opens the existing atlas in place");
  assert.ok(!/WebGL|three\.js|threejs/i.test(src), "no simulator in WP8: the renderer is a later work package");
  // ES5 only (engine test rule), no em/en dashes and no web-or-browser wording in app text.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/(^|[^\w.])(let|const) |=>|`/.test(code), "kardia.js is ES5");
  assert.ok(!/[—–]/.test(src), "no em or en dashes");
  assert.ok(!/web app|browser/i.test(src), "a phone app: never web app or browser in text");
});

/* ---------- 5. behaviour: the real engine + kardia.js in a sandbox ---------- */
function sandbox(extra) {
  const store = {}, prefs = {};
  let html = "";
  const classes = new Set();
  const root = {
    _sp: 0, className: "", innerHTML: "",
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, removeAttribute() {},
    addEventListener() {}, appendChild() {}, contains: () => false,
    // The engine would append a draft footer here if the host opted in; Kardia does not.
    querySelector: (sel) => (sel === ".sp-scroll"
      ? { insertAdjacentHTML: (pos, h) => { root.innerHTML += h; } }
      : null),
    focus() {}
  };
  const handlers = {};
  const doc = {
    activeElement: null,
    body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    createElement: () => ({ rel: "", href: "", async: false, setAttribute() {}, onload: null, onerror: null }),
    getElementById: (id) => (id === "smdKardia" ? root : null),
    querySelector: () => null,
    addEventListener: (t, f) => { handlers[t] = f; }
  };
  const calls = { openLearn: [], gate: [], paywall: 0, toast: [] };
  const G = {
    SPECIALTY: undefined, SPECIALTY_CORE: undefined, SPECIALTY_DATA: undefined,
    document: doc, location: { search: "" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 1, tracks: [], access: { freeLevels: ["mbbs"] }, sources: {} }) }),
    toast: (m) => calls.toast.push(m),
    SMD_PRO: { isProSync: () => false, openPaywall: () => { calls.paywall++; } },
    SMD_PRO_NOTICE: { show: () => { calls.paywall++; } },
    SMD_XACCESS: { gate: (f, go) => { calls.gate.push(f); } },
    KARDIOX: { openLearn: (id) => { calls.openLearn.push(id); }, open: () => {} },
    SMD_KARDIOX_CONTENT: {
      ecgs: [
        { id: "normal-sinus-rhythm-01", title: "Normal Sinus Rhythm", category: "Normal" },
        { id: "lesson-2", title: "Second lesson", category: "Normal" },
        { id: "lesson-3", title: "Third lesson", category: "Normal" },
        { id: "lesson-4", title: "Fourth lesson", category: "Normal" },
        { id: "lesson-5", title: "Fifth lesson", category: "Normal" },
        { id: "lesson-6", title: "Sixth lesson", category: "Locked" },
        { id: "lesson-7", title: "Seventh lesson", category: "Locked" }
      ]
    },
    ICONS: { get: () => "", has: () => false }
  };
  Object.assign(G, extra || {});
  const ctx = vm.createContext(G);
  for (const f of ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "kardia.js"])
    vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f });
  const painted = () => root.innerHTML;
  return { G, ctx, store, prefs, calls, painted, root };
}

function btn(v) { return { getAttribute: (a) => (a === "data-t" ? v.t : a === "data-v" ? v.v : a === "data-id" ? v.id : null) }; }

test("flag off: KARDIA.open() is a no-op that touches no DOM", async () => {
  const s = sandbox();
  s.store.smd_kardia = "0";
  assert.equal(s.G.KARDIA.open(), false, "closed flag refuses");
  assert.equal(s.painted(), "", "no DOM touched");
});

test("Learn tab: free preview opens real atlas lessons in place; the rest is Pro", async () => {
  const s = sandbox();
  s.store.smd_kardia = "1";
  s.G.KARDIA.open();
  await new Promise((r) => setTimeout(r, 50));
  s.G.KARDIA._internal.ACTIONS.ktab(btn({ t: "learn" }));
  const h = s.painted();
  assert.ok(h.includes("Normal Sinus Rhythm"), "free preview lists real atlas lessons");
  assert.ok(h.includes("Plus 2 more lessons"), "locked rest is counted, not listed");
  s.G.KARDIA._internal.ACTIONS.klearn(btn({ id: "normal-sinus-rhythm-01" }));
  assert.deepEqual(s.calls.openLearn, ["normal-sinus-rhythm-01"], "a free lesson opens in place, unchanged, by id");
  s.G.KARDIA._internal.ACTIONS.klearn(btn({}));
  assert.deepEqual(s.calls.openLearn, ["normal-sinus-rhythm-01", undefined], "the full atlas opens for Pro through the same unchanged entry");
});

test("KardiQ X tab still passes the untouched access gate", () => {
  const s = sandbox();
  s.store.smd_kardia = "1";
  s.G.KARDIA.open();
  s.G.KARDIA._internal.ACTIONS.ktab(btn({ t: "kardiox" }));
  assert.ok(s.painted().includes("Open KardiQ X"), "tab names the AI reading");
  s.G.KARDIA._internal.ACTIONS.kx({});
  assert.deepEqual(s.calls.gate, ["kardiox"], 'SMD_XACCESS.gate("kardiox") is still called');
});
