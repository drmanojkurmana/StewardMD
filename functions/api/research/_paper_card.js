/* ResearchMD paste-a-link study card (ES module, server side).
 * Contract: docs/research/contracts/phase-5/paper-card.md.
 *
 *   POST /v1/projects/{pid}/paper-card          body { link }
 *     Read role. No AI call and no MaiK token charge. tokensUsed is 0.
 *   POST /v1/projects/{pid}/paper-card/explain  body { pmid?, doi? }
 *     Write role. One AI call, and only when the cached card is unstructured
 *     or has no findings. A card that is already structured with findings is
 *     400 not_needed.
 *
 * resolveLink is pure. A journal page is fetched only when the link itself
 * has no PMID, PMCID or DOI, and only to read citation meta tags.
 */
import { assertPublicHttpsUrl } from "../../_connect/onboard/ssrf.js";
import { fetchWithRetry, readJson, createBucket, requireContactEmail, ConnectorError } from "./_connectors/_http.js";
import { efetchAbstracts } from "./_connectors/pubmed_efetch.js";
import { fetchRecords, normalise } from "./_connectors/crossref.js";
import { normaliseDoi } from "./_dedup.js";
import { parseFindings } from "./_auto_studies.js";
import { runUserAi, extractJson } from "./_suggest.js";

