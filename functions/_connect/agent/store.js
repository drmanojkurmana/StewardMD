// functions/_connect/agent/store.js — D1 access for the Connect Hospital agent broker.
// Follows the existing onboard store idiom (functions/_connect/onboard/store.js): plain prepare/bind,
// tenant id on EVERY statement, client-safe projections that never surface an internal reference, and
// OnboardError klasses as the only thing that reaches a client.
//
// Deliberate SQL restraint: every WHERE is `col = ?` equality, ANDed. No ranges, no ORDER BY/LIMIT
// semantics are relied on — range filtering (expiry, lease lapse) happens in JS on a state-narrowed read.
// That keeps the statements inside what test/connect/onboard/onboard-db.mjs (the shared D1-shaped mock)
// executes faithfully, so the tests exercise the REAL statements rather than test-only variants.
import { OnboardError } from "../onboard/errors.js";
import { sha256hex } from "./hmac.js";

export const nowIso = () => new Date().toISOString();
export const newId = (p) => (p || "") + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };
const need = (db) => { if (!db) throw new OnboardError("not-configured", "CONNECT_DB binding missing"); return db; };

// --- compare-and-swap -------------------------------------------------------------------------------
// The UPDATE itself carries `revision = ?` so the swap is atomic in D1. D1's meta.changes is not
// available through every driver shim, so the swap is CONFIRMED by re-reading the row: a lost race left
// the revision unchanged, which is a conflict, not a silent no-op.
async function casUpdate(db, table, tenantId, id, expectedRevision, set) {
  const cols = Object.keys(set);
  const sql = "UPDATE " + table + " SET " + cols.map((c) => c + "=?").join(", ") +
    ", revision=?, updated_at=? WHERE tenant_id=? AND id=? AND revision=?";
  const binds = cols.map((c) => set[c]).concat([Number(expectedRevision) + 1, nowIso(), tenantId, id, Number(expectedRevision)]);
  const res = await need(db).prepare(sql).bind(...binds).run();
  const after = await db.prepare("SELECT * FROM " + table + " WHERE tenant_id=? AND id=?").bind(tenantId, id).first();
  if (!after) throw new OnboardError("not-found", "row vanished during update");
  if (res && ((res.meta && typeof res.meta.changes === "number" && res.meta.changes === 0) || res.changes === 0)) {
    throw new OnboardError("conflict", "stale revision");
  }
  if (Number(after.revision) !== Number(expectedRevision) + 1) throw new OnboardError("conflict", "stale revision");
  for (const c of cols) {
    if (String(after[c]) !== String(set[c])) throw new OnboardError("conflict", "stale revision");
  }
  return after;
}

// --- deployment -------------------------------------------------------------------------------------
// The vendor fingerprint is derived from the canonical approved origin set, never from a hostname alone:
// a shared vendor host (one SaaS domain serving many hospitals) must not collapse two tenants together,
// which is why uniqueness is (tenant_id, fingerprint) and lookups are always tenant-scoped.
export async function deploymentFingerprint(origins) {
  const canon = [...new Set((origins || []).map((o) => String(o)))].sort().join("\n");
  return sha256hex(canon);
}

export async function getDeployment(db, tenantId, id) {
  const row = await need(db).prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND id=?").bind(tenantId, id).first();
  if (!row) throw new OnboardError("not-found", "deployment not found");
  return row;
}

