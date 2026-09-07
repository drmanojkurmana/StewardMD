/* test/wardsynq-actors.test.mjs — HAZ-AI-01 and HAZ-ID-01.
 *
 * Adversarial throughout. The hazard is an AI-authored order reaching the active record, so these
 * tests are written as an attacker: claim a tier you do not have, sign as somebody else, mark a
 * record as human-written, shape the payload so the status looks benign, mutate the actor after it
 * was issued. Every one must fail.
 *
 * node --test test/wardsynq-actors.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TIER, KIND, INSTRUCTION_TYPES, GovernanceError, GovernedStore, makeActor, can, effectiveTier, authoriseWrite,
} from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { MedicationOrder, Observation, ClinicalNote } from "../wardsynq/wardsynq-model.js";

const doctor = makeActor({ id: "dr-menon", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "NMC-88421" });
const uncredentialled = makeActor({ id: "dr-locum", kind: KIND.HUMAN, tier: TIER.EXECUTE });
const maik = makeActor({ id: "maik-scribe", kind: KIND.AI, tier: TIER.DRAFT });
const monitor = makeActor({ id: "bed-04-monitor", kind: KIND.DEVICE, tier: TIER.DRAFT });
const ghis = makeActor({ id: "ghis-adapter", kind: KIND.ADAPTER, tier: TIER.DRAFT });

const order = (over) => MedicationOrder({ patientId: "pat-1", drug: "Enoxaparin 40mg", prescriberId: "dr-menon", ...over });

async function governed(over) {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  return new GovernedStore({ store, ...(over || {}) });
}

/* ------------------------------------------------------------------ the ladder */

test("actors: an AI actor is capped at DRAFT by its KIND, whatever tier it asks for", () => {
  const greedy = makeActor({ id: "maik", kind: KIND.AI, tier: TIER.EXECUTE });
  assert.equal(greedy.tier, TIER.DRAFT, "the ceiling is a property of being an AI, not a setting");
  assert.equal(greedy.requestedTier, TIER.EXECUTE);
  assert.equal(greedy.clamped, true, "and the clamp is visible in the audit rather than silent");
  assert.equal(can(greedy, TIER.EXECUTE), false);
});

test("actors: every non-human kind is capped below EXECUTE", () => {
  for (const kind of [KIND.AI, KIND.DEVICE, KIND.ADAPTER, KIND.SERVICE]) {
    const a = makeActor({ id: `x-${kind}`, kind, tier: TIER.EXECUTE });
    assert.equal(can(a, TIER.EXECUTE), false, `${kind} must never reach EXECUTE`);
    assert.equal(a.tier, TIER.DRAFT);
  }
  assert.equal(can(doctor, TIER.EXECUTE), true, "a credentialed human can");
});

test("ADVERSARIAL: an actor cannot be promoted after it is issued", () => {
  const a = makeActor({ id: "maik", kind: KIND.AI, tier: TIER.DRAFT });
  assert.throws(() => { a.tier = TIER.EXECUTE; }, "the actor is frozen");
  assert.throws(() => { a.kind = KIND.HUMAN; }, "and so is its kind");
  assert.equal(can(a, TIER.EXECUTE), false);
});

test("ADVERSARIAL: an unrecognised actor kind gets no permissions at all", () => {
  assert.throws(() => makeActor({ id: "x", kind: "superuser" }), (e) => { assert.equal(e.code, "UNKNOWN_KIND"); return true; });
  assert.throws(() => makeActor({ id: "x", kind: undefined }), GovernanceError);
  assert.throws(() => makeActor({ kind: KIND.HUMAN }), (e) => { assert.equal(e.code, "NO_ACTOR_ID"); return true; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: the AI boundary */

test("ADVERSARIAL: an AI cannot commit an active order", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(maik, order({ status: "active" })), (e) => {
    assert.equal(e.code, "EXECUTE_DENIED");
    return true;
  }, "this is the hazard in one line: a model committing a prescription");
});

test("ADVERSARIAL: an AI cannot forge a clinician signature", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(maik, order({ signedBy: "dr-menon" })), (e) => {
    assert.equal(e.code, "NON_HUMAN_SIGNATURE");
    return true;
  }, "signedBy is only meaningful if the actor writing IS the signer");
});

