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
  // Health authorities, regulators, libraries
  "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "nih.gov", "who.int", "cdc.gov", "fda.gov",
  "ema.europa.eu", "nice.org.uk", "sign.ac.uk", "cochranelibrary.com", "medlineplus.gov", "clinicaltrials.gov",
  "icmr.gov.in", "mohfw.gov.in",
  // Reference works and teaching sites clinicians already use
  "mayoclinic.org", "uptodate.com", "medscape.com", "drugs.com", "msdmanuals.com", "radiopaedia.org",
  "litfl.com", "aafp.org", "acponline.org",
  // Journals
  "nejm.org", "thelancet.com", "jamanetwork.com", "bmj.com", "ahajournals.org", "ashpublications.org",
  // Specialty societies and guideline bodies (owner, 2026-09-18: "images from ALL trusted sources",
  // a melena question should surface AASLD / ACG / AGA figures). Guideline publishers by specialty:
  // GI and hepatology
  "aasld.org", "gastro.org", "gi.org", "asge.org", "esge.com", "bsg.org.uk", "easl.eu", "worldgastroenterology.org",
  // Cardiology and stroke
  "acc.org", "escardio.org", "heart.org", "stroke.org", "hrsonline.org",
  // Respiratory, critical care, emergency, resuscitation
  "thoracic.org", "chestnet.org", "ersnet.org", "brit-thoracic.org.uk", "goldcopd.org", "ginasthma.org",
  "sccm.org", "esicm.org", "acep.org", "resus.org.uk", "cprguidelines.eu", "ilcor.org",
  // Infectious disease, endocrine, renal
  "idsociety.org", "escmid.org", "diabetes.org", "endocrine.org", "easd.org", "kidney.org", "kdigo.org", "asn-online.org",
  // Oncology and haematology
  "cancer.gov", "cancer.org", "asco.org", "esmo.org", "nccn.org", "hematology.org",
  // Neurology, rheumatology, obstetrics, paediatrics
  "aan.com", "rheumatology.org", "eular.org", "acog.org", "rcog.org.uk", "aap.org", "publications.aap.org",
  // Surgery, urology, dermatology, radiology, ENT, ophthalmology, psychiatry, anaesthesia
  "facs.org", "sages.org", "auanet.org", "uroweb.org", "aad.org", "rsna.org", "acr.org",
  "entnet.org", "aao.org", "psychiatry.org", "asahq.org"
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
