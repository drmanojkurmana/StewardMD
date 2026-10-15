/* GET /api/health — unauthenticated deploy probe. `v` is bumped whenever a
 * production deploy needs to be confirmed from outside (the Pages build was
 * failing silently from 2026-10-13 to 2026-10-15 while OTA kept shipping, so
 * "the app updated" proved nothing about server code). No env, no bindings. */
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, v: "2026-10-15-pagesfix1" }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
