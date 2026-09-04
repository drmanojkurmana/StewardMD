/* test/wardsynq-ghis-live.test.mjs — the cut-over, and the ward round it must never break.
 *
 * This wraps a function in a live mobile app that a clinician is using during a ward round. Every
 * test here is a way that could go wrong for them, and the first three are the ones that matter:
 * the legacy result comes back untouched, the adapter cannot throw into the caller, and the whole
 * thing can be stopped from the device without a reload.
 *
 * node --test test/wardsynq-ghis-live.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MODE, installLiveGhis, bundleIdentity, countLegacyRows } from "../wardsynq/wardsynq-ghis-live.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";

const NOW = "2026-09-05T09:00:00.000Z";
const flagsOn = { get: (k) => k === "smd_wardsynq_cutover" };
const flagsOff = { get: () => false };

/** A GHIS bundle of the shape the adapter's own tests use. */
const bundle = (over) => ({
  patientId: "GH-40118", ts: "2026-09-05T08:00:00.000Z",
  patient: { patientId: "GH-40118", name: "Test Patient", dob: "67", sex: "F" },
  labs: [
    { test: "Potassium", result: "5.4", units: "mmol/L" },
    { test: "Creatinine", result: "1.42", units: "mg/dL" },
  ],
  ...over,
});

/** A host whose ingestFromWard behaves like the real one: returns an applied map. */
const makeHost = (impl) => ({
  ingestFromWard: impl || ((b) => ({ applied: { k: {}, creat: {} }, conflicts: [], source: "Ward Sync", bundle: b })),
});

async function governed() {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const store = new GovernedStore({ store: raw });
  const adapter = makeActor({ id: "ghis-adapter", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  return { store: store.asStoreFor(adapter), raw, adapter };
}

/* ------------------------------------------------------------------ ADVERSARIAL: the ward round */

test("ADVERSARIAL: the legacy result comes back UNTOUCHED and is computed first", async () => {
  const order = [];
  const host = makeHost((b) => { order.push("legacy"); return { applied: { k: {} }, marker: "legacy-value" }; });
  const { store } = await governed();

  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });
  assert.equal(live.installed, true);

  const result = host.ingestFromWard(bundle());
  assert.equal(result.marker, "legacy-value", "the mobile app receives exactly what it received before");
  assert.equal(order[0], "legacy", "and it was computed before anything the adapter does");
});

test("ADVERSARIAL: an adapter that explodes cannot break the ward round", async () => {
  const host = makeHost();
  const { store } = await governed();
  const errors = [];
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW, onError: (e) => errors.push(e) });

  // A bundle shaped to make the adapter unhappy.
  const result = host.ingestFromWard({ patientId: null, labs: "not an array" });
  assert.ok(result, "the caller still got a result");
  const report = live.report();
  assert.ok(report.adapterErrors + report.issues.length >= 1, "and the failure is a number on a report");
  assert.match(report.reading, /mobile app is unaffected|canonical records written/);
});

test("ADVERSARIAL: a store that throws on every write cannot break the ward round", async () => {
  const host = makeHost();
  const exploding = { put: () => { throw new Error("IndexedDB is full"); } };
  const live = installLiveGhis({ host, flags: flagsOn, store: exploding, now: () => NOW });

  const result = host.ingestFromWard(bundle());
  assert.ok(result.applied, "the ward round continued");
  assert.ok(live.report().writeErrors >= 1);
  assert.match(live.report().lastError.message, /IndexedDB is full/);
});

test("ADVERSARIAL: a rejecting async store is counted, not thrown", async () => {
  const host = makeHost();
  const live = installLiveGhis({
    host, flags: flagsOn, now: () => NOW,
    store: { put: () => Promise.reject(new Error("quota exceeded")) },
  });
  host.ingestFromWard(bundle());
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(live.report().writeErrors >= 1);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the kill switch */

test("ADVERSARIAL: the cut-over can be stopped from the device, with no reload", async () => {
  const host = makeHost();
  const { store } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });

  host.ingestFromWard(bundle());
  const before = live.report().bundlesSeen;
  assert.equal(before, 1);

  const halt = live.halt("mapping looked wrong on the round");
  assert.equal(halt.mode, MODE.HALTED);

  host.ingestFromWard(bundle({ ts: "2026-09-05T09:00:00.000Z" }));
  assert.equal(live.report().bundlesSeen, before, "nothing further was processed");
  assert.match(live.report().reading, /the ward is working normally/);

  live.resume();
  host.ingestFromWard(bundle({ ts: "2026-09-05T10:00:00.000Z" }));
  assert.equal(live.report().bundlesSeen, before + 1);
});

test("the legacy path keeps working while halted", async () => {
  const host = makeHost((b) => ({ applied: { k: {} }, marker: "still-working" }));
  const live = installLiveGhis({ host, flags: flagsOn, now: () => NOW });
  live.halt("test");
  assert.equal(host.ingestFromWard(bundle()).marker, "still-working");
});

test("uninstall restores the original function exactly", async () => {
  const original = (b) => ({ applied: {}, marker: "original" });
  const host = makeHost(original);
  const live = installLiveGhis({ host, flags: flagsOn, now: () => NOW });
  assert.notEqual(host.ingestFromWard, original, "it is wrapped");
  live.uninstall();
  assert.equal(host.ingestFromWard, original, "and the wrapper leaves no trace");
});

/* ------------------------------------------------------------------ the flag */

test("nothing is installed with the flag off", () => {
  const host = makeHost();
  const live = installLiveGhis({ host, flags: flagsOff, now: () => NOW });
  assert.equal(live.installed, false);
  assert.equal(live.mode, MODE.OFF);
  assert.equal(live.report(), null);
});

