// FollowCare AI — server crypto/codec unit tests (Phase 1).
// Verifies the link-token HMAC codec + PHI AES-GCM round-trip using real Web Crypto (node globalThis.crypto).
// These are the security-critical primitives that keep patient links unguessable/revocable and PHI encrypted.
import { test } from "node:test";
import assert from "node:assert";
import { signToken, verifyToken, episodeIdFromToken, encPHI, decPHI, patientKeyHash, currentDueDay, nextScheduled, worstEsc } from "../functions/_followcare.js";

const SECRET = "test-secret-at-least-16-chars-long-xxxxx";
const KEY_B64URL = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"); // 32-byte AES key
const ENV = { FOLLOWCARE_PHI_KEY: KEY_B64URL };
const NOW = Date.UTC(2026, 6, 1, 0, 0, 0);

test("token: sign → verify round-trips for the right secret + ver + unexpired", async () => {
  const t = await signToken({ episodeId: "ep_abc", exp: NOW + 1000, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 1, NOW);
  assert.equal(v.ok, true);
  assert.equal(v.episodeId, "ep_abc");
});

test("token: wrong secret fails", async () => {
  const t = await signToken({ episodeId: "ep_abc", exp: NOW + 1000, ver: 1 }, SECRET);
  assert.equal((await verifyToken(t, "another-secret-16chars-xxxxxxxx", 1, NOW)).ok, false);
});

test("token: revocation — bumping tokenVer invalidates old links", async () => {
  const t = await signToken({ episodeId: "ep_abc", exp: NOW + 1000, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 2, NOW);            // episode now at ver 2
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("token: expiry enforced", async () => {
  const t = await signToken({ episodeId: "ep_abc", exp: NOW - 1, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 1, NOW);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "expired");
  assert.equal(v.episodeId, "ep_abc");   // still parses the id (for a friendly 'link expired' page)
});

test("token: tamper on the body fails signature", async () => {
  const t = await signToken({ episodeId: "ep_abc", exp: NOW + 1000, ver: 1 }, SECRET);
  const tampered = t.replace(/^[^.]+/, Buffer.from("ep_evil." + (NOW + 1000)).toString("base64url"));
  assert.equal((await verifyToken(tampered, SECRET, 1, NOW)).ok, false);
});

test("episodeIdFromToken: structural parse (no signature) still finds the id, safe on garbage", async () => {
  const t = await signToken({ episodeId: "ep_xyz", exp: NOW + 1000, ver: 1 }, SECRET);
  assert.equal(episodeIdFromToken(t), "ep_xyz");
  assert.equal(episodeIdFromToken("garbage"), "");
  assert.equal(episodeIdFromToken(""), "");
});

test("PHI: AES-GCM encrypt → decrypt round-trips; ciphertext is not the plaintext; empty stays empty", async () => {
  const blob = await encPHI(ENV, "+91 98765 43210");
  assert.notEqual(blob, "+91 98765 43210");
  assert.ok(blob.length > 0);
  assert.equal(await decPHI(ENV, blob), "+91 98765 43210");
  assert.equal(await encPHI(ENV, ""), "");
  assert.equal(await decPHI(ENV, ""), "");
});

test("PHI: two encryptions of the same value differ (random IV) but both decrypt", async () => {
  const a = await encPHI(ENV, "Ramesh Kumar"), b = await encPHI(ENV, "Ramesh Kumar");
  assert.notEqual(a, b);
  assert.equal(await decPHI(ENV, a), "Ramesh Kumar");
  assert.equal(await decPHI(ENV, b), "Ramesh Kumar");
});

test("PHI: missing key fails closed (throws) — never stores plaintext", async () => {
  await assert.rejects(() => encPHI({}, "secret-phone"), /phi_key_missing/);
});

// ---- security-review regression tests --------------------------------------------------
const SCHED = [{ dayOffset: 1, dueAtMs: 100 }, { dayOffset: 2, dueAtMs: 200 }, { dayOffset: 3, dueAtMs: 300 }];

test("REVIEW #1: currentDueDay never returns a FUTURE (not-yet-due) day — blocks schedule fast-forward", () => {
  // fresh episode, now=150 → only day 1 is due (day 2/3 dueAt in the future)
  assert.equal(currentDueDay({ schedule: SCHED, lastDayDone: -1 }, 150), 1);
  // day 1 answered, now still 150 → day 2 NOT due yet → nothing due (patient cannot fast-forward)
  assert.equal(currentDueDay({ schedule: SCHED, lastDayDone: 1 }, 150), null);
  // day 1 answered, now=250 → day 2 now legitimately due
  assert.equal(currentDueDay({ schedule: SCHED, lastDayDone: 1 }, 250), 2);
  // all answered → nothing due
  assert.equal(currentDueDay({ schedule: SCHED, lastDayDone: 3 }, 999), null);
  // genuine overdue catch-up: away a long time, days 1+2 both overdue → earliest first
  assert.equal(currentDueDay({ schedule: SCHED, lastDayDone: -1 }, 999), 1);
});

test("REVIEW #1: nextScheduled reports the next unanswered day for the 'opens on…' message", () => {
  assert.equal(nextScheduled({ schedule: SCHED, lastDayDone: 1 }).dayOffset, 2);
  assert.equal(nextScheduled({ schedule: SCHED, lastDayDone: 3 }), null);
});

test("REVIEW #1: worstEsc keeps a prior red visible on the board even after a later green", () => {
  assert.equal(worstEsc("red", "green"), "red");     // a later green must NOT hide an earlier red
  assert.equal(worstEsc("green", "orange"), "orange");
  assert.equal(worstEsc("", "yellow"), "yellow");
  assert.equal(worstEsc("green", "green"), "green");
});

test("patientKeyHash: stable, tenant-scoped, country-code-insensitive, non-reversible", async () => {
  const a = await patientKeyHash("hosp1", "+91 98765-43210");  // 12 digits → last 10
  const b = await patientKeyHash("hosp1", "9876543210");       // bare 10 digits
  const c = await patientKeyHash("hosp2", "9876543210");
  assert.equal(a, b);                 // "+91 …" and the bare number are the SAME patient (no duplicate episodes)
  assert.notEqual(a, c);              // tenant-scoped
  assert.equal(a.length, 64);         // sha-256 hex
  assert.ok(!a.includes("9876"));     // not reversible to the phone
});
