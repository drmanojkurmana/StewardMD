/* ResearchMD Phase 5A.3 manuscript API (ES module, server side).
 * Contract: docs/research/contracts/phase-5/manuscript-api.md.
 * Numbers stay canonical {{run:<id>.<field>}} tokens (tokens.md). This module
 * looks up values already stored on a run or in the draft token table. It
 * never runs the stats engine and never rewrites a token into a number.
 *
 * A finished manuscript_draft job (result.json {draft}) becomes the next
 * version. jobCallback calls ingestManuscriptJob; GET also ingests so a
 * settled job shows up even when the callback already returned.
 */
const READ_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const WRITE_ROLES = ["owner", "editor", "analyst"];
const APPROVE_ROLES = ["owner", "editor"];

const TOKEN_RE = /\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}/g;
const LOOSE_RE = /\{\{run:([^}]*)\}\}/g;
const NUMBER_RE = /(?<![A-Za-z0-9_])\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;
const YEAR_RE = /^(?:19|20)\d{2}$/;
const REVIEWER_RE = /\b\d+\s+(?:reviewers|assessors|screeners)\b|\b(?:reviewers|assessors|screeners)\s*(?:=|:)\s*\d+/gi;
const THRESHOLD_RE = /\b(?:threshold|cutoff|alpha|significance level|type I error)\b[^.!?]{0,30}?\d+(?:\.\d+)?%?|\b(?:heterogeneity|I2|I\u00b2)\b[^.!?]{0,30}?\b(?:25|50|75)\s*%|\b(?:90|95|99)\s*%\s*(?:CI|confidence)\b/gi;
const CITE_RE = /\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]/g;
const CLAIM_RE = /\b(?:reduc\w*|decreas\w*|increas\w*|improv\w*|worsen\w*|significant\w*|associat\w*|superior|inferior)\b/i;
/* A research question or objective is not a result claim; it needs no source. */
const WHETHER_RE = /\bwhether\b/i;
const OBJECTIVE_RE = /\b(?:aim(?:s|ed)?|objective|purpose|we (?:sought|set out) to|this (?:review|study|analysis) (?:asks|examines|assesses|evaluates|addresses))\b/i;
const DIR_DOWN_RE = /\b(?:reduc\w*|decreas\w*|lower(?:ed|ing|s)?|declin\w*)\b/i;
const DIR_UP_RE = /\b(?:increas\w*|higher|elevat\w*|greater)\b/i;
const SIG_NEG_RE = /\b(?:not|no|without)\s+significan\w*|\bnon-?significan\w*/i;
const SIG_RE = /\bsignificant(?:ly)?\b/i;
const SENTENCE_RE = /(?<=[.!?])\s+/;
const NUMBER_SECTIONS = ["abstract", "results"];
const CLAIM_SECTIONS = ["abstract", "results", "discussion"];
const CI_ALIASES = { ci: 1, ci95: 1, confidence_interval: 1, confidenceinterval: 1 };
const TWO_DEC = { estimate: 1, effect: 1, yi: 1, or: 1, rr: 1, rd: 1, md: 1, smd: 1, hr: 1, hedges_g: 1, ciLower: 1, ciUpper: 1, ci_lower: 1, ci_upper: 1, tau2: 1, tau: 1, se: 1, se_yi: 1, q: 1 };
const INT_FIELDS = { k: 1, n: 1, total: 1, sample_size: 1, count: 1, studies: 1, participants: 1, events: 1, events_intervention: 1, events_control: 1, df: 1 };
const NULLS = { OR: 1, RR: 1, HR: 1, ROM: 1, IRR: 1, RRR: 1, MD: 0, RD: 0, SMD: 0 };

