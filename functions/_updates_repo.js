/* StewardMD — Medical Updates: D1 data access (repository).
 *
 * All SQL for the Medical Updates module lives here so the route handler and the
 * pipeline stay thin. Binding: env.UPDATES_DB (Cloudflare D1, "stewardmd-updates").
 *
 * When D1 is not bound the module degrades gracefully: reads fall back to the legacy
 * KV feed (updates:list) so the bell keeps working until the DB is provisioned; all
 * writes require D1 and surface a clear "no-db" error.
 */

export function hasDb(env) { return !!env.UPDATES_DB; }
function db(env) { return env.UPDATES_DB; }
function legacyKv(env) { return env.UPDATES_KV || env.GHIS_KV || env.CASES_KV || null; }

export function newId(p) { return (p || "u") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// type → legacy category (drives the coloured chip in the existing feed card)
const TYPE_CAT = { drug_approval: "approval", safety_alert: "safety", guideline: "guideline", trial: "study" };
export function typeCategory(t) { return TYPE_CAT[t] || "general"; }

/* ---------------- row <-> feed item ---------------- */
export function rowToItem(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    category: r.category || typeCategory(r.type),
    title: r.title,
    body: r.body || (r.summary ? String(r.summary).slice(0, 240) : ""),
    summary: r.summary || "",
    organization: r.organization || r.source_id || "",
    source: r.organization || r.source_id || "StewardMD",
    workspace: r.workspace || "internal_medicine",
    branch: r.branch || "",
    importance: r.importance || "normal",
    est_read_min: r.est_read_min || 0,
    url: r.official_url || "",
    version: r.version || "",
    doi: r.doi || "",
    pmid: r.pmid || "",
    pinned: !!r.pinned,
    auto: !!r.auto,
    ts: r.published_ts || r.created_ts || 0,
  };
}

/* ---------------- updates: feed + detail ---------------- */

// Paginated, filterable feed. opts = { type, workspace, q, before, limit }.
// Cursor `before` = "<published_ts>_<id>" of the last item on the previous page.
export async function getFeed(env, opts) {
  opts = opts || {};
  if (!hasDb(env)) {
    let items = await legacyItems(env);
    if (opts.auto === "0" || opts.auto === 0) items = items.filter((x) => !x.auto);
    else if (opts.auto === "1" || opts.auto === 1) items = items.filter((x) => x.auto);
    return { items, nextCursor: null };
  }
  const where = [], binds = [];
  if (opts.type && opts.type !== "all") { where.push("type = ?"); binds.push(String(opts.type)); }
  if (opts.workspace && opts.workspace !== "all") { where.push("workspace = ?"); binds.push(String(opts.workspace)); }
  if (opts.branch && opts.branch !== "all") { where.push("branch = ?"); binds.push(String(opts.branch)); }
  if (opts.q) {
    const like = "%" + String(opts.q).toLowerCase().slice(0, 80) + "%";
    where.push("(lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(keywords) LIKE ?)");
    binds.push(like, like, like);
  }
  if (opts.auto === "0" || opts.auto === "1" || opts.auto === 0 || opts.auto === 1) { where.push("auto = ?"); binds.push(parseInt(opts.auto, 10)); }
  if (opts.before) {
    const parts = String(opts.before).split("_");
    const p = parseInt(parts[0], 10) || 0, cid = parts.slice(1).join("_") || "";
    where.push("(published_ts < ? OR (published_ts = ? AND id < ?))");
    binds.push(p, p, cid);
  }
  const limit = Math.max(1, Math.min(50, parseInt(opts.limit, 10) || 20));
  const sql = "SELECT * FROM updates" + (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY published_ts DESC, id DESC LIMIT ?";
  const rs = await db(env).prepare(sql).bind(...binds, limit + 1).all();
  const rows = (rs.results || []).slice();
  let nextCursor = null;
  if (rows.length > limit) {
    rows.length = limit;
    const last = rows[rows.length - 1];
    nextCursor = (last.published_ts || 0) + "_" + last.id;
  }
  return { items: rows.map(rowToItem), nextCursor };
}

// Legacy KV feed (only used when D1 is not bound) — keeps the bell alive pre-migration.
async function legacyItems(env) {
  const kv = legacyKv(env); if (!kv) return [];
  try { return (await kv.get("updates:list", "json")) || []; } catch (e) { return []; }
}

export async function getById(env, id) {
  if (!hasDb(env)) return null;
  const r = await db(env).prepare("SELECT * FROM updates WHERE id = ?").bind(id).first();
  if (!r) return null;
  let structured = null; try { structured = r.summary_json ? JSON.parse(r.summary_json) : null; } catch (e) {}
  const versions = await listVersions(env, id);
  return { item: rowToItem(r), structured, row: r, versions };
}

export async function getByDocKey(env, docKey) {
  if (!hasDb(env)) return null;
  return await db(env).prepare("SELECT * FROM updates WHERE doc_key = ?").bind(docKey).first();
}

// Insert a fully-formed update row. `u` fields map 1:1 to the schema columns.
export async function insertUpdate(env, u) {
  if (!hasDb(env)) throw new Error("no-db");
  const now = Date.now();
  const id = u.id || newId("u");
  await db(env).prepare(
    "INSERT INTO updates (id, doc_key, source_id, type, organization, workspace, branch, title, body, category, published_ts, importance, est_read_min, summary, summary_json, official_url, official_pdf_url, doi, pmid, keywords, version, content_hash, auto, pinned, created_ts, updated_ts) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    id, u.doc_key, u.source_id || "", u.type || "guideline", u.organization || "", u.workspace || "internal_medicine", u.branch || "",
    u.title, u.body || "", u.category || typeCategory(u.type), u.published_ts || now, u.importance || "normal",
    u.est_read_min || 0, u.summary || "", u.summary_json || "", u.official_url || "", u.official_pdf_url || "",
    u.doi || "", u.pmid || "", u.keywords || "", u.version || "", u.content_hash || "", u.auto == null ? 1 : (u.auto ? 1 : 0),
    u.pinned ? 1 : 0, now, now
  ).run();
  return id;
}

// Replace the current summary/version of an existing update (used when a doc changes).
export async function updateExisting(env, id, u) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare(
    "UPDATE updates SET type=?, organization=?, workspace=?, branch=?, title=?, body=?, category=?, published_ts=?, importance=?, est_read_min=?, summary=?, summary_json=?, official_url=?, official_pdf_url=?, doi=?, pmid=?, keywords=?, version=?, content_hash=?, updated_ts=? WHERE id=?"
  ).bind(
    u.type || "guideline", u.organization || "", u.workspace || "internal_medicine", u.branch || "", u.title, u.body || "",
    u.category || typeCategory(u.type), u.published_ts || Date.now(), u.importance || "normal", u.est_read_min || 0,
    u.summary || "", u.summary_json || "", u.official_url || "", u.official_pdf_url || "", u.doi || "", u.pmid || "",
    u.keywords || "", u.version || "", u.content_hash || "", Date.now(), id
  ).run();
}

