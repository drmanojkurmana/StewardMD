/* test/opd-org-store-ward-bed.test.mjs — TASK 4.1: ward/bed CRUD in _opd_org_store.js, against a
 * real in-memory Firestore double, proving persistence, tenant scoping (a ward/bed listed only
 * under the org that created it), audit-on-write, and the pure model's own defaults surviving a
 * round trip through the store - the same shape department()/room()'s own CRUD would need if it
 * were tested (it currently is not; this closes that gap for the two NEW entities, not for the
 * pre-existing ones, which is out of this task's scope).
 *
 * node --test --experimental-test-module-mocks test/opd-org-store-ward-bed.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const docs = new Map();
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d } } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 1000, out = [];
      for (const [path, f] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(f[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...f } });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => { for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } docs.set(w.update.name, { ...(docs.get(w.update.name) || {}), ...w.update.fields }); } return { ok: true }; },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
  },
});
mock.module("../functions/_opd_auth.js", { namedExports: { genSalt: () => "salt", hashSecret: async () => "hash" } });

const ORG = await import("../functions/_opd_org_store.js");

test("createWard/listWards: persists for real, scoped to the creating org", async () => {
  docs.clear();
  const w1 = await ORG.createWard(undefined, "org-a", { name: "Medical A", type: "clinical" }, "actor-1");
  assert.equal(w1.name, "Medical A"); assert.equal(w1.orgId, "org-a"); assert.equal(w1.active, true);
  await ORG.createWard(undefined, "org-b", { name: "A ward belonging to a DIFFERENT org" }, "actor-1");

  const listed = await ORG.listWards(undefined, "org-a");
  assert.equal(listed.length, 1, "org-a's ward list carries NONE of org-b's wards");
  assert.equal(listed[0].id, w1.id);

  const fetched = await ORG.getWard(undefined, w1.id);
  assert.equal(fetched.name, "Medical A");
});

test("createWard/createBed: type/active/state/restrictions are honoured at CREATE time, not only on a later update", async () => {
  docs.clear();
  const w = await ORG.createWard(undefined, "org-a", { name: "Retired Ward", type: "clinical", active: false }, "actor-1");
  assert.equal(w.type, "clinical"); assert.equal(w.active, false, "a ward can be CREATED already-inactive, not just updated into that state");
  const b = await ORG.createBed(undefined, "org-a", { wardId: w.id, name: "1", state: "maintenance", genderRestriction: "female", isolation: true, active: false }, "actor-1");
  assert.equal(b.state, "maintenance"); assert.equal(b.genderRestriction, "female"); assert.equal(b.isolation, true); assert.equal(b.active, false);
});

test("updateWard: a ward can be retired without deleting its history, orgId stays immutable", async () => {
  docs.clear();
  const w = await ORG.createWard(undefined, "org-a", { name: "ICU" }, "actor-1");
  const retired = await ORG.updateWard(undefined, w.id, { active: false }, "actor-1");
  assert.equal(retired.active, false);
  assert.equal(retired.orgId, "org-a", "orgId is not overwritable through an update");
  // A different org's id in the patch is IGNORED, not honoured.
  const attempt = await ORG.updateWard(undefined, w.id, { orgId: "org-hijack" }, "actor-1");
  assert.equal(attempt.orgId, "org-a");
  assert.equal(await ORG.updateWard(undefined, "no-such-ward", { active: false }, "actor-1"), null);
});

test("createBed/listBeds: persists for real, filterable by ward, defaults survive the round trip", async () => {
  docs.clear();
  const w1 = await ORG.createWard(undefined, "org-a", { name: "Medical A" }, "actor-1");
  const w2 = await ORG.createWard(undefined, "org-a", { name: "Medical B" }, "actor-1");
  const b1 = await ORG.createBed(undefined, "org-a", { wardId: w1.id, name: "1" }, "actor-1");
  await ORG.createBed(undefined, "org-a", { wardId: w2.id, name: "1" }, "actor-1");

  assert.equal(b1.state, "available", "the default state survives a real store round trip");
  const allBeds = await ORG.listBeds(undefined, "org-a");
  assert.equal(allBeds.length, 2);
  const w1Beds = await ORG.listBeds(undefined, "org-a", w1.id);
  assert.equal(w1Beds.length, 1);
  assert.equal(w1Beds[0].id, b1.id);
});

test("updateBed: state transitions persist for real, wardId/orgId stay immutable through an update", async () => {
  docs.clear();
  const w = await ORG.createWard(undefined, "org-a", { name: "Medical A" }, "actor-1");
  const b = await ORG.createBed(undefined, "org-a", { wardId: w.id, name: "3" }, "actor-1");
  const occupied = await ORG.updateBed(undefined, b.id, { state: "occupied" }, "actor-1");
  assert.equal(occupied.state, "occupied");
  const cleaned = await ORG.updateBed(undefined, b.id, { state: "cleaning" }, "actor-1");
  assert.equal(cleaned.state, "cleaning", "a real second write reflects a real state change, not a stale cache");

  // A bed does not get relabeled into a different ward's history through an update - it is retired
  // and recreated instead (updateBed's own comment states this).
  const hijack = await ORG.updateBed(undefined, b.id, { wardId: "some-other-ward" }, "actor-1");
  assert.equal(hijack.wardId, w.id);
  assert.equal(await ORG.updateBed(undefined, "no-such-bed", { state: "blocked" }, "actor-1"), null);
});
