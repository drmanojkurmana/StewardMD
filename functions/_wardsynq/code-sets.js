/* functions/_wardsynq/code-sets.js - the SNOMED CT, ICD-10 and LOINC codes a hospital has loaded, and a search over them.
 *
 * NO LICENSED CONTENT SHIPS WITH WARDSYNQ. Each of these vocabularies is licensed by its owner: SNOMED CT in India
 * through NRCeS (the hospital's own affiliate licence), ICD-10 by WHO, LOINC by Regenstrief. A hospital loads the
 * release it is licensed for, as a CSV on Admin > FHIR, and confirms that licence on the import; the importer, the
 * time, the file name and that confirmation are kept on the record. Until a system is loaded it has no codes here
 * and the picker says so. (LOINC's licence text could not be retrieved to check redistribution terms, 2026-09-16,
 * so no LOINC table is shipped either; the few LOINC codes this build already carries stay in terminology.js.)
 *
 * STORAGE. One CodeSetImport record per system (who, when, how many, which import is current) and the codes in
 * CodeSetChunk records of CHUNK codes each, ids carrying the import id, so a re-import writes new chunks and never
 * overwrites the old ones (append-only like every record; a reader follows the current import only).
 *
 * A CODE IS CHOSEN BY A PERSON FROM THE LOADED SET. resolveCoding() is the gate every write that attaches a code
 * goes through: the system must be loaded and the code must be in it, and the display stored is the set's own,
 * never what the client typed.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-code-sets.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { systemUri } from "./terminology.js";

const IMPORT_TYPE = "CodeSetImport", CHUNK_TYPE = "CodeSetChunk";
const CHUNK = 2000;
// ponytail: every search reads the whole set into memory; past this size move the codes to an indexed store.
const MAX_CODES = 100000;
/* The systems a hospital may load, keyed the way terminology.js aliases them, with the licence the import asks the
 * hospital to confirm. */
const CODE_SYSTEMS = Object.freeze({
  snomed: { name: "SNOMED CT", uri: systemUri("snomed"), licence: "SNOMED CT: this hospital holds a SNOMED CT affiliate licence (in India, through NRCeS) covering this release." },
  "icd-10": { name: "ICD-10", uri: systemUri("icd-10"), licence: "ICD-10: this hospital is licensed by WHO (or its national release centre) to use this release." },
  loinc: { name: "LOINC", uri: systemUri("loinc"), licence: "LOINC: this hospital accepts the LOINC licence (loinc.org/license) and keeps its copyright notice with the content." },
});
const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const importIdFor = (system) => `wsq-codeset-${system}`;
const chunkIdFor = (system, importId, n) => `wsq-codeset-${system}-${importId}-${n}`;

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

/** PURE. One CSV/TSV line into fields (RFC 4180 quotes). */
function splitLine(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === "") q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/* The column names the common release files use. A hospital's own CSV names them code and display. */
const CODE_COLS = ["code", "loinc_num", "conceptid", "concept_id", "icd10code", "icd_code"];
const DISPLAY_COLS = ["display", "long_common_name", "term", "description", "title", "name", "preferred_term"];

/**
 * PURE. The CSV (or tab-separated release file) as [[code, display]], first row per code, inactive rows (an "active"
 * column of 0) left out. Returns { ok, rows, skipped } or { ok:false, error, detail }.
 */
function parseCodeCsv(text) {
  const lines = String(text == null ? "" : text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, error: "csv_empty", detail: "the file needs a header row and at least one code" };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const head = splitLine(lines[0], delim).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const ci = head.findIndex((h) => CODE_COLS.includes(h)), di = head.findIndex((h) => DISPLAY_COLS.includes(h)), ai = head.indexOf("active");
  if (ci < 0 || di < 0) return { ok: false, error: "csv_columns", detail: `the header must name a code column (${CODE_COLS.join(", ")}) and a display column (${DISPLAY_COLS.join(", ")})` };
  const seen = new Set(), rows = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const f = splitLine(line, delim), code = str(f[ci]), display = str(f[di]);
    if (!code || !display || (ai >= 0 && str(f[ai]) === "0") || seen.has(code)) { skipped++; continue; }
    seen.add(code); rows.push([code, display]);
  }
  if (!rows.length) return { ok: false, error: "csv_no_codes", detail: "no row had both a code and a display" };
  if (rows.length > MAX_CODES) return { ok: false, error: "csv_too_large", detail: `at most ${MAX_CODES} codes per system can be loaded; this file has ${rows.length}` };
  return { ok: true, rows, skipped };
}

