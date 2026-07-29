/* StewardMD — ICU collaboration API.
 *
 *   POST /api/icu/group-key   { gid }  ->  { ok, key }   (base64 AES-256 group key)
 *
 * Hands the per-group encryption key to a VERIFIED MEMBER of that ICU group only. The key is
 * derived server-side from ICU_GROUP_KEY_SECRET + gid (see _icu_crypto.js); it is never stored.
 * Membership is checked with the same isGroupMember() the watch write-path uses, so a non-member
 * (or a doctor who self-bound to a group they were never invited to) cannot obtain the key and
 * therefore cannot read the encrypted patient docs even if Firestore rules were ever relaxed.
 *
 * Requires the Pages secret ICU_GROUP_KEY_SECRET. If it is unset the endpoint 503s and the client
 * feature stays inert (the flag smd_icu_encrypt is default-OFF), so nothing changes until the owner
 * both sets the secret AND enables the flag.
 */
import { verifyFirebaseToken } from "../../_fbauth.js";
import { isGroupMember } from "../../_taskpush.js";
import { deriveGroupKey } from "../../_icu_crypto.js";

const ORIGINS = ["https://stewardmd.in", "https://www.stewardmd.in", "https://stewardmd.pages.dev", "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
  if (ORIGINS.indexOf(o) > -1 || o === "") h["Access-Control-Allow-Origin"] = o || "*";
  return h;
}
function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)),
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const seg = url.pathname.replace(/\/+$/, "").split("/").pop();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  if (request.method === "POST" && seg === "group-key") {
    const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let uid = null;
    if (tok) { try { uid = await verifyFirebaseToken(tok, env); } catch (e) { uid = null; } }
    if (!uid) return json({ error: "signin_required" }, 401, request);

    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const gid = String(b.gid || "").trim().slice(0, 200);
    if (!gid) return json({ error: "bad_gid" }, 400, request);

    if (!env.ICU_GROUP_KEY_SECRET) return json({ error: "not_configured" }, 503, request);
    if (!(await isGroupMember(env, gid, uid))) return json({ error: "forbidden" }, 403, request);

    try {
      const key = await deriveGroupKey(env.ICU_GROUP_KEY_SECRET, gid);
      return json({ ok: true, key }, 200, request);
    } catch (e) {
      try { console.warn("[icu group-key] derive failed"); } catch (x) {}
      return json({ error: "server_error" }, 500, request);
    }
  }

  return json({ error: "not_found" }, 404, request);
}
