/* StewardMD - Medical Updates: PubMed (NCBI E-utilities) fetcher for journal trials.
 *
 * A `pubmed` source's `query` column holds a PubMed query, e.g.
 *   ("N Engl J Med"[ta] OR "Lancet"[ta]) AND "Randomized Controlled Trial"[pt] NOT "Comment"[pt]
 * esearch (JSON) finds PMIDs published in the last `days` (reldate + datetype=pdat, newest first), efetch
 * (XML) returns titles, structured abstracts, DOIs and dates. Same output shape as _litapi.js fetchLitApi,
 * so the pipeline treats both alike, and the same doc_key scheme (doi: first, then pmid:), so a paper found
 * by both sources is one update.
 *
 * NCBI asks for tool + email on every call and at most 3 requests a second without a key (10 with
 * env.NCBI_API_KEY). A run makes 2 requests per source.
 * COPYRIGHT: abstracts are fetched transiently for summarising; only our summary + metadata + links are stored.
 */
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const UA = "StewardMD/1.0 (+https://stewardmd.in)";
const MIN_ABSTRACT = 300;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function decodeXml(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function text(s) { return decodeXml(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function first(block, re) { const m = block.match(re); return m ? m[1] : ""; }

function dateOf(block) {
  const pick = (inner) => {
    const y = parseInt(first(inner, /<Year>(\d{4})<\/Year>/), 10);
    if (!y) return 0;
    const mRaw = first(inner, /<Month>([^<]+)<\/Month>/);
    const m = MON[String(mRaw).slice(0, 3).toLowerCase()] || parseInt(mRaw, 10) || 1;
    const d = parseInt(first(inner, /<Day>(\d{1,2})<\/Day>/), 10) || 1;
    return Date.UTC(y, m - 1, d);
  };
  const art = first(block, /<ArticleDate[^>]*>([\s\S]*?)<\/ArticleDate>/);          // electronic publication
  if (art) { const t = pick(art); if (t) return t; }
  const pub = first(block, /<PubDate>([\s\S]*?)<\/PubDate>/);
  return pub ? pick(pub) : 0;
}

/** Parse an efetch XML payload into records. Exported for tests. */
export function parsePubmedXml(xml) {
  const out = [];
  const blocks = String(xml || "").split(/<PubmedArticle>/).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/PubmedArticle>/)[0];
    const pmid = first(block, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = text(first(block, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/));
    const parts = [];
    block.replace(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g, (_, attrs, body) => {
      const label = (attrs.match(/Label="([^"]+)"/) || [])[1];
      const t = text(body);
      if (t) parts.push(label ? label.charAt(0) + label.slice(1).toLowerCase() + ": " + t : t);
      return "";
    });
    const doi = text(first(block, /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/) || first(block, /<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/));
    const journal = text(first(block, /<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/) || first(block, /<Title>([^<]+)<\/Title>/));
    const pubTypes = [];
    block.replace(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/g, (_, t) => { pubTypes.push(text(t)); return ""; });
    out.push({ pmid, title, abstract: parts.join(" "), doi, journal, pubTypes, ts: dateOf(block) });
  }
  return out;
}

// NCBI: at most 3 requests a second without a key (10 with one). Space every call and retry a 429 once;
// three PubMed sources back to back drew a 429 in a live run on 2026-09-28 before this existed.
let _last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function ncbiFetch(url, init, env) {
  const gap = env && env.NCBI_API_KEY ? 110 : 360;
  const wait = _last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  _last = Date.now();
  let r = await fetch(url, init);
  if (r.status === 429) { await sleep(1100); _last = Date.now(); r = await fetch(url, init); }
  return r;
}

function params(env) {
  const p = "&tool=stewardmd&email=" + encodeURIComponent((env && env.NCBI_EMAIL) || "support@stewardmd.in");
  return (env && env.NCBI_API_KEY) ? p + "&api_key=" + encodeURIComponent(env.NCBI_API_KEY) : p;
}

/**
 * fetchPubMed(query, opts) -> [{ docKey, title, abstract, doi, pmid, url, ts, journal, pubTypes }]
 * opts: { days (default 7), limit (default 12, max 25), env }
 * Only records with a real abstract; newest first; excludes retracted publications and errata.
 */
export async function fetchPubMed(query, opts) {
  opts = opts || {};
  const days = Math.max(1, Math.min(60, opts.days || 7));
  const limit = Math.max(1, Math.min(25, opts.limit || 12));
  const q = "(" + query + ") NOT (\"Retracted Publication\"[pt] OR \"Published Erratum\"[pt])";
  const s = await ncbiFetch(EUTILS + "esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&datetype=pdat&reldate=" + days +
    "&retmax=" + limit + "&term=" + encodeURIComponent(q) + params(opts.env), { headers: { "User-Agent": UA, "Accept": "application/json" } }, opts.env);
  if (!s.ok) throw new Error("PubMed esearch HTTP " + s.status);
  const ids = (((await s.json()) || {}).esearchresult || {}).idlist || [];
  if (!ids.length) return [];
  const f = await ncbiFetch(EUTILS + "efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=" + ids.join(",") + params(opts.env),
    { headers: { "User-Agent": UA, "Accept": "application/xml" } }, opts.env);
  if (!f.ok) throw new Error("PubMed efetch HTTP " + f.status);
  const recs = parsePubmedXml(await f.text());
  const out = [];
  for (const r of recs) {
    if (!r.pmid || ids.indexOf(r.pmid) < 0 || !r.title || r.abstract.length < MIN_ABSTRACT) continue;   // only what we asked for
    const docKey = r.doi ? "doi:" + r.doi : "pmid:" + r.pmid;
    const url = r.doi ? "https://doi.org/" + r.doi : "https://pubmed.ncbi.nlm.nih.gov/" + r.pmid + "/";
    out.push({ docKey, title: r.title, abstract: r.abstract, doi: r.doi, pmid: r.pmid, url, ts: r.ts || Date.now(), journal: r.journal, pubTypes: r.pubTypes });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
