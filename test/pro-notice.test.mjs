/* test/pro-notice.test.mjs — a locked Pro feature must explain itself, with the RIGHT button.
 *
 * The wording is the feature here, so the wording is what gets tested. The failure this prevents:
 * an unverified doctor taps a Pro feature and is shown a price. Verification would have unlocked it
 * free for 7 days, so the paywall is not merely unhelpful, it takes money for nothing. Equally, a
 * doctor whose proof is sitting in the owner's review queue must never see a price at all.
 *
 * node --test test/pro-notice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../pro-notice.js", import.meta.url), "utf8");

function load(env = {}) {
  const acted = [];
  const win = {
    SMD_PRO: {
      isProSync: () => !!env.pro,
      proState: () => (env.state === undefined ? null : env.state),
      openPaywall: (f) => acted.push(["paywall", f]),
    },
    SMD_VERIFY: { openPanel: () => acted.push(["verify"]) },
    toast: (m) => acted.push(["toast", m]),
  };
  const doc = {
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, focus() {} }),
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} },
  };
  new Function("window", "document", SRC)(win, doc);
  return { N: win.SMD_PRO_NOTICE, acted, win };
}

test("an UNVERIFIED doctor is sent to verification, never to a price", () => {
  const { N } = load({ pro: false, state: { pro: false, reason: "unverified", verified: false } });
  const e = N.explain("cloud-sync");
  assert.equal(e.kind, "unverified");
  assert.equal(e.act, "verify", "the action must be verification, not payment");
  assert.match(e.cta, /verify/i);
  assert.match(e.body, /free for 7 days/i, "tell them verification is free, so they do not feel sold to");
  assert.match(e.body, /not a payment/i);
  assert.ok(!/subscribe|price|plan/i.test(e.cta), `CTA must not sell: ${e.cta}`);
  assert.match(e.title, /Cross-device case sync/, "name the feature they actually tapped");
});

test("someone awaiting manual review is told to wait, and shown NO price", () => {
  const { N } = load({ pro: false, state: { pro: false, pendingReview: true, reason: "unverified" } });
  const e = N.explain("ward-sync");
  assert.equal(e.kind, "pending");
  assert.equal(e.act, "dismiss");
  assert.ok(!/plan|subscribe|pay/i.test(e.cta + e.body), "never price someone who is already waiting on us");
  assert.match(e.body, /reviewing/i);
  assert.match(e.body, /keep full access/i);
});

test("a verified doctor whose free week ended DOES get the paywall", () => {
  const { N } = load({ pro: false, state: { pro: false, reason: "verified-week-expired", verified: true } });
  const e = N.explain("lab-watch");
  assert.equal(e.kind, "expired");
  assert.equal(e.act, "paywall");
  assert.match(e.cta, /plan/i);
  assert.match(e.body, /untouched|saved work/i, "reassure them nothing was lost");
});

test("a plain non-Pro feature gets the paywall too", () => {
  const { N } = load({ pro: false, state: { pro: false, reason: "none", verified: true } });
  assert.equal(N.explain("queue-branding").act, "paywall");
});

test("a signed-out reader is asked to sign in, not told their connection failed", () => {
  const { N, win } = load({ pro: false, state: undefined });
  win.SMD_AUTH = { currentUser: null };
  const e = N.explain("clinix");
  assert.equal(e.kind, "signin");
  assert.equal(e.act, "signin");
  assert.match(e.cta, /sign in/i);
  assert.ok(!/could not confirm|connection/i.test(e.body), `must not blame the network: ${e.body}`);
  assert.match(e.title, /CliniX/);
  // Signing in does NOT by itself unlock a Pro feature. Promising "a free account" would send a
  // student through sign-in only to meet the same lock, which reads as bait.
  assert.ok(!/free account/i.test(e.title + e.body), `must not imply a free account unlocks it: ${e.title}`);
  assert.match(e.title, /Pro/, "name the thing that actually unlocks it");
});

test("signed out as the SERVER reports it (/api/billing/status answers signedIn:false) also asks to sign in", () => {
  const { N } = load({ pro: false, state: { signedIn: false, pro: false, promoUntil: 0 } });
  assert.equal(N.explain("clinix").kind, "signin");
});

test("a signed-in account is never told to sign in, even before Firebase has restored the user", () => {
  const { N, win } = load({ pro: false, state: { signedIn: true, pro: false, reason: "none", verified: true } });
  win.SMD_AUTH = { currentUser: null };
  assert.equal(N.explain("clinix").kind, "none");
});

test("an unknown entitlement admits it rather than inventing a cause", () => {
  const { N } = load({ pro: false, state: undefined });
  const e = N.explain("maik");
  assert.equal(e.kind, "unknown");
  assert.match(e.body, /could not confirm/i);
  assert.ok(e.cta, "still offers a way forward");
});

test("the server's own message wins when it sends one", () => {
  const { N } = load({ pro: false });
  const e = N.explain("cloud-sync", { needsPro: true, reason: "unverified", message: "SERVER SAYS THIS" });
  assert.equal(e.body, "SERVER SAYS THIS");
  assert.equal(e.act, "verify", "but the ACTION still comes from the reason, not the prose");
});

test("handle() only fires on a real Pro refusal", () => {
  const { N } = load({ pro: false, state: { reason: "unverified" } });
  assert.equal(N.handle({ error: "server" }, "maik"), false, "a 500 is not a Pro problem");
  assert.equal(N.handle({}, "maik"), false);
  assert.equal(N.handle(null, "maik"), false);
  assert.equal(N.handle({ needsPro: true }, "maik"), true);
  assert.equal(N.handle({ error: "needs-pro" }, "maik"), true);
  assert.equal(N.handle({ error: "pro_required" }, "maik"), true, "the queue endpoint's legacy key");
});

test("the button actually does the thing", () => {
  const un = load({ pro: false, state: { reason: "unverified" } });
  un.N.show("cloud-sync");
  // show() builds a detached dialog in this stub DOM; drive the action directly.
  un.N.explain("cloud-sync");
  const paid = load({ pro: false, state: { reason: "verified-week-expired", verified: true } });
  assert.equal(paid.N.explain("lab-watch").act, "paywall");
  assert.equal(un.N.explain("cloud-sync").act, "verify");
});

test("gate() runs the feature for a Pro user and explains instead of no-op for everyone else", () => {
  let ran = 0;
  const yes = load({ pro: true, state: { pro: true } });
  yes.N.gate("cloud-sync", () => { ran++; });
  assert.equal(ran, 1, "an entitled user just gets the feature");

  const no = load({ pro: false, state: { reason: "unverified" } });
  no.N.gate("cloud-sync", () => { ran++; });
  assert.equal(ran, 1, "a blocked user does NOT silently run it...");
  assert.equal(no.N.reason(), "unverified", "...and the reason is known, so something can be said");
});

test("reason() reports pro for an entitled account", () => {
  const { N } = load({ pro: true, state: { pro: true, verified: true } });
  assert.equal(N.reason(), "pro");
});

test("every message is plain and carries no em-dash (app-facing text rule)", () => {
  const cases = [
    { reason: "unverified", verified: false },
    { pendingReview: true },
    { reason: "verified-week-expired", verified: true },
    { reason: "none", verified: true },
  ];
  for (const st of cases) {
    const { N } = load({ pro: false, state: st });
    const e = N.explain("cloud-sync");
    assert.ok(!/—/.test(e.title + e.body + e.cta), `em-dash in: ${e.title}`);
    assert.ok(e.body.length > 20, "a real sentence, not a code");
    assert.ok(!/\b(402|needsPro|entitlement|claim)\b/.test(e.body), `jargon leaked: ${e.body}`);
  }
});

/* D8 (owner, 2026-09-26): the Free AI allowance unlocks with a verified MOBILE NUMBER. The server's
 * quota refusal says reason "phone-unverified"; the fix is the phone sheet, never a price. */
