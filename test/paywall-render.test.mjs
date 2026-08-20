/* test/paywall-render.test.mjs — the 6-tier paywall renders all tiers + token store without error. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../pro-paywall.js", import.meta.url), "utf8");

const PLANS = { plans: {
  monthly: { months: 1, amount: 59900 }, annual: { months: 12, amount: 499900 },
  tiers: {
    student: { amount: 19900, annual: 199900, regular: 39900, label: "Trainee", requiresVerify: true },
    coresident: { amount: 29900, annual: 299900, regular: 99900, label: "Co-Resident" },
    pro: { amount: 59900, annual: 499900, regular: 99900, label: "Pro", popular: true },
    physician: { amount: 149900, annual: 1499900, regular: 249900, label: "Physician" },
    physicianpro: { amount: 249900, annual: 2499900, regular: 399900, label: "Physician Pro", premium: true },
  },
  addons: { onco: { amount: 8900, label: "Physician Onco" }, clinic: { amount: 13900, label: "Extra clinic" } },
  tokens: { boost: { mt: 50000, amount: 4900 }, plus: { mt: 250000, amount: 19900, regular: 24500, popular: true }, power: { mt: 750000, amount: 49900, regular: 73500 } },
} };

function run(platform) {
  let captured = "";
  const capNode = { onclick: null, style: {}, set innerHTML(v) { captured = v; }, get innerHTML() { return captured; } };
  function node() {
    return { style: {}, firstChild: null, set innerHTML(v) { this._h = v; this.firstChild = this; }, get innerHTML() { return this._h; },
      querySelector: () => capNode, querySelectorAll: () => [], appendChild() {}, remove() {}, addEventListener() {}, getAttribute: () => "" };
  }
  const fetchImpl = async (url) => ({
    status: 200, url, clone() { return this; },
    json: async () => (String(url).indexOf("/plans") > -1 ? PLANS : { promo: false, pro: false }),
  });
  const win = {
    SMD_PRO: {}, SMD_API_BASE: "", ICONS: { get: () => "" }, fetch: fetchImpl,
    SMD_AUTH: { currentUser: { getIdToken: () => Promise.resolve("tok") } },
    Capacitor: platform === "ios" ? { getPlatform: () => "ios" } : undefined,
  };
  const doc = { createElement: () => node(), body: { style: {}, appendChild() {} }, addEventListener() {} };
  // bare `fetch` is a browser global (window.fetch); provide it in the sandbox.
  const fn = new Function("window", "document", "location", "setTimeout", "clearInterval", "setInterval", "history", "navigator", "ICONS", "fetch",
    SRC);
  fn(win, doc, { search: "", hash: "", pathname: "/" }, (f) => (typeof f === "function" ? f() : 0), () => {}, () => 0, { replaceState() {} }, {}, win.ICONS, fetchImpl);
  return { win, get html() { return captured; } };
}

test("web paywall renders all 5 tiers + token store + redeem", async () => {
  const r = run("web");
  r.win.SMD_PRO.openPaywall();
  await new Promise((res) => setTimeout(res, 40));
  const h = r.html;
  ["Trainee", "Co-Resident", "Pro", "Physician", "Physician Pro"].forEach((t) => assert.ok(h.includes(t), "missing tier " + t));
  assert.ok(h.includes("MaiK Token top-ups"), "missing token store");
  assert.ok(h.includes("Most popular") && h.includes("Premium"), "missing badges");
  assert.ok(h.includes("institution code") || h.includes("pp-code"), "redeem shown on web");
});

test("iOS paywall hides the coupon-redeem field", async () => {
  const r = run("ios");
  r.win.SMD_PRO.openPaywall();
  await new Promise((res) => setTimeout(res, 40));
  const h = r.html;
  assert.ok(h.includes("Physician Pro"), "tiers still render on iOS");
  assert.ok(!h.includes("pp-code"), "coupon field must be hidden on iOS");
});
