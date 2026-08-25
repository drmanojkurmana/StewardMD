/* The bugs that quietly corrupt a student's record.
 *
 * Two of these destroy data and one of them destroys the NEXT person's data, and all of them are
 * invisible: nothing throws, nothing logs, the screen looks right. They came out of a full read of
 * clinix-screens.js on 2026-08-26.
 *
 *   1. SIGN-OUT NEVER WIPES ANYTHING. Five modules (CliniX, SknX, ThoreX, KardioX, SURGX) each
 *      register a wipe() on "smd:signout" and friends. Nothing in the repo has ever dispatched one
 *      of those events. kardiox-screens.js even carries the note "🔧 hook the real signout" - the
 *      gap was known and never closed. The real path (signout-fix.js) clears the account and
 *      reloads, so the reload MASKS it: fresh JS, closed overlay, everything looks clean while
 *      smd_clinix_skills_v1 / _pos_v1 / _log_v1 sit untouched in localStorage. The next person to
 *      sign in on that device inherits the previous student's competency, misses and resume tile.
 *      Worse, four of the five only registered the listener when the module was first OPENED, so
 *      even a dispatched event would have missed any module the student had not visited.
 *
 *   2. OSCE GRADED EVERY SKILL ALL-OR-NOTHING. finishStation wrote
 *      `record(sid, ps.correct === ps.seen)` - tick 5 of 6 items for a skill and a hard `false` is
 *      filed against the whole skill. Do two stations demonstrating most of the chest examination
 *      correctly and "chest expansion" reads as struggling. Learn, Viva and Case all record one
 *      attempt per PROBE; only OSCE collapsed many items into one verdict.
 *
 *   3. A NULL VIVA VERDICT BUZZED LIKE A WRONG ANSWER. "MaiK could not judge this" is explicitly
 *      not the student's fault (vivaNext refuses to demote them for it) but it fired the same
 *      warning haptic as being wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

/* ── 1. sign-out actually reaches the modules ─────────────────────────────── */

/* A window just real enough to run signout-fix.js: capture-phase delegated click, a target with
 * .closest(), localStorage, and a location.reload() we can observe instead of perform. */
function fakeWindow() {
  const listeners = { capture: {}, bubble: {} };
  const store = new Map();
  const win = {
    reloaded: false,
    dispatched: [],
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      _store: store
    },
    addEventListener(type, fn) { (listeners.bubble[type] ||= []).push(fn); },
    dispatchEvent(ev) {
      win.dispatched.push(ev.type);
      for (const fn of listeners.bubble[ev.type] || []) fn(ev);
      return true;
    },
    setTimeout, clearTimeout, console
  };
  // A real WebView has these; the dispatch path uses Event and falls back to createEvent.
  win.Event = class { constructor(type) { this.type = type; } };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  win.location = { reload() { win.reloaded = true; }, href: "", search: "" };
  win.document = {
    addEventListener(type, fn, capture) { (capture ? listeners.capture : listeners.bubble)[type] ||= []; (capture ? listeners.capture : listeners.bubble)[type].push(fn); },
    removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {} },
    readyState: "complete"
  };
  win.__clickSignOut = function (id) {
    const target = { id, closest: (sel) => (sel.includes("#" + id) ? target : null) };
    const ev = { type: "click", target, preventDefault() {}, stopImmediatePropagation() {} };
    for (const fn of listeners.capture.click || []) fn(ev);
  };
  return win;
}

test("signing out DISPATCHES the wipe event the modules are all listening for", async () => {
  const win = fakeWindow();
  const ctx = vm.createContext(win);
  vm.runInContext(read("signout-fix.js"), ctx, { filename: "signout-fix.js" });

  let wiped = 0;
  win.addEventListener("smd:signout", () => { wiped++; });

  win.__clickSignOut("sessionSignOut");
  // fullSignOut() resolves a promise before reloading; let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(win.dispatched.includes("smd:signout"),
    "sign-out must dispatch smd:signout - five modules wipe patient/progress data on it");
  assert.equal(wiped, 1, "the wipe listener must have actually run");
});

