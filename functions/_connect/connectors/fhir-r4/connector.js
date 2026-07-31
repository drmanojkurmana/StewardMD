// functions/_connect/connectors/fhir-r4/connector.js — SMART-on-FHIR R4 pull connector (Track A).
// Orchestrates SMART Backend Services auth (discover->sign->exchange->cache) + bounded same-origin
// paginated fetch, then hands raw FHIR to normalize. The engine owns the ephemeral fail-closed tail
// (validate->filter->audit->discard). A 401 is ONE bounded re-auth, never an unauthenticated fetch.
// DUAL-MODE: SMART is engaged when the connector has client key material (config.secret_ref); with none,
// it keeps the Phase-0 no-auth sandbox behaviour (optional bearer via secrets("bearer")) so the walking-
// skeleton pipeline stays green. The connector never sees env / the master key — only ctx.
import { normalizeFhir } from "./normalize.js";
import { UpstreamError } from "../../permission.js";
import { acquireAccessToken } from "../../smart/token.js";
import { searchPaged, ReauthNeeded } from "./paginate.js";

const FHIR_RES = ["Encounter", "Condition", "MedicationRequest", "MedicationStatement", "Observation", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];
// SCCM scope type -> the FHIR resource(s) that feed it. The SCCM medications family ("MedicationStatement")
// is fed by BOTH FHIR MedicationRequest (origin=order) AND MedicationStatement (origin=statement); the
// engine's post-normalize scope filter keys medications on the SCCM type, so scope stays SCCM-canonical.
const SCCM_TO_FHIR = { Encounter: ["Encounter"], Condition: ["Condition"], MedicationStatement: ["MedicationRequest", "MedicationStatement"], AllergyIntolerance: ["AllergyIntolerance"], Observation: ["Observation"], DiagnosticReport: ["DiagnosticReport"], DocumentReference: ["DocumentReference"] };
const fhirTypesFor = (scope) => (scope || []).filter((t) => SCCM_TO_FHIR[t]).flatMap((t) => SCCM_TO_FHIR[t]);
const scopeToSmart = (scope) => fhirTypesFor(scope).map((f) => "system/" + f + ".rs");   // // VERIFY .rs vs .read
const smartOn = (ctx) => !!(ctx.config && ctx.config.secret_ref);

function authDeps(ctx) {
  return { fetch: ctx.fetch, kv: ctx.kv, secrets: ctx.secrets, envelope: ctx.envelope, now: () => ctx.now().getTime(), logger: ctx.logger, tenantId: ctx.tenant.id, connectorId: (ctx.config && ctx.config.connector_id) || "fhir-r4" };
}
const doAuth = (ctx, forceRefresh) => acquireAccessToken(authDeps(ctx), { config: ctx.config, requestedScopes: scopeToSmart(ctx.scope), forceRefresh });

async function initialAuthHeader(ctx) {
  if (smartOn(ctx)) return { authorization: "Bearer " + (await doAuth(ctx, false)).token };
  const tok = ctx.secrets ? await ctx.secrets("bearer").catch(() => null) : null;     // Phase-0 sandbox path
  return tok ? { authorization: "Bearer " + tok } : {};
}

export const fhirR4Connector = {
  meta: { id: "fhir-r4", name: "FHIR R4 (SMART-on-FHIR)", version: "1.0", profile: "pull", kinds: ["fhir-r4"], sccmVersion: "1.0" },

  authenticate: async (ctx) => {
    if (!smartOn(ctx)) return { ok: true };                                            // sandbox: token (if any) via secrets("bearer")
    const t = await doAuth(ctx, false);
    return { token: t.accessToken, expiresAt: ctx.now().getTime() + (t.expiresIn || 0) * 1000, grantedScopes: t.grantedScopes };
  },

  capabilities: async () => ({ resources: ["Patient", ...FHIR_RES], operations: ["read", "search"], authKinds: ["smart-backend-services", "none"] }),   // graceful stub (C14)

  validate: async (ctx) => {
    const checks = [];
    try {
      const authHeader = await initialAuthHeader(ctx);
      if (smartOn(ctx)) checks.push({ name: "authenticate", ok: !!authHeader.authorization });
      const base = (ctx.config.base_url || "").replace(/\/$/, "");
      const res = await ctx.fetch(base + "/Patient?_count=1", { headers: authHeader });
      checks.push({ name: "patient-search", ok: !!(res && res.ok) });
      return { ok: checks.every((c) => c.ok), checks };
    } catch (e) { checks.push({ name: "validate", ok: false, detail: e.message }); return { ok: false, checks }; }
  },

  fetchPatient: async (ctx, patientRef) => {
    const base = (ctx.config.base_url || "").replace(/\/$/, "");
    const smart = smartOn(ctx);
    let authHeader = await initialAuthHeader(ctx);
    const pageDeps = () => ({ fetch: ctx.fetch, authHeader, budget: ctx.budget, now: () => ctx.now().getTime(), logger: ctx.logger });
    const readPatient = async () => {
      const res = await ctx.fetch(base + "/Patient/" + encodeURIComponent(patientRef), { headers: authHeader });
      if (res.status === 401) return 401;
      if (!res.ok) throw new UpstreamError("Patient read HTTP " + res.status);
      return res.json();
    };
    let patient = await readPatient();
    if (patient === 401) {
      if (!smart) throw new UpstreamError("unauthorized");
      authHeader = { authorization: "Bearer " + (await doAuth(ctx, true)).token };      // ONE bounded re-auth
      patient = await readPatient();
      if (patient === 401) throw new UpstreamError("unauthorized after re-auth");
    }
    const resources = [];
    for (const type of fhirTypesFor(ctx.scope)) {
      try {
        (await searchPaged(pageDeps(), { base, resourceType: type, patientRef, count: ctx.budget.maxPagesPerResource })).forEach((r) => resources.push(r));
      } catch (e) {
        if (e instanceof ReauthNeeded && smart) {                                        // one re-auth then retry this family
          authHeader = { authorization: "Bearer " + (await doAuth(ctx, true)).token };
          (await searchPaged(pageDeps(), { base, resourceType: type, patientRef, count: ctx.budget.maxPagesPerResource })).forEach((r) => resources.push(r));
        } else throw e;
      }
    }
    return { patient, resources };
  },

  normalize: async (ctx, raw) => normalizeFhir(ctx, raw),
};
