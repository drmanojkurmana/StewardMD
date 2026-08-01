// functions/_connect/onboard/pull.js — pull a patient through the REUSED fhir-r4 connector, normalize to
// SCCM, return the canonical bundle (for in-app viewing; real-PHI-to-LLM stays behind the existing R7/BAA
// egress gate — unchanged). The onboard layer owns SSRF-guarded auth acquisition (token bearer, or SMART
// discovery+client-credentials via probe.resolveAuth); the connector then runs in its NO-SMART bearer mode
// (secret_ref unset => smartOn=false), so the connector is REUSED (not forked) and works against any public
// host. The connector's own paginate keeps its same-origin-next guard (no exfil hop).
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink, hmacPseudonym } from "../audit.js";
import { validateBundle } from "../canonical/validate.js";
import { assertConsumable, SCCM_MAJOR, RESOURCE_KEYS } from "../canonical/model.js";
import { fhirR4Connector } from "../connectors/fhir-r4/connector.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { makeSafeFetch } from "./net.js";
import { OnboardError } from "./errors.js";
import { getRow, ONBOARD_SCOPE } from "./store.js";
import { resolveAuth } from "./probe.js";

export async function pullConnection(deps, request, env, tenantId, connectionId, patientId) {
  // PHI read: gate on connector:read membership, and deny an auditor (RBAC reserves PHI away from auditors).
  const { actor, tenant, role } = await requireCan(deps, request, env, tenantId, "connector:read");
  if (role === "auditor") throw new PermissionError("auditor may not read patient data");
  if (!patientId || typeof patientId !== "string") throw new OnboardError("invalid", "patientId required");

  const { row, config } = await getRow(deps.db, tenant.id, connectionId);
  const base = assertPublicHttpsUrl(row.base_url, "fhirBaseUrl").href.replace(/\/$/, "");
  let creds = {}; try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch { creds = {}; }

  // Acquire a bearer in the onboard layer (SSRF-guarded); hand it to the connector via secrets("bearer").
  // // VERIFY: a token-method connection with a CUSTOM headerName pulls with Authorization: Bearer here
  // (the fhir-r4 connector only emits a Bearer header). Custom-header pull is a later connector extension;
  // the capability probe already honors the custom header.
  const { bearer } = await resolveAuth(deps, base, config, creds);

  const t0 = Date.now();
  // The connector's own reads/searches go through the redirect-safe fetch: a compromised/redirecting FHIR
  // host can never bounce the authenticated, PHI-bearing request to a private/other origin.
  const safeFetch = makeSafeFetch(deps.fetch);
  const ctx = {
    tenant: { id: tenant.id, mode: tenant.mode || "sandbox", settings: {} },
    config: { base_url: base, connector_id: connectionId },     // NO secret_ref => connector stays in bearer mode
    scope: ONBOARD_SCOPE.slice(),
    kv: deps.kv,
    secrets: async (name) => (name === "bearer" ? bearer : null),
    envelope: deps.secrets && { seal: deps.secrets.seal, open: deps.secrets.open },
    now: () => new Date(),
    fetch: safeFetch,
    audit: () => {},
    logger: { warn() {}, error() {} },
    budget: { maxSubrequests: 20, deadlineMs: 8000, maxPagesPerResource: 50 },
  };

  const raw = await fhirR4Connector.fetchPatient(ctx, patientId);
  const bundle = await fhirR4Connector.normalize(ctx, raw);
  assertConsumable(bundle, SCCM_MAJOR);
  const v = validateBundle(bundle);
  if (!v.ok) throw new OnboardError("invalid", "normalized bundle failed validation");
  bundle.meta.warnings.push(...v.warnings);

  // PHI-free audit: counts + a pseudonymous patient-ref hash; never the raw patientId / URL / creds.
  await makeAuditSink(env, deps.db)({
    tenantId: tenant.id, actor: actor.id, connectorId: connectionId, action: "connect.onboard.pulled",
    resourceCounts: RESOURCE_KEYS.reduce((a, k) => (a[k] = bundle[k].length, a), {}),
    patientRefHash: await hmacPseudonym(env, tenant.id, patientId), latencyMs: Date.now() - t0, outcome: "ok",
    ts: new Date().toISOString(),
  });
  return bundle;
}
