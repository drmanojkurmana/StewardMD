/* test/opd-scribe-extract-wire.test.mjs — /api/ai/extract kind:"opd-scribe", EXERCISED.
 *
 * Drives the real exported onRequest() with a fake KV, a fake Gemini upstream and a locally-signed
 * Firebase ID token (so the Pro/quota path actually has a uid and the seconds meter really writes).
 * Asserts on the shipped response and on the KV rows, not on the source text:
 *
 *   - the quota meter charges the client's body.sec delta, and a legacy client that sends no `sec`
 *     is charged the safe per-kind floor rather than the old flat 120s
 *   - the grounding result (ungroundedFields) comes back when the model supplies citations
 *   - a truncated model reply still yields the EMR fields, and yields NO grounding signal at all
 *
 * node --test test/opd-scribe-extract-wire.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));

const PROJECT = "stewardmd-test";
const UID = "doctor-uid-1";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const TRANSCRIPT =
  "Doctor: what brings you in. Patient: I have had fever for three days and a cough for two days. " +
  "Doctor: on examination the chest is clear with equal air entry.";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* One RSA key for the whole file: _fbauth.js caches the JWK set module-globally. */
const KEY_ID = "test-kid-1";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const PUB_JWK = Object.assign(await crypto.subtle.exportKey("jwk", pair.publicKey), { kid: KEY_ID, alg: "RS256", use: "sig" });

async function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }));
  const body = b64url(JSON.stringify(Object.assign({
    aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: UID,
    iat: now - 30, exp: now + 3600, pro: true,
  }, claims || {})));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(new Uint8Array(sig));
}

