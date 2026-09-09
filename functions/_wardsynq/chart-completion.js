/* functions/_wardsynq/chart-completion.js — TASK 4.11: a real chart-completion queue.
 *
 * NOT A NEW RESOURCE TYPE. Every fact this file reports already lives somewhere: an unsigned note
 * in note-cosign.js's own `signingState`, an open critical-result loop in critical-results.js, an
 * undecided medicine in med-reconciliation.js, a scope with no recorded consent in consent.js, an
 * unreceived handover or an overdue reassessment in handover.js/risk-assessment.js, a case signed
 * out with no operative note in migrate-surgery.js, a discharge with no signed summary note. This
 * file reads those and nothing else - inventing a second "complete" flag on any of them would be
 * exactly the duplication note-cosign.js's own header already warns against for `signedBy`.
 *
 * NOTHING HERE IS HARDCODED AS A REQUIREMENT. The plan is explicit: "do not invent universal legal
 * requirements; site policy must configure them." `ctx.rules` is read verbatim from the org's own
 * `wardsynq.chartCompletion` config (the same `settings.wardsynq` a hospital already edits for
 * critical-result limits, risk tools, and note templates). A type with no rule configured is simply
 * never checked - an empty config means an empty queue, never a default one this file made up.
 *
 * DUE-NESS IS COMPUTED, NEVER STORED, the same discipline critical-results.js's own escalationOf()
 * states for the same reason: a stored "overdue" is a fact that goes stale the moment the clock
 * moves past it.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { signingState } from "./note-cosign.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";
import { escalationOf as criticalEscalationOf } from "./critical-results.js";
import { reconciliationSummary } from "./med-reconciliation.js";
import { permits } from "./consent.js";
import { reassessmentStatus } from "./risk-assessment.js";

const str = (v) => (v == null ? "" : String(v).trim());

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
 * PURE. How overdue an item is against ITS OWN rule, computed the same way critical-results.js
 * computes escalationOf(): elapsed hours against dueAfterHours/escalateAfterHours from config, never
 * a stored status. No rule (or a rule missing both thresholds) means "due" with no urgency claimed.
 */
function ruleEscalation(sinceIso, nowMs, rule) {
  const since = Date.parse(sinceIso || "");
  if (!rule || !Number.isFinite(since)) return { level: "due", hoursOpen: 0 };
  const hours = Math.max(0, ((Number.isFinite(nowMs) ? nowMs : Date.now()) - since) / 3600000);
  const escAfter = Number(rule.escalateAfterHours), dueAfter = Number(rule.dueAfterHours);
  if (Number.isFinite(escAfter) && hours >= escAfter) return { level: "escalate", hoursOpen: Math.round(hours) };
  if (Number.isFinite(dueAfter) && hours >= dueAfter) return { level: "overdue", hoursOpen: Math.round(hours) };
  return { level: "due", hoursOpen: Math.round(hours) };
}

function item(type, rule, fields) {
  return { type, responsibleRole: (rule && rule.responsibleRole) || null, ...fields };
}

async function unsignedNotes(svc, patientId, rule, nowMs) {
  const notes = await svc.byPatient("ClinicalNote", patientId).catch(() => []);
  return (notes || []).filter((n) => n && signingState(n) === "awaiting").map((n) =>
    item("unsigned-notes", rule, {
      detail: `${n.noteType || "Note"} awaiting signature`, since: n.submittedAt,
      escalation: ruleEscalation(n.submittedAt, nowMs, rule), sourceRef: { noteId: n.id },
    }));
}

async function dischargeSummaryDeficiencies(svc, patientId, rule, nowMs) {
  const encounters = await svc.byPatient("Encounter", patientId).catch(() => []);
  const finished = (encounters || []).filter((e) => e && e.status === "finished" && e.periodEnd);
  const out = [];
  for (const enc of finished) {
    const noteId = dischargeSummaryIdFor(enc.id);
    if (!noteId) continue;
    const note = await svc.get("ClinicalNote", noteId).catch(() => null);
    if (!note || signingState(note) === "draft" || signingState(note) === "awaiting") {
      out.push(item("discharge-summary", rule, {
        detail: note ? "Discharge summary not yet signed" : "No discharge summary recorded",
        since: enc.periodEnd, escalation: ruleEscalation(enc.periodEnd, nowMs, rule),
        encounterId: enc.id, sourceRef: { encounterId: enc.id, noteId },
      }));
    }
  }
  return out;
}

async function operativeDocumentation(svc, patientId, rule, nowMs) {
  const cases = await svc.byPatient("SurgicalCase", patientId).catch(() => []);
  return (cases || []).filter((c) => c && c.stage === "signed-out" && !c.operativeRecord).map((c) =>
    item("operative-documentation", rule, {
      detail: "Signed out with no operative note", since: c.signedOutAt || null,
      escalation: ruleEscalation(c.signedOutAt || null, nowMs, rule),
      encounterId: c.encounterId, sourceRef: { caseId: c.id },
    }));
}

async function resultAcknowledgement(svc, patientId, rule, nowMs, criticalPolicy) {
  const loops = await svc.byPatient("CriticalResultLoop", patientId).catch(() => []);
  return (loops || []).filter((l) => l && l.state === "open").map((l) => {
    // Reuses critical-results.js's OWN escalation policy (wsqCfg.criticalEscalation), not a second
    // one invented here - the loop is already escalated by that file; this queue only surfaces it.
    const esc = criticalEscalationOf(l, nowMs, criticalPolicy);
    return item("result-acknowledgement", rule, {
      detail: `${l.display || l.code} not yet acknowledged`, since: l.reportedAt || l.openedAt,
      escalation: { level: esc.level === "none" ? "due" : esc.level, hoursOpen: Math.round((esc.minutesOpen || 0) / 60) },
      encounterId: l.encounterId, sourceRef: { loopId: l.id },
    });
  });
}

