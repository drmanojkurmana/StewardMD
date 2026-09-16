/* functions/_wardsynq/connectors.js - owner S2, S4, S5: a hospital plugs in ITS OWN imaging archive,
 * payers and payment gateway.
 *
 * WardSynQ is sold to many hospitals and each brings different vendors, so no vendor is in domain
 * logic. A CONNECTOR is one per-hospital record: which adapter (a provider this build ships), its
 * non-secret settings, and its credentials sealed. The adapters live beside this file (dicomweb.js,
 * payer-connectors.js, payment-gateways.js) and declare the fields they need; the Admin screen is
 * drawn from that declaration, so a field the server would refuse is never offered.
 *
 * CREDENTIALS. Typed in once on Admin > Integrations, sealed AES-GCM under the document key exactly as
 * webhook secrets are (webhooks.js sealSecret), stored on the record, and never returned by any route:
 * a screen learns only WHICH secrets are set and when. Replacing one is a rotation, audited as such.
 * Opened only at the moment an adapter needs it. No document key on the server, nothing is saved.
 *
 * WHO. staff.admin at the route AND a clinical actor that may write the record, the webhooks' double
 * gate, so hr (staff.admin without clinical standing) is refused. Every create, change, rotation,
 * enable, disable and test is audited in the same append as the change, naming keys and hosts, never
 * a secret value.
 *
 * WHERE. Every URL setting passes the webhooks' destination rules at save (https, no userinfo, no
 * private/loopback/link-local/metadata address, for an IP and for every address a name resolves to),
 * and the adapter checks again before each call.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";
import { docKey } from "./documents.js";
import { sealSecret, openSecret, checkDestination } from "./webhooks.js";
import { DICOM_KIND } from "./dicomweb.js";
import { PAYER_KIND } from "./payer-connectors.js";
import { PAYMENT_KIND } from "./payment-gateways.js";
import { ABDM_KIND } from "./abdm-hospital.js";
import { WHATSAPP_KIND } from "./patient-messaging.js";
import { BACKUP_KIND } from "./backup-destinations.js";
import { EINVOICE_KIND } from "./einvoice-irp.js";

const CONNECTOR_TYPE = "_wardsynq_connector";
const MAX_CONNECTORS = 100;

/* kind -> { label, singleton, providers: { id -> { label, settings[], secrets[], validate?, test? } } }
 * validate(settings, secretsPresent, { org, previous }): previous is the saved settings of the same provider, or null. */
const KINDS = Object.freeze({ payment: PAYMENT_KIND, payer: PAYER_KIND, dicom: DICOM_KIND, abdm: ABDM_KIND, whatsapp: WHATSAPP_KIND, backup: BACKUP_KIND, einvoice: EINVOICE_KIND });

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** PURE. What a screen may see of a connector. Never a secret, sealed or open. */
function summaryOf(rec) {
  return {
    id: rec.id, kind: rec.kind, provider: rec.provider, name: rec.name || null, settings: rec.settings || {},
    secretsSet: Object.keys(rec.secretsEnc || {}).sort(), secretsSetAt: rec.secretsSetAt || null,
    active: rec.active === true, version: rec.version, updatedAt: rec.writtenBy && rec.writtenBy.at, updatedBy: rec.writtenBy && rec.writtenBy.id,
  };
}

/** PURE. The catalogue a screen draws its forms from. */
function catalogue() {
  return Object.entries(KINDS).map(([kind, k]) => ({
    kind, label: k.label, singleton: !!k.singleton, help: k.help || null,
    providers: Object.entries(k.providers).map(([id, p]) => ({ id, label: p.label, help: p.help || null, settings: p.settings, secrets: p.secrets, testable: typeof p.test === "function" })),
  }));
}

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

const readFailed = { ok: false, status: 502, error: "record_read_failed", message: "The connector could not be read, so nothing was changed." };
const writeFailed = (e) => e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This connector changed at the same moment. Reload and try again; nothing was saved." }
  : { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };
const refuse = (error, message) => ({ ok: false, status: 422, error, message });
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-connectors", action, outcome: "ok", scope });

/** PURE. Declared settings only, typed. Unknown keys are dropped, never stored. */
function settingsFrom(spec, raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const f of spec.settings) {
    const v = r[f.key];
    if (f.type === "checkbox") { out[f.key] = v === true; continue; }
    const s = str(v).slice(0, 500);
    if (!s) continue;
    if (f.type === "select" && !(f.options || []).some((o) => o[0] === s)) return { error: refuse("bad_setting", `${f.label} must be one of: ${(f.options || []).map((o) => o[1]).join(", ")}.`) };
    out[f.key] = s;
  }
  const missing = spec.settings.filter((f) => f.required && f.type !== "checkbox" && !out[f.key]).map((f) => f.label);
  if (missing.length) return { error: refuse("settings_required", `Required: ${missing.join(", ")}.`) };
  return { settings: out };
}

