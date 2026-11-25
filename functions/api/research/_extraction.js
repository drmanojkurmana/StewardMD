/* ResearchMD Phase 3.4 extraction (ES module, server side).
 * Contract: docs/research/contracts/phase-3/extraction.md (+ frozen schemas).
 * Routes hooked in [[path]].js (Firebase auth + project role on every call):
 *   GET  /v1/extraction-templates
 *   GET  /v1/projects/{pid}/studies/{sid}/extraction?template=
 *   PUT  /v1/projects/{pid}/studies/{sid}/extraction
 *   POST /v1/extractions/{eid}/verify
 *   POST /v1/extractions/{eid}/correct
 *   GET  /v1/extractions/{eid}/audit
 *   POST /v1/extractions/{eid}/suggestions/{sgid}/accept
 *   POST /v1/extractions/{eid}/promote
 *   GET  /v1/projects/{pid}/artifacts
 *   POST /v1/projects/{pid}/pdf-uploads        (multipart, reuses _jobs.createJob)
 *   GET  /v1/artifacts/{aid}/result
 *
 * Integrity (plan section 3): one value per field, each with a locator AND a
 * verbatim quote. Field status unverified|verified|corrected; only verified
 * and corrected (human-attested) may promote. Promote is the ONLY path from an
 * extraction to a research_studies row, and it writes verified=1 only after
 * every required field is verified/corrected with locator+quote. The engine
 * (createRun) already refuses unverified studies, so no AI value reaches
 * analysis unverified. Corrections append an audit row; nothing is silently
 * overwritten. T1 suggestions (3.5, _suggest.js) arrive unverified and Accept
 * moves a value into a field STILL unverified; nothing is auto-verified.
 */
import { createJob } from "./_jobs.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const MEASURES = { OR: 1, RR: 1, HR: 1, RD: 1, MD: 1, SMD: 1 };

/* Form templates (extraction-templates.response.json). Field keys, types and
 * the measures each template can promote to are frozen by the contract. */
export const TEMPLATES = [
  { id: "rct_binary", label: "RCT binary outcome", measures: ["OR", "RR", "RD"], fields: [
    { key: "events1", label: "Events (intervention)", type: "integer", required: true },
    { key: "n1", label: "N (intervention)", type: "integer", required: true },
    { key: "events2", label: "Events (control)", type: "integer", required: true },
    { key: "n2", label: "N (control)", type: "integer", required: true }] },
  { id: "rct_continuous", label: "RCT continuous outcome", measures: ["MD", "SMD"], fields: [
    { key: "mean1", label: "Mean (intervention)", type: "number", required: true },
    { key: "sd1", label: "SD (intervention)", type: "number", required: true },
    { key: "n1", label: "N (intervention)", type: "integer", required: true },
    { key: "mean2", label: "Mean (control)", type: "number", required: true },
    { key: "sd2", label: "SD (control)", type: "number", required: true },
    { key: "n2", label: "N (control)", type: "integer", required: true }] },
  { id: "generic_effect", label: "Generic effect", measures: ["OR", "RR", "HR", "MD", "SMD"], fields: [
    { key: "yi", label: "log effect (yi)", type: "number", required: false },
    { key: "se", label: "Standard error", type: "number", required: false },
    { key: "effect", label: "Reported effect", type: "number", required: false },
    { key: "ciLower", label: "CI lower", type: "number", required: false },
    { key: "ciUpper", label: "CI upper", type: "number", required: false },
    { key: "ciLevel", label: "CI level", type: "number", required: false }] },
];
export function templateById(id) {
  for (const t of TEMPLATES) if (t.id === id) return t;
  return null;
}

function isFin(n) { return typeof n === "number" && Number.isFinite(n); }
function isInt(n) { return typeof n === "number" && Number.isInteger(n); }

/* Evidence locator (phase-1/locator.schema.json): manual or pdf, pdf block
 * preserved. Shared with _rob.js so both enforce the same shape. */