export async function findDeploymentByFingerprint(db, tenantId, fingerprint) {
  return (await need(db).prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND fingerprint=?").bind(tenantId, fingerprint).first()) || null;
}

export async function insertDeployment(db, { tenantId, hospitalId, name, origins, vendor, fingerprint, networkMode }) {
  const id = newId("dep_");
  await need(db).prepare(
    "INSERT INTO connect_deployment (id,tenant_id,hospital_id,name,origins,vendor,fingerprint,network_mode,active_version_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, tenantId, hospitalId, name || null, JSON.stringify(origins || []), vendor || null, fingerprint,
    networkMode || "public", null, "active", nowIso(), nowIso()).run();
  return await getDeployment(db, tenantId, id);
}

export function deploymentOrigins(row) { return json(row && row.origins, []) || []; }

// Client-safe deployment projection. Carries no membership signal about any OTHER tenant.
export function deploymentView(row, activeVersion) {
  return {
    deploymentId: row.id, hospitalId: row.hospital_id, name: row.name || null,
    origins: deploymentOrigins(row), vendor: row.vendor || null, networkMode: row.network_mode,
    status: row.status,
    activeVersion: activeVersion ? { versionId: activeVersion.id, contentHash: activeVersion.content_hash, capabilities: json(activeVersion.capabilities, []) || [], schemaVersion: activeVersion.schema_version } : null,
  };
}

// --- adapter version --------------------------------------------------------------------------------
export async function getVersion(db, tenantId, id) {
  if (!id) return null;
  return (await need(db).prepare("SELECT * FROM connect_adapter_version WHERE tenant_id=? AND id=?").bind(tenantId, id).first()) || null;
}

export async function insertVersion(db, { tenantId, deploymentId, manifestRef, schemaVersion, contentHash, capabilities, parentVersionId, evidenceHash }) {
  const id = newId("ver_");
  await need(db).prepare(
    "INSERT INTO connect_adapter_version (id,tenant_id,deployment_id,manifest_ref,schema_version,content_hash,capabilities,parent_version_id,evidence_hash,approver,policy_version,lifecycle,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, tenantId, deploymentId, manifestRef, Number(schemaVersion) || 1, contentHash,
    JSON.stringify(capabilities || []), parentVersionId || null, evidenceHash || null, null, null, "CREATED", nowIso(), nowIso()).run();
  return await getVersion(db, tenantId, id);
}

// connect_adapter_version and connect_deployment carry no numeric `revision` column (the schema file's own
// "additive, new tables only" convention rules out adding one to an existing table), so activation.js's CAS
// guards the column that IS the thing being raced over: the version's own `lifecycle` (the exact state-machine
// edge state.js just asserted), and the deployment's own `active_version_id`. Same "confirm by re-read" shape
// as casUpdate above, for the same reason (D1 meta.changes is not available through every driver shim).
export async function casVersionLifecycle(db, tenantId, id, expectedLifecycle, set) {
  const cols = Object.keys(set);
  const sql = "UPDATE connect_adapter_version SET " + cols.map((c) => c + "=?").join(", ") +
    ", updated_at=? WHERE tenant_id=? AND id=? AND lifecycle=?";
  await need(db).prepare(sql).bind(...cols.map((c) => set[c]), nowIso(), tenantId, id, expectedLifecycle).run();
  const after = await getVersion(db, tenantId, id);
  if (!after) throw new OnboardError("not-found", "version vanished during update");
  for (const c of cols) { if (String(after[c]) !== String(set[c])) throw new OnboardError("conflict", "stale lifecycle"); }
  return after;
}

export async function casDeploymentActiveVersion(db, tenantId, id, expectedActiveVersionId, newActiveVersionId) {
  const guard = expectedActiveVersionId === null ? "active_version_id IS NULL" : "active_version_id=?";
  const binds = expectedActiveVersionId === null ? [newActiveVersionId, nowIso(), tenantId, id]
    : [newActiveVersionId, nowIso(), tenantId, id, expectedActiveVersionId];
  await need(db).prepare(
    "UPDATE connect_deployment SET active_version_id=?, updated_at=? WHERE tenant_id=? AND id=? AND " + guard
  ).bind(...binds).run();
  const after = await getDeployment(db, tenantId, id);
  if (String(after.active_version_id || null) !== String(newActiveVersionId)) throw new OnboardError("conflict", "deployment active version changed concurrently");
  return after;
}

// --- activation (append-only) -----------------------------------------------------------------------
export async function insertActivation(db, { tenantId, deploymentId, versionId, approverId, policyVersion, evidenceHash }) {
  const id = newId("act_");
  await need(db).prepare(
    "INSERT INTO connect_agent_activation (id,tenant_id,deployment_id,version_id,approver,policy_version,evidence_hash,activated_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(id, tenantId, deploymentId, versionId, approverId, policyVersion, evidenceHash, nowIso(), null).run();
  return (await need(db).prepare("SELECT * FROM connect_agent_activation WHERE tenant_id=? AND id=?").bind(tenantId, id).first());
}

// The currently-live activation for a deployment: the newest row not yet revoked. Append-only + this
// query is how "which version served reads, and under what evidence, at any point in time" stays answerable.
export async function getActiveActivation(db, tenantId, deploymentId) {
  const r = await need(db).prepare("SELECT * FROM connect_agent_activation WHERE tenant_id=? AND deployment_id=? AND revoked_at IS NULL").bind(tenantId, deploymentId).all();
  const rows = (r.results || []).slice();
  rows.sort((a, b) => String(b.activated_at || "").localeCompare(String(a.activated_at || "")));
  return rows[0] || null;
}

export async function revokeActivation(db, tenantId, id, whenIso) {
  await need(db).prepare("UPDATE connect_agent_activation SET revoked_at=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL").bind(whenIso, tenantId, id).run();
}

// --- consent ----------------------------------------------------------------------------------------
export async function insertConsent(db, row) {
  await need(db).prepare(
    "INSERT INTO connect_agent_consent (id,tenant_id,deployment_id,actor_id,scope,policy_version,expires_at,revoked_at,receipt_hmac,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(row.id, row.tenant_id, row.deployment_id, row.actor_id, row.scope, row.policy_version,
    row.expires_at, null, row.receipt_hmac, nowIso()).run();
  return row;
}

export async function listConsents(db, tenantId, actorId, deploymentId) {
  const r = await need(db).prepare("SELECT * FROM connect_agent_consent WHERE tenant_id=? AND actor_id=? AND deployment_id=?").bind(tenantId, actorId, deploymentId).all();
  return r.results || [];
}

export async function getConsent(db, tenantId, id) {
  return (await need(db).prepare("SELECT * FROM connect_agent_consent WHERE tenant_id=? AND id=?").bind(tenantId, id).first()) || null;
}

export async function revokeConsentRow(db, tenantId, id, whenMs) {
  await need(db).prepare("UPDATE connect_agent_consent SET revoked_at=? WHERE tenant_id=? AND id=?").bind(whenMs, tenantId, id).run();
}

// --- session ----------------------------------------------------------------------------------------
export async function insertSession(db, row) {
  await need(db).prepare(
    "INSERT INTO connect_agent_session (id,tenant_id,deployment_id,actor_id,runner_ref,runner_id,consent_id,state,control_owner,revision,expires_at,cleanup_after,closed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(row.id, row.tenant_id, row.deployment_id, row.actor_id, row.runner_ref, null, row.consent_id,
    row.state, row.control_owner, 1, row.expires_at, null, null, nowIso(), nowIso()).run();
  return await getSessionRow(db, row.tenant_id, row.id);
}

export async function getSessionRow(db, tenantId, id) {
  return (await need(db).prepare("SELECT * FROM connect_agent_session WHERE tenant_id=? AND id=?").bind(tenantId, id).first()) || null;
}

// Any still-usable session this actor already holds for this deployment. This is what makes app
// backgrounding / reconnection RESUME instead of provisioning a second browser context.
export async function findLiveSession(db, tenantId, actorId, deploymentId, liveStates, nowMs) {
  const r = await need(db).prepare("SELECT * FROM connect_agent_session WHERE tenant_id=? AND actor_id=? AND deployment_id=?").bind(tenantId, actorId, deploymentId).all();
  const rows = (r.results || []).filter((s) => liveStates.indexOf(String(s.state)) !== -1 && Number(s.expires_at) > Number(nowMs));
  rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return rows[0] || null;
}

export async function casSession(db, tenantId, id, expectedRevision, set) {
  return casUpdate(db, "connect_agent_session", tenantId, id, expectedRevision, set);
}

// Client-safe session projection. runner_ref, runner_id and any browser identifier are structurally
// absent: the opaque runner reference IS the Camofox userId and must never leave the server.
export function sessionView(session, job) {
  return {
    sessionId: session.id, deploymentId: session.deployment_id,
    state: session.state, controlOwner: session.control_owner, revision: Number(session.revision),
    expiresAt: Number(session.expires_at),
    job: job ? {
      jobId: job.id, state: job.state, revision: Number(job.revision),
      stage: job.stage || null, code: job.stage_code || null,
      attempts: Number(job.attempts), maxAttempts: Number(job.max_attempts),
      deadlineAt: Number(job.deadline_at), candidateVersionId: job.candidate_version_id || null,
    } : null,
  };
}

// --- job --------------------------------------------------------------------------------------------
export async function insertJob(db, row) {
  await need(db).prepare(
    "INSERT INTO connect_agent_job (id,tenant_id,session_id,deployment_id,actor_id,state,revision,idempotency_key,lease_owner,lease_expires_at,attempts,max_attempts,deadline_at,stage,stage_code,candidate_version_id,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(row.id, row.tenant_id, row.session_id, row.deployment_id, row.actor_id, row.state, 1,
    row.idempotency_key || null, null, null, 0, Number(row.max_attempts) || 3, row.deadline_at,
    null, null, null, null, nowIso(), nowIso()).run();
  return await getJobRow(db, row.tenant_id, row.id);
}

export async function getJobRow(db, tenantId, id) {
  return (await need(db).prepare("SELECT * FROM connect_agent_job WHERE tenant_id=? AND id=?").bind(tenantId, id).first()) || null;
}

export async function getJobById(db, id) {
  return (await need(db).prepare("SELECT * FROM connect_agent_job WHERE id=?").bind(id).first()) || null;
}

export async function findJobByIdempotencyKey(db, tenantId, key) {
  if (!key) return null;
  return (await need(db).prepare("SELECT * FROM connect_agent_job WHERE tenant_id=? AND idempotency_key=?").bind(tenantId, key).first()) || null;
}

export async function findJobForSession(db, tenantId, sessionId) {
  const r = await need(db).prepare("SELECT * FROM connect_agent_job WHERE tenant_id=? AND session_id=?").bind(tenantId, sessionId).all();
  const rows = (r.results || []).slice();
  rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return rows[0] || null;
}

export async function casJob(db, tenantId, id, expectedRevision, set) {
  return casUpdate(db, "connect_agent_job", tenantId, id, expectedRevision, set);
}

// Candidate jobs for a lease sweep: read by STATE (equality, index-friendly) and filter the time ranges
// in JS. `states` is a small fixed list from state.js, never client input.
export async function jobsInStates(db, states) {
  const out = [];
  for (const s of states) {
    const r = await need(db).prepare("SELECT * FROM connect_agent_job WHERE state=?").bind(s).all();
    for (const row of r.results || []) out.push(row);
  }
  return out;
}

// --- viewer tokens ----------------------------------------------------------------------------------
export async function insertViewerToken(db, row) {
  await need(db).prepare(
    "INSERT INTO connect_agent_viewer_token (jti,tenant_id,session_id,actor_id,expires_at,used_at,revoked_at,created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(row.jti, row.tenant_id, row.session_id, row.actor_id, row.expires_at, null, null, nowIso()).run();
}

export async function getViewerToken(db, jti) {
  return (await need(db).prepare("SELECT * FROM connect_agent_viewer_token WHERE jti=?").bind(jti).first()) || null;
}

export async function markViewerTokenUsed(db, jti, whenMs) {
  await need(db).prepare("UPDATE connect_agent_viewer_token SET used_at=? WHERE jti=?").bind(whenMs, jti).run();
  return await getViewerToken(db, jti);
}

// Cancellation revokes every outstanding viewer token for the session in one statement.
export async function revokeSessionViewerTokens(db, sessionId, whenMs) {
  await need(db).prepare("UPDATE connect_agent_viewer_token SET revoked_at=? WHERE session_id=?").bind(whenMs, sessionId).run();
}

// --- callback nonces --------------------------------------------------------------------------------
export async function getNonce(db, nonce) {
  return (await need(db).prepare("SELECT * FROM connect_agent_nonce WHERE nonce=?").bind(nonce).first()) || null;
}

export async function insertNonce(db, { nonce, runnerId, seenAt, expiresAt }) {
  await need(db).prepare("INSERT INTO connect_agent_nonce (nonce,runner_id,seen_at,expires_at) VALUES (?,?,?,?)")
    .bind(nonce, runnerId || null, seenAt, expiresAt).run();
}

export { OnboardError };