function fakeKv() {
  const m = new Map();
  return {
    _m: m,
    keys: (prefix) => [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)),
    get: async (k, type) => {
      if (!m.has(k)) return null;
      const raw = m.get(k), t = typeof type === "string" ? type : (type && type.type);
      if (t === "json") { try { return JSON.parse(raw); } catch { return null; } }
      return raw;
    },
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async (o) => ({ keys: [...m.keys()].filter((k) => !(o && o.prefix) || k.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

/* `reply` is the raw model text; `finishReason` lets a test say the cap was hit. */
function harness(reply, finishReason) {
  const kv = fakeKv();
  const calls = { gen: 0, maxOutputTokens: null };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.indexOf(JWK_URL) === 0) {
      return new Response(JSON.stringify({ keys: [PUB_JWK] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=3600" } });
    }
    if (u.indexOf("generateContent") >= 0) {
      calls.gen++;
      try { calls.maxOutputTokens = JSON.parse(init.body).generationConfig.maxOutputTokens; } catch { /* not under test */ }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: finishReason || "STOP" }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = {
    AI_PROVIDER: "developer",
    GEMINI_API_KEY: "test-key-not-real",
    FIREBASE_PROJECT_ID: PROJECT,
    VERIFY_REQUIRED_FOR_PRO: "0",
    SCRIBE_CAPS: "1",
    MAIK_KV: kv,
  };
  return { kv, calls, env, restore: () => { globalThis.fetch = realFetch; } };
}

async function extract(h, body) {
  const waits = [];
  const request = new Request("https://stewardmd.in/api/ai/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await idToken()) },
    body: JSON.stringify(Object.assign({ transcript: TRANSCRIPT, kind: "opd-scribe" }, body || {})),
  });
  const res = await onRequest({ request, env: h.env, params: { path: ["extract"] }, waitUntil: (p) => waits.push(p) });
  const text = await res.text();
  await Promise.allSettled(waits);
  let json = null; try { json = JSON.parse(text); } catch { /* surfaced by the assertion */ }
  return { res, text, json };
}

const secondsCharged = async (kv) => {
  const k = kv.keys("aiu:sec:")[0];
  return k ? Number(await kv.get(k)) : 0;
};

const GOOD_REPLY = JSON.stringify({
  en: "I have had fever for three days and a cough for two days. On examination the chest is clear with equal air entry.",
  emrFields: { cc: "Fever x 3 days, cough x 2 days", systemicExam: "Chest clear, equal air entry" },
  sources: {
    cc: "I have had fever for three days and a cough for two days",
    systemicExam: "on examination the chest is clear with equal air entry",
  },
  suggestions: { provisionalDx: "", ddx: ["Viral fever"], investigations: ["CBC"] },
});

/* ── quota accounting ──────────────────────────────────────────────────────────────────────── */

test("the seconds meter charges the client's body.sec delta, not a cadence constant", async () => {
  const h = harness(GOOD_REPLY);
  try {
    await extract(h, { sec: 45 });
    assert.equal(h.calls.gen, 1);
    assert.equal(await secondsCharged(h.kv), 45, "45s of new audio must charge 45s");
    await extract(h, { sec: 45 });
    assert.equal(await secondsCharged(h.kv), 90, "and the next window adds its own 45, never the whole transcript again");
  } finally { h.restore(); }
});

test("a 10-minute consult costs the same quota as it did before the cadence change", async () => {
  const h = harness(GOOD_REPLY);
  try {
    for (let i = 0; i < 14; i++) await extract(h, { sec: 600 / 14 });   // 14 refines over 600s of audio
    assert.equal(Math.round(await secondsCharged(h.kv)), 600, "600s of dictation, 600s of budget");
    // the defect charged 14 x 120 = 1680 of an 1800s daily cap, and the client then stopped the mic.
    assert.ok((await secondsCharged(h.kv)) < 1800 * 0.4);
  } finally { h.restore(); }
});

test("a client that sends no `sec` is safe: the floor, not the old 120s, and never NaN", async () => {
  const h = harness(GOOD_REPLY);
  try {
    await extract(h, {});
    assert.equal(await secondsCharged(h.kv), 45);
    await extract(h, { sec: "not a number" });
    assert.equal(await secondsCharged(h.kv), 90);
    await extract(h, { sec: -5 });
    assert.equal(await secondsCharged(h.kv), 135);
  } finally { h.restore(); }
});

test("one call can never spend more than 300s however large `sec` is", async () => {
  const h = harness(GOOD_REPLY);
  try {
    await extract(h, { sec: 99999 });
    assert.equal(await secondsCharged(h.kv), 300);
  } finally { h.restore(); }
});

test("the daily cap still bites - the meter was made honest, not switched off", async () => {
  const h = harness(GOOD_REPLY);
  h.env.SCRIBE_SEC_DAY = "120";
  try {
    await extract(h, { sec: 130 });
    const blocked = await extract(h, { sec: 45 });
    assert.equal(blocked.res.status, 429);
    assert.equal(blocked.json.reason, "scribe-daily");
  } finally { h.restore(); }
});

/* ── grounding ─────────────────────────────────────────────────────────────────────────────── */

test("the grounding result is RETURNED when the model supplies citations", async () => {
  const h = harness(GOOD_REPLY);
  try {
    const { json } = await extract(h, { sec: 45 });
    assert.equal(json.kind, "opd-scribe");
    assert.equal(json.emrFields.cc, "Fever x 3 days, cough x 2 days");
    assert.deepEqual(json.ungroundedFields, [], "verifySources ran and found every citation in the transcript");
    assert.ok(json.sources && json.sources.cc, "the citation map is still handed to the client");
  } finally { h.restore(); }
});

test("a fabricated citation comes back in ungroundedFields", async () => {
  const bad = JSON.parse(GOOD_REPLY);
  bad.sources.systemicExam = "there is a pansystolic murmur radiating to the axilla";
  const h = harness(JSON.stringify(bad));
  try {
    const { json } = await extract(h, { sec: 45 });
    assert.deepEqual(json.ungroundedFields, ["systemicExam"]);
  } finally { h.restore(); }
});

test("a TRUNCATED reply keeps the EMR fields and returns NO grounding signal", async () => {
  // Pre-fix: parseJsonLoose returned null here and the doctor got an empty note. And had it parsed,
  // the half-written sources map would have badged good fields "not found in the recording".
  const cut = GOOD_REPLY.slice(0, GOOD_REPLY.indexOf('"sources"') + 30);
  const h = harness(cut, "MAX_TOKENS");
  try {
    const { json } = await extract(h, { sec: 45 });
    assert.equal(json.emrFields.cc, "Fever x 3 days, cough x 2 days", "the EMR content survives the cut");
    assert.equal(json.emrFields.systemicExam, "Chest clear, equal air entry");
    assert.equal(json.truncated, true);
    assert.equal(json.sources, undefined, "no half-present citation map");
    assert.equal(json.ungroundedFields, undefined, "and no derived badge list either");
  } finally { h.restore(); }
});

test("the scribe call asks the provider for a scribe-sized output budget", async () => {
  const h = harness(GOOD_REPLY);
  try {
    await extract(h, { sec: 45 });
    assert.equal(h.calls.maxOutputTokens, 6000, "not the 1100 chat budget that was truncating the note");
    h.env.SCRIBE_MAX_OUTPUT_TOKENS = "3000";
    await extract(h, { sec: 45 });
    assert.equal(h.calls.maxOutputTokens, 3000, "and it is tunable without a deploy");
  } finally { h.restore(); }
});

test("SCRIBE_GROUND=0 removes the signal, leaving the extraction intact", async () => {
  const h = harness(GOOD_REPLY);
  h.env.SCRIBE_GROUND = "0";
  try {
    const { json } = await extract(h, { sec: 45 });
    assert.equal(json.emrFields.cc, "Fever x 3 days, cough x 2 days");
    assert.equal(json.sources, undefined);
    assert.equal(json.ungroundedFields, undefined);
  } finally { h.restore(); }
});
