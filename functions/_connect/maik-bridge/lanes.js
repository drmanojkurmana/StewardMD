// functions/_connect/maik-bridge/lanes.js — split the canonical MaiK context into two lanes (spec §4.2).
//   deterministic : structured SCCM facts for on-device / non-LLM reasoning — ALWAYS available for a
//                   consented bundle; served to the treating clinician's own (authorized) device.
//   egress        : the patientCase block that would enter the Gemini prompt — emitted ONLY when
//                   assertEgressAllowed(bundle, tenant) passes (R7). Flag-on alone is NOT sufficient.
// This file EDITS neither maik-context.js nor engine.js — it consumes them exactly as Phase-1 left them.
import { buildMaikContext, assertEgressAllowed, EgressBlocked } from "../maik-context.js";

// App-facing (no em-dash per house rule; MaiK LLM output is exempt but this is a UI string).
export const EGRESS_BLOCKED_NOTICE = "Patient record used for on-device reasoning only; not sent to the AI model.";

function valStr(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.value != null) return String(v.value) + (v.unit ? " " + v.unit : "");
    if (v.text) return String(v.text);
    if (Array.isArray(v.coding) || v.coding) return String(v.text || "");
    return "";
  }
  return String(v);
}
function ageFromBirthDate(bd) {
  if (!bd) return null;
  const y = parseInt(String(bd).slice(0, 4), 10);
  if (!Number.isFinite(y)) return null;
  const age = new Date().getUTCFullYear() - y;
  return age >= 0 && age < 150 ? age : null;
}

// Map the SCCM-flat context to the EXISTING pkg.patientCase shape renderGroundedPrompt already renders
// (age/sex/findings/abnormalLabs/radiologyImpressions) — so the live AI endpoint needs NO second change.
// Meds + allergies are folded into `findings` so they still reach the LLM via the existing channel.
export function toPatientCase(c) {
  const pc = {};
  if (c.patient) {
    if (c.patient.gender) pc.sex = c.patient.gender;
    const age = ageFromBirthDate(c.patient.birthDate); if (age != null) pc.age = age;
  }
  const findings = [];
  (c.problems || []).forEach((p) => { if (p.label) findings.push(p.label + (p.status ? " (" + p.status + ")" : "")); });
  const meds = (c.medications || []).map((m) => m.label).filter(Boolean);
  if (meds.length) findings.push("Current medications: " + meds.join(", "));
  const allg = (c.allergies || []).map((a) => (a.label ? a.label + (a.criticality ? " (" + a.criticality + ")" : "") : "")).filter(Boolean);
  if (allg.length) findings.push("Allergies: " + allg.join(", "));
  (c.vitals || []).forEach((v) => { if (v.label) findings.push(v.label + ": " + valStr(v.value)); });
  if (findings.length) pc.findings = findings;
  const abn = {};
  (c.labs || []).forEach((l) => { if (l.label && l.interpretation && String(l.interpretation).toLowerCase() !== "normal") abn[l.label] = valStr(l.value); });
  if (Object.keys(abn).length) pc.abnormalLabs = abn;
  const imp = (c.reports || []).map((r) => r.conclusion).filter(Boolean).concat((c.documents || []).map((d) => d.text).filter(Boolean));
  if (imp.length) pc.radiologyImpressions = imp;
  return pc;
}

export function splitLanes(bundle, tenant) {
  const deterministic = buildMaikContext(bundle);          // SCCM-only; no vendor fields / no provenance
  let egress = null, notice = null;
  // Normalize to STRICT types before the R7 gate: egressBaaOk must be boolean `true` (never a truthy
  // "false"/1/{} a future caller might pass), and mode is compared exactly to "sandbox" in the guard.
  const gateTenant = { mode: tenant && tenant.mode, egressBaaOk: !!tenant && tenant.egressBaaOk === true };
  try {
    assertEgressAllowed(bundle, gateTenant);               // R7 gate — throws unless sandbox OR egressBaaOk===true
    egress = toPatientCase(deterministic);
  } catch (e) {
    if (e instanceof EgressBlocked) { egress = null; notice = EGRESS_BLOCKED_NOTICE; }
    else throw e;                                           // a real bug still propagates (fail-closed)
  }
  return { deterministic, egress, notice };
}
