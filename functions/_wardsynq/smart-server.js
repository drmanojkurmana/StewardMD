/* functions/_wardsynq/smart-server.js - letting another application read this record, as somebody.
 *
 * Connect has a SMART CLIENT: it can obtain a token from another hospital's server. Nothing here
 * could ISSUE one, so no external application could reach WardSynQ's FHIR data except by holding a
 * clinician's own session. This is the server side, and it is deliberately the smallest one that
 * is real: an application gets a short-lived, read-only token that acts as a named person or a
 * registered system, narrowed to what they were granted, and every FHIR read it makes goes through
 * the same governed store and the same audit as a clinician's.
 *
 * TWO GRANTS, TWO KINDS OF SUBJECT:
 *
 *   AUTHORIZATION CODE + PKCE, for an application a clinician is using. The clinician's OWN session
 *   authorises it, so the token acts as that clinician - narrowed to READ, and narrowed again by the
 *   scopes the application asked for. It can do nothing the clinician could not, and less. PKCE is
 *   REQUIRED (S256 only): a public application has no secret, and without PKCE an intercepted code is
 *   a token.
 *
 *   CLIENT CREDENTIALS, for a registered system with a key. It proves itself with a JWT it signed
 *   (private_key_jwt), verified against the JWKS the hospital registered for it - never fetched from
 *   a URL the client named. Its token acts as `smart:<client>`, a SERVICE-kind actor, READ tier.
 *
 * TOKENS ARE OPAQUE, HASHED AT REST AND NEVER RETURNED TWICE. A grant is looked up by the digest of
 * the token, so a stolen record cannot be replayed as a token. Expiry is the record's, not the
 * token's; revocation is a new version of the grant and cannot be deleted afterwards.
 *
 * NO LAUNCH CONTEXT, NO PATIENT-SCOPED TOKENS, NO REFRESH TOKENS, NO WRITES. `patient/` scopes need
 * a patient chosen at launch and a consent screen to choose it on; neither exists yet, and a
 * patient-scoped token that quietly acted as user-scoped would be the worst possible version of
 * "supported". `user/` and `system/` read scopes only. Writes stay on the clinician's door.
 *
 * OFF UNLESS THE HOSPITAL TURNS IT ON, with a client registered in its own configuration. There is
 * no dynamic client registration: who may connect is the hospital's decision, made by name.
 */

import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { RecordService } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { hashSecret, sameSecret } from "./patient-access.js";
import { CANONICAL_TYPE, FHIR_TYPE } from "./fhir.js";
import { hit as rateHit } from "./rate-limit.js";

const str = (v) => (v == null ? "" : String(v).trim());
const GRANT_TYPE = "SmartGrant";

const CODE_TTL_SECONDS = 300;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const MAX_TOKEN_TTL_SECONDS = 4 * 3600;
const ASSERTION_MAX_LIFETIME_SECONDS = 300;
const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** The FHIR resource names a scope may name: everything exported, plus Provenance. */
const SCOPE_RESOURCES = Object.freeze([...Object.values(FHIR_TYPE), "Provenance", "*"]);

/* ---- pure ------------------------------------------------------------------------------------ */

function smartEnabled(config) {
  return !!(config && config.smart && config.smart.enabled === true);
}

/** PURE. A registered client, or null. Clients are hospital configuration; there is no registration endpoint. */
function findClient(config, clientId) {
  const id = str(clientId);
  if (!id) return null;
  const list = (config && config.smart && Array.isArray(config.smart.clients)) ? config.smart.clients : [];
  const c = list.find((x) => x && str(x.clientId) === id);
  if (!c) return null;
  return {
    clientId: id, name: str(c.name) || id,
    kind: str(c.kind) === "backend" ? "backend" : "public",
    redirectUris: Array.isArray(c.redirectUris) ? c.redirectUris.map(str).filter(Boolean) : [],
    scopes: Array.isArray(c.scopes) ? c.scopes.map(str).filter(Boolean) : [],
    // An empty key set is no key set: a backend client with no registered key can prove nothing.
    jwks: c.jwks && Array.isArray(c.jwks.keys) && c.jwks.keys.length ? c.jwks : null,
  };
}

/** PURE. `user/Observation.read` -> {context, resource, access}, or null when it is not a scope this server honours. */
function parseScope(s) {
  const m = /^(user|system)\/([A-Za-z*]+)\.(read|rs)$/.exec(str(s));
  if (!m || !SCOPE_RESOURCES.includes(m[2])) return null;
  return { context: m[1], resource: m[2], access: "read", raw: `${m[1]}/${m[2]}.read` };
}

