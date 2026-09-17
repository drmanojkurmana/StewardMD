/* functions/_wardsynq/fhir-bulk.js - FHIR Bulk Data export ($export), per the HL7 Bulk Data Access IG v2.
 *
 * fhir.js answers one resource, one search, one patient's $everything. A successor system, a
 * research warehouse or a national exchange wants the hospital: every Observation since last
 * Tuesday, as NDJSON, without paging a search API ten thousand times. This is that, and nothing wider.
 *
 *   GET    [base]/$export                 system level: every exported type the caller may read
 *   GET    [base]/Patient/$export         the patient compartment: resources that belong to a patient
 *   GET    [base]/Group/{id}/$export      one ward's census at kick-off (fhir-group.js), its patients' resources
 *   POST   any of the three above         the same kick-off with a Parameters body (IG v2)
 *   GET    [base]/$export-status/{id}     202 + X-Progress while running, 200 + manifest when done
 *   DELETE [base]/$export-status/{id}     cancel; the files go too
 *   GET    [base]/$export-file/{id}/{f}   one NDJSON file, with auth, audited
 *
 * WHO. A SMART backend-services token (system/ scopes, the types narrowed to what it was granted) on
 * /api/fhir, or a staff session on the ward door holding staff.admin AND a clinical actor that may read
 * each type - the same double gate the backup export and the security review use, so hr (staff.admin,
 * no clinical actor) is refused by the store, not by a screen. Always one hospital: every read and
 * every file is keyed by the tenant the door resolved.
 *
 * THE WORK IS NOT DONE IN THE REQUEST. Kick-off writes the job, its slot and an outbox event in ONE
 * append (with the audit row). ops-tick drains the event: one bounded run walks the record's change
 * stream for a few pages, writes one encrypted NDJSON part per type to the document object store, and
 * appends the next job version together with the next event. A worker that dies mid-run leaves the
 * cursor where it was and the event is retried; a run that keeps failing marks the job FAILED rather
 * than leaving it "in progress" for ever.
 *
 * THE WALK. repository.changes() is every version in sequence order. A row is exported when it is the
 * version current AT transactionTime: the latest version, or - when the record changed after the export
 * began - the last version recorded at or before it. Rows recorded after transactionTime are skipped,
 * so a resource edited mid-export appears once, as it stood when the export was asked for.
 *
 * NOTHING IS SILENTLY OMITTED. A record with no honest FHIR mapping is counted and named in error[];
 * an export that hits MAX_RESOURCES stops and says which types may be incomplete; a failure is a
 * failed status with its reason. The manifest is only ever served for a job that finished.
 *
 * ONE ACTIVE EXPORT PER HOSPITAL, held by a versioned slot record: two kick-offs that both see it free
 * cannot both claim it, because the repository refuses the second version.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { canRead } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { outboxEvent, MAX_ATTEMPTS } from "./outbox.js";
import { FHIR_TYPE, CANONICAL_TYPE, toFhir, operationOutcome } from "./fhir.js";
import { groupMembers } from "./fhir-group.js";
import { sha256Hex } from "./object-store.js";
import { docKey, encryptBytes, decryptBytes } from "./documents.js";

const str = (v) => (v == null ? "" : String(v).trim());

const JOB_TYPE = "_wardsynq_fhir_export";
const SLOT_TYPE = "_wardsynq_fhir_export_slot";
const SLOT_ID = "active";
const TOPIC_CHUNK = "fhir.export.chunk";
const TOPIC_EXPIRE = "fhir.export.expire";
const CHUNK_ROWS = 200;
const PAGES_PER_RUN = 10;
/* ponytail: a hard ceiling per export, reported in error[] when hit; narrow with _type/_since beyond it. */
const MAX_RESOURCES = 200000;
const FILE_TTL_MS = 24 * 3600 * 1000;
/** An in-progress job nothing has advanced for this long is reported failed and frees the slot. */
const STALL_MS = 60 * 60 * 1000;
const OUTPUT_FORMATS = ["application/fhir+ndjson", "application/ndjson", "ndjson"];
const NDJSON = "application/fhir+ndjson";

