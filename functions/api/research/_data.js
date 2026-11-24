/* ResearchMD Phase 3.8 study-level data import (module F, ES module, server).
 * Contract: docs/research/contracts/phase-3/data-import.md (+ frozen schemas).
 * Routes hooked in [[path]].js (Firebase auth + project role on every call):
 *   GET  /v1/projects/{pid}/data-dictionary
 *   PUT  /v1/projects/{pid}/data-dictionary
 *   POST /v1/projects/{pid}/data-uploads        (multipart .csv -> R2)
 *   POST /v1/projects/{pid}/data-imports        (validate + version + snapshot)
 *   GET  /v1/projects/{pid}/data-imports
 *   GET  /v1/data-imports/{iid}
 *   GET  /v1/data-imports/{iid}/snapshot        (frozen text/csv bytes)
 *   POST /v1/data-imports/{iid}/freeze
 *
 * STUDY-LEVEL only (one row per study). Patient-level data is behind the IPD
 * gate (5C) and is rejected here (422 ipd_gate). All validation is deterministic
 * code (plan integrity rule 5); no LLM. Every import is versioned and writes a
 * frozen R2 snapshot, even when checks fail, so the exact uploaded bytes are
 * auditable. rowsImported counts only rows that passed blocking checks; errors
 * are never hidden. A frozen import cannot be deleted; a new import supersedes.
 */
const WRITE_ROLES = ["owner", "editor", "analyst"];
const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const FREEZE_ROLES = ["owner", "editor"];
const COLUMN_TYPES = ["string", "integer", "number", "date", "category"];
const MAX_CSV_BYTES = 5 * 1024 * 1024;
/* Patient-level identifier columns trip the IPD gate (5C). Study-level rows
 * carry a study_id, never a patient identifier. */
const IPD_COLUMN_RE = /^(patient[_-]?id|patientid|mrn|subject[_-]?id|participant[_-]?id|person[_-]?id)$/i;

function isInt(n) { return typeof n === "number" && Number.isInteger(n); }

/* Deterministic CSV parse (RFC4180-style: quoted fields, embedded commas and
 * newlines, doubled quotes). Returns {header, rows}; fully blank lines skipped.
 * rows are arrays of cell strings aligned to the header. */
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false, i = 0;
  const s = String(text == null ? "" : text);
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r") { if (s[i + 1] === "\n") i++; pushRow(); i++; continue; }
    if (c === "\n") { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) pushRow();
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!nonEmpty.length) return { header: [], rows: [] };
  const header = nonEmpty[0].map((h) => String(h).trim());
  return { header, rows: nonEmpty.slice(1) };
}

function cellEmpty(v) { return v === undefined || v === null || String(v).trim() === ""; }
function parsesAs(type, v) {
  const t = String(v).trim();
  if (type === "integer") { const n = Number(t); return t !== "" && Number.isFinite(n) && Number.isInteger(n); }
  if (type === "number") { const n = Number(t); return t !== "" && Number.isFinite(n); }
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(t);
  return true; /* string, category checked against allowed separately */
}

/* Deterministic validation checks (data-import.md table). Messages are stable
 * and carry no cell value (no PHI). row is the 1-based CSV data row. */