/**
 * Loads (or replaces) one system's codes. ctx: { migration, system, csv, fileName?, licenceConfirmed, actorDeps, recordDeps }
 * Chunks are written before the import record that points at them, so a failure part-way leaves the previous set current
 * and is reported as nothing loaded.
 */
async function importCodeSet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const system = str(ctx.system);
  if (!CODE_SYSTEMS[system]) return { ...base, ok: false, status: 422, error: "system_invalid", detail: `the code system is one of ${Object.keys(CODE_SYSTEMS).join(", ")}`, written: 0 };
  if (ctx.licenceConfirmed !== true) return { ...base, ok: false, status: 422, error: "licence_not_confirmed", detail: CODE_SYSTEMS[system].licence, written: 0 };
  const parsed = parseCodeCsv(ctx.csv);
  if (!parsed.ok) return { ...base, status: 422, ...parsed, written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(IMPORT_TYPE, importIdFor(system)); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The code set could not be read, so nothing was loaded.", written: 0 };
  }
  const importedAt = new Date().toISOString();
  const importId = importedAt.replace(/[^0-9]/g, "");
  const chunks = Math.ceil(parsed.rows.length / CHUNK);
  let written = 0;
  try {
    for (let n = 0; n < chunks; n++) {
      await svc.put({ resourceType: CHUNK_TYPE, id: chunkIdFor(system, importId, n), system, importId, n, codes: parsed.rows.slice(n * CHUNK, (n + 1) * CHUNK) }, { expectedVersion: 0 });
      written++;
    }
    const rec = {
      resourceType: IMPORT_TYPE, id: importIdFor(system), system, uri: CODE_SYSTEMS[system].uri, importId, chunks, count: parsed.rows.length,
      skippedRows: parsed.skipped, fileName: str(ctx.fileName) || null, importedBy: resolved.actor.id, importedAt,
      licenceConfirmed: { by: resolved.actor.id, at: importedAt, statement: CODE_SYSTEMS[system].licence },
      replaced: current ? { importId: current.importId, count: current.count, version: current.version } : null,
    };
    const out = await svc.put(rec, { expectedVersion: current ? current.version : 0 });
    written++;
    return { ...base, ok: true, written, system, count: rec.count, skippedRows: parsed.skipped, chunks, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    // Chunks already written belong to an import nothing points at; the previous set is still the current one.
    return { ...base, ...writeFailure(e, { written: 0, partialChunksIgnored: written }), detail: "The code set was not loaded; the previous set, if any, is still in use." };
  }
}

const CACHE = new Map();   // ponytail: per-isolate cache of whole sets, newest 4 kept.
/** Every code of one loaded system, [[code, display]], or null when it is not loaded. Throws when it cannot be read. */
async function loadedCodes(svc, tenantId, system) {
  const imp = await svc.get(IMPORT_TYPE, importIdFor(system));
  if (!imp) return null;
  const key = `${tenantId}|${system}|${imp.importId}`;
  if (CACHE.has(key)) return { imp, rows: CACHE.get(key) };
  const parts = await Promise.all(Array.from({ length: imp.chunks }, (_, n) => svc.get(CHUNK_TYPE, chunkIdFor(system, imp.importId, n))));
  if (parts.some((p) => !p || p.importId !== imp.importId)) throw new Error("code set incomplete");
  const rows = parts.flatMap((p) => p.codes || []);
  CACHE.set(key, rows);
  while (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
  return { imp, rows };
}

/** ctx: { migration, actorDeps, recordDeps } - each loadable system and what is loaded for it. */
async function listCodeSets(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", systems: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, systems: [] };
  try {
    const systems = await Promise.all(Object.entries(CODE_SYSTEMS).map(async ([system, s]) => {
      const imp = await svc.get(IMPORT_TYPE, importIdFor(system));
      return { system, name: s.name, uri: s.uri, licence: s.licence, loaded: !!imp, count: imp ? imp.count : 0,
        importedAt: imp ? imp.importedAt : null, importedBy: imp ? imp.importedBy : null, fileName: imp ? imp.fileName : null };
    }));
    return { ...base, ok: true, systems };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", systems: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The loaded code sets could not be read. Do not read this as none loaded.", systems: [] };
  }
}

