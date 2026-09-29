/* test/email-deliverability.test.mjs - spam-trait fixes after relayed mail landed in Gmail spam.
 *
 * Owner 2026-09-30: the welcome email, sent from the owner console to an Apple Hide My Email address,
 * passed SPF, DKIM and DMARC and still went to spam. What was ours to fix:
 *   - /api/email-test sent marketing mail with no uid, so the copy had no Unsubscribe link and no
 *     List-Unsubscribe headers (a real sign-up's welcome has both).
 *   - invisible filler after every preheader (a bulk-mail trait that also leaked into the text part).
 *   - the welcome email quoted a price ("From Rs 20 a day. Less than a roadside chai.").
 *
 * node --test --experimental-test-module-mocks test/email-deliverability.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mocks before anything imports _fbadmin / _adminauth -----------------------------------------
const realAdmin = await import("../functions/_fbadmin.js");
const realAuth = await import("../functions/_adminauth.js");
const accounts = new Map();
let lookupThrows = false;
mock.module("../functions/_fbadmin.js", {
  namedExports: { ...realAdmin, lookupUidByEmail: async (_e, email) => {
    if (lookupThrows) throw new Error("identitytoolkit down");
    const uid = accounts.get(String(email).toLowerCase()); return uid ? { uid, email, name: "" } : null;
  } },
});
let owner = true;
mock.module("../functions/_adminauth.js", { namedExports: { ...realAuth, ownerOK: async () => owner } });

const E = await import("../functions/_email.js");
const { onRequestPost: emailTest } = await import("../functions/api/email-test.js");
const { unsubUid } = await import("../functions/_unsub.js");

const RELAY = "rnntckhbr7@privaterelay.appleid.com";
function captureEnv() { const out = []; return { out, env: { __EMAIL_CAPTURE: (o) => out.push(o) } }; }

// Real sendBranded against a faked Resend, so headers and the rendered page are what would ship.
async function sendViaRoute(body) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "x" }), { status: 200 }); }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const env = { RESEND_API_KEY: "re_test" };
    const req = new Request("https://stewardmd.in/api/email-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await emailTest({ request: req, env });
    return { status: res.status, body: await res.json(), sent, env };
  } finally { globalThis.fetch = realFetch; }
}

// ---- preheader ----------------------------------------------------------------------------------
test("no invisible filler after the preview text, in any template", async () => {
  const html = E.renderEmail({ title: "T", preheader: "Preview line.", bodyHtml: "" });
  assert.match(html, /display:none[^>]*>Preview line\.<\/div>/, "the preheader is just the preview text");
  for (const bad of ["&#847;", "&zwnj;", "͏", "‌"]) assert.ok(html.indexOf(bad) < 0, "no " + JSON.stringify(bad));
  const { out, env } = captureEnv();
  await E.emailWelcome(env, { email: RELAY, name: "", uid: "u1" });
  const page = E.renderEmail(out[0]);
  assert.ok(page.indexOf("&#847;") < 0 && page.indexOf("&zwnj;") < 0, "welcome page has no filler");
});

// ---- welcome copy -------------------------------------------------------------------------------
test("welcome quotes no price; the Pro tile stays, with its link", async () => {
  const { out, env } = captureEnv();
  await E.emailWelcome(env, { email: RELAY, name: "", uid: "u1" });
  const o = out[0];
  const all = [o.subject, o.title, o.subtitle, o.preheader, o.bodyHtml].join(" ");
  assert.doesNotMatch(all, /₹|a day|\/day|chai|price/i, "no rupee figure, per-day price or chai line");
  assert.match(o.bodyHtml, /A week free when you verify\./);
  assert.match(o.bodyHtml, /See what Pro unlocks/);
  assert.match(o.bodyHtml, /\?pro=1/);
  assert.equal(o.kind, "marketing"); assert.equal(o.uid, "u1");
  assert.ok(all.indexOf("—") < 0, "no em-dash");
});

test("the Pro upsell still carries its price (prices moved, not removed)", async () => {
  const { out, env } = captureEnv();
  await E.emailProUpsell(env, { email: RELAY, name: "", uid: "u1", promoActive: false });
  assert.match(out[0].subject + out[0].bodyHtml, /₹\d+/);
});

// ---- /api/email-test ----------------------------------------------------------------------------
test("owner test email to a real account carries that account's Unsubscribe link and headers", async () => {
  accounts.set(RELAY, "uid-apple-1"); lookupThrows = false; owner = true;
  const r = await sendViaRoute({ kind: "welcome", email: RELAY });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.equal(r.sent.length, 1);
  const p = r.sent[0];
  assert.match(p.headers["List-Unsubscribe"], /^<https:\/\/stewardmd\.in\/api\/unsubscribe\?t=/);
  assert.equal(p.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(p.html, />Unsubscribe</, "footer Unsubscribe button/link");
  const tok = decodeURIComponent(p.headers["List-Unsubscribe"].match(/t=([^>]+)>/)[1]);
  assert.equal(await unsubUid(r.env, tok), "uid-apple-1", "the token is signed for the real account");
});

test("no account for the address: placeholder uid, still a complete marketing email", async () => {
  accounts.clear(); lookupThrows = false;
  const r = await sendViaRoute({ kind: "upsell", email: "someone@example.org" });
  assert.equal(r.body.ok, true);
  assert.ok(r.sent[0].headers && r.sent[0].headers["List-Unsubscribe"], "List-Unsubscribe present");
  const tok = decodeURIComponent(r.sent[0].headers["List-Unsubscribe"].match(/t=([^>]+)>/)[1]);
  assert.equal(await unsubUid(r.env, tok), "preview-uid");
});

test("a failed account lookup never blocks the test send", async () => {
  lookupThrows = true;
  const r = await sendViaRoute({ kind: "welcome", email: RELAY });
  assert.equal(r.body.ok, true);
  assert.match(r.sent[0].html, />Unsubscribe</);
  lookupThrows = false;
});

test("still owner-only", async () => {
  owner = false;
  const r = await sendViaRoute({ kind: "welcome", email: RELAY });
  assert.equal(r.status, 401); assert.equal(r.sent.length, 0);
  owner = true;
});
