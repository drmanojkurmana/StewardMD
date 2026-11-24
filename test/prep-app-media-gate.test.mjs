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

test("app/ routes the new pictures and clips, streams a clip, and refuses traversal and the wrong type", async () => {
  gate.resetBankGateMemory();
  const clip = "app/kardia/media/clips/tte-a2c-2.mp4";
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([9, 8, 7]));
      controller.close();
    },
  });
  const files = {
    ["prep-bank/" + clip]: null,
  };
  const typed = {
    "app/surgx/media/acl-reconstruction/04_eua.webp": "image/webp",
    "app/kardia/learn/diagrams/dop_cw.svg": "image/svg+xml",
    "app/tokos/media/ctg/1020.svg": "image/svg+xml",
    "app/tokos/learn/diagrams/gy5-fibroid.svg": "image/svg+xml",
    "app/tokos/learn/media/real/gy5-fibroid.webp": "image/webp",
    "app/ophthalmos/learn/media/photos/sim-amd.webp": "image/webp",
    "app/ophthalmos/learn/diagrams/pg-ted.svg": "image/svg+xml",
    "app/surgx/media/prk/still.png": "image/png",
    "app/surgx/media/prk/still.jpg": "image/jpeg",
    [clip]: "video/mp4",
  };
  for (const p of Object.keys(typed)) if (p !== clip) files["prep-bank/" + p] = "BYTES";
  const bucket = {
    get: async (k) => {
      if (k === "prep-bank/" + clip) {
        return {
          body,
          httpEtag: '"e1"',
          text() { throw new Error("buffered"); },
          arrayBuffer() { throw new Error("buffered"); },
        };
      }
      return k in files && files[k] != null ? { body: files[k], httpEtag: '"e1"' } : null;
    },
  };
  const env = { PREP_BANK_ENFORCE: "0", MAIK_KV: kv(), PREP_BANK_R2: bucket };
  assert.equal((await get(env, clip)).status, 401, "a clip is refused with no signature");
  const sess = await gate.mintBankSession({ id: "fb:u-a" }, env);
  for (const p of Object.keys(typed)) {
    const q = await gate.signImagePath(sess.sessionKey, sess.sessionId, p, 300);
    const r = await get(env, p, new Request("https://stewardmd.in/api/prep/bank/" + p + "?" + q, { headers: { Origin: "https://localhost" } }));
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get("Content-Type"), typed[p], p);
    assert.match(r.headers.get("Cache-Control"), /^private/, p);
    if (p === clip) assert.deepEqual([...(new Uint8Array(await r.arrayBuffer()))], [9, 8, 7]);
  }
  for (const p of [
    "app/surgx/media/lap-cholecystectomy/gif09_cvs.gif",
    "app/surgx/media/manifest.json",
    "app/surgx/media/../secret.webp",
    "app/kardia/media/clips/tte-a2c-2.webp",
    "app/kardia/probelab/assets/media/CinePLAX.mp4",
    "app/tokos/explorer/mechanism/frame.svg",
    "app/tokos/learn/index.json",
    "app/tokos/learn/media/credits.json",
    "app/ophthalmos/learn/media/credits.json",
    "app/prep/lessons/media/x-y.png",
  ]) {
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
