// The two mounted ABDM surfaces: the V3 callback receiver at /api/v3/* and the M1 clinician routes at
// /api/abdm/*. Both must be inert until their flag is set, and neither may leak PHI or 5xx at ABDM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as receiver } from "../../../functions/api/v3/[[path]].js";
import { onRequest as m1 } from "../../../functions/api/abdm/[[path]].js";

const req = (url, init = {}) => new Request(url, init);
const ctx = (env, request) => ({ request, env, waitUntil: (p) => { (ctx.pending ||= []).push(p); } });

// ── the receiver ────────────────────────────────────────────────────────────────────────────────────
test("the callback receiver is invisible until CONNECT_FLAG is set", async () => {
  const res = await receiver(ctx({}, req("https://abdm.stewardmd.in/api/v3/hip/patient/share", { method: "POST" })));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

test("a callback missing the mandatory headers is refused 400, before any bearer work", async () => {
  const env = { CONNECT_FLAG: "1", ABDM_ENV: "sandbox" };
  const res = await receiver(ctx(env, req("https://abdm.stewardmd.in/api/v3/hip/patient/share", { method: "POST", body: "{}" })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "rejected");
});

test("with valid headers but no bearer, the callback is refused - never 2xx", async () => {
  const env = { CONNECT_FLAG: "1", ABDM_ENV: "sandbox" };
  const res = await receiver(ctx(env, req("https://abdm.stewardmd.in/api/v3/hip/patient/share", {
    method: "POST", body: "{}",
    headers: { "REQUEST-ID": crypto.randomUUID(), TIMESTAMP: new Date().toISOString(), "X-HIP-ID": "IN2810006668" },
  })));
  // 401 (no bearer) or 503 (JWKS unreachable in a test env) are both fail-closed; 2xx would be a hole.
  assert.ok(res.status === 401 || res.status === 503, "got " + res.status);
});

test("an unknown callback path 404s rather than being treated as a known kind", async () => {
  const env = { CONNECT_FLAG: "1", ABDM_ENV: "sandbox" };
  const res = await receiver(ctx(env, req("https://abdm.stewardmd.in/api/v3/nope", { method: "POST", body: "{}" })));
  assert.equal(res.status, 404);
});

// ── the M1 routes ───────────────────────────────────────────────────────────────────────────────────
test("the M1 surface is invisible until ABDM_M1_FLAG is set", async () => {
  const res = await m1(ctx({ CONNECT_FLAG: "1" }, req("https://stewardmd.in/api/abdm/meta")));
  assert.equal(res.status, 404);
});

test("M1 refuses a guest before any ABDM call is made", async () => {
  const env = { ABDM_M1_FLAG: "1", ABDM_ENV: "sandbox" };
  const res = await m1(ctx(env, req("https://stewardmd.in/api/abdm/meta")));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

test("M1 reports 503 rather than crashing when ABDM credentials are absent", async () => {
  // Cf-Access header is the cheapest way past identify() without minting a Firebase token.
  const env = { ABDM_M1_FLAG: "1", ABDM_ENV: "sandbox" };
  const res = await m1(ctx(env, req("https://stewardmd.in/api/abdm/meta", {
    headers: { "Cf-Access-Authenticated-User-Email": "doctor@example.com" },
  })));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "abdm_unavailable");
});

test("an unknown ABDM_ENV is a configuration error, not a silent default", async () => {
  const env = { ABDM_M1_FLAG: "1", ABDM_ENV: "staging" };
  const res = await m1(ctx(env, req("https://stewardmd.in/api/abdm/meta", {
    headers: { "Cf-Access-Authenticated-User-Email": "doctor@example.com" },
  })));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "misconfigured");
});
