/* test/email-template.test.mjs - the email system: the template engine, the signed unsubscribe
 * token and endpoint, the per-day price maths, the promotional series and the lifecycle rules that
 * decide who gets what.
 *
 * Requested 2026-09-19: emails "like Apple sends", every marketing email with an unsubscribe button
 * and header, the promotional series selling 2-3 features per email with the price quoted per day.
 *
 * node --test test/email-template.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../functions/_email.js";
import { PROMO_EDITIONS, promoEdition, emailPromo } from "../functions/_promo.js";
import { unsubToken, unsubUid, unsubUrl } from "../functions/_unsub.js";
import { dayPrices, perDay, inr } from "../functions/_pricing.js";
import { markUnsubscribed, isUnsubscribed, getLifecycle, sendProUpsellOnce, decidePromo, promoSeriesEnabled, markPhoneVerified } from "../functions/_lifecycle.js";
import { onRequest as unsubscribeRoute } from "../functions/api/unsubscribe.js";
import { buildPreview } from "../functions/api/email-preview.js";

const EM_DASH = "—";
const DAY = 86400000;

// In-memory KV with the subset of the Cloudflare API the lifecycle module uses.
function memKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v.value) : v.value; },
    async put(k, v, o) { m.set(k, { value: v, metadata: (o && o.metadata) || null }); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).metadata })), list_complete: true }; },
  };
}
function env(extra) { return Object.assign({ UNSUB_SECRET: "test-secret", MAIK_KV: memKV() }, extra || {}); }

// Capture what a template hands to sendBranded, without a network.
async function captured(fn) { let o = null; await fn({ __EMAIL_CAPTURE: (x) => { o = x; } }); return o; }

/* ── unsubscribe token ─────────────────────────────────────────────────────────────────────────── */
test("unsubscribe token round-trips and a forged one verifies to null", async () => {
  const e = env();
  const t = await unsubToken(e, "uid-123");
  assert.ok(t && t.indexOf(".") > 0);
  assert.equal(await unsubUid(e, t), "uid-123");
  assert.equal(await unsubUid(e, t.slice(0, -2) + "zz"), null, "tampered signature");
  assert.equal(await unsubUid(e, "dWlkLTEyMw." + "AAAA"), null, "wrong length");
  assert.equal(await unsubUid(e, ""), null);
  assert.equal(await unsubUid({ UNSUB_SECRET: "other" }, t), null, "different secret");
  assert.equal(await unsubToken({}, "uid"), "", "no secret at all: no token, no link");
  assert.match(unsubUrl(t), /^https:\/\/stewardmd\.in\/api\/unsubscribe\?t=/);
});

test("the token falls back to the Resend key, so a sending deployment always has one", async () => {
  const t = await unsubToken({ RESEND_API_KEY: "re_x" }, "u");
  assert.equal(await unsubUid({ RESEND_API_KEY: "re_x" }, t), "u");
});

/* ── per-day pricing ───────────────────────────────────────────────────────────────────────────── */
test("per-day prices come from the live plan amounts and round UP", () => {
  const p = dayPrices({});
  assert.equal(p.pro.month, 599); assert.equal(p.pro.day, 20, "599/30 = 19.97 -> 20, never 19");
  assert.equal(p.trainee.day, 7, "199/30 = 6.63 -> 7");
  assert.equal(p.annual.year, 4999); assert.equal(p.annual.day, 14, "4999/365 = 13.7 -> 14");
  assert.equal(p.coresident.day, 10); assert.equal(p.coresident.perSeatDay, 5);
  assert.equal(perDay(100, 30), 4);
  assert.equal(inr(4999), "₹4,999", "Indian grouping");
  // An env/KV override flows straight into the copy.
  assert.equal(dayPrices({ PRO_PRICE_MONTHLY: "89900" }).pro.day, 30);
});