export function validateCsv(header, rows, columns) {
  const checks = [];
  const colBy = {};
  for (const c of columns) colBy[c.column] = c;
  for (const h of header)
    if (!colBy[h]) checks.push({ code: "unknown_column", severity: "warning", row: null, column: h, message: 'Column "' + h + '" has no dictionary entry' });
  for (const c of columns)
    if (header.indexOf(c.column) < 0) checks.push({ code: "missing_column", severity: "warning", row: null, column: c.column, message: 'Dictionary column "' + c.column + '" is absent from the CSV' });
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const seen = {};
  let imported = 0;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];
    const rowNo = r + 1;
    let rowOk = true;
    for (const c of columns) {
      const ci = idx[c.column];
      const v = ci === undefined ? undefined : cells[ci];
      if (cellEmpty(v)) {
        if (c.required) { checks.push({ code: "missing_required", severity: "error", row: rowNo, column: c.column, message: "Required value missing in row " + rowNo }); rowOk = false; }
        else checks.push({ code: "missing_optional", severity: "warning", row: rowNo, column: c.column, message: "Optional value empty in row " + rowNo });
        continue;
      }
      const t = String(v).trim();
      if ((c.type === "integer" || c.type === "number" || c.type === "date") && !parsesAs(c.type, t)) {
        checks.push({ code: "type_mismatch", severity: "error", row: rowNo, column: c.column, message: "Row " + rowNo + ' column "' + c.column + '" is not a valid ' + c.type });
        rowOk = false; continue;
      }
      if ((c.type === "integer" || c.type === "number") && c.range) {
        const n = Number(t);
        if ((c.range.min !== undefined && n < c.range.min) || (c.range.max !== undefined && n > c.range.max)) {
          checks.push({ code: "out_of_range", severity: "error", row: rowNo, column: c.column, message: "Row " + rowNo + ' column "' + c.column + '" is outside the allowed range ' + c.range.min + " to " + c.range.max });
          rowOk = false;
        }
      }
      if (c.type === "category" && Array.isArray(c.allowed) && c.allowed.indexOf(t) < 0) {
        checks.push({ code: "not_allowed", severity: "error", row: rowNo, column: c.column, message: "Row " + rowNo + ' column "' + c.column + '" is not an allowed value' });
        rowOk = false;
      }
    }
    const sidIdx = idx.study_id;
    const sid = sidIdx === undefined ? undefined : cells[sidIdx];
    if (!cellEmpty(sid)) {
      const key = String(sid).trim();
      if (seen[key]) { checks.push({ code: "duplicate_study_id", severity: "error", row: rowNo, column: "study_id", message: "Duplicate study_id in row " + rowNo }); rowOk = false; }
      seen[key] = true;
    }
    if (rowOk) imported++;
  }
  const errs = checks.filter((c) => c.severity === "error").length;
  const warns = checks.filter((c) => c.severity === "warning").length;
  return { rowCount: rows.length, rowsImported: imported, checks, status: errs ? "errors" : warns ? "warnings" : "ok" };
}

function validateColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return "columns must be a non-empty array";
  const names = {};
  let hasStudyId = false;
  for (const c of columns) {
    if (!c || typeof c.column !== "string" || !c.column.trim()) return "each column needs a name";
    if (IPD_COLUMN_RE.test(c.column.trim()) || c.type === "patient_id") return "ipd_gate";
    if (names[c.column]) return "duplicate column name: " + c.column;
    names[c.column] = true;
    if (COLUMN_TYPES.indexOf(c.type) < 0) return "column type must be string, integer, number, date or category";
    if (typeof c.required !== "boolean") return "column.required must be a boolean";
    if (c.range !== undefined && c.range !== null) {
      if (!c.range || typeof c.range !== "object") return "range must be an object";
      if (c.range.min !== undefined && typeof c.range.min !== "number") return "range.min must be a number";
      if (c.range.max !== undefined && typeof c.range.max !== "number") return "range.max must be a number";
    }
    if (c.type === "category" && c.allowed !== undefined && (!Array.isArray(c.allowed) || c.allowed.some((a) => typeof a !== "string")))
      return "category allowed must be an array of strings";
    if (c.column === "study_id") {
      hasStudyId = true;
      if (c.type !== "string" || !c.required) return "study_id must be a required string column";
    }
  }
  if (!hasStudyId) return "a study_id column (string, required) is required";
  return null;
}
function cleanColumns(columns) {
  return columns.map((c) => {
    const out = { column: c.column, label: c.label === undefined ? "" : String(c.label),
      type: c.type, unit: c.unit === undefined ? "" : String(c.unit), required: !!c.required };
    if (c.range) out.range = { min: c.range.min, max: c.range.max };
    if (c.type === "category" && Array.isArray(c.allowed)) out.allowed = c.allowed.slice();
    return out;
  });
}
async function currentDictionary(db, projectId) {
  return db.prepare("SELECT * FROM research_data_dictionaries WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
}
function dictionaryOf(row) {
  return { version: row.version, columns: JSON.parse(row.columns_json || "[]") };
}
function importOf(row) {
  return {
    id: row.id, projectId: row.project_id, version: row.version,
    storageKey: row.storage_key, snapshotKey: row.snapshot_key,
    rowCount: row.row_count, rowsImported: row.rows_imported, status: row.status,
    checks: JSON.parse(row.checks_json || "[]"), dictionaryVersion: row.dictionary_version,
    frozen: row.frozen === 1, frozenTs: row.frozen_ts == null ? null : row.frozen_ts,
    createdBy: row.created_by || "", createdTs: row.created_ts,
  };
}
async function resolveImport(db, uid, importId, roles) {
  const row = await db.prepare("SELECT * FROM research_data_imports WHERE id=?").bind(importId).first();
  if (!row) return { status: 404, code: "import_not_found" };
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?").bind(row.project_id, uid).first();
  if (!me || roles.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?").bind(row.project_id, uid).first();
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "import_not_found" };
  }
  return { row, projectId: row.project_id, role: me.role };
}

