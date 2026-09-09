// test/opd-org.test.mjs — Phase 3 org model + TENANT ISOLATION + room≠doctor + status (pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  org, department, opd, room, membership, thresholds, roomStatus, resolveRoomDoctor,
  isOwnerOfOrg, canAccessOrg, roleInOrg, withinScope, authorizeOrgAccess, ROOM_ASSIGN_MODES,
  normDocId, roomForActor, ward, bed, BED_STATES
} from "../functions/_opd_org.js";

test("org: mode/connector; native default; thresholds normalised", () => {
  const o = org({ id: "org1", name: "GIMSR", mode: "connect", connectorId: "ghis", ownerUid: "u1" });
  assert.equal(o.mode, "connect"); assert.equal(o.connectorId, "ghis"); assert.equal(o.ownerUid, "u1");
  assert.equal(org({ id: "o", mode: "x" }).mode, "native");
  assert.deepEqual(org({ id: "o" }).thresholds, { moderate: 3, busy: 6 });   // defaults
  assert.equal(org({ id: "o", thresholds: { moderate: 5, busy: 2 } }).thresholds.busy, 6); // busy forced > moderate
});

// The third, explicit organisation mode: a hospital where WardSynQ itself is the EMR/HIS. Must survive
// the normalizer as its OWN value - never silently collapsed into "native" (personal clinic, on-device)
// or "connect" (external FHIR EMR), and never produced by anything other than an explicit mode:"wardsynq".
test("org: mode 'wardsynq' is a third, explicit value - never inferred, never collapsed into native/connect", () => {
  assert.equal(org({ id: "o", mode: "wardsynq" }).mode, "wardsynq");
  // Every existing org shape (no mode, or an unrecognised one) still defaults to "native" - adding
  // "wardsynq" must not change the meaning of any pre-existing document.
  assert.equal(org({ id: "o" }).mode, "native");
  assert.equal(org({ id: "o", mode: "x" }).mode, "native");
  assert.equal(org({ id: "o", mode: "connect" }).mode, "connect");
  // connectTenantId is the SAME existing tenant-link field a wardsynq org reuses - not a new one.
  assert.equal(org({ id: "o", mode: "wardsynq", connectTenantId: "t1" }).connectTenantId, "t1");
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

test("TASK 4.1: every organizational unit carries type and active state, additive and backward-compatible", () => {
  // Omitted on every call this file already had - so no existing document changes meaning.
  const d = department({ id: "d1", orgId: "o1", name: "Laboratory" });
  assert.equal(d.type, "general"); assert.equal(d.active, true);
  const withType = department({ id: "d2", orgId: "o1", name: "Radiology", type: "clinical" });
  assert.equal(withType.type, "clinical");
  const retired = department({ id: "d1", orgId: "o1", name: "Laboratory", active: false });
  assert.equal(retired.active, false, "a department once opened can be retired without deleting its history");
  assert.equal(opd({ id: "o", orgId: "o1", name: "General OPD" }).active, true);
  assert.equal(room({ id: "r", orgId: "o1", name: "R1" }).active, true);
});

test("TASK 4.1: ward and bed - Enterprise -> ... -> Ward -> Bed, a ward is a PLACE distinct from a department's SERVICE", () => {
  const w = ward({ id: "w1", orgId: "o1", name: "Medical A", departmentId: "d1" });
  assert.equal(w.name, "Medical A"); assert.equal(w.departmentId, "d1"); assert.equal(w.type, "general"); assert.equal(w.active, true);
  assert.throws(() => ward({ orgId: "o1" }), /id required/);

  const b = bed({ id: "b1", orgId: "o1", wardId: "w1", name: "1" });
  assert.equal(b.state, "available", "a bed defaults to available, never to a state nobody set");
  assert.deepEqual(BED_STATES, ["available", "reserved", "occupied", "blocked", "cleaning", "maintenance"]);
  assert.equal(bed({ id: "b2", orgId: "o1", wardId: "w1", name: "2", state: "not-a-real-state" }).state, "available", "an unrecognised state falls back to available, never to whatever was typed");
  assert.equal(bed({ id: "b3", orgId: "o1", wardId: "w1", name: "3", state: "maintenance" }).state, "maintenance");

  // A stated restriction, never an inferred one.
  assert.equal(bed({ id: "b4", orgId: "o1", wardId: "w1", name: "4" }).genderRestriction, null);
  assert.equal(bed({ id: "b5", orgId: "o1", wardId: "w1", name: "5", genderRestriction: "female" }).genderRestriction, "female");
  assert.equal(bed({ id: "b6", orgId: "o1", wardId: "w1", name: "6", genderRestriction: "not-a-gender" }).genderRestriction, null);
  assert.equal(bed({ id: "b7", orgId: "o1", wardId: "w1", name: "7", isolation: true }).isolation, true);
  assert.throws(() => bed({ orgId: "o1", wardId: "w1" }), /id required/);
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

test("roomForActor: maps a doctor's login to the room the sister routes into (identity mapping)", () => {
  const rooms = [
    { id: "r1", name: "Medicine 1", department: "General", assignment: { mode: "primary", primary: "fb:ownerUID", doctors: ["fb:ownerUID"] } },
    { id: "r2", name: "Gastro", department: "Gastroenterology", assignment: { mode: "primary", primary: "drgastro@clinic.in", doctors: ["drgastro@clinic.in"] } },
    { id: "r3", name: "Cardio", department: "Cardiology", assignment: { mode: "rotating", doctors: ["ghis:502862", "cardio2@x.in"] } },
    { id: "r4", name: "Spare", assignment: { mode: "unassigned", doctors: [], primary: null } },
  ];
  // normalization: fb:/ghis: prefixes + case are stripped for comparison
  assert.equal(normDocId("fb:ABC"), "abc");
  assert.equal(normDocId("ghis:502862"), "502862");
  // owner: assignment "fb:ownerUID" matches an actor whose id is "fb:ownerUID" OR the raw "ownerUID"
  assert.equal(roomForActor(rooms, { id: "fb:ownerUID" }).id, "r1");
  assert.equal(roomForActor(rooms, { id: "ownerUID" }).id, "r1");
  // invited doctor: assigned by EMAIL, matched via the firebase account's email (id is an unrelated uid)
  assert.equal(roomForActor(rooms, { id: "fb:someOtherUid", email: "DrGastro@Clinic.in" }).id, "r2");
  // GHIS employee id matches a rotating-room member ("ghis:502862")
  assert.equal(roomForActor(rooms, { id: "ghis:502862" }).id, "r3");
  // unassigned room is never returned; a doctor with no assignment gets null (app -> room picker)
  assert.equal(roomForActor(rooms, { id: "fb:nobody", email: "nobody@x.in" }), null);
  assert.equal(roomForActor([], { id: "fb:x" }), null);
});
