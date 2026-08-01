// functions/_connect/enterprise/ratelimit.js — per-tenant per-action throttle (spec §3.5, ADR-D8).
// The RBAC config write (setLimit) is FAIL-CLOSED. The counter (checkAndCount) is a SECONDARY
// availability control and FAILS OPEN on a KV infra error — a metering blip must never deny a treating
// clinician (mirrors the AI endpoint's "fail-open on any store error so metering never breaks a call").
// The KV key is tenant+action+time ONLY — never a patientRef/identifier (no PHI in KV).
import { requireCan } from "./guard.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink } from "../audit.js";

export class RateLimited extends Error {}       // maps to HTTP 429 in the routes

export const DEFAULT_LIMITS = Object.freeze({
  "context:load": { windowSec: 3600, maxCount: 120 },
  "maik:attach": { windowSec: 3600, maxCount: 240 },
  "connector:validate": { windowSec: 3600, maxCount: 30 },
});

export function rlKey(tenantId, action, now, windowSec) {
  const win = Math.floor(Number(now) / 1000 / windowSec);
  return "connect:rl:" + tenantId + ":" + action + ":" + win;    // no patient data — tenant+action+window only
}

export async function loadLimit(db, tenantId, action) {
  try {
    const r = await db.prepare("SELECT * FROM connect_tenant_limits WHERE tenant_id=?").bind(tenantId).all();
    const row = (r.results || []).find((x) => String(x.action) === String(action));
    if (row) return { windowSec: Number(row.window_sec), maxCount: Number(row.max_count) };
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_LIMITS[action] || { windowSec: 3600, maxCount: 300 };
}

// Primitive: called by an ALREADY-authorized action. Returns {ok, used, limit[, degraded]}.
export async function checkAndCount(kv, tenantId, action, now, limit) {
  const cfg = limit || DEFAULT_LIMITS[action] || { windowSec: 3600, maxCount: 300 };
  const key = rlKey(tenantId, action, now, cfg.windowSec);
  try {
    const cur = Number(await kv.get(key)) || 0;
    if (cur >= cfg.maxCount) return { ok: false, used: cur, limit: cfg.maxCount };
    await kv.put(key, String(cur + 1), { expirationTtl: cfg.windowSec * 2 });
    return { ok: true, used: cur + 1, limit: cfg.maxCount };
  } catch (e) {
    return { ok: true, used: 0, limit: cfg.maxCount, degraded: true };   // fail-OPEN on counter infra error
  }
}

// Enforce on an ALREADY-authorized, deliberate action (e.g. maik:attach). On exceed: write a PHI-free
// ratelimit.block audit event and throw RateLimited (429). Fail-open on a counter infra error. Do NOT
// call this on the AI-endpoint auto-pull — a throttle must never deny a clinical answer (spec §3.5).
export async function enforce(deps, env, tenantId, action, actorId, now = Date.now()) {
  const r = await checkAndCount(deps.kv, tenantId, action, now, await loadLimit(deps.db, tenantId, action));
  if (!r.ok) {
    try { await makeAuditSink(env, deps.db)({ tenantId, actor: actorId, action: "ratelimit.block", outcome: "denied", ts: new Date(now).toISOString() }); } catch (e) {}
    throw new RateLimited(action + " rate limit exceeded (" + r.used + "/" + r.limit + ")");
  }
  return r;
}

export async function setLimit(deps, request, env, tenantId, { action, windowSec, maxCount }) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "ratelimit:write");   // fail-CLOSED authz
  if (!action || !(Number(windowSec) > 0) || !(Number(maxCount) > 0)) throw new PermissionError("action, windowSec>0, maxCount>0 required");
  await deps.db.prepare("INSERT INTO connect_tenant_limits (tenant_id,action,window_sec,max_count) VALUES (?,?,?,?)")
    .bind(tenant.id, action, Number(windowSec), Number(maxCount)).run();
  return { ok: true };
}
