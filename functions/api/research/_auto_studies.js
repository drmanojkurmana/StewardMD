/* ResearchMD find-and-add studies (ES module, server side).
 * Contract: docs/research/contracts/phase-5/auto-studies.md.
 *
 * Routes (Firebase claims + project role, hooked in [[path]].js):
 *   POST /v1/projects/{pid}/find-studies
 *     body { q, limit? }  limit defaults to 20, max 50
 *     200 { results: [{ pmid, doi, title, authors, year, journal,
 *            abstract, freeFullText, source }] }
 *     Read role (owner, editor, analyst, reviewer, viewer). No AI, no charge.
 *   POST /v1/projects/{pid}/studies/auto-add
 *     body { items: [{ pmid?, doi? }], outcome, measure? }
 *     measure is RR, OR, HR, MD or SMD. Default is protocol content.measure
 *     or content.outcomes.measure when that is one of those five, else RR.
 *     200 { results: [{ status, study, fields, quote, location, method, message? }] }
 *     status is "filled", "needs_pdf" or "failed".
 *     method is "cache", "parser", "ai" or "" .
 *     study is the research_studies shape (verified false) or null.
 *     fields is { events1, total1, events2, total2 } or
 *     { estimate, ciLower, ciUpper } or null.
 *     Write role (owner, editor, analyst). A 402 or 422 from the AI step
 *     aborts the request. Other AI failures mark that item failed.
 *
 * Cache key (shared across users, research_paper_numbers):
 *   sha256( pmid + "||" + doi + "|" + normalisedOutcome + "|" + measure )
 *   doi is the normalised DOI (lowercase, no resolver prefix). pmid is digits
 *   or "". normalisedOutcome is lowercase, punctuation collapsed to spaces.
 *
 * Search is capped at `limit` records per source. pubmed.search and
 * europepmc.search archive every hit, so this route does one esearch
 * (retmax=limit) and one Europe PMC page, then reuses fetchRecords,
 * normalise, efetchAbstracts and dedupRecords.
 *
 * No DOCX and no new provider client. Full text is fetched only from the
 * fixed Europe PMC host when the PMC id matches PMC plus digits and the
 * record is open access (and not NC or ND when a licence is present).
 */
import * as pubmed from "./_connectors/pubmed.js";
import * as europepmc from "./_connectors/europepmc.js";
import { efetchAbstracts } from "./_connectors/pubmed_efetch.js";
import { fetchWithRetry, readJson, politeUserAgent, requireContactEmail, createBucket, ConnectorError } from "./_connectors/_http.js";
import { dedupRecords, normaliseDoi, firstAuthorKey } from "./_dedup.js";
import { runUserAi, extractJson } from "./_suggest.js";

const READ_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const WRITE_ROLES = ["owner", "editor", "analyst"];
const MEASURES = ["RR", "OR", "HR", "MD", "SMD"];
const COUNT_MEASURES = { RR: 1, OR: 1 };
const KEPT_CAP = 6000;
const ABSTRACT_CAP = 1200;
const AI_MAX_OUT = 300;
const TOKENS_MESSAGE = "You need more MaiK tokens";
const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EPMC_SEARCH = "https://www.europepmc.org/webservices/rest/search";
const EPMC_XML = "https://www.ebi.ac.uk/europepmc/webservices/rest/";
const TOOL = "StewardMD_ResearchMD";
const BUCKET = createBucket(8);

const MEASURE_WORDS = {
  RR: ["risk ratio", "rr"],
  OR: ["odds ratio", "or"],
  HR: ["hazard ratio", "hr"],
  MD: ["mean difference", "md"],
  SMD: ["standardised mean difference", "standardized mean difference", "smd"],
  RD: ["risk difference", "rd"],
};
const FINDING_MEASURES = ["RR", "OR", "HR", "MD", "SMD", "RD"];
const STOP = new Set(["with", "from", "that", "this", "were", "have", "been", "into", "over", "under", "than", "then", "them", "they", "their", "about", "after", "before", "between", "among", "using", "used", "study", "trial", "patients", "patient"]);

