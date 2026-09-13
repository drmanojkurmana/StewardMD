/* functions/_wardsynq/documents.js — patient documents: a consent form, a referral letter, an outside
 * report, a scanned ID.
 *
 * TWO HALVES, KEPT APART. The METADATA is a DocumentReference in the same append-only RecordService as
 * the rest of the chart: who uploaded what, for which patient and visit, of what type, which version,
 * whether it was withdrawn and why. The BYTES live in an object store behind object-store.js, under a
 * key nobody can guess, ENCRYPTED HERE before they leave (AES-GCM), so the storage provider only ever
 * holds ciphertext. Losing the bucket's credentials does not leak a single clinical document.
 *
 * VERSIONS NEVER OVERWRITE. A new version is a new record version pointing at a NEW object; the old
 * object stays, so every version a clinician ever saw can be opened again.
 *
 * WITHDRAWING IS NOT DELETING. "Entered in error" keeps the file and says why. Deleting the bytes
 * (purge) is refused until the hospital's retention period has passed, and even then the metadata
 * stays, so the record shows a document existed and when and by whom it was purged.
 *
 * NO PUBLIC LINKS. A file is opened with a signed link that names one person, one document and one
 * version, lasts five minutes, and is audited every time it is used.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { sha256Hex } from "./object-store.js";
import { signToken, verifyToken, queueSecret } from "../_queue.js";

const TYPE = "DocumentReference";
const str = (v) => (v == null ? "" : String(v).trim());
const DOC_TYPES = Object.freeze(["consent", "referral-letter", "outside-report", "outside-imaging", "id-proof", "insurance", "prescription-outside", "other"]);
const CONTENT_TYPES = Object.freeze(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
// Indian Medical Council regulation 1.3.1: in-patient records kept at least three years. A hospital
// sets its own, longer, period in wardsynq.documentRetentionYears.
const DEFAULT_RETENTION_YEARS = 3;
const LINK_MS = 5 * 60 * 1000;

async function open(request, env, ctx, need) {
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
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this document changed since you opened it - reload and try again", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const off = (mig) => !mig || mig.mode === "off";
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const NO_STORE = { ok: false, status: 503, error: "document_storage_not_configured", message: "Document storage is not set up for this hospital yet, so nothing can be uploaded or opened. Nothing was saved." };

/* ---- encryption (AES-GCM, 12-byte IV prepended) ------------------------------------------------- */
function unb64u(s) { let t = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const b = atob(t); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function docKey(env) {
  const raw = (env && (env.DOC_ENC_KEY || env.FOLLOWCARE_PHI_KEY)) || "";
  const bytes = raw ? unb64u(raw) : null;
  if (!bytes || bytes.length !== 32) return null;
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function decryptBytes(key, blob) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12)));
}

