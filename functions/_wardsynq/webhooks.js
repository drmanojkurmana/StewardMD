/* functions/_wardsynq/webhooks.js - P2.13: tenant-scoped webhooks, delivered through the outbox.
 *
 * A THIN NOTIFICATION. A webhook says "encounter.admitted, Encounter/wsq-9f..." and nothing else: no
 * name, no MRN, no test, no value. The receiver comes back through the FHIR API with its own SMART
 * token, where the hospital's grant and the audit trail apply. A URL an administrator typed is exactly
 * where clinical content must never be posted (wardsynq-api-gov.js rule 5).
 *
 * REGISTERED BY AN ADMINISTRATOR. staff.admin at the route AND a clinical actor that may write the
 * record, the same double gate the outbound FHIR destinations use, so a staff-admin role with no
 * clinical standing (hr) cannot point the hospital's events somewhere. Every registration, change,
 * rotation, test and disable is audited in the same append as the change.
 *
 * WHERE IT MAY POINT. https only, no userinfo, no localhost/.local/.internal name, and no address in a
 * private, loopback, link-local, CGNAT, documentation, benchmarking, multicast or metadata range - for
 * an IP literal directly, and for a name EVERY address it resolves to. Checked at registration, at
 * re-enable, and again before EVERY send (a name that was public in March may point inside in
 * September). No redirect is followed. RESIDUAL: the platform's fetch resolves the name again, so a
 * resolver answering differently within those milliseconds is not closed; pinning the address needs a
 * socket API this runtime does not give.
 *
 * THE SECRET. 32 random bytes made here, shown once in the answer that created or rotated it, stored
 * AES-GCM encrypted under the document key, never returned again. No key on the server, no webhook.
 *
 * DELIVERY. webhook-events.js stages a `webhook.event` in the clinical write. The fan-out consumer turns
 * it into one `webhook.deliver` event per subscribed endpoint, so each endpoint retries and dies on the
 * outbox's own backoff without holding the others back. A send is POST, 5 s timeout, signed
 * HMAC-SHA256 over "<timestamp>.<body>". Each attempt writes one log row (status, attempt, response
 * code, and this file's own reason word; never a response body) and the endpoint's failure streak in
 * the same append. A streak of AUTO_DISABLE_FAILURES spanning AUTO_DISABLE_SPAN_MS turns the endpoint
 * off, audited, visible on the Admin screen.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { assertPublicHttpsUrl } from "../_connect/onboard/ssrf.js";
import { VersionConflictError } from "./repository.js";
import { outboxEvent, MAX_ATTEMPTS } from "./outbox.js";
import { docKey, encryptBytes, decryptBytes } from "./documents.js";
import { ENDPOINT_TYPE, TOPIC_EVENT, MAX_ENDPOINTS, EVENT_TYPES, PAYLOAD_FHIR, PAYLOADS, topicFor, subscriptionIdFor } from "./webhook-events.js";

const DELIVERY_TYPE = "_wardsynq_webhook_delivery";
const HEALTH_TYPE = "_wardsynq_webhook_health";
const TOPIC_DELIVER = "webhook.deliver";
const TIMEOUT_MS = 5000;
const DNS_TIMEOUT_MS = 3000;
const AUTO_DISABLE_FAILURES = 10;
const AUTO_DISABLE_SPAN_MS = 30 * 60 * 1000;
const SIGNATURE_TOLERANCE_S = 300;
/* Any RFC 8484 JSON resolver. Injected as deps.resolveHost in tests and by a deployment that has its own. */
const DOH_URL = "https://cloudflare-dns.com/dns-query";

const str = (v) => (v == null ? "" : String(v).trim());
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* ---- addresses ----------------------------------------------------------------------------------- */

function ip4Blocked(h) {
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||             // this network, private, loopback, multicast and reserved
    (a === 100 && b >= 64 && b <= 127) ||                             // CGNAT (and 100.100.100.200 metadata)
    (a === 169 && b === 254) ||                                       // link-local, 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||  // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||                 // IETF (192.0.0.192 metadata), documentation
    (a === 198 && (b === 18 || b === 19)) ||                          // benchmarking
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);   // documentation
}

/** The eight hextets of an IPv6 literal, or null when it is not one. */
function hextets(h) {
  let s = h.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) || []).length > 1) return null;
  const [head, tail] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = tail === undefined ? null : (tail ? tail.split(":") : []);
  const parts = b === null ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  if (parts.length !== 8 || parts.some((x) => x.length > 4)) return null;
  return parts.map((x) => parseInt(x || "0", 16));
}
const v4of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");

