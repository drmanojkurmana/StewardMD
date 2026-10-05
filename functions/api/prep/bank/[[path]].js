/* GET /api/prep/bank/<version>/<subject>/<file> - the PrepNucleus question bank (plan: vault/plans/PrepNucleus.md 5.2).
 *
 * The ONE serving path for bank files. Module files and search indexes are too big to ship in the app (about 180 MB
 * in all), so the build tool (tools/prep-build-bank.mjs, tools/prep-upload-bank.mjs) puts them in R2 and the app
 * fetches a module the first time it opens it, then keeps it in IndexedDB. The native app only calls
 * stewardmd.in/api/*, so there is no public bank domain.
 *
 * Storage: binding PREP_BANK_R2, which is the existing `stewardmd-offline` bucket (also bound as OTA_R2 for the
 * update system) under the `prep-bank/` prefix, so no new bucket is needed and no binding can point at a bucket
 * that does not exist yet.
 *
 * Public by design: the bank is MedMCQA (MIT) plus StewardMD-generated items, the same content the app shows
 * before sign-in, and nothing here is per user. Only whitelisted paths are served; files are versioned (v1, v2, ...)
 * and never change once uploaded, so they are cached as immutable.
 */
const PATH_RE = /^v\d{1,3}\/(?:manifest\.json|[a-z0-9-]{2,60}\/(?:index|search)\.json|[a-z0-9-]{2,60}\/mcq\/[a-z0-9-]{2,80}\.json)$/;
const PREFIX = "prep-bank/";

function notFound() { return new Response(JSON.stringify({ error: "not-found" }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

export function bankPath(params) {
  const p = [].concat((params && params.path) || []).map(String).join("/");
  return PATH_RE.test(p) ? p : null;
}

export async function onRequestGet({ env, params }) {
  const p = bankPath(params);
  if (!p) return notFound();
  const bucket = env && env.PREP_BANK_R2;
  if (!bucket || !bucket.get) return new Response(JSON.stringify({ error: "bank-not-configured" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  let obj = null;
  try { obj = await bucket.get(PREFIX + p); } catch (e) { obj = null; }
  if (!obj) return notFound();
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    // manifest.json names the current files, so it may change; everything else is immutable within a version
    "Cache-Control": /manifest\.json$/.test(p) ? "public, max-age=300" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { status: 200, headers });
}
