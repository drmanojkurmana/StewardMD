/* StewardMD - Medical Updates push queue.
 *
 * WHY THIS EXISTS (2026-11-27). New Medical Updates were pushed from inside POST /api/updates/sync,
 * the same invocation that had just crawled every source and called the AI summariser. That
 * invocation had already spent most of its per-invocation subrequest / KV budget, and the push
 * fan-out (one KV read per device token, one APNs/FCM call per device) ran in waitUntil after the
 * response with every error swallowed. Result: the feed filled up, no phone ever got a banner, and
 * nothing was logged. Pushes that DO arrive (kits, PrepNucleus, support replies) all run in their
 * own small invocation.
 *
 * Now the crawl only ENQUEUES (one KV write). drain() sends from a separate, fresh invocation: the
 * 15-minute cron (POST /api/push/task-overdue-run, already deployed) and POST /api/updates/push-run.
 * Every send is written to crawl_logs as source "push" with sent/total, so the admin console shows
 * whether Apple/Google accepted it.
 */
import { pushKv, sendPushToAll, pushEnabled } from "./_webpush.js";
import { sendNativeToAll, nativePushEnabled } from "./_nativepush.js";
import * as repo from "./_updates_repo.js";

const KEY = "updates:pushq";
const MAX_QUEUE = 24;
const CAT_TYPE = { approval: "drug_approval", drug: "drug_approval", safety: "safety_alert", recall: "safety_alert", guideline: "guideline", study: "trial", general: "guideline" };
const NOTIF_LABEL = { guideline: "New Guideline", drug_approval: "New Drug Approval", safety_alert: "Safety Alert", trial: "New Trial" };
const RANK = { critical: 3, high: 2, normal: 1 };

export function pushLabel(item) { const t = (item && (item.type || CAT_TYPE[item.category])) || ""; return NOTIF_LABEL[t] || "Medical Update"; }

// Title = "<label>: <title>"; body = first line of the summary. Tap target is an IN-APP deep link
// (/?u=<id>) so tapping opens the summary, not the source PDF.
export function pushMessage(item) {
  if (!item) return { title: "StewardMD", body: "New medical update", url: "/" };
  return {
    title: pushLabel(item) + ": " + (item.title || "StewardMD"),
    body: String(item.body || item.summary || item.organization || item.source || "New medical update").split("\n")[0].replace(/\*\*/g, "").replace(/^[•\-*]\s+/, "").slice(0, 180),
    url: item.id ? "/?u=" + item.id : "/",
    tag: item.id ? "smd-" + item.id : undefined,
  };
}

// One representative item per workspace (highest importance first), as before.
export function pickPerWorkspace(items) {
  const byWs = {};
  for (const it of items || []) {
    if (!it) continue;
    const w = it.workspace || "internal_medicine";
    if (!byWs[w] || (RANK[it.importance] || 1) > (RANK[byWs[w].importance] || 1)) byWs[w] = it;
  }
  return Object.keys(byWs).map((w) => ({ workspace: w, msg: pushMessage(byWs[w]), id: byWs[w].id || null }));
}

// Called from the crawl. One KV read + one write; never sends.
export async function enqueue(env, items) {
  const store = pushKv(env);
  const jobs = pickPerWorkspace(items);
  if (!store || !jobs.length) return { queued: 0 };
  let q = [];
  try { q = (await store.get(KEY, "json")) || []; } catch (e) {}
  // A newer job for the same workspace replaces the older one: one banner per specialty per drain.
  const ws = new Set(jobs.map((j) => j.workspace));
  q = q.filter((j) => !ws.has(j.workspace)).concat(jobs.map((j) => ({ ...j, ts: Date.now() }))).slice(-MAX_QUEUE);
  await store.put(KEY, JSON.stringify(q));
  return { queued: jobs.length };
}

// Called from a FRESH invocation. Clears the queue first (a crash mid-send loses a banner rather
// than repeating it on every cron tick), then sends and logs each job.
export async function drain(env, deps) {
  deps = deps || {};
  const store = pushKv(env);
  if (!store) return { ok: false, reason: "no-kv" };
  let q = [];
  try { q = (await store.get(KEY, "json")) || []; } catch (e) {}
  if (!q.length) return { ok: true, jobs: 0 };
  await store.delete(KEY);
  const native = deps.native || ((m, o) => sendNativeToAll(env, m, o));
  const web = deps.web || ((o) => sendPushToAll(env, o));
  const log = deps.log || ((l) => repo.addCrawlLog(env, l));
  const out = [];
  for (const j of q) {
    const t0 = Date.now();
    let n = { sent: 0, total: 0 }, w = { sent: 0, total: 0 }, err = "";
    try { if (deps.native || nativePushEnabled(env)) n = (await native(j.msg, { workspace: j.workspace })) || n; else err = "native-push-not-configured"; }
    catch (e) { err = "native: " + String((e && e.message) || e).slice(0, 120); }
    try { if (deps.web || pushEnabled(env)) w = (await web({ workspace: j.workspace })) || w; } catch (e) {}
    const detail = `ws=${j.workspace} native=${n.sent}/${n.total} web=${w.sent}/${w.total}` + (j.id ? ` id=${j.id}` : "") + (err ? ` ${err}` : "");
    try { await log({ source_id: "push", status: n.sent || w.sent ? "ok" : "error", detail, duration_ms: Date.now() - t0 }); } catch (e) {}
    out.push({ workspace: j.workspace, native: n, web: w, error: err || undefined });
  }
  return { ok: true, jobs: q.length, results: out };
}
