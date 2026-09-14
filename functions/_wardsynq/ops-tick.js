/* functions/_wardsynq/ops-tick.js — the work nobody asks for: escalating unacknowledged critical
 * results, and running the transactional outbox.
 *
 * Before this, escalationOf() only ever ran when somebody opened a board, so a potassium of 7 that
 * nobody acknowledged was "escalate" on a screen nobody was looking at and was never told to anyone
 * again. And drainOutbox() was called by nothing, so an event staged beside a consultation stayed
 * pending forever. Both now run here, against a tenant's repository, with no request and no user.
 *
 * WHO CALLS IT is deliberately not this file's business. The router runs it in the background on
 * ordinary ward traffic, at most once per window per hospital, and an external scheduler can call it
 * directly. Nothing here knows about Cloudflare, a cron, or a clock other than the one it is given.
 *
 * ESCALATION IS RECORDED ON THE LOOP, once per level. Crossing "overdue" and crossing "escalate" each
 * append one entry saying when, how long it had been open, and what the notification attempt did.
 * A hospital with no notification channel configured gets "no channel" written down, never "sent".
 * A clinician's acknowledgement written at the same moment wins: the append is on the next version,
 * so it conflicts and this loop is simply left for the next tick. Nothing here acknowledges anything.
 */

import { drainOutbox } from "./outbox.js";
import { anchorHead } from "./audit-chain.js";
import { escalationOf } from "./critical-results.js";
import { VersionConflictError } from "./repository.js";
import { Dispatcher, NotifyError } from "../../wardsynq/wardsynq-notify.js";

const RANK = { none: 0, due: 0, overdue: 1, escalate: 2 };
/* ponytail: no downstream consumer is registered yet, so drained events are marked done. A consumer
 * (billing, analytics, an integration) is added here by topic when one exists. */
const CONSUMERS = Object.freeze({});
const SCAN = 500;

async function escalateCriticals(repository, tenantId, opts) {
  const o = opts || {};
  const nowMs = o.nowMs || Date.now();
  const loops = await repository.latestByType(tenantId, "CriticalResultLoop", SCAN);
  const out = { checked: 0, escalated: 0, conflicts: 0, partial: loops.length >= SCAN };
  for (const loop of loops || []) {
    if (!loop || loop.state !== "open") continue;
    out.checked += 1;
    const e = escalationOf(loop, nowMs, o.policy);
    if (RANK[e.level] <= RANK[loop.escalatedLevel || "none"]) continue;
    let notification;
    try {
      const sent = await new Dispatcher(o.notifyDeps || {}).send({ loopId: loop.id, patientId: loop.patientId, code: loop.code, display: loop.display, value: loop.value, unit: loop.unit, escalation: e.level }, undefined, { retries: 2 });
      notification = { attempted: true, delivered: sent.delivered, channels: sent.attempts.map((a) => ({ channel: a.channel, delivered: a.delivered, detail: a.detail })) };
    } catch (err) {
      notification = { attempted: true, delivered: false, reason: err instanceof NotifyError ? err.code : "NOTIFY_ERROR", detail: String((err && err.message) || err).slice(0, 200) };
    }
    const at = new Date(nowMs).toISOString();
    const next = {
      ...loop, version: loop.version + 1, escalatedLevel: e.level,
      escalations: [...(Array.isArray(loop.escalations) ? loop.escalations : []), { level: e.level, at, minutesOpen: e.minutesOpen, notification }],
      writtenBy: { id: "system:escalation", kind: "service", at },
    };
    try { await repository.append(tenantId, [next], {}); out.escalated += 1; }
    catch (err) { if (err instanceof VersionConflictError) { out.conflicts += 1; continue; } throw err; }
  }
  return out;
}

/* ANCHORING RIDES ON THE TICK BUT NEVER RISKS IT. Copying the audit-chain head outside the
 * database is housekeeping: when the copy fails (KV down, head unreadable) the failure is recorded
 * on result.anchor for the tick log, and the tick still reports its clinical halves. Callers hand in
 * opts.anchorStore only when an anchor is due (hourly, decided beside the tick gate); without one
 * the step reports skipped and writes nothing. */
async function anchorTick(repository, tenantId, opts) {
  const o = opts || {};
  if (!o.anchorStore) return { status: "skipped", message: "No anchor store was handed in, so the chain head was not anchored on this run." };
  return anchorHead(repository, tenantId, o.anchorStore, new Date(o.nowMs || Date.now()).toISOString());
}

/** One pass for one hospital. Each third is reported on its own; one failing does not hide the others. */
async function runTick(repository, tenantId, opts) {
  const o = opts || {};
  const result = { tenantId, at: new Date(o.nowMs || Date.now()).toISOString() };
  try { result.criticals = await escalateCriticals(repository, tenantId, o); }
  catch (e) { result.criticals = { error: String((e && e.message) || e).slice(0, 200) }; }
  try { result.outbox = await drainOutbox(repository, tenantId, o.consumers || CONSUMERS, { now: () => o.nowMs || Date.now() }); }
  catch (e) { result.outbox = { error: String((e && e.message) || e).slice(0, 200) }; }
  try { result.anchor = await anchorTick(repository, tenantId, o); }
  catch (e) { result.anchor = { error: String((e && e.message) || e).slice(0, 200) }; }
  return result;
}

export { RANK, escalateCriticals, runTick };
