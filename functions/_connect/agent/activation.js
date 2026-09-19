// functions/_connect/agent/activation.js — adapter version activation, rollback and drift.
//
// This is the ONLY place a version's lifecycle may move into or out of ACTIVE, and the only place
// connect_deployment.active_version_id changes. Three guarantees the brief requires, enforced here:
//   * exact-hash binding — activation is refused unless the caller's evidenceHash matches the version's
//     own bound evidence_hash (the candidate that was actually validated is the candidate that activates).
//   * role-gated — canAgent(role, "activate") from state.js; a clinician can onboard but never activate.
//   * append-only history — every activation/rollback writes a NEW connect_agent_activation row and
//     revokes the previous one; nothing is ever overwritten, so "what served reads, when, under what
//     evidence" stays answerable without reconstructing it from mutated rows.
//
// NOT atomic across tables: D1 has no cross-statement transaction available through the shim this repo
// targets (see store.js's casVersionLifecycle/casDeploymentActiveVersion comment). Ordering below is
// deliberate to keep a failure mid-sequence SAFE rather than silent: the version's own lifecycle moves
// first (a version stuck ACTIVE-but-unpointed is inert and recoverable by retrying the deployment swap;
// the reverse order would leave a deployment pointing at a version that never actually finished
// activating). VERIFY: move to db.batch() for real atomicity if this repo's D1 shim gains transaction
// support.
import { OnboardError } from "../onboard/errors.js";
import { assertTransition, canAgent, PermissionError } from "./state.js";
import {
  getVersion, getDeployment, casVersionLifecycle, casDeploymentActiveVersion,
  insertActivation, getActiveActivation, revokeActivation, nowIso,
} from "./store.js";

function requireActivate(role) {
  if (!canAgent(role, "activate")) throw new PermissionError("role '" + role + "' may not activate an adapter version");
}

async function loadVersionForDeployment(db, tenantId, deploymentId, versionId) {
  const version = await getVersion(db, tenantId, versionId);
  if (!version || String(version.deployment_id) !== String(deploymentId)) throw new OnboardError("not-found", "adapter version not found");
  return version;
}

/**
 * Move a candidate version from AWAITING_APPROVAL to ACTIVE and point the deployment at it.
 * `evidenceHash` must equal the version's own bound evidence hash (functions/_connect/agent activation
 * caller gets this from connect-agent/manifest/validate.mjs's output) - it is NOT trusted from the
 * caller's say-so alone, it is a match check against what was actually validated.
 */
export async function activateVersion(db, { tenantId, deploymentId, versionId, actorId, role, policyVersion, evidenceHash }) {
  requireActivate(role);
  if (!evidenceHash) throw new OnboardError("invalid", "activation requires the validation evidence hash");
  const version = await loadVersionForDeployment(db, tenantId, deploymentId, versionId);
  assertTransition("adapter", version.lifecycle, "ACTIVE"); // fail-closed: only AWAITING_APPROVAL -> ACTIVE exists
  if (!version.evidence_hash) throw new OnboardError("invalid", "version has no bound validation evidence");
  if (String(version.evidence_hash) !== String(evidenceHash)) throw new OnboardError("conflict", "evidence hash does not match the validated candidate");

  const deployment = await getDeployment(db, tenantId, deploymentId);
  const activatedVersion = await casVersionLifecycle(db, tenantId, versionId, "AWAITING_APPROVAL", {
    lifecycle: "ACTIVE", approver: actorId, policy_version: policyVersion || "default",
  });
  await casDeploymentActiveVersion(db, tenantId, deploymentId, deployment.active_version_id || null, versionId);

  const previous = await getActiveActivation(db, tenantId, deploymentId);
  const activation = await insertActivation(db, {
    tenantId, deploymentId, versionId, approverId: actorId,
    policyVersion: policyVersion || "default", evidenceHash: version.evidence_hash,
  });
  if (previous && previous.id !== activation.id) await revokeActivation(db, tenantId, previous.id, nowIso());
  return { version: activatedVersion, activation };
}

/**
 * Point the deployment back at an older, still-usable version. `targetVersionId` must be a version of
 * THIS deployment whose lifecycle is ACTIVE or NEEDS_REPAIR (a version that was itself never activated,
 * or was REVOKED/FAILED, cannot become the rollback target - rollback restores a known-good past state,
 * it does not promote an unvetted candidate past approval).
 */
export async function rollbackVersion(db, { tenantId, deploymentId, targetVersionId, actorId, role, reason }) {
  requireActivate(role);
  const target = await loadVersionForDeployment(db, tenantId, deploymentId, targetVersionId);
  if (["ACTIVE", "NEEDS_REPAIR"].indexOf(target.lifecycle) === -1) {
    throw new OnboardError("invalid", "rollback target must have previously been active (lifecycle ACTIVE or NEEDS_REPAIR)");
  }
  const deployment = await getDeployment(db, tenantId, deploymentId);
  if (String(deployment.active_version_id || "") === String(targetVersionId)) {
    throw new OnboardError("invalid", "target is already the active version");
  }
  await casDeploymentActiveVersion(db, tenantId, deploymentId, deployment.active_version_id || null, targetVersionId);

  const previous = await getActiveActivation(db, tenantId, deploymentId);
  const activation = await insertActivation(db, {
    tenantId, deploymentId, versionId: targetVersionId, approverId: actorId,
    policyVersion: "rollback:" + String(reason || "unspecified").slice(0, 200), evidenceHash: target.evidence_hash || "",
  });
  if (previous && previous.id !== activation.id) await revokeActivation(db, tenantId, previous.id, nowIso());
  return { version: target, activation };
}

/**
 * Drift: the currently-active version stops matching what the hospital actually serves (a probe failed,
 * a capability check regressed). Puts ONLY that version into NEEDS_REPAIR - it does NOT touch the
 * deployment pointer (in-flight reads stay version-pinned to what is still, until repaired, the active
 * version; see activation.js module comment and the brief's "a doctor's narrower permissions are not
 * automatically schema drift" - this function does not decide THAT judgment call, it only records one
 * already made by the caller).
 */
export async function markDrift(db, { tenantId, deploymentId, versionId, reason }) {
  const version = await loadVersionForDeployment(db, tenantId, deploymentId, versionId);
  assertTransition("adapter", version.lifecycle, "NEEDS_REPAIR");
  return casVersionLifecycle(db, tenantId, versionId, version.lifecycle, {
    lifecycle: "NEEDS_REPAIR", approver: version.approver, policy_version: "drift:" + String(reason || "unspecified").slice(0, 200),
  });
}

export { OnboardError, PermissionError };
