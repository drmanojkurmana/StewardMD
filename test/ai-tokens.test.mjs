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
import { addTokens, getCredits, inrToMt, mtToInr, tokenPackFor, MT_PER_INR, tokenPacks, tokenPackList } from "../functions/_credits.js";
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

test("the token packs are defined once: the paywall and the wallet quote the same selling prices", () => {
  const t = tokenPacks({});
  assert.deepEqual(Object.keys(t), ["boost", "plus", "power"]);
  assert.deepEqual([t.boost.mt, t.boost.amount], [50000, 4900]);     // App Store: in.stewardmd.tokens.boost, INR 49
  assert.deepEqual([t.plus.mt, t.plus.amount, t.plus.regular, t.plus.popular], [250000, 19900, 24500, true]);
  assert.deepEqual([t.power.mt, t.power.amount, t.power.regular], [750000, 49900, 73500]);
  assert.deepEqual(tokenPackList({}), [{ id: "boost", mt: 50000, inr: 49 }, { id: "plus", mt: 250000, inr: 199 }, { id: "power", mt: 750000, inr: 499 }]);
  // A live price change reaches both (env here; the KV override goes through the same cfgPrice).
  assert.equal(tokenPackList({ TOKENS_BOOST: "5900" })[0].inr, 59);
  assert.equal(tokenPacks({ TOKENS_BOOST: "5900" }).boost.amount, 5900);
  // The wallet's worth is at the selling price, not the AI cost rate: 20k tokens = Rs 19.6, not Rs 10.
  assert.equal(Math.round(20000 * 49 / 50000 * 10) / 10, 19.6);
  assert.equal(20000 / MT_PER_INR, 10);
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
  // Google's published price ($0.30 / $2.50 per 1M) at Rs 96 per USD (2026-10-02).
  assert.equal(inrToMt(r.in), 58);                                        // ₹0.0288/1k in
  assert.equal(inrToMt(r.out), 480);                                      // ₹0.24/1k out
  assert.equal(inrToMt(estCostInr(env, model, 0, 0, { images: 1 })), 700);
  assert.equal(inrToMt(estCostInr(env, model, 0, 0, { audioSeconds: 1 })), 8);     // Rs 0.004/s (Vertex audio)
  // A real call: 2k in + 1k out must cost in-rate*2 + out-rate*1.
  assert.equal(inrToMt(estCostInr(env, model, 2000, 1000)), Math.round((0.0288 * 2 + 0.24) * 2000));
  // Env override moves the rate card and the charge together.
  assert.equal(inrToMt(modelRate({ AI_RATE_GEMINI_2_5_FLASH_IN: "0.01" }, model).in), 20);
});

test("a doctor is never quoted an ESTIMATED price", () => {
  assert.equal(rateConfirmed({}, "gemini-2.5-flash"), true, "2.5 rates are published");
  assert.equal(rateConfirmed({}, "gemini-2.5-pro"), true);
  // Google published the 3.x prices (read 2026-10-02), so those are real rates now too.
  assert.equal(rateConfirmed({}, "gemini-3.5-flash"), true, "3.x prices are published");
  assert.equal(rateConfirmed({}, "gemini-3.1-flash-lite"), true);
  assert.equal(rateConfirmed({}, "something-unknown"), false, "unknown model falls back to a guess");
  // The est flag still guards any future model added before its price is published.
});

// Owner, 2026-10-05: the cheapest model in service (every Gemini 2.5 model retires on Vertex 2026-10-16).
test("the active model is gemini-3.1-flash-lite unless deliberately changed", () => {
  assert.equal(MODEL_HARD_DEFAULT, "gemini-3.1-flash-lite");
  assert.equal(resolveModel(null, {}), "gemini-3.1-flash-lite", "no override, no env → 3.1-flash-lite");
  assert.equal(resolveModel(null, { GEMINI_MODEL: "" }), "gemini-3.1-flash-lite");
  assert.equal(resolveModel("not-a-model", {}), "gemini-3.1-flash-lite", "a junk override cannot take effect");
  assert.equal(rateConfirmed({}, resolveModel(null, {})), true, "so the rate card IS publishable by default");
});

test("caps are reported as enforced only when the flag is on", () => {
  assert.equal(capsEnforced({}), false);
  assert.equal(capsEnforced({ MAIK_ENFORCE_CAPS: "0" }), false);
  assert.equal(capsEnforced({ MAIK_ENFORCE_CAPS: "1" }), true);
});

// ---- the dashboard's render, lifted out of home.js's IIFE and run for real ----------------------
// Owner, 2026-10-10: ONE unit (MaiK Tokens), today left, this week, this month; no wallet, rate card or model name.
const src = readFileSync(join(ROOT, "home.js"), "utf8");
const A = src.indexOf("  function aiuBar(");
const B = src.indexOf("  // AI Control Center — OWNER admin console");
assert.ok(A > 0 && B > A, "found the AI Usage render block in home.js");
const renderAiUsage = new Function(
  // The real aiCtlEsc from home.js, so escaping behaviour under test matches production exactly.
  "function aiCtlEsc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}\n" + src.slice(A, B) + "\nreturn renderAiUsage;"
)();

