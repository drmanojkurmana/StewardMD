// functions/_connect/agent/viewer-token.js — short-lived, actor-bound, SINGLE-USE viewer authorization.
//
// The token authorizes ONE attachment to ONE session's login viewport. It carries no EMR secret, no
// cookie and no runner reference: it is a claim check, and the server does the resolving.
//
// Invariants, all enforced in redeemViewerToken:
//   * keyed HMAC (CONNECT_AGENT_TOKEN_KEY via the existing secrets facility) — a forged or edited token
//     fails before any row is read;
//   * short TTL (default 120s) checked against the server clock, not a client-supplied time;
//   * actor-bound — the redeeming actor must be the actor it was minted for;
//   * session-bound — and the session must still be live;
//   * SINGLE USE — used_at is stamped on first redemption; a second redemption is a conflict;
//   * revocable — cancelling a session revokes every outstanding token for it.
//
// NEVER put this token in a URL. It is returned in a JSON body and must be presented in the
// x-smd-viewer-token header. A URL leaks through Referer, browser history, server logs and analytics,
// and this token is a session capability.
import { OnboardError } from "../onboard/errors.js";
import { hmacHex, equalHex, sha256hex, utf8b64url, b64urlUtf8 } from "./hmac.js";
import { insertViewerToken, getViewerToken, markViewerTokenUsed, newId } from "./store.js";

export const VIEWER_TOKEN_PREFIX = "smdvt1";
export const VIEWER_TOKEN_TTL_MS = 120 * 1000;
export const VIEWER_TOKEN_MAX_TTL_MS = 10 * 60 * 1000;

async function tokenKey(deps, env) {
  // deps.secrets is makeSecrets(env) — the same facility the onboard store seals credentials with. Its
  // get() reads a named env var, which is where a Pages secret lands.
  const key = deps.secrets ? await deps.secrets.get("CONNECT_AGENT_TOKEN_KEY") : (env && env.CONNECT_AGENT_TOKEN_KEY);
  if (!key) throw new OnboardError("not-configured", "CONNECT_AGENT_TOKEN_KEY missing");
  return String(key);
}

// The actor id is HASHED into the token rather than embedded: the token is handed to a viewport client,
// and an opaque id ("fb:<uid>") is still an identifier we do not need to hand out again.
async function actorTag(actorId) { return (await sha256hex(String(actorId))).slice(0, 32); }

export async function issueViewerToken(deps, env, { session, actorId, ttlMs, now }) {
  const key = await tokenKey(deps, env);
  const nowMs = Number(now != null ? now : deps.now());
  const ttl = Math.min(Number(ttlMs) > 0 ? Number(ttlMs) : VIEWER_TOKEN_TTL_MS, VIEWER_TOKEN_MAX_TTL_MS);
  // A viewer token never outlives its session.
  const exp = Math.min(nowMs + ttl, Number(session.expires_at));
  if (exp <= nowMs) throw new OnboardError("expired", "session expired");
  const jti = newId("vt_");
  const payload = { jti, sid: String(session.id), tid: String(session.tenant_id), aid: await actorTag(actorId), exp };
  const body = utf8b64url(JSON.stringify(payload));
  const sig = await hmacHex(key, VIEWER_TOKEN_PREFIX + "." + body);
  await insertViewerToken(deps.db, { jti, tenant_id: session.tenant_id, session_id: session.id, actor_id: String(actorId), expires_at: exp });
  return { token: VIEWER_TOKEN_PREFIX + "." + body + "." + sig, expiresAt: exp, jti };
}

// redeemViewerToken — verify then consume. Every failure is the SAME klass ("forbidden") except an
// outright expiry, so a caller cannot probe which of the checks it tripped.
export async function redeemViewerToken(deps, env, token, { actorId, now } = {}) {
  const key = await tokenKey(deps, env);
  const nowMs = Number(now != null ? now : deps.now());
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== VIEWER_TOKEN_PREFIX) throw new OnboardError("forbidden", "viewer token invalid");
  const expected = await hmacHex(key, VIEWER_TOKEN_PREFIX + "." + parts[1]);
  if (!equalHex(expected, parts[2])) throw new OnboardError("forbidden", "viewer token invalid");

  let payload;
  try { payload = JSON.parse(b64urlUtf8(parts[1])); } catch { throw new OnboardError("forbidden", "viewer token invalid"); }
  if (!payload || typeof payload !== "object") throw new OnboardError("forbidden", "viewer token invalid");
  if (!Number.isFinite(Number(payload.exp)) || nowMs >= Number(payload.exp)) throw new OnboardError("expired", "viewer token expired");

  const row = await getViewerToken(deps.db, payload.jti);
  if (!row) throw new OnboardError("forbidden", "viewer token invalid");
  if (String(row.session_id) !== String(payload.sid) || String(row.tenant_id) !== String(payload.tid)) throw new OnboardError("forbidden", "viewer token invalid");
  if (row.revoked_at != null) throw new OnboardError("forbidden", "viewer token invalid");
  if (row.used_at != null) throw new OnboardError("conflict", "viewer token already used");
  if (nowMs >= Number(row.expires_at)) throw new OnboardError("expired", "viewer token expired");
  // Actor binding: both against the stored row and against the tag inside the signed payload, so neither
  // a swapped row nor a swapped payload alone is enough.
  if (actorId != null) {
    if (String(row.actor_id) !== String(actorId)) throw new OnboardError("forbidden", "viewer token invalid");
    if (payload.aid !== await actorTag(actorId)) throw new OnboardError("forbidden", "viewer token invalid");
  }
  const after = await markViewerTokenUsed(deps.db, payload.jti, nowMs);
  // Re-read guard: if a concurrent redemption stamped a DIFFERENT used_at first, this one lost the race.
  if (!after || Number(after.used_at) !== nowMs) throw new OnboardError("conflict", "viewer token already used");
  return { sessionId: row.session_id, tenantId: row.tenant_id, actorId: row.actor_id, jti: payload.jti };
}
