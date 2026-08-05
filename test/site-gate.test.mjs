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
  return { request, env, next: async () => new Response(APP, { status: 200 }) };
}
const text = (r) => r.text();

test("app page navigation (/) -> marketing page, NOT the app", async () => {
  const r = await onRequest(ctx("/", { doc: true }));
  assert.equal(r.status, 200);
  const b = await text(r);
  assert.notEqual(b, APP);
  assert.match(b, /Coming soon/i);
});

test("app assets (home.js / index.html / kb) -> hard 404 (bundle not downloadable)", async () => {
  assert.equal((await onRequest(ctx("/home.js"))).status, 404);
  assert.equal((await onRequest(ctx("/kb/dist/kb.core.js"))).status, 404);
  assert.equal((await onRequest(ctx("/index.html"))).status, 404);           // asset request
  const doc = await onRequest(ctx("/index.html", { doc: true }));            // document request -> marketing
  assert.notEqual(await text(doc), APP);
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