export function validateLocator(loc) {
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return "locator is required";
  if (loc.kind !== "manual" && loc.kind !== "pdf") return "locator.kind must be manual or pdf";
  if (typeof loc.citation !== "string" || !loc.citation.trim() || loc.citation.length > 500)
    return "locator.citation must be 1-500 characters";
  if (loc.page !== undefined && typeof loc.page !== "string" && !isInt(loc.page))
    return "locator.page must be a string or integer";
  if (loc.section !== undefined && (typeof loc.section !== "string" || loc.section.length > 200))
    return "locator.section must be at most 200 characters";
  if (loc.table !== undefined && (typeof loc.table !== "string" || loc.table.length > 200))
    return "locator.table must be at most 200 characters";
  if (loc.quote !== undefined && (typeof loc.quote !== "string" || loc.quote.length > 2000))
    return "locator.quote must be at most 2000 characters";
  if (loc.pdf !== undefined && loc.pdf !== null) {
    const pdf = loc.pdf;
    if (!pdf || typeof pdf !== "object" || Array.isArray(pdf)) return "locator.pdf must be an object";
    if (typeof pdf.artifactId !== "string" || !pdf.artifactId) return "locator.pdf.artifactId is required";
    if (!isInt(pdf.page) || pdf.page < 1) return "locator.pdf.page must be an integer of at least 1";
    if (pdf.box !== undefined) {
      const box = pdf.box;
      if (!box || typeof box !== "object") return "locator.pdf.box must be an object";
      for (const k of ["x", "y", "w", "h"])
        if (!(typeof box[k] === "number" && box[k] >= 0 && box[k] <= 1))
          return "locator.pdf.box." + k + " must be between 0 and 1";
    }
  }
  return null;
}

/* Phase-1 study inputs validation (mirrors [[path]].js validateInputs): exactly
 * one of rawCounts / rawMeans / reported / generic with the measure match. */
