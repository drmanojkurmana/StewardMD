/* functions/_wardsynq/system-health.js - P2.15: what is broken right now, and what that means on a ward.
 *
 * ONE REAL PROBE PER DEPENDENCY, EACH UNDER A SHORT TIMEOUT. A status that was not measured is not a
 * status: every entry here is the result of a call made for this report (or, for document storage, the
 * router's own round-trip probe, cached ten minutes and stamped with when it actually ran).
 *
 * NEVER GREEN ON A FAILED OR SLOW PROBE. A probe that throws, times out or returns nothing is "down".
 * "up" is only ever produced from a probe that answered and said so.
 *
 * EVERY NON-GREEN LINE SAYS WHAT STAFF WILL SEE, in plain words, and whether charting continues. An
 * administrator reading this at 3am needs the consequence, not the error code.
 *
 * NO SECRETS AND NO INTERNAL ADDRESSES. Reasons are this file's own sentences. A provider's error text is
 * never copied through, because it can echo a request URL or a key back.
 *
 * STORAGE-AGNOSTIC. The router hands in the probes that touch the org store, document storage and the
 * background-run log; this file calls only the repository port and the MaiK gateway's own config.
 */

import { outboxHealth } from "./outbox.js";
import { dataProtection, RESTORE_TYPE } from "./security-review.js";
import { RUN_TYPE } from "./backup-run.js";
import { maikConfig, geminiKey } from "./maik-gateway.js";
import { verifyAuditChain } from "./audit-chain.js";

const TIMEOUT_MS = 3000;
const MIN = 60000;
/* Thresholds, returned on the report so a reader can see what "degraded" meant. */
const LIMITS = Object.freeze({ auditChainRows: 200, recordSlowMs: 1500, outboxDegradedMinutes: 15, outboxDownMinutes: 60, tickDegradedMinutes: 15, tickDownMinutes: 60 });

class ProbeTimeout extends Error {}