const READ_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const WRITE_ROLES = ["owner", "editor", "analyst"];
const TOOL = "StewardMD_ResearchMD";
const BUCKET = createBucket(8);
const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const IDCONV = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/";
const PAGE_BYTES = 300 * 1024;
const PAGE_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const UNRECOGNISED = "Paste a PubMed, DOI, PMC or journal article link (a link to one study).";
const TOKENS_MESSAGE = "You need more MaiK tokens";
const NOT_NEEDED = "This study is already summarised for free.";
const AI_KEYS = ["population", "intervention", "comparison", "outcome", "design", "mainResult", "conclusion"];
const DOI_RE = /10\.\d{4,9}\/[^\s?#"<>]+/i;

const DESIGNS = [
  { key: "rct", pt: ["randomized controlled trial"], label: "Randomized controlled trial (RCT) (people were assigned to groups by chance)" },
  { key: "meta_analysis", pt: ["meta-analysis"], label: "Meta-analysis (results from several studies combined into one estimate)" },
  { key: "systematic_review", pt: ["systematic review"], label: "Systematic review (a structured search of the studies on one question)" },
  { key: "observational", pt: ["observational study"], label: "Observational study (researchers recorded what happened, without assigning a treatment)" },
  { key: "cohort", pt: ["cohort study"], mesh: ["cohort studies"], label: "Cohort study (a group of people followed over time)" },
  { key: "case_control", pt: ["case-control study"], mesh: ["case-control studies"], label: "Case-control study (people with the outcome compared with people without it)" },
  { key: "cross_sectional", pt: ["cross-sectional study"], mesh: ["cross-sectional studies"], label: "Cross-sectional study (people measured at one point in time)" },
  { key: "case_report", pt: ["case reports"], label: "Case report (a description of one patient or a few patients)" },
  { key: "clinical_trial", pt: ["clinical trial"], label: "Clinical trial (a study that tests a treatment in people)" },
  { key: "review", pt: ["review"], label: "Review (a summary of published studies)" },
];

function configOf(env) {
  return {
    contactEmail: requireContactEmail({ contactEmail: env.RESEARCH_CONTACT_EMAIL }),
    apiKey: String(env.RESEARCH_NCBI_API_KEY || "").trim(),
    deadline: Date.now() + 60000,
    bucket: BUCKET,
  };
}
function transport(config) {
  return { deadline: config.deadline, bucket: config.bucket };
}

/* Strip trailing punctuation and /full, /abstract, /pdf, /epdf. A closing
 * parenthesis stays when it balances one inside the DOI. */
function cleanDoi(raw) {
  let d = String(raw || "");
  let prev = "";
  while (d && d !== prev) {
    prev = d;
    d = d.replace(/\/(?:full|abstract|pdf|epdf)\/?$/i, "");
    d = d.replace(/[.,;:]+$/, "");
    const open = (d.match(/\(/g) || []).length;
    const close = (d.match(/\)/g) || []).length;
    if (d.endsWith(")") && close > open) d = d.slice(0, -1);
    else if (/[\]>'"]$/.test(d)) d = d.slice(0, -1);
  }
  return d;
}

function doiOf(text) {
  const m = String(text || "").match(DOI_RE);
  if (!m) return "";
  const cleaned = cleanDoi(m[0]);
  return /^10\.\d{4,9}\/\S+$/i.test(cleaned) ? cleaned.toLowerCase() : "";
}

/* resolveLink(text) -> { pmid?, pmcid?, doi? } or null. No network. */
export function resolveLink(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 4000) return null;
  let url = null;
  try { url = new URL(raw); } catch (e) { url = null; }
  if (url && url.hostname) {
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const path = url.pathname || "";
    if (host === "pubmed.ncbi.nlm.nih.gov" || host === "www.pubmed.ncbi.nlm.nih.gov") {
      const m = path.match(/^\/(\d{1,9})(?:\/|$)/);
      if (m) return { pmid: m[1] };
    }
    if (host === "ncbi.nlm.nih.gov" || host === "www.ncbi.nlm.nih.gov") {
      const pm = path.match(/^\/pubmed\/(\d{1,9})(?:\/|$)/i);
      if (pm) return { pmid: pm[1] };
      const pmc = path.match(/^\/pmc\/articles\/(PMC\d+)(?:\/|$)/i);
      if (pmc) return { pmcid: pmc[1].toUpperCase() };
    }
    if (host === "pmc.ncbi.nlm.nih.gov" || host === "www.pmc.ncbi.nlm.nih.gov") {
      const pmc = path.match(/^\/articles\/(PMC\d+)(?:\/|$)/i);
      if (pmc) return { pmcid: pmc[1].toUpperCase() };
    }
    if (host === "europepmc.org" || host === "www.europepmc.org") {
      const med = path.match(/^\/(?:article|abstract)\/MED\/(\d{1,9})(?:\/|$)/i);
      if (med) return { pmid: med[1] };
      const pmc = path.match(/^\/article\/PMC\/(PMC\d+)(?:\/|$)/i);
      if (pmc) return { pmcid: pmc[1].toUpperCase() };
    }
  }
  const doi = doiOf(raw);
  if (doi) return { doi };
  const labelled = raw.match(/\bPMID\s*:?\s*(\d{1,9})\b/i);
  if (labelled) return { pmid: labelled[1] };
  if (/^\d{1,9}$/.test(raw)) return { pmid: raw };
  return null;
}

function hostBlocked(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.indexOf(":") >= 0) return true;
  return false;
}

/* https only, no IP literal, no localhost, no private range. null means do not fetch. */
function publicPageUrl(urlStr) {
  let u;
  try { u = new URL(String(urlStr)); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  if (hostBlocked(u.hostname)) return null;
  try { assertPublicHttpsUrl(u.toString()); } catch (e) { return null; }
  return u.toString();
}

function attrOf(tag, key) {
  const m = String(tag || "").match(new RegExp("\\b" + key + "\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)", "i"));
  if (!m) return "";
  return m[1].replace(/^["']|["']$/g, "").trim();
}

/* citation_doi, dc.identifier when it holds a DOI, or citation_pmid. Nothing else. */
function metaIds(html) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  let doi = "";
  let pmid = "";
  let dc = "";
  for (let i = 0; i < tags.length; i++) {
    const name = (attrOf(tags[i], "name") || attrOf(tags[i], "property")).toLowerCase();
    const content = attrOf(tags[i], "content");
    if (!name || !content) continue;
    if (name === "citation_doi" && !doi) doi = doiOf(content);
    else if (name === "dc.identifier" && !dc) dc = doiOf(content);
    else if (name === "citation_pmid" && !pmid) {
      const m = content.match(/\b(\d{1,9})\b/);
      if (m) pmid = m[1];
    }
  }
  doi = doi || dc;
  if (!doi && !pmid) return null;
  const out = {};
  if (pmid) out.pmid = pmid;
  if (doi) out.doi = doi;
  return out;
}

async function readLimited(res) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return String(text || "").slice(0, PAGE_BYTES);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < PAGE_BYTES) {
    const part = await reader.read();
    if (part.done) break;
    const value = part.value;
    const room = PAGE_BYTES - size;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, room));
      size += room;
      try { await reader.cancel(); } catch (e) { /* closed */ }
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) { bytes.set(chunks[i], offset); offset += chunks[i].byteLength; }
  return new TextDecoder().decode(bytes);
}