const recordedAt = (r) => str((r && r.meta && r.meta.recordedAt) || (r && r.writtenBy && r.writtenBy.at));
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/* ---- pure ------------------------------------------------------------------------------------ */

/**
 * PURE. The kick-off parameters. STRICT: a parameter this server does not honour is a 400, never
 * dropped, because a client that asked for a filtered export and got the whole hospital believes it
 * holds the filtered one. `p` is URLSearchParams or { _type, _since, _outputFormat }.
 */
function parseExportParams(p) {
  const get = (k) => (p instanceof URLSearchParams ? p.get(k) : p && p[k]);
  const keys = p instanceof URLSearchParams ? [...new Set([...p.keys()])] : Object.keys(p || {});
  const problems = [];
  for (const k of keys) if (!["_type", "_since", "_outputFormat", "orgId"].includes(k)) problems.push(`${k} is not supported by this server`);
  const fmt = str(get("_outputFormat"));
  if (fmt && !OUTPUT_FORMATS.includes(fmt)) problems.push(`_outputFormat ${fmt} is not supported; use ${NDJSON}`);
  const rawTypes = Array.isArray(get("_type")) ? get("_type") : str(get("_type")).split(",");
  const types = [...new Set(rawTypes.map(str).filter(Boolean))];
  for (const t of types) if (!CANONICAL_TYPE[t]) problems.push(`_type ${t} is not exported by this server`);
  let since = null;
  const rawSince = str(get("_since"));
  if (rawSince) {
    const ms = Date.parse(rawSince);
    if (!/^\d{4}-\d{2}-\d{2}/.test(rawSince) || !Number.isFinite(ms)) problems.push(`_since ${rawSince} is not a FHIR instant`);
    else since = new Date(ms).toISOString();
  }
  return { types: types.filter((t) => CANONICAL_TYPE[t]).sort(), since, problems };
}

/**
 * PURE. A POST kick-off's Parameters body as the same parameter object a GET's query gives (Bulk Data
 * IG v2: _type as valueString, repeatable; _since as valueInstant; _outputFormat as valueString). A
 * parameter name this server does not honour is carried through so parseExportParams names it as a 400;
 * a body that is not Parameters is a problem of its own.
 */
function parametersToExportParams(body) {
  if (body === undefined || body === null || (typeof body === "object" && !Object.keys(body).length)) return { params: {} };
  if (!body || body.resourceType !== "Parameters") return { error: "a POST $export body must be a FHIR Parameters resource" };
  const out = {};
  for (const p of Array.isArray(body.parameter) ? body.parameter : []) {
    const name = str(p && p.name);
    if (!name) return { error: "every Parameters.parameter needs a name" };
    const v = p.valueString !== undefined ? p.valueString : p.valueInstant !== undefined ? p.valueInstant : p.valueDateTime !== undefined ? p.valueDateTime : p.valueCode !== undefined ? p.valueCode : null;
    if (v === null) { out[name] = out[name] || "(no value)"; continue; }
    if (name === "_type") { out._type = [...(out._type || []), ...str(v).split(",")]; continue; }
    out[name] = str(v);
  }
  return { params: out };
}

/** PURE. What a job's status is NOW: a job past its expiry is expired, a stuck one has failed. */
function effectiveStatus(job, nowMs) {
  if (!job) return null;
  if (job.status === "in-progress" && Date.parse(job.progressAt) + STALL_MS <= nowMs) return "failed";
  if (job.status === "complete" && (job.filesDeleted || Date.parse(job.expiresAt) <= nowMs)) return "expired";
  return job.status;
}

/** PURE. The Bulk Data manifest of a complete job. `link(name)` builds a file URL. */
function manifestOf(job, link) {
  const issues = job.issues || [];
  return {
    transactionTime: job.transactionTime,
    request: job.request,
    requiresAccessToken: true,
    output: (job.output || []).map((f) => ({ type: f.type, url: link(f.name), count: f.count })),
    error: (job.errorFiles || []).map((f) => ({ type: "OperationOutcome", url: link(f.name), count: f.count })),
    ...(issues.length ? { extension: { "https://wardsynq.com/fhir/StructureDefinition/export-issues": issues } } : {}),
  };
}

