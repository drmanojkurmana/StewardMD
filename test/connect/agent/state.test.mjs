// test/connect/agent/state.test.mjs - State machine transitions and authorization for agent broker.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATES,
  SESSION_STATES,
  SESSION_TRANSITIONS,
  SESSION_LIVE,
  JOB_STATES,
  JOB_TRANSITIONS,
  JOB_TERMINAL,
  JOB_LEASABLE,
  JOB_RECLAIMABLE,
  ADAPTER_STATES,
  ADAPTER_TRANSITIONS,
  canTransition,
  assertTransition,
  AGENT_NEEDS,
  AGENT_MATRIX,
  canAgent,
  requireAgent,
  assertOwnership,
  OnboardError,
  PermissionError,
} from "../../../functions/_connect/agent/state.js";
import { makeAgentDb } from "./agent-db.mjs";

test("vocabulary tables and state collections are frozen", () => {
  assert.equal(Object.isFrozen(STATES), true);
  assert.equal(Object.isFrozen(SESSION_STATES), true);
  assert.equal(Object.isFrozen(SESSION_TRANSITIONS), true);
  assert.equal(Object.isFrozen(SESSION_LIVE), true);
  assert.equal(Object.isFrozen(JOB_STATES), true);
  assert.equal(Object.isFrozen(JOB_TRANSITIONS), true);
  assert.equal(Object.isFrozen(JOB_TERMINAL), true);
  assert.equal(Object.isFrozen(JOB_LEASABLE), true);
  assert.equal(Object.isFrozen(JOB_RECLAIMABLE), true);
  assert.equal(Object.isFrozen(ADAPTER_STATES), true);
  assert.equal(Object.isFrozen(ADAPTER_TRANSITIONS), true);
  assert.equal(Object.isFrozen(AGENT_NEEDS), true);
  assert.equal(Object.isFrozen(AGENT_MATRIX), true);

  // Attempting mutation throws
  assert.throws(() => { STATES.push("HACKED"); });
  assert.throws(() => { SESSION_STATES.push("HACKED"); });
  assert.throws(() => { AGENT_MATRIX.clinician.push("activate"); });
});

test("session machine transitions: valid edges succeed, invalid fail-closed", () => {
  // Valid transitions
  assert.equal(canTransition("session", "CREATED", "AWAITING_LOGIN"), true);
  assert.equal(canTransition("session", "CREATED", "CANCELLED"), true);
  assert.equal(canTransition("session", "CREATED", "EXPIRED"), true);
  assert.equal(canTransition("session", "AWAITING_LOGIN", "AUTHENTICATED"), true);
  assert.equal(canTransition("session", "AWAITING_LOGIN", "NEEDS_REAUTH"), true);
  assert.equal(canTransition("session", "AUTHENTICATED", "NEEDS_REAUTH"), true);
  assert.equal(canTransition("session", "NEEDS_REAUTH", "AWAITING_LOGIN"), true);
  assert.equal(canTransition("session", "NEEDS_REAUTH", "AUTHENTICATED"), true);

  // assertTransition returns target state on success
  assert.equal(assertTransition("session", "CREATED", "AWAITING_LOGIN"), "AWAITING_LOGIN");
  assert.equal(assertTransition("session", "AWAITING_LOGIN", "AUTHENTICATED"), "AUTHENTICATED");

  // Invalid transitions
  assert.equal(canTransition("session", "CREATED", "AUTHENTICATED"), false);
  assert.equal(canTransition("session", "CANCELLED", "AWAITING_LOGIN"), false);
  assert.equal(canTransition("session", "EXPIRED", "AUTHENTICATED"), false);
  assert.equal(canTransition("session", "AUTHENTICATED", "CREATED"), false);

  assert.throws(() => assertTransition("session", "CREATED", "AUTHENTICATED"), {
    name: "OnboardError",
    klass: "conflict",
  });
  assert.throws(() => assertTransition("session", "CANCELLED", "CREATED"), {
    name: "OnboardError",
    klass: "conflict",
  });
});

