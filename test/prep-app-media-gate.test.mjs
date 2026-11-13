/* Learning content served from R2 on first view, signed-in only (owner 2026-11-12).
 *  - app/<bundle path> (moved out of the app: lesson files, lesson diagrams, CliniX photos) is ALWAYS enforced, even
 *    while PREP_BANK_ENFORCE is off, because no older app build reaches it without proof.
 *  - v<n>/lessons/<key>.json and v<n>/lessons/media/* stay public until PREP_LESSONS_GATED=1 (app builds already on
 *    phones fetch them without proof), then need a signed-in user; the lesson list (lessons/index.json) stays public.
 *   node --test --experimental-test-module-mocks test/prep-app-media-gate.test.mjs */
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

const FILES = {
  "prep-bank/app/clinix/media/practicals/obg-ins-veress-needle.webp": "WEBP",
  "prep-bank/app/prep/lessons/v1/ana-brachial-plexus.json": '{"v":1}',
  "prep-bank/v1/lessons/ana-axilla.json": '{"v":1}',
  "prep-bank/v1/lessons/media/neck-us.webp": "WEBP",
  "prep-bank/v1/lessons/index.json": '{"v":1,"modules":{}}',
};
const get = (env, p, request) => bank.onRequestGet({ env, params: { path: p.split("/") }, request: request || new Request("https://stewardmd.in/api/prep/bank/" + p, { headers: { Origin: "https://stewardmd.in" } }) });

test("app/ content: refused without sign-in even with PREP_BANK_ENFORCE off", async () => {
  gate.resetBankGateMemory();
  const env = { PREP_BANK_ENFORCE: "0", PREP_BANK_R2: r2(FILES) };
  assert.equal((await get(env, "app/clinix/media/practicals/obg-ins-veress-needle.webp")).status, 401);
  assert.equal((await get(env, "app/prep/lessons/v1/ana-brachial-plexus.json")).status, 401);
});

test("app/ content: a signed-in picture URL and a signed-in lesson request are served, privately", async () => {
  gate.resetBankGateMemory();
  const env = { PREP_BANK_ENFORCE: "0", MAIK_KV: kv(), PREP_BANK_R2: r2(FILES) };
  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const img = "app/clinix/media/practicals/obg-ins-veress-needle.webp";
  const q = await gate.signImagePath(sess.sessionKey, sess.sessionId, img, 300);
  const r1 = await get(env, img, new Request("https://stewardmd.in/api/prep/bank/" + img + "?" + q, { headers: { Origin: "https://localhost" } }));
  assert.equal(r1.status, 200);
  assert.match(r1.headers.get("Cache-Control"), /^private/);
  assert.equal(r1.headers.get("Access-Control-Allow-Origin"), "https://localhost", "the app's WebView fetch can read the bytes");
  const les = "app/prep/lessons/v1/ana-brachial-plexus.json";
  const r2r = await get(env, les, await createSignedRequest(les, "tok-a", sess));
  assert.equal(r2r.status, 200);
  assert.equal(r2r.headers.get("Cache-Control"), "private, no-store");
});

test("app/ content: a forged picture signature is refused", async () => {
  gate.resetBankGateMemory();
  const env = { PREP_BANK_ENFORCE: "0", MAIK_KV: kv(), PREP_BANK_R2: r2(FILES) };
  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  const img = "app/clinix/media/practicals/obg-ins-veress-needle.webp";
  const r = await get(env, img, new Request(`https://stewardmd.in/api/prep/bank/${img}?s=${encodeURIComponent(sess.sessionId)}&exp=${Math.floor(Date.now() / 1000) + 200}&sig=deadbeef`, { headers: { Origin: "https://localhost" } }));
  assert.equal(r.status, 401);
});

test("app/ routes only the moved content: other names and traversal are 404", async () => {
  gate.resetBankGateMemory();
  const env = { PREP_BANK_R2: r2(FILES) };
  for (const p of ["app/secret.json", "app/clinix/media/other/x-y.webp", "app/prep/lessons/v1/index.json.bak", "app/prep/lessons/media/x-y.png"]) {
    assert.equal((await get(env, p)).status, 404, p);
  }
});

test("lessons: public until PREP_LESSONS_GATED=1, then signed-in only; the lesson list stays public", async () => {
  gate.resetBankGateMemory();
  const open = { PREP_BANK_ENFORCE: "1", PREP_BANK_R2: r2(FILES) };
  assert.equal((await get(open, "v1/lessons/ana-axilla.json")).status, 200);
  assert.equal((await get(open, "v1/lessons/media/neck-us.webp")).status, 200);
  const gated = { PREP_BANK_ENFORCE: "0", PREP_LESSONS_GATED: "1", MAIK_KV: kv(), PREP_BANK_R2: r2(FILES) };
  assert.equal((await get(gated, "v1/lessons/ana-axilla.json")).status, 401, "enforced even with PREP_BANK_ENFORCE off");
  assert.equal((await get(gated, "v1/lessons/media/neck-us.webp")).status, 401);
  const li = await get(gated, "v1/lessons/index.json");
  assert.equal(li.status, 200);
  assert.match(li.headers.get("Cache-Control"), /^public/);
  const sess = await gate.mintBankSession({ id: "fb:u-a" }, gated);
  const ok = await get(gated, "v1/lessons/ana-axilla.json", await createSignedRequest("v1/lessons/ana-axilla.json", "tok-a", sess));
  assert.equal(ok.status, 200);
});