function validateInputs(measure, inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return "inputs must be an object";
  const keys = Object.keys(inputs);
  const has = (...ks) => ks.every((k) => keys.indexOf(k) >= 0);
  const noExtra = (...ks) => keys.every((k) => ks.indexOf(k) >= 0);
  let shape = null;
  if (has("events1", "n1", "events2", "n2") && noExtra("events1", "n1", "events2", "n2")) shape = "rawCounts";
  else if (has("mean1", "sd1", "n1", "mean2", "sd2", "n2") && noExtra("mean1", "sd1", "n1", "mean2", "sd2", "n2")) shape = "rawMeans";
  else if (has("effect", "ciLower", "ciUpper") && noExtra("effect", "ciLower", "ciUpper", "ciLevel")) shape = "reported";
  else if (has("yi") && noExtra("yi", "se", "sei", "vi")) shape = "generic";
  else return "inputs must be exactly one of rawCounts, rawMeans, reported or generic";
  if (shape === "rawCounts") {
    if (measure !== "OR" && measure !== "RR" && measure !== "RD") return "raw counts need measure OR, RR or RD";
    const { events1, n1, events2, n2 } = inputs;
    if (!isInt(events1) || events1 < 0 || !isInt(n1) || n1 < 1 || !isInt(events2) || events2 < 0 || !isInt(n2) || n2 < 1)
      return "raw counts need integer events of at least 0 and n of at least 1";
    if (events1 > n1 || events2 > n2) return "events cannot exceed n";
    return null;
  }
  if (shape === "rawMeans") {
    if (measure !== "MD" && measure !== "SMD") return "raw means need measure MD or SMD";
    const { mean1, sd1, n1, mean2, sd2, n2 } = inputs;
    if (!isFin(mean1) || !isFin(mean2)) return "means must be finite numbers";
    if (!isFin(sd1) || !(sd1 > 0) || !isFin(sd2) || !(sd2 > 0)) return "sd must be above 0";
    if (!isInt(n1) || n1 < 1 || !isInt(n2) || n2 < 1) return "n must be an integer of at least 1";
    return null;
  }
  if (shape === "reported") {
    const { effect, ciLower, ciUpper, ciLevel } = inputs;
    if (!isFin(effect) || !isFin(ciLower) || !isFin(ciUpper)) return "effect and CI bounds must be finite";
    if (!(ciLower < effect && effect < ciUpper)) return "reported CI needs ciLower below effect below ciUpper";
    if (ciLevel !== undefined && !(typeof ciLevel === "number" && ciLevel > 0 && ciLevel < 1)) return "ciLevel must be between 0 and 1";
    if ((measure === "OR" || measure === "RR" || measure === "HR") && !(effect > 0 && ciLower > 0 && ciUpper > 0))
      return "ratio effects must be positive";
    return null;
  }
  if (!isFin(inputs.yi)) return "generic yi must be finite";
  const spreads = [inputs.se, inputs.sei, inputs.vi].filter((v) => v !== undefined);
  if (!spreads.length) return "generic inputs need se, sei or vi";
  for (const v of spreads) if (!isFin(v) || !(v > 0)) return "generic se, sei and vi must be above 0";
  return null;
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

function fieldComplete(f) {
  return f && f.value != null && f.value !== "" && f.locator && f.quote;
}

async function suggestionsOf(db, extractionId) {
  const rows = (await db.prepare(
    "SELECT * FROM research_extraction_suggestions WHERE extraction_id=? AND status='unverified' ORDER BY created_ts ASC")
    .bind(extractionId).all()).results || [];
  return rows.map((r) => ({
    id: r.id, fieldKey: r.field_key, value: JSON.parse(r.value_json || "null"),
    locator: r.locator_json ? JSON.parse(r.locator_json) : null, quote: r.quote || "",
    model: r.model || "", status: "unverified", createdTs: r.created_ts,
  }));
}
export async function extractionOf(db, row) {
  return {
    id: row.id, projectId: row.project_id, studyId: row.study_id,
    artifactId: row.artifact_id || null, template: row.template, status: row.status,
    version: row.version, fields: JSON.parse(row.fields_json || "{}"),
    suggestions: await suggestionsOf(db, row.id),
    createdBy: row.created_by || "", createdTs: row.created_ts, updatedTs: row.updated_ts,
  };
}
function scaffold(projectId, studyId, template, uid, now) {
  return {
    id: "ext_draft_" + projectId + "_" + studyId, projectId, studyId, artifactId: null,
    template, status: "draft", version: 0, fields: {}, suggestions: [],
    createdBy: uid, createdTs: now, updatedTs: now,
  };
}
export async function rowFor(db, projectId, studyId) {
  return db.prepare("SELECT * FROM research_extractions WHERE project_id=? AND study_id=?")
    .bind(projectId, studyId).first();
}
async function appendAudit(db, extractionId, kind, uid, detail, now) {
  await db.prepare(
    "INSERT INTO research_extraction_audit (id,extraction_id,kind,field_key,old_json,new_json,reason,by_uid,ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind("exa_" + crypto.randomUUID().replace(/-/g, ""), extractionId, kind,
      detail.fieldKey || "", detail.old !== undefined ? JSON.stringify(detail.old) : null,
      detail.new !== undefined ? JSON.stringify(detail.new) : null,
      detail.reason || "", uid, now).run();
}
/* Resolve an extraction id to its project with a role gate. Outsiders and
 * unknown ids both get 404 extraction_not_found (Phase 1 convention). */
async function resolveExtraction(db, uid, extractionId, roles) {
  const row = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(extractionId).first();
  if (!row) return { status: 404, code: "extraction_not_found" };
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  if (!me || roles.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
      .bind(row.project_id, uid).first();
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "extraction_not_found" };
  }
  return { row, projectId: row.project_id, role: me.role };
}
function staleExtraction(current, requestId, json) {
  return json({ error: { code: "stale_version", message: "Extraction changed on the server", requestId },
    current: { extraction: current } }, 409, { "x-request-id": requestId });
}

