/* functions/_wardsynq/report-builder.js - a hospital's own reports, built from named datasets, never from a query.
 *
 * THERE IS NO QUERY LANGUAGE HERE. A report is a dataset name, a list of its column ids, simple filters, one group-by
 * and a count or a sum. Everything a caller sends is checked against the dataset's own column list, so nothing reads a
 * field the dataset did not name, and nothing reaches another hospital: every read is this hospital's RecordService,
 * under the reader's own grant.
 *
 * THE DOOR IS staff.admin, AND IT IS NOT ENOUGH ON ITS OWN. Each dataset re-checks the capability its own screen's
 * read route needs (billing.view for invoices, incident.investigate for incidents), and a column that identifies a
 * patient needs emr.view as well, whether it is shown, filtered on or grouped by. `hr` holds staff.admin and still
 * cannot pull a list of patients through this.
 *
 * Saved reports are records (SavedReport), shared within the hospital or kept to their author. CSV is built here.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";
import { csvRows } from "./compliance.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "SavedReport";
/* ROW_LIMIT: every record of the dataset's type is read (service.listAll, paged, oldest first); past it the newest are
 * not read and truncated says so. ponytail: audit O20 is the upgrade if paging is slow. */
const ROW_LIMIT = 50000, SHOW_LIMIT = 500;
const day = (t) => str(t).slice(0, 10) || null;
const losDays = (e) => { const a = Date.parse(e.periodStart || ""), b = Date.parse(e.periodEnd || ""); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(((b - a) / 86400000) * 10) / 10 : null; };
const recon = (inv) => { try { return reconciliationOf(inv); } catch (e) { return {}; } };

/* kind: text | date | number. pii: identifies a patient. get: how the value is read (default: the field of that id). */
const DATASETS = Object.freeze({
  encounters: { label: "Visits and admissions", type: "Encounter", cap: "emr.view", columns: [
    { id: "patientId", label: "Patient record id", kind: "text", pii: true },
    { id: "class", label: "Type of visit", kind: "text" }, { id: "status", label: "Status", kind: "text" },
    { id: "ward", label: "Ward", kind: "text", get: (r) => r.location && r.location.ward },
    { id: "startDay", label: "Start date", kind: "date", get: (r) => day(r.periodStart) },
    { id: "endDay", label: "End date", kind: "date", get: (r) => day(r.periodEnd) },
    { id: "lengthOfStayDays", label: "Length of stay (days)", kind: "number", get: losDays },
    { id: "disposition", label: "Discharge disposition", kind: "text" },
  ] },
  reports: { label: "Laboratory and imaging reports", type: "DiagnosticReport", cap: "emr.view", columns: [
    { id: "patientId", label: "Patient record id", kind: "text", pii: true },
    { id: "category", label: "Category", kind: "text" }, { id: "status", label: "Status", kind: "text" },
    { id: "test", label: "Test", kind: "text", get: (r) => r.display || r.code },
    { id: "reportedDay", label: "Reported date", kind: "date", get: (r) => day(r.reportedAt) },
  ] },
  immunizations: { label: "Vaccinations", type: "Immunization", cap: "emr.view", columns: [
    { id: "patientId", label: "Patient record id", kind: "text", pii: true },
    { id: "vaccine", label: "Vaccine", kind: "text" }, { id: "status", label: "Status", kind: "text" },
    { id: "doseNumber", label: "Dose number", kind: "number" }, { id: "occurredOn", label: "Date given", kind: "date", get: (r) => day(r.occurredOn) },
  ] },
  invoices: { label: "Invoices", type: "Invoice", cap: "billing.view", columns: [
    { id: "patientId", label: "Patient record id", kind: "text", pii: true },
    { id: "currency", label: "Currency", kind: "text" },
    { id: "charged", label: "Charged", kind: "number", get: (r) => recon(r).charged },
    { id: "paidIn", label: "Paid", kind: "number", get: (r) => recon(r).paidIn },
    { id: "balance", label: "Balance", kind: "number", get: (r) => recon(r).balance },
    { id: "invoiceStatus", label: "Invoice status", kind: "text", get: (r) => (r.void ? "void" : recon(r).status) },
  ] },
  incidents: { label: "Incident reports", type: "IncidentReport", cap: "incident.investigate", columns: [
    { id: "category", label: "Category", kind: "text" }, { id: "severity", label: "Severity", kind: "text" },
    { id: "state", label: "State", kind: "text" }, { id: "reportedDay", label: "Reported date", kind: "date", get: (r) => day(r.reportedAt) },
  ] },
  dataRequests: { label: "Data principal requests (DPDP)", type: "DataPrincipalRequest", cap: "dpdp.manage", columns: [
    { id: "patientId", label: "Patient record id", kind: "text", pii: true },
    { id: "kind", label: "Request", kind: "text" }, { id: "state", label: "State", kind: "text" },
    { id: "receivedVia", label: "Received by", kind: "text" }, { id: "receivedDay", label: "Received date", kind: "date", get: (r) => day(r.receivedAt) },
  ] },
});
const OPS = Object.freeze(["eq", "ne", "contains", "gte", "lte", "empty", "not-empty"]);
const PII_CAP = "emr.view";

