/* functions/_queue_timeline.js — OPD encounter timeline (owner vision 2026-08-09).
 *
 * A per-encounter, append-only clinical timeline: assessment + clinical notes, medications-as-notes,
 * vitals, and key queue events. At checkout it is sealed and shared with the patient via a secure,
 * no-PHI-in-URL link (7-day validity, doctor-extendable to 30). It self-expires (Firestore TTL on
 * `expiresAt`) so it never grows the database. Clinical text is PHI -> encrypted at rest (encPHI),
 * reusing the app's key. The patient link reuses the queue's signed ticket token (exp + ver-revoke).
 *
 * Medications have TWO paths (owner): "Add to timeline" = a note here ONLY (no EMR write, safe today);
 * "Save" = the real pharmacy/EMR order (GHIS CreateDrugs — still hard-gated until captured).
 *
 * Pure helpers (tlKind/clampExtendMs/timelineLive) are unit-tested; the I/O is thin over Firestore.
 * ponytail: entries live in one doc's array (single-writer per encounter, low volume). If a future
 * flow appends concurrently, move to a q_timeline_events subcollection.
 */
import { fsGet, fsCommit, wCreate, wUpdate, fsQuery } from "./_fbfirestore.js";
import { encPHI, decPHI, mintTicketToken, verifyTicketToken, ticketIdFromToken } from "./_queue.js";

const now = () => Date.now();
const DAY = 86400000;
const OPEN_TTL_MS = 2 * DAY;   // an un-checked-out timeline is cleaned up ~2 days later
const LINK_DAYS_DEFAULT = 7;
const LINK_DAYS_MAX = 30;

// ---- pure helpers -------------------------------------------------------------------------------
export const TL_KINDS = ["note", "assessment", "medication", "vitals", "status", "move", "checkout"];
export function tlKind(k) { k = String(k || "").toLowerCase(); return TL_KINDS.indexOf(k) > -1 ? k : "note"; }
// A doctor may extend the link, clamped to [1, 30] days from now.
export function clampExtendMs(nowMs, days) { const n = (days == null || isNaN(Number(days))) ? LINK_DAYS_DEFAULT : Number(days); const d = Math.max(1, Math.min(LINK_DAYS_MAX, Math.round(n))); return nowMs + d * DAY; }
// The patient's token was minted at checkout to expire at closedAt + LINK_DAYS_MAX, so no extension can
// outlive that. Promising a later date would show the doctor an expiry the link never reaches.
export function extendLinkMs(nowMs, days, closedAt) { return Math.min(clampExtendMs(nowMs, days), (Number(closedAt) || nowMs) + LINK_DAYS_MAX * DAY); }
// The patient link is live only after checkout and before linkExpiresAt.
export function timelineLive(doc, nowMs) { return !!(doc && doc.linkExpiresAt && nowMs <= doc.linkExpiresAt); }

// ---- append a clinical entry (creates the timeline doc on first write) --------------------------
export async function appendTimeline(env, session, ticket, kind, text, by) {
  const id = ticket.id;
  const enc = await encPHI(env, String(text || "").slice(0, 4000));
  const entry = { ts: now(), kind: tlKind(kind), by: String(by || "").slice(0, 60), enc: enc };
  const existing = await fsGet(env, "q_timeline/" + id);
  if (!existing) {
    const f = {
      ticketId: id, sessionId: session.id, doctorUid: session.doctorUid || "", hospitalId: session.hospitalId || "",
      mrnLast4: ticket.mrnLast4 || "", entries: [entry], closed: false, closedAt: 0, linkExpiresAt: 0, token: "",
      tokenVer: 1, createdAt: now(), updatedAt: now(), expiresAt: now() + OPEN_TTL_MS
    };
    await fsCommit(env, [wCreate(env, "q_timeline/" + id, f)]);
    return { ok: true, count: 1 };
  }
  const doc = existing.fields;
  const entries = (Array.isArray(doc.entries) ? doc.entries : []).concat([entry]);
  await fsCommit(env, [wUpdate(env, "q_timeline/" + id, { entries: entries, updatedAt: now(), expiresAt: Math.max(doc.expiresAt || 0, now() + OPEN_TTL_MS) })]);
  return { ok: true, count: entries.length };
}

