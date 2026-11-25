/* ResearchMD journal format check (ES module, server side).
 * Contract: docs/research/contracts/phase-5/polish-format-import.md.
 *
 * GET /v1/projects/{pid}/format-check?journal=<id>
 * Deterministic. No model call and no MaiK tokens. Read role: every member.
 * An outsider gets 404. Unknown journal or no manuscript is 404.
 *
 * Limits that the journal row does not store (title words, tables, figures,
 * reference count) stay null. A null limit is "warn": the file does not
 * state a number, so the check is not scored pass or fail. Tests may pass
 * journal.limits to score those checks. Word limits and reference style
 * come from the research_journals row (_journals.js).
 */
import { loadJournal } from "./_journals.js";
import { checklistItems } from "./_checklists.js";

const READ_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const TOKEN_RE = /\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}/g;
const LOOSE_RE = /\{\{run:([^}]*)\}\}/g;
const NUMBERED_RE = /\[[0-9]+(?:\s*[,;]\s*[0-9]+|\s*-\s*[0-9]+)*\]/g;
const KEY_RE = /\[@([A-Za-z0-9_:-]+)\]|\\cite\{([^}]+)\}/g;
const AUTHOR_YEAR_RE = /\(([A-Z][A-Za-z'\-]{2,})(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][A-Za-z'\-]{2,})?,?\s+((?:19|20)\d{2})\)/g;

const TYPE_CHECKLIST = {
  rct: "consort",
  randomised: "consort",
  randomized: "consort",
  randomized_trial: "consort",
  cohort: "strobe",
  observational: "strobe",
  cross_sectional: "strobe",
  case_control: "strobe",
  diagnostic_accuracy: "stard",
  diagnostic: "stard",
  prognostic: "tripod",
  systematic_review: "prisma",
  meta_analysis: "prisma",
  case_report: "care",
  case_series: "care",
  protocol: "spirit",
};
const CHECKLIST_PLAIN = {
  consort2010: "CONSORT (the randomised trial report checklist)",
  strobe: "STROBE (the observational study report checklist)",
  prisma2020: "PRISMA (the systematic review report checklist)",
  stard2015: "STARD (the diagnostic accuracy report checklist)",
  tripod: "TRIPOD (the prediction model report checklist)",
  care: "CARE (the case report checklist)",
  spirit: "SPIRIT (the trial protocol checklist)",
};
const REQUIRED = [
  { id: "introduction", re: /introduc/, label: "Introduction (why the study was done)" },
  { id: "methods", re: /\bmethods?\b|materials and methods/, label: "Methods (what was done)" },
  { id: "results", re: /\bresults?\b/, label: "Results (what was found)" },
  { id: "discussion", re: /discussion/, label: "Discussion (what the findings mean)" },
  { id: "ethics", re: /ethic/, label: "Ethics (approval and consent)" },
  { id: "funding", re: /funding|financial support|sources of funding/, label: "Funding (who paid for the work)" },
  { id: "conflicts", re: /conflict|competing interest|\bcoi\b/, label: "Conflicts of interest (relationships that could sway the paper)" },
  { id: "data_availability", re: /data availability|data sharing|availability of data/, label: "Data availability (where the data can be obtained)" },
];
const ABSTRACT_HEADS = [
  { name: "Background or Objective", re: /\b(?:background|objectives?|aims?)\s*:/i },
  { name: "Methods", re: /\b(?:methods?|methodology|materials and methods)\s*:/i },
  { name: "Results", re: /\bresults?\s*:/i },
  { name: "Conclusion", re: /\bconclusions?\s*:/i },
];