/* One GET, at most 3 redirects, 6s, 300 KB. Returns ids or null. Never throws. */
async function pageIds(link) {
  let current = publicPageUrl(String(link || "").trim());
  if (!current) return null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(current, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { "Accept": "text/html", "User-Agent": "StewardMD-ResearchMD/1.0" },
      });
    } catch (e) { return null; }
    if (res.status >= 300 && res.status < 400) {
      try { if (res.body) await res.body.cancel(); } catch (e) { /* closed */ }
      if (hop >= MAX_REDIRECTS) return null;
      const loc = res.headers.get("location");
      if (!loc) return null;
      let next;
      try { next = new URL(loc, current).toString(); } catch (e) { return null; }
      current = publicPageUrl(next);
      if (!current) return null;
      continue;
    }
    if (!res.ok) return null;
    let html = "";
    try { html = await readLimited(res); } catch (e) { return null; }
    return metaIds(html);
  }
  return null;
}

function cacheKeys(ids) {
  const keys = [];
  const pmid = ids && /^\d+$/.test(String(ids.pmid || "")) ? String(ids.pmid) : "";
  const doi = ids && ids.doi ? (normaliseDoi(ids.doi) || "") : "";
  if (pmid) keys.push("pmid:" + pmid);
  if (doi) keys.push("doi:" + doi.toLowerCase());
  return keys;
}

async function readCache(db, ids) {
  const keys = cacheKeys(ids);
  for (let i = 0; i < keys.length; i++) {
    const row = await db.prepare("SELECT card_json FROM research_paper_cards WHERE cache_key=?").bind(keys[i]).first();
    if (!row) continue;
    try {
      const card = JSON.parse(row.card_json || "");
      if (card && typeof card === "object" && !Array.isArray(card)) return card;
    } catch (e) { /* try the other key */ }
  }
  return null;
}

async function writeCache(db, card) {
  const keys = cacheKeys(card);
  const now = Date.now();
  const payload = JSON.stringify(card);
  for (let i = 0; i < keys.length; i++) {
    await db.prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET card_json=excluded.card_json, created_ts=excluded.created_ts")
      .bind(keys[i], payload, now).run();
  }
}

function served(card, method) {
  return Object.assign({}, card, { method, tokensUsed: 0 });
}

async function idconv(id, config) {
  const p = new URLSearchParams();
  p.set("ids", id);
  p.set("format", "json");
  p.set("tool", TOOL);
  p.set("email", config.contactEmail);
  if (config.apiKey) p.set("api_key", config.apiKey);
  try {
    const body = await readJson(await fetchWithRetry(IDCONV + "?" + p.toString(), transport(config)));
    const rec = body && Array.isArray(body.records) ? body.records[0] : null;
    if (!rec || rec.status === "error" || rec.errmsg) return {};
    const pmid = /^\d+$/.test(String(rec.pmid || "")) ? String(rec.pmid) : "";
    const pmcRaw = String(rec.pmcid || "").replace(/\s+/g, "").toUpperCase();
    return { pmid, pmcid: /^PMC\d+$/.test(pmcRaw) ? pmcRaw : "", doi: normaliseDoi(rec.doi) || "" };
  } catch (e) {
    if (e instanceof ConnectorError && e.code === "invalid_search") return {};
    throw e;
  }
}

