/* StewardMD — Firestore REST helpers (server-side, service-account).
 *
 * A tiny, dependency-free Firestore client for Cloudflare Pages Functions. It mints an
 * OAuth token from FIREBASE_SERVICE_ACCOUNT (via _fbadmin.serviceAccountToken, `datastore`
 * scope) and talks to the Firestore v1 REST API. The service account bypasses Security
 * Rules, so these collections can be locked to "deny all" for clients and only ever touched
 * here — every read/write is server-validated.
 *
 * What it gives the Experimental Access framework:
 *   • fsGet(env, path)                → decoded doc { id, fields, updateTime } | null
 *   • fsCommit(env, [writes])         → ATOMIC multi-write commit (all-or-nothing). Returns
 *                                       { ok:true } or throws an Error with .code:
 *                                       "precondition" when a currentDocument guard fails
 *                                       (this is how single-use activation stays exactly-once).
 *   • wCreate / wUpdate / wDelete     → build the write objects for fsCommit.
 *   • fsQuery(env, collection, opts)  → runQuery with an optional single-field equality
 *                                       filter (uses Firestore's automatic single-field index,
 *                                       so NO composite index is ever required).
 *
 * Values use a minimal typed encoding (string / integer / double / bool / null). Timestamps
 * are stored as integer ms-epoch to avoid RFC3339 formatting — the admin renders via Date(ms).
 */
import { serviceAccountToken } from "./_fbadmin.js";

const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

export function fsProject(env) { return (env && env.FIREBASE_PROJECT_ID) || FB_PROJECT_DEFAULT; }
function fsRoot(env) { return `projects/${fsProject(env)}/databases/(default)/documents`; }
function fsUrl(env, suffix) { return `https://firestore.googleapis.com/v1/${fsRoot(env)}${suffix || ""}`; }
export function fsDocName(env, path) { return `${fsRoot(env)}/${String(path).replace(/^\/+/, "")}`; }

async function fsToken(env) { return serviceAccountToken(env, DATASTORE_SCOPE); }

// ---- typed value <-> JS encoding -------------------------------------------------------
export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
export function encodeFields(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => { out[k] = encodeValue(obj[k]); });
  return out;
}
export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}
export function decodeFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach((k) => { out[k] = decodeValue(fields[k]); });
  return out;
}
function docId(name) { const s = String(name || ""); return s.slice(s.lastIndexOf("/") + 1); }

// ---- reads -----------------------------------------------------------------------------
// GET a single document. Returns { id, fields (decoded), updateTime } or null on 404.
export async function fsGet(env, path) {
  const tok = await fsToken(env);
  const res = await fetch(fsUrl(env, "/" + String(path).replace(/^\/+/, "")), {
    headers: { Authorization: "Bearer " + tok },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error("fs_get_failed"), { code: "fs_get", status: res.status, detail: (await res.text()).slice(0, 300) });
  const d = await res.json();
  return { id: docId(d.name), name: d.name, fields: decodeFields(d.fields), updateTime: d.updateTime };
}

// ---- write builders --------------------------------------------------------------------
// Create-if-absent: the whole doc is written only when it does not already exist. Used for
// code generation (uniqueness) and the activation record.
export function wCreate(env, path, fieldsObj) {
  return { update: { name: fsDocName(env, path), fields: encodeFields(fieldsObj) }, currentDocument: { exists: false } };
}
// Patch specific fields. opts.updateTime → guard the write on the doc being UNCHANGED since it
// was read (optimistic concurrency → the single-use activation is exactly-once). opts.exists →
// require the doc to already exist.
export function wUpdate(env, path, fieldsObj, opts) {
  opts = opts || {};
  const w = {
    update: { name: fsDocName(env, path), fields: encodeFields(fieldsObj) },
    updateMask: { fieldPaths: Object.keys(fieldsObj || {}) },
  };
  if (opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
  else if (opts.exists === true) w.currentDocument = { exists: true };
  return w;
}
export function wDelete(env, path) { return { delete: fsDocName(env, path) }; }

// ---- atomic commit ---------------------------------------------------------------------
// Applies ALL writes atomically (all-or-nothing). Throws { code:"precondition" } when any
// currentDocument guard fails (doc changed / already exists / missing) — the caller turns that
// into "already used".
export async function fsCommit(env, writes) {
  const tok = await fsToken(env);
  const res = await fetch(fsUrl(env, ":commit"), {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: writes || [] }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  let status = "";
  try { status = (JSON.parse(text).error || {}).status || ""; } catch (e) {}
  if (res.status === 409 || res.status === 400 && /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(text) || status === "FAILED_PRECONDITION" || status === "ALREADY_EXISTS") {
    throw Object.assign(new Error("fs_precondition"), { code: "precondition", status: res.status, detail: text.slice(0, 300) });
  }
  throw Object.assign(new Error("fs_commit_failed"), { code: "fs_commit", status: res.status, detail: text.slice(0, 300) });
}

// ---- query -----------------------------------------------------------------------------
// runQuery over a collection with an OPTIONAL single-field equality filter (opts.where =
// { field, value }). A single equality filter uses Firestore's automatic single-field index,
// so this never needs a hand-built composite index. Returns decoded docs (newest first isn't
// guaranteed — the caller sorts; beta volumes are tiny). opts.limit caps the result.
export async function fsQuery(env, collectionId, opts) {
  opts = opts || {};
  const tok = await fsToken(env);
  const structuredQuery = { from: [{ collectionId }] };
  if (opts.where && opts.where.field) {
    structuredQuery.where = {
      fieldFilter: { field: { fieldPath: opts.where.field }, op: "EQUAL", value: encodeValue(opts.where.value) },
    };
  }
  if (opts.limit) structuredQuery.limit = opts.limit;
  const res = await fetch(fsUrl(env, ":runQuery"), {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw Object.assign(new Error("fs_query_failed"), { code: "fs_query", status: res.status, detail: (await res.text()).slice(0, 300) });
  const rows = await res.json();
  const out = [];
  (rows || []).forEach((r) => { if (r && r.document) out.push({ id: docId(r.document.name), name: r.document.name, fields: decodeFields(r.document.fields), updateTime: r.document.updateTime }); });
  return out;
}
