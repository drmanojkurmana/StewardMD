// functions/api/connect/agent/[[path]].js -- Connect Hospital agent-broker HTTP surface.
// Cloudflare Pages routes /api/connect/agent/* here, ahead of the Phase-0 catch-all
// functions/api/connect/[[path]].js. Flag-gated (smd_connect_agent, default OFF => 404,
// no existence leak); server-derived identity (identify) + fail-closed RBAC inside the agent
// modules; no-store; sanitized errors (only { error: <class> } -- never a stack/URL/token).
import { jsonResponse } from "../../../_connect/testkit.js";
import { agentFlagOn, browserSessionFlagOn } from "../../../_connect/agent/flags.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { OnboardError } from "../../../_connect/onboard/errors.js";
import { identify } from "../../../_usage.js";
import { ownerOK } from "../../../_adminauth.js";
import { makeSecrets } from "../../../_connect/secrets.js";
import { resolveActor, resolveTenant } from "../../../_connect/identity.js";
import { listMyTenants } from "../../../_connect/enterprise/members.js";
import {
  requireAgent,
  assertOwnership,
  assertTransition,
  canTransition,
  canAgent,
  SESSION_LIVE,
} from "../../../_connect/agent/state.js";
import {
  assertConsent,
  recordConsent,
  revokeConsent,
  AGENT_SCOPES,
} from "../../../_connect/agent/consent.js";
import {
  issueViewerToken,
  redeemViewerToken,
} from "../../../_connect/agent/viewer-token.js";
import {
  getDeployment,
  findDeploymentByFingerprint,
  insertDeployment,
  deploymentFingerprint,
  deploymentView,
  deploymentOrigins,
  updateDeploymentOrigins,
  listDeploymentsForTenant,
  getVersion,
  insertVersion,
  casVersionLifecycle,
  listVersionsByLifecycle,
  findVersionByLifecycle,
  insertSession,
  getSessionRow,
  findLiveSession,
  findLatestSessionForDeployment,
  casSession,
  sessionView,
  insertJob,
  findJobForSession,
  findJobByCandidateVersion,
  casJob,
  casDeploymentActiveVersion,
  getActiveActivation,
  revokeSessionViewerTokens,
  newId,
  nowIso,
} from "../../../_connect/agent/store.js";
import { activateVersion } from "../../../_connect/agent/activation.js";
import { compileManifest } from "../../../../connect-agent/manifest/compile.mjs";
import { validateCandidate } from "../../../../connect-agent/manifest/validate.mjs";
import {
  sha256,
  canonicalJson,
  findHostileKeys,
  manifestContentHash,
  validateManifest,
  templatePlaceholders,
} from "../../../../connect-agent/manifest/schema.mjs";
import { inferHtmlOperations } from "../../../../connect-agent/manifest/infer-html.mjs";
import { askBrain, ROLES as BRAIN_ROLES } from "../../../_connect/agent/brain.js";

export { agentFlagOn, browserSessionFlagOn } from "../../../_connect/agent/flags.js";

/* A manifest id the manifest schema will actually accept: lower-case [a-z0-9._-], 64 characters at
 * most (MANIFEST_ID_RE, connect-agent/manifest/schema.mjs). The ids here are `dep_<uuid>` and
 * `job_<uuid>`, so prefixes and dashes are dropped and the first 12 hex characters of each are kept:
 * 34 characters, unique per deployment and job, and both are still readable to a reviewer. */
/* HOW MANY CANDIDATES ONE HOSPITAL MAY HOLD AT ONCE.
 *
 * Re-running discovery is normal: a doctor signs in again, shows the agent a view it missed, and a
 * fresh candidate appears. Only one of them can ever become the connection, so the rest are noise -
 * and left alone they accumulate as decisions nobody will be asked to make. Owner rule (2026-09-12):
 * keep the three newest, discard the rest, and when one is approved discard every other candidate
 * for that deployment. Three is enough to compare a retry against what came before; more is a
 * queue of stale drafts. Discarded means REVOKED: nothing is deleted and the audit trail stands. */
export const CANDIDATE_LIMIT = 3;

/** Revoke every AWAITING_APPROVAL candidate of a deployment except the ones named in `keepIds`. */
async function discardOtherCandidates(db, tenantId, deploymentId, keepIds, reason) {
  const keep = new Set((keepIds || []).filter(Boolean));
  const all = await listVersionsByLifecycle(db, tenantId, deploymentId, "AWAITING_APPROVAL");
  const discarded = [];
  for (const v of all) {
    if (keep.has(v.id)) continue;
    try {
      await casVersionLifecycle(db, tenantId, v.id, "AWAITING_APPROVAL", {
        lifecycle: "REVOKED",
        policy_version: "discarded:" + String(reason || "superseded").slice(0, 100),
      });
      discarded.push(v.id);
    } catch { /* a candidate someone else just decided on: leave it as they left it */ }
  }
  return discarded;
}

export function manifestIdFor(deploymentId, jobId) {
  const short = (id) => String(id || "").toLowerCase().replace(/^(dep|job)_/, "").replace(/[^a-z0-9]/g, "").slice(0, 12) || "unknown";
  return `manifest-${short(deploymentId)}-${short(jobId)}`;
}

const STATUS = (e) =>
  e instanceof OnboardError
    ? e.klass === "not-found"
      ? 404
      : e.klass === "too-large"
        ? 413
        : e.klass === "forbidden"
          ? 403
          : e.klass === "conflict"
            ? 409
            : 400
    : e instanceof AuthError
      ? 401
      : e instanceof PermissionError
        ? 403
        : e instanceof SandboxViolation
          ? 403
          : 400;

const CODE = (e) =>
  e instanceof OnboardError
    ? e.klass
    : e && e.constructor && e.constructor.name
      ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error"
      : "error";

function hasCredentials(body) {
  if (!body || typeof body !== "object") return false;
  const keys = ["password", "token", "credentials", "secret", "emrPassword", "clientSecret", "privateKey", "auth"];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null) return true;
  }
  return false;
}

// A crawler view's pathTemplate is a full URL; infer-html reduces it to a path. Same reduction here so a
// repaired view can be matched to the operation it produced.
function toRepairPath(p) { try { return new URL(String(p)).pathname || "/"; } catch { return String(p || "/").split("?")[0]; } }

/* An identifier inside a captured page path is not structure. Older phones stored a labs page as
 * /LabResults/Home?recordNo=<MRN>; the value becomes {id} on the way in and on the way out. */
