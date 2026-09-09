/* functions/_wardsynq/fhir-outbound.js — TASK 7.4: WardSynQ's record, out to another system.
 *
 * The audit found this simply absent: every other direction existed (a FHIR read door, a FHIR write
 * door, an HL7 gateway, a DICOMweb pull) and there was no way for WardSynQ to SEND anything. The one
 * outbound-shaped thing in the codebase, wardsynq-api-gov.js's webhook, deliberately refuses to
 * carry clinical content at all. This is the missing direction, and it is a pipeline rather than a
 * serializer: a destination somebody registered, a queue that survives the process, an attempt
 * history, a backoff, a dead-letter, and a receipt.
 *
 * FIVE RULES, each one a way an outbound interface normally goes wrong.
 *
 *  1. A DESTINATION IS REGISTERED, NEVER SUPPLIED. The URL a resource goes to is a record an
 *     administrator wrote, re-validated against the SSRF guard on every single send - not a
 *     parameter on the request that triggered the send. Clinical data cannot be exfiltrated by
 *     asking this server to POST it somewhere, because nothing here takes a URL from a caller.
 *  2. SENT IS NOT DELIVERED. A 2xx from the far end is DELIVERED with the receipt it returned;
 *     anything else - a 5xx, a timeout, a refused connection, a redirect into a private network -
 *     is a failed attempt with a time to try again. Nothing is ever recorded as delivered because
 *     it was posted.
 *  3. THE QUEUE IS THE RECORD. Deliveries are RecordService rows like everything else: append-only,
 *     tenant-bound by construction, audited on every state change. A queue in memory is a queue that
 *     loses a discharge summary when the isolate recycles.
 *  4. ONE RESOURCE VERSION, ONE DELIVERY. The delivery's id is derived from destination + resource +
 *     version, so asking twice for the same thing is the same row, not a second copy at the far end.
 *  5. IT GIVES UP HONESTLY. After MAX_ATTEMPTS the delivery is DEAD-LETTERED and stays visible with
 *     every attempt and every error on it. A queue that retries for ever hides an integration that
 *     has been broken since Tuesday.
 *
 * WHAT THIS DOES NOT DO. It does not schedule itself: `dispatchOutbound` is called by whatever this
 * hospital uses for a clock (a cron trigger, the integration console's own button). A Pages Function
 * has no timer, and inventing one that only runs while somebody happens to be using the app would be
 * a queue that drains when the ward is busy and stalls overnight. It also holds no secret: an
 * authenticated destination names the ENV BINDING its credential lives in, and the value never
 * enters the record.
 *
 * STATUS: IMPLEMENTED and TESTED against a deterministic in-test server. NOT verified against any
 * real external FHIR endpoint - no partner or sandbox endpoint exists in this environment, and none
 * is pretended to.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, NATIVE_SYSTEM } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { assertPublicHttpsUrl } from "../_connect/onboard/ssrf.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";
import { validateResource } from "./fhir-validate.js";
import { FHIR_TYPE, CANONICAL_TYPE, toFhir } from "./fhir.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const DESTINATION_TYPE = "OutboundDestination";
const DELIVERY_TYPE = "OutboundDelivery";

/** What a delivery can be. Every one of them is a fact about what actually happened. */
const DELIVERY_STATE = Object.freeze({
  QUEUED: "queued",           // written down, nothing attempted
  DELIVERED: "delivered",     // the far end returned 2xx, and its receipt is on the record
  FAILED: "failed",           // an attempt failed; nextAttemptAt says when to try again
  DEAD_LETTER: "dead-letter", // out of attempts; a person looks
  CANCELLED: "cancelled",     // a person stopped it
});

/** How a destination proves who it is. The SECRET never lives in the record - only its binding name. */
const AUTH_KINDS = Object.freeze(["none", "bearer"]);

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;          // 30s, 1m, 2m, 4m ... deliberately not sub-second: a far end
const MAX_BACKOFF_MS = 6 * 3600_000;     // that is down does not want to be hammered awake.
const SEND_TIMEOUT_MS = 15_000;

/** PURE. When to try again after `attempt` failures. Exponential, capped, and never zero. */
function backoffMs(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, n - 1));
}