function iso(ts) {
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function parseJson(text, fallback) {
  try { const v = JSON.parse(text || ""); return v == null ? fallback : v; } catch { return fallback; }
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function sectionGated(section, names) {
  const id = String(section.id || "").toLowerCase();
  const heading = String(section.heading || "").toLowerCase();
  return names.some((n) => id.indexOf(n) >= 0 || heading.indexOf(n) >= 0);
}
function formatP(p) {
  if (p < 0.001) return "< .001";
  if (p > 0.999) return "> .999";
  return p.toFixed(3).replace(/^0/, "");
}
function formatField(fieldPath, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const last = String(fieldPath).split(".").pop();
  if (last === "p" || last === "pValue" || last === "p_value" || last === "pval") return formatP(value);
  if (last === "i2" || last === "i_squared") return value.toFixed(1) + "%";
  if (INT_FIELDS[last]) return String(Math.round(value));
  if (TWO_DEC[last] || typeof value === "number") return value.toFixed(2);
  return String(value);
}
function formatCi(lo, hi) {
  const a = formatField("estimate", lo);
  const b = formatField("estimate", hi);
  if (a == null || b == null) return null;
  return "(95% CI " + a + " to " + b + ")";
}

/* Stored numbers only: draft token table first, then each saved run's
 * result_json. No derived estimates. */
export async function tokenTable(db, projectId, stored) {
  const table = {};
  const src = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  for (const key of Object.keys(src)) {
    const entry = src[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const runId = entry.runId || key.split(".", 1)[0];
    table[key] = {
      value: entry.value, null: entry.null, measure: entry.measure || "", runId,
    };
  }
  const runs = (await db.prepare("SELECT id, measure, result_json FROM research_runs WHERE project_id=?").bind(projectId).all()).results || [];
  for (const run of runs) {
    const result = parseJson(run.result_json, {});
    walkResult(result, "", table, run.id, run.measure);
  }
  return table;
}
function walkResult(node, prefix, table, runId, measure) {
  if (!node || typeof node !== "object") return;
  for (const k of Object.keys(node)) {
    if (!/^[A-Za-z0-9_]+$/.test(k)) continue;
    const path = prefix ? prefix + "." + k : k;
    const v = node[k];
    const key = runId + "." + path;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (!table[key]) table[key] = { value: v, runId, measure, null: NULLS[measure] };
    } else if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      if (!table[key]) table[key] = { value: v.slice(), runId, measure, null: NULLS[measure] };
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      walkResult(v, path, table, runId, measure);
    }
  }
}
function fieldValue(table, runId, field) {
  const entry = table[runId + "." + field];
  return entry && typeof entry.value === "number" ? entry.value : null;
}
function boundsOf(table, runId) {
  const lo = fieldValue(table, runId, "ciLower");
  const hi = fieldValue(table, runId, "ciUpper");
  if (lo != null && hi != null) return [lo, hi];
  const lo2 = fieldValue(table, runId, "ci_lower");
  const hi2 = fieldValue(table, runId, "ci_upper");
  if (lo2 != null && hi2 != null) return [lo2, hi2];
  const ci = table[runId + ".ci"];
  if (ci && Array.isArray(ci.value) && ci.value.length === 2) return ci.value;
  return null;
}
function tokenResolves(table, runId, field) {
  if (table[runId + "." + field]) return true;
  if (CI_ALIASES[String(field).toLowerCase()] && boundsOf(table, runId)) return true;
  return false;
}
function publicTokens(text, table) {
  const out = {};
  const re = new RegExp(TOKEN_RE.source, "g");
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const runId = m[1], field = m[2], key = runId + "." + field;
    if (out[key] || !tokenResolves(table, runId, field)) continue;
    if (CI_ALIASES[field.toLowerCase()] && !table[key]) {
      const bounds = boundsOf(table, runId);
      const formatted = bounds ? formatCi(bounds[0], bounds[1]) : null;
      if (formatted) out[key] = { value: bounds, formatted };
      continue;
    }
    const entry = table[key];
    if (Array.isArray(entry.value) && entry.value.length === 2) {
      const formatted = formatCi(entry.value[0], entry.value[1]);
      if (formatted) out[key] = { value: entry.value, formatted };
      continue;
    }
    const formatted = formatField(field, entry.value);
    if (formatted == null) continue;
    out[key] = { value: entry.value, formatted };
  }
  return out;
}
function runIdsOf(sections, table) {
  const ids = new Set();
  for (const key of Object.keys(table || {})) {
    const id = key.split(".", 1)[0];
    if (id) ids.add(id);
  }
  const re = new RegExp(TOKEN_RE.source, "g");
  for (const s of sections) {
    let m;
    while ((m = re.exec(s.text || "")) !== null) ids.add(m[1]);
  }
  return [...ids].sort();
}

