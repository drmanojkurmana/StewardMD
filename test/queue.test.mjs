// test/queue.test.mjs — Smart OPD Queue link-token security (Phase 0).
// A patient link must: round-trip; reject tampering; expire; revoke on ver bump; reject a wrong secret;
// and the env wrappers must honour QUEUE_TOKEN_SECRET with a FOLLOWCARE_TOKEN_SECRET fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, idFromToken, mintTicketToken, verifyTicketToken } from "../functions/_queue.js";

const SECRET = "x".repeat(40);          // >= 32 chars
const now = 1_000_000_000_000;

test("round-trips and returns the ticket id", async () => {
  const t = await signToken({ id: "ticket_abc", exp: now + 3600e3, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 1, now);
  assert.equal(v.ok, true);
  assert.equal(v.id, "ticket_abc");
  assert.equal(idFromToken(t), "ticket_abc");   // structural parse matches the signed id
});

test("rejects a tampered signature", async () => {
  const t = await signToken({ id: "t1", exp: now + 3600e3, ver: 1 }, SECRET);
  const bad = t.slice(0, -1) + (t.slice(-1) === "A" ? "B" : "A");
  const v = await verifyToken(bad, SECRET, 1, now);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("expires after exp", async () => {
  const t = await signToken({ id: "t1", exp: now - 1, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 1, now);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "expired");
});

test("revokes when the ticket ver is bumped", async () => {
  const t = await signToken({ id: "t1", exp: now + 3600e3, ver: 1 }, SECRET);
  const v = await verifyToken(t, SECRET, 2, now);   // ticket revoked -> current ver = 2
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("rejects a wrong secret", async () => {
  const t = await signToken({ id: "t1", exp: now + 3600e3, ver: 1 }, SECRET);
  const v = await verifyToken(t, "y".repeat(40), 1, now);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("malformed token -> malformed", async () => {
  const v = await verifyToken("not-a-token", SECRET, 1, now);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "malformed");
});

test("mint/verify via env, with FOLLOWCARE_TOKEN_SECRET fallback", async () => {
  const exp = Date.now() + 3600e3;                       // verifyTicketToken uses real Date.now()
  const t = await mintTicketToken({ QUEUE_TOKEN_SECRET: SECRET }, "tk_1", exp, 1);
  const v = await verifyTicketToken({ QUEUE_TOKEN_SECRET: SECRET }, t, 1);
  assert.equal(v.ok, true);
  assert.equal(v.id, "tk_1");
  // same secret provided only via the FollowCare fallback verifies the same token
  assert.equal((await verifyTicketToken({ FOLLOWCARE_TOKEN_SECRET: SECRET }, t, 1)).ok, true);
});
