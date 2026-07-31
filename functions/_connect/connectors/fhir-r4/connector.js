// functions/_connect/connectors/fhir-r4/connector.js — read-only FHIR R4 pull connector (spec §5)
import { normalizeFhir } from "./normalize.js";
import { UpstreamError } from "../../permission.js";

const RES = ["Condition", "Observation", "MedicationStatement", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];

async function getJson(ctx, url) {
  try {
    const token = await ctx.secrets("bearer").catch(() => null);
    const res = await ctx.fetch(url, token ? { headers: { authorization: "Bearer " + token } } : {});
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) { throw new UpstreamError("FHIR fetch failed: " + e.message); }
}

export const fhirR4Connector = {
  meta: { id: "fhir-r4", name: "FHIR R4 (read-only)", version: "0.1", profile: "pull", kinds: ["fhir-r4"], sccmVersion: "1.0" },
  capabilities: async () => ({ resources: ["Patient", ...RES], operations: ["read", "search"], authKinds: ["oauth2", "none"] }),   // Phase-0 stub vs a known sandbox
  authenticate: async () => ({ ok: true }),          // sandbox: token (if any) supplied via secrets("bearer")
  validate: async (ctx) => { try { await getJson(ctx, (ctx.config.base_url || "") + "/Patient?_count=1"); return { ok: true, checks: [{ name: "patient-read", ok: true }] }; } catch (e) { return { ok: false, checks: [{ name: "patient-read", ok: false, detail: e.message }] }; } },
  fetchPatient: async (ctx, patientRef) => {
    const base = ctx.config.base_url || "";
    const patient = await getJson(ctx, base + "/Patient/" + encodeURIComponent(patientRef));
    const resources = [];
    for (const type of RES.filter((t) => ctx.scope.includes(t)).slice(0, ctx.budget.maxSubrequests)) {
      const b = await getJson(ctx, base + "/" + type + "?patient=" + encodeURIComponent(patientRef) + "&_count=" + ctx.budget.maxPagesPerResource);
      (b.entry || []).forEach((e) => e.resource && resources.push(e.resource));
    }
    return { patient, resources };
  },
  normalize: async (ctx, raw) => normalizeFhir(ctx, raw),
};
