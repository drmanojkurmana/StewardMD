/* NEET-SS two-page flow (owner 2026-10-14) through the real prep-plan.js browser code with a stub host.
 * What must hold:
 *  - the exam step names what is next for NEET-SS instead of a long inline group scroll;
 *  - Step 1 (Who are you?) offers the fifteen feeder groups as radios with degree and includes lines, preselects
 *    nothing, and Continue waits for a pick;
 *  - Step 2 (Pick your super-specialty) shows only the picked group's subjects with module and MCQ counts, the
 *    mixed All-row first, a visible Change group control, and never a zero-question subject;
 *  - Change group, Back and the hardware back step return to Step 1 with the pick kept;
 *  - Continue from Step 2 reaches the date step; skipping the rest still remembers exam and group;
 *  - the settings sheet (the Change control on later screens) offers the same fifteen groups and saves one;
 *  - no coming-soon wording and no en/em dash in any painted page.
 * node --test test/prep-ss-flow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "prep-plan.js"), "utf8");
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");

const IX = {
  "ss-urology": [{ id: "uro-m0", title: { en: "Uro 1" }, group: "uro-s", count: 8 }, { id: "uro-m1", title: { en: "Uro 2" }, group: "uro-s", count: 8 }],
  "ss-neurosurgery": [{ id: "nsu-m0", title: { en: "Nsu 1" }, group: "nsu-s", count: 8 }],
  "ss-biostatistics": [{ id: "bio-m0", title: { en: "Bio 1" }, group: "bio-s", count: 8 }],
};
const LOADED = {};
Object.keys(IX).forEach((k) => { LOADED[k] = IX[k]; });
function fakeEl() {
  return {
    className: "", id: "", innerHTML: "",
    appendChild() {}, removeChild() {},
    setAttribute() {}, focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}
function setup() {
  const painted = [];
  const planStore = {};
  const stack = [() => {}];
  let homeCalled = 0, rerendered = 0;
  const G = { document: { createElement: () => fakeEl(), activeElement: null } };
  // prep-loader.js loads prep-ss-groups.js before prep-plan.js in the app; mirror that here.
  G.PREP_SS_GROUPS = require("../prep-ss-groups.js");
  const H = {
    paint: (html) => { painted.push(html); },
    bar: (t, sub, kind, extra) => "<bar>" + t + "|" + sub + "|" + kind + "|" + (extra || "") + "</bar>",
    esc: (s) => String(s == null ? "" : s),
    store: () => planStore, save: () => {},
    today: () => 20000,
    subjectsOf: () => [],
    subjectById: (id) => ({ id, name: { en: id } }),
    tx: (n) => (n && n.en) || n,
    fmt: (n) => String(n),
    ico: (n) => "<i>" + n + "</i>",
    subjHue: () => 1, subjIco: () => "<i>x</i>",
    ix: () => { const o = {}; Object.keys(LOADED).forEach((k) => { o[k] = { id: k, topics: LOADED[k] }; }); return o; },
    loadIndex: (sid) => { if (!LOADED[sid]) LOADED[sid] = []; return Promise.resolve({ id: sid, topics: LOADED[sid] }); },
    pure: { countFor: (t) => t.count || 0 },
    nav: () => {},
    stack: () => stack, stackTop: () => stack[stack.length - 1],
    home: () => { homeCalled++; },
    rerender: () => { rerendered++; },
    exam: () => ({ id: "neet-pg", label: "NEET-PG" }),
    root: () => null,
  };
  new Function("window", "module", SRC)(G, undefined);
  const PLAN = G.PREP_PLAN;
  PLAN._p.ob = null; PLAN._p.sheet = null;
  const btn = (act, v) => ({ getAttribute: (k) => (k === "data-act" ? act : k === "data-v" ? v : null) });
  const last = () => painted[painted.length - 1];
  const radios = (html) => (html.match(/role="radio"/g) || []).length;
  const checked = (html) => (html.match(/aria-checked="true"/g) || []).length;
  return { PLAN, H, painted, planStore, btn, last, radios, checked,
    get homeCalled() { return homeCalled; }, get rerendered() { return rerendered; } };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test("exam step points NEET-SS at the two pages, with no inline group list", () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  assert.match(t.last(), /Which exam/, "exam step first");
  assert.equal((t.last().match(/data-act="p-f-exam"/g) || []).length, 13, "thirteen exams");
  assert.match(t.last(), /disabled/, "Continue waits for an exam");
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  assert.match(t.last(), /who you are/, "what is next is named");
  assert.equal((t.last().match(/data-act="p-f-group"/g) || []).length, 0, "no long group scroll inline");
});

test("Step 1 asks explicitly: fifteen radios, nothing preselected", () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  assert.match(t.last(), /Who are you\?/, "Step 1 on its own page");
  assert.equal(t.radios(t.last()), 15, "fifteen feeder groups");
  assert.equal(t.checked(t.last()), 0, "nothing preselected");
  assert.match(t.last(), /Radiodiagnosis/, "radiodiagnosis asked");
  assert.match(t.last(), /own paper/, "own-paper groups asked");
  assert.match(t.last(), /Urology, Neurosurgery/, "includes lines name the super-specialties");
  assert.match(t.last(), /disabled/, "Continue waits for a pick");
});

test("Step 2 shows only the picked group's subjects, counts filled, All-row first", async () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  t.PLAN.act("p-f-group", t.btn("p-f-group", "surgical"), t.H);
  assert.equal(t.checked(t.last()), 1, "the pick shows");
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  assert.match(t.last(), /Pick your super-specialty/, "Step 2 on its own page");
  await tick();
  const html = t.last();
  assert.match(html, /Surgical group: only these subjects/, "scope named");
  assert.ok(html.indexOf("All Surgical subjects") < html.indexOf("ss-urology"), "mixed All-row first");
  assert.match(html, /Mixed/, "mixed row marked");
  assert.match(html, /2 modules · 16 MCQs/, "module and MCQ counts");
  assert.ok(!/ss-cardiology/.test(html) && !/Cardiology/.test(html), "no medical subjects for surgery");
  assert.match(html, /Change group/, "visible Change group control");
});

test("Change group, Back and hardware back return to Step 1 with the pick kept", async () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  t.PLAN.act("p-f-group", t.btn("p-f-group", "surgical"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  await tick();
  t.PLAN.act("p-f-who", t.btn("p-f-who"), t.H);
  assert.match(t.last(), /Who are you\?/, "Change group returns to Step 1");
  assert.equal(t.checked(t.last()), 1, "pick kept");
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  await tick();
  assert.match(t.last(), /Pick your super-specialty/, "forward again");
  assert.equal(t.PLAN.back(), true, "hardware back handled");
  assert.match(t.last(), /Who are you\?/, "hardware back returns to Step 1");
  t.PLAN.act("p-ob-back", t.btn("p-ob-back"), t.H);
  assert.match(t.last(), /Which exam/, "Back returns to the exam step");
});

test("Continue from Step 2 reaches the date step; skipping still remembers exam and group", async () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  t.PLAN.act("p-f-group", t.btn("p-f-group", "surgical"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  await tick();
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  assert.match(t.last(), /When is your exam\?/, "date step next");
  t.PLAN.act("p-skip", t.btn("p-skip"), t.H);
  assert.equal(t.planStore.pl.exam, "neet-ss", "exam kept");
  assert.equal(t.planStore.pl.group, "surgical", "group kept");
  assert.equal(t.homeCalled, 1, "lands home");
});

test("settings sheet offers the same fifteen groups and saves the switch", () => {
  const t = setup();
  t.planStore.pl = { ob: 1, exam: "neet-ss", group: "surgical", date: null, min: 30, rem: null };
  let sheetHtml = "";
  t.H.root = () => ({ appendChild: (el) => { sheetHtml = el.innerHTML; }, querySelector: () => null });
  t.PLAN.act("p-settings", t.btn("p-settings"), t.H);
  assert.equal((sheetHtml.match(/data-act="p-f-group"/g) || []).length, 15, "settings offers the same fifteen groups");
  assert.match(sheetHtml, /Urology, Neurosurgery/, "includes lines in settings too");
  t.PLAN.act("p-f-group", t.btn("p-f-group", "medical"), t.H);
  t.PLAN.act("p-save", t.btn("p-save"), t.H);
  assert.equal(t.planStore.pl.group, "medical", "switch saved");
  assert.equal(t.rerendered, 1, "home rerenders");
});

test("no coming-soon wording and no en/em dash on the new pages", async () => {
  const t = setup();
  t.PLAN.onboard(t.H);
  t.PLAN.act("p-f-exam", t.btn("p-f-exam", "neet-ss"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  t.PLAN.act("p-f-group", t.btn("p-f-group", "surgical"), t.H);
  t.PLAN.act("p-ob-next", t.btn("p-ob-next"), t.H);
  await tick();
  for (const html of t.painted) {
    assert.ok(!/coming soon/i.test(html), "never promises what is coming");
    assert.ok(!DASH.test(html.replace(/<bar>.*<\/bar>/, "")), "no en or em dash on screen");
    assert.ok(!/aria-checked="(?!true|false)/.test(html), "radios carry real checked states");
  }
});
