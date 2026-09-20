/* functions/_wardsynq/smart-clients.js - the hospital's own list of outside applications allowed to
 * connect over SMART on FHIR (Admin Center > Integrations > Connected apps).
 *
 * There is no dynamic client registration: who may connect is hospital configuration, read by
 * smart-server.js findClient() from `wardsynq.fhir.smart.clients` (the `fhir` object is what both
 * doors pass as `config`, so `smart` nests under it, not beside it). Today the only way to set it
 * is a raw org/update write, which no hospital can realistically use, so these four routes are the
 * governed way in: the same double gate the webhooks use (staff.admin at the route, inside open() a
 * clinical actor that may write the record, so an hr role holding staff.admin is still refused),
 * strict validation with a field-keyed 422 for every refusal, and an audit row naming the clientId
 * and the action on every write, never the keys.
 *
 * Writes go through ORG.updateOrg, the same store function org/update uses. Its wardsynq merge is
 * ONE level deep, so the route reads the org first and resends the whole `fhir` object with only
 * its `smart` block changed: sending `{wardsynq: {fhir: {smart}}}` bare would drop the fhir
 * siblings (profiles, terminology pointers) the same way a bare `{wardsynq: {...}}` once dropped
 * whole settings. Removal cuts access at once because resolveBearer re-reads the client from this
 * same configuration on every read: a token whose client is gone is refused, not honoured.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import * as ORG from "../_opd_org_store.js";
import { parseScope, SPECIAL_SCOPES, SCOPE_RESOURCES } from "./smart-server.js";

const str = (v) => (v == null ? "" : String(v).trim());
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;
/* A JWK carrying any of these can sign, not just verify: it is a private key asking to be stored
 * as a public one, so it is refused outright rather than stripped (a stripped copy would leave the
 * administrator believing the client can authenticate when it cannot). */
const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"];

function httpsUrl(u) {
  try {
    const x = new URL(str(u));
    if (x.protocol !== "https:") return null;
    if (x.hash) return null;
    return x.href;
  } catch { return null; }
}

/* ---- the gate ---------------------------------------------------------------------------------- */

/* staff.admin opened the route; this decides whether the caller may stand behind it. Copied from
 * webhooks.js open() on purpose: the two integrations share one bar, so hr (staff.admin, no
 * clinical standing) is refused here exactly as it is there. */
async function open(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
    return { actorId: r.actor.id, tenantId: mig.tenantId, repo: ctx.recordDeps.repository };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}

async function audit(ctx, tenantId, actorId, action, scope) {
  try {
    await ctx.recordDeps.repository.auditOnly(tenantId,
      { ts: new Date().toISOString(), actor: actorId, connectorId: "wardsynq-smart-clients", action, outcome: "ok", scope: scope || {}, phi: false });
  } catch { /* the audit sink failing must not turn a recorded write into a reported failure */ }
}

/* ---- reading ----------------------------------------------------------------------------------- */

const smartOf = (org) => ((org && org.wardsynq && org.wardsynq.fhir && org.wardsynq.fhir.smart) || {});

/* PURE. What a screen may see of a client: the key count and each public key's kid/kty/alg, never
 * key material. A count alone would not tell two registered keys apart on the screen. */
function summarize(c) {
  const keys = (c && c.jwks && Array.isArray(c.jwks.keys) ? c.jwks.keys : []).filter((k) => k && typeof k === "object");
  return {
    clientId: str(c.clientId), name: str(c.name) || str(c.clientId),
    kind: str(c.kind) === "backend" ? "backend" : "public",
    redirectUris: Array.isArray(c.redirectUris) ? c.redirectUris.map(str).filter(Boolean) : [],
    scopes: Array.isArray(c.scopes) ? c.scopes.map(str).filter(Boolean) : [],
    keyCount: keys.length,
    keys: keys.map((k) => ({ kid: str(k.kid) || null, kty: str(k.kty) || null, alg: str(k.alg) || null })),
    jwksUri: /^https:\/\//.test(str(c.jwksUri)) ? str(c.jwksUri) : null,
  };
}

/* PURE. Every scope this server would accept on a save, grouped for checkboxes: each resource the
 * grammar knows, in each context, plus the special scopes by name. Built from smart-server's own
 * SCOPE_RESOURCES and SPECIAL_SCOPES so the screen can never offer what the server would refuse. */
function scopeCatalog() {
  const out = { user: [], patient: [], system: [], special: [...SPECIAL_SCOPES] };
  for (const r of SCOPE_RESOURCES) {
    if (r === "*") continue;
    out.user.push(`user/${r}.read`);
    out.patient.push(`patient/${r}.read`);
    out.system.push(`system/${r}.read`);
  }
  out.user.push("user/*.read");
  out.patient.push("patient/*.read");
  out.system.push("system/*.read");
  return out;
}