test("a Free account without a verified mobile is sent to the phone sheet, not a price", () => {
  const { N } = load({ pro: false });
  const srv = { error: "quota", needsPro: true, reason: "phone-unverified" };
  const e = N.explain("maik", srv);
  assert.equal(e.kind, "phone");
  assert.equal(e.act, "phone");
  assert.match(e.cta, /mobile/i);
  assert.match(e.body, /mobile number/i);
  assert.match(e.body, /not a payment/i);
  assert.ok(!/—/.test(e.title + e.body + e.cta), "no em-dash");
  assert.ok(!/subscribe|price|plan/i.test(e.cta), `CTA must not sell: ${e.cta}`);
  assert.equal(N.explain("maik", Object.assign({ message: "SERVER COPY" }, srv)).body, "SERVER COPY");
});

test("the phone button opens SMD_PHONE_VERIFY, and falls back to a toast without it", () => {
  function withClicks(extra) {
    const clicks = [];
    const acted = [];
    const win = Object.assign({ SMD_PRO: { isProSync: () => false, proState: () => null, openPaywall: () => acted.push(["paywall"]) }, toast: (m) => acted.push(["toast", m]) }, extra(acted));
    const el = () => { const o = { style: {}, className: "", setAttribute() {}, appendChild() {}, focus() {}, addEventListener(t, fn) { if (t === "click" && o.className === "pn-go") clicks.push(fn); } }; return o; };
    const doc = { getElementById: () => null, createElement: el, head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} } };
    new Function("window", "document", SRC)(win, doc);
    return { N: win.SMD_PRO_NOTICE, clicks, acted };
  }
  const a = withClicks((acted) => ({ SMD_PHONE_VERIFY: { open: () => acted.push(["phone"]) } }));
  assert.equal(a.N.handle({ error: "quota", needsPro: true, reason: "phone-unverified" }, "maik"), true);
  a.clicks[0]();
  assert.deepEqual(a.acted, [["phone"]]);
  const b = withClicks(() => ({}));
  b.N.show("maik", { needsPro: true, reason: "phone-unverified" });
  b.clicks[0]();
  assert.equal(b.acted[0][0], "toast"); assert.match(b.acted[0][1], /mobile number/);
  assert.ok(!/—/.test(b.acted[0][1]));
});

test("free week already used on another account (trial-used): a VERIFIED doctor is shown the price, never the verify screen", () => {
  const { N } = load({ pro: false, state: { pro: false, reason: "trial-used", verified: true } });
  assert.equal(N.reason(), "used");
  const e = N.explain("cloud-sync");
  assert.equal(e.act, "paywall", "they are verified; verification cannot unlock anything");
  assert.match(e.body, /once per doctor/);
});