/** PURE. The admin screen's view of one job. No file keys, no PHI. */
function summaryOf(job, nowMs) {
  return {
    id: job.id, status: effectiveStatus(job, nowMs), level: job.level, groupName: job.groupName || null, types: job.types, since: job.since,
    requestedAt: job.transactionTime, requestedBy: job.requestedBy, completedAt: job.completedAt || null, expiresAt: job.expiresAt || null,
    exported: job.exported || 0, files: (job.output || []).map((f) => ({ type: f.type, name: f.name, count: f.count })),
    issues: job.issues || [], error: job.error || (effectiveStatus(job, nowMs) === "failed" && job.status === "in-progress" ? "the export stopped making progress" : null),
  };
}

/* ---- who is asking ---------------------------------------------------------------------------- */

const fail = (status, code, detail) => ({ ok: false, status, outcome: operationOutcome("error", code, detail) });

/**
 * The requester and the canonical types it may export. A bearer must be a backend-services token
 * (system/ scopes, no patient context); a staff session resolves its clinical actor here (the route
 * has already required staff.admin). Returns { requester } or { error }.
 */
async function requesterOf(request, env, ctx) {
  if (ctx.actorOverride) {
    const b = ctx.actorOverride;
    if (b.source !== "smart:backend" || b.patientId || !(b.scopes || []).some((s) => /^system\//.test(s))) {
      return { error: fail(403, "forbidden", "bulk export needs a SMART backend-services token with system/ scopes") };
    }
    return { requester: { id: b.actor.id, kind: "smart", actor: b.actor } };
  }
  try {
    const r = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { requester: { id: r.actor.id, kind: "staff", actor: r.actor } };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: fail(status, status === 401 ? "login" : "forbidden", str(e && e.message)) };
  }
}

/** A staff member may see every export of the hospital; a SMART client only its own. */
const mayOpen = (requester, job) => !!job && (requester.kind === "staff" || job.requestedBy === requester.id);

function auditEvent(action, actor, fields) {
  return { ts: new Date().toISOString(), actor, connectorId: "wardsynq-fhir-bulk", action, outcome: "ok", ...fields };
}

/* ---- kick-off --------------------------------------------------------------------------------- */

/**
 * ctx: { migration, recordDeps, actorDeps, actorOverride?, store, env, level: "system"|"patient",
 *        params (URLSearchParams | object), requestUrl }
 * Returns { ok, status: 202, jobId } or { ok: false, status, outcome }.
 */