/* ---- GET / PUT data-dictionary --------------------------------------------- */
export async function getDictionary(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const row = await currentDictionary(db, projectId);
  return json({ dictionary: row ? dictionaryOf(row) : { version: 0, columns: [] } }, 200, { "x-request-id": requestId });
}
export async function putDictionary(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "The data dictionary needs an owner, editor or analyst role", requestId);
  const bad = validateColumns(body.columns);
  if (bad === "ipd_gate") return err(422, "ipd_gate", "Patient-level identifiers are not allowed; study-level data only (IPD gate 5C)", requestId);
  if (bad) return err(422, "invalid_dictionary", bad, requestId);
  const current = await currentDictionary(db, projectId);
  const currentVersion = current ? current.version : 0;
  if (current) {
    if (!isInt(body.version) || body.version !== currentVersion)
      return json({ error: { code: "stale_version", message: "Dictionary changed on the server", requestId },
        current: { dictionary: dictionaryOf(current) } }, 409, { "x-request-id": requestId });
  } else if (body.version !== undefined && body.version !== 0 && body.version !== 1) {
    return err(400, "invalid_dictionary", "version must be 0 or 1 for the first dictionary", requestId);
  }
  const version = currentVersion + 1;
  const columns = cleanColumns(body.columns);
  const now = Date.now();
  const id = "dic_" + crypto.randomUUID().replace(/-/g, "");
  await db.prepare("INSERT INTO research_data_dictionaries (id,project_id,version,columns_json,created_by,created_ts) VALUES (?,?,?,?,?,?)")
    .bind(id, projectId, version, JSON.stringify(columns), uid, now).run();
  await audit(db, projectId, uid, "data_dictionary_saved", id, { version });
  return json({ dictionary: { version, columns } }, 200, { "x-request-id": requestId });
}

/* ---- POST data-uploads ----------------------------------------------------- */
export async function uploadData(ctx) {
  const { request, env, db, uid, requestId, api, projectId } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Data uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart CSV upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one CSV in the file field", requestId);
  if (file.size < 1 || file.size > MAX_CSV_BYTES)
    return err(413, "file_size", "CSV must be 1 byte to 5 MiB", requestId);
  const name = typeof file.name === "string" ? file.name : "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext !== "csv") return err(415, "file_type", "Data file must be .csv", requestId);
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const text = new TextDecoder().decode(bytes);
  const { header, rows } = parseCsv(text);
  const storageKey = "projects/" + projectId + "/data/" + sha256 + ".csv";
  await env.RESEARCH_R2.put(storageKey, bytes, { httpMetadata: { contentType: "text/csv" },
    customMetadata: { projectId, uploadedBy: uid, sha256 } });
  await audit(db, projectId, uid, "data_uploaded", storageKey, { bytes: file.size, sha256, rowCount: rows.length });
  return json({ storageKey, sha256, bytes: file.size, rowCount: rows.length, columns: header }, 201, { "x-request-id": requestId });
}