/**
 * PURE. The scopes actually granted: requested, intersected with what the client was registered
 * for, never widened. A registered `user/*.read` covers any `user/X.read`; a registered `user/X.read`
 * does not cover `user/*.read`. Anything unparseable is dropped and named.
 */
function grantScopes(requested, clientScopes, context) {
  const asked = str(requested).split(/\s+/).map(parseScope).filter(Boolean).filter((s) => s.context === context);
  const allowed = (clientScopes || []).map(parseScope).filter(Boolean).filter((s) => s.context === context);
  const covers = (a, s) => a.resource === "*" || a.resource === s.resource;
  const granted = asked.filter((s) => allowed.some((a) => covers(a, s)));
  const dropped = str(requested).split(/\s+/).filter(Boolean).filter((raw) => !granted.some((g) => g.raw === raw));
  return { granted: [...new Set(granted.map((g) => g.raw))], dropped };
}

/** PURE. The canonical types a scope set may read, or null for every exported type. */
function readTypesFor(scopes) {
  const parsed = (scopes || []).map(parseScope).filter(Boolean);
  if (parsed.some((s) => s.resource === "*")) return null;
  const types = new Set();
  for (const s of parsed) {
    if (s.resource === "Provenance") { for (const t of Object.keys(FHIR_TYPE)) types.add(t); continue; }
    const canonical = CANONICAL_TYPE[s.resource];
    if (canonical) types.add(canonical);
  }
  return [...types];
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { const t = str(s).replace(/-/g, "+").replace(/_/g, "/"); const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : ""; const bin = atob(t + pad); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

/** S256 only. `plain` is refused: a code challenge equal to its verifier protects nothing. */
async function pkceMatches(verifier, challenge) {
  const v = str(verifier);
  if (v.length < 43 || v.length > 128) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return sameSecret(b64url(digest), str(challenge));
}

function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** PURE. The document at .well-known/smart-configuration. It declares exactly what is implemented. */
function smartConfiguration(base, config) {
  const clients = (config && config.smart && Array.isArray(config.smart.clients)) ? config.smart.clients : [];
  const scopes = [...new Set(clients.flatMap((c) => (Array.isArray(c.scopes) ? c.scopes : [])).map(parseScope).filter(Boolean).map((s) => s.raw))];
  return {
    issuer: base,
    authorization_endpoint: `${base}/smart/authorize`,
    token_endpoint: `${base}/smart/token`,
    revocation_endpoint: `${base}/smart/revoke`,
    token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256", "ES256"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes,
    capabilities: ["client-public", "client-confidential-asymmetric", "permission-user", "sso-openid-connect"].filter((c) => c !== "sso-openid-connect"),
    /* Said in the document, where a machine reads it: no launch, no patient context, no refresh. */
    "x-wardsynq": { launch: false, patientScopes: false, refreshTokens: false, writes: false },
  };
}

/** Decodes a compact JWS without verifying. Returns null for anything malformed. */
function decodeJws(jwt) {
  const parts = str(jwt).split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: fromB64url(parts[2]) };
  } catch { return null; }
}

const ALG = Object.freeze({
  RS256: { importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyAlg: "RSASSA-PKCS1-v1_5", kty: "RSA" },
  ES256: { importAlg: { name: "ECDSA", namedCurve: "P-256" }, verifyAlg: { name: "ECDSA", hash: "SHA-256" }, kty: "EC" },
});

/**
 * Verifies a private_key_jwt client assertion against the client's REGISTERED keys.
 *
 * Checks, in order and all required: a supported alg; a registered key with that kid (or the only
 * key when there is one); the signature; iss and sub equal to the client id; aud equal to THIS
 * token endpoint; exp in the future and not more than five minutes away; a jti. The keys come from
 * the hospital's own configuration and never from a URL the client supplied.
 */