async function kickoffExport(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return fail(404, "not-supported", "this hospital does not run the WardSynQ record");
  if (!ctx.store) return fail(503, "exception", "Document storage is not set up for this hospital, so no export files can be written. Nothing was started.");
  if (!(await docKey(env))) return fail(503, "exception", "Export files cannot be stored encrypted on this server, so no export was started.");

  const { types, since, problems } = parseExportParams(ctx.params);
  if (problems.length) return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: problems.map((d) => ({ severity: "error", code: "not-supported", diagnostics: d })) } };

  const who = await requesterOf(request, env, ctx);
  if (who.error) return who.error;
  const { requester } = who;
  const exportable = Object.values(FHIR_TYPE).filter((t) => canRead(requester.actor, CANONICAL_TYPE[t]));
  const wanted = types.length ? types : exportable.sort();
  const refused = wanted.filter((t) => !exportable.includes(t));
  if (refused.length) return fail(403, "forbidden", `not permitted to export ${refused.join(", ")}`);
  if (!wanted.length) return fail(403, "forbidden", "this requester may not read any exported type");

  /* G9. Group/{id}/$export: the ward census frozen at kick-off, read as the requester (fhir-group.js).
   * The member list is on the job, so a patient admitted after the kick-off is not in this export. */
  let group = null;
  if (ctx.level === "group") {
    const m = await groupMembers(request, env, ctx, ctx.groupId);
    if (m.error) return { ok: false, status: m.error.status, outcome: m.error.outcome };
    group = { id: str(ctx.groupId), name: m.ward, members: m.patientIds };
  }

  const repo = ctx.recordDeps.repository, tenantId = mig.tenantId;
  const now = new Date(), nowIso = now.toISOString();
  let slot, holder = null;
  try {
    slot = await repo.latest(tenantId, SLOT_TYPE, SLOT_ID);
    holder = slot && slot.jobId ? await repo.latest(tenantId, JOB_TYPE, slot.jobId) : null;
  } catch (e) { return fail(502, "exception", "the export queue could not be read"); }
  if (holder && effectiveStatus(holder, now.getTime()) === "in-progress") {
    return { ...fail(429, "throttled", "an export is already running for this hospital; wait for it to finish or cancel it"), retryAfter: 120 };
  }

  const jobId = `wsq-fhirexp-${randomHex(12)}`;
  const by = { id: requester.id, kind: requester.kind === "smart" ? "service" : "human", at: nowIso };
  const job = {
    resourceType: JOB_TYPE, id: jobId, version: 1, status: "in-progress", level: ctx.level === "patient" ? "patient" : group ? "group" : "system",
    ...(group ? { groupId: group.id, groupName: group.name, members: group.members } : {}),
    types: wanted, since, transactionTime: nowIso, request: str(ctx.requestUrl), requestedBy: requester.id, requesterKind: requester.kind,
    cursor: 0, exported: 0, output: [], errorFiles: [], issues: [], unrendered: {}, progressAt: nowIso, writtenBy: by,
  };
  const nextSlot = { resourceType: SLOT_TYPE, id: SLOT_ID, version: slot ? slot.version + 1 : 1, jobId, writtenBy: by };
  const evt = outboxEvent(TOPIC_CHUNK, { jobId, cursor: 0 }, nowIso);
  try {
    await repo.append(tenantId, [job, nextSlot, evt], { audit: auditEvent("fhir.export.kickoff", requester.id, { resourceCounts: null, scope: { jobId, level: job.level, types: wanted, since, via: requester.kind, ...(group ? { groupId: group.id, members: group.members.length } : {}) } }) });
  } catch (e) {
    if (e instanceof VersionConflictError) return { ...fail(429, "throttled", "another export was started for this hospital at the same moment"), retryAfter: 120 };
    return fail(502, "exception", "the export could not be recorded, so it was not started");
  }
  return { ok: true, status: 202, jobId };
}

/* ---- the background run ------------------------------------------------------------------------ */

/**
 * The version of `row` to export as of the job's transactionTime, or null when this row is not it.
 * Only a record that changed AFTER the export began costs a history read.
 */
async function versionAsOf(repo, tenantId, row, txMs) {
  if (Date.parse(recordedAt(row)) > txMs) return null;
  const latest = await repo.latest(tenantId, row.resourceType, row.id);
  if (!latest) return null;
  if (latest.version === row.version) return latest;
  if (!(Date.parse(recordedAt(latest)) > txMs)) return null;          // a later version before tx exists; it is exported at its own row
  const hist = (await repo.history(tenantId, row.resourceType, row.id)) || [];
  const asOf = hist.filter((v) => !(Date.parse(recordedAt(v)) > txMs)).pop();
  return asOf && asOf.version === row.version ? asOf : null;
}

/* The storage key for one export file. Fixed here so a run can record the keys it is about to
 * write BEFORE writing them; expiry, cancel and the failed path then delete listed keys even when
 * the run died between the write and the recording. Keys carry no PHI, only the job id and type. */
function exportObjectKey(tenantId, jobId, name) {
  return `t/${tenantId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/fhir-export/${jobId}/${name}-${randomHex(8)}`;
}

async function putFile(store, tenantId, jobId, name, lines, encKey, objectKey) {
  const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
  const key = objectKey || exportObjectKey(tenantId, jobId, name);
  await store.put(key, await encryptBytes(encKey, bytes), "application/octet-stream");
  return { key, sha256: await sha256Hex(bytes) };
}

