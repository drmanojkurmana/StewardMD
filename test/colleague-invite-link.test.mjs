/* The colleague invite link https://stewardmd.in/add/<StewardMD ID> (Colleagues > Invite on WhatsApp):
 * the page served to a doctor without the app (functions/add/[id].js), the gate letting it through,
 * and the Universal Link association that makes it open the app instead.
 *
 * node --test test/colleague-invite-link.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../functions/add/[id].js");
const { onRequest: gate } = await import("../functions/_middleware.js");

test("normalizeId: accepts the ID with or without SMD-, any case; refuses everything else", () => {
  assert.equal(P.normalizeId("SMD-95NURW"), "SMD-95NURW");
  assert.equal(P.normalizeId("smd-95nurw"), "SMD-95NURW");
  assert.equal(P.normalizeId("95nurw"), "SMD-95NURW");
  assert.equal(P.normalizeId("SMD%2D95NURW"), "SMD-95NURW");
  for (const bad of ["", "SMD-95NUR", "SMD-95NURWX", "<script>", "SMP-1234-5678A", "%E0%A4%A"]) assert.equal(P.normalizeId(bad), "", bad);
});

test("the invite page: shows the ID, both stores and an open-the-app link; no script; noindex", async () => {
  const r = P.renderInvite("smd-95nurw");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /SMD-95NURW/);
  assert.match(html, /href="stewardmd:\/\/add\/SMD-95NURW"/);
  assert.ok(html.includes(P.APP_STORE) && html.includes(P.PLAY_STORE));
  assert.ok(!/<script/i.test(html), "script-free");
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  assert.match(html, /property="og:title" content="Add me on StewardMD"/, "WhatsApp shows a clear preview");
  assert.ok(!/[–—]/.test(html), "no em or en dash");
  assert.ok(!/web app|browser/i.test(html), "never presented as a web product");
});

test("the invite page: a malformed ID is escaped, never echoed, and answers 404", async () => {
  const r = P.renderInvite("<img src=x onerror=alert(1)>");
  assert.equal(r.status, 404);
  const html = await r.text();
  assert.ok(!/onerror/.test(html) && !/<img src=x/.test(html));
  assert.match(html, /Join your colleagues on StewardMD/);
});

test("onRequest: GET and HEAD only", async () => {
  const post = await P.onRequest({ request: new Request("https://stewardmd.in/add/SMD-95NURW", { method: "POST" }), params: { id: "SMD-95NURW" } });
  assert.equal(post.status, 405);
  const get = await P.onRequest({ request: new Request("https://stewardmd.in/add/SMD-95NURW"), params: { id: "SMD-95NURW" } });
  assert.equal(get.status, 200);
});

test("the stewardmd.in gate lets /add/<ID> through to its function, not the marketing page", async () => {
  let asked = null;
  const res = await gate({ request: new Request("https://stewardmd.in/add/SMD-95NURW"), env: {}, next: async (r) => { asked = r ? new URL(r.url).pathname : "/add/SMD-95NURW"; return new Response("page"); }, params: {}, waitUntil() {} });
  assert.equal(res.status, 200); assert.equal(asked, "/add/SMD-95NURW");
});

test("the Universal Link association covers /add/* so the link opens the app on iOS", async () => {
  const res = await gate({ request: new Request("https://stewardmd.in/.well-known/apple-app-site-association"), env: {}, next: async () => new Response("x"), params: {}, waitUntil() {} });
  const aasa = await res.json();
  assert.ok(aasa.applinks.details.some((d) => (d.paths || []).includes("/add/*")));
});
