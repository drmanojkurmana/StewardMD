/* test/wardsynq-offline.test.mjs — HAZ-DOWN-01, offline charting and reconciliation.
 *
 * The hazard is not losing the network, it is losing somebody's charting on the way back. So these
 * tests are mostly attempts to make a clinician's work disappear: last-write-wins, a silent fold
 * into a signed record, a conflict resolved by preference or recency, an edit with no ancestor.
 *
 * node --test test/wardsynq-offline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { OUTCOME, OfflineError, OfflineJournal, MemoryJournalBackend, Reconciler, reconcileOne, changedFields } from "../wardsynq/wardsynq-offline.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";

function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (m) => { t += m * 60000; } };
}

const order = (over) => ({
  resourceType: "MedicationOrder", id: "rx-1", patientId: "pat-1",
  drug: "Enoxaparin 40mg", dose: { value: 40, unit: "mg" }, route: "SC",
  frequency: "daily", status: "draft", ...over,
});

async function setup(over) {
  const c = (over && over.clock) || clock("2026-09-04T12:00:00.000Z");
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const bus = (over && over.bus) || new ClinicalEventBus();
  return { store, bus, clock: c, journal: new OfflineJournal({ now: c.now }), rec: new Reconciler({ store, bus, now: c.now }) };
}

/* ------------------------------------------------------------------ the journal */

test("journal: an edit must record the version it was derived from", async () => {
  const j = new OfflineJournal({});
  await assert.rejects(() => j.record(order(), undefined, "dr-1"), (e) => {
    assert.equal(e.code, "NO_BASE");
    return true;
  }, "an edit with no ancestor cannot be three-way merged later, only guessed at");
  await assert.rejects(() => j.record(order(), null, null), (e) => { assert.equal(e.code, "NO_ACTOR"); return true; });
  await assert.rejects(() => j.record({ id: "x" }, null, "dr-1"), (e) => { assert.equal(e.code, "NO_ENTITY"); return true; });
});

test("journal: entries are snapshots and are frozen against later mutation", async () => {
  const j = new OfflineJournal({});
  const live = order();
  const entry = await j.record(live, null, "dr-1");
  live.dose = { value: 999, unit: "mg" };
  assert.equal(entry.entity.dose.value, 40, "the journal holds what was charted, not a live reference");
  assert.throws(() => { entry.actorId = "someone-else"; });
});

/* ------------------------------------------------------------------ the three-way compare */

test("three-way: only the offline side changed, so the edit lands", () => {
  const base = order();
  const r = reconcileOne({ base, local: order({ route: "IV" }), remote: order() });
  assert.equal(r.outcome, OUTCOME.APPLIED);
  assert.equal(r.merged.route, "IV");
});

test("three-way: disjoint edits on both sides are combined, and ONLY because the base says who changed what", () => {
  const base = order();
  const r = reconcileOne({
    base,
    local: order({ route: "IV" }),                 // the ward changed the route
    remote: order({ frequency: "twice daily" }),   // pharmacy changed the frequency
  });
  assert.equal(r.outcome, OUTCOME.MERGED);
  assert.equal(r.merged.route, "IV");
  assert.equal(r.merged.frequency, "twice daily", "both clinicians were right and neither is discarded");
  assert.deepEqual(r.conflicts, []);
});

test("ADVERSARIAL: the same field changed on both sides is a CONFLICT, never last-write-wins", () => {
  const base = order();
  const r = reconcileOne({
    base,
    local: order({ dose: { value: 60, unit: "mg" } }),
    remote: order({ dose: { value: 20, unit: "mg" } }),
  });
  assert.equal(r.outcome, OUTCOME.CONFLICT);
  assert.equal(r.merged, null, "there is no merged answer, because guessing one would discard a clinician's decision");
  assert.equal(r.conflicts[0].field, "dose");
  assert.equal(r.conflicts[0].local.value, 60);
  assert.equal(r.conflicts[0].remote.value, 20);
  assert.equal(r.conflicts[0].base.value, 40, "the conflict carries the ancestor so a human can see who moved");
});

