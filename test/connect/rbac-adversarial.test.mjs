// test/connect/rbac-adversarial.test.mjs — DUAL-ADVERSARIAL: actively try to BREAK the RBAC gate.
// Every probe MUST deny. (spec §3.1 "Task 1 DUAL-ADVERSARIAL")
import { test } from "node:test";
import assert from "node:assert/strict";
import { can, ROLE_MATRIX } from "../../functions/_connect/enterprise/rbac.js";
import { requireCan } from "../../functions/_connect/enterprise/guard.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

test("prototype-pollution keys do not authorize", () => {
  assert.equal(can("__proto__", "tenant:read"), false);
  assert.equal(can("constructor", "tenant:read"), false);
  assert.equal(can("toString", "tenant:read"), false);
  assert.equal(can("hasOwnProperty", "context:load"), false);
});

test("case/whitespace variants of a role do not authorize (exact match only)", () => {
  assert.equal(can("Owner", "egress:baa"), false);
  assert.equal(can("OWNER", "egress:baa"), false);
  assert.equal(can("owner ", "egress:baa"), false);
  assert.equal(can(" clinician", "context:load"), false);
  assert.equal(can("clinician\n", "context:load"), false);
});

test("non-string inputs (array/object/number/symbol) deny, never throw-as-allow", () => {
  assert.equal(can(["clinician"], "context:load"), false);
  assert.equal(can("clinician", ["context:load"]), false);
  assert.equal(can({ toString: () => "owner" }, "egress:baa"), false);
  assert.equal(can(0, 0), false);
  assert.equal(can("clinician", { valueOf: () => "context:load" }), false);
});

test("the matrix is frozen — a runtime mutation cannot widen permissions", () => {
  assert.throws(() => { ROLE_MATRIX.clinician.push("egress:baa"); });          // frozen array
  assert.throws(() => { ROLE_MATRIX.hacker = ["tenant:write"]; });             // frozen object
  assert.equal(can("clinician", "egress:baa"), false);
  assert.equal(can("hacker", "tenant:write"), false);
});

test("a body-supplied tenantId the actor is not a member of is refused (IDOR)", async () => {
  // Actor is a clinician of t1 only; asking for t2 must deny at membership, regardless of action.
  const db = makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }, { id: "t2", mode: "sandbox" }], connect_membership: [{ user_id: "u", tenant_id: "t1", role: "clinician" }] });
  await assert.rejects(() => requireCan({ db, identifyFn: async () => ({ id: "u", guest: false }) }, {}, {}, "t2", "context:load"), PermissionError);
});

test("a membership row cannot smuggle an out-of-enum role into an allow", async () => {
  // Even a forged 'superadmin' membership row denies every gated action (deny-by-default on unknown role).
  const db = makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }], connect_membership: [{ user_id: "u", tenant_id: "t1", role: "superadmin" }] });
  await assert.rejects(() => requireCan({ db, identifyFn: async () => ({ id: "u", guest: false }) }, {}, {}, "t1", "tenant:read"), PermissionError);
});
