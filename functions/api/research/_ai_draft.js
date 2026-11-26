/* ResearchMD Ask MaiK drafts (ES module, server side).
 * Contract: docs/research/contracts/phase-5/ai-draft.md.
 *
 * POST /v1/projects/{pid}/ai-draft
 *   body { task, input? }
 *   200 { draft, model, costInr }
 *   Write role: owner, editor, analyst. Viewer and reviewer get 403.
 *   Unknown task: 400 invalid_task.
 *   Insufficient MaiK tokens: 402 insufficient_credits,
 *   message "You need more MaiK tokens".
 *
 * draft.status is always "unverified". The row is stored in
 * research_ai_drafts and is never copied into the protocol, risk of bias,
 * checklist or manuscript tables. A person saves through those routes.
 *
 * Tasks and output shapes (temperature 0, one provider call each):
 *   protocol (max 1200 tokens)
 *     { title, pico: {population, intervention, comparison, outcome},
 *       peco: null | {population, exposure, comparison, outcome},
 *       eligibility: [string], outcomes: {primary, secondary: [string]},
 *       analysis: {measure, model} }
 *   search_query (max 500)
 *     { pubmed, europePmc }
 *     pubmed must have balanced () and [] and only known field tags.
 *   rob (max 1500)
 *     { tool: "rob2", studies: [{ studyId, domains: [{ key, judgement, reason, quote }] }] }
 *     A quote that is not an exact substring of that study's snippet
 *     clears that domain (judgement, reason and quote become "").
 *   checklist (max 1500)
 *     { guidelineId, items: [{ itemNum, topic, status, section }] }
 *     status is "covered" or "missing". Covered with no matching manuscript
 *     section or the protocol is forced to "missing".
 *   title_abstract (max 800)
 *     { title, abstract: {background, methods, results, conclusions} }
 *     A bare number outside a {{run:<id>.<field>}} token is removed.
 *   polish (max 2000, the T1 output ceiling)
 *     input: { text?, sectionId?, journalId? }
 *     text wins when it is non-empty. Otherwise the latest manuscript
 *     section named by sectionId is read and is not written back.
 *     { polished, changes: [{ before, after, reason }], sectionId,
 *       journalId, spelling }
 *     spelling is British or American. American journals: nejm, jama,
 *     jama_internal_medicine, annals, plos_medicine. Anything else,
 *     including an Indian journal id and a missing journal, is British.
 *     reason is grammar, clarity, concision, academic tone,
 *     tense consistency, British spelling or American spelling, and the
 *     spelling reason must match the journal.
 *     Hard checks, else 422 invalid_draft and the row is not stored:
 *     every {{run:...}} token survives with the same count; no new
 *     number; no new citation; polished length is at most 1.2 times
 *     the section (integer: length * 5 <= input length * 6).
 *   thesis_to_paper (max 1200 per section)
 *     input: { text?, pages?: [{n, text}], section?, wordLimit?, paperType?,
 *              checklist?, journalId?, format?, filename? }
 *     One call per section. section omitted means abstract, introduction,
 *     methods, results and discussion. Default word limit is the journal
 *     main limit when journalId matches a row, else 3000.
 *     { paperType, checklist, suggestion, wordLimit, wordCount,
 *       trimmedToWordLimit, sections: [{ id, heading, text, flags, numbers }],
 *       suggestedTables, references }
 *     numbers: [{ value, locator: { page, table, label } }]
 *     label is "From your thesis, page 54, Table 7" when both are known.
 *     A number that is not an exact substring of the thesis text is removed
 *     and the sentence is flagged "check this number".
 *     references: the model may return references:[{citation, doi?, pmid?}].
 *     A citation is kept only when it is an exact substring of the thesis.
 *     doi and pmid are kept only when they appear verbatim in the thesis.
 *     A kept reference with neither doi nor pmid has
 *     flag "check this reference". Otherwise flag is "".
 *     DOCX: this repo has no DOCX reader. format "docx", a .docx filename,
 *     or docxBase64, without extracted text, returns 422 docx_needs_pdf
 *     and does not call a provider. Upload a PDF through the existing
 *     pdf-uploads route instead.
 *     The PHI gate runs on the extracted thesis text before any provider
 *     call. A hit returns 422 phi_blocked with categories and pages, and
 *     the matched text is not returned.
 */
import { runUserAi, extractJson } from "./_suggest.js";
import { scan, phiCategories } from "./_phi.js";
import { checklistItems } from "./_checklists.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const TOKENS_MESSAGE = "You need more MaiK tokens";
export const TASKS = [
  "protocol", "search_query", "rob", "checklist", "title_abstract", "thesis_to_paper", "polish",
  "iec_application", "consent_form", "ctri_fields",
  "publication_consent", "case_report_draft", "manuscript_draft",
];
const MAX_OUT = {
  protocol: 1200,
  search_query: 500,
  rob: 1500,
  checklist: 1500,
  title_abstract: 800,
  thesis_to_paper: 1200,
  polish: 2000,
  iec_application: 2000,
  consent_form: 2000,
  ctri_fields: 1500,
  publication_consent: 2000,
  case_report_draft: 2500,
  manuscript_draft: 2000,
};
/* One T1 call has to return the whole section. 5000 characters leaves room
 * for the polished text inside the 2000 token output ceiling. */
