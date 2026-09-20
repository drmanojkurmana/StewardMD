/* functions/_wardsynq/growth-tables.js - a hospital's own growth reference tables (WHO, IAP or another publisher's), loaded
 * with a licence confirmation, used by the growth chart in place of the CDC 2000 reference WardSynQ ships.
 *
 * WHY. WardSynQ ships only growth data whose licence permits commercial use: the CDC 2000 growth charts, a US Government
 * work in the public domain (owner decision 2026-09-17, vault/decisions/Decisions.md). The WHO Child Growth Standards are
 * CC BY-NC-SA 3.0 IGO and the IAP charts are the Indian Academy of Paediatrics'; a hospital licensed to use either loads
 * the LMS tables itself on Admin > FHIR > Growth charts and confirms that licence, the same way it loads a code set
 * (code-sets.js). Until it does, the chart uses CDC 2000 and says so.
 *
 * THE FILE. CSV (or tab-separated) with a header naming indicator, sex, x, l, m and s. indicator is wfa, lhfa, wfl, wfh,
 * bmi or hcfa; sex is 1 or male, 2 or female; x is the age in months (a WHO day table: days / 30.4375) or, for weight-for-
 * length (wfl, used under 24 months) and weight-for-height (wfh, from 24 months), the length or height in cm. method says
 * how z is computed: "lms" (plain LMS, CDC's method) or "who-restricted" (WHO's |z| > 3 adjustment on weight-for-age,
 * weight-for-length/height and BMI, as WHO's own anthro code does). Every row is checked; one bad row loads nothing.
 *
 * STORAGE. One GrowthTableImport record (who, when, the reference name, method, row count, the licence confirmation) and the
 * rows in GrowthTableChunk records, ids carrying the import id so a re-import never overwrites (append-only; a reader
 * follows the current import). Withdrawing (a lapsed licence) is a new version of the import record marked withdrawn:
 * the chart goes back to CDC 2000, and the loaded rows stay on record.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-growth-tables.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { INDICATORS, METHODS, CDC2000, hospitalReference } from "../../wardsynq/wardsynq-growth.js";

const IMPORT_TYPE = "GrowthTableImport", CHUNK_TYPE = "GrowthTableChunk", IMPORT_ID = "wsq-growthtable";
const CHUNK = 2000, MAX_ROWS = 60000;
const LICENCE = "This hospital holds a licence from the publisher of these growth tables (for example WHO or the Indian Academy of Paediatrics) that permits their use in this software for patient care.";
const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const chunkIdFor = (importId, n) => `wsq-growthtable-${importId}-${n}`;

async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/**
 * PURE. The CSV as rows [[indicator, sex, x, L, M, S]]. Returns { ok, rows, indicators } or { ok:false, error, detail, line }.
 * A row that is not a valid table row refuses the whole file: a growth table with a hole in it is not a table.
 */
function parseGrowthCsv(text) {
  const lines = String(text == null ? "" : text).replace(/^﻿/, "").split(/\r?\n|\r/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, error: "csv_empty", detail: "the file needs a header row and at least one table row" };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const head = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(["indicator", "sex", "x", "l", "m", "s"].map((k) => [k, head.indexOf(k)]));
  const missing = Object.keys(col).filter((k) => col[k] < 0);
  if (missing.length) return { ok: false, error: "csv_columns", detail: `the header must name the columns indicator, sex, x, l, m and s (missing: ${missing.join(", ")})` };
  if (lines.length - 1 > MAX_ROWS) return { ok: false, error: "csv_too_large", detail: `at most ${MAX_ROWS} rows can be loaded; this file has ${lines.length - 1}` };
  const rows = [], seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(delim).map((v) => v.trim());
    const ind = f[col.indicator].toLowerCase(), sexRaw = f[col.sex].toLowerCase();
    const sex = sexRaw === "1" || sexRaw === "male" ? "male" : sexRaw === "2" || sexRaw === "female" ? "female" : null;
    const [x, l, m, s] = [f[col.x], f[col.l], f[col.m], f[col.s]].map((v) => (v === "" || v == null ? NaN : Number(v)));
    const bad = !INDICATORS.includes(ind) ? `indicator "${f[col.indicator]}" is not one of ${INDICATORS.join(", ")}`
      : !sex ? `sex "${f[col.sex]}" is not 1, 2, male or female`
      : !(x >= 0) || !Number.isFinite(l) || !(m > 0) || !(s > 0) ? "x must be 0 or more, L a number, and M and S more than 0"
      : null;
    if (bad) return { ok: false, error: "csv_row_invalid", line: i + 1, detail: `line ${i + 1}: ${bad}` };
    const key = `${ind}|${sex}|${x}`;
    if (seen.has(key)) return { ok: false, error: "csv_row_duplicate", line: i + 1, detail: `line ${i + 1}: ${ind} ${sex} at ${x} appears twice` };
    seen.add(key);
    rows.push([ind, sex, x, l, m, s]);
  }
  const indicators = [...new Set(rows.map((r) => r[0]))].sort();
  return { ok: true, rows, indicators };
}

/**
 * POST /ward/growth-table-import. ctx: { migration, referenceName, method, csv, fileName?, licenceConfirmed, withdraw?,
 * actorDeps, recordDeps }. withdraw:true writes a withdrawn version of the import (back to CDC 2000); nothing else is read.
 * Chunks are written before the import record that points at them, so a failure part-way leaves the previous tables in use.
 */