test("the wipe event fires BEFORE the reload, or it never runs at all", async () => {
  /* signout-fix.js reloads the page as its last act. A wipe dispatched after that is a wipe that
   * never happens, so the ordering IS the fix. */
  const win = fakeWindow();
  const ctx = vm.createContext(win);
  vm.runInContext(read("signout-fix.js"), ctx, { filename: "signout-fix.js" });

  let reloadedWhenWiped = null;
  win.addEventListener("smd:signout", () => { reloadedWhenWiped = win.reloaded; });

  win.__clickSignOut("sessionSignOut");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(reloadedWhenWiped, false, "the wipe must run while the page is still alive");
  assert.ok(win.reloaded, "and the reload must still happen afterwards");
});

test("every module registers its sign-out wipe at LOAD, not on first open", () => {
  /* The listener has to exist before the student signs out. Registering it inside mount()/init()
   * means a module the student never opened this session keeps the previous account's data. */
  const cases = [
    ["clinix-screens.js", "SMD_CLINIX_WIPE"],
    ["sknx-screens.js", null],
    ["thorex-screens.js", "SMD_THOREX_WIPE"],
    ["kardiox-screens.js", "SMD_KARDIOX_WIPE"],
    ["surgx-store.js", "SMD_SURGX_WIPE"]
  ];
  for (const [file, _g] of cases) {
    const src = read(file);
    // A wireSignout() call that is NOT inside a function body - i.e. at IIFE top level.
    const atLoad = /\n\s{0,2}wireSignout\(\);/.test(src);
    assert.ok(atLoad, `${file} only wires its sign-out listener lazily; it must wire at load`);
  }
});

test("every module's sign-out wipe actually deletes something", async () => {
  /* A dispatched event only helps if the handler on the other end does work. Four of the five
   * modules called a real deleteAll(); SknX's wipe() was an empty block with the comment "no
   * bulk-delete API yet", so it kept up to 100 dermatology analyses across an account switch. */
  const sknx = (await import("../sknx-store.js")).default;
  const mem = new Map();
  const impl = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  sknx.save({ at: 1, differential: [{ label: "psoriasis" }] }, impl);
  assert.equal(sknx.list(impl).length, 1, "the analysis was stored");
  sknx.deleteAll(impl);
  assert.deepEqual(sknx.list(impl), [], "sign-out must leave no dermatology history behind");
});

test("no module's wipe() is a comment where a delete should be", () => {
  for (const [file, fn] of [
    ["sknx-screens.js", /function wipe\(\)[^\n]*/],
    ["thorex-screens.js", /function wipe\(\)[^\n]*/],
    ["kardiox-screens.js", /function wipe\(\)[^\n]*/],
    ["clinix-screens.js", /function wipe\(\)[^\n]*/]
  ]) {
    const m = fn.exec(read(file));
    assert.ok(m, `${file} has no wipe()`);
    assert.match(m[0], /delete|remove|wipe|stopAudio/i, `${file}: wipe() does not delete anything`);
    assert.ok(!/no bulk-delete API yet/.test(m[0]), `${file}: wipe() is still a placeholder`);
  }
});

test("sign-out asks first when it would destroy the only copy of SURGX notes", async () => {
  /* Making the wipe real also made sign-out an irreversible way to lose clinical notes that exist
   * nowhere else. It must ask - but only when there is something to lose. */
  const win = fakeWindow();
  let asked = 0;
  win.confirm = () => { asked++; return false; };
  win.SMD_SURGX_STORE = { listNotes: () => [{ id: "n1" }, { id: "n2" }] };
  vm.runInContext(read("signout-fix.js"), vm.createContext(win), { filename: "signout-fix.js" });

  win.__clickSignOut("sessionSignOut");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(asked, 1, "it must warn before deleting unrecoverable notes");
  assert.ok(!win.reloaded, "declining must abort the sign-out entirely");
  assert.ok(!win.dispatched.includes("smd:signout"), "and must not wipe anything");
});