/** Resolves with fn's result, or rejects with ProbeTimeout after ms. */
function withTimeout(fn, ms) {
  let timer;
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new ProbeTimeout("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const up = (reason) => ({ status: "up", reason: reason || null });
const degraded = (reason) => ({ status: "degraded", reason });
const down = (reason) => ({ status: "down", reason });
const ageMinutes = (iso, nowMs) => Math.round((nowMs - Date.parse(iso)) / MIN);

/* The dependencies, in the order a ward would feel them. `consequence` is what staff see. */
const DEPENDENCIES = [
  {
    id: "record-store", name: "Patient record store",
    consequence: {
      down: "Patient record store down: charts cannot be opened and nothing can be saved, including observations and medicines given. Use paper charts and the last printed downtime pack, and enter what was done once it is back.",
      degraded: "Patient record store slow: charts open and save slowly. Charting continues; do not repeat a save that is still in progress.",
    },
    async check(d) {
      const p = await d.repository.probe();
      if (!p || !p.ok) return down((p && p.detail) || "The record store could not be queried.");
      return p.ms > LIMITS.recordSlowMs ? degraded(`The record store answered in ${p.ms} ms.`) : up();
    },
  },
  {
    id: "org-store", name: "Hospital, staff and sign-in store",
    consequence: {
      down: "Hospital and staff store down: sign-in fails and ward screens refuse requests, because every request checks staff access there. Use paper charts and the last printed downtime pack.",
      degraded: "Hospital and staff store slow: sign-in and every screen are slow.",
    },
    async check(d) {
      const org = await d.orgProbe();
      return org ? up() : down("This hospital's settings could not be read from the store.");
    },
  },
  {
    id: "document-storage", name: "Document storage",
    consequence: {
      down: "Document storage down: uploads fail and existing documents cannot be opened; charting continues.",
      degraded: "Document storage unreliable: some uploads or document views may fail; charting continues.",
    },
    async check(d) {
      const r = await d.documentProbe();
      const at = r && r.checkedAt;
      if (!r) return down("The storage check returned nothing.");
      if (r.state === "ok") return { ...up(), checkedAt: at };
      if (r.state === "not_configured") return { ...down("Document storage is not configured for this deployment."), checkedAt: at };
      return { ...down(`Storage refused the ${r.step || "unknown"} step of a test save${r.providerStatus ? " (status " + Number(r.providerStatus) + ")" : ""}.`), checkedAt: at };
    },
  },
  {
    id: "maik-gateway", name: "MaiK clinical AI",
    consequence: {
      down: "MaiK down: AI summaries and drafts fail. Charting, prescribing and safety checks continue without it.",
      degraded: "MaiK limited: AI summaries and drafts may fail or be unavailable. Charting, prescribing and safety checks continue without it.",
    },
    async check(d) {
      const cfg = maikConfig(d.maik);
      if (!cfg.enabled) return degraded("MaiK is turned off for this hospital.");
      const fetchImpl = d.fetchImpl || fetch;
      const probes = [];
      const key = geminiKey(d.env);
      /* A model metadata read: it proves the key and the service answer, and generates nothing. */
      if (key) probes.push(["Google model service", () => fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash", { headers: { "x-goog-api-key": key } })]);
      if (cfg.localBaseUrl && cfg.localModel) probes.push(["hospital model server", () => fetchImpl(`${cfg.localBaseUrl.replace(/\/+$/, "")}/models`)]);
      if (!probes.length) return down("MaiK is on but no model provider is configured.");
      const results = await Promise.all(probes.map(([label, fn]) => fn().then((res) => [label, !!(res && res.ok)], () => [label, false])));
      const failed = results.filter((x) => !x[1]).map((x) => x[0]);
      if (!failed.length) return up();
      return failed.length === results.length ? down(`No model provider answered (${failed.join(", ")}).`) : degraded(`Not answering: ${failed.join(", ")}.`);
    },
  },
  {
    id: "outbox", name: "Background event queue",
    consequence: {
      down: "Background event queue stalled: follow-on events queued with saved consultations are not being processed. Saved clinical records are not affected; charting continues.",
      degraded: "Background event queue behind: follow-on events are waiting or some have failed for good. Saved clinical records are not affected; charting continues.",
    },
    async check(d, nowMs) {
      const h = await outboxHealth(d.repository, d.tenantId, 500);
      const age = h.oldestPendingAt ? ageMinutes(h.oldestPendingAt, nowMs) : 0;
      if (age >= LIMITS.outboxDownMinutes) return down(`The oldest waiting event has waited ${age} minutes.`);
      const notes = [];
      if (age >= LIMITS.outboxDegradedMinutes) notes.push(`the oldest waiting event has waited ${age} minutes`);
      if (h.dead.length) notes.push(`${h.dead.length} event${h.dead.length === 1 ? " has" : "s have"} failed for good`);
      if (h.partial) notes.push("only the newest 500 events were checked");
      return notes.length ? degraded(notes.join("; ") + ".") : up(h.pending ? `${h.pending} waiting, oldest ${age} minutes.` : "Nothing waiting.");
    },
  },
  {
    id: "ops-tick", name: "Background run (critical-result escalation)",
    consequence: {
      down: "Background run not happening: unacknowledged critical results are not escalated again and queued events wait. Phone critical results to the responsible clinician directly.",
      degraded: "Background run late or partly failing: escalation of unacknowledged critical results may be delayed. Phone critical results to the responsible clinician directly.",
    },
    async check(d, nowMs) {
      const t = await d.lastTick();
      if (t === undefined) return down("This deployment has nowhere to record background runs, so none can be confirmed.");
      if (!t || !Number.isFinite(Date.parse(t.at))) return down("No background run has been recorded.");
      const age = ageMinutes(t.at, nowMs);
      if (age >= LIMITS.tickDownMinutes) return down(`The last background run was ${age} minutes ago.`);
      const notes = [];
      if (t.criticalsFailed) notes.push("critical-result escalation failed on the last run");
      if (t.outboxFailed) notes.push("event processing failed on the last run");
      if (age >= LIMITS.tickDegradedMinutes) notes.push(`the last run was ${age} minutes ago`);
      return notes.length ? degraded(notes.join("; ") + ".") : up(`Last run ${age} minutes ago.`);
    },
  },
  {
    id: "backup", name: "Backup and restore test",
    consequence: {
      down: "No usable backup evidence: if the record store were lost, recent records might not be recoverable. Nothing changes on the ward today; charting continues.",
      degraded: "Backup evidence incomplete: recovery of recent records is not confirmed. Nothing changes on the ward today; charting continues.",
    },
    async check(d, nowMs) {
      const [runs, tests] = await Promise.all([d.repository.latestByType(d.tenantId, RUN_TYPE, 50), d.repository.latestByType(d.tenantId, RESTORE_TYPE, 200)]);
      const p = dataProtection(runs, tests, d.rpoMinutes, new Date(nowMs).toISOString());
      const reason = p.reasons.join(" ") || null;
      return p.status === "green" ? up(`Last backup ${p.lastBackup.at}; last restore test ${p.lastRestoreTest.at}.`) : p.status === "amber" ? degraded(reason) : down(reason);
    },
  },
  {
    /* P2.17. The newest rows of the tamper-evident audit chain, re-hashed. Not verified counts as down:
     * an integrity nobody could check is not an integrity anybody can rely on. */
    id: "audit-chain", name: "Audit trail integrity",
    consequence: {
      down: "Audit trail integrity not confirmed: audit rows may have been changed or removed in the database, or the check could not run. Charting continues and nothing is blocked. Tell the information governance lead, and do not restore or re-import the database until the audit trail has been examined.",
    },
    async check(d) {
      const v = await verifyAuditChain(d.repository, d.tenantId, { limit: LIMITS.auditChainRows });
      return v.status === "ok" || v.status === "empty" ? up(v.message) : down(v.message);
    },
  },
];

/**
 * deps: { repository, tenantId, env, maik, rpoMinutes, orgProbe(), documentProbe(), lastTick(),
 *   fetchImpl?, timeoutMs?, now?() }
 */
async function systemHealthReport(deps) {
  const ms = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : TIMEOUT_MS;
  const now = () => (deps.now ? deps.now() : Date.now());
  const dependencies = await Promise.all(DEPENDENCIES.map(async (dep) => {
    let r;
    try { r = await withTimeout(() => dep.check(deps, now()), ms); }
    catch (e) { r = down(e instanceof ProbeTimeout ? `No answer within ${ms} ms.` : "The check failed before it could answer."); }
    if (!r || !["up", "degraded", "down"].includes(r.status)) r = down("The check returned no result.");
    return { id: dep.id, name: dep.name, status: r.status, checkedAt: r.checkedAt || new Date(now()).toISOString(), reason: r.reason || null, consequence: r.status === "up" ? null : dep.consequence[r.status] };
  }));
  const worst = dependencies.some((x) => x.status === "down") ? "down" : dependencies.some((x) => x.status === "degraded") ? "degraded" : "up";
  return { ok: true, generatedAt: new Date(now()).toISOString(), overall: worst, dependencies, timeoutMs: ms, limits: LIMITS };
}

export { TIMEOUT_MS, LIMITS, DEPENDENCIES, withTimeout, systemHealthReport };