/**
 * Create or change a connector. ctx: { kind, provider, name?, settings, secrets?, active?, id?, resolveHost?, fetchImpl? }
 * A singleton kind has one connector (id = kind). Otherwise the id is `<kind>-<slug(settings.ref)>`.
 */
async function saveConnector(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const kind = KINDS[str(ctx.kind)];
  if (!kind) return refuse("unknown_kind", "Not a kind of connector this server has.");
  const spec = kind.providers[str(ctx.provider)];
  if (!spec) return refuse("unknown_provider", `Not a ${kind.label} provider this server has.`);
  const s = settingsFrom(spec, ctx.settings);
  if (s.error) return s.error;
  const id = kind.singleton ? str(ctx.kind) : `${str(ctx.kind)}-${slug(s.settings.ref || ctx.id)}`;
  if (!kind.singleton && id === `${str(ctx.kind)}-`) return refuse("ref_required", "Give this connector a short reference.");
  for (const f of spec.settings.filter((x) => x.type === "url" && s.settings[x.key])) {
    const dest = await checkDestination(s.settings[f.key], ctx);
    if (!dest.ok) return refuse(dest.reason === "dns-failed" ? "url_unresolvable" : "url_refused", `${f.label}: ${dest.detail}`);
  }

  let cur;
  try { cur = await who.repo.latest(who.tenantId, CONNECTOR_TYPE, id); } catch { return readFailed; }
  if (!cur) {
    let all;
    try { all = (await who.repo.latestByType(who.tenantId, CONNECTOR_TYPE, MAX_CONNECTORS * 2)) || []; } catch { return readFailed; }
    if (all.length >= MAX_CONNECTORS) return { ok: false, status: 409, error: "too_many_connectors", message: `A hospital may keep ${MAX_CONNECTORS} connectors.` };
  }
  const supplied = {};
  for (const f of spec.secrets) { const v = str(ctx.secrets && ctx.secrets[f.key]); if (v) supplied[f.key] = v; }
  // A different provider's credentials are not these credentials: switching provider keeps none, so each validate() asks again.
  const kept = cur && cur.provider === str(ctx.provider) ? { ...(cur.secretsEnc || {}) } : {};
  for (const k of Object.keys(kept)) if (!spec.secrets.some((f) => f.key === k)) delete kept[k];
  const invalid = spec.validate ? spec.validate(s.settings, { ...Object.fromEntries(Object.keys(kept).map((k) => [k, true])), ...supplied },
    { org: ctx.org || null, previous: cur && cur.provider === str(ctx.provider) ? cur.settings || {} : null }) : null;
  if (invalid) return refuse("invalid_connector", invalid);

  const sealed = { ...kept };
  if (Object.keys(supplied).length) {
    if (!(await docKey(env))) return { ok: false, status: 503, error: "connector_key_not_configured", message: "Credentials cannot be stored encrypted on this server, so nothing was saved." };
    for (const [k, v] of Object.entries(supplied)) {
      const enc = await sealSecret(env, v);
      if (!enc) return { ok: false, status: 503, error: "connector_key_not_configured", message: "Credentials cannot be stored encrypted on this server, so nothing was saved." };
      sealed[k] = enc;
    }
  }

  const at = new Date().toISOString();
  const active = typeof ctx.active === "boolean" ? ctx.active : (cur ? cur.active === true : true);
  const next = {
    resourceType: CONNECTOR_TYPE, id, version: cur ? cur.version + 1 : 1, kind: str(ctx.kind), provider: str(ctx.provider),
    name: str(ctx.name).slice(0, 120) || null, settings: s.settings, secretsEnc: sealed,
    secretsSetAt: Object.keys(supplied).length ? at : (cur && cur.secretsSetAt) || null, active,
    createdAt: (cur && cur.createdAt) || at, createdBy: (cur && cur.createdBy) || who.actorId, writtenBy: { id: who.actorId, kind: "human", at },
    // What ABDM's registries answered (abdm-registry.js) is kept across a settings change; it names the ID it checked.
    ...(cur && cur.registry ? { registry: cur.registry } : {}),
  };
  const settingsChanged = [...new Set([...Object.keys(next.settings), ...Object.keys((cur && cur.settings) || {})])]
    .filter((k) => JSON.stringify(next.settings[k]) !== JSON.stringify(cur && cur.settings && cur.settings[k])).sort();
  const secretsReplaced = Object.keys(supplied).sort();
  const providerChanged = !!cur && cur.provider !== next.provider;
  if (cur && !settingsChanged.length && !secretsReplaced.length && !providerChanged && active === (cur.active === true) && next.name === (cur.name || null)) {
    return { ok: true, unchanged: true, connector: summaryOf(cur) };
  }
  const action = !cur ? "connector.create"
    : active !== (cur.active === true) ? (active ? "connector.enable" : "connector.disable")
    : (secretsReplaced.length && !settingsChanged.length && !providerChanged) ? "connector.rotate" : "connector.update";
  const hosts = spec.settings.filter((f) => f.type === "url" && next.settings[f.key]).map((f) => { try { return new URL(next.settings[f.key]).host; } catch { return null; } }).filter(Boolean);
  try {
    await who.repo.append(who.tenantId, [next], { audit: auditEvent(action, who.actorId, { connectorId: id, kind: next.kind, provider: next.provider, settingsChanged, secretsReplaced, active, hosts }) });
  } catch (e) { return writeFailed(e); }
  return { ok: true, connector: summaryOf(next), ...(secretsReplaced.length ? { secretsNote: "Credentials stored encrypted. They are not shown again; enter new ones to rotate." } : {}) };
}

