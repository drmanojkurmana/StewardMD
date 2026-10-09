/* /api/prep/decks - PrepNucleus deck backup (client: prep-decks.js PREP_DECKS.backup). A student's own decks, one
 * encrypted blob per deck, so they come back on a new phone or after a reinstall once the student signs in.
 *
 * Same threat model as /api/prep/sync: the client encrypts with AES-GCM under HKDF(uid, salt, "prepnucleus-decks-v1");
 * the server keeps the blob and a per-user salt keyed by sha256("prep-decks|" + uid) (the uid is never stored). A leaked
 * database or backup is unreadable without the uids; the operator running this code is not kept out (it sees the uid).
 * What a blob holds (client side): the manifest, the questions, the flashcards and the facts not yet used (with the one
 * or two sentences each cites), never the source file, the rest of the page text or the images. Visible here: sizes,
 * update times, deck ids (gen_<sha12>, a hash), the uid hash.
 *
 *   GET            -> 200 { salt: <base64 32 bytes>, decks: [{ id, size, at }] } (the first GET creates the salt)
 *   GET    /<id>   -> 200 text/plain: the blob as base64; 404 none
 *   PUT    /<id>   body = base64 blob -> 200 { id, at }; 413 over 512 KB; 409 too-many (over 120 decks); 400 malformed
 *   DELETE /<id>   -> 200 { deleted: true }
 * Base64 text, not octet-stream, for the native CapacitorHttp adapter (see the sync route). Bearer Firebase token
 * (401 otherwise). Binding PREP_ARENA_DB (503 without). Tables: prep-arena-worker/migrations/0004_prep_decks.sql.
 */
import { verifiedClaimsFor } from "../../../_fbauth.js";

export const DECK_BLOB_MAX = 524288;
export const DECKS_MAX = 120;
const ID = /^gen_[a-f0-9]{12}$/;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
const unb64 = (s) => { try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch (e) { return null; } };
const bytes = (x) => (x == null ? null : x instanceof Uint8Array ? x : new Uint8Array(x));
async function rowKey(uid) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("prep-decks|" + uid)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(request, env, path, now = Date.now()) {
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return json({ error: "sign-in-required" }, 401);
  const db = env && env.PREP_ARENA_DB;
  if (!db) return json({ error: "not-configured" }, 503);
  if (path && !ID.test(path)) return json({ error: "not-found" }, 404);
  const uh = await rowKey(claims.sub), method = request.method;

  if (method === "GET" && !path) {
    await db.prepare("INSERT OR IGNORE INTO prep_deck_keys (uh, salt) VALUES (?, ?)").bind(uh, crypto.getRandomValues(new Uint8Array(32)).buffer).run();
    const k = await db.prepare("SELECT salt FROM prep_deck_keys WHERE uh = ?").bind(uh).first();
    const r = await db.prepare("SELECT id, size, updated_at FROM prep_decks WHERE uh = ? ORDER BY updated_at DESC").bind(uh).all();
    return json({ salt: b64(bytes(k.salt)), decks: ((r && r.results) || []).map((x) => ({ id: x.id, size: x.size, at: x.updated_at })) });
  }
  if (!path) return json({ error: "method-not-allowed" }, 405);

  if (method === "GET") {
    const row = await db.prepare("SELECT blob FROM prep_decks WHERE uh = ? AND id = ?").bind(uh, path).first();
    if (!row) return json({ error: "not-found" }, 404);
    return new Response(b64(bytes(row.blob)), { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }

  if (method === "PUT") {
    if (+request.headers.get("Content-Length") > Math.ceil(DECK_BLOB_MAX / 3) * 4 + 8) return json({ error: "too-large" }, 413);
    const text = (await request.text()).trim();
    if (text.length > Math.ceil(DECK_BLOB_MAX / 3) * 4) return json({ error: "too-large" }, 413);
    const blob = unb64(text);
    if (!blob || blob.length < 29) return json({ error: "bad-request" }, 400);
    if (blob.length > DECK_BLOB_MAX) return json({ error: "too-large" }, 413);
    const k = await db.prepare("SELECT 1 AS k FROM prep_deck_keys WHERE uh = ?").bind(uh).first();
    if (!k) return json({ error: "no-key" }, 409);   // GET the list first: it creates the salt the blob was sealed with
    const has = await db.prepare("SELECT 1 AS k FROM prep_decks WHERE uh = ? AND id = ?").bind(uh, path).first();
    if (!has) {
      const c = await db.prepare("SELECT COUNT(*) AS n FROM prep_decks WHERE uh = ?").bind(uh).first();
      if (c && c.n >= DECKS_MAX) return json({ error: "too-many" }, 409);
    }
    await db.prepare("INSERT INTO prep_decks (uh, id, blob, size, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uh, id) DO UPDATE SET blob = excluded.blob, size = excluded.size, updated_at = excluded.updated_at")
      .bind(uh, path, blob.buffer, blob.length, now).run();
    return json({ id: path, at: now });
  }

  if (method === "DELETE") {
    await db.prepare("DELETE FROM prep_decks WHERE uh = ? AND id = ?").bind(uh, path).run();
    return json({ deleted: true });
  }
  return json({ error: "method-not-allowed" }, 405);
}

export async function onRequest({ request, env, params }) {
  const path = [].concat((params && params.path) || []).map(String).join("/");
  try { return await handle(request, env, path); }
  catch (e) { return json({ error: "server-error" }, 500); }
}
