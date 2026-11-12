/* /api/account/delete - self-service account deletion (App Store guideline 5.1.1(v)).
 *   POST { confirm: "DELETE" }  with  Authorization: Bearer <Firebase ID token>
 *     -> { ok, deleted, purged }
 *
 * Why this is server-side: the in-app button used to call the Firebase web SDK's user.delete(),
 * which refuses with auth/requires-recent-login once the sign-in is more than a few minutes old.
 * Its fallback, reauthenticateWithPopup, cannot open a popup inside the native WebView, so on the
 * phone the account survived while the app told the doctor it was gone. The ID token proves the
 * caller owns the uid; the service account then removes the data and the sign-in.
 *
 * Order matters (same as the unverified sweep): the data goes FIRST, then the Firebase user, so a
 * failure part-way never leaves a live sign-in with no data or clinical data with no owner.
 */
import { verifiedClaimsFor } from "../../_fbauth.js";
import { deleteUser } from "../../_fbadmin.js";
import { purgeUserData, deleteLifecycle } from "../../_lifecycle.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
  // Firebase only: a Cloudflare Access identity is a staff login, not an app account.
  const claims = await verifiedClaimsFor(request, env);
  const uid = claims && typeof claims.sub === "string" ? claims.sub : "";
  if (!uid) return json({ error: "signin-required" }, 401);
  let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
  if (body.confirm !== "DELETE") return json({ error: "confirm-required" }, 400);

  let purged = null;
  try { purged = await purgeUserData(env, uid); } catch (e) { purged = null; }
  try { await deleteLifecycle(env, uid); } catch (e) {}
  let deleted = false;
  try { deleted = await deleteUser(env, uid); } catch (e) { deleted = false; }
  if (!deleted) return json({ ok: false, error: "delete-failed", purged }, 502);
  return json({ ok: true, deleted: true, purged });
}
