/* ResearchMD Phase 3 PubMed efetch abstracts (ES module).
 * The Phase 2.3 connector uses esummary, which carries NO abstract (SEAMS.md
 * seam 2: upstream drops papers without one). The internal literature-search
 * endpoint needs abstracts, so it fetches them here with efetch rettype=abstract
 * retmode=xml, batched (rule 19: never single-record calls). Same terms as
 * pubmed.js: tool + email on every request, api_key when configured, the
 * shared rate bucket and retry policy.
 *
 * Parsing is deterministic regex over the controlled E-utilities XML shape:
 * no DOM parser, no external entity resolution, no network fetches from
 * within the document (threat-model.md untrusted-input rules).
 */
import { ConnectorError, createBucket, fetchWithRetry, requireContactEmail } from "./_http.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const TOOL = "StewardMD_ResearchMD";
const BATCH = 200;
const KEYED_BUCKET = createBucket(10);
const ANON_BUCKET = createBucket(3);

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function pad(n) { return String(n).padStart(2, "0"); }

/* One <PubmedArticle> block -> { pmid, abstract, publicationDate, venue }. */
export function parseArticle(block) {
  const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
  const pmid = pmidMatch ? pmidMatch[1] : "";
  const parts = [];
  const absRe = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g;
  let m;
  while ((m = absRe.exec(block)) !== null) {
    const label = (m[1].match(/Label="([^"]*)"/) || [])[1];
    const text = stripTags(m[2]);
    if (text) parts.push(label ? label + ": " + text : text);
  }
  let publicationDate = "";
  const ad = block.match(/<ArticleDate[^>]*>\s*<Year>(\d{4})<\/Year>\s*<Month>(\d{1,2})<\/Month>\s*<Day>(\d{1,2})<\/Day>/);
  if (ad) publicationDate = ad[1] + "-" + pad(ad[2]) + "-" + pad(ad[3]);
  else {
    const pd = block.match(/<PubDate>\s*<Year>(\d{4})<\/Year>(?:\s*<Month>([^<]*)<\/Month>)?(?:\s*<Day>(\d{1,2})<\/Day>)?/);
    if (pd) {
      const month = MONTHS[String(pd[2] || "").slice(0, 3)] || (/^\d{1,2}$/.test(pd[2] || "") ? pad(pd[2]) : "");
      publicationDate = pd[1] + (month ? "-" + month + (pd[3] ? "-" + pad(pd[3]) : "") : "");
    }
  }
  const journal = block.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/);
  return { pmid, abstract: parts.join(" "), publicationDate, venue: journal ? stripTags(journal[1]) : "" };
}

/* efetchAbstracts(ids, opts) -> Map pmid -> {abstract, publicationDate, venue}.
 * opts: contactEmail (required), apiKey, fetch/sleep/random/now/deadline/bucket
 * (injectable, same as the other connectors). */
export async function efetchAbstracts(ids, opts = {}) {
  const email = requireContactEmail(opts);
  const apiKey = String(opts.apiKey || "").trim();
  const transport = {
    fetchImpl: opts.fetch, sleep: opts.sleep, random: opts.random,
    now: opts.now || Date.now, deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    bucket: opts.bucket || (apiKey ? KEYED_BUCKET : ANON_BUCKET),
  };
  const out = new Map();
  const list = (ids || []).map(String).filter((id) => /^\d+$/.test(id));
  for (let i = 0; i < list.length; i += BATCH) {
    const p = new URLSearchParams();
    p.set("tool", TOOL);
    p.set("email", email);
    if (apiKey) p.set("api_key", apiKey);
    p.set("db", "pubmed");
    p.set("id", list.slice(i, i + BATCH).join(","));
    p.set("rettype", "abstract");
    p.set("retmode", "xml");
    const res = await fetchWithRetry(BASE + "efetch.fcgi?" + p.toString(), transport);
    const xml = await res.text();
    const blocks = xml.split("<PubmedArticle>");
    for (let b = 1; b < blocks.length; b++) {
      const art = parseArticle(blocks[b]);
      if (art.pmid) out.set(art.pmid, art);
    }
  }
  return out;
}

/* Re-exported so the gateway can map connector failures uniformly. */
export { ConnectorError };