test("job machine transitions: valid stages succeed, invalid jumps fail-closed", () => {
  // Valid progression
  assert.equal(assertTransition("job", "CREATED", "AWAITING_LOGIN"), "AWAITING_LOGIN");
  assert.equal(assertTransition("job", "AWAITING_LOGIN", "AUTHENTICATED"), "AUTHENTICATED");
  assert.equal(assertTransition("job", "AUTHENTICATED", "DISCOVERING"), "DISCOVERING");
  assert.equal(assertTransition("job", "DISCOVERING", "COMPILING"), "COMPILING");
  assert.equal(assertTransition("job", "COMPILING", "VALIDATING"), "VALIDATING");
  assert.equal(assertTransition("job", "VALIDATING", "AWAITING_APPROVAL"), "AWAITING_APPROVAL");
  assert.equal(assertTransition("job", "VALIDATING", "ACTIVE"), "ACTIVE");
  assert.equal(assertTransition("job", "AWAITING_APPROVAL", "ACTIVE"), "ACTIVE");

  // Failure / cancellation / expiry from non-terminal states
  assert.equal(canTransition("job", "CREATED", "CANCELLED"), true);
  assert.equal(canTransition("job", "DISCOVERING", "FAILED"), true);
  assert.equal(canTransition("job", "VALIDATING", "EXPIRED"), true);

  // Terminal states cannot transition
  for (const term of JOB_TERMINAL) {
    for (const st of JOB_STATES) {
      assert.equal(canTransition("job", term, st), false);
    }
  }

  // Illegal jumps
  assert.throws(() => assertTransition("job", "CREATED", "ACTIVE"), {
    name: "OnboardError",
    klass: "conflict",
  });
  assert.throws(() => assertTransition("job", "DISCOVERING", "ACTIVE"), {
    name: "OnboardError",
    klass: "conflict",
  });
  assert.throws(() => assertTransition("job", "ACTIVE", "CREATED"), {
    name: "OnboardError",
    klass: "conflict",
  });
});

test("adapter machine transitions: lifecycle progression and rejection of invalid edges", () => {
  // Valid progression
  assert.equal(assertTransition("adapter", "CREATED", "VALIDATING"), "VALIDATING");
  assert.equal(assertTransition("adapter", "VALIDATING", "AWAITING_APPROVAL"), "AWAITING_APPROVAL");
  assert.equal(assertTransition("adapter", "AWAITING_APPROVAL", "ACTIVE"), "ACTIVE");
  assert.equal(assertTransition("adapter", "ACTIVE", "NEEDS_REPAIR"), "NEEDS_REPAIR");
  assert.equal(assertTransition("adapter", "NEEDS_REPAIR", "VALIDATING"), "VALIDATING");
  assert.equal(assertTransition("adapter", "ACTIVE", "REVOKED"), "REVOKED");

  // Illegal jumps
  assert.throws(() => assertTransition("adapter", "CREATED", "ACTIVE"), {
    name: "OnboardError",
    klass: "conflict",
  });
  assert.throws(() => assertTransition("adapter", "FAILED", "ACTIVE"), {
    name: "OnboardError",
    klass: "conflict",
  });
  assert.throws(() => assertTransition("adapter", "REVOKED", "VALIDATING"), {
    name: "OnboardError",
    klass: "conflict",
  });
});

test("transition guards fail-closed against unknown machines and prototype pollution", () => {
  assert.equal(canTransition("unknown_machine", "CREATED", "ACTIVE"), false);
  assert.equal(canTransition("__proto__", "CREATED", "ACTIVE"), false);
  assert.equal(canTransition("session", "__proto__", "ACTIVE"), false);
  assert.equal(canTransition("session", "toString", "ACTIVE"), false);
  assert.equal(canTransition(123, "CREATED", "ACTIVE"), false);
  assert.equal(canTransition("session", null, "ACTIVE"), false);

  assert.throws(() => assertTransition("unknown_machine", "CREATED", "ACTIVE"), {
    name: "OnboardError",
    klass: "conflict",
  });
});

