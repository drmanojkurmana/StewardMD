// functions/_connect/onboard/consents.js — Consent Dashboard (Increment 1): a hospital admin's PHI-free,
// tenant-scoped READ of their own connect_abdm_consent_req rows (status/purpose/scope/expiry), plus a LOCAL
// revoke that genuinely blocks further data-sharing (functions/_connect/abdm/consent.js#revalidateForRequest
// re-checks status==='GRANTED' on EVERY data request, so flipping this row to REVOKED is a real, enforced
// block -- not cosmetic). HONEST SPLIT: the listing and the LOCAL revoke are REAL TODAY; only the EXTERNAL
// ABDM Consent-Manager notification is a flag-gated stub behind an INTERFACE (getConsentProvider), so a future
// wired HIP/CM integration plugs in without this module (or the dashboard) changing shape.
//
// Mirrors activity.js exactly: PHI-free tenant-scoped RBAC read (connector:read) + client-safe allow-list
// projection (toConsentRow) + defense-in-depth tenant re-filter + JS-side sort + empty-binding early return.
// Revoke uses connector:write (owner/admin only per rbac.js -- a clinician holds connector:read but not
// connector:write, so RBAC alone keeps revocation an org-administration action).
import { requireCan } from "../enterprise/guard.js";
import { updateConsentStatus } from "../abdm/state.js"; // REUSE the Stage-3 monotonic guard (R6); do not duplicate the rank logic.
import { makeAuditSink } from "../audit.js";
import { hipFlagOn } from "../abdm/hip-flags.js";
import { OnboardError } from "./errors.js";
import { revokeConsent as abdmRevokeConsent } from "./consent-abdm.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function intOpt(v, dflt, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// A deterministic, wall-clock-free sortable rank for a ts (ISO string or epoch number). Unparseable/missing
// sorts last, so a malformed row never jumps to the top. (Mirrors activity.js's tsRank exactly.)
function tsRank(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "string") { const p = Date.parse(ts); if (Number.isFinite(p)) return p; }
  return -Infinity;
}

function safeJson(raw, fallback) {
  if (typeof raw !== "string" || raw === "") return fallback;
  try { const v = JSON.parse(raw); return v === undefined ? fallback : v; } catch { return fallback; }
}

// COUNT of care_contexts only -- the raw list (a patient-linkable careContextReference array) is NEVER
// forwarded to the client, even as an opaque blob.
function careContextCount(raw) {
  const arr = safeJson(raw, null);
  return Array.isArray(arr) ? arr.length : 0;
}

// Render the patient pseudonym HMAC truncated -- extra defense-in-depth on top of it already being an HMAC
// (never the raw ABHA; see schema comment on patient_abha_hash), so even the full digest never reaches the DOM.
const HASH_VISIBLE = 8;
function truncateHash(h) {
  if (typeof h !== "string" || !h) return null;
  return h.length > HASH_VISIBLE ? h.slice(0, HASH_VISIBLE) + "..." : h;
}

// The ONLY fields a client ever sees for a consent row. `actor`, the raw `care_contexts` array, and the raw
// `patient_abha_hash` are structurally dropped here (care_contexts collapses to a COUNT; the hash is
// truncated) -- never forwarded in full, even though the row carries them.
export function toConsentRow(row) {
  if (!row || typeof row !== "object") return null;
  const hiTypes = safeJson(row.hi_types, []);
  const dr = safeJson(row.date_range, null);
  const dateRange = (dr && typeof dr === "object" && !Array.isArray(dr)) ? { from: dr.from ?? null, to: dr.to ?? null } : null;
  return {
    consentId: row.consent_id ?? null,
    ref: row.consent_id ?? row.request_id ?? null,
    status: row.status ?? null,
    purpose: safeJson(row.purpose, row.purpose ?? null),
    hiTypes: Array.isArray(hiTypes) ? hiTypes : [],
    careContextCount: careContextCount(row.care_contexts),
    dateRange,
    expiresAt: row.expires_at ?? null,
    dataEraseAt: row.data_erase_at ?? null,
    patientRefHash: truncateHash(row.patient_abha_hash),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    revocable: row.status === "GRANTED",
  };
}