function words(text) {
  const m = String(text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}
function parseJson(text, fallback) {
  try { const v = JSON.parse(text || ""); return v == null ? fallback : v; } catch { return fallback; }
}
function integerLimit(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function journalLimit(journal, key) {
  const bag = journal && journal.limits;
  if (!bag || typeof bag !== "object") return null;
  return integerLimit(bag[key]);
}
function sectionBlob(section) {
  return (String(section && section.id || "") + " " + String(section && section.heading || "")).toLowerCase();
}
function findSection(sections, re) {
  return (sections || []).find((s) => re.test(sectionBlob(s)) && String(s.text || "").trim());
}
function maskTokens(text) {
  return String(text || "").replace(new RegExp(TOKEN_RE.source, "g"), " ");
}
function styleFamily(style) {
  const s = String(style || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!s) return "";
  if (s === "vancouver" || s === "ama" || s === "nlm" || s === "numbered" || s === "icmje") return "numbered";
  if (s === "harvard" || s === "apa" || s === "author-year") return "author-year";
  return "";
}
function distinctLabels(text, word) {
  const re = new RegExp("\\b" + word + "\\s+(\\d+[A-Za-z]?)\\b", "gi");
  const set = new Set();
  let m;
  const src = String(text || "");
  while ((m = re.exec(src))) set.add(m[1].toLowerCase());
  return set.size;
}
function expandNumbers(raw) {
  const nums = [];
  for (const part of String(raw || "").split(/\s*[,;]\s*/)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) { const t = a; a = b; b = t; }
      if (b - a > 30) { nums.push(a, b); continue; }
      for (let n = a; n <= b; n++) nums.push(n);
    } else if (/^\d+$/.test(part)) nums.push(Number(part));
  }
  return nums;
}
function familyOf(ref) {
  const first = Array.isArray(ref && ref.authors) ? String(ref.authors[0] || "") : "";
  if (!first.trim()) return "";
  const family = first.indexOf(",") >= 0 ? first.split(",")[0] : first.trim().split(/\s+/)[0];
  return family.toLowerCase().replace(/[^a-z]/g, "");
}
function keywordsOf(sections) {
  const own = (sections || []).find((s) => /keyword/.test(sectionBlob(s)));
  let text = own ? String(own.text || "") : "";
  if (!text.trim()) {
    const blob = (sections || []).map((s) => String(s.text || "")).join("\n");
    const m = blob.match(/(?:^|\n)\s*keywords?\s*:\s*([^\n]+)/i);
    text = m ? m[1] : "";
  }
  return text.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}
function walkPaths(node, prefix, out) {
  if (!node || typeof node !== "object") return;
  for (const k of Object.keys(node)) {
    if (!/^[A-Za-z0-9_]+$/.test(k)) continue;
    const path = prefix ? prefix + "." + k : k;
    const v = node[k];
    if (typeof v === "number" && Number.isFinite(v)) out.add(path);
    else if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) out.add(path);
    else if (v && typeof v === "object" && !Array.isArray(v)) walkPaths(v, path, out);
  }
}
function item(check, status, detail, sectionId) {
  const labels = {
    word_count: "Word count (how many words the paper has)",
    abstract: "Abstract (the short summary at the front)",
    title_length: "Title length (how long the title is)",
    tables_figures: "Tables and figures (the extra displays after the text)",
    reference_count: "Reference count (how many papers are in the list)",
    reference_style: "Reference style (numbered Vancouver or AMA, or author-year)",
    run_tokens: "Run tokens (saved result numbers written as {{run:...}})",
    citations: "Citations (every paper mentioned is listed, and every listed paper is mentioned)",
    keywords: "Keywords (the short subject words under the abstract)",
    required_sections: "IMRaD sections (Introduction, Methods, Results and Discussion, plus ethics, funding, conflicts and data availability)",
    reporting_checklist: "Reporting checklist (how much of the paper-type checklist is filled in)",
  };
  return { check, status, detail, label: labels[check] || check, sectionId: sectionId || check };
}

function mainSections(sections) {
  const skip = /abstract|reference|bibliograph|keyword|ethic|funding|financial|conflict|competing|\bcoi\b|data availability|data sharing|availability of data|title/;
  const body = (sections || []).filter((s) => !skip.test(sectionBlob(s)));
  return body.length ? body : (sections || []);
}

