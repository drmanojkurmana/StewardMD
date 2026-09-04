/* functions/_maik_feedback.js — "Was this helpful?" answer feedback (MaiK).
 *
 * Owner: "was this helpful button feedback stores where?" -> nowhere durable (an anonymous
 * server-side up/down COUNTER only, plus a device-local-only gap log). Owner then asked for an
 * admin console section, and for a "No" tap to ask why and store the reason. This is that store.
 *
 * METADATA + the doctor's own free-text reason, NEVER patient data: helpful (up/down), the QUESTION
 * the doctor typed (clipped, same practice as _clientlog.js's message field - a clinical question is
 * not itself PHI, but is still clipped defensively), an OPTIONAL reason typed after a "No", which
 * engine/pack answered, and a server timestamp. No identity is required or stored (mirrors
 * functions/api/ws-feedback.js's anonymous-signal stance) - this is product-quality signal, not a
 * user record. Ring buffer + aggregate, same shape as _clientlog.js so the admin console pattern
 * (getX/recordX/clearX) is identical across both panes. */

export const FEEDBACK_KEY = "maikfb:recent";
export const FEEDBACK_AGG_KEY = "maikfb:agg";
const CAP = 500;
const TTL = 60 * 60 * 24 * 90; // 90 days - product signal, kept longer than crash telemetry

function clip(s, n) { s = (s == null ? "" : String(s)); return s.length > n ? s.slice(0, n) : s; }

function genId(now) { return now + "-" + Math.random().toString(36).slice(2, 8); }

export function sanitizeFeedback(rec, now) {
  rec = rec || {};
  const helpful = rec.helpful === "up" ? "up" : rec.helpful === "down" ? "down" : null;
  return {
    id: genId(now || Date.now()),
    ts: now || Date.now(),
    helpful,
    question: clip(rec.question, 300),
    reason: clip(rec.reason, 500),
    engine: clip(rec.engine, 20),   // "cloud" | "local" | "kb" | "rag" - never a raw model name
    pack: clip(rec.pack, 40),       // on-device pack label, when engine is local
  };
}

/** Records the rating immediately (so the aggregate reflects every tap, not just the ones a doctor
 * stays to explain) and returns the stored entry's id, so a "No" that leads to a typed reason can
 * amend THIS SAME row a moment later via amendFeedbackReason - never a second, duplicate entry. */
export async function recordFeedback(store, rec, now) {
  if (!store) return null;
  const s = sanitizeFeedback(rec, now);
  if (!s.helpful) return null;   // nothing to log without a rating
  try {
    const raw = await store.get(FEEDBACK_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    list.unshift(s);
    if (list.length > CAP) list = list.slice(0, CAP);
    await store.put(FEEDBACK_KEY, JSON.stringify(list), { expirationTtl: TTL });
    // Best-effort aggregate (KV has no atomic inc; a rare race under-counts, acceptable for signal).
    let agg = {};
    try { agg = JSON.parse((await store.get(FEEDBACK_AGG_KEY)) || "{}"); } catch (e) { agg = {}; }
    agg.up = (agg.up || 0) + (s.helpful === "up" ? 1 : 0);
    agg.down = (agg.down || 0) + (s.helpful === "down" ? 1 : 0);
    agg.withReason = (agg.withReason || 0) + (s.reason ? 1 : 0);
    agg.total = (agg.up || 0) + (agg.down || 0);
    await store.put(FEEDBACK_AGG_KEY, JSON.stringify(agg), { expirationTtl: TTL });
    return s.id;
  } catch (e) { return null; /* best-effort telemetry: a lost row must never break the app or the endpoint */ }
}

/** Attaches a doctor's typed reason to their own just-recorded "No", found by id, within the ring
 * buffer's current window (older entries may already have rolled off, which is fine - the reason is
 * best-effort, not a guaranteed write). Bumps agg.withReason once, the first time a reason lands. */
export async function amendFeedbackReason(store, id, reason, now) {
  if (!store || !id) return false;
  try {
    const raw = await store.get(FEEDBACK_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return false;
    let found = false, hadReason = false;
    list = list.map(function (e) {
      if (e && e.id === id) { found = true; hadReason = !!e.reason; return Object.assign({}, e, { reason: clip(reason, 500) }); }
      return e;
    });
    if (!found) return false;
    await store.put(FEEDBACK_KEY, JSON.stringify(list), { expirationTtl: TTL });
    if (!hadReason && reason) {
      try {
        const agg = JSON.parse((await store.get(FEEDBACK_AGG_KEY)) || "{}");
        agg.withReason = (agg.withReason || 0) + 1;
        await store.put(FEEDBACK_AGG_KEY, JSON.stringify(agg), { expirationTtl: TTL });
      } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}

export async function getFeedback(store) {
  if (!store) return [];
  try { const raw = await store.get(FEEDBACK_KEY); const l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}

export async function getFeedbackAgg(store) {
  if (!store) return { up: 0, down: 0, withReason: 0, total: 0 };
  try { return JSON.parse((await store.get(FEEDBACK_AGG_KEY)) || "null") || { up: 0, down: 0, withReason: 0, total: 0 }; }
  catch (e) { return { up: 0, down: 0, withReason: 0, total: 0 }; }
}

export async function clearFeedback(store) {
  if (!store) return;
  try {
    await store.put(FEEDBACK_KEY, "[]", { expirationTtl: TTL });
    await store.put(FEEDBACK_AGG_KEY, JSON.stringify({ up: 0, down: 0, withReason: 0, total: 0 }), { expirationTtl: TTL });
  } catch (e) {}
}