/* ---- POST data-imports (validate + version + snapshot) --------------------- */
export async function createDataImport(ctx, projectId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Data imports need an owner, editor or analyst role", requestId);
  const storageKey = typeof body.storageKey === "string" ? body.storageKey : "";
  if (!storageKey) return err(400, "invalid_body", "storageKey is required", requestId);
  if (storageKey.indexOf("projects/" + projectId + "/") !== 0)
    return err(403, "not_member", "Storage key is outside this project", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const obj = await env.RESEARCH_R2.get(storageKey);
  if (!obj) return err(404, "import_not_found", "Upload not found in storage", requestId);
  const text = await obj.text();
  /* Dictionary: the requested version, else the current one. */
  let dictRow;
  if (body.dictionaryVersion !== undefined) {
    if (!isInt(body.dictionaryVersion) || body.dictionaryVersion < 1)
      return err(400, "invalid_dictionary", "dictionaryVersion must be an integer of at least 1", requestId);
    dictRow = await db.prepare("SELECT * FROM research_data_dictionaries WHERE project_id=? AND version=?")
      .bind(projectId, body.dictionaryVersion).first();
    if (!dictRow) return err(400, "invalid_dictionary", "Dictionary version not found", requestId);
  } else {
    dictRow = await currentDictionary(db, projectId);
  }
  if (!dictRow) return err(422, "invalid_dictionary", "A data dictionary with a study_id column is required before importing", requestId);
  const columns = JSON.parse(dictRow.columns_json || "[]");
  if (columns.some((c) => IPD_COLUMN_RE.test(String(c.column)) || c.type === "patient_id"))
    return err(422, "ipd_gate", "Patient-level identifiers are not allowed; study-level data only (IPD gate 5C)", requestId);
  const { header, rows } = parseCsv(text);
  /* A patient-level identifier header in the CSV also trips the gate. */
  if (header.some((h) => IPD_COLUMN_RE.test(String(h).trim())))
    return err(422, "ipd_gate", "Patient-level identifiers are not allowed; study-level data only (IPD gate 5C)", requestId);
  const v = validateCsv(header, rows, columns);
  const importId = "imp_" + crypto.randomUUID().replace(/-/g, "");
  const snapshotKey = "projects/" + projectId + "/data/snapshots/" + importId + ".csv";
  /* A snapshot is ALWAYS written, even when checks fail: the exact uploaded
   * bytes are frozen and auditable. Re-importing creates a new version. */
  await env.RESEARCH_R2.put(snapshotKey, text, { httpMetadata: { contentType: "text/csv" },
    customMetadata: { projectId, importId, sha256: "" } });
  const last = await db.prepare("SELECT MAX(version) AS v FROM research_data_imports WHERE project_id=?").bind(projectId).first();
  const version = ((last && last.v) || 0) + 1;
  const now = Date.now();
  await db.prepare("INSERT INTO research_data_imports (id,project_id,version,storage_key,snapshot_key,row_count,rows_imported,status,checks_json,dictionary_version,frozen,frozen_ts,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)")
    .bind(importId, projectId, version, storageKey, snapshotKey, v.rowCount, v.rowsImported, v.status,
      JSON.stringify(v.checks), dictRow.version, uid, now).run();
  await audit(db, projectId, uid, "data_imported", importId, { version, status: v.status, rowCount: v.rowCount, rowsImported: v.rowsImported });
  const row = await db.prepare("SELECT * FROM research_data_imports WHERE id=?").bind(importId).first();
  return json({ import: importOf(row) }, 201, { "x-request-id": requestId });
}

/* ---- GET imports / one / snapshot / freeze --------------------------------- */
export async function listDataImports(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.max(1, Math.min(100, limit));
  const rows = (await db.prepare("SELECT * FROM research_data_imports WHERE project_id=? ORDER BY version DESC, id DESC LIMIT ?")
    .bind(projectId, limit + 1).all()).results || [];
  const body = { imports: rows.slice(0, limit).map(importOf) };
  if (rows.length > limit) body.nextCursor = String(rows[limit - 1].version);
  return json(body, 200, { "x-request-id": requestId });
}
export async function getDataImport(ctx, importId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err } = api;
  const resolved = await resolveImport(db, uid, importId, ALL_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Import not found", requestId);
  return json({ import: importOf(resolved.row) }, 200, { "x-request-id": requestId });
}
export async function getDataSnapshot(ctx, importId) {
  const { env, db, uid, requestId, api } = ctx;
  const { err } = api;
  const resolved = await resolveImport(db, uid, importId, ALL_ROLES);
  if (resolved.status) return err(resolved.status, resolved.code, "Import not found", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const obj = await env.RESEARCH_R2.get(resolved.row.snapshot_key);
  if (!obj) return err(404, "import_not_found", "Snapshot not found", requestId);
  const text = await obj.text();
  return new Response(text, { status: 200, headers: {
    "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-request-id": requestId } });
}
export async function freezeDataImport(ctx, importId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const resolved = await resolveImport(db, uid, importId, FREEZE_ROLES);
  if (resolved.status)
    return err(resolved.status, resolved.code, resolved.code === "not_member" ? "Freezing needs an owner or editor role" : "Import not found", requestId);
  if (resolved.row.frozen === 1)
    return err(409, "already_frozen", "Import already frozen", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_data_imports SET frozen=1,frozen_ts=? WHERE id=?").bind(now, importId).run();
  await audit(db, resolved.projectId, uid, "data_import_frozen", importId, { version: resolved.row.version });
  const row = await db.prepare("SELECT * FROM research_data_imports WHERE id=?").bind(importId).first();
  return json({ import: importOf(row) }, 200, { "x-request-id": requestId });
}
