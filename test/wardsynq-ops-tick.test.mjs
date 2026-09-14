/* ops-tick.js: unacknowledged critical results escalate on their own, once per level; the outbox drains. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { runTick } from "../functions/_wardsynq/ops-tick.js";
import { stageEvent, TYPE as OUTBOX } from "../functions/_wardsynq/outbox.js";
import { StagedRepository } from "../functions/_wardsynq/staged.js";

const T = "t1";
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const loop = (id, minutesAgo, extra) => ({ resourceType: "CriticalResultLoop", id, version: 1, patientId: "p1", code: "K", display: "Potassium", value: 7.1, unit: "mmol/L",
  basis: "limit", state: "open", reportedAt: new Date(NOW - minutesAgo * 60000).toISOString(), ...(extra || {}) });

test("an unacknowledged critical result escalates once per level, says nobody was notified when no channel exists, and never touches an acknowledged one", async () => {
  const repo = new MemoryRepository();
  await repo.append(T, [loop("c-old", 240), loop("c-new", 2), loop("c-acked", 240, { state: "acknowledged", acknowledgedBy: "dr" })], {});
  const r = await runTick(repo, T, { nowMs: NOW });
  assert.equal(r.criticals.escalated, 1, JSON.stringify(r));
  const old = await repo.latest(T, "CriticalResultLoop", "c-old");
  assert.equal(old.escalatedLevel, "escalate");
  assert.equal(old.escalations.length, 1);
  assert.equal(old.escalations[0].notification.delivered, false, "no channel configured is recorded as not delivered, never as sent");
  assert.equal(old.state, "open", "escalation acknowledges nothing");
  assert.equal((await repo.latest(T, "CriticalResultLoop", "c-new")).version, 1, "a result inside its window is left alone");
  assert.equal((await repo.latest(T, "CriticalResultLoop", "c-acked")).version, 1);

  const again = await runTick(repo, T, { nowMs: NOW + 60000 });
  assert.equal(again.criticals.escalated, 0, "the same level is not escalated twice");
});

test("a delivered notification is recorded as delivered", async () => {
  const repo = new MemoryRepository();
  await repo.append(T, [loop("c1", 45)], {});
  const sent = [];
  await runTick(repo, T, { nowMs: NOW, notifyDeps: { channels: { pager: async (p) => { sent.push(p); return { delivered: true, receipt: "r1" }; } } } });
  const l = await repo.latest(T, "CriticalResultLoop", "c1");
  assert.equal(l.escalations[0].level, "overdue");
  assert.equal(l.escalations[0].notification.delivered, true);
  assert.equal(sent[0].escalation, "overdue");
});

test("the outbox drains on a tick", async () => {
  const repo = new MemoryRepository();
  const s = new StagedRepository(repo);
  await stageEvent(s, T, "consultation.saved", { encounterId: "e1" });
  await s.commit();
  const r = await runTick(repo, T, { nowMs: Date.now() + 1000 });
  assert.equal(r.outbox.ran, 1, JSON.stringify(r.outbox));
  assert.equal((await repo.latestByType(T, OUTBOX, 10))[0].status, "done");
});