test("sign-out with no notes to lose does NOT nag", async () => {
  const win = fakeWindow();
  let asked = 0;
  win.confirm = () => { asked++; return true; };
  win.SMD_SURGX_STORE = { listNotes: () => [] };
  vm.runInContext(read("signout-fix.js"), vm.createContext(win), { filename: "signout-fix.js" });

  win.__clickSignOut("sessionSignOut");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(asked, 0, "an empty note store means nothing irreplaceable is lost");
  assert.ok(win.reloaded, "and sign-out proceeds in one tap");
});

/* ── 2. OSCE scoring is proportionate ─────────────────────────────────────── */

/* clinix-screens.js loads under plain node (it guards every window/document touch), so the real
 * finishStation can be driven against a recording spy instead of being re-implemented here. */
async function screensWithSpy() {
  // The module only binds its window globals when a window exists, and P() reads
  // window.SMD_CLINIX_PROGRESS - so the window has to be there BEFORE the import.
  if (!globalThis.window) {
    globalThis.window = globalThis;
    globalThis.addEventListener = () => {};
    // show() bails out when its host element is absent, so a document that finds nothing turns
    // the trailing repaint() into a no-op without stubbing the whole renderer.
    globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
  }
  // finishStation scores through the REAL model, so the scoring rule under test is the shipped one.
  if (!globalThis.window.SMD_CLINIX_MODEL) {
    const M = await import("../clinix-model.js");
    globalThis.window.SMD_CLINIX_MODEL = M.default || M;
  }
  const mod = await import("../clinix-screens.js");
  const S = mod.default || mod;
  const calls = [];
  globalThis.window.SMD_CLINIX_PROGRESS = {
    record: (skillId, correct, meta) => { calls.push({ skillId, correct, meta }); },
    deleteAll: () => {}
  };
  return { S, calls };
}

test("OSCE records one attempt per CHECKLIST ITEM, not one verdict per skill", async () => {
  const { S, calls } = await screensWithSpy();
  const st = S._state();

  // One skill, six items; the student got five of them.
  st.station = {
    title: "Chest examination", seconds: 300, maxScore: 6, passMark: 50,
    items: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: "i" + n, label: "step " + n, weight: 1, critical: false, skillId: "skill.ex.resp.expansion"
    }))
  };
  st.stationChecked = { i1: true, i2: true, i3: true, i4: true, i5: true };
  S._finishStation();

  const mine = calls.filter((c) => c.skillId === "skill.ex.resp.expansion");
  assert.equal(mine.length, 6, "six checklist items must produce six recorded attempts");
  assert.equal(mine.filter((c) => c.correct === true).length, 5, "five items were performed");
  assert.equal(mine.filter((c) => c.correct === false).length, 1, "one item was missed");
  assert.ok(!mine.some((c) => c.correct === true && c.correct === false));
});

test("REGRESSION: 5-of-6 must never be filed as a flat wrong answer", async () => {
  const { S, calls } = await screensWithSpy();
  const st = S._state();
  st.station = {
    title: "t", seconds: 60, maxScore: 6, passMark: 50,
    items: [1, 2, 3, 4, 5, 6].map((n) => ({ id: "i" + n, label: "s" + n, weight: 1, skillId: "skill.x" }))
  };
  st.stationChecked = { i1: true, i2: true, i3: true, i4: true, i5: true };
  S._finishStation();

  const wrong = calls.filter((c) => c.skillId === "skill.x" && c.correct === false).length;
  assert.equal(wrong, 1,
    "the old code wrote a single hard false for the whole skill, so mostly-correct read as struggling");
});