/* ---- GET /v1/extraction-templates ------------------------------------------ */
export async function extractionTemplates(ctx) {
  return ctx.api.json({ templates: TEMPLATES }, 200, { "x-request-id": ctx.requestId });
}

/* ---- GET / PUT extraction -------------------------------------------------- */
export async function getExtraction(ctx, projectId, studyId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const study = await db.prepare("SELECT id FROM research_studies WHERE id=? AND project_id=?")
    .bind(studyId, projectId).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  const row = await rowFor(db, projectId, studyId);
  if (row) return json({ extraction: await extractionOf(db, row) }, 200, { "x-request-id": requestId });
  const template = url.searchParams.get("template") || "rct_binary";
  if (!templateById(template)) return err(422, "invalid_template", "Unknown extraction template", requestId);
  return json({ extraction: scaffold(projectId, studyId, template, uid, Date.now()) }, 200, { "x-request-id": requestId });
}

export async function putExtraction(ctx, projectId, studyId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Extraction needs an owner, editor or analyst role", requestId);
  const study = await db.prepare("SELECT id FROM research_studies WHERE id=? AND project_id=?")
    .bind(studyId, projectId).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  const tpl = templateById(body.template);
  if (!tpl) return err(422, "invalid_template", "Unknown extraction template", requestId);
  if (!isInt(body.version) || body.version < 0)
    return err(400, "invalid_body", "version must be an integer of at least 0", requestId);
  if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields))
    return err(400, "invalid_body", "fields must be an object", requestId);
  const fieldKeys = tpl.fields.map((f) => f.key);
  const row = await rowFor(db, projectId, studyId);
  const currentVersion = row ? row.version : 0;
  if (body.version !== currentVersion)
    return staleExtraction(row ? await extractionOf(db, row) : scaffold(projectId, studyId, tpl.id, uid, Date.now()), requestId, json);
  const fields = row ? JSON.parse(row.fields_json || "{}") : {};
  const now = Date.now();
  for (const key of Object.keys(body.fields)) {
    if (fieldKeys.indexOf(key) < 0) return err(400, "invalid_body", "Unknown field key: " + key, requestId);
    const f = body.fields[key] || {};
    if (f.value !== undefined && f.value !== null && typeof f.value !== "string" && typeof f.value !== "number")
      return err(400, "invalid_body", "field value must be a string, number or null", requestId);
    if (f.locator !== undefined && f.locator !== null) {
      const bad = validateLocator(f.locator);
      if (bad) return err(400, "invalid_body", bad, requestId);
    }
    if (f.quote !== undefined && (typeof f.quote !== "string" || f.quote.length > 2000))
      return err(400, "invalid_body", "quote must be at most 2000 characters", requestId);
    /* Editing invalidates prior verification: the value stays unverified. */
    fields[key] = { value: f.value === undefined ? null : f.value,
      locator: f.locator || null, quote: f.quote || "", status: "unverified",
      source: "human", verifier: null, verifiedAt: null };
    if (row) await appendAudit(db, row.id, "field_saved", uid, { fieldKey: key }, now);
  }
  const artifactId = body.artifactId !== undefined ? body.artifactId : (row ? row.artifact_id : null);
  let id;
  if (row) {
    id = row.id;
    await db.prepare("UPDATE research_extractions SET template=?,artifact_id=?,status='draft',fields_json=?,version=version+1,updated_ts=? WHERE id=?")
      .bind(tpl.id, artifactId, JSON.stringify(fields), now, id).run();
  } else {
    id = "ext_" + crypto.randomUUID().replace(/-/g, "");
    await db.prepare("INSERT INTO research_extractions (id,project_id,study_id,artifact_id,template,status,version,fields_json,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,'draft',1,?,?,?,?)")
      .bind(id, projectId, studyId, artifactId, tpl.id, JSON.stringify(fields), uid, now, now).run();
    for (const key of Object.keys(body.fields)) await appendAudit(db, id, "field_saved", uid, { fieldKey: key }, now);
  }
  await audit(db, projectId, uid, "extraction_saved", id, { template: tpl.id, fields: Object.keys(body.fields).length });
  const fresh = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(id).first();
  return json({ extraction: await extractionOf(db, fresh) }, 200, { "x-request-id": requestId });
}

