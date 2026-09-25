/* functions/_wardsynq/dicom-viewer.js - the in-app viewer's two reads, proxied from the hospital's own archive.
 *
 * DECISION 2026-09-25 (vault/decisions/Decisions.md): images are now PROXIED, still never STORED. The
 * study list and each instance are fetched from the hospital's DICOMweb connector (dicomweb.js) on the
 * server, with the connector's sealed credential, and handed to the signed-in clinician. The browser never
 * holds the PACS address or credential; nothing is written to the record, KV or any cache (no-store).
 *
 *   GET imaging-series?studyId=<ImagingStudy id>                  QIDO-RS: the study's series and instances
 *   GET imaging-instance?studyId=&seriesUid=&sopUid=              WADO-RS: one instance, as application/dicom
 *
 * THE BROWSER NAMES A RECORD, NOT A STUDY UID. The StudyInstanceUID always comes from this hospital's own
 * ImagingStudy row, read through the caller's governed read, so another hospital's study (or any study the
 * caller cannot read) is unreachable however the query is written. The series and SOP UIDs the caller sends
 * are checked as UIDs and sent UNDER that study's path; the archive answers 404 for one that is not in it.
 *
 * AUDIT. Opening a study (imaging-series) is audited as `imaging.study.open` (who, when, which study),
 * beside the record.read the governed get already writes. The per-image reads that follow are not each
 * audited: a CT is hundreds of them, and the open is the decisive act.
 *
 * THE HEADER (patient name, id, birth date from the archive's DICOM tags) is returned only when the caller
 * may read this patient's Patient record; otherwise `header` is null and `headerHidden` says so.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { checkDestination } from "./webhooks.js";
import { authHeaders } from "./dicomweb.js";
import { activeConnectors, openConnectorSecrets } from "./connectors.js";

const str = (v) => (v == null ? "" : String(v).trim());
const UID = /^[0-9]+(\.[0-9]+)*$/;
const isUid = (v) => typeof v === "string" && v.length <= 64 && UID.test(v);
const QIDO_TIMEOUT_MS = 8000, WADO_TIMEOUT_MS = 20000;
const MAX_SERIES = 60, MAX_INSTANCES = 1500;
const MAX_BYTES = 48 * 1024 * 1024;   // ponytail: whole instance in memory; a larger one (big multi-frame) is refused, stream it if that matters

/* ---- DICOM JSON, PURE ----------------------------------------------------------------------------- */
function tag(obj, t) { const e = obj && obj[t]; return e && Array.isArray(e.Value) && e.Value.length ? e.Value[0] : null; }
function personName(v) { return v && typeof v === "object" ? str(v.Alphabetic) : str(v); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/** PURE. Series (QIDO JSON) and each series' instances, sorted the way a stack is read. */
function seriesOf(seriesJson, instancesBySeries) {
  return (Array.isArray(seriesJson) ? seriesJson : []).map((s) => {
    const uid = str(tag(s, "0020000E"));
    const inst = (instancesBySeries[uid] || []).map((i) => ({
      sopUid: str(tag(i, "00080018")), number: num(tag(i, "00200013")), frames: num(tag(i, "00280008")) || 1,
    })).filter((i) => isUid(i.sopUid)).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
    return { seriesUid: uid, number: num(tag(s, "00200011")), modality: str(tag(s, "00080060")) || null,
      description: str(tag(s, "0008103E")) || null, instances: inst };
  }).filter((s) => isUid(s.seriesUid)).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
}

/** PURE. The patient/study header from a QIDO study row. */
function headerOf(studyRow) {
  if (!studyRow) return null;
  return { patientName: personName(tag(studyRow, "00100010")) || null, patientId: str(tag(studyRow, "00100020")) || null,
    birthDate: str(tag(studyRow, "00100030")) || null, sex: str(tag(studyRow, "00100040")) || null,
    studyDate: str(tag(studyRow, "00080020")) || null, studyDescription: str(tag(studyRow, "00081030")) || null,
    accessionNumber: str(tag(studyRow, "00080050")) || null };
}

/** PURE. The first part of a multipart/related answer, as bytes. null when it is not multipart. */
function firstPart(bytes, contentType) {
  const m = /boundary="?([^";,]+)"?/i.exec(contentType || "");
  if (!m) return null;
  const enc = new TextEncoder(), delim = enc.encode("--" + m[1]);
  const find = (needle, from) => {
    outer: for (let i = from; i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  const start = find(delim, 0);
  if (start < 0) return null;
  const headEnd = find(enc.encode("\r\n\r\n"), start + delim.length);
  if (headEnd < 0) return null;
  const bodyStart = headEnd + 4;
  const next = find(enc.encode("\r\n--" + m[1]), bodyStart);
  return bytes.subarray(bodyStart, next < 0 ? bytes.length : next);
}

/* ---- the governed door ----------------------------------------------------------------------------- */
async function openStudy(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_enabled" } };
  const studyId = str(ctx.studyId);
  if (!studyId) return { error: { ok: false, status: 422, error: "study_required", detail: "studyId (the ImagingStudy record) is required." } };
  let svc;
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: r.tenant, actor: r.actor, role: r.role, roleSource: r.source });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error" } };
  }
  let study;
  try { study = ctx.audited ? await svc.get("ImagingStudy", studyId) : await svc.governed.get(svc.actor, "ImagingStudy", studyId); }
  catch (e) {
    if (e instanceof PermissionError || e instanceof GovernanceError) return { error: { ok: false, status: 403, error: "permission" } };
    return { error: { ok: false, status: 502, error: "record_read_failed" } };
  }
  if (!study) return { error: { ok: false, status: 404, error: "study_not_found", detail: "No such imaging study at this hospital." } };
  if (!isUid(str(study.studyUid))) return { error: { ok: false, status: 422, error: "study_uid_missing", detail: "This study has no StudyInstanceUID on record, so the archive cannot be asked for it." } };
  let conn;
  try { conn = (await activeConnectors(svc.repository, svc.tenantId, "dicom"))[0] || null; }
  catch { return { error: { ok: false, status: 502, error: "record_read_failed" } }; }
  if (!conn || !str(conn.settings && conn.settings.qidoUrl)) return { error: { ok: false, status: 409, error: "no_archive", detail: "No DICOMweb archive is configured for this hospital (Admin > Integrations > Imaging)." } };
  return { svc, study, conn, secrets: await openConnectorSecrets(env, conn) };
}