function checkWordCount(spec) {
  const journal = spec.journal || {};
  const limit = integerLimit(journal.wordLimits && journal.wordLimits.main);
  const name = journal.name || "This journal";
  const n = mainSections(spec.sections).reduce((sum, s) => sum + words(s.text), 0);
  const sectionId = findSection(spec.sections, /\bresults?\b/) ? "results" : "manuscript";
  if (limit == null) {
    return item("word_count", "warn",
      n + " words in the main text. No main-text word limit is on file for " + name + ".", sectionId);
  }
  if (n > limit) {
    return item("word_count", "fail",
      n + " words in the main text. The limit on file is " + limit + ".", sectionId);
  }
  return item("word_count", "pass",
    n + " words in the main text, within the " + limit + " word limit.", sectionId);
}

function checkAbstract(spec) {
  const journal = spec.journal || {};
  const name = journal.name || "This journal";
  const limit = integerLimit(journal.wordLimits && journal.wordLimits.abstract);
  const section = (spec.sections || []).find((s) => /abstract/.test(sectionBlob(s)));
  if (!section || !String(section.text || "").trim()) {
    return item("abstract", "fail", "The abstract is missing.", "abstract");
  }
  const text = String(section.text).replace(/(?:^|\n)\s*keywords?\s*:[^\n]*/gi, "\n");
  const missing = ABSTRACT_HEADS.filter((h) => !h.re.test(text)).map((h) => h.name);
  const n = words(text);
  if (missing.length) {
    return item("abstract", "fail",
      "The abstract is missing " + missing.join(", ") + ". A structured abstract needs those headings.", "abstract");
  }
  if (limit == null) {
    return item("abstract", "warn",
      "The abstract is " + n + " words and has Background or Objective, Methods, Results and Conclusion. No abstract word limit is on file for " + name + ".",
      "abstract");
  }
  if (n > limit) {
    return item("abstract", "fail",
      "The abstract is " + n + " words. The limit on file is " + limit + ". The structured headings are present.", "abstract");
  }
  return item("abstract", "pass",
    "The abstract is " + n + " words, within the " + limit + " word limit, and the structured headings are present.",
    "abstract");
}

function checkTitle(spec) {
  const title = String(spec.title || "").trim();
  const limit = journalLimit(spec.journal, "titleWords");
  const name = (spec.journal && spec.journal.name) || "This journal";
  const n = words(title);
  if (!title) return item("title_length", "fail", "The title is empty.", "title");
  if (limit == null) {
    return item("title_length", "warn",
      "The title is " + n + " words. No title length limit is on file for " + name + ".", "title");
  }
  if (n > limit) {
    return item("title_length", "fail",
      "The title is " + n + " words. The limit on file is " + limit + ".", "title");
  }
  return item("title_length", "pass",
    "The title is " + n + " words, within the " + limit + " word limit.", "title");
}

function checkTables(spec) {
  const blob = (spec.sections || []).map((s) => s.text || "").join("\n");
  const tables = distinctLabels(blob, "Table");
  const figures = distinctLabels(blob, "Figure");
  const tableLimit = journalLimit(spec.journal, "tables");
  const figureLimit = journalLimit(spec.journal, "figures");
  const name = (spec.journal && spec.journal.name) || "This journal";
  const counted = tables + " table" + (tables === 1 ? "" : "s") + " and " + figures + " figure" + (figures === 1 ? "" : "s");
  const over = [];
  if (tableLimit != null && tables > tableLimit) over.push(tables + " tables, limit " + tableLimit);
  if (figureLimit != null && figures > figureLimit) over.push(figures + " figures, limit " + figureLimit);
  if (over.length) return item("tables_figures", "fail", counted + ". Over the limit on file: " + over.join("; ") + ".", "results");
  if (tableLimit == null || figureLimit == null) {
    return item("tables_figures", "warn",
      counted + ". No table or figure limit is on file for " + name + ".", "results");
  }
  return item("tables_figures", "pass",
    counted + ", within the limits on file (" + tableLimit + " tables, " + figureLimit + " figures).", "results");
}

