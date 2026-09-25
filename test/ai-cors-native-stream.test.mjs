/* Audit T14 (server half): the native app streams /explain cross-origin from its own WebView origin,
 * and the preflight must allow every header the app sends (reasoning.js aiHeaders adds X-SMD-Device). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/ai/[[path]].js";

for (const origin of ["capacitor://localhost", "https://localhost"]) {
  test(`preflight from ${origin} allows Authorization and X-SMD-Device`, async () => {
    const req = new Request("https://stewardmd.in/api/ai/explain?stream=1", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization,x-smd-device" } });
    const r = await onRequest({ request: req, env: {}, params: { path: ["explain"] }, waitUntil: () => {} });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), origin);
    const allow = (r.headers.get("Access-Control-Allow-Headers") || "").toLowerCase();
    for (const h of ["authorization", "x-smd-device", "content-type"]) assert.ok(allow.includes(h), h);
  });
}
test("an unknown origin gets no CORS grant", async () => {
  const req = new Request("https://stewardmd.in/api/ai/explain", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  const r = await onRequest({ request: req, env: {}, params: { path: ["explain"] }, waitUntil: () => {} });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});
