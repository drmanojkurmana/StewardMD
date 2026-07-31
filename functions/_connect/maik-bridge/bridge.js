// functions/_connect/maik-bridge/bridge.js — pull canonical MaiK context for the attached patient (spec §4.1).
// Reuses the UNCHANGED Phase-0 engine (identity+membership+sandbox-gate+scope+PHI-free-audit+ephemeral)
// to produce the CanonicalBundle, then splits it into lanes. Real-PHI egress remains gated by R7 inside
// splitLanes. Returns null when the clinician has no active binding.
import { readBinding } from "./attach.js";
import { splitLanes } from "./lanes.js";
import { loadPatientContext } from "../engine.js";
import { resolveActor } from "../identity.js";

export const DEFAULT_SCOPE = ["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"];

async function egressBaaOk(db, tenantId) {
  try {
    const r = await db.prepare("SELECT * FROM connect_tenant_egress WHERE tenant_id=?").bind(tenantId).all();
    const row = (r.results || []).find((x) => String(x.tenant_id) === String(tenantId));
    return !!row && (Number(row.baa_ok) === 1 || row.baa_ok === true);
  } catch (e) { return false; }                 // fail-closed: no egress table / error => egress stays blocked
}

// Authoritative mode from D1. On any error / missing row => "unknown" (anything but "sandbox"), so the
// R7 gate then requires egressBaaOk. NEVER default an unknown tenant to "sandbox" (that would open egress).
async function tenantMode(db, tenantId) {
  try { const row = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first(); return (row && row.mode) ? String(row.mode) : "unknown"; }
  catch (e) { return "unknown"; }               // fail-closed
}

// deps: { db, kv, identifyFn, connectors [, ownerOk] }; io: { fetch }
export async function pullLanes(env, deps, request, io = {}) {
  const actor = await resolveActor(deps.identifyFn, request, env);
  const binding = await readBinding(env, deps.kv, actor.id);
  if (!binding) return null;

  // The engine re-derives identity + membership for this actor/tenant and enforces the sandbox gate,
  // scope intersection, validation, filter, and PHI-free audit. It persists no patient content.
  const req = { request, tenantId: binding.tenantId, connectorId: binding.connectorId, patientRef: binding.patientRef, scope: DEFAULT_SCOPE };
  const bundle = await loadPatientContext(env, deps, req, io);

  // Build the tenant object the R7 gate reads: authoritative D1 mode + the BAA flag (both fail-closed).
  const tenant = { mode: await tenantMode(deps.db, binding.tenantId), egressBaaOk: await egressBaaOk(deps.db, binding.tenantId) };
  return splitLanes(bundle, tenant);
}
