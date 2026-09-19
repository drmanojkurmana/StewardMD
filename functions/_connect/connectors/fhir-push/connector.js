// functions/_connect/connectors/fhir-push/connector.js — inbound FHIR-push (webhook) connector, Track B.
// A hospital / integration engine POSTs a FHIR R4 Bundle OR a single FHIR resource to the HMAC-gated ingest
// spine; ingest here = parse the JSON body -> shape it as the FHIR normalizer's { patient, resources } input
// -> normalizeFhir -> SCCM. Auth + replay are the spine's HMAC (no per-connector auth). It never throws on a
// malformed body: bad JSON yields an empty document (an empty SCCM bundle the spine's validateBundle then
// rejects with a sanitized 422); the normalizer itself degrades unknown fields with warnings.
//
// This REUSES the SHIPPED FHIR R4 normalizer (../fhir-r4/normalize.js) verbatim — the same anti-corruption
// map the pull connector uses — so a pushed resource and a pulled one normalize identically. It is a sibling
// of the hl7v2 connector (parse -> normalize), differing only in the wire format (JSON FHIR vs pipe HL7).
import { normalizeFhir } from "../fhir-r4/normalize.js";

// Accept a Bundle {resourceType:"Bundle", entry:[{resource}, ...]} OR a single resource {resourceType:...}.
// The normalizer keys the Patient separately (raw.patient) from the rest (raw.resources), so split it out.
// Bounded by ctx.budget.maxRows (defends against a pathologically large Bundle).
function toRaw(rawBody, budget) {
  let doc; try { doc = JSON.parse(rawBody || "{}"); } catch { doc = {}; }
  let all = [];
  if (doc && doc.resourceType === "Bundle") all = (doc.entry || []).map((e) => e && e.resource).filter(Boolean);
  else if (doc && doc.resourceType) all = [doc];
  const cap = (budget && budget.maxRows) || 50000;
  if (all.length > cap) all = all.slice(0, cap);
  const patient = all.find((r) => r && r.resourceType === "Patient") || {};
  const resources = all.filter((r) => r && r.resourceType !== "Patient");
  return { patient, resources };
}

export const fhirPushConnector = {
  meta: { id: "fhir-push", name: "FHIR R4 push (webhook)", version: "1.0", profile: "push", kinds: ["fhir-push"], sccmVersion: "1.1" },
  authenticate: async () => ({ ok: true }),                    // auth handled by the HMAC-gated spine
  validate: async () => ({ ok: true, checks: [{ name: "json", ok: true }] }),
  normalize: async (ctx, raw) => normalizeFhir(ctx, raw),
  ingest: async (ctx, rawEvent) => {
    const raw = toRaw((rawEvent && rawEvent.rawBody) || "", ctx.budget);
    const bundle = normalizeFhir(ctx, raw);
    return { handle: { type: "fhir-push", resources: (raw.resources || []).length }, bundle };
  },
};
