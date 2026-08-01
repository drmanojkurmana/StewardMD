// functions/_connect/maik-bridge/hook.js — the adapter the LIVE MaiK/AI endpoint calls (spec §4.5).
// This is the ONLY thing functions/api/ai/[[path]].js imports. Design contract:
//   * DOUBLE-GATED: inert unless BOTH smd_connect (CONNECT_FLAG) AND smd_connect_maik (CONNECT_MAIK_FLAG).
//   * FAIL-SAFE: any Connect/engine/KV error degrades to "no context" — it never breaks or delays a MaiK
//     answer (the client already runs a 90s watchdog).
//   * SECURITY: only the R7-GATED egress lane is folded into pkg.patientCase; when the gate blocks (real
//     PHI, no BAA) NOTHING is added to pkg, so zero patient bytes can reach renderGroundedPrompt/callGemini.
//     The deterministic lane is NOT attached to pkg here (pkg is what reaches the LLM) — it is served to
//     the clinician's device by the separate Connect surface (functions/api/connect/maik/context).
import { flagOn } from "../testkit.js";
import { pullLanes } from "./bridge.js";
import { identify } from "../../_usage.js";
import { fhirR4Connector } from "../connectors/fhir-r4/connector.js";

export function maikWiringOn(env) {
  return flagOn(env) && String(env && env.CONNECT_MAIK_FLAG) === "1";   // smd_connect AND smd_connect_maik
}

function mergePatientCase(existing, egress) {
  const base = existing && typeof existing === "object" ? existing : {};
  const out = Object.assign({}, base, egress);
  const findings = [].concat(base.findings || [], egress.findings || []);
  if (findings.length) out.findings = findings;
  if (base.abnormalLabs || egress.abnormalLabs) out.abnormalLabs = Object.assign({}, base.abnormalLabs || {}, egress.abnormalLabs || {});
  const imp = [].concat(base.radiologyImpressions || [], egress.radiologyImpressions || []);
  if (imp.length) out.radiologyImpressions = imp;
  return out;
}

function defaultDeps(env) {
  return { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: { "fhir-r4": fhirR4Connector } };
}

// A hung (non-erroring) KV/D1/engine call must never delay the MaiK answer. Race the pull against a short
// deadline; a timeout is caught by the fail-safe below => "no context" (the client also runs a 90s watchdog).
function withTimeout(promise, ms) {
  let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("connect-pull-timeout")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Mutates pkg in place (adds pkg.patientCase) ONLY when the egress gate is open. Returns {pkg, applied, notice}.
export async function applyConnectContext(env, request, pkg, io = {}) {
  if (!maikWiringOn(env) || !pkg) return { pkg, applied: false };
  try {
    const pull = io.pullLanes || pullLanes;
    const ms = Math.max(200, Number(env && env.CONNECT_MAIK_PULL_TIMEOUT_MS) || 1500);
    const lanes = await withTimeout(pull(env, io.deps || defaultDeps(env), request, io), ms);
    if (lanes && lanes.egress) {
      pkg.patientCase = mergePatientCase(pkg.patientCase, lanes.egress);   // gated egress lane only
      return { pkg, applied: true, notice: null };
    }
    return { pkg, applied: false, notice: lanes ? lanes.notice : null };
  } catch (e) {
    return { pkg, applied: false };            // fail-safe: never break a MaiK answer
  }
}
