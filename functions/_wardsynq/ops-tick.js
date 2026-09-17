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
import { anchorHead, anchorStoresOf } from "./audit-chain.js";
import { escalationOf } from "./critical-results.js";
import { VersionConflictError, pagedLatest } from "./repository.js";
import { dispatchLevel, smsFallbackDue } from "./push-alerts.js";

const RANK = { none: 0, due: 0, overdue: 1, escalate: 2 };
/* ponytail: no downstream consumer is registered yet, so drained events are marked done. A consumer
 * (billing, analytics, an integration) is added here by topic when one exists. */
const CONSUMERS = Object.freeze({});
/* R4-2: every loop is paged (pagedLatest). The old read was the OLDEST 500 loops, so once a hospital had 500 critical
 * results no NEW one was ever escalated. Past SCAN the newest are not read and the tick says partial. */
const SCAN = 50000;

async function escalateCriticals(repository, tenantId, opts) {
  const o = opts || {};
  const nowMs = o.nowMs || Date.now();
  const { rows: loops, capped } = await pagedLatest(repository, tenantId, "CriticalResultLoop", { max: SCAN });
  const out = { checked: 0, escalated: 0, texted: 0, conflicts: 0, partial: capped };
  for (const loop of loops || []) {
    if (!loop || loop.state !== "open") continue;
    out.checked += 1;
    const e = escalationOf(loop, nowMs, o.policy);
    const crossed = RANK[e.level] > RANK[loop.escalatedLevel || "none"];
    // S3 P0 (owner decision O4): a push no handset confirmed within its level window goes out by SMS once.
    const owedSms = o.notifyDeps && typeof o.notifyDeps.smsFallback === "function" ? smsFallbackDue(loop, nowMs, o.policy) : [];
    if (!crossed && !owedSms.length) continue;
    const at = new Date(nowMs).toISOString();
    let next = { ...loop, version: loop.version + 1, writtenBy: { id: "system:escalation", kind: "service", at } };
    if (owedSms.length) {
      const sms = await o.notifyDeps.smsFallback(loop, owedSms);
      next.notifications = (loop.notifications || []).map((n) => (n && sms[n.nid] ? { ...n, sms: sms[n.nid] } : n));
    }
    if (crossed) {
      // S3 P0: the same dispatch the decline route uses, so a notice made by the timer lands on the loop too.
      const { notification, notices } = await dispatchLevel(o.notifyDeps, loop, e.level);
      next = {
        ...next, escalatedLevel: e.level,
        escalations: [...(Array.isArray(loop.escalations) ? loop.escalations : []), { level: e.level, at, minutesOpen: e.minutesOpen, notification }],
        notifications: [...(Array.isArray(next.notifications) ? next.notifications : (loop.notifications || [])), ...notices],
      };
    }
    try { await repository.append(tenantId, [next], {}); if (crossed) out.escalated += 1; if (owedSms.length) out.texted += owedSms.length; }
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
  const stores = anchorStoresOf(o.anchorStores || o.anchorStore);
  if (!stores.length) return { status: "skipped", message: "No anchor store was handed in, so the chain head was not anchored on this run." };
  const at = new Date(o.nowMs || Date.now()).toISOString();
  /* G12: every chain (the clinical one, and the hospital event log when handed in) into every store,
   * each attempt on its own, so one store down never stops the other store getting its copy. */
  const chains = [{ label: null, repository, id: tenantId }];
  if (o.orgAuditChain) chains.push({ label: "event log", repository: o.orgAuditChain, id: o.orgAuditChain.chainId });
  if (stores.length === 1 && chains.length === 1) return anchorHead(repository, tenantId, stores[0].store, at);
  const results = [];
  for (const c of chains) for (const s of stores) {
    const where = c.label ? `${s.name} (${c.label})` : s.name;
    try { results.push({ where, status: (await anchorHead(c.repository, c.id, s.store, at)).status }); }
    catch (e) { results.push({ where, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) return { status: "failed", at, stores: results, failedIn: failed.map((r) => r.where).join(", "), error: failed.map((r) => `${r.where}: ${r.error}`).join("; ").slice(0, 200) };
  return { status: results.some((r) => r.status === "conflict") ? "conflict" : "ok", at, stores: results };
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
