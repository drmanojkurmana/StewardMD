/* ResearchMD Phase 04: Monthly cloud fallback allowance + container cost tracker (ES module).
 *
 * Plan allowances live in _caps.js (`CLOUD_FALLBACKS_PER_MONTH`) and resolve
 * from the canonical entitlement helper (`../../_entitlements.js`) plus founding/
 * legacy `claims.pro` (7-day free trial stays on `free`).
 *
 * NOTE (legacy clients): Cloud jobs created without a `fallback` object in the
 * request body are left unchanged for backwards compatibility with older app
 * versions. Once old versions are retired, server-side enforcement can be
 * switched on unconditionally for all cloud job creations.
 *
 * NOTE (container cost alerts): ResearchMD has no existing automated email/ops
 * push channel for container spend. Monthly container minutes + active threshold
 * flags (`6h`, `100h`) are computed here, logged once per threshold per month
 * (deduped in MAIK_KV when bound), and exposed on the admin ops endpoint.
 */
import { getEntitlement, effectiveTierFor } from "../../_entitlements.js";
import { CLOUD_FALLBACKS_PER_MONTH, CLOUD_FALLBACK_MESSAGES } from "./_caps.js";

export const CONTAINER_ALERT_THRESHOLDS_MIN = [
  { hours: 6, minutes: 360 },
  { hours: 100, minutes: 6000 },
];

const REFUNDABLE_FALLBACK_ERRORS = [
  "callback_unavailable",
  "snapshot_invalid",
  "manuscript_failed",
  "job_lost",
  "device_failed",
  "storage_unavailable",
  "queue_unavailable",
  "worker_crash",
  "extract_failed",
  "stats_failed",
  "container_failed",
  "internal_error",
  "infra_error",
];

function randId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "cfb_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function utcMonthRange(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const month = y + "-" + String(m + 1).padStart(2, "0");
  const monthStartMs = Date.UTC(y, m, 1);
  const resetsAt = new Date(Date.UTC(y, m + 1, 1)).toISOString();
  return { month, monthStartMs, resetsAt };
}

export async function resolveUserPlan(env, uid, claims, nowMs = Date.now()) {
  let rec = null;
  try {
    if (env && uid) rec = await getEntitlement(env, uid);
  } catch {
    rec = null;
  }
  let tier = "free";
  try {
    /* _entitlements stores Trainee as "trainee"; older records and the billing plan key say "student". */
    const raw = String((rec && rec.tier) || "").trim().toLowerCase();
    const norm = raw === "student" ? Object.assign({}, rec, { tier: "trainee" }) : rec;
    tier = effectiveTierFor(norm, nowMs) || "free";
  } catch {
    tier = "free";
  }
  /* Report Trainee under the billing plan key the allowance table and the app use. */
  if (tier === "trainee") tier = "student";
  /* Founding coupons and legacy Pro set claims.pro=true on Firebase token;
   * free trials live on claims.freePro/promo and stay excluded from paid fallback. */
  if (tier === "free" && claims && claims.pro === true && (!claims.proExp || Number(claims.proExp) > nowMs)) {
    tier = "pro";
  }
  return Object.prototype.hasOwnProperty.call(CLOUD_FALLBACKS_PER_MONTH, tier) ? tier : "free";
}

export async function getCloudFallbackStatus(env, db, uid, claims, nowMs = Date.now()) {
  const plan = await resolveUserPlan(env, uid, claims, nowMs);
  const allowance = CLOUD_FALLBACKS_PER_MONTH[plan] ?? 0;
  const { month, resetsAt } = utcMonthRange(nowMs);
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM research_cloud_fallbacks WHERE uid=? AND month=? AND status='used'")
    .bind(uid, month).first();
  const used = Number((row && row.n) || 0);
  const remaining = Math.max(0, allowance - used);
  return { plan, allowance, used, remaining, month, resetsAt };
}

export async function checkCloudFallbackAvailable(env, db, uid, claims, nowMs = Date.now()) {
  const status = await getCloudFallbackStatus(env, db, uid, claims, nowMs);
  if (status.remaining > 0) return { ok: true, status };
  if (status.allowance === 0) {
    return {
      ok: false,
      http: 402,
      code: "cloud_fallback_free",
      message: CLOUD_FALLBACK_MESSAGES.cloud_fallback_free,
      status,
    };
  }
  return {
    ok: false,
    http: 402,
    code: "cloud_fallback_limit",
    message: CLOUD_FALLBACK_MESSAGES.cloud_fallback_limit,
    status,
  };
}

/* Strip any non-metadata fields so file bytes, patient rows, or manuscript text never land in D1. */
export function parseFormFallback(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return null;
}

