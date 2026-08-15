/* functions/_analytics.js — privacy-safe product analytics. Counts ALLOW-LISTED event names only
 * (never free-text, never PHI, never per-user detail) into KV daily rollups, so you can see feature
 * adoption + the verify->active funnel under DPDP without touching patient data. Pure + KV; tested. */

// Only these events are counted. Anything else is dropped (guarantees no PHI/free-text leaks in).
export const ALLOWED_EVENTS = [
  "app_open",
  "verify_start", "verify_complete", "verify_trial",
  "scribe_start", "scribe_saved",
  "maik_ask", "maik_query",
  "insulin_calc", "opd_patient_open", "opd_assess_save",
  "followcare_sent", "kardiox_used", "fundx_used", "connect_pull",
  "support_ticket",
];
const ALLOWED = new Set(ALLOWED_EVENTS);
function day(now) { return new Date(now || Date.now()).toISOString().slice(0, 10); }
const TTL = 60 * 60 * 24 * 120; // ~120 days of daily rollups

export function isAllowedEvent(e) { return ALLOWED.has(String(e || "")); }

export async function recordEvent(store, event, now) {
  if (!store || !isAllowedEvent(event)) return;
  var key = "analytics:" + day(now);
  try {
    var raw = await store.get(key);
    var d = raw ? JSON.parse(raw) : { byEvent: {}, total: 0 };
    if (!d.byEvent) d.byEvent = {};
    d.byEvent[event] = (d.byEvent[event] || 0) + 1;
    d.total = (d.total || 0) + 1;
    await store.put(key, JSON.stringify(d), { expirationTtl: TTL });
  } catch (e) { /* best-effort; analytics must never break a request */ }
}

// Aggregate the last N days: per-event totals + a per-day series.
export async function getAnalytics(store, days, now) {
  var out = { days: [], totals: {}, grandTotal: 0 };
  if (!store) return out;
  var n = Math.min(90, Math.max(1, days | 0 || 7));
  var base = now || Date.now();
  for (var i = 0; i < n; i++) {
    var dstr = day(base - i * 86400000);
    try {
      var raw = await store.get("analytics:" + dstr);
      var d = raw ? JSON.parse(raw) : { byEvent: {}, total: 0 };
      out.days.push({ day: dstr, total: d.total || 0, byEvent: d.byEvent || {} });
      out.grandTotal += d.total || 0;
      for (var k in (d.byEvent || {})) if (Object.prototype.hasOwnProperty.call(d.byEvent, k)) out.totals[k] = (out.totals[k] || 0) + d.byEvent[k];
    } catch (e) { out.days.push({ day: dstr, total: 0, byEvent: {} }); }
  }
  return out;
}