/** PURE. Codes whose code starts with the query, then displays containing every word of it, at most `limit`. */
function matchCodes(rows, q, limit) {
  const query = str(q).toLowerCase();
  if (!query) return [];
  const words = query.split(/\s+/).filter(Boolean), byCode = [], byWords = [];
  for (const [code, display] of rows || []) {
    if (code.toLowerCase().startsWith(query)) byCode.push([code, display]);
    else { const d = display.toLowerCase(); if (words.every((w) => d.includes(w))) byWords.push([code, display]); }
    if (byCode.length >= limit) break;
  }
  return [...byCode, ...byWords].slice(0, limit).map(([code, display]) => ({ code, display }));
}

/** ctx: { migration, system, q, limit?, actorDeps, recordDeps } */
async function searchCodes(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", codes: [] };
  const system = str(ctx.system);
  if (!CODE_SYSTEMS[system]) return { ...base, ok: false, status: 422, error: "system_invalid", codes: [] };
  if (str(ctx.q).length < 2) return { ...base, ok: false, status: 422, error: "query_too_short", detail: "type at least two characters", codes: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, codes: [] };
  let set;
  try { set = await loadedCodes(svc, mig.tenantId, system); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", codes: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The code set could not be read. Do not read this as no match.", codes: [] };
  }
  if (!set) return { ...base, ok: false, status: 409, error: "not_loaded", detail: `no ${CODE_SYSTEMS[system].name} codes are loaded for this hospital`, codes: [] };
  const limit = Math.min(Math.max(Number(ctx.limit) || 25, 1), 100);
  return { ...base, ok: true, system, name: CODE_SYSTEMS[system].name, uri: CODE_SYSTEMS[system].uri, codes: matchCodes(set.rows, ctx.q, limit) };
}

/**
 * The gate for a code attached to a record. input: { system, code } or nothing.
 * Returns { coding: null } for none, { coding: {system, uri, code, display} } for a code in the loaded set,
 * or { refuse: {status, error, detail} }. Throws when the set cannot be read.
 */
async function resolveCoding(svc, tenantId, input) {
  if (!input || (!str(input.system) && !str(input.code))) return { coding: null };
  const system = str(input.system), code = str(input.code);
  if (!CODE_SYSTEMS[system] || !code) return { refuse: { status: 422, error: "coding_invalid", detail: `a code needs a system (${Object.keys(CODE_SYSTEMS).join(", ")}) and the code` } };
  const set = await loadedCodes(svc, tenantId, system);
  if (!set) return { refuse: { status: 422, error: "code_set_not_loaded", detail: `no ${CODE_SYSTEMS[system].name} codes are loaded for this hospital` } };
  const hit = set.rows.find((r) => r[0] === code);
  if (!hit) return { refuse: { status: 422, error: "code_not_in_set", detail: `${code} is not in this hospital's ${CODE_SYSTEMS[system].name} codes` } };
  return { coding: { system, uri: CODE_SYSTEMS[system].uri, code, display: hit[1] } };
}

/** PURE. A stored coding as a FHIR Coding, or undefined. */
function fhirCodingOf(c) {
  return c && str(c.code) && str(c.uri) ? { system: str(c.uri), code: str(c.code), display: str(c.display) || undefined } : undefined;
}

export { CODE_SYSTEMS, IMPORT_TYPE, CHUNK_TYPE, MAX_CODES, parseCodeCsv, matchCodes, importCodeSet, listCodeSets, searchCodes, resolveCoding, fhirCodingOf };
