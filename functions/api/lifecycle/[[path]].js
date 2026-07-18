/* StewardMD — lifecycle email sweeps (Cloudflare Pages Function).
 *
 *   POST /api/lifecycle/run   (X-Admin-Token; cron only)  -> Pro-upsell email for day-3 non-converters
 *
 * The stewardmd-api Worker's daily cron pings this with X-Admin-Token (same as /api/watch/run). It
 * finds users whose FIRST sign-in was >= PRO_UPSELL_DELAY_DAYS ago (default 3) and who have not yet
 * been upsell-emailed, then sends the Pro upsell once each. sendProUpsellOnce() skips anyone holding a
 * real Pro claim and is the send-once guard, so re-running is safe (a second run emails 0).
 *
 * Auth: owner Google login OR X-Admin-Token (UPDATES_ADMIN_TOKEN / VERIFY_ADMIN_TOKEN), via ownerOK.
 */
import { ownerOK } from "../../_adminauth.js";
import { listLifecycleUids, sendProUpsellOnce } from "../../_lifecycle.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const DAY = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");

  if (request.method === "POST" && seg === "run") {
    if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);

    const days = Number(env.PRO_UPSELL_DELAY_DAYS) > 0 ? Number(env.PRO_UPSELL_DELAY_DAYS) : 3;
    const cutoff = Date.now() - days * DAY;
    const cap = Number(env.PRO_UPSELL_MAX_PER_RUN) > 0 ? Number(env.PRO_UPSELL_MAX_PER_RUN) : 300;

    let candidates;
    try {
      // Pre-filter from KV list() metadata (no per-key get): first-seen old enough, not yet upsold.
      candidates = await listLifecycleUids(env, (md) => !!(md && md.firstSeen && md.firstSeen <= cutoff && !md.upsellAt));
    } catch (e) { return json({ error: "list-failed", detail: String((e && e.message) || e) }, 500); }

    const batch = candidates.slice(0, cap);
    let emailed = 0, skipped = 0;
    for (const uid of batch) {
      try { const r = await sendProUpsellOnce(env, uid, {}); if (r && r.sent) emailed++; else skipped++; } catch (e) { skipped++; }
    }
    // Report the cap so a large backlog is never silently dropped — the next nightly run drains more.
    const deferred = candidates.length - batch.length;
    return json({ ok: true, days, candidates: candidates.length, processed: batch.length, emailed, skipped, deferred });
  }

  return json({ error: "not-found", seg }, 404);
}
