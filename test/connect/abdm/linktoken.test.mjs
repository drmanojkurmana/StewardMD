// Link tokens (M2). The two limits that bite: three generate-token calls per patient per facility per
// day (a fourth earns a 24-hour block, FAQ Q31) and a six-month validity meant to be cached and reused.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayStamp, getCachedToken, putToken, attemptsToday, claimAttempt, buildGenerateTokenBody,
  ensureLinkToken, MAX_ATTEMPTS_PER_DAY, TOKEN_TTL_SEC, LinkTokenError,
} from "../../../functions/_connect/abdm/linktoken.js";

const HIP = "IN0710000001";
const HASH = "a".repeat(64);
const NOW = "2026-08-18T12:00:00.000Z";

function memKv() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v, opts) => { m.set(k, v); if (opts) m.set(k + "::ttl", opts.expirationTtl); },
  };
}
const deps = (kv, over = {}) => ({ kv, now: () => NOW, ...over });

test("the day window is UTC and matches ABDM's own timestamps", () => {
  assert.equal(dayStamp(() => NOW), "2026-08-18");
  assert.equal(dayStamp(() => "2026-08-18T23:59:59.999Z"), "2026-08-18");
  assert.equal(dayStamp(() => "2026-08-19T00:00:00.000Z"), "2026-08-19");
});

test("the cached TTL is just under six months, with headroom to renew", () => {
  const sixMonths = 180 * 24 * 3600;
  assert.ok(TOKEN_TTL_SEC < sixMonths && TOKEN_TTL_SEC > sixMonths - 14 * 24 * 3600);
});

// ── cache ───────────────────────────────────────────────────────────────────────────────────────────
test("a stored token is returned, and the KV TTL is set from it", async () => {
  const kv = memKv();
  await putToken(deps(kv), { hipId: HIP, abhaHash: HASH, token: "LT-1" });
  assert.equal(await getCachedToken(deps(kv), { hipId: HIP, abhaHash: HASH }), "LT-1");
  assert.equal(kv.m.get("connect:abdm:linktok:" + HIP + ":" + HASH + "::ttl"), TOKEN_TTL_SEC);
});

test("an expired cached token reads as absent, so it is re-requested", async () => {
  const kv = memKv();
  await putToken(deps(kv), { hipId: HIP, abhaHash: HASH, token: "LT-1", ttlSec: 120 });
  const later = deps(kv, { now: () => "2026-08-18T12:10:00.000Z" });   // +10 min
  assert.equal(await getCachedToken(later, { hipId: HIP, abhaHash: HASH }), null);
});

test("tokens are scoped per facility and per patient", async () => {
  const kv = memKv();
  await putToken(deps(kv), { hipId: HIP, abhaHash: HASH, token: "LT-1" });
  assert.equal(await getCachedToken(deps(kv), { hipId: "OTHER", abhaHash: HASH }), null);
  assert.equal(await getCachedToken(deps(kv), { hipId: HIP, abhaHash: "b".repeat(64) }), null);
});

test("an empty token is never cached", async () => {
  await assert.rejects(() => putToken(deps(memKv()), { hipId: HIP, abhaHash: HASH, token: "" }), LinkTokenError);
});

test("corrupt cache contents degrade to a miss rather than throwing", async () => {
  const kv = memKv();
  kv.m.set("connect:abdm:linktok:" + HIP + ":" + HASH, "{not json");
  assert.equal(await getCachedToken(deps(kv), { hipId: HIP, abhaHash: HASH }), null);
});

// ── the daily limit ─────────────────────────────────────────────────────────────────────────────────
test("three attempts are allowed and the fourth is refused locally", async () => {
  const kv = memKv();
  const d = deps(kv);
  for (let i = 1; i <= MAX_ATTEMPTS_PER_DAY; i++) assert.equal(await claimAttempt(d, { hipId: HIP, abhaHash: HASH }), i);
  await assert.rejects(
    () => claimAttempt(d, { hipId: HIP, abhaHash: HASH }),
    (e) => e instanceof LinkTokenError && e.code === "daily_limit" && /24 hours/.test(e.message));
});

test("the counter resets on the next UTC day", async () => {
  const kv = memKv();
  for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) await claimAttempt(deps(kv), { hipId: HIP, abhaHash: HASH });
  const tomorrow = deps(kv, { now: () => "2026-08-19T00:00:01.000Z" });
  assert.equal(await attemptsToday(tomorrow, { hipId: HIP, abhaHash: HASH }), 0);
  assert.equal(await claimAttempt(tomorrow, { hipId: HIP, abhaHash: HASH }), 1);
});

test("the limit is per patient per facility, not global", async () => {
  const kv = memKv();
  const d = deps(kv);
  for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) await claimAttempt(d, { hipId: HIP, abhaHash: HASH });
  assert.equal(await claimAttempt(d, { hipId: HIP, abhaHash: "b".repeat(64) }), 1);   // other patient
  assert.equal(await claimAttempt(d, { hipId: "OTHER", abhaHash: HASH }), 1);         // other facility
});