/** One DICOMweb GET. Returns { res } or { error } in this file's answer shape. */
async function archiveGet(o, base, path, accept, timeoutMs, deps) {
  const dest = await checkDestination(`${base.replace(/\/+$/, "")}${path}`, deps);
  if (!dest.ok) return { error: { ok: false, status: 502, error: "archive_refused", detail: `The archive address is not allowed: ${dest.detail}.` } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await (deps.fetchImpl || fetch)(dest.url, { method: "GET", redirect: "manual", signal: controller.signal,
      headers: { Accept: accept, "User-Agent": "WardSynQ-DICOMweb/1", ...(authHeaders(o.conn.settings, o.secrets) || {}) } });
  } catch {
    return { error: { ok: false, status: 504, error: controller.signal.aborted ? "archive_timeout" : "archive_unreachable", detail: controller.signal.aborted ? "The archive did not answer in time." : "The archive could not be reached." } };
  } finally { clearTimeout(timer); }
  const code = Number(res.status) || 0;
  if (code === 401 || code === 403) return { error: { ok: false, status: 502, error: "archive_auth_refused", detail: `The archive refused this hospital's credentials (${code}).` } };
  if (code === 404) return { error: { ok: false, status: 404, error: "not_in_archive", detail: "The archive does not have this study or image." } };
  if (code === 204) return { res: null };
  if (code < 200 || code >= 300) return { error: { ok: false, status: 502, error: "archive_error", detail: `The archive answered ${code}.` } };
  return { res };
}
async function qidoJson(o, path, deps) {
  const r = await archiveGet(o, str(o.conn.settings.qidoUrl), path, "application/dicom+json", QIDO_TIMEOUT_MS, deps);
  if (r.error) return r;
  if (!r.res) return { json: [] };
  try { const j = await r.res.json(); return Array.isArray(j) ? { json: j } : { error: { ok: false, status: 502, error: "archive_not_dicom_json" } }; }
  catch { return { error: { ok: false, status: 502, error: "archive_not_dicom_json", detail: "The archive did not answer with DICOM JSON." } }; }
}

