/* functions/_clientlog.js — client crash / uncaught-error telemetry.
 * METADATA ONLY, NEVER PHI: message + stack + scrubbed path + build + platform + hashed uid. Stored as a
 * KV ring buffer (newest-first, deduped by signature with a count) so the fleet's crashes are visible in
 * the admin console. Pure + KV; unit-tested. Mirrors the AI audit-log pattern in _ai_usage.js. */

export const CLIENTLOG_KEY = "clientlog:recent";
const CAP = 200;
const TTL = 60 * 60 * 24 * 14; // 14 days

function clip(s, n) { s = (s == null ? "" : String(s)); return s.length > n ? s.slice(0, n) : s; }

// Strip anything identifying/PHI from a path: query string, fragment, and long numeric/hex segments
// (patient ids, mrns, tokens) collapse to ":id".
export function scrubUrl(u) {
  u = String(u || "");
  var q = u.indexOf("?"); if (q > -1) u = u.slice(0, q);
  var h = u.indexOf("#"); if (h > -1) u = u.slice(0, h);
  return u.replace(/\/[0-9a-fA-F]{6,}(?=\/|$)/g, "/:id").slice(0, 300);
}

export function sanitizeClientLog(rec, now) {
  rec = rec || {};
  var lvl = String(rec.level || "error");
  if (["error", "warn", "fatal", "unhandledrejection"].indexOf(lvl) < 0) lvl = "error";
  return {
    ts: now || Date.now(),
    level: lvl,
    message: clip(rec.message, 300),
    stack: clip(rec.stack, 1500),
    url: scrubUrl(rec.url),
    build: clip(rec.build, 40),
    platform: clip(rec.platform, 20),
    ua: clip(rec.ua, 200),
    uidHash: clip(rec.uidHash, 24),   // hashed uid only; the client must never send a raw uid/email
  };
}

// Dedup signature: same message + build + first stack frame => one row with a count (so one crash looping
// on 1000 phones doesn't blow the ring buffer or hide other errors).
function sig(r) { return (r.message + "|" + r.build + "|" + (r.stack || "").split("\n")[0]).slice(0, 220); }

export async function recordClientError(store, rec, now) {
  if (!store) return;
  var s = sanitizeClientLog(rec, now);
  if (!s.message) return;
  try {
    var raw = await store.get(CLIENTLOG_KEY);
    var list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    var g = sig(s);
    var existing = null;
    list = list.filter(function (x) { if (x && x._sig === g) { existing = x; return false; } return true; });
    if (existing) { s._sig = g; s.count = (existing.count || 1) + 1; s.firstTs = existing.firstTs || existing.ts; }
    else { s._sig = g; s.count = 1; s.firstTs = s.ts; }
    list.unshift(s);
    if (list.length > CAP) list = list.slice(0, CAP);
    await store.put(CLIENTLOG_KEY, JSON.stringify(list), { expirationTtl: TTL });
  } catch (e) { /* best-effort telemetry: a lost error must never break the app or the endpoint */ }
}

export async function getClientErrors(store) {
  if (!store) return [];
  try { var raw = await store.get(CLIENTLOG_KEY); var l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}

export async function clearClientErrors(store) {
  if (!store) return; try { await store.put(CLIENTLOG_KEY, "[]", { expirationTtl: TTL }); } catch (e) {}
}