export async function deleteUpdate(env, id) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare("DELETE FROM updates WHERE id = ?").bind(id).run();
  await db(env).prepare("DELETE FROM update_versions WHERE update_id = ?").bind(id).run();
}

/* ---------------- version history ---------------- */
export async function insertVersion(env, v) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare(
    "INSERT INTO update_versions (id, update_id, version, published_ts, summary_json, whats_changed_json, content_hash, created_ts) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(v.id || newId("v"), v.update_id, v.version || "", v.published_ts || Date.now(), v.summary_json || "", v.whats_changed_json || "", v.content_hash || "", Date.now()).run();
}
export async function listVersions(env, updateId) {
  if (!hasDb(env)) return [];
  const rs = await db(env).prepare("SELECT * FROM update_versions WHERE update_id = ? ORDER BY created_ts DESC").bind(updateId).all();
  return rs.results || [];
}

/* ---------------- sources registry ---------------- */
export async function listSources(env, enabledOnly) {
  if (!hasDb(env)) return [];
  const sql = "SELECT * FROM sources" + (enabledOnly ? " WHERE enabled = 1" : "") + " ORDER BY priority ASC, id ASC";
  const rs = await db(env).prepare(sql).all();
  return rs.results || [];
}
export async function getSource(env, id) {
  if (!hasDb(env)) return null;
  return await db(env).prepare("SELECT * FROM sources WHERE id = ?").bind(id).first();
}
export async function saveSource(env, s) {
  if (!hasDb(env)) throw new Error("no-db");
  const now = Date.now();
  await db(env).prepare(
    "INSERT INTO sources (id, name, workspace, branch, type, homepage, guideline_page, rss_url, query, parser_type, priority, enabled, created_ts) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace=excluded.workspace, branch=excluded.branch, type=excluded.type, homepage=excluded.homepage, guideline_page=excluded.guideline_page, rss_url=excluded.rss_url, query=excluded.query, parser_type=excluded.parser_type, priority=excluded.priority, enabled=excluded.enabled"
  ).bind(
    s.id, s.name || s.id, s.workspace || "internal_medicine", s.branch || "", s.type || "guideline", s.homepage || "",
    s.guideline_page || "", s.rss_url || "", s.query || "", s.parser_type || "rss", parseInt(s.priority, 10) || 100,
    s.enabled ? 1 : 0, now
  ).run();
}
export async function deleteSource(env, id) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare("DELETE FROM sources WHERE id = ?").bind(id).run();
}
// Persist conditional-request state after a HEAD/GET poll of a 'head' source.
export async function saveSourceCrawlState(env, id, st) {
  if (!hasDb(env)) return;
  await db(env).prepare("UPDATE sources SET etag=?, last_modified=?, content_length=?, last_crawl_ts=? WHERE id=?")
    .bind(st.etag || "", st.last_modified || "", st.content_length || "", Date.now(), id).run();
}

