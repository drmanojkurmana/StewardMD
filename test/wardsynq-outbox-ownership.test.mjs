/* Codex F4: a worker only claims and completes events of topics it has a consumer for.
 * The FHIR $export-status poll runs a tenant-wide tick with export consumers only; it must leave a
 * pending webhook event for the ordinary queue tick instead of marking it done without fan-out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { TYPE, outboxEvent, drainOutbox, outboxHealth } from "../functions/_wardsynq/outbox.js";
import { runTick } from "../functions/_wardsynq/ops-tick.js";
import { exportConsumers } from "../functions/_wardsynq/fhir-bulk.js";
import { TOPIC_EVENT } from "../functions/_wardsynq/webhook-events.js";

const T = "t1";
const rows = (repo) => repo.latestByType(T, TYPE, 100);
const stage = async (repo, topic) => { const e = outboxEvent(topic, { n: 1 }); await repo.append(T, [e], {}); return e.id; };

test("drainOutbox leaves an event whose topic this worker has no consumer for pending", async () => {
  const repo = new MemoryRepository();
  const id = await stage(repo, "webhook.event");
  const r = await drainOutbox(repo, T, { other: { c: async () => {} } });
  assert.equal(r.ran, 0);
  const [e] = await rows(repo);
  assert.equal(e.id, id);
  assert.equal(e.status, "pending");
  assert.equal(e.version, 1, "not even claimed");
  assert.equal((await outboxHealth(repo, T)).pending, 1, "still counted as waiting");
});

test("an export-only tick (the $export-status poll) does not complete a pending webhook event; the next ordinary tick fires it", async () => {
  const repo = new MemoryRepository();
  await stage(repo, TOPIC_EVENT);
  const exportOnly = exportConsumers({ repository: repo, tenantId: T, store: null, env: {} });
  const poll = await runTick(repo, T, { consumers: exportOnly });
  assert.equal(poll.outbox.ran, 0);
  assert.equal((await rows(repo))[0].status, "pending");

  const fired = [];
  const ordinary = await runTick(repo, T, { consumers: { ...exportOnly, [TOPIC_EVENT]: { "webhook-fanout": async (p) => { fired.push(p); } } } });
  assert.equal(ordinary.outbox.ran, 1);
  assert.equal(fired.length, 1, "the webhook fired on the next ordinary tick");
  assert.equal((await rows(repo))[0].status, "done");
});

test("a topic nobody consumes (consultation.saved) is still settled by any tick", async () => {
  const repo = new MemoryRepository();
  await stage(repo, "consultation.saved");
  const t = await runTick(repo, T, { consumers: exportConsumers({ repository: repo, tenantId: T, store: null, env: {} }) });
  assert.equal(t.outbox.ran, 1);
  assert.equal((await rows(repo))[0].status, "done");
});
