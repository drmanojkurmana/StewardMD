/* test/wardsynq-interop.test.mjs — the Integration Hub.
 *
 * A hub takes data from software nobody here controls, written to standards nobody fully follows, on
 * a connection that drops. So the tests are mostly about hostile and broken feeds: an adapter that
 * throws, one that lies about its tier, a payload nobody claims, two adapters claiming the same
 * message, a reconnect replaying yesterday.
 *
 * node --test test/wardsynq-interop.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Adapter, IntegrationHub, InteropError, QUARANTINE, ghisAdapter } from "../wardsynq/wardsynq-interop.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { mapGhisBundle } from "../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { Observation, MedicationOrder } from "../wardsynq/wardsynq-model.js";

async function hub(over) {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const governed = new GovernedStore({ store });
  return { hub: new IntegrationHub({ governed, bus: (over && over.bus) || new ClinicalEventBus(), ...(over || {}) }), store, governed };
}

/** A minimal well-behaved feed. */
const goodAdapter = (over) => new Adapter({
  system: "toy",
  claims: (p) => !!(p && p.kind === "toy"),
  normalise: async (p) => ({ entities: [Observation({ patientId: p.patientId || "pat-1", code: "8867-4", value: p.value ?? 70 })] }),
  ...(over || {}),
});

const ghisBundle = (over) => ({
  patientId: "12345", episodeId: "EP1", ts: 1757000000000,
  patient: { name: "RAMU DEVI", sex: "F", mrn: "12345", age: "45" },
  labs: [{ test: "Sodium", result: "138", units: "mEq/L", date: "03-JUL-2026 08:30" }],
  ...over,
});

/* ------------------------------------------------------------------ registration */

test("registry: an adapter must say what it speaks for and how", () => {
  assert.throws(() => new Adapter({ claims: () => true, normalise: async () => ({}) }), (e) => { assert.equal(e.code, "NO_SYSTEM"); return true; });
  assert.throws(() => new Adapter({ system: "x", normalise: async () => ({}) }), (e) => { assert.equal(e.code, "NO_CLAIMS"); return true; });
  assert.throws(() => new Adapter({ system: "x", claims: () => true }), (e) => { assert.equal(e.code, "NO_NORMALISE"); return true; });
});

test("registry: two feeds cannot register under the same system name", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter());
  assert.throws(() => h.register(goodAdapter()), (e) => { assert.equal(e.code, "DUPLICATE_SYSTEM"); return true; });
  assert.deepEqual(h.systems, ["toy"]);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the ceiling */

test("ADVERSARIAL: an adapter cannot ask its way above DRAFT", () => {
  const greedy = goodAdapter({ system: "greedy", tier: TIER.EXECUTE });
  assert.equal(greedy.actor.tier, TIER.DRAFT, "the ceiling is a property of being an adapter, not a setting");
  assert.equal(greedy.actor.kind, KIND.ADAPTER);
  assert.equal(greedy.actor.clamped, true, "and the clamp is visible in the audit");
});

test("ADVERSARIAL: an upstream system asserting a signed active order does not get one", async () => {
  const { hub: h, store } = await hub();
  h.register(new Adapter({
    system: "pushy",
    claims: (p) => p && p.kind === "pushy",
    // The other hospital's software insists this is a live, signed prescription.
    normalise: async () => ({ entities: [MedicationOrder({ patientId: "pat-1", drug: "Warfarin 5mg", prescriberId: "dr-elsewhere", status: "active", signedBy: "dr-elsewhere" })] }),
  }));

  const r = await h.ingest({ kind: "pushy" });
  assert.equal(r.refused, 1, "governance refuses it rather than the hub trusting the sender");
  assert.equal(h.quarantine.at(-1).reason, QUARANTINE.UNWRITABLE);
  assert.match(h.quarantine.at(-1).detail, /cannot commit a record with status|cannot produce a clinician signature/);
  assert.equal((await store.byPatient("MedicationOrder", "pat-1")).length, 0,
    "'the other system said so' is not a clinician's signature");
});

test("an adapter CAN write a draft, which is the whole point of the tier", async () => {
  const { hub: h, store } = await hub();
  h.register(goodAdapter());
  const r = await h.ingest({ kind: "toy", patientId: "pat-9", value: 88 });
  assert.equal(r.ok, true);
  assert.equal(r.entities.length, 1);
  const saved = await store.byPatient("Observation", "pat-9");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].writtenBy.kind, KIND.ADAPTER, "and the record says which adapter produced it");
  assert.equal(saved[0].writtenBy.id, "adapter:toy");
});