const POLISH_TEXT_MAX = 5000;
const POLISH_CHANGES_MAX = 40;
const AMERICAN_JOURNALS = new Set(["nejm", "jama", "jama_internal_medicine", "annals", "plos_medicine"]);
const PUBMED_TAGS = new Set([
  "ti", "tiab", "tw", "ab", "mh", "mesh", "majr", "au", "pt", "dp", "la", "sh", "sb",
  "nm", "rn", "pmid", "doi", "ta", "jt", "ad", "all", "ot", "edat", "crdt", "ptyp", "pl",
  "mh:noexp", "mesh:noexp",
]);
const ROB_KEYS = ["d1", "d2", "d3", "d4", "d5"];
const ROB_JUDGEMENTS = ["low", "some_concerns", "high"];
const THESIS_SECTIONS = [
  { id: "abstract", heading: "Abstract" },
  { id: "introduction", heading: "Introduction" },
  { id: "methods", heading: "Methods" },
  { id: "results", heading: "Results" },
  { id: "discussion", heading: "Discussion" },
];
const NUM_RE = /(?<![A-Za-z0-9.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;

function inputOf(body) {
  const input = body && body.input;
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}
function asText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function roundInr(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function wordCount(text) {
  const m = String(text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}
function trimWords(text, max) {
  const words = String(text || "").trim().match(/\S+/g) || [];
  if (max < 1) return "";
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

async function oneCall(ctx, projectId, task, system, prompt) {
  const refId = ctx.api.uuid("adf_");
  return runUserAi(ctx, projectId, "ai_draft_" + task, system, prompt, refId, {
    temperature: 0,
    maxOutputTokens: MAX_OUT[task] || 800,
    insufficientMessage: TOKENS_MESSAGE,
  });
}

async function storeDraft(ctx, projectId, task, draft, model, costInr) {
  const { db, uid, api } = ctx;
  const id = api.uuid("draft_");
  const now = Date.now();
  const stored = Object.assign({ id, status: "unverified", task }, draft);
  await db.prepare("INSERT INTO research_ai_drafts (id,project_id,task,status,draft_json,model,cost_inr,created_by,created_ts) VALUES (?,?,?,'unverified',?,?,?,?,?)")
    .bind(id, projectId, task, JSON.stringify(stored), model || "", costInr, uid, now).run();
  await api.audit(db, projectId, uid, "ai_draft_stored", id, { task, status: "unverified" });
  return stored;
}
function respond(ctx, stored, model, costInr) {
  return ctx.api.json({ draft: stored, model: model || "", costInr: roundInr(costInr) }, 200, { "x-request-id": ctx.requestId });
}

async function loadProjectBits(db, projectId) {
  const project = await db.prepare("SELECT * FROM research_projects WHERE id=?").bind(projectId).first();
  const protocolRow = await db.prepare("SELECT content_json FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  let protocol = {};
  try { protocol = JSON.parse((protocolRow && protocolRow.content_json) || "{}"); } catch (e) { protocol = {}; }
  const studies = (await db.prepare("SELECT id, label, quote, measure FROM research_studies WHERE project_id=? ORDER BY updated_ts DESC LIMIT 30")
    .bind(projectId).all()).results || [];
  const run = await db.prepare("SELECT id, result_json, measure FROM research_runs WHERE project_id=? ORDER BY created_ts DESC LIMIT 1")
    .bind(projectId).first();
  const version = await db.prepare("SELECT id FROM research_manuscript_versions WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  let sections = [];
  if (version) {
    sections = (await db.prepare("SELECT section_id, heading, text FROM research_manuscript_sections WHERE version_id=? ORDER BY sort_order ASC")
      .bind(version.id).all()).results || [];
  }
  return { project, protocol, studies, run, sections };
}

function protocolDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title = asText(parsed.title, 240);
  if (!title) return null;
  const src = parsed.pico && typeof parsed.pico === "object" ? parsed.pico : {};
  const pico = {
    population: asText(src.population, 2000),
    intervention: asText(src.intervention, 2000),
    comparison: asText(src.comparison, 2000),
    outcome: asText(src.outcome, 2000),
  };
  if (!pico.population || !pico.intervention || !pico.outcome) return null;
  let peco = null;
  if (parsed.peco && typeof parsed.peco === "object" && !Array.isArray(parsed.peco)) {
    peco = {
      population: asText(parsed.peco.population, 2000) || pico.population,
      exposure: asText(parsed.peco.exposure, 2000),
      comparison: asText(parsed.peco.comparison, 2000),
      outcome: asText(parsed.peco.outcome, 2000) || pico.outcome,
    };
    if (!peco.exposure) peco = null;
  }
  const eligibility = Array.isArray(parsed.eligibility)
    ? parsed.eligibility.map((e) => asText(e, 500)).filter(Boolean).slice(0, 100) : [];
  if (!eligibility.length) return null;
  const outcomesSrc = parsed.outcomes && typeof parsed.outcomes === "object" ? parsed.outcomes : {};
  const primary = asText(outcomesSrc.primary, 500) || pico.outcome;
  const secondary = Array.isArray(outcomesSrc.secondary)
    ? outcomesSrc.secondary.map((s) => asText(s, 500)).filter(Boolean).slice(0, 50) : [];
  const analysisSrc = parsed.analysis && typeof parsed.analysis === "object" ? parsed.analysis : {};
  const measure = ["RR", "OR", "HR", "RD", "MD", "SMD"].indexOf(analysisSrc.measure) >= 0 ? analysisSrc.measure : "RR";
  const model = asText(analysisSrc.model, 300) || "random-effects";
  return { title, pico, peco, eligibility, outcomes: { primary, secondary }, analysis: { measure, model } };
}

function bracketsBalanced(s) {
  const open = { "(": ")", "[": "]" };
  const stack = [];
  for (const c of String(s || "")) {
    if (open[c]) stack.push(open[c]);
    else if (c === ")" || c === "]") {
      if (stack.pop() !== c) return false;
    }
  }
  return stack.length === 0;
}
function pubmedTagsOk(s) {
  const tags = String(s || "").match(/\[[^\]]+\]/g) || [];
  return tags.every((t) => PUBMED_TAGS.has(t.slice(1, -1).toLowerCase().replace(/\s+/g, "")));
}
function searchDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const pubmed = asText(parsed.pubmed, 2000);
  if (!pubmed || !bracketsBalanced(pubmed) || !pubmedTagsOk(pubmed)) return null;
  let europePmc = asText(parsed.europePmc, 2000);
  if (!europePmc || !bracketsBalanced(europePmc)) europePmc = pubmed.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
  if (!europePmc || !bracketsBalanced(europePmc)) return null;
  return { pubmed, europePmc };
}

function robDraft(parsed, studies) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const byId = new Map(studies.map((s) => [s.studyId, s]));
  const incoming = Array.isArray(parsed.studies) ? parsed.studies : [];
  const outStudies = [];
  for (const study of studies) {
    const found = incoming.find((s) => s && s.studyId === study.studyId) || {};
    const got = Array.isArray(found.domains) ? found.domains : [];
    const domains = ROB_KEYS.map((key) => {
      const item = got.find((d) => d && d.key === key) || {};
      const quote = typeof item.quote === "string" ? item.quote : "";
      const snippet = study.snippet || "";
      const judgement = ROB_JUDGEMENTS.indexOf(item.judgement) >= 0 ? item.judgement : "";
      if (!quote || snippet.indexOf(quote) < 0) return { key, judgement: "", reason: "", quote: "" };
      return { key, judgement, reason: asText(item.reason, 300), quote: quote.slice(0, 2000) };
    });
    if (byId.has(study.studyId)) outStudies.push({ studyId: study.studyId, domains });
  }
  return { tool: "rob2", studies: outStudies };
}

function sectionKnown(section, headings) {
  const s = String(section || "").trim().toLowerCase();
  if (!s) return false;
  return headings.some((h) => {
    const name = String(h || "").trim().toLowerCase();
    return name && (name === s || name.indexOf(s) >= 0 || s.indexOf(name) >= 0);
  });
}
function checklistDraft(parsed, guide, headings) {
  if (!guide) return null;
  const got = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  const items = guide.items.map((item) => {
    const found = got.find((g) => g && String(g.itemNum) === item.itemNum) || {};
    const section = asText(found.section, 200);
    let status = found.status === "covered" ? "covered" : "missing";
    if (status === "covered" && !sectionKnown(section, headings)) status = "missing";
    return { itemNum: item.itemNum, topic: item.topic, status, section: status === "covered" ? section : "" };
  });
  return { guidelineId: guide.id, name: guide.name, items };
}

function stripBareNumbers(text) {
  const tokens = [];
  const masked = String(text || "").replace(/\{\{run:[A-Za-z0-9_-]+[:.][A-Za-z0-9_.]+\}\}/g, (m) => {
    tokens.push(m);
    return "\u0000";
  });
  const stripped = masked.replace(/(?<![A-Za-z0-9_.])\d+(?:\.\d+)?%?/g, "");
  let i = 0;
  return stripped.replace(/\u0000/g, () => tokens[i++] || "").replace(/\s{2,}/g, " ").trim();
}
function manuscriptDraft(parsed, fallbackTitle) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title = stripBareNumbers(asText(parsed.title, 300)) || asText(fallbackTitle, 300);
  const byId = new Map();
  if (Array.isArray(parsed.sections)) {
    for (const s of parsed.sections) {
      if (!s || typeof s !== "object") continue;
      const id = String(s.id || s.sectionId || "").trim().toLowerCase();
      if (id && typeof s.text === "string" && s.text.trim()) byId.set(id, s.text);
    }
  } else if (parsed.sections && typeof parsed.sections === "object") {
    for (const [k, v] of Object.entries(parsed.sections)) {
      if (typeof v === "string" && v.trim()) byId.set(String(k).trim().toLowerCase(), v);
    }
  }
  for (const s of THESIS_SECTIONS) {
    if (!byId.has(s.id) && typeof parsed[s.id] === "string" && parsed[s.id].trim()) {
      byId.set(s.id, parsed[s.id]);
    }
  }
  const sections = [];
  for (const s of THESIS_SECTIONS) {
    const raw = byId.get(s.id);
    if (!raw) continue;
    const cleaned = (s.id === "abstract" || s.id === "results")
      ? stripBareNumbers(asText(raw, 6000))
      : asText(raw, 8000);
    if (cleaned) sections.push({ id: s.id, heading: s.heading, text: cleaned });
  }
  if (!sections.length) return null;
  return { title, sections };
}
function titleDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title = stripBareNumbers(asText(parsed.title, 300));
  if (!title) return null;
  const src = typeof parsed.abstract === "string"
    ? { background: "", methods: "", results: parsed.abstract, conclusions: "" }
    : (parsed.abstract && typeof parsed.abstract === "object" ? parsed.abstract : null);
  if (!src) return null;
  const abstract = {
    background: stripBareNumbers(asText(src.background, 2000)),
    methods: stripBareNumbers(asText(src.methods, 2000)),
    results: stripBareNumbers(asText(src.results, 4000)),
    conclusions: stripBareNumbers(asText(src.conclusions, 2000)),
  };
  if (!abstract.background && !abstract.methods && !abstract.results && !abstract.conclusions) return null;
  return { title, abstract };
}

export const CONSENT_LANGUAGES_LIST = [
  { code: "en", name: "English", script: "Latin", dir: "ltr" },
  { code: "te", name: "Telugu", script: "Telugu", dir: "ltr" },
  { code: "hi", name: "Hindi", script: "Devanagari", dir: "ltr" },
  { code: "kn", name: "Kannada", script: "Kannada", dir: "ltr" },
  { code: "ta", name: "Tamil", script: "Tamil", dir: "ltr" },
  { code: "ml", name: "Malayalam", script: "Malayalam", dir: "ltr" },
  { code: "gu", name: "Gujarati", script: "Gujarati", dir: "ltr" },
  { code: "bn", name: "Bengali", script: "Bengali", dir: "ltr" },
  { code: "ur", name: "Urdu", script: "Perso-Arabic Nastaliq", dir: "rtl" },
  { code: "mr", name: "Marathi", script: "Devanagari", dir: "ltr" },
];

export const CONSENT_LANGUAGES = new Set([
  "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Urdu",
  "en", "hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "ur",
]);

export const SCRIPT_RANGES = {
  te: [[0x0C00, 0x0C7F]],
  hi: [[0x0900, 0x097F]],
  mr: [[0x0900, 0x097F]],
  kn: [[0x0C80, 0x0CFF]],
  ta: [[0x0B80, 0x0BFF]],
  ml: [[0x0D00, 0x0D7F]],
  gu: [[0x0A80, 0x0AFF]],
  bn: [[0x0980, 0x09FF]],
  ur: [[0x0600, 0x06FF], [0x0750, 0x077F]],
};

export const LANG_MAP = {
  en: "English", english: "English",
  te: "Telugu", telugu: "Telugu",
  hi: "Hindi", hindi: "Hindi",
  kn: "Kannada", kannada: "Kannada",
  ta: "Tamil", tamil: "Tamil",
  ml: "Malayalam", malayalam: "Malayalam",
  mr: "Marathi", marathi: "Marathi",
  bn: "Bengali", bengali: "Bengali",
  gu: "Gujarati", gujarati: "Gujarati",
  ur: "Urdu", urdu: "Urdu",
};

export const CODE_BY_NAME = {
  english: "en", en: "en",
  telugu: "te", te: "te",
  hindi: "hi", hi: "hi",
  kannada: "kn", kn: "kn",
  tamil: "ta", ta: "ta",
  malayalam: "ml", ml: "ml",
  marathi: "mr", mr: "mr",
  bengali: "bn", bn: "bn",
  gujarati: "gu", gu: "gu",
  urdu: "ur", ur: "ur",
};

export function checkScriptRatio(text, lang) {
  const norm = String(lang || "").trim().toLowerCase();
  const code = CODE_BY_NAME[norm] || norm;
  if (code === "en") return { ok: true, ratio: 1, targetLetters: 0, totalLetters: 0 };
  const ranges = SCRIPT_RANGES[code];
  if (!ranges) return { ok: false, ratio: 0, reason: "unknown_language" };
  const str = String(text || "");
  let targetLetters = 0;
  let totalLetters = 0;
  for (const ch of str) {
    if (/\p{L}|\p{M}/u.test(ch)) {
      totalLetters++;
      const cp = ch.codePointAt(0);
      let inScript = false;
      for (let i = 0; i < ranges.length; i++) {
        if (cp >= ranges[i][0] && cp <= ranges[i][1]) {
          inScript = true;
          break;
        }
      }
      if (inScript) targetLetters++;
    }
  }
  if (totalLetters === 0) return { ok: false, ratio: 0, targetLetters: 0, totalLetters: 0 };
  const ratio = targetLetters / totalLetters;
  return { ok: ratio >= 0.6, ratio, targetLetters, totalLetters };
}

function stripContactInfo(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "");
  s = s.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, "");
  s = s.replace(/\b\d{10}\b/g, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

function iecDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const clean = (s, max = 4000) => stripContactInfo(asText(s, max));
  const title = clean(parsed.title, 300);
  if (!title) return null;
  const background = clean(parsed.background, 4000);
  const design = clean(parsed.design, 1000);
  const setting = clean(parsed.setting, 1000);
  const duration = clean(parsed.duration, 500);
  const sampleSize = clean(parsed.sampleSize, 1000);
  const methodology = clean(parsed.methodology, 4000);
  const statisticalAnalysis = clean(parsed.statisticalAnalysis, 2000);
  const risks = clean(parsed.risks, 2000);
  const benefits = clean(parsed.benefits, 2000);
  const confidentiality = clean(parsed.confidentiality, 2000);
  const compensation = clean(parsed.compensation, 2000);
  const conflictOfInterest = clean(parsed.conflictOfInterest, 2000);
  const funding = clean(parsed.funding, 2000);
  const consentProcess = clean(parsed.consentProcess, 2000);
  const vulnerablePopulations = clean(parsed.vulnerablePopulations, 2000);

  const cleanArr = (arr) => Array.isArray(arr) ? arr.map((item) => clean(item, 500)).filter(Boolean) : [];
  const investigators = cleanArr(parsed.investigators);
  const objectives = cleanArr(parsed.objectives);
  const inclusion = cleanArr(parsed.inclusion);
  const exclusion = cleanArr(parsed.exclusion);

  if (!background || !design || !methodology || !risks || !benefits) return null;

  return {
    title,
    investigators,
    background,
    objectives,
    design,
    setting,
    duration,
    sampleSize,
    inclusion,
    exclusion,
    methodology,
    statisticalAnalysis,
    risks,
    benefits,
    confidentiality,
    compensation,
    conflictOfInterest,
    funding,
    consentProcess,
    vulnerablePopulations,
  };
}