function maskTokens(text) {
  return text.replace(new RegExp(TOKEN_RE.source, "g"), (s) => " ".repeat(s.length));
}
/* Draft text is converted from LaTeX ("Table 1", numbered lists); those numbers are labels, not results. */
const TABLE_FIGURE_RE = /\b(?:Table|Figure|Fig\.|Supplementary Table|eTable|eFigure)\s+\d+[A-Za-z]?\b/g;
const LIST_NUMBER_RE = /(?:^|\n)\s*\d+\.\s/g;
function allowedNumberSpans(text) {
  const spans = [];
  for (const re of [REVIEWER_RE, THRESHOLD_RE, TABLE_FIGURE_RE, LIST_NUMBER_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const inner = new RegExp(NUMBER_RE.source, "g");
      let n;
      while ((n = inner.exec(m[0])) !== null) spans.push([m.index + n.index, m.index + n.index + n[0].length]);
    }
  }
  return spans;
}
function spanAllowed(spans, start, end) {
  return spans.some((s) => s[0] === start && s[1] === end);
}

/* Release gates. Types follow manuscript-api.md. Values compared here are
 * the stored token table, never a freshly computed effect. */
export function gateManuscript(sections, references, table) {
  const failures = [];
  const checks = {
    tokens: { total: 0, resolved: 0, unresolved: 0 },
    citations: { total: 0, resolved: 0, unresolved: 0 },
    claims: { total: 0, linked: 0, unlinked: 0 },
  };
  const refs = Array.isArray(references) ? references : [];
  const byKey = {};
  for (const r of refs) if (r && r.key) byKey[r.key] = r;
  for (const section of sections) {
    const text = String(section.text || "");
    const sid = section.id || "";
    const location = (section.heading || sid || "Section") + " section";
    const numberGated = sectionGated(section, NUMBER_SECTIONS);
    if (numberGated) {
      const masked = maskTokens(text);
      const allowed = allowedNumberSpans(text);
      const numRe = new RegExp(NUMBER_RE.source, "g");
      let n;
      while ((n = numRe.exec(masked)) !== null) {
        if (YEAR_RE.test(n[0]) || spanAllowed(allowed, n.index, n.index + n[0].length)) continue;
        failures.push({
          type: "unresolved_token",
          message: "Bare number " + n[0] + " in " + location + " is not a run token.",
          token: n[0], sectionId: sid, location,
        });
      }
    }
    const tokRe = new RegExp(TOKEN_RE.source, "g");
    let tm;
    while ((tm = tokRe.exec(text)) !== null) {
      checks.tokens.total++;
      if (tokenResolves(table, tm[1], tm[2])) checks.tokens.resolved++;
      else {
        checks.tokens.unresolved++;
        failures.push({
          type: "unresolved_token",
          message: "Token " + tm[0] + " cannot be resolved from saved runs.",
          token: tm[0], sectionId: sid, location,
        });
      }
    }
    const loose = new RegExp(LOOSE_RE.source, "g");
    let lm;
    while ((lm = loose.exec(text)) !== null) {
      if (new RegExp("^" + TOKEN_RE.source + "$").test(lm[0])) continue;
      checks.tokens.total++;
      checks.tokens.unresolved++;
      failures.push({
        type: "unresolved_token",
        message: "Token " + lm[0] + " is not the canonical {{run:<id>.<field>}} form.",
        token: lm[0], sectionId: sid, location,
      });
    }
    const citeRe = new RegExp(CITE_RE.source, "g");
    let cm;
    while ((cm = citeRe.exec(text)) !== null) {
      const raw = cm[1] || cm[2] || "";
      for (const key of raw.split(",").map((k) => k.trim()).filter(Boolean)) {
        checks.citations.total++;
        const ref = byKey[key];
        const doi = ref && ref.doi ? String(ref.doi) : "";
        const pmid = ref && ref.pmid ? String(ref.pmid) : "";
        if (ref && (doi || pmid)) checks.citations.resolved++;
        else {
          checks.citations.unresolved++;
          failures.push({
            type: "unresolved_citation",
            message: ref
              ? "Citation key " + key + " has neither DOI nor PMID in references."
              : "Citation key " + key + " is not in the manuscript references.",
            key, sectionId: sid, location,
          });
        }
      }
    }
    if (!sectionGated(section, CLAIM_SECTIONS)) continue;
    for (const sentence of text.split(SENTENCE_RE)) {
      if (!CLAIM_RE.test(sentence)) continue;
      const claimExempt = WHETHER_RE.test(sentence) || OBJECTIVE_RE.test(sentence);
      if (!claimExempt) {
        checks.claims.total++;
        const linked = new RegExp(TOKEN_RE.source).test(sentence) || new RegExp(CITE_RE.source).test(sentence);
        if (linked) checks.claims.linked++;
        else {
          checks.claims.unlinked++;
          failures.push({
            type: "unlinked_claim",
            message: "Claim in " + location + " has no linked run token or citation.",
            sectionId: sid, location,
          });
        }
      }
      const down = sentence.match(DIR_DOWN_RE);
      const up = sentence.match(DIR_UP_RE);
      const sigNeg = SIG_NEG_RE.test(sentence);
      const sig = SIG_RE.test(sentence);
      const runIds = new Set();
      const sr = new RegExp(TOKEN_RE.source, "g");
      let sm;
      while ((sm = sr.exec(sentence)) !== null) runIds.add(sm[1]);
      for (const runId of [...runIds].sort()) {
        const entry = Object.values(table).find((e) => e && e.runId === runId);
        if (!entry || typeof entry.null !== "number") continue;
        const estimate = fieldValue(table, runId, "estimate");
        if (estimate != null && down && !(estimate < entry.null)) {
          failures.push({
            type: "direction_mismatch",
            message: "Direction word \"" + down[0] + "\" does not match the stored estimate.",
            sectionId: sid, location,
          });
        }
        if (estimate != null && up && !(estimate > entry.null)) {
          failures.push({
            type: "direction_mismatch",
            message: "Direction word \"" + up[0] + "\" does not match the stored estimate.",
            sectionId: sid, location,
          });
        }
        if (!sig) continue;
        const bounds = boundsOf(table, runId);
        if (!bounds) continue;
        const excludes = bounds[0] > entry.null || bounds[1] < entry.null;
        if (sigNeg && excludes) {
          failures.push({
            type: "significance_mismatch",
            message: "The sentence says not significant, but the stored CI excludes the null.",
            sectionId: sid, location,
          });
        } else if (!sigNeg && !excludes) {
          failures.push({
            type: "significance_mismatch",
            message: "The sentence says significant, but the stored CI crosses the null.",
            sectionId: sid, location,
          });
        }
      }
    }
  }
  return { gatesPassed: failures.length === 0, gateFailures: failures, checks };
}

