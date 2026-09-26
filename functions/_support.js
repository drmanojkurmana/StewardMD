/* _support.js — in-app support tickets. A doctor opens Help -> creates a ticket with a unique
 * complaint id; the owner sees every ticket in the admin console and can reply / reply+resolve.
 * KV-backed (low volume): one key per ticket + a summary index so the admin list needs one read.
 *
 * PRIVACY: ticket text is user-typed free text and is owner-only. The Help UI warns doctors not to
 * include patient-identifying details; we cannot reliably scrub free text, so access control is the
 * control. Never log ticket bodies elsewhere. */

const IDX_KEY = "support:index";              // [{id, owner, email, subject, status, unread, createdAt, updatedAt}] newest-first
const tKey = (id) => "support:t:" + id;
const INDEX_CAP = 800;                          // ponytail: ring-buffer cap; oldest summaries drop past this (ticket bodies still TTL out)
const TTL = 180 * 86400;                        // 180d, refreshed on every update
const SUBJECT_MAX = 200, TEXT_MAX = 4000, MSGS_MAX = 200;
// Bug reports (shake to report, 2026-09-26) are tickets of kind "bug" with where-it-happened details
// and a promised fix time. The owner asked for "solved in 24hrs", so dueAt is createdAt + 24 h.
export const BUG_SLA_MS = 24 * 3600 * 1000;
export const SHOT_MAX = 900 * 1024;            // base64 JPEG cap for the screenshot
export const SHOT_TTL = 30 * 86400;            // screenshots can show a patient: kept 30 d at most, dropped on resolve
export const shotKey = (id) => "support:shot:" + id;

// Only the shape we render, clipped: never trust client geometry or selectors beyond display.
export function cleanBugMeta(b) {
  b = b || {};
  const n = (v) => { const x = Math.round(+v); return Number.isFinite(x) ? Math.max(-99999, Math.min(99999, x)) : 0; };
  const el = b.element && typeof b.element === "object" ? b.element : null;
  return {
    route: clean(b.route, 200),
    element: el ? { sel: clean(el.sel, 300), label: clean(el.label, 160), tag: clean(el.tag, 24),
      rect: el.rect ? { x: n(el.rect.x), y: n(el.rect.y), w: n(el.rect.w), h: n(el.rect.h) } : null } : null,
    screen: b.screen ? { w: n(b.screen.w), h: n(b.screen.h), dpr: Math.round((+b.screen.dpr || 1) * 100) / 100 } : null,
    ua: clean(b.ua, 200),
  };
}

const STATUSES = ["open", "resolved"];
export function isStatus(s) { return STATUSES.indexOf(s) >= 0; }

function clean(s, max) { return String(s == null ? "" : s).replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, max); }

// Human-readable complaint id: SMD-XXXXXX (base32, no ambiguous chars). Caller passes a couple of
// random 32-bit ints so the module stays pure/testable; the endpoint sources them from crypto.
const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford-ish: no I/L/O/U
function idFrom(rand32a, rand32b) {
  let n = (rand32a >>> 0) * 4096 + ((rand32b >>> 0) % 4096), out = "";
  for (let i = 0; i < 6; i++) { out = ALPH[n % 32] + out; n = Math.floor(n / 32); }
  return "SMD-" + out;
}
export function makeId(rands) { return idFrom(rands[0] || 0, rands[1] || 0); }

async function readIndex(store) { try { return JSON.parse((await store.get(IDX_KEY)) || "[]") || []; } catch (e) { return []; } }
async function writeIndex(store, idx) { await store.put(IDX_KEY, JSON.stringify(idx.slice(0, INDEX_CAP)), { expirationTtl: TTL }); }

/* Create a ticket. who = { id (owner key), email, name }. Returns the ticket (incl. its complaint id).
 * `rands` = [int, int] entropy for the id; `now` = ms. Throws on empty subject+text. */
