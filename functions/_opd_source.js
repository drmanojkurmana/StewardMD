/* functions/_opd_source.js — the OPD ⇄ EMR boundary (Phase 1: the contract + resolver).
 *
 * The OPD engine talks to an "OPD source": either an EMR connector's OPD adapter (GHIS is the first,
 * Phase 2) or the native StewardMD provider (clinics with no external EMR). Every OPD method is OPTIONAL
 * and declared via `opdCaps`; the engine checks opdSupports() before calling and otherwise runs on its
 * own data — so OPD stays fully functional when a connector is missing, unregistered, or down
 * (architecture §5/§6/§7). This EXTENDS the existing Connect connector contract; it does not replace it.
 *
 * Nothing imports this yet — it is the boundary, wired in Phase 2.
 */

// The optional OPD capabilities a source may implement (superset; a source declares the subset it has).
export const OPD_CAPS = [
  "syncOrgStructure",     // -> normalized Organization/Department/Room/Doctor
  "getWorklist",          // ({date, dept}) -> normalized Appointments/arrivals  (e.g. GHIS docopdlist)
  "findPatient",          // (query) -> normalized Patient candidates
  "resolvePatient",       // (ref) -> normalized Patient
  "checkIn",              // (ref) -> record arrival in the EMR
  "setConsultationState", // (ref, state) -> notify consult start/end
  "writeAssessment",      // (ref, data) -> push assessment back
  "writeVitals",          // (ref, data) -> push vitals back
  "writeOrder"            // (ref, data) -> push an order back
];

// Does this source implement + declare a capability?
export function opdSupports(source, cap) {
  return !!(source && Array.isArray(source.opdCaps) && source.opdCaps.indexOf(cap) > -1 && typeof source[cap] === "function");
}

// Validate a source object: every declared cap must be a known cap AND an actual function.
export function assertOpdSource(source) {
  if (!source || typeof source !== "object") throw new Error("opd_source: must be an object");
  const caps = source.opdCaps || [];
  if (!Array.isArray(caps)) throw new Error("opd_source: opdCaps must be an array");
  for (const c of caps) {
    if (OPD_CAPS.indexOf(c) < 0) throw new Error("opd_source: unknown capability: " + c);
    if (typeof source[c] !== "function") throw new Error("opd_source: declared capability not implemented: " + c);
  }
  return true;
}

// ---- connector registry (Phase 2 registers "ghis" etc.; empty in Phase 1) ----------------------
const REGISTRY = {};
export function registerOpdConnector(id, factory) { if (id && typeof factory === "function") REGISTRY[String(id)] = factory; }
export function opdConnectorIds() { return Object.keys(REGISTRY); }
// Test/reset hook — keeps the module-level registry from leaking across unit tests.
export function _resetOpdConnectors() { for (const k of Object.keys(REGISTRY)) delete REGISTRY[k]; }

// The native (no-EMR) OPD source: no external capabilities — OPD runs on its own StewardMD data.
export function nativeOpdSource(env, org) {
  return { orgId: org && org.id ? String(org.id) : "", kind: "native", opdCaps: [] };
}

// Resolve an org's OPD source. Native orgs, orgs with no connector, and orgs whose connector isn't
// registered (or is unavailable) all degrade to native — the engine keeps working either way.
export function resolveOpdSource(env, org) {
  if (!org || org.mode !== "connect" || !org.connectorId) return nativeOpdSource(env, org);
  const factory = REGISTRY[String(org.connectorId)];
  if (!factory) return nativeOpdSource(env, org);
  try {
    const src = factory(env, org);
    assertOpdSource(src);
    return Object.assign({ kind: "connector", connectorId: String(org.connectorId) }, src);
  } catch (e) {
    return nativeOpdSource(env, org);   // a broken/misconfigured connector never takes OPD down
  }
}
