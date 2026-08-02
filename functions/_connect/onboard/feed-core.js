// functions/_connect/onboard/feed-core.js — generic self-service inbound-feed CRUD, shared by the HL7 v2
// feed and the FHIR-push webhook onboarding paths. A "feed" is a connect_feed row for THIS tenant carrying a
// server-generated per-feed HMAC secret (32 bytes CSPRNG), envelope-sealed at rest (secret_sealed), shown
// ONCE on create and NEVER returned again. Auth/replay/normalize live in the SHIPPED ingest spine
// (functions/_connect/ingest.js); we only CREATE / LIST / REVOKE feeds here. The ONLY per-feed-type
// differences are the connector kind, the ingest endpoint, the SCCM scope, an audit-action key, and an
// optional message-type allow-list — everything else (RBAC, envelope-sealed secret, PHI-free audit,
// client-safe projection, revoke-erases-secret) is identical, so both feed types reuse this factory verbatim.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { OnboardError } from "./errors.js";

// The signed-header contract a feed must send (shown in the wizard's config hint; enforced by the spine).
export const FEED_HEADERS = Object.freeze({ feed: "X-SMD-Feed", timestamp: "X-SMD-Timestamp", signature: "X-SMD-Signature" });

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const now = () => new Date().toISOString();

// 32 bytes of CSPRNG as hex — the shared HMAC secret the sender signs its posts with.
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Absolute ingest URL from the request origin (prod: https://stewardmd.in<ingestPath>).
function ingestUrlFor(request, path) { try { return new URL(request.url).origin + path; } catch { return path; } }

// spec = { kind, ingestPath, scope, auditKey }. Returns { createFeed, listFeeds, deleteFeed }.
// createFeed takes an optional normMsgTypes(body.allowedMessageTypes) -> string[] to persist an advisory
// allow-list (HL7 uses it; the resource-typed webhook does not, so it defaults to []).
export function makeFeed(spec) {
  const KIND = spec.kind;
  const audit = (env, deps, tenant, actor, action, outcome, extra) =>
    makeAuditSink(env, deps.db)(Object.assign({ tenantId: tenant.id, actor: actor.id, connectorId: KIND, action, outcome, ts: now() }, extra || {}));

  // Client-safe projection — NEVER includes secret_sealed / secret_ref or any raw material.
  function safeFeedView(row) {
    let c = {}; try { c = JSON.parse(row.config || "{}"); } catch {}
    let msgTypes = []; try { const p = JSON.parse(row.msg_types || "[]"); if (Array.isArray(p)) msgTypes = p; } catch {}
    return {
      feedId: row.feed_id, name: c.name || null, connector: row.connector_id || KIND,
      allowedMessageTypes: msgTypes, status: row.status || null,
      createdAt: c.createdAt || row.created_at || null,
    };
  }

  async function createFeed(deps, request, env, tenantId, body = {}, normMsgTypes) {
    const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
    if (!nonEmpty(body.name)) throw new OnboardError("invalid", "name required");
    const msgTypes = normMsgTypes ? normMsgTypes(body.allowedMessageTypes) : [];

    const secret = randomSecret();
    const sealed = await deps.secrets.seal(secret);            // envelope-encrypted at rest; the raw secret is NEVER stored
    const feedId = (crypto.randomUUID ? crypto.randomUUID() : "feed-" + Math.random().toString(36).slice(2));
    const config = JSON.stringify({ source: "onboard", name: String(body.name).trim(), createdAt: now() });
    await deps.db.prepare(
      "INSERT INTO connect_feed (feed_id,tenant_id,connector_id,secret_ref,secret_sealed,msg_types,granted_scopes,config,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(feedId, tenant.id, KIND, "inline", sealed, JSON.stringify(msgTypes), JSON.stringify(spec.scope), config, "active", now()).run();

    // PHI-free audit: ids are structurally dropped by the ALLOW filter; only a count of allowed types is kept.
    await audit(env, deps, tenant, actor, spec.auditKey + ".created", "ok", { resourceCounts: { messageTypes: msgTypes.length } });

    // The secret is shown ONCE here and never again (list omits it; there is no get).
    return { ok: true, feedId, ingestUrl: ingestUrlFor(request, spec.ingestPath), secret, headers: FEED_HEADERS, allowedMessageTypes: msgTypes };
  }

  async function listFeeds(deps, request, env, tenantId) {
    const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
    const r = await deps.db.prepare("SELECT * FROM connect_feed WHERE tenant_id=?").bind(tenant.id).all();
    return (r.results || [])
      .filter((row) => String(row.connector_id) === KIND)
      .filter((row) => { try { return JSON.parse(row.config || "{}").source === "onboard"; } catch { return false; } })
      .map(safeFeedView);
  }

  async function deleteFeed(deps, request, env, tenantId, feedId) {
    const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
    // Fail-closed 404 if the feed is missing / another connector / not this tenant's onboard feed (no cross-tenant leak).
    const r = await deps.db.prepare("SELECT * FROM connect_feed WHERE tenant_id=?").bind(tenant.id).all();
    const row = (r.results || []).find((x) => String(x.feed_id) === String(feedId) && String(x.connector_id) === KIND);
    let onboard = false; if (row) { try { onboard = JSON.parse(row.config || "{}").source === "onboard"; } catch {} }
    if (!row || !onboard) throw new OnboardError("not-found", "feed not found");
    // Revoke = delete the row, which ERASES the envelope-sealed secret with it. The ingest spine's correlateFeed
    // then returns null, so any further signed POST to this feed is rejected (401).
    await deps.db.prepare("DELETE FROM connect_feed WHERE tenant_id=? AND feed_id=?").bind(tenant.id, feedId).run();
    await audit(env, deps, tenant, actor, spec.auditKey + ".deleted", "ok", {});
    return { ok: true };
  }

  return { createFeed, listFeeds, deleteFeed, safeFeedView };
}