function consentVersionDraft(src, lang) {
  if (!src || typeof src !== "object" || Array.isArray(src)) return null;
  const pis = src.participantInformationSheet && typeof src.participantInformationSheet === "object" ? src.participantInformationSheet : {};
  const cf = src.consentForm && typeof src.consentForm === "object" ? src.consentForm : {};

  const clean = (s) => stripContactInfo(asText(s, 3000));
  const participantInformationSheet = {
    title: clean(pis.title),
    purpose: clean(pis.purpose),
    procedures: clean(pis.procedures),
    duration: clean(pis.duration),
    risks: clean(pis.risks),
    benefits: clean(pis.benefits),
    alternatives: clean(pis.alternatives),
    confidentiality: clean(pis.confidentiality),
    voluntary: clean(pis.voluntary),
    contact: clean(pis.contact),
  };

  const statements = Array.isArray(cf.statements) ? cf.statements.map(clean).filter(Boolean) : [];
  const signatureBlock = clean(cf.signatureBlock);
  const consentForm = { statements, signatureBlock };

  if (!participantInformationSheet.title || !participantInformationSheet.purpose || !participantInformationSheet.procedures || !statements.length) {
    return null;
  }
  return { participantInformationSheet, consentForm, language: lang || "English" };
}

function consentDraft(parsed, requestedLang) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const reqLower = String(requestedLang || "").trim().toLowerCase();
  const langName = LANG_MAP[reqLower] || requestedLang || "English";
  const langCode = CODE_BY_NAME[reqLower] || CODE_BY_NAME[langName.toLowerCase()] || "en";

  if (langCode === "en") {
    const v = consentVersionDraft(parsed.englishVersion || parsed, "English");
    if (!v) return null;
    return v;
  }

  // When language is not English, return BOTH englishVersion and translatedVersion objects of the same shape.
  const eng = consentVersionDraft(parsed.englishVersion, "English");
  const trans = consentVersionDraft(parsed.translatedVersion || (parsed.translatedVersion === undefined ? parsed : null), langName);
  if (!eng || !trans) return null;

  const transText = [
    trans.participantInformationSheet.title,
    trans.participantInformationSheet.purpose,
    trans.participantInformationSheet.procedures,
    trans.participantInformationSheet.risks,
    trans.participantInformationSheet.benefits,
    trans.participantInformationSheet.voluntary,
    trans.consentForm.statements.join(" ")
  ].join(" ");

  const scriptRes = checkScriptRatio(transText, langCode);
  if (!scriptRes.ok) return null;

  return {
    participantInformationSheet: trans.participantInformationSheet,
    consentForm: trans.consentForm,
    language: langName,
    englishVersion: eng,
    translatedVersion: trans,
  };
}

function ctriDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const clean = (s, max = 2000) => stripContactInfo(asText(s, max));
  const publicTitle = clean(parsed.publicTitle, 300);
  const scientificTitle = clean(parsed.scientificTitle, 300);
  if (!publicTitle || !scientificTitle) return null;

  const studyType = clean(parsed.studyType, 200);
  const phase = clean(parsed.phase, 100);
  const condition = clean(parsed.condition, 500);
  const intervention = clean(parsed.intervention, 2000);
  const comparator = clean(parsed.comparator, 2000);
  const inclusion = clean(parsed.inclusion, 3000);
  const exclusion = clean(parsed.exclusion, 3000);

  const po = parsed.primaryOutcome && typeof parsed.primaryOutcome === "object" ? parsed.primaryOutcome : {};
  const primaryOutcome = {
    outcome: clean(po.outcome, 1000),
    timepoint: clean(po.timepoint, 500),
  };
  if (!primaryOutcome.outcome) return null;

  const secondaryOutcomes = Array.isArray(parsed.secondaryOutcomes)
    ? parsed.secondaryOutcomes.map((s) => clean(s, 1000)).filter(Boolean)
    : [];

  let targetSampleSize = parsed.targetSampleSize;
  if (typeof targetSampleSize === "string") targetSampleSize = parseInt(targetSampleSize, 10) || targetSampleSize;

  const sites = clean(parsed.sites, 1000);
  const recruitmentStatus = "Not Yet Recruiting";
  const ethicsCommittee = "";
  const regulatoryClearance = "";
  const fundingSource = clean(parsed.fundingSource, 500);

  let briefSummary = clean(parsed.briefSummary, 5000);
  if (briefSummary) {
    briefSummary = trimWords(briefSummary, 300);
  }

  return {
    publicTitle,
    scientificTitle,
    studyType,
    phase,
    condition,
    intervention,
    comparator,
    inclusion,
    exclusion,
    primaryOutcome,
    secondaryOutcomes,
    targetSampleSize: targetSampleSize || "",
    sites,
    recruitmentStatus,
    ethicsCommittee,
    regulatoryClearance,
    fundingSource,
    briefSummary,
  };
}

function publicationConsentDraft(parsed, requestedLang) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const english = stripContactInfo(asText(parsed.english, 10000));
  const local = stripContactInfo(asText(parsed.local, 10000));
  const reqLower = String(requestedLang || "").trim().toLowerCase();
  const languageName = asText(parsed.languageName, 80) || LANG_MAP[reqLower] || requestedLang || "English";
  const langCode = CODE_BY_NAME[reqLower] || CODE_BY_NAME[languageName.toLowerCase()] || "en";
  if (!english) return null;
  const finalLocal = local || (langCode === "en" ? english : "");
  if (!finalLocal) return null;

  if (langCode !== "en") {
    const scriptRes = checkScriptRatio(finalLocal, langCode);
    if (!scriptRes.ok) return null;
  }

  return {
    english,
    local: finalLocal,
    languageName,
  };
}

function caseReportDraft(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const sec = parsed.sections && typeof parsed.sections === "object" && !Array.isArray(parsed.sections) ? parsed.sections : parsed;
  const title = asText(sec.title, 500);
  const abstract = asText(sec.abstract, 4000);
  const introduction = asText(sec.introduction, 4000);
  const casePresentation = asText(sec.casePresentation || sec.presentation || sec.case_presentation, 8000);
  const timeline = asText(sec.timeline, 4000);
  const discussion = asText(sec.discussion, 8000);
  const conclusion = asText(sec.conclusion, 4000);
  const patientPerspective = asText(sec.patientPerspective || sec.perspective || "", 2000);
  let learningPoints = [];
  if (Array.isArray(sec.learningPoints || sec.learning_points)) {
    learningPoints = (sec.learningPoints || sec.learning_points).map((lp) => asText(lp, 500)).filter(Boolean);
  }
  if (!title || !abstract || !introduction || !casePresentation || !discussion || !conclusion) {
    return null;
  }
  return {
    sections: {
      title,
      abstract,
      introduction,
      casePresentation,
      timeline,
      discussion,
      conclusion,
      patientPerspective,
      learningPoints,
    },
  };
}

function suggestDesign(text) {
  const s = String(text || "").toLowerCase();
  if (/\brandomi[sz]ed\b|\brct\b|\bplacebo\b/.test(s))
    return { paperType: "rct", checklist: "CONSORT", label: "Randomised controlled trial (RCT) (a trial that assigns people by chance)" };
  if (/systematic review|\bmeta-analysis\b|\bmeta analysis\b/.test(s))
    return { paperType: "systematic_review", checklist: "PRISMA", label: "Systematic review (a review that finds and combines every eligible study)" };
  if (/case series|case report/.test(s))
    return { paperType: "case_series", checklist: "CARE", label: "Case series (a report of a run of similar patients)" };
  return { paperType: "observational", checklist: "STROBE", label: "Observational study (a study that watches what happened, without assigning treatment)" };
}
function thesisSource(input) {
  if (Array.isArray(input.pages) && input.pages.length)
    return input.pages.map((p) => String(p && p.text || "")).join("\n\n");
  return typeof input.text === "string" ? input.text : "";
}
function isDocx(input) {
  const format = String(input.format || "").toLowerCase();
  const name = String(input.filename || input.name || "").toLowerCase();
  return format === "docx" || /\.docx$/.test(name) || typeof input.docxBase64 === "string";
}
function phiPageList(input, hits) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const found = new Set();
  if (pages.length) {
    let cursor = 0;
    const spans = pages.map((p) => {
      const text = String(p && p.text || "");
      const start = cursor;
      cursor += text.length + 2;
      return { n: p && p.n, start, end: start + text.length };
    });
    for (const h of hits) {
      const span = spans.find((s) => h.start < s.end && h.end > s.start);
      if (span && span.n != null) found.add(span.n);
    }
    for (const p of pages) {
      if (p && p.n != null && scan(String(p.text || "")).blocked) found.add(p.n);
    }
  }
  return [...found];
}
function scrubNumbers(text, source) {
  const flags = [];
  const kept = [];
  const parts = String(text || "").split(/(?<=[.!?])\s+/);
  const out = [];
  for (const sentence of parts) {
    let removed = false;
    const next = sentence.replace(NUM_RE, (m) => {
      if (source.indexOf(m) >= 0) { kept.push(m); return m; }
      removed = true;
      return "";
    }).replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
    if (!next && !removed) continue;
    if (removed) {
      flags.push("check this number");
      out.push((next + " (check this number)").trim());
    } else if (next) out.push(next);
  }
  return { text: out.join(" "), flags: flags.length ? ["check this number"] : [], numbers: [...new Set(kept)] };
}
function locatorFor(value, pages, full) {
  let page = null;
  let table = "";
  const tableRe = /Table\s+\d+[A-Za-z]?/i;
  if (Array.isArray(pages)) {
    for (const p of pages) {
      if (p && String(p.text || "").indexOf(value) >= 0) {
        page = p.n == null ? null : p.n;
        const tm = String(p.text || "").match(tableRe);
        if (tm) table = tm[0].replace(/\s+/g, " ");
        break;
      }
    }
  }
  if (!table && full) {
    const idx = full.indexOf(value);
    if (idx >= 0) {
      const window = full.slice(Math.max(0, idx - 80), idx + String(value).length + 80);
      const tm = window.match(tableRe);
      if (tm) table = tm[0].replace(/\s+/g, " ");
    }
  }
  let label = "From your thesis";
  if (page != null && table) label = "From your thesis, page " + page + ", " + table;
  else if (page != null) label = "From your thesis, page " + page;
  else if (table) label = "From your thesis, " + table;
  return { page, table, label };
}
function thesisReferences(full, list) {
  const src = String(full || "");
  const lower = src.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const citation = asText(item.citation || item.text, 500);
    if (!citation || src.indexOf(citation) < 0) continue;
    const key = citation.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let doi = asText(item.doi, 200);
    let pmid = asText(item.pmid, 20);
    if (doi && lower.indexOf(doi.toLowerCase()) < 0) doi = "";
    if (pmid && src.indexOf(pmid) < 0) pmid = "";
    out.push({ citation, doi, pmid, flag: doi || pmid ? "" : "check this reference" });
    if (out.length >= 40) break;
  }
  return out;
}
function suggestedTables(text) {
  const seen = new Set();
  const out = [];
  const re = /Table\s+\d+[A-Za-z]?/gi;
  let m;
  while ((m = re.exec(String(text || ""))) !== null && out.length < 3) {
    const id = m[0].replace(/\s+/g, " ");
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const window = text.slice(Math.max(0, m.index - 60), m.index + id.length + 80);
    out.push({
      id,
      reason: /\d/.test(window)
        ? "This table sits next to a result number in the thesis."
        : "This table appears in the thesis.",
    });
  }
  return out;
}
function sectionText(raw) {
  const parsed = extractJson(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.text === "string") return parsed.text;
  const s = String(raw || "").trim();
  if (!s || s.charAt(0) === "{") return "";
  return s;
}
function budgetsFor(sections, wordLimit) {
  if (sections.length === 1) return new Map([[sections[0].id, wordLimit]]);
  const abstract = sections.find((s) => s.id === "abstract");
  const rest = sections.filter((s) => s.id !== "abstract");
  const abstractBudget = abstract ? Math.min(250, Math.max(1, wordLimit - rest.length)) : 0;
  const each = rest.length ? Math.max(1, Math.floor((wordLimit - (abstract ? abstractBudget : 0)) / rest.length)) : 0;
  const map = new Map();
  if (abstract) map.set("abstract", abstractBudget || 1);
  for (const s of rest) map.set(s.id, each || 1);
  return map;
}

