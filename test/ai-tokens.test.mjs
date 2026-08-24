/* test/ai-tokens.test.mjs — MaiK Token wallet + the AI Usage dashboard render.
 *
 * Covers the bug this shipped to fix: a token-pack purchase used to fall through the webhook's
 * `months` branch and grant a month of Pro instead of tokens, and the advertised pack sizes did not
 * match what the credit math would have paid out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addTokens, getCredits, inrToMt, mtToInr, tokenPackFor, MT_PER_INR } from "../functions/_credits.js";
import { modelRate, estCostInr, capsEnforced, rateConfirmed, resolveModel, MODEL_HARD_DEFAULT } from "../functions/_ai_usage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const ID = "em:doc@x.in";
// The live pack table (functions/api/billing/[[path]].js) — kept here as the contract under test.
const PACKS = { boost: 50000, plus: 250000, power: 750000 };

test("a token pack credits EXACTLY the tokens the doctor was shown", async () => {
  for (const [pack, mt] of Object.entries(PACKS)) {
    const kv = fakeKv();
    const r = await addTokens(kv, ID, mt);
    assert.equal(r.addedMt, mt, pack + ": advertised size is what lands in the wallet");
    assert.equal(inrToMt(await getCredits(kv, ID)), mt, pack + ": balance reads back as the same token count");
  }
});

test("tokens stack on an existing balance", async () => {
  const kv = fakeKv();
  await addTokens(kv, ID, PACKS.boost);
  await addTokens(kv, ID, PACKS.plus);
  assert.equal(inrToMt(await getCredits(kv, ID)), PACKS.boost + PACKS.plus);
});

test("MT <-> INR is one conversion, both ways", () => {
  assert.equal(MT_PER_INR, 2000);
  assert.equal(inrToMt(25), 50000);
  assert.equal(mtToInr(50000), 25);
  assert.equal(inrToMt(mtToInr(750000)), 750000);
  assert.equal(inrToMt(-5), 0);              // never a negative wallet
  assert.equal(inrToMt("nonsense"), 0);
});

test("only token packs are fulfilled as tokens; subscriptions still grant Pro", () => {
  assert.equal(tokenPackFor("tokens:plus"), "plus");
  assert.equal(tokenPackFor("tokens:boost"), "boost");
  assert.equal(tokenPackFor("pro:monthly"), null);        // <- used to be credited as 1 month; must stay Pro
  assert.equal(tokenPackFor("student:annual"), null);
  assert.equal(tokenPackFor("addon:onco"), null);
  assert.equal(tokenPackFor(""), null);
  assert.equal(tokenPackFor(undefined), null);
  assert.equal(tokenPackFor("tokens:"), null);
  assert.equal(tokenPackFor("xtokens:plus"), null);
});

test("rate card is priced off the same cost model that debits the wallet", () => {
  const env = {}, model = "gemini-2.5-flash";
  const r = modelRate(env, model);
  assert.equal(inrToMt(r.in), 14);                                        // ₹0.007/1k in
  assert.equal(inrToMt(r.out), 50);                                       // ₹0.025/1k out
  assert.equal(inrToMt(estCostInr(env, model, 0, 0, { images: 1 })), 700);
  assert.equal(inrToMt(estCostInr(env, model, 0, 0, { audioSeconds: 1 })), 40);
  // A real call: 2k in + 1k out must cost in-rate*2 + out-rate*1.
  assert.equal(inrToMt(estCostInr(env, model, 2000, 1000)), 14 * 2 + 50);
  // Env override moves the rate card and the charge together.
  assert.equal(inrToMt(modelRate({ AI_RATE_GEMINI_2_5_FLASH_IN: "0.01" }, model).in), 20);
});

test("a doctor is never quoted an ESTIMATED price", () => {
  assert.equal(rateConfirmed({}, "gemini-2.5-flash"), true, "2.5 rates are published");
  assert.equal(rateConfirmed({}, "gemini-2.5-pro"), true);
  assert.equal(rateConfirmed({}, "gemini-3.5-flash"), false, "3.x rates are our own estimate");
  assert.equal(rateConfirmed({}, "gemini-3.5-flash-lite"), false);
  assert.equal(rateConfirmed({}, "gemini-3.1-flash-lite"), false);
  assert.equal(rateConfirmed({}, "something-unknown"), false, "unknown model falls back to a guess");
  // Once the owner enters the published figure, the card may be shown.
  assert.equal(rateConfirmed({ AI_RATE_GEMINI_3_5_FLASH_IN: "0.009" }, "gemini-3.5-flash"), false, "half an override is not a rate");
  assert.equal(rateConfirmed({ AI_RATE_GEMINI_3_5_FLASH_IN: "0.009", AI_RATE_GEMINI_3_5_FLASH_OUT: "0.03" }, "gemini-3.5-flash"), true);
});

test("the active model stays gemini-2.5-flash unless deliberately changed", () => {
  assert.equal(MODEL_HARD_DEFAULT, "gemini-2.5-flash");
  assert.equal(resolveModel(null, {}), "gemini-2.5-flash", "no override, no env → 2.5-flash");
  assert.equal(resolveModel(null, { GEMINI_MODEL: "" }), "gemini-2.5-flash");
  assert.equal(resolveModel("not-a-model", {}), "gemini-2.5-flash", "a junk override cannot take effect");
  assert.equal(rateConfirmed({}, resolveModel(null, {})), true, "so the rate card IS publishable by default");
});

test("caps are reported as enforced only when the flag is on", () => {
  assert.equal(capsEnforced({}), false);
  assert.equal(capsEnforced({ MAIK_ENFORCE_CAPS: "0" }), false);
  assert.equal(capsEnforced({ MAIK_ENFORCE_CAPS: "1" }), true);
});

// ---- the dashboard's render, lifted out of home.js's IIFE and run for real ----------------------
const src = readFileSync(join(ROOT, "home.js"), "utf8");
const A = src.indexOf("  // Compact MaiK Token count");
const B = src.indexOf("  // AI Control Center — OWNER admin console");
assert.ok(A > 0 && B > A, "found the AI Usage render block in home.js");
const renderAiUsage = new Function(
  "function aiCtlEsc(s){return String(s==null?'':s);}\n" + src.slice(A, B) + "\nreturn renderAiUsage;"
)();

const RATES = { model: "gemini-2.5-flash", inPer1k: 14, outPer1k: 50, perImage: 700, perAudioSec: 40 };
const base = { req: 3, tokens: 4200, estCostInr: 0.5, tokensUsedMt: 1000, avgLatencyMs: 2400, mtPerInr: 2000, byModule: { maik: 3 }, limits: { maik: 50, ecg: 10 }, rates: RATES };

test("dashboard: wallet, buy button and rate card always render", () => {
  const h = renderAiUsage(Object.assign({}, base, { balanceMt: 250000 }));
  assert.match(h, /250k/, "balance shown compactly");
  assert.match(h, /id="aiuBuy"/, "buy-tokens button is present for the click wiring to find");
  assert.match(h, /Rate card/);
  assert.match(h, /14 MT/); assert.match(h, /50 MT/); assert.match(h, /700 MT/); assert.match(h, /40 MT/);
  assert.match(h, /gemini-2\.5-flash/);
  assert.ok(h.indexOf("undefined") === -1 && h.indexOf("NaN") === -1, "no undefined/NaN leaks into the sheet");
});

test("dashboard: withholds the rate card entirely when rates are provisional", () => {
  const u = Object.assign({}, base, { balanceMt: 1000, rates: undefined, ratesProvisional: true });
  const h = renderAiUsage(u);
  assert.match(h, /being confirmed and are not published yet/);
  assert.ok(!/\d+ MT<|MT<\/span>|per 1,000 tokens/.test(h), "no per-unit price is printed");
  assert.ok(h.indexOf("gemini-3") === -1, "and no estimated model is named with a price");
  assert.match(h, /id="aiuBuy"/, "buying is still possible");
});

test("dashboard: an empty wallet still invites a top-up instead of showing nothing", () => {
  const h = renderAiUsage(Object.assign({}, base, { balanceMt: 0, req: 0, tokens: 0, tokensUsedMt: 0, byModule: {}, avgLatencyMs: 0 }));
  assert.match(h, /Top up once/);
  assert.match(h, /id="aiuBuy"/);
  assert.match(h, /No AI activity yet today/);
  assert.ok(h.indexOf("NaN") === -1);
});

test("dashboard: no cap bar is drawn while the caps are not enforced", () => {
  const off = renderAiUsage(Object.assign({}, base, { balanceMt: 1000, capsEnforced: false }));
  assert.ok(off.indexOf("3 / 50") === -1, "must not imply a 50/day cap that blocks nobody");
  assert.match(off, /No per-feature daily limits are in force/);
  assert.ok(off.indexOf("aiu-bar") === -1, "no bars at all when nothing is capped and no cost cap is on");

  const on = renderAiUsage(Object.assign({}, base, { balanceMt: 1000, capsEnforced: true }));
  assert.match(on, /3 \/ 50/, "with caps on, the real limit is shown");
  assert.match(on, /0 \/ 10/, "an untouched module still shows its cap");
  assert.match(on, /aiu-bar/);
});

test("dashboard: the free daily allowance bar appears only when the cost cap is live", () => {
  const on = renderAiUsage(Object.assign({}, base, { balanceMt: 0, costCapOn: true, dailyFreeMt: 20000, tokensUsedMt: 15000 }));
  assert.match(on, /free allowance/i);
  assert.match(on, /15k \/ 20k/);
  assert.match(on, /width:75%/, "bar reflects 15k of 20k");
  const off = renderAiUsage(Object.assign({}, base, { balanceMt: 0, costCapOn: false, dailyFreeMt: 20000 }));
  assert.ok(off.toLowerCase().indexOf("free allowance") === -1);
});

test("dashboard: a pooled co-resident is told the balance is shared", () => {
  assert.match(renderAiUsage(Object.assign({}, base, { balanceMt: 5000, pooled: true })), /shared with your linked account/);
  assert.ok(renderAiUsage(Object.assign({}, base, { balanceMt: 5000 })).indexOf("shared with your linked account") === -1);
});

test("the buy button routes to the existing paywall token store", () => {
  assert.match(src, /aiuBuy[\s\S]{0,400}SMD_PRO\.openPaywall/, "home.js wires #aiuBuy to SMD_PRO.openPaywall()");
});
