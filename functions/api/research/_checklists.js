/* ResearchMD Phase 5B checklist API (ES module, server side).
 * GET /v1/checklists and /v1/checklists/{id} serve data/research-checklists (data/ ships to Pages; docs/ is removed by scripts/pages-build.sh)
 * (README excluded). Short names used by _templates.js map onto the file ids.
 * The project snapshot is assembled from stored rows only. Keys with no rows
 * are omitted. PRISMA counts come from prismaCounts (the same helper the
 * PRISMA route uses). Manual entries are the researcher's own text.
 */
import consort2010 from "../../../data/research-checklists/consort2010.json";
import spirit from "../../../data/research-checklists/spirit.json";
import strobe from "../../../data/research-checklists/strobe.json";
import stard2015 from "../../../data/research-checklists/stard2015.json";
import tripod from "../../../data/research-checklists/tripod.json";
import prisma2020 from "../../../data/research-checklists/prisma2020.json";
import care from "../../../data/research-checklists/care.json";
import { ingestProjectDrafts } from "./_manuscript.js";

const READ_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const WRITE_ROLES = ["owner", "editor", "analyst"];

const FILES = [consort2010, spirit, strobe, stard2015, tripod, prisma2020, care];
const BY_ID = Object.fromEntries(FILES.map((c) => [c.id, c]));
/* Aliases are the reportingChecklistId / protocolChecklistId values in
 * _templates.js. File ids stay the canonical stored key. */
const ALIASES = {
  consort: "consort2010",
  spirit: "spirit",
  strobe: "strobe",
  stard: "stard2015",
  tripod: "tripod",
  prisma: "prisma2020",
  care: "care",
};

export function resolveChecklistId(id) {
  if (BY_ID[id]) return id;
  const alias = ALIASES[id];
  return alias && BY_ID[alias] ? alias : null;
}

/* Flat item list for Ask MaiK checklist drafts. Null when the id is unknown. */
export function checklistItems(id) {
  const canonical = resolveChecklistId(id);
  if (!canonical) return null;
  const c = BY_ID[canonical];
  const items = [];
  for (const sec of c.sections || []) {
    for (const item of sec.items || []) {
      items.push({
        itemNum: String(item.number),
        topic: String(item.topic || ""),
        sectionTitle: String(sec.title || ""),
      });
    }
  }
  return { id: canonical, name: c.name, items };
}

function summaryOf(c) {
  return { id: c.id, name: c.name, version: c.version };
}
function parseJson(text, fallback) {
  try { const v = JSON.parse(text || ""); return v == null ? fallback : v; } catch { return fallback; }
}
function prismaEmpty(p) {
  if (!p) return true;
  const nums = ["recordsIdentified", "recordsFromDatabases", "recordsFromOtherSources",
    "recordsDuplicatesRemoved", "recordsScreened", "recordsExcluded", "reportsSought",
    "reportsNotRetrieved", "reportsAssessed", "reportsExcluded", "studiesIncluded", "conflictsOpen"];
  if (nums.some((k) => p[k])) return false;
  return !(p.excludedByReason && p.excludedByReason.length);
}

export async function listChecklists(ctx) {
  const { requestId, api } = ctx;
  return api.json({ checklists: FILES.map(summaryOf) }, 200, { "x-request-id": requestId });
}

export async function getChecklist(ctx, id) {
  const { requestId, api } = ctx;
  const { json, err } = api;
  const canonical = resolveChecklistId(id);
  if (!canonical) return err(404, "checklist_not_found", "Checklist not found", requestId);
  return json({ checklist: BY_ID[canonical] }, 200, { "x-request-id": requestId });
}

