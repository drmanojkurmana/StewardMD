/* StewardMD — Watch-Lab store (A2, consent-gated).
 * Per-doctor, per-patient background lab watching. Stores the doctor's GHIS
 * credentials ONLY when they explicitly consent, AES-GCM encrypted, auto-destroyed
 * after 30 days (KV expirationTtl), revocable. Everyone who does not opt in keeps the
 * default "password never stored" posture.
 *
 * Honest note: the AES key (WATCH_ENC_KEY) lives server-side, so our server — and anyone
 * who breaches it — can decrypt these credentials. That is why this is strictly opt-in.
 *
 * Config (Cloudflare env / secrets):
 *   WATCH_ENC_KEY  base64 of a 32-byte AES-256 key — SECRET
 *   Store: WATCH_KV (falls back to PUSH_KV / UPDATES_KV / GHIS_KV / CASES_KV)
 */
import { pushKv } from "./_webpush.js";

const TTL_S = 30 * 24 * 3600;                    // 30-day auto-destroy
const CRED = (uid) => "watch:cred:" + uid;
const LIST = (uid) => "watch:list:" + uid;
const SEEN = (uid, pid) => "watch:seen:" + uid + ":" + pid;

export function watchKv(env) { return env.WATCH_KV || pushKv(env); }
export function watchConfigured(env) { return !!(watchKv(env) && env.WATCH_ENC_KEY); }

