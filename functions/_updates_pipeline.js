/* StewardMD — Medical Updates: daily crawl + summarize pipeline.
 *
 * For each ENABLED source (priority order):
 *   • parser_type='rss'  → fetch feed, parse items, hash each, dedup by doc_key.
 *   • parser_type='head' → conditional GET (If-None-Match / If-Modified-Since) of the
 *                          guideline page; unchanged (304 / same ETag+Length) → STOP.
 * AI summarization runs ONLY for a genuinely new or content-hash-changed document.
 * Every source writes a crawl_logs row. Results are cached in D1 and shared by all users.
 */
import * as repo from "./_updates_repo.js";
import { summarizeDocument, diffDocument } from "./_summarize.js";
import { clean, sha256hex, itemHashInput, parseRss, keepItem } from "./_updates_util.js";
import { fetchLitApi } from "./_litapi.js";
import { tinyfishSearch } from "./_search.js";

const UA = "StewardMD/1.0 (+https://stewardmd.in)";
export { parseRss };

function metaFor(source, item, excerpt) {
  return {
    title: item.title,
    organization: source.name,
    sourceType: source.type,
    workspace: source.workspace,
    url: item.url || source.guideline_page || source.homepage || "",
    doi: item.doi || "", pmid: item.pmid || "",
    publishedTs: item.ts || Date.now(),
    excerpt,
  };
}

// Persist a summarized document as new, or as an updated version of an existing one.
async function storeSummary(env, source, item, docKey, hash, mode) {
  const excerpt = String(item.desc || item.title || "").slice(0, 8000);
  // Enrich thin RSS headlines (and all drug/safety items) with a web search so the summary + pharma
  // carry real facts, not just a title. Bounded + best-effort (no key/error → no search).
  const needsSearch = source.type === "drug_approval" || source.type === "safety_alert" || excerpt.length < 800;
  const search = needsSearch ? await tinyfishSearch(env, ((item.title || "") + " " + (source.name || "")).trim()) : [];
  const res = await summarizeDocument(env, Object.assign(metaFor(source, item, excerpt), { search }));
  if (!res.ok) return { ai: true, ok: false, error: res.error };
  const d = res.data;
  const body = (d.summary || "").slice(0, 240);
  const summary_json = JSON.stringify(d);
  const base = {
    doc_key: docKey, source_id: source.id, type: source.type, organization: d.organization || source.name,
    workspace: d.workspace || source.workspace, branch: source.branch || "", title: d.title || item.title, body,
    category: repo.typeCategory(source.type), published_ts: item.ts || Date.now(), importance: d.importance,
    est_read_min: d.est_read_min, summary: d.summary, summary_json,
    official_url: d.official_url || item.url || "", official_pdf_url: d.official_pdf_url || "",
    doi: d.doi || item.doi || "", pmid: d.pmid || item.pmid || "", keywords: (d.keywords || []).join(", "), version: d.version || "",
    content_hash: hash, auto: 1,
  };
  const pushItem = (id) => ({ id, title: base.title, url: base.official_url, workspace: base.workspace, importance: base.importance, organization: base.organization, category: base.category, type: base.type, body: base.body });
  if (mode === "updated") {
    const existing = await repo.getByDocKey(env, docKey);
    if (existing) {
      // Phase 3 — "What's Changed": diff the previous summary against the new source,
      // and store the Topic/Previous/Current/Impact rows on the snapshot version row.
      let whats_changed_json = "";
      try {
        const prev = existing.summary_json ? JSON.parse(existing.summary_json) : null;
        if (prev) {
          const diff = await diffDocument(env, { prevSummary: prev, newExcerpt: excerpt, title: base.title, organization: base.organization });
          if (diff.ok && diff.changes.length) whats_changed_json = JSON.stringify(diff.changes);
        }
      } catch (e) {}
      await repo.insertVersion(env, { update_id: existing.id, version: existing.version || "", published_ts: existing.published_ts, summary_json: existing.summary_json || "", whats_changed_json: whats_changed_json, content_hash: existing.content_hash || "" });
      await repo.updateExisting(env, existing.id, base);
      return { ai: true, ok: true, id: existing.id, mode: "updated", item: pushItem(existing.id) };
    }
  }
  const id = await repo.insertUpdate(env, base);
  return { ai: true, ok: true, id, mode: "new", item: pushItem(id) };
}