/* ---- POST verify ----------------------------------------------------------- */
export async function verifyExtraction(ctx, extractionId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err } = api;
  const resolved = await resolveExtraction(db, uid, extractionId, WRITE_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Extraction not found", requestId);
  const row = resolved.row;
  if (!isInt(body.version) || body.version < 0)
    return err(400, "invalid_body", "version must be an integer of at least 0", requestId);
  if (body.version !== row.version) return staleExtraction(await extractionOf(db, row), requestId, json);
  const fields = JSON.parse(row.fields_json || "{}");
  const keys = body.fieldKey ? [body.fieldKey] : Object.keys(fields);
  const now = Date.now();
  for (const key of keys) {
    const f = fields[key];
    if (!f) continue;
    if (!fieldComplete(f))
      return err(422, "locator_required", "A value needs a locator and a quote before verification", requestId);
    f.status = "verified"; f.verifier = uid; f.verifiedAt = now;
    await appendAudit(db, row.id, "verified", uid, { fieldKey: key }, now);
  }
  await db.prepare("UPDATE research_extractions SET fields_json=?,status='verified',version=version+1,updated_ts=? WHERE id=?")
    .bind(JSON.stringify(fields), now, row.id).run();
  await api.audit(db, row.project_id, uid, "extraction_verified", row.id, { fieldKey: body.fieldKey || null });
  const fresh = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(row.id).first();
  return json({ extraction: await extractionOf(db, fresh) }, 200, { "x-request-id": requestId });
}

/* ---- POST correct (append-only audit) -------------------------------------- */
export async function correctExtraction(ctx, extractionId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err } = api;
  const resolved = await resolveExtraction(db, uid, extractionId, WRITE_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Extraction not found", requestId);
  const row = resolved.row;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!body.fieldKey || body.value === undefined || body.value === null || !reason)
    return err(400, "invalid_correction", "fieldKey, value and reason are required", requestId);
  if (typeof body.value !== "string" && typeof body.value !== "number")
    return err(400, "invalid_correction", "value must be a string or number", requestId);
  if (reason.length > 500) return err(400, "invalid_correction", "reason must be at most 500 characters", requestId);
  if (!isInt(body.version) || body.version < 0)
    return err(400, "invalid_body", "version must be an integer of at least 0", requestId);
  if (body.version !== row.version) return staleExtraction(await extractionOf(db, row), requestId, json);
  const fields = JSON.parse(row.fields_json || "{}");
  const prev = fields[body.fieldKey] || {};
  const old = prev.value === undefined ? null : prev.value;
  const locator = body.locator || prev.locator || null;
  const quote = body.quote || prev.quote || "";
  if (locator) { const bad = validateLocator(locator); if (bad) return err(400, "invalid_correction", bad, requestId); }
  const now = Date.now();
  fields[body.fieldKey] = { value: body.value, locator, quote, status: "corrected",
    source: "human", verifier: uid, verifiedAt: now };
  await appendAudit(db, row.id, "corrected", uid, { fieldKey: body.fieldKey, old, new: body.value, reason }, now);
  await db.prepare("UPDATE research_extractions SET fields_json=?,version=version+1,updated_ts=? WHERE id=?")
    .bind(JSON.stringify(fields), now, row.id).run();
  await api.audit(db, row.project_id, uid, "extraction_corrected", row.id, { fieldKey: body.fieldKey });
  const fresh = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(row.id).first();
  return json({ extraction: await extractionOf(db, fresh) }, 200, { "x-request-id": requestId });
}