function ip6Blocked(h) {
  const x = hextets(h);
  if (!x) return true;
  if (x.slice(0, 6).every((n) => n === 0)) return true;                                   // ::, ::1, IPv4-compatible
  if (x.slice(0, 5).every((n) => n === 0) && x[5] === 0xffff) return ip4Blocked(v4of(x[6], x[7]));   // IPv4-mapped
  if (x[0] === 0x64 && x[1] === 0xff9b && x.slice(2, 6).every((n) => n === 0)) return ip4Blocked(v4of(x[6], x[7]));   // NAT64
  if (x[0] === 0x2002) return ip4Blocked(v4of(x[1], x[2]));                               // 6to4
  if (x[0] === 0x2001 && (x[1] === 0 || x[1] === 0xdb8)) return true;                     // Teredo, documentation
  return (x[0] & 0xfe00) === 0xfc00 || (x[0] & 0xffc0) === 0xfe80 || (x[0] & 0xff00) === 0xff00;   // unique-local, link-local, multicast
}

/** PURE. Whether an address literal is somewhere a webhook may not be sent. Anything unparseable is. */
function addressBlocked(ip) {
  const h = str(ip).replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return ip4Blocked(h);
  if (h.includes(":")) return ip6Blocked(h);
  return true;
}

/** Every A and AAAA address a name resolves to, over DNS-over-HTTPS. Throws when it cannot say. */
async function resolveViaDoh(host, fetchImpl) {
  const f = fetchImpl || fetch;
  const out = [];
  for (const type of ["A", "AAAA"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
    try {
      const res = await f(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: controller.signal, redirect: "manual" });
      if (!res.ok) throw new Error("resolver refused");
      const j = await res.json();
      if (j.Status !== 0 && j.Status !== 3) throw new Error("resolver failed");
      for (const a of j.Answer || []) if (a.type === 1 || a.type === 28) out.push(str(a.data));
    } finally { clearTimeout(timer); }
  }
  return out;
}

/**
 * Whether `url` may receive a webhook now. deps: { resolveHost?(host) -> string[], fetchImpl? }
 * Returns { ok: true, url } or { ok: false, reason, detail }.
 */
async function checkDestination(url, deps) {
  let u;
  try { u = assertPublicHttpsUrl(str(url), "webhook url"); }
  catch (e) { return { ok: false, reason: "blocked-address", detail: str(e && e.message) }; }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return addressBlocked(host) ? { ok: false, reason: "blocked-address", detail: "webhook url is not a public address" } : { ok: true, url: u.href };
  }
  let addresses;
  try { addresses = await (deps && deps.resolveHost ? deps.resolveHost(host) : resolveViaDoh(host, deps && deps.fetchImpl)); }
  catch { return { ok: false, reason: "dns-failed", detail: "the webhook host name could not be resolved, so nothing is sent to it" }; }
  if (!addresses || !addresses.length) return { ok: false, reason: "dns-failed", detail: "the webhook host name does not resolve" };
  if (addresses.some(addressBlocked)) return { ok: false, reason: "blocked-address", detail: "the webhook host name resolves to a private, loopback, link-local or metadata address" };
  return { ok: true, url: u.href };
}

/* ---- signing ------------------------------------------------------------------------------------- */

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The signature header value for one send. */
async function signPayload(secret, timestamp, body) { return `v1=${await hmacHex(secret, `${timestamp}.${body}`)}`; }