/* ── the template ──────────────────────────────────────────────────────────────────────────────── */
test("renderEmail: logo, one headline, subline, preheader; marketing adds Unsubscribe, transactional does not", () => {
  const html = E.renderEmail({ title: "Hello.", subtitle: "One line.", bodyHtml: E.tile({ title: "T" }), preheader: "pre", kind: "marketing", unsub: "https://stewardmd.in/api/unsubscribe?t=abc" });
  assert.match(html, /logo\.png/, "the SD mark");
  assert.match(html, /<h1[^>]*>Hello\.<\/h1>/);
  assert.match(html, /One line\./);
  assert.match(html, /display:none[^>]*>pre/);
  assert.equal((html.match(/unsubscribe\?t=abc/g) || []).length, 2, "footer button AND footer link");
  assert.match(html, />Unsubscribe</);
  assert.match(html, /MAIKNOWLEDGE LLP/);
  assert.match(html, /privacy\.html/); assert.match(html, /terms\.html/);
  const tx = E.renderEmail({ title: "Code", bodyHtml: E.codeBox("123456") });
  assert.doesNotMatch(tx, /Unsubscribe/);
  assert.match(tx, /123456/);
  assert.doesNotMatch(html + tx, /border:1px solid #e2e8f0|background:#0e6e63;padding:24px/, "the old teal-banner shell is gone");
});

test("sendBranded: a marketing email with a uid carries List-Unsubscribe + one-click headers; transactional carries none", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => "" }; };
  try {
    const e = env({ RESEND_API_KEY: "re_test" });
    const r = await E.sendBranded(e, { to: "d@x.in", subject: "S", title: "T", bodyHtml: "<p>b</p>", kind: "marketing", uid: "u1" });
    assert.equal(r.ok, true); assert.equal(r.unsub, true);
    const b = calls[0].body;
    assert.match(b.headers["List-Unsubscribe"], /^<https:\/\/stewardmd\.in\/api\/unsubscribe\?t=.+>$/);
    assert.equal(b.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(b.html, /Unsubscribe/);
    assert.equal(b.from, "StewardMD <noreply@stewardmd.in>");
    // The footer link and the header point at the same signed token.
    const tok = decodeURIComponent(b.headers["List-Unsubscribe"].match(/t=([^>]+)/)[1]);
    assert.equal(await unsubUid(e, tok), "u1");

    await E.sendBranded(e, { to: "d@x.in", subject: "S", title: "T", bodyHtml: "<p>b</p>" });
    assert.equal(calls[1].body.headers, undefined, "transactional: no unsubscribe header");
    assert.doesNotMatch(calls[1].body.html, /Unsubscribe/);

    assert.deepEqual(await E.sendBranded({}, { to: "d@x.in", subject: "S", title: "T" }), { ok: false, skipped: true }, "no key: skipped, never throws");
  } finally { globalThis.fetch = realFetch; }
});

/* ── every template, every edition: copy rules ─────────────────────────────────────────────────── */
const ARGS = { email: "d@x.in", name: "Asha Rao", uid: "u1" };
const TEMPLATES = {
  otp: (e) => E.emailOtp(e, { ...ARGS, code: "123456", minutes: 10 }),
  reset: (e) => E.emailResetCode(e, { ...ARGS, code: "123456" }),
  temp: (e) => E.emailTempPassword(e, { ...ARGS, password: "Abcdefgh1234" }),
  verified: (e) => E.emailVerified(e, { ...ARGS, regNo: "1", council: "APMC" }),
  reminder: (e) => E.emailVerifyReminder(e, { ...ARGS, daysLeft: 2 }),
  pro: (e) => E.emailProConfirmation(e, { ...ARGS, trial: true }),
  failed: (e) => E.emailFailed(e, { ...ARGS, reason: "no match" }),
  welcome: (e) => E.emailWelcome(e, ARGS),
  upsell: (e) => E.emailProUpsell(e, { ...ARGS, promoActive: false }),
  upsellPromo: (e) => E.emailProUpsell(e, { ...ARGS, promoActive: true, promoUntilStr: "27 Sep 2026" }),
  alert: (e) => E.emailAlert(e, { ...ARGS, title: "A result landed.", line: "Open the app." }),
};
for (const ed of PROMO_EDITIONS) TEMPLATES["promo:" + ed] = (e) => emailPromo(e, { ...ARGS, edition: ed });

test("no em-dash in any subject, headline, subline or body (CLAUDE.md), and every one renders", async () => {
  for (const [k, fn] of Object.entries(TEMPLATES)) {
    const o = await captured(fn);
    assert.ok(o && o.subject && o.title, k + " builds");
    const html = E.renderEmail(o);
    for (const s of [o.subject, o.title, o.subtitle || "", o.preheader || "", html]) assert.ok(s.indexOf(EM_DASH) < 0, k + " has an em-dash");
    assert.ok(html.length > 2000, k + " renders a full page");
  }
});

