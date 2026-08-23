/* test/queue-front-desk.test.mjs — front desk works IN THE APP.
 *
 * REPORTED 2026-08-24: "front desk button is dead when I click OPD Queue".
 * It was dead twice over:
 *   1. "I'm front-desk staff" led to a note saying front desk should use the web console instead.
 *   2. That note's only button called window.open(url, "_blank"), which a Capacitor WKWebView
 *      silently ignores - so tapping it did nothing at all.
 * And underneath: authHeaders() only ever sent a Firebase token, so a receptionist (who has no
 * Firebase account, just a clinic ID + login + PIN) could not authenticate from the app even in
 * principle.
 *
 * node --test test/queue-front-desk.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");

function load(store) {
  const s = store || {};
  const win = {
    localStorage: { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => (s[k] = v), removeItem: (k) => delete s[k] },
    addEventListener: () => {}, navigator: { language: "en" }
  };
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {} }),
    body: { appendChild() {} }, addEventListener: () => {} };
  win.window = win;
  try { new Function("window", "document", "location", SRC)(win, doc, { search: "" }); } catch (e) {}
  return win.QUEUE;
}

test("REGRESSION: the front-desk button no longer sends staff to the web console", () => {
  assert.equal(/Front-desk staff use the OPD web console/.test(SRC), false,
    "the dead-end note must be gone");
  assert.match(SRC, /cmd === "rolestaff"[\s\S]{0,120}_staffGate\(\)/,
    "it must open a real sign-in instead");
});

test("the app can authenticate a staff member at all", () => {
  assert.match(SRC, /X-Staff-Token/, "the app must be able to send a staff token");
  assert.match(SRC, /auth\/pin/, "clinic ID + login + PIN sign-in");
  // The staff token must WIN over Firebase, otherwise a doctor's stale session would mask reception.
  const fn = SRC.slice(SRC.indexOf("function authHeaders()"), SRC.indexOf("function authHeaders()") + 420);
  assert.match(fn, /X-Staff-Token/);
  assert.ok(fn.indexOf("X-Staff-Token") < fn.indexOf("fbToken"), "staff token is checked first");
});

test("the sign-in asks for exactly what a receptionist has", () => {
  assert.match(SRC, /qFdOrg/);   // clinic id
  assert.match(SRC, /qFdUser/);  // their login
  assert.match(SRC, /qFdPin/);   // their PIN
  assert.match(SRC, /Clinic ID/i);
  assert.match(SRC, /inputmode="numeric"/, "the PIN opens a number pad");
});

test("a saved staff session reopens on the desk, never the doctor router", () => {
  const open = SRC.slice(SRC.indexOf("function open(opts)"), SRC.indexOf("function open(opts)") + 2200);
  assert.match(open, /staffTok\(\)/, "checked on open");
  assert.ok(open.indexOf("_wpRouterOn") > -1, "the workplace router must be in the sampled window");
  assert.ok(open.indexOf("staffTok()") < open.indexOf("_wpRouterOn"),
    "the staff check must come BEFORE the Hospital/Personal workplace routing");
});

test("the front desk shows the whole clinic, not one doctor's list", () => {
  assert.match(SRC, /opd-board\?orgId=/, "the org board: every room + the pool");
  assert.match(SRC, /function renderFrontDesk/);
  assert.match(SRC, /Waiting to be routed/, "the unassigned pool is visible - it was invisible before");
});

test("actions are gated by the staff member's real capabilities", () => {
  assert.match(SRC, /function staffCan/);
  assert.match(SRC, /staffCan\("queue\.add"\)/, "only staff who may register see Add patient");
  assert.match(SRC, /staffCan\("queue\.assign"\)/, "only staff who may route see Route");
  // caps come from the server's whoami, never from the client's own opinion
  assert.match(SRC, /apiGet\("\/whoami"\)/);
});

test("adding a patient reuses the shared ABDM-ready check-in sheet", () => {
  const fn = SRC.slice(SRC.indexOf("function frontDeskAdd()"), SRC.indexOf("function frontDeskAdd()") + 900);
  assert.match(fn, /SMD_PATIENTREG\.open/, "the same sheet the doctor uses");
  assert.match(fn, /patient\/register/, "server allocates the MR");
  assert.match(fn, /"\/pool"/, "then into the central pool for routing");
});

test("routing only offers rooms that actually have a doctor", () => {
  const fn = SRC.slice(SRC.indexOf("function frontDeskRoute("), SRC.indexOf("function frontDeskRoute(") + 700);
  assert.match(fn, /status !== "unavailable"/, "an unstaffed room has no queue to route into");
  assert.match(fn, /assign-room|doRoute/);
});

test("signing out clears the staff session", () => {
  assert.match(SRC, /cmd === "staffout"[\s\S]{0,140}setStaffTok\(""\)/);
});

test("the module still loads and exposes its API", () => {
  const Q = load();
  assert.ok(Q && typeof Q.open === "function", "QUEUE.open must still exist");
  assert.ok(typeof Q._render === "function");
});