// readTenantConsents(deps, request, env, tenantId, opts) -> { ok:true, consents:[...], truncated }.
// Fail-closed RBAC (connector:read); tenant is taken from the RESOLVED membership, never the client-supplied
// id, so there is no cross-tenant widening. If the D1 binding is absent, return an EMPTY list rather than
// throwing -- a missing binding is an ops/config gap, not a security decision.
export async function readTenantConsents(deps, request, env, tenantId, opts = {}) {
  if (!deps || !deps.db) return { ok: true, consents: [], truncated: false };

  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
  const limit = intOpt(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  // Overfetch by one so truncation can be detected without a second COUNT query, mirroring activity.js.
  const r = await deps.db.prepare(
    "SELECT * FROM connect_abdm_consent_req WHERE tenant_id=? ORDER BY updated_at DESC LIMIT ?"
  ).bind(tenant.id, limit + 1).all();
  const rows = (r.results || []).filter((row) => String(row.tenant_id) === String(tenant.id)); // defense-in-depth tenant re-check

  rows.sort((a, b) => tsRank(b.updated_at) - tsRank(a.updated_at));    // most-recent-first, input-order-independent

  const truncated = rows.length > limit;
  const consents = rows.slice(0, limit).map(toConsentRow);
  return { ok: true, consents, truncated };
}

// ---- LOCAL revoke: the monotonic write our OWN data-request gate enforces (consent.js#revalidateForRequest
// re-checks status==='GRANTED' on EVERY request, so this genuinely blocks sharing -- it is not cosmetic).
// GRANTED/INITIATED -> REVOKED succeeds; an already-REVOKED row is an idempotent no-op; a terminal
// EXPIRED/DENIED row refuses (nothing left to revoke). ----
async function localRevoke(deps, env, row, now) {
  const guarded = await updateConsentStatus(deps.db, row.request_id, "REVOKED", now);
  if (!guarded.ok) {
    if (guarded.status === "REVOKED") return { ok: true, status: "REVOKED", noop: true };   // idempotent repeat
    throw new OnboardError("invalid", "consent is already terminal (" + guarded.status + ") and cannot be revoked");
  }
  await makeAuditSink(env, deps.db)({
    action: "consent.revoked", outcome: "ok", ts: now,
    tenantId: row.tenant_id ?? null, consentId: row.consent_id ?? null,
  });
  return { ok: true, status: "REVOKED", propagated: "local" };
}

// getConsentProvider(env) -- the INTERFACE seam. Returns the ABDM adapter only when the ABDM/HIP flag is on
// (consent-abdm.js); otherwise the LOCAL adapter (today's default, and the ONLY reachable path until a real
// gateway.post("consentRevoke", ...) is wired -- see consent-abdm.js). revokeTenantConsent goes THROUGH this
// factory so it never imports abdm/* directly.
export function getConsentProvider(env) {
  if (hipFlagOn(env)) {
    return { revokeConsent: (deps, envArg, row, now) => abdmRevokeConsent(deps, envArg, row, now, localRevoke) };
  }
  return { revokeConsent: (deps, envArg, row, now) => localRevoke(deps, envArg, row, now) };
}

// revokeTenantConsent(deps, request, env, tenantId, ref) -> the provider's revoke result. Fail-closed RBAC
// (connector:write -- owner/admin only); the candidate row set is scoped to the RESOLVED tenant BEFORE the ref
// is matched (consent_id OR request_id), so a ref belonging to another tenant is structurally invisible here
// (no IDOR). Mirrors store.js's mutating-endpoint idiom: no special-cased "db absent" branch (a missing D1
// binding on a write path is an ops/config fault, not a degrade-to-empty case).
export async function revokeTenantConsent(deps, request, env, tenantId, ref) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  const now = new Date().toISOString();

  const r = await deps.db.prepare("SELECT * FROM connect_abdm_consent_req WHERE tenant_id=?").bind(tenant.id).all();
  const rows = (r.results || []).filter((row) => String(row.tenant_id) === String(tenant.id));
  const row = rows.find((row) => (row.consent_id != null && String(row.consent_id) === String(ref)) || String(row.request_id) === String(ref));
  if (!row) throw new OnboardError("not-found", "consent not found");

  const provider = getConsentProvider(env);
  return provider.revokeConsent(deps, env, row, now);
}
