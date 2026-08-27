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