test("ADVERSARIAL: an AI cannot disguise its output as human-authored", async () => {
  const g = await governed();
  // Claiming human authorship outright is not refused, it is OVERWRITTEN. Refusing would only catch
  // a claim the check can see; overwriting cannot be evaded by omitting or misspelling the field.
  await g.put(maik, order({ aiDrafted: false }));
  const [saved] = await g.byPatient(doctor, "MedicationOrder", "pat-1");
  assert.equal(saved.aiDrafted, true, "the store asserts AI provenance rather than trusting the payload");
  assert.equal(saved.writtenBy.kind, KIND.AI);

  // The same is true when the field is simply absent.
  await g.put(maik, ClinicalNote({ patientId: "pat-1", noteType: "soap" }));
  const [note] = await g.byPatient(doctor, "ClinicalNote", "pat-1");
  assert.equal(note.aiDrafted, true);
});

test("ADVERSARIAL: an AI cannot reach EXECUTE by any status wording", async () => {
  const g = await governed();
  for (const status of ["active", "completed", "on-hold", "final", "signed", "committed", "ACTIVE"]) {
    await assert.rejects(() => g.put(maik, order({ status })), (e) => {
      assert.equal(e.code, "EXECUTE_DENIED");
      return true;
    }, `status "${status}" must not slip past the tier check`);
  }
});

test("ADVERSARIAL: an AI cannot write a signed note either; the rule is not medication-specific", async () => {
  const g = await governed();
  await assert.rejects(
    () => g.put(maik, ClinicalNote({ patientId: "pat-1", noteType: "soap", signedBy: "dr-menon" })),
    (e) => { assert.equal(e.code, "NON_HUMAN_SIGNATURE"); return true; },
  );
});

test("the intended path: an AI drafts, a clinician signs, and the record shows both", async () => {
  const g = await governed();
  await g.put(maik, order({}));                       // AI stages a draft
  const drafts = await g.byPatient(doctor, "MedicationOrder", "pat-1");
  assert.equal(drafts[0].status, "draft");
  assert.equal(drafts[0].aiDrafted, true);

  // The clinician signs it themselves, under their own credential.
  await g.put(doctor, { ...drafts[0], status: "active", signedBy: "dr-menon" });
  const signed = await g.get(doctor, "MedicationOrder", drafts[0].id);
  assert.equal(signed.status, "active");
  assert.equal(signed.signedBy, "dr-menon");
  assert.equal(signed.aiDrafted, true, "the record still shows the draft came from a model");
  assert.equal(signed.writtenBy.kind, KIND.HUMAN, "and that a human committed it");
});

/* ------------------------------------------------------------------ ADVERSARIAL: humans */

test("ADVERSARIAL: a clinician cannot sign as somebody else", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(doctor, order({ status: "active", signedBy: "dr-someone-else" })),
    (e) => { assert.equal(e.code, "SIGNATURE_NOT_OWN"); return true; });
});

test("ADVERSARIAL: a human without a credential cannot sign", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(uncredentialled, order({ status: "active", signedBy: "dr-locum" })),
    (e) => { assert.equal(e.code, "NO_CREDENTIAL"); return true; });
});