async function esearchDoi(doi, config) {
  const p = new URLSearchParams();
  p.set("db", "pubmed");
  p.set("term", '"' + doi + '"[doi]');
  p.set("retmode", "json");
  p.set("retmax", "1");
  p.set("tool", TOOL);
  p.set("email", config.contactEmail);
  if (config.apiKey) p.set("api_key", config.apiKey);
  try {
    const body = await readJson(await fetchWithRetry(ESEARCH + "?" + p.toString(), transport(config)));
    const id = body && body.esearchresult && body.esearchresult.idlist && body.esearchresult.idlist[0];
    return /^\d+$/.test(String(id || "")) ? String(id) : "";
  } catch (e) {
    if (e instanceof ConnectorError && e.code === "invalid_search") return "";
    throw e;
  }
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function designOf(publicationTypes, mesh) {
  const pt = (publicationTypes || []).map((s) => String(s || "").toLowerCase().trim());
  const mh = (mesh || []).map((s) => String(s || "").toLowerCase().trim());
  for (let i = 0; i < DESIGNS.length; i++) {
    const d = DESIGNS[i];
    if ((d.pt || []).some((name) => pt.indexOf(name) >= 0))
      return { key: d.key, label: d.label, source: "publication_type" };
  }
  for (let i = 0; i < DESIGNS.length; i++) {
    const d = DESIGNS[i];
    if ((d.mesh || []).some((name) => mh.indexOf(name) >= 0))
      return { key: d.key, label: d.label, source: "mesh" };
  }
  return null;
}

function sampleSizeOf(text) {
  const src = String(text || "");
  const patterns = [
    /\bn\s*=\s*(\d{1,3}(?:,\d{3})+|\d+)\b/gi,
    /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:patients|participants|subjects|adults|children|women|men|infants)\b/gi,
    /\b(?:randomized|randomised|enrolled|included)\s+(\d{1,3}(?:,\d{3})+|\d+)\b/gi,
  ];
  let best = null;
  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i];
    let m;
    while ((m = re.exec(src)) !== null) {
      const n = Number(String(m[1]).replace(/,/g, ""));
      if (!Number.isInteger(n) || n < 1 || n > 10000000) continue;
      if (!best || n > best.n) best = { n, quote: m[0] };
    }
  }
  return best;
}

function abstractOf(sections) {
  return (sections || []).map((s) => String((s && s.text) || "").trim()).filter(Boolean).join(" ");
}

function labelled(sections, names) {
  return (sections || []).filter((s) => s && names.indexOf(String(s.label || "").toLowerCase()) >= 0);
}

