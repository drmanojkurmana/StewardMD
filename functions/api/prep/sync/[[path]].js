/* /api/prep/sync - PrepNucleus encrypted progress sync (client: prep-sync.js). One opaque blob per user.
 *
 * Threat model: the client encrypts with AES-GCM under HKDF(uid, salt); the server keeps the blob, the salt and a
 * version, keyed by sha256("prep-sync|" + uid) (the uid is never stored). A leaked database or backup is unreadable
 * without the uids. This does NOT protect against whoever runs this code: it sees the uid on every authenticated
 * request and holds the salt (only a user-held secret with a recovery-code UX could close that). Visible here:
 * blob size, update times, the uid hash.
 *
 *   GET    -> 200 text/plain: the blob as base64 ("" when none), ETag "<ver>", X-Sync-Salt <base64 32 bytes>
 *             (the first GET creates the row with a fresh random salt)
 *   PUT    body = base64 blob, If-Match "<ver>", X-Sync-Salt -> 200 { ver } + ETag. 428 without If-Match,
 *             412 (current ETag) when the version or salt moved on, 413 over 256 KB, 400 malformed
 *   DELETE -> 200 { deleted: true }: the row and its salt are gone
 *
 * The wire is base64 text, not octet-stream: the native app sends /api/* through the CapacitorHttp plugin
 * (native-bridge.js nativeApiFetch), which carries string bodies and string responses only. A DELETE answers 200,
 * not 204, because that adapter builds a Response with a "" body, which a 204 rejects.
 * Bearer Firebase token (401 otherwise). Binding PREP_ARENA_DB (503 without). Table: prep-arena-worker/migrations/0001.
 */
import { verifiedClaimsFor } from "../../../_fbauth.js";

const MAX = 262144;
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...h } });
const etag = (v) => ({ ETag: '"' + v + '"' });
const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
const unb64 = (s) => { try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch (e) { return null; } };
const bytes = (x) => (x == null ? null : x instanceof Uint8Array ? x : new Uint8Array(x));   // D1 BLOB: ArrayBuffer or number[]
async function rowKey(uid) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("prep-sync|" + uid)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(request, env, path, now = Date.now()) {
  if (path) return json({ error: "not-found" }, 404);
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return json({ error: "sign-in-required" }, 401);
  const db = env && env.PREP_ARENA_DB;
  if (!db) return json({ error: "not-configured" }, 503);
  const uh = await rowKey(claims.sub), method = request.method;

  if (method === "GET") {
    await db.prepare("INSERT OR IGNORE INTO prep_sync (uh, salt, ver, updated_at) VALUES (?, ?, 0, ?)").bind(uh, crypto.getRandomValues(new Uint8Array(32)).buffer, now).run();
    const row = await db.prepare("SELECT salt, ver, blob FROM prep_sync WHERE uh = ?").bind(uh).first();
    const blob = bytes(row.blob);
    return new Response(blob && blob.length ? b64(blob) : "", { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Sync-Salt": b64(bytes(row.salt)), ...etag(row.ver) } });
  }

  if (method === "PUT") {
    const m = /^(?:W\/)?"(\d+)"$/.exec((request.headers.get("If-Match") || "").trim());
    if (!m) return json({ error: "if-match-required" }, 428);
    if (+request.headers.get("Content-Length") > Math.ceil(MAX / 3) * 4 + 8) return json({ error: "too-large" }, 413);
    const text = (await request.text()).trim();
    if (text.length > Math.ceil(MAX / 3) * 4) return json({ error: "too-large" }, 413);
    const blob = unb64(text), salt = unb64(request.headers.get("X-Sync-Salt") || "");
    if (!blob || blob.length < 29 || !salt || salt.length !== 32) return json({ error: "bad-request" }, 400);
    if (blob.length > MAX) return json({ error: "too-large" }, 413);
    // Compare-and-set on version AND salt: a client still holding the salt of a wiped row cannot write into its successor.
    const r = await db.prepare("UPDATE prep_sync SET blob = ?, ver = ver + 1, updated_at = ? WHERE uh = ? AND ver = ? AND salt = ?")
      .bind(blob.buffer, now, uh, +m[1], salt.buffer).run();
    if (r && r.meta && r.meta.changes === 1) return json({ ver: +m[1] + 1 }, 200, etag(+m[1] + 1));
    const cur = await db.prepare("SELECT ver FROM prep_sync WHERE uh = ?").bind(uh).first();
    return json({ error: "stale" }, 412, cur ? etag(cur.ver) : {});
  }

  if (method === "DELETE") {
    await db.prepare("DELETE FROM prep_sync WHERE uh = ?").bind(uh).run();
    return json({ deleted: true });
  }
  return json({ error: "method-not-allowed" }, 405);
}

export async function onRequest({ request, env, params }) {
  const path = [].concat((params && params.path) || []).map(String).join("/");
  try { return await handle(request, env, path); }
  catch (e) { return json({ error: "server-error" }, 500); }
}
