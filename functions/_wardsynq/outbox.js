/* functions/_wardsynq/outbox.js — "the clinical change and the event about it land together, or neither".
 *
 * THE PROBLEM. A consultation is saved, and billing, notifications, analytics and integrations each need
 * to hear about it. Calling them after the save loses the event whenever the process dies in between;
 * calling them before announces a save that may still fail. Both are silent.
 *
 * THE PATTERN (transactional outbox). An event is a row of its own internal type, written in the SAME
 * repository.append() as the business records - through a StagedRepository, so one atomic batch carries
 * both. Consumers run later: drainOutbox() claims a pending event by writing its next version (the
 * repository's version uniqueness means two workers cannot both claim it), runs the consumer, and records
 * done, a retry with backoff, or dead after too many failures. Consumers that succeeded are recorded per
 * event, so a RETRY does not re-run them. Delivery is still AT LEAST ONCE: a worker that dies after a
 * consumer ran but before recording it hands the event on (a claim older than ten minutes is taken over),
 * and that consumer runs again. Consumers must therefore be idempotent on the event id.
 *
 * The type is internal (underscore-prefixed, like the bed claim): never served through the record API.
 * ponytail: drains the newest `limit` events per call; add a status index if a backlog ever outgrows it.
 */

import { VersionConflictError } from "./repository.js";

const TYPE = "_wardsynq_outbox";
const MAX_ATTEMPTS = 6;
const backoffMs = (attempt) => Math.min(60 * 60 * 1000, 30 * 1000 * 2 ** (attempt - 1));   // 30s, 1m, 2m ... capped at 1h

let seq = 0;
/** An event record ready to stage beside business records. */
function outboxEvent(topic, payload, at) {
  const when = at || new Date().toISOString();
  seq = (seq + 1) % 1e6;
  return {
    resourceType: TYPE, id: `evt-${Date.parse(when).toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, version: 1,
    topic: String(topic), payload: payload || {}, status: "pending", attempts: 0, consumers: {}, nextAttemptAt: when, createdAt: when,
    writtenBy: { id: "system:outbox", kind: "service", at: when },
  };
}

/** Stage an event into an open unit of work (StagedRepository). It commits, or not, with everything else. */
async function stageEvent(staged, tenantId, topic, payload) {
  const evt = outboxEvent(topic, payload);
  await staged.append(tenantId, [evt], {});
  return evt.id;
}

/**
 * Run pending events. consumers: { [topic]: { [consumerName]: async (payload, event) => void } }.
 * Returns what happened, per event. Safe to run concurrently: a lost claim is skipped, not repeated.
 */
async function drainOutbox(repository, tenantId, consumers, opts) {
  const o = opts || {};
  const nowMs = o.now ? o.now() : Date.now();
  const rows = await repository.latestByType(tenantId, TYPE, o.limit || 200);
  // A claim older than ten minutes belongs to a worker that died; the event is taken over, not stranded.
  const stale = (e) => e.status === "running" && Date.parse(e.claimedAt) + 10 * 60 * 1000 <= nowMs;
  const due = rows.filter((e) => ((e.status === "pending" || e.status === "retry") && Date.parse(e.nextAttemptAt) <= nowMs) || stale(e))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const report = [];
  for (const evt of due) {
    const at = new Date(nowMs).toISOString();
    // CLAIM: the next version. A second worker computing the same version loses with a conflict.
    const claimed = { ...evt, version: evt.version + 1, status: "running", claimedAt: at };
    try { await repository.append(tenantId, [claimed], {}); }
    catch (e) { if (e instanceof VersionConflictError) { report.push({ id: evt.id, skipped: "claimed_elsewhere" }); continue; } throw e; }

    const handlers = consumers[evt.topic] || {};
    const done = { ...(evt.consumers || {}) };
    let error = null;
    for (const [name, fn] of Object.entries(handlers)) {
      if (done[name]) continue;                               // already ran for this event: never twice
      try { await fn(evt.payload, evt); done[name] = at; }
      catch (e) { error = `${name}: ${String((e && e.message) || e).slice(0, 200)}`; break; }
    }
    const attempts = evt.attempts + (error ? 1 : 0);
    const next = error
      ? { ...claimed, version: claimed.version + 1, consumers: done, attempts, lastError: error,
          status: attempts >= MAX_ATTEMPTS ? "dead" : "retry", nextAttemptAt: new Date(nowMs + backoffMs(attempts)).toISOString() }
      : { ...claimed, version: claimed.version + 1, consumers: done, status: "done", doneAt: at };
    await repository.append(tenantId, [next], {});
    report.push({ id: evt.id, topic: evt.topic, status: next.status, ...(error ? { error } : {}) });
  }
  return { ran: report.filter((r) => !r.skipped).length, report };
}

/** Events that need a person: dead ones, and how many are still waiting. Never "all clear" on a partial read. */
async function outboxHealth(repository, tenantId, limit) {
  const rows = await repository.latestByType(tenantId, TYPE, limit || 500);
  return {
    pending: rows.filter((e) => e.status === "pending" || e.status === "retry" || e.status === "running").length,
    dead: rows.filter((e) => e.status === "dead").map((e) => ({ id: e.id, topic: e.topic, attempts: e.attempts, lastError: e.lastError })),
    partial: rows.length >= (limit || 500),
  };
}

export { TYPE, MAX_ATTEMPTS, backoffMs, outboxEvent, stageEvent, drainOutbox, outboxHealth };
