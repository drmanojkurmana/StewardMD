/* StewardMD — Medical Updates API (Cloudflare Pages Function).
 *
 * Powers the 🔔 bell "Medical Updates" tab + guideline detail page + admin registry.
 * Backed by Cloudflare D1 (binding UPDATES_DB, "stewardmd-updates"). Reads fall back to
 * the legacy KV feed (updates:list) when D1 is not yet bound so the bell never goes dark.
 *
 * Content is PUBLIC non-PHI reference info → reads are open. Writes (publish, delete,
 * sync, source CRUD, migrate) require owner auth (Google owner login OR X-Admin-Token).
 *
 * Routes:
 *   GET    /api/updates                         -> { enabled, items, nextCursor }   (public feed; filters: type, workspace, q, before, limit)
 *   GET    /api/updates?id=<id>                  -> { enabled, item, structured, versions, has_whats_changed }  (public detail)
 *   GET    /api/updates/sources                 -> { sources }                      (admin)
 *   GET    /api/updates/crawl-logs              -> { logs }                         (admin)
 *   POST   /api/updates                         -> { ok, item }  manual publish     (admin)
 *   POST   /api/updates/sync                    -> { ok, ...tally }  run pipeline    (admin/cron)
 *   POST   /api/updates/migrate                 -> { ok, imported }  KV -> D1        (admin, one-time)
 *   POST   /api/updates/sources                 -> { ok }  create/update source     (admin)
 *   DELETE /api/updates/sources/:id             -> { ok }                           (admin)
 *   DELETE /api/updates/:id                     -> { ok }                           (admin)
 */
import { sendPushToAll, pushEnabled } from "../../_webpush.js";
import { sendNativeToAll, nativePushEnabled } from "../../_nativepush.js";
import { ownerOK } from "../../_adminauth.js";
import { identify } from "../../_fbauth.js";
import * as repo from "../../_updates_repo.js";
import { runPipeline } from "../../_updates_pipeline.js";
import { classifyDocument } from "../../_summarize.js";
import { tinyfishSearch } from "../../_search.js";
import { buildDigest } from "../../_digest.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

const CATS = ["drug", "approval", "safety", "recall", "guideline", "study", "general"];
const CAT_TYPE = { approval: "drug_approval", drug: "drug_approval", safety: "safety_alert", recall: "safety_alert", guideline: "guideline", study: "trial", general: "guideline" };
const WORKSPACES = ["internal_medicine", "surgery", "ent", "ophthalmology", "obstetrics_gynaecology", "urology", "dentistry_omfs", "paediatrics"];
const BRANCHES = ["cardiology", "nephrology", "pulmonology", "endocrinology", "infectious_diseases", "critical_care", "gastroenterology", "hepatology", "oncology", "emergency_medicine", "family_medicine"];
function normBranch(v) { v = String(v || "").toLowerCase().trim(); return BRANCHES.indexOf(v) >= 0 ? v : ""; }
function cleanBranches(v) { return Array.isArray(v) ? v.filter((b) => BRANCHES.indexOf(b) >= 0) : []; }
function normCategory(c) { c = String(c || "").toLowerCase().trim(); return CATS.indexOf(c) >= 0 ? c : "general"; }
function normImportance(v) { v = String(v || "").toLowerCase().trim(); return (v === "high" || v === "critical") ? v : "normal"; }
function normWorkspace(v) { v = String(v || "").toLowerCase().trim(); return WORKSPACES.indexOf(v) >= 0 ? v : "internal_medicine"; }
function cleanWorkspaces(v) { return Array.isArray(v) ? v.filter((w) => WORKSPACES.indexOf(w) >= 0) : []; }
function normType(t) { t = String(t || "").toLowerCase().trim(); return ["guideline", "drug_approval", "safety_alert", "trial"].indexOf(t) >= 0 ? t : ""; }
// Notification label prefix by content type, e.g. "New Guideline: <title>".
const NOTIF_LABEL = { guideline: "New Guideline", drug_approval: "New Drug Approval", safety_alert: "Safety Alert", trial: "New Trial" };
function pushLabel(item) { const t = (item && (item.type || CAT_TYPE[item.category])) || ""; return NOTIF_LABEL[t] || "Medical Update"; }