/** What a receiver does: recompute, compare in constant time, and refuse a stale timestamp. */
async function verifySignature(secret, timestamp, body, header, nowMs) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs((nowMs || Date.now()) / 1000 - ts) > SIGNATURE_TOLERANCE_S) return false;
  const want = await signPayload(secret, ts, body);
  const got = str(header);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function sealSecret(env, secret) {
  const key = await docKey(env);
  return key ? b64(await encryptBytes(key, new TextEncoder().encode(secret))) : null;
}
async function openSecret(env, sealed) {
  const key = await docKey(env);
  if (!key || !sealed) return null;
  try { return new TextDecoder().decode(await decryptBytes(key, unb64(sealed))); } catch { return null; }
}
const newSecret = () => `whsec_${b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

/* ---- one send ------------------------------------------------------------------------------------ */

/**
 * PURE. The notification body. Ids and the event type only.
 *
 * An endpoint registered with payload "fhir-id-only" is a FHIR Subscription (R4 Subscriptions Backport,
 * rest-hook, id-only) and receives the backport's notification Bundle instead: a history Bundle whose
 * first entry is the SubscriptionStatus Parameters and whose other entries are the focus resource's
 * fullUrl with no resource. The same ids, the same signature headers, the same delivery; only the shape
 * differs. `webhook.test` goes out as a handshake. References are relative to the hospital's FHIR base.
 */
function notificationBody(event, orgId, endpoint) {
  if (endpoint && endpoint.payload === PAYLOAD_FHIR) {
    const test = event.type === "webhook.test";
    const focus = event.resource ? `${event.resource.resourceType}/${event.resource.id}` : null;
    const subscription = `Subscription/${subscriptionIdFor(endpoint.id, test ? (endpoint.eventTypes || [])[0] : event.type)}`;
    return JSON.stringify({
      resourceType: "Bundle", type: "history", timestamp: event.occurredAt,
      entry: [
        { fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: { resourceType: "Parameters", parameter: [
          { name: "subscription", valueReference: { reference: subscription } },
          { name: "topic", valueCanonical: topicFor(test ? (endpoint.eventTypes || [])[0] : event.type) },
          { name: "status", valueCode: "active" },
          { name: "type", valueCode: test ? "handshake" : "event-notification" },
          ...(test || !focus ? [] : [{ name: "notification-event", part: [{ name: "event-number", valueString: event.id }, { name: "timestamp", valueInstant: event.occurredAt }, { name: "focus", valueReference: { reference: focus } }] }]),
        ] }, request: { method: "GET", url: `${subscription}/$status` }, response: { status: "200" } },
        ...(test || !focus ? [] : [{ fullUrl: focus, request: { method: "GET", url: focus }, response: { status: "200" } }]),
      ],
    });
  }
  return JSON.stringify({
    id: event.id, type: event.type, occurredAt: event.occurredAt, hospital: orgId || null,
    resource: event.resource ? { resourceType: event.resource.resourceType, id: event.resource.id } : null,
    note: "No clinical content. Read the resource through the WardSynQ FHIR API with your own SMART token.",
  });
}

/** One POST. Returns { ok, code, reason }: the response code only, never the response body. */
async function sendOnce(endpoint, secret, event, deps) {
  const dest = await checkDestination(endpoint.url, deps);
  if (!dest.ok) return { ok: false, code: 0, reason: dest.reason };
  const body = notificationBody(event, deps.orgId, endpoint);
  const timestamp = Math.floor((deps.nowMs || Date.now()) / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || TIMEOUT_MS);
  let res;
  try {
    res = await (deps.fetchImpl || fetch)(dest.url, {
      method: "POST", redirect: "manual", signal: controller.signal, body,
      headers: { "Content-Type": endpoint.payload === PAYLOAD_FHIR ? "application/fhir+json" : "application/json", "User-Agent": "WardSynQ-Webhooks/1", "X-WardSynQ-Event-Id": event.id, "X-WardSynQ-Event-Type": event.type,
        "X-WardSynQ-Timestamp": String(timestamp), "X-WardSynQ-Signature": await signPayload(secret, timestamp, body) },
    });
  } catch (e) {
    return { ok: false, code: 0, reason: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally { clearTimeout(timer); }
  try { if (res.body && typeof res.body.cancel === "function") await res.body.cancel(); } catch { /* the body is never read */ }
  const code = Number(res.status) || 0;
  if (res.type === "opaqueredirect" || (code >= 300 && code < 400)) return { ok: false, code, reason: "redirect-not-followed" };
  return code >= 200 && code < 300 ? { ok: true, code, reason: null } : { ok: false, code, reason: "http-error" };
}

/* ---- records ------------------------------------------------------------------------------------- */

const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-webhooks", action, outcome: "ok", scope });
const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };

/** PURE. What a screen may see of an endpoint. Never the secret. */
function summaryOf(ep, health) {
  const h = health || {};
  return {
    id: ep.id, url: ep.url, description: ep.description || null, eventTypes: ep.eventTypes || [], active: ep.active === true, payload: ep.payload || "wardsynq",
    status: ep.active === true ? "active" : ep.status === "auto-disabled" ? "auto-disabled" : "disabled",
    disabledAt: ep.disabledAt || null, disabledReason: ep.disabledReason || null,
    createdAt: ep.createdAt, createdBy: ep.createdBy, secretSetAt: ep.secretSetAt, version: ep.version,
    consecutiveFailures: h.consecutiveFailures || 0, failingSince: h.failingSince || null,
    lastAttemptAt: h.lastAttemptAt || null, lastResponseCode: h.lastResponseCode == null ? null : h.lastResponseCode, lastOk: h.lastOk == null ? null : h.lastOk,
  };
}

/**
 * One attempt, written down: the log row and the endpoint's failure streak in ONE append, then an
 * auto-disable when the streak is sustained. Returns the log row.
 */
async function recordAttempt(deps, ep, entry) {
  const repo = deps.repository, tenantId = deps.tenantId;
  const nowMs = deps.nowMs || Date.now(), at = new Date(nowMs).toISOString();
  const by = { id: "system:webhooks", kind: "service", at };
  const row = { resourceType: DELIVERY_TYPE, id: entry.logId, version: 1, endpointId: ep.id, eventId: entry.eventId, eventType: entry.eventType,
    attempt: entry.attempt, status: entry.status, responseCode: entry.responseCode, reason: entry.reason || null, test: !!entry.test, at, writtenBy: by };
  let health = null;
  for (let i = 0; i < 3; i++) {
    const cur = await repo.latest(tenantId, HEALTH_TYPE, ep.id);
    const counts = !entry.test && (entry.status === "delivered" || entry.status === "failed" || entry.status === "dead");
    const ok = entry.status === "delivered";
    const next = counts ? {
      resourceType: HEALTH_TYPE, id: ep.id, version: cur ? cur.version + 1 : 1, lastAttemptAt: at, lastResponseCode: entry.responseCode, lastOk: ok,
      consecutiveFailures: ok ? 0 : ((cur && cur.consecutiveFailures) || 0) + 1, failingSince: ok ? null : (cur && cur.failingSince) || at, writtenBy: by,
    } : null;
    try { await repo.append(tenantId, next ? [row, next] : [row], {}); health = next; break; }
    catch (e) {
      if (!(e instanceof VersionConflictError)) throw e;
      if (await repo.latest(tenantId, DELIVERY_TYPE, row.id)) return row;   // this attempt was already recorded
    }
  }
  if (health && !health.lastOk && ep.active === true && health.consecutiveFailures >= AUTO_DISABLE_FAILURES && nowMs - Date.parse(health.failingSince) >= AUTO_DISABLE_SPAN_MS) {
    const minutes = Math.round((nowMs - Date.parse(health.failingSince)) / 60000);
    const off = { ...ep, version: ep.version + 1, active: false, status: "auto-disabled", disabledAt: at, disabledBy: "system:webhooks",
      disabledReason: `${health.consecutiveFailures} deliveries in a row failed over ${minutes} minutes`, writtenBy: by };
    try { await repo.append(tenantId, [off], { audit: auditEvent("webhook.auto-disable", "system:webhooks", { webhookId: ep.id, host: hostOf(ep.url), failures: health.consecutiveFailures, minutes }) }); }
    catch (e) { if (!(e instanceof VersionConflictError)) throw e; }   // changed by an administrator meanwhile; the next failure decides
  }
  return row;
}

/* ---- outbox consumers ---------------------------------------------------------------------------- */

/** webhook.event -> one webhook.deliver per subscribed active endpoint, in one append. */
async function fanOut(deps, payload, event) {
  const repo = deps.repository, tenantId = deps.tenantId;
  const type = str(payload && payload.type);
  const eps = ((await repo.latestByType(tenantId, ENDPOINT_TYPE, MAX_ENDPOINTS * 5)) || []).filter((e) => e && e.active === true && (e.eventTypes || []).includes(type));
  if (!eps.length) return;
  const at = new Date(deps.nowMs || Date.now()).toISOString();
  const notice = { id: event.id, type, occurredAt: payload.occurredAt, resource: payload.resource || null };
  // A deterministic id per (event, endpoint): a fan-out re-run after a crash conflicts instead of doubling.
  const rows = eps.map((ep) => ({ ...outboxEvent(TOPIC_DELIVER, { endpointId: ep.id, event: notice }, at), id: `evt-wh-${event.id}-${ep.id}` }));
  try { await repo.append(tenantId, rows, {}); }
  catch (e) { if (!(e instanceof VersionConflictError)) throw e; }
}

/** webhook.deliver -> one attempt. Throws on failure so the outbox retries it, and marks it dead after MAX_ATTEMPTS. */
async function deliverOne(deps, payload, event) {
  const repo = deps.repository, tenantId = deps.tenantId;
  const notice = payload.event || {};
  const attempt = ((event && event.attempts) || 0) + 1;
  const ep = await repo.latest(tenantId, ENDPOINT_TYPE, str(payload.endpointId));
  const entry = { logId: `whd-${str(payload.endpointId)}-${notice.id}-a${attempt}`, eventId: notice.id, eventType: notice.type, attempt };
  if (!ep) return;
  if (ep.active !== true || !(ep.eventTypes || []).includes(notice.type)) {
    await recordAttempt(deps, ep, { ...entry, status: "skipped", responseCode: null, reason: ep.active === true ? "not-subscribed" : "endpoint-disabled" });
    return;
  }
  const secret = await openSecret(deps.env, ep.secretEnc);
  const result = secret ? await sendOnce(ep, secret, notice, deps) : { ok: false, code: 0, reason: "no-key" };
  const status = result.ok ? "delivered" : attempt >= MAX_ATTEMPTS ? "dead" : "failed";
  await recordAttempt(deps, ep, { ...entry, status, responseCode: result.code, reason: result.reason });
  if (!result.ok) throw new Error(`webhook ${ep.id} attempt ${attempt}: ${result.reason}${result.code ? " " + result.code : ""}`);
}

/** The consumers ops-tick runs for one hospital. deps: { repository, tenantId, env, orgId, fetchImpl?, resolveHost?, nowMs? } */
function webhookConsumers(deps) {
  return {
    [TOPIC_EVENT]: { "webhook-fanout": (payload, event) => fanOut(deps, payload, event) },
    [TOPIC_DELIVER]: { "webhook-send": (payload, event) => deliverOne(deps, payload, event) },
  };
}

/* ---- the administrator's routes ------------------------------------------------------------------ */

async function open(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
    return { actorId: r.actor.id, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}

function eventTypesFrom(v) {
  const list = [...new Set((Array.isArray(v) ? v : []).map(str).filter(Boolean))];
  const unknown = list.filter((t) => !EVENT_TYPES[t]);
  if (unknown.length) return { error: { ok: false, status: 422, error: "unknown_event_type", message: `Not an event this server sends: ${unknown.join(", ")}.` } };
  if (!list.length) return { error: { ok: false, status: 422, error: "event_types_required", message: "Choose at least one event." } };
  return { types: list.sort() };
}

const badPayload = { ok: false, status: 422, error: "unknown_payload", message: "The payload must be wardsynq (thin JSON) or fhir-id-only (FHIR Subscription notification)." };
const readFailed = { ok: false, status: 502, error: "record_read_failed", message: "The webhook could not be read, so nothing was changed." };
const writeFailed = (e) => e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This webhook changed at the same moment. Reload and try again; nothing was saved." }
  : { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };

/** ctx: { migration, actorDeps, recordDeps, env, url, eventTypes, description?, resolveHost?, fetchImpl? } */
async function registerWebhook(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const { types, error } = eventTypesFrom(ctx.eventTypes);
  if (error) return error;
  const payload = ctx.payload === undefined || ctx.payload === null || ctx.payload === "" ? "wardsynq" : str(ctx.payload);
  if (!PAYLOADS.includes(payload)) return badPayload;
  const dest = await checkDestination(ctx.url, ctx);
  if (!dest.ok) return { ok: false, status: 422, error: dest.reason === "dns-failed" ? "url_unresolvable" : "url_refused", message: dest.detail };
  let existing;
  try { existing = (await who.repo.latestByType(who.tenantId, ENDPOINT_TYPE, MAX_ENDPOINTS * 5)) || []; } catch { return readFailed; }
  if (existing.length >= MAX_ENDPOINTS) return { ok: false, status: 409, error: "too_many_webhooks", message: `A hospital may register ${MAX_ENDPOINTS} webhooks.` };
  const secret = newSecret();
  const secretEnc = await sealSecret(env, secret);
  if (!secretEnc) return { ok: false, status: 503, error: "webhook_key_not_configured", message: "Webhook secrets cannot be stored encrypted on this server, so no webhook was registered." };
  const at = new Date().toISOString();
  const ep = { resourceType: ENDPOINT_TYPE, id: `wh-${randomHex(8)}`, version: 1, url: dest.url, description: str(ctx.description).slice(0, 120) || null, eventTypes: types, payload,
    active: true, status: "active", secretEnc, secretSetAt: at, createdAt: at, createdBy: who.actorId, writtenBy: { id: who.actorId, kind: "human", at } };
  try { await who.repo.append(who.tenantId, [ep], { audit: auditEvent("webhook.register", who.actorId, { webhookId: ep.id, host: hostOf(ep.url), eventTypes: types, payload }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, webhook: summaryOf(ep), secret, secretNote: "Copy this secret now. It is not shown again." };
}

async function loadEndpoint(who, id) {
  try { return { ep: await who.repo.latest(who.tenantId, ENDPOINT_TYPE, str(id)) }; } catch { return { error: readFailed }; }
}
const notFound = { ok: false, status: 404, error: "webhook_not_found", message: "No such webhook at this hospital." };

/** ctx: { ..., id, eventTypes?, active? }. Turning one off is a disable; turning it on re-checks the address and clears the streak. */
async function updateWebhook(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const { ep, error } = await loadEndpoint(who, ctx.id);
  if (error) return error;
  if (!ep) return notFound;
  const next = { ...ep, version: ep.version + 1 };
  const changes = {};
  if (ctx.eventTypes !== undefined) {
    const t = eventTypesFrom(ctx.eventTypes);
    if (t.error) return t.error;
    if (t.types.join() !== (ep.eventTypes || []).join()) { changes.eventTypes = { from: ep.eventTypes, to: t.types }; next.eventTypes = t.types; }
  }
  if (ctx.payload !== undefined && ctx.payload !== null && str(ctx.payload) !== (ep.payload || "wardsynq")) {
    if (!PAYLOADS.includes(str(ctx.payload))) return badPayload;
    changes.payload = { from: ep.payload || "wardsynq", to: str(ctx.payload) }; next.payload = str(ctx.payload);
  }
  if (typeof ctx.active === "boolean" && ctx.active !== (ep.active === true)) {
    changes.active = ctx.active;
    const at = new Date().toISOString();
    if (ctx.active) {
      const dest = await checkDestination(ep.url, ctx);
      if (!dest.ok) return { ok: false, status: 422, error: "url_refused", message: `Not turned on: ${dest.detail}` };
      Object.assign(next, { active: true, status: "active", disabledAt: null, disabledBy: null, disabledReason: null });
    } else {
      Object.assign(next, { active: false, status: "disabled", disabledAt: at, disabledBy: who.actorId, disabledReason: str(ctx.reason).slice(0, 200) || "turned off by an administrator" });
    }
  }
  if (!Object.keys(changes).length) return { ok: true, unchanged: true, webhook: summaryOf(ep) };
  next.writtenBy = { id: who.actorId, kind: "human", at: new Date().toISOString() };
  const records = [next];
  if (changes.active === true) {
    const h = await who.repo.latest(who.tenantId, HEALTH_TYPE, ep.id).catch(() => undefined);
    if (h === undefined) return readFailed;
    if (h && h.consecutiveFailures) records.push({ ...h, version: h.version + 1, consecutiveFailures: 0, failingSince: null, writtenBy: next.writtenBy });
  }
  const action = changes.active === false ? "webhook.disable" : changes.active === true ? "webhook.enable" : "webhook.update";
  try { await who.repo.append(who.tenantId, records, { audit: auditEvent(action, who.actorId, { webhookId: ep.id, host: hostOf(ep.url), ...changes }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, webhook: summaryOf(next, records[1] || null) };
}

/** ctx: { ..., id }. A new secret, shown once; the old one stops verifying at once. */
async function rotateWebhookSecret(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const { ep, error } = await loadEndpoint(who, ctx.id);
  if (error) return error;
  if (!ep) return notFound;
  const secret = newSecret();
  const secretEnc = await sealSecret(env, secret);
  if (!secretEnc) return { ok: false, status: 503, error: "webhook_key_not_configured", message: "The new secret cannot be stored encrypted on this server, so the secret was not changed." };
  const at = new Date().toISOString();
  const next = { ...ep, version: ep.version + 1, secretEnc, secretSetAt: at, writtenBy: { id: who.actorId, kind: "human", at } };
  try { await who.repo.append(who.tenantId, [next], { audit: auditEvent("webhook.rotate", who.actorId, { webhookId: ep.id, host: hostOf(ep.url) }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, webhook: summaryOf(next), secret, secretNote: "Copy this secret now. It is not shown again. The previous secret no longer verifies." };
}

/** ctx: { ..., id, orgId }. One signed webhook.test, sent now, once, and logged. Not counted towards auto-disable. */
async function testWebhook(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const { ep, error } = await loadEndpoint(who, ctx.id);
  if (error) return error;
  if (!ep) return notFound;
  const secret = await openSecret(env, ep.secretEnc);
  if (!secret) return { ok: false, status: 503, error: "webhook_key_not_configured", message: "The signing secret cannot be read on this server, so no test was sent." };
  const notice = { id: `evt-test-${randomHex(8)}`, type: "webhook.test", occurredAt: new Date().toISOString(), resource: null };
  const deps = { ...ctx, repository: who.repo, tenantId: who.tenantId, env };
  const result = await sendOnce(ep, secret, notice, deps);
  const status = result.ok ? "delivered" : "failed";
  try {
    await recordAttempt(deps, ep, { logId: `whd-${ep.id}-${notice.id}-a1`, eventId: notice.id, eventType: notice.type, attempt: 1, status, responseCode: result.code, reason: result.reason, test: true });
    await who.repo.auditOnly(who.tenantId, auditEvent("webhook.test", who.actorId, { webhookId: ep.id, host: hostOf(ep.url), status, responseCode: result.code }));
  } catch { return { ok: false, status: 502, error: "record_write_failed", message: `The test was ${result.ok ? "delivered" : "not delivered"} but could not be logged.`, responseCode: result.code }; }
  if (!result.ok) return { ok: false, status: 502, error: "test_not_delivered", message: `The test event was not delivered (${result.reason}${result.code ? ", response " + result.code : ""}).`, responseCode: result.code, reason: result.reason };
  return { ok: true, delivered: true, responseCode: result.code, eventId: notice.id };
}

/** ctx: { migration, actorDeps, recordDeps, env }. Every endpoint with its health, the event catalogue, and whether secrets can be stored. */
async function listWebhooks(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  let eps, health;
  try {
    [eps, health] = await Promise.all([who.repo.latestByType(who.tenantId, ENDPOINT_TYPE, MAX_ENDPOINTS * 5), who.repo.latestByType(who.tenantId, HEALTH_TYPE, MAX_ENDPOINTS * 5)]);
  } catch { return { ok: false, status: 502, error: "record_read_failed", message: "The webhook list could not be read." }; }
  const byId = new Map((health || []).map((h) => [h.id, h]));
  return {
    ok: true, keyConfigured: !!(await docKey(env)), eventTypes: Object.entries(EVENT_TYPES).map(([id, label]) => ({ id, label })),
    webhooks: (eps || []).map((e) => summaryOf(e, byId.get(e.id))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

/** ctx: { ..., id }. The newest 50 attempts for one endpoint. */
async function listWebhookDeliveries(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const { ep, error } = await loadEndpoint(who, ctx.id);
  if (error) return error;
  if (!ep) return notFound;
  let rows;
  // ponytail: newest 1000 attempts across the hospital, filtered here; a per-endpoint index if a hospital outgrows it.
  try { rows = await who.repo.latestByType(who.tenantId, DELIVERY_TYPE, 1000, { newest: true }); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The delivery log could not be read." }; }
  return { ok: true, webhookId: ep.id, deliveries: (rows || []).filter((r) => r.endpointId === ep.id).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50)
    .map((r) => ({ at: r.at, eventId: r.eventId, eventType: r.eventType, attempt: r.attempt, status: r.status, responseCode: r.responseCode, reason: r.reason, test: r.test })) };
}

export {
  DELIVERY_TYPE, HEALTH_TYPE, TOPIC_DELIVER, TIMEOUT_MS, AUTO_DISABLE_FAILURES, AUTO_DISABLE_SPAN_MS,
  addressBlocked, checkDestination, signPayload, verifySignature, notificationBody, sendOnce, summaryOf,
  fanOut, deliverOne, webhookConsumers,
  registerWebhook, updateWebhook, rotateWebhookSecret, testWebhook, listWebhooks, listWebhookDeliveries,
};