async function thesisTask(ctx, projectId, input) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const textPresent = (typeof input.text === "string" && input.text.trim()) ||
    (Array.isArray(input.pages) && input.pages.some((p) => p && String(p.text || "").trim()));
  if (isDocx(input) && !textPresent) {
    return err(422, "docx_needs_pdf",
      "This file is a DOCX (Word document). Export it as PDF (in Word: File, then Save As, then PDF) and upload the PDF.",
      requestId);
  }
  const full = thesisSource(input);
  if (!full.trim())
    return err(400, "invalid_body", "Thesis text is required. Export a DOCX (Word document) as PDF and upload the PDF.", requestId);
  const report = scan(full);
  if (report.blocked) {
    const categories = phiCategories(report.hits);
    const pages = phiPageList(input, report.hits);
    await audit(db, projectId, uid, "ai_phi_blocked", "thesis", { categories, purpose: "thesis_to_paper", pages });
    return json({
      error: {
        code: "phi_blocked",
        message: "Patient identifiers (protected health information, PHI) were found. Remove them before MaiK reads this thesis.",
        requestId,
      },
      categories,
      pages,
    }, 422, { "x-request-id": requestId });
  }
  let journalLimit = null;
  if (typeof input.journalId === "string" && input.journalId) {
    const journal = await db.prepare("SELECT word_limit_main FROM research_journals WHERE id=?").bind(input.journalId).first();
    if (journal && Number.isInteger(journal.word_limit_main) && journal.word_limit_main > 0) journalLimit = journal.word_limit_main;
  }
  const requested = input.wordLimit != null ? input.wordLimit : (journalLimit || 3000);
  if (!Number.isInteger(requested) || requested < 1 || requested > 20000)
    return err(400, "invalid_body", "wordLimit must be an integer from 1 to 20000", requestId);
  const wordLimit = requested;
  let sections = THESIS_SECTIONS;
  if (input.section !== undefined && input.section !== null && input.section !== "") {
    const id = String(input.section).toLowerCase();
    const found = THESIS_SECTIONS.find((s) => s.id === id);
    if (!found) return err(400, "invalid_body", "section must be abstract, introduction, methods, results or discussion", requestId);
    sections = [found];
  }
  const suggestion = suggestDesign(full);
  const paperType = asText(input.paperType, 80) || suggestion.paperType;
  const checklist = asText(input.checklist, 40) || suggestion.checklist;
  const excerpt = full.slice(0, 20000);
  const budgets = budgetsFor(sections, wordLimit);
  const system = "You turn thesis text into one section of a journal article (IMRaD: Introduction, Methods, Results, Discussion). " +
    "Return ONLY JSON {\"text\":\"...\"}. Copy numbers exactly from the thesis. Do not invent or recompute a number. " +
    "Keep the author's wording where you can. Stay within the word budget.";
  let model = "";
  let costInr = 0;
  const drafted = [];
  const modelRefs = [];
  for (const section of sections) {
    const budget = budgets.get(section.id) || wordLimit;
    const prompt = "Section: " + section.heading + "\nWord budget: " + budget +
      "\nPaper type: " + paperType + "\nChecklist: " + checklist + "\n\nThesis text:\n" + excerpt;
    const out = await oneCall(ctx, projectId, "thesis_to_paper", system, prompt);
    if (out.error) return out.error;
    model = out.model || model;
    costInr += out.costInr || 0;
    const parsed = extractJson(out.text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.references))
      modelRefs.push(...parsed.references);
    const scrubbed = scrubNumbers(sectionText(out.text), full);
    const trimmed = trimWords(scrubbed.text, budget);
    const trimmedFlag = wordCount(scrubbed.text) > budget;
    const still = scrubbed.numbers.filter((n) => trimmed.indexOf(n) >= 0);
    drafted.push({
      id: section.id,
      heading: section.heading,
      text: trimmed,
      flags: scrubbed.flags,
      trimmedToWordLimit: trimmedFlag,
      numbers: still.map((value) => ({ value, locator: locatorFor(value, input.pages, full) })),
    });
  }
  let total = drafted.reduce((n, s) => n + wordCount(s.text), 0);
  let trimmedToWordLimit = drafted.some((s) => s.trimmedToWordLimit);
  if (total > wordLimit && drafted.length) {
    const last = drafted[drafted.length - 1];
    const over = total - wordLimit;
    const keep = Math.max(0, wordCount(last.text) - over);
    last.text = trimWords(last.text, keep);
    last.numbers = last.numbers.filter((n) => last.text.indexOf(n.value) >= 0);
    last.trimmedToWordLimit = true;
    trimmedToWordLimit = true;
    total = drafted.reduce((n, s) => n + wordCount(s.text), 0);
  }
  const draft = {
    paperType,
    checklist,
    suggestion,
    wordLimit,
    wordCount: total,
    trimmedToWordLimit,
    sections: drafted.map((s) => ({
      id: s.id, heading: s.heading, text: s.text, flags: s.flags, numbers: s.numbers,
    })),
    suggestedTables: suggestedTables(full),
    references: thesisReferences(full, modelRefs),
  };
  const stored = await storeDraft(ctx, projectId, "thesis_to_paper", draft, model, roundInr(costInr));
  return respond(ctx, stored, model, costInr);
}