// Fire OS push banners (best-effort). Web push is payloadless (SW fetches newest);
// native carries the text. Pass `workspace` to deliver only to that workspace's
// subscribers (specialty-aware); omit it to broadcast to everyone.
function firePush(context, item, workspace) {
  const wsOpt = workspace ? { workspace } : undefined;
  try { if (pushEnabled(context.env)) context.waitUntil(sendPushToAll(context.env, wsOpt)); } catch (e) {}
  try {
    if (nativePushEnabled(context.env)) {
      // Title = "<label>: <title>"; body = the summary/description. Tap target is an
      // IN-APP deep link (/?u=<id>) so tapping opens the summary, not the PDF in Safari.
      const msg = item
        ? { title: pushLabel(item) + ": " + (item.title || "StewardMD"),
            body: String(item.body || item.summary || item.organization || item.source || "New medical update").split("\n")[0].replace(/\*\*/g, "").replace(/^[•\-*]\s+/, "").slice(0, 180),
            url: item.id ? "/?u=" + item.id : "/", tag: item.id ? "smd-" + item.id : undefined }
        : { title: "StewardMD", body: "New medical update", url: "/" };
      context.waitUntil(sendNativeToAll(context.env, msg, wsOpt));
    }
  } catch (e) {}
}
// Extract a PDF's text via Cloudflare Workers AI toMarkdown (env.AI binding). This is what lets the
// AI push box actually READ a guideline/FDA/EMA PDF instead of falling back to generic filler.
// Never throws — returns {ok:false, note} so the caller can log why and degrade to note+search.
async function pdfToText(env, u, resp) {
  try {
    if (!(env && env.AI && typeof env.AI.toMarkdown === "function")) return { ok: false, contentType: "application/pdf", note: "no-ai-binding" };
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 30 * 1024 * 1024) return { ok: false, contentType: "application/pdf", note: "pdf-too-large-" + buf.byteLength };
    const name = ((u.split(/[?#]/)[0].split("/").pop()) || "document.pdf").slice(0, 120) || "document.pdf";
    const res = await env.AI.toMarkdown({ name, blob: new Blob([buf], { type: "application/pdf" }) });
    const conv = Array.isArray(res) ? res[0] : res;
    if (!conv || conv.format !== "markdown" || !conv.data) {
      try { console.warn("[classify] pdf->md failed:", (conv && conv.error) || "no-data"); } catch (e) {}
      return { ok: false, contentType: "application/pdf", note: (conv && conv.error) || "pdf-convert-failed" };
    }
    const md = String(conv.data).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const hm = md.match(/^#{1,3}\s+(.+)$/m);                                   // first heading = title
    const title = (hm ? hm[1] : name).replace(/\s+/g, " ").trim().slice(0, 240);
    try { console.log("[classify] pdf->md ok:", md.length, "chars", conv.tokens ? "(" + conv.tokens + " tok)" : ""); } catch (e) {}
    return { ok: true, title, text: md.slice(0, 30000) };                     // large slice: key-changes pages sit near the front
  } catch (e) {
    try { console.warn("[classify] pdf->md exception:", String((e && e.message) || e)); } catch (x) {}
    return { ok: false, contentType: "application/pdf", note: "pdf-exception" };
  }
}

// Fetch a URL and reduce it to a title + bounded plain-text excerpt for the AI classifier
// (admin "AI push box"). HTML is stripped to text; PDFs go through Workers AI toMarkdown.
// Never throws — returns {ok:false} on any failure so the classifier degrades to note+search.
async function fetchUrlText(env, u) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (StewardMD-admin classifier)" }, redirect: "follow" });
    if (!r.ok) return { ok: false, status: r.status };
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const isPdf = ct.indexOf("pdf") >= 0 || /\.pdf(\?|#|$)/i.test(u);
    if (isPdf) return await pdfToText(env, u, r);
    if (ct.indexOf("html") < 0 && ct.indexOf("text") < 0) return { ok: false, contentType: ct };  // other binary → rely on note+search
    const html = (await r.text()).slice(0, 400000);
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = tm ? tm[1].replace(/\s+/g, " ").trim().slice(0, 240) : "";
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ").trim();
    return { ok: true, title, text: text.slice(0, 16000) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
// Group new/updated pipeline items by workspace and fire one targeted push per
// workspace (a representative item per group — highest importance first).
function firePushForItems(context, items) {
  const rank = { critical: 3, high: 2, normal: 1 };
  const byWs = {};
  for (const it of items || []) {
    const w = it.workspace || "internal_medicine";
    if (!byWs[w] || (rank[it.importance] || 1) > (rank[byWs[w].importance] || 1)) byWs[w] = it;
  }
  Object.keys(byWs).forEach((w) => firePush(context, byWs[w], w));
}

// One-time import of the legacy KV feed (updates:list) into D1.
async function migrateKvToD1(env) {
  const kv = env.UPDATES_KV || env.GHIS_KV || env.CASES_KV || null;
  if (!kv) return { imported: 0, note: "no-kv" };
  let list = [];
  try { list = (await kv.get("updates:list", "json")) || []; } catch (e) {}
  let imported = 0;
  for (const x of list) {
    const docKey = x.url || x.title;
    if (!docKey) continue;
    if (await repo.getByDocKey(env, docKey)) continue;
    const type = CAT_TYPE[normCategory(x.category)] || "guideline";
    await repo.insertUpdate(env, {
      doc_key: docKey, source_id: "legacy", type, organization: x.source || "StewardMD",
      workspace: "internal_medicine", title: String(x.title || "").slice(0, 240), body: String(x.body || "").slice(0, 240),
      category: normCategory(x.category), published_ts: x.ts || Date.now(), importance: normImportance(x.importance),
      est_read_min: 1, summary: String(x.body || ""), summary_json: "", official_url: x.url || "",
      content_hash: "", auto: x.auto ? 1 : 0, pinned: x.pinned ? 1 : 0,
    });
    imported++;
  }
  return { imported, total: list.length };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path.filter(Boolean) : (params.path ? [params.path] : []);
  const head = parts[0] || "";

  /* ---------------- public reads ---------------- */
  if (method === "GET" && !head) {
    const idq = url.searchParams.get("id");
    if (idq) {
      const detail = await repo.getById(env, idq);
      if (!detail) return json({ enabled: repo.hasDb(env), error: "not-found" }, 404);
      return json({ enabled: true, item: detail.item, structured: detail.structured, versions: detail.versions, has_whats_changed: (detail.versions || []).length > 0 });
    }
    const feed = await repo.getFeed(env, {
      type: url.searchParams.get("type") || "all",
      workspace: url.searchParams.get("workspace") || "all",
      branch: url.searchParams.get("branch") || "all",
      q: url.searchParams.get("q") || "",
      auto: url.searchParams.get("auto"),
      before: url.searchParams.get("before") || "",
      limit: url.searchParams.get("limit") || "20",
    });
    return json({ enabled: repo.hasDb(env) || feed.items.length > 0, items: feed.items, nextCursor: feed.nextCursor });
  }
  // Public: latest weekly "This Week in Medicine" digest (for the feed banner).
  if (method === "GET" && head === "digest") {
    return json({ enabled: repo.hasDb(env), digest: await repo.getLatestDigest(env) });
  }

  /* ---------- user-authenticated (any signed-in doctor; NOT owner-only) ---------- */
  if (head === "prefs") {
    const uid = await identify(request, env);
    if (!uid) return json({ error: "sign-in-required" }, 401);
    if (method === "GET") {
      const prefs = (await repo.getPrefs(env, uid)) || { uid, workspaces: ["internal_medicine"], branches: [], push_enabled: true };
      return json({ ok: true, prefs });
    }
    if (method === "POST") {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const workspaces = cleanWorkspaces(body.workspaces);
      const branches = cleanBranches(body.branches);
      const push_enabled = body.push_enabled !== false;
      await repo.savePrefs(env, uid, { workspaces, branches, push_enabled });
      return json({ ok: true, prefs: { uid, workspaces: workspaces.length ? workspaces : ["internal_medicine"], branches, push_enabled } });
    }
    return json({ error: "bad-request" }, 400);
  }
  if (head === "bookmarks") {
    const uid = await identify(request, env);
    if (!uid) return json({ error: "sign-in-required" }, 401);
    if (method === "GET") return json({ ok: true, ids: await repo.listBookmarkIds(env, uid), items: await repo.listBookmarkItems(env, uid) });
    if (method === "POST") {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      let body = {}; try { body = await request.json(); } catch (e) {}
      if (!body.id) return json({ error: "id-required" }, 400);
      await repo.addBookmark(env, uid, String(body.id));
      return json({ ok: true });
    }
    if (method === "DELETE" && parts[1]) {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      await repo.removeBookmark(env, uid, parts[1]);
      return json({ ok: true });
    }
    return json({ error: "bad-request" }, 400);
  }

  /* ---------------- admin gate (everything below) ---------------- */
  if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);

  try {
    if (method === "GET" && head === "sources") return json({ sources: await repo.listSources(env, false) });
    if (method === "GET" && head === "crawl-logs") return json({ logs: await repo.listCrawlLogs(env, url.searchParams.get("limit")) });

    if (method === "POST" && head === "sync") {
      const res = await runPipeline(env);
      if (res && res.items && res.items.length) firePushForItems(context, res.items);
      return json(res.ok === false ? { ok: false, ...res } : { ok: true, ...res });
    }

    // AI push box: given a link and/or a note, fetch the page and let Gemini classify it into a
    // publishable draft (type, specialty workspace, title, summary, importance). Does NOT publish —
    // the console shows the draft to review/edit, then POSTs /api/updates (which fires the push).
    if (method === "POST" && head === "classify") {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const srcUrl = String(body.url || "").trim().slice(0, 800);
      const prompt = String(body.prompt || "").trim().slice(0, 2000);
      if (!srcUrl && !prompt) return json({ error: "url-or-prompt-required" }, 400);
      let title = "", excerpt = "", fetchNote = "";
      if (srcUrl) {
        const f = await fetchUrlText(env, srcUrl);
        if (f.ok) { title = f.title; excerpt = f.text; }
        else fetchNote = "could-not-fetch-page" + (f.status ? "-" + f.status : "");   // classifier falls back to the note+url+search
      }
      // Enrich with a web search (unless caller opts out) — lets a bare drug/guideline name work, and
      // fills real pharma facts a thin headline lacks. Query = note, else page title, else the URL.
      const wantSearch = body.search !== false;
      const search = (wantSearch && (prompt || title || srcUrl)) ? await tinyfishSearch(env, prompt || title || srcUrl) : [];
      const res = await classifyDocument(env, { url: srcUrl, title, excerpt, prompt, search });
      if (!res.ok) return json({ ok: false, error: res.error || "classify-failed", fetchNote, searched: search.length }, 502);
      return json({ ok: true, draft: res.draft, model: res.model, fetchNote, searched: search.length });
    }

    if (method === "POST" && head === "digest") {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days"), 10) || 7));
      const items = await repo.getUpdatesSince(env, Date.now() - days * 86400000, 60);
      if (!items.length) return json({ ok: true, skipped: "no-items", week: repo.isoWeekKey(Date.now()) });
      const res = await buildDigest(env, items);
      if (!res.ok) return json({ ok: false, error: res.error }, 502);
      const week = repo.isoWeekKey(Date.now());
      await repo.saveDigest(env, week, JSON.stringify(res.data));
      return json({ ok: true, week, count: items.length });
    }

    if (method === "POST" && head === "migrate") {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      const res = await migrateKvToD1(env);
      return json({ ok: true, ...res });
    }

    if (method === "POST" && head === "sources") {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      if (!id) return json({ error: "id-required" }, 400);
      await repo.saveSource(env, {
        id, name: String(body.name || id).slice(0, 120), workspace: normWorkspace(body.workspace), branch: normBranch(body.branch),
        type: normType(body.type) || "guideline", query: String(body.query || "").slice(0, 600), homepage: String(body.homepage || "").slice(0, 400),
        guideline_page: String(body.guideline_page || "").slice(0, 400), rss_url: String(body.rss_url || "").slice(0, 400),
        parser_type: (["head", "litapi", "rss"].indexOf(body.parser_type) >= 0 ? body.parser_type : "rss"), priority: parseInt(body.priority, 10) || 100,
        enabled: body.enabled ? 1 : 0,
      });
      return json({ ok: true, id });
    }

    if (method === "POST" && !head) {
      if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const title = String(body.title || "").trim().slice(0, 240);
      if (!title) return json({ error: "title-required" }, 400);
      const category = normCategory(body.category);
      const type = normType(body.type) || CAT_TYPE[category] || "guideline";
      const bodyText = String(body.body || "").trim().slice(0, 4000);
      // Optional structured payload from the AI push box (e.g. a drug's pharma block). Stored in
      // summary_json so the app detail view (data.structured) can render a prescribing snapshot.
      const structured = (body.structured && typeof body.structured === "object" && !Array.isArray(body.structured)) ? body.structured : null;
      const summaryJson = structured ? JSON.stringify(Object.assign({}, structured, { summary: bodyText })).slice(0, 12000) : "";
      const docKey = String(body.url || "").slice(0, 500) || ("manual:" + repo.newId("m"));
      const u = {
        doc_key: docKey, source_id: "manual", type, organization: String(body.source || "StewardMD").slice(0, 120),
        workspace: normWorkspace(body.workspace), branch: normBranch(body.branch), title, body: bodyText.slice(0, 240),
        category, published_ts: Date.now(), importance: normImportance(body.importance),
        est_read_min: Math.max(1, Math.round(bodyText.split(/\s+/).length / 200)) || 1,
        summary: bodyText, summary_json: summaryJson, official_url: String(body.url || "").slice(0, 500),
        content_hash: "", auto: 0, pinned: !!body.pinned,
      };
      // Re-publishing the SAME url updates the existing item (upgrade its content) instead of failing
      // on the doc_key UNIQUE constraint. A genuinely new item is inserted AND pushed; an update is not
      // re-pushed (users who already got it aren't re-notified for a content fix).
      let id, updated = false;
      const existing = await repo.getByDocKey(env, docKey);
      if (existing && existing.id) { await repo.updateExisting(env, existing.id, u); id = existing.id; updated = true; }
      else { id = await repo.insertUpdate(env, u); }
      const detail = await repo.getById(env, id);
      const item = detail && detail.item;
      if (!updated) firePush(context, item, item && item.workspace);
      return json({ ok: true, item, updated });
    }

    if (method === "DELETE" && head === "sources" && parts[1]) {
      await repo.deleteSource(env, parts[1]);
      return json({ ok: true });
    }
    if (method === "DELETE" && head) {
      await repo.deleteUpdate(env, head);
      return json({ ok: true });
    }

    return json({ error: "bad-request", method, head }, 400);
  } catch (e) {
    { try { console.warn("[api] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {} return json({ error: "server_error" }, 500); }
  }
}
