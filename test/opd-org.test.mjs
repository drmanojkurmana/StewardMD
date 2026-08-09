// test/opd-org.test.mjs — Phase 3 org model + TENANT ISOLATION + room≠doctor + status (pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  org, department, opd, room, membership, thresholds, roomStatus, resolveRoomDoctor,
  isOwnerOfOrg, canAccessOrg, roleInOrg, withinScope, authorizeOrgAccess, ROOM_ASSIGN_MODES
} from "../functions/_opd_org.js";

test("org: mode/connector; native default; thresholds normalised", () => {
  const o = org({ id: "org1", name: "GIMSR", mode: "connect", connectorId: "ghis", ownerUid: "u1" });
  assert.equal(o.mode, "connect"); assert.equal(o.connectorId, "ghis"); assert.equal(o.ownerUid, "u1");
  assert.equal(org({ id: "o", mode: "x" }).mode, "native");
  assert.deepEqual(org({ id: "o" }).thresholds, { moderate: 3, busy: 6 });   // defaults
  assert.equal(org({ id: "o", thresholds: { moderate: 5, busy: 2 } }).thresholds.busy, 6); // busy forced > moderate
});

test("roomStatus honours editable thresholds", () => {
  const t = { moderate: 3, busy: 6 };
  assert.equal(roomStatus(0, false, t), "normal");
  assert.equal(roomStatus(2, false, t), "normal");
  assert.equal(roomStatus(3, false, t), "moderate");
  assert.equal(roomStatus(6, false, t), "busy");
  assert.equal(roomStatus(1, true, t), "moderate");        // consulting with a queue -> at least moderate
  assert.equal(roomStatus(2, false, { moderate: 2, busy: 4 }), "moderate"); // custom thresholds
});

test("room is NOT one doctor: primary / multiple / rotating / unassigned", () => {
  assert.deepEqual([...ROOM_ASSIGN_MODES].sort(), ["multiple", "primary", "rotating", "unassigned"]);
  assert.equal(resolveRoomDoctor(room({ id: "r", orgId: "o", assignment: { mode: "primary", primary: "dA", doctors: ["dA", "dB"] } })), "dA");
  assert.equal(resolveRoomDoctor(room({ id: "r", orgId: "o", assignment: { mode: "multiple", doctors: ["dX", "dY"] } })), "dX"); // first when no primary
  assert.equal(resolveRoomDoctor(room({ id: "r", orgId: "o", assignment: { mode: "unassigned", doctors: ["dA"] } })), null);
  const rot = room({ id: "r", orgId: "o", assignment: { mode: "rotating", doctors: ["d1", "d2", "d3"] } });
  assert.equal(resolveRoomDoctor(rot, { rotationIndex: 0 }), "d1");
  assert.equal(resolveRoomDoctor(rot, { rotationIndex: 4 }), "d2");   // 4 % 3 = 1
  assert.equal(room({ id: "r", orgId: "o" }).assignment.mode, "unassigned"); // default
});

test("hierarchy is optional: room needs orgId; dept/opd may be absent (simple clinic)", () => {
  const r = room({ id: "r1", orgId: "o1", name: "Consulting Room" });
  assert.equal(r.orgId, "o1"); assert.equal(r.departmentId, null); assert.equal(r.opdId, null);
  assert.equal(opd({ id: "opd1", orgId: "o1", name: "General OPD" }).departmentId, null);
  assert.equal(department({ id: "d1", orgId: "o1", name: "Cardiology", code: "CARD" }).code, "CARD");
  assert.throws(() => room({ orgId: "o1" }), /id required/);
});

test("TENANT ISOLATION: a membership can act ONLY in its own org", () => {
  const m = membership({ id: "org1__u1", orgId: "org1", identity: "u1", role: "nurse" });
  assert.equal(canAccessOrg(m, "org1"), true);
  assert.equal(canAccessOrg(m, "org2"), false);              // cross-org denied
  assert.equal(canAccessOrg(membership({ id: "x", orgId: "org1", identity: "u", active: false }), "org1"), false); // inactive denied
  assert.equal(roleInOrg(m, "org1"), "nurse");
  assert.equal(roleInOrg(m, "org2"), null);
  assert.equal(isOwnerOfOrg({ ownerUid: "u1" }, "u1"), true);
  assert.equal(isOwnerOfOrg({ ownerUid: "u1" }, "u2"), false);
});