async function deleteFiles(store, job) {
  const keys = new Set();
  for (const f of [...((job && job.output) || []), ...((job && job.errorFiles) || [])]) if (f && f.key) keys.add(f.key);
  for (const k of ((job && job.pendingKeys) || [])) if (typeof k === "string" && k) keys.add(k);
  for (const key of keys) { try { await store.delete(key); } catch { /* best effort; the job still says expired */ } }
}

/**
 * One bounded run of one job: the outbox consumer for TOPIC_CHUNK.
 * deps: { repository, tenantId, store, env, pageRows?, pagesPerRun?, maxResources?, nowMs? }
 */
async function runExportChunk(deps, payload, event) {
  const repo = deps.repository, tenantId = deps.tenantId;
  let job = await repo.latest(tenantId, JOB_TYPE, str(payload && payload.jobId));
  if (!job || job.status !== "in-progress" || job.cursor !== payload.cursor) return;   // cancelled, finished, or a repeat of a run already recorded
  const nowIso = new Date(deps.nowMs || Date.now()).toISOString();
  /* A job already reported failed for stalling stays failed: the slot was freed on that report, and a
   * run that quietly resumed it would put two exports in flight and flip a failure into a success. */
  if (effectiveStatus(job, Date.parse(nowIso)) === "failed") {
    if (deps.store) await deleteFiles(deps.store, job);
    try { await repo.append(tenantId, [{ ...job, version: job.version + 1, status: "failed", error: "the export stopped making progress", failedAt: nowIso, writtenBy: { id: "system:fhir-export", kind: "service", at: nowIso } }], { audit: auditEvent("fhir.export.failed", "system:fhir-export", { outcome: "error", scope: { jobId: job.id, reason: "stalled" } }) }); }
    catch (e) { if (!(e instanceof VersionConflictError)) throw e; }
    return;
  }
  const written = [];
  try {
    if (!deps.store) throw new Error("document storage is not configured");
    const encKey = await docKey(deps.env);
    if (!encKey) throw new Error("the export encryption key is not configured");
    const pageRows = deps.pageRows || CHUNK_ROWS, maxResources = deps.maxResources || MAX_RESOURCES;
    const canonical = new Set(job.types.map((t) => CANONICAL_TYPE[t]));
    const sinceMs = job.since ? Date.parse(job.since) : null, txMs = Date.parse(job.transactionTime);
    const lines = {}, unrendered = { ...(job.unrendered || {}) };
    let cursor = job.cursor, exported = job.exported, done = false, truncatedAt = null;
    for (let page = 0; page < (deps.pagesPerRun || PAGES_PER_RUN) && !done && !truncatedAt; page++) {
      const res = await repo.changes(tenantId, cursor, pageRows);
      const rows = (res && res.records) || [];
      for (const row of rows) {
        if (!canonical.has(row.resourceType)) continue;
        if (job.level === "patient" && row.resourceType !== "Patient" && !str(row.patientId)) continue;
        if (job.level === "group" && !(job.members || []).includes(row.resourceType === "Patient" ? str(row.id) : str(row.patientId))) continue;
        const rec = await versionAsOf(repo, tenantId, row, txMs);
        if (!rec) continue;
        if (sinceMs !== null && !(Date.parse(recordedAt(rec)) > sinceMs)) continue;
        if (exported >= maxResources) { truncatedAt = row.resourceType; break; }
        let f = null;
        try { f = toFhir(rec); } catch { f = null; }                      // one malformed record is named, not a failed export
        const fhirType = FHIR_TYPE[rec.resourceType];
        if (!f) { unrendered[fhirType] = (unrendered[fhirType] || 0) + 1; continue; }
        (lines[f.resourceType] = lines[f.resourceType] || []).push(JSON.stringify(f));
        exported += 1;
      }
      cursor = (res && res.cursor) || cursor;
      if (rows.length < pageRows) done = true;
    }

    const finished = done || !!truncatedAt;
    /* The issues are known before any byte is stored, so every key this run is about to write can be
     * listed on the job first. */
    let issues = [];
    if (finished) {
      issues = Object.entries(unrendered).map(([type, count]) => ({ type, code: "not-mapped", count, detail: `${count} ${type} record(s) have no honest FHIR mapping and are not in the export` }));
      if (truncatedAt) for (const type of job.types) issues.push({ type, code: "incomplete", count: null, detail: `the export stopped at the ${maxResources}-resource limit; ${type} may be incomplete. Narrow it with _type or _since.` });
    }
    /* Every file this run will write, with its storage key fixed now. The keys are recorded on the
     * job before the first put, so a run that dies between the write and the recording leaves no
     * key that expiry, cancel and the failed path cannot find. */
    const plans = [];
    for (const type of Object.keys(lines).sort()) {
      const name = `${type}-${(job.output || []).filter((o) => o.type === type).length + 1}.ndjson`;
      plans.push({ type, name, fileLines: lines[type], key: exportObjectKey(tenantId, job.id, name) });
    }
    let ooLines = null;
    if (finished && issues.length) {
      ooLines = issues.map((i) => JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: i.code === "incomplete" ? "too-costly" : "not-supported", diagnostics: i.detail, expression: [i.type] }] }));
      plans.push({ type: "OperationOutcome", name: "OperationOutcome-1.ndjson", fileLines: ooLines, key: exportObjectKey(tenantId, job.id, "OperationOutcome-1.ndjson") });
    }
    /* Write-ahead intent: the same versioned append the run already uses. When it conflicts the job
     * moved under this run, so nothing is written and the conflict handling below applies. */
    let base = job;
    if (plans.length) {
      const intent = [...(job.pendingKeys || []), ...plans.map((p) => p.key)];
      const pending = { ...job, version: job.version + 1, pendingKeys: [...new Set(intent)], progressAt: nowIso, writtenBy: { id: "system:fhir-export", kind: "service", at: nowIso } };
      await repo.append(tenantId, [pending], {});
      base = pending;
      job = pending;
    }

    const output = [...(base.output || [])];
    for (const plan of plans) {
      if (plan.type === "OperationOutcome") continue;
      const put = await putFile(deps.store, tenantId, base.id, plan.name, plan.fileLines, encKey, plan.key);
      const file = { type: plan.type, name: plan.name, count: plan.fileLines.length, ...put };
      written.push(file); output.push(file);
    }

    const recorded = new Set();
    const next = { ...base, version: base.version + 1, cursor, exported, output, unrendered, progressAt: nowIso, writtenBy: { id: "system:fhir-export", kind: "service", at: nowIso } };
    const records = [next];
    let audit;
    if (finished) {
      const errorFiles = [];
      if (ooLines) {
        const plan = plans.find((p) => p.type === "OperationOutcome");
        const put = await putFile(deps.store, tenantId, base.id, plan.name, plan.fileLines, encKey, plan.key);
        const file = { type: "OperationOutcome", name: plan.name, count: plan.fileLines.length, ...put };
        written.push(file); errorFiles.push(file);
      }
      /* The same recording append drops the keys it just recorded; older pending keys stay listed
       * until the run that wrote them is recorded, or until expiry, cancel or the failed path. */
      for (const f of written) recorded.add(f.key);
      next.pendingKeys = (base.pendingKeys || []).filter((k) => !recorded.has(k));
      const expiresAt = new Date(Date.parse(nowIso) + FILE_TTL_MS).toISOString();
      Object.assign(next, { status: "complete", issues, errorFiles, completedAt: nowIso, expiresAt });
      records.push(outboxEvent(TOPIC_EXPIRE, { jobId: base.id }, expiresAt));
      const counts = {};
      for (const o of output) counts[o.type] = (counts[o.type] || 0) + o.count;
      audit = auditEvent("fhir.export.complete", "system:fhir-export", { resourceCounts: counts, scope: { jobId: base.id, requestedBy: base.requestedBy, exported, files: output.length, issues: issues.length, truncated: !!truncatedAt } });
    } else {
      for (const f of written) recorded.add(f.key);
      next.pendingKeys = (base.pendingKeys || []).filter((k) => !recorded.has(k));
      records.push(outboxEvent(TOPIC_CHUNK, { jobId: base.id, cursor }, nowIso));
    }
    await repo.append(tenantId, records, audit ? { audit } : {});
  } catch (e) {
    for (const f of written) { try { await deps.store.delete(f.key); } catch { /* best effort; orphans stay listed in pendingKeys, so expiry, cancel or the failed path deletes them */ } }
    if (e instanceof VersionConflictError) return;                        // cancelled while this run was writing
    const attempts = ((event && event.attempts) || 0) + 1;
    if (attempts < MAX_ATTEMPTS) throw e;                                  // the outbox retries with backoff
    const reason = str(e && e.message).slice(0, 200) || "unknown error";
    try {
      if (deps.store) await deleteFiles(deps.store, job);
      await repo.append(tenantId, [{ ...job, version: job.version + 1, status: "failed", error: reason, failedAt: nowIso, progressAt: nowIso, writtenBy: { id: "system:fhir-export", kind: "service", at: nowIso } }],
        { audit: auditEvent("fhir.export.failed", "system:fhir-export", { outcome: "error", scope: { jobId: job.id, reason } }) });
    } catch (e2) { throw e; }
  }
}

