// test/site-gate.test.mjs — the web-app kill: browsers get marketing/legal/FollowCare only; the app is
// never served or downloadable in a browser; /api + native are untouched; preview + SITE_ALLOW_WEB escape hatches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

const APP = "APP-SERVED";   // what next() (Pages serving the real asset) would return
function ctx(path, { host = "stewardmd.in", doc = false, method = "GET", env = {} } = {}) {
  const headers = {};
  if (doc) headers["Sec-Fetch-Dest"] = "document";
  const request = new Request("https://" + host + path, { method, headers });
  // `served` records what next() was asked for: the gate serves the marketing home by REWRITING to
  // /_site/, so "root -> marketing" means next() saw /_site/, not that a canned string came back.
  const c = { request, env, served: [], next: async (req) => {
    c.served.push(req ? new URL(req.url).pathname : new URL(request.url).pathname);
    return new Response(APP, { status: 200 });
  } };
  return c;
}
const text = (r) => r.text();

test("site root -> marketing page even WITHOUT Sec-Fetch-Dest/Accept (the header-drop bug that 404'd it)", async () => {
  for (const req of [ctx("/"), ctx("/", { doc: true })]) {
    const r = await onRequest(req);
    assert.equal(r.status, 200);
    // never the app shell: the only thing served is the marketing page under /_site/
    assert.deepEqual(req.served, ["/_site/"]);
  }
});

test("app JS/CSS/kb assets -> hard 404 (bundle not downloadable); .html pages -> marketing", async () => {
  assert.equal((await onRequest(ctx("/home.js"))).status, 404);
  assert.equal((await onRequest(ctx("/kb/dist/kb.core.js"))).status, 404);
  assert.equal((await onRequest(ctx("/app.css"))).status, 404);
  const c = ctx("/index.html");                      // .html -> marketing page, never the app, never a bare 404
  const idx = await onRequest(c);
  assert.equal(idx.status, 200);
  assert.deepEqual(c.served, ["/_site/"]);
});

test("/validation sign-off sheet + the atlas viewer it needs are public; the app bundle is NOT", async () => {
  assert.equal(await text(await onRequest(ctx("/validation", { doc: true }))), APP);
  assert.equal(await text(await onRequest(ctx("/atlas.js"))), APP);
  assert.equal(await text(await onRequest(ctx("/atlas.css"))), APP);
  assert.equal(await text(await onRequest(ctx("/atlas/modules.json"))), APP);
  assert.equal(await text(await onRequest(ctx("/atlas/vhp-thorax-ct/atlas.json"))), APP);
  assert.equal(await text(await onRequest(ctx("/atlas/vhp-thorax-ct/slices/012.webp"))), APP);
  assert.equal(await text(await onRequest(ctx("/api/validation", { method: "POST" }))), APP);
  // the opening is exactly the atlas and nothing adjacent to it
  assert.equal((await onRequest(ctx("/atlas-pipeline/build.py"))).status, 404);
  assert.equal((await onRequest(ctx("/atlasx.js"))).status, 404);
  assert.equal((await onRequest(ctx("/app.js"))).status, 404);
  assert.equal((await onRequest(ctx("/engine.js"))).status, 404);
});

test("/api/* is always served (native backend)", async () => {
  assert.equal(await text(await onRequest(ctx("/api/connect/context", { method: "POST" }))), APP);
});

test("FollowCare portal + its assets + vendor libs + legal pages still served", async () => {
  assert.equal(await text(await onRequest(ctx("/followcare", { doc: true }))), APP);
  assert.equal(await text(await onRequest(ctx("/followcare-i18n.js"))), APP);
  assert.equal(await text(await onRequest(ctx("/vendor/motion/motion.js"))), APP);
  assert.equal(await text(await onRequest(ctx("/privacy", { doc: true }))), APP);
  assert.equal(await text(await onRequest(ctx("/delete-account", { doc: true }))), APP);
});

test("preview deployment (<hash>.stewardmd.pages.dev) still serves the real app for owner testing", async () => {
  assert.equal(await text(await onRequest(ctx("/home.js", { host: "abc123.stewardmd.pages.dev" }))), APP);
});

test("emergency valve SITE_ALLOW_WEB=1 restores the web app instantly", async () => {
  assert.equal(await text(await onRequest(ctx("/home.js", { env: { SITE_ALLOW_WEB: "1" } }))), APP);
});