test("a missed item is logged with WHICH step was missed", async () => {
  /* The miss log drives "Weak areas". "You missed something in chest examination" is useless;
   * "you did not test chest expansion" is the whole point of keeping the log. */
  const { S, calls } = await screensWithSpy();
  const st = S._state();
  st.station = {
    title: "t", seconds: 60, maxScore: 2, passMark: 50,
    items: [
      { id: "a", label: "Wash your hands", weight: 1, skillId: "skill.gen.hygiene" },
      { id: "b", label: "Take consent", weight: 1, skillId: "skill.gen.consent" }
    ]
  };
  st.stationChecked = { a: true };
  S._finishStation();

  const miss = calls.find((c) => c.correct === false);
  assert.ok(miss, "the missed item must be recorded as wrong");
  assert.equal(miss.skillId, "skill.gen.consent");
  assert.match(String(miss.meta && miss.meta.probe), /consent/i,
    "the miss log must name the checklist item, not just the station");
  assert.equal(miss.meta.mode, "osce");
});

/* ── 3. haptics tell the truth ────────────────────────────────────────────── */

test("an unjudgeable viva answer does not buzz like a wrong one", () => {
  const src = read("clinix-screens.js");
  assert.ok(!/haptic\(correct === true \? "success" : "warning"\)/.test(src),
    "a null verdict (MaiK could not judge) must not fire the wrong-answer haptic");
  assert.match(src, /correct === null[^\n]*"(light|tap)"|"(light|tap)"[^\n]*correct === null/,
    "an unjudged answer gets a neutral haptic");
});

/* ── 4. typed text survives reaching for the mic ──────────────────────────── */

test("tapping the mic keeps what the student already typed", () => {
  /* #cxAnswer is re-rendered from state.vivaPartial on every repaint, and typed text lives only in
   * the DOM until submit. vivaMicToggle cleared vivaPartial and repainted, so a student who typed
   * half an answer and then reached for the mic watched it vanish. */
  const src = read("clinix-screens.js");
  const fn = src.slice(src.indexOf("function vivaMicToggle"), src.indexOf("function vivaSubmitVoiceAnswer"));
  assert.ok(/textAnswer\(\)/.test(fn),
    "vivaMicToggle must read the textbox before it repaints over it");
  assert.ok(!/^\s*state\.vivaPartial = "";\s*$/m.test(fn),
    "it must not blank the answer box unconditionally");
});

/* ── 5. a stream cannot write into a lesson the student has left ──────────── */

test("a tutor answer that lands after the lesson changed is discarded", () => {
  const src = read("clinix-screens.js");
  const fn = src.slice(src.indexOf("function tutorSend"), src.indexOf("function tutorSend") + 1400);
  assert.match(fn, /state\.tutorLog !== |!== log\b/,
    "tutorSend must capture the log it belongs to and drop late frames, like the viva's startedFor guard");
});

/* ── 6. the manifest's declared counts are enforced ───────────────────────── */

test("every disease's declared chapter count matches its pack", () => {
  /* Currently all 22 agree - this pins it. The manifest is fetched first and drives the UI, so a
   * count that drifts from the pack shows a chapter list that does not match what opens. */
  const m = JSON.parse(read("clinix/manifest.json"));
  const bad = [];
  let n = 0;
  for (const sys of m.systems || []) {
    for (const d of sys.diseases || []) {
      n++;
      const pack = JSON.parse(read(join("clinix", d.file)));
      const actual = ((pack.disease || pack).chapters || []).length;
      if (actual !== d.chapters) bad.push(`${d.id}: manifest ${d.chapters}, pack ${actual}`);
    }
  }
  assert.ok(n >= 22, `expected the disease library, walked ${n}`);
  assert.deepEqual(bad, [], "declared chapter counts that no longer match:\n  " + bad.join("\n  "));
});

/* ── 7. the flag comment matches the flags ────────────────────────────────── */

test("index.html does not claim CliniX defaults OFF when it defaults ON", () => {
  const flags = read("clinix-flags.js");
  const def = /smd_clinix:\s*\{[^}]*def:\s*(true|false)/.exec(flags);
  assert.ok(def, "could not read the smd_clinix default");
  const html = read("index.html");
  const block = html.slice(html.indexOf("<!-- CliniX"), html.indexOf("clinix-flags.js"));
  if (def[1] === "true") {
    assert.ok(!/DEFAULT OFF/i.test(block),
      "the load-order comment still says DEFAULT OFF while the flag ships ON");
  }
});