async function verifyClientAssertion(jwt, client, opts) {
  const d = decodeJws(jwt);
  if (!d) return { ok: false, error: "invalid_client", detail: "client_assertion is not a compact JWS" };
  const alg = str(d.header.alg);
  const spec = ALG[alg];
  if (!spec) return { ok: false, error: "invalid_client", detail: `alg ${alg || "(none)"} is not accepted; RS256 or ES256` };
  const keys = (client.jwks && client.jwks.keys) || [];
  const kid = str(d.header.kid);
  const jwk = kid ? keys.find((k) => str(k.kid) === kid) : (keys.length === 1 ? keys[0] : null);
  if (!jwk) return { ok: false, error: "invalid_client", detail: kid ? `no registered key with kid ${kid}` : "the client has several keys and the assertion names none" };
  if (str(jwk.kty) !== spec.kty) return { ok: false, error: "invalid_client", detail: "the registered key does not match the assertion's algorithm" };
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, spec.importAlg, false, ["verify"]);
    ok = await crypto.subtle.verify(spec.verifyAlg, key, d.signature, new TextEncoder().encode(d.signingInput));
  } catch (e) { ok = false; }
  if (!ok) return { ok: false, error: "invalid_client", detail: "signature did not verify against the registered key" };

  const p = d.payload || {};
  const now = Number.isFinite(opts && opts.nowSeconds) ? opts.nowSeconds : Math.floor(Date.now() / 1000);
  if (str(p.iss) !== client.clientId || str(p.sub) !== client.clientId) return { ok: false, error: "invalid_client", detail: "iss and sub must both be the client id" };
  const aud = Array.isArray(p.aud) ? p.aud.map(str) : [str(p.aud)];
  if (!aud.includes(str(opts && opts.tokenEndpoint))) return { ok: false, error: "invalid_client", detail: "aud must be this token endpoint" };
  const exp = Number(p.exp);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, error: "invalid_client", detail: "assertion expired" };
  if (exp - now > ASSERTION_MAX_LIFETIME_SECONDS) return { ok: false, error: "invalid_client", detail: "assertion lifetime exceeds five minutes" };
  if (!str(p.jti)) return { ok: false, error: "invalid_client", detail: "jti is required" };
  return { ok: true, claims: p, kid: kid || str(jwk.kid) || null };
}

/** PURE. The grant record. Only digests of secrets ever live here. */
function SmartGrant(input) {
  const i = input || {};
  return {
    resourceType: GRANT_TYPE, id: i.id,
    kind: i.kind,                                   // "code" | "token" | "jti"
    clientId: i.clientId, clientKind: i.clientKind,
    subject: i.subject, subjectKind: i.subjectKind, // "human" | "service"
    scopes: i.scopes || [],
    readTypes: i.readTypes === undefined ? null : i.readTypes,
    redirectUri: i.redirectUri || null,
    codeChallenge: i.codeChallenge || null,
    issuedAt: i.issuedAt, expiresAt: i.expiresAt,
    redeemedAt: i.redeemedAt || null, tokenGrantId: i.tokenGrantId || null,
    revokedAt: i.revokedAt || null, revokedBy: i.revokedBy || null,
    issuedBy: i.issuedBy || null,
  };
}

/** PURE. Whether a grant is live now. Unreadable timestamps fail CLOSED. */
function grantLive(grant, nowIso) {
  const g = grant || {};
  if (g.revokedAt) return { ok: false, reason: "revoked" };
  const exp = Date.parse(str(g.expiresAt)), now = Date.parse(str(nowIso));
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return { ok: false, reason: "unusable" };
  if (now >= exp) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ---- the machinery's own actor ---------------------------------------------------------------- */

function grantActor() {
  return makeActor({ id: "service:smart", kind: KIND.SERVICE, tier: TIER.DRAFT, scope: { read: [GRANT_TYPE], write: [GRANT_TYPE] } });
}
function serviceFor(ctx, actor) {
  return new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: ctx.migration.tenantId }, actor, role: "smart", roleSource: "wardsynq-smart" });
}
const grantIdFor = async (kind, secret) => `wsq-smart-${kind}-${await hashSecret(secret, `smart:${kind}`)}`;

async function audit(ctx, action, fields) {
  try { await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, { ts: new Date().toISOString(), actor: (fields && fields.actor) || "anonymous", connectorId: "wardsynq-smart", action, ...fields, phi: false }); }
  catch { /* the audit sink failing must not turn into a token */ }
}

const oauthError = (status, error, detail) => ({ ok: false, status, body: { error, error_description: detail } });

/* ---- authorize -------------------------------------------------------------------------------- */

/**
 * The authorization endpoint. The caller IS the clinician (their own session), so this is that
 * clinician saying "this application may read as me". Returns where to redirect.
 * ctx: { migration, config, base, params (URLSearchParams), actorDeps, recordDeps, ipKey }
 */