export function redactPathValues(p) {
  return String(p || "").replace(/=([A-Za-z]{0,6}\d{3,}[A-Za-z0-9-]*)(?=&|$)/g, "={id}");
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Validates+strips body.observedViews (crawler-observed server-rendered views) for inferHtmlOperations.
// Fail-closed: an out-of-shape entry throws "invalid" rather than silently dropping fields. Hostile keys
// (__proto__/constructor/prototype) are already rejected on the whole body upstream of this call.
function cleanObservedViews(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new OnboardError("invalid", "observedViews must be an array");
  if (raw.length > 40) throw new OnboardError("invalid", "observedViews: too many entries");
  return raw.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new OnboardError("invalid", "observedViews: view must be an object");
    if (typeof v.resourceHint !== "string" || v.resourceHint.length > 32) throw new OnboardError("invalid", "observedViews: resourceHint invalid");
    if (typeof v.pathTemplate !== "string" || v.pathTemplate.length > 512) throw new OnboardError("invalid", "observedViews: pathTemplate invalid");
    if (!Array.isArray(v.headers) || v.headers.length > 24 || v.headers.some((h) => typeof h !== "string" || h.length > 120)) {
      throw new OnboardError("invalid", "observedViews: headers invalid");
    }
    const clean = { resourceHint: v.resourceHint, pathTemplate: redactPathValues(v.pathTemplate), headers: v.headers.slice() };
    if (v.rowsSelector !== undefined) {
      if (typeof v.rowsSelector !== "string" || v.rowsSelector.length > 200) throw new OnboardError("invalid", "observedViews: rowsSelector invalid");
      clean.rowsSelector = v.rowsSelector;
    }
    if (v.onclickTemplate !== undefined) {
      if (typeof v.onclickTemplate !== "string" || v.onclickTemplate.length > 120) throw new OnboardError("invalid", "observedViews: onclickTemplate invalid");
      clean.onclickTemplate = v.onclickTemplate;
    }
    if (v.singleRecord !== undefined) {
      if (typeof v.singleRecord !== "boolean") throw new OnboardError("invalid", "observedViews: singleRecord invalid");
      clean.singleRecord = v.singleRecord;
    }
    if (v.method !== undefined) {
      if (v.method !== "GET" && v.method !== "HEAD") throw new OnboardError("invalid", "observedViews: method invalid");
      clean.method = v.method;
    }
    // Report block (label/value view): one positional selector per header, relative to rowsSelector.
    if (v.cellSelectors !== undefined) {
      if (!Array.isArray(v.cellSelectors) || v.cellSelectors.length !== clean.headers.length || v.cellSelectors.some((s) => typeof s !== "string" || s.length > 200)) {
        throw new OnboardError("invalid", "observedViews: cellSelectors invalid");
      }
      clean.cellSelectors = v.cellSelectors.slice();
    }
    if (v.block !== undefined) {
      if (typeof v.block !== "boolean") throw new OnboardError("invalid", "observedViews: block invalid");
      clean.block = v.block;
    }
    // Same-origin endpoints the click triggered (redacted on the phone: no query values, digit runs -> #).
    if (v.endpoints !== undefined) {
      if (!Array.isArray(v.endpoints) || v.endpoints.length > 8) throw new OnboardError("invalid", "observedViews: endpoints invalid");
      clean.endpoints = v.endpoints.map((e) => {
        if (!e || typeof e !== "object" || (e.method !== "GET" && e.method !== "POST") || typeof e.path !== "string" || e.path.length > 512 || /\d{3,}/.test(e.path)) {
          throw new OnboardError("invalid", "observedViews: endpoint invalid");
        }
        const cleanEndpoint = { method: e.method, path: e.path };
        // Request FIELD NAMES only (never values), for the phone runtime to replay a POST inside the
        // doctor's authenticated session (e.g. GHIS's __RequestVerificationToken + recordNo).
        if (e.bodyKeys !== undefined) {
          if (!Array.isArray(e.bodyKeys) || e.bodyKeys.length > 40 || e.bodyKeys.some((k) => typeof k !== "string" || k.length > 60 || /\d{3,}/.test(k) || k.indexOf("@") >= 0)) {
            throw new OnboardError("invalid", "observedViews: endpoint bodyKeys invalid");
          }
          cleanEndpoint.bodyKeys = e.bodyKeys.slice();
        }
        if (e.requestKind !== undefined) {
          if (e.requestKind !== "form" && e.requestKind !== "json" && e.requestKind !== "multipart" && e.requestKind !== "other") {
            throw new OnboardError("invalid", "observedViews: endpoint requestKind invalid");
          }
          cleanEndpoint.requestKind = e.requestKind;
        }
        if (e.xhr !== undefined) {
          if (typeof e.xhr !== "boolean") throw new OnboardError("invalid", "observedViews: endpoint xhr invalid");
          cleanEndpoint.xhr = e.xhr;
        }
        if (e.contentType !== undefined) {
          if (typeof e.contentType !== "string" || e.contentType.length > 60) throw new OnboardError("invalid", "observedViews: endpoint contentType invalid");
          cleanEndpoint.contentType = e.contentType;
        }
        return cleanEndpoint;
      });
    }
    // Guided step: the doctor showed the agent where this lives; the tap path is the replay pattern.
    if (v.guided !== undefined) {
      if (typeof v.guided !== "boolean") throw new OnboardError("invalid", "observedViews: guided invalid");
      clean.guided = v.guided;
    }
    // The brain's column roles (advisory; infer-html uses one only where its own rules found nothing).
    if (v.fieldHints !== undefined) {
      if (!v.fieldHints || typeof v.fieldHints !== "object" || Array.isArray(v.fieldHints)) throw new OnboardError("invalid", "observedViews: fieldHints invalid");
      const fh = {};
      for (const k of Object.keys(v.fieldHints)) {
        if (typeof k !== "string" || k.length > 120 || BRAIN_ROLES.indexOf(v.fieldHints[k]) < 0) throw new OnboardError("invalid", "observedViews: fieldHints invalid");
        if (clean.headers.indexOf(k) >= 0) fh[k] = v.fieldHints[k];
      }
      clean.fieldHints = fh;
    }
    if (v.guidedPath !== undefined) {
      if (!Array.isArray(v.guidedPath) || v.guidedPath.length > 20 || v.guidedPath.some((s) => typeof s !== "string" || s.length > 120 || /\d{3,}/.test(s))) {
        throw new OnboardError("invalid", "observedViews: guidedPath invalid");
      }
      clean.guidedPath = v.guidedPath.slice();
    }
    return clean;
  });
}

// A discovery-spec event's redacted path (connect-agent/discovery.mjs's redactPath) always writes the
// generic token `{id}`; a compiled operation's pathTemplate (connect-agent/manifest/compile.mjs's
// templateFromRedactedPath) renames that to a semantic placeholder ("{patientId}") derived from the
// parent segment. Same path, different placeholder spelling -- genericize both sides before comparing
// "was this operation's path actually observed".
function genericizePath(path) {
  return String(path || "").replace(/\{[^}/]*\}/g, "{id}");
}

// --- phone-runner handoff: registrable-domain origin matching (CONTRACT.md) --------------------------
// Same-registrable-domain origins observed during handoff merge into the deployment's approved set
// automatically (an SSO/API subdomain of a hospital's own domain); anything else is held as a
// doctor-confirmable pending origin. The 3-label suffix list covers the common two-label ccTLD SLDs
// where the registrable domain is actually 3 labels (co.in, co.uk, ...) -- a plain "last 2 labels" rule
// would treat "hospital.co.in" and "other.co.in" as the same registrable domain.
const THREE_LABEL_SUFFIXES = new Set(["co.in", "ac.in", "edu.in", "org.in", "gov.in", "net.in", "res.in", "co.uk", "ac.uk"]);
function registrableDomain(hostname) {
  const labels = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  if (labels.length >= 3 && THREE_LABEL_SUFFIXES.has(last2)) return labels.slice(-3).join(".");
  return last2;
}
function sameRegistrableDomain(originA, originB) {
  try {
    return registrableDomain(new URL(originA).hostname) === registrableDomain(new URL(originB).hostname);
  } catch { return false; }
}

// --- phone-runner capability resource names --------------------------------------------------------
// The UI's capability list is keyed by a FIXED vocabulary distinct from the manifest's own canonical
// `mapping.resource` (connect-agent/manifest/schema.mjs RESOURCES: patient/worklist/encounters/
// medications/allergies/observations/documents -- the SCCM-facing name) and from OPERATION_TYPES (the
// compiler-facing name). One deterministic table, in one place, from operation TYPE -> UI resource name,
// so a capability never carries two different resource spellings depending on which route built it.
// `patient_lookup` and `result_detail` are reserved slots in the UI vocabulary with no compiler operation
// type that produces them today (the compiler has only ONE patient-read type, get_patient_summary, and
// ONE results-read type, list_results) -- `other` is the fail-closed default for anything unmapped,
// never a guess at which of those two names would apply.
const CAPABILITY_RESOURCE = Object.freeze({
  list_worklist: "worklist",
  get_patient_summary: "patient_summary",
  list_medications: "medications",
  list_allergies: "allergies",
  list_results: "results",
  list_encounters: "encounters",
  list_notes: "notes",
});
function capabilityResource(operationType) {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_RESOURCE, operationType) ? CAPABILITY_RESOURCE[operationType] : "other";
}

// --- phone-runner deterministic planner (CONTRACT.md "POST /sessions/:id/plan") ------------------------
// No LLM in v1. A prompt-injection line ("click logout", "Ignore previous instructions...") is defeated
// structurally, not semantically: SKIP_LABEL matches the substring regardless of the rest of the label,
// and every candidate must ALSO come from a real `[ref=...]` line the phone actually rendered -- text in
// a label can only ever narrow the candidate set, never point at an arbitrary ref. Ported verbatim from
// connect-agent/discovery.mjs's SKIP_LABEL (same list, same intent: never click something destructive/
// irreversible).
const PLAN_SKIP_LABEL = /sign\s?out|log\s?out|logout|delete|remove|discharge|export|download|order|prescribe|submit|save|new\b|create/i;
const PLAN_CLICKABLE_ROLE = /^(?:link|button|menuitem|tab|option|row|cell)$/i;
const PLAN_LINE_RE = /^\s*- (\w+) "(.*)" \[ref=([A-Za-z0-9_-]{1,32})\]$/;
const PLAN_TIER1 = /doctor|physician|clinical|ward|inpatient|\bipd\b|\bopd\b|patient|worklist|census|dashboard/i;
const PLAN_TIER2 = /lab|result|investigation|radiolog|report|medic|drug|medicine|allerg|encounter|visit|note|summary|history|vital|diagnos/i;