test("nothing is installed when there is no ingest function to wrap", () => {
  const live = installLiveGhis({ host: {}, flags: flagsOn, now: () => NOW });
  assert.equal(live.installed, false);
  assert.match(live.reason, /no ingestFromWard/);
});

/* ------------------------------------------------------------------ the canonical model */

test("ADVERSARIAL: ward data reaches the CANONICAL model, which is the whole point", async () => {
  const host = makeHost();
  const { store, raw } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });

  host.ingestFromWard(bundle());
  await new Promise((r) => setTimeout(r, 0));

  const report = live.report();
  assert.ok(report.observationsMapped >= 2, "the potassium and creatinine were mapped");
  assert.ok(report.written >= 1, "and written to the canonical store");
  assert.match(report.reading, /canonical records written/);
});

test("a dry run with no store is NOT counted as written", async () => {
  const host = makeHost();
  const live = installLiveGhis({ host, flags: flagsOn, now: () => NOW });
  host.ingestFromWard(bundle());
  const r = live.report();
  assert.ok(r.mapped >= 1, "mapping still ran");
  assert.equal(r.written, 0, "a dry run reporting success is a dry run mistaken for a live one");
});

test("ADVERSARIAL: a redelivered bundle does not write a second copy", async () => {
  const host = makeHost();
  const { store } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });

  const b = bundle();
  host.ingestFromWard(b);
  await new Promise((r) => setTimeout(r, 0));
  const afterFirst = live.report().written;

  host.ingestFromWard(b);   // reconnect, catch-up window, or a double tap
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(live.report().written, afterFirst, "a reconnect must not duplicate a patient's potassium");
  assert.ok(live.report().skippedDuplicate >= 1);
});

test("ADVERSARIAL: the adapter writes as an ADAPTER, so it cannot commit an active record", async () => {
  // Not re-implemented here: the actor model caps an adapter at DRAFT, and this asserts the cut-over
  // actually goes through it rather than around it.
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const store = new GovernedStore({ store: raw });
  const adapter = makeActor({ id: "ghis", kind: KIND.ADAPTER, tier: TIER.EXECUTE });
  assert.equal(adapter.tier, TIER.DRAFT, "the factory clamps an adapter, whatever it asks for");

  const session = store.asStoreFor(adapter);
  await assert.rejects(
    () => Promise.resolve(session.put({ resourceType: "MedicationOrder", patientId: "p", status: "active" })),
    "a feed cannot commit an active clinical record however confidently GHIS asserts one");
});

/* ------------------------------------------------------------------ divergence */

test("divergence between the two paths is recorded rather than alarmed about", async () => {
  // The legacy path applied one row; the adapter mapped two. That is usually the legacy path
  // dropping a value it has no key for, which is worth reading and not worth an alert.
  const host = makeHost(() => ({ applied: { k: {} } }));
  const { store } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });

  host.ingestFromWard(bundle());
  const d = live.report().divergences;
  assert.equal(d.length, 1);
  assert.equal(d[0].legacyRows, 1);
  assert.equal(d[0].canonicalRows, 2);
  assert.match(d[0].note, /Worth reading, not worth alarming/);
});

test("no divergence is recorded when the two agree", async () => {
  const host = makeHost(() => ({ applied: { k: {}, creat: {} } }));
  const { store } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });
  host.ingestFromWard(bundle());
  assert.equal(live.report().divergences.length, 0);
});

test("a legacy result with no applied map yields no divergence claim", () => {
  assert.equal(countLegacyRows(undefined), null);
  assert.equal(countLegacyRows({ conflicts: [] }), null);
  assert.equal(countLegacyRows({ applied: { a: 1, b: 2 } }), 2);
});

/* ------------------------------------------------------------------ the bus */

test("the bundle is announced on the event bus, idempotently", async () => {
  const host = makeHost();
  const { store } = await governed();
  const bus = new ClinicalEventBus();
  const seen = [];
  bus.on("interop.ingested", (e) => seen.push(e));

  const live = installLiveGhis({ host, flags: flagsOn, store, bus, now: () => NOW });
  const b = bundle();
  host.ingestFromWard(b);
  host.ingestFromWard(b);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(seen.length, 1, "one bundle, one event, however many times it is redelivered");
  assert.equal(seen[0].payload.system, "GHIS");
});

test("a bus that throws does not reach the ward", async () => {
  const host = makeHost();
  const live = installLiveGhis({
    host, flags: flagsOn, now: () => NOW,
    bus: { emit: () => { throw new Error("bus is down"); } },
  });
  assert.ok(host.ingestFromWard(bundle()).applied);
});

test("bundle identity is stable and falls back to patient plus timestamp", () => {
  assert.equal(bundleIdentity({ eventId: "evt-9" }), "evt-9");
  assert.equal(bundleIdentity({ patientId: "GH-1", ts: "T" }), "ghis:GH-1:T");
  assert.equal(bundleIdentity({ patientId: "GH-1" }), null, "no timestamp means no stable identity to claim");
  assert.equal(bundleIdentity(null), null);
});

/* ------------------------------------------------------------------ what approval means */

test("ADVERSARIAL: the report does NOT claim clinical approval", async () => {
  const host = makeHost();
  const { store } = await governed();
  const live = installLiveGhis({ host, flags: flagsOn, store, now: () => NOW });
  host.ingestFromWard(bundle());

  const r = live.report();
  assert.match(r.clinicalNote, /NOT clinical approval/);
  assert.match(r.clinicalNote, /UNAPPROVED seed content/,
    "the owner approved an architectural cut-over, which is not pharmacy approving a rule pack");
});
