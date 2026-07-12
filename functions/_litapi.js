/* StewardMD — Medical Updates: literature-API fetcher (Europe PMC).
 *
 * Auto-discovers individual published guideline DOCUMENTS (not PDF/JS hub pages) so
 * the pipeline can summarize real content. Europe PMC is a single public JSON REST
 * endpoint (no key) that returns titles, ABSTRACTS, DOIs, PMIDs and dates, with a
 * publication-type filter — ideal for a Worker (no PDF parsing, no headless render).
 *
 * A `litapi` source's `query` column holds a Europe PMC query string, e.g.:
 *   (AUTH:"KDIGO" OR TITLE:"KDIGO") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")
 *
 * COPYRIGHT: only transient abstract text is fetched for summarization; nothing is
 * stored except our own original summary + metadata + the official DOI/PMID links.
 */
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const UA = "StewardMD/1.0 (+https://stewardmd.in)";
const MIN_ABSTRACT = 300;   // need real text to produce a useful summary

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function titleKey(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60); }

/**
 * fetchLitApi(query, opts) → [{ docKey, title, abstract, doi, pmid, url, ts, journal }]
 * Filters to results that have a real abstract; dedups the same guideline republished
 * across journals by normalized title; newest first.
 */
export async function fetchLitApi(query, opts) {
  opts = opts || {};
  const limit = Math.max(1, Math.min(25, opts.limit || 10));
  const url = EPMC + "?query=" + encodeURIComponent(query) +
    "&format=json&resultType=core&pageSize=" + limit + "&sort=" + encodeURIComponent("P_PDATE_D desc");
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error("EuropePMC HTTP " + r.status);
  const j = await r.json();
  const results = (j.resultList && j.resultList.result) || [];
  const out = [], seen = new Set();
  for (const x of results) {
    const abstract = stripTags(x.abstractText);
    if (abstract.length < MIN_ABSTRACT) continue;                 // skip abstract-less statements
    const title = stripTags(x.title);
    const key = titleKey(title);
    if (!title || seen.has(key)) continue;                        // dedup same doc across journals
    seen.add(key);
    const doi = (x.doi || "").trim();
    const pmid = (x.pmid || "").trim();
    const docKey = doi ? "doi:" + doi : (pmid ? "pmid:" + pmid : "epmc:" + x.source + ":" + x.id);
    const officialUrl = doi ? "https://doi.org/" + doi
      : (pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/"
        : "https://europepmc.org/article/" + (x.source || "MED") + "/" + x.id);
    let ts = Date.now();
    if (x.firstPublicationDate) { const t = Date.parse(x.firstPublicationDate); if (t) ts = t; }
    else if (x.pubYear) { const t = Date.parse(x.pubYear + "-01-01"); if (t) ts = t; }
    out.push({ docKey, title, abstract, doi, pmid, url: officialUrl, ts, journal: stripTags(x.journalTitle) });
  }
  return out;
}