/** PURE. The datasets as a screen sees them: no functions. */
function datasetList() {
  return Object.keys(DATASETS).map((id) => ({ id, label: DATASETS[id].label, cap: DATASETS[id].cap, columns: DATASETS[id].columns.map((c) => ({ id: c.id, label: c.label, kind: c.kind, pii: !!c.pii })) }));
}

/** PURE. Checks a spec against its dataset. Returns { error, detail } or { spec, dataset, needs: [caps] }. */
function validateSpec(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const ds = DATASETS[str(s.dataset)];
  if (!ds) return { error: "unknown_dataset" };
  const col = (id) => ds.columns.find((c) => c.id === id);
  const columns = (Array.isArray(s.columns) ? s.columns : []).map(str).filter(Boolean);
  if (columns.some((c) => !col(c))) return { error: "unknown_column" };
  const filters = Array.isArray(s.filters) ? s.filters.slice(0, 10) : [];
  for (const f of filters) {
    if (!f || !col(str(f.column)) || !OPS.includes(str(f.op))) return { error: "bad_filter" };
    if (!["empty", "not-empty"].includes(f.op) && str(f.value).length > 200) return { error: "bad_filter" };
  }
  const groupBy = str(s.groupBy) || null;
  if (groupBy && !col(groupBy)) return { error: "unknown_column" };
  const fn = s.aggregate && s.aggregate.fn === "sum" ? "sum" : "count";
  const sumCol = fn === "sum" ? str(s.aggregate.column) : null;
  if (fn === "sum" && !(col(sumCol) && col(sumCol).kind === "number")) return { error: "sum_needs_number_column" };
  if (!groupBy && !columns.length) return { error: "columns_required" };
  const used = [...columns, ...filters.map((f) => str(f.column)), ...(groupBy ? [groupBy] : []), ...(sumCol ? [sumCol] : [])];
  const needs = [ds.cap, ...(used.some((id) => col(id).pii) ? [PII_CAP] : [])];
  return {
    dataset: ds, needs: [...new Set(needs)],
    spec: { dataset: str(s.dataset), columns, filters: filters.map((f) => ({ column: str(f.column), op: str(f.op), value: str(f.value) })), groupBy, aggregate: { fn, column: sumCol } },
  };
}

function valueOf(ds, id, row) { const c = ds.columns.find((x) => x.id === id); const v = c.get ? c.get(row) : row[id]; return v === undefined ? null : v; }

/** PURE. Runs a validated spec over rows already read. */
function runSpec(ds, spec, records) {
  const pass = (row) => spec.filters.every((f) => {
    const v = valueOf(ds, f.column, row), kind = ds.columns.find((c) => c.id === f.column).kind;
    if (f.op === "empty") return v == null || v === "";
    if (f.op === "not-empty") return !(v == null || v === "");
    if (v == null) return false;
    const a = kind === "number" ? Number(v) : String(v).toLowerCase(), b = kind === "number" ? Number(f.value) : f.value.toLowerCase();
    if (f.op === "eq") return a === b;
    if (f.op === "ne") return a !== b;
    if (f.op === "contains") return String(a).includes(String(b));
    if (f.op === "gte") return a >= b;
    return a <= b;
  });
  const rows = records.filter(Boolean).filter(pass);
  const label = (id) => ds.columns.find((c) => c.id === id).label;
  if (spec.groupBy) {
    const groups = new Map();
    for (const r of rows) {
      const k = valueOf(ds, spec.groupBy, r); const key = k == null || k === "" ? "(blank)" : String(k);
      const cur = groups.get(key) || 0;
      groups.set(key, spec.aggregate.fn === "sum" ? cur + (Number(valueOf(ds, spec.aggregate.column, r)) || 0) : cur + 1);
    }
    const out = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => [key, Math.round(v * 100) / 100]);
    return { header: [label(spec.groupBy), spec.aggregate.fn === "sum" ? "Sum of " + label(spec.aggregate.column) : "Count"], rows: out, matched: rows.length };
  }
  return { header: spec.columns.map(label), rows: rows.map((r) => spec.columns.map((id) => valueOf(ds, id, r))), matched: rows.length };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });

/* The capability re-check. ctx.hasCap is the router's authorizeOrg for THIS hospital and THIS person. */
async function missingCap(ctx, needs) {
  for (const cap of needs) if (!(ctx.hasCap && (await ctx.hasCap(cap)))) return cap;
  return null;
}

async function execute(request, env, ctx, rawSpec) {
  const v = validateSpec(rawSpec);
  if (v.error) return { ok: false, status: 422, error: v.error };
  const lacking = await missingCap(ctx, v.needs);
  if (lacking) return { ok: false, status: 403, error: "forbidden", cap: lacking, detail: `This report needs ${lacking}, which your role does not include.` };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return error;
  let records;
  let truncated;
  try { ({ rows: records, truncated } = await svc.listAll(v.dataset.type, { max: ROW_LIMIT })); }
  catch (e) { return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed" }; }
  return { ok: true, spec: v.spec, truncated, ...runSpec(v.dataset, v.spec, records) };
}

/** ctx: { migration, spec, hasCap, actorDeps, recordDeps } */
async function runReport(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", rows: [] };
  const r = await execute(request, env, ctx, ctx.spec);
  if (!r.ok) return { ...base, ...r };
  return { ...base, ...r, rows: r.rows.slice(0, SHOW_LIMIT), shown: Math.min(r.rows.length, SHOW_LIMIT), total: r.rows.length };
}

async function savedReports(svc, actorId) {
  const all = (await svc.list(TYPE, 500)).filter(Boolean);
  return all.filter((r) => !r.deleted && (r.shared === true || r.ownerId === actorId));
}

/** ctx: { migration, reportId?, name, spec, shared, hasCap, actorDeps, recordDeps } */
async function saveReport(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const name = str(ctx.name).slice(0, 120);
  if (name.length < 2) return { ...base, ok: false, status: 422, error: "name_required", written: 0 };
  const v = validateSpec(ctx.spec);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, written: 0 };
  const lacking = await missingCap(ctx, v.needs);
  if (lacking) return { ...base, ok: false, status: 403, error: "forbidden", cap: lacking, written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const now = new Date().toISOString(), me = resolved.actor.id;
  try {
    let current = null;
    if (str(ctx.reportId)) {
      current = await svc.get(TYPE, str(ctx.reportId));
      if (!current || current.deleted) return { ...base, ok: false, status: 404, error: "report_not_found", written: 0 };
      if (current.ownerId !== me) return { ...base, ok: false, status: 403, error: "not_owner", detail: "Only the person who saved a report can change it.", written: 0 };
    }
    const id = current ? current.id : `wsq-report-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${now.replace(/[^0-9]/g, "").slice(0, 17)}`;
    const rec = { resourceType: TYPE, id, name, spec: v.spec, shared: ctx.shared === true, ownerId: current ? current.ownerId : me, createdAt: current ? current.createdAt : now, updatedAt: now, deleted: ctx.deleted === true && !!current, source: { system: "wardsynq-native", sourceId: "saved-report" } };
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined });
    return { ...base, ok: true, written: 1, report: { id, name, spec: rec.spec, shared: rec.shared, mine: true, deleted: rec.deleted, version: out.record.version } };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", written: 0 };
  }
}

/** ctx: { migration, actorDeps, recordDeps } */
async function listSavedReports(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", reports: [], datasets: datasetList() };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, reports: null, datasets: datasetList() };
  try {
    const rows = await savedReports(svc, resolved.actor.id);
    return { ...base, ok: true, datasets: datasetList(), reports: rows.map((r) => ({ id: r.id, name: r.name, spec: r.spec, shared: r.shared === true, mine: r.ownerId === resolved.actor.id, updatedAt: r.updatedAt })).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", reports: null, datasets: datasetList() }; }
}

/** ctx: { migration, reportId, hasCap, actorDeps, recordDeps } -> { ok, csv, filename } */
async function reportCsv(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: false, status: 409, error: "off" };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let saved;
  try { saved = (await savedReports(svc, resolved.actor.id)).find((r) => r.id === str(ctx.reportId)); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
  if (!saved) return { ...base, ok: false, status: 404, error: "report_not_found" };
  const r = await execute(request, env, ctx, saved.spec);
  if (!r.ok) return { ...base, ...r };
  const lines = [r.header, ...r.rows];
  if (r.truncated) lines.push([`Only the first ${ROW_LIMIT} records of this dataset were read; the report may be incomplete.`]);
  return { ...base, ok: true, csv: csvRows(lines), filename: (saved.name.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60) || "report") + ".csv" };
}

export { TYPE, DATASETS, OPS, ROW_LIMIT, datasetList, validateSpec, runSpec, runReport, saveReport, listSavedReports, reportCsv };
