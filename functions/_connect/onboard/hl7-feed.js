// functions/_connect/onboard/hl7-feed.js — Self-Service EMR Onboarding, Increment 3: the HL7 v2 feed path.
// The wizard REGISTERS an inbound feed that a hospital's integration engine (Mirth/Rhapsody/...) POSTs HL7 v2
// messages to; the ALREADY-BUILT Track-B HMAC-gated ingest spine (functions/_connect/ingest.js) verifies +
// parses + normalizes each message. We only CREATE / LIST / REVOKE feeds here — we do NOT reimplement ingest.
//
// A feed is a connect_feed row for THIS tenant with connector_id = 'hl7v2'. The per-feed HMAC secret is
// server-generated (32 bytes CSPRNG), envelope-sealed at rest (secret_sealed, via secrets.js), shown ONCE on
// create and NEVER returned again (list omits it). Auth to the feed is the EXISTING mechanism: per-feed
// HMAC-SHA256 over `${timestamp}.${rawBody}`, constant-time compared + replay-guarded by the spine. Revoke
// DELETEs the row (erasing the sealed secret with it), after which the spine rejects that feed.
//
// Server-derived identity + fail-closed RBAC (reuses the Track-D guard): create/delete = connector:write
// (owner/admin), list = connector:read. Audit is PHI-free by construction (the audit ALLOW filter drops
// anything but ids/counts) and NEVER carries the secret or any raw HL7. Mirrors store.js / csv-upload.js.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { OnboardError } from "./errors.js";

const HL7_KIND = "hl7v2";
// The REAL Track-B ingest endpoint an HL7 feed POSTs to (functions/api/connect/[[path]].js -> handleFeedIngest).
const INGEST_PATH = "/api/connect/ingress/hl7";
// The SCCM scope an HL7 v2 event feed may deliver (Patient always; ORU=Observation/DiagnosticReport,
// ADT=Encounter/Condition, MDM=DocumentReference, ...). The spine filters anything outside this per message.
export const HL7_FEED_SCOPE = Object.freeze(["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"]);
// The signed-header contract the hospital must send (shown in the config hint; enforced by the spine).
export const FEED_HEADERS = Object.freeze({ feed: "X-SMD-Feed", timestamp: "X-SMD-Timestamp", signature: "X-SMD-Signature" });

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const now = () => new Date().toISOString();
const audit = (env, deps, tenant, actor, action, outcome, extra) =>
  makeAuditSink(env, deps.db)(Object.assign({ tenantId: tenant.id, actor: actor.id, connectorId: HL7_KIND, action, outcome, ts: now() }, extra || {}));

// 32 bytes of CSPRNG as hex — the shared HMAC secret the hospital signs its posts with.
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Optional allow-list of message types, e.g. ["ORU^R01","ADT^A01"]. Stored as documentation/config; validated
// but not required. (The spine authenticates by HMAC; message-type policy is advisory today.)
function normMsgTypes(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new OnboardError("invalid", "allowedMessageTypes must be an array");
  const out = [];
  for (const t of v) {
    if (!nonEmpty(t)) throw new OnboardError("invalid", "allowedMessageTypes entries must be non-empty strings");
    out.push(String(t).trim().toUpperCase());
  }
  return out.slice(0, 64); // hard cap
}

// Absolute ingest URL from the request origin (prod: https://stewardmd.in/api/connect/ingress/hl7).
function ingestUrl(request) { try { return new URL(request.url).origin + INGEST_PATH; } catch { return INGEST_PATH; } }

// Client-safe projection — NEVER includes secret_sealed / secret_ref or any raw material.
function safeFeedView(row) {
  let c = {}; try { c = JSON.parse(row.config || "{}"); } catch {}
  let msgTypes = []; try { const p = JSON.parse(row.msg_types || "[]"); if (Array.isArray(p)) msgTypes = p; } catch {}
  return {
    feedId: row.feed_id, name: c.name || null, connector: row.connector_id || HL7_KIND,
    allowedMessageTypes: msgTypes,
    status: row.status || null,
    createdAt: c.createdAt || row.created_at || null,
    // Per-feed message-count / last-received telemetry is NOT tracked by the spine today, so it is omitted
    // (not faked). Delivery is observable via the PHI-free connect_audit_event ingest.hl7v2 rows.
  };
}

export async function createFeed(deps, request, env, tenantId, body = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  if (!nonEmpty(body.name)) throw new OnboardError("invalid", "name required");
  const msgTypes = normMsgTypes(body.allowedMessageTypes);

  const secret = randomSecret();
  const sealed = await deps.secrets.seal(secret);            // envelope-encrypted at rest; the raw secret is NEVER stored
  const feedId = (crypto.randomUUID ? crypto.randomUUID() : "feed-" + Math.random().toString(36).slice(2));
  const config = JSON.stringify({ source: "onboard", name: String(body.name).trim(), createdAt: now() });
  await deps.db.prepare(
    "INSERT INTO connect_feed (feed_id,tenant_id,connector_id,secret_ref,secret_sealed,msg_types,granted_scopes,config,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(feedId, tenant.id, HL7_KIND, "inline", sealed, JSON.stringify(msgTypes), JSON.stringify(HL7_FEED_SCOPE), config, "active", now()).run();

  // PHI-free audit: ids are structurally dropped by the ALLOW filter; only a count of allowed types is kept.
  await audit(env, deps, tenant, actor, "connect.onboard.hl7-feed.created", "ok", { resourceCounts: { messageTypes: msgTypes.length } });

  // The secret is shown ONCE here and never again (list omits it; there is no get).
  return { ok: true, feedId, ingestUrl: ingestUrl(request), secret, headers: FEED_HEADERS, allowedMessageTypes: msgTypes };
}

export async function listFeeds(deps, request, env, tenantId) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
  const r = await deps.db.prepare("SELECT * FROM connect_feed WHERE tenant_id=?").bind(tenant.id).all();
  return (r.results || [])
    .filter((row) => String(row.connector_id) === HL7_KIND)
    .filter((row) => { try { return JSON.parse(row.config || "{}").source === "onboard"; } catch { return false; } })
    .map(safeFeedView);
}

export async function deleteFeed(deps, request, env, tenantId, feedId) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  // Fail-closed 404 if the feed is missing / another connector / not this tenant's onboard feed (no cross-tenant leak).
  const r = await deps.db.prepare("SELECT * FROM connect_feed WHERE tenant_id=?").bind(tenant.id).all();
  const row = (r.results || []).find((x) => String(x.feed_id) === String(feedId) && String(x.connector_id) === HL7_KIND);
  let onboard = false; if (row) { try { onboard = JSON.parse(row.config || "{}").source === "onboard"; } catch {} }
  if (!row || !onboard) throw new OnboardError("not-found", "feed not found");
  // Revoke = delete the row, which ERASES the envelope-sealed secret with it. The ingest spine's correlateFeed
  // then returns null, so any further signed POST to this feed is rejected (401). Mirrors store.deleteConnection.
  await deps.db.prepare("DELETE FROM connect_feed WHERE tenant_id=? AND feed_id=?").bind(tenant.id, feedId).run();
  await audit(env, deps, tenant, actor, "connect.onboard.hl7-feed.deleted", "ok", {});
  return { ok: true };
}