function configOf(env) {
  return {
    contactEmail: env.RESEARCH_CONTACT_EMAIL,
    apiKey: env.RESEARCH_NCBI_API_KEY,
    deadline: Date.now() + 60000,
    bucket: BUCKET,
  };
}
function transport(config, headers) {
  return {
    headers: headers || {},
    deadline: config.deadline,
    bucket: config.bucket,
  };
}
function capAbstract(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > ABSTRACT_CAP ? t.slice(0, ABSTRACT_CAP) : t;
}
function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
function resultListOf(body) {
  const rl = body && body.resultList;
  if (Array.isArray(rl)) return rl;
  if (rl && Array.isArray(rl.result)) return rl.result;
  return [];
}
function pubmedFree(raw) {
  const ids = raw && Array.isArray(raw.articleids) ? raw.articleids : [];
  return ids.some((a) => a && (a.idtype === "pmc" || a.idtype === "pmcid"));
}
function epmcFree(raw) {
  return String(raw && raw.isOpenAccess || "").toUpperCase() === "Y" || raw && raw.isOpenAccess === true;
}
function epmcJournal(raw) {
  if (!raw) return "";
  if (raw.journalTitle) return String(raw.journalTitle);
  const info = raw.journalInfo && raw.journalInfo.journal;
  return info && info.title ? String(info.title) : "";
}
function pubmedResult(rec, raw, abstracts) {
  const art = abstracts.get(rec.externalId) || {};
  const doi = normaliseDoi(rec.doi) || String(rec.doi || "");
  return {
    id: "pm_" + rec.externalId,
    source: "pubmed",
    pmid: rec.externalId,
    doi,
    title: rec.title || "",
    authors: rec.authors || [],
    year: rec.year,
    journal: String((raw && (raw.fulljournalname || raw.source)) || art.venue || ""),
    abstract: capAbstract(art.abstract || ""),
    freeFullText: pubmedFree(raw),
    createdTs: 0,
  };
}
function epmcResult(rec, raw) {
  return {
    id: "ep_" + rec.externalId,
    source: "europe_pmc",
    pmid: String((raw && raw.pmid) || ""),
    doi: normaliseDoi(rec.doi) || "",
    title: rec.title || "",
    authors: rec.authors || [],
    year: rec.year,
    journal: epmcJournal(raw),
    abstract: capAbstract(stripTags(raw && raw.abstractText)),
    freeFullText: !!epmcFree(raw),
    createdTs: 1,
  };
}
function publicResult(r) {
  return {
    pmid: r.pmid || "",
    doi: r.doi || "",
    title: r.title || "",
    authors: Array.isArray(r.authors) ? r.authors.slice(0, 30) : [],
    year: r.year == null ? null : r.year,
    journal: r.journal || "",
    abstract: r.abstract || "",
    freeFullText: !!r.freeFullText,
    source: r.source,
  };
}
function mergeDedup(records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const { groups } = dedupRecords(records.map((r) => ({
    id: r.id, source: r.source === "europe_pmc" ? "europe_pmc" : "pubmed",
    externalId: r.pmid || r.id, title: r.title, authors: r.authors, year: r.year,
    doi: r.doi, pmid: r.pmid, createdTs: r.createdTs,
  })));
  const grouped = new Set();
  const out = [];
  for (const g of groups) {
    for (const id of g.memberIds) grouped.add(id);
    const canon = byId.get(g.canonicalRecordId);
    const merged = Object.assign({}, canon);
    for (const id of g.memberIds) {
      const m = byId.get(id);
      if (!m) continue;
      if (!merged.abstract && m.abstract) merged.abstract = m.abstract;
      if (!merged.freeFullText && m.freeFullText) merged.freeFullText = true;
      if (!merged.doi && m.doi) merged.doi = m.doi;
      if (!merged.pmid && m.pmid) merged.pmid = m.pmid;
      if (!merged.journal && m.journal) merged.journal = m.journal;
      if (!merged.title && m.title) merged.title = m.title;
    }
    out.push(merged);
  }
  for (const r of records) if (!grouped.has(r.id)) out.push(r);
  return out;
}

async function pubmedLimited(query, limit, config) {
  const p = new URLSearchParams();
  p.set("tool", TOOL);
  p.set("email", config.contactEmail);
  if (config.apiKey) p.set("api_key", config.apiKey);
  p.set("db", "pubmed");
  p.set("term", query);
  p.set("retmax", String(limit));
  p.set("retmode", "json");
  p.set("sort", "relevance");
  const head = await readJson(await fetchWithRetry(ESEARCH + "?" + p.toString(), transport(config)));
  const ids = (((head || {}).esearchresult || {}).idlist || []).map(String).filter((id) => /^\d+$/.test(id)).slice(0, limit);
  if (!ids.length) return [];
  const raws = await pubmed.fetchRecords(ids, config);
  let abstracts = new Map();
  try { abstracts = await efetchAbstracts(ids, config); } catch (e) { abstracts = new Map(); }
  const out = [];
  for (const raw of raws) {
    try { out.push(pubmedResult(pubmed.normalise(raw), raw, abstracts)); } catch (e) { /* skip a bad record */ }
  }
  return out;
}
async function epmcLimited(query, limit, config) {
  const email = requireContactEmail(config);
  const p = new URLSearchParams();
  p.set("query", query);
  p.set("resultType", "core");
  p.set("format", "json");
  p.set("pageSize", String(Math.min(limit, 1000)));
  p.set("cursorMark", "*");
  const body = await readJson(await fetchWithRetry(EPMC_SEARCH + "?" + p.toString(), transport(config, {
    "User-Agent": politeUserAgent(email), "Accept": "application/json",
  })));
  const out = [];
  for (const raw of resultListOf(body).slice(0, limit)) {
    try { out.push(epmcResult(europepmc.normalise(raw), raw)); } catch (e) { /* skip */ }
  }
  return out;
}

