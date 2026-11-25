/* ResearchMD Phase 4.3 GRADE module M API (ES module, server side).
 * Contract: docs/research/contracts/phase-4/grade.md. The certainty arithmetic,
 * suggestions and Summary of Findings live in the pure repo-root
 * research-grade.js (imported here exactly as _engine.js imports the stats
 * engine); this module only persists human judgments per saved run and serves
 * the computed table. No LLM is involved in GRADE.
 *
 * Routes hooked in [[path]].js (Firebase auth + project role on every call):
 *   GET  /v1/projects/{pid}/grade-assessments
 *   PUT  /v1/projects/{pid}/grade-assessments        (upsert per saved run)
 *   GET  /v1/projects/{pid}/grade-assessments/{gid}
 *   GET  /v1/projects/{pid}/summary-of-findings      (computed SoF table + text)
 *   GET  /v1/projects/{pid}/grade-suggestions?runId=&mid=
 *
 * Human gates (grade.md): every downgrade/upgrade carries a human reason and
 * reviewer id (research-grade.js refuses incomplete judgments). The design,
 * MID and assumed control risk are human inputs, never inferred. Suggestions
 * (suggestImprecision / suggestInconsistency) are deterministic and labelled;
 * they are never applied automatically. Ungraded runs are excluded from the
 * SoF table and counted in a note.
 */
import GRADE from "../../../research-grade.js";

const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const WRITE_ROLES = ["owner", "editor", "analyst", "reviewer"];
const DOMAIN_KEYS = ["riskOfBias", "inconsistency", "indirectness", "imprecision", "publicationBias"];

function isFin(n) { return typeof n === "number" && Number.isFinite(n); }

/* Reconstruct the engine run result the pure module expects: the stored
 * result_json (run result minus manifest) plus manifest_json. */
function runResultOf(row) {
  return Object.assign({}, JSON.parse(row.result_json || "{}"), { manifest: JSON.parse(row.manifest_json || "{}") });
}
function assessmentOf(row) {
  return {
    id: row.id, projectId: row.project_id, runId: row.run_id, outcome: row.outcome,
    design: row.design, input: JSON.parse(row.input_json || "{}"),
    result: JSON.parse(row.result_json || "{}"),
    baselineRisk: row.baseline_risk == null ? null : row.baseline_risk,
    mid: row.mid == null ? null : row.mid,
    version: row.version, createdBy: row.created_by || "",
    createdTs: row.created_ts, updatedTs: row.updated_ts,
  };
}
async function loadRun(db, projectId, runId) {
  return db.prepare("SELECT * FROM research_runs WHERE id=? AND project_id=?").bind(runId, projectId).first();
}

/* ---- GET assessments ------------------------------------------------------- */
export async function listGrade(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare("SELECT * FROM research_grade_assessments WHERE project_id=? ORDER BY updated_ts DESC, id DESC")
    .bind(projectId).all()).results || [];
  return json({ assessments: rows.map(assessmentOf) }, 200, { "x-request-id": requestId });
}
export async function getGrade(ctx, projectId, gradeId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const row = await db.prepare("SELECT * FROM research_grade_assessments WHERE id=? AND project_id=?").bind(gradeId, projectId).first();
  if (!row) return err(404, "grade_not_found", "GRADE assessment not found", requestId);
  return json({ assessment: assessmentOf(row) }, 200, { "x-request-id": requestId });
}