test("which emails are marketing (unsubscribable) and which are account notices", async () => {
  const kind = async (k) => (await captured(TEMPLATES[k])).kind || "transactional";
  for (const k of ["welcome", "upsell", "upsellPromo", ...PROMO_EDITIONS.map((e) => "promo:" + e)]) {
    const o = await captured(TEMPLATES[k]);
    assert.equal(o.kind, "marketing", k); assert.equal(o.uid, "u1", k + " carries the uid the token is signed for");
  }
  for (const k of ["otp", "reset", "temp", "verified", "reminder", "pro", "failed", "alert"]) assert.equal(await kind(k), "transactional", k);
});

test("the promotional series: seven editions, 2-3 features each, per-day price, one button", () => {
  assert.equal(PROMO_EDITIONS.length, 7);
  assert.equal(new Set(PROMO_EDITIONS).size, 7, "no duplicate ids");
  for (const id of PROMO_EDITIONS) {
    const e = promoEdition({}, id);
    assert.equal(e.id, id);
    const tiles = (e.bodyHtml.match(/border-radius:22px;padding:30px 28px/g) || []).length;
    assert.ok(tiles >= 2 && tiles <= 3, id + " has " + tiles + " feature tiles");
    assert.equal((e.bodyHtml.match(/border-radius:980px;background:#0e6e63/g) || []).length, 1, id + " has exactly one primary button");
    assert.match(e.bodyHtml, /background-image:linear-gradient/, id + " has a hero panel");
    assert.match(e.bodyHtml, /₹\d+ a day|₹\d+\/day/, id + " quotes a per-day price");
  }
  assert.equal(promoEdition({}, 0).id, "maik", "by index");
  assert.equal(promoEdition({}, "nope"), null);
  // The comparison the owner asked for: cheaper than chai / water / a pastry.
  const all = PROMO_EDITIONS.map((id) => { const e = promoEdition({}, id); return e.subtitle + e.bodyHtml; }).join("");
  assert.match(all, /chai/); assert.match(all, /bottle of water/); assert.match(all, /pastry/);
  assert.match(all, /₹20 a day/, "Pro at 599/mo is 20 a day");
  assert.match(all, /₹14 a day/, "annual at 4999 is 14 a day");
  assert.match(all, /₹7 a day/, "trainee at 199 is 7 a day");
});

test("imaging edition says decision support, never a diagnosis", () => {
  const e = promoEdition({}, "imaging");
  assert.match(e.bodyHtml, /decision support/i);
  assert.match(e.bodyHtml, /never makes a diagnosis/i);
});

/* ── lifecycle: opt-out and the series rules ───────────────────────────────────────────────────── */
test("markUnsubscribed flips only the marketing flag, mirrored into metadata, and can be undone", async () => {
  const e = env();
  await e.MAIK_KV.put("lifecycle:u:u1", JSON.stringify({ email: "d@x.in", firstSeen: 5, upsellAt: 9 }), { metadata: { firstSeen: 5 } });
  const r = await markUnsubscribed(e, "u1", true);
  assert.ok(r.unsubscribedAt > 0); assert.equal(r.upsellAt, 9); assert.equal(r.firstSeen, 5);
  assert.ok(e.MAIK_KV._m.get("lifecycle:u:u1").metadata.unsubscribedAt > 0, "sweeps can filter from list()");
  assert.equal(isUnsubscribed(await getLifecycle(e, "u1")), true);
  const back = await markUnsubscribed(e, "u1", false);
  assert.equal(back.unsubscribedAt, undefined);
  assert.equal(e.MAIK_KV._m.get("lifecycle:u:u1").metadata.unsubscribedAt, 0);
});

test("sendProUpsellOnce honours an opt-out and does NOT stamp it as sent", async () => {
  const e = env();
  await markUnsubscribed(e, "u1", true);
  const r = await sendProUpsellOnce(e, "u1", { email: "d@x.in" });
  assert.deepEqual(r, { sent: false, reason: "unsubscribed" });
  assert.equal((await getLifecycle(e, "u1")).upsellAt, undefined);
});

test("decidePromo: due only after the start delay, spaced out, never to opt-outs, payers or after the last edition", () => {
  const now = Date.parse("2026-09-19T10:00:00Z");
  const rec = (age, x) => ({ email: "d@x.in", firstSeen: now - age * DAY, ...(x || {}) });
  assert.equal(decidePromo({}, rec(6), {}, now).send, true);
  assert.equal(decidePromo({}, rec(6), {}, now).edition, "maik");
  assert.equal(decidePromo({}, rec(4), {}, now).reason, "too-young", "day-3 upsell owns the first days");
  assert.equal(decidePromo({}, rec(10, { promoIdx: 1, promoAt: now - 2 * DAY }), {}, now).reason, "too-soon");
  assert.equal(decidePromo({}, rec(10, { promoIdx: 1, promoAt: now - 5 * DAY }), {}, now).edition, "bedside");
  assert.equal(decidePromo({}, rec(10, { unsubscribedAt: 1 }), {}, now).reason, "unsubscribed");
  assert.equal(decidePromo({}, rec(10), { pro: true }, now).reason, "paying");
  assert.equal(decidePromo({}, rec(10), { pro: true, proExp: now - 1 }, now).send, true, "an expired Pro is a lapsed customer, worth an email");
  assert.equal(decidePromo({}, rec(40, { promoIdx: 7, promoAt: now - 10 * DAY }), {}, now).reason, "done");
  assert.equal(decidePromo({}, rec(10, { purgedAt: 1 }), {}, now).reason, "purged");
  assert.equal(decidePromo({}, { firstSeen: now - 10 * DAY }, {}, now).reason, "no-email");
  assert.equal(decidePromo({ PROMO_START_DAYS: "1" }, rec(2), {}, now).send, true, "cadence is env-tunable");
});

test("the series is OFF until the owner switches it on", () => {
  assert.equal(promoSeriesEnabled({}), false);
  assert.equal(promoSeriesEnabled({ PROMO_SERIES_ON: "1" }), true);
  assert.equal(promoSeriesEnabled({ PROMO_SERIES_ON: "0" }), false);
});

test("markPhoneVerified records the number and the time", async () => {
  const e = env();
  const r = await markPhoneVerified(e, "u1", "919876543210");
  assert.equal(r.phone, "919876543210"); assert.ok(r.phoneVerifiedAt > 0);
});

/* ── the endpoint ──────────────────────────────────────────────────────────────────────────────── */
test("/api/unsubscribe: GET unsubscribes and shows Resubscribe; one-click POST returns plain ok; resub POST undoes; bad token 400", async () => {
  const e = env();
  const t = await unsubToken(e, "u1");
  const req = (method, q, body, ct) => new Request("https://stewardmd.in/api/unsubscribe?t=" + encodeURIComponent(q), { method, body, headers: ct ? { "Content-Type": ct } : {} });

  let r = await unsubscribeRoute({ request: req("GET", t), env: e });
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.match(html, /You are unsubscribed/); assert.match(html, />Resubscribe</);
  assert.equal(isUnsubscribed(await getLifecycle(e, "u1")), true);

  r = await unsubscribeRoute({ request: req("POST", t, "resub=1", "application/x-www-form-urlencoded"), env: e });
  assert.match(await r.text(), /back on the list/);
  assert.equal(isUnsubscribed(await getLifecycle(e, "u1")), false);

  r = await unsubscribeRoute({ request: req("POST", t, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"), env: e });
  assert.equal(r.status, 200); assert.equal(await r.text(), "ok", "RFC 8058 clients want a bare 2xx");
  assert.equal(isUnsubscribed(await getLifecycle(e, "u1")), true);

  r = await unsubscribeRoute({ request: req("GET", "forged.token"), env: e });
  assert.equal(r.status, 400); assert.match(await r.text(), /not valid/);
  r = await unsubscribeRoute({ request: req("DELETE", t), env: e });
  assert.equal(r.status, 405);
});

test("the owner preview builds every kind without sending", async () => {
  for (const k of ["welcome", "upsell", "verified", "reminder", "failed", "pro", "otp", "reset", "temp", "alert", "promo:maik", "promo:annual"]) {
    const o = await buildPreview({}, k, {});
    assert.ok(o && o.subject && o.bodyHtml, k);
  }
  assert.equal(await buildPreview({}, "nope", {}), null);
});
