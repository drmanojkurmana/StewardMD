/* Collapsible Tests tab (owner 2026-10-11, prep-tests.js grouping).
 * What must hold:
 *  - exams order with the student's exam first; only it is open, others closed;
 *  - inside it only Daily 10 and Grand open, the rest collapsed; open state persists per exam;
 *  - headers are buttons with aria-expanded/controls, counts read "N, M done";
 *  - collapsed groups render lazily (no paper rows until opened); big groups show 6 + Show all N;
 *  - groups past 20 papers show a filter box; a sticky jump bar lists the 12 formats;
 *  - resume, done status, honest empties, ?tests2=0 and offline still work.
 *  - gaps B starters: Daily mixed beside Daily 10; image/case exam + subject starters; weak-area and
 *    incorrect-questions engine starters with honest disabled whys; engine custom reachable, study custom kept.
 * node --test test/prep-tests-collapse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PURE = require("../prep.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "prep-tests.js"), "utf8");

function profiles() {
  const base = (id, name, tab) => ({
    id, name, tab, status: "official", version: "2026.1.0", verified_on: "2026-10-10",
    format: { questions: 180, duration_min: 210, sections: [{ id: "A", label: "Section A", questions: 36, minutes: 42 }] },
    scoring: { correct: 4, incorrect: -1, unanswered: 0, pass: null },
    pace_sec: 70, blueprint: { kind: "none" }, sources: { S: { title: "Bulletin" } },
  });
  return [base("neet-pg", "NEET-PG", "neet-pg"), base("ini-cet", "INI-CET", "neet-pg")];
}
function mockA(list) {
  const byId = {};
  list.forEach((p) => { byId[p.id] = p; });
  return {
    forTab: (tab) => list.filter((p) => p.tab === tab),
    profile: (id) => byId[id] || null,
    profileIds: () => list.map((p) => p.id),
    bankStatus: () => "available",
    blueprint: (p, type) => {
      if (!p) return null;
      if (type === "part") return null;
      if (type === "daily10") return { count: 10, duration_sec: 700, min_viable: 10, pace: 70 };
      if (type === "grand") return { count: 180, duration_sec: 12600, min_viable: 90 };
      if (type === "mini") return { count: 36, duration_sec: 2520, min_viable: 18 };
      return { count: 20, duration_sec: 1400, min_viable: 5 };
    },
    dailyKey: (exam) => "daily10:" + exam + ":2026-10-11",
    paceSec: () => 70,
  };
}
function mockStore() {
  return { t2h: [], t2d: {}, pl: null, mt: {}, cards: {}, mod: {} };
}
function mockH(store, ls) {
  return {
    store: () => store, exam: () => ({ id: "neet-pg", label: "NEET-PG" }),
    row: (act, icon, title, sub, attrs) => '<button type="button" class="pn-row" data-act="' + act + '"' + (attrs || "") + "><b>" + title + "</b><small>" + sub + "</small></button>",
    ico: (n) => '<svg data-ico="' + n + '"></svg>',
    fmt: (n) => String(n), planToday: () => ({ due: 0, left: 0, weak: [] }),
    root: () => null, pure: PURE,
  };
}
function loadT2(list, store, lsGet, lsSet, search) {
  const mem = {};
  const G = {
    location: { search: search || "" },
    localStorage: {
      getItem: (k) => (lsGet ? lsGet(k, mem) : (k in mem ? mem[k] : null)),
      setItem: (k, v) => { if (lsSet) lsSet(k, v, mem); else mem[k] = String(v); },
    },
    PREP_ASSESS: mockA(list), PREP_PYQ: null, matchMedia: () => ({ matches: false }),
  };
  new Function("window", "module", SRC)(G, undefined);
  const T2 = G.PREP_TESTS;
  T2._G = G;
  T2._mem = mem;
  return T2;
}
function papers() {
  const out = [];
  for (let i = 1; i <= 38; i++) out.push({ id: "neet-pg-sub-anatomy-" + i, exam: "neet-pg", format: "subject_mini", title: "NEET-PG Anatomy Test " + i, count: 20, duration_sec: 1400, scope: "Anatomy", path: "x" });
  for (let i = 1; i <= 15; i++) out.push({ id: "neet-pg-grand-" + i, exam: "neet-pg", format: "grand", title: "NEET-PG Grand Test " + i, count: 180, duration_sec: 12600, scope: "All subjects", path: "x" });
  for (let i = 1; i <= 15; i++) out.push({ id: "neet-pg-daily10-" + i, exam: "neet-pg", format: "daily10", title: "NEET-PG Daily 10 Set " + i, count: 10, duration_sec: 700, scope: "Mixed", path: "x" });
  for (let i = 1; i <= 3; i++) out.push({ id: "neet-pg-image-" + i, exam: "neet-pg", format: "image", title: "NEET-PG Image Test " + i, count: 20, duration_sec: 1400, scope: "Images", path: "x" });
  for (let i = 1; i <= 2; i++) out.push({ id: "ini-cet-grand-" + i, exam: "ini-cet", format: "grand", title: "INI-CET Grand Test " + i, count: 200, duration_sec: 10800, scope: "All", path: "x" });
  return out;
}
function doneStore() {
  const s = mockStore();
  for (let i = 1; i <= 5; i++) s.t2h.push({ exam: "neet-pg", type: "custom", paper: "neet-pg-sub-anatomy-" + i, raw: 10, max: 20, ts: 1 });
  s.t2h.push({ exam: "neet-pg", type: "grand", paper: "neet-pg-grand-1", raw: 100, max: 180, ts: 2 });
  s.t2h.push({ exam: "neet-pg", type: "grand", paper: null, raw: 90, max: 180, ts: 3 });
  s.t2h.push({ exam: "neet-pg", type: "diagnostic", paper: null, raw: 12, max: 20, ts: 4 });
  s.t2d["daily10:neet-pg:2026-10-11"] = { ts: 1, raw: 5, max: 10, correct: 6, n: 10 };
  return s;
}

test("pure grouping: order, names, exam order, filter and visible", () => {
  const T2 = loadT2(profiles(), mockStore());
  const g = T2._grp;
  assert.deepEqual(g.ORDER, ["daily10", "grand", "part", "mini", "subject_mini", "topic", "image", "case", "weak_area", "incorrect", "pyq", "custom"]);
  assert.equal(g.name("subject_mini"), "Subject tests");
  assert.equal(g.name("pyq"), "PYQ papers");
  assert.equal(g.name("daily10"), "Daily sets");
  assert.equal(g.name("case"), "Clinical cases");
  assert.equal(g.name("weak_area"), "Weak areas");
  assert.equal(g.name("incorrect"), "Incorrect questions");
  assert.equal(g.short("subject_mini"), "Subject");
  const ord = g.examOrder(profiles(), "ini-cet").map((p) => p.id);
  assert.deepEqual(ord, ["ini-cet", "neet-pg"]);
  assert.deepEqual(g.examOrder([], "x"), []);
  const px = papers();
  assert.equal(g.fxFor(px, "neet-pg", "subject_mini").length, 38);
  assert.equal(g.fxFor(px, "ini-cet", "grand").length, 2);
  assert.equal(g.fxFor(null, "neet-pg", "grand").length, 0);
  assert.equal(g.filterFx(px.slice(0, 38), "anatomy test 1").length >= 10, true);
  assert.equal(g.filterFx(px.slice(0, 38), "ZZZ-no-match").length, 0);
  assert.equal(g.filterFx(px.slice(0, 38), "").length, 38);
  assert.equal(g.visibleFx(px.slice(0, 38), false).length, 6);
  assert.equal(g.visibleFx(px.slice(0, 38), true).length, 38);
  assert.equal(g.visibleFx(px.slice(0, 3), false).length, 3);
  assert.equal(g.FIRST, 6);
  assert.equal(g.SEARCH_AT, 20);
});

test("pure counting and defaults", () => {
  const T2 = loadT2(profiles(), mockStore());
  const g = T2._grp;
  const s = doneStore();
  assert.equal(g.paperDone(s.t2h, "neet-pg-sub-anatomy-1"), true);
  assert.equal(g.paperDone(s.t2h, "neet-pg-sub-anatomy-9"), false);
  assert.equal(g.engineDone(s.t2h, "neet-pg", "grand"), true);
  assert.equal(g.engineDone(s.t2h, "neet-pg", "mini"), false);
  assert.equal(g.dailyDoneByKey(s.t2d, "daily10:neet-pg:2026-10-11"), true);
  assert.equal(g.dailyDoneByKey(s.t2d, "daily10:ini-cet:2026-10-11"), false);
  assert.equal(g.countFxDone(papers().filter((r) => r.format === "subject_mini"), s.t2h), 5);
  assert.equal(g.defaultExamOpen("neet-pg", "neet-pg"), true);
  assert.equal(g.defaultExamOpen("ini-cet", "neet-pg"), false);
  assert.equal(g.defaultGrpOpen("neet-pg", "neet-pg", "daily10"), true);
  assert.equal(g.defaultGrpOpen("neet-pg", "neet-pg", "grand"), true);
  assert.equal(g.defaultGrpOpen("neet-pg", "neet-pg", "mini"), false);
  assert.equal(g.defaultGrpOpen("ini-cet", "neet-pg", "grand"), false);
});

test("persistence works without localStorage and survives bad JSON", () => {
  const T2 = loadT2(profiles(), mockStore());
  const g = T2._grp;
  assert.deepEqual(g.loadGrp(), { v: 1, exams: {} });
  g.setGrpOpen(g.loadGrp(), "neet-pg", "mini", true);
  assert.equal(g.grpIsOpen(g.loadGrp(), "neet-pg", "neet-pg", "mini"), true);
  assert.equal(g.grpIsOpen(g.loadGrp(), "neet-pg", "neet-pg", "topic"), false);
  const Tbad = loadT2(profiles(), mockStore(), () => "{nope", () => {});
  assert.deepEqual(Tbad._grp.loadGrp(), { v: 1, exams: {} });
  const Tthrow = loadT2(profiles(), mockStore(), () => { throw new Error("denied"); }, () => { throw new Error("denied"); });
  assert.deepEqual(Tthrow._grp.loadGrp(), { v: 1, exams: {} });
  assert.equal(Tthrow._grp.grpIsOpen(Tthrow._grp.loadGrp(), "neet-pg", "neet-pg", "grand"), true);
  Tthrow._grp.setGrpOpen(Tthrow._grp.loadGrp(), "neet-pg", "mini", true);
});

test("?tests2=0 still turns the tab off; default stays on", () => {
  const T2 = loadT2(profiles(), mockStore(), null, null, "");
  assert.equal(T2.on(), true);
  T2._G.location.search = "?tests2=0";
  assert.equal(T2.on(), false);
  T2._G.location.search = "?tests2=1";
  assert.equal(T2.on(), true);
  T2._G.location.search = "";
  T2._G.localStorage.setItem("smd_prep_tests2", "0");
  assert.equal(T2.on(), false);
});

test("testsHtml: primary exam first and open, Daily 10 and Grand open, counts in headers", () => {
  const list = profiles(), store = doneStore();
  const T2 = loadT2(list, store);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(mockH(store));
  assert.ok(html.indexOf('data-p="neet-pg"') < html.indexOf('data-p="ini-cet"'), "primary first");
  assert.ok(html.includes('class="pn-t2xhead" data-act="t2-x" data-p="neet-pg" aria-expanded="true"'), "primary exam open");
  assert.ok(html.includes('data-act="t2-x" data-p="ini-cet" aria-expanded="false"'), "other exam closed");
  assert.ok(html.includes('data-act="t2-g" data-p="neet-pg" data-f="daily10" aria-expanded="true"'), "daily open");
  assert.ok(html.includes('data-act="t2-g" data-p="neet-pg" data-f="grand" aria-expanded="true"'), "grand open");
  assert.ok(html.includes('data-act="t2-g" data-p="neet-pg" data-f="mini" aria-expanded="false"'), "mini closed");
  assert.ok(html.includes("Subject tests</span>"), "group name");
  assert.ok(html.includes("38, 5 done"), "subject counts: 38 papers, 5 done");
  assert.ok(html.includes("16, 3 done") || html.includes("16, 2 done"), "grand counts include the engine starter");
  assert.ok(html.includes("3, 1 done"), "custom counts diagnostic done");
  const jumps = (html.match(/data-act="t2-jump"/g) || []).length;
  assert.equal(jumps, 24, "12 jump chips per exam");
  assert.ok(html.includes('role="navigation" aria-label="Jump to test type"'), "jump bar labelled");
  const gheads = (html.match(/class="pn-t2ghead"[^>]*aria-expanded="[^"]*"[^>]*aria-controls="pnT2G-[^"]+"/g) || []).length;
  assert.equal(gheads, 24, "every group header exposes expanded/controls");
  assert.equal((html.match(/<h2 class="pn-t2xh">/g) || []).length, 2, "exam headers keep h2 hierarchy");
  assert.equal((html.match(/<h3 class="pn-t2gh">/g) || []).length, 24, "group headers keep h3 hierarchy");
});

test("lazy render: collapsed groups build no rows; open groups cap at 6 with Show all", () => {
  const list = profiles(), store = doneStore();
  const T2 = loadT2(list, store);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(mockH(store));
  assert.ok(!html.includes("NEET-PG Anatomy Test 1"), "collapsed subject builds no rows");
  const fxRows = (html.match(/data-fx="/g) || []).length;
  assert.equal(fxRows, 12, "daily (6) + grand (6) only; the rest lazy");
  assert.ok(html.includes("Show all 15"), "big open groups cap with Show all");
  assert.ok(html.includes('data-lazy="1"'), "collapsed bodies stay lazy");
  assert.ok(!html.includes('class="pn-in pn-t2search" data-p="neet-pg" data-f="grand"'), "15 papers: no filter box");
  const Topen = loadT2(list, store, (k, mem) => (k === "smd_prep_t2grp" ? JSON.stringify({ v: 1, exams: { "neet-pg": { open: true, groups: { subject_mini: true } } } }) : (mem[k] ?? null)));
  Topen._P.fx = papers();
  Topen._P.sess = null;
  const html2 = Topen.testsHtml(mockH(store));
  assert.ok(html2.includes("NEET-PG Anatomy Test 1"), "opened group builds rows");
  assert.ok(html2.includes("Show all 38"), "38 papers cap with Show all 38");
  assert.ok(html2.includes('aria-label="Filter Subject tests"'), "past 20 papers a filter box appears");
});

test("honest empties, loading and offline fixed states", () => {
  const list = profiles(), store = mockStore();
  const openPart = (k, mem) => (k === "smd_prep_t2grp" ? JSON.stringify({ v: 1, exams: { "neet-pg": { open: true, groups: { part: true, image: true, pyq: true } } } }) : (mem[k] ?? null));
  const T2 = loadT2(list, store, openPart);
  T2._P.fx = [];
  T2._P.sess = null;
  const html = T2.testsHtml(mockH(store));
  assert.ok(html.includes("One-part tests apply only to FMGE."), "part honest on non-FMGE");
  assert.ok(html.includes("Build an image test"), "image on-demand starter replaces the fixed-only empty");
  assert.ok(html.includes("No PYQ papers for this exam yet."), "pyq honest empty");
  const Tload = loadT2(list, store);
  Tload._P.fx = null;
  Tload._P.sess = null;
  const htmlL = Tload.testsHtml(mockH(store));
  assert.ok(htmlL.includes("Loading papers"), "open groups show loading while the index loads");
  assert.ok(htmlL.includes("Start Daily 10"), "engine starters render without the index (offline)");
});

test("resume and Your practice survive the regrouping", () => {
  const list = profiles(), store = doneStore();
  store.mt = { a: 1, b: 1 };
  const T2 = loadT2(list, store);
  T2._P.fx = papers();
  T2._P.sess = { v: 1, t2: { exam: "x" }, title: "NEET-PG Grand", ans: [0, -1], q: [["s", "m"]], saved: Date.now(), done: false };
  const H = mockH(store);
  H.planToday = () => ({ due: 3, left: 5, weak: ["m1"] });
  const html = T2.testsHtml(H);
  assert.ok(html.includes("Resume your NEET-PG Grand"), "resume stays on top");
  assert.ok(html.includes("Your practice"), "global practice section kept");
  assert.ok(html.includes("Today&#39;s set") || html.includes("Today's set"), "today set kept");
  assert.ok(html.includes("Weak areas") && html.includes("My mistakes"), "weak and mistakes kept");
});

test("collapsible CSS: short motion, reduced-motion off switch, no glow/backdrop", () => {
  const css = fs.readFileSync(path.join(ROOT, "prep-tests.css"), "utf8");
  assert.match(css, /\.pn-t2gbody[^{]*\{[^}]*grid-template-rows/);
  assert.match(css, /180ms var\(--pn-ease\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.pn-t2gbody[^}]*transition: none/);
  assert.match(css, /\.pn-t2jump[^}]*position: sticky/);
  assert.match(css, /aria-expanded="true"[^}]*rotate\(90deg\)/);
  assert.match(css, /\.pn-t2ghead[^}]*scroll-margin-top/);
  assert.match(css, /\.pn-t2fxwrap \.pn-row[^}]*content-visibility: auto/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /linear-gradient/);
});

test("gaps B starters: daily mixed, image/case, weak-area, incorrect, engine custom", () => {
  const list = profiles(), store = mockStore();
  const openAll = (k, mem) => (k === "smd_prep_t2grp" ? JSON.stringify({ v: 1, exams: { "neet-pg": { open: true, groups: { daily10: true, image: true, case: true, weak_area: true, incorrect: true, custom: true } } } }) : (mem[k] ?? null));
  const T2 = loadT2(list, store, openAll);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(mockH(store));
  assert.ok(html.includes("Daily sets</span>"), "daily group holds both sets");
  assert.ok(html.includes("Start Daily mixed") && html.includes('data-k="daily_mixed"'), "daily mixed starter");
  assert.ok(html.includes("Clinical cases</span>"), "case group");
  assert.ok(html.includes("Build a clinical case test by subject") && html.includes('data-k="case"'), "case exam + subject starters");
  assert.ok(html.includes("Build an image test by subject") && html.includes('data-k="image"'), "image exam + subject starters");
  assert.ok(html.includes("No weak modules yet"), "weak starter says why when no history");
  assert.ok(html.includes("of 5 mistakes needed"), "incorrect starter says why when too few mistakes");
  assert.ok(html.includes('data-act="t2-ccpick"'), "engine custom picker reachable");
  assert.ok(html.includes('data-act="t2-custom"'), "study custom row kept");
  const Tfull = loadT2(list, store, openAll);
  Tfull._P.fx = papers();
  Tfull._P.sess = null;
  const rich = doneStore();
  rich.mod = { "anatomy-m0": { t: 10, ok: 3 } };
  rich.mt = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 };
  const html2 = Tfull.testsHtml(mockH(rich));
  assert.ok(html2.includes("1 weak module"), "weak starter enables from weakModules history");
  assert.ok(!html2.includes("No weak modules yet"), "weak why clears with history");
  assert.ok(html2.includes("Up to 20 of your 6 mistakes"), "incorrect starter enables from the mistakes list");
});
