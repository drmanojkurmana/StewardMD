// test/thorex-secure-egress.test.mjs — security H1: the smd_thorex_secure_egress flag routes native CXR
// analysis through the authenticated Worker proxy (/api/thorex) instead of raw Cloud Run. Default OFF
// keeps the direct-backend validation path; web builds already use the same-origin edge.
import { test } from "node:test";
import assert from "node:assert";

let flagOn = false, native = true;
globalThis.window = { Capacitor: { isNativePlatform: () => native }, SMD_THOREX_FLAGS: { bool: (k) => k === "smd_thorex_secure_egress" && flagOn } };
const NET = (await import("../thorex-net.js")).default;

// Capture the POST URL; return a 400 (no retry) so we never touch the decode path.
function captureFetch(rec) {
  return function (url) { rec.url = url; return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: { message: "stop" } }), text: () => Promise.resolve("{}") }); };
}
async function urlFor(opts) {
  const rec = {};
  const a = NET.remoteAnalyzer({ fetchImpl: captureFetch(rec) });
  try { await a.analyze({ data: "x" }, "v1", () => {}); } catch (e) { /* expected 400 */ }
  return rec.url;
}

test("native + flag OFF: posts straight to the raw Cloud Run backend (validation path unchanged)", async () => {
  native = true; flagOn = false;
  assert.equal(await urlFor(), "https://thorex-pipeline-yislqrddsq-uc.a.run.app/v1/cxr/analyze");
});

test("native + flag ON: routes through the authenticated Worker proxy (/api/thorex/v1/cxr/analyze)", async () => {
  native = true; flagOn = true;
  assert.equal(await urlFor(), "https://stewardmd.in/api/thorex/v1/cxr/analyze");
});

test("web build always uses the same-origin edge, regardless of the flag", async () => {
  native = false; flagOn = false;
  assert.equal(await urlFor(), "/api/thorex/v1/cxr/analyze");
});
