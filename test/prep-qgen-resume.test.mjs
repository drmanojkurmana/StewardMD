/* PrepNucleus MaiK modules survive a screen lock (owner 2026-10-11): the real prep-qgen.js browser loop runs in a
 * stub phone (document, window, fetch, timers, decks store). What must hold:
 *  - a failed round is tried once more after a short delay with the SAME idem key, then finishes honestly;
 *  - "offline" only when navigator.onLine says so at that moment (a lock suspending the request is not offline);
 *  - a cut-off module goes on by itself on visibilitychange, pageshow, resume or online, with no manual retry;
 *  - a resumed or replayed round never saves a question twice.
 *
 * node --test test/prep-qgen-resume.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const DK = req("../prep-decks.js");
const SRC = fs.readFileSync(path.join(ROOT, "prep-qgen.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const item = (i) => ({ id: "q_r" + i, q: "Stem " + i + "?", o: ["a" + i, "b" + i, "c" + i, "d" + i], a: i % 4, exp: "Why " + i, qg: { g: 0, v: "ok", u: 1 } });
const okBody = (ids) => ({ items: ids.map(item), dropped: [], usage: { mt: 100 }, left: { modules: 2, questions: 20 } });

/* A stub phone. script: one entry per fetch call: { fail } or { status, body }. */
function load(script) {
  const gens = [], sent = [];
  const items = [], decks = {};
  const docL = {}, winL = {};
  const document = {
    visibilityState: "visible",
    addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
  };
  const navigator = { onLine: true };
  let seq = 1;
  const timers = new Map();
  const G = {
    document, navigator,
    location: { search: "" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: (fn, ms) => { const id = seq++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); },
    SMD_AUTH: { currentUser: { getIdToken: async () => "tok" } },
    SMD_API_BASE: "",
    PREP_DECKS: {
      sha12: DK.sha12, newManifest: DK.newManifest, topicsFor: DK.topicsFor, questionCount: DK.questionCount,
      putItems: async (recs) => { recs.forEach((r) => items.push(JSON.parse(JSON.stringify(r)))); },
      putDeck: async (m) => { decks[m.id] = JSON.parse(JSON.stringify(m)); },
      putSrc: async () => {},
      changed: () => {},
    },
    PREP_SRC: {},
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (body.op === "gen") gens.push(body);
      const s = script.length ? script.shift() : { status: 200, body: okBody([]) };
      if (s.fail) throw s.fail;
      return { status: s.status, json: async () => JSON.parse(JSON.stringify(s.body)) };
    },
  };
  const paints = [];
  let lastPush = null;
  const rootEl = { querySelector: (sel) => (sel === "#qgProgView" ? {} : null) };
  const host = {
    push: (fn) => { lastPush = fn; fn(); },
    back: () => {},
    rerender: () => { if (lastPush) lastPush(); },
    root: () => rootEl,
    paint: (html) => { paints.push(html); },
    bar: (t, s) => "<div>" + t + "|" + s + "</div>",
    esc: (s) => String(s),
    exam: () => ({ id: "neet-pg" }),
    toast: () => {},
    ico: () => "",
  };
  G.PREP = { _host: host };
  const sandbox = {
    window: G,
    Promise, JSON, Date, Math, Uint8Array, Object, Array, String, Number, Boolean, Error, TypeError, RegExp,
    parseInt, isNaN,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "prep-qgen.js" });
  const Q = G.PREP_QGEN;
  const fire = async (ms) => {
    for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
    await sleep(40);
  };
  const dispatch = async (where, type) => {
    for (const f of (where === "doc" ? docL[type] || [] : winL[type] || [])) f();
    await sleep(40);
  };
  const go = async (afterAct) => {
    Object.assign(Q._cs, { kind: "topic", topic: "Diabetic ketoacidosis", text: "", count: 10, diff: "mix", exam: "neet-pg", own: false, err: "", busy: "" });
    Q.act("g-go", null, host);
    if (afterAct) afterAct();
    await sleep(40);
  };
  return { Q, G, host, document, navigator, paints, gens, items, decks, timers, docL, winL, fire, dispatch, go };
}
const lastPaint = (e) => e.paints[e.paints.length - 1];

test("the loop listens for every foreground and network trigger", () => {
  const e = load([]);
  assert.ok((e.docL.visibilitychange || []).length === 1, "visibilitychange");
  assert.ok((e.docL.resume || []).length === 1, "app resume");
  assert.ok((e.winL.pageshow || []).length === 1, "pageshow");
  assert.ok((e.winL.online || []).length === 1, "online");
});