async function authorize(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const p = ctx.params;
  const clientId = str(p.get("client_id")), redirectUri = str(p.get("redirect_uri")), state = str(p.get("state"));
  const client = findClient(ctx.config, clientId);
  /* Errors about the CLIENT or the REDIRECT are never redirected: an attacker who controls the
   * redirect_uri would otherwise receive the error, and the user's browser would be sent to it. */
  if (!client) return oauthError(400, "invalid_client", "unknown client_id");
  if (client.kind !== "public") return oauthError(400, "unauthorized_client", "a backend client uses client_credentials, not the authorization endpoint");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return oauthError(400, "invalid_request", "redirect_uri must exactly match one registered for this client");

  const rl = await rateHit({ kv: env && env.WSQ_RL_KV }, { key: `smart:authz:${mig.tenantId}:${clientId}`, limit: 60, windowMs: 60000 });
  if (!rl.allowed) return { ok: false, status: 429, body: { error: "temporarily_unavailable", error_description: "too many authorization requests; retry later" }, retryAfter: rl.retryAfterSeconds };

  // From here, errors MAY go back to the registered redirect_uri, per OAuth.
  const back = (error, detail) => ({ ok: false, status: 302, redirect: `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(detail)}${state ? "&state=" + encodeURIComponent(state) : ""}` });
  if (str(p.get("response_type")) !== "code") return back("unsupported_response_type", "response_type must be code");
  const challenge = str(p.get("code_challenge")), method = str(p.get("code_challenge_method"));
  if (!challenge || method !== "S256") return back("invalid_request", "PKCE with S256 is required");
  const aud = str(p.get("aud"));
  if (aud && aud !== str(ctx.base)) return back("invalid_request", "aud must be this FHIR server");

  const { granted, dropped } = grantScopes(p.get("scope"), client.scopes, "user");
  if (!granted.length) return back("invalid_scope", `no requested scope is registered for this client${dropped.length ? ": " + dropped.join(" ") : ""}`);

  // The clinician authorising. They must be able to read this hospital's record themselves.
  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps); }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ok: false, status, body: { error: status === 401 ? "login_required" : "access_denied", error_description: str(e && e.message) } };
  }

  const code = randomToken(32);
  const now = new Date();
  const grant = SmartGrant({
    id: await grantIdFor("code", code), kind: "code", clientId, clientKind: client.kind,
    subject: resolved.actor.id, subjectKind: "human", scopes: granted, readTypes: readTypesFor(granted),
    redirectUri, codeChallenge: challenge,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString(), issuedBy: resolved.actor.id,
  });
  try { await serviceFor(ctx, grantActor()).put(grant); }
  catch (e) { return { ok: false, status: 502, body: { error: "server_error", error_description: "could not record the authorization" } }; }
  await audit(ctx, "smart.authorize", { actor: resolved.actor.id, scope: { clientId, scopes: granted, dropped } });

  return { ok: true, status: 302, redirect: `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}${state ? "&state=" + encodeURIComponent(state) : ""}`, granted, dropped };
}

/* ---- token ------------------------------------------------------------------------------------ */

/**
 * The token endpoint. Form-encoded, per OAuth.
 * ctx: { migration, config, base, form (URLSearchParams), recordDeps, ipKey }
 */