/* ---------------- crawl logs ---------------- */
export async function addCrawlLog(env, log) {
  if (!hasDb(env)) return;
  try {
    await db(env).prepare("INSERT INTO crawl_logs (id, ts, source_id, status, detail, ai_used, duration_ms) VALUES (?,?,?,?,?,?,?)")
      .bind(newId("c"), Date.now(), log.source_id || "", log.status || "ok", String(log.detail || "").slice(0, 300), log.ai_used ? 1 : 0, log.duration_ms || 0).run();
  } catch (e) {}
}
export async function listCrawlLogs(env, limit) {
  if (!hasDb(env)) return [];
  const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  const rs = await db(env).prepare("SELECT * FROM crawl_logs ORDER BY ts DESC LIMIT ?").bind(n).all();
  return rs.results || [];
}
// Keep only the newest `keep` crawl-log rows.
export async function pruneCrawlLogs(env, keep) {
  if (!hasDb(env)) return;
  const n = Math.max(50, parseInt(keep, 10) || 500);
  try {
    await db(env).prepare(
      "DELETE FROM crawl_logs WHERE id NOT IN (SELECT id FROM crawl_logs ORDER BY ts DESC LIMIT ?)"
    ).bind(n).run();
  } catch (e) {}
}

/* ---------------- per-user notification preferences (Phase 2) ---------------- */
const DEFAULT_WS = ["internal_medicine"];
export async function getPrefs(env, uid) {
  if (!hasDb(env) || !uid) return null;
  const r = await db(env).prepare("SELECT * FROM user_prefs WHERE uid = ?").bind(uid).first();
  if (!r) return null;
  let ws = DEFAULT_WS; try { ws = JSON.parse(r.workspaces || "[]"); if (!Array.isArray(ws) || !ws.length) ws = DEFAULT_WS; } catch (e) {}
  let br = []; try { br = JSON.parse(r.branches || "[]"); if (!Array.isArray(br)) br = []; } catch (e) {}
  return { uid: r.uid, workspaces: ws, branches: br, push_enabled: !!r.push_enabled, updated_ts: r.updated_ts };
}
export async function savePrefs(env, uid, p) {
  if (!hasDb(env)) throw new Error("no-db");
  const ws = JSON.stringify(Array.isArray(p.workspaces) && p.workspaces.length ? p.workspaces : DEFAULT_WS);
  const br = JSON.stringify(Array.isArray(p.branches) ? p.branches : []);
  await db(env).prepare(
    "INSERT INTO user_prefs (uid, workspaces, branches, push_enabled, updated_ts) VALUES (?,?,?,?,?) " +
    "ON CONFLICT(uid) DO UPDATE SET workspaces=excluded.workspaces, branches=excluded.branches, push_enabled=excluded.push_enabled, updated_ts=excluded.updated_ts"
  ).bind(uid, ws, br, p.push_enabled === false ? 0 : 1, Date.now()).run();
}

/* ---------------- cross-device bookmarks (Phase 2) ---------------- */
export async function listBookmarkIds(env, uid) {
  if (!hasDb(env) || !uid) return [];
  const rs = await db(env).prepare("SELECT update_id FROM bookmarks WHERE uid = ? ORDER BY created_ts DESC").bind(uid).all();
  return (rs.results || []).map((x) => x.update_id);
}
// Full bookmarked update rows (for a "Saved" view), newest-bookmarked first.
export async function listBookmarkItems(env, uid) {
  if (!hasDb(env) || !uid) return [];
  const rs = await db(env).prepare(
    "SELECT u.* FROM bookmarks b JOIN updates u ON u.id = b.update_id WHERE b.uid = ? ORDER BY b.created_ts DESC LIMIT 200"
  ).bind(uid).all();
  return (rs.results || []).map(rowToItem);
}
export async function addBookmark(env, uid, updateId) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare("INSERT OR IGNORE INTO bookmarks (uid, update_id, created_ts) VALUES (?,?,?)").bind(uid, updateId, Date.now()).run();
}
export async function removeBookmark(env, uid, updateId) {
  if (!hasDb(env)) throw new Error("no-db");
  await db(env).prepare("DELETE FROM bookmarks WHERE uid = ? AND update_id = ?").bind(uid, updateId).run();
}
