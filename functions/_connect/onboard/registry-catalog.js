// functions/_connect/onboard/registry-catalog.js — Connector Registry + Marketplace catalog (self-service).
//
// A read-only, client-safe CATALOG of every connector TYPE the platform supports, so a hospital admin can see
// what they can connect and whether each type is currently enabled -- without contacting us. This is METADATA
// ONLY: a static capability list (each connector's declared meta/capabilities, from the SDK registry for pull
// types + a small static table for the feed/file types) plus the per-track flag state read from env. It reads
// NO tenant row and NO PHI, and the catalog itself is IDENTICAL for every tenant (tenantId is used only to
// satisfy fail-closed RBAC, mirroring /health and /activity -- see functions/_connect/maik/integration-health.js
// and functions/_connect/onboard/activity.js).
//
// "Marketplace architecture" here = a catalog model (typed entries + metadata + an enable-via-flag model) that
// a future third-party marketplace would build on. The actual third-party install/publish flow is OUT OF SCOPE.
//
// Pull types (fhir-r4, rest-json, dicomweb) are DERIVED from the SDK registry (sdk/catalog.js's defaultRegistry
// -> asConnectorMap) + each connector's own capabilities(), so this never hand-duplicates their resource/auth
// lists. The registry also carries the abdm connector (profile "event"), which is filtered OUT here: onboarding
// lists PULL connection types only -- abdm is a different (event-profile) onboarding surface, not a self-service
// connection type an admin picks from this catalog. The feed/file types (file/CSV, hl7v2, fhir-push) are event/
// push-profile connectors that do not implement capabilities() (interfaces.js's assertConnector only requires it
// for profile "pull"), so their resources/authKinds are declared statically here, mirroring what their
// normalizer actually emits (file/normalize.js, hl7v2/normalize.js, fhir-r4/normalize.js reused verbatim by
// fhir-push/connector.js).
import { requireCan } from "../enterprise/guard.js";
import { defaultRegistry } from "../sdk/catalog.js";
import { onboardFlagOn } from "./flags.js";
import { fhirFlagOn } from "../smart/flags.js";
import { restFlagOn } from "../connectors/rest-json/flags.js";
import { dicomFlagOn } from "../connectors/dicomweb/flags.js";
import { flagHl7On, flagFhirPushOn } from "../ingest.js";

// Per-track flag gate + a short one-line, non-em-dash description for each SDK-registry PULL connector.
const PULL_META = {
  "fhir-r4": {
    category: "pull", flagEnv: "CONNECT_FHIR_FLAG", enabledFn: fhirFlagOn,
    description: "SMART-on-FHIR R4 pull connection to your EMR's FHIR server.",
  },
  "rest-json": {
    category: "pull", flagEnv: "CONNECT_REST_FLAG", enabledFn: restFlagOn,
    description: "Generic REST/JSON lab-results API pull connection, no EMR-specific code required.",
  },
  "dicomweb": {
    category: "imaging", flagEnv: "CONNECT_DICOM_FLAG", enabledFn: dicomFlagOn,
    description: "DICOMweb QIDO-RS pull connection that reads imaging study metadata only, never pixel data.",
  },
};

// Static entries for the non-pull ingestion types. CSV upload rides on the base onboard flag only (there is no
// separate per-track flag for it in the router), so it is "enabled" whenever the onboard surface itself is
// reachable (which it must be, for this function to run at all).
const STATIC_ENTRIES = [
  {
    id: "file", name: "File/CSV lab feed", category: "file", profile: "event",
    resources: ["Patient", "Observation", "DiagnosticReport"], authKinds: ["none"],
    description: "One-time CSV or flat-file lab export upload, parsed and normalized in the browser.",
    flagEnv: "CONNECT_ONBOARD_FLAG", enabledFn: onboardFlagOn,
  },
  {
    id: "hl7v2", name: "HL7 v2 (event)", category: "feed", profile: "event",
    resources: ["Encounter", "Condition", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"],
    authKinds: ["hmac-webhook"],
    description: "Inbound HL7 v2 feed signed with HMAC, for ORU, ADT and similar messages from your integration engine.",
    flagEnv: "CONNECT_HL7_FLAG", enabledFn: flagHl7On,
  },
  {
    id: "fhir-push", name: "FHIR R4 push (webhook)", category: "feed", profile: "push",
    resources: ["Patient", "Encounter", "Condition", "MedicationRequest", "MedicationStatement", "Observation", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"],
    authKinds: ["hmac-webhook"],
    description: "Inbound webhook that accepts a pushed FHIR R4 Bundle or resource, signed with HMAC.",
    flagEnv: "CONNECT_FHIR_PUSH_FLAG", enabledFn: flagFhirPushOn,
  },
];

// buildCatalog(env) -> connector[]. Deterministic ordering: registry pull types in BUILTIN order (fhir-r4,
// rest-json, dicomweb -- abdm filtered out), then the static feed/file entries. No env I/O beyond reading the
// flag env vars; no tenant/request data is read here at all.
async function buildCatalog(env) {
  const map = defaultRegistry().asConnectorMap();
  const out = [];
  for (const id of Object.keys(map)) {
    const meta = PULL_META[id];
    const connector = map[id];
    if (!meta || !connector.meta || connector.meta.profile !== "pull") continue;   // onboarding lists PULL types only
    const caps = (await connector.capabilities()) || {};
    out.push({
      id,
      name: connector.meta.name || id,
      category: meta.category,
      resources: Array.isArray(caps.resources) ? caps.resources.slice() : [],
      authKinds: Array.isArray(caps.authKinds) ? caps.authKinds.slice() : [],
      profile: connector.meta.profile,
      description: meta.description,
      enabled: !!meta.enabledFn(env),
      flagEnv: meta.flagEnv,
    });
  }
  for (const s of STATIC_ENTRIES) {
    out.push({
      id: s.id, name: s.name, category: s.category,
      resources: s.resources.slice(), authKinds: s.authKinds.slice(),
      profile: s.profile, description: s.description,
      enabled: !!s.enabledFn(env), flagEnv: s.flagEnv,
    });
  }
  return out;
}

// listConnectorCatalog(deps, request, env) -> { ok:true, connectors:[...] }. Fail-closed RBAC via requireCan
// (connector:read -- the SAME read tier as /health and /activity); tenantId is read from the request only to
// prove the caller is a member of SOME tenant (access control), never to scope the catalog itself -- the
// returned list is identical for every tenant and carries no tenant id, no PHI, and no per-tenant row.
export async function listConnectorCatalog(deps, request, env) {
  const tenantId = new URL(request.url).searchParams.get("tenant");
  await requireCan(deps, request, env, tenantId, "connector:read");
  return { ok: true, connectors: await buildCatalog(env) };
}