export async function findStudies(ctx, projectId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "Finding studies needs a project role", requestId);
  const q = body && typeof body.q === "string" ? body.q.trim() : "";
  if (!q || q.length > 4000) return err(400, "invalid_body", "q must be 1-4000 characters", requestId);
  let limit = body && body.limit === undefined ? 20 : body.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return err(400, "invalid_body", "limit must be an integer from 1 to 50", requestId);
  if (!env.RESEARCH_CONTACT_EMAIL)
    return err(503, "search_unconfigured", "Research database contact is not configured", requestId);
  const config = configOf(env);
  const settled = await Promise.allSettled([
    pubmedLimited(q, limit, config),
    epmcLimited(q, limit, config),
  ]);
  const records = [];
  let failures = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") records.push(...s.value);
    else failures++;
  }
  if (failures === settled.length)
    return err(502, "search_failed", "The literature databases could not be searched. Try again.", requestId);
  const merged = mergeDedup(records).slice(0, limit);
  return json({ results: merged.map(publicResult) }, 200, { "x-request-id": requestId });
}

/* ---- auto-add ----------------------------------------------------------- */

function normOutcome(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function outcomeWords(outcome) {
  return normOutcome(outcome).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
}
function sentenceMatches(sentence, words) {
  if (!words.length) return true;
  const s = sentence.toLowerCase();
  return words.some((w) => s.indexOf(w) >= 0);
}
function sentencesOf(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
function numberPresent(quote, n) {
  /* 0.80 in the sentence and 0.8 in the row are the same number. A dot is part
   * of the number only when a digit follows it, so a sentence-ending period
   * does not hide 90 or 2371. Boundaries still stop 237 matching inside 2373,
   * and 49 matching inside 0.49. */
  const target = Number(n);
  if (!Number.isFinite(target)) return false;
  /* a leading minus (hyphen or unicode minus) belongs to the number, so -0.52 and 0.52 differ */
  const re = /(?<![0-9.])([-\u2212]?)(\d+(?:\.\d+)?)(?![0-9])(?!\.\d)/g;
  const text = String(quote || "");
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[2]);
    const signed = m[1] && !isRangeHyphen(text, m.index) ? -v : v;
    if (signed === target) return true;
  }
  return false;
}
/* "0.70-0.91": that hyphen is a range, not a sign on 0.91 */
function isRangeHyphen(text, i) {
  return i > 0 && /[0-9]/.test(text.charAt(i - 1));
}
function rowNumbers(row) {
  if (!row) return [];
  if (row.format === "counts") return [row.events1, row.total1, row.events2, row.total2];
  return [row.estimate, row.ciLower, row.ciUpper];
}
function numbersInQuote(row, quote) {
  return rowNumbers(row).every((n) => numberPresent(quote, n));
}
function asInt(n) {
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}
function asFin(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function parseCounts(sentence) {
  const slash = sentence.match(/(\d+)\s*\/\s*(\d+)\s*(?:\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*(?:vs\.?|versus|compared with|compared to)\s*(\d+)\s*\/\s*(\d+)/i);
  const of = sentence.match(/(\d+)\s+of\s+(\d+)\b[^.!?]{0,80}?\b(?:versus|vs\.?|compared with|compared to)\s+(\d+)\s+of\s+(\d+)/i);
  const m = slash || of;
  if (!m) return null;
  const events1 = Number(m[1]), total1 = Number(m[2]), events2 = Number(m[3]), total2 = Number(m[4]);
  if (![events1, total1, events2, total2].every((n) => Number.isInteger(n))) return null;
  if (total1 < 1 || total2 < 1 || events1 < 0 || events2 < 0) return null;
  if (events1 > total1 || events2 > total2) return null;
  return { format: "counts", events1, total1, events2, total2 };
}
/* Long names match any case; abbreviations only in capitals, so the English
 * word "or" is never read as an odds ratio. */
const MEASURE_ABBR = { RR: ["RR", "RRR"], OR: ["OR", "aOR"], HR: ["HR", "aHR"], MD: ["MD", "WMD"], SMD: ["SMD"], RD: ["RD", "ARD"] };
const MEASURE_NAMES = {
  RR: ["risk ratio", "relative risk", "rate ratio"],
  OR: ["odds ratio"],
  HR: ["hazard ratio"],
  MD: ["mean difference", "difference in means"],
  SMD: ["standardised mean difference", "standardized mean difference"],
  RD: ["risk difference", "absolute risk difference"],
};
const NUM = "([-+]?\\d+(?:\\.\\d+)?)\\s*%?";
/* label, up to 14 words or marks of filler (words may hold digits, as HbA1c) ("in HbA1c was", ", 0.74; 95% confidence interval [CI],"), estimate,
 * then the 95% CI in any common journal style, then the two limits. */
const TAIL = "(?:[A-Za-z][A-Za-z0-9]*|[^\\dA-Za-z+\\-]){0,14}?" + NUM +
  "\\s*[,;:(\\[]?\\s*(?:95\\s*%\\s*)?(?:confidence\\s+interval|CI)?\\s*(?:\\[CI\\]|\\(CI\\))?\\s*[,:;]?\\s*" +
  NUM + "\\s*(?:to|-|,|;)\\s*" + NUM;
function estimateRegexes(measure) {
  const out = [];
  const names = MEASURE_NAMES[measure] || [];
  const abbr = MEASURE_ABBR[measure] || [];
  if (names.length) out.push(new RegExp("\\b(?:" + names.join("|") + ")\\b(?:\\s*[\\[(][A-Za-z]{2,4}[\\])])?" + TAIL, "i"));
  if (abbr.length) out.push(new RegExp("\\b(?:" + abbr.join("|") + ")\\b" + TAIL));
  return out;
}
function normaliseDashes(sentence) {
  /* unicode minus is a sign; en and em dashes and the non-breaking hyphen are range separators */
  return String(sentence || "").replace(/\u2212/g, "-").replace(/\s*[\u2013\u2014\u2011]\s*/g, " to ");
}
function parseEstimate(sentence, measure) {
  const text = normaliseDashes(sentence);
  for (const re of estimateRegexes(measure)) {
    const m = text.match(re);
    if (!m) continue;
    const estimate = Number(m[1]), ciLower = Number(m[2]), ciUpper = Number(m[3]);
    if (![estimate, ciLower, ciUpper].every((n) => Number.isFinite(n))) continue;
    if (!(ciLower < estimate && estimate < ciUpper)) continue;
    if ((measure === "RR" || measure === "OR" || measure === "HR") && !(estimate > 0 && ciLower > 0 && ciUpper > 0)) continue;
    return { format: "estimate", estimate, ciLower, ciUpper };
  }
  return null;
}
export function parseText(text, measure, words, location) {
  for (const sentence of sentencesOf(text)) {
    if (!sentenceMatches(sentence, words)) continue;
    let row = null;
    if (COUNT_MEASURES[measure]) row = parseCounts(sentence);
    if (!row) row = parseEstimate(sentence, measure);
    if (!row) continue;
    const quote = sentence.slice(0, 2000);
    if (!numbersInQuote(row, quote)) continue;
    return Object.assign({ quote, location: location || "abstract", confidence: 1, measure }, row);
  }
  return null;
}

/* p next to an estimate, kept as the comparison the abstract printed ("<0.001"). */
function pValue(sentence) {
  const m = String(sentence || "").match(/\bp\s*([<=>])\s*(\d*\.\d+|\d+)/i);
  return m ? m[1] + m[2] : "";
}

/* Every counts row and estimate-with-CI that parseCounts / parseEstimate can
 * read, in sentence order, at most 5. The paper card calls this. Auto-add
 * still uses parseText, which returns one row for one measure. */
export function parseFindings(text) {
  const out = [];
  const seen = new Set();
  for (const sentence of sentencesOf(text)) {
    const quote = sentence.slice(0, 2000);
    const counts = parseCounts(sentence);
    if (counts && numbersInQuote(counts, quote)) {
      const key = "c:" + counts.events1 + ":" + counts.total1 + ":" + counts.events2 + ":" + counts.total2;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          format: "counts", events1: counts.events1, total1: counts.total1,
          events2: counts.events2, total2: counts.total2, quote,
        });
        if (out.length >= 5) return out;
      }
    }
    for (let i = 0; i < FINDING_MEASURES.length; i++) {
      const measure = FINDING_MEASURES[i];
      const est = parseEstimate(sentence, measure);
      if (!est || !numbersInQuote(est, quote)) continue;
      const key = measure + ":" + est.estimate + ":" + est.ciLower + ":" + est.ciUpper;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = {
        measure, format: "estimate", estimate: est.estimate,
        ciLower: est.ciLower, ciUpper: est.ciUpper, quote,
      };
      const p = pValue(sentence);
      if (p) row.p = p;
      out.push(row);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function emptyItem(status, message) {
  return { status, study: null, fields: null, quote: "", location: "", method: "", message: message || "" };
}
function needsPdf() {
  return emptyItem("needs_pdf", "The abstract did not contain a complete result. Upload the PDF (the full paper) so the numbers can be read from a table.");
}
function failedItem(message) {
  return emptyItem("failed", message || "This record could not be read. Check the PMID (PubMed identifier) or DOI (digital object identifier).");
}
function fieldsOf(row) {
  if (!row) return null;
  if (row.format === "counts")
    return { events1: row.events1, total1: row.total1, events2: row.events2, total2: row.total2 };
  return { estimate: row.estimate, ciLower: row.ciLower, ciUpper: row.ciUpper };
}
function inputsOf(row) {
  if (row.format === "counts")
    return { events1: row.events1, n1: row.total1, events2: row.events2, n2: row.total2 };
  return { effect: row.estimate, ciLower: row.ciLower, ciUpper: row.ciUpper };
}
function studyOf(row) {
  return {
    id: row.id, projectId: row.project_id, label: row.label || "", measure: row.measure,
    inputs: JSON.parse(row.inputs_json || "{}"), locator: JSON.parse(row.locator_json || "{}"),
    quote: row.quote || "", verified: row.verified === 1,
    verifiedBy: row.verified_by || "", verifiedAt: row.verified_at == null ? null : row.verified_at,
    version: row.version, createdBy: row.created_by || "",
    createdAt: row.created_ts, updatedAt: row.updated_ts,
  };
}
function labelOf(authors, year, title, pmid) {
  const family = firstAuthorKey(authors);
  const nice = family ? family.charAt(0).toUpperCase() + family.slice(1) : "";
  if (nice && year) return (nice + " " + year).slice(0, 240);
  if (pmid) return ("PMID " + pmid).slice(0, 240);
  return String(title || "Study").slice(0, 240);
}
function citationOf(pmid, doi) {
  const parts = [];
  if (pmid) parts.push("PMID " + pmid);
  if (doi) parts.push("DOI " + doi);
  return (parts.join(". ") || "Record").slice(0, 500);
}
function locationString(loc) {
  if (typeof loc === "string") return loc.trim().slice(0, 200);
  if (loc && typeof loc === "object" && !Array.isArray(loc)) {
    const bits = [];
    if (loc.table) bits.push(String(loc.table));
    if (loc.page !== undefined && loc.page !== null && loc.page !== "") bits.push("page " + loc.page);
    if (loc.section) bits.push(String(loc.section));
    return bits.join(", ").slice(0, 200);
  }
  return "";
}

function hasResultNumber(text) {
  return /\d+\s*\/\s*\d+|\d+\s+of\s+\d+|\d+(?:\.\d+)?\s*%|\b(?:RR|OR|HR|MD|SMD)\b|\brisk ratio\b|\bodds ratio\b|\bhazard ratio\b|\bmean difference\b/i.test(text);
}
function snippetsFromXml(xml, words) {
  const out = [];
  const tables = String(xml || "").split(/<table\b/i).slice(1);
  for (const table of tables) {
    const cap = stripTags((table.match(/<caption[\s\S]*?<\/caption>/i) || table.match(/<title[\s\S]*?<\/title>/i) || [""])[0]);
    const tableName = (cap.match(/table\s+\d+[a-z]?/i) || [""])[0];
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const text = stripTags(row);
      if (!text || !hasResultNumber(text) || !sentenceMatches(text, words)) continue;
      out.push({ text: text.slice(0, 1000), location: tableName || "table" });
    }
  }
  const paras = String(xml || "").match(/<p[\s\S]*?<\/p>/gi) || [];
  for (const para of paras) {
    const text = stripTags(para);
    for (const sentence of sentencesOf(text)) {
      if (!hasResultNumber(sentence) || !sentenceMatches(sentence, words)) continue;
      out.push({ text: sentence.slice(0, 1000), location: "full text" });
    }
  }
  return out;
}
function licenceAllows(raw) {
  const licence = String((raw && (raw.license || raw.licence)) || "").toLowerCase();
  if (!licence) return true;
  if (/nc|nd/.test(licence)) return false;
  return /cc0|cc[- ]?by|open/.test(licence);
}

async function epmcLookup(pmid, doi, config) {
  const parts = [];
  if (pmid) parts.push("(EXT_ID:" + pmid + " AND SRC:MED)");
  if (doi) parts.push("DOI:" + doi);
  if (!parts.length) return null;
  const email = requireContactEmail(config);
  const p = new URLSearchParams();
  p.set("query", parts.join(" OR "));
  p.set("resultType", "core");
  p.set("format", "json");
  p.set("pageSize", "1");
  const body = await readJson(await fetchWithRetry(EPMC_SEARCH + "?" + p.toString(), transport(config, {
    "User-Agent": politeUserAgent(email), "Accept": "application/json",
  })));
  const list = resultListOf(body);
  return list.length ? list[0] : null;
}
async function oaSnippets(raw, words, config) {
  if (!raw || !epmcFree(raw) || !licenceAllows(raw)) return [];
  const pmcid = String(raw.pmcid || "");
  if (!/^PMC\d+$/.test(pmcid)) return [];
  const res = await fetchWithRetry(EPMC_XML + pmcid + "/fullTextXML", transport(config, {
    "User-Agent": politeUserAgent(config.contactEmail), "Accept": "application/xml",
  }));
  const xml = await res.text();
  return snippetsFromXml(xml, words);
}

function aiRowOk(parsed, measure, snippets) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.measure !== measure) return null;
  if (parsed.format !== "counts" && parsed.format !== "estimate") return null;
  const quote = typeof parsed.quote === "string" ? parsed.quote.trim() : "";
  if (!quote || quote.length > 2000) return null;
  if (snippets.indexOf(quote) < 0) return null;
  if (parsed.confidence !== undefined) {
    const c = parsed.confidence;
    if (typeof c !== "number" || c < 0 || c > 1) return null;
  }
  let row;
  if (parsed.format === "counts") {
    if (!COUNT_MEASURES[measure]) return null;
    const events1 = asInt(parsed.events1), total1 = asInt(parsed.total1);
    const events2 = asInt(parsed.events2), total2 = asInt(parsed.total2);
    if (events1 == null || total1 == null || events2 == null || total2 == null) return null;
    if (total1 < 1 || total2 < 1 || events1 < 0 || events2 < 0) return null;
    if (events1 > total1 || events2 > total2) return null;
    row = { format: "counts", events1, total1, events2, total2 };
  } else {
    const estimate = asFin(parsed.estimate), ciLower = asFin(parsed.ciLower), ciUpper = asFin(parsed.ciUpper);
    if (estimate == null || ciLower == null || ciUpper == null) return null;
    if (!(ciLower < estimate && estimate < ciUpper)) return null;
    if ((measure === "RR" || measure === "OR" || measure === "HR") && !(estimate > 0 && ciLower > 0 && ciUpper > 0)) return null;
    row = { format: "estimate", estimate, ciLower, ciUpper };
  }
  if (!numbersInQuote(row, quote)) return null;
  const location = locationString(parsed.location) || "abstract";
  return Object.assign({ quote, location, confidence: parsed.confidence == null ? null : parsed.confidence, measure }, row);
}