export async function checklistSnapshot(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const snapshot = {};

  const protocol = await db.prepare("SELECT content_json FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  if (protocol) {
    const content = parseJson(protocol.content_json, {});
    if (content && typeof content === "object" && !Array.isArray(content) && Object.keys(content).length) snapshot.protocol = content;
  }

  const searches = (await db.prepare("SELECT * FROM research_search_runs WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  if (searches.length) {
    snapshot.searches = searches.map((row) => {
      const item = { database: row.database, query: row.query, resultCount: row.result_count };
      if (row.date_to) item.dateTo = row.date_to;
      const filters = parseJson(row.filters_json, {});
      if (filters && typeof filters === "object" && !Array.isArray(filters) && Object.keys(filters).length)
        item.filters = JSON.stringify(filters);
      return item;
    });
  }

  const prisma = await api.prismaCounts(db, projectId);
  if (prisma && !prismaEmpty(prisma)) {
    const copy = Object.assign({}, prisma);
    delete copy.projectId;
    snapshot.prisma = copy;
  }

  const extractions = (await db.prepare("SELECT e.status, e.fields_json, s.label FROM research_extractions e JOIN research_studies s ON s.id=e.study_id WHERE e.project_id=? ORDER BY e.updated_ts ASC, e.id ASC")
    .bind(projectId).all()).results || [];
  if (extractions.length) {
    snapshot.extractions = extractions.map((row) => {
      const fields = parseJson(row.fields_json, {});
      const item = { verified: row.status === "verified" };
      if (row.label) item.citation = row.label;
      if (fields && typeof fields === "object" && !Array.isArray(fields) && Object.keys(fields).length) item.characteristics = fields;
      if (fields && fields.effect != null) item.effect = fields.effect;
      return item;
    });
  }

  const rob = (await db.prepare("SELECT r.tool, r.overall, s.label FROM research_rob_assessments r JOIN research_studies s ON s.id=r.study_id WHERE r.project_id=? ORDER BY r.created_ts ASC, r.id ASC")
    .bind(projectId).all()).results || [];
  if (rob.length) {
    snapshot.rob = rob.map((row) => {
      const item = { tool: row.tool };
      if (row.label) item.citation = row.label;
      if (row.overall) item.overall = row.overall;
      return item;
    });
  }

  const runs = (await db.prepare("SELECT * FROM research_runs WHERE project_id=? ORDER BY created_ts ASC, id ASC").bind(projectId).all()).results || [];
  if (runs.length) {
    snapshot.runs = runs.map((row) => {
      const result = parseJson(row.result_json, {});
      const item = { measure: row.measure, model: row.model };
      if (row.engine) item.software = row.engine;
      for (const k of ["effect", "ciLower", "ciUpper", "i2", "tau2", "q", "preparation", "display", "subgroup", "sensitivity", "reportingBias"]) {
        if (result[k] != null && result[k] !== "") item[k] = result[k];
      }
      return item;
    });
  }

  const grades = (await db.prepare("SELECT * FROM research_grade_assessments WHERE project_id=? ORDER BY created_ts ASC, id ASC").bind(projectId).all()).results || [];
  if (grades.length) {
    snapshot.grade = grades.map((row) => {
      const result = parseJson(row.result_json, {});
      const item = { outcome: row.outcome };
      if (result.certainty) item.certainty = result.certainty;
      return item;
    });
  }

  await ingestProjectDrafts(ctx, projectId);
  const version = await db.prepare("SELECT id FROM research_manuscript_versions WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  if (version) {
    const sections = (await db.prepare("SELECT heading, text FROM research_manuscript_sections WHERE version_id=? ORDER BY sort_order ASC, section_id ASC")
      .bind(version.id).all()).results || [];
    if (sections.length) snapshot.manuscript = { sections: sections.map((s) => ({ heading: s.heading, text: s.text })) };
  }

  return json({ snapshot }, 200, { "x-request-id": requestId });
}

async function manualEntries(db, projectId, guidelineId) {
  const rows = (await db.prepare("SELECT item_num, text FROM research_checklist_manual WHERE project_id=? AND guideline_id=? ORDER BY item_num ASC")
    .bind(projectId, guidelineId).all()).results || [];
  const entries = {};
  for (const row of rows) entries[row.item_num] = row.text;
  return entries;
}

export async function getManual(ctx, projectId, guidelineId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, READ_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const canonical = resolveChecklistId(guidelineId);
  if (!canonical) return err(404, "checklist_not_found", "Checklist not found", requestId);
  return json({ entries: await manualEntries(db, projectId, canonical) }, 200, { "x-request-id": requestId });
}

export async function putManual(ctx, projectId, guidelineId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Checklist entries need an owner, editor or analyst role", requestId);
  const canonical = resolveChecklistId(guidelineId);
  if (!canonical) return err(404, "checklist_not_found", "Checklist not found", requestId);
  const num = body && typeof body.num === "string" ? body.num : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(num))
    return err(400, "invalid_body", "num must be 1-40 letters, digits, dots, underscores or hyphens", requestId);
  if (typeof body.text !== "string" || body.text.length > 8000)
    return err(400, "invalid_body", "text must be a string of at most 8000 characters", requestId);
  const now = Date.now();
  await db.prepare("INSERT INTO research_checklist_manual (project_id,guideline_id,item_num,text,updated_by,updated_ts) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,guideline_id,item_num) DO UPDATE SET text=excluded.text, updated_by=excluded.updated_by, updated_ts=excluded.updated_ts")
    .bind(projectId, canonical, num, body.text, uid, now).run();
  await audit(db, projectId, uid, "checklist_manual_saved", canonical, { num });
  return json({ entries: await manualEntries(db, projectId, canonical) }, 200, { "x-request-id": requestId });
}