/** GET imaging-series. ctx: { migration, actorDeps, recordDeps, studyId, fetchImpl?, resolveHost? } */
async function imagingSeries(request, env, ctx) {
  const o = await openStudy(request, env, { ...ctx, audited: true });
  if (o.error) return o.error;
  const uid = o.study.studyUid, deps = { fetchImpl: ctx.fetchImpl, resolveHost: ctx.resolveHost };
  const sr = await qidoJson(o, `/studies/${uid}/series`, deps);
  if (sr.error) return sr.error;
  const seriesJson = sr.json.slice(0, MAX_SERIES);
  const bySeries = {};
  let total = 0;
  for (const s of seriesJson) {
    const suid = str(tag(s, "0020000E"));
    if (!isUid(suid) || total >= MAX_INSTANCES) continue;
    const ir = await qidoJson(o, `/studies/${uid}/series/${suid}/instances`, deps);
    if (ir.error) return ir.error;
    bySeries[suid] = ir.json.slice(0, MAX_INSTANCES - total);
    total += bySeries[suid].length;
  }
  const series = seriesOf(seriesJson, bySeries);

  /* The header only for a caller who may read this patient. The governed read decides; a refusal hides it. */
  let header = null, headerHidden = true;
  try {
    const pat = o.study.patientId ? await o.svc.governed.get(o.svc.actor, "Patient", o.study.patientId) : null;
    if (pat) {
      const st = await qidoJson(o, `/studies?StudyInstanceUID=${uid}&includefield=00100030&includefield=00100040`, deps);
      if (!st.error) { header = headerOf(st.json[0]); headerHidden = false; }
    }
  } catch { /* not allowed to read the patient: header stays hidden */ }

  try {
    await o.svc.repository.auditOnly(o.svc.tenantId, await o.svc._audit("imaging.study.open", {
      scope: { studyId: o.study.id, studyUid: uid, series: series.length, instances: series.reduce((n, s) => n + s.instances.length, 0), headerShown: !headerHidden },
      patientId: o.study.patientId || null }));
  } catch { return { ok: false, status: 502, error: "record_write_failed", detail: "The study could not be opened because the opening could not be logged." }; }

  return { ok: true, study: { id: o.study.id, studyUid: uid, modality: o.study.modality || null, started: o.study.started || null },
    header, headerHidden, series, truncated: sr.json.length > MAX_SERIES || total >= MAX_INSTANCES };
}

/** GET imaging-instance. Returns { ok, bytes, contentType } or an error. Not audited per image (see header). */
async function imagingInstance(request, env, ctx) {
  const seriesUid = str(ctx.seriesUid), sopUid = str(ctx.sopUid);
  if (!isUid(seriesUid) || !isUid(sopUid)) return { ok: false, status: 400, error: "bad_uid", detail: "seriesUid and sopUid must be DICOM UIDs." };
  const o = await openStudy(request, env, ctx);
  if (o.error) return o.error;
  const base = str(o.conn.settings.wadoUrl) || str(o.conn.settings.qidoUrl);
  const r = await archiveGet(o, base, `/studies/${o.study.studyUid}/series/${seriesUid}/instances/${sopUid}`,
    'multipart/related; type="application/dicom"; transfer-syntax=*', WADO_TIMEOUT_MS, { fetchImpl: ctx.fetchImpl, resolveHost: ctx.resolveHost });
  if (r.error) return r.error;
  if (!r.res) return { ok: false, status: 404, error: "not_in_archive" };
  if (Number(r.res.headers.get("content-length")) > MAX_BYTES) return { ok: false, status: 413, error: "too_large", detail: "This image is too large to open here." };
  const all = new Uint8Array(await r.res.arrayBuffer());
  if (all.length > MAX_BYTES) return { ok: false, status: 413, error: "too_large", detail: "This image is too large to open here." };
  const ct = str(r.res.headers.get("content-type"));
  const bytes = /multipart\//i.test(ct) ? firstPart(all, ct) : all;
  if (!bytes || bytes.length < 132) return { ok: false, status: 502, error: "archive_not_dicom", detail: "The archive did not answer with a DICOM instance." };
  return { ok: true, bytes, contentType: "application/dicom" };
}

export { isUid, seriesOf, headerOf, firstPart, imagingSeries, imagingInstance };