/* ---- GET audit ------------------------------------------------------------- */
export async function extractionAudit(ctx, extractionId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err } = api;
  const resolved = await resolveExtraction(db, uid, extractionId, ALL_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Extraction not found", requestId);
  const rows = (await db.prepare("SELECT * FROM research_extraction_audit WHERE extraction_id=? ORDER BY ts DESC, rowid DESC")
    .bind(extractionId).all()).results || [];
  const events = rows.map((r) => {
    const e = { kind: r.kind, by: r.by_uid, ts: r.ts };
    if (r.field_key) e.fieldKey = r.field_key;
    if (r.old_json != null) e.old = JSON.parse(r.old_json);
    if (r.new_json != null) e.new = JSON.parse(r.new_json);
    if (r.reason) e.reason = r.reason;
    return e;
  });
  return json({ events }, 200, { "x-request-id": requestId });
}

/* ---- POST accept suggestion (never verifies) ------------------------------- */
export async function acceptSuggestion(ctx, extractionId, suggestionId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err } = api;
  const resolved = await resolveExtraction(db, uid, extractionId, WRITE_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Extraction not found", requestId);
  const row = resolved.row;
  if (body && body.version !== undefined && body.version !== row.version)
    return staleExtraction(await extractionOf(db, row), requestId, json);
  const sug = await db.prepare("SELECT * FROM research_extraction_suggestions WHERE id=? AND extraction_id=? AND status='unverified'")
    .bind(suggestionId, extractionId).first();
  if (!sug) return err(404, "extraction_not_found", "Suggestion not found", requestId);
  const fields = JSON.parse(row.fields_json || "{}");
  const now = Date.now();
  /* Accept moves the value into the field STILL unverified; a human must Verify
   * before promote. No suggestion is ever auto-applied or auto-verified. */
  fields[sug.field_key] = { value: JSON.parse(sug.value_json || "null"),
    locator: sug.locator_json ? JSON.parse(sug.locator_json) : null, quote: sug.quote || "",
    status: "unverified", source: "suggestion", verifier: null, verifiedAt: null };
  await db.prepare("UPDATE research_extraction_suggestions SET status='accepted' WHERE id=?").bind(sug.id).run();
  await appendAudit(db, row.id, "suggestion_accepted", uid, { fieldKey: sug.field_key }, now);
  await db.prepare("UPDATE research_extractions SET fields_json=?,status='draft',version=version+1,updated_ts=? WHERE id=?")
    .bind(JSON.stringify(fields), now, row.id).run();
  const fresh = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(row.id).first();
  return json({ extraction: await extractionOf(db, fresh) }, 200, { "x-request-id": requestId });
}