async function crawlRssSource(env, source, budget) {
  const acc = { new: 0, updated: 0, unchanged: 0, errors: 0, ai: 0, items: [] };
  let xml = "";
  try {
    const r = await fetch(source.rss_url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" }, cf: { cacheTtl: 300 } });
    if (!r.ok) { await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: "feed HTTP " + r.status }); acc.errors++; return acc; }
    xml = await r.text();
  } catch (e) { await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: String(e && e.message || e).slice(0, 200) }); acc.errors++; return acc; }

  const items = parseRss(xml);
  const maxNew = Math.max(1, parseInt(env.UPDATES_MAX_NEW_PER_SOURCE, 10) || 8);
  for (const it of items) {
    if (acc.new + acc.updated >= maxNew) break;
    if (budget.left <= 0) break;
    if (!keepItem(source.type, it.title, it.desc)) continue;
    const docKey = it.url || it.title;
    const hash = await sha256hex(itemHashInput(it));
    const existing = await repo.getByDocKey(env, docKey);
    if (existing && existing.content_hash === hash) { acc.unchanged++; continue; }        // no AI
    const mode = existing ? "updated" : "new";
    budget.left--;
    const res = await storeSummary(env, source, it, docKey, hash, mode);
    acc.ai += res.ai ? 1 : 0;
    if (!res.ok) { acc.errors++; await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: "summarize: " + (res.error || ""), ai_used: 1 }); continue; }
    acc[res.mode]++;
    if (res.item) acc.items.push(res.item);
  }
  await repo.addCrawlLog(env, { source_id: source.id, status: (acc.new || acc.updated) ? (acc.updated ? "updated" : "new") : "unchanged", detail: `new=${acc.new} updated=${acc.updated} unchanged=${acc.unchanged} err=${acc.errors}`, ai_used: acc.ai });
  return acc;
}

async function crawlHeadSource(env, source, budget) {
  const acc = { new: 0, updated: 0, unchanged: 0, errors: 0, ai: 0, items: [] };
  const page = source.guideline_page || source.homepage;
  if (!page) { await repo.addCrawlLog(env, { source_id: source.id, status: "skipped", detail: "no guideline_page" }); return acc; }
  const headers = { "User-Agent": UA };
  if (source.etag) headers["If-None-Match"] = source.etag;
  if (source.last_modified) headers["If-Modified-Since"] = source.last_modified;
  let r;
  try { r = await fetch(page, { headers, cf: { cacheTtl: 300 } }); }
  catch (e) { await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: String(e && e.message || e).slice(0, 200) }); acc.errors++; return acc; }

  const etag = r.headers.get("ETag") || "", lastMod = r.headers.get("Last-Modified") || "", len = r.headers.get("Content-Length") || "";
  // Fast path: server says unchanged, or headers match what we stored → STOP (no download, no AI).
  if (r.status === 304 || (source.etag && etag && source.etag === etag) || (source.content_length && len && source.content_length === len && source.last_modified === lastMod && (etag === source.etag))) {
    await repo.saveSourceCrawlState(env, source.id, { etag, last_modified: lastMod, content_length: len });
    acc.unchanged++;
    await repo.addCrawlLog(env, { source_id: source.id, status: "unchanged", detail: "metadata match (304/etag)" });
    return acc;
  }
  let html = ""; try { html = await r.text(); } catch (e) {}
  const text = clean(html).slice(0, 8000);
  const hash = await sha256hex(text);
  const docKey = page;
  const existing = await repo.getByDocKey(env, docKey);
  await repo.saveSourceCrawlState(env, source.id, { etag, last_modified: lastMod, content_length: len });
  if (existing && existing.content_hash === hash) {                                        // body identical → no AI
    acc.unchanged++;
    await repo.addCrawlLog(env, { source_id: source.id, status: "unchanged", detail: "content hash match" });
    return acc;
  }
  if (budget.left <= 0) { await repo.addCrawlLog(env, { source_id: source.id, status: "skipped", detail: "ai budget exhausted" }); return acc; }
  budget.left--;
  const item = { title: source.name + " — guideline page", url: page, desc: text, ts: Date.now() };
  const res = await storeSummary(env, source, item, docKey, hash, existing ? "updated" : "new");
  acc.ai += res.ai ? 1 : 0;
  if (!res.ok) { acc.errors++; await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: "summarize: " + (res.error || ""), ai_used: 1 }); return acc; }
  acc[res.mode]++;
  if (res.item) acc.items.push(res.item);
  await repo.addCrawlLog(env, { source_id: source.id, status: res.mode, detail: "head-detected change", ai_used: 1 });
  return acc;
}

