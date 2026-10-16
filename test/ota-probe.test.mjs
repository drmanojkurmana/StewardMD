/* ota-probe.test.mjs - the download card's speed probe (GET /api/ota/probe): n ASCII bytes, bounded, no-store, CORS-safe. */
import { test } from "node:test";
import assert from "node:assert/strict";
const route = await import("../functions/api/ota/[[path]].js");
const call = (url, method = "GET") => route.onRequest({ request: new Request(url, { method }), env: { OTA_R2: {} }, params: { path: ["probe"] } });

test("probe returns exactly n bytes of ASCII, uncached", async () => {
  const r = await call("https://stewardmd.in/api/ota/probe?n=393216");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.match(r.headers.get("Content-Type"), /^text\/plain/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  const t = await r.text();
  assert.equal(t.length, 393216);
  assert.equal(t.replace(/a/g, "").length, 0);
});

test("probe size is clamped to 1 KB..1.5 MB and bad input falls back to the default", async () => {
  assert.equal((await (await call("https://stewardmd.in/api/ota/probe?n=999999999")).text()).length, 1572864);
  assert.equal((await (await call("https://stewardmd.in/api/ota/probe?n=1")).text()).length, 1024);
  assert.equal((await (await call("https://stewardmd.in/api/ota/probe?n=junk")).text()).length, 393216);
});

test("preflight and HEAD are answered without a body or an owner check", async () => {
  const o = await call("https://stewardmd.in/api/ota/probe", "OPTIONS");
  assert.equal(o.status, 204);
  assert.match(o.headers.get("Access-Control-Allow-Headers"), /Range/);
  const h = await call("https://stewardmd.in/api/ota/probe?n=2048", "HEAD");
  assert.equal(h.status, 200); assert.equal(h.headers.get("Content-Length"), "2048");
  const f = await route.onRequest({ request: new Request("https://stewardmd.in/api/ota/file/" + "a".repeat(64), { method: "OPTIONS" }), env: { OTA_R2: {} }, params: { path: ["file", "a".repeat(64)] } });
  assert.equal(f.status, 204);
});
