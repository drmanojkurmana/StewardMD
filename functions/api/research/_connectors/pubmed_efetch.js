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
import { resolveNcbiApiKey } from "./pubmed.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const TOOL = "StewardMD_ResearchMD";
const BATCH = 200;
const KEYED_BUCKET = createBucket(10);
const ANON_BUCKET = createBucket(3);

export function selectBucket(opts = {}) {
  const apiKey = typeof opts === "string" ? String(opts).trim() : resolveNcbiApiKey(opts);
  return apiKey ? KEYED_BUCKET : ANON_BUCKET;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function tagList(block, re) {
  const out = [];
  const g = new RegExp(re.source, re.flags.indexOf("g") >= 0 ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(block)) !== null) {
    const text = stripTags(m[1]);
    if (text) out.push(text);
  }
  return out;
}
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function pad(n) { return String(n).padStart(2, "0"); }

/* One <PubmedArticle> block. abstract / publicationDate / venue stay as they
 * were. The extra fields feed the paper card: labelled sections, authors,
 * publication types, MeSH, keywords, PMCID, DOI. */
export function parseArticle(block) {
  const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
  const pmid = pmidMatch ? pmidMatch[1] : "";
  const parts = [];
  const sections = [];
  const absRe = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g;
  let m;
  while ((m = absRe.exec(block)) !== null) {
    const label = (m[1].match(/Label="([^"]*)"/) || [])[1];
    const text = stripTags(m[2]);
    if (!text) continue;
    parts.push(label ? label + ": " + text : text);
    const pretty = label ? label.charAt(0).toUpperCase() + label.slice(1).toLowerCase() : "";
    sections.push({ label: pretty, text });
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
  const venue = journal ? stripTags(journal[1]) : "";
  const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
  const authors = [];
  const authorRe = /<Author\b[^>]*>[\s\S]*?<\/Author>/g;
  while ((m = authorRe.exec(block)) !== null && authors.length < 30) {
    const open = (m[0].match(/^<Author\b[^>]*>/) || [""])[0];
    if (/ValidYN="N"/i.test(open)) continue;
    const chunk = m[0];
    const last = stripTags((chunk.match(/<LastName>([\s\S]*?)<\/LastName>/) || [])[1] || "");
    const initials = stripTags((chunk.match(/<Initials>([\s\S]*?)<\/Initials>/) || [])[1] || "");
    const collective = stripTags((chunk.match(/<CollectiveName>([\s\S]*?)<\/CollectiveName>/) || [])[1] || "");
    const name = last ? (initials ? last + " " + initials : last) : collective;
    if (name) authors.push(name);
  }
  const pmcMatch = block.match(/<ArticleId\b[^>]*\bIdType=["']pmc["'][^>]*>([^<]+)<\/ArticleId>/i);
  const doiMatch = block.match(/<ArticleId\b[^>]*\bIdType=["']doi["'][^>]*>([^<]+)<\/ArticleId>/i)
    || block.match(/<ELocationID\b[^>]*\bEIdType=["']doi["'][^>]*>([^<]+)<\/ELocationID>/i);
  const pmcid = pmcMatch ? String(pmcMatch[1]).replace(/\s+/g, "").toUpperCase() : "";
  const yearMatch = publicationDate.match(/^(\d{4})/);
  return {
    pmid, abstract: parts.join(" "), publicationDate, venue,
    title: titleMatch ? stripTags(titleMatch[1]) : "",
    authors, year: yearMatch ? Number(yearMatch[1]) : null, journal: venue, sections,
    publicationTypes: tagList(block, /<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/gi),
    mesh: tagList(block, /<DescriptorName\b[^>]*>([\s\S]*?)<\/DescriptorName>/gi),
    keywords: tagList(block, /<Keyword\b[^>]*>([\s\S]*?)<\/Keyword>/gi),
    pmcid: /^PMC\d+$/.test(pmcid) ? pmcid : "",
    doi: doiMatch ? String(doiMatch[1]).trim() : "",
  };
}

/* efetchAbstracts(ids, opts) -> Map pmid -> {abstract, publicationDate, venue}.
 * opts: contactEmail (required), apiKey, fetch/sleep/random/now/deadline/bucket
 * (injectable, same as the other connectors). */
export async function efetchAbstracts(ids, opts = {}) {
  const email = requireContactEmail(opts);
  const apiKey = resolveNcbiApiKey(opts);
  const transport = {
    fetchImpl: opts.fetch, sleep: opts.sleep, random: opts.random,
    now: opts.now || Date.now, deadline: opts.deadline === undefined ? Infinity : opts.deadline,
    timeoutMs: opts.timeoutMs === undefined ? 30000 : opts.timeoutMs,
    maxRetries: opts.maxRetries === undefined ? 5 : opts.maxRetries,
    signal: opts.signal || null,
    bucket: opts.bucket || selectBucket(apiKey),
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