// Literature-API source (Europe PMC): auto-discovers individual published guideline
// documents via source.query, then summarizes each abstract into a rich card.
async function crawlLitApiSource(env, source, budget) {
  const acc = { new: 0, updated: 0, unchanged: 0, errors: 0, ai: 0, items: [] };
  const query = source.query || source.rss_url;
  if (!query) { await repo.addCrawlLog(env, { source_id: source.id, status: "skipped", detail: "no query" }); return acc; }
  let results;
  try { results = await fetchLitApi(query, { limit: 12 }); }
  catch (e) { await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: String(e && e.message || e).slice(0, 200) }); acc.errors++; return acc; }

  const maxNew = Math.max(1, parseInt(env.UPDATES_MAX_NEW_PER_SOURCE, 10) || 8);
  for (const it of results) {
    if (acc.new + acc.updated >= maxNew) break;
    if (budget.left <= 0) break;
    const docKey = it.docKey;
    const hash = await sha256hex(it.title + "|" + it.abstract);
    const existing = await repo.getByDocKey(env, docKey);
    if (existing && existing.content_hash === hash) { acc.unchanged++; continue; }        // no AI
    const mode = existing ? "updated" : "new";
    budget.left--;
    const item = { title: it.title, url: it.url, desc: it.abstract, ts: it.ts, doi: it.doi, pmid: it.pmid };
    const res = await storeSummary(env, source, item, docKey, hash, mode);
    acc.ai += res.ai ? 1 : 0;
    if (!res.ok) { acc.errors++; await repo.addCrawlLog(env, { source_id: source.id, status: "error", detail: "summarize: " + (res.error || ""), ai_used: 1 }); continue; }
    acc[res.mode]++;
    if (res.item) acc.items.push(res.item);
  }
  await repo.addCrawlLog(env, { source_id: source.id, status: (acc.new || acc.updated) ? (acc.updated ? "updated" : "new") : "unchanged", detail: `new=${acc.new} updated=${acc.updated} unchanged=${acc.unchanged} err=${acc.errors} (litapi)`, ai_used: acc.ai });
  return acc;
}

function crawlFor(parser) { return parser === "litapi" ? crawlLitApiSource : (parser === "head" ? crawlHeadSource : crawlRssSource); }

// Entry point. Iterates enabled sources; bounds total AI calls per run. Returns a tally.
export async function runPipeline(env) {
  if (!repo.hasDb(env)) return { ok: false, error: "no-db" };
  const sources = await repo.listSources(env, true);
  const total = { new: 0, updated: 0, unchanged: 0, errors: 0, ai: 0, sources: sources.length, items: [] };
  const budget = { left: Math.max(1, parseInt(env.UPDATES_MAX_AI_PER_RUN, 10) || 20) };
  for (const s of sources) {
    const acc = await crawlFor(s.parser_type)(env, s, budget);
    total.new += acc.new; total.updated += acc.updated; total.unchanged += acc.unchanged; total.errors += acc.errors; total.ai += acc.ai;
    if (acc.items && acc.items.length) total.items = total.items.concat(acc.items);
  }
  await repo.pruneCrawlLogs(env, parseInt(env.UPDATES_CRAWL_LOG_KEEP, 10) || 500);
  total.ok = true;
  total.added = total.new + total.updated;   // back-compat with the old {added} response
  return total;
}