test("membership scope: room/dept scoping restricts; empty scope = whole-org (central nurse)", () => {
  const nurse = membership({ id: "m1", orgId: "o", identity: "n", role: "nurse" });             // no scope -> org-wide
  assert.equal(withinScope(nurse, { roomId: "r9" }), true);
  const deskA = membership({ id: "m2", orgId: "o", identity: "d", role: "reception", scope: { departments: ["cardio"] } });
  assert.equal(withinScope(deskA, { departmentId: "cardio" }), true);
  assert.equal(withinScope(deskA, { departmentId: "neuro" }), false);                            // out of scope
  const roomOnly = membership({ id: "m3", orgId: "o", identity: "x", role: "intern", scope: { rooms: ["r1"] } });
  assert.equal(withinScope(roomOnly, { roomId: "r1" }), true);
  assert.equal(withinScope(roomOnly, { roomId: "r2" }), false);
  assert.equal(withinScope(roomOnly, { departmentId: "anything" }), true);  // no room named in target -> not restricted by rooms
});

test("membership: bogus role -> viewer; identity/role carried", () => {
  assert.equal(membership({ id: "m", orgId: "o", identity: "u", role: "wizard" }).role, "viewer");
  assert.equal(membership({ id: "m", orgId: "o", identity: "u", role: "doctor" }).role, "doctor");
});

test("authorizeOrgAccess: owner bypass, cross-org denial, capability + scope boundaries", () => {
  const orgDoc = { id: "org1", ownerUid: "owner1" };
  const nurse = membership({ id: "org1__n", orgId: "org1", identity: "n", role: "nurse" });
  // owner -> full admin over their org, no membership needed
  assert.deepEqual(authorizeOrgAccess(orgDoc, null, "owner1", "org1", "staff.admin"), { ok: true, role: "admin", owner: true });
  // CROSS-ORG: a member of org1 cannot act in org2 (org doc mismatch, and membership mismatch)
  assert.equal(authorizeOrgAccess({ id: "org2", ownerUid: "z" }, nurse, "n", "org1").ok, false); // org doc != orgId
  assert.equal(authorizeOrgAccess(orgDoc, membership({ id: "x", orgId: "org2", identity: "n", role: "admin" }), "n", "org1").reason, "not_a_member");
  // capability boundary: a nurse cannot manage staff
  assert.equal(authorizeOrgAccess(orgDoc, nurse, "n", "org1", "staff.admin").reason, "forbidden");
  assert.equal(authorizeOrgAccess(orgDoc, nurse, "n", "org1", "queue.reorder").ok, true);
  // scope boundary: a room-scoped intern only within its room
  const intern = membership({ id: "m", orgId: "org1", identity: "i", role: "intern", scope: { rooms: ["r1"] } });
  assert.equal(authorizeOrgAccess(orgDoc, intern, "i", "org1", "queue.view", { roomId: "r2" }).reason, "out_of_scope");
  assert.equal(authorizeOrgAccess(orgDoc, intern, "i", "org1", "queue.view", { roomId: "r1" }).ok, true);
  // missing/mismatched org
  assert.equal(authorizeOrgAccess(null, nurse, "n", "org1").reason, "org_not_found");
});

test("hardening: revoked/disabled staff denied; unmapped identity denied (no 502862-style bootstrap)", () => {
  const orgDoc = { id: "org1", ownerUid: "owner1" };
  // A disabled membership is blocked immediately (revocation is effective at the authz gate).
  const disabled = membership({ id: "m", orgId: "org1", identity: "n", role: "nurse", active: false });
  assert.equal(authorizeOrgAccess(orgDoc, disabled, "n", "org1", "queue.reorder").reason, "not_a_member");
  // An identity with NO membership gets NOTHING — there is no hard-coded id that grants admin.
  assert.equal(authorizeOrgAccess(orgDoc, null, "ghis:502862", "org1", "queue.view").reason, "not_a_member");
  assert.equal(authorizeOrgAccess(orgDoc, null, "ghis:502862", "org1", "staff.admin").reason, "not_a_member");
  // Only the real owner is admin — by ownerUid, never by an employee id.
  assert.equal(authorizeOrgAccess(orgDoc, null, "owner1", "org1", "staff.admin").ok, true);
});
