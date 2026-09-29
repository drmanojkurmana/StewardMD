/* StewardMD - CDSCO "new drugs approved" lists, for the India status of a Clinical Bulletin.
 *
 * CDSCO publishes one PDF per year (2020 to the current year) on its Approved New Drugs page. The daily
 * pipeline (runPipeline) refreshes them into D1 (cdsco_lists), reading each PDF with TinyFish Fetch (free) or,
 * failing that, Workers AI toMarkdown, at most
 * MAX_PER_RUN PDFs a run; the Review Desk looks a drug up in the stored text. The signer still CHOOSES the
 * India status: a match is shown as evidence (the list line and its approval date), and a miss is shown as
 * "not in these lists", which does not prove a drug is unapproved (older approvals and new strengths are
 * published elsewhere). Checked by hand on 2026-09-28: the page lists yearly PDFs through a download JSP
 * that answers with an iframe to the file; the 2025 PDF has numbered entries with dd.mm.yyyy dates.
 */
import { tinyfishFetch } from "./_search.js";

const PAGE = "https://cdsco.gov.in/opencms/opencms/en/Approval_new/Approved-New-Drugs/";
const ORIGIN = "https://cdsco.gov.in";
const UA = "Mozilla/5.0 (compatible; StewardMD/1.0; +https://stewardmd.in)";
const MAX_PER_RUN = 3, FIRST_YEAR = 2020, CURRENT_TTL = 7 * 86400000;

function clean(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }

/** Pure: yearly list rows from the page HTML -> [{ title, release, year, jsp }]. */
export function parseListPage(html) {
  const out = [];
  String(html || "").replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = []; row.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (__, c) => { cells.push(c); return ""; });
    if (cells.length < 4) return "";
    const title = clean(cells[1]), release = clean(cells[2]);
    const href = (cells[3].match(/href=['"]([^'"]+)['"]/i) || [])[1] || "";
    const year = parseInt((title.match(/\b(20\d\d)\b/) || [])[1], 10);
    if (!/new drugs approved/i.test(title) || !year || year < FIRST_YEAR || !href) return "";
    out.push({ title, release, year, jsp: href.indexOf("http") === 0 ? href : ORIGIN + href });
    return "";
  });
  return out.sort((a, b) => b.year - a.year);
}

/** Pure: the PDF address inside the download JSP's iframe. */
export function iframePdf(html) {
  const src = (String(html || "").match(/<iframe[^>]+src=['"]([^'"]+\.pdf)['"]/i) || [])[1];
  return src ? (src.indexOf("http") === 0 ? src : ORIGIN + src).replace(/ /g, "%20") : "";
}

function dateKey(s) { const m = String(s).match(/\b\d{2}[./-]\d{2}[./-]20\d\d\b/); return m ? m[0] : ""; }
function norm(s) { return " " + String(s || "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ") + " "; }

/** Pure: find a drug in one list's text -> [{ date, excerpt }]. Terms: generic names; combinations split. */
export function findInList(text, query) {
  const terms = String(query || "").toLowerCase().split(/\s*(?:,|\/|\+|\band\b|\bwith\b)\s*/).map((t) => t.replace(/[^a-z0-9 -]/g, "").trim()).filter((t) => t.length >= 4);
  if (!terms.length) return [];
  const flat = String(text || "").replace(/\s+/g, " ");
  const low = flat.toLowerCase(), hits = [];
  for (const t of terms) {
    const re = new RegExp("(^|[^a-z0-9])" + t.replace(/[-\s]+/g, "[-\\s]+") + "(?![a-z0-9])", "g");
    let m;
    while ((m = re.exec(low)) && hits.length < 5) {
      const at = m.index + m[1].length;
      // Start at this entry's serial number ("7. Rimegepant ...") when it is close before the match.
      const from = Math.max(0, at - 120), back = flat.slice(from, at);
      const serial = back.match(/^[\s\S]*(?:^|\s)(\d{1,3}\.\s)/);
      const start = serial ? from + serial[0].length - serial[1].length : Math.max(0, at - 60);
      const after = flat.slice(at, at + 700);
      const date = (after.match(/\b(\d{2})[./-](\d{2})[./-](20\d\d)\b/) || []);
      const prev = hits[hits.length - 1];
      if (prev && prev.term === t && (prev._start === start || (dateKey(after) && prev._date === dateKey(after)))) continue;   // same entry again
      hits.push({ _start: start, _date: dateKey(after), term: t, date: date[0] ? date[3] + "-" + date[2] + "-" + date[1] : "", excerpt: (start > 0 ? "..." : "") + flat.slice(start, at + 180).trim() + "..." });
    }
  }
  return hits.map((h) => ({ term: h.term, date: h.date, excerpt: h.excerpt }));
}