test("ADVERSARIAL: an unauthenticated write is refused outright", async () => {
  const g = await governed();
  for (const nobody of [null, undefined, {}, { id: "ghost" }]) {
    await assert.rejects(() => g.put(nobody, order({})), GovernanceError, "a write with no actor is not a write");
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: devices and adapters */

test("ADVERSARIAL: a device cannot write anything but an observation", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(monitor, order({})), (e) => {
    assert.equal(e.code, "DEVICE_SCOPE");
    return true;
  }, "a pump does not write prescriptions");
  await g.put(monitor, Observation({ patientId: "pat-1", code: "8867-4", value: 88 }));
});

test("ADVERSARIAL: an interop adapter cannot commit an active record", async () => {
  const g = await governed();
  await assert.rejects(() => g.put(ghis, order({ status: "active" })), (e) => { assert.equal(e.code, "EXECUTE_DENIED"); return true; },
    "an upstream system's say-so is not a clinician's signature");
  await g.put(ghis, Observation({ patientId: "pat-1", code: "2823-3", value: 4.1 }));
});

/* ------------------------------------------------------------------ ADVERSARIAL: wrong chart, HAZ-ID-01 */

test("ADVERSARIAL: a write cannot land on a chart the actor does not have open", async () => {
  const g = await governed();
  const session = g.session(doctor, "pat-1");
  await assert.rejects(() => session.put(order({ patientId: "pat-2", status: "active", signedBy: "dr-menon" })), (e) => {
    assert.equal(e.code, "WRONG_CHART");
    return true;
  }, "a second tab, a stale form or a mid-write patient switch must not commit to the wrong aggregate");
});

test("session: the correct chart still works, and the session cannot be re-pointed", async () => {
  const g = await governed();
  const session = g.session(doctor, "pat-1");
  await session.put(order({ status: "active", signedBy: "dr-menon" }));
  assert.equal((await session.byPatient("MedicationOrder", "pat-1")).length, 1);
  assert.throws(() => { session.activePatientId = "pat-2"; }, "a bound session is frozen to its chart");
  assert.throws(() => { session.actor = doctor; });
});

/* ------------------------------------------------------------------ the decision, in isolation */

test("authorise: the decision is pure and reports every reason, not just the first", () => {
  const v = authoriseWrite(maik, { resourceType: "MedicationOrder", patientId: "pat-2", status: "active", signedBy: "dr-menon", aiDrafted: false }, { activePatientId: "pat-1" });
  assert.equal(v.allowed, false);
  const codes = v.reasons.map((r) => r.code).sort();
  assert.deepEqual(codes, ["EXECUTE_DENIED", "NON_HUMAN_SIGNATURE", "WRONG_CHART"],
    "a reviewer needs every way a write was wrong, not the first one that tripped");
});

/* ------------------------------------------------------------------ evidence */

test("audit: every denial is recorded and announced as a governance event", async () => {
  const bus = new ClinicalEventBus();
  const events = [];
  bus.on("governance.denied", (e) => events.push(e.payload));
  const g = await governed({ bus });

  await assert.rejects(() => g.put(maik, order({ status: "active" })));
  assert.equal(g.denials.length, 1);
  assert.equal(events.length, 1, "a denied AI commit is a security event, not a dropped request");
  assert.equal(events[0].actorKind, KIND.AI);
  assert.equal(events[0].reasons[0].code, "EXECUTE_DENIED");
  assert.ok(events[0].at, "and it is timestamped");
});

test("audit: a permitted write records who actually performed it, not who it claims to be from", async () => {
  const g = await governed();
  await g.put(doctor, order({ status: "active", signedBy: "dr-menon", prescriberId: "dr-someone-else" }));
  const saved = (await g.byPatient(doctor, "MedicationOrder", "pat-1"))[0];
  assert.equal(saved.writtenBy.id, "dr-menon", "provenance is stamped by the store");
  assert.equal(saved.writtenBy.tier, TIER.EXECUTE);
  assert.ok(saved.writtenBy.at);
});

test("ADVERSARIAL: a caller cannot spoof provenance by supplying writtenBy", async () => {
  const g = await governed();
  await g.put(maik, order({ writtenBy: { id: "dr-menon", kind: KIND.HUMAN, tier: TIER.EXECUTE } }));
  const saved = (await g.byPatient(doctor, "MedicationOrder", "pat-1"))[0];
  assert.equal(saved.writtenBy.id, "maik-scribe", "the store overwrites any supplied provenance with the truth");
  assert.equal(saved.writtenBy.kind, KIND.AI);
});

test("reads: even a read needs an authenticated actor", async () => {
  const g = await governed();
  await assert.rejects(() => g.get(null, "MedicationOrder", "x"), (e) => { assert.equal(e.code, "READ_DENIED"); return true; });
  assert.deepEqual(await g.byPatient(maik, "MedicationOrder", "pat-1"), [], "an AI may read, which is tier one");
});


/* ------------------------------------------------------------------ machinery that spans charts */

test("asStoreFor: batch machinery is bound to an actor but to no chart", async () => {
  const g = await governed();
  const handle = g.asStoreFor(doctor);
  // It writes across patients, which a chart-bound session deliberately cannot.
  await handle.put(order({ patientId: "pat-1", status: "active", signedBy: "dr-menon" }));
  await handle.put(order({ id: "rx-2", patientId: "pat-2", status: "active", signedBy: "dr-menon" }));
  assert.equal((await handle.byPatient("MedicationOrder", "pat-1")).length, 1);
  assert.equal((await handle.byPatient("MedicationOrder", "pat-2")).length, 1);
});

test("ADVERSARIAL: asStoreFor is still governed; it is not a way around the ceiling", async () => {
  const g = await governed();
  const handle = g.asStoreFor(maik);
  await assert.rejects(() => handle.put(order({ status: "active" })), (e) => {
    assert.equal(e.code, "EXECUTE_DENIED");
    return true;
  }, "a batch handle must not become a hole in the actor model");
  await assert.rejects(() => handle.put(order({ signedBy: "dr-menon" })),
    (e) => { assert.equal(e.code, "NON_HUMAN_SIGNATURE"); return true; });
});

test("asStoreFor: provenance still records who really wrote it", async () => {
  const g = await governed();
  await g.asStoreFor(doctor).put(order({ status: "active", signedBy: "dr-menon" }));
  const [saved] = await g.byPatient(doctor, "MedicationOrder", "pat-1");
  assert.equal(saved.writtenBy.id, "dr-menon");
});

test("asStoreFor: the handle is frozen and cannot be re-pointed at another actor", () => {
  const g = new GovernedStore({ store: { open: () => {}, put: async (e) => e } });
  const handle = g.asStoreFor(maik);
  assert.throws(() => { handle.put = async () => "bypassed"; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: the ceiling at the check
 *
 * Found while building wardsynq-secops.js. The ceiling was applied in makeActor() and can() then
 * trusted actor.tier, so an actor that never passed through the factory held whatever it claimed.
 * That is not an exotic path: an actor object gets hand-built in a test harness, deserialised from
 * storage, rebuilt across a process boundary, or supplied by a caller that constructed the shape
 * itself. A ceiling enforced only at construction assumes every path went through the door.
 */

test("ADVERSARIAL: a hand-built AI actor claiming EXECUTE does not hold it", () => {
  const forged = { id: "ai-1", kind: KIND.AI, tier: TIER.EXECUTE };
  assert.equal(can(forged, TIER.EXECUTE), false, "the ceiling is re-applied at the check, not only at construction");
  assert.equal(can(forged, TIER.DRAFT), true, "and it still holds everything up to its ceiling");
  assert.equal(effectiveTier(forged), TIER.DRAFT);
});

test("ADVERSARIAL: a forged actor cannot commit an active record", () => {
  const forged = { id: "ai-1", kind: KIND.AI, tier: TIER.EXECUTE };
  const order = { resourceType: "MedicationOrder", patientId: "pat-1", status: "active" };
  const v = authoriseWrite(forged, order, {});
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => r.code === "EXECUTE_DENIED"));
});

test("a deserialised actor behaves exactly like a constructed one", () => {
  const real = makeActor({ id: "ai-2", kind: KIND.AI, tier: TIER.EXECUTE });
  const roundTripped = JSON.parse(JSON.stringify(real));
  assert.equal(can(real, TIER.EXECUTE), can(roundTripped, TIER.EXECUTE));
  assert.equal(effectiveTier(roundTripped), TIER.DRAFT);
});

test("every non-human kind is capped at the check, not just AI", () => {
  for (const kind of [KIND.AI, KIND.DEVICE, KIND.ADAPTER, KIND.SERVICE]) {
    assert.equal(can({ id: "x", kind, tier: TIER.EXECUTE }, TIER.EXECUTE), false, `${kind} must not reach EXECUTE`);
  }
  assert.equal(can({ id: "dr", kind: KIND.HUMAN, tier: TIER.EXECUTE }, TIER.EXECUTE), true);
});

test("ADVERSARIAL: an unrecognised kind gets nothing, even claiming EXECUTE", () => {
  assert.equal(can({ id: "x", kind: "superuser", tier: TIER.EXECUTE }, TIER.READ), false);
  assert.equal(effectiveTier({ id: "x", kind: "superuser", tier: TIER.EXECUTE }), null);
});

/* ------------------------------------------------------------------ ADVERSARIAL: instruction vs fact
 *
 * Found by scripts/wardsynq-cutover-check.mjs on its first run, which is the best possible place to
 * find it. The commit rule had been written against the STATUS STRING: any non-draft status needed
 * EXECUTE. The intent was right and the implementation was not, because several canonical types
 * have no draft state at all. An Encounter is born "planned"; a DiagnosticReport is born
 * "preliminary".
 *
 * So no adapter could ever write an encounter. Every ward encounter was refused while its
 * observations wrote successfully carrying an encounterId pointing at a record that did not exist.
 * A dangling reference nothing reports is worse than a loud failure.
 */

test("ADVERSARIAL: an adapter CAN record a fact another system is authoritative for", () => {
  const feed = makeActor({ id: "ghis", kind: KIND.ADAPTER, tier: TIER.DRAFT });

  // An Encounter has no draft state. Refusing it means the feed cannot say a patient is admitted,
  // which is the one thing an ADT feed exists to say.
  assert.equal(authoriseWrite(feed, { resourceType: "Encounter", patientId: "p", status: "in-progress" }, {}).allowed, true);
  assert.equal(authoriseWrite(feed, { resourceType: "DiagnosticReport", patientId: "p", status: "final" }, {}).allowed, true);
  assert.equal(authoriseWrite(feed, { resourceType: "Observation", patientId: "p", status: "final" }, {}).allowed, true);
});

test("ADVERSARIAL: an adapter still cannot issue an INSTRUCTION, which is what the rule was for", () => {
  const feed = makeActor({ id: "ghis", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  for (const resourceType of INSTRUCTION_TYPES) {
    const v = authoriseWrite(feed, { resourceType, patientId: "p", status: "active" }, {});
    assert.equal(v.allowed, false, `${resourceType} active must still need EXECUTE`);
    assert.ok(v.reasons.some((r) => r.code === "EXECUTE_DENIED"));
  }
});

test("ADVERSARIAL: an AI still cannot commit an active order, so HAZ-AI-01 is unchanged", () => {
  const ai = makeActor({ id: "ai", kind: KIND.AI, tier: TIER.EXECUTE });
  const v = authoriseWrite(ai, { resourceType: "MedicationOrder", patientId: "p", status: "active", signedBy: "dr-1" }, {});
  assert.equal(v.allowed, false);
  const codes = v.reasons.map((r) => r.code);
  assert.ok(codes.includes("EXECUTE_DENIED"));
  assert.ok(codes.includes("NON_HUMAN_SIGNATURE"));
});

test("a device is still confined to observations, whatever the status", () => {
  const pump = makeActor({ id: "pump", kind: KIND.DEVICE, tier: TIER.DRAFT });
  assert.equal(authoriseWrite(pump, { resourceType: "Observation", patientId: "p", status: "final" }, {}).allowed, true);
  assert.equal(authoriseWrite(pump, { resourceType: "Encounter", patientId: "p", status: "in-progress" }, {}).allowed, false);
});

test("a READ actor writes nothing at all, draft or otherwise", () => {
  const viewer = makeActor({ id: "student", kind: KIND.HUMAN, tier: TIER.READ });
  const v = authoriseWrite(viewer, { resourceType: "ClinicalNote", patientId: "p", status: "draft" }, {});
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => r.code === "DRAFT_DENIED"));
});

/* ------------------------------------------------------------------ scope and delegation (2026-09-06) */

test("scope: an actor built without scope behaves exactly as before; a scoped one is refused outside it, as a governance denial", async () => {
  const { GovernedStore, makeActor, KIND, TIER, authoriseWrite, canRead, GovernanceError } = await import("../wardsynq/wardsynq-actors.js");
  const { ClinicalStore, MemoryBackend } = await import("../wardsynq/wardsynq-store.js");
  const unscoped = makeActor({ id: "dr", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "R1" });
  assert.deepEqual(unscoped.scope, { read: null, write: null, writeCategories: null });
  assert.equal(canRead(unscoped, "ClinicalNote"), true);
  const nurse = makeActor({ id: "rn", kind: KIND.HUMAN, tier: TIER.EXECUTE, scope: { read: null, write: ["Observation"] } });
  assert.equal(authoriseWrite(nurse, { resourceType: "Observation", id: "o" }).allowed, true);
  const v = authoriseWrite(nurse, { resourceType: "MedicationOrder", id: "rx", status: "draft" });
  assert.equal(v.allowed, false);
  assert.deepEqual(v.reasons.map((r) => r.code), ["SCOPE_DENIED"]);
  const pharm = makeActor({ id: "ph", kind: KIND.HUMAN, tier: TIER.READ, scope: { read: ["MedicationOrder"], write: [] } });
  const g = new GovernedStore({ store: new ClinicalStore(new MemoryBackend()) });
  await assert.rejects(g.get(pharm, "ClinicalNote", "n"), (e) => e instanceof GovernanceError && e.code === "READ_SCOPE_DENIED");
  assert.equal(await g.get(pharm, "MedicationOrder", "rx"), null);
  assert.equal(nurse.scope.write.includes("Observation"), true);
  assert.throws(() => { nurse.scope.write.push("MedicationOrder"); }, /object is not extensible|read only/);
});

test("SCOPE WITHIN A TYPE: one Observation carries four clinical meanings, and a role gets only its own", async () => {
  const { makeActor, KIND, TIER, authoriseWrite } = await import("../wardsynq/wardsynq-actors.js");
  /* `Observation` is a vital sign, a laboratory result, a fluid entry and a device reading. A scope
   * expressed only as "may write Observation" let a laboratory actor write a blood pressure, which
   * the eMAR then believes when it checks a weight-based dose. */
  const lab = makeActor({
    id: "lab", kind: KIND.HUMAN, tier: TIER.EXECUTE,
    scope: { read: null, write: ["Observation"], writeCategories: { Observation: ["laboratory"] } },
  });
  assert.equal(authoriseWrite(lab, { resourceType: "Observation", id: "o", category: "laboratory" }).allowed, true);

  const vital = authoriseWrite(lab, { resourceType: "Observation", id: "o", category: "vital-signs" });
  assert.equal(vital.allowed, false);
  assert.deepEqual(vital.reasons.map((r) => r.code), ["CATEGORY_DENIED"]);
  assert.match(vital.reasons[0].message, /"vital-signs"/, "the refusal names what was actually asked for");

  /* ABSENCE IS REFUSED, NOT WAVED THROUGH. The model factory defaults a missing category to
   * "vital-signs", so omitting the field is a claim, not a neutral act - and it is the exact shape
   * that would otherwise slip past a check written as "if a category is present". */
  const bare = authoriseWrite(lab, { resourceType: "Observation", id: "o" });
  assert.equal(bare.allowed, false);
  assert.deepEqual(bare.reasons.map((r) => r.code), ["CATEGORY_DENIED"]);
  assert.match(bare.reasons[0].message, /no category/);
  assert.equal(authoriseWrite(lab, { resourceType: "Observation", id: "o", category: null }).allowed, false);

  // A type with no entry in the map is unconstrained: the constraint is per type, not a mode.
  assert.equal(authoriseWrite(lab, { resourceType: "DiagnosticReport", id: "d" }).allowed, false, "still out of type scope");
  const both = makeActor({
    id: "lab2", kind: KIND.HUMAN, tier: TIER.EXECUTE,
    scope: { read: null, write: ["Observation", "DiagnosticReport"], writeCategories: { Observation: ["laboratory"] } },
  });
  assert.equal(authoriseWrite(both, { resourceType: "DiagnosticReport", id: "d" }).allowed, true);

  // A malformed map is dropped rather than treated as a constraint: a half-parsed rule that refuses
  // everything would take a working role offline.
  const junk = makeActor({ id: "x", kind: KIND.HUMAN, tier: TIER.EXECUTE, scope: { read: null, write: ["Observation"], writeCategories: { Observation: [] } } });
  assert.equal(junk.scope.writeCategories, null);
  assert.equal(authoriseWrite(junk, { resourceType: "Observation", id: "o", category: "anything" }).allowed, true);
});

test("delegation: an AI acting for a human is stamped as the AI with onBehalfOf, never as the human", async () => {
  const { GovernedStore, makeActor, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");
  const { ClinicalStore, MemoryBackend } = await import("../wardsynq/wardsynq-store.js");
  const g = new GovernedStore({ store: new ClinicalStore(new MemoryBackend()) });
  const bot = makeActor({ id: "ai:maik", kind: KIND.AI, tier: TIER.EXECUTE, onBehalfOf: "dr-1" });
  assert.equal(bot.tier, TIER.DRAFT);
  const saved = await g.put(bot, { resourceType: "ClinicalNote", id: "n1", patientId: "p", sections: {} });
  assert.equal(saved.writtenBy.id, "ai:maik");
  assert.equal(saved.writtenBy.kind, "ai");
  assert.equal(saved.writtenBy.onBehalfOf, "dr-1");
  assert.equal(saved.aiDrafted, true);
  const human = makeActor({ id: "dr-1", kind: KIND.HUMAN, tier: TIER.EXECUTE });
  const own = await g.put(human, { resourceType: "ClinicalNote", id: "n2", patientId: "p", sections: {} });
  assert.equal("onBehalfOf" in own.writtenBy, false, "a human acting for themselves carries no delegate");
});
