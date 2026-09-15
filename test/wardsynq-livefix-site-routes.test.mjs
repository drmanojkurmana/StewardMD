/* test/wardsynq-livefix-site-routes.test.mjs - server fixes from the live test of 2026-09-15, through the real routers.
 *
 *   GET /api/queue/ward/actor-names          LT-37 who an audit row's actor id is, for this hospital's admin
 *   GET /api/wardsynq/:tenant/changes?newest=1&before=   LT-37 the audit list newest first (MemoryRepository here;
 *                                            the D1 SQL is executed in test/wardsynq-d1-sql.test.mjs)
 *
 * node --test --experimental-test-module-mocks test/wardsynq-livefix-site-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { H, docs, seedHospital, as, sanitize, idFor, ORG, NURSE, ADMIN, OTHER_DOCTOR, DOCTOR } from "./_wardsynq-alert-harness.mjs";

test("GET /api/queue/ward/actor-names: no session 401; a nurse 403; another hospital 403; nothing written", async () => {
  seedHospital();
  const before = docs.size;
  const q = "/ward/actor-names?orgId=" + ORG + "&ids=" + encodeURIComponent(idFor(NURSE));
  assert.equal((await as(null, q)).__status, 401);
  const nurse = await as(NURSE, q);
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal(nurse.names, undefined, "no names to a role without staff.admin");
  assert.equal((await as(OTHER_DOCTOR, q)).__status, 403, "a member of another hospital");
  assert.equal(docs.size, before, "a read writes nothing");
});

test("GET /api/queue/ward/actor-names: the admin gets staff by email or staff ID and role; a mobile number, an account id or a stranger is never a name", async () => {
  seedHospital();
  const adminKey = `q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`;
  docs.get(adminKey).fields.email = ADMIN;
  docs.set(`q_users/fb-UIDADMIN1`, { fields: { email: ADMIN, smdId: "SMD-X" }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__8897298117`, { fields: { orgId: ORG, identity: "8897298117", role: "doctor", active: true }, updateTime: "t1" });
  const ids = [idFor(ADMIN), "fb:UIDADMIN1", "nurse1", "8897298117", idFor(DOCTOR), "fb:NOBODY", "system:bed-claim", "someone-else"];
  const r = await as(ADMIN, "/ward/actor-names?orgId=" + ORG + "&ids=" + encodeURIComponent(ids.join(",")));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.names[idFor(ADMIN)], { name: ADMIN, role: "admin" }, "an Access sign-in, matched by the hash of the member's email");
  assert.deepEqual(r.names["fb:UIDADMIN1"], { name: ADMIN, role: "admin" }, "a Google account, through its sign-in email");
  assert.deepEqual(r.names.nurse1, { name: "nurse1", role: "nurse" }, "a staff ID the hospital chose");
  assert.deepEqual(r.names["8897298117"], { name: null, role: "doctor" }, "a mobile number is not a name");
  assert.deepEqual(r.names[idFor(DOCTOR)], { name: null, role: "doctor" }, "a member with no email: the role, and no account id as a name");
  assert.deepEqual(r.names["fb:NOBODY"], { name: null, role: null });
  assert.deepEqual(r.names["someone-else"], { name: null, role: null }, "nobody at this hospital is looked up anywhere else");
  assert.deepEqual(r.names["system:bed-claim"], { system: true });
  assert.ok(!JSON.stringify(r).includes("SMD-X"));
});

test("GET /api/wardsynq/:tenant/changes?newest=1 (MemoryRepository changes newest): newest first, paged down with before; the sync feed stays ascending", async () => {
  seedHospital();
  const repo = H.RECORD;
  const T = "tenant-x";
  for (let i = 1; i <= 5; i++) await repo.append(T, [{ resourceType: "Note", id: "n" + i, version: 1, writtenBy: { id: "fb:A", at: "2026-09-1" + i + "T00:00:00.000Z" } }], {});
  const p1 = await repo.changes(T, 0, 2, { newest: true });
  assert.deepEqual(p1.records.map((r) => r.id), ["n5", "n4"]);
  const p2 = await repo.changes(T, 0, 2, { newest: true, before: p1.cursor });
  assert.deepEqual(p2.records.map((r) => r.id), ["n3", "n2"]);
  const p3 = await repo.changes(T, 0, 2, { newest: true, before: p2.cursor });
  assert.deepEqual(p3.records.map((r) => r.id), ["n1"]);
  assert.deepEqual((await repo.changes(T, 0, 2, { newest: true, before: p3.cursor })).records, []);
  assert.deepEqual((await repo.changes(T, 0, 10)).records.map((r) => r.id), ["n1", "n2", "n3", "n4", "n5"], "the sync feed is unchanged");
});
