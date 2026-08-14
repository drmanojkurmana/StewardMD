// test/clinic-model.test.mjs — Shared Clinic EMR data model (Phase 1): envelope + change journal +
// versioning + optimistic-concurrency conflict detection. Pure logic, no storage/crypto/network.
// node --test test/clinic-model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const M = require(join(dirname(fileURLToPath(import.meta.url)), "..", "clinic-model.js"));

const CTX = (o = {}) => Object.assign({ now: 1000, deviceId: "devA", userId: "uidA", clinicId: "C1" }, o);

test("create: fresh record at version 1 + a create change (base 0)", () => {
  const { record, change } = M.create(M.ENTITY.PATIENT, { name: "Asha" }, CTX());
  assert.equal(record.entityType, "patient");
  assert.equal(record.version, 1);
  assert.equal(record.deviceId, "devA");
  assert.equal(record.authorUid, "uidA");
  assert.equal(record.clinicId, "C1");
  assert.equal(record.deleted, false);
  assert.deepEqual(record.data, { name: "Asha" });
  assert.equal(change.op, "create");
  assert.equal(change.base, 0);
  assert.equal(change.version, 1);
  assert.equal(change.recordId, record.id);
});

test("edit: bumps version, restamps author/updatedAt, change carries the base version", () => {
  const { record: v1 } = M.create(M.ENTITY.ENCOUNTER, { bp: "120/80" }, CTX());
  const { record: v2, change } = M.edit(v1, { bp: "130/85" }, CTX({ now: 2000, deviceId: "devB", userId: "uidB" }));
  assert.equal(v2.version, 2);
  assert.equal(v2.id, v1.id, "id stable across edits");
  assert.equal(v2.createdAt, 1000, "createdAt preserved");
  assert.equal(v2.updatedAt, 2000);
  assert.equal(v2.deviceId, "devB");
  assert.equal(v2.authorUid, "uidB");
  assert.deepEqual(v2.data, { bp: "130/85" });
  assert.equal(change.op, "update");
  assert.equal(change.base, 1, "change records the version it was made from");
  assert.equal(change.version, 2);
});

test("remove: sets deleted + a delete change, keeps id/history", () => {
  const { record: v1 } = M.create(M.ENTITY.PATIENT, { name: "X" }, CTX());
  const { record: v2, change } = M.remove(v1, CTX({ now: 3000 }));
  assert.equal(v2.deleted, true);
  assert.equal(v2.version, 2);
  assert.equal(v2.id, v1.id);
  assert.equal(change.op, "delete");
  assert.equal(change.base, 1);
});

test("makeId: globally unique across devices (device prefix partitions the space)", () => {
  const a = M.makeId("devA", 1000), b = M.makeId("devB", 1000), c = M.makeId("devA", 1000);
  assert.ok(a.startsWith("devA."), "carries device prefix");
  assert.ok(b.startsWith("devB."));
  assert.notEqual(a, b, "different devices never collide");
  assert.notEqual(a, c, "same device, monotonic seq keeps ids distinct even in the same ms");
});

test("apply: never-seen change -> created", () => {
  const { change } = M.create(M.ENTITY.PATIENT, { name: "New" }, CTX());
  const r = M.apply(null, change);
  assert.equal(r.kind, "created");
  assert.equal(r.record.data.name, "New");
});

test("apply: local still at base -> fast-forward (no conflict)", () => {
  const { record: v1 } = M.create(M.ENTITY.ENCOUNTER, { note: "a" }, CTX());
  // peer edits v1 -> v2 and sends the change; our local is still v1 (== change.base)
  const { change } = M.edit(v1, { note: "b" }, CTX({ now: 2000, deviceId: "devB" }));
  const r = M.apply(v1, change);
  assert.equal(r.kind, "fastforward");
  assert.equal(r.record.version, 2);
  assert.equal(r.record.data.note, "b");
});

test("apply: identical change already applied -> duplicate (no-op)", () => {
  const { record: v1 } = M.create(M.ENTITY.ENCOUNTER, { note: "a" }, CTX());
  const { record: v2, change } = M.edit(v1, { note: "b" }, CTX({ now: 2000, deviceId: "devB" }));
  const r = M.apply(v2, change);   // our local is already exactly v2 from devB
  assert.equal(r.kind, "duplicate");
});

test("apply: incoming behind what we have -> stale (ignored)", () => {
  const { record: v1 } = M.create(M.ENTITY.ENCOUNTER, { note: "a" }, CTX());
  const { change: oldChange } = M.edit(v1, { note: "b" }, CTX({ now: 2000, deviceId: "devB" })); // base 1 -> v2
  const { record: v3 } = M.edit(M.edit(v1, { note: "b" }, CTX({ now: 2000 })).record, { note: "c" }, CTX({ now: 3000 }));
  const r = M.apply(v3, oldChange);   // we're at v3, someone replays the old v2 change
  assert.equal(r.kind, "stale");
});

test("apply: both devices edited from the same base -> CONFLICT, never silent overwrite", () => {
  const { record: v1 } = M.create(M.ENTITY.ENCOUNTER, { dose: "500 mg", note: "same" }, CTX());
  // Device A edits v1 -> v2 locally (dose 500 stays, note changes)
  const { record: aV2 } = M.edit(v1, { dose: "500 mg", note: "A note" }, CTX({ now: 2000, deviceId: "devA", userId: "uidA" }));
  // Device B independently edits the SAME v1 -> its own v2 (dose 450) and syncs the change
  const { change: bChange } = M.edit(v1, { dose: "450 mg", note: "same" }, CTX({ now: 2100, deviceId: "devB", userId: "uidB" }));
  const r = M.apply(aV2, bChange);   // A applies B's change, but A already moved off base 1
  assert.equal(r.kind, "conflict");
  assert.ok(r.fields.includes("dose"), "the clinical field that differs is flagged");
  assert.ok(r.fields.includes("note"));
  assert.equal(r.local.data.dose, "500 mg");
  assert.equal(r.incoming.data.dose, "450 mg");
});

test("diffFields: flags changed, added, and cleared fields; ignores equal", () => {
  const d = M.diffFields({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" });
  assert.ok(d.includes("b"), "changed value flagged");
  assert.ok(d.includes("d"), "field added on the other side flagged");
  assert.ok(d.includes("c"), "field cleared on the other side (3 -> empty) flagged");
  assert.ok(!d.includes("a"), "unchanged field excluded");
});