async function token(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const f = ctx.form;
  const grantType = str(f.get("grant_type"));
  const clientId = str(f.get("client_id")) || (decodeJws(f.get("client_assertion")) || { payload: {} }).payload.sub || "";
  const client = findClient(ctx.config, clientId);
  if (!client) return oauthError(401, "invalid_client", "unknown client");

  const rl = await rateHit({ kv: env && env.WSQ_RL_KV }, { key: `smart:token:${mig.tenantId}:${client.clientId}`, limit: 30, windowMs: 60000 });
  if (!rl.allowed) return { ok: false, status: 429, body: { error: "temporarily_unavailable", error_description: "too many token requests; retry later" }, retryAfter: rl.retryAfterSeconds };

  const svc = serviceFor(ctx, grantActor());
  const now = new Date();
  const ttl = Math.min(MAX_TOKEN_TTL_SECONDS, Math.max(60, Number(ctx.config.smart.tokenTtlSeconds) || DEFAULT_TOKEN_TTL_SECONDS));
  const mint = async ({ subject, subjectKind, scopes, issuedBy }) => {
    const access = randomToken(32);
    const g = SmartGrant({
      id: await grantIdFor("token", access), kind: "token", clientId: client.clientId, clientKind: client.kind,
      subject, subjectKind, scopes, readTypes: readTypesFor(scopes),
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(), issuedBy,
    });
    await svc.put(g);
    return { access, grantId: g.id };
  };

  if (grantType === "authorization_code") {
    if (client.kind !== "public") return oauthError(400, "unauthorized_client", "this client is a backend service");
    const code = str(f.get("code")), verifier = str(f.get("code_verifier")), redirectUri = str(f.get("redirect_uri"));
    if (!code || !verifier) return oauthError(400, "invalid_request", "code and code_verifier are required");
    let g = null;
    try { g = await svc.get(GRANT_TYPE, await grantIdFor("code", code)); } catch { g = null; }
    /* One answer for every failure of the code: a wrong code, a used code and an expired code look
     * the same from outside, so the endpoint is not an oracle for which codes exist. */
    const deny = oauthError(400, "invalid_grant", "the authorization code is not valid");
    if (!g || g.kind !== "code" || g.clientId !== client.clientId || g.redeemedAt) { await audit(ctx, "smart.token.denied", { scope: { clientId: client.clientId, grant: "authorization_code" } }); return deny; }
    if (!grantLive(g, now.toISOString()).ok) return deny;
    if (str(g.redirectUri) !== redirectUri) return deny;
    if (!(await pkceMatches(verifier, g.codeChallenge))) { await audit(ctx, "smart.token.denied", { scope: { clientId: client.clientId, grant: "authorization_code", pkce: false } }); return deny; }

    let minted;
    try {
      minted = await mint({ subject: g.subject, subjectKind: g.subjectKind, scopes: g.scopes, issuedBy: g.subject });
      const { meta, version, ...rest } = g;
      /* The code is spent in the same breath. A second exchange of the same code would otherwise
       * mint a second token, which is exactly the replay PKCE exists to stop. */
      await svc.put({ ...rest, redeemedAt: now.toISOString(), tokenGrantId: minted.grantId }, { expectedVersion: version });
    } catch (e) {
      if (e instanceof GovernanceError) return oauthError(500, "server_error", "could not record the grant");
      return oauthError(500, "server_error", "could not issue the token");
    }
    await audit(ctx, "smart.token", { actor: g.subject, scope: { clientId: client.clientId, grant: "authorization_code", scopes: g.scopes } });
    return { ok: true, status: 200, body: { access_token: minted.access, token_type: "Bearer", expires_in: ttl, scope: g.scopes.join(" ") } };
  }

  if (grantType === "client_credentials") {
    if (client.kind !== "backend") return oauthError(400, "unauthorized_client", "this client is a public application; use the authorization code flow");
    if (str(f.get("client_assertion_type")) !== JWT_BEARER) return oauthError(400, "invalid_request", `client_assertion_type must be ${JWT_BEARER}`);
    const v = await verifyClientAssertion(f.get("client_assertion"), client, { tokenEndpoint: `${str(ctx.base)}/smart/token` });
    if (!v.ok) { await audit(ctx, "smart.token.denied", { scope: { clientId: client.clientId, grant: "client_credentials", why: v.detail } }); return oauthError(401, v.error, v.detail); }
    /* jti replay: the assertion's id is recorded, and a second presentation is refused. Bounded by
     * the assertion's own five-minute lifetime. */
    const jtiId = await grantIdFor("jti", `${client.clientId}:${v.claims.jti}`);
    let seen = null;
    try { seen = await svc.get(GRANT_TYPE, jtiId); } catch { seen = null; }
    if (seen) return oauthError(400, "invalid_grant", "client_assertion jti was already used");
    const { granted, dropped } = grantScopes(f.get("scope") || client.scopes.join(" "), client.scopes, "system");
    if (!granted.length) return oauthError(400, "invalid_scope", `no requested scope is registered for this client${dropped.length ? ": " + dropped.join(" ") : ""}`);
    let minted;
    try {
      await svc.put(SmartGrant({ id: jtiId, kind: "jti", clientId: client.clientId, clientKind: client.kind, subject: `smart:${client.clientId}`, subjectKind: "service", scopes: [], readTypes: [], issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ASSERTION_MAX_LIFETIME_SECONDS * 1000).toISOString() }));
      minted = await mint({ subject: `smart:${client.clientId}`, subjectKind: "service", scopes: granted, issuedBy: `smart:${client.clientId}` });
    } catch (e) { return oauthError(500, "server_error", "could not issue the token"); }
    await audit(ctx, "smart.token", { actor: `smart:${client.clientId}`, scope: { clientId: client.clientId, grant: "client_credentials", scopes: granted, dropped, kid: v.kid } });
    return { ok: true, status: 200, body: { access_token: minted.access, token_type: "Bearer", expires_in: ttl, scope: granted.join(" ") } };
  }

  return oauthError(400, "unsupported_grant_type", "authorization_code or client_credentials");
}