async function medicationReconciliation(svc, patientId, rule, nowMs) {
  const recs = await svc.byPatient("MedicationReconciliation", patientId).catch(() => []);
  return (recs || []).filter((r) => r).map(reconciliationSummary).filter((s) => s.undecided > 0).map((s) =>
    item("medication-reconciliation", rule, {
      detail: `${s.undecided} medicine(s) undecided (${s.stage})`, since: s.startedAt,
      escalation: ruleEscalation(s.startedAt, nowMs, rule),
      encounterId: s.encounterId, sourceRef: { reconciliationId: s.reconciliationId },
    }));
}

async function missingConsent(svc, patientId, rule, nowMs) {
  const scopes = (rule && Array.isArray(rule.requiredScopes)) ? rule.requiredScopes : [];
  if (!scopes.length) return [];
  const consents = await svc.byPatient("PatientConsent", patientId).catch(() => []);
  const out = [];
  for (const scope of scopes) {
    const p = permits(consents, scope, nowMs);
    if (p.status === "not-recorded" || p.status === "expired") {
      out.push(item("consent", rule, {
        detail: `Consent (${scope}) ${p.status === "expired" ? "has expired" : "not recorded"}`,
        since: null, escalation: { level: "due", hoursOpen: 0 }, sourceRef: { scope },
      }));
    }
  }
  return out;
}

// Scoped exactly to the two nursing signals that already exist (per this task's own audit), never a
// guessed universal "nursing documentation" list.
async function nursingDocumentation(svc, patientId, rule, nowMs, riskTools) {
  const out = [];
  const signals = (rule && Array.isArray(rule.signals)) ? rule.signals : [];
  if (signals.includes("handover")) {
    const handovers = await svc.byPatient("ShiftHandover", patientId).catch(() => []);
    for (const h of (handovers || [])) {
      if (h && !h.receivedBy) out.push(item("nursing-documentation", rule, {
        detail: "Handover not yet received", since: h.givenAt, escalation: ruleEscalation(h.givenAt, nowMs, rule),
        encounterId: h.encounterId, sourceRef: { handoverId: h.id, signal: "handover" },
      }));
    }
  }
  if (signals.includes("risk-reassessment")) {
    const assessments = await svc.byPatient("RiskAssessment", patientId).catch(() => []);
    for (const a of (assessments || [])) {
      const tool = (riskTools || []).filter((t) => t && t.id === a.toolId)[0] || null;
      const status = reassessmentStatus(a, tool, nowMs);
      if (status.state === "overdue") out.push(item("nursing-documentation", rule, {
        detail: `${a.toolId || "Risk"} reassessment overdue by ${status.overdueHours}h`, since: a.assessedAt,
        escalation: { level: "overdue", hoursOpen: status.overdueHours },
        encounterId: a.encounterId, sourceRef: { assessmentId: a.id, signal: "risk-reassessment" },
      }));
    }
  }
  return out;
}

const DETECTORS = {
  "unsigned-notes": (svc, patientId, rule, nowMs) => unsignedNotes(svc, patientId, rule, nowMs),
  "discharge-summary": (svc, patientId, rule, nowMs) => dischargeSummaryDeficiencies(svc, patientId, rule, nowMs),
  "operative-documentation": (svc, patientId, rule, nowMs) => operativeDocumentation(svc, patientId, rule, nowMs),
  "result-acknowledgement": (svc, patientId, rule, nowMs, cfg) => resultAcknowledgement(svc, patientId, rule, nowMs, cfg.criticalPolicy),
  "medication-reconciliation": (svc, patientId, rule, nowMs) => medicationReconciliation(svc, patientId, rule, nowMs),
  "consent": (svc, patientId, rule, nowMs) => missingConsent(svc, patientId, rule, nowMs),
  "nursing-documentation": (svc, patientId, rule, nowMs, cfg) => nursingDocumentation(svc, patientId, rule, nowMs, cfg.riskTools),
};

/**
 * GET-only aggregation. ctx: { migration, patientId, rules, criticalPolicy?, riskTools?, actorDeps,
 * recordDeps }. `rules` is `wsqCfg.chartCompletion` verbatim: `{ [type]: { responsibleRole,
 * dueAfterHours, escalateAfterHours, requiredScopes?, signals? } }`. A type with no key is skipped.
 */
async function chartCompletionQueue(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", items: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, items: [] };

  const rules = (ctx.rules && typeof ctx.rules === "object") ? ctx.rules : {};
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const cfg = { criticalPolicy: ctx.criticalPolicy || null, riskTools: ctx.riskTools || [] };

  let items;
  try {
    const lists = await Promise.all(
      Object.keys(rules).filter((type) => DETECTORS[type] && rules[type])
        .map((type) => DETECTORS[type](svc, patientId, rules[type], nowMs, cfg))
    );
    items = lists.flat();
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), items: [] };
  }

  const RANK = { escalate: 0, overdue: 1, due: 2 };
  items.sort((a, b) => (RANK[a.escalation.level] - RANK[b.escalation.level]) || String(a.type).localeCompare(String(b.type)));
  return { ...base, ok: true, patientId, items, escalated: items.filter((i) => i.escalation.level === "escalate").length, overdue: items.filter((i) => i.escalation.level === "overdue").length };
}

export { ruleEscalation, chartCompletionQueue };
