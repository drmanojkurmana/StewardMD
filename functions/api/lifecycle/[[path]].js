/* StewardMD — lifecycle email sweeps + the unverified-account sweep (Cloudflare Pages Function).
 *
 *   POST /api/lifecycle/run                (X-Admin-Token; cron only) -> day-3 Pro upsell, then the
 *                                                                        unverified sweep (reporting)
 *   POST /api/lifecycle/purge-unverified   (X-Admin-Token)            -> the unverified sweep alone
 *
 * The stewardmd-api Worker's daily cron pings /run with X-Admin-Token (same as /api/watch/run). It
 * finds users whose FIRST sign-in was >= PRO_UPSELL_DELAY_DAYS ago (default 3) and who have not yet
 * been upsell-emailed, then sends the Pro upsell once each. sendProUpsellOnce() skips anyone holding a
 * real Pro claim and is the send-once guard, so re-running is safe (a second run emails 0).
 *
 * THE UNVERIFIED SWEEP (owner decision, 2026-08-27): StewardMD is for registered doctors, so an
 * account that never verifies is removed. Day 5 sends one warning email; day 7 removes.
 *
 *   IT IS OFF BY DEFAULT AND REPORTS ONLY. Warnings are real emails; the removal itself does
 *   nothing until UNVERIFIED_PURGE_ON=1, and even then it DISABLES (reversible) rather than
 *   deletes unless UNVERIFIED_PURGE_HARD_DELETE=1 as well. A StewardMD account can own ICU
 *   membership and saved clinical cases, so the irreversible option is a deliberate second switch.
 *   Pass { dryRun: true } to force a report even when the switches are on.
 *
 * Auth: owner Google login OR X-Admin-Token (UPDATES_ADMIN_TOKEN / VERIFY_ADMIN_TOKEN), via ownerOK.
 */
import { ownerOK } from "../../_adminauth.js";
import {
  listLifecycleUids, sendProUpsellOnce, getLifecycle, decidePurge, markPurgeWarned, markPurged,
  purgeDays, warnDays, purgeEnabled, hardDeleteEnabled,
} from "../../_lifecycle.js";
import { getUserClaims, setUserDisabled, deleteUser } from "../../_fbadmin.js";
import { emailVerifyReminder } from "../../_email.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const DAY = 24 * 60 * 60 * 1000;

async function upsellSweep(env) {
  const days = Number(env.PRO_UPSELL_DELAY_DAYS) > 0 ? Number(env.PRO_UPSELL_DELAY_DAYS) : 3;
  const cutoff = Date.now() - days * DAY;
  const cap = Number(env.PRO_UPSELL_MAX_PER_RUN) > 0 ? Number(env.PRO_UPSELL_MAX_PER_RUN) : 300;

  // Pre-filter from KV list() metadata (no per-key get): first-seen old enough, not yet upsold.
  const candidates = await listLifecycleUids(env, (md) => !!(md && md.firstSeen && md.firstSeen <= cutoff && !md.upsellAt));
  const batch = candidates.slice(0, cap);
  let emailed = 0, skipped = 0;
  for (const uid of batch) {
    try { const r = await sendProUpsellOnce(env, uid, {}); if (r && r.sent) emailed++; else skipped++; } catch (e) { skipped++; }
  }
  // Report the cap so a large backlog is never silently dropped — the next nightly run drains more.
  return { days, candidates: candidates.length, processed: batch.length, emailed, skipped, deferred: candidates.length - batch.length };
}

/* The unverified sweep. `force` (dryRun) makes it report without acting even when enabled. */
async function unverifiedSweep(env, { dryRun } = {}) {
  const now = Date.now();
  const pd = purgeDays(env), wd = warnDays(env);
  const enabled = purgeEnabled(env) && !dryRun;
  const hard = hardDeleteEnabled(env);
  const cap = Number(env.UNVERIFIED_MAX_PER_RUN) > 0 ? Number(env.UNVERIFIED_MAX_PER_RUN) : 200;

  // Cheap pre-filter: old enough to be worth a claims lookup, and not already dealt with. Every
  // real decision is then made from CLAIMS in decidePurge(), because this metadata can be stale.
  const cutoff = now - wd * DAY;
  const candidates = await listLifecycleUids(env, (md) =>
    !!(md && md.firstSeen && md.firstSeen <= cutoff && !md.verifiedAt && !md.purgedAt));
  const batch = candidates.slice(0, cap);

  const out = { mode: enabled ? (hard ? "delete" : "disable") : "report-only",
                purgeDays: pd, warnDays: wd, candidates: candidates.length, processed: batch.length,
                warned: 0, purged: 0, wouldPurge: 0, skipped: 0, failed: 0,
                deferred: candidates.length - batch.length, reasons: {} };

  for (const uid of batch) {
    try {
      const rec = await getLifecycle(env, uid);
      let claims = {};
      try { claims = (await getUserClaims(env, uid)) || {}; } catch (e) { out.failed++; continue; }   // unknown claims = never act
      const d = decidePurge(env, rec, claims, now);
      out.reasons[d.reason] = (out.reasons[d.reason] || 0) + 1;

      if (d.action === "skip") { out.skipped++; continue; }

      if (d.action === "warn") {
        // The warning is the one thing that always runs: nobody should lose an account without
        // having been told, and a warning email to a doctor who then verifies is a good outcome.
        const to = (rec && rec.email) || "";
        let sent = false;
        if (to) {
          try {
            const r = await emailVerifyReminder(env, { email: to, name: (rec && rec.name) || "", daysLeft: Math.max(1, Math.ceil(pd - d.ageDays)) });
            sent = !!(r && r.ok);
          } catch (e) {}
        }
        // Only stamp on a real send, so a transient email failure retries on the next run rather
        // than starting the clock on a warning the doctor never received.
        if (sent) { await markPurgeWarned(env, uid); out.warned++; } else { out.failed++; }
        continue;
      }

      if (d.action === "purge") {
        if (!enabled) { out.wouldPurge++; continue; }
        let ok = false;
        try { ok = hard ? await deleteUser(env, uid) : await setUserDisabled(env, uid, true); } catch (e) { ok = false; }
        if (ok) { await markPurged(env, uid, hard ? "delete" : "disable"); out.purged++; } else { out.failed++; }
      }
    } catch (e) { out.failed++; }
  }
  return out;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");

  if (request.method === "POST" && (seg === "run" || seg === "purge-unverified")) {
    if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const dryRun = body && (body.dryRun === true || body.dryRun === "1");

    if (seg === "purge-unverified") {
      try { return json({ ok: true, unverified: await unverifiedSweep(env, { dryRun }) }); }
      catch (e) { return json({ error: "sweep-failed", detail: String((e && e.message) || e) }, 500); }
    }

    let upsell, unverified;
    try { upsell = await upsellSweep(env); }
    catch (e) { return json({ error: "list-failed", detail: String((e && e.message) || e) }, 500); }
    // The unverified sweep must never take the nightly cron down with it — the upsell result is
    // already earned by the time we get here.
    try { unverified = await unverifiedSweep(env, { dryRun }); }
    catch (e) { unverified = { error: String((e && e.message) || e) }; }
    return json({ ok: true, ...upsell, unverified });
  }

  return json({ error: "not-found", seg }, 404);
}