async function cacheKey(api, pmid, doi, outcome, measure) {
  const material = String(pmid || "") + "||" + String(doi || "") + "|" + normOutcome(outcome) + "|" + measure;
  return api.sha256Hex(material);
}
async function readCache(db, key) {
  const row = await db.prepare("SELECT value_json FROM research_paper_numbers WHERE cache_key=?").bind(key).first();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value_json || "");
    if (!value || typeof value !== "object") return null;
    if (!value.quote || (value.format !== "counts" && value.format !== "estimate")) return null;
    return value;
  } catch (e) { return null; }
}
async function writeCache(db, api, uid, projectId, key, pmid, doi, outcome, measure, value) {
  const now = Date.now();
  await db.prepare("INSERT INTO research_paper_numbers (cache_key,pmid,doi,outcome_norm,measure,value_json,created_ts) VALUES (?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json, created_ts=excluded.created_ts")
    .bind(key, pmid || "", doi || "", normOutcome(outcome), measure, JSON.stringify(value), now).run();
  await api.audit(db, projectId, uid, "paper_numbers.stored", key, { measure, method: value.method || "" });
}

async function insertStudy(db, api, uid, projectId, measure, packed, method) {
  const id = api.uuid("st_");
  const now = Date.now();
  const quote = String(packed.quote || "").slice(0, 2000);
  const location = packed.location || "abstract";
  const table = /^table\b/i.test(location) ? location.slice(0, 200) : "";
  const locator = {
    kind: "manual",
    citation: packed.citation || citationOf(packed.pmid, packed.doi),
    page: "",
    section: table ? "" : location.slice(0, 200),
    table,
    quote,
    aiSuggested: true,
    method,
  };
  const label = String(packed.label || labelOf(null, null, packed.title, packed.pmid)).slice(0, 240);
  await db.prepare("INSERT INTO research_studies (id,project_id,label,measure,inputs_json,locator_json,quote,verified,verified_by,verified_at,version,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,0,'',NULL,1,?,?,?)")
    .bind(id, projectId, label, measure, JSON.stringify(inputsOf(packed)), JSON.stringify(locator), quote, uid, now, now).run();
  await api.audit(db, projectId, uid, "study.created", id, { measure, method, verified: false });
  await api.audit(db, projectId, uid, "study.auto_added", id, { measure, method, aiSuggested: true });
  const row = await db.prepare("SELECT * FROM research_studies WHERE id=?").bind(id).first();
  return {
    status: "filled",
    study: studyOf(row),
    fields: fieldsOf(packed),
    quote,
    location,
    method,
  };
}

