/* test/paywall-interceptor.test.mjs — pro-paywall.js wiring: SMD_PRO methods + the /api/ai 429
 * ai-cost-cap fetch interceptor. Minimal fake window/document; no real browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../pro-paywall.js", import.meta.url), "utf8");

function stubNode() {
  const node = { style: {}, _html: "", firstChild: null,
    set innerHTML(v) { this._html = v; this.firstChild = node; }, get innerHTML() { return this._html; },
    querySelector: () => ({ style: {}, onclick: null }),
    querySelectorAll: () => [], appendChild() {}, remove() {}, addEventListener() {}, getAttribute: () => "" };
  return node;
}
function load(fetchImpl) {
  let created = 0;
  const win = { SMD_PRO: {}, SMD_API_BASE: "", ICONS: { get: () => "" }, fetch: fetchImpl };
  const doc = {
    createElement() { created++; return stubNode(); },
    body: { style: {}, appendChild() {} },
    addEventListener() {},
  };
  const loc = { search: "", hash: "", pathname: "/" };
  // ICONS is read as a bare global in the browser (window.ICONS alias); provide it in the sandbox.
  const fn = new Function("window", "document", "location", "setTimeout", "clearInterval", "setInterval", "history", "navigator", "ICONS", SRC);
  fn(win, doc, loc, (f) => f, () => {}, () => 0, { replaceState() {} }, {}, win.ICONS);
  return { win, doc, createdCount: () => created };
}

test("attach exposes openPaywall / openAiLimit / refresh on SMD_PRO", () => {
  const { win } = load(async () => ({ status: 200, clone() { return this; }, json: async () => ({}) }));
  assert.equal(typeof win.SMD_PRO.openPaywall, "function");
  assert.equal(typeof win.SMD_PRO.openAiLimit, "function");
  assert.equal(typeof win.SMD_PRO.refresh, "function");
});

test("fetch is wrapped once (idempotent marker)", () => {
  const { win } = load(async () => ({ status: 200, clone() { return this; }, json: async () => ({}) }));
  assert.equal(win.fetch._smdPaywrap, true);
});

test("non-AI fetch passes through untouched", async () => {
  const orig = async (u) => ({ status: 429, url: u, clone() { return this; }, json: async () => ({ reason: "ai-cost-cap" }) });
  const { win, createdCount } = load(orig);
  const before = createdCount();
  const r = await win.fetch("/api/billing/status");   // not /api/ai/ → no sheet
  assert.equal(r.status, 429);
  assert.equal(createdCount(), before);                // openAiLimit NOT called (no node created)
});

test("AI 429 ai-cost-cap opens the AI-limit sheet", async () => {
  const orig = async (u) => ({ status: 429, url: u, clone() { return this; }, json: async () => ({ reason: "ai-cost-cap", resetAt: 0, credits: 0 }) });
  const { win, createdCount } = load(orig);
  const before = createdCount();
  const r = await win.fetch("/api/ai/maik");
  assert.equal(r.status, 429);                          // caller still gets the real response
  await new Promise((res) => setTimeout(res, 0));       // let the clone().json().then fire
  assert.ok(createdCount() > before, "openAiLimit created an overlay node");
});