/** The consumer for TOPIC_EXPIRE: the files go, the job stays as the record that they existed. */
async function expireExport(deps, payload) {
  const repo = deps.repository, tenantId = deps.tenantId;
  const job = await repo.latest(tenantId, JOB_TYPE, str(payload && payload.jobId));
  if (!job || job.filesDeleted) return;
  if (deps.store) await deleteFiles(deps.store, job);
  const at = new Date(deps.nowMs || Date.now()).toISOString();
  try { await repo.append(tenantId, [{ ...job, version: job.version + 1, filesDeleted: true, writtenBy: { id: "system:fhir-export", kind: "service", at } }], {}); }
  catch (e) { if (!(e instanceof VersionConflictError)) throw e; }
}

/** The outbox consumers ops-tick runs for one hospital. */
function exportConsumers(deps) {
  return {
    [TOPIC_CHUNK]: { "fhir-export": (payload, event) => runExportChunk(deps, payload, event) },
    [TOPIC_EXPIRE]: { "fhir-export-expire": (payload) => expireExport(deps, payload) },
  };
}

/* ---- status, cancel, files, list ------------------------------------------------------------------ */

async function openJob(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: fail(404, "not-supported", "this hospital does not run the WardSynQ record") };
  const who = await requesterOf(request, env, ctx);
  if (who.error) return who;
  let job = null;
  try { job = await ctx.recordDeps.repository.latest(mig.tenantId, JOB_TYPE, str(ctx.jobId)); }
  catch { return { error: fail(502, "exception", "the export could not be read") }; }
  if (!mayOpen(who.requester, job)) return { error: fail(404, "not-found", "no such export") };
  return { job, requester: who.requester };
}