async function importGrowthTables(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const withdraw = ctx.withdraw === true;
  const name = str(ctx.referenceName), method = str(ctx.method) || "lms";
  let parsed = null;
  if (!withdraw) {
    if (!name || name.length > 120) return { ...base, ok: false, status: 422, error: "reference_name_required", detail: "Name the reference (for example WHO Child Growth Standards 2006), at most 120 characters.", written: 0 };
    if (!METHODS.includes(method)) return { ...base, ok: false, status: 422, error: "method_invalid", detail: `the method is one of ${METHODS.join(", ")}`, written: 0 };
    if (ctx.licenceConfirmed !== true) return { ...base, ok: false, status: 422, error: "licence_not_confirmed", detail: LICENCE, written: 0 };
    parsed = parseGrowthCsv(ctx.csv);
    if (!parsed.ok) return { ...base, status: 422, ...parsed, written: 0 };
  }
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(IMPORT_TYPE, IMPORT_ID); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The growth tables could not be read, so nothing was changed.", written: 0 };
  }
  const at = new Date().toISOString();
  if (withdraw) {
    if (!current || current.withdrawn) return { ...base, ok: false, status: 409, error: "nothing_loaded", detail: "No growth tables of this hospital are in use.", written: 0 };
    try {
      const out = await svc.put({ ...current, withdrawn: { by: resolved.actor.id, at } }, { expectedVersion: current.version });
      return { ...base, ok: true, written: 1, withdrawn: true, version: out.record.version };
    } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  }
  const importId = at.replace(/[^0-9]/g, "");
  const chunks = Math.ceil(parsed.rows.length / CHUNK);
  let written = 0;
  try {
    for (let n = 0; n < chunks; n++) {
      await svc.put({ resourceType: CHUNK_TYPE, id: chunkIdFor(importId, n), importId, n, rows: parsed.rows.slice(n * CHUNK, (n + 1) * CHUNK) }, { expectedVersion: 0 });
      written++;
    }
    const rec = {
      resourceType: IMPORT_TYPE, id: IMPORT_ID, importId, chunks, count: parsed.rows.length, indicators: parsed.indicators,
      referenceName: name, method, fileName: str(ctx.fileName) || null, importedBy: resolved.actor.id, importedAt: at,
      licenceConfirmed: { by: resolved.actor.id, at, statement: LICENCE }, withdrawn: null,
      replaced: current ? { importId: current.importId, referenceName: current.referenceName, count: current.count, version: current.version } : null,
    };
    const out = await svc.put(rec, { expectedVersion: current ? current.version : 0 });
    written++;
    return { ...base, ok: true, written, count: rec.count, indicators: rec.indicators, chunks, version: out.record.version };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0, partialChunksIgnored: written }), detail: "The growth tables were not loaded; the reference in use before is still in use." };
  }
}

const CACHE = new Map();   // ponytail: per-isolate cache of whole tables, newest 4 kept.
/**
 * The reference the growth chart uses for this hospital: its loaded tables, or CDC 2000 when none are loaded (or they
 * were withdrawn). Throws when the tables cannot be read, so a read failure is never shown as CDC 2000.
 */
async function growthReferenceFor(svc, tenantId) {
  const imp = await svc.get(IMPORT_TYPE, IMPORT_ID);
  if (!imp || imp.withdrawn) return CDC2000;
  const key = `${tenantId}|${imp.importId}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const parts = await Promise.all(Array.from({ length: imp.chunks }, (_, n) => svc.get(CHUNK_TYPE, chunkIdFor(imp.importId, n))));
  if (parts.some((p) => !p || p.importId !== imp.importId)) throw new Error("growth tables incomplete");
  const ref = hospitalReference({ name: imp.referenceName, method: imp.method, rows: parts.flatMap((p) => p.rows || []),
    info: { citation: null, source: null, licence: imp.licenceConfirmed && imp.licenceConfirmed.statement, importedAt: imp.importedAt, importedBy: imp.importedBy, fileName: imp.fileName } });
  CACHE.set(key, ref);
  while (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
  return ref;
}

/** GET /ward/growth-tables - what the chart uses: this hospital's loaded tables, or CDC 2000. */
async function listGrowthTables(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", loaded: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, loaded: null };
  try {
    const imp = await svc.get(IMPORT_TYPE, IMPORT_ID);
    const loaded = imp ? { referenceName: imp.referenceName, method: imp.method, count: imp.count, indicators: imp.indicators, fileName: imp.fileName,
      importedAt: imp.importedAt, importedBy: imp.importedBy, withdrawn: imp.withdrawn || null } : null;
    return { ...base, ok: true, loaded, inUse: loaded && !loaded.withdrawn ? "hospital" : "cdc2000", cdc2000: CDC2000.info, licence: LICENCE, methods: METHODS, indicators: INDICATORS };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", loaded: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The growth tables could not be read. Do not read this as none loaded.", loaded: null };
  }
}

export { IMPORT_TYPE, CHUNK_TYPE, LICENCE, MAX_ROWS, parseGrowthCsv, importGrowthTables, listGrowthTables, growthReferenceFor };