/** PURE. A destination row. `url` is validated at registration AND again before every send. */
function OutboundDestination(input) {
  const i = input || {};
  return {
    resourceType: DESTINATION_TYPE, id: i.id,
    name: i.name || i.id,
    url: i.url,
    /* Which resource types this destination may be sent. An empty list means NONE: a destination
     * that has not said what it accepts does not receive a discharge summary by default. */
    resourceTypes: Array.isArray(i.resourceTypes) ? [...i.resourceTypes].map(str).filter(Boolean) : [],
    auth: { kind: AUTH_KINDS.includes(str(i.auth && i.auth.kind)) ? str(i.auth.kind) : "none",
      // The NAME of the env binding holding the token. Never the token.
      secretBinding: str(i.auth && i.auth.secretBinding) || null },
    active: i.active !== false,
    createdBy: i.createdBy, createdAt: i.createdAt,
    revokedBy: i.revokedBy || null, revokedAt: i.revokedAt || null, revokedReason: i.revokedReason || null,
    source: { system: NATIVE_SYSTEM, sourceId: `outbound-destination:${i.id}` },
  };
}

/** PURE. One delivery of one resource VERSION to one destination. Append-only; attempts accumulate. */
function OutboundDelivery(input) {
  const i = input || {};
  return {
    resourceType: DELIVERY_TYPE, id: i.id,
    destinationId: i.destinationId, destinationName: i.destinationName || null,
    patientId: i.patientId || null,
    target: { resourceType: i.target && i.target.resourceType, id: i.target && i.target.id, version: i.target && i.target.version, fhirType: i.target && i.target.fhirType },
    state: i.state || DELIVERY_STATE.QUEUED,
    attempts: Array.isArray(i.attempts) ? [...i.attempts] : [],
    nextAttemptAt: i.nextAttemptAt || null,
    deliveredAt: i.deliveredAt || null,
    receipt: i.receipt || null,            // what the far end returned: its status and its own id for the resource
    lastError: i.lastError || null,
    queuedBy: i.queuedBy, queuedAt: i.queuedAt,
    source: { system: NATIVE_SYSTEM, sourceId: `outbound-delivery:${i.id}` },
  };
}

function destinationIdFor(name) { const s = slug(name); return s ? `wsq-outbound-dest-${s}` : null; }
/** ONE RESOURCE VERSION, ONE DELIVERY: the id IS the idempotency key. */
function deliveryIdFor(destinationId, resourceType, id, version) {
  const d = slug(destinationId), t = slug(resourceType), r = slug(id), v = slug(String(version));
  return d && t && r && v ? `wsq-outbound-${d}-${t}-${r}-v${v}` : null;
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need || "record:write", ctx.actorDeps);
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
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/* ---- destinations ----------------------------------------------------------------------------- */

/**
 * Registers where WardSynQ may send. ctx: { migration, name, url, resourceTypes, auth, actorDeps, recordDeps }
 *
 * The URL is checked by the SAME SSRF guard the inbound connectors use - https only, no userinfo, no
 * private/loopback/link-local/metadata address, no localhost/.local/.internal name - at registration
 * AND again immediately before every send, because a record written months ago is not evidence about
 * where that name points today.
 */
