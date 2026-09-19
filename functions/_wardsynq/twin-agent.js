/* functions/_wardsynq/twin-agent.js — TASK 10.18: a governed agent that drafts, and cannot act.
 *
 * ONE AGENT, DRAFT-ONLY, BY DESIGN NOT BY DISCIPLINE. The plan's own list of what an agent MAY do -
 * "prepare work queues, identify overdue items, draft notifications, prepare reports, suggest
 * resource allocation" - is entirely read-and-draft. None of those verbs need a write capability, so
 * this file is never given one: it imports no RecordService write path, calls no `.put`/`.append`
 * anywhere, and its return value is a plain object a human reads and acts on themselves. "High-risk
 * clinical, financial, identity or security actions require explicit human authorization" (plan
 * section 17) is satisfied by there being no action here at all to authorise.
 *
 * IT REUSES THE EXISTING OVERDUE DETECTORS, IT DOES NOT INVENT A NEW ONE. "Overdue" for a critical
 * result is critical-results.js's own escalationOf() (the "due -> overdue -> escalate" clock that
 * file already owns); "overdue" for a stay is patient-flow.js's own staysWithOpenItems ranking. This
 * file only reads the twin snapshot both of those already produced and turns it into one prioritised
 * list - never a second escalation policy.
 */

import { buildTwinSnapshot } from "./digital-twin.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * PURE. Drafts a prioritised work-queue report from an already-built twin snapshot. Returns a DRAFT
 * object; nothing is written, nothing is notified, nothing is assigned - a human reads this and
 * decides.
 */
function draftOverdueWorkQueue(twin) {
  if (!twin) return { ok: false, error: "no_twin", detail: "a work queue needs a real twin snapshot to draft from" };

  const items = [];

  const criticals = twin.sections.criticals;
  if (criticals.status === "ok") {
    for (const loop of (criticals.data.loops || [])) {
      if (loop.escalation && (loop.escalation.level === "overdue" || loop.escalation.level === "escalate")) {
        items.push({
          kind: "critical-result", priority: loop.escalation.level === "escalate" ? 1 : 2,
          ref: loop.loopId || null, reason: `critical result ${loop.escalation.level}: reported ${loop.reportedAt || "unknown time"}`,
          source: "critical-results.js escalationOf()",
        });
      }
    }
  } else {
    items.push({ kind: "critical-result", priority: 0, ref: null, reason: `critical-result state is UNAVAILABLE (${criticals.error}) - this queue is INCOMPLETE, not empty`, source: "digital-twin.js" });
  }

  const flow = twin.sections.flow;
  if (flow.status === "ok" && flow.data.flow) {
    for (const stay of (flow.data.flow.staysWithOpenItems || []).slice(0, 20)) {
      items.push({
        kind: "open-chart-items", priority: 3, ref: stay.encounterId,
        reason: `${stay.openItems} open item(s), ${stay.ward || "unassigned ward"} bed ${stay.bed || "unassigned"}`,
        source: "patient-flow.js pendingItems()",
      });
    }
  } else if (flow.status !== "ok") {
    items.push({ kind: "open-chart-items", priority: 0, ref: null, reason: `patient-flow state is UNAVAILABLE (${flow.error}) - this queue is INCOMPLETE, not empty`, source: "digital-twin.js" });
  }

  items.sort((a, b) => a.priority - b.priority);

  return {
    ok: true, generatedAt: new Date().toISOString(), draft: true,
    /* Said plainly, because a sorted, numbered list of clinical items is the single easiest artefact
     * in this whole file to mistake for an assignment. It is not one. */
    note: "This is a DRAFT prioritised list for a human to review. Nothing has been assigned, notified or actioned.",
    items, count: items.length,
    incomplete: items.some((i) => i.priority === 0),
  };
}

/**
 * Route-shaped wrapper: builds its OWN twin snapshot as the calling actor (so the agent can never
 * see more than the caller's own authorized read), then drafts. ctx: same shape buildTwinSnapshot
 * takes - { migration, ward?, escalationPolicy?, actorDeps, recordDeps, thresholds? }.
 */
async function prepareOverdueWorkQueue(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const twinResult = await buildTwinSnapshot(request, env, ctx);
  if (!twinResult.ok) return twinResult;
  if (!twinResult.twin) return { ...base, ok: false, status: 502, error: "twin_unavailable" };

  const drafted = draftOverdueWorkQueue(twinResult.twin);
  return { ...base, ...drafted };
}

export { draftOverdueWorkQueue, prepareOverdueWorkQueue };