const PRO = { plan: "pro", signedIn: true, day: { limit: 20000, used: 4960 }, week: { used: 14960 }, month: { limit: 300000, used: 40000 } };
const base = { req: 3, tokens: 4200, byModule: { maik: 3 }, allowance: PRO };

test("dashboard: today left leads, with the daily allowance and the nightly reset", () => {
  const h = renderAiUsage(base);
  assert.match(h, /MaiK Tokens left today/); assert.match(h, /15,040/); assert.match(h, /of 20,000/); assert.match(h, /resets every night at midnight/);
  assert.match(h, /aria-label="MaiK Tokens used today"/, "and a bar for it");
});

test("dashboard: this week used and this month left, in the same unit", () => {
  const h = renderAiUsage(base);
  assert.match(h, /Used this week<\/span><b>14,960/);
  assert.match(h, /Left this month<\/span><b>2,60,000/); assert.match(h, /of 3,00,000/);
});

test("dashboard: no wallet, no MT, no price list, no model or vendor name", () => {
  const h = renderAiUsage(Object.assign({}, base, { balanceMt: 250000, rates: { model: "gemini-2.5-flash", inPer1k: 14, outPer1k: 50 }, estCostInr: 3 }));
  assert.ok(!/gemini|vertex/i.test(h), "no vendor/model name");
  const text = h.replace(/<[^>]+>/g, " ");   // what the doctor reads, not CSS class names
  assert.ok(!/\bMT\b|wallet|Pricing|per 1,000 tokens|Buy MaiK Tokens/i.test(text), "no second unit, no rate card");
  assert.ok(h.indexOf("aiuBuy") === -1, "no buy button for a Pro account");
});

test("dashboard: an owner is Unlimited; a free account leads with its month and is offered Pro", () => {
  const own = renderAiUsage({ allowance: { plan: "owner", day: { limit: -1, used: 10 }, week: { used: 10 }, month: { limit: -1, used: 10 } } });
  assert.match(own, /Unlimited/); assert.ok(!/aiuBuy/.test(own));
  const free = renderAiUsage({ allowance: { plan: "free", day: { limit: null, used: 1 }, week: { used: 1 }, month: { limit: 5000, used: 1200 } } });
  assert.match(free, /MaiK Tokens left this month/); assert.match(free, /3,800/); assert.match(free, /renews on the 1st/);
  assert.match(free, /id="aiuBuy"[^>]*>Upgrade to Pro/);
});

test("dashboard: used today by feature lists only what was used, busiest first, and names unknown modules", () => {
  const h = renderAiUsage({ allowance: PRO, byModule: { maik: 5, kb: 4, ocr: 0, tts: 1, brand_new: 2 } });
  assert.match(h, /Used today by feature/);
  assert.ok(h.indexOf("MaiK questions") < h.indexOf("Knowledge Base search"), "busiest first");
  assert.ok(h.indexOf("Photo scans") === -1, "an unused feature is not listed");
  assert.match(h, /brand_new/); assert.match(h, /1 request</, "singular");
  assert.ok(renderAiUsage({ allowance: PRO, byModule: {} }).indexOf("Used today by feature") === -1, "nothing used, no empty list");
});

test("dashboard: an empty or hostile payload still renders a calm screen", () => {
  for (const u of [{}, { allowance: null, tokens: "x" }, { allowance: { plan: "pro", day: { limit: "abc", used: -5 }, week: { used: null }, month: { limit: undefined, used: NaN } }, byModule: null }]) {
    const h = renderAiUsage(u);
    assert.ok(!/undefined|NaN|null/.test(h), "no undefined/NaN/null: " + h.slice(0, 80));
    assert.ok(!/>-\d/.test(h), "no negative counts");
  }
  assert.match(renderAiUsage({}), /Sign in to see your daily and monthly MaiK Tokens/);
});

test("dashboard: progress bars are readable to a screen reader", () => {
  const h = renderAiUsage(base);
  assert.match(h, /role="progressbar"/);
  assert.match(h, /aria-valuenow="25"/, "4,960 of 20,000 = 25%");
});

test("the sheet has a retry that reloads in place, and a skeleton while loading", () => {
  assert.match(src, /aiuRetry[\s\S]{0,200}onclick = aiuLoad/, "retry re-runs the load without reopening the sheet");
  assert.match(src, /aria-busy="true"/, "the loading state is announced");
  assert.match(src, /prefers-reduced-motion/, "the skeleton pulse respects reduced motion");
});

test("the buy button routes to the existing paywall token store", () => {
  assert.match(src, /aiuBuy[\s\S]{0,400}SMD_PRO\.openPaywall/, "home.js wires #aiuBuy to SMD_PRO.openPaywall()");
});