export async function createTicket(store, who, body, rands, now) {
  const subject = clean(body && body.subject, SUBJECT_MAX);
  const text = clean(body && body.text, TEXT_MAX);
  if (!subject && !text) throw new Error("empty");
  const idx = await readIndex(store);
  const taken = new Set(idx.map((t) => t.id));
  let id = makeId(rands); let salt = (rands[1] >>> 0);
  while (taken.has(id)) { salt = (salt + 1) >>> 0; id = makeId([rands[0], salt]); }   // vanishingly rare collision
  const ticket = {
    id, owner: (who && who.id) || "anon",
    email: (who && (who.email || who.accountEmail)) || "", name: (who && who.name) || "",   // contact address, not an identity
    platform: clean(body && body.platform, 16), build: clean(body && body.build, 32),
    subject: subject || "(no subject)", status: "open",
    createdAt: now, updatedAt: now,
    messages: [{ from: "user", text: text, ts: now }],
  };
  if (body && body.kind === "bug") {
    ticket.kind = "bug"; ticket.dueAt = now + BUG_SLA_MS; ticket.bug = cleanBugMeta(body.bug); ticket.hasShot = !!body.hasShot;
  }
  await store.put(tKey(id), JSON.stringify(ticket), { expirationTtl: TTL });
  idx.unshift({ id, owner: ticket.owner, email: ticket.email, subject: ticket.subject, status: "open", unread: true, createdAt: now, updatedAt: now,
    ...(ticket.kind === "bug" ? { kind: "bug", dueAt: ticket.dueAt } : {}) });
  await writeIndex(store, idx);
  return ticket;
}

export async function getTicket(store, id) { try { return JSON.parse((await store.get(tKey(id))) || "null"); } catch (e) { return null; } }

/* Append a message. from = "support" (owner reply) or "user" (doctor follow-up). Optionally set
 * status in the same call (owner "reply & resolve"). `unread` in the index flips so each side sees
 * a pending badge: a support reply marks unread for nobody-in-index (doctor polls the ticket), a
 * user follow-up marks unread=true for the owner. */
export async function addMessage(store, id, from, text, now, status) {
  const t = await getTicket(store, id);
  if (!t) return null;
  const msg = clean(text, TEXT_MAX);
  if (msg) { t.messages.push({ from: from === "support" ? "support" : "user", text: msg, ts: now }); if (t.messages.length > MSGS_MAX) t.messages = t.messages.slice(-MSGS_MAX); }
  if (status && isStatus(status)) { if (status === "resolved" && t.status !== "resolved") t.resolvedAt = now; t.status = status; }
  // The doctor's side of the badge: a developer reply is unread for them until they open it.
  if (from === "support" && msg) t.userUnread = true;
  if (from === "user") t.userUnread = false;
  t.updatedAt = now;
  await store.put(tKey(id), JSON.stringify(t), { expirationTtl: TTL });
  const idx = await readIndex(store);
  const row = idx.find((r) => r.id === id);
  if (row) { row.status = t.status; row.updatedAt = now; row.unread = from === "user"; }
  // bump to front on new activity
  const rest = idx.filter((r) => r.id !== id);
  await writeIndex(store, row ? [row].concat(rest) : idx);
  return t;
}

export async function setStatus(store, id, status, now) {
  if (!isStatus(status)) return null;
  return addMessage(store, id, "support", "", now, status);
}

// Admin list: summary index (optionally filtered by status). Newest-first.
export async function listTickets(store, status) {
  const idx = await readIndex(store);
  return status && isStatus(status) ? idx.filter((r) => r.status === status) : idx;
}

// A doctor's own tickets (full threads). Owner key must match — never returns another doctor's.
export async function listMine(store, owner) {
  if (!owner) return [];
  const idx = await readIndex(store);
  const mine = idx.filter((r) => r.owner === owner).slice(0, 50);
  const out = [];
  for (const r of mine) { const t = await getTicket(store, r.id); if (t) out.push(t); }
  return out;
}

// The stored "jpeg:<base64>" -> an image Response (doctor route and admin route).
export function shotResponse(raw) {
  const i = String(raw || "").indexOf(":");
  if (i < 0) return null;
  const type = raw.slice(0, i), b64 = raw.slice(i + 1);
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Response(bytes, { headers: { "Content-Type": "image/" + (type === "png" ? "png" : "jpeg"), "Cache-Control": "private, no-store" } });
}

// The doctor opened the ticket: clear their unread badge. Owner-checked by the caller.
export async function markSeen(store, id, now) {
  const t = await getTicket(store, id);
  if (!t || !t.userUnread) return t;
  t.userUnread = false;
  await store.put(tKey(id), JSON.stringify(t), { expirationTtl: TTL });
  return t;
}

export const _internal = { IDX_KEY, tKey, INDEX_CAP, SUBJECT_MAX, TEXT_MAX };