test("a failed round is retried once with the same key, then the module completes with no duplicates", async () => {
  const e = load([
    { fail: new TypeError("Failed to fetch") },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  assert.equal(e.gens.length, 1, "first attempt sent");
  assert.equal(e.Q._job().done, false, "not finished: the retry is pending");
  assert.ok([...e.timers.values()].some((t) => t.ms === 3000), "the one retry waits a short delay");
  await e.fire(3000);
  assert.equal(e.gens.length, 3, "retry plus the second round");
  assert.equal(e.gens[0].idem, e.gens[1].idem, "the retry reuses the round key, so the server replays");
  assert.equal(e.gens[0].round, e.gens[1].round, "same round number");
  assert.notEqual(e.gens[2].idem, e.gens[0].idem, "the next round gets a fresh key");
  assert.match(e.gens[0].idem, /^qg[0-9a-f]{24}$/);
  const j = e.Q._job();
  assert.equal(j.done, true); assert.equal(j.code, "");
  assert.equal(j.made, 10);
  assert.deepEqual(e.items.map((x) => x.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => "q_r" + i).sort());
  assert.match(lastPaint(e), /Module ready/);
});

test("two failures with the network up say ai-failed, never offline; coming back resumes by itself", async () => {
  const e = load([
    { fail: new TypeError("Failed to fetch") },
    { fail: new TypeError("Failed to fetch") },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  await e.fire(3000);
  assert.equal(e.gens.length, 2, "attempt plus the one retry, then it gives up");
  const j = e.Q._job();
  assert.equal(j.done, true);
  assert.equal(j.code, "ai-failed", "online at that moment: not offline");
  assert.match(lastPaint(e), /Module not made/, "nothing made yet: not made, not partly");
  assert.match(lastPaint(e), /MaiK could not write questions this time\. Try again\./);
  assert.match(lastPaint(e), /data-act="g-retry"/, "Try again stays as the fallback");
  assert.doesNotMatch(lastPaint(e), /You are offline/);
  await e.dispatch("doc", "visibilitychange");
  assert.equal(e.gens.length, 4, "no manual retry: the foreground return resumed it");
  assert.equal(e.gens[2].idem, e.gens[0].idem, "the resumed round keeps its key");
  assert.deepEqual(e.gens[2].avoid.length, 0, "nothing saved yet: nothing to avoid");
  const j2 = e.Q._job();
  assert.equal(j2.done, true); assert.equal(j2.code, ""); assert.equal(j2.made, 10);
  assert.equal(new Set(e.items.map((x) => x.id)).size, 10, "no duplicate questions after resume");
});

test("a partly made module keeps its questions across resume and never saves one twice", async () => {
  const e = load([
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { fail: new TypeError("Failed to fetch") },
    { fail: new TypeError("Failed to fetch") },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  await e.fire(3000);
  assert.equal(e.Q._job().made, 5, "the first round stayed saved");
  assert.match(lastPaint(e), /Module partly made/);
  assert.match(lastPaint(e), /5<\/p>|>5</, "the count shows 5");
  await e.dispatch("win", "pageshow");
  assert.equal(e.gens.length, 4, "pageshow resumed the rest");
  assert.equal(e.gens[3].avoid.length, 5, "the resumed round avoids the saved stems");
  assert.equal(e.Q._job().made, 10);
  assert.equal(new Set(e.items.map((x) => x.id)).size, 10);
});

test("a replayed round is saved once: questions already in the module are left out", async () => {
  const e = load([
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  await sleep(60);
  assert.equal(e.Q._job().made, 10);
  assert.equal(e.items.length, 10, "the replayed five were not saved again");
  assert.equal(new Set(e.items.map((x) => x.id)).size, 10);
});

test("truly offline says You are offline; it waits for the network, then finishes", async () => {
  const e = load([
    { fail: new TypeError("Failed to fetch") },
    { fail: new TypeError("Failed to fetch") },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go(() => { e.navigator.onLine = false; });
  await e.fire(3000);
  assert.equal(e.Q._job().code, "offline");
  assert.match(lastPaint(e), /You are offline\. Connect and try again\./);
  await e.dispatch("doc", "visibilitychange");
  assert.equal(e.gens.length, 2, "no futile resume while still offline");
  e.navigator.onLine = true;
  await e.dispatch("win", "online");
  assert.equal(e.gens.length, 4, "the network returning resumed it");
  assert.equal(e.Q._job().made, 10);
});

test("no resume while still hidden; the visible return resumes", async () => {
  const e = load([
    { fail: new TypeError("Failed to fetch") },
    { fail: new TypeError("Failed to fetch") },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  await e.fire(3000);
  assert.equal(e.Q._job().code, "ai-failed");
  e.document.visibilityState = "hidden";
  await e.dispatch("doc", "visibilitychange");
  assert.equal(e.gens.length, 2, "hidden: no resume");
  e.document.visibilityState = "visible";
  await e.dispatch("doc", "visibilitychange");
  assert.equal(e.gens.length, 4, "visible: resumed with no manual retry");
  assert.equal(e.Q._job().made, 10);
});

test("a limit stop never resumes by itself", async () => {
  const e = load([{ status: 429, body: { error: "quota", reason: "daily-modules" } }]);
  await e.go();
  assert.equal(e.Q._job().code, "daily-modules");
  await e.dispatch("doc", "visibilitychange");
  await e.dispatch("win", "online");
  await e.dispatch("win", "pageshow");
  assert.equal(e.gens.length, 1, "a limit stop never resumes by itself");
});

test("our own wait running out says took too long, and resumes on return", async () => {
  const abort = () => { const x = new Error("aborted"); x.name = "AbortError"; return x; };
  const e = load([
    { fail: abort() },
    { fail: abort() },
    { status: 200, body: okBody([1, 2, 3, 4, 5]) },
    { status: 200, body: okBody([6, 7, 8, 9, 10]) },
  ]);
  await e.go();
  await e.fire(3000);
  assert.equal(e.Q._job().code, "ai-timeout");
  assert.match(lastPaint(e), /MaiK took too long\. Try again\./);
  await e.dispatch("doc", "visibilitychange");
  assert.equal(e.Q._job().made, 10, "the foreground return resumed it");
});