function studySnippets(bits, input) {
  const extra = new Map();
  const list = Array.isArray(input.studies) ? input.studies : [];
  for (const s of list) {
    if (s && s.studyId) extra.set(s.studyId, asText(s.abstract || s.snippet || "", 1500));
  }
  return bits.studies.map((s) => ({
    studyId: s.id,
    label: s.label || "",
    snippet: (extra.get(s.id) || s.quote || "").slice(0, 1500),
  }));
}
function spellingOf(journalId) {
  const id = String(journalId || "").trim().toLowerCase();
  return AMERICAN_JOURNALS.has(id) ? "American" : "British";
}
function tokenBag(text) {
  const bag = new Map();
  const re = /\{\{run:[^}]*\}\}/g;
  let m;
  const src = String(text || "");
  while ((m = re.exec(src))) bag.set(m[0], (bag.get(m[0]) || 0) + 1);
  return bag;
}
function sameBag(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}
function maskRunTokens(text) {
  return String(text || "").replace(/\{\{run:[^}]*\}\}/g, " ");
}
function numberBag(text) {
  const bag = new Map();
  const re = /(?<![A-Za-z0-9.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
  let m;
  const src = maskRunTokens(text);
  while ((m = re.exec(src))) bag.set(m[0], (bag.get(m[0]) || 0) + 1);
  return bag;
}
function citeIds(text) {
  const src = maskRunTokens(text);
  const ids = new Set();
  let m;
  const keyRe = /\[@([A-Za-z0-9_:-]+)\]|\\cite\{([^}]+)\}/g;
  while ((m = keyRe.exec(src))) {
    const raw = m[1] || m[2] || "";
    for (const key of raw.split(",")) {
      const k = key.trim();
      if (k) ids.add("k:" + k);
    }
  }
  const numRe = /\[[0-9]+(?:\s*[,;]\s*[0-9]+|\s*-\s*[0-9]+)*\]/g;
  while ((m = numRe.exec(src))) {
    for (const part of m[0].slice(1, -1).split(/\s*[,;]\s*/)) {
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        let a = Number(range[1]);
        let b = Number(range[2]);
        if (a > b) { const t = a; a = b; b = t; }
        const span = Math.min(b, a + 30);
        for (let n = a; n <= span; n++) ids.add("n:" + n);
        if (b > span) ids.add("n:" + b);
      } else if (/^\d+$/.test(part)) ids.add("n:" + Number(part));
    }
  }
  const ayRe = /\(([A-Z][A-Za-z'\-]{2,})(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][A-Za-z'\-]{2,})?,?\s+((?:19|20)\d{2})\)/g;
  while ((m = ayRe.exec(src))) ids.add("y:" + m[1].toLowerCase() + "|" + m[2]);
  return ids;
}
function polishReason(raw, spelling) {
  const s = String(raw || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const map = {
    grammar: "grammar",
    grammatical: "grammar",
    clarity: "clarity",
    clear: "clarity",
    concision: "concision",
    concise: "concision",
    brevity: "concision",
    "academic tone": "academic tone",
    academic: "academic tone",
    tone: "academic tone",
    "tense consistency": "tense consistency",
    "tense consistent": "tense consistency",
    tense: "tense consistency",
    "british spelling": "British spelling",
    british: "British spelling",
    "american spelling": "American spelling",
    american: "American spelling",
    spelling: spelling === "American" ? "American spelling" : "British spelling",
  };
  const reason = map[s] || "";
  if (reason === "British spelling" && spelling !== "British") return "";
  if (reason === "American spelling" && spelling !== "American") return "";
  return reason;
}
/* Rejects a polish that drops a token, adds a number or citation, or grows
 * past 1.2x. Returns { error } or { polished, changes }. */
function checkPolish(parsed, source, spelling) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { error: "MaiK did not return a polish draft that could be checked." };
  if (typeof parsed.polished !== "string" || !parsed.polished.trim())
    return { error: "MaiK did not return polished text." };
  const polished = parsed.polished;
  if (!sameBag(tokenBag(source), tokenBag(polished)))
    return { error: "The polish dropped or changed a {{run:...}} token." };
  if (polished.length * 5 > source.length * 6)
    return { error: "The polish is longer than 1.2 times the section." };
  const srcNums = numberBag(source);
  for (const [k, n] of numberBag(polished)) {
    if ((srcNums.get(k) || 0) < n)
      return { error: "The polish added a number that was not in the section." };
  }
  const srcCites = citeIds(source);
  for (const id of citeIds(polished)) {
    if (!srcCites.has(id))
      return { error: "The polish added a citation that was not in the section." };
  }
  if (!Array.isArray(parsed.changes))
    return { error: "MaiK did not return a list of wording changes." };
  if (parsed.changes.length > POLISH_CHANGES_MAX)
    return { error: "Too many changes in one polish." };
  if (!parsed.changes.length && polished !== source)
    return { error: "The polish changed the text without listing the changes." };
  if (parsed.changes.length && polished === source)
    return { error: "The polish listed changes but the text is unchanged." };
  const changes = [];
  for (const c of parsed.changes) {
    if (!c || typeof c !== "object" || Array.isArray(c))
      return { error: "A wording change is missing before, after or reason." };
    if (typeof c.before !== "string" || typeof c.after !== "string")
      return { error: "A wording change is missing before, after or reason." };
    if (c.before === c.after)
      return { error: "A wording change has the same before and after text." };
    if (c.before && source.indexOf(c.before) < 0)
      return { error: "A change does not match the section text." };
    if (c.after && polished.indexOf(c.after) < 0)
      return { error: "A change does not match the polished text." };
    const reason = polishReason(c.reason, spelling);
    if (!reason) return { error: "A change reason is not allowed for this journal." };
    changes.push({ before: c.before, after: c.after, reason });
  }
  return { polished, changes };
}
async function polishTask(ctx, projectId, input) {
  const { db, requestId, api } = ctx;
  const { err } = api;
  const sectionId = asText(input.sectionId, 80);
  const journalId = asText(input.journalId, 80);
  let text = typeof input.text === "string" ? input.text : "";
  if (!text.trim()) {
    if (!sectionId) return err(400, "invalid_body", "Section text is required.", requestId);
    const version = await db.prepare("SELECT id FROM research_manuscript_versions WHERE project_id=? ORDER BY version DESC LIMIT 1")
      .bind(projectId).first();
    if (!version) return err(404, "manuscript_not_found", "Manuscript not found", requestId);
    const section = await db.prepare("SELECT text FROM research_manuscript_sections WHERE version_id=? AND section_id=?")
      .bind(version.id, sectionId).first();
    if (!section) return err(404, "section_not_found", "Section not found", requestId);
    text = String(section.text || "");
  }
  if (!text.trim()) return err(400, "invalid_body", "Section text is required.", requestId);
  if (text.length > POLISH_TEXT_MAX)
    return err(400, "invalid_body", "Section text must be 5000 characters or fewer.", requestId);
  const spelling = spellingOf(journalId);
  const spellingReason = spelling === "American" ? "American spelling" : "British spelling";
  const system = "You polish the wording of one manuscript section. Return ONLY JSON " +
    "{\"polished\":\"...\",\"changes\":[{\"before\":\"...\",\"after\":\"...\",\"reason\":\"...\"}]}. " +
    "Keep every {{run:...}} token unchanged and in the same count. " +
    "Do not add a number, a citation, or a new claim. Do not change the meaning. " +
    "polished must be at most 1.2 times the length of the section. " +
    "before is an exact phrase from the section. after is an exact phrase from polished. " +
    "reason is exactly one of: grammar, clarity, concision, academic tone, tense consistency, British spelling, American spelling. " +
    "For a spelling change use " + spellingReason + " only.";
  /* The header must not sit against the section. "British" then "Journal"
   * is a capitalised pair, and the PHI gate treats that as a name when the
   * word patient is within 40 characters. */
  const prompt = "Spelling to follow: " + spelling +
    "\nJournal id: " + (journalId || "(none)") +
    "\n\nThe section text is below. Polish only that section.\n\n" + text;
  const out = await oneCall(ctx, projectId, "polish", system, prompt);
  if (out.error) return out.error;
  const checked = checkPolish(extractJson(out.text), text, spelling);
  if (checked.error) return err(422, "invalid_draft", checked.error, requestId);
  const draft = {
    polished: checked.polished,
    changes: checked.changes,
    sectionId,
    journalId,
    spelling,
  };
  const stored = await storeDraft(ctx, projectId, "polish", draft, out.model, out.costInr || 0);
  return respond(ctx, stored, out.model, out.costInr || 0);
}

function tokenList(run) {
  if (!run) return [];
  let result = {};
  try { result = JSON.parse(run.result_json || "{}"); } catch (e) { result = {}; }
  return Object.keys(result).filter((k) => /^[A-Za-z0-9_]+$/.test(k)).map((k) => "{{run:" + run.id + "." + k + "}}");
}
function manuscriptTokenList(run) {
  if (!run) return [];
  let result = {};
  try { result = JSON.parse(run.result_json || "{}"); } catch (e) { result = {}; }
  const out = [];
  const seen = new Set();
  const add = (field) => {
    const tok = "{{run:" + run.id + "." + field + "}}";
    if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
  };
  for (const k of Object.keys(result)) {
    if (/^[A-Za-z0-9_]+$/.test(k) && typeof result[k] !== "object") add(k);
  }
  if (result.pooled && typeof result.pooled === "object") {
    for (const k of ["estimate", "effect", "ciLower", "ciUpper", "p"]) {
      if (result.pooled[k] != null || (k === "estimate" && result.pooled.effect != null)) add(k);
    }
  }
  if (result.heterogeneity && typeof result.heterogeneity === "object") {
    for (const k of ["i2", "tau2", "q", "df"]) {
      if (result.heterogeneity[k] != null) add(k);
    }
  }
  if (Array.isArray(result.weights)) add("k");
  return out;
}