/* ------------------------------------------------------------------ ADVERSARIAL: nothing dropped */

test("ADVERSARIAL: a payload no adapter claims is quarantined, never dropped", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter());
  const r = await h.ingest({ kind: "something-else", mrn: "X" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, QUARANTINE.UNCLAIMED);
  assert.equal(h.quarantine.length, 1);
  assert.deepEqual(h.quarantine[0].payload, { kind: "something-else", mrn: "X" },
    "the payload is kept, because a feed that discards what it does not understand produces a chart that is wrong invisibly");
});

test("ADVERSARIAL: two adapters claiming one message is quarantined rather than guessed", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ system: "a" }));
  h.register(goodAdapter({ system: "b" }));
  const r = await h.ingest({ kind: "toy" });
  assert.equal(r.reason, QUARANTINE.AMBIGUOUS);
  assert.match(h.quarantine[0].detail, /claimed by a, b/,
    "guessing would attach a patient's data to whichever adapter registered first");
});

test("ADVERSARIAL: an adapter that produces nothing is quarantined with its reason", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ normalise: async () => ({ entities: [], reason: "no identifiable patient" }) }));
  const r = await h.ingest({ kind: "toy" });
  assert.equal(r.reason, QUARANTINE.REJECTED);
  assert.equal(h.quarantine[0].detail, "no identifiable patient");
});

/* ------------------------------------------------------------------ ADVERSARIAL: broken feeds */

test("ADVERSARIAL: an adapter that throws is isolated and the hub survives", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ system: "broken", claims: (p) => p && p.kind === "broken", normalise: async () => { throw new Error("upstream sent XML where JSON was promised"); } }));
  const r = await h.ingest({ kind: "broken" });
  assert.equal(r.reason, QUARANTINE.FAILED);
  assert.match(h.quarantine[0].detail, /XML where JSON/);
  assert.equal(h.health().find((x) => x.system === "broken").failures, 1);
});

test("ADVERSARIAL: one broken feed does not stop the others", async () => {
  const { hub: h, store } = await hub();
  h.register(goodAdapter({ system: "broken", claims: (p) => p && p.kind === "broken", normalise: async () => { throw new Error("down"); } }));
  h.register(goodAdapter());

  await h.ingest({ kind: "broken" });
  const ok = await h.ingest({ kind: "toy", patientId: "pat-2" });
  assert.equal(ok.ok, true, "a hospital runs many feeds and they fail independently");
  assert.equal((await store.byPatient("Observation", "pat-2")).length, 1);
});

test("ADVERSARIAL: a claims() that throws is treated as not claiming, not as a crash", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ system: "rude", claims: () => { throw new Error("boom"); } }));
  const r = await h.ingest({ kind: "toy" });
  assert.equal(r.reason, QUARANTINE.UNCLAIMED, "a broken claim check must not take the hub down");
});

/* ------------------------------------------------------------------ ADVERSARIAL: replay */

test("ADVERSARIAL: a reconnect replaying the same message does not duplicate a patient's data", async () => {
  const { hub: h, store } = await hub();
  h.register(ghisAdapter(mapGhisBundle));

  const first = await h.ingest(ghisBundle());
  assert.equal(first.ok, true);
  const second = await h.ingest(ghisBundle());       // identical message, as a catch-up window sends
  assert.equal(second.duplicate, true);
  assert.equal(second.entities.length, 0);

  const obs = await store.byPatient("Observation", first.entities.find((e) => e.resourceType === "Patient").id);
  assert.equal(obs.length, 1, "one sodium, not two");
});

test("replay: a genuinely new message from the same patient is not mistaken for a replay", async () => {
  const { hub: h } = await hub();
  h.register(ghisAdapter(mapGhisBundle));
  await h.ingest(ghisBundle({ ts: 1757000000000 }));
  const later = await h.ingest(ghisBundle({ ts: 1757000600000, labs: [{ test: "Potassium", result: "5.9", units: "mEq/L", date: "03-JUL-2026 09:30" }] }));
  assert.equal(later.duplicate, undefined);
  assert.equal(later.ok, true);
});

/* ------------------------------------------------------------------ GHIS as an instance */