function planNext({ url, lines, visited, depth, events }) {
  const visitedSet = new Set((Array.isArray(visited) ? visited : []).map(String));
  const candidates = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const m = PLAN_LINE_RE.exec(String(raw));
    if (!m) continue;
    const [, role, label, ref] = m;
    if (!PLAN_CLICKABLE_ROLE.test(role)) continue;
    if (PLAN_SKIP_LABEL.test(label)) continue;
    if (visitedSet.has(`${url}|${label}`)) continue;
    candidates.push({ label, ref });
  }

  const tier1 = candidates.find((c) => PLAN_TIER1.test(c.label));
  if (tier1) return { action: "click", ref: tier1.ref, label: tier1.label, reason: "tier1 keyword match" };

  const tier2 = candidates.find((c) => PLAN_TIER2.test(c.label));
  if (tier2) return { action: "click", ref: tier2.ref, label: tier2.label, reason: "tier2 keyword match" };

  const sawArrayJson = (Array.isArray(events) ? events : []).some(
    (e) => e && Number(e.status) >= 200 && Number(e.status) < 300 && /json/i.test(String(e.contentType || ""))
  );
  if (sawArrayJson) {
    const row = candidates.find((c) => c.label.indexOf("#") !== -1);
    if (row) return { action: "click", ref: row.ref, label: row.label, reason: "row after list detected" };
  }

  if (Number(depth) > 0) return { action: "back", reason: "no candidate on this page" };
  return { action: "stop", reason: "no candidate and at root depth" };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!agentFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/agent\/?/, "").replace(/\/+$/, "");
  const parts = seg ? seg.split("/") : [];
  const method = request.method;

  const deps = {
    db: env.CONNECT_DB,
    kv: env.MAIK_KV,
    identifyFn: env.identifyFn || identify,
    ownerOk: env.ownerOk || ownerOK,
    secrets: makeSecrets(env),
    fetch,
    now: env.now || (() => Date.now()),
    env,
  };

  let body = {};
  if (method === "POST" || method === "DELETE") {
    try { body = await request.json(); } catch {}
  }
  // A doctor onboarding their own hospital knows their hospital's address, not a tenant id - that is
  // OUR identifier and no client screen ever shows it. Every route below is tenant-scoped, so resolve
  // it once here from the actor's own membership when the caller did not supply one; supplying it
  // still wins, and nothing is ever guessed between several tenants.
  let tid = body.tenantId || url.searchParams.get("tenant");
  const resolveTid = async () => {
    if (tid) return tid;
    const mine = (await listMyTenants(deps, request, env)).filter((t) => canAgent(t.role, "session"));
    if (mine.length === 1) tid = mine[0].tenantId;
    else if (mine.length > 1) throw new OnboardError("invalid", "tenantId required: this account belongs to more than one tenant");
    else throw new OnboardError("forbidden", "no tenant available for this actor");
    return tid;
  };

  try {
    if (!tid && seg !== "hospitals/resolve" && seg !== "tenants") await resolveTid();
    // GET /tenants -- the hospitals this account may onboard for. The client asks the doctor to pick
    // one when there are several (an owner or super-admin belongs to many), instead of the 400
    // "tenantId required" that resolveTid() answers for every other route.
    if (method === "GET" && seg === "tenants") {
      const mine = (await listMyTenants(deps, request, env)).filter((t) => canAgent(t.role, "read"));
      return jsonResponse({ ok: true, tenants: mine.map((t) => ({ tenantId: t.tenantId, name: t.name || null, role: t.role })) });
    }
    // POST /brain/classify | /brain/map-columns | /brain/next -- the model that reads screen STRUCTURE.
    // PHI gate first (400 with the reason, nothing sent), then a per-origin cache, then the model.
    // A model failure is 503 brain_unavailable: the phone falls back to its deterministic rules.
    if (method === "POST" && parts.length === 2 && parts[0] === "brain") {
      await requireAgent(deps, request, env, tid, "session");
      if (findHostileKeys(body).length) throw new OnboardError("invalid", "hostile key in request body");
      const { tenantId: _t, ...payload } = body;
      payload.op = parts[1];
      let out;
      try {
        out = await askBrain({ env, kv: deps.kv, fetchImpl: deps.fetch, generateImpl: env.brainGenerate, payload });
      } catch (e) {
        return jsonResponse({ ok: false, error: "brain_unavailable", detail: String((e && e.message) || e).slice(0, 300) }, { status: 503 });
      }
      if (!out.ok) throw new OnboardError("invalid", "refused by the PHI gate: " + out.refused);
      return jsonResponse(Object.assign({ ok: true, cached: out.cached, model: out.model }, out.answer));
    }
    // POST /sessions -- validate actor/tenant via identify()+RBAC, consent, create job/session
    if (method === "POST" && seg === "sessions") {
      if (!browserSessionFlagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
      if (hasCredentials(body)) throw new OnboardError("invalid", "credentials must not be supplied");

      // The deployment is the other identifier a first-time doctor cannot have: for a hospital nobody
      // has onboarded yet the row does not exist at all, so it is found-or-created from emrUrl below.
      const tenantId = await resolveTid();
      const { actor } = await requireAgent(deps, request, env, tenantId, "session");

      let deployment = null;
      if (body.deploymentId) {
        deployment = await getDeployment(deps.db, tenantId, body.deploymentId);
      } else if (body.emrUrl) {
        let origin = null;
        try { origin = new URL(String(body.emrUrl)).origin; } catch { throw new OnboardError("invalid", "emrUrl must be an absolute URL"); }
        // https only: the whole session rides on this origin, and the approved-origin list this
        // deployment is pinned to is what every later read is checked against.
        if (!/^https:$/i.test(new URL(origin).protocol)) throw new OnboardError("invalid", "emrUrl must be https");
        const fp = await deploymentFingerprint([origin]);
        deployment = await findDeploymentByFingerprint(deps.db, tenantId, fp);
        if (!deployment) {
          deployment = await insertDeployment(deps.db, {
            tenantId,
            hospitalId: String(body.hospitalId || new URL(origin).host),
            name: body.name ? String(body.name).slice(0, 200) : new URL(origin).host,
            origins: [origin],
            vendor: null,
            fingerprint: fp,
            networkMode: "public",
          });
        }
      } else {
        throw new OnboardError("invalid", "deploymentId or emrUrl required");
      }

      // Consent is SERVER-owned: the client tells us the doctor agreed on the consent screen, and the
      // server writes its own HMAC-signed record from that action. It never accepts a consent receipt
      // from the client, and an existing valid consent is still required when none is being given now.
      const consent = (body.consent && body.consent.agreed === true)
        ? await recordConsent(deps, env, {
            tenantId,
            actorId: actor.id,
            deploymentId: deployment.id,
            scope: [...AGENT_SCOPES],
            now: deps.now(),
          })
        : await assertConsent(deps, env, {
            tenantId,
            actorId: actor.id,
            deploymentId: deployment.id,
            requiredScope: ["emr:session"],
            now: deps.now(),
          });
      const nowMs = Number(deps.now());
      const runnerPhone = body.runner === "phone";
      // Reconnect/backgrounding resumption
      let session = await findLiveSession(deps.db, tenantId, actor.id, deployment.id, SESSION_LIVE, nowMs);
      let job = session ? await findJobForSession(deps.db, tenantId, session.id) : null;
      if (!session) {
        const sessionId = newId("ses_");
        const sessionTtl = Number(body.ttlMs) > 0 ? Number(body.ttlMs) : 3600000;
        const sessionExpiry = Math.min(nowMs + sessionTtl, Number(consent.expires_at));
        session = await insertSession(deps.db, {
          id: sessionId,
          tenant_id: tenantId,
          deployment_id: deployment.id,
          actor_id: actor.id,
          runner_ref: newId("run_"),
          consent_id: consent.id,
          state: "CREATED",
          control_owner: "clinician",
          expires_at: sessionExpiry,
        });
        // Phone runner reuse: the deployment already has a live, approved adapter -- this session is for
        // reauth/use of that adapter, not for onboarding a new one, so no job is created at all. The
        // existing Camofox path (runner absent) is unchanged: it always onboards, active version or not.
        if (!(runnerPhone && deployment.active_version_id)) {
          const jobId = newId("job_");
          job = await insertJob(deps.db, {
            id: jobId,
            tenant_id: tenantId,
            session_id: sessionId,
            deployment_id: deployment.id,
            actor_id: actor.id,
            state: "CREATED",
            idempotency_key: body.idempotencyKey || null,
            deadline_at: sessionExpiry,
            max_attempts: Number(body.maxAttempts) || 3,
          });
        }
      }
      const sessionResp = Object.assign({ ok: true }, sessionView(session, job));
      if (runnerPhone) {
        sessionResp.deployment = { id: deployment.id, origins: deploymentOrigins(deployment), activeVersionId: deployment.active_version_id || null };
        /* REUSE IS ABOUT THE ADAPTER, NOT ABOUT A LEFTOVER JOB. A doctor who ran Connect Hospital and
         * then opened Ward Sync within the hour still holds the live session of that run, complete
         * with its onboarding job; "no job" made reuse false and Ward Sync refused the APPROVED
         * adapter with reuse=false (owner, 2026-09-13). A caller reading through the adapter says
         * purpose:"read"; otherwise only a job still onboarding keeps reuse off, so the sheet can
         * resume that run. */
        const jobBusy = !!job && ["CREATED", "AUTHENTICATED", "DISCOVERING", "COMPILING", "VALIDATING"].includes(job.state);
        sessionResp.reuse = !!deployment.active_version_id && (body.purpose === "read" || !jobBusy);
      }
      return jsonResponse(sessionResp);
    }

    // POST /sessions/:id/viewer-token -- short-lived, actor-bound, single-use viewer authorization
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "viewer-token") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const nowMs = Number(deps.now());
      if (SESSION_LIVE.indexOf(session.state) === -1 || nowMs >= Number(session.expires_at)) {
        throw new OnboardError("expired", "session expired");
      }
      const vt = await issueViewerToken(deps, env, {
        session,
        actorId: actor.id,
        ttlMs: body.ttlMs,
        now: nowMs,
      });
      return jsonResponse(Object.assign({ ok: true }, vt));
    }

    // POST /sessions/:id/viewer-token/redeem -- redeem viewer authorization (single-use, actor-bound)
    if (method === "POST" && parts.length === 4 && parts[0] === "sessions" && parts[2] === "viewer-token" && parts[3] === "redeem") {
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const token = body.token || request.headers.get("x-smd-viewer-token");
      const redeemed = await redeemViewerToken(deps, env, token, { actorId: actor.id, now: deps.now() });
      return jsonResponse(Object.assign({ ok: true }, redeemed));
    }

    // GET /sessions/:id -- sanitized state/progress only, never raw internals
    if (method === "GET" && parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "read");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const job = await findJobForSession(deps.db, tid, sessionId);
      const dep = await getDeployment(deps.db, tid, session.deployment_id);
      const view = Object.assign({ ok: true }, sessionView(session, job));
      view.deployment = { id: dep.id, origins: deploymentOrigins(dep), activeVersionId: dep.active_version_id || null };
      view.candidateVersionId = job && job.candidate_version_id ? job.candidate_version_id : null;
      if (job && job.candidate_version_id) {
        const ver = await getVersion(deps.db, tid, job.candidate_version_id);
        if (ver) view.capabilities = safeJsonParse(ver.capabilities) || [];
      }
      return jsonResponse(view);
    }

    // POST /sessions/:id/handoff -- idempotent handoff to agent
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "handoff") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      let session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      let job = await findJobForSession(deps.db, tid, sessionId);
      const idemKey = body.idempotencyKey || request.headers.get("Idempotency-Key") || null;

      // Phone-runner: origins the doctor's web view actually visited (CONTRACT.md). Same-registrable-
      // domain origins merge into the deployment's approved set automatically; anything else is held as
      // a doctor-confirmable pending origin (POST .../origins). Idempotent by construction (Set-based),
      // so it runs before the idempotency short-circuits below and is safe to reprocess on a replay.
      let deploymentRow = await getDeployment(deps.db, tid, session.deployment_id);
      if (Array.isArray(body.visitedOrigins)) {
        const currentOrigins = deploymentOrigins(deploymentRow);
        const firstOrigin = currentOrigins[0];
        const existing = new Set(currentOrigins);
        const toAppend = [];
        const pendingBefore = safeJsonParse(session.pending_origins) || [];
        const pendingSet = new Set(pendingBefore);
        for (const raw of body.visitedOrigins.slice(0, 50)) {
          let o = null;
          try { o = new URL(String(raw)).origin; } catch { continue; }
          if (!/^https:$/i.test(new URL(o).protocol)) continue;
          if (existing.has(o)) continue;
          if (firstOrigin && sameRegistrableDomain(o, firstOrigin)) { toAppend.push(o); existing.add(o); }
          else pendingSet.add(o);
        }
        if (toAppend.length) {
          deploymentRow = await updateDeploymentOrigins(deps.db, tid, deploymentRow.id, [...currentOrigins, ...toAppend]);
        }
        const pendingAfter = [...pendingSet];
        if (pendingAfter.length !== pendingBefore.length) {
          session = await casSession(deps.db, tid, session.id, session.revision, { pending_origins: JSON.stringify(pendingAfter) });
        }
      }
      const withOrigins = (resp) => {
        resp.origins = deploymentOrigins(deploymentRow);
        resp.pendingOrigins = safeJsonParse(session.pending_origins) || [];
        return resp;
      };

      // Idempotency check
      if (idemKey && job && job.idempotency_key === idemKey) {
        return jsonResponse(withOrigins(Object.assign({ ok: true, idempotent: true }, sessionView(session, job))));
      }
      if (session.control_owner === "agent" && (session.state === "AUTHENTICATED" || (job && job.state === "DISCOVERING"))) {
        return jsonResponse(withOrigins(Object.assign({ ok: true, idempotent: true }, sessionView(session, job))));
      }

      await assertConsent(deps, env, {
        tenantId: tid,
        actorId: actor.id,
        deploymentId: session.deployment_id,
        requiredScope: ["emr:session", "emr:discover"],
        now: deps.now(),
      });

      let currentSession = session;
      if (currentSession.state === "CREATED") {
        assertTransition("session", "CREATED", "AWAITING_LOGIN");
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { state: "AWAITING_LOGIN" });
      }
      if (currentSession.state === "AWAITING_LOGIN") {
        assertTransition("session", "AWAITING_LOGIN", "AUTHENTICATED");
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { state: "AUTHENTICATED", control_owner: "agent" });
      } else if (currentSession.state === "AUTHENTICATED" && currentSession.control_owner !== "agent") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "agent" });
      }

      let currentJob = job;
      if (currentJob) {
        if (currentJob.state === "CREATED") {
          assertTransition("job", "CREATED", "AWAITING_LOGIN");
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, { state: "AWAITING_LOGIN" });
        }
        if (currentJob.state === "AWAITING_LOGIN") {
          assertTransition("job", "AWAITING_LOGIN", "AUTHENTICATED");
          const jobSet = { state: "AUTHENTICATED" };
          if (idemKey && !currentJob.idempotency_key) jobSet.idempotency_key = idemKey;
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, jobSet);
        }
        // Handoff stops at AUTHENTICATED, deliberately: it does not itself advance the job to
        // DISCOVERING. JOB_LEASABLE (state.js) is only ["CREATED","AUTHENTICATED"] - a job handoff
        // pushed straight to DISCOVERING would never be leasable by a runner at all (DISCOVERING is
        // only RECLAIMABLE, i.e. after a runner already held and lost a lease on it), so no runner
        // could ever pick up a freshly-handed-off job. The runner's own POST .../report with
        // stage:"DISCOVERING" is what legally makes that transition, once it has actually leased the
        // job and started working - see functions/api/connect/agent/runner/[[path]].js.
        else if (idemKey && currentJob.state === "AUTHENTICATED" && !currentJob.idempotency_key) {
          currentJob = await casJob(deps.db, tid, currentJob.id, currentJob.revision, { idempotency_key: idemKey });
        }
      }

      return jsonResponse(withOrigins(Object.assign({ ok: true }, sessionView(currentSession, currentJob))));
    }

    // POST /sessions/:id/origins -- doctor confirms a pending (non-registrable-domain) origin
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "origins") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const pending = safeJsonParse(session.pending_origins) || [];
      const pendingSet = new Set(pending);
      const approveList = Array.isArray(body.approve) ? body.approve.slice(0, 50) : [];
      const toApprove = [];
      for (const raw of approveList) {
        const o = String(raw);
        if (!pendingSet.has(o)) throw new OnboardError("invalid", "origin was not offered for confirmation");
        let parsed = null;
        try { parsed = new URL(o); } catch { throw new OnboardError("invalid", "malformed origin"); }
        if (!/^https:$/i.test(parsed.protocol)) throw new OnboardError("invalid", "origin must be https");
        toApprove.push(o);
      }
      let deploymentRow = await getDeployment(deps.db, tid, session.deployment_id);
      if (toApprove.length) {
        const merged = [...new Set([...deploymentOrigins(deploymentRow), ...toApprove])];
        deploymentRow = await updateDeploymentOrigins(deps.db, tid, deploymentRow.id, merged);
        const remaining = pending.filter((o) => toApprove.indexOf(o) === -1);
        await casSession(deps.db, tid, session.id, session.revision, { pending_origins: JSON.stringify(remaining) });
      }
      return jsonResponse({ ok: true, origins: deploymentOrigins(deploymentRow) });
    }

    // POST /sessions/:id/pause -- explicit ownership transfer to clinician
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "pause") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (SESSION_LIVE.indexOf(session.state) === -1) {
        throw new OnboardError("conflict", "session is not active");
      }
      let currentSession = session;
      if (currentSession.control_owner !== "clinician") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "clinician" });
      }
      const job = await findJobForSession(deps.db, tid, sessionId);
      return jsonResponse(Object.assign({ ok: true }, sessionView(currentSession, job)));
    }

    // POST /sessions/:id/resume -- explicit ownership transfer to agent
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "resume") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (SESSION_LIVE.indexOf(session.state) === -1) {
        throw new OnboardError("conflict", "session is not active");
      }
      let currentSession = session;
      if (currentSession.control_owner !== "agent") {
        currentSession = await casSession(deps.db, tid, currentSession.id, currentSession.revision, { control_owner: "agent" });
      }
      const job = await findJobForSession(deps.db, tid, sessionId);
      return jsonResponse(Object.assign({ ok: true }, sessionView(currentSession, job)));
    }

    // DELETE /sessions/:id -- cancel/revoke session and schedule cleanup
    if (method === "DELETE" && parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      assertTransition("session", session.state, "CANCELLED");
      const updatedSession = await casSession(deps.db, tid, session.id, session.revision, {
        state: "CANCELLED",
        closed_at: nowIso(),
        cleanup_after: nowIso(),
      });
      const job = await findJobForSession(deps.db, tid, sessionId);
      let updatedJob = job;
      if (job && canTransition("job", job.state, "CANCELLED")) {
        assertTransition("job", job.state, "CANCELLED");
        updatedJob = await casJob(deps.db, tid, job.id, job.revision, {
          state: "CANCELLED",
          completed_at: nowIso(),
        });
      }
      const nowMs = Number(deps.now());
      await revokeSessionViewerTokens(deps.db, session.id, nowMs);
      if (body.revokeConsent && session.consent_id) {
        try { await revokeConsent(deps, env, { tenantId: tid, consentId: session.consent_id, now: nowMs }); } catch {}
      }
      return jsonResponse(Object.assign({ ok: true, cancelled: true }, sessionView(updatedSession, updatedJob)));
    }

    // POST /sessions/:id/plan -- deterministic keyword planner (no LLM). Lines are NEVER persisted or
    // logged: they are parsed, used to answer this one request, and discarded.
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "plan") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (findHostileKeys(body).length) throw new OnboardError("invalid", "hostile key in request body");
      if (typeof body.url !== "string" || !body.url) throw new OnboardError("invalid", "url required");
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const events = Array.isArray(body.events) ? body.events : [];
      if (lines.length > 400) throw new OnboardError("invalid", "too many lines");
      if (events.length > 200) throw new OnboardError("invalid", "too many events");
      for (const l of lines) if (typeof l !== "string" || l.length > 200) throw new OnboardError("invalid", "line too long");
      const visited = Array.isArray(body.visited) ? body.visited : [];
      const plan = planNext({ url: body.url, lines, visited, depth: body.depth, events });
      return jsonResponse(Object.assign({ ok: true }, plan));
    }

    // POST /sessions/:id/progress -- AUTHENTICATED -> DISCOVERING (idempotent)
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "progress") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (body.stage !== "DISCOVERING") throw new OnboardError("invalid", "unsupported progress stage");
      let job = await findJobForSession(deps.db, tid, sessionId);
      if (!job) throw new OnboardError("not-found", "job not found");
      if (job.state === "AUTHENTICATED") {
        assertTransition("job", "AUTHENTICATED", "DISCOVERING");
        job = await casJob(deps.db, tid, job.id, job.revision, { state: "DISCOVERING", stage: "discovering" });
      }
      return jsonResponse(Object.assign({ ok: true }, sessionView(session, job)));
    }

    // POST /sessions/:id/discovery -- compile + offline-validate the candidate manifest, issue GET probes
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "discovery") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).length;
      if (bodyBytes > 512 * 1024) throw new OnboardError("too-large", "discovery payload exceeds 512 KB");
      if (findHostileKeys(body).length) throw new OnboardError("invalid", "hostile key in request body");
      const spec = body.spec;
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new OnboardError("invalid", "spec required");
      const observedViews = cleanObservedViews(body.observedViews);

      let job = await findJobForSession(deps.db, tid, sessionId);
      if (!job) throw new OnboardError("not-found", "job not found");
      if (["DISCOVERING", "COMPILING", "VALIDATING"].indexOf(job.state) === -1) {
        throw new OnboardError("conflict", "job is not in discovery");
      }
      const deployment = await getDeployment(deps.db, tid, session.deployment_id);

      if (job.state === "DISCOVERING") {
        assertTransition("job", "DISCOVERING", "COMPILING");
        job = await casJob(deps.db, tid, job.id, job.revision, { state: "COMPILING", stage: "compiling" });
      }

      // connect-agent/discovery.mjs's createCollector().collect() (the shape CONTRACT.md says this body's
      // `spec` is, unchanged) stamps version:3; compileManifest now accepts both 2 and 3 (identical
      // handling -- see connect-agent/manifest/compile.mjs).
      let manifest;
      try {
        const compiled = await compileManifest(spec, {
          /* THE ID THAT FAILED EVERY REAL HOSPITAL. `manifest-<deployment>-<job>` with two prefixed
           * UUIDs is 90 characters; MANIFEST_ID_RE caps a manifestId at 64, so validateManifest
           * rejected it and compileManifest threw for EVERY discovery that ever reached this line.
           * The fixtures passed because their ids are short ("dep-1", "job-1"). A doctor's crawl of
           * 21 pages died here with "spec could not be compiled" (device, 2026-09-12). Twelve hex
           * characters of each id keep it unique and readable inside the cap. */
          manifestId: manifestIdFor(deployment.id, job.id),
          timezone: (env && env.CONNECT_AGENT_MANIFEST_TIMEZONE) || "Asia/Kolkata",
        });
        manifest = compiled.manifest;
      } catch (e) {
        // Keep the compiler's own reason: without it a failed compile is indistinguishable from a
        // network error, and the crawl that produced the spec is thrown away with nothing to fix.
        throw new OnboardError("invalid", "spec could not be compiled: " + String((e && e.message) || e).slice(0, 200));
      }

      // HTML-operation inference: merge crawler-observed views into the compiled manifest so a phone that
      // only crawls (no JSON API discovered) still gets a full adapter. JSON-discovered operations always
      // win a type collision. Never let inference break the JSON-only path -- a merge that fails
      // validation is dropped and reported, not stored.
      let htmlOperationsAdded = [];
      let htmlInferenceError = null;
      let addedHtmlOps = [];
      if (observedViews.length) {
        const primaryOrigin = manifest.origins[0]; // compile.mjs always assigns origins[0] the primary origin
        const inferred = inferHtmlOperations(observedViews, { originId: primaryOrigin.id });
        const existingTypes = new Set(manifest.operations.map((op) => op.type));
        const toAdd = inferred.operations.filter((op) => !existingTypes.has(op.type));
        if (toAdd.length || inferred.unsupported.length) {
          const merged = Object.assign({}, manifest, {
            operations: manifest.operations.concat(toAdd),
            unsupported: manifest.unsupported.concat(inferred.unsupported),
            capabilityProbes: Array.isArray(manifest.capabilityProbes)
              ? manifest.capabilityProbes.concat(toAdd.map((op) => ({ operationType: op.type, expect: { minItems: 0 } })))
              : manifest.capabilityProbes,
          });
          merged.contentHash = manifestContentHash(merged);
          const mergeErrors = validateManifest(merged);
          if (mergeErrors.length === 0) {
            manifest = merged;
            addedHtmlOps = toAdd;
            htmlOperationsAdded = toAdd.map((op) => op.type);
          } else {
            htmlInferenceError = "html-inferred manifest failed validation; kept JSON-only manifest";
          }
        }
      }

      if (job.state === "COMPILING") {
        assertTransition("job", "COMPILING", "VALIDATING");
        job = await casJob(deps.db, tid, job.id, job.revision, { state: "VALIDATING", stage: "validating" });
      }

      // Offline: no live network call to the hospital from the server. Runs the schema/structural checks
      // against an empty fixture; real capability proof comes from the phone's own live probes at
      // POST .../evidence.
      const offlineValidation = await validateCandidate({ manifest, fixture: { routes: {} } });

      const depOrigins = new Set(deploymentOrigins(deployment));
      const observedPaths = new Set(
        (Array.isArray(spec.events) ? spec.events : [])
          .filter((e) => e && String(e.method || "").toUpperCase() === "GET")
          .map((e) => `${e.origin}|${genericizePath(e.path)}`)
      );
      const probes = [];
      for (const op of manifest.operations) {
        if (op.method !== "GET") continue;
        const originRow = manifest.origins.find((o) => o.id === op.originId);
        if (!originRow || !depOrigins.has(originRow.origin)) continue;
        if (!observedPaths.has(`${originRow.origin}|${genericizePath(op.pathTemplate)}`)) continue;
        probes.push({ opId: op.type, method: "GET", url: originRow.origin + op.pathTemplate });
      }
      // Added html ops: safe to probe directly (no observed-event match needed) since they are GET-only,
      // placeholder-free, and scoped to an allowlisted origin.
      for (const op of addedHtmlOps) {
        if (op.method !== "GET") continue;
        if (templatePlaceholders(op.pathTemplate).length) continue;
        const originRow = manifest.origins.find((o) => o.id === op.originId);
        if (!originRow || !depOrigins.has(originRow.origin)) continue;
        probes.push({ opId: op.type, method: "GET", url: originRow.origin + op.pathTemplate });
      }

      // observedViews are kept on the job (PHI-free structure: selectors, labels, redacted endpoints and
      // the doctor's guided tap paths) as the replay pattern for the phone-side runtime.
      /* WHO ASKED FOR THIS CONNECTION, kept with the candidate it produced.
       *
       * The approval screen named the hospital and nothing else, which is the one fact the owner
       * already knows: they are looking at their own hospital's queue. What they cannot see is WHICH
       * doctor signed in and ran the agent, and that is the whole basis for trusting the request
       * (owner, 2026-09-12). The email is the VERIFIED one from identify(), never a body value, and
       * it names a colleague rather than a patient: no PHI. Session rows keep only a pseudonymous
       * actor id, so this is where the human-readable fact can live without a schema change. */
      let requestedBy = null;
      try {
        const who = await deps.identifyFn(request, env);
        requestedBy = who && who.email ? String(who.email).toLowerCase() : null;
      } catch { /* identity is already proven by requireAgent above; this is only the label */ }

      const phoneState = {
        manifest, probes,
        offlineValidation,
        requestedBy,
        requestedAt: nowIso(),
        observedEvents: (Array.isArray(spec.events) ? spec.events : []).slice(0, 200),
        observedViews,
      };
      job = await casJob(deps.db, tid, job.id, job.revision, { phone_state: JSON.stringify(phoneState) });

      return jsonResponse({
        ok: true, candidateVersionId: job.candidate_version_id || null, manifest, probes, capabilities: null,
        htmlOperationsAdded, htmlInferenceError,
      });
    }

    // POST /sessions/:id/evidence -- phone reports live probe results for opIds this server issued
    if (method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "evidence") {
      const sessionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      const session = await getSessionRow(deps.db, tid, sessionId);
      assertOwnership(session, tid, actor.id);
      if (findHostileKeys(body).length) throw new OnboardError("invalid", "hostile key in request body");

      let job = await findJobForSession(deps.db, tid, sessionId);
      if (!job) throw new OnboardError("not-found", "job not found");
      if (job.state !== "VALIDATING" && job.state !== "AWAITING_APPROVAL") {
        throw new OnboardError("conflict", "job is not awaiting evidence");
      }
      const phoneState = safeJsonParse(job.phone_state);
      if (!phoneState || !phoneState.manifest) throw new OnboardError("conflict", "no candidate manifest on this job");
      const manifest = phoneState.manifest;
      const issuedOpIds = new Set((phoneState.probes || []).map((p) => p.opId));

      const reportedProbes = Array.isArray(body.probes) ? body.probes : [];
      if (reportedProbes.length > 200) throw new OnboardError("invalid", "too many probe results");
      const cleanProbes = [];
      for (const p of reportedProbes) {
        if (!p || typeof p !== "object" || !issuedOpIds.has(p.opId)) {
          throw new OnboardError("invalid", "probe opId was not issued by this server");
        }
        cleanProbes.push({
          opId: String(p.opId),
          status: Number.isInteger(p.status) ? p.status : 0,
          contentType: p.contentType != null ? String(p.contentType).slice(0, 100) : null,
          responseShape: (p.responseShape && typeof p.responseShape === "object" && !Array.isArray(p.responseShape)) ? p.responseShape : null,
          itemCount: Number.isInteger(p.itemCount) ? p.itemCount : null,
        });
      }
      const probeByOp = new Map(cleanProbes.map((p) => [p.opId, p]));
      const observedByKey = new Map(
        (phoneState.observedEvents || []).map((e) => [`${String(e.method || "").toUpperCase()} ${e.origin}|${genericizePath(e.path)}`, e])
      );

      const capabilities = manifest.operations.map((op) => {
        const probe = probeByOp.get(op.type);
        let proven = false, how = "none";
        if (probe && probe.status >= 200 && probe.status < 300 && probe.responseShape != null) {
          proven = true; how = "probe";
        } else if (op.method !== "GET") {
          const originRow = manifest.origins.find((o) => o.id === op.originId);
          const observed = observedByKey.get(`${op.method} ${originRow ? originRow.origin : ""}|${genericizePath(op.pathTemplate)}`);
          if (observed && Number(observed.status) >= 200 && Number(observed.status) < 300 && /json/i.test(String(observed.contentType || ""))) {
            proven = true; how = "observed";
          }
        }
        return { operation: op.type, resource: capabilityResource(op.type), proven, how };
      });

      const evidenceHash = sha256(canonicalJson({ offlineValidation: phoneState.offlineValidation, probes: cleanProbes }));

      let candidateVersionId = job.candidate_version_id;
      let versionState;
      if (!candidateVersionId) {
        let version = await insertVersion(deps.db, {
          tenantId: tid,
          deploymentId: session.deployment_id,
          manifestRef: "manifest:" + manifest.contentHash,
          schemaVersion: manifest.schemaVersion,
          contentHash: manifest.contentHash,
          capabilities,
          parentVersionId: null,
          evidenceHash,
        });
        candidateVersionId = version.id;
        assertTransition("adapter", "CREATED", "VALIDATING");
        version = await casVersionLifecycle(deps.db, tid, version.id, "CREATED", { lifecycle: "VALIDATING" });
        assertTransition("adapter", "VALIDATING", "AWAITING_APPROVAL");
        version = await casVersionLifecycle(deps.db, tid, version.id, "VALIDATING", { lifecycle: "AWAITING_APPROVAL" });
        /* A retry ADDS a candidate rather than replacing one, so hold the newest CANDIDATE_LIMIT and
         * discard anything older: an owner should never face a queue of stale drafts of the same
         * connection. The candidate just built is always among those kept. */
        const holding = await listVersionsByLifecycle(deps.db, tid, version.deployment_id, "AWAITING_APPROVAL");
        if (holding.length > CANDIDATE_LIMIT) {
          const keep = holding.slice(0, CANDIDATE_LIMIT).map((v) => v.id);
          if (keep.indexOf(version.id) < 0) { keep.pop(); keep.push(version.id); }
          await discardOtherCandidates(deps.db, tid, version.deployment_id, keep, "older than the newest " + CANDIDATE_LIMIT);
        }
        versionState = version.lifecycle;
      } else {
        const version = await getVersion(deps.db, tid, candidateVersionId);
        versionState = version ? version.lifecycle : "AWAITING_APPROVAL";
      }

      if (job.state === "VALIDATING") {
        assertTransition("job", "VALIDATING", "AWAITING_APPROVAL");
        job = await casJob(deps.db, tid, job.id, job.revision, { state: "AWAITING_APPROVAL", candidate_version_id: candidateVersionId });
      }

      return jsonResponse({ ok: true, candidateVersionId, capabilities, evidenceHash, state: versionState });
    }

    // GET /versions/:id
    if (method === "GET" && parts.length === 2 && parts[0] === "versions") {
      const versionId = parts[1];
      await requireAgent(deps, request, env, tid, "read");
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      let operations = [];
      const phoneState = job ? safeJsonParse(job.phone_state) : null;
      if (phoneState && phoneState.manifest && Array.isArray(phoneState.manifest.operations)) {
        operations = phoneState.manifest.operations.map((op) => ({
          opId: op.type, type: op.type, resource: capabilityResource(op.type),
          method: op.method, pathTemplate: op.pathTemplate,
        }));
      }
      /* WHAT THE OWNER NEEDS TO JUDGE THIS, not just accept or reject it blind.
       *
       * The detail carried the operations and a hash. An owner asked, reasonably, how they were
       * meant to decide: who requested it, what the agent actually saw, and whether it will work
       * (2026-09-12). All of it already exists on the job; none of it is PHI - view labels, column
       * headers, paths and probe outcomes, never a patient's data. */
      const validation = phoneState && phoneState.offlineValidation ? phoneState.offlineValidation : null;
      const views = (phoneState && Array.isArray(phoneState.observedViews) ? phoneState.observedViews : []).map((v) => ({
        resource: v.resourceHint || "unknown",
        path: v.pathTemplate ? redactPathValues(v.pathTemplate) : null,
        columns: Array.isArray(v.headers) ? v.headers.slice(0, 12) : [],
        guided: !!v.guided,
      }));
      return jsonResponse({
        ok: true, id: version.id, state: version.lifecycle, deploymentId: version.deployment_id,
        operations, capabilities: safeJsonParse(version.capabilities) || [],
        evidenceHash: version.evidence_hash || null, createdAt: version.created_at,
        requestedBy: (phoneState && phoneState.requestedBy) || null,
        requestedAt: (phoneState && phoneState.requestedAt) || null,
        pagesObserved: phoneState && Array.isArray(phoneState.observedEvents) ? phoneState.observedEvents.length : 0,
        views,
        // The phone runtime replays these (selectors, labels, paths: PHI-free by construction, see
        // connect-agent/phone/CONTRACT.md "observedViews") to read a ward list in the doctor's own session.
        replay: phoneState && Array.isArray(phoneState.observedViews) ? phoneState.observedViews.map((v) => Object.assign({}, v, { pathTemplate: redactPathValues(v.pathTemplate) })) : [],
        validation: validation ? { ok: validation.ok !== false, issues: (validation.issues || []).slice(0, 10) } : null,
      });
    }

    // POST /versions/:id/approve -- owner/admin only; activates the candidate
    if (method === "POST" && parts.length === 3 && parts[0] === "versions" && parts[2] === "approve") {
      const versionId = parts[1];
      const { actor, role } = await requireAgent(deps, request, env, tid, "approve");
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      const { version: activated, activation } = await activateVersion(deps.db, {
        tenantId: tid,
        deploymentId: version.deployment_id,
        versionId,
        actorId: actor.id,
        role,
        policyVersion: "connect-agent-phone/1",
        evidenceHash: version.evidence_hash,
      });
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      if (job && canTransition("job", job.state, "ACTIVE")) {
        assertTransition("job", job.state, "ACTIVE");
        await casJob(deps.db, tid, job.id, job.revision, { state: "ACTIVE", completed_at: nowIso() });
      }
      // One candidate wins; the others are drafts of the same connection and must not stay in the
      // owner's queue pretending to be decisions (CANDIDATE_LIMIT).
      const discarded = await discardOtherCandidates(deps.db, tid, version.deployment_id, [versionId], "approved:" + versionId);
      return jsonResponse({ ok: true, state: activated.lifecycle, activationId: activation.id, discarded: discarded.length });
    }

    // POST /versions/:id/repair -- read-time self-repair. The phone read zero rows through an APPROVED
    // adapter, the doctor was asked to show the right screen, and this is that screen's PHI-free
    // structure. It becomes a NEW candidate (parent = the approved version) for the owner to approve;
    // the approved adapter is never edited in place, and the three-draft rule applies.
    if (method === "POST" && parts.length === 3 && parts[0] === "versions" && parts[2] === "repair") {
      const versionId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "session");
      if (findHostileKeys(body).length) throw new OnboardError("invalid", "hostile key in request body");
      const session = await getSessionRow(deps.db, tid, String(body.sessionId || ""));
      assertOwnership(session, tid, actor.id);
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      if (version.lifecycle !== "ACTIVE") throw new OnboardError("conflict", "only an approved adapter can be repaired");
      if (!body.view || typeof body.view !== "object") throw new OnboardError("invalid", "view required");
      const view = cleanObservedViews([body.view])[0];
      if (!view.rowsSelector) throw new OnboardError("invalid", "the repaired view has no row selector");
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      const phoneState = job ? safeJsonParse(job.phone_state) : null;
      if (!phoneState || !phoneState.manifest || !Array.isArray(phoneState.manifest.origins) || !phoneState.manifest.origins.length) {
        throw new OnboardError("conflict", "no candidate manifest on this adapter");
      }
      view.guided = true;
      const observedViews = (Array.isArray(phoneState.observedViews) ? phoneState.observedViews : [])
        .filter((v) => v && v.resourceHint !== view.resourceHint).concat([view]);
      const base = phoneState.manifest;
      const inferred = inferHtmlOperations(observedViews, { originId: base.origins[0].id });
      const jsonOps = (base.operations || []).filter((op) => op.responseFormat !== "html");
      const jsonTypes = new Set(jsonOps.map((op) => op.type));
      const htmlOps = inferred.operations.filter((op) => !jsonTypes.has(op.type));
      const manifest = Object.assign({}, base, {
        operations: jsonOps.concat(htmlOps),
        unsupported: inferred.unsupported,
        capabilityProbes: (Array.isArray(base.capabilityProbes) ? base.capabilityProbes.filter((p) => p && jsonTypes.has(p.operationType)) : [])
          .concat(htmlOps.map((op) => ({ operationType: op.type, expect: { minItems: 0 } }))),
      });
      manifest.contentHash = manifestContentHash(manifest);
      const errors = validateManifest(manifest);
      if (errors.length) throw new OnboardError("invalid", "repaired adapter failed validation: " + String((errors[0] && (errors[0].message || errors[0].path)) || errors[0]).slice(0, 160));
      const offlineValidation = await validateCandidate({ manifest, fixture: { routes: {} } });
      const evidenceHash = sha256(canonicalJson({ offlineValidation, repairedFrom: versionId }));
      const capabilities = manifest.operations.map((op) => ({ operation: op.type, resource: capabilityResource(op.type), proven: op.type === (inferred.operations.find((o) => o.pathTemplate === toRepairPath(view.pathTemplate)) || {}).type, how: "repair" }));
      let candidate = await insertVersion(deps.db, {
        tenantId: tid, deploymentId: version.deployment_id, manifestRef: "manifest:" + manifest.contentHash,
        schemaVersion: manifest.schemaVersion, contentHash: manifest.contentHash, capabilities,
        parentVersionId: versionId, evidenceHash,
      });
      assertTransition("adapter", "CREATED", "VALIDATING");
      candidate = await casVersionLifecycle(deps.db, tid, candidate.id, "CREATED", { lifecycle: "VALIDATING" });
      assertTransition("adapter", "VALIDATING", "AWAITING_APPROVAL");
      candidate = await casVersionLifecycle(deps.db, tid, candidate.id, "VALIDATING", { lifecycle: "AWAITING_APPROVAL" });
      const holding = await listVersionsByLifecycle(deps.db, tid, version.deployment_id, "AWAITING_APPROVAL");
      if (holding.length > CANDIDATE_LIMIT) {
        const keep = holding.slice(0, CANDIDATE_LIMIT).map((v) => v.id);
        if (keep.indexOf(candidate.id) < 0) { keep.pop(); keep.push(candidate.id); }
        await discardOtherCandidates(deps.db, tid, version.deployment_id, keep, "older than the newest " + CANDIDATE_LIMIT);
      }
      let requestedBy = null;
      try { const who = await deps.identifyFn(request, env); requestedBy = who && who.email ? String(who.email).toLowerCase() : null; } catch { /* label only */ }
      // The candidate's own job row carries the replay views the phone runtime reads once approved.
      const repairJob = await insertJob(deps.db, {
        id: newId("job_"), tenant_id: tid, session_id: session.id, deployment_id: version.deployment_id, actor_id: actor.id,
        state: "AWAITING_APPROVAL", idempotency_key: null, deadline_at: session.expires_at, max_attempts: 1,
      });
      await casJob(deps.db, tid, repairJob.id, repairJob.revision, {
        candidate_version_id: candidate.id,
        phone_state: JSON.stringify({
          manifest, probes: [], offlineValidation, requestedBy, requestedAt: nowIso(), repairedFrom: versionId,
          observedEvents: Array.isArray(phoneState.observedEvents) ? phoneState.observedEvents : [], observedViews,
        }),
      });
      return jsonResponse({ ok: true, candidateVersionId: candidate.id, state: candidate.lifecycle, parentVersionId: versionId, replay: observedViews });
    }

    // POST /versions/:id/reject -- owner/admin only; revokes the candidate
    if (method === "POST" && parts.length === 3 && parts[0] === "versions" && parts[2] === "reject") {
      const versionId = parts[1];
      await requireAgent(deps, request, env, tid, "approve");
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      assertTransition("adapter", version.lifecycle, "REVOKED");
      const updated = await casVersionLifecycle(deps.db, tid, versionId, version.lifecycle, {
        lifecycle: "REVOKED",
        policy_version: "reject:" + String(body.reason || "unspecified").slice(0, 200),
      });
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      if (job && canTransition("job", job.state, "FAILED")) {
        assertTransition("job", job.state, "FAILED");
        await casJob(deps.db, tid, job.id, job.revision, { state: "FAILED", stage_code: "E_REJECTED", completed_at: nowIso() });
      }
      return jsonResponse({ ok: true, state: updated.lifecycle });
    }

    // DELETE /connections/:deploymentId -- owner/admin removes a hospital's adapter: the approved version
    // is revoked, the hospital's active pointer cleared, every waiting draft discarded. The deployment
    // row stays (history, consent), so the hospital shows as "Not connected" and can be connected again.
    if (method === "DELETE" && parts.length === 2 && parts[0] === "connections") {
      const deploymentId = parts[1];
      const { actor } = await requireAgent(deps, request, env, tid, "approve");
      const deployment = await getDeployment(deps.db, tid, deploymentId);
      const activeId = deployment.active_version_id || null;
      if (activeId) {
        const active = await getVersion(deps.db, tid, activeId);
        await casDeploymentActiveVersion(deps.db, tid, deploymentId, activeId, null);
        if (active && canTransition("adapter", active.lifecycle, "REVOKED")) {
          await casVersionLifecycle(deps.db, tid, activeId, active.lifecycle, { lifecycle: "REVOKED", policy_version: "removed:" + String(actor.id).slice(0, 60) });
        }
      }
      const discarded = await discardOtherCandidates(deps.db, tid, deploymentId, [], "removed by " + String(body.reason || "the owner").slice(0, 60));
      return jsonResponse({ ok: true, deploymentId, removedVersionId: activeId, discarded: discarded.length });
    }

    // GET /connections -- this tenant's deployments, one row each
    if (method === "GET" && seg === "connections") {
      await requireAgent(deps, request, env, tid, "read");
      const deployments = await listDeploymentsForTenant(deps.db, tid);
      const connections = [];
      for (const dep of deployments) {
        const activation = dep.active_version_id ? await getActiveActivation(deps.db, tid, dep.id) : null;
        const pending = await findVersionByLifecycle(deps.db, tid, dep.id, "AWAITING_APPROVAL");
        const lastSession = await findLatestSessionForDeployment(deps.db, tid, dep.id);
        connections.push({
          deploymentId: dep.id,
          origins: deploymentOrigins(dep),
          activeVersionId: dep.active_version_id || null,
          activeSince: activation ? activation.activated_at : null,
          pendingVersionId: pending ? pending.id : null,
          lastSessionState: lastSession ? lastSession.state : null,
        });
      }
      return jsonResponse({ ok: true, connections });
    }

    // POST /hospitals/resolve -- resolve deployment by metadata without leaking membership
    if (method === "POST" && seg === "hospitals/resolve") {
      const actor = await resolveActor(deps.identifyFn, request, env);
      const targetTenantId = body.tenantId || null;
      const origins = Array.isArray(body.origins) ? body.origins : null;
      const fingerprint = body.fingerprint || (origins ? await deploymentFingerprint(origins) : null);
      const emrUrl = body.emrUrl || null;
      const deploymentId = body.deploymentId || null;
      const hospitalId = body.hospitalId || null;

      if (targetTenantId) {
        let isAllowed = false;
        try {
          const { role } = await resolveTenant(deps.db, actor, targetTenantId, env);
          isAllowed = canAgent(role, "read");
        } catch {
          isAllowed = false;
        }
        if (!isAllowed) {
          throw new OnboardError("not-found", "hospital not found");
        }
        let dep = null;
        if (deploymentId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND id=?").bind(targetTenantId, deploymentId).first()) || null;
        } else if (fingerprint) {
          dep = await findDeploymentByFingerprint(deps.db, targetTenantId, fingerprint);
        } else if (hospitalId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND hospital_id=?").bind(targetTenantId, hospitalId).first()) || null;
        }
        if (!dep) throw new OnboardError("not-found", "hospital not found");
        const activeVer = dep.active_version_id ? await getVersion(deps.db, targetTenantId, dep.active_version_id) : null;
        return jsonResponse(Object.assign({ ok: true }, deploymentView(dep, activeVer)));
      }

      // No tenant specified: search caller's own accessible tenants without cross-tenant leak
      const myTenants = await listMyTenants(deps, request, env);

      // A doctor picking their hospital, or typing their hospital's EMR address, is the PRIMARY
      // onboarding path (brief section 5: "select hospital or enter canonical EMR deployment URL").
      // Both answer with a LIST, and an empty list is a normal, successful answer meaning "no
      // deployment of yours matches" - which is exactly the first-time case for a hospital nobody has
      // onboarded yet. It must not be a 404: the client dead-ends on the new-hospital path otherwise,
      // which is what it did. An empty list is also what a caller who simply is not a member of the
      // owning tenant gets, so "exists but not yours" and "does not exist" stay indistinguishable.
      const wantsList = emrUrl != null || body.query != null || (!deploymentId && !fingerprint && !hospitalId);
      if (wantsList) {
        let wantFingerprint = fingerprint;
        if (!wantFingerprint && emrUrl) {
          try { wantFingerprint = await deploymentFingerprint([new URL(String(emrUrl)).origin]); }
          catch { throw new OnboardError("invalid", "emrUrl must be an absolute http(s) URL"); }
        }
        const needle = String(body.query || "").trim().toLowerCase();
        const hospitals = [];
        for (const t of myTenants) {
          if (!canAgent(t.role, "read")) continue;
          const r = await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=?").bind(t.tenantId).all();
          for (const dep of (r.results || [])) {
            if (String(dep.status || "active") !== "active") continue;
            if (wantFingerprint && String(dep.fingerprint) !== String(wantFingerprint)) continue;
            if (needle && !(`${dep.name || ""} ${dep.hospital_id || ""}`.toLowerCase().includes(needle))) continue;
            const ver = dep.active_version_id ? await getVersion(deps.db, t.tenantId, dep.active_version_id) : null;
            hospitals.push({
              deploymentId: dep.id,
              hospitalId: dep.hospital_id,
              name: dep.name || dep.hospital_id,
              emrUrl: deploymentOrigins(dep)[0] || null,
              hasActiveAdapter: !!ver,
              adapterVersion: ver ? ver.id : null,
            });
          }
        }
        return jsonResponse({ ok: true, hospitals });
      }

      let foundDep = null;
      let foundTenantId = null;
      for (const t of myTenants) {
        if (!canAgent(t.role, "read")) continue;
        let dep = null;
        if (deploymentId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND id=?").bind(t.tenantId, deploymentId).first()) || null;
        } else if (fingerprint) {
          dep = await findDeploymentByFingerprint(deps.db, t.tenantId, fingerprint);
        } else if (hospitalId) {
          dep = (await deps.db.prepare("SELECT * FROM connect_deployment WHERE tenant_id=? AND hospital_id=?").bind(t.tenantId, hospitalId).first()) || null;
        }
        if (dep) {
          foundDep = dep;
          foundTenantId = t.tenantId;
          break;
        }
      }
      if (!foundDep) throw new OnboardError("not-found", "hospital not found");
      const activeVer = foundDep.active_version_id ? await getVersion(deps.db, foundTenantId, foundDep.active_version_id) : null;
      return jsonResponse(Object.assign({ ok: true }, deploymentView(foundDep, activeVer)));
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    /* The CODE alone is not enough to act on: a doctor whose crawl walked 21 pages was told
     * {"error":"invalid"} and nothing else. An OnboardError's message is authored here, is a
     * sentence rather than a stack, and carries no PHI, so it travels as `detail`. Any OTHER
     * exception keeps the bare code, since its message is not ours to promise. */
    const body = { error: CODE(e) };
    if (e instanceof OnboardError && e.message) body.detail = String(e.message).slice(0, 300);
    return jsonResponse(body, { status: STATUS(e) });
  }
}
