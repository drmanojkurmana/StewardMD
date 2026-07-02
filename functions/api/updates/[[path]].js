/* StewardMD — Notifications / Medical Updates API (Cloudflare Pages Function)
 *
 * Powers the in-app 🔔 notifications panel. Two kinds of updates:
 *   • MANUAL   — published by the admin from /admin/updates.html (what you type).
 *   • AUTO     — trusted medical updates ingested from FDA RSS feeds (new drug
 *                approvals, MedWatch safety alerts, recalls), filtered to the
 *                important ones. Triggered by POST /api/updates/sync (the Worker
 *                cron calls this on a schedule; the admin page has a button too).
 *
 * Content here is PUBLIC, non-PHI reference information → GET is open. Writes
 * (publish / delete / sync) require the admin token.
 *
 * Routes:
 *   GET    /api/updates            -> { enabled, items:[...] }         (public)
 *   POST   /api/updates            -> { ok, item }   body={title,body,category,url,importance}  (admin)
 *   POST   /api/updates/sync       -> { ok, added, total }            (admin; pulls FDA feeds)
 *   DELETE /api/updates/:id        -> { ok }                          (admin)
 *
 * Config (Cloudflare Pages env):
 *   KV binding  UPDATES_KV  (or falls back to GHIS_KV / CASES_KV)  — key "updates:list"
 *   Secret      UPDATES_ADMIN_TOKEN  — required to publish/delete/sync
 *   Optional    UPDATES_FEEDS  — comma-separated "category|url" trusted RSS feeds
 *                                (defaults to FDA MedWatch, press releases, recalls)
 */
const LIST_KEY = "updates:list";
const CAP = 120;                 // keep the newest N
const DESC_MAX = 600;

function kv(env) { return env.UPDATES_KV || env.GHIS_KV || env.CASES_KV || null; }
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

// admin token check → true/false, or null when not configured (publishing disabled)
function adminOK(request, env) {
  const want = env.UPDATES_ADMIN_TOKEN || "";
  if (!want) return null;
  const got = request.headers.get("X-Admin-Token") || "";
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

const CATS = ["drug", "approval", "safety", "recall", "guideline", "study", "general"];
function normCategory(c) { c = String(c || "").toLowerCase().trim(); return CATS.indexOf(c) >= 0 ? c : "general"; }
function normImportance(v) { v = String(v || "").toLowerCase().trim(); return (v === "high" || v === "critical") ? v : "normal"; }
function newId() { return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function readList(store) { try { return (await store.get(LIST_KEY, "json")) || []; } catch (e) { return []; } }
async function writeList(store, list) {
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
  const capped = list.slice(0, CAP);
  await store.put(LIST_KEY, JSON.stringify(capped));
  return capped;
}

/* ---------------- FDA feed ingest (trusted, auto) ---------------- */
// Default trusted sources. FDA RSS is curated + authoritative. Category is the feed's.
const DEFAULT_FEEDS = [
  { category: "safety",   url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml", source: "FDA MedWatch" },
  { category: "approval", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", source: "FDA Press" },
  { category: "recall",   url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml", source: "FDA Recalls" }
];
// Keep only genuinely important items (approvals / safety / recalls / label changes).
// NB: no trailing \b — these are word STEMS (approv → approves/approved/approval),
// so anchoring the end would reject the inflected forms we most want.
const IMPORTANT_RE = /\b(approv|clearance|authoriz|granted|safety|warning|boxed|black[-\s]?box|recall|withdraw|alert|contraindicat|shortage|label|guidance|adverse|indication|black box)/i;

function feedsFromEnv(env) {
  if (!env.UPDATES_FEEDS) return DEFAULT_FEEDS;
  return String(env.UPDATES_FEEDS).split(",").map((s) => {
    const parts = s.split("|"); const url = (parts[1] || parts[0] || "").trim();
    return url ? { category: normCategory(parts[1] ? parts[0] : "general"), url, source: "FDA" } : null;
  }).filter(Boolean);
}
function decodeEntities(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(+n); } catch (e) { return m; } });
}
function stripTags(s) { return String(s).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim(); }
function clean(s) { return decodeEntities(stripTags(decodeEntities(s || ""))); }

function parseRss(xml) {
  const out = [];
  const blocks = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const seg = raw.split(/<\/item>/i)[0];
    const pick = (tag) => { const m = seg.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i")); return m ? clean(m[1]) : ""; };
    const title = pick("title"); if (!title) continue;
    const link = pick("link") || pick("guid");
    const desc = pick("description");
    const date = pick("pubDate") || pick("updated") || pick("date");
    const ts = date ? (Date.parse(date) || Date.now()) : Date.now();
    out.push({ title, url: link, body: desc.slice(0, DESC_MAX), ts });
  }
  return out;
}

async function ingestFeeds(env, store) {
  const feeds = feedsFromEnv(env);
  const list = await readList(store);
  const seen = new Set(list.map((x) => x.url || x.title));
  let added = 0;
  for (const f of feeds) {
    let xml = "";
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "StewardMD/1.0 (+https://stewardmd.in)", "Accept": "application/rss+xml, application/xml, text/xml" }, cf: { cacheTtl: 300 } });
      if (!r.ok) continue;
      xml = await r.text();
    } catch (e) { continue; }
    for (const it of parseRss(xml)) {
      const key = it.url || it.title;
      if (seen.has(key)) continue;
      if (!IMPORTANT_RE.test(it.title + " " + it.body)) continue;         // only important items
      seen.add(key);
      list.push({ id: newId(), title: it.title.slice(0, 200), body: it.body,
        category: f.category, source: f.source, url: it.url,
        importance: /recall|boxed|black[-\s]?box|withdraw|contraindicat/i.test(it.title + it.body) ? "high" : "normal",
        ts: it.ts, auto: true });
      added++;
    }
  }
  const saved = await writeList(store, list);
  return { added, total: saved.length };
}

/* ---------------- entry ---------------- */
export async function onRequest(context) {
  const { request, env, params } = context;
  const store = kv(env);
  const id = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  if (!store) {
    if (method === "GET" && !id) return json({ enabled: false, items: [] });
    return json({ enabled: false, error: "no-store" }, 501);
  }

  // Public read
  if (method === "GET" && !id) {
    const items = await readList(store);
    return json({ enabled: true, items });
  }

  // Everything below is admin-only
  const ok = adminOK(request, env);
  if (ok === null) return json({ error: "admin-not-configured", detail: "set UPDATES_ADMIN_TOKEN" }, 503);
  if (!ok) return json({ error: "unauthorised" }, 401);

  try {
    if (method === "POST" && id === "sync") {
      const res = await ingestFeeds(env, store);
      return json({ ok: true, ...res });
    }
    if (method === "POST" && !id) {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) return json({ error: "title-required" }, 400);
      const item = {
        id: newId(), title,
        body: String(body.body || "").trim().slice(0, 4000),
        category: normCategory(body.category),
        importance: normImportance(body.importance),
        source: String(body.source || "StewardMD").slice(0, 60),
        url: String(body.url || "").slice(0, 400),
        pinned: !!body.pinned,
        ts: Date.now(), auto: false
      };
      const list = await readList(store);
      list.push(item);
      await writeList(store, list);
      return json({ ok: true, item });
    }
    if (method === "DELETE" && id) {
      const list = (await readList(store)).filter((x) => x.id !== id);
      await writeList(store, list);
      return json({ ok: true });
    }
    return json({ error: "bad-request", method, id }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