function lastSentence(text) {
  const parts = String(text || "").trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function buildCard(rec) {
  const sections = Array.isArray(rec.sections) ? rec.sections.filter((s) => s && s.text) : [];
  const whole = abstractOf(sections);
  const results = labelled(sections, ["results", "result"]);
  const conclusions = labelled(sections, ["conclusions", "conclusion", "interpretation"]);
  const findingText = results.length ? results.map((s) => s.text).join(" ") : whole;
  const pmid = /^\d+$/.test(String(rec.pmid || "")) ? String(rec.pmid) : "";
  const doi = normaliseDoi(rec.doi) || "";
  const pmcid = /^PMC\d+$/.test(String(rec.pmcid || "")) ? String(rec.pmcid) : "";
  const year = Number.isInteger(rec.year) ? rec.year : null;
  return {
    pmid, pmcid, doi,
    title: String(rec.title || ""),
    journal: String(rec.journal || ""),
    year,
    authors: (Array.isArray(rec.authors) ? rec.authors : []).map((a) => String(a || "").trim()).filter(Boolean).slice(0, 6),
    url: pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/" : (doi ? "https://doi.org/" + doi : ""),
    freeFullText: /^PMC\d+$/.test(pmcid),
    design: designOf(rec.publicationTypes, rec.mesh),
    sampleSize: sampleSizeOf(whole),
    structured: sections.some((s) => String(s.label || "").trim()),
    sections: sections.map((s) => ({ label: String(s.label || ""), text: String(s.text || "") })),
    findings: parseFindings(findingText),
    conclusion: conclusions.length ? String(conclusions[0].text || "") : lastSentence(whole),
    mesh: (Array.isArray(rec.mesh) ? rec.mesh : []).map((s) => String(s || "").trim()).filter(Boolean),
    keywords: (Array.isArray(rec.keywords) ? rec.keywords : []).map((s) => String(s || "").trim()).filter(Boolean),
    method: "api",
    tokensUsed: 0,
  };
}

async function fromCrossref(doi, config) {
  let rows = [];
  try { rows = await fetchRecords([doi], config); }
  catch (e) {
    if (e instanceof ConnectorError && e.code === "invalid_search") return null;
    throw e;
  }
  const raw = rows && rows[0];
  if (!raw) return null;
  let rec;
  try { rec = normalise(raw); } catch (e) { return null; }
  const abstract = stripTags(raw.abstract || "");
  const journal = Array.isArray(raw["container-title"]) ? String(raw["container-title"][0] || "") : "";
  if (!rec.title && !abstract) return null;
  return {
    pmid: "", pmcid: "", doi: normaliseDoi(rec.doi) || doi,
    title: rec.title || "", journal, year: rec.year,
    authors: rec.authors || [],
    sections: abstract ? [{ label: "", text: abstract }] : [],
    publicationTypes: [], mesh: [], keywords: [],
  };
}

async function fromPubmed(pmid, doi, pmcid, config) {
  const map = await efetchAbstracts([pmid], config);
  const art = map.get(String(pmid));
  if (!art || (!art.title && !art.abstract && !(art.sections && art.sections.length))) return null;
  return {
    pmid: art.pmid || pmid,
    pmcid: art.pmcid || pmcid || "",
    doi: normaliseDoi(art.doi) || doi || "",
    title: art.title || "",
    journal: art.journal || art.venue || "",
    year: art.year,
    authors: art.authors || [],
    sections: art.sections && art.sections.length ? art.sections : (art.abstract ? [{ label: "", text: art.abstract }] : []),
    publicationTypes: art.publicationTypes || [],
    mesh: art.mesh || [],
    keywords: art.keywords || [],
  };
}

async function loadRecord(ids, config) {
  let pmid = /^\d+$/.test(String(ids.pmid || "")) ? String(ids.pmid) : "";
  let pmcid = /^PMC\d+$/i.test(String(ids.pmcid || "")) ? String(ids.pmcid).toUpperCase() : "";
  let doi = normaliseDoi(ids.doi) || "";
  if (!pmid && pmcid) {
    const conv = await idconv(pmcid, config);
    pmid = conv.pmid || pmid;
    doi = doi || conv.doi || "";
    pmcid = conv.pmcid || pmcid;
  }
  if (!pmid && doi) {
    const conv = await idconv(doi, config);
    pmid = conv.pmid || pmid;
    pmcid = pmcid || conv.pmcid || "";
    doi = conv.doi || doi;
  }
  if (!pmid && doi) pmid = await esearchDoi(doi, config);
  if (pmid) {
    const art = await fromPubmed(pmid, doi, pmcid, config);
    if (art) return art;
  }
  if (doi) {
    const cr = await fromCrossref(doi, config);
    if (cr && pmcid) cr.pmcid = pmcid;
    return cr;
  }
  return null;
}

async function viewed(api, db, projectId, uid, card) {
  await api.audit(db, projectId, uid, "paper_card.viewed", card.pmid || card.doi || "", {
    pmid: card.pmid || "", doi: card.doi || "", pmcid: card.pmcid || "",
  });
}

export async function paperCard(ctx, projectId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "Opening a study card needs a project role", requestId);
  const link = body && typeof body.link === "string" ? body.link.trim() : "";
  if (!link || link.length > 4000) return err(400, "invalid_body", "link is required", requestId);

  let ids = resolveLink(link);
  if (!ids) ids = await pageIds(link);
  if (!ids || (!ids.pmid && !ids.pmcid && !ids.doi))
    return err(400, "link_unrecognised", UNRECOGNISED, requestId);

  const cached = await readCache(db, ids);
  if (cached) {
    const card = served(cached, "cache");
    await viewed(api, db, projectId, uid, card);
    return json({ card }, 200, { "x-request-id": requestId });
  }
  if (!env.RESEARCH_CONTACT_EMAIL)
    return err(503, "search_unconfigured", "Research database contact is not configured", requestId);

  let rec;
  try { rec = await loadRecord(ids, configOf(env)); }
  catch (e) {
    return err(502, "search_failed", "The literature databases could not be reached. Try again.", requestId);
  }
  if (!rec) return err(404, "paper_not_found", "This study could not be found from that link.", requestId);
  const card = buildCard(rec);
  if (!card.title && !card.sections.length)
    return err(404, "paper_not_found", "This study could not be found from that link.", requestId);
  await writeCache(db, card);
  await viewed(api, db, projectId, uid, card);
  return json({ card }, 200, { "x-request-id": requestId });
}