// ---- staff/doctor view (decrypted) --------------------------------------------------------------
export async function getTimeline(env, ticketId) {
  const d = await fsGet(env, "q_timeline/" + ticketId); if (!d) return null;
  const doc = d.fields;
  const entries = await Promise.all((doc.entries || []).map(async (e) => ({ ts: e.ts, kind: e.kind, by: e.by, text: await decPHI(env, e.enc) })));
  return { ticketId: ticketId, mrnLast4: doc.mrnLast4 || "", closed: !!doc.closed, closedAt: doc.closedAt || 0, linkExpiresAt: doc.linkExpiresAt || 0, entries: entries };
}

// ---- PATIENT view: opaque token -> their own timeline (only after checkout, while the link is live) --
export async function getTimelineByToken(env, token) {
  const id = ticketIdFromToken(token); if (!id) return { error: "invalid" };
  const d = await fsGet(env, "q_timeline/" + id); if (!d) return { error: "not_found" };
  const doc = d.fields;
  const v = await verifyTicketToken(env, token, doc.tokenVer || 1); if (!v || !v.ok) return { error: "invalid" };
  if (!doc.closed) return { error: "not_ready" };
  if (!timelineLive(doc, now())) return { error: "expired" };
  const entries = await Promise.all((doc.entries || []).map(async (e) => ({ ts: e.ts, kind: e.kind, text: await decPHI(env, e.enc) })));  // 'by' omitted for the patient
  return { ok: true, mrnLast4: doc.mrnLast4 || "", closedAt: doc.closedAt || 0, linkExpiresAt: doc.linkExpiresAt || 0, entries: entries };
}

// ---- checkout: seal the timeline, 7-day link, mint the patient token (30-day cap window) --------
export async function finalizeCheckout(env, session, ticket, actor) {
  const id = ticket.id;
  const nowMs = now();
  const linkExpiresAt = nowMs + LINK_DAYS_DEFAULT * DAY;
  const maxExp = nowMs + LINK_DAYS_MAX * DAY;   // token exp = the widest possible extension window
  await appendTimeline(env, session, ticket, "checkout", "Visit completed", actor);   // ensures the doc exists
  const d = await fsGet(env, "q_timeline/" + id);
  const tokenVer = (d && d.fields && d.fields.tokenVer) || 1;
  const token = await mintTicketToken(env, id, maxExp, tokenVer);
  // expiresAt (TTL) tracks the effective link expiry, so an un-extended timeline is deleted at 7 days.
  await fsCommit(env, [wUpdate(env, "q_timeline/" + id, { closed: true, closedAt: nowMs, linkExpiresAt: linkExpiresAt, expiresAt: linkExpiresAt, token: token, updatedAt: nowMs })]);
  const base = (env && env.QUEUE_LINK_BASE) || "https://stewardmd.in";
  return { token: token, url: base.replace(/\/+$/, "") + "/queue?t=" + token + "&v=t", linkExpiresAt: linkExpiresAt };
}

// ---- doctor extends the link (up to 30 days from now) -------------------------------------------
export async function extendTimeline(env, ticketId, days) {
  const d = await fsGet(env, "q_timeline/" + ticketId); if (!d) return { error: "not_found" };
  // Before checkout there is no link, and writing expiresAt would cut the open visit's clean-up window.
  if (!d.fields.closed) return { error: "not_ready" };
  const linkExpiresAt = extendLinkMs(now(), days, d.fields.closedAt);
  await fsCommit(env, [wUpdate(env, "q_timeline/" + ticketId, { linkExpiresAt: linkExpiresAt, expiresAt: linkExpiresAt, updatedAt: now() })]);
  return { ok: true, linkExpiresAt: linkExpiresAt };
}

// ---- doctor's treated-patient history (closed + not expired). Masked: mrnLast4 + counts only. ----
export async function listTreated(env, doctorUid) {
  const rows = await fsQuery(env, "q_timeline", { where: { field: "doctorUid", value: String(doctorUid) }, limit: 300 });
  const nowMs = now();
  return rows.map((r) => Object.assign({ id: r.id }, r.fields))
    .filter((t) => t.closed && (t.linkExpiresAt || 0) >= nowMs)
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
    .map((t) => ({ ticketId: t.ticketId, mrnLast4: t.mrnLast4 || "", closedAt: t.closedAt || 0, linkExpiresAt: t.linkExpiresAt || 0, entries: (t.entries || []).length }));
}