/** ctx: { migration, actorDeps, recordDeps, org } */
async function listSmartClients(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const smart = smartOf(ctx.org);
  const clients = Array.isArray(smart.clients) ? smart.clients : [];
  return { ok: true, enabled: smart.enabled === true, clients: clients.map(summarize), scopeCatalog: scopeCatalog() };
}

/* ---- validation ---------------------------------------------------------------------------------- */

/* PURE. The stored client, or { error } with a field-keyed 422 the screen renders verbatim. Every
 * branch names its field: the administrator is fixing one input, not decoding a code. */
function validatedClient(raw) {
  const c = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : null;
  if (!c) return { error: { ok: false, status: 422, error: "client_required", field: "client", message: "No client was sent." } };
  const clientId = str(c.clientId);
  if (!CLIENT_ID_RE.test(clientId)) return { error: { ok: false, status: 422, error: "invalid_client_id", field: "clientId", message: "Client ID must be 3 to 64 letters, digits, dots, underscores or hyphens." } };
  const name = str(c.name);
  if (!name) return { error: { ok: false, status: 422, error: "name_required", field: "name", message: "Name is required: it is what the consent screen shows the clinician." } };
  const kind = str(c.kind);
  if (kind !== "public" && kind !== "backend") return { error: { ok: false, status: 422, error: "invalid_kind", field: "kind", message: "Kind must be public (an app a clinician uses) or backend (a system with a key)." } };

  const rawUris = c.redirectUris === undefined || c.redirectUris === null ? [] : c.redirectUris;
  if (!Array.isArray(rawUris)) return { error: { ok: false, status: 422, error: "invalid_redirect_uris", field: "redirectUris", message: "Redirect URIs must be a list." } };
  const redirectUris = [];
  for (const u of rawUris) {
    const good = httpsUrl(u);
    if (!good) return { error: { ok: false, status: 422, error: "invalid_redirect_uri", field: "redirectUris", message: `Not an https address without a fragment: ${str(u) || "(empty)"}.` } };
    redirectUris.push(good);
  }
  if (kind === "public" && !redirectUris.length) return { error: { ok: false, status: 422, error: "redirect_uri_required", field: "redirectUris", message: "A public app needs at least one https redirect URI; errors about it are never sent anywhere else." } };

  if (!Array.isArray(c.scopes) || !c.scopes.length) return { error: { ok: false, status: 422, error: "scopes_required", field: "scopes", message: "Choose at least one scope: a client with none can never be granted anything." } };
  const scopes = [];
  for (const s of c.scopes) {
    const w = str(s);
    const parsed = parseScope(w);
    if (!parsed && !SPECIAL_SCOPES.includes(w)) return { error: { ok: false, status: 422, error: "unknown_scope", field: "scopes", message: `Not a scope this server honours: ${w || "(empty)"}.` } };
    /* A normalised spelling (user/Observation.rs) is stored normalised, so the consent screen and
     * the grant check read the same word the registration meant. */
    const word = parsed ? parsed.raw : w;
    if (parsed && parsed.context === "system" && kind !== "backend") return { error: { ok: false, status: 422, error: "system_scope_needs_backend", field: "scopes", message: `A system scope (${word}) belongs to a backend client, never to a public app.` } };
    if (parsed && parsed.context !== "system" && kind !== "public") return { error: { ok: false, status: 422, error: "user_scope_needs_public", field: "scopes", message: `A ${parsed.context} scope (${word}) belongs to a public app, never to a backend system.` } };
    if (!scopes.includes(word)) scopes.push(word);
  }

  const stored = { clientId, name: name.slice(0, 120), kind, redirectUris, scopes };
  if (kind === "backend") {
    const rawKeys = (c.jwks && Array.isArray(c.jwks.keys)) ? c.jwks.keys : null;
    if (rawKeys) {
      for (const k of rawKeys) {
        if (!k || typeof k !== "object" || Array.isArray(k)) return { error: { ok: false, status: 422, error: "invalid_jwk", field: "jwks", message: "Every key must be a JSON object." } };
        const priv = PRIVATE_JWK_MEMBERS.filter((m) => k[m] !== undefined && k[m] !== null && str(k[m]) !== "");
        if (priv.length) return { error: { ok: false, status: 422, error: "private_key_not_accepted", field: "jwks", message: "A private key was sent (it carries private members). Send only the public half; the private half never leaves the other system." } };
      }
    }
    const jwksUri = str(c.jwksUri);
    if (jwksUri && !httpsUrl(jwksUri)) return { error: { ok: false, status: 422, error: "invalid_jwks_uri", field: "jwksUri", message: "The JWKS address must be https." } };
    if ((!rawKeys || !rawKeys.length) && !jwksUri) return { error: { ok: false, status: 422, error: "backend_key_required", field: "jwks", message: "A backend client proves itself with a key: paste its public keys, or give the https address this hospital registered for them." } };
    if (rawKeys && rawKeys.length) stored.jwks = { keys: rawKeys };
    if (jwksUri) stored.jwksUri = jwksUri;
  }
  /* A public app authenticates nobody, so keys sent with one are dropped, not stored: keeping them
   * would suggest they do something. */
  return { client: stored };
}

