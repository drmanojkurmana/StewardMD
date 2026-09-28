/* StewardMD - Clinical Bulletins: the weekly review run (Saturday 09:00 IST, worker cron "30 3 * * 6").
 *
 * 1. Runs the Medical Updates pipeline (journals, openFDA, CDSCO lists), so the queue is fresh.
 * 2. Counts what needs a doctor: new source items without a bulletin (candidates), drafts, bulletins whose
 *    source changed, and signed bulletins due for review within 30 days.
 * 3. Sends one native push to every ACTIVE signer's devices (tokens bound to "fb:<uid>"): tapping it opens
 *    the Review Desk "Clinical updates" tab (/?rvtab=bulletins). Nothing is sent when nothing is waiting.
 * 4. Records the run in bulletin_settings ('review_digest_ts') and bulletin_audit ('review_digest').
 * Nothing here signs or publishes anything: a bulletin still reaches a disease page only when a doctor signs it.
 */
import * as brepo from "./_bulletins_repo.js";
import { ensureBulletinSchema } from "./_bulletins_schema.js";
import { sendNativeToAll, nativePushEnabled } from "./_nativepush.js";

const DAY = 86400000;
export const REVIEW_URL = "/?rvtab=bulletins";

/** What is waiting for a signer right now. */
export async function pendingCounts(env, now) {
  const rows = await brepo.listForQueue(env);
  const c = { candidates: 0, drafts: 0, source_changed: 0, review_due: 0 };
  for (const r of rows) {
    const st = brepo.stateOf(r, now);
    if (st === "draft" || st === "edited") c.drafts++;
    else if (st === "source_changed") c.source_changed++;
    else if (st === "review_due" || (st === "live" && r.review_due_ts < now + 30 * DAY)) c.review_due++;
  }
  c.candidates = (await brepo.listCandidates(env, now - 90 * DAY, 200)).length;
  c.total = c.candidates + c.drafts + c.source_changed + c.review_due;
  return c;
}

/** Pure: the notification text. No em-dash (app-facing). */
export function digestMessage(c) {
  const parts = [];
  if (c.candidates) parts.push(c.candidates + " new journal and FDA item" + (c.candidates === 1 ? "" : "s"));
  if (c.source_changed) parts.push(c.source_changed + " source change" + (c.source_changed === 1 ? "" : "s") + " to re-check");
  if (c.drafts) parts.push(c.drafts + " draft" + (c.drafts === 1 ? "" : "s"));
  if (c.review_due) parts.push(c.review_due + " due for review");
  return {
    title: "Clinical updates to review",
    body: parts.join(", ") + ". Read each against its source and sign what should reach the disease page.",
    url: REVIEW_URL, tag: "smd-bulletin-review",
  };
}

/**
 * runWeeklyReview(env, deps) -> { ok, pipeline, counts, signers, notified, skipped }
 * deps (for tests): { runPipeline, send, now }
 */
export async function runWeeklyReview(env, deps) {
  deps = deps || {};
  const now = deps.now || Date.now();
  if (!env || !env.UPDATES_DB) return { ok: false, error: "no-db" };
  await ensureBulletinSchema(env.UPDATES_DB);
  let pipeline = null;
  if (deps.runPipeline) { try { pipeline = await deps.runPipeline(env); } catch (e) { pipeline = { ok: false, error: String((e && e.message) || e).slice(0, 120) }; } }
  const counts = await pendingCounts(env, now);
  const signers = (await brepo.listSigners(env)).filter((s) => s.active === 1);
  const out = { ok: true, pipeline, counts, signers: signers.length, notified: 0, devices: 0, skipped: "" };
  if (!counts.total) out.skipped = "nothing-to-review";
  else if (!signers.length) out.skipped = "no-signers";
  else if (!deps.send && !nativePushEnabled(env)) out.skipped = "native-push-not-configured";
  else {
    const msg = digestMessage(counts);
    const send = deps.send || ((uid, m) => sendNativeToAll(env, m, { uid }));
    for (const s of signers) {
      try {
        const r = await send("fb:" + s.uid, msg);
        if (r && r.sent) { out.notified++; out.devices += r.sent; }
      } catch (e) {}
    }
  }
  const D = env.UPDATES_DB;
  await D.batch([
    D.prepare("INSERT INTO bulletin_settings (key, value, updated_by, updated_ts) VALUES ('review_digest_ts', ?, 'system', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ts = excluded.updated_ts").bind(String(now), now),
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) VALUES ('a' || lower(hex(randomblob(10))), '', ?, '', 'review_digest', '', ?)")
      .bind(now, JSON.stringify({ counts, signers: out.signers, notified: out.notified, skipped: out.skipped }).slice(0, 300)),
  ]);
  return out;
}
