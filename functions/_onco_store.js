/* StewardMD - Oncology treatment-plan store.
 * PHASE 0: pure id/scoping helpers (sanitize/newId/_cycleId), import-safe for Node tests.
 * PHASE 2: Firestore I/O for q_onco_plans / q_onco_cycles / q_onco_admin, layered over those pure
 * helpers + the Phase 1 dose engine (onco-dose.js). Mirrors functions/_opd_org_store.js conventions
 * (fsGet/fsCommit/wCreate/wUpdate, qAudit). ES module to match _fbfirestore.js/_opd_org_store.js.
 *
 * SAFETY (spec, non-negotiable): suggest-and-confirm, no auto-order. Every override of a calculated
 * dose requires a typed reason (_recordOverride throws otherwise - enforced at the data layer, not
 * just the UI). Version-lock by SNAPSHOT: a plan copies the whole template into lockedTemplate at
 * creation and never re-reads it, so publishing a newer template can never alter an existing plan.
 * Administration records are append-only (q_onco_admin is never mutated after a row is written).
 * Every mutating fn audits via qAudit with ONLY non-PHI meta: MRN (ghisPatientId) scoping + dose
 * numbers, NEVER patient name/mobile.
 *
 * TESTABILITY: every persistence fn takes an optional trailing `deps` object {fsGet,fsCommit,wCreate,
 * wUpdate,qAudit} so node --test can inject fakes and run the whole plan -> cycle -> admin flow
 * without touching real Firestore. Defaults to the real imports; production callers never pass deps.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
// onco-dose.js is a root-level UMD/CommonJS module (module.exports, no ESM export) - same shape as
// followcare-comms.js / followcare-pathways.js, which functions/_followcare_comms.js already imports
// the identical way (`import Comms from "../followcare-comms.js"`). Re-using that proven interop path
// instead of re-deriving the dose math here (never re-derive; onco-dose.js is R1-cleared).
import ONCODOSE from "../onco-dose.js";

function sanitize(x) { return String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80); }
function newId() { return crypto.randomUUID().replace(/-/g, ""); }

// Deterministic cycle-instance id so a plan's cycle is idempotent to write/read.
// Mirrors memberId(): sanitize(planId) + "__" + cycleNo. Non-doc-id chars (e.g. "/") become "-".
function _cycleId(planId, cycleNo) { return sanitize(planId) + "__" + String(cycleNo); }

// ---- pure helpers (no Firestore, no env) --------------------------------------------------------

// Version-lock by snapshot: a deep copy of the template, taken once at plan creation. A later
// mutation of the source template object (or a newer published version) can never reach back into
// an already-created plan because the plan only ever holds this copy.
function _snapshot(template) { return structuredClone(template); }

// Override-needs-reason, enforced at the DATA layer (not just a UI disabled-button). Throws on an
// empty/whitespace reason so a bad override can never be persisted, regardless of caller.
function _recordOverride(o) {
  o = o || {};
  const reason = String(o.reason == null ? "" : o.reason).trim();
  if (!reason) throw new Error("override_reason_required");
  return { drugId: o.drugId != null ? String(o.drugId) : "", was: o.was, now: o.now, reason: reason, by: o.by || "", at: o.at != null ? o.at : Date.now() };
}

// PHASE E: one immutable audit-history row per override, appended to plan.auditHistory in confirmPlan.
// `original` is the SERVER'S OWN calculated dose (plan.calculatedDoses) - never the client-supplied
// `was` - so the true pre-override calculation is what is recorded and can never be overwritten. The
// modified value + typed reason + physician + server timestamp complete the {field,original,modified,
// reason,physicianId,timestampServer} shape. This APPENDS; the original lineage is left fully intact.
function _auditEntry(mod, calc, at) {
  mod = mod || {};
  const original = (calc && calc.final != null) ? calc.final : (mod.was != null ? mod.was : null);
  return { field: "dose:" + (mod.drugId || ""), original: original, modified: mod.now, reason: mod.reason, physicianId: mod.by || "", timestampServer: at != null ? at : Date.now() };
}

// Any field still carrying the literal "VERIFY" sentinel (schema: an unresolved VERIFY blocks ACTIVE).
// Deep-scans a snapshot so a nested VERIFY (e.g. a drug dose) can never slip through the activation gate.
function _deepHasVerify(v) {
  if (v === "VERIFY") return true;
  if (Array.isArray(v)) return v.some(_deepHasVerify);
  if (v && typeof v === "object") return Object.keys(v).some((k) => _deepHasVerify(v[k]));
  return false;
}

// PHASE F pre-activation gate (fail-closed): a Treatment Plan may only be activated when ALL hold -
// (1) required dose calculations complete (every drug resolves to a non-null final dose), (2) required
// source evidence present (>=1 core evidence entry), (3) required clearance information available (the
// snapshotted protocol declares its clearance checks), (4) NO unresolved mandatory VERIFY on the
// snapshotted protocol, (5) physician confirmation explicitly recorded. Returns every blocker (not just
// the first) so the UI can show the whole checklist. NEVER auto-passes - a missing physicianConfirmed
// alone blocks, so activation can never be automatic. Pure + exported for direct unit testing.
function _activationGate(plan, opts) {
  plan = plan || {}; opts = opts || {};
  const blockers = [];
  const tmpl = plan.lockedTemplate || {};
  const drugs = tmpl.drugs || (tmpl.regimen && tmpl.regimen.drugs) || [];
  const doses = (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses : (plan.calculatedDoses || []);
  const byDrug = {}; doses.forEach((d) => { if (d && d.drugId) byDrug[d.drugId] = d; });
  if (!(drugs.length > 0 && drugs.every((dr) => { const d = byDrug[dr.id]; return !!(d && d.final != null); }))) blockers.push("dose_calculations_incomplete");
  const ev = plan.evidenceSnapshot || tmpl.evidence || null;
  if (!(ev && ev.core && ev.core.length)) blockers.push("source_evidence_missing");
  if (!((tmpl.clearanceChecks || []).length)) blockers.push("clearance_info_missing");
  if ((tmpl.verifyFields || []).length || _deepHasVerify(tmpl)) blockers.push("unresolved_verify");
  if (!opts.physicianConfirmed) blockers.push("physician_confirmation_missing");
  return { ok: blockers.length === 0, blockers: blockers };
}

// Lean v1 cycle state machine (spec R5): DUE/CLEARANCE/PHYSICIAN-CONFIRMED/READY/ADMINISTRATION/
// COMPLETED collapse into these 5 states. `held` is reachable from any live state (hold/delay/cancel
// + reason) but is terminal in v1 - resuming a held cycle is a future workflow gap, not modelled yet.
const CYCLE_STATES = ["planned", "ready", "administering", "done", "held"];
const CYCLE_TRANSITIONS = {
  planned: ["ready", "held"],
  ready: ["administering", "held"],
  administering: ["done", "held"],
  done: [],
  held: [],
};
function _canTransition(from, to) { return !!(CYCLE_TRANSITIONS[from] && CYCLE_TRANSITIONS[from].indexOf(to) > -1); }

// ---- Firestore I/O (env-taking; deps-injectable for tests) --------------------------------------

const REAL_DEPS = { fsGet, fsQuery, fsCommit, wCreate, wUpdate, qAudit };

// PHI-free audit: hospitalId scoping, actor id, action, and a JSON meta blob that may carry MRN
// (ghisPatientId - explicitly allowed, spec R1) and dose numbers, but NEVER patient name/mobile.
function auditOnco(io, env, hospitalId, actor, action, meta) {
  return io.qAudit(env, { hospitalId: hospitalId || "", ticketId: "", actor: actor || "", action, meta: JSON.stringify(meta || {}) });
}

export async function createPlan(env, body, template, deps) {
  const io = deps || REAL_DEPS;
  body = body || {};
  const id = newId();
  const snap = _snapshot(template);
  const patientParams = body.patientParams || {};
  const calculatedDoses = ONCODOSE.planDoses(snap, patientParams);
  const now = Date.now();
  const f = {
    planId: id,
    hospitalId: sanitize(body.hospitalId || body.orgId || ""),
    orgId: sanitize(body.orgId || body.hospitalId || ""),
    doctorUid: String(body.doctorUid || ""),
    ghisPatientId: String(body.ghisPatientId || ""),
    protocolId: String(body.protocolId || (template && template.id) || ""),
    lockedVersion: String((template && template.version) || ""),
    lockedTemplate: snap,
    intent: String(body.intent || ""),
    patientParams: patientParams,
    calculatedDoses: calculatedDoses,
    physicianModifications: [],
    confirmedDoses: [],
    plannedCycles: Number((template && template.cycles) || 0),
    plannedDates: [],
    status: "draft",   // "planned" in the plan lifecycle; kept as "draft" (draft -> active on CONFIRM & ACTIVATE)
    confirmations: [],
    createdAt: now,
    updatedAt: now,
    // PHASE F persistence: source protocol + IMMUTABLE version snapshot (lockedTemplate is the frozen
    // copy; sourceProtocolId/Version name it explicitly), patient phenotype, the exact evidence shown at
    // selection, patient parameters + full dose lineage, and the multi-tenant hospital binding. hospitalId
    // / hospitalImplementationVersion are null when no hospital overlay applies (global protocol); NO
    // hospital is ever hard-coded. auditHistory accumulates every override (see confirmPlan).
    sourceProtocolId: String(body.protocolId || (template && template.id) || ""),
    sourceProtocolVersion: String((template && template.version) || ""),
    patientPhenotype: body.patientPhenotype || {},
    evidenceSnapshot: body.evidenceSnapshot || (snap && snap.evidence) || null,
    patientParameters: patientParams,
    doseLineage: calculatedDoses,
    hospitalImplementationVersion: body.hospitalImplementationVersion != null ? String(body.hospitalImplementationVersion) : null,
    auditHistory: [],
  };
  await io.fsCommit(env, [io.wCreate(env, "q_onco_plans/" + id, f)]);
  await auditOnco(io, env, f.hospitalId, f.doctorUid, "onco:plan:create",
    { mrn: f.ghisPatientId, protocolId: f.protocolId, lockedVersion: f.lockedVersion, doses: calculatedDoses.map((d) => d.final) });
  return f;
}

export async function getPlan(env, planId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(planId);
  if (!id) return null;
  const d = await io.fsGet(env, "q_onco_plans/" + id);
  return d ? Object.assign({ planId: id }, d.fields) : null;
}

// CONFIRM & ACTIVATE (status draft -> active). Each override must carry a reason or the WHOLE confirm
// is rejected before any write (override-needs-reason at the data layer).
//
// The 3rd arg is EITHER the legacy overrides[] (data-layer callers/tests: overrides only, NO strict
// activation gate - pre-Phase-F behaviour, byte-identical) OR an options object
// { overrides, physicianConfirmed } from the PRODUCTION route, which ALWAYS runs the Phase F
// pre-activation gate (_activationGate). So in production activation is gated + never automatic: a
// missing physicianConfirmed alone blocks. Fail-closed: the gate throws BEFORE any Firestore write.
export async function confirmPlan(env, planId, arg, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(planId);
  const plan = await getPlan(env, id, io);
  if (!plan) throw new Error("plan_not_found");
  const gated = !Array.isArray(arg) && arg != null && typeof arg === "object";
  const opts = gated ? arg : {};
  const overrides = (gated ? arg.overrides : arg) || [];
  const now = Date.now();
  const mods = overrides.map((o) => _recordOverride(Object.assign({ at: now }, o)));
  // Dose lineage modified -> confirmed: apply each override's `now` onto the matching drug's calculated
  // lineage so the CONFIRMED dose (what the nurse view, the admin record's `planned`, and the PDF read)
  // is the physician's value, not the pre-override calculation. The ORIGINAL calculatedDoses array is
  // NEVER mutated (plan.calculatedDoses stays untouched in the doc) and each confirmed entry is a NEW
  // object spread from the calculated lineage, so protocolDose/inputs/calculated/rounded (the full
  // original lineage) are preserved alongside the modified final - original dose never destroyed.
  const byDrug = {}; mods.forEach((m) => { if (m.drugId) byDrug[m.drugId] = m; });
  const confirmedDoses = (plan.calculatedDoses || []).map((d) => {
    const m = d && byDrug[d.drugId];
    return m ? Object.assign({}, d, { modified: m.now, modifiedReason: m.reason, final: m.now }) : d;
  });
  const calcByDrug = {}; (plan.calculatedDoses || []).forEach((d) => { if (d && d.drugId) calcByDrug[d.drugId] = d; });
  const auditAdds = mods.map((m) => _auditEntry(m, calcByDrug[m.drugId], now));
  if (gated) {
    if (plan.status !== "draft") throw new Error("plan_not_activatable:" + plan.status);   // never re-activate
    const gate = _activationGate(Object.assign({}, plan, { confirmedDoses: confirmedDoses }), opts);
    if (!gate.ok) throw new Error("activation_blocked:" + gate.blockers.join(","));
  }
  const patch = {
    physicianModifications: (plan.physicianModifications || []).concat(mods),
    auditHistory: (plan.auditHistory || []).concat(auditAdds),
    confirmedDoses: confirmedDoses,
    status: "active",
    confirmations: (plan.confirmations || []).concat([{ by: plan.doctorUid || "", at: now, physicianConfirmed: !!opts.physicianConfirmed }]),
    updatedAt: now,
  };
  await io.fsCommit(env, [io.wUpdate(env, "q_onco_plans/" + id, patch)]);
  await auditOnco(io, env, plan.hospitalId, plan.doctorUid, "onco:plan:confirm", { mrn: plan.ghisPatientId, overrides: mods.length });
  return Object.assign({}, plan, patch);
}

export async function createCycle(env, planId, cycleNo, deps) {
  const io = deps || REAL_DEPS;
  const pid = sanitize(planId);
  const plan = await getPlan(env, pid, io);
  if (!plan) throw new Error("plan_not_found");
  const id = _cycleId(pid, cycleNo);
  const now = Date.now();
  const f = {
    planId: pid, cycleNo: Number(cycleNo), day: 1,
    plannedDate: (plan.plannedDates && plan.plannedDates[Number(cycleNo) - 1]) || null,
    state: "planned", holdReason: "",
    clearance: { status: "pending", checks: [], resolvedBy: "", resolvedAt: 0 },
    confirmedDrugs: [], confirmedDoses: plan.confirmedDoses || [],
    administrationSequence: [], createdAt: now, updatedAt: now,
  };
  await io.fsCommit(env, [io.wCreate(env, "q_onco_cycles/" + id, f)]);
  await auditOnco(io, env, plan.hospitalId, plan.doctorUid, "onco:cycle:create", { mrn: plan.ghisPatientId, cycleNo: f.cycleNo });
  return Object.assign({ cycleId: id }, f);
}

export async function getCycle(env, cycleId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  if (!id) return null;
  const d = await io.fsGet(env, "q_onco_cycles/" + id);
  return d ? Object.assign({ cycleId: id }, d.fields) : null;
}

// Pre-chemo clearance (spec R5/Phase 5): v1 is a physician ATTESTATION - each named check gets a
// status the physician typed/tapped, plus one overall status. Fail-closed: an unrecognised status is
// rejected rather than silently downgraded, so a bug here can never masquerade as "cleared". Never
// pulls or fabricates a real lab VALUE (deferred; see file header) - "checks" carries only the
// physician's attestation text, not a lab result.
const CLEARANCE_STATUSES = ["cleared", "review", "not_cleared"];
export async function resolveClearance(env, cycleId, input, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  const cyc = await getCycle(env, id, io);
  if (!cyc) throw new Error("cycle_not_found");
  input = input || {};
  const status = String(input.status || "");
  if (CLEARANCE_STATUSES.indexOf(status) < 0) throw new Error("invalid_clearance_status");
  const checks = (input.checks || []).map((c) => ({ name: String((c && c.name) || ""), status: String((c && c.status) || "") }));
  const now = Date.now();
  const clearance = { status, checks, resolvedBy: String(input.by || ""), resolvedAt: now };
  const plan = await getPlan(env, cyc.planId, io);
  await io.fsCommit(env, [io.wUpdate(env, "q_onco_cycles/" + id, { clearance, updatedAt: now })]);
  await auditOnco(io, env, plan && plan.hospitalId, input.by, "onco:cycle:clearance", { mrn: plan && plan.ghisPatientId, cycleId: id, status, checks: checks.length });
  return Object.assign({}, cyc, { clearance, updatedAt: now });
}

// planned -> ready. Clearance BLOCKS ready (spec R5/Phase 5, non-negotiable): a cycle can only reach
// "ready" once its OWN clearance object says "cleared" - "pending" (the createCycle default) and
// "review"/"not_cleared" all refuse, same as an invalid state transition. Checked at the data layer
// (not just a UI-disabled button) so no caller can route around it.
export async function confirmCycle(env, cycleId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  const cyc = await getCycle(env, id, io);
  if (!cyc) throw new Error("cycle_not_found");
  if (!_canTransition(cyc.state, "ready")) throw new Error("invalid_cycle_transition:" + cyc.state + "->ready");
  if (!cyc.clearance || cyc.clearance.status !== "cleared") throw new Error("clearance_not_resolved");
  const now = Date.now();
  const plan = await getPlan(env, cyc.planId, io);
  await io.fsCommit(env, [io.wUpdate(env, "q_onco_cycles/" + id, { state: "ready", updatedAt: now })]);
  await auditOnco(io, env, plan && plan.hospitalId, plan && plan.doctorUid, "onco:cycle:confirm", { mrn: plan && plan.ghisPatientId, cycleId: id });
  return Object.assign({}, cyc, { state: "ready", updatedAt: now });
}

// ready -> administering ("nurse taps Start on the first drug" / opens the execution view). No
// clearance re-check here - clearance already gated planned -> ready; ready -> administering is a
// nurse-cap transition (spec R11), never a dose/clearance decision.
export async function startCycle(env, cycleId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  const cyc = await getCycle(env, id, io);
  if (!cyc) throw new Error("cycle_not_found");
  if (!_canTransition(cyc.state, "administering")) throw new Error("invalid_cycle_transition:" + cyc.state + "->administering");
  const now = Date.now();
  const plan = await getPlan(env, cyc.planId, io);
  await io.fsCommit(env, [io.wUpdate(env, "q_onco_cycles/" + id, { state: "administering", updatedAt: now })]);
  await auditOnco(io, env, plan && plan.hospitalId, plan && plan.doctorUid, "onco:cycle:start", { mrn: plan && plan.ghisPatientId, cycleId: id });
  return Object.assign({}, cyc, { state: "administering", updatedAt: now });
}

// Append-only: writes ONE new q_onco_admin row, never mutates an existing one. No calculation here -
// the nurse view (Phase 5) reads confirmed doses off the plan/cycle only; `planned` below is that
// confirmed lineage for this drug, carried for audit trail (protocol vs administered), not recomputed.
export async function recordAdmin(env, body, deps) {
  const io = deps || REAL_DEPS;
  body = body || {};
  const cycleId = sanitize(body.cycleId);
  const planId = sanitize(body.planId);
  const plan = await getPlan(env, planId, io);
  const planned = ((plan && plan.confirmedDoses) || []).filter((d) => d && d.drugId === body.drugId)[0] || null;
  const id = newId();
  const now = Date.now();
  const f = {
    cycleId: cycleId, planId: planId, drugId: String(body.drugId || ""),
    planned: planned, actual: body.actual != null ? Number(body.actual) : null,
    route: String(body.route || ""), startTime: body.startTime || 0, endTime: body.endTime || 0,
    administeredBy: String(body.administeredBy || ""),
    prepared: !!body.prepared, administered: !!body.administered,
    reaction: String(body.reaction || ""), notes: String(body.notes || "").slice(0, 500),
    status: body.administered ? "administered" : "recorded",
    createdAt: now,
  };
  await io.fsCommit(env, [io.wCreate(env, "q_onco_admin/" + id, f)]);
  await auditOnco(io, env, plan && plan.hospitalId, f.administeredBy, "onco:admin:record",
    { mrn: plan && plan.ghisPatientId, drugId: f.drugId, actualDose: f.actual });
  return Object.assign({ id: id }, f);
}

// All append-only q_onco_admin rows for one cycle (single-field equality on cycleId - no composite
// index needed). This is the NURSE-READ counterpart to recordAdmin's write: a fresh session (new
// device/reload) has no local memory of what was already given, so the give-list/admin table must
// read this back from Firestore, not rely on a client-side array patched in-session. Sorted by
// createdAt so the administration record renders in the order doses were actually given.
export async function getAdminRecords(env, cycleId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  if (!id) return [];
  const rows = await io.fsQuery(env, "q_onco_admin", { where: { field: "cycleId", value: id }, limit: 200 });
  return rows.map((r) => Object.assign({ id: r.id }, r.fields)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// administering -> done ("Complete cycle").
export async function completeCycle(env, cycleId, deps) {
  const io = deps || REAL_DEPS;
  const id = sanitize(cycleId);
  const cyc = await getCycle(env, id, io);
  if (!cyc) throw new Error("cycle_not_found");
  if (!_canTransition(cyc.state, "done")) throw new Error("invalid_cycle_transition:" + cyc.state + "->done");
  const now = Date.now();
  const plan = await getPlan(env, cyc.planId, io);
  await io.fsCommit(env, [io.wUpdate(env, "q_onco_cycles/" + id, { state: "done", updatedAt: now })]);
  await auditOnco(io, env, plan && plan.hospitalId, plan && plan.doctorUid, "onco:cycle:complete", { mrn: plan && plan.ghisPatientId, cycleId: id });
  return Object.assign({}, cyc, { state: "done", updatedAt: now });
}

// Give-list projection for the NURSE read (GET /onco/cycle): the drug NAMES / routes / days / units
// and premeds a nurse needs to administer, WITHOUT the calculation inputs (dosePerUnit / basis /
// roundingRule / caps). The nurse gets confirmed FINAL doses off the cycle and never sees or re-runs
// the formula - this keeps "the nurse view never calculates" true even for the data it is handed.
function _nurseTemplate(template) {
  const t = template || {};
  return {
    name: t.name || "", cycleLengthDays: t.cycleLengthDays || null,
    premedications: t.premedications || [], supportiveCare: t.supportiveCare || [], clearanceChecks: t.clearanceChecks || [],
    drugs: (t.drugs || []).map((d) => ({ id: d.id, name: d.name, route: d.route, days: d.days, unit: d.unit, notes: d.notes || "" })),
  };
}

export {
  sanitize, newId, _cycleId, _snapshot, _recordOverride, _auditEntry, _activationGate, _deepHasVerify, _canTransition, _nurseTemplate,
  CYCLE_STATES, CYCLE_TRANSITIONS, CLEARANCE_STATUSES,
};
