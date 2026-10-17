/* test/prep-bank-gate.test.mjs — Comprehensive unit tests for PrepNucleus bank gate.
 *
 * Verifies:
 * 1. ENFORCE=1: unauthenticated requests get 401 JSON
 * 2. Strict Origin/CORS check: foreign origin -> 403 with no CORS header
 * 3. App binding: missing origin (curl) with valid token only -> 401 app-binding-required
 * 4. Signed-in user without app proof -> 401 missing-proof
 * 5. Signed-in user with valid app proof -> 200 with private, no-store cache and CORS headers
 * 6. Nonce replay -> 401 replayed-nonce
 * 7. Stale timestamp (>60s) -> 401 stale-timestamp
 * 8. Invalid signature -> 401 invalid-signature
 * 9. Session user mismatch -> 401 session-user-mismatch
 * 10. Image signed query params: valid -> 200 private max-age=300; expired -> 401; forged -> 401
 * 11. Rate limit minute burst (120 req/min) -> 429
 * 12. Sequential enumeration (>30 module files/min) -> 429 enumeration-detected and 24h account flag
 * 13. Flagged user rejected -> 429 account-flagged
 * 14. Shadow mode (ENFORCE=0): unauthenticated requests return 200 private, no-store (shadow logged)
 * 15. Guard test: all bank paths classified public or gated; no question file is public
 * 16. Guard test: gated responses are NEVER public or immutable
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = {
  "tok-a": { sub: "u-a", email: "a@example.com", email_verified: true },
  "tok-b": { sub: "u-b", email: "b@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifiedClaimsFor: async (req) => claimsOf(req),
    identify: async (req) => {
      const c = claimsOf(req);
      return c ? "fb:" + c.sub : null;
    },
  },
});

const bank = await import("../functions/api/prep/bank/[[path]].js");
const gate = await import("../functions/_prep_bank_gate.js");

function r2(files) {
  return { get: async (k) => (k in files ? { body: files[k], httpEtag: '"e1"' } : null) };
}

function kv() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

async function createSignedRequest(path, userToken, session, overrides = {}) {
  const ts = overrides.timestamp != null ? overrides.timestamp : Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce || ("n_" + Math.random().toString(36).slice(2));
  const toSign = `${ts}:${path}:${nonce}`;
  const sig = overrides.sig != null ? overrides.sig : (session ? await gate.hmacSha256Hex(session.sessionKey, toSign) : "bad_sig");

  const headers = new Headers({
    Origin: overrides.origin != null ? overrides.origin : "https://stewardmd.in",
    "X-SMD-Device": "dev-test-1",
  });

  if (userToken) headers.set("Authorization", "Bearer " + userToken);
  if (session && overrides.noSessionHeader !== true) headers.set("X-SMD-Session", session.sessionId);
  if (overrides.noTimestampHeader !== true) headers.set("X-SMD-Timestamp", String(ts));
  if (overrides.noNonceHeader !== true) headers.set("X-SMD-Nonce", nonce);
  if (overrides.noSigHeader !== true) headers.set("X-SMD-Signature", sig);

  if (overrides.dropOrigin) headers.delete("Origin");

  return new Request("https://stewardmd.in/api/prep/bank/" + path, {
    method: "GET",
    headers,
  });
}

test("gate [ENFORCE=1]: unauthenticated curl request gets 401 JSON", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const req = new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", {
    method: "GET",
  });
  const r = await bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: req });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  const j = await r.json();
  assert.equal(j.error, "unauthorized");
  assert.equal(j.code, "app-binding-required");
});

test("gate [ENFORCE=1]: curl with valid user token only (no origin, no app proof) is refused", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const req = new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", {
    method: "GET",
    headers: { Authorization: "Bearer tok-a" },
  });
  const r = await bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: req });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "app-binding-required");
});

test("gate [ENFORCE=1]: foreign origin is refused with 403 and NO CORS headers", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const req = new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", {
    method: "GET",
    headers: {
      Origin: "https://attacker.example.com",
      Authorization: "Bearer tok-a",
    },
  });
  const r = await bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: req });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  const j = await r.json();
  assert.equal(j.code, "foreign-origin");
});

test("gate [ENFORCE=1]: signed-in user without app proof headers gets 401 missing-proof", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const req = new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", {
    method: "GET",
    headers: {
      Origin: "https://stewardmd.in",
      Authorization: "Bearer tok-a",
    },
  });
  const r = await bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: req });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "missing-proof");
});

test("gate [ENFORCE=1]: mint session + valid app proof gets 200 with private no-store and CORS headers", async () => {
  gate.resetBankGateMemory();
  const memKv = kv();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: memKv,
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[{"id":"q1","q":"Test question"}]}' }),
  };

  // 1. Mint session via POST /api/prep/bank/session
  const sessReq = new Request("https://stewardmd.in/api/prep/bank/session", {
    method: "POST",
    headers: {
      Origin: "https://stewardmd.in",
      Authorization: "Bearer tok-a",
      "Content-Type": "application/json",
      "X-SMD-Device": "phone-1",
    },
    body: JSON.stringify({ deviceId: "phone-1", appVersion: "1.0.0" }),
  });
  const sessRes = await bank.onRequestPost({ env, params: { path: ["session"] }, request: sessReq });
  assert.equal(sessRes.status, 200);
  const sessData = await sessRes.json();
  assert.equal(sessData.ok, true);
  assert.ok(sessData.sessionId);
  assert.ok(sessData.sessionKey);

  // 2. Request question module with valid app proof
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";
  const req = await createSignedRequest(path, "tok-a", sessData);
  const r = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://stewardmd.in");
  assert.match(r.headers.get("Vary"), /Origin/);
  const body = await r.json();
  assert.equal(body.topic, "ana-gametogenesis");
  assert.equal(body.items.length, 1);
});

test("gate [ENFORCE=1]: mint session without Origin header (curl) is refused with 403", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: kv(),
  };
  const sessReq = new Request("https://stewardmd.in/api/prep/bank/session", {
    method: "POST",
    headers: {
      Authorization: "Bearer tok-a",
      "Content-Type": "application/json",
      "X-SMD-Device": "dev-test-1",
    },
    body: JSON.stringify({ deviceId: "dev-test-1", appVersion: "1.0.0" }),
  });
  const sessRes = await bank.onRequestPost({ env, params: { path: ["session"] }, request: sessReq });
  assert.equal(sessRes.status, 403);
  const sessData = await sessRes.json();
  assert.equal(sessData.code, "origin-required");
});

test("gate [ENFORCE=1]: mint session with foreign Origin is refused with 403", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: kv(),
  };
  const sessReq = new Request("https://stewardmd.in/api/prep/bank/session", {
    method: "POST",
    headers: {
      Origin: "https://evil-site.com",
      Authorization: "Bearer tok-a",
      "Content-Type": "application/json",
      "X-SMD-Device": "dev-test-1",
    },
    body: JSON.stringify({ deviceId: "dev-test-1", appVersion: "1.0.0" }),
  });
  const sessRes = await bank.onRequestPost({ env, params: { path: ["session"] }, request: sessReq });
  assert.equal(sessRes.status, 403);
  const sessData = await sessRes.json();
  assert.equal(sessData.code, "foreign-origin");
});

test("gate [ENFORCE=1]: replayed nonce is rejected with 401 replayed-nonce", async () => {
  gate.resetBankGateMemory();
  const memKv = kv();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: memKv,
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";

  const req1 = await createSignedRequest(path, "tok-a", sess, { nonce: "fixed_nonce_1" });
  const res1 = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req1 });
  assert.equal(res1.status, 200);

  // Send exact same nonce again
  const req2 = await createSignedRequest(path, "tok-a", sess, { nonce: "fixed_nonce_1" });
  const res2 = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req2 });
  assert.equal(res2.status, 401);
  const j2 = await res2.json();
  assert.equal(j2.code, "replayed-nonce");
});

test("gate [ENFORCE=1]: stale timestamp (>60s) is rejected with 401 stale-timestamp", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";

  const staleTs = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
  const req = await createSignedRequest(path, "tok-a", sess, { timestamp: staleTs });
  const r = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "stale-timestamp");
});

test("gate [ENFORCE=1]: invalid signature is rejected with 401 invalid-signature", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";

  const req = await createSignedRequest(path, "tok-a", sess, { sig: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" });
  const r = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "invalid-signature");
});

test("gate [ENFORCE=1]: session user mismatch (session of user B used with token of user A) is rejected", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  // Mint session for user B
  const sessB = await gate.mintBankSession({ id: "fb:u-b" }, env);
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";

  // Use user A's auth token with user B's session
  const req = await createSignedRequest(path, "tok-a", sessB);
  const r = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.code, "session-user-mismatch");
});

test("gate [ENFORCE=1]: image URL HMAC query authentication and expiry", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v5/img/ana-brachial-plexus-1.webp": "RIFF_IMAGE_DATA" }),
  };

  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const imgPath = "v5/img/ana-brachial-plexus-1.webp";

  // 1. Valid signed image URL
  const query = await gate.signImagePath(sess.sessionKey, sess.sessionId, imgPath, 300);
  const validUrl = "https://stewardmd.in/api/prep/bank/" + imgPath + "?" + query;
  const reqValid = new Request(validUrl, { method: "GET" });
  const rValid = await bank.onRequestGet({ env, params: { path: imgPath.split("/") }, request: reqValid });
  assert.equal(rValid.status, 200);
  assert.equal(rValid.headers.get("Content-Type"), "image/webp");
  assert.equal(rValid.headers.get("Cache-Control"), "private, max-age=300");

  // 2. Expired query parameter
  const expiredQuery = `s=${encodeURIComponent(sess.sessionId)}&exp=${Math.floor(Date.now() / 1000) - 10}&sig=abc`;
  const reqExp = new Request("https://stewardmd.in/api/prep/bank/" + imgPath + "?" + expiredQuery, { method: "GET" });
  const rExp = await bank.onRequestGet({ env, params: { path: imgPath.split("/") }, request: reqExp });
  assert.equal(rExp.status, 401);
  assert.equal((await rExp.json()).code, "expired-or-invalid-expiry");

  // 3. Forged signature query parameter
  const now = Math.floor(Date.now() / 1000);
  const forgedQuery = `s=${encodeURIComponent(sess.sessionId)}&exp=${now + 200}&sig=deadbeef`;
  const reqForged = new Request("https://stewardmd.in/api/prep/bank/" + imgPath + "?" + forgedQuery, { method: "GET" });
  const rForged = await bank.onRequestGet({ env, params: { path: imgPath.split("/") }, request: reqForged });
  assert.equal(rForged.status, 401);
  assert.equal((await rForged.json()).code, "invalid-signature");
});

test("gate [ENFORCE=1]: rate limit burst (120 req/min) returns 429", async () => {
  gate.resetBankGateMemory();
  const memKv = kv();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: memKv,
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"items":[]}' }),
  };

  const user = { id: "fb:u-a" };
  const p = "v1/anatomy/search.json";
  const now = Date.now();

  // 120 calls succeed
  for (let i = 0; i < 120; i++) {
    const rl = await gate.checkBankRateLimits(env, user, p, null, now);
    assert.equal(rl.ok, true);
  }

  // 121st call fails with 429 minute-limit
  const rlDenied = await gate.checkBankRateLimits(env, user, p, null, now);
  assert.equal(rlDenied.ok, false);
  assert.equal(rlDenied.status, 429);
  assert.equal(rlDenied.code, "minute-limit");
});

test("gate [ENFORCE=1]: bulk download enumeration (>30 module files/min) flags account 24h and returns 429", async () => {
  gate.resetBankGateMemory();
  const memKv = kv();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: memKv,
    PREP_BANK_R2: r2({}),
  };

  const user = { id: "fb:u-scrapper" };
  const now = Date.now();

  // 30 module file requests pass
  for (let i = 0; i < 30; i++) {
    const rl = await gate.checkBankRateLimits(env, user, `v1/anatomy/mcq/ana-topic-${i}.json`, null, now);
    assert.equal(rl.ok, true);
  }

  // 31st module file request triggers enumeration detection and 24h flag
  const rlDenied = await gate.checkBankRateLimits(env, user, "v1/anatomy/mcq/ana-topic-31.json", null, now);
  assert.equal(rlDenied.ok, false);
  assert.equal(rlDenied.status, 429);
  assert.equal(rlDenied.code, "enumeration-detected");

  // Subsequent request within 24h is rejected with account-flagged
  const rlFlagged = await gate.checkBankRateLimits(env, user, "v1/anatomy/mcq/ana-topic-0.json", null, now + 1000);
  assert.equal(rlFlagged.ok, false);
  assert.equal(rlFlagged.status, 429);
  assert.equal(rlFlagged.code, "account-flagged");
});

test("gate [ENFORCE=0 / default OFF]: shadow mode logs would-deny but allows request", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "0",
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };

  // Request without auth or proof
  const req = new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", {
    method: "GET",
  });
  const r = await bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: req });
  assert.equal(r.status, 200);
  // Caching is strictly private even in shadow mode
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  const j = await r.json();
  assert.equal(j.topic, "ana-gametogenesis");
});

test("guard test: all bank paths classified public or gated; no question file is public", () => {
  const samplePaths = [
    // Public paths
    { path: "health", expected: "public" },
    { path: "status", expected: "public" },
    { path: "image-credits.json", expected: "public" },
    { path: "v1/lessons/index.json", expected: "public" },
    { path: "v1/lessons/sur-thyroid.json", expected: "public" },
    { path: "v1/lessons/media/neck-us.webp", expected: "public" },
    { path: "v1/lessons/media/neck-flow.svg", expected: "public" },
    { path: "v1/kb/media/heart-failure-management-fig1.webp", expected: "public" },
    { path: "v1/kb/media/x.png", expected: "gated" },
    { path: "v1/kb/media/../x.webp", expected: "gated" },
    { path: "v1/cards/index.json", expected: "public" },
    { path: "v1/cards/sur-thyroid.json", expected: "public" },

    // Gated MCQ paths (must NEVER be public)
    { path: "v1/anatomy/mcq/ana-gametogenesis.json", expected: "gated" },
    { path: "v1/manifest.json", expected: "gated" },
    { path: "v1/anatomy/index.json", expected: "gated" },
    { path: "v1/anatomy/search.json", expected: "gated" },
    { path: "v1/anatomy/search-0a1b2c3d.json", expected: "gated" },
    { path: "v2/pyq/index.json", expected: "gated" },
    { path: "v2/pyq/items-0a1b2c3d.json", expected: "gated" },
    { path: "v2/pyq/img/neet-pg-2025-r1-1-1.webp", expected: "gated" },
    { path: "v5/img/ana-brachial-plexus-1.webp", expected: "gated" },
    { path: "img/radnotes/rn-n1-p031-2.webp", expected: "gated" },
    { path: "img/maikimg/i-0a1b2c3d.webp", expected: "gated" },
    { path: "overlay/medcov/medicine/med-acs.json", expected: "gated" },
    { path: "overlay/maik1/pathology/pat-cell-injury.json", expected: "gated" },
    { path: "overlay/maik/index.json", expected: "gated" },
    { path: "overlay/maik/manifest-01234567.json", expected: "gated" },
    { path: "v1/ids/index.json", expected: "gated" },
    { path: "v1/ids/00-123456.json", expected: "gated" },
    { path: "v1/links/index.json", expected: "gated" },
    { path: "v1/links/m/ana-gametogenesis-01234567.json", expected: "gated" },
    { path: "quality/index.json", expected: "gated" },
    { path: "quality/v1/anatomy.json", expected: "gated" },
    { path: "v1/tests/index.json", expected: "gated" },
    { path: "v1/tests/anatomy/full/paper1.json", expected: "gated" },
    { path: "v6/ss-radiology/img/rad-moyamoya-pmc1-f1.webp", expected: "gated" },
    { path: "v6/ss-radiology/stack/vs/soft/000.webp", expected: "gated" },
  ];

  for (const { path, expected } of samplePaths) {
    const classification = gate.classifyBankPath(path);
    assert.equal(classification, expected, `Path ${path} should be classified as ${expected}`);
  }
});

test("guard test: gated responses are NEVER Cache-Control public or immutable", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({
      "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"items":[]}',
      "prep-bank/v5/img/ana-brachial-plexus-1.webp": "RIFF",
    }),
  };

  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);

  // Gated JSON module file
  const pathJson = "v1/anatomy/mcq/ana-gametogenesis.json";
  const reqJson = await createSignedRequest(pathJson, "tok-a", sess);
  const resJson = await bank.onRequestGet({ env, params: { path: pathJson.split("/") }, request: reqJson });
  assert.equal(resJson.status, 200);
  const ccJson = resJson.headers.get("Cache-Control") || "";
  assert.match(ccJson, /private/);
  assert.doesNotMatch(ccJson, /public/);
  assert.doesNotMatch(ccJson, /immutable/);

  // Gated image file
  const pathImg = "v5/img/ana-brachial-plexus-1.webp";
  const query = await gate.signImagePath(sess.sessionKey, sess.sessionId, pathImg, 300);
  const reqImg = new Request("https://stewardmd.in/api/prep/bank/" + pathImg + "?" + query);
  const resImg = await bank.onRequestGet({ env, params: { path: pathImg.split("/") }, request: reqImg });
  assert.equal(resImg.status, 200);
  const ccImg = resImg.headers.get("Cache-Control") || "";
  assert.match(ccImg, /private/);
  assert.doesNotMatch(ccImg, /public/);
  assert.doesNotMatch(ccImg, /immutable/);
});

test("client compatibility: prep-bank-client HMAC signature verified by server gate", async () => {
  gate.resetBankGateMemory();
  const client = (await import("../prep-bank-client.js")).default || (await import("../prep-bank-client.js"));
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const path = "v1/anatomy/mcq/ana-gametogenesis.json";
  const ts = Math.floor(Date.now() / 1000);
  const nonce = "nonce-test-123";
  const toSign = `${ts}:${path}:${nonce}`;

  const clientSig = client.hmacSha256Hex(key, toSign);
  const serverSig = await gate.hmacSha256Hex(key, toSign);
  assert.equal(clientSig, serverSig, "Pure JS client HMAC-SHA256 matches subtle crypto server HMAC-SHA256");

  // Verify full request flow with client headers
  const memKv = kv();
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: memKv,
    PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' }),
  };
  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);

  const req = new Request("https://stewardmd.in/api/prep/bank/" + path, {
    method: "GET",
    headers: {
      Origin: "https://stewardmd.in",
      Authorization: "Bearer tok-a",
      "X-SMD-Session": sess.sessionId,
      "X-SMD-Timestamp": String(ts),
      "X-SMD-Nonce": nonce,
      "X-SMD-Signature": client.hmacSha256Hex(sess.sessionKey, toSign),
    },
  });

  const res = await bank.onRequestGet({ env, params: { path: path.split("/") }, request: req });
  assert.equal(res.status, 200);
});

test("guard test: client does not write question files to persistent caches (cachePut)", async () => {
  const fs = await import("node:fs/promises");
  const prepJs = await fs.readFile(new URL("../prep.js", import.meta.url), "utf8");
  const prepPyqJs = await fs.readFile(new URL("../prep-pyq.js", import.meta.url), "utf8");

  // prep.js should not call cachePut on module or overlay question paths
  assert.ok(!prepJs.includes('cachePut(p, { items: items'), "loadBank must not put questions in IDB cache");
  assert.ok(!prepJs.includes('cachePut(p, { sx: sx'), "loadSearchAt must not put search index in IDB cache");
  assert.ok(!prepJs.includes('cachePut(u, { qf: f'), "loadQuality must not put quality sidecar in IDB cache");

  // prep-pyq.js should not put pyq items in IDB cache
  assert.ok(!prepPyqJs.includes('host.cachePut(key, f)'), "prep-pyq.js loadItems must not put items in IDB cache");
  assert.ok(!prepPyqJs.includes('host.cachePut("pyq/index.json"'), "prep-pyq.js loadIndex must not put pyq index in IDB cache");
});


test("gate [KV flag]: billing:cfg flags.PREP_BANK_ENFORCE=1 enforces with no env binding; clearing it returns to shadow", async () => {
  const files = { "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' };
  const url = "https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json";
  const call = (env) => bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: new Request(url, { method: "GET" }) });
  const store = kv();
  store.m.set("billing:cfg", { flags: { PREP_BANK_ENFORCE: "1" }, prices: {} });
  const on = { PREP_BANK_R2: r2(files), MAIK_KV: { get: async (k, t) => store.get(k) } };
  const billing = await import("../functions/_billingcfg.js");
  await billing.setBillingCfg(null, { flags: { PREP_BANK_ENFORCE: "1" } });   // refreshes this isolate's cache like the owner route does
  gate.resetBankGateMemory();
  assert.equal((await call(on)).status, 401, "KV flag on: anonymous read refused");
  await billing.setBillingCfg(null, { flags: { PREP_BANK_ENFORCE: "" } });
  gate.resetBankGateMemory();
  assert.equal((await call({ PREP_BANK_R2: r2(files) })).status, 200, "flag cleared and no env: shadow mode serves");
});

test("gate [ENFORCE=1]: tools credential reads the bank without login; wrong, missing or unset hash is refused", async () => {
  gate.resetBankGateMemory();
  const secret = "tool-secret-0123456789abcdef0123456789";
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const file = { "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}' };
  const mk = (kvStore) => ({ PREP_BANK_ENFORCE: "1", PREP_BANK_R2: r2(file), MAIK_KV: kvStore });
  const get = (env, hdr) => bank.onRequestGet({ env, params: { path: ["v1", "anatomy", "mcq", "ana-gametogenesis.json"] }, request: new Request("https://stewardmd.in/api/prep/bank/v1/anatomy/mcq/ana-gametogenesis.json", { method: "GET", headers: hdr }) });
  const k = kv(); k.m.set("bank:tool-hash", hash);
  const ok = await get(mk(k), { "X-SMD-Tool": secret });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await get(mk(k), { "X-SMD-Tool": secret + "x" })).status, 401);
  assert.equal((await get(mk(k), {})).status, 401);
  assert.equal((await get(mk(kv()), { "X-SMD-Tool": secret })).status, 401, "no hash in KV: the header opens nothing");
  assert.equal((await get({ PREP_BANK_ENFORCE: "1", PREP_BANK_R2: r2(file) }, { "X-SMD-Tool": secret })).status, 401, "no KV: refused");
});

test("gate [ENFORCE=1]: opening a module with 26 overlay sets is ONE open, not 27 files toward the lockouts", async () => {
  gate.resetBankGateMemory();
  const env = { PREP_BANK_ENFORCE: "1", MAIK_KV: kv(), PREP_BANK_R2: r2({}) };
  const user = { id: "fb:u-real" }, now = Date.now();
  // five modules in one minute, each = 1 bank file + 26 overlay files (135 requests): normal reading, must all pass
  for (let m = 0; m < 5; m++) {
    const rl0 = await gate.checkBankRateLimits(env, user, `v5/ss-endocrinology/mcq/mod-${m}.json`, null, now);
    assert.equal(rl0.ok, true);
    for (let s = 0; s < 26; s++) {
      const rl = await gate.checkBankRateLimits(env, user, `overlay/set${s}/ss-endocrinology/mod-${m}.json`, null, now);
      assert.equal(rl.ok, true, "module " + m + " overlay " + s);
    }
  }
  assert.equal(gate.moduleUnitOf("v5/ss-endocrinology/mcq/mod-1.json"), "ss-endocrinology/mod-1");
  assert.equal(gate.moduleUnitOf("overlay/maiknuc3/ss-endocrinology/mod-1.json"), "ss-endocrinology/mod-1");
  assert.equal(gate.moduleUnitOf("v1/anatomy/search.json"), null);
  // enumeration across MANY modules is still caught: the 31st distinct module in a minute flags the account
  const bot = { id: "fb:u-bot" };
  for (let i = 0; i < 30; i++) assert.equal((await gate.checkBankRateLimits(env, bot, `v5/ss-endocrinology/mcq/m-${i}.json`, null, now)).ok, true);
  const denied = await gate.checkBankRateLimits(env, bot, "v5/ss-endocrinology/mcq/m-31.json", null, now);
  assert.equal(denied.code, "enumeration-detected");
  // the same file again does not ride free
  gate.resetBankGateMemory();
  const rep = { id: "fb:u-rep" };
  for (let i = 0; i < 30; i++) assert.equal((await gate.checkBankRateLimits(env, rep, "v5/ss-endocrinology/mcq/same.json", null, now)).ok, true);
  assert.equal((await gate.checkBankRateLimits(env, rep, "v5/ss-endocrinology/mcq/same.json", null, now)).code, "enumeration-detected", "hammering one file still counts");
});

test("KB figure images are public and immutable: an unsigned <img> request is served even with the gate enforced", async () => {
  gate.resetBankGateMemory();
  const env = {
    PREP_BANK_ENFORCE: "1",
    PREP_BANK_R2: r2({ "prep-bank/v1/kb/media/heart-failure-management-fig1.webp": "RIFF" }),
  };
  const route = await import("../functions/api/prep/bank/[[path]].js");
  const res = await route.onRequestGet({
    env,
    params: { path: ["v1", "kb", "media", "heart-failure-management-fig1.webp"] },
    request: new Request("https://stewardmd.in/api/prep/bank/v1/kb/media/heart-failure-management-fig1.webp"),
    waitUntil() {},
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control"), /public.*immutable/);
});