/* ---- POST promote (the only path to an engine-ready study) ----------------- */
export async function promoteExtraction(ctx, extractionId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const resolved = await resolveExtraction(db, uid, extractionId, WRITE_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Extraction not found", requestId);
  const row = resolved.row;
  const measure = body.measure;
  if (!MEASURES[measure]) return err(400, "invalid_body", "measure must be one of OR, RR, HR, RD, MD, SMD", requestId);
  const tpl = templateById(row.template);
  if (tpl.measures.indexOf(measure) < 0)
    return err(422, "invalid_template", "Measure " + measure + " is not allowed for template " + tpl.id, requestId);
  const fields = JSON.parse(row.fields_json || "{}");
  const attested = (k) => {
    const f = fields[k];
    return f && (f.status === "verified" || f.status === "corrected");
  };
  const num = (k) => Number(fields[k].value);
  let requiredKeys;
  if (tpl.id === "generic_effect") {
    /* generic shape (yi+se) wins; else reported (effect+CI). Ratio measures
     * keep the logged yi (generic) or display effect+CI (reported, which the
     * engine logs internally) exactly per the phase-1 study contract. */
    if (attested("yi") && attested("se")) requiredKeys = ["yi", "se"];
    else if (attested("effect") && attested("ciLower") && attested("ciUpper")) requiredKeys = ["effect", "ciLower", "ciUpper"];
    else return err(422, "extraction_unverified", "A generic effect needs verified yi+se or effect+CI; no AI value reaches analysis unverified", requestId);
  } else {
    requiredKeys = tpl.fields.filter((f) => f.required).map((f) => f.key);
  }
  /* Every required field must be human-attested AND carry locator+quote BEFORE
   * any value is read: no AI value reaches analysis unverified (plan gate 12). */
  for (const k of requiredKeys) {
    if (!attested(k))
      return err(422, "extraction_unverified", "Required field " + k + " is unverified; no AI value reaches analysis unverified", requestId);
    if (!fields[k].locator || !fields[k].quote)
      return err(422, "locator_required", "Field " + k + " needs a locator and a quote before promote", requestId);
  }
  let inputs;
  if (tpl.id === "generic_effect") {
    if (requiredKeys[0] === "yi") inputs = { yi: num("yi"), se: num("se") };
    else {
      inputs = { effect: num("effect"), ciLower: num("ciLower"), ciUpper: num("ciUpper") };
      if (fields.ciLevel && attested("ciLevel")) inputs.ciLevel = num("ciLevel");
    }
  } else {
    inputs = {};
    for (const k of requiredKeys) inputs[k] = num(k);
  }
  const badInputs = validateInputs(measure, inputs);
  if (badInputs) return err(422, "extraction_unverified", badInputs, requestId);
  const locKey = body.locatorFieldKey || requiredKeys[0];
  const locField = fields[locKey];
  if (!locField || !locField.locator || !locField.quote)
    return err(422, "locator_required", "The locator field needs a locator and a quote", requestId);
  const badLoc = validateLocator(locField.locator);
  if (badLoc) return err(422, "locator_required", badLoc, requestId);
  const label = body.label === undefined ? null : String(body.label).slice(0, 240);
  const study = await db.prepare("SELECT * FROM research_studies WHERE id=? AND project_id=?")
    .bind(row.study_id, row.project_id).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  const now = Date.now();
  /* Writes verified=1: this study is now engine-ready exactly like a phase-1
   * manual study. createRun refuses any study whose verified flag is 0. */
  await db.prepare("UPDATE research_studies SET measure=?,inputs_json=?,locator_json=?,quote=?,label=COALESCE(?,label),verified=1,verified_by=?,verified_at=?,version=version+1,updated_ts=? WHERE id=?")
    .bind(measure, JSON.stringify(inputs), JSON.stringify(locField.locator), locField.quote,
      label, uid, now, now, row.study_id).run();
  await appendAudit(db, row.id, "promoted", uid, { new: measure }, now);
  await audit(db, row.project_id, uid, "study.promoted", row.study_id, { measure, extractionId: row.id });
  const fresh = await db.prepare("SELECT * FROM research_studies WHERE id=?").bind(row.study_id).first();
  return json({ study: studyOf(fresh), requestId }, 200, { "x-request-id": requestId });
}

/* ---- PDF artifacts (3.2/3.3) ----------------------------------------------- */
function artifactOf(row, job) {
  const usage = job ? JSON.parse(job.usage_json || "{}") : {};
  return {
    id: row.id, projectId: row.project_id, filename: row.filename || "",
    sha256: row.sha256, bytes: row.bytes,
    pages: row.pages != null ? row.pages : (usage.pages != null ? usage.pages : null),
    status: job ? job.status : row.status, jobId: row.job_id || null, createdTs: row.created_ts,
  };
}
export async function listArtifacts(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare(
    "SELECT a.*, j.status AS job_status, j.usage_json AS job_usage FROM research_extraction_artifacts a LEFT JOIN research_job_runs j ON j.id=a.job_id WHERE a.project_id=? ORDER BY a.created_ts DESC, a.id DESC")
    .bind(projectId).all()).results || [];
  const artifacts = rows.map((r) => artifactOf(r, r.job_status ? { status: r.job_status, usage_json: r.job_usage } : null));
  return json({ artifacts }, 200, { "x-request-id": requestId });
}