test("canAgent checks role matrix and denies invalid or out-of-scope roles", () => {
  // Owner and Admin have all agent privileges
  assert.equal(canAgent("owner", "read"), true);
  assert.equal(canAgent("owner", "session"), true);
  assert.equal(canAgent("owner", "activate"), true);

  assert.equal(canAgent("admin", "read"), true);
  assert.equal(canAgent("admin", "session"), true);
  assert.equal(canAgent("admin", "activate"), true);

  // Clinician can onboard and create sessions, but CANNOT activate
  assert.equal(canAgent("clinician", "read"), true);
  assert.equal(canAgent("clinician", "session"), true);
  assert.equal(canAgent("clinician", "activate"), false);

  // Auditor has read-only oversight
  assert.equal(canAgent("auditor", "read"), true);
  assert.equal(canAgent("auditor", "session"), false);
  assert.equal(canAgent("auditor", "activate"), false);

  // Superadmin has all privileges
  assert.equal(canAgent("superadmin", "read"), true);
  assert.equal(canAgent("superadmin", "session"), true);
  assert.equal(canAgent("superadmin", "activate"), true);

  // Unknown role or invalid input
  assert.equal(canAgent("guest", "read"), false);
  assert.equal(canAgent("hacker", "activate"), false);
  assert.equal(canAgent("__proto__", "read"), false);
  assert.equal(canAgent(null, "read"), false);
  assert.equal(canAgent("clinician", "unknown_need"), false);
});

test("requireAgent authorizes valid roles and denies unauthorized ones", async () => {
  const db = makeAgentDb({
    connect_tenant: [
      { id: "tenant-1", mode: "sandbox" },
      { id: "tenant-2", mode: "sandbox" },
    ],
    connect_membership: [
      { user_id: "doc-1", tenant_id: "tenant-1", role: "clinician" },
      { user_id: "admin-1", tenant_id: "tenant-1", role: "admin" },
      { user_id: "auditor-1", tenant_id: "tenant-1", role: "auditor" },
    ],
  });

  const makeReq = (userId) => {
    const identifyFn = async () => ({ id: userId, guest: false });
    const req = new Request("https://example.com/api/test");
    return { deps: { db, identifyFn }, req };
  };

  // Clinician can request "session"
  const { deps: docDeps, req: docReq } = makeReq("doc-1");
  const docRes = await requireAgent(docDeps, docReq, {}, "tenant-1", "session");
  assert.equal(docRes.actor.id, "doc-1");
  assert.equal(docRes.role, "clinician");

  // Clinician CANNOT request "activate" -> PermissionError
  await assert.rejects(
    () => requireAgent(docDeps, docReq, {}, "tenant-1", "activate"),
    PermissionError
  );

  // Admin CAN request "activate"
  const { deps: adminDeps, req: adminReq } = makeReq("admin-1");
  const adminRes = await requireAgent(adminDeps, adminReq, {}, "tenant-1", "activate");
  assert.equal(adminRes.role, "admin");

  // Auditor CANNOT request "session" -> PermissionError
  const { deps: auditDeps, req: auditReq } = makeReq("auditor-1");
  await assert.rejects(
    () => requireAgent(auditDeps, auditReq, {}, "tenant-1", "session"),
    PermissionError
  );

  // Cross-tenant access is rejected
  await assert.rejects(
    () => requireAgent(docDeps, docReq, {}, "tenant-2", "read"),
    PermissionError
  );

  // Guest actor is rejected (AuthError)
  const guestDeps = { db, identifyFn: async () => ({ id: "guest-1", guest: true }) };
  await assert.rejects(
    () => requireAgent(guestDeps, docReq, {}, "tenant-1", "read")
  );
});

test("assertOwnership enforces tenant and actor matching with not-found error", () => {
  const row = { id: "s1", tenant_id: "t1", actor_id: "a1" };

  // Matching row succeeds
  assert.deepEqual(assertOwnership(row, "t1", "a1"), row);

  // Mismatched tenant fails closed with not-found (no IDOR existence leak)
  assert.throws(() => assertOwnership(row, "t2", "a1"), {
    name: "OnboardError",
    klass: "not-found",
  });

  // Mismatched actor fails closed with not-found
  assert.throws(() => assertOwnership(row, "t1", "a2"), {
    name: "OnboardError",
    klass: "not-found",
  });

  // Null or undefined row fails closed
  assert.throws(() => assertOwnership(null, "t1", "a1"), {
    name: "OnboardError",
    klass: "not-found",
  });
});