async function loadSections(db, versionId) {
  return (await db.prepare("SELECT * FROM research_manuscript_sections WHERE version_id=? ORDER BY sort_order ASC, section_id ASC")
    .bind(versionId).all()).results || [];
}
async function latestVersion(db, projectId) {
  return db.prepare("SELECT * FROM research_manuscript_versions WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
}
async function versionByNumber(db, projectId, version) {
  return db.prepare("SELECT * FROM research_manuscript_versions WHERE project_id=? AND version=?").bind(projectId, version).first();
}
function sectionOf(row) {
  return {
    id: row.section_id, heading: row.heading, level: row.level, text: row.text,
    updatedAt: iso(row.updated_ts), updatedBy: row.updated_by || "",
  };
}
async function approvalOf(db, row) {
  if (!row || row.status === "draft") return null;
  const a = await db.prepare("SELECT * FROM research_manuscript_approvals WHERE version_id=? ORDER BY created_ts DESC, id DESC LIMIT 1")
    .bind(row.id).first();
  if (!a) return null;
  if (a.status === "approved") {
    return { status: "approved", approvedBy: a.approved_by || "", approvedAt: a.approved_at ? iso(a.approved_at) : "", note: a.note || "" };
  }
  return { status: "requested", requestedBy: a.requested_by || "", requestedAt: a.requested_at ? iso(a.requested_at) : "", note: a.note || "" };
}
async function manuscriptOf(db, projectId, row) {
  const sections = await loadSections(db, row.id);
  const refs = parseJson(row.references_json, []);
  const stored = parseJson(row.tokens_json, {});
  const table = await tokenTable(db, projectId, stored);
  const text = sections.map((s) => s.text).join("\n");
  const lock = row.status === "locked" && row.lock_json ? parseJson(row.lock_json, null) : null;
  return {
    id: row.id, projectId: row.project_id, version: row.version,
    title: row.title, authors: parseJson(row.authors_json, []),
    affiliations: row.affiliations || "", status: row.status,
    sections: sections.map(sectionOf),
    tokens: publicTokens(text, table),
    references: refs,
    approval: await approvalOf(db, row),
    lock,
  };
}
function summaryOf(row, sectionCount) {
  const out = {
    id: row.id, version: row.version, title: row.title, status: row.status,
    sectionCount, referenceCount: parseJson(row.references_json, []).length,
    createdAt: iso(row.created_ts), createdBy: row.created_by || "",
  };
  if (row.status === "locked") {
    out.versionHash = row.version_hash || "";
    if (row.locked_at) out.lockedAt = iso(row.locked_at);
    out.lockedBy = row.locked_by || "";
  }
  return out;
}
async function hashPayload(row, sections) {
  const stored = parseJson(row.tokens_json, {});
  return {
    manuscript: {
      title: row.title,
      authors: parseJson(row.authors_json, []),
      affiliations: row.affiliations || "",
      sections: sections.map((s) => ({ id: s.section_id, heading: s.heading, level: s.level, text: s.text })),
      references: parseJson(row.references_json, []),
      tokens: stored,
    },
    runIds: runIdsOf(sections.map((s) => ({ text: s.text })), stored),
  };
}

function versionNumber(body) {
  return body && typeof body.version === "number" && Number.isInteger(body.version) ? body.version : null;
}
const SECTION_HEADINGS = {
  abstract: "Abstract",
  introduction: "Introduction",
  methods: "Methods",
  results: "Results",
  discussion: "Discussion",
  title: "Title Page",
  casePresentation: "Case Presentation",
  timeline: "Timeline",
  conclusion: "Conclusion",
  patientPerspective: "Patient Perspective",
  learningPoints: "Learning Points",
};
function defaultSectionHeading(sectionId) {
  if (SECTION_HEADINGS[sectionId]) return SECTION_HEADINGS[sectionId];
  const s = String(sectionId || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Section";
}
async function ensureFirstVersion(ctx, projectId, project, now) {
  const { db, uid, api } = ctx;
  const { uuid, audit } = api;
  const id = uuid("man_");
  const title = (project && typeof project.title === "string" ? project.title : "").slice(0, 500);
  try {
    await db.prepare("INSERT INTO research_manuscript_versions (id,project_id,version,title,authors_json,affiliations,status,references_json,tokens_json,job_id,created_by,created_ts) VALUES (?,?,1,?,'[]','','draft','[]','{}','',?,?)")
      .bind(id, projectId, title, uid, now).run();
    await audit(db, projectId, uid, "manuscript_version_created", id, { version: 1, source: "section_save" });
    return await latestVersion(db, projectId);
  } catch (e) {
    const raced = await latestVersion(db, projectId);
    if (raced) return raced;
    throw e;
  }
}
async function editable(ctx, projectId, body, roles, denyMessage) {
  const { db, uid, requestId, api } = ctx;
  const { err, json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, roles);
  if (gate.status) return { error: gateErr(gate, denyMessage, requestId) };
  await ingestProjectDrafts(ctx, projectId);
  const version = versionNumber(body);
  if (version == null) return { error: err(400, "invalid_body", "version must be an integer", requestId) };
  const row = await latestVersion(db, projectId);
  if (!row) return { error: err(404, "manuscript_not_found", "Manuscript not found", requestId) };
  if (version !== row.version) {
    return { error: json({
      error: { code: "stale_version", message: "Manuscript changed on the server", requestId },
      current: { manuscript: await manuscriptOf(db, projectId, row) },
    }, 409, { "x-request-id": requestId }) };
  }
  if (row.status === "locked") return { error: err(403, "manuscript_locked", "This manuscript version is locked", requestId) };
  return { row };
}

async function readR2Json(env, key) {
  if (!env.RESEARCH_R2 || !key) return null;
  const obj = await env.RESEARCH_R2.get(key);
  if (!obj) return null;
  try {
    if (typeof obj.json === "function") return await obj.json();
    if (typeof obj.text === "function") return JSON.parse(await obj.text());
  } catch { return null; }
  return null;
}

/* Insert one version from a manuscript_draft result.json. Idempotent on job id. */
export async function ingestManuscriptJob(ctx, job) {
  if (!job || job.kind !== "manuscript_draft" || job.status !== "succeeded" || !job.result_r2_key) return null;
  const { db, env, api } = ctx;
  const { uuid } = api;
  const existing = await db.prepare("SELECT id FROM research_manuscript_versions WHERE project_id=? AND job_id=?")
    .bind(job.project_id, job.id).first();
  if (existing) return existing.id;
  const stored = await readR2Json(env, job.result_r2_key);
  const draft = stored && stored.draft;
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.sections) || !draft.sections.length) return null;
  const project = await db.prepare("SELECT title FROM research_projects WHERE id=?").bind(job.project_id).first();
  const title = typeof draft.title === "string" && draft.title.trim() ? draft.title.trim().slice(0, 500) : ((project && project.title) || "");
  const authors = Array.isArray(draft.authors) ? draft.authors.filter((a) => typeof a === "string").slice(0, 40) : [];
  const affiliations = typeof draft.affiliations === "string" ? draft.affiliations.slice(0, 500) : "";
  const references = Array.isArray(draft.references) ? draft.references : [];
  const tokens = draft.tokens && typeof draft.tokens === "object" && !Array.isArray(draft.tokens) ? draft.tokens : {};
  const max = await db.prepare("SELECT MAX(version) AS v FROM research_manuscript_versions WHERE project_id=?").bind(job.project_id).first();
  const version = ((max && max.v) || 0) + 1;
  const id = uuid("man_");
  const now = Date.now();
  const actor = job.created_by || "";
  try {
    await db.prepare("INSERT INTO research_manuscript_versions (id,project_id,version,title,authors_json,affiliations,status,references_json,tokens_json,job_id,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, job.project_id, version, title, JSON.stringify(authors), affiliations, "draft", JSON.stringify(references), JSON.stringify(tokens), job.id, actor, now).run();
  } catch {
    const raced = await db.prepare("SELECT id FROM research_manuscript_versions WHERE project_id=? AND job_id=?").bind(job.project_id, job.id).first();
    return raced ? raced.id : null;
  }
  let order = 0;
  const seen = new Set();
  for (const s of draft.sections) {
    if (!s || typeof s !== "object") continue;
    const sid = typeof s.id === "string" && s.id ? s.id.slice(0, 80) : "";
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const heading = typeof s.heading === "string" ? s.heading.slice(0, 300) : sid;
    const level = Number.isInteger(s.level) && s.level >= 1 && s.level <= 6 ? s.level : 1;
    const text = typeof s.text === "string" ? s.text : "";
    await db.prepare("INSERT INTO research_manuscript_sections (version_id,section_id,heading,level,text,sort_order,updated_by,updated_ts) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, sid, heading, level, text, order++, actor, now).run();
  }
  await api.audit(db, job.project_id, actor || "worker", "manuscript_version_created", id, { jobId: job.id, version });
  return id;
}

export async function ingestProjectDrafts(ctx, projectId) {
  const { db } = ctx;
  const jobs = (await db.prepare("SELECT * FROM research_job_runs WHERE project_id=? AND kind='manuscript_draft' AND status='succeeded' AND result_r2_key!='' ORDER BY completed_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  for (const job of jobs) await ingestManuscriptJob(ctx, job);
}

export async function listVersions(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  await ingestProjectDrafts(ctx, projectId);
  const rows = (await db.prepare("SELECT * FROM research_manuscript_versions WHERE project_id=? ORDER BY version ASC").bind(projectId).all()).results || [];
  const versions = [];
  for (const row of rows) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM research_manuscript_sections WHERE version_id=?").bind(row.id).first();
    versions.push(summaryOf(row, (n && n.n) || 0));
  }
  return json({ versions }, 200, { "x-request-id": requestId });
}

export async function getManuscript(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  await ingestProjectDrafts(ctx, projectId);
  const raw = url.searchParams.get("version");
  let row;
  if (raw == null || raw === "") row = await latestVersion(db, projectId);
  else {
    const version = Number(raw);
    if (!Number.isInteger(version)) return err(400, "invalid_body", "version must be an integer", requestId);
    row = await versionByNumber(db, projectId, version);
  }
  if (!row) return err(404, "manuscript_not_found", "Manuscript not found", requestId);
  return json({ manuscript: await manuscriptOf(db, projectId, row) }, 200, { "x-request-id": requestId });
}

export async function putSection(ctx, projectId, sectionId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Section edits need an owner, editor or analyst role", requestId);
  const sid = typeof sectionId === "string" ? sectionId.trim().slice(0, 80) : "";
  if (!sid) return err(400, "invalid_body", "sectionId is required", requestId);
  const version = versionNumber(body);
  if (version == null || version < 1) return err(400, "invalid_body", "version must be an integer", requestId);
  if (typeof body.text !== "string" || body.text.length > 200000)
    return err(400, "invalid_body", "text must be a string of at most 200000 characters", requestId);
  if (body.heading !== undefined && (typeof body.heading !== "string" || !body.heading.trim() || body.heading.length > 300))
    return err(400, "invalid_body", "heading must be 1-300 characters", requestId);
  await ingestProjectDrafts(ctx, projectId);
  let row = await latestVersion(db, projectId);
  if (row) {
    if (version !== row.version) {
      return json({
        error: { code: "stale_version", message: "Manuscript changed on the server", requestId },
        current: { manuscript: await manuscriptOf(db, projectId, row) },
      }, 409, { "x-request-id": requestId });
    }
    if (row.status === "locked") return err(403, "manuscript_locked", "This manuscript version is locked", requestId);
  } else {
    row = await ensureFirstVersion(ctx, projectId, gate.project, Date.now());
    if (row.status === "locked") return err(403, "manuscript_locked", "This manuscript version is locked", requestId);
  }
  const section = await db.prepare("SELECT * FROM research_manuscript_sections WHERE version_id=? AND section_id=?").bind(row.id, sid).first();
  const now = Date.now();
  if (section) {
    const heading = body.heading !== undefined ? body.heading.trim() : section.heading;
    await db.prepare("UPDATE research_manuscript_sections SET heading=?,text=?,updated_by=?,updated_ts=? WHERE version_id=? AND section_id=?")
      .bind(heading, body.text, uid, now, row.id, sid).run();
  } else {
    const heading = body.heading !== undefined ? body.heading.trim() : defaultSectionHeading(sid);
    const maxOrder = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM research_manuscript_sections WHERE version_id=?").bind(row.id).first();
    const sortOrder = (maxOrder && typeof maxOrder.m === "number" ? maxOrder.m : -1) + 1;
    await db.prepare("INSERT INTO research_manuscript_sections (version_id,section_id,heading,level,text,sort_order,updated_by,updated_ts) VALUES (?,?,?,1,?,?,?,?)")
      .bind(row.id, sid, heading, body.text, sortOrder, uid, now).run();
  }
  if (row.status === "review" || row.status === "approved")
    await db.prepare("UPDATE research_manuscript_versions SET status='draft' WHERE id=?").bind(row.id).run();
  await audit(db, projectId, uid, "manuscript_section_saved", row.id, { sectionId: sid, version: row.version });
  const fresh = await db.prepare("SELECT * FROM research_manuscript_sections WHERE version_id=? AND section_id=?").bind(row.id, sid).first();
  const stored = parseJson(row.tokens_json, {});
  const table = await tokenTable(db, projectId, stored);
  return json({ section: sectionOf(fresh), version: row.version, tokens: publicTokens(fresh.text, table) }, 200, { "x-request-id": requestId });
}

export async function requestApproval(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid } = api;
  const opened = await editable(ctx, projectId, body, WRITE_ROLES, "Approval requests need an owner, editor or analyst role");
  if (opened.error) return opened.error;
  const note = body.note === undefined ? "" : body.note;
  if (typeof note !== "string" || note.length > 2000) return err(400, "invalid_body", "note must be a string of at most 2000 characters", requestId);
  const now = Date.now();
  const id = uuid("appr_");
  await db.prepare("INSERT INTO research_manuscript_approvals (id,version_id,status,requested_by,requested_at,note,created_ts) VALUES (?,?, 'requested',?,?,?,?)")
    .bind(id, opened.row.id, uid, now, note, now).run();
  await db.prepare("UPDATE research_manuscript_versions SET status='review' WHERE id=?").bind(opened.row.id).run();
  await audit(db, projectId, uid, "manuscript_approval_requested", opened.row.id, { version: opened.row.version });
  return json({
    status: "review",
    approval: { status: "requested", requestedBy: uid, requestedAt: iso(now), note },
  }, 200, { "x-request-id": requestId });
}

export async function approveManuscript(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid } = api;
  const opened = await editable(ctx, projectId, body, APPROVE_ROLES, "Approval needs an owner or editor role");
  if (opened.error) return opened.error;
  if (body.decision !== "approved") return err(400, "invalid_body", "decision must be approved", requestId);
  const note = body.note === undefined ? "" : body.note;
  if (typeof note !== "string" || note.length > 2000) return err(400, "invalid_body", "note must be a string of at most 2000 characters", requestId);
  const existing = await db.prepare("SELECT * FROM research_manuscript_approvals WHERE version_id=? AND status='approved' ORDER BY created_ts DESC LIMIT 1")
    .bind(opened.row.id).first();
  if (opened.row.status === "approved" && existing) {
    return json({
      status: "approved",
      approval: { status: "approved", approvedBy: existing.approved_by, approvedAt: iso(existing.approved_at), note: existing.note || "" },
    }, 200, { "x-request-id": requestId });
  }
  const now = Date.now();
  await db.prepare("INSERT INTO research_manuscript_approvals (id,version_id,status,approved_by,approved_at,note,decision,created_ts) VALUES (?,?, 'approved',?,?,?, 'approved',?)")
    .bind(uuid("appr_"), opened.row.id, uid, now, note, now).run();
  await db.prepare("UPDATE research_manuscript_versions SET status='approved' WHERE id=?").bind(opened.row.id).run();
  await audit(db, projectId, uid, "manuscript_approved", opened.row.id, { version: opened.row.version });
  return json({
    status: "approved",
    approval: { status: "approved", approvedBy: uid, approvedAt: iso(now), note },
  }, 200, { "x-request-id": requestId });
}

export async function lockManuscript(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const opened = await editable(ctx, projectId, body, APPROVE_ROLES, "Locking needs an owner or editor role");
  if (opened.error) return opened.error;
  if (opened.row.status !== "approved")
    return err(409, "approval_required", "A clinician must approve this version before it can be locked", requestId);
  const sections = await loadSections(db, opened.row.id);
  const payload = await hashPayload(opened.row, sections);
  const versionHash = await sha256Hex(canonicalJson(payload));
  const now = Date.now();
  const lock = {
    version_hash: versionHash,
    locked_at: iso(now),
    locked_by: uid,
    run_ids: payload.runIds,
    manuscript_title: opened.row.title,
    section_count: sections.length,
    reference_count: parseJson(opened.row.references_json, []).length,
    status: "locked",
    metadata: {},
  };
  await db.prepare("UPDATE research_manuscript_versions SET status='locked', version_hash=?, locked_by=?, locked_at=?, lock_json=? WHERE id=? AND status='approved'")
    .bind(versionHash, uid, now, JSON.stringify(lock), opened.row.id).run();
  await audit(db, projectId, uid, "manuscript_locked", opened.row.id, { version: opened.row.version, versionHash });
  return json({ status: "locked", lock }, 200, { "x-request-id": requestId });
}

async function gatesFor(ctx, projectId, version) {
  const { db, err } = ctx.api ? { db: ctx.db, err: ctx.api.err } : ctx;
  const row = version == null ? await latestVersion(db, projectId) : await versionByNumber(db, projectId, version);
  if (!row) return { error: err(404, "manuscript_not_found", "Manuscript not found", ctx.requestId) };
  const sections = (await loadSections(db, row.id)).map(sectionOf);
  const refs = parseJson(row.references_json, []);
  const table = await tokenTable(db, projectId, parseJson(row.tokens_json, {}));
  return { row, report: gateManuscript(sections, refs, table) };
}

export async function manuscriptGates(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  await ingestProjectDrafts(ctx, projectId);
  const raw = url.searchParams.get("version");
  let version = null;
  if (raw != null && raw !== "") {
    version = Number(raw);
    if (!Number.isInteger(version)) return err(400, "invalid_body", "version must be an integer", requestId);
  }
  const got = await gatesFor(ctx, projectId, version);
  if (got.error) return got.error;
  return json(got.report, 200, { "x-request-id": requestId });
}

export async function exportManuscript(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Export needs an owner, editor or analyst role", requestId);
  await ingestProjectDrafts(ctx, projectId);
  const format = body.format === undefined ? "docx" : body.format;
  if (format !== "docx") return err(400, "invalid_body", "format must be docx", requestId);
  const version = versionNumber(body);
  if (version == null) return err(400, "invalid_body", "version must be an integer", requestId);
  const row = await latestVersion(db, projectId);
  if (!row) return err(404, "manuscript_not_found", "Manuscript not found", requestId);
  if (version !== row.version) {
    return json({
      error: { code: "stale_version", message: "Manuscript changed on the server", requestId },
      current: { manuscript: await manuscriptOf(db, projectId, row) },
    }, 409, { "x-request-id": requestId });
  }
  const got = await gatesFor(ctx, projectId, row.version);
  if (got.error) return got.error;
  if (!got.report.gatesPassed) {
    return json({
      error: { code: "gate_failed", message: "Export blocked: manuscript contains unresolved tokens or citations.", requestId },
      gatesPassed: false,
      gateFailures: got.report.gateFailures,
    }, 422, { "x-request-id": requestId });
  }
  const jobId = uuid("job_");
  const now = Date.now();
  await db.prepare("INSERT INTO research_manuscript_exports (id,project_id,version_id,format,status,created_by,created_ts) VALUES (?,?,?, 'docx','pending',?,?)")
    .bind(jobId, projectId, row.id, uid, now).run();
  await audit(db, projectId, uid, "manuscript_export_queued", jobId, { version: row.version, format: "docx" });
  return json({ jobId, status: "pending", format: "docx", gatesPassed: true }, 202, { "x-request-id": requestId });
}