/** ctx: { kind? }. This hospital's connectors, the catalogue, and whether credentials can be stored. */
async function listConnectors(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  let rows;
  try { rows = (await who.repo.latestByType(who.tenantId, CONNECTOR_TYPE, MAX_CONNECTORS * 2)) || []; }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The connectors could not be read." }; }
  const kind = str(ctx.kind);
  return {
    ok: true, keyConfigured: !!(await docKey(env)), catalogue: catalogue().filter((c) => !kind || c.kind === kind),
    connectors: rows.filter((r) => r && KINDS[r.kind] && (!kind || r.kind === kind)).map(summaryOf).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** ctx: { id, fetchImpl?, resolveHost? }. The adapter's own honest check, audited. Never returns a response body. */
async function testConnector(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  let rec;
  try { rec = await who.repo.latest(who.tenantId, CONNECTOR_TYPE, str(ctx.id)); } catch { return readFailed; }
  if (!rec || !KINDS[rec.kind]) return { ok: false, status: 404, error: "connector_not_found", message: "No such connector at this hospital." };
  const spec = KINDS[rec.kind].providers[rec.provider];
  if (!spec || typeof spec.test !== "function") return refuse("no_test", "This connector has no connection test.");
  const secrets = await openConnectorSecrets(env, rec);
  let result;
  try { result = await spec.test({ settings: rec.settings || {}, secrets, fetchImpl: ctx.fetchImpl, resolveHost: ctx.resolveHost }); }
  catch (e) { result = { ok: false, reason: "error", detail: `The test could not run: ${str(e && e.message).slice(0, 160)}` }; }
  try {
    await who.repo.auditOnly(who.tenantId, auditEvent("connector.test", who.actorId, { connectorId: rec.id, kind: rec.kind, provider: rec.provider, ok: !!result.ok, reason: result.reason || null, httpStatus: result.httpStatus || null }));
  } catch { return { ok: false, status: 502, error: "record_write_failed", message: `The test ${result.ok ? "passed" : "failed"} but could not be logged.` }; }
  return { ok: true, connectorId: rec.id, test: { passed: !!result.ok, reason: result.reason || null, httpStatus: result.httpStatus || null, detail: str(result.detail), ...(result.count != null ? { count: result.count } : {}) } };
}

/* ---- for the adapters' callers -------------------------------------------------------------------- */

/** The ACTIVE connectors of one kind at a hospital. Throws when the record cannot be read. */
async function activeConnectors(repo, tenantId, kind) {
  const rows = (await repo.latestByType(tenantId, CONNECTOR_TYPE, MAX_CONNECTORS * 2)) || [];
  return rows.filter((r) => r && r.kind === kind && r.active === true);
}

/** Every sealed credential on a connector, opened. A seal that does not open is absent, never guessed. */
async function openConnectorSecrets(env, rec) {
  const out = {};
  for (const [k, sealed] of Object.entries((rec && rec.secretsEnc) || {})) {
    const v = await openSecret(env, sealed);
    if (v) out[k] = v;
  }
  return out;
}

export { CONNECTOR_TYPE, KINDS, summaryOf, catalogue, settingsFrom, saveConnector, listConnectors, testConnector, activeConnectors, openConnectorSecrets };
