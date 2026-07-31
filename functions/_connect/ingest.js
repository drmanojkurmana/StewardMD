// functions/_connect/ingest.js — HMAC-gated legacy-feed ingest spine (mirrors abdm/ingress.js).
// Fail-closed order: flag -> verify signature -> replay defense -> correlate(authoritative tenant) ->
// route -> validate/filter/PHI-free-audit -> discard. Inbound push has NO StewardMD actor (identify() is
// never called here); the connect_feed row is the sole tenant/connector/scope source. (Task 7 DUAL-ADVERSARIAL.)
import { flagOn, jsonResponse } from "./testkit.js";
import { validateBundle } from "./canonical/validate.js";
import { hmacPseudonym } from "./audit.js";

export function flagHl7On(env) { return flagOn(env) && String(env && env.CONNECT_HL7_FLAG) === "1"; }   // smd_connect AND smd_connect_hl7

const FRESH_MS = 300_000;
const SCOPE_TO_KEY = { Encounter: "encounters", Condition: "conditions", MedicationStatement: "medications", AllergyIntolerance: "allergies", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };
const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents"];

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function ctEq(a, b) { a = String(a || ""); b = String(b || ""); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const sane = (status) => jsonResponse({ error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "bad_request" }, { status });

export async function feedNonceKey(secret, msgId) { return "connect:feed:nonce:" + (await hmacHex(secret, "nonce." + msgId)); }

export async function correlateFeed(db, feedId) {
  const r = await db.prepare("SELECT * FROM connect_feed WHERE feed_id=?").bind(feedId).all();
  return (r.results || []).find((x) => String(x.feed_id) === String(feedId)) || null;
}

export async function handleFeedIngest(env, deps, request, kind) {
  if (!flagHl7On(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const t0 = (deps.now ? deps.now() : Date.now());
  const h = request.headers;
  const feedId = h.get("X-SMD-Feed"), ts = h.get("X-SMD-Timestamp"), sig = h.get("X-SMD-Signature");
  if (!feedId || !ts || !sig) return sane(401);
  let rawBody; try { rawBody = await request.text(); } catch { return sane(400); }

  // (2) verify signature — fail-closed
  let feed, secret;
  try {
    feed = await correlateFeed(deps.db, feedId);
    if (!feed || String(feed.status) === "disabled") return sane(401);
    secret = await deps.secrets.open(await deps.secrets.get(feed.secret_ref));
    if (!secret) return sane(401);
  } catch { return sane(401); }
  const expected = await hmacHex(secret, ts + "." + rawBody);
  if (!ctEq(expected, sig)) return sane(401);

  // (3) replay defense: freshness + nonce
  const tsn = Number(ts);
  if (!Number.isFinite(tsn) || Math.abs((typeof t0 === "number" ? t0 : Date.now()) - tsn) > FRESH_MS) return sane(401);
  const msgId = h.get("X-SMD-Msg-Id") || (await hmacHex(secret, "body." + rawBody));
  const nonceKey = await feedNonceKey(secret, msgId);
  try { if (deps.kv && (await deps.kv.get(nonceKey))) return jsonResponse({ ok: true, replay: true }, { status: 202 }); } catch { /* KV read miss -> proceed */ }

  // (4) correlate -> authoritative tenant/connector/msg-types (headers are cross-check only)
  const hdrConn = h.get("X-SMD-Connector");
  if (hdrConn && String(hdrConn) !== String(feed.connector_id)) return sane(403);
  if (String(feed.connector_id) !== String(kind)) return sane(403);
  let scope = []; try { scope = JSON.parse(feed.granted_scopes || "[]"); } catch { return sane(403); }

  // (5) route
  const connector = deps.connectors[kind];
  if (!connector) return sane(403);
  const ctx = { tenant: { id: feed.tenant_id, mode: "sandbox", settings: {} }, config: { config: feed.config || "{}", connector_id: feed.connector_id },
    secrets: async () => null, scope, now: () => new Date(typeof t0 === "number" ? t0 : Date.now()), logger: { warn() {}, error() {} }, budget: { maxBytes: 2_000_000, maxSegments: 5000, maxRows: 50_000, maxFieldsPerSegment: 512, maxCell: 100_000 }, audit: () => {} };

  let outcome = "error", counts = {}, warnings = [];
  try {
    const { bundle } = await connector.ingest(ctx, { rawBody, headers: h });
    // (6) validate -> filter -> PHI-free audit -> discard
    const v = validateBundle(bundle);
    if (!v.ok) { outcome = "error"; await writeAudit(env, deps, feed, kind, {}, scope, bundle, t0, outcome); return jsonResponse({ error: "invalid_bundle" }, { status: 422 }); }
    bundle.meta.warnings.push(...v.warnings);
    for (const key of RESOURCE_KEYS) { const type = Object.keys(SCOPE_TO_KEY).find((t) => SCOPE_TO_KEY[t] === key); if (type && !scope.includes(type)) bundle[key] = []; }
    counts = RESOURCE_KEYS.reduce((a, k) => (a[k] = bundle[k].length, a), {});
    warnings = structuralWarnings(bundle.meta.warnings);
    outcome = "ok";
    await writeAudit(env, deps, feed, kind, counts, scope, bundle, t0, outcome);
    // record the nonce only after a clean run
    try { if (deps.kv) await deps.kv.put(nonceKey, "1", { expirationTtl: 600 }); } catch { /* best-effort */ }
    return jsonResponse({ ok: true, accepted: counts, warnings }, { status: 202 });
  } catch (e) {
    try { await writeAudit(env, deps, feed, kind, {}, scope, null, t0, "error"); } catch {}
    return jsonResponse({ error: "ingest_failed" }, { status: 500 });   // sanitized
  }
}

function structuralWarnings(ws) { return (ws || []).slice(0, 50).map((w) => String(w).replace(/'[^']*'/g, "'…'")).filter((v, i, a) => a.indexOf(v) === i); }
async function writeAudit(env, deps, feed, kind, counts, scope, bundle, t0, outcome) {
  if (!deps.audit) return;
  const patientRefHash = bundle && bundle.patient ? await hmacPseudonym(env, feed.tenant_id, bundle.patient.id).catch(() => null) : null;
  await deps.audit({ tenantId: feed.tenant_id, actor: null, connectorId: feed.connector_id, action: "ingest." + kind, resourceCounts: counts, scope, patientRefHash, latencyMs: (deps.now ? deps.now() : Date.now()) - (typeof t0 === "number" ? t0 : 0), outcome, ts: new Date(typeof t0 === "number" ? t0 : Date.now()).toISOString() });
}
