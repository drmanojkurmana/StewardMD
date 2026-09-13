/* functions/_wardsynq/safety-inbox.js — the one list of what needs a person, across the ward.
 *
 * NOT A NEW SOURCE OF TRUTH, AND NOT A DASHBOARD. Every item here already exists somewhere: an open
 * critical-result loop in critical-results.js, an unsigned note in note-cosign.js, an undecided
 * medicine in med-reconciliation.js, an overdue reassessment in risk-assessment.js, and the rest of
 * the detectors chart-completion.js already reads. That file does exactly this job for ONE patient;
 * this does it for the ward and sorts by who has to act.
 *
 * WHY IT HAD TO EXIST. Those facts were reachable one patient at a time, which is the wrong shape
 * for the question actually being asked. A doctor coming on shift does not ask "is patient 7's note
 * signed"; they ask "what needs me, now, anywhere on this ward". Answering that by opening thirty
 * charts is how the answer stops being looked for.
 *
 * ROLE-TAILORED, NEVER ROLE-HIDDEN. The inbox is ordered and filtered by who OWNS an item, which is
 * the hospital's own `responsibleRole` on the rule - not a judgement made here. But a role filter is
 * a convenience, never a permission: what a person may READ is decided by the record service's own
 * grant, exactly as everywhere else, and an item whose patient a reader may not read never reaches
 * this file at all. Filtering here can only ever narrow what the reader was already entitled to see.
 *
 * DUE-NESS IS COMPUTED, NEVER STORED — inherited from chart-completion.js for the reason its own
 * header gives: a stored "overdue" goes stale the moment the clock passes it.
 *
 * THE WARD IS SCANNED, AND THE COST IS SAID OUT LOUD. This reads every patient's chart to build the
 * list, which is genuinely expensive; it is capped, and when the cap bites the response says so
 * rather than quietly returning a short list that reads as a quiet ward. A truncated safety inbox
 * that looks complete is worse than no safety inbox.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { DETECTORS } from "./chart-completion.js";
import { escalationOf as criticalEscalationOf } from "./critical-results.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* How many patients one request will scan. A ward larger than this gets a truthful, explicitly
 * partial answer rather than a silently short one. */
const SCAN_CAP = 60;

/* Which roles an item belongs to when the hospital has not said. These are defaults for ORDERING,
 * never for access: every one of these items is readable by anyone who may read the chart it came
 * from, and this only decides whose inbox it appears in first. */
const DEFAULT_OWNER = {
  "critical-result": ["doctor", "nurse"],
  "unsigned-notes": ["doctor"],
  "discharge-summary": ["doctor"],
  "operative-note": ["doctor"],
  "med-reconciliation": ["doctor", "pharmacy"],
  "consent": ["doctor", "nurse"],
  "handover": ["nurse"],
  "reassessment": ["nurse"],
};

const RANK = { escalate: 0, overdue: 1, due: 2 };

/** PURE. Whose inbox an item belongs in. */
function ownersOf(item) {
  const declared = str(item && item.responsibleRole);
  if (declared) return [declared.toLowerCase()];
  return DEFAULT_OWNER[str(item && item.type)] || [];
}

/** PURE. Does this item belong to the role asking? No role asked means everything. */
function forRole(item, role) {
  const want = str(role).toLowerCase();
  if (!want) return true;
  const owners = ownersOf(item);
  // An item nobody owns is shown to everybody rather than to nobody: an unowned safety item that
  // silently appears in no inbox is the failure this whole file exists to prevent.
  if (!owners.length) return true;
  return owners.indexOf(want) >= 0;
}