export function sanitizeFallbackMetadata(fallback) {
  if (!fallback || typeof fallback !== "object" || Array.isArray(fallback)) return {};
  const reasons = Array.isArray(fallback.reasons)
    ? fallback.reasons.slice(0, 6).map((r) => {
        if (!r || typeof r !== "object") return { rule: String(r || "").slice(0, 80) };
        return {
          try: Number.isFinite(r.try) ? r.try : undefined,
          rule: String(r.rule || r.code || "").slice(0, 80),
          code: String(r.code || "").slice(0, 80),
          detail: r.detail ? String(r.detail).slice(0, 120) : undefined,
        };
      })
    : [];
  const d = fallback.device && typeof fallback.device === "object" ? fallback.device : null;
  const device = d ? {
    model: d.model ? String(d.model).slice(0, 80) : undefined,
    platform: d.platform ? String(d.platform).slice(0, 40) : undefined,
    operatingSystem: d.operatingSystem ? String(d.operatingSystem).slice(0, 40) : undefined,
    osVersion: d.osVersion ? String(d.osVersion).slice(0, 40) : undefined,
    manufacturer: d.manufacturer ? String(d.manufacturer).slice(0, 60) : undefined,
    appVersion: d.appVersion ? String(d.appVersion).slice(0, 40) : undefined,
    engine: d.engine ? String(d.engine).slice(0, 80) : undefined,
  } : undefined;
  return {
    reasons,
    ...(device ? { device } : {}),
    ...(fallback.appVersion ? { appVersion: String(fallback.appVersion).slice(0, 40) } : {}),
    ...(fallback.engine ? { engine: String(fallback.engine).slice(0, 80) } : {}),
  };
}

export async function recordCloudFallbackUsed(db, { uid, projectId, kind, jobId, fallback, nowMs = Date.now() }) {
  if (jobId) {
    const existing = await db.prepare(
      "SELECT id FROM research_cloud_fallbacks WHERE job_id=? AND status='used' LIMIT 1")
      .bind(jobId).first();
    if (existing) return existing.id;
  }
  const { month } = utcMonthRange(nowMs);
  const id = randId();
  const reasonJson = JSON.stringify(sanitizeFallbackMetadata(fallback));
  await db.prepare(
    "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,?,?,?,?,?,'used',?,?)")
    .bind(id, uid, projectId || "", kind, jobId || "", month, reasonJson, nowMs).run();
  return id;
}

export function isRefundableFallbackError(errorCode) {
  const c = String(errorCode || "").trim().toLowerCase();
  if (!c) return false;
  if (c.startsWith("gateway")) return true;
  return REFUNDABLE_FALLBACK_ERRORS.indexOf(c) >= 0;
}

export async function refundCloudFallbackForJob(db, jobId, errorCode) {
  if (!jobId || !isRefundableFallbackError(errorCode)) return false;
  const res = await db.prepare(
    "UPDATE research_cloud_fallbacks SET status='refunded' WHERE job_id=? AND status='used'")
    .bind(jobId).run();
  return ((res && res.meta && res.meta.changes) || 0) > 0;
}

export async function computeMonthlyContainerMinutes(db, nowMs = Date.now()) {
  const { month, monthStartMs } = utcMonthRange(nowMs);
  const jobRows = await db.prepare(
    "SELECT started_ts, completed_ts, status, output_json FROM research_job_runs WHERE started_ts IS NOT NULL AND started_ts >= ?")
    .bind(monthStartMs).all();
  const statsRows = await db.prepare(
    "SELECT started_ts, completed_ts, status FROM research_stats_jobs WHERE started_ts IS NOT NULL AND started_ts >= ?")
    .bind(monthStartMs).all();

  let totalMinutes = 0;
  let wakes = 0;
  const addRow = (row) => {
    const start = Number(row.started_ts);
    if (!Number.isFinite(start) || start <= 0) return;
    let end = row.completed_ts != null ? Number(row.completed_ts) : (row.status === "running" ? nowMs : start);
    if (!Number.isFinite(end) || end < start) end = start;
    /* Runtime duration plus 1 idle minute per container wake (IDLE_MS = 60s). */
    totalMinutes += (end - start) / 60000 + 1;
    wakes += 1;
  };

  for (const r of (jobRows && jobRows.results) || []) {
    const out = String(r.output_json || "");
    if (out.indexOf('"engine":"ondevice"') >= 0 || out.indexOf('"runner":"device"') >= 0) continue;
    addRow(r);
  }
  for (const r of (statsRows && statsRows.results) || []) {
    addRow(r);
  }
  const minutes = Math.round(totalMinutes * 100) / 100;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return { month, minutes, hours, wakes };
}

export async function checkContainerHoursAlerts(env, db, nowMs = Date.now()) {
  const usage = await computeMonthlyContainerMinutes(db, nowMs);
  const triggered = [];
  for (const t of CONTAINER_ALERT_THRESHOLDS_MIN) {
    if (usage.minutes < t.minutes) continue;
    triggered.push(t.hours);
    const kv = env && env.MAIK_KV;
    const key = "research:container_alert:" + usage.month + ":" + t.hours + "h";
    let alreadyLogged = false;
    try {
      if (kv && typeof kv.get === "function") {
        alreadyLogged = Boolean(await kv.get(key));
        if (!alreadyLogged && typeof kv.put === "function") {
          await kv.put(key, String(usage.minutes), { expirationTtl: 60 * 60 * 24 * 45 });
        }
      }
    } catch { /* best effort alert dedup */ }
    if (!alreadyLogged) {
      console.warn("research:container_hours_alert", JSON.stringify({
        month: usage.month, thresholdHours: t.hours, minutes: usage.minutes, hours: usage.hours, wakes: usage.wakes,
      }));
    }
  }
  return Object.assign({}, usage, { thresholdsExceededHours: triggered });
}