function checkReferenceCount(spec) {
  const n = Array.isArray(spec.references) ? spec.references.length : 0;
  const limit = journalLimit(spec.journal, "references");
  const name = (spec.journal && spec.journal.name) || "This journal";
  if (limit == null) {
    return item("reference_count", "warn",
      n + " references. No reference count limit is on file for " + name + ".", "references");
  }
  if (n > limit) {
    return item("reference_count", "fail",
      n + " references. The limit on file is " + limit + ".", "references");
  }
  return item("reference_count", "pass",
    n + " references, within the " + limit + " reference limit.", "references");
}

function bodyText(sections) {
  return (sections || []).filter((s) => !/reference|bibliograph/.test(sectionBlob(s)))
    .map((s) => String(s.text || "")).join("\n");
}
function citeScan(text) {
  const src = maskTokens(text);
  const numbered = new Set();
  const numberedRe = new RegExp(NUMBERED_RE.source, "g");
  let m;
  while ((m = numberedRe.exec(src))) {
    for (const n of expandNumbers(m[0].slice(1, -1))) numbered.add(n);
  }
  const keys = new Set();
  const keyRe = new RegExp(KEY_RE.source, "g");
  while ((m = keyRe.exec(src))) {
    const raw = m[1] || m[2] || "";
    for (const key of raw.split(",").map((k) => k.trim()).filter(Boolean)) keys.add(key);
  }
  const authorYear = [];
  const ayRe = new RegExp(AUTHOR_YEAR_RE.source, "g");
  while ((m = ayRe.exec(src))) authorYear.push({ family: m[1].toLowerCase(), year: Number(m[2]) });
  return { numbered, keys, authorYear };
}

function checkReferenceStyle(spec) {
  const family = styleFamily(spec.journal && spec.journal.referenceStyle);
  const name = (spec.journal && spec.journal.name) || "This journal";
  const style = spec.journal && spec.journal.referenceStyle;
  const scan = citeScan(bodyText(spec.sections));
  const numbered = scan.numbered.size;
  const authorYear = scan.authorYear.length;
  if (!family) {
    const why = style
      ? "Reference style on file (" + style + ") is not numbered or author-year, so consistency was not scored."
      : "No reference style is on file for " + name + ", so numbered versus author-year was not scored.";
    return item("reference_style", "warn", why, "references");
  }
  const want = family === "numbered" ? "numbered (Vancouver or AMA)" : "author-year";
  if (numbered && authorYear) {
    return item("reference_style", "fail",
      "The text mixes numbered citations and author-year citations. " + name + " asks for " + want + ".", "references");
  }
  if (family === "numbered" && authorYear && !numbered) {
    return item("reference_style", "fail",
      "The text uses author-year citations. " + name + " asks for numbered citations.", "references");
  }
  if (family === "author-year" && numbered && !authorYear) {
    return item("reference_style", "fail",
      "The text uses numbered citations. " + name + " asks for author-year citations.", "references");
  }
  if ((family === "numbered" && numbered) || (family === "author-year" && authorYear)) {
    return item("reference_style", "pass",
      "In-text citations match the " + want + " style on file for " + name + ".", "references");
  }
  if (scan.keys.size) {
    return item("reference_style", "warn",
      "Citations are still keys such as [@smith2020]. " + name + " asks for " + want + ", applied when the reference list is formatted.",
      "references");
  }
  return item("reference_style", "warn",
    "No in-text citations to compare with the " + want + " style on file for " + name + ".", "references");
}