/**
 * GET status. ctx: { ..., jobId, link(name) }
 * Returns { status: 202, progress } | { status: 200, manifest } | { status, outcome }.
 */
async function exportStatus(request, env, ctx) {
  const { job, error } = await openJob(request, env, ctx);
  if (error) return error;
  const st = effectiveStatus(job, Date.now());
  if (st === "in-progress") return { ok: true, status: 202, progress: `${job.exported} resources exported in ${job.output.length} file(s)` };
  if (st === "complete") return { ok: true, status: 200, manifest: manifestOf(job, ctx.link) };
  if (st === "failed") return fail(500, "exception", `the export failed: ${job.error || "it stopped making progress"}`);
  if (st === "expired") return fail(404, "not-found", "this export has expired and its files were deleted");
  return fail(404, "not-found", "this export was cancelled");
}

/** DELETE status: cancels a running export or withdraws a finished one's files. */
async function cancelExport(request, env, ctx) {
  const { job, requester, error } = await openJob(request, env, ctx);
  if (error) return error;
  const st = effectiveStatus(job, Date.now());
  if (st !== "in-progress" && st !== "complete") return fail(404, "not-found", `this export is already ${st}`);
  const at = new Date().toISOString();
  try {
    await ctx.recordDeps.repository.append(ctx.migration.tenantId, [{ ...job, version: job.version + 1, status: "cancelled", cancelledAt: at, cancelledBy: requester.id, writtenBy: { id: requester.id, kind: requester.kind === "smart" ? "service" : "human", at } }],
      { audit: auditEvent("fhir.export.cancel", requester.id, { scope: { jobId: job.id, wasStatus: st } }) });
  } catch (e) {
    if (e instanceof VersionConflictError) return fail(409, "conflict", "the export changed at the same moment; ask for its status again");
    return fail(502, "exception", "the cancellation could not be recorded, so the export was not cancelled");
  }
  if (ctx.store) await deleteFiles(ctx.store, job);
  return { ok: true, status: 202 };
}

