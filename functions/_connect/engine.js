// functions/_connect/engine.js — ConnectEngine pipeline (spec §6). Stateless; ephemeral; fail-closed.
import { resolveActor, resolveTenant } from "./identity.js";
import { loadConnectorConfig, assertSandboxAllowed } from "./tenant.js";
import { enforceScope, PermissionError, UpstreamError } from "./permission.js";
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
    let granted; try { granted = JSON.parse(tenant.granted_scopes || "[]"); } catch { throw new PermissionError("invalid granted_scopes"); }
    const scope = enforceScope(granted, req.scope || []);

    // 4. build the injected ctx (no global state; PHI stays here)
    const secrets = makeSecrets(env);
    const ctx = {
      tenant: { id: tenant.id, mode: tenant.mode, settings: {} },
      config, scope,
      kv: env.MAIK_KV,                                       // NON-PHI SMART discovery + token cache (connect:smart:*) // VERIFY binding
      secrets: async (name) => {
        if (name === "smart") return config.secret_ref ? JSON.parse(await secrets.open(await secrets.get(config.secret_ref))) : null;
        if (name === "bearer") return config.secret_ref ? secrets.open(await secrets.get(config.secret_ref)).catch(() => null) : null;
        return null;
      },
      envelope: { seal: secrets.seal, open: secrets.open },  // request-scoped envelope for connector token cache
      now: () => new Date(t0),
      fetch: io.fetch || fetch,
      audit: () => {},                    // connectors never write audit directly
      logger: { warn() {}, error() {} },
      budget: { maxSubrequests: 20, deadlineMs: 8000, maxPagesPerResource: 50 },
    };

    // 5-6. fetch → normalize
    const connector = deps.connectors[req.connectorId];
    if (!connector) throw new UpstreamError("connector not registered: " + req.connectorId);
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

// ---- Stage-3 Task-7: push-side ingest entry — DISTINCT from the pull loadPatientContext above. -------
// R9: the ABDM webhook is server-to-server (gateway/signature) authenticated, so there is NO logged-in
// client actor — this path NEVER calls resolveActor/identify/derives a doctor. It routes an already-
// authenticated event by `type` to the INJECTED `deps` state functions (db pre-bound in the real wiring;
// spies in tests), recording only the ABDM-authenticated context. It returns a NULLABLE bundle: a real
// SCCM bundle only exists after the Stage-4 buffer-join + Fidelius decrypt, so every INTERMEDIATE event
// correctly returns { handle, bundle:null } (not a failure). Fail-closed: a genuine state error propagates.
// `now` is injected (deps.now or the event) — never Date.now/globals.
export async function ingestEvent(env, deps, rawEvent) {
  const ev = rawEvent || {};
  const type = ev.type;
  const now = (deps && typeof deps.now === "function") ? deps.now() : (ev.now ?? ev.receivedAt ?? ev.timestamp);
  const handle = { type, requestId: ev.requestId, transactionId: ev.transactionId };
  // Correlation key: request-keyed callbacks carry requestId; transfer-keyed callbacks carry transactionId.
  const corr = ev.requestId ?? ev.transactionId;

  switch (type) {
    case "consent-notification":                         // consent lifecycle (monotonic R6) — no bundle.
      // R3/R6 RECONCILIATION: the GRANT notify carries BOTH our correlation requestId AND the gateway consentId.
      // LINK consentId onto the ONE lifecycle row (the durable join) FIRST, so verifyConsentArtifact and the
      // data-request both reload the SAME row. Guarded — linkConsentId is only bound on the real ingress path,
      // and a notify without a consentId (or a pure-status callback) simply skips the link. // VERIFY id-echoing.
      if (ev.consentId != null && deps.linkConsentId) await deps.linkConsentId(ev.requestId, ev.consentId, now);
      await deps.updateConsentStatus(ev.requestId, ev.status, now);
      return { handle, bundle: null };
    case "on-fetch":                                     // the CM-delivered signed consent artifact (R3/R4/R6) — no bundle.
      // Verify the artifact JWS + persist the FULL SIGNED scope onto the ONE reconciled lifecycle row (resolved
      // via consent_id — the GRANT notify's linkConsentId ran FIRST). A no-linked-row artifact fails closed
      // INSIDE verifyConsentArtifact (reconciliation model). Guarded — only bound on the real ingress path; db/kv/
      // fetch/audit are injected there. The webhook may wrap the artifact under `artifact`, or BE the artifact.
      if (deps.verifyConsentArtifact) await deps.verifyConsentArtifact(ev.artifact ?? ev);
      return { handle, bundle: null };
    case "on-request":                                   // attach our correlation half, then advance FSM.
      await deps.attachTransactionId(ev.requestId, ev.transactionId, now);
      await deps.advanceStatus(ev.requestId, "CONSENT_GRANTED", "REQUESTED", now);
      return { handle, bundle: null };
    case "data-push":                                    // Stage-4 buffers+joins ciphertext; here just FSM→RECEIVING.
      await deps.advanceStatus(corr, "REQUESTED", "RECEIVING", now);
      return { handle, bundle: null };
    case "data-transfer-complete":                       // exactly-once ack (D1 CAS), then close FSM. Still no bundle in Stage 3.
      await deps.claimAck(ev.transactionId, now);
      await deps.advanceStatus(corr, "RECEIVING", "TRANSFERRED", now);
      return { handle, bundle: null };
    default:                                             // unknown/unsupported → graceful, no throw.
      return { handle: { type, unsupported: true }, bundle: null };
  }
}