test("ADVERSARIAL: a signed record is never folded into, even when the fields are disjoint", () => {
  const base = order();
  const r = reconcileOne({
    base,
    local: order({ route: "IV" }),
    remote: order({ status: "active", signedBy: "dr-menon" }),
  });
  assert.equal(r.outcome, OUTCOME.CONFLICT,
    "quietly merging an offline edit into a signed order forges the signature already on it");
  assert.match(r.reason, /signed, administered or completed/);
});

test("ADVERSARIAL: an administered record is never folded into", () => {
  const base = order();
  const r = reconcileOne({
    base,
    local: order({ route: "IV" }),
    remote: order({ administeredAt: "2026-09-04T11:30:00.000Z" }),
  });
  assert.equal(r.outcome, OUTCOME.CONFLICT, "you cannot retrospectively edit a dose that has gone into a patient");
});

test("three-way: identical edits on both sides are not a conflict", () => {
  const base = order();
  const same = order({ route: "IV" });
  const r = reconcileOne({ base, local: same, remote: order({ route: "IV" }) });
  assert.notEqual(r.outcome, OUTCOME.CONFLICT, "agreeing is not conflicting");
});

test("three-way: an entity created offline with no server version applies cleanly", () => {
  const r = reconcileOne({ base: null, local: order({ id: "rx-new" }), remote: null });
  assert.equal(r.outcome, OUTCOME.APPLIED);
});

test("three-way: bookkeeping fields do not manufacture conflicts", () => {
  const base = order();
  const r = reconcileOne({
    base,
    local: { ...order(), meta: { recordedAt: "a" }, writtenBy: { id: "x" } },
    remote: { ...order(), meta: { recordedAt: "b" }, writtenBy: { id: "y" } },
  });
  assert.equal(r.outcome, OUTCOME.UNCHANGED, "provenance differing is not two clinicians disagreeing");
  assert.deepEqual(changedFields(base, { ...base, meta: { x: 1 } }), []);
});

/* ------------------------------------------------------------------ reconnection */

test("reconnect: a full journal reconciles into applied, merged and conflicting buckets", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ id: "rx-clean" }));
  await store.put(order({ id: "rx-merge", frequency: "twice daily" }));
  await store.put(order({ id: "rx-clash", dose: { value: 20, unit: "mg" } }));

  await journal.record(order({ id: "rx-clean", route: "IV" }), order({ id: "rx-clean" }), "dr-1");
  await journal.record(order({ id: "rx-merge", route: "IV" }), order({ id: "rx-merge" }), "dr-1");
  await journal.record(order({ id: "rx-clash", dose: { value: 60, unit: "mg" } }), order({ id: "rx-clash" }), "dr-1");

  const out = await rec.reconcile(journal);
  assert.equal(out.applied.length, 1);
  assert.equal(out.merged.length, 1);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].id, "rx-clash");

  assert.equal((await store.get("MedicationOrder", "rx-clean")).route, "IV");
  assert.equal((await store.get("MedicationOrder", "rx-merge")).frequency, "twice daily", "the server's change survived");
  assert.equal((await store.get("MedicationOrder", "rx-merge")).route, "IV", "and so did the offline one");
});

test("ADVERSARIAL: a conflict is never written to the store by reconciliation", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-1");

  const out = await rec.reconcile(journal);
  assert.equal(out.conflicts.length, 1);
  const current = await store.get("MedicationOrder", "rx-1");
  assert.equal(current.dose.value, 20, "the server version stands untouched until a human decides");
  const history = await store.history("MedicationOrder", "rx-1");
  assert.equal(history.length, 1, "and nothing was quietly appended");
});

test("reconnect: a conflict carries BOTH versions and the ancestor, so nothing is lost", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-night");
  const [c] = (await rec.reconcile(journal)).conflicts;

  assert.equal(c.local.dose.value, 60);
  assert.equal(c.remote.dose.value, 20);
  assert.equal(c.base.dose.value, 40);
  assert.equal(c.offlineBy, "dr-night", "the clinician who charted offline is named");
  assert.equal(c.resolved, false);
  assert.ok(c.detectedAt);
});

test("reconnect: conflicts are announced so a ward can be told before somebody acts on the chart", async () => {
  const bus = new ClinicalEventBus();
  const raised = [];
  bus.on("offline.conflict", (e) => raised.push(e.payload));
  const { store, journal, rec } = await setup({ bus });
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-1");
  await rec.reconcile(journal);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].patientId, "pat-1");
});

test("reconnect: a dry run changes nothing", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order());
  await journal.record(order({ route: "IV" }), order(), "dr-1");
  const out = await rec.reconcile(journal, { dryRun: true });
  assert.equal(out.applied.length, 1);
  assert.equal((await store.get("MedicationOrder", "rx-1")).route, "SC", "a preview must not write");
});

test("reconnect: a hundred offline edits all survive to a decision", async () => {
  const { store, journal, rec } = await setup();
  for (let i = 0; i < 100; i++) {
    const id = `rx-${i}`;
    await store.put(order({ id, dose: { value: 20, unit: "mg" } }));
    await journal.record(order({ id, dose: { value: 60, unit: "mg" } }), order({ id }), "dr-1");
  }
  const out = await rec.reconcile(journal);
  assert.equal(out.conflicts.length, 100, "every one is surfaced; none is dropped for volume");
  assert.equal(out.applied.length + out.merged.length, 0);
});

/* ------------------------------------------------------------------ resolution */

test("ADVERSARIAL: a conflict cannot be resolved without a person and a reason", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-1");
  const [c] = (await rec.reconcile(journal)).conflicts;

  await assert.rejects(() => rec.resolve(c, { take: "local" }, null, "because"), (e) => { assert.equal(e.code, "NO_ACTOR"); return true; });
  await assert.rejects(() => rec.resolve(c, { take: "local" }, "dr-2", ""), (e) => {
    assert.equal(e.code, "NO_RATIONALE");
    return true;
  }, "somebody's charting is being discarded, so a reason is not optional");
  await assert.rejects(() => rec.resolve(c, { take: "newest" }, "dr-2", "recency"), (e) => {
    assert.equal(e.code, "NO_CHOICE");
    return true;
  }, "there is deliberately no resolve-by-recency");
});

test("resolution: the discarded version is kept on the record", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-night");
  const [c] = (await rec.reconcile(journal)).conflicts;

  await rec.resolve(c, { take: "local" }, "dr-consultant", "Night team's 60 mg is correct; weight recorded after the day dose was written.");
  const saved = await store.get("MedicationOrder", "rx-1");
  assert.equal(saved.dose.value, 60);
  assert.equal(saved.conflictResolution.by, "dr-consultant");
  assert.equal(saved.conflictResolution.took, "local");
  assert.equal(saved.conflictResolution.discarded.dose.value, 20,
    "the rejected version survives in the record, because a discarded clinical decision is evidence");
  assert.match(saved.conflictResolution.rationale, /Night team/);
  assert.equal(c.resolved, true);
});

test("resolution: a manual merge must supply the entity it merged to", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-1");
  const [c] = (await rec.reconcile(journal)).conflicts;
  await assert.rejects(() => rec.resolve(c, { take: "manual" }, "dr-2", "combined both"), (e) => { assert.equal(e.code, "NO_ENTITY"); return true; });

  const merged = await rec.resolve(c, { take: "manual", entity: order({ dose: { value: 40, unit: "mg" } }) }, "dr-2", "Split the difference after review with pharmacy.");
  assert.equal(merged.dose.value, 40);
  assert.equal(merged.conflictResolution.discarded.local.dose.value, 60, "both discarded versions are kept");
  assert.equal(merged.conflictResolution.discarded.remote.dose.value, 20);
});

test("resolution: taking the server version still records that offline work was discarded", async () => {
  const { store, journal, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));
  await journal.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-night");
  const [c] = (await rec.reconcile(journal)).conflicts;
  const saved = await rec.resolve(c, { take: "remote" }, "dr-consultant", "Day team's dose confirmed with the patient's weight.");
  assert.equal(saved.dose.value, 20);
  assert.equal(saved.conflictResolution.discarded.dose.value, 60, "the offline clinician's work is visible, not vanished");
});


/* ------------------------------------------------------------------ durability
 *
 * This is the half of HAZ-DOWN-01 that was open. Reconciliation was already sound; the journal was
 * in memory, so a workstation losing power mid-outage lost the charting it was holding. These tests
 * simulate exactly that: the process dies and a fresh journal object is opened over the same
 * storage, the way a workstation comes back after a power cut.
 */

/** Survives across "restarts" the way a disk does. */
class FakeDisk extends MemoryJournalBackend {}

test("durability: an edit is on disk BEFORE record() resolves", async () => {
  const disk = new FakeDisk();
  const j = new OfflineJournal({ backend: disk });
  await j.open();

  let onDiskAtResolve = null;
  const realAppend = disk.append.bind(disk);
  disk.append = async (entry) => {
    await realAppend(entry);
    onDiskAtResolve = (await disk.all()).length; // durable before the promise settles
  };

  await j.record(order(), null, "dr-1");
  assert.equal(onDiskAtResolve, 1,
    "a UI that reports a note saved before this resolves would be lying to a clinician");
});

test("durability: a failed write does NOT report success, and is not held in memory", async () => {
  const disk = new FakeDisk();
  disk.append = async () => { throw new Error("disk full"); };
  const j = new OfflineJournal({ backend: disk });
  await j.open();

  await assert.rejects(() => j.record(order(), null, "dr-1"), /disk full/,
    "the caller must learn the edit was not saved");
  assert.equal(j.size, 0, "and it must not sit in memory pretending to be journalled");
});

test("durability: charting survives the workstation dying mid-outage", async () => {
  const disk = new FakeDisk();
  const c = clock("2026-09-04T12:00:00.000Z");

  // A night of charting during an outage.
  const before = new OfflineJournal({ backend: disk, now: c.now });
  await before.open();
  await before.record(order({ id: "rx-1", route: "IV" }), order({ id: "rx-1" }), "dr-night");
  c.advance(5);
  await before.record(order({ id: "rx-2", dose: { value: 60, unit: "mg" } }), order({ id: "rx-2" }), "dr-night");
  assert.equal(before.size, 2);

  // The workstation loses power. Nothing is flushed, closed or cleaned up.
  const after = new OfflineJournal({ backend: disk, now: c.now });
  const restored = await after.open();

  assert.equal(restored, 2, "both edits come back");
  assert.equal(after.pending()[0].entity.route, "IV", "with their content intact");
  assert.equal(after.pending()[0].actorId, "dr-night", "and attributed to who charted them");
  assert.deepEqual(after.pending().map((e) => e.id), ["rx-1", "rx-2"], "in the order they happened");
});

test("durability: restored charting reconciles normally", async () => {
  const disk = new FakeDisk();
  const { store, rec } = await setup();
  await store.put(order({ dose: { value: 20, unit: "mg" } }));

  const before = new OfflineJournal({ backend: disk });
  await before.open();
  await before.record(order({ dose: { value: 60, unit: "mg" } }), order(), "dr-night");

  // Power cut, restart, reconnect.
  const after = new OfflineJournal({ backend: disk });
  await after.open();
  const out = await rec.reconcile(after);

  assert.equal(out.conflicts.length, 1, "work that survived a power cut still reaches a human decision");
  assert.equal(out.conflicts[0].local.dose.value, 60);
  assert.equal(out.conflicts[0].offlineBy, "dr-night");
});

test("durability: reconciled entries leave the journal, unresolved conflicts stay", async () => {
  const disk = new FakeDisk();
  const { store, rec } = await setup();
  await store.put(order({ id: "rx-clean" }));
  await store.put(order({ id: "rx-clash", dose: { value: 20, unit: "mg" } }));

  const j = new OfflineJournal({ backend: disk });
  await j.open();
  await j.record(order({ id: "rx-clean", route: "IV" }), order({ id: "rx-clean" }), "dr-1");
  await j.record(order({ id: "rx-clash", dose: { value: 60, unit: "mg" } }), order({ id: "rx-clash" }), "dr-1");

  const out = await rec.reconcile(j);
  assert.equal(out.applied.length, 1);
  assert.equal(out.conflicts.length, 1);
  assert.equal(j.size, 1, "the settled edit is gone from the journal");

  // And it is gone from DISK too, so a restart does not replay it.
  const after = new OfflineJournal({ backend: disk });
  assert.equal(await after.open(), 1,
    "a device that dies mid-reconciliation comes back holding only the unresolved work");
  assert.equal(after.pending()[0].id, "rx-clash");
});

test("durability: a dry run leaves the journal completely intact", async () => {
  const disk = new FakeDisk();
  const { store, rec } = await setup();
  await store.put(order());
  const j = new OfflineJournal({ backend: disk });
  await j.open();
  await j.record(order({ route: "IV" }), order(), "dr-1");

  await rec.reconcile(j, { dryRun: true });
  assert.equal(j.size, 1, "a preview must not consume the journal");
  const after = new OfflineJournal({ backend: disk });
  assert.equal(await after.open(), 1);
});

test("durability: a corrupted row is skipped rather than poisoning the restore", async () => {
  const disk = new FakeDisk();
  const j = new OfflineJournal({ backend: disk });
  await j.open();
  await j.record(order(), null, "dr-1");
  // Something half-written by a device that died mid-transaction.
  disk.rows.push({ garbage: true });
  disk.rows.push({ resourceType: "MedicationOrder" }); // no id, no timestamp

  const after = new OfflineJournal({ backend: disk });
  assert.equal(await after.open(), 1,
    "one unreadable row must not cost a clinician the rest of the night's charting");
});


/* ------------------------------------------------------------------ reconciliation is governed
 *
 * Reconciliation writes clinical records. Handing it a raw store would let an outage's worth of
 * charting be committed with no actor at all, which is exactly the hole the governed store exists
 * to close. Found while wiring the workstation, not by a test, so it gets a test.
 */

test("ADVERSARIAL: reconciliation through a governed handle is still governed", async () => {
  const { GovernedStore, makeActor, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  await raw.open();
  const g = new GovernedStore({ store: raw });
  const ai = makeActor({ id: "maik", kind: KIND.AI, tier: TIER.DRAFT });

  await raw.put(order({ status: "draft" }));
  const j = new OfflineJournal({ backend: new MemoryJournalBackend() });
  await j.open();
  // An offline edit that would commit an ACTIVE order.
  await j.record(order({ status: "active", signedBy: "dr-menon" }), order(), "maik");

  const rec = new Reconciler({ store: g.asStoreFor(ai) });
  // Asserted on the REASON CODE rather than on the message text. This originally matched a
  // substring and broke when the message was made more specific ("cannot commit a MedicationOrder
  // with status" rather than "a record with status"), which is a test failing over prose while the
  // behaviour it guards was unchanged.
  await assert.rejects(
    () => rec.reconcile(j),
    (err) => Array.isArray(err.reasons) && err.reasons.some((r) => r.code === "EXECUTE_DENIED"),
    "an AI's offline edit must not become an active order just because it arrived through reconciliation");
});

test("reconciliation through a credentialed clinician's handle works normally", async () => {
  const { GovernedStore, makeActor, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  await raw.open();
  const g = new GovernedStore({ store: raw });
  const doc = makeActor({ id: "dr-menon", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "NMC-1" });

  await raw.put(order());
  const j = new OfflineJournal({ backend: new MemoryJournalBackend() });
  await j.open();
  await j.record(order({ route: "IV" }), order(), "dr-menon");

  const out = await new Reconciler({ store: g.asStoreFor(doc) }).reconcile(j);
  assert.equal(out.applied.length, 1);
  assert.equal((await raw.get("MedicationOrder", "rx-1")).route, "IV");
});
