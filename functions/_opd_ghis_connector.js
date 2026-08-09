/* functions/_opd_ghis_connector.js — GHIS as OPD connector #1 (Phase 2).
 *
 * A thin ADAPTER: it maps the OPD source contract (_opd_source.js) onto the EXISTING, working GHIS
 * functions (functions/api/ghis/[[path]].js) — nothing about GHIS is rewritten, and the GHIS endpoints
 * keep working underneath. The OPD engine calls resolveOpdSource(org) → this connector → existing GHIS,
 * so the engine no longer reaches into /api/ghis/* directly.
 *
 *   OPD engine → resolveOpdSource(org) → ghisOpdConnector → getOpdPatients/getOpdProfile/saveAssessment/…
 *
 * The GHIS session token travels in ctx.ghisToken (the caller's per-doctor session) — no hard-coded GHIS
 * org or user id, no 502862 dependency. GHIS advertises only the capabilities its EMR actually supports;
 * anything it can't do (org sync, check-in, consult-state) is simply not declared, so the OPD engine
 * falls back to native for those.
 */
import { getOpdPatients, getOpdProfile, saveAssessment, orderInvestigation } from "./api/ghis/[[path]].js";
import { registerOpdConnector } from "./_opd_source.js";

export function ghisOpdConnector(env, org) {
  const tok = (ctx) => (ctx && ctx.ghisToken) || "";
  return {
    kind: "connector",
    connectorId: "ghis",
    orgId: (org && org.id) || "",
    opdCaps: ["getWorklist", "resolvePatient", "writeAssessment", "writeVitals", "writeOrder"],

    // Today's OPD Out-patients worklist (the existing OPD-only, reconciling import). Returns raw GHIS rows
    // for importRoster's proven mapper; {unauth} when the GHIS session is gone (engine degrades to native).
    getWorklist: async (ctx, opts) => {
      const r = await getOpdPatients(env, tok(ctx), (opts && opts.date) || "", false, (opts && opts.cb) || "");
      if (r && r.unauth) return { unauth: true, rows: [] };
      return { rows: Array.isArray(r) ? r : [] };
    },
    // Existing GHIS patient profile (labs/meds/history), unchanged underneath.
    resolvePatient: async (ctx, ref) => {
      ref = ref || {};
      const r = await getOpdProfile(env, tok(ctx), ref.patientId || "", ref.recordNo || "");
      if (r && r.unauth) return { unauth: true };
      return r;
    },
    // Existing assessment write-back (CreateinitialAssessmentnew) — still gated by QUEUE_EMR_WRITE inside.
    writeAssessment: async (ctx, ref, data) => saveAssessment(env, tok(ctx), (data && data.body) || data || {}),
    // Vitals are a subset of the same assessment form; reuse the same gated write.
    writeVitals: async (ctx, ref, data) => saveAssessment(env, tok(ctx), (data && data.body) || data || {}),
    // Existing investigation order (CreateServices) — also gated inside.
    writeOrder: async (ctx, ref, data) => orderInvestigation(env, tok(ctx), (data && data.body) || data || {})
  };
}

// Self-register on import. Any module that imports this makes the "ghis" connector resolvable by org config.
registerOpdConnector("ghis", ghisOpdConnector);