// ── request body (FAQ Q32) ──────────────────────────────────────────────────────────────────────────
test("the body carries the address, and reports whether the ABHA number was included", () => {
  const withNum = buildGenerateTokenBody({ abhaAddress: "hina@sbx", abhaNumber: "91-1783-8617-6531", name: "Hina", gender: "F", yearOfBirth: 1994 });
  assert.equal(withNum.abhaNumberIncluded, true);
  assert.deepEqual(withNum.body, { abhaAddress: "hina@sbx", abhaNumber: "91178386176531", name: "Hina", gender: "F", yearOfBirth: 1994 });

  const without = buildGenerateTokenBody({ abhaAddress: "hina@sbx" });
  assert.equal(without.abhaNumberIncluded, false);
  assert.equal("abhaNumber" in without.body, false);
});

test("a malformed ABHA number or year is refused, and the address is required", () => {
  assert.throws(() => buildGenerateTokenBody({}), LinkTokenError);
  assert.throws(() => buildGenerateTokenBody({ abhaAddress: "a@sbx", abhaNumber: "123" }), LinkTokenError);
  assert.throws(() => buildGenerateTokenBody({ abhaAddress: "a@sbx", yearOfBirth: 1800 }), LinkTokenError);
  assert.throws(() => buildGenerateTokenBody({ abhaAddress: "a@sbx", yearOfBirth: 2300 }), LinkTokenError);
});

// ── ensureLinkToken ─────────────────────────────────────────────────────────────────────────────────
test("a cache hit returns immediately and spends no attempt and no ABDM call", async () => {
  const kv = memKv();
  await putToken(deps(kv), { hipId: HIP, abhaHash: HASH, token: "LT-CACHED" });
  const calls = [];
  const r = await ensureLinkToken(deps(kv, { gateway: { post: async (k, b) => { calls.push([k, b]); return { status: 202 }; } } }),
    { hipId: HIP, abhaHash: HASH, patient: { abhaAddress: "hina@sbx" } });
  assert.deepEqual(r, { token: "LT-CACHED", pending: false, fromCache: true });
  assert.equal(calls.length, 0);
  assert.equal(await attemptsToday(deps(kv), { hipId: HIP, abhaHash: HASH }), 0);
});

test("a miss calls the gateway once and reports pending, since the token arrives by callback", async () => {
  const kv = memKv();
  const calls = [];
  const d = deps(kv, { gateway: { post: async (k, b) => { calls.push([k, b]); return { status: 202 }; } } });
  const r = await ensureLinkToken(d, { hipId: HIP, abhaHash: HASH, patient: { abhaAddress: "hina@sbx", abhaNumber: "91178386176531" } });
  assert.equal(r.pending, true);
  assert.equal(r.token, null);
  assert.equal(r.abhaNumberIncluded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "tokenGenerate");
  assert.equal(calls[0][1].abhaAddress, "hina@sbx");
  assert.equal(await attemptsToday(d, { hipId: HIP, abhaHash: HASH }), 1);
});

test("once today's attempts are gone, no further ABDM call is made", async () => {
  const kv = memKv();
  const calls = [];
  const d = deps(kv, { gateway: { post: async (k) => { calls.push(k); return { status: 202 }; } } });
  const patient = { abhaAddress: "hina@sbx" };
  for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) await ensureLinkToken(d, { hipId: HIP, abhaHash: HASH, patient });
  assert.equal(calls.length, 3);
  await assert.rejects(() => ensureLinkToken(d, { hipId: HIP, abhaHash: HASH, patient }), (e) => e.code === "daily_limit");
  assert.equal(calls.length, 3, "the blocking fourth call must never be sent");
});

test("no HIP id or no patient pseudonym fails closed with a useful code", async () => {
  const d = deps(memKv(), { gateway: { post: async () => ({ status: 202 }) } });
  await assert.rejects(() => ensureLinkToken(d, { abhaHash: HASH, patient: { abhaAddress: "a@sbx" } }), (e) => e.code === "no_hip_id");
  await assert.rejects(() => ensureLinkToken(d, { hipId: HIP, patient: { abhaAddress: "a@sbx" } }), (e) => e.code === "no_subject");
});

test("the cache key is the pseudonym, never a raw ABHA", async () => {
  const kv = memKv();
  await putToken(deps(kv), { hipId: HIP, abhaHash: HASH, token: "LT-1" });
  for (const k of kv.m.keys()) {
    assert.ok(!/\d{14}/.test(k), "a 14-digit ABHA must never appear in a KV key: " + k);
    assert.ok(!k.includes("@"), "an ABHA address must never appear in a KV key: " + k);
  }
});
