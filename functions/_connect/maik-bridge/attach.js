// functions/_connect/maik-bridge/attach.js — MaiK-session patient binding (spec §4.4).
// A clinician attaches a Connect patient to their MaiK session. The binding {tenantId,connectorId,
// patientRef} is envelope-SEALED before it touches KV — patientRef may embed an MRN, so the KV value is
// ciphertext only (no PHI in KV). Keyed by the clinician's server-derived actor id; short TTL. PHI-free
// audit (patientRefHash only). One active binding per clinician; a new attach overwrites the prior.
import { requireCan } from "../enterprise/guard.js";
import { enforce } from "../enterprise/ratelimit.js";
import { resolveActor } from "../identity.js";
import { makeSecrets } from "../secrets.js";
import { makeAuditSink, hmacPseudonym } from "../audit.js";

export const BIND_TTL_SEC = 3600;                 // 1h MaiK session // VERIFY (spec §11.7)
export const bindKey = (actorId) => "connect:maikbind:" + actorId;

export async function attach(deps, request, env, { tenantId, connectorId, patientRef }) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "maik:attach");
  if (!connectorId || !patientRef) throw new Error("connectorId and patientRef required");
  await enforce(deps, env, tenant.id, "maik:attach", actor.id);       // secondary throttle (fail-open counter)
  const sealed = await makeSecrets(env).seal(JSON.stringify({ tenantId: tenant.id, connectorId, patientRef }));
  await deps.kv.put(bindKey(actor.id), sealed, { expirationTtl: BIND_TTL_SEC });   // ciphertext only
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, connectorId, action: "maik.attach",
    outcome: "ok", ts: new Date().toISOString(), patientRefHash: await hmacPseudonym(env, tenant.id, patientRef) });
  return { ok: true };
}

export async function detach(deps, request, env) {
  const actor = await resolveActor(deps.identifyFn, request, env);
  await deps.kv.delete(bindKey(actor.id));
  try { await makeAuditSink(env, deps.db)({ actor: actor.id, action: "maik.detach", outcome: "ok", ts: new Date().toISOString() }); } catch (e) {}
  return { ok: true };
}

// Open the sealed binding for an actor. Returns null when absent or on any decrypt error (fail-safe).
export async function readBinding(env, kv, actorId) {
  const sealed = await kv.get(bindKey(actorId));
  if (!sealed) return null;
  try { return JSON.parse(await makeSecrets(env).open(sealed)); } catch (e) { return null; }
}