function b64ToBytes(b) {
  const s = String(b).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(u) { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

function randRef() { const u = crypto.getRandomValues(new Uint8Array(16)); return Array.from(u, b => b.toString(16).padStart(2, "0")).join(""); }
async function aesKey(env) { return crypto.subtle.importKey("raw", b64ToBytes(env.WATCH_ENC_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function enc(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
  return bytesToB64(out);
}
async function dec(env, s) {
  const raw = b64ToBytes(s), iv = raw.slice(0, 12), ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(env), ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// ── credentials (opt-in only) ───────────────────────────────────────────────
export async function saveCred(env, uid, creds) {
  const kv = watchKv(env); if (!kv) return false;
  await kv.put(CRED(uid), await enc(env, { userId: creds.userId, password: creds.password }), { expirationTtl: TTL_S });
  return true;
}
export async function getCred(env, uid) {
  const kv = watchKv(env); if (!kv) return null;
  const s = await kv.get(CRED(uid)); if (!s) return null;
  try { return await dec(env, s); } catch (e) { return null; }
}
export async function deleteCred(env, uid) { const kv = watchKv(env); if (kv) await kv.delete(CRED(uid)); }

// ── watch list (refresh TTL on every write so an active watcher never expires) ─
export async function getList(env, uid) {
  const kv = watchKv(env); if (!kv) return [];
  let list; try { list = (await kv.get(LIST(uid), "json")) || []; } catch (e) { return []; }
  // Decrypt the at-rest patient name so callers still get plaintext (behaviour unchanged).
  let legacy = false;
  for (const p of list) {
    if (!p) continue;
    if (p.name == null && p.nameEnc) { try { p.name = await dec(env, p.nameEnc); } catch (e) { p.name = ""; } }
    else if (p.name != null && !p.nameEnc) legacy = true;   // stored before at-rest encryption existed
    if (!p.ref) legacy = true;                              // stored before the opaque push-ref existed
  }
  // Migrate legacy rows (plaintext name, or missing ref) on first read rather than leaving them
  // that way until they expire. setList does the encrypting/ref-assigning; this only has to notice
  // and use what it returns — the migrated fields land on a COPY, not on `list` in place (see
  // setList's own comment), so a caller must get that copy back, not the original. Best-effort:
  // a failed migration must not fail the read the doctor is waiting on.
  if (legacy) { try { return await setList(env, uid, list); } catch (e) { } }
  return list;
}
/* The ONE seam every writer routes through, so the plaintext name is stripped here rather than in
 * each caller. getList decrypts `nameEnc` into `name` for its callers, and addWatch/removeWatch
 * both read-then-write — so without this, every add or remove wrote the decrypted names of all the
 * OTHER entries straight back to KV, undoing the at-rest encryption on each list change.
 * A legacy row (plaintext `name`, no `nameEnc`) is encrypted here on its first write.
 *
 * Also assigns `ref`: a random per-patient reference, opaque outside an authenticated call to
 * getList for this uid. This is what a lab-watch PUSH NOTIFICATION carries instead of the real
 * patientId — see functions/api/watch/[[path]].js runForUid(). The push relay (APNs/FCM) and the
 * device lock screen never see a hospital identifier; the app resolves ref -> patientId itself,
 * by calling GET /api/watch/status with the doctor's own token, after the doctor is signed in.
 *
 * Returns what it wrote (with `name` re-attached in memory) so getList's migration path can hand
 * the caller the up-to-date objects — `list` itself is never mutated with the new ref/nameEnc,
 * only the `safe` copy destructured here is, so a caller reading the ORIGINAL array back would
 * silently miss the very field this migration exists to add. */
export async function setList(env, uid, list) {
  const kv = watchKv(env); if (!kv) return [];
  const safe = [];
  for (const p of (list || [])) {
    if (!p) { safe.push(p); continue; }
    const { name, ...rest } = p;
    if (!rest.nameEnc && name != null) {
      // Fail closed: if encryption is unavailable, drop the name rather than persist it readable.
      try { rest.nameEnc = await enc(env, name); } catch (e) { }
    }
    if (!rest.ref) rest.ref = randRef();
    safe.push(name != null ? { ...rest, name } : rest);
  }
  await kv.put(LIST(uid), JSON.stringify(safe.map(({ name, ...rest }) => rest)), { expirationTtl: TTL_S });
  return safe;
}
export async function addWatch(env, uid, patient) {
  const list = await getList(env, uid);
  const pid = String(patient.patientId);
  if (!list.some((p) => String(p.patientId) === pid)) {
    // Encrypt the patient name at rest (PHI) — GHIS creds in this module are already AES-GCM encrypted.
    let nameEnc = ""; try { nameEnc = await enc(env, patient.name || ""); } catch (e) {}
    list.push({ patientId: pid, episodeId: patient.episodeId || "", nameEnc: nameEnc, since: Date.now(), ref: randRef() });
    await setList(env, uid, list);
  }
  return list;
}
export async function removeWatch(env, uid, patientId) {
  const pid = String(patientId);
  const list = (await getList(env, uid)).filter((p) => String(p.patientId) !== pid);
  await setList(env, uid, list);
  const kv = watchKv(env); if (kv) await kv.delete(SEEN(uid, pid));
  return list;
}
export async function forget(env, uid) {
  const kv = watchKv(env); if (!kv) return;
  const list = await getList(env, uid);
  await Promise.all(list.map((p) => kv.delete(SEEN(uid, String(p.patientId)))));
  await kv.delete(LIST(uid));
  await deleteCred(env, uid);
}

// ── seen signatures (for new-lab detection) ───────────────────────────────────
export async function getSeen(env, uid, pid) { const kv = watchKv(env); if (!kv) return null; return kv.get(SEEN(uid, String(pid))); }
export async function setSeen(env, uid, pid, sig) { const kv = watchKv(env); if (kv) await kv.put(SEEN(uid, String(pid)), sig, { expirationTtl: TTL_S }); }

// Stable signature of a patient's lab orders — changes when a new order appears or an
// existing order's status changes (e.g. ordered → reported). Order-independent.
export function labSignature(orders) {
  return (orders || [])
    .map((o) => (o.renderId || o.orderId || "") + ":" + (o.status || ""))
    .sort()
    .join("|");
}

// All uids that currently have a watch list (for the cron run).
export async function listWatchUids(env) {
  const kv = watchKv(env); if (!kv || !kv.list) return [];
  const out = []; let cursor;
  do {
    const r = await kv.list({ prefix: "watch:list:", cursor });
    for (const k of r.keys) out.push(k.name.slice("watch:list:".length));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
