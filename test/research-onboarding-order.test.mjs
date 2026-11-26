/* Onboarding order: the optional profile sheet waits for the first screen, and a session shows
 * at most one optional onboarding sheet. Both client files are loaded for real in a VM sandbox;
 * the DOM is a tiny stateful stub so the sequencing logic and the email-auth hand-off are
 * exercised, not just grepped.
 *
 * node --test --experimental-test-module-mocks test/research-onboarding-order.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const profileSrc = fs.readFileSync(new URL("../profile-setup.js", import.meta.url), "utf8");
const emailSrc = fs.readFileSync(new URL("../email-auth.js", import.meta.url), "utf8");

function makeStorage() {
  const bag = new Map();
  return {
    getItem(k) { return bag.has(k) ? bag.get(k) : null; },
    setItem(k, v) { bag.set(String(k), String(v)); },
    removeItem(k) { bag.delete(String(k)); },
    clear() { bag.clear(); },
    _bag: bag,
  };
}

function makeEl(id, opts) {
  opts = opts || {};
  const cls = new Set(opts.classes || []);
  const attrs = new Map(Object.entries(opts.attrs || {}));
  const el = {
    id,
    style: opts.style || {},
    classList: {
      contains: (c) => cls.has(c),
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); },
    },
    hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getBoundingClientRect: () => (opts.rect || { width: 300, height: 600, top: 0, left: 0, right: 300, bottom: 600 }),
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    _cls: cls,
    _attrs: attrs,
  };
  return el;
}

function makeSandbox(opts) {
  opts = opts || {};
  const elements = new Map();
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const document = {
    readyState: "complete",
    documentElement: {},
    body: { appendChild() {} },
    head: { appendChild() {} },
    addEventListener() {},
    getElementById: (id) => elements.get(id) || null,
    querySelector(sel) {
      const id = String(sel || "").replace(/^#/, "").split(".")[0];
      let el = elements.get(id);
      if (!el) return null;
      if (/\.on$/.test(sel) && !el.classList.contains("on")) return null;
      return el;
    },
    querySelectorAll() { return []; },
    createElement: () => makeEl("created"),
  };
  const sandbox = {
    console,
    document,
    localStorage: opts.localStorage || localStorage,
    sessionStorage: opts.sessionStorage || sessionStorage,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    getComputedStyle(el) {
      if (!el) return { display: "none", visibility: "hidden", opacity: "0" };
      const st = el.style || {};
      return { display: st.display || "block", visibility: st.visibility || "visible", opacity: st.opacity || "1" };
    },
    navigator: { onLine: true },
    location: { search: "" },
    CustomEvent: function CustomEvent() {},
    MutationObserver: function MutationObserver() {
      this.observe = () => {};
      this.disconnect = () => {};
    },
  };
  sandbox.window = sandbox;
  sandbox.elements = elements;
  sandbox._localStorage = localStorage;
  sandbox._sessionStorage = sessionStorage;
  if (opts.seed) opts.seed(sandbox);
  return sandbox;
}

function loadProfile(opts) {
  const sandbox = makeSandbox(opts);
  vm.runInContext(profileSrc, vm.createContext(sandbox), { filename: "profile-setup.js" });
  assert.ok(sandbox.window.SMD_PROFILE_SETUP, "profile-setup.js must export SMD_PROFILE_SETUP");
  return { sandbox, P: sandbox.window.SMD_PROFILE_SETUP };
}

function loadEmailAuth(opts) {
  const sandbox = makeSandbox(opts);
  vm.runInContext(emailSrc, vm.createContext(sandbox), { filename: "email-auth.js" });
  assert.ok(sandbox.window.SMD_EMAIL_AUTH, "email-auth.js must export SMD_EMAIL_AUTH");
  return { sandbox, EA: sandbox.window.SMD_EMAIL_AUTH };
}

/* ── the decision itself ─────────────────────────────────────────────────────────────────── */

test("legacy order always wins: immediate open, even with a spent budget or no first screen", () => {
  const { P } = loadProfile();
  const d = P._onb.decide;
  assert.equal(d({ legacy: true, shown: true, foreground: false, force: false, needed: false }), "open-now");
  assert.equal(d({ legacy: true, shown: false, foreground: false, force: false, needed: true }), "open-now");
});

test("one optional onboarding sheet per session", () => {
  const { P } = loadProfile();
  const d = P._onb.decide;
  assert.equal(d({ legacy: false, shown: true, foreground: true, force: true, needed: null }), "skip-session");
  assert.equal(d({ legacy: false, shown: true, foreground: false, force: false, needed: true }), "skip-session");
  assert.equal(d({ legacy: false, shown: false, foreground: true, force: false, needed: true }), "open");
});

