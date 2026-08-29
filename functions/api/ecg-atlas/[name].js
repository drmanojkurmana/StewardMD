/* StewardMD — Learn-ECG atlas image, behind sign-in (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:  functions/api/ecg-atlas/[name].js  ->  https://stewardmd.in/api/ecg-atlas/<file>
 *
 * WHY THIS EXISTS
 * The Learn-ECG atlas (872 teaching ECGs, ~182 MB) is deliberately NOT bundled into the native app
 * — see scripts/build-www.sh — so kardiox-screens.js fetches each image from stewardmd.in at
 * runtime. But functions/_middleware.js hard-404s every static asset on that origin, because the
 * clinical web bundle must not be downloadable or runnable in a browser after the scraping wave.
 *
 * Two decisions that are each correct on their own, and together meant the ECGs never loaded: the
 * atlas asks the one origin that refuses to serve it. Reported as "ecg learn cases not displaying
 * ecgs"; confirmed with /assets/kardiox-learn/<id>.jpg returning the middleware's 404 in production
 * while /logo.png (explicitly allowlisted there) returns 200.
 *
 * This route is the seam. /api/* already passes the middleware (each endpoint self-authorises), so
 * a SIGNED-IN doctor can read an atlas image while an anonymous scraper still cannot — the atlas
 * stays protected, which was the entire point of the gate. Chosen over simply allowlisting
 * /assets/kardiox-learn/* publicly, which would have exposed all 872 images to anyone.
 *
 * SECURITY
 *   • Firebase ID token required, same check as every other authed endpoint.
 *   • The filename is whitelisted to a flat [\w.-] image name — no slashes, no "..", no query —
 *     and always resolved under /assets/kardiox-learn/, so this can never be turned into a reader
 *     for the rest of the deployment.
 *   • env.ASSETS.fetch() reads the deployed asset directly and does NOT re-enter _middleware.js.
 *     (Fetching the public URL from here would simply 404 again.)
 *   • Cached PRIVATE: licensed teaching images, not public brand assets, so no shared cache.
 */

import { verifyFirebaseToken } from "../../_fbauth.js";

const deny = (status, msg) => new Response(msg, {
  status, headers: { "content-type": "text/plain", "cache-control": "no-store" }
});

// Flat image filename only — the atlas is a single flat directory of hashed names.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(jpg|jpeg|png|webp)$/i;

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const name = String((params && params.name) || "");
  if (!SAFE_NAME.test(name) || name.includes("..")) return deny(400, "Bad request");

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny(401, "Sign in required");
  let claims = null;
  try { claims = await verifyFirebaseToken(token, env); } catch (e) { claims = null; }
  if (!claims || !claims.sub) return deny(401, "Sign in required");

  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    console.warn("[ecg-atlas] env.ASSETS binding unavailable");
    return deny(503, "Atlas unavailable");
  }
  const assetUrl = new URL("/assets/kardiox-learn/" + name, request.url);
  let res;
  try {
    res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  } catch (e) {
    console.warn("[ecg-atlas] asset fetch threw:", String((e && e.message) || e));
    return deny(502, "Atlas unavailable");
  }
  if (!res || !res.ok) return deny(404, "Not found");

  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=86400");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.delete("set-cookie");
  return out;
}

// Anything other than GET here is a mistake; say so rather than falling through to the asset read.
export async function onRequest(context) {
  if (context.request.method !== "GET") return deny(405, "Method not allowed");
  return onRequestGet(context);
}
