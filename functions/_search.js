/* StewardMD — web-search enrichment (TinyFish).
 *
 * Shared by the admin AI push box (manual publish) and the daily crawler pipeline, so both can turn
 * a thin headline or a bare drug/guideline name into rich, authoritative context (prescribing info,
 * indications, doses, official links) before the Gemini summarizer runs.
 *
 * Key is a Cloudflare secret (env.TINYFISH_API_KEY) — never hardcoded. Best-effort: no key, or any
 * network/parse error, returns [] and the caller proceeds without enrichment. Never throws.
 */
import { fetchWithTimeout } from "./_fetch.js";

/* TRUSTED MEDICAL DOMAINS ONLY (owner, 2026-09-04): "mk sure tinyfish uses trusted medical
 * resources". Every caller of this file is medical (Research on the web, the Medical-Updates
 * crawler, the admin publish box), so the restriction is applied here once rather than per caller.
 * TinyFish's `include_domains` param (comma-separated) hard-restricts results server-side — this is
 * an allow-list, not a ranking hint, so nothing outside it is ever returned as a "web result".
 * Health authorities, major journals, guideline bodies, and PubMed/PMC; no general news or forums. */
export const TRUSTED_MEDICAL_DOMAINS = [
  "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "nih.gov", "who.int", "cdc.gov", "fda.gov",
  "ema.europa.eu", "nice.org.uk", "cochranelibrary.com", "medlineplus.gov", "clinicaltrials.gov",
  "icmr.gov.in", "mohfw.gov.in",
  "mayoclinic.org", "uptodate.com", "medscape.com", "drugs.com",
  "nejm.org", "thelancet.com", "jamanetwork.com", "bmj.com", "ahajournals.org",
  "idsociety.org", "diabetes.org", "kidney.org", "cancer.gov", "heart.org"
];

export async function tinyfishSearch(env, query) {
  const key = env && env.TINYFISH_API_KEY;
  if (!key || !query) return [];
  try {
    const r = await fetchWithTimeout("https://api.search.tinyfish.ai?query=" + encodeURIComponent(String(query).slice(0, 300)) +
      "&include_domains=" + encodeURIComponent(TRUSTED_MEDICAL_DOMAINS.join(",")), {
      headers: { "X-API-Key": key },
      redirect: "follow",
    });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j && j.results) || []).slice(0, 8).map((x) => ({
      title: String(x.title || "").slice(0, 200),
      snippet: String(x.snippet || "").slice(0, 400),
      url: String(x.url || "").slice(0, 500),
      site: String(x.site_name || "").slice(0, 120),
    })).filter((x) => x.title || x.snippet);
  } catch (e) { return []; }
}