function checkRunTokens(spec) {
  const paths = spec.resolvedTokens instanceof Set
    ? spec.resolvedTokens
    : new Set(spec.resolvedTokens || []);
  const bad = [];
  let total = 0;
  for (const section of spec.sections || []) {
    const text = String(section.text || "");
    const loose = new RegExp(LOOSE_RE.source, "g");
    let m;
    while ((m = loose.exec(text))) {
      if (new RegExp("^" + TOKEN_RE.source + "$").test(m[0])) continue;
      bad.push(m[0]);
    }
    const re = new RegExp(TOKEN_RE.source, "g");
    while ((m = re.exec(text))) {
      total++;
      const key = m[1] + "." + m[2];
      const field = m[2].toLowerCase();
      const ci = field === "ci" || field === "ci95" || field === "confidence_interval";
      const ok = paths.has(key) || (ci && paths.has(m[1] + ".ciLower") && paths.has(m[1] + ".ciUpper"));
      if (!ok) bad.push(m[0]);
    }
  }
  const where = (spec.sections || []).find((s) => /\{\{run:/.test(String(s.text || "")));
  const sectionId = where ? (where.id || "results") : "results";
  if (bad.length) {
    const shown = [...new Set(bad)].slice(0, 5).join(", ");
    return item("run_tokens", "fail",
      "Unresolved run token" + (bad.length === 1 ? "" : "s") + ": " + shown + ".", sectionId);
  }
  if (!total) return item("run_tokens", "pass", "No run tokens in the manuscript.", "results");
  return item("run_tokens", "pass",
    total + " run token" + (total === 1 ? "" : "s") + ", each resolved from a saved run.", sectionId);
}

function checkCitations(spec) {
  const refs = Array.isArray(spec.references) ? spec.references : [];
  const scan = citeScan((spec.sections || []).map((s) => s.text || "").join("\n"));
  const uncited = [];
  refs.forEach((ref, i) => {
    const n = i + 1;
    const key = ref && ref.key ? String(ref.key) : "";
    const family = familyOf(ref);
    const year = ref && ref.year != null ? Number(ref.year) : null;
    const byKey = key && scan.keys.has(key);
    const byNumber = scan.numbered.has(n);
    const byAuthor = family && year && scan.authorYear.some((c) => c.family === family && c.year === year);
    if (!byKey && !byNumber && !byAuthor) uncited.push(key || ("reference " + n));
  });
  const knownKeys = new Set(refs.map((r) => r && r.key).filter(Boolean));
  const missing = [];
  for (const key of scan.keys) if (!knownKeys.has(key)) missing.push("[@" + key + "]");
  for (const n of scan.numbered) if (n < 1 || n > refs.length) missing.push("[" + n + "]");
  for (const c of scan.authorYear) {
    const hit = refs.some((r) => familyOf(r) === c.family && Number(r && r.year) === c.year);
    if (!hit) missing.push("(" + c.family + ", " + c.year + ")");
  }
  if (!refs.length && !scan.keys.size && !scan.numbered.size && !scan.authorYear.length) {
    return item("citations", "warn", "No reference list yet, and no in-text citations.", "references");
  }
  if (uncited.length || missing.length) {
    const bits = [];
    if (uncited.length) bits.push("Not cited in the text: " + uncited.slice(0, 5).join(", "));
    if (missing.length) bits.push("In the text but not in the list: " + missing.slice(0, 5).join(", "));
    return item("citations", "fail", bits.join(". ") + ".", "references");
  }
  return item("citations", "pass",
    refs.length + " reference" + (refs.length === 1 ? "" : "s") + ", each cited in the text, and every in-text citation is in the list.",
    "references");
}

function checkKeywords(spec) {
  const list = keywordsOf(spec.sections);
  const section = (spec.sections || []).find((s) => /keyword/.test(sectionBlob(s)));
  const sectionId = section ? (section.id || "keywords") : "keywords";
  if (list.length >= 3 && list.length <= 6) {
    return item("keywords", "pass", list.length + " keywords, within 3 to 6.", sectionId);
  }
  if (!list.length) return item("keywords", "fail", "No keywords. A paper needs 3 to 6.", sectionId);
  return item("keywords", "fail",
    list.length + " keyword" + (list.length === 1 ? "" : "s") + ". A paper needs 3 to 6.", sectionId);
}

function checkRequired(spec) {
  const missing = REQUIRED.filter((req) => !findSection(spec.sections, req.re));
  if (!missing.length) {
    return item("required_sections", "pass",
      "Introduction, Methods, Results, Discussion, ethics, funding, conflicts and data availability are present.",
      "introduction");
  }
  return item("required_sections", "fail",
    "Missing: " + missing.map((m) => m.label).join("; ") + ".", missing[0].id);
}

function checkChecklist(spec) {
  const box = spec.checklist;
  if (!box || !box.total) {
    const why = spec.studyType
      ? "Paper type \"" + spec.studyType + "\" has no reporting checklist on file."
      : "Paper type is not set, so no reporting checklist was scored.";
    return item("reporting_checklist", "warn", why, "checklist");
  }
  const filled = box.filled || 0;
  const total = box.total;
  const percent = filled >= total ? 100 : Math.floor((filled * 100) / total);
  const name = box.plain || box.name || "The checklist";
  const detail = name + " is " + percent + "% complete (" + filled + " of " + total + " items).";
  if (filled >= total) return item("reporting_checklist", "pass", detail, "checklist");
  if (!filled) return item("reporting_checklist", "fail", detail, "checklist");
  return item("reporting_checklist", "warn", detail, "checklist");
}

/* Pure checker. spec: { title, sections, references, journal, resolvedTokens, studyType, checklist }. */
export function buildFormatChecks(spec) {
  const src = spec || {};
  return [
    checkWordCount(src),
    checkAbstract(src),
    checkTitle(src),
    checkTables(src),
    checkReferenceCount(src),
    checkReferenceStyle(src),
    checkRunTokens(src),
    checkCitations(src),
    checkKeywords(src),
    checkRequired(src),
    checkChecklist(src),
  ];
}

function resolvedFromRuns(runs, tokensJson) {
  const paths = new Set();
  for (const run of runs || []) {
    const result = parseJson(run.result_json, {});
    const found = new Set();
    walkPaths(result, "", found);
    for (const path of found) paths.add(run.id + "." + path);
  }
  const stored = parseJson(tokensJson, {});
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const key of Object.keys(stored)) {
      const entry = stored[key];
      if (!entry || typeof entry !== "object") continue;
      const norm = key.indexOf(":") >= 0 && key.indexOf(".") < 0 ? key.replace(":", ".") : key;
      if (entry.value != null) paths.add(norm);
    }
  }
  return paths;
}