/* ---- the bearer, on a read ------------------------------------------------------------------- */

/**
 * Turns a Bearer token into the actor a FHIR read runs as. Returns null when there is no bearer,
 * so the caller can fall back to the ordinary session; returns {error} for a bearer that is bad.
 * ctx: { migration, config, recordDeps }
 */
async function resolveBearer(request, env, ctx) {
  const auth = str(request.headers.get("Authorization"));
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { error: { status: 401, code: "invalid_token", detail: "bearer tokens are not accepted here" } };
  const svc = serviceFor(ctx, grantActor());
  let g = null;
  try { g = await svc.get(GRANT_TYPE, await grantIdFor("token", m[1])); } catch { g = null; }
  if (!g || g.kind !== "token") return { error: { status: 401, code: "invalid_token", detail: "the token is not valid" } };
  const live = grantLive(g, new Date().toISOString());
  if (!live.ok) return { error: { status: 401, code: "invalid_token", detail: `the token is ${live.reason}` } };
  const client = findClient(ctx.config, g.clientId);
  if (!client) return { error: { status: 401, code: "invalid_token", detail: "the client is no longer registered" } };

  /* READ tier, empty write scope, read narrowed to the granted types. A human subject keeps their
   * own id so the audit shows the person; a service subject is `smart:<client>`. Neither can be
   * clamped UP by anything downstream: the record's own ceilings still apply on top. */
  const actor = makeActor({
    id: g.subject,
    kind: g.subjectKind === "service" ? KIND.SERVICE : KIND.HUMAN,
    tier: TIER.READ,
    display: `${client.name} (SMART)`,
    scope: { read: g.readTypes === null ? null : (g.readTypes || []), write: [] },
  });
  return { actor, tenant: { id: mig.tenantId }, role: "smart", source: `smart:${g.clientKind}`, grantId: g.id, scopes: g.scopes };
}

/** Ends a token. The bearer itself, or a person with the hospital's admin capability. */
async function revoke(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const tok = str(ctx.form && ctx.form.get("token"));
  if (!tok) return oauthError(400, "invalid_request", "token is required");
  const svc = serviceFor(ctx, grantActor());
  let g = null;
  try { g = await svc.get(GRANT_TYPE, await grantIdFor("token", tok)); } catch { g = null; }
  // RFC 7009: an unknown token is a 200. Revocation is not an oracle either.
  if (!g || g.revokedAt) return { ok: true, status: 200, body: {} };
  const bearer = await resolveBearer(request, env, ctx);
  const self = bearer && bearer.actor && bearer.actor.id === g.subject;
  let by = self ? g.subject : null;
  if (!by) {
    try { const r = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps); by = r.actor.id; }
    catch { return oauthError(401, "invalid_client", "revoking somebody else's token needs the hospital's own session"); }
  }
  const { meta, version, ...rest } = g;
  try { await svc.put({ ...rest, revokedAt: new Date().toISOString(), revokedBy: by }, { expectedVersion: version }); }
  catch { return oauthError(500, "server_error", "could not record the revocation"); }
  await audit(ctx, "smart.revoke", { actor: by, scope: { clientId: g.clientId } });
  return { ok: true, status: 200, body: {} };
}

export {
  GRANT_TYPE, CODE_TTL_SECONDS, DEFAULT_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS, ASSERTION_MAX_LIFETIME_SECONDS, JWT_BEARER, SCOPE_RESOURCES,
  smartEnabled, findClient, parseScope, grantScopes, readTypesFor, pkceMatches, randomToken, smartConfiguration,
  decodeJws, verifyClientAssertion, SmartGrant, grantLive,
  authorize, token, resolveBearer, revoke,
};
