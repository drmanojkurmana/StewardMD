/* test/paywall-resync.test.mjs — the Subscription tap decides on a FRESH entitlement verdict.
 *
 * Reported 2026-09-02: "even after registration is verified it asks me to verify again when I press
 * the subscription button". openPaywall() bounced to the verify explainer off the /billing/status
 * payload account.js cached at sign-in, which predated the verification. Now it re-syncs once
 * before bouncing, and never loops.
 *
 * Same sandbox harness as paywall-render.test.mjs (pro-paywall.js run under new Function with a
 * stub window), plus stubs for SMD_PRO.sync and SMD_PRO_NOTICE.
 *
 * node --test test/paywall-resync.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../pro-paywall.js", import.meta.url), "utf8");

const PLANS = { plans: { monthly: { months: 1, amount: 59900 }, annual: { months: 12, amount: 499900 },
  tiers: { pro: { amount: 59900, annual: 499900, regular: 99900, label: "Pro", popular: true } }, addons: {}, tokens: {} } };

/* `reasons` is the sequence SMD_PRO_NOTICE.reason() answers with: the first value is the cached
 * verdict, the second is what a sync() flips it to. */
function run(reasons) {
  let reasonIdx = 0;
  const calls = { syncs: 0, shows: [], appended: 0 };
  const node = () => ({ style: {}, firstChild: null, set innerHTML(v) { this._h = v; this.firstChild = this; }, get innerHTML() { return this._h; },
    querySelector: () => ({ onclick: null, style: {}, set innerHTML(v) {}, get innerHTML() { return ""; } }), querySelectorAll: () => [],
    appendChild() {}, remove() {}, addEventListener() {}, getAttribute: () => "" });
  const fetchImpl = async (url) => ({ status: 200, url, clone() { return this; },
    json: async () => (String(url).indexOf("/plans") > -1 ? PLANS : { pro: reasons[reasonIdx] === "pro" }) });
  const win = {
    SMD_API_BASE: "", ICONS: { get: () => "" }, fetch: fetchImpl,
    SMD_AUTH: { currentUser: { getIdToken: () => Promise.resolve("tok") } },
    SMD_PRO: { sync() { calls.syncs++; if (reasonIdx < reasons.length - 1) reasonIdx++; return Promise.resolve({}); } },
    SMD_PRO_NOTICE: { reason: () => reasons[reasonIdx], show: (f) => calls.shows.push(f) },
  };
  const doc = { createElement: () => node(), body: { style: {}, appendChild() { calls.appended++; } }, addEventListener() {} };
  const fn = new Function("window", "document", "location", "setTimeout", "clearInterval", "setInterval", "history", "navigator", "ICONS", "fetch", SRC);
  fn(win, doc, { search: "", hash: "", pathname: "/" }, (f) => (typeof f === "function" ? f() : 0), () => {}, () => 0, { replaceState() {} }, {}, win.ICONS, fetchImpl);
  return { win, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test("THE REPORTED CASE: verified this session, cache still says unverified -> the paywall opens", async () => {
  const { win, calls } = run(["unverified", "pro"]);
  win.SMD_PRO.openPaywall("menu");
  await settle();
  assert.equal(calls.syncs, 1, "one fresh status round trip before deciding");
  assert.deepEqual(calls.shows, [], "the verify explainer must NOT appear for a verified doctor");
  assert.equal(calls.appended, 1, "the real paywall is on screen");
});

test("still unverified after the fresh check -> the explainer, once, and no loop", async () => {
  const { win, calls } = run(["unverified", "unverified"]);
  win.SMD_PRO.openPaywall("menu");
  await settle();
  assert.equal(calls.syncs, 1, "re-synced exactly once, not on every pass");
  assert.deepEqual(calls.shows, ["menu"], "sent to verification, with the feature they tapped");
  assert.equal(calls.appended, 0, "no paywall for someone whose problem is verification");
});

test("pending review after the fresh check -> the wait explainer, no paywall", async () => {
  const { win, calls } = run(["pending", "pending"]);
  win.SMD_PRO.openPaywall("lab-watch");
  await settle();
  assert.equal(calls.syncs, 1);
  assert.deepEqual(calls.shows, ["lab-watch"]);
  assert.equal(calls.appended, 0);
});

test("an account the cache already knows is Pro opens the paywall with no round trip", async () => {
  const { win, calls } = run(["pro"]);
  win.SMD_PRO.openPaywall("menu");
  await settle();
  assert.equal(calls.syncs, 0, "nothing to re-check");
  assert.deepEqual(calls.shows, []);
  assert.equal(calls.appended, 1);
});

test("a free week that has ended is a real paywall, not a verify bounce, and needs no round trip", async () => {
  const { win, calls } = run(["expired"]);
  win.SMD_PRO.openPaywall("menu");
  await settle();
  assert.equal(calls.syncs, 0);
  assert.deepEqual(calls.shows, []);
  assert.equal(calls.appended, 1);
});

test("sync() failing still ends in a decision (the explainer), not a hang", async () => {
  const { win, calls } = run(["unverified", "unverified"]);
  win.SMD_PRO.sync = () => { calls.syncs++; return Promise.reject(new Error("offline")); };
  win.SMD_PRO.openPaywall("menu");
  await settle();
  assert.equal(calls.syncs, 1);
  assert.deepEqual(calls.shows, ["menu"]);
});