/* ---------------- storage + refresh (D1 table created by _bulletins_schema.js) ---------------- */

export async function listStored(env) {
  const rs = await env.UPDATES_DB.prepare("SELECT url, title, release, year, fetched_ts, length(text) AS n FROM cdsco_lists ORDER BY year DESC").all();
  return rs.results || [];
}

export async function lookup(env, query) {
  const rs = await env.UPDATES_DB.prepare("SELECT title, release, year, fetched_ts, text FROM cdsco_lists ORDER BY year DESC").all();
  const lists = rs.results || [], matches = [];
  for (const l of lists) for (const h of findInList(l.text, query)) matches.push({ list: l.title, year: l.year, date: h.date, term: h.term, excerpt: h.excerpt });
  return { checked: lists.map((l) => ({ title: l.title, year: l.year, release: l.release, fetched_ts: l.fetched_ts })), matches: matches.slice(0, 8) };
}

// PDF -> text. TinyFish Fetch first (free, reads PDFs, no Workers AI); Workers AI toMarkdown as the fallback.
async function pdfText(env, url) {
  if (env.TINYFISH_API_KEY) {
    const f = await tinyfishFetch(env, [url], { perUrlTimeoutMs: 100000 });
    const t = f.results[0] && f.results[0].text;
    if (t && t.length > 50) return String(t).replace(/[ \t]+/g, " ").slice(0, 400000);
  }
  if (!env.AI || typeof env.AI.toMarkdown !== "function") throw new Error("cdsco pdf: tinyfish failed and no Workers AI");
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("cdsco pdf HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const res = await env.AI.toMarkdown({ name: "cdsco.pdf", blob: new Blob([buf], { type: "application/pdf" }) });
  const conv = Array.isArray(res) ? res[0] : res;
  if (!conv || conv.format !== "markdown" || !conv.data) throw new Error("cdsco pdf convert failed");
  return String(conv.data).replace(/[ \t]+/g, " ").slice(0, 400000);
}

/** Refresh stale or missing yearly lists. Best-effort; returns a tally. Needs TinyFish (TINYFISH_API_KEY) or Workers AI. */
export async function refreshCdscoLists(env, opts) {
  opts = opts || {};
  const canRead = env && (env.TINYFISH_API_KEY || (env.AI && typeof env.AI.toMarkdown === "function"));
  if (!env || !env.UPDATES_DB || !canRead) return { ok: false, reason: "no-ai-or-db" };
  const now = opts.now || Date.now();
  const page = await fetch(PAGE, { headers: { "User-Agent": UA } });
  if (!page.ok) return { ok: false, reason: "page-" + page.status };
  const rows = parseListPage(await page.text());
  const stored = {};
  for (const s of await listStored(env)) stored[s.year] = s;
  const thisYear = new Date(now).getUTCFullYear();
  let fetched = 0;
  const errors = [];
  for (const row of rows) {
    if (fetched >= MAX_PER_RUN) break;
    const have = stored[row.year];
    const stale = !have || have.release !== row.release || (row.year >= thisYear - 1 && now - have.fetched_ts > CURRENT_TTL);
    if (!stale) continue;
    try {
      const jsp = await fetch(row.jsp, { headers: { "User-Agent": UA, "Referer": PAGE } });
      const pdf = iframePdf(await jsp.text());
      if (!pdf) throw new Error("no pdf link");
      const text = await pdfText(env, pdf);
      await env.UPDATES_DB.prepare(
        "INSERT INTO cdsco_lists (url, title, release, year, fetched_ts, text) VALUES (?,?,?,?,?,?) " +
        "ON CONFLICT(year) DO UPDATE SET url=excluded.url, title=excluded.title, release=excluded.release, fetched_ts=excluded.fetched_ts, text=excluded.text"
      ).bind(pdf, row.title, row.release, row.year, now, text).run();
      fetched++;
    } catch (e) { errors.push(row.year + ": " + String((e && e.message) || e).slice(0, 80)); }
  }
  return { ok: true, lists: rows.length, fetched, errors };
}