test("ghis: the existing adapter registers as an ordinary feed", async () => {
  const bus = new ClinicalEventBus();
  const ingested = [];
  bus.on("interop.ingested", (e) => ingested.push(e.payload));
  const { hub: h, store } = await hub({ bus });
  h.register(ghisAdapter(mapGhisBundle));

  const r = await h.ingest(ghisBundle());
  assert.equal(r.system, "ghis");
  assert.ok(r.entities.some((e) => e.resourceType === "Patient"));
  assert.ok(r.entities.some((e) => e.resourceType === "Observation"));
  assert.equal(ingested[0].system, "ghis");

  const patient = r.entities.find((e) => e.resourceType === "Patient");
  const saved = await store.get("Patient", patient.id);
  assert.equal(saved.mrn, "12345");
  assert.equal(saved.writtenBy.id, "adapter:ghis", "the first integration is now an instance of the pattern");
});

/* TASK 7 STEP 3: the same contract vocabulary _connect/sdk/descriptor.js states for a network
 * connector, stated here for a claim-based payload adapter. */
test("contract(): structural facts are always true, and the ghis adapter states its real identity strategy honestly", () => {
  const g = ghisAdapter(mapGhisBundle);
  const c = g.contract();
  assert.equal(c.direction, "inbound-event");
  assert.equal(c.ownership, "external");
  assert.equal(c.readWrite, "write-via-ingest");
  assert.equal(c.transport, "in-process", "no network egress of its own - the payload already arrived");
  assert.equal(c.tenantScope, "delegated");
  assert.equal(c.idempotency, "source-event-id", "ghis declares a sourceEventId, so replay safety is real, not claimed");
  assert.equal(c.identityStrategy, "trusted-patientid-no-mpi-reconciliation", "stated plainly: this path does NOT run wardsynq-mpi.js, unlike fhir-inbound.js/hl7-inbound.js");
});

test("contract(): an adapter that declares no sourceEventId honestly reports no idempotency strategy, not a fabricated one", () => {
  const a = new Adapter({ system: "toy", claims: () => true, normalise: async () => ({ entities: [] }) });
  assert.equal(a.contract().idempotency, null);
  assert.equal(a.contract().identityStrategy, null);
});

test("ghis: it does not claim payloads that are not its shape", async () => {
  const { hub: h } = await hub();
  h.register(ghisAdapter(mapGhisBundle));
  for (const notGhis of [{ kind: "toy" }, { mrn: "1" }, null, "a string", { labs: [] }]) {
    const r = await h.ingest(notGhis);
    assert.equal(r.ok, false, "an over-eager claim would swallow another system's traffic");
  }
});

test("ghis: mapping issues are announced rather than buried", async () => {
  const bus = new ClinicalEventBus();
  const issues = [];
  bus.on("interop.issues", (e) => issues.push(...e.payload.issues));
  const { hub: h } = await hub({ bus });
  h.register(ghisAdapter(mapGhisBundle));
  await h.ingest(ghisBundle({ labs: [{ test: "Serum Xyzase", result: "3", units: "U/L" }] }));
  assert.ok(issues.some((i) => i.code === "GHIS_LAB_UNMAPPED"),
    "an unmapped analyte must reach somebody, not sit in a return value nobody reads");
});

/* ------------------------------------------------------------------ health */

test("health: a feed that arrives and never lands is visibly stalled", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ system: "rotting", claims: (p) => p && p.kind === "rotting", normalise: async () => { throw new Error("schema changed upstream"); } }));
  h.register(goodAdapter());

  await h.ingest({ kind: "rotting" });
  await h.ingest({ kind: "rotting" });
  await h.ingest({ kind: "toy" });

  const health = h.health();
  const bad = health.find((x) => x.system === "rotting");
  const good = health.find((x) => x.system === "toy");
  assert.equal(bad.stalled, true, "a hospital with eight feeds needs to see which one is rotting");
  assert.equal(bad.seen, 2);
  assert.equal(bad.ingested, 0);
  assert.equal(good.stalled, false);
  assert.equal(good.entities, 1);
});

test("health: every feed reports the tier it actually holds", async () => {
  const { hub: h } = await hub();
  h.register(goodAdapter({ tier: TIER.EXECUTE }));
  assert.equal(h.health()[0].actorTier, TIER.DRAFT, "what it asked for is not what it has");
});

test("hub: works with no governed store, for a dry-run or a mapping harness", async () => {
  const h = new IntegrationHub({});
  h.register(goodAdapter());
  const r = await h.ingest({ kind: "toy" });
  assert.equal(r.ok, true, "mapping must be exercisable without a store, the same as the adapters themselves");
  assert.equal(r.entities.length, 1);
});