/* ---- PUT assessment (upsert per saved run) --------------------------------- */
export async function putGrade(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "GRADE judgments need an owner, editor, analyst or reviewer role", requestId);
  const runId = typeof body.runId === "string" ? body.runId : "";
  const run = await loadRun(db, projectId, runId);
  if (!run) return err(404, "run_not_found", "Saved run not found", requestId);
  const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
  if (!outcome || outcome.length > 240) return err(400, "invalid_grade", "outcome must be 1-240 characters", requestId);
  if (body.design !== "rct" && body.design !== "observational")
    return err(400, "invalid_grade", "design must be rct or observational", requestId);
  let baselineRisk = null;
  if (body.baselineRisk !== undefined && body.baselineRisk !== null && body.baselineRisk !== "") {
    baselineRisk = Number(body.baselineRisk);
    if (!isFin(baselineRisk) || baselineRisk < 0 || baselineRisk > 1000)
      return err(400, "invalid_grade", "baselineRisk must be between 0 and 1000 (per 1000)", requestId);
  }
  let mid = null;
  if (body.mid !== undefined && body.mid !== null && body.mid !== "") {
    mid = Number(body.mid);
    if (!isFin(mid)) return err(400, "invalid_grade", "mid must be a finite number", requestId);
  }
  const runResult = runResultOf(run);
  const input = { outcome, design: body.design, run: runResult };
  for (const k of DOMAIN_KEYS) input[k] = body[k];
  if (body.upgrades !== undefined) input.upgrades = body.upgrades;
  let result;
  try {
    /* research-grade.js refuses incomplete judgments (missing reason/reviewer)
     * and invalid upgrades; nothing is fabricated or auto-applied here. */
    result = GRADE.assessOutcome(input);
  } catch (e) {
    return err(422, "invalid_grade", String((e && e.message) || e).slice(0, 300), requestId);
  }
  /* Store the human input WITHOUT the bulky run object (provenance is runId). */
  const storedInput = { outcome, design: body.design };
  for (const k of DOMAIN_KEYS) storedInput[k] = body[k];
  if (body.upgrades !== undefined) storedInput.upgrades = body.upgrades;
  const existing = await db.prepare("SELECT * FROM research_grade_assessments WHERE project_id=? AND run_id=?")
    .bind(projectId, runId).first();
  const now = Date.now();
  let id;
  if (existing) {
    if (body.version !== undefined && body.version !== existing.version)
      return json({ error: { code: "stale_version", message: "GRADE assessment changed on the server", requestId },
        current: { assessment: assessmentOf(existing) } }, 409, { "x-request-id": requestId });
    id = existing.id;
    await db.prepare("UPDATE research_grade_assessments SET outcome=?,design=?,input_json=?,result_json=?,baseline_risk=?,mid=?,version=version+1,updated_ts=? WHERE id=?")
      .bind(outcome, body.design, JSON.stringify(storedInput), JSON.stringify(result), baselineRisk, mid, now, id).run();
  } else {
    id = "grd_" + crypto.randomUUID().replace(/-/g, "");
    await db.prepare("INSERT INTO research_grade_assessments (id,project_id,run_id,outcome,design,input_json,result_json,baseline_risk,mid,version,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)")
      .bind(id, projectId, runId, outcome, body.design, JSON.stringify(storedInput), JSON.stringify(result), baselineRisk, mid, uid, now, now).run();
  }
  await audit(db, projectId, uid, "grade_saved", id, { runId, outcome, certainty: result.certainty });
  const row = await db.prepare("SELECT * FROM research_grade_assessments WHERE id=?").bind(id).first();
  return json({ assessment: assessmentOf(row) }, 200, { "x-request-id": requestId });
}

/* ---- GET Summary of Findings ----------------------------------------------- */
export async function summaryOfFindings(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare("SELECT * FROM research_grade_assessments WHERE project_id=? ORDER BY created_ts ASC")
    .bind(projectId).all()).results || [];
  const sofRows = [];
  for (const a of rows) {
    const run = await loadRun(db, projectId, a.run_id);
    if (!run) continue;
    sofRows.push({ outcome: a.outcome, run: runResultOf(run), grade: JSON.parse(a.result_json || "{}"),
      baselineRisk: a.baseline_risk == null ? undefined : a.baseline_risk });
  }
  let table;
  try { table = GRADE.summaryOfFindings(sofRows); }
  catch (e) { return err(422, "invalid_grade", String((e && e.message) || e).slice(0, 300), requestId); }
  const totalRuns = await db.prepare("SELECT COUNT(*) AS n FROM research_runs WHERE project_id=?").bind(projectId).first();
  const ungraded = Math.max(0, ((totalRuns && totalRuns.n) || 0) - sofRows.length);
  return json({ table, text: GRADE.summaryOfFindingsText(table), ungraded }, 200, { "x-request-id": requestId });
}

/* ---- GET deterministic suggestions (never applied) ------------------------- */
export async function gradeSuggestions(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const runId = url.searchParams.get("runId") || "";
  const run = await loadRun(db, projectId, runId);
  if (!run) return err(404, "run_not_found", "Saved run not found", requestId);
  const runResult = runResultOf(run);
  const midRaw = url.searchParams.get("mid");
  const mid = midRaw === null || midRaw === "" ? undefined : Number(midRaw);
  let imprecision, inconsistency;
  try {
    imprecision = GRADE.suggestImprecision(runResult, mid);
    inconsistency = GRADE.suggestInconsistency(runResult);
  } catch (e) {
    return err(422, "invalid_grade", String((e && e.message) || e).slice(0, 300), requestId);
  }
  /* SUGGESTION ONLY: a human accepts these in the screen; nothing is applied. */
  return json({ runId, imprecision, inconsistency }, 200, { "x-request-id": requestId });
}
