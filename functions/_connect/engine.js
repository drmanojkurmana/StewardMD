// functions/_connect/engine.js — ConnectEngine pipeline (spec §6). Stateless; ephemeral; fail-closed.
import { resolveActor, resolveTenant } from "./identity.js";
import { loadConnectorConfig, assertSandboxAllowed } from "./tenant.js";
import { enforceScope, PermissionError } from "./permission.js";
import { makeSecrets } from "./secrets.js";
import { makeAuditSink, hmacPseudonym } from "./audit.js";
import { validateBundle } from "./canonical/validate.js";
import { assertConsumable, SCCM_MAJOR, RESOURCE_KEYS } from "./canonical/model.js";

export class ValidationError extends Error {}

const SCOPE_TO_KEY = { Encounter: "encounters", Condition: "conditions", MedicationStatement: "medications", AllergyIntolerance: "allergies", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };

export async function loadPatientContext(env, deps, req, io = {}) {
  const t0 = Date.now();
  const audit = makeAuditSink(env, deps.db);
  let actor = { id: null }, outcome = "error";
  try {
    // 1. server-derived identity + membership
    actor = await resolveActor(deps.identifyFn, req.request, env);
    const { tenant } = await resolveTenant(deps.db, actor.id, req.tenantId);

    // 2. connector config + sandbox-only gate
    const config = await loadConnectorConfig(deps.db, tenant.id, req.connectorId);
    if (!config) throw new PermissionError("connector not configured for tenant");
    assertSandboxAllowed(tenant, config);

    // 3. fail-closed scope: granted ∩ requested
    const granted = JSON.parse(tenant.granted_scopes || "[]");
    const scope = enforceScope(granted, req.scope || []);

    // 4. build the injected ctx (no global state; PHI stays here)
    const secrets = makeSecrets(env);
    const ctx = {
      tenant: { id: tenant.id, mode: tenant.mode, settings: {} },
      config, scope,
      secrets: async (name) => (name === "bearer" && config.secret_ref ? secrets.open(await secrets.get(config.secret_ref)).catch(() => null) : null),
      now: () => new Date(t0),
      fetch: io.fetch || fetch,
      audit: () => {},                    // connectors never write audit directly
      logger: { warn() {}, error() {} },
      budget: { maxSubrequests: 20, deadlineMs: 8000, maxPagesPerResource: 50 },
    };

    // 5-6. fetch → normalize
    const connector = deps.connectors[req.connectorId];
    const raw = await connector.fetchPatient(ctx, req.patientRef);
    const bundle = await connector.normalize(ctx, raw);
    assertConsumable(bundle, SCCM_MAJOR);

    // 7. validate (mutates: dangling refs nulled)
    const v = validateBundle(bundle);
    if (!v.ok) throw new ValidationError(v.errors.join("; "));
    bundle.meta.warnings.push(...v.warnings);
    bundle.meta.scope = scope;

    // 8. permission FILTER (defense in depth): drop any resource type not in scope
    for (const key of RESOURCE_KEYS) {
      const type = Object.keys(SCOPE_TO_KEY).find((t) => SCOPE_TO_KEY[t] === key);
      if (type && !scope.includes(type)) bundle[key] = [];
    }

    outcome = "ok";
    // 9. PHI-free audit (metadata only)
    await audit({ tenantId: tenant.id, actor: actor.id, connectorId: req.connectorId, action: "context",
      resourceCounts: RESOURCE_KEYS.reduce((a, k) => (a[k] = bundle[k].length, a), {}), scope,
      patientRefHash: await hmacPseudonym(env, tenant.id, req.patientRef),
      latencyMs: Date.now() - t0, outcome, ts: new Date(t0).toISOString() });

    return bundle;                        // 10. returned + discarded by caller; never persisted
  } catch (e) {
    outcome = e instanceof PermissionError ? "denied" : "error";
    try { await audit({ tenantId: req.tenantId || null, actor: actor.id || null, connectorId: req.connectorId, action: "context", latencyMs: Date.now() - t0, outcome, ts: new Date(t0).toISOString() }); } catch {}
    throw e;                              // typed error; router sanitizes before HTTP
  }
}
