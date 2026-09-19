// test/connect/agent/viewer-token.test.mjs - Short-lived, actor-bound, single-use viewer token tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIEWER_TOKEN_PREFIX,
  VIEWER_TOKEN_TTL_MS,
  VIEWER_TOKEN_MAX_TTL_MS,
  issueViewerToken,
  redeemViewerToken,
} from "../../../functions/_connect/agent/viewer-token.js";
import { revokeSessionViewerTokens } from "../../../functions/_connect/agent/store.js";
import { b64urlUtf8, utf8b64url } from "../../../functions/_connect/agent/hmac.js";
import { makeAgentDb } from "./agent-db.mjs";

const TOKEN_KEY = "test-agent-token-signing-key-secret";
const ENV = { CONNECT_AGENT_TOKEN_KEY: TOKEN_KEY };

test("token key missing fails closed", async () => {
  const db = makeAgentDb();
  const session = { id: "s1", tenant_id: "t1", expires_at: Date.now() + 60000 };
  const deps = { db, now: () => Date.now() };

  await assert.rejects(
    () => issueViewerToken(deps, {}, { session, actorId: "doc-1" }),
    { name: "OnboardError", klass: "not-configured" }
  );

  await assert.rejects(
    () => redeemViewerToken(deps, {}, "smdvt1.fake.fake"),
    { name: "OnboardError", klass: "not-configured" }
  );
});

test("issueViewerToken produces safe JSON payload and never leaks into a URL", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const issued = await issueViewerToken(deps, ENV, {
    session,
    actorId: "doc-specialist-1",
    now: nowMs,
  });

  // Returned as structured object for header or response body, not a URL
  assert.equal(typeof issued, "object");
  assert.equal(typeof issued.token, "string");
  assert.equal(typeof issued.expiresAt, "number");
  assert.match(issued.jti, /^vt_/);

  // Does NOT contain URL scheme or path
  assert.doesNotMatch(issued.token, /^https?:/);
  assert.doesNotMatch(issued.token, /[/?#&=]/);

  // Token structure: prefix.body.sig
  const parts = issued.token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], VIEWER_TOKEN_PREFIX);

  // Payload content verification
  const payload = JSON.parse(b64urlUtf8(parts[1]));
  assert.equal(payload.jti, issued.jti);
  assert.equal(payload.sid, "session-1");
  assert.equal(payload.tid, "tenant-1");
  // Actor ID is hashed, never cleartext
  assert.notEqual(payload.aid, "doc-specialist-1");
  assert.match(payload.aid, /^[0-9a-f]{32}$/);
  assert.equal(payload.exp, nowMs + VIEWER_TOKEN_TTL_MS);

  // No secrets or cookies in payload
  assert.equal("cookie" in payload, false);
  assert.equal("password" in payload, false);
  assert.equal("runnerRef" in payload, false);
});

test("TTL bounds: respects default, caps at max, and never outlives session", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  // 1. Default TTL is 120s
  const s1 = { id: "s1", tenant_id: "t1", expires_at: nowMs + 1000000 };
  const t1 = await issueViewerToken(deps, ENV, { session: s1, actorId: "doc-1", now: nowMs });
  assert.equal(t1.expiresAt, nowMs + VIEWER_TOKEN_TTL_MS);

  // 2. TTL capped at MAX_TTL (10 minutes)
  const t2 = await issueViewerToken(deps, ENV, { session: s1, actorId: "doc-1", ttlMs: 999999999, now: nowMs });
  assert.equal(t2.expiresAt, nowMs + VIEWER_TOKEN_MAX_TTL_MS);

  // 3. Clamped by session expiry when session expires before TTL
  const sShort = { id: "s2", tenant_id: "t1", expires_at: nowMs + 45000 }; // 45s left
  const t3 = await issueViewerToken(deps, ENV, { session: sShort, actorId: "doc-1", now: nowMs });
  assert.equal(t3.expiresAt, nowMs + 45000);

  // 4. Already expired session throws expired error
  const sExpired = { id: "s3", tenant_id: "t1", expires_at: nowMs - 1 };
  await assert.rejects(
    () => issueViewerToken(deps, ENV, { session: sExpired, actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "expired" }
  );
});

test("single-use invariant: token cannot be redeemed twice", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const { token } = await issueViewerToken(deps, ENV, { session, actorId: "doc-1", now: nowMs });

  // First redemption succeeds
  const redeemed = await redeemViewerToken(deps, ENV, token, { actorId: "doc-1", now: nowMs + 1000 });
  assert.equal(redeemed.sessionId, "session-1");
  assert.equal(redeemed.tenantId, "tenant-1");
  assert.equal(redeemed.actorId, "doc-1");

  // Second redemption of the SAME token fails with conflict
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, token, { actorId: "doc-1", now: nowMs + 2000 }),
    { name: "OnboardError", klass: "conflict" }
  );
});

test("actor-bound invariant: token cannot be redeemed by another actor", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const { token } = await issueViewerToken(deps, ENV, { session, actorId: "doc-1", now: nowMs });

  // Different actor attempts redemption -> forbidden
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, token, { actorId: "doc-intruder", now: nowMs + 1000 }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // Original actor can still redeem (not burned by failed intruder attempt)
  const redeemed = await redeemViewerToken(deps, ENV, token, { actorId: "doc-1", now: nowMs + 2000 });
  assert.equal(redeemed.actorId, "doc-1");
});

test("tamper detection: modified payload, altered signature or wrong key fails", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const { token } = await issueViewerToken(deps, ENV, { session, actorId: "doc-1", now: nowMs });
  const parts = token.split(".");

  // 1. Tampered payload
  const payload = JSON.parse(b64urlUtf8(parts[1]));
  payload.sid = "session-hijacked";
  const tamperedToken = parts[0] + "." + utf8b64url(JSON.stringify(payload)) + "." + parts[2];
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, tamperedToken, { actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // 2. Tampered signature
  const badSigToken = parts[0] + "." + parts[1] + "." + parts[2].slice(0, -2) + "00";
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, badSigToken, { actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // 3. Wrong key
  await assert.rejects(
    () => redeemViewerToken(deps, { CONNECT_AGENT_TOKEN_KEY: "wrong-key" }, token, { actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // 4. Malformed tokens
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, "not-a-token", { actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, "otherprefix." + parts[1] + "." + parts[2], { actorId: "doc-1", now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );
});

test("expired viewer token cannot be redeemed", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const { token, expiresAt } = await issueViewerToken(deps, ENV, { session, actorId: "doc-1", now: nowMs });

  // At or past expiry -> expired error
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, token, { actorId: "doc-1", now: expiresAt + 1 }),
    { name: "OnboardError", klass: "expired" }
  );
});

test("revocation marks all viewer tokens for session and rejects redemption", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };
  const session = { id: "session-1", tenant_id: "tenant-1", expires_at: nowMs + 3600000 };

  const { token } = await issueViewerToken(deps, ENV, { session, actorId: "doc-1", now: nowMs });

  // Revoke all tokens for the session (e.g. session cancellation or doctor logout)
  await revokeSessionViewerTokens(db, "session-1", nowMs + 1000);

  // Redemption fails closed with forbidden
  await assert.rejects(
    () => redeemViewerToken(deps, ENV, token, { actorId: "doc-1", now: nowMs + 2000 }),
    { name: "OnboardError", klass: "forbidden" }
  );
});