function slug(v) { return str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function randomHex(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join(""); }
function objectKeyFor(tenantId, docId, version) { return `t/${slug(tenantId)}/docs/${slug(docId)}/v${version}-${randomHex(12)}`; }
function retainUntilFrom(uploadedAt, years) {
  const d = new Date(uploadedAt); d.setUTCFullYear(d.getUTCFullYear() + (Number(years) > 0 ? Number(years) : DEFAULT_RETENTION_YEARS));
  return d.toISOString();
}
function decodeBase64(b64) { try { return unb64u(str(b64).replace(/^data:[^,]*,/, "")); } catch { return null; } }
function summary(d) {
  return { id: d.id, version: d.version, patientId: d.patientId, encounterId: d.encounterId || null, docType: d.docType, title: d.title,
    contentType: d.contentType, sizeBytes: d.sizeBytes, sha256: d.sha256, status: d.status, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt,
    retainUntil: d.retainUntil, withdrawnReason: d.withdrawnReason || null, withdrawnBy: d.withdrawnBy || null, purgedAt: d.purgedAt || null };
}

/**
 * Upload a new document, or a new version of one. ctx: { migration, store, env, patientId, encounterId,
 * docType, title, contentType, dataBase64, documentId?, expectedVersion?, retentionYears, actorDeps, recordDeps }
 */
async function uploadDocument(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off", written: 0 };
  if (!ctx.store) return { ...base, ...NO_STORE, written: 0 };
  const key = await docKey(env);
  if (!key) return { ...base, ok: false, status: 503, error: "document_key_not_configured", message: "Documents cannot be stored encrypted on this server, so none are stored.", written: 0 };

  const docType = str(ctx.docType), title = str(ctx.title).slice(0, 160), contentType = str(ctx.contentType).toLowerCase();
  if (!DOC_TYPES.includes(docType)) return { ...base, ok: false, status: 422, error: "bad_doc_type", allowed: DOC_TYPES, written: 0 };
  if (!title) return { ...base, ok: false, status: 422, error: "title_required", written: 0 };
  if (!CONTENT_TYPES.includes(contentType)) return { ...base, ok: false, status: 422, error: "bad_content_type", message: "Upload a PDF, JPEG, PNG or WebP file.", written: 0 };
  const bytes = decodeBase64(ctx.dataBase64);
  if (!bytes || !bytes.length) return { ...base, ok: false, status: 422, error: "file_required", written: 0 };
  if (bytes.length > MAX_BYTES) return { ...base, ok: false, status: 413, error: "file_too_large", message: "Files are limited to 10 MB.", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current = null;
  const docId = str(ctx.documentId);
  try {
    if (docId) {
      current = await svc.get(TYPE, docId);
      if (!current) return { ...base, ok: false, status: 404, error: "document_not_found", written: 0 };
      if (current.status === "purged") return { ...base, ok: false, status: 409, error: "document_purged", written: 0 };
      if (ctx.expectedVersion != null && Number(ctx.expectedVersion) !== current.version) return { ...base, ...writeFailure(new VersionConflictError("stale")), written: 0 };
    } else {
      const patient = await svc.get("Patient", str(ctx.patientId));
      if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    }
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }

  const now = new Date().toISOString();
  const id = docId || `wsq-doc-${slug(ctx.patientId)}-${Date.now().toString(36)}-${randomHex(4)}`;
  const version = current ? current.version + 1 : 1;
  const objectKey = objectKeyFor(mig.tenantId, id, version);
  const sha256 = await sha256Hex(bytes);

  /* Bytes first, record second. If the record write fails the object is an orphan nobody can reach
   * (its key is random and recorded nowhere), which is harmless; the reverse order would leave a record
   * pointing at a file that does not exist - a document that looks present and cannot be opened. */
  try { await ctx.store.put(objectKey, await encryptBytes(key, bytes), "application/octet-stream"); }
  catch (e) { return { ...base, ok: false, status: 502, error: "document_store_failed", message: "The file could not be stored. Nothing was saved.", detail: str(e && e.message), written: 0 }; }

  const record = {
    resourceType: TYPE, id,
    patientId: current ? current.patientId : str(ctx.patientId),
    encounterId: current ? current.encounterId || null : (str(ctx.encounterId) || null),
    docType: current ? current.docType : docType, title, contentType, sizeBytes: bytes.length, sha256, objectKey,
    status: "current", uploadedBy: resolved.actor.id, uploadedAt: now,
    retainUntil: current ? current.retainUntil : retainUntilFrom(now, ctx.retentionYears),
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, document: summary({ ...record, version: out.record.version }) };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }
}

/** The patient's documents, current version of each, newest first. */
async function listDocuments(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off", documents: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try {
    const rows = await svc.byPatient(TYPE, patientId);
    const docs = (rows || []).filter(Boolean).map(summary).sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return { ...base, ok: true, storageConfigured: !!ctx.store, documents: docs };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }
}

/** Every version of one document, oldest first. */
async function documentVersions(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off", versions: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try {
    const rows = await svc.history(TYPE, str(ctx.documentId));
    if (!rows || !rows.length) return { ...base, ok: false, status: 404, error: "document_not_found" };
    return { ...base, ok: true, versions: rows.map(summary) };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }
}