function aiFields(parsed, abstract) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out = {};
  for (let i = 0; i < AI_KEYS.length; i++) {
    const key = AI_KEYS[i];
    if (typeof parsed[key] !== "string") continue;
    const value = parsed[key].trim().slice(0, 400);
    if (!value) continue;
    if (key === "mainResult") {
      const nums = value.match(/\d+(?:\.\d+)?/g) || [];
      const ok = nums.every((n) => new RegExp("(?<![0-9])" + n.replace(/\./g, "\\.") + "(?![0-9])").test(abstract));
      if (!ok) continue;
    }
    out[key] = value;
  }
  return out;
}

export async function explainPaperCard(ctx, projectId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "A plain-language summary needs an owner, editor or analyst role", requestId);
  const pmid = body && typeof body.pmid === "string" && /^\d{1,9}$/.test(body.pmid.trim()) ? body.pmid.trim() : "";
  const doi = body ? (normaliseDoi(body.doi) || "") : "";
  if (!pmid && !doi) return err(400, "invalid_body", "pmid or doi is required", requestId);
  const cached = await readCache(db, { pmid, doi });
  if (!cached) return err(404, "paper_not_found", "Paste the study link first, then ask for a summary.", requestId);
  const findings = Array.isArray(cached.findings) ? cached.findings : [];
  if (cached.structured === true && findings.length)
    return err(400, "not_needed", NOT_NEEDED, requestId);
  if (cached.ai && typeof cached.ai === "object") {
    return json({ card: served(cached, "cache"), model: cached.aiModel || "", costInr: 0 }, 200, { "x-request-id": requestId });
  }
  const abstract = abstractOf(cached.sections);
  const title = String(cached.title || "");
  const system = "You summarise one study for a clinician. Return ONLY JSON with keys population, intervention, comparison, outcome, design, mainResult, conclusion. " +
    "Each value is a short string. mainResult may contain only numbers copied from the abstract. Do not invent a number.";
  const prompt = ("Title: " + title + "\nAbstract: " + abstract).slice(0, 3000);
  const out = await runUserAi(ctx, projectId, "paper_card_explain", system, prompt, api.uuid("pce_"), {
    temperature: 0, maxOutputTokens: 350, insufficientMessage: TOKENS_MESSAGE,
  });
  if (out.error) return out.error;
  const ai = aiFields(extractJson(out.text), abstract);
  if (!ai) return err(422, "invalid_draft", "MaiK did not return a summary that could be checked.", requestId);
  const card = Object.assign({}, cached, { ai, aiModel: out.model || "", tokensUsed: 0 });
  await writeCache(db, card);
  return json({ card: served(card, "cache"), model: out.model || "", costInr: out.costInr || 0 }, 200, { "x-request-id": requestId });
}
