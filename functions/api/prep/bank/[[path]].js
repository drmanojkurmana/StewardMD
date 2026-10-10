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
 * before sign-in, and nothing here is per user. PYQ files (v2/pyq/) are recall questions the owner supplied; they live
 * only in R2 (never in the public repo). Only whitelisted paths are served; files are versioned (v1, v2, ...)
 * and never change once uploaded, so they are cached as immutable.
 */
// search-<8 hex>.json: a rebuilt subject search index under a new immutable name (the subject index.json names it).
const PATH_RE = /^v\d{1,3}\/(?:manifest\.json|[a-z0-9-]{2,60}\/(?:index|search|search-[0-9a-f]{8})\.json|[a-z0-9-]{2,60}\/mcq\/[a-z0-9-]{2,80}\.json)$/;
// PYQ (tools/prep-pyq.mjs): v<n>/pyq/index.json (names the current items file, so short cache), items-<8 hex>.json and
// img/<name>.webp (both immutable: the items name carries a content hash, image names never change meaning).
const PYQ_RE = /^v\d{1,3}\/pyq\/(?:index\.json|items-[0-9a-f]{8}\.json|img\/[a-z0-9-]{2,80}\.webp)$/;
// Lessons and Flashcards (tools/prep-lessons.mjs, tools/prep-cards.mjs, uploaded with prep-upload-bank.mjs --as v<n>/lessons
// or v<n>/cards): index.json (lists the modules, so a short cache: a later run may add modules), <module>.json and
// lesson media (both immutable).
const STUDY_RE = /^v\d{1,3}\/(?:(?:lessons|cards)\/(?:index|[a-z0-9-]{2,80})\.json|lessons\/media\/[a-z0-9-]{2,80}\.(?:svg|webp))$/;
// Radiology media (tools/prep-rad.mjs, a subject's own bank path such as v6/ss-radiology/): question images
// img/<name>.webp and scroll stacks stack/<id>/<window>/<NNN>.webp plus stack/<id>/stack.json. All immutable: a changed
// image or stack gets a new name or id, never new bytes. Not under pyq/, lessons/ or cards/.
const RAD_RE = /^v\d{1,3}\/(?!pyq\/|lessons\/|cards\/)[a-z0-9-]{2,60}\/(?:img\/[a-z0-9-]{2,100}\.webp|stack\/[a-z0-9-]{2,60}\/(?:stack\.json|[a-z]{2,12}\/\d{3}\.webp))$/;
// Images a bank item carries (img + imgPlace, set by the bank build): v<n>/img/<name>.webp, immutable.
const IMG_RE = /^v\d{1,3}\/img\/[a-z0-9-]{2,80}\.webp$/;
// The owner's radiology notes (tools/prep-radnotes.mjs, set "radnotes"; tools/prep-radmax.mjs and tools/prep-ctc.mjs, sets "radmax" to "radmax7"): figures
// img/radnotes/rn-<id>.webp or img/radmax/rm-<id>.webp and MCQ overlays overlay/<set>/<subject>/<module>.json (all
// immutable: a new run writes new names or a new set folder, radnotes2, radnotes3, radmax2 ... radmax7, as medcov).
const RADNOTES_RE = /^(?:img\/(?:radnotes\/rn|radmax\/rm)-[a-z0-9-]{2,80}\.webp|overlay\/(?:radnotes|radmax)(?:[2-9]|[1-9]\d)?\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,80}\.json)$/;
// Medicine coverage MCQs (tools/prep-medcov.mjs, set "medcov"): overlay/medcov/<subject>/<module>.json, immutable.
// A new release goes to a new folder (medcov2, medcov3, medcov4, ...) so phones that cached the old file fetch the new one.
const MEDCOV_RE = /^overlay\/medcov(?:[2-9]|[1-9]\d)?\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,80}\.json$/;
// Share IDs (tools/prep-ids.mjs, prep-ids.js): v<n>/ids/index.json names the current shards (short cache); a shard
// <two ID characters>-<6 hex content hash>.json is immutable (a changed shard gets a new name).
const IDS_RE = /^v\d{1,3}\/ids\/(?:index|[0-9a-z]{2}-[0-9a-f]{6})\.json$/;
const PREFIX = "prep-bank/";

function notFound() { return new Response(JSON.stringify({ error: "not-found" }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

export function bankPath(params) {
  const p = [].concat((params && params.path) || []).map(String).join("/");
  return PATH_RE.test(p) || PYQ_RE.test(p) || STUDY_RE.test(p) || IMG_RE.test(p) || RADNOTES_RE.test(p) || MEDCOV_RE.test(p) || RAD_RE.test(p) || IDS_RE.test(p) ? p : null;
}

export async function onRequestGet({ env, params }) {
  const p = bankPath(params);
  if (!p) return notFound();
  const bucket = env && env.PREP_BANK_R2;
  if (!bucket || !bucket.get) return new Response(JSON.stringify({ error: "bank-not-configured" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  // A failed R2 read is a 503 (retry later), never a 404: the client treats a 404 as "this file does not exist" and,
  // for overlays, remembers that for the session (prep.js), so a passing R2 error used to hide content.
  let obj = null;
  try { obj = await bucket.get(PREFIX + p); } catch (e) { return new Response(JSON.stringify({ error: "bank-unavailable" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "5" } }); }
  if (!obj) return notFound();
  const headers = new Headers({
    "Content-Type": /\.webp$/.test(p) ? "image/webp" : /\.svg$/.test(p) ? "image/svg+xml" : "application/json; charset=utf-8",
    // manifest.json and the pyq/lessons/cards/ids index.json name the current files, so they may change; everything else is immutable
    "Cache-Control": /(?:manifest|(?:pyq|lessons|cards|ids)\/index)\.json$/.test(p) ? "public, max-age=300" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  // an SVG opened on its own runs no script and loads nothing
  if (/\.svg$/.test(p)) headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { status: 200, headers });
}

// HEAD answers like GET without a body (without it, HEAD fell through to the app's index.html with a 200).
export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  if (r.body && r.body.cancel) { try { await r.body.cancel(); } catch (e) {} }
  return new Response(null, { status: r.status, headers: r.headers });
}
