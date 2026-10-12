/* Plan scope (owner 2026-10-12): Tests and QBank follow the selected plan's exam.
 * What must hold:
 *  - plan choices resolve to exam profiles (USMLE Step 1 / Step 2 CK as selected; legacy "usmle" reads Step 1);
 *  - NEET-SS groups narrow subjects (medical default; groups without bank subjects get the short coming state);
 *  - INI-SS narrows to the one picked subject, and asks for it when none is picked;
 *  - the Tests segment shows ONLY the plan exam (no sibling exam, no "More exam formats"); ready-made papers filter
 *    by plan/group/subject and counts reflect the filtered set; empty groups stay hidden;
 *  - a coming bank shows one short clean state (format notes behind an info row, no inline walls of grey text).
 * node --test test/prep-plan-scope.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLAN = require("../prep-plan.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "prep-tests.js"), "utf8");

const SS = [
  { id: "ss-cardiology", name: { en: "Cardiology" } },
  { id: "ss-neurology", name: { en: "Neurology" } },
  { id: "ss-pulmonology", name: { en: "Pulmonology" } },
];
function profiles() {
  const base = (id, name, tab, extra) => Object.assign({
    id, name, tab, status: "official", version: "2026.1.0", verified_on: "2026-10-10", bank: null,
    format: { questions: 80, duration_min: 90, sections: [{ id: "1", label: "Stage I", questions: 80, minutes: 90 }] },
    scoring: { correct: 1, incorrect: -0.3333333333333333, unanswered: 0, pass: null },
    pace_sec: 68, blueprint: { kind: "none" }, sources: { S: { title: "Bulletin" } },
  }, extra || {});
  return [
    base("neet-ss", "NEET-SS", "neet-ss"),
    base("ini-ss", "INI-SS", "neet-ss"),
    base("usmle-step1", "USMLE Step 1", "usmle", { status: "provisional" }),
    base("usmle-step2-ck", "USMLE Step 2 CK", "usmle", { status: "provisional", bank: { status: "coming", note: "no Step 2 CK clinical items in the bank yet" } }),
    base("plab-1", "PLAB 1", "plab", { bank: { status: "coming", note: "no PLAB 1 questions in the bank yet" } }),
  ];
}
function mockA(list) {
  const byId = {};
  list.forEach((p) => { byId[p.id] = p; });
  return {
    forTab: (tab) => list.filter((p) => p.tab === tab),
    profile: (id) => byId[id] || null,
    profileIds: () => list.map((p) => p.id),
    bankStatus: (p) => (p && p.bank && p.bank.status) || "available",
    blueprint: (p, type) => {
      if (!p) return null;
      if (type === "part" || type === "pyq") return null;
      if (type === "daily10") return { count: 10, duration_sec: 600, min_viable: 10, pace: 60 };
      if (type === "grand") return { count: 80, duration_sec: 5400, min_viable: 40 };
      if (type === "mini") return { count: 20, duration_sec: 1200, min_viable: 5 };
      return { count: 20, duration_sec: 1200, min_viable: 5 };
    },
    dailyKey: (exam) => "daily10:" + exam + ":2026-10-11",
    paceSec: () => 68,
  };
}
function planSubsFor(pl) {
  if (!pl || !pl.exam) return SS.slice();
  if (pl.exam === "neet-ss") {
    const want = {};
    PLAN.ssGroupSubjects(PLAN.planGroup(pl)).forEach((id) => { want[id] = 1; });
    return SS.filter((s) => want[s.id]);
  }
  if (pl.exam === "ini-ss") return SS.filter((s) => s.id === pl.subject);
  return SS.slice();
}
function mockH(store, tab, pl) {
  const subs = () => planSubsFor(pl);
  return {
    store: () => store, exam: () => ({ id: tab, label: tab }),
    row: (act, icon, title, sub, attrs) => '<button type="button" class="pn-row" data-act="' + act + '"' + (attrs || "") + "><b>" + title + "</b><small>" + sub + "</small></button>",
    ico: (n) => '<svg data-ico="' + n + '"></svg>',
    fmt: (n) => String(n), planToday: () => ({ due: 0, left: 0, weak: [] }),
    root: () => null,
    subjectsOf: () => SS.slice(),
    subjectById: (id) => SS.filter((s) => s.id === id)[0] || null,
    tx: (n) => (n && n.en) || n,
    planSubjects: subs,
    planNeed: () => (pl && pl.exam === "ini-ss" && !subs().length ? { kind: "subject" } : null),
    planExamLabel: () => (pl && pl.exam && PLAN.choiceOf(pl.exam) ? PLAN.choiceOf(pl.exam).label : tab),
    planScopeLabel: () => {
      if (!pl || !pl.exam) return "";
      if (pl.exam === "neet-ss") { const g = PLAN.ssGroupOf(PLAN.planGroup(pl)); return g ? g.label : ""; }
      if (pl.exam === "ini-ss" && pl.subject) { const sb = SS.filter((s) => s.id === pl.subject)[0]; return sb ? sb.name.en : ""; }
      return "";
    },
  };
}
function loadT2(list, store, tab, pl) {
  const mem = {};
  const G = {
    location: { search: "" },
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
    },
    PREP_ASSESS: mockA(list), PREP_PYQ: null, PREP_PLAN: { _pure: PLAN }, matchMedia: () => ({ matches: false }),
  };
  new Function("window", "module", SRC)(G, undefined);
  const T2 = G.PREP_TESTS;
  T2._G = G;
  return { T2, H: mockH(store, tab, pl) };
}
function paper(id, exam, format, scope) {
  return { id, exam, format, title: id, count: 20, duration_sec: 1200, scope, path: "x" };
}
function papers() {
  return [
    paper("neet-ss-sub-ss-cardiology-1", "neet-ss", "subject_mini", "Cardiology"),
    paper("neet-ss-sub-ss-neurology-1", "neet-ss", "subject_mini", "Neurology"),
    paper("neet-ss-sub-ss-pulmonology-1", "neet-ss", "subject_mini", "Pulmonology"),
    paper("neet-ss-topic-ss-cardiology-sca-x", "neet-ss", "topic", "Some cardiology topic"),
    paper("neet-ss-grand-01", "neet-ss", "grand", "All NEET-SS subjects"),
    paper("neet-ss-image-06", "neet-ss", "image", "Image questions · Cardiology"),
    paper("neet-ss-image-01", "neet-ss", "image", "Image questions · all NEET-SS subjects"),
  ];
}
function storeFor(pl) {
  return { t2h: [], t2d: {}, pl: pl || null, mt: {}, cards: {}, mod: {} };
}

test("plan choices resolve to exam profiles; legacy usmle reads Step 1", () => {
  assert.equal(PLAN.EXAM_CHOICES.length, 13);
  assert.ok(PLAN.EXAM_CHOICES.every((e) => e.tab && e.profile && e.label && e.sub));
  assert.equal(PLAN.planProfileId("usmle"), "usmle-step1");
  assert.equal(PLAN.planProfileId("usmle-step2-ck"), "usmle-step2-ck");
  assert.equal(PLAN.planProfileId("ini-ss"), "ini-ss");
  assert.equal(PLAN.planProfileId("plab-1"), "plab-1");
  assert.equal(PLAN.planProfileId("mrcs-part-a"), "mrcs-part-a");
  assert.equal(PLAN.planProfileId("amc-mcq"), "amc-mcq");
  assert.equal(PLAN.planProfileId("mccqe-1"), "mccqe-1");
  assert.equal(PLAN.planProfileId("mrcp-part1"), "mrcp-part1");
  assert.equal(PLAN.planProfileId("mrcp-part2-written"), "mrcp-part2-written");
  assert.equal(PLAN.choiceOf("ini-cet").tab, "neet-pg");
  assert.equal(PLAN.choiceOf("ini-ss").tab, "neet-ss");
  assert.equal(PLAN.choiceOf("mrcp-part1").tab, "mrcp");
  assert.equal(PLAN.choiceOf("mrcp-part2-written").tab, "mrcp");
  assert.equal(PLAN.choiceOf("amc-mcq").tab, "amc");
  assert.equal(PLAN.choiceOf("mccqe-1").tab, "mccqe");
});

test("NEET-SS groups: 15 groups, medical default, surgical has no bank subjects", () => {
  assert.equal(PLAN.SS_GROUPS.length, 15);
  assert.ok(PLAN.SS_GROUPS.every((g) => g.id && g.label && g.feeder && Array.isArray(g.subjects)));
  assert.equal(PLAN.defaultSsGroup(), "medical");
  assert.equal(PLAN.planGroup({ exam: "neet-ss" }), "medical");
  assert.equal(PLAN.planGroup({ exam: "neet-ss", group: "surgical" }), "surgical");
  assert.equal(PLAN.planGroup({ exam: "neet-ss", group: "nope" }), "medical");
  assert.equal(PLAN.planGroup({ exam: "ini-ss" }), null);
  const med = PLAN.ssGroupSubjects("medical");
  ["ss-cardiology", "ss-neurology", "ss-nephrology", "ss-gastroenterology", "ss-hepatology",
    "ss-endocrinology", "ss-haematology", "ss-medical-oncology", "ss-pulmonology",
    "ss-infectious-diseases", "ss-rheumatology-immunology"].forEach((id) => assert.ok(med.includes(id), "medical holds " + id));
  assert.deepEqual(PLAN.ssGroupSubjects("surgical"), []);
  assert.deepEqual(PLAN.normalizePlan({ exam: "neet-pg", group: "medical", subject: "ss-cardiology" }), { exam: "neet-pg" });
});

test("paperSubject reads the bank subject from ready-made paper ids", () => {
  const { T2 } = loadT2(profiles(), storeFor(), "neet-ss", null);
  const g = T2._grp;
  const sids = SS.map((s) => s.id);
  assert.equal(g.paperSubject(paper("neet-ss-sub-ss-cardiology-1", "neet-ss", "subject_mini", "Cardiology"), sids), "ss-cardiology");
  assert.equal(g.paperSubject(paper("neet-ss-topic-ss-cardiology-sca-x", "neet-ss", "topic", "t"), sids), "ss-cardiology");
  assert.equal(g.paperSubject(paper("neet-ss-grand-01", "neet-ss", "grand", "All"), sids), null);
  assert.equal(g.paperSubject(paper("neet-ss-image-06", "neet-ss", "image", "Image questions · Cardiology"), sids), null);
  assert.equal(g.paperSubject(paper("neet-ss-sub-ss-unknown-1", "neet-ss", "subject_mini", "X"), sids), false);
  assert.equal(g.paperSubject({ exam: "neet-ss", format: "grand" }, sids), null);
});

test("fxFor filters papers by the plan scope; counts follow", () => {
  const { T2 } = loadT2(profiles(), storeFor(), "neet-ss", null);
  const g = T2._grp;
  const px = papers();
  assert.equal(g.fxFor(px, "neet-ss", "subject_mini").length, 3, "unfiltered: all three subject papers");
  const plan = { subs: ["ss-pulmonology"], names: { "ss-pulmonology": "pulmonology" }, all: SS.map((s) => s.id) };
  assert.deepEqual(g.fxFor(px, "neet-ss", "subject_mini", plan).map((r) => r.id), ["neet-ss-sub-ss-pulmonology-1"]);
  assert.deepEqual(g.fxFor(px, "neet-ss", "topic", plan).map((r) => r.id), [], "cardiology topic paper hidden");
  assert.deepEqual(g.fxFor(px, "neet-ss", "grand", plan).map((r) => r.id), [], "exam-wide papers need the whole exam");
  assert.deepEqual(g.fxFor(px, "neet-ss", "image", plan).map((r) => r.id), [], "general and cardiology image papers hidden");
  const cardio = { subs: ["ss-cardiology"], names: { "ss-cardiology": "cardiology" }, all: SS.map((s) => s.id) };
  assert.deepEqual(g.fxFor(px, "neet-ss", "image", cardio).map((r) => r.id), ["neet-ss-image-06"], "subject image paper kept by scope name");
});

test("NEET-SS respiratory plan: only its papers, counts filtered, no leakage", () => {
  const list = profiles(), pl = { exam: "neet-ss", group: "respiratory" };
  const { T2, H } = loadT2(list, storeFor(pl), "neet-ss", pl);
  T2._P.fx = papers();
  T2._P.sess = null;
  T2._P.plan = null;
  const html = T2.testsHtml(H);
  assert.ok(html.includes('data-p="neet-ss"'), "plan exam shown");
  assert.ok(!html.includes('data-p="ini-ss"'), "sibling INI-SS card gone");
  assert.ok(!html.includes("More exam formats"), "no more-formats section");
  assert.ok(html.includes("NEET-SS · Respiratory Medicine group"), "context names the group");
  assert.ok(html.includes("neet-ss-sub-ss-pulmonology-1") || html.includes("1, 0 done"), "only the group subject paper counts");
  assert.ok(!html.includes("neet-ss-sub-ss-cardiology-1"), "other groups subject papers hidden");
  assert.ok(!html.includes("neet-ss-grand-01"), "exam-wide grand hidden from the filtered group");
});

test("INI-SS plan with a subject: only INI-SS, only its scope", () => {
  const list = profiles(), pl = { exam: "ini-ss", subject: "ss-cardiology" };
  const { T2, H } = loadT2(list, storeFor(pl), "neet-ss", pl);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(H);
  assert.ok(html.includes('data-p="ini-ss"'), "INI-SS section shown");
  assert.ok(!html.includes('data-p="neet-ss"'), "NEET-SS card gone on the INI-SS plan");
  assert.ok(html.includes("INI-SS · Cardiology"), "context names the one subject");
  assert.ok(html.includes("Subject tests</span>"), "subject builder group kept");
});

test("INI-SS plan without a subject: one prompt, no exam section", () => {
  const list = profiles(), pl = { exam: "ini-ss" };
  const { T2, H } = loadT2(list, storeFor(pl), "neet-ss", pl);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(H);
  assert.ok(html.includes("Pick your INI-SS subject"), "the one blocking step");
  assert.ok(!html.includes('data-p="ini-ss"'), "no exam section before the subject is picked");
  assert.ok(html.includes('data-act="p-settings"'), "settings is the way through");
});

test("surgical NEET-SS plan: one short empty state for the group", () => {
  const list = profiles(), pl = { exam: "neet-ss", group: "surgical" };
  const { T2, H } = loadT2(list, storeFor(pl), "neet-ss", pl);
  T2._P.fx = papers();
  T2._P.sess = null;
  const html = T2.testsHtml(H);
  assert.ok(html.includes("No questions for the Surgical group in the bank yet."), "rare state, clearly worded");
  assert.ok(!html.includes('data-p="neet-ss"'), "no empty exam section");
});

test("empty bank (Step 2 CK, PLAB): one short state, format behind an info row", () => {
  const list = profiles();
  const ck = { exam: "usmle-step2-ck" };
  const t1 = loadT2(list, storeFor(ck), "usmle", ck);
  t1.T2._P.fx = papers();
  t1.T2._P.sess = null;
  const html = t1.T2.testsHtml(t1.H);
  assert.ok(html.includes('data-p="usmle-step2-ck"'), "the selected step shown");
  assert.ok(!html.includes('data-p="usmle-step1"'), "the other step gone");
  assert.ok(html.includes("No questions for this exam in the bank yet."), "one short line");
  assert.ok(!html.includes("Format available, question bank coming."), "no bold wall of grey text");
  assert.ok(html.includes("<summary>Exam format</summary>"), "format notes behind an info row");
  assert.ok(html.includes("no Step 2 CK clinical items in the bank yet"), "bank note kept in the info row");
  assert.ok(!html.includes("More exam formats"), "no more-formats section");
  const plab = { exam: "plab-1" };
  const t2 = loadT2(list, storeFor(plab), "plab", plab);
  t2.T2._P.fx = papers();
  t2.T2._P.sess = null;
  const html2 = t2.T2.testsHtml(t2.H);
  assert.ok(html2.includes('data-p="plab-1"') && html2.includes("No questions for this exam in the bank yet."), "PLAB plan reads the empty state");
});

test("legacy usmle plan reads Step 1; no plan reads the tab default", () => {
  const list = profiles();
  const t1 = loadT2(list, storeFor({ exam: "usmle" }), "usmle", { exam: "usmle" });
  t1.T2._P.fx = papers();
  t1.T2._P.sess = null;
  const html = t1.T2.testsHtml(t1.H);
  assert.ok(html.includes('data-p="usmle-step1"') && !html.includes('data-p="usmle-step2-ck"'), "legacy usmle means Step 1");
  const t2 = loadT2(list, storeFor(), "neet-ss", null);
  t2.T2._P.fx = papers();
  t2.T2._P.sess = null;
  const html2 = t2.T2.testsHtml(t2.H);
  assert.ok(html2.includes('data-p="neet-ss"') && !html2.includes('data-p="ini-ss"'), "no plan: the tab default only");
});

test("INI-SS subjectless plan: planSubjects is empty and planNeed asks for subject", () => {
  const plWithout = { exam: "ini-ss" };
  const subsWithout = planSubsFor(plWithout);
  assert.deepEqual(subsWithout, [], "without subject, planSubjects is empty");
  const hWithout = mockH(storeFor(plWithout), "neet-ss", plWithout);
  assert.deepEqual(hWithout.planNeed(), { kind: "subject" }, "asks for subject");

  const plWith = { exam: "ini-ss", subject: "ss-cardiology" };
  const subsWith = planSubsFor(plWith);
  assert.equal(subsWith.length, 1, "with subject, exactly one subject");
  assert.equal(subsWith[0].id, "ss-cardiology");
  const hWith = mockH(storeFor(plWith), "neet-ss", plWith);
  assert.equal(hWith.planNeed(), null, "no need once subject is picked");
});