/** PURE. Most urgent first, then oldest first within a level - the order a person works a list in. */
function sortItems(items) {
  return items.slice().sort((a, b) => {
    const la = RANK[a.escalation && a.escalation.level] ?? 3;
    const lb = RANK[b.escalation && b.escalation.level] ?? 3;
    if (la !== lb) return la - lb;
    return str(a.since).localeCompare(str(b.since));
  });
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * Everything on this ward that needs a person.
 *
 * ctx: { migration, rules, criticalPolicy, riskTools, role?, patients: [{patientId, name, mrn, ward, bed}] }
 * `patients` is supplied by the route from the ward list it already loads - this file does not
 * invent a second idea of who is on the ward.
 */
async function safetyInbox(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, items: [] };

  const roster = Array.isArray(ctx.patients) ? ctx.patients.filter((p) => p && str(p.patientId)) : [];
  const truncated = roster.length > SCAN_CAP;
  const scanning = truncated ? roster.slice(0, SCAN_CAP) : roster;

  const rules = (ctx.rules && typeof ctx.rules === "object") ? ctx.rules : {};
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const cfg = { criticalPolicy: ctx.criticalPolicy || null, riskTools: ctx.riskTools || [] };
  const activeTypes = Object.keys(rules).filter((t) => DETECTORS[t] && rules[t]);

  const items = [];
  const failed = [];

  for (const p of scanning) {
    const patientId = str(p.patientId);
    const who = { patientId, name: str(p.name) || null, mrn: str(p.mrn) || null, ward: str(p.ward) || null, bed: str(p.bed) || null };

    /* CRITICAL RESULTS FIRST, and independently of the hospital's chart-completion config. An
     * unacknowledged critical result is the one item that must never depend on a hospital having
     * configured a rule for it: a hospital with an empty config still has critical results. */
    try {
      const loops = (await svc.byPatient("CriticalResultLoop", patientId)) || [];
      for (const loop of loops) {
        if (!loop || str(loop.state) !== "open") continue;
        items.push({
          type: "critical-result",
          detail: `${str(loop.display) || str(loop.code)}${loop.value != null ? ` ${loop.value}${loop.unit ? ` ${loop.unit}` : ""}` : ""} — nobody has acknowledged this yet`,
          since: str(loop.reportedAt) || str(loop.openedAt) || null,
          escalation: criticalEscalationOf(loop, nowMs, cfg.criticalPolicy) || { level: "escalate" },
          sourceRef: { loopId: str(loop.id) },
          patient: who,
        });
      }
    } catch {
      /* A patient whose criticals could not be read is NAMED, never skipped silently. A safety
       * inbox that quietly drops the patient it could not read is the exact failure mode it is
       * supposed to remove. */
      failed.push({ ...who, what: "critical results" });
    }

    if (!activeTypes.length) continue;
    try {
      const lists = await Promise.all(activeTypes.map((t) => DETECTORS[t](svc, patientId, rules[t], nowMs, cfg)));
      for (const it of lists.flat()) items.push({ ...it, patient: who });
    } catch {
      failed.push({ ...who, what: "chart completion" });
    }
  }

  const role = str(ctx.role) || str(resolved.role);
  const mine = sortItems(items.filter((i) => forRole(i, role)));
  const all = sortItems(items);

  return {
    ...base, ok: true,
    role: role || null,
    items: mine,
    /* The count for EVERY role, not only this one, so a doctor can see that the ward has nursing
     * work outstanding without it cluttering their own list. */
    totalOnWard: all.length,
    escalated: mine.filter((i) => i.escalation && i.escalation.level === "escalate").length,
    overdue: mine.filter((i) => i.escalation && i.escalation.level === "overdue").length,
    scanned: scanning.length,
    ...(truncated ? {
      truncated: true,
      warning: `Only the first ${SCAN_CAP} patients were checked. This list is incomplete - do not read it as a quiet ward.`,
    } : {}),
    ...(failed.length ? {
      failed,
      warning: `${failed.length} patient${failed.length === 1 ? "" : "s"} could not be checked. This list is incomplete - do not read it as a quiet ward.`,
    } : {}),
    ...(!activeTypes.length ? {
      note: "This hospital has configured no chart-completion rules, so only critical results are listed.",
    } : {}),
  };
}

export { safetyInbox, ownersOf, forRole, sortItems, DEFAULT_OWNER, SCAN_CAP };