export async function aiDraft(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "Ask MaiK needs an owner, editor or analyst role", requestId);
  const task = body && typeof body.task === "string" ? body.task : "";
  if (TASKS.indexOf(task) < 0)
    return err(400, "invalid_task", "Unknown task. Use protocol, search_query, rob, checklist, title_abstract, thesis_to_paper, polish, iec_application, consent_form, ctri_fields, publication_consent, case_report_draft or manuscript_draft.", requestId);
  const input = inputOf(body);
  if (task === "thesis_to_paper") return thesisTask(ctx, projectId, input);
  if (task === "polish") return polishTask(ctx, projectId, input);
  if (task === "case_report_draft") {
    const caseText = typeof input.caseText === "string" ? input.caseText : "";
    if (!caseText.trim()) {
      return err(400, "invalid_body", "Case text is required.", requestId);
    }
    const report = scan(caseText);
    if (report.blocked) {
      const categories = phiCategories(report.hits);
      await api.audit(db, projectId, uid, "ai_phi_blocked", "case_report_draft", { categories, purpose: "case_report_draft" });
      return ctx.api.json({
        error: { code: "phi_blocked", message: "Patient identifiers detected in case text.", requestId },
        categories,
      }, 422, { "x-request-id": requestId });
    }
  }

  const bits = await loadProjectBits(db, projectId);
  const project = bits.project || {};
  let system = "";
  let prompt = "";
  if (task === "protocol") {
    const added = (Array.isArray(input.studies) ? input.studies : []).map((s) => {
      const title = asText(s && s.title, 300);
      const abstract = asText(s && s.abstract, 500);
      return title ? title + ": " + abstract : "";
    }).filter(Boolean);
    const stored = bits.studies.map((s) => (s.label || "Study") + ": " + String(s.quote || "").slice(0, 400));
    system = "You draft a review protocol. Return ONLY JSON with title, pico {population, intervention, comparison, outcome}, " +
      "peco or null, eligibility (array of strings), outcomes {primary, secondary}, analysis {measure, model}. " +
      "measure is RR, OR, HR, MD or SMD. Do not invent results.";
    prompt = "Title: " + (project.title || "") +
      "\nPaper type: " + (project.study_type || "") +
      "\nQuestion: " + (project.research_question || "") +
      "\nOutcome notes: " + JSON.stringify(bits.protocol.outcomes || {}) +
      "\nStudies:\n" + stored.concat(added).slice(0, 30).join("\n");
  } else if (task === "search_query") {
    const pico = bits.protocol.pico || {};
    system = "You write a PubMed search and a Europe PMC variant. Return ONLY JSON {pubmed, europePmc}. " +
      "The PubMed query must have balanced round and square brackets and only PubMed field tags such as [tiab], [mh], [mesh], [au], [pt], [ti], [tw]. " +
      "Use MeSH (medical subject headings) and keywords. Keep the query focused with study-design terms when the study type is known (for example trials or cohorts) so it avoids returning tens of thousands of unrelated hits.";
    prompt = "Title: " + (project.title || "") +
      "\nStudy design: " + (project.study_type || "") +
      "\nPopulation (who was studied): " + (pico.population || project.research_question || project.title || "") +
      "\nIntervention: " + (pico.intervention || "") +
      "\nComparison: " + (pico.comparison || "") +
      "\nOutcome: " + ((bits.protocol.outcomes && bits.protocol.outcomes.primary) || pico.outcome || "");
  } else if (task === "rob") {
    const studies = studySnippets(bits, input);
    if (!studies.length) return err(422, "invalid_draft", "Add a study before asking for a Risk of Bias 2 (RoB 2) (could the study design have skewed its result) draft.", requestId);
    system = "You draft Risk of Bias 2 (RoB 2) domain judgements. Return ONLY JSON {studies:[{studyId, domains:[{key, judgement, reason, quote}]}]}. " +
      "keys are d1, d2, d3, d4, d5. judgement is low, some_concerns or high. " +
      "quote must be copied exactly from that study's snippet. If you cannot support a domain, leave judgement and quote empty.";
    prompt = studies.map((s) => "studyId: " + s.studyId + "\nLabel: " + s.label + "\nSnippet: " + s.snippet).join("\n\n");
    const out = await oneCall(ctx, projectId, task, system, prompt);
    if (out.error) return out.error;
    const draft = robDraft(extractJson(out.text), studies);
    if (!draft) return err(422, "invalid_draft", "MaiK did not return a Risk of Bias 2 (RoB 2) draft that could be checked.", requestId);
    const stored = await storeDraft(ctx, projectId, task, draft, out.model, out.costInr || 0);
    return respond(ctx, stored, out.model, out.costInr || 0);
  } else if (task === "checklist") {
    const guide = checklistItems(input.guidelineId || input.guideline || "strobe");
    if (!guide) return err(400, "invalid_body", "Unknown checklist. Use CARE, SPIRIT, PRISMA, STROBE or CONSORT.", requestId);
    const headings = bits.sections.map((s) => s.heading || s.section_id);
    if (bits.protocol && Object.keys(bits.protocol).length) headings.push("protocol");
    const brief = guide.items.slice(0, 40).map((item) => item.itemNum + " " + item.topic).join("\n");
    const manuscript = bits.sections.map((s) => (s.heading || s.section_id) + ": " + String(s.text || "").slice(0, 400)).join("\n");
    system = "You mark reporting-checklist items. Return ONLY JSON {items:[{itemNum, status, section}]}. " +
      "status is covered or missing. section is the manuscript heading or protocol when status is covered. " +
      "If you cannot point at a section, status is missing.";
    prompt = "Checklist: " + guide.name + "\nItems:\n" + brief +
      "\n\nProtocol: " + JSON.stringify(bits.protocol).slice(0, 2000) +
      "\n\nManuscript:\n" + manuscript;
    const out = await oneCall(ctx, projectId, task, system, prompt);
    if (out.error) return out.error;
    const draft = checklistDraft(extractJson(out.text), guide, headings);
    if (!draft) return err(422, "invalid_draft", "MaiK did not return a checklist draft that could be checked.", requestId);
    const stored = await storeDraft(ctx, projectId, task, draft, out.model, out.costInr || 0);
    return respond(ctx, stored, out.model, out.costInr || 0);
  } else if (task === "title_abstract") {
    const tokens = tokenList(bits.run);
    system = "You draft a paper title and a structured abstract. Return ONLY JSON {title, abstract:{background, methods, results, conclusions}}. " +
      "Any result number must be one of the allowed {{run:...}} tokens. Do not write any other digit.";
    prompt = "Title: " + (project.title || "") +
      "\nProtocol: " + JSON.stringify(bits.protocol).slice(0, 2000) +
      "\nAllowed tokens (use these exact strings, do not invent numbers): " + (tokens.join(", ") || "(none saved yet)");
  } else if (task === "iec_application") {
    const proto = bits.protocol || {};
    const ss = input.sampleSize ? JSON.stringify(input.sampleSize) : "";
    const notes = asText(input.notes || input.note, 2000);
    system = "You draft an Institutional Ethics Committee (IEC) application following ICMR National Ethical Guidelines (2017). " +
      "Return ONLY JSON with title, investigators (array of strings), background, objectives (array of strings), design, setting, duration, sampleSize, inclusion (array of strings), exclusion (array of strings), methodology, statisticalAnalysis, risks, benefits, confidentiality, compensation, conflictOfInterest, funding, consentProcess, vulnerablePopulations. " +
      "Use plain clear English. Do not invent investigator names, phone numbers or emails. If not provided, leave investigators as an empty array [].";
    prompt = "Title: " + (project.title || "") +
      "\nStudy type: " + (project.study_type || "") +
      "\nQuestion: " + (project.research_question || "") +
      "\nProtocol: " + JSON.stringify(proto).slice(0, 3000) +
      (ss ? "\nSample size: " + ss : "") +
      (notes ? "\nNotes: " + notes : "");
  } else if (task === "consent_form") {
    const proto = bits.protocol || {};
    const reqLower = String(input.language || "").trim().toLowerCase();
    const lang = LANG_MAP[reqLower] || input.language || "English";
    const code = CODE_BY_NAME[reqLower] || CODE_BY_NAME[lang.toLowerCase()] || "en";
    const notes = asText(input.notes || input.note, 2000);
    const langObj = CONSENT_LANGUAGES_LIST.find((item) => item.code === code) || { name: lang, script: "local script" };
    system = "You draft an informed consent document including a Participant Information Sheet (PIS) and Informed Consent Form (ICF) according to ICMR ethical guidelines. " +
      "Reading level: simple short sentences for participants. Use numbers in Western digits (0-9). For medical terms, write the medical term followed by the plain local word in brackets. " +
      "Return ONLY JSON {participantInformationSheet:{title, purpose, procedures, duration, risks, benefits, alternatives, confidentiality, voluntary, contact}, consentForm:{statements:[string], signatureBlock:string}, language:string}. " +
      "Do not invent contact phone numbers or emails. Leave contact empty or 'Fill this in'. " +
      (code !== "en"
        ? "Since the language is " + lang + ", return BOTH englishVersion and translatedVersion objects in the JSON, each of the same {participantInformationSheet, consentForm, language} shape. " +
          "translatedVersion must be written in " + lang + " using " + langObj.script + " script (at least 60% of letters from the target script's Unicode block), simple short sentences, numbers in Western digits."
        : "");
    prompt = "Title: " + (project.title || "") +
      "\nStudy type: " + (project.study_type || "") +
      "\nQuestion: " + (project.research_question || "") +
      "\nLanguage: " + lang + " (" + code + ")" +
      (notes ? "\nNotes: " + notes : "") +
      "\nProtocol: " + JSON.stringify(proto).slice(0, 3000);
  } else if (task === "ctri_fields") {
    const proto = bits.protocol || {};
    const ss = input.sampleSize ? JSON.stringify(input.sampleSize) : "";
    const notes = asText(input.notes || input.note, 2000);
    system = "You draft Clinical Trials Registry - India (CTRI) registration fields. Return ONLY JSON with: " +
      "publicTitle, scientificTitle, studyType, phase, condition, intervention, comparator, inclusion, exclusion, primaryOutcome {outcome, timepoint}, secondaryOutcomes (array of strings), targetSampleSize, sites, recruitmentStatus, ethicsCommittee, regulatoryClearance, fundingSource, briefSummary. " +
      "briefSummary must be at most 300 words. recruitmentStatus must be 'Not Yet Recruiting'. " +
      "Do not invent investigator names, phone numbers, emails, ethics committee approval numbers or regulatory clearance numbers. Leave ethicsCommittee and regulatoryClearance as empty string ''.";
    prompt = "Title: " + (project.title || "") +
      "\nStudy type: " + (project.study_type || "") +
      "\nQuestion: " + (project.research_question || "") +
      "\nProtocol: " + JSON.stringify(proto).slice(0, 3000) +
      (ss ? "\nSample size: " + ss : "") +
      (notes ? "\nNotes: " + notes : "");
  } else if (task === "publication_consent") {
    const reqLower = String(input.language || "").trim().toLowerCase();
    const lang = LANG_MAP[reqLower] || input.language || "English";
    const code = CODE_BY_NAME[reqLower] || CODE_BY_NAME[lang.toLowerCase()] || "en";
    const includesImages = !!input.includesImages;
    const journalName = asText(input.journalName, 200);
    const langObj = CONSENT_LANGUAGES_LIST.find((item) => item.code === code) || { name: lang, script: "local script" };
    system = "You draft a formal patient consent for publication document for a medical case report according to international guidelines (COPE and ICMJE). " +
      "Reading level: clear and respectful for patients or their representatives. Simple short sentences. Numbers in Western digits (0-9). Medical terms followed by the plain local word in brackets. " +
      "Return ONLY JSON {english: string, local: string, languageName: string}. " +
      "The document must cover all required elements in both English and " + lang + " (written in " + langObj.script + " script): " +
      "1) What will be published (text, clinical details, and " + (includesImages ? "clinical images" : "images if any") + "); " +
      "2) May be read worldwide including online access; " +
      "3) Name will not be used, but someone may still recognise the case; " +
      "4) Patient can withdraw consent at any time before publication; " +
      "5) Medical care and treatment will not be affected in any way; " +
      "6) Signature or thumb impression with witness; " +
      "7) Date; " +
      "8) Next of kin or legally acceptable representative option (if patient is unable to sign); " +
      "9) List of images included. " +
      "Also include the note: 'Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal\\'s instructions.' " +
      "Do not invent contact phone numbers or emails. Leave contact lines empty or as blank lines. " +
      (code !== "en" ? "The local field must be written in " + lang + " script (at least 60% of letters from the target script's Unicode block), with simple short sentences, numbers in Western digits, medical terms followed by the plain local word." : "");
    prompt = "Title: " + (project.title || "") +
      "\nStudy type: " + (project.study_type || "case-report") +
      "\nLanguage: " + lang + " (" + code + ")" +
      (journalName ? "\nJournal: " + journalName : "") +
      "\nIncludes images: " + includesImages;
  } else if (task === "case_report_draft") {
    const caseText = typeof input.caseText === "string" ? input.caseText : "";
    system = "You draft a clinical case report manuscript from de-identified case notes following CARE guidelines. " +
      "Return ONLY JSON {sections:{title, abstract, introduction, casePresentation, timeline, discussion, conclusion, patientPerspective, learningPoints}}. " +
      "learningPoints must be an array of strings. patientPerspective is a string or empty string ''. " +
      "Do not invent facts, numbers, dates, patient names, or hospital numbers. " +
      "All facts and numbers must come directly from the case text.";
    prompt = "Project title: " + (project.title || "") +
      "\nCase notes:\n" + caseText;
  } else if (task === "manuscript_draft") {
    const tokens = manuscriptTokenList(bits.run);
    const titleText = asText(input.title || project.title, 300);
    const studyType = asText(input.studyType || project.study_type, 120);
    const question = asText(input.researchQuestion || project.research_question, 1000);
    const notes = asText(input.notes || input.note, 2000);
    const journalId = asText(input.journalId, 80);
    const studyList = bits.studies.slice(0, 20)
      .map((s) => (s.label || "Study") + ": " + String(s.quote || "").slice(0, 250))
      .join("\n");
    system = "You draft an IMRaD medical research manuscript (Abstract, Introduction, Methods, Results, Discussion). " +
      "Return ONLY JSON {title, sections:[{id, heading, text}]} where id is one of abstract, introduction, methods, results, discussion. " +
      "For Abstract and Results, any statistical result must be one of the allowed {{run:...}} tokens. Do not invent or compute numbers. " +
      "Do not invent citations, patient identifiers, or unverified claims.";
    prompt = "Title: " + titleText +
      "\nStudy type: " + studyType +
      "\nResearch question: " + question +
      (journalId ? "\nTarget journal: " + journalId : "") +
      (notes ? "\nNotes: " + notes : "") +
      "\nProtocol: " + JSON.stringify(bits.protocol).slice(0, 2000) +
      "\nAllowed result tokens (use these exact strings, do not invent numbers): " + (tokens.join(", ") || "(none saved yet)") +
      (studyList ? "\nIncluded study notes:\n" + studyList : "");
  }

  const out = await oneCall(ctx, projectId, task, system, prompt);
  if (out.error) return out.error;
  const parsed = extractJson(out.text);
  let draft = null;
  if (task === "protocol") draft = protocolDraft(parsed);
  else if (task === "search_query") draft = searchDraft(parsed);
  else if (task === "title_abstract") draft = titleDraft(parsed);
  else if (task === "iec_application") draft = iecDraft(parsed);
  else if (task === "consent_form") draft = consentDraft(parsed, input.language);
  else if (task === "ctri_fields") draft = ctriDraft(parsed);
  else if (task === "publication_consent") draft = publicationConsentDraft(parsed, input.language);
  else if (task === "case_report_draft") draft = caseReportDraft(parsed);
  else if (task === "manuscript_draft") draft = manuscriptDraft(parsed, project.title || input.title || "");
  if (!draft) return err(422, "invalid_draft", "MaiK did not return a draft that matched the required fields.", requestId);
  const stored = await storeDraft(ctx, projectId, task, draft, out.model, out.costInr || 0);
  return respond(ctx, stored, out.model, out.costInr || 0);
}