export async function uploadPdfArtifact(ctx) {
  const { request, env, db, uid, requestId, api, projectId } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "PDF uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart PDF upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one PDF in the file field", requestId);
  if (file.size > 26214400) return err(413, "ceiling_bytes", "This file is larger than 25 MB. Upload a smaller version.", requestId);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(head) !== "%PDF-") return err(415, "file_type", "Only valid PDF files are accepted", requestId);
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const filename = typeof file.name === "string" ? file.name.slice(0, 240) : "";
  /* Content-addressed PDF row (reuses the 0003 research_pdfs layout). */
  let pdf = await db.prepare("SELECT * FROM research_pdfs WHERE project_id=? AND sha256=?").bind(projectId, sha256).first();
  const now = Date.now();
  if (!pdf) {
    const r2Key = "projects/" + projectId + "/pdf/" + sha256 + ".pdf";
    await env.RESEARCH_R2.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" },
      customMetadata: { projectId, uploadedBy: uid, sha256 } });
    const pdfId = "pdf_" + crypto.randomUUID().replace(/-/g, "");
    await db.prepare("INSERT INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,?,?,?,?)")
      .bind(pdfId, projectId, sha256, r2Key, file.size, uid, now).run();
    pdf = await db.prepare("SELECT * FROM research_pdfs WHERE id=?").bind(pdfId).first();
  }
  /* Enqueue through the existing job machinery (caps, credits, queue, idempotency). */
  const jobRes = await createJob(ctx, { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "pdfup:" + sha256 });
  if (jobRes.status >= 400) return jobRes;
  const jobBody = await jobRes.json();
  const job = jobBody.job;
  const existing = await db.prepare("SELECT * FROM research_extraction_artifacts WHERE project_id=? AND pdf_id=?")
    .bind(projectId, pdf.id).first();
  if (existing) {
    if (job && existing.job_id !== job.id)
      await db.prepare("UPDATE research_extraction_artifacts SET job_id=?,status=? WHERE id=?").bind(job.id, job.status, existing.id).run();
    const fresh = await db.prepare("SELECT a.*, j.status AS job_status, j.usage_json AS job_usage FROM research_extraction_artifacts a LEFT JOIN research_job_runs j ON j.id=a.job_id WHERE a.id=?").bind(existing.id).first();
    return json({ artifact: artifactOf(fresh, fresh.job_status ? { status: fresh.job_status, usage_json: fresh.job_usage } : null), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  }
  const artId = "art_" + crypto.randomUUID().replace(/-/g, "");
  await db.prepare("INSERT INTO research_extraction_artifacts (id,project_id,pdf_id,filename,sha256,bytes,job_id,status,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(artId, projectId, pdf.id, filename, sha256, file.size, job ? job.id : null, job ? job.status : "queued", uid, now).run();
  await audit(db, projectId, uid, "artifact_uploaded", artId, { bytes: file.size, sha256, jobId: job ? job.id : null });
  const fresh = await db.prepare("SELECT a.*, j.status AS job_status, j.usage_json AS job_usage FROM research_extraction_artifacts a LEFT JOIN research_job_runs j ON j.id=a.job_id WHERE a.id=?").bind(artId).first();
  return json({ artifact: artifactOf(fresh, fresh.job_status ? { status: fresh.job_status, usage_json: fresh.job_usage } : null), requestId }, 201, { "x-request-id": requestId });
}

export async function artifactResult(ctx, artifactId) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, member } = api;
  const row = await db.prepare("SELECT * FROM research_extraction_artifacts WHERE id=?").bind(artifactId).first();
  if (!row || !(await member(db, row.project_id, uid)))
    return err(404, "artifact_not_found", "Artifact not found", requestId);
  const job = row.job_id ? await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.job_id).first() : null;
  if (!job || job.status !== "succeeded")
    return err(409, "job_not_done", "The extraction job has not finished yet", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const key = "projects/" + row.project_id + "/jobs/" + job.id + "/result.json";
  const obj = await env.RESEARCH_R2.get(key);
  if (!obj) return err(409, "job_not_done", "The extraction result is not available yet", requestId);
  const result = await obj.json();
  return json(result, 200, { "x-request-id": requestId });
}