async function defaultMeasure(db, projectId, requested) {
  if (requested !== undefined && requested !== null && requested !== "") {
    return MEASURES.indexOf(requested) >= 0 ? requested : null;
  }
  const protocol = await db.prepare("SELECT content_json FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  if (protocol) {
    try {
      const content = JSON.parse(protocol.content_json || "{}");
      const from = content && (content.measure || (content.outcomes && content.outcomes.measure));
      if (MEASURES.indexOf(from) >= 0) return from;
    } catch (e) { /* default RR */ }
  }
  return "RR";
}

async function loadRecord(item, config) {
  const pmid = typeof item.pmid === "string" ? item.pmid.trim() : "";
  const doi = normaliseDoi(item.doi) || (typeof item.doi === "string" ? item.doi.trim() : "");
  if (pmid && !/^\d{1,12}$/.test(pmid)) return { error: "bad_id" };
  let abstract = "";
  let title = "";
  let authors = [];
  let year = null;
  let resolvedDoi = doi && doi.indexOf("10.") === 0 ? doi : "";
  let resolvedPmid = /^\d+$/.test(pmid) ? pmid : "";
  if (resolvedPmid) {
    const abstracts = await efetchAbstracts([resolvedPmid], config);
    const art = abstracts.get(resolvedPmid);
    if (art) abstract = art.abstract || "";
    try {
      const raws = await pubmed.fetchRecords([resolvedPmid], config);
      if (raws[0]) {
        const rec = pubmed.normalise(raws[0]);
        title = rec.title || "";
        authors = rec.authors || [];
        year = rec.year;
        if (!resolvedDoi) resolvedDoi = normaliseDoi(rec.doi) || "";
      }
    } catch (e) { /* abstract can still be enough */ }
  }
  let epmc = null;
  try { epmc = await epmcLookup(resolvedPmid, resolvedDoi, config); } catch (e) { epmc = null; }
  if (epmc) {
    if (!abstract) abstract = stripTags(epmc.abstractText || "");
    if (!title) title = String(epmc.title || "");
    if (!resolvedPmid && epmc.pmid) resolvedPmid = String(epmc.pmid);
    if (!resolvedDoi) resolvedDoi = normaliseDoi(epmc.doi) || "";
    if (year == null) {
      const y = parseInt(epmc.pubYear, 10);
      if (Number.isFinite(y)) year = y;
    }
  }
  return { pmid: resolvedPmid, doi: resolvedDoi, abstract, title, authors, year, epmc };
}