async function registerDestination(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const name = str(ctx.name);
  if (!name) return { ...base, ok: false, status: 422, error: "name_required", written: 0 };
  let url;
  try { url = assertPublicHttpsUrl(str(ctx.url), "destination url").href; }
  catch (e) { return { ...base, ok: false, status: 422, error: "bad_destination_url", detail: str(e && e.message), written: 0 }; }

  const types = (Array.isArray(ctx.resourceTypes) ? ctx.resourceTypes : []).map(str).filter(Boolean);
  const unknown = types.filter((t) => !FHIR_TYPE[t] && !CANONICAL_TYPE[t]);
  if (unknown.length) return { ...base, ok: false, status: 422, error: "unknown_resource_type", detail: `this server does not export ${unknown.join(", ")}`, written: 0 };
  if (!types.length) return { ...base, ok: false, status: 422, error: "resource_types_required", detail: "a destination must say what it accepts; a destination that has not said receives nothing", written: 0 };

  const authKind = str(ctx.auth && ctx.auth.kind) || "none";
  if (!AUTH_KINDS.includes(authKind)) return { ...base, ok: false, status: 422, error: "bad_auth_kind", detail: `auth.kind must be one of ${AUTH_KINDS.join(", ")}`, written: 0 };
  const binding = str(ctx.auth && ctx.auth.secretBinding);
  if (authKind === "bearer" && !binding) return { ...base, ok: false, status: 422, error: "secret_binding_required", detail: "name the environment binding the token lives in; the token itself is never stored on the record", written: 0 };
  if (binding && /[^A-Z0-9_]/.test(binding)) return { ...base, ok: false, status: 422, error: "bad_secret_binding", detail: "a binding name is an environment variable name", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = destinationIdFor(name);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  let current = null;
  try { current = await svc.get(DESTINATION_TYPE, id); } catch { current = null; }
  const dest = OutboundDestination({ id, name, url, resourceTypes: types, auth: { kind: authKind, secretBinding: binding || null },
    active: true, createdBy: resolved.actor.id, createdAt: new Date().toISOString() });
  try {
    const out = await svc.put(dest, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, destination: { ...dest, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/** Stops a destination. Nothing queued for it is sent afterwards. Append-only, like every revocation here. */
async function revokeDestination(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const id = destinationIdFor(str(ctx.name));
  const reason = str(ctx.reason);
  if (!id) return { ...base, ok: false, status: 422, error: "name_required", written: 0 };
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this destination is being stopped", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current = null;
  try { current = await svc.get(DESTINATION_TYPE, id); } catch { current = null; }
  if (!current) return { ...base, ok: false, status: 404, error: "destination_not_found", written: 0 };
  if (current.active === false) return { ...base, ok: true, written: 0, skipped: "already_revoked", destination: current };

  const next = OutboundDestination({ ...current, active: false, revokedBy: resolved.actor.id, revokedAt: new Date().toISOString(), revokedReason: reason });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, destination: { ...next, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/** Every destination, with NO secret in the answer - only whether one is configured. */
async function listDestinations(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", destinations: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, destinations: [] };
  let rows;
  try { rows = await svc.list(DESTINATION_TYPE, 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), destinations: [] }; }
  return { ...base, ok: true, destinations: (rows || []).filter(Boolean).map((d) => ({
    id: d.id, name: d.name, url: d.url, resourceTypes: d.resourceTypes, active: d.active !== false,
    // The console needs to know a credential EXISTS and is resolvable, never what it is.
    auth: { kind: d.auth && d.auth.kind, secretBinding: (d.auth && d.auth.secretBinding) || null,
      configured: !(d.auth && d.auth.kind === "bearer") || !!str(env && env[str(d.auth && d.auth.secretBinding)]) },
    createdAt: d.createdAt, revokedAt: d.revokedAt || null, revokedReason: d.revokedReason || null, version: d.version,
  })) };
}

/* ---- queueing --------------------------------------------------------------------------------- */

/**
 * Queues one resource, as it stands now, for one registered destination.
 * ctx: { migration, destination (name), resourceType (canonical), id, actorDeps, recordDeps }
 *
 * The resource is read through the CALLER'S governed read: a clinician who may not see a record
 * cannot cause it to be sent anywhere. It is validated against R4 before it is queued, because a
 * payload that cannot be valid should fail here, in front of the person asking, rather than five
 * retries later against somebody else's server.
 */
async function queueDelivery(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const canonical = str(ctx.resourceType);
  const rid = str(ctx.id);
  if (!canonical || !rid) return { ...base, ok: false, status: 422, error: "resource_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const destId = destinationIdFor(str(ctx.destination));
  let dest = null;
  try { dest = destId ? await svc.get(DESTINATION_TYPE, destId) : null; } catch { dest = null; }
  if (!dest) return { ...base, ok: false, status: 404, error: "destination_not_registered", detail: `"${str(ctx.destination)}" is not a destination this hospital has registered; nothing is sent to an address that is not on the record`, written: 0 };
  if (dest.active === false) return { ...base, ok: false, status: 409, error: "destination_revoked", detail: `${dest.name} was stopped: ${str(dest.revokedReason) || "no reason recorded"}`, written: 0 };
  if (!(dest.resourceTypes || []).includes(canonical) && !(dest.resourceTypes || []).includes(FHIR_TYPE[canonical])) {
    return { ...base, ok: false, status: 409, error: "resource_type_not_accepted", detail: `${dest.name} accepts ${(dest.resourceTypes || []).join(", ") || "nothing"}; it was not registered for ${canonical}`, written: 0 };
  }

  let record;
  try { record = await svc.get(canonical, rid); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", detail: "this actor may not read that record, so it cannot send it", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }
  if (!record) return { ...base, ok: false, status: 404, error: "resource_not_found", written: 0 };

  const payload = toFhir(record);
  if (!payload) return { ...base, ok: false, status: 422, error: "not_exportable", detail: `${canonical} has no FHIR mapping in this server; it is not sent as an approximation of something else`, written: 0 };
  const conformance = validateResource(payload, { profiles: ctx.profiles || null }).issues.filter((i) => i.severity === "error" || i.severity === "fatal");
  if (conformance.length) return { ...base, ok: false, status: 422, error: "payload_invalid", issues: conformance, written: 0 };

  const id = deliveryIdFor(dest.id, canonical, rid, record.version);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  /* ONE RESOURCE VERSION, ONE DELIVERY. Asking twice is the same row - and a row that already
   * delivered is not queued again, which is what stops a double-send at the far end. */
  let existing = null;
  try { existing = await svc.get(DELIVERY_TYPE, id); } catch { existing = null; }
  if (existing) return { ...base, ok: true, written: 0, duplicate: true, delivery: existing,
    note: existing.state === DELIVERY_STATE.DELIVERED ? "this exact version was already delivered to this destination" : "this exact version is already queued for this destination" };

  const delivery = OutboundDelivery({
    id, destinationId: dest.id, destinationName: dest.name,
    patientId: record.resourceType === "Patient" ? record.id : (record.patientId || null),
    target: { resourceType: canonical, id: rid, version: record.version, fhirType: FHIR_TYPE[canonical] || canonical },
    state: DELIVERY_STATE.QUEUED, nextAttemptAt: new Date().toISOString(),
    queuedBy: resolved.actor.id, queuedAt: new Date().toISOString(),
  });
  try {
    const out = await svc.put(delivery, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, delivery: { ...delivery, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/* ---- dispatch --------------------------------------------------------------------------------- */

/** PURE. Is this delivery due to be attempted now? */
function isDue(d, nowMs) {
  if (!d) return false;
  if (d.state !== DELIVERY_STATE.QUEUED && d.state !== DELIVERY_STATE.FAILED) return false;
  const at = Date.parse(str(d.nextAttemptAt));
  return !Number.isFinite(at) || at <= (nowMs || Date.now());
}

/**
 * Sends ONE delivery, once. Returns the next state of the row - it does not write it.
 * `send` is the network call; injected so a test drives a real deterministic server rather than a
 * mock of this function's own logic.
 */
async function attemptDelivery(delivery, send, nowIso) {
  const attemptNo = (delivery.attempts || []).length + 1;
  let result;
  try { result = await send(); }
  catch (e) { result = { ok: false, status: 0, detail: str(e && e.message) || "unreachable" }; }

  const attempt = { at: nowIso, n: attemptNo, status: Number(result && result.status) || 0, ok: !!(result && result.ok), detail: str(result && result.detail) || null };
  const attempts = [...(delivery.attempts || []), attempt];

  if (result && result.ok) {
    return { ...delivery, state: DELIVERY_STATE.DELIVERED, attempts, deliveredAt: nowIso, nextAttemptAt: null, lastError: null,
      /* THE RECEIPT IS WHAT THE FAR END SAID, verbatim-ish: its status, its own Location for the
       * resource when it gave one, and its own id. Nothing here infers delivery from anything but
       * that answer. */
      receipt: { status: attempt.status, location: str(result.location) || null, remoteId: str(result.remoteId) || null, at: nowIso } };
  }
  /* OUT OF ATTEMPTS IS A STATE, NOT A SILENCE. A dead-lettered delivery keeps every attempt and
   * every error, because the question after an incident is "what exactly happened and when". */
  if (attemptNo >= MAX_ATTEMPTS) {
    return { ...delivery, state: DELIVERY_STATE.DEAD_LETTER, attempts, nextAttemptAt: null, lastError: attempt.detail || `HTTP ${attempt.status}` };
  }
  return { ...delivery, state: DELIVERY_STATE.FAILED, attempts,
    nextAttemptAt: new Date(Date.parse(nowIso) + backoffMs(attemptNo)).toISOString(),
    lastError: attempt.detail || `HTTP ${attempt.status}` };
}

/**
 * Drains what is due. ctx: { migration, limit?, now?, fetchImpl?, actorDeps, recordDeps }
 *
 * Called by whatever this hospital uses for a clock; this file schedules nothing itself (see the
 * header). Every send re-reads the destination and RE-VALIDATES its URL, because a destination
 * registered in March is not evidence about where that name points in September.
 */
async function dispatchOutbound(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", attempted: 0 };

  const { svc, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, attempted: 0 };

  let rows;
  try { rows = await svc.list(DELIVERY_TYPE, 500); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), attempted: 0 }; }

  const nowIso = str(ctx.now) || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const due = (rows || []).filter((d) => isDue(d, nowMs)).slice(0, Math.max(1, Math.min(100, Number(ctx.limit) || 25)));
  const baseFetch = ctx.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const safeFetch = baseFetch ? makeSafeFetch(baseFetch) : null;

  const results = [];
  for (const d of due) {
    let dest = null;
    try { dest = await svc.get(DESTINATION_TYPE, d.destinationId); } catch { dest = null; }

    /* A destination that has been stopped, or has vanished, does not receive what was queued before
     * it was stopped. The delivery is cancelled and says why - it is not left queued for ever
     * pretending it is still on its way. */
    if (!dest || dest.active === false) {
      const next = { ...d, state: DELIVERY_STATE.CANCELLED, nextAttemptAt: null,
        lastError: dest ? `destination stopped: ${str(dest.revokedReason) || "no reason recorded"}` : "destination no longer registered" };
      try { const { meta, version, ...rest } = next; await svc.put(rest, { expectedVersion: d.version }); } catch { /* recorded next pass */ }
      results.push({ id: d.id, state: next.state, detail: next.lastError });
      continue;
    }

    // The record as it stands: re-read through the governed store, never a copy cached on the queue.
    let record = null;
    try { record = await svc.get(d.target.resourceType, d.target.id); } catch { record = null; }
    if (!record) {
      const next = { ...d, state: DELIVERY_STATE.CANCELLED, nextAttemptAt: null, lastError: "the resource is no longer readable here" };
      try { const { meta, version, ...rest } = next; await svc.put(rest, { expectedVersion: d.version }); } catch { /* next pass */ }
      results.push({ id: d.id, state: next.state, detail: next.lastError });
      continue;
    }
    const payload = toFhir(record);

    const send = async () => {
      if (!safeFetch) return { ok: false, status: 0, detail: "no fetch available in this environment" };
      let url;
      // RE-VALIDATED on every send, not only at registration.
      try { url = assertPublicHttpsUrl(dest.url, "destination url").href; }
      catch (e) { return { ok: false, status: 0, detail: `destination url is no longer acceptable: ${str(e && e.message)}` }; }
      const headers = { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" };
      if (dest.auth && dest.auth.kind === "bearer") {
        const token = str(env && env[str(dest.auth.secretBinding)]);
        // A destination whose credential is not configured is a FAILED attempt with a plain reason,
        // never an unauthenticated send of clinical data.
        if (!token) return { ok: false, status: 0, detail: `no credential in binding ${str(dest.auth.secretBinding)}; nothing was sent` };
        headers.Authorization = `Bearer ${token}`;
      }
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), SEND_TIMEOUT_MS) : null;
      try {
        const res = await safeFetch(`${url.replace(/\/+$/, "")}/${d.target.fhirType}`, {
          method: "POST", headers, body: JSON.stringify(payload), ...(controller ? { signal: controller.signal } : {}) });
        const location = res.headers && typeof res.headers.get === "function" ? str(res.headers.get("location")) : "";
        let remoteId = null;
        try { const body = await res.clone().json(); remoteId = str(body && body.id) || null; } catch { remoteId = null; }
        if (!res.ok) {
          let detail = `the destination answered ${res.status}`;
          try { const t = (await res.clone().text()).slice(0, 300); if (t) detail += `: ${t}`; } catch { /* body unreadable */ }
          return { ok: false, status: res.status, detail };
        }
        return { ok: true, status: res.status, location, remoteId };
      } catch (e) {
        return { ok: false, status: 0, detail: str(e && e.message) || "unreachable" };
      } finally { if (timer) clearTimeout(timer); }
    };

    const next = await attemptDelivery(d, send, nowIso);
    try {
      const { meta, version, ...rest } = next;
      await svc.put(rest, { expectedVersion: d.version });
    } catch (e) { results.push({ id: d.id, state: "not-recorded", detail: str(e && e.message) }); continue; }
    results.push({ id: d.id, state: next.state, attempts: next.attempts.length, detail: next.lastError || null, nextAttemptAt: next.nextAttemptAt });
  }

  return { ...base, ok: true, attempted: results.length, due: due.length, results };
}

/** The queue as it stands: what is waiting, what went out, what gave up. ctx: { migration, state? } */
async function listDeliveries(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", deliveries: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, deliveries: [] };
  let rows;
  try { rows = await svc.list(DELIVERY_TYPE, 500); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), deliveries: [] }; }
  const wanted = str(ctx.state);
  const all = (rows || []).filter(Boolean).filter((d) => (wanted ? d.state === wanted : true))
    .sort((a, b) => String(b.queuedAt || "").localeCompare(String(a.queuedAt || "")));
  const counts = {};
  for (const d of (rows || []).filter(Boolean)) counts[d.state] = (counts[d.state] || 0) + 1;
  return { ...base, ok: true, deliveries: all, counts,
    deadLetter: (rows || []).filter((d) => d && d.state === DELIVERY_STATE.DEAD_LETTER).length };
}

/**
 * A person puts a dead-lettered delivery back on the queue. Controlled replay: it is never automatic,
 * it names who did it, and the attempts that already failed stay on the record behind it.
 * ctx: { migration, deliveryId, reason, actorDeps, recordDeps }
 */
async function replayDelivery(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const id = str(ctx.deliveryId);
  const reason = str(ctx.reason);
  if (!id) return { ...base, ok: false, status: 422, error: "delivery_required", written: 0 };
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this is being sent again", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current = null;
  try { current = await svc.get(DELIVERY_TYPE, id); } catch { current = null; }
  if (!current) return { ...base, ok: false, status: 404, error: "delivery_not_found", written: 0 };
  if (current.state === DELIVERY_STATE.DELIVERED) return { ...base, ok: false, status: 409, error: "already_delivered", detail: "this version already reached the destination; sending it again would be a second copy there", written: 0 };

  const next = { ...current, state: DELIVERY_STATE.QUEUED, nextAttemptAt: new Date().toISOString(),
    attempts: [...(current.attempts || []), { at: new Date().toISOString(), n: (current.attempts || []).length + 1, status: 0, ok: false, detail: `re-queued by ${resolved.actor.id}: ${reason}`, replay: true }] };
  try {
    const { meta, version, ...rest } = next;
    const out = await svc.put(rest, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, delivery: { ...rest, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

export {
  DESTINATION_TYPE, DELIVERY_TYPE, DELIVERY_STATE, AUTH_KINDS, MAX_ATTEMPTS, BASE_BACKOFF_MS, MAX_BACKOFF_MS,
  OutboundDestination, OutboundDelivery, destinationIdFor, deliveryIdFor, backoffMs, isDue, attemptDelivery,
  registerDestination, revokeDestination, listDestinations, queueDelivery, dispatchOutbound, listDeliveries, replayDelivery,
};