test("the optional sheet waits for the first screen", () => {
  const { P } = loadProfile();
  const d = P._onb.decide;
  assert.equal(d({ legacy: false, shown: false, foreground: false, force: true, needed: null }), "wait");
  assert.equal(d({ legacy: false, shown: false, foreground: false, force: false, needed: true }), "wait");
});

test("a complete profile is not asked again; a forced first-run still opens", () => {
  const { P } = loadProfile();
  const d = P._onb.decide;
  assert.equal(d({ legacy: false, shown: false, foreground: true, force: false, needed: false }), "skip-not-needed");
  assert.equal(d({ legacy: false, shown: false, foreground: true, force: true, needed: false }), "open");
});

test("marking the session budget is shared and resets with a new session", () => {
  const { P, sandbox } = loadProfile();
  assert.equal(P._onb.shown(), false);
  P._onb.markShown();
  assert.equal(P._onb.shown(), true);
  assert.equal(sandbox._sessionStorage.getItem(P._onb.OPTIONAL_KEY), "1");
  assert.equal(sandbox._localStorage.getItem(P._onb.OPTIONAL_KEY), null, "budget must not leak across sessions");
  sandbox._sessionStorage.clear();
  assert.equal(P._onb.shown(), false);
});

test("smd_onb_legacy is the localStorage switch", () => {
  const on = loadProfile();
  on.sandbox._localStorage.setItem(on.P._onb.FLAG, "1");
  assert.equal(on.P._onb.legacy(), true);
  const off = loadProfile();
  assert.equal(off.P._onb.legacy(), false);
});

/* ── first screen / stacking guards ──────────────────────────────────────────────────────── */

test("the first screen is blocked by every pre-home gate", () => {
  const { P } = loadProfile();
  assert.equal(P._onb.firstScreen(), true, "no home container and no gates is a usable shell");

  const home = makeEl("homeV2", { classes: ["on"] });
  // Fresh sandbox because elements live in its document.
  const withHome = loadProfile();
  withHome.sandbox.elements.set("homeV2", home);
  assert.equal(withHome.P._onb.firstScreen(), true);

  for (const id of ["accountGate", "introPoster", "verifyGate", "splash", "smdBootSplash"]) {
    const s = loadProfile();
    s.sandbox.elements.set(id, makeEl(id));
    assert.equal(s.P._onb.firstScreen(), false, id + " must hold the optional sheet back");
  }
});

test("other onboarding and work overlays are busy screens, not free space", () => {
  const applock = loadProfile();
  applock.sandbox.elements.set("smdApplock", makeEl("smdApplock"));
  assert.equal(applock.P._onb.busy(), true);

  const phone = loadProfile();
  phone.sandbox.elements.set("phvRoot", makeEl("phvRoot", { classes: ["on"] }));
  assert.equal(phone.P._onb.busy(), true);

  const phoneOff = loadProfile();
  phoneOff.sandbox.elements.set("phvRoot", makeEl("phvRoot"));
  assert.equal(phoneOff.P._onb.busy(), false, "a closed phone sheet is not busy");

  const research = loadProfile();
  research.sandbox.elements.set("researchMD", makeEl("researchMD"));
  assert.equal(research.P._onb.busy(), true, "never interrupt ResearchMD with the profile form");

  const researchHidden = loadProfile();
  researchHidden.sandbox.elements.set("researchMD", makeEl("researchMD", { attrs: { hidden: "true" } }));
  assert.equal(researchHidden.P._onb.busy(), false);

  const icu = loadProfile();
  icu.sandbox.elements.set("icuRoot", makeEl("icuRoot", { classes: ["on"] }));
  assert.equal(icu.P._onb.busy(), true);

  const tour = loadProfile();
  tour.sandbox.elements.set("smdtWel", makeEl("smdtWel", { style: { display: "flex" } }));
  tour.sandbox.document.querySelector = (sel) => (sel === ".smdt-wel" ? tour.sandbox.elements.get("smdtWel") : null);
  assert.equal(tour.P._onb.busy(), true);
});

/* ── email-auth hand-off ─────────────────────────────────────────────────────────────────── */

test("first-run profile asks go through the deferred request; explicit re-opens stay immediate", () => {
  const calls = [];
  const { EA } = loadEmailAuth({
    seed(sandbox) {
      sandbox.window.SMD_PROFILE_SETUP = {
        open() { calls.push("open"); },
        request(opts) { calls.push(["request", opts && opts.force]); },
      };
    },
  });
  EA._openProfile({ firstRun: true, name: "Dr Test" });
  assert.deepEqual(calls, [["request", true]]);

  calls.length = 0;
  EA._openProfile();   // Account / explicit re-open
  assert.deepEqual(calls, ["open"]);
});