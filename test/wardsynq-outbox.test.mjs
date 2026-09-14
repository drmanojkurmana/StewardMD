/* P1.15 transactional outbox (functions/_wardsynq/outbox.js). */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module(new URL("../functions/_wardsynq/actor.js", import.meta.url).href, {
  namedExports: { resolveClinicalActor: async () => ({ actor: { id: "dr.a", scope: { write: null, read: null } }, tenant: {}, role: "doctor", source: "opd" }) },
});
const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { StagedRepository } = await import("../functions/_wardsynq/staged.js");
const { TYPE, MAX_ATTEMPTS, outboxEvent, stageEvent, drainOutbox, outboxHealth } = await import("../functions/_wardsynq/outbox.js");
const { saveConsultation } = await import("../functions/_wardsynq/consultation.js");

const T = "t1";
const events = (repo) => repo.latestByType(T, TYPE, 500);

test("INVARIANT: the business record and its event land in one append, or neither does", async () => {
  const repo = new MemoryRepository();
  const s = new StagedRepository(repo);
  await s.append(T, [{ resourceType: "Observation", id: "o1", version: 1, patientId: "p1" }], {});
  await stageEvent(s, T, "vitals.recorded", { id: "o1" });
  await s.commit();
  assert.equal((await events(repo)).length, 1);
  assert.ok(await repo.latest(T, "Observation", "o1"));

  const repo2 = new MemoryRepository();
  await repo2.append(T, [{ resourceType: "Observation", id: "o1", version: 1, patientId: "p1" }], {});
  const s2 = new StagedRepository(repo2);
  await stageEvent(s2, T, "vitals.recorded", { id: "o1" });
  s2.records.push({ resourceType: "Observation", id: "o1", version: 1, patientId: "p1" });   // a conflict the commit will hit
  await assert.rejects(() => s2.commit());
  assert.equal((await events(repo2)).length, 0, "the refused business write took its event with it");
});

test("a saved consultation carries exactly one consultation.saved event; a refused one carries none", async () => {
  const repo = new MemoryRepository();
  const writer = (type) => async (_r, _e, c) => { await c.recordDeps.repository.append(T, [{ resourceType: type, id: type + "-" + c.index, version: 1, patientId: "p1" }], {}); return { ok: true, written: 1 }; };
  const base = { migration: { mode: "native", tenantId: T }, encounterId: "enc-1", recordDeps: { repository: repo } };
  const ok = await saveConsultation({}, {}, { ...base, body: { vitals: [{}], note: {} }, writers: { vitals: writer("Observation"), note: writer("ClinicalNote") } });
  assert.equal(ok.ok, true);
  assert.equal(ok.written, 2, "the event is not counted as a clinical record");
  const evts = await events(repo);
  assert.equal(evts.length, 1);
  assert.equal(evts[0].id, ok.eventId);
  assert.deepEqual(evts[0].payload.pieces, ["vitals", "note"]);

  const bad = await saveConsultation({}, {}, { ...base, body: { vitals: [{}] }, writers: { vitals: async () => ({ ok: false, error: "x" }) } });
  assert.equal(bad.ok, false);
  assert.equal((await events(repo)).length, 1, "no event for a consultation that was not saved");
});

test("drain runs every consumer once, marks done, and never runs a finished consumer again", async () => {
  const repo = new MemoryRepository();
  const s = new StagedRepository(repo);
  await stageEvent(s, T, "consultation.saved", { encounterId: "e1" });
  await s.commit();
  const calls = { billing: 0, notify: 0 };
  const consumers = { "consultation.saved": { billing: async () => { calls.billing += 1; }, notify: async () => { calls.notify += 1; } } };
  const r = await drainOutbox(repo, T, consumers);
  assert.equal(r.report[0].status, "done");
  await drainOutbox(repo, T, consumers);
  assert.deepEqual(calls, { billing: 1, notify: 1 }, "a done event is not picked up again");
});

test("a failing consumer retries with growing waits, keeps the consumers that already succeeded, then goes dead and is reported", async () => {
  const repo = new MemoryRepository();
  const s = new StagedRepository(repo);
  await stageEvent(s, T, "consultation.saved", {});
  await s.commit();
  let clock = Date.now();
  const calls = { billing: 0, notify: 0 };
  const consumers = { "consultation.saved": { billing: async () => { calls.billing += 1; }, notify: async () => { calls.notify += 1; throw new Error("sms gateway down"); } } };

  const first = await drainOutbox(repo, T, consumers, { now: () => clock });
  assert.equal(first.report[0].status, "retry");
  assert.match(first.report[0].error, /notify: sms gateway down/);
  assert.equal((await drainOutbox(repo, T, consumers, { now: () => clock })).ran, 0, "not retried before its wait is over");

  for (let i = 1; i < MAX_ATTEMPTS; i++) { clock += 2 * 60 * 60 * 1000; await drainOutbox(repo, T, consumers, { now: () => clock }); }
  assert.equal(calls.billing, 1, "billing succeeded the first time and is never charged twice");
  assert.equal(calls.notify, MAX_ATTEMPTS);
  const h = await outboxHealth(repo, T);
  assert.equal(h.dead.length, 1, "a dead event is surfaced for a person, not dropped");
  assert.equal(h.pending, 0);
});

/* REGRESSION, 2026-09-14. The drain used to read the newest 200 events and pick out the
 * waiting ones, so one old pending event behind more than 200 newer settled events sat beyond the
 * window: never retried, never reported. The drain now seeks waiting rows by status, oldest first,
 * so the oldest waiter is found no matter how many settled events pile up in front of it. */
test("an old pending row beyond 200 newer delivered rows is still found, drained and reported", async () => {
  const repo = new MemoryRepository();
  const old = outboxEvent("consultation.saved", { encounterId: "old" }, "2026-01-01T00:00:00.000Z");
  await repo.append(T, [old]);
  for (let i = 0; i < 250; i++) {
    await repo.append(T, [{ ...outboxEvent("bulk.ping", { i }), status: "done", doneAt: "2026-06-01T00:00:00.000Z" }]);
  }

  const newest = await repo.latestByType(T, TYPE, 200, { newest: true });
  assert.ok(!newest.some((e) => e.id === old.id), "precondition: the old row sits outside the newest-200 window the drain used to read");

  const before = await outboxHealth(repo, T);
  assert.equal(before.pending, 1, "health sees the old waiter through the settled pile, not just the window");
  assert.equal(before.oldestPendingAt, "2026-01-01T00:00:00.000Z");
  assert.equal(before.partial, false, "one waiting row in a status read is a full count, not a lower bound");

  let runs = 0;
  const r = await drainOutbox(repo, T, { "consultation.saved": { billing: async () => { runs += 1; } } });
  assert.equal(runs, 1, "the old pending event is drained despite 250 newer settled events");
  assert.equal(r.ran, 1);
  assert.equal(r.report[0].id, old.id);
  assert.equal(r.report[0].status, "done");

  assert.equal((await outboxHealth(repo, T)).pending, 0, "nothing waiting after the drain");
});

test("outboxHealth calls a bounded read that filled up a lower bound, not a count", async () => {
  const repo = new MemoryRepository();
  for (let i = 0; i < 6; i++) await repo.append(T, [outboxEvent("bulk.ping", { i })]);
  const full = await outboxHealth(repo, T, 50);
  assert.equal(full.pending, 6);
  assert.equal(full.partial, false);
  const bounded = await outboxHealth(repo, T, 5);
  assert.equal(bounded.pending, 5);
  assert.equal(bounded.partial, true, "a filled bound means more may wait beyond it");
});

test("two workers draining at once: one claims, the other skips, the consumer runs once", async () => {
  const repo = new MemoryRepository();
  const s = new StagedRepository(repo);
  await stageEvent(s, T, "consultation.saved", {});
  await s.commit();
  let runs = 0;
  const slow = { "consultation.saved": { billing: async () => { runs += 1; await new Promise((r) => setTimeout(r, 5)); } } };
  const [a, b] = await Promise.all([drainOutbox(repo, T, slow), drainOutbox(repo, T, slow)]);
  assert.equal(runs, 1);
  assert.equal([...a.report, ...b.report].filter((x) => x.skipped === "claimed_elsewhere").length, 1);
});
