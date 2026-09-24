/* functions/_maik_feedback.js — "Was this helpful?" answer feedback (MaiK).
 *
 * Owner: "was this helpful button feedback stores where?" -> nowhere durable (an anonymous
 * server-side up/down COUNTER only, plus a device-local-only gap log). Owner then asked for an
 * admin console section, and for a "No" tap to ask why and store the reason. This is that store.
 *
 * METADATA + the doctor's own free-text reason, NEVER patient data: helpful (up/down), the QUESTION
 * the doctor typed (identifier-stripped via _deid.js, then clipped - a clinical question is not
 * itself PHI, but doctors paste bed/UHID numbers), an OPTIONAL reason typed after a "No", which
 * engine/pack answered, and a server timestamp. No identity is required or stored (mirrors
 * functions/api/ws-feedback.js's anonymous-signal stance) - this is product-quality signal, not a
 * user record. Ring buffer + aggregate, same shape as _clientlog.js so the admin console pattern
 * (getX/recordX/clearX) is identical across both panes. */

import { stripIdentifiers } from "./_deid.js";

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
    // Identifier-like content (MRN/UHID/bed, phone, email, 4+ digit runs, "patient name ...") is
    // stripped BEFORE storage: this row is kept 90 days and read in the admin console (T10).
    question: clip(stripIdentifiers(rec.question), 300),
    reason: clip(stripIdentifiers(rec.reason), 500),
    engine: clip(rec.engine, 20),   // "cloud" | "local" | "kb" | "rag" - never a raw model name
    pack: clip(rec.pack, 40),       // on-device pack label, when engine is local
  };
}

/* SHARDED (T53). One maikfb:recent list and one maikfb:agg object were read-modify-written on every
 * tap, so two doctors tapping at once lost one of the ratings. Each write now lands in one of SHARDS
 * random shard keys (maikfb:recent:<n> / maikfb:agg:<n>) and the readers merge them, plus the legacy
 * unsharded keys so nothing recorded before this change disappears. A collision now needs two taps
 * on the same shard at once.
 * ponytail: still KV read-modify-write within a shard; move to D1 if feedback volume ever grows. */
export const SHARDS = 4;
const shardKey = (base, n) => base + ":" + n;
const allKeys = (base) => [base].concat(Array.from({ length: SHARDS }, (_, n) => shardKey(base, n)));
async function readList(store, key) {
  try { const raw = await store.get(key); const l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
async function readAgg(store, key) {
  try { return JSON.parse((await store.get(key)) || "null") || null; } catch (e) { return null; }
}

/** Records the rating immediately (so the aggregate reflects every tap, not just the ones a doctor
 * stays to explain) and returns the stored entry's id, so a "No" that leads to a typed reason can
 * amend THIS SAME row a moment later via amendFeedbackReason - never a second, duplicate entry. */
export async function recordFeedback(store, rec, now) {
  if (!store) return null;
  const s = sanitizeFeedback(rec, now);
  if (!s.helpful) return null;   // nothing to log without a rating
  const shard = Math.floor(Math.random() * SHARDS);
  try {
    let list = await readList(store, shardKey(FEEDBACK_KEY, shard));
    list.unshift(s);
    if (list.length > CAP) list = list.slice(0, CAP);
    await store.put(shardKey(FEEDBACK_KEY, shard), JSON.stringify(list), { expirationTtl: TTL });
    const agg = (await readAgg(store, shardKey(FEEDBACK_AGG_KEY, shard))) || {};
    agg.up = (agg.up || 0) + (s.helpful === "up" ? 1 : 0);
    agg.down = (agg.down || 0) + (s.helpful === "down" ? 1 : 0);
    agg.withReason = (agg.withReason || 0) + (s.reason ? 1 : 0);
    agg.total = (agg.up || 0) + (agg.down || 0);
    await store.put(shardKey(FEEDBACK_AGG_KEY, shard), JSON.stringify(agg), { expirationTtl: TTL });
    return s.id;
  } catch (e) { return null; /* best-effort telemetry: a lost row must never break the app or the endpoint */ }
}

/** Attaches a doctor's typed reason to their own just-recorded "No", found by id in whichever shard
 * (or the legacy list) holds it, within the ring buffer's current window. Bumps that shard's
 * withReason once, the first time a reason lands. */
export async function amendFeedbackReason(store, id, reason, now) {
  if (!store || !id) return false;
  try {
    const keys = allKeys(FEEDBACK_KEY), aggKeys = allKeys(FEEDBACK_AGG_KEY);
    for (let i = 0; i < keys.length; i++) {
      const list = await readList(store, keys[i]);
      let found = false, hadReason = false;
      const next = list.map(function (e) {
        if (e && e.id === id) { found = true; hadReason = !!e.reason; return Object.assign({}, e, { reason: clip(stripIdentifiers(reason), 500) }); }
        return e;
      });
      if (!found) continue;
      await store.put(keys[i], JSON.stringify(next), { expirationTtl: TTL });
      if (!hadReason && reason) {
        try {
          const agg = (await readAgg(store, aggKeys[i])) || {};
          agg.withReason = (agg.withReason || 0) + 1;
          await store.put(aggKeys[i], JSON.stringify(agg), { expirationTtl: TTL });
        } catch (e) {}
      }
      return true;
    }
    return false;
  } catch (e) { return false; }
}

export async function getFeedback(store) {
  if (!store) return [];
  try {
    const lists = await Promise.all(allKeys(FEEDBACK_KEY).map((k) => readList(store, k)));
    return [].concat.apply([], lists).sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, CAP);
  } catch (e) { return []; }
}

export async function getFeedbackAgg(store) {
  const out = { up: 0, down: 0, withReason: 0, total: 0 };
  if (!store) return out;
  try {
    const aggs = await Promise.all(allKeys(FEEDBACK_AGG_KEY).map((k) => readAgg(store, k)));
    aggs.forEach((a) => { if (a) { out.up += a.up || 0; out.down += a.down || 0; out.withReason += a.withReason || 0; } });
    out.total = out.up + out.down;
    return out;
  } catch (e) { return { up: 0, down: 0, withReason: 0, total: 0 }; }
}

export async function clearFeedback(store) {
  if (!store) return;
  try {
    for (const k of allKeys(FEEDBACK_KEY)) await store.put(k, "[]", { expirationTtl: TTL });
    for (const k of allKeys(FEEDBACK_AGG_KEY)) await store.put(k, JSON.stringify({ up: 0, down: 0, withReason: 0, total: 0 }), { expirationTtl: TTL });
  } catch (e) {}
}