/** GET one file. The download is audited before a byte leaves; an unauditable download does not happen. */
async function exportFile(request, env, ctx) {
  const { job, requester, error } = await openJob(request, env, ctx);
  if (error) return error;
  if (effectiveStatus(job, Date.now()) !== "complete") return fail(404, "not-found", "no such file: the export is not complete, or has expired or been cancelled");
  const file = [...job.output, ...(job.errorFiles || [])].find((f) => f.name === str(ctx.fileName));
  if (!file) return fail(404, "not-found", "no such file in this export");
  // The token presenting the file must still be allowed that type: a narrower token of the same client is not.
  if (file.type !== "OperationOutcome" && !canRead(requester.actor, CANONICAL_TYPE[file.type])) return fail(403, "forbidden", `not permitted to read ${file.type}`);
  if (!ctx.store) return fail(503, "exception", "document storage is not configured");
  const encKey = await docKey(env);
  if (!encKey) return fail(503, "exception", "the export encryption key is not configured");
  let bytes;
  try {
    const obj = await ctx.store.get(file.key);
    if (!obj) return fail(502, "exception", "the export record names this file but the store does not have it");
    bytes = await decryptBytes(encKey, obj.bytes);
  } catch { return fail(502, "exception", "the file could not be read from storage"); }
  if ((await sha256Hex(bytes)) !== file.sha256) return fail(502, "exception", "the stored file does not match what was written, so it is not served");
  try { await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, auditEvent("fhir.export.download", requester.id, { resourceCounts: { [file.type]: file.count }, scope: { jobId: job.id, file: file.name, via: requester.kind } })); }
  catch { return fail(502, "exception", "the download could not be recorded in the audit trail, so it was refused"); }
  return { ok: true, status: 200, bytes, contentType: NDJSON };
}

/** The admin screen's list. ctx: { migration, recordDeps, actorDeps } */
async function listExports(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, error: "not_a_wardsynq_hospital" };
  const who = await requesterOf(request, env, { ...ctx, actorOverride: null });
  if (who.error) return { ok: false, status: who.error.status, error: who.error.status === 401 ? "auth" : "permission", detail: who.error.outcome.issue[0].diagnostics };
  let jobs;
  try { jobs = await ctx.recordDeps.repository.latestByType(mig.tenantId, JOB_TYPE, 50); }
  catch (e) { return { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }
  const now = Date.now();
  return { ok: true, exportable: Object.values(FHIR_TYPE).filter((t) => canRead(who.requester.actor, CANONICAL_TYPE[t])).sort(), exports: (jobs || []).map((j) => summaryOf(j, now)).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))) };
}

export {
  JOB_TYPE, SLOT_TYPE, TOPIC_CHUNK, TOPIC_EXPIRE, CHUNK_ROWS, MAX_RESOURCES, FILE_TTL_MS, STALL_MS, NDJSON,
  parseExportParams, parametersToExportParams, effectiveStatus, manifestOf, summaryOf, exportConsumers, runExportChunk, expireExport,
  kickoffExport, exportStatus, cancelExport, exportFile, listExports,
};