/** Withdraw ("entered in error"). The file is kept; the reason is required. */
async function withdrawDocument(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off", written: 0 };
  const reason = str(ctx.reason);
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this document is wrong", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await svc.get(TYPE, str(ctx.documentId)); } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "document_not_found", written: 0 };
  if (cur.status !== "current") return { ...base, ok: true, written: 0, skipped: "already_" + cur.status, document: summary(cur) };
  const next = { ...cur, status: "entered-in-error", withdrawnReason: reason, withdrawnBy: resolved.actor.id, withdrawnAt: new Date().toISOString() };
  delete next.version;
  try {
    const out = await svc.put(next, { expectedVersion: cur.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, document: summary({ ...next, version: out.record.version }) };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/**
 * Delete the stored bytes of every version, once the retention period has passed. The metadata stays.
 * Refused before retainUntil, whoever asks.
 */
async function purgeDocument(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off", written: 0 };
  if (!ctx.store) return { ...base, ...NO_STORE, written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let versions;
  try { versions = await svc.history(TYPE, str(ctx.documentId)); } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  const cur = versions && versions[versions.length - 1];
  if (!cur) return { ...base, ok: false, status: 404, error: "document_not_found", written: 0 };
  if (cur.status === "purged") return { ...base, ok: true, written: 0, skipped: "already_purged" };
  if (new Date(cur.retainUntil).getTime() > Date.now()) {
    return { ...base, ok: false, status: 409, error: "retention_not_expired", retainUntil: cur.retainUntil, message: `This document must be kept until ${cur.retainUntil.slice(0, 10)}.`, written: 0 };
  }
  try { for (const v of versions) if (v.objectKey) await ctx.store.delete(v.objectKey); }
  catch (e) { return { ...base, ok: false, status: 502, error: "document_store_failed", detail: str(e && e.message), written: 0 }; }
  const next = { ...cur, status: "purged", purgedAt: new Date().toISOString(), purgedBy: resolved.actor.id };
  delete next.version;
  try {
    const out = await svc.put(next, { expectedVersion: cur.version });
    return { ...base, ok: true, written: 1, objectsDeleted: versions.filter((v) => v.objectKey).length, document: summary({ ...next, version: out.record.version }) };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/* ---- signed links -------------------------------------------------------------------------------- */
/** Mint a five-minute link for one person, one document, one version. Reading the record here is the
 * authorisation check: someone who cannot read the document cannot get a link to it. */
async function documentLink(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (off(mig)) return { ...base, ok: true, skipped: "off" };
  if (!ctx.store) return { ...base, ...NO_STORE };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let versions;
  try { versions = await svc.history(TYPE, str(ctx.documentId)); } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
  if (!versions || !versions.length) return { ...base, ok: false, status: 404, error: "document_not_found" };
  const want = ctx.version != null ? Number(ctx.version) : versions[versions.length - 1].version;
  const v = versions.find((x) => x.version === want);
  if (!v) return { ...base, ok: false, status: 404, error: "version_not_found" };
  if (versions[versions.length - 1].status === "purged") return { ...base, ok: false, status: 410, error: "document_purged", message: "This document was deleted after its retention period." };
  const exp = Date.now() + LINK_MS;
  const token = await signToken({ id: ["doc", mig.tenantId, v.id, v.version, resolved.actor.id].map((x) => encodeURIComponent(x)).join("~"), exp, ver: 3 }, queueSecret(env));
  return { ...base, ok: true, url: "/api/queue/ward/document-file?t=" + encodeURIComponent(token), expiresAt: new Date(exp).toISOString() };
}

/**
 * Serve a signed link. Pre-authentication by design (a new tab carries no staff header): the token IS
 * the authorisation, minted by documentLink for a named actor under five minutes ago. Every use is
 * audited under that actor. deps: { store, recordDepsFor(tenantId) }
 */
async function serveDocumentLink(env, token, deps) {
  const v = await verifyToken(token, queueSecret(env), 3, Date.now());
  if (!v || !v.ok) return { ok: false, status: v && v.reason === "expired" ? 410 : 401, error: v && v.reason === "expired" ? "link_expired" : "bad_link" };
  const parts = String(v.id).split("~").map((x) => decodeURIComponent(x));
  if (parts[0] !== "doc" || parts.length !== 5) return { ok: false, status: 401, error: "bad_link" };
  const [, tenantId, docId, versionStr, actorId] = parts;
  if (!deps.store) return NO_STORE;
  const key = await docKey(env);
  if (!key) return { ok: false, status: 503, error: "document_key_not_configured" };
  const rd = deps.recordDepsFor(tenantId);
  const versions = await rd.repository.history(tenantId, TYPE, docId);
  const rec = (versions || []).find((x) => x.version === Number(versionStr));
  if (!rec) return { ok: false, status: 404, error: "document_not_found" };
  if (versions[versions.length - 1].status === "purged") return { ok: false, status: 410, error: "document_purged" };
  const obj = await deps.store.get(rec.objectKey);
  if (!obj) return { ok: false, status: 502, error: "document_file_missing", message: "The record says this file exists but the store does not have it." };
  const bytes = await decryptBytes(key, obj.bytes);
  if ((await sha256Hex(bytes)) !== rec.sha256) return { ok: false, status: 502, error: "document_integrity_failed", message: "The stored file does not match what was uploaded, so it is not shown." };
  await rd.repository.auditOnly(tenantId, {
    ts: new Date().toISOString(), actor: actorId, connectorId: "wardsynq", action: "document.download",
    resourceCounts: { [TYPE]: 1 }, scope: { resourceType: TYPE, id: docId, version: rec.version, via: "signed-link" },
    patientRefHash: rec.patientId && rd.pseudonym ? await rd.pseudonym(rec.patientId) : null, outcome: "ok",
  });
  return { ok: true, bytes, contentType: rec.contentType, filename: `${slug(rec.title) || "document"}-v${rec.version}` };
}

export { TYPE, DOC_TYPES, CONTENT_TYPES, MAX_BYTES, DEFAULT_RETENTION_YEARS, uploadDocument, listDocuments, documentVersions, withdrawDocument, purgeDocument, documentLink, serveDocumentLink, retainUntilFrom };
