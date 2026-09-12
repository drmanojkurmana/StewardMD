import { test, mock } from "node:test";
import assert from "node:assert/strict";

/* One mock for the file: the actor and the record store are swapped through these. */
let writeScope = null;
let store = new Map();
let puts = [];
let putThrows = null;

mock.module(new URL("../functions/_wardsynq/actor.js", import.meta.url).href, {
  namedExports: {
    resolveClinicalActor: async () => ({
      actor: { id: "dr.a@x.test", scope: { write: writeScope, read: null } },
      tenant: {}, role: "doctor", source: "opd",
    }),
  },
});
mock.module(new URL("../functions/_wardsynq/service.js", import.meta.url).href, {
  namedExports: {
    RecordService: class {
      async get(type, id) { return store.get(type + ":" + id) || null; }
      async byPatient(type, patientId) {
        return [...store.values()].filter((r) => r.resourceType === type && r.patientId === patientId);
      }
      async put(rec, opts) {
        if (putThrows) throw putThrows;
        puts.push({ rec, opts });
        const version = (rec.version || 0) + 1;
        store.set(rec.resourceType + ":" + rec.id, { ...rec, version });
        return { record: { version } };
      }
    },
  },
});

const M = await import("../functions/_wardsynq/patient-identity.js");

const CTX = { migration: { mode: "native", tenantId: "t1" }, recordDeps: {}, actorDeps: {} };
function reset() {
  writeScope = null; store = new Map(); puts = []; putThrows = null;
  store.set("Patient:p1", { resourceType: "Patient", id: "p1", name: "Ramesh", mrn: "M1", version: 3 });
}

/* ---- deceased ------------------------------------------------------------------------------- */