/* ---- writes -------------------------------------------------------------------------------------- */

/* The org's fhir object with only its smart block replaced. updateOrg merges wardsynq one level,
 * so siblings of `smart` inside `fhir` (profiles and the like) must be carried along here, not
 * trusted to survive a bare write. */
async function writeSmart(env, orgId, org, smart, actorId) {
  const fhir = Object.assign({}, (org && org.wardsynq && org.wardsynq.fhir) || {}, { smart });
  const updated = await ORG.updateOrg(env, orgId, { wardsynq: { fhir } }, actorId);
  return updated || null;
}

/** ctx: { migration, actorDeps, recordDeps, org, orgId, client, actorId } */
async function saveSmartClient(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const orgId = str(ctx.orgId);
  if (!orgId) return { ok: false, status: 400, error: "org_required", field: "orgId", message: "orgId is required." };
  const { client, error } = validatedClient(ctx.client);
  if (error) return error;
  const smart = smartOf(ctx.org);
  const clients = Array.isArray(smart.clients) ? smart.clients.map((x) => ({ ...(x || {}) })) : [];
  const at = clients.findIndex((x) => str(x && x.clientId) === client.clientId);
  const action = at >= 0 ? "updated" : "created";
  if (at >= 0) clients[at] = client; else clients.push(client);
  let updated;
  try {
    updated = await writeSmart(env, orgId, ctx.org, { ...(smart || {}), clients }, who.actorId);
  } catch { return { ok: false, status: 502, error: "record_write_failed", message: "The client could not be recorded, so it was not saved." }; }
  if (!updated) return { ok: false, status: 502, error: "record_write_failed", message: "The client could not be recorded, so it was not saved." };
  await audit(ctx, who.tenantId, who.actorId, "smart.client.save", { clientId: client.clientId, kind: client.kind, action });
  return { ok: true, action, client: summarize(client) };
}

/** ctx: { migration, actorDeps, recordDeps, org, orgId, clientId, actorId } */
async function removeSmartClient(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const orgId = str(ctx.orgId);
  if (!orgId) return { ok: false, status: 400, error: "org_required", field: "orgId", message: "orgId is required." };
  const clientId = str(ctx.clientId);
  if (!clientId) return { ok: false, status: 422, error: "client_id_required", field: "clientId", message: "clientId is required." };
  const smart = smartOf(ctx.org);
  const clients = Array.isArray(smart.clients) ? smart.clients : [];
  if (!clients.some((x) => str(x && x.clientId) === clientId)) return { ok: false, status: 404, error: "client_not_found", field: "clientId", message: "No such connected app at this hospital; nothing was removed." };
  let updated;
  try {
    updated = await writeSmart(env, orgId, ctx.org, { ...(smart || {}), clients: clients.filter((x) => str(x && x.clientId) !== clientId) }, who.actorId);
  } catch { return { ok: false, status: 502, error: "record_write_failed", message: "The client could not be removed, so it is still registered." }; }
  if (!updated) return { ok: false, status: 502, error: "record_write_failed", message: "The client could not be removed, so it is still registered." };
  /* From this write on, resolveBearer finds no client for the id and refuses its tokens: removal
   * is revocation, with no separate step to forget. */
  await audit(ctx, who.tenantId, who.actorId, "smart.client.remove", { clientId });
  return { ok: true, removed: clientId };
}

/** ctx: { migration, actorDeps, recordDeps, org, orgId, enabled, actorId } */
async function setSmartEnabled(request, env, ctx) {
  const who = await open(request, env, ctx);
  if (who.error) return who.error;
  const orgId = str(ctx.orgId);
  if (!orgId) return { ok: false, status: 400, error: "org_required", field: "orgId", message: "orgId is required." };
  if (ctx.enabled !== true && ctx.enabled !== false) return { ok: false, status: 422, error: "invalid_enabled", field: "enabled", message: "enabled must be true or false." };
  const smart = smartOf(ctx.org);
  let updated;
  try {
    updated = await writeSmart(env, orgId, ctx.org, { ...(smart || {}), enabled: ctx.enabled }, who.actorId);
  } catch { return { ok: false, status: 502, error: "record_write_failed", message: "The switch could not be recorded, so it did not move." }; }
  if (!updated) return { ok: false, status: 502, error: "record_write_failed", message: "The switch could not be recorded, so it did not move." };
  await audit(ctx, who.tenantId, who.actorId, "smart.enable", { enabled: ctx.enabled });
  return { ok: true, enabled: ctx.enabled };
}

export {
  CLIENT_ID_RE, PRIVATE_JWK_MEMBERS,
  summarize, scopeCatalog, validatedClient,
  listSmartClients, saveSmartClient, removeSmartClient, setSmartEnabled,
};