export async function formatCheck(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, gate.status === 404 ? "Project not found" : "Project access denied", requestId);
  const journalId = (url.searchParams.get("journal") || "").trim();
  if (!journalId) return err(400, "invalid_body", "journal is required", requestId);
  const journal = await loadJournal(db, journalId);
  if (!journal) return err(404, "journal_not_found", "Journal not found", requestId);
  const row = await db.prepare("SELECT * FROM research_manuscript_versions WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  if (!row) return err(404, "manuscript_not_found", "Manuscript not found", requestId);
  const sectionRows = (await db.prepare("SELECT * FROM research_manuscript_sections WHERE version_id=? ORDER BY sort_order ASC, section_id ASC")
    .bind(row.id).all()).results || [];
  const sections = sectionRows.map((s) => ({ id: s.section_id, heading: s.heading, text: s.text }));
  const runs = (await db.prepare("SELECT id, result_json FROM research_runs WHERE project_id=?").bind(projectId).all()).results || [];
  const studyType = String((gate.project && gate.project.study_type) || "");
  const guideId = TYPE_CHECKLIST[studyType] || "";
  const guide = guideId ? checklistItems(guideId) : null;
  let checklist = null;
  if (guide) {
    const manual = (await db.prepare("SELECT item_num, text FROM research_checklist_manual WHERE project_id=? AND guideline_id=?")
      .bind(projectId, guide.id).all()).results || [];
    const nums = new Set(guide.items.map((itemRow) => itemRow.itemNum));
    const filled = manual.filter((m) => nums.has(m.item_num) && String(m.text || "").trim()).length;
    checklist = {
      id: guide.id,
      name: guide.name,
      plain: CHECKLIST_PLAIN[guide.id] || guide.name,
      total: guide.items.length,
      filled,
    };
  }
  const checks = buildFormatChecks({
    title: row.title || "",
    sections,
    references: parseJson(row.references_json, []),
    journal: {
      id: journal.id,
      name: journal.name,
      wordLimits: journal.wordLimits,
      referenceStyle: journal.referenceStyle,
      limits: {},
    },
    resolvedTokens: resolvedFromRuns(runs, row.tokens_json),
    studyType,
    checklist,
  });
  return json({ journalId: journal.id, journalName: journal.name, checks }, 200, { "x-request-id": requestId });
}