test("a death is not recorded without an explicit confirmation", async () => {
  reset();
  const r = await M.recordDeath({}, {}, { ...CTX, patientId: "p1", at: "2026-09-12T10:00:00.000Z" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "confirmation_required");
  assert.equal(puts.length, 0, "nothing may be written without confirmation");
});

test("a confirmed death becomes a new version of the patient, deleting nothing", async () => {
  reset();
  const r = await M.recordDeath({}, {}, {
    ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T12:00:00.000Z",
    deceased: { at: "2026-09-12T10:00:00.000Z", cause: "Septic shock", certifiedBy: "Dr Rao" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.deceased.at, "2026-09-12T10:00:00.000Z");
  assert.equal(r.deceased.cause, "Septic shock");
  assert.equal(r.deceased.certifiedBy, "Dr Rao");
  // Who typed it is captured separately and cannot be supplied by the caller.
  assert.equal(r.deceased.recordedBy, "dr.a@x.test");
  // The write is version-checked, and the rest of the patient survives.
  assert.equal(puts[0].opts.expectedVersion, 3);
  assert.equal(puts[0].rec.name, "Ramesh");
  assert.equal(puts[0].rec.mrn, "M1");
});

test("a death in the future is refused, not quietly clamped to now", async () => {
  reset();
  const r = await M.recordDeath({}, {}, {
    ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T10:00:00.000Z",
    deceased: { at: "2027-01-01T00:00:00.000Z" },
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "death_in_the_future");
  assert.equal(puts.length, 0);
});

test("recording a death twice is refused rather than overwriting the first", async () => {
  reset();
  await M.recordDeath({}, {}, { ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T10:00:00.000Z" });
  const again = await M.recordDeath({}, {}, { ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T11:00:00.000Z" });
  assert.equal(again.ok, false);
  assert.equal(again.error, "already_recorded");
  assert.ok(again.deceased, "the existing entry is shown rather than replaced");
});

test("withdrawing a death keeps what was withdrawn, and needs a reason", async () => {
  reset();
  await M.recordDeath({}, {}, { ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T10:00:00.000Z" });

  const noReason = await M.correctDeath({}, {}, { ...CTX, patientId: "p1" });
  assert.equal(noReason.error, "reason_required");

  const done = await M.correctDeath({}, {}, { ...CTX, patientId: "p1", reason: "wrong patient selected", now: "2026-09-12T13:00:00.000Z" });
  assert.equal(done.ok, true);
  const saved = store.get("Patient:p1");
  assert.equal(saved.deceased, null, "the patient is no longer marked deceased");
  // The thing that was withdrawn is kept, with who withdrew it and why.
  assert.equal(saved.deceasedCorrection.reason, "wrong patient selected");
  assert.equal(saved.deceasedCorrection.by, "dr.a@x.test");
  assert.ok(saved.deceasedCorrection.withdrew, "what was withdrawn must stay readable");
});

test("a death cannot be withdrawn when none was recorded", async () => {
  reset();
  const r = await M.correctDeath({}, {}, { ...CTX, patientId: "p1", reason: "x" });
  assert.equal(r.error, "not_recorded_deceased");
});

/* ---- contacts ------------------------------------------------------------------------------- */

const PERSON = { name: "Sita Kumar", relationship: "spouse", phone: "9876543210", nextOfKin: true };

test("a contact is recorded with who to ring and what they are", async () => {
  reset();
  const r = await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", person: PERSON, at: "2026-09-12T10:00:00.000Z" });
  assert.equal(r.ok, true);
  assert.equal(r.person.name, "Sita Kumar");
  assert.equal(r.person.relationship, "spouse");
  assert.equal(r.person.nextOfKin, true);
  assert.equal(r.person.active, true);
  assert.equal(r.person.recordedBy, "dr.a@x.test");
});

test("a next of kin without a telephone number is refused - it is the name somebody rings", async () => {
  reset();
  const r = await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", person: { ...PERSON, phone: "" } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "phone_required");
});

test("a contact that is neither kin, guardian nor emergency contact is refused", async () => {
  reset();
  const r = await M.addRelatedPerson({}, {}, {
    ...CTX, patientId: "p1", person: { name: "A", relationship: "friend", phone: "1", nextOfKin: false },
  });
  assert.equal(r.error, "role_required");
});

test("one person can be kin, guardian and emergency contact at once", async () => {
  reset();
  const r = await M.addRelatedPerson({}, {}, {
    ...CTX, patientId: "p1",
    person: { name: "Sita", relationship: "spouse", phone: "9", nextOfKin: true, guardian: true, emergencyContact: true },
  });
  assert.equal(r.ok, true);
  assert.equal(r.person.nextOfKin, true);
  assert.equal(r.person.guardian, true);
  assert.equal(r.person.emergencyContact, true);
});

test("a relationship nobody recognises is refused rather than stored as typed", async () => {
  reset();
  const r = await M.addRelatedPerson({}, {}, {
    ...CTX, patientId: "p1", person: { name: "A", relationship: "cousin-in-law", phone: "1", nextOfKin: true },
  });
  assert.equal(r.error, "unknown_relationship");
  assert.match(r.detail, /spouse/);
});

test("removing a contact keeps it, marked inactive, with who removed it", async () => {
  reset();
  const added = await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", person: PERSON, at: "2026-09-12T10:00:00.000Z" });
  const gone = await M.removeRelatedPerson({}, {}, { ...CTX, relatedPersonId: added.relatedPersonId, reason: "moved away", at: "2026-09-13T10:00:00.000Z" });
  assert.equal(gone.ok, true);

  const saved = store.get("RelatedPerson:" + added.relatedPersonId);
  assert.equal(saved.active, false);
  assert.equal(saved.removedBy, "dr.a@x.test");
  assert.equal(saved.removedReason, "moved away");
  assert.equal(saved.name, "Sita Kumar", "the contact itself is kept, not erased");
});

test("the list says loudly when there is nobody to ring", async () => {
  reset();
  const empty = await M.listRelatedPeople({}, {}, { ...CTX, patientId: "p1" });
  assert.equal(empty.ok, true);
  assert.equal(empty.hasEmergencyContact, false);
  assert.match(empty.warning, /Nobody is recorded/);
});

test("the list puts active emergency contacts first and keeps removed ones visible", async () => {
  reset();
  await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", at: "2026-09-10T10:00:00.000Z",
    person: { name: "Old Contact", relationship: "friend", phone: "1", emergencyContact: true } });
  const old = [...store.values()].find((r) => r.name === "Old Contact");
  await M.removeRelatedPerson({}, {}, { ...CTX, relatedPersonId: old.id, at: "2026-09-11T10:00:00.000Z" });
  await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", at: "2026-09-12T10:00:00.000Z",
    person: { name: "Sita", relationship: "spouse", phone: "9", emergencyContact: true } });

  const r = await M.listRelatedPeople({}, {}, { ...CTX, patientId: "p1" });
  assert.equal(r.people.length, 2, "a removed contact is still listed");
  assert.equal(r.people[0].name, "Sita", "the active emergency contact comes first");
  assert.equal(r.people[1].active, false);
  assert.equal(r.hasEmergencyContact, true);
});

test("the contact list carries the patient's deceased state, so a caller sees it", async () => {
  reset();
  await M.recordDeath({}, {}, { ...CTX, patientId: "p1", confirm: true, now: "2026-09-12T10:00:00.000Z" });
  const r = await M.listRelatedPeople({}, {}, { ...CTX, patientId: "p1" });
  assert.ok(r.deceased, "the deceased block should travel with the contacts");
  assert.equal(r.deceased.recordedBy, "dr.a@x.test");
});

/* ---- governance ------------------------------------------------------------------------------ */

test("a hospital that is not WardSynQ-native is skipped, never errored", async () => {
  reset();
  for (const fn of [M.recordDeath, M.addRelatedPerson, M.removeRelatedPerson]) {
    const r = await fn({}, {}, { migration: { mode: "off" }, patientId: "p1", confirm: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "off");
    assert.equal(r.written, 0);
  }
});

test("a refused write is reported as a refusal, not as a save", async () => {
  reset();
  const { GovernanceError } = await import("../wardsynq/wardsynq-actors.js");
  putThrows = new GovernanceError("refused", "SCOPE_DENIED", [{ code: "SCOPE_DENIED" }]);
  const r = await M.addRelatedPerson({}, {}, { ...CTX, patientId: "p1", person: PERSON });
  assert.equal(r.ok, false);
  assert.equal(r.error, "governance");
  assert.deepEqual(r.reasons, ["SCOPE_DENIED"]);
  assert.equal(r.written, 0);
});

test("a missing patient is a not-found, and nothing is written", async () => {
  reset();
  const r = await M.recordDeath({}, {}, { ...CTX, patientId: "nope", confirm: true });
  assert.equal(r.status, 404);
  assert.equal(r.error, "patient_not_found");
  assert.equal(puts.length, 0);
});