export async function autoAddStudies(ctx, projectId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "Adding studies needs an owner, editor or analyst role", requestId);
  const items = body && body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20)
    return err(400, "invalid_body", "items must list 1 to 20 records", requestId);
  const outcome = body && typeof body.outcome === "string" ? body.outcome.trim() : "";
  if (!outcome || outcome.length > 500) return err(400, "invalid_body", "outcome must be 1-500 characters", requestId);
  const measure = await defaultMeasure(db, projectId, body && body.measure);
  if (!measure) return err(400, "invalid_body", "measure must be RR, OR, HR, MD or SMD", requestId);
  const words = outcomeWords(outcome);
  const results = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      results.push(failedItem("Each item needs a PMID (PubMed identifier) or a DOI (digital object identifier)."));
      continue;
    }
    const pmidIn = typeof item.pmid === "string" ? item.pmid.trim() : "";
    const doiIn = normaliseDoi(item.doi) || "";
    if (!pmidIn && !doiIn) {
      results.push(failedItem("Each item needs a PMID (PubMed identifier) or a DOI (digital object identifier)."));
      continue;
    }
    const requestPmid = /^\d+$/.test(pmidIn) ? pmidIn : "";
    const key = await cacheKey(api, requestPmid, doiIn, outcome, measure);
    const cached = await readCache(db, key);
    if (cached && cached.measure === measure && numbersInQuote(cached, cached.quote)) {
      results.push(await insertStudy(db, api, uid, projectId, measure, cached, "cache"));
      continue;
    }
    if (!env.RESEARCH_CONTACT_EMAIL)
      return err(503, "search_unconfigured", "Research database contact is not configured", requestId);
    let loaded;
    try { loaded = await loadRecord(item, configOf(env)); }
    catch (e) {
      const code = e instanceof ConnectorError ? e.code : "";
      results.push(failedItem(code === "invalid_search"
        ? "This record could not be read. Check the PMID (PubMed identifier) or DOI (digital object identifier)."
        : "The literature databases could not be reached. Try again."));
      continue;
    }
    if (loaded.error) {
      results.push(failedItem());
      continue;
    }
    let extra = [];
    try { extra = await oaSnippets(loaded.epmc, words, configOf(env)); }
    catch (e) { extra = []; }
    let kept = String(loaded.abstract || "").trim();
    const pieces = [{ text: kept, location: "abstract" }];
    for (const snip of extra) {
      if ((kept.length + snip.text.length) > KEPT_CAP) break;
      kept = kept ? kept + "\n" + snip.text : snip.text;
      pieces.push(snip);
    }
    kept = kept.slice(0, KEPT_CAP);
    if (!kept) {
      results.push(needsPdf());
      continue;
    }
    let parsed = null;
    for (const piece of pieces) {
      parsed = parseText(piece.text, measure, words, piece.location);
      if (parsed) break;
    }
    let method = "parser";
    if (!parsed) {
      const system = "You extract one result from the snippets for the outcome the user names. " +
        "Return ONLY a JSON object {measure, format, events1, total1, events2, total2, estimate, ciLower, ciUpper, quote, location, confidence}. " +
        "format is \"counts\" or \"estimate\". measure is " + measure + ". " +
        "quote is copied exactly from the snippets. location is a short place such as abstract or a table name. " +
        "confidence is from 0 to 1. Do not invent a number. If the snippets do not contain a complete " + measure + " result, return {\"measure\":\"" + measure + "\",\"format\":\"estimate\",\"quote\":\"\",\"location\":\"\",\"confidence\":0}.";
      const prompt = "Outcome: " + outcome + "\nMeasure: " + measure + "\n\nSnippets:\n" + kept;
      const refId = api.uuid("aut_");
      const out = await runUserAi(ctx, projectId, "study_auto_add", system, prompt, refId, {
        temperature: 0, maxOutputTokens: AI_MAX_OUT, insufficientMessage: TOKENS_MESSAGE,
      });
      if (out.error) {
        const status = out.error.status;
        if (status === 402 || status === 422) return out.error;
        results.push(failedItem("The AI service could not complete this request. Try again."));
        continue;
      }
      parsed = aiRowOk(extractJson(out.text), measure, kept);
      method = "ai";
      if (!parsed) {
        results.push(needsPdf());
        continue;
      }
    }
    const packed = Object.assign({}, parsed, {
      pmid: loaded.pmid, doi: loaded.doi, title: loaded.title,
      label: labelOf(loaded.authors, loaded.year, loaded.title, loaded.pmid),
      citation: citationOf(loaded.pmid, loaded.doi),
      method,
    });
    const filled = await insertStudy(db, api, uid, projectId, measure, packed, method);
    const cacheValue = Object.assign({}, packed, { method });
    await writeCache(db, api, uid, projectId, key, requestPmid, doiIn, outcome, measure, cacheValue);
    const loadedKey = await cacheKey(api, loaded.pmid, loaded.doi, outcome, measure);
    if (loadedKey !== key)
      await writeCache(db, api, uid, projectId, loadedKey, loaded.pmid, loaded.doi, outcome, measure, cacheValue);
    results.push(filled);
  }
  return json({ results }, 200, { "x-request-id": requestId });
}
