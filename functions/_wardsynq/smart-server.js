/* functions/_wardsynq/smart-server.js - letting another application read this record, as somebody.
 *
 * Connect has a SMART CLIENT: it can obtain a token from another hospital's server. This is the
 * server side: an application gets a short-lived, read-only token that acts as a named person or a
 * registered system, narrowed to what they were granted, and every FHIR read it makes goes through
 * the same governed store and the same audit as a clinician's.
 *
 * TWO GRANTS, TWO KINDS OF SUBJECT:
 *
 *   AUTHORIZATION CODE + PKCE, for an application a clinician is using. The clinician's OWN session
 *   authorises it - on a CONSENT SCREEN that names the application, every scope it asked for, every
 *   scope it will NOT get, and the patient it will be confined to - so the token acts as that
 *   clinician, narrowed to READ, narrowed again by the scopes, and narrowed again to one patient
 *   when the scopes are patient/ ones. PKCE is REQUIRED (S256 only).
 *
 *   CLIENT CREDENTIALS, for a registered system with a key. It proves itself with a JWT it signed
 *   (private_key_jwt), verified against the JWKS the hospital registered for it, inline or at a
 *   jwks_uri the HOSPITAL registered (fetched through the hardened fetch, cached, refreshed once on
 *   a miss) - never at a URL the client named in the request. Its token acts as `smart:<client>`.
 *
 * LAUNCH AND PATIENT CONTEXT. `launch` (EHR launch) resolves a launch grant the ward created for one
 * patient and encounter; `launch/patient` (standalone) asks the clinician to name the patient on the
 * consent screen. Either way the token carries `patient` (and `encounter`), and the bearer's reads
 * are FENCED TO THAT COMPARTMENT by the read layer, not by trusting a `patient=` parameter.
 *
 * REFRESH TOKENS (`offline_access` / `online_access`) are opaque, hashed, rotated on every use, and
 * a rotated token presented again revokes its whole family: that is the one signal of theft a server
 * can see. ID TOKENS (`openid`, optionally `fhirUser`) are ES256 JWTs signed with the hospital's
 * key (WSQ_SMART_SIGNING_JWK); without a key the scope is dropped and said so, never faked.
 *
 * TOKENS ARE OPAQUE, HASHED AT REST AND NEVER RETURNED TWICE. A grant is looked up by the digest of
 * the token, so a stolen record cannot be replayed as a token. Expiry is the record's, not the
 * token's; revocation is a new version of the grant and cannot be deleted afterwards. NO WRITES:
 * a bearer's actor has an empty write scope and the external door has no write route.
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
import { CANONICAL_TYPE, FHIR_TYPE, resolveId } from "./fhir.js";
import { hit as rateHit } from "./rate-limit.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";

const str = (v) => (v == null ? "" : String(v).trim());
const GRANT_TYPE = "SmartGrant";

const CODE_TTL_SECONDS = 300;
const AUTHZ_TTL_SECONDS = 600;
const LAUNCH_TTL_SECONDS = 300;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const MAX_TOKEN_TTL_SECONDS = 4 * 3600;
const DEFAULT_REFRESH_TTL_SECONDS = 24 * 3600;
const MAX_REFRESH_TTL_SECONDS = 30 * 24 * 3600;
const ASSERTION_MAX_LIFETIME_SECONDS = 300;
const JWKS_CACHE_MS = 3600000;
const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** The FHIR resource names a scope may name: everything exported, plus Provenance. */
const SCOPE_RESOURCES = Object.freeze([...Object.values(FHIR_TYPE), "Provenance", "*"]);
/** The scopes that are not resource scopes but mean something here. */
const SPECIAL_SCOPES = Object.freeze(["launch", "launch/patient", "openid", "fhirUser", "offline_access", "online_access"]);

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
    // The HOSPITAL registered this URL. A client never names one in a request.
    jwksUri: /^https:\/\//.test(str(c.jwksUri)) ? str(c.jwksUri) : null,
  };
}

/** PURE. `user/Observation.read` -> {context, resource, access}, or null when it is not a resource scope this server honours. */
function parseScope(s) {
  const m = /^(user|system|patient)\/([A-Za-z*]+)\.(read|rs)$/.exec(str(s));
  if (!m || !SCOPE_RESOURCES.includes(m[2])) return null;
  return { context: m[1], resource: m[2], access: "read", raw: `${m[1]}/${m[2]}.read` };
}

/**
 * PURE. The scopes actually granted: requested, intersected with what the client was registered
 * for, never widened. A registered `user/*.read` covers any `user/X.read`; a registered `user/X.read`
 * does not cover `user/*.read`. Special scopes (launch, openid, offline_access...) are granted when
 * the client was registered for them by name. Anything unparseable is dropped and named.
 * `contexts` is one context or a list; the authorization code flow allows user AND patient.
 */
function grantScopes(requested, clientScopes, contexts) {
  const ctxs = Array.isArray(contexts) ? contexts : [contexts];
  const words = str(requested).split(/\s+/).filter(Boolean);
  const asked = words.map(parseScope).filter(Boolean).filter((s) => ctxs.includes(s.context));
  const allowed = (clientScopes || []).map(parseScope).filter(Boolean).filter((s) => ctxs.includes(s.context));
  const covers = (a, s) => a.context === s.context && (a.resource === "*" || a.resource === s.resource);
  const granted = asked.filter((s) => allowed.some((a) => covers(a, s))).map((g) => g.raw);
  const special = words.filter((w) => SPECIAL_SCOPES.includes(w) && (clientScopes || []).includes(w));
  const all = [...new Set([...granted, ...special])];
  const dropped = words.filter((raw) => !all.includes(raw) && !(parseScope(raw) && all.includes(parseScope(raw).raw)));
  return { granted: all, dropped };
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

/**
 * PURE. Which canonical types a token may read ONLY inside its patient compartment: those granted by
 * a patient/ scope and NOT also by a user/ or system/ scope. null = no type is fenced (no patient/
 * scopes); [] with a wildcard user scope = nothing fenced; "*" = every type is fenced.
 */
function compartmentTypesFor(scopes) {
  const parsed = (scopes || []).map(parseScope).filter(Boolean);
  const patient = parsed.filter((s) => s.context === "patient");
  if (!patient.length) return null;
  const wide = parsed.filter((s) => s.context !== "patient");
  if (wide.some((s) => s.resource === "*")) return [];
  const wideTypes = new Set(wide.map((s) => CANONICAL_TYPE[s.resource]).filter(Boolean));
  if (patient.some((s) => s.resource === "*")) return wideTypes.size ? Object.keys(FHIR_TYPE).filter((t) => !wideTypes.has(t)) : "*";
  return [...new Set(patient.map((s) => CANONICAL_TYPE[s.resource]).filter((t) => t && !wideTypes.has(t)))];
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { const t = str(s).replace(/-/g, "+").replace(/_/g, "/"); const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : ""; const bin = atob(t + pad); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const utf8 = (s) => new TextEncoder().encode(s);

/** S256 only. `plain` is refused: a code challenge equal to its verifier protects nothing. */
async function pkceMatches(verifier, challenge) {
  const v = str(verifier);
  if (v.length < 43 || v.length > 128) return false;
  const digest = await crypto.subtle.digest("SHA-256", utf8(v));
  return sameSecret(b64url(digest), str(challenge));
}

function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** PURE. The document at .well-known/smart-configuration. It declares exactly what is implemented. */
function smartConfiguration(base, config, opts) {
  const o = opts || {};
  const clients = (config && config.smart && Array.isArray(config.smart.clients)) ? config.smart.clients : [];
  const registered = clients.flatMap((c) => (Array.isArray(c.scopes) ? c.scopes : []));
  const scopes = [...new Set([...registered.map(parseScope).filter(Boolean).map((s) => s.raw), ...registered.filter((s) => SPECIAL_SCOPES.includes(s))])];
  const signing = !!o.signingKey;
  return {
    issuer: base,
    authorization_endpoint: `${base}/smart/authorize`,
    token_endpoint: `${base}/smart/token`,
    revocation_endpoint: `${base}/smart/revoke`,
    ...(signing ? { jwks_uri: `${base}/.well-known/jwks.json` } : {}),
    token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256", "ES256"],
    grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes.filter((s) => signing || (s !== "openid" && s !== "fhirUser")),
    capabilities: [
      "launch-ehr", "launch-standalone", "client-public", "client-confidential-asymmetric",
      "context-ehr-patient", "context-ehr-encounter", "context-standalone-patient",
      "permission-patient", "permission-user", "permission-offline", "permission-online", "permission-v2",
      ...(signing ? ["sso-openid-connect"] : []),
    ],
    /* Said in the document, where a machine reads it. */
    "x-wardsynq": { launch: true, patientScopes: true, refreshTokens: true, idToken: signing, writes: false },
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

/** PURE-ish. Verifies one JWS against one key set. */
async function verifyAgainst(d, keys, spec) {
  const kid = str(d.header.kid);
  const jwk = kid ? keys.find((k) => str(k.kid) === kid) : (keys.length === 1 ? keys[0] : null);
  if (!jwk) return { ok: false, detail: kid ? `no registered key with kid ${kid}` : "the client has several keys and the assertion names none" };
  if (str(jwk.kty) !== spec.kty) return { ok: false, detail: "the registered key does not match the assertion's algorithm" };
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, spec.importAlg, false, ["verify"]);
    const ok = await crypto.subtle.verify(spec.verifyAlg, key, d.signature, utf8(d.signingInput));
    return ok ? { ok: true, kid: kid || str(jwk.kid) || null } : { ok: false, detail: "signature did not verify against the registered key" };
  } catch { return { ok: false, detail: "signature did not verify against the registered key" }; }
}

/**
 * Verifies a private_key_jwt client assertion against the client's REGISTERED keys.
 *
 * Checks, in order and all required: a supported alg; a registered key with that kid (or the only
 * key when there is one); the signature; iss and sub equal to the client id; aud equal to THIS
 * token endpoint; exp in the future and not more than five minutes away; a jti. The keys come from
 * the hospital's own configuration - inline, or at the jwks_uri the hospital registered, fetched by
 * `opts.jwksFetch` - and never from a URL the client supplied.
 */
async function verifyClientAssertion(jwt, client, opts) {
  const d = decodeJws(jwt);
  if (!d) return { ok: false, error: "invalid_client", detail: "client_assertion is not a compact JWS" };
  const alg = str(d.header.alg);
  const spec = ALG[alg];
  if (!spec) return { ok: false, error: "invalid_client", detail: `alg ${alg || "(none)"} is not accepted; RS256 or ES256` };
  let keys = (client.jwks && client.jwks.keys) || [];
  let v = keys.length ? await verifyAgainst(d, keys, spec) : { ok: false, detail: "no registered key" };
  if (!v.ok && client.jwksUri && opts && typeof opts.jwksFetch === "function") {
    /* A key the hospital registered by URL: fetched (cached), and on a miss fetched ONCE more fresh,
     * because a rotation is the ordinary reason a kid is unknown. */
    const cached = await opts.jwksFetch(client.jwksUri, false);
    if (cached && cached.length) v = await verifyAgainst(d, cached, spec);
    if (!v.ok) { const fresh = await opts.jwksFetch(client.jwksUri, true); if (fresh && fresh.length) v = await verifyAgainst(d, fresh, spec); }
  }
  if (!v.ok) return { ok: false, error: "invalid_client", detail: v.detail };

  const p = d.payload || {};
  const now = Number.isFinite(opts && opts.nowSeconds) ? opts.nowSeconds : Math.floor(Date.now() / 1000);
  if (str(p.iss) !== client.clientId || str(p.sub) !== client.clientId) return { ok: false, error: "invalid_client", detail: "iss and sub must both be the client id" };
  const aud = Array.isArray(p.aud) ? p.aud.map(str) : [str(p.aud)];
  if (!aud.includes(str(opts && opts.tokenEndpoint))) return { ok: false, error: "invalid_client", detail: "aud must be this token endpoint" };
  const exp = Number(p.exp);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, error: "invalid_client", detail: "assertion expired" };
  if (exp - now > ASSERTION_MAX_LIFETIME_SECONDS) return { ok: false, error: "invalid_client", detail: "assertion lifetime exceeds five minutes" };
  if (!str(p.jti)) return { ok: false, error: "invalid_client", detail: "jti is required" };
  return { ok: true, claims: p, kid: v.kid };
}

/* ---- the hospital's signing key, for id_tokens ------------------------------------------------ */

/** The private JWK from the environment, or null. Nothing is signed without it and nothing pretends to be. */
function signingKey(env) {
  const raw = env && env.WSQ_SMART_SIGNING_JWK;
  if (!raw) return null;
  try {
    const jwk = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) return null;
    return { jwk, kid: str(jwk.kid) || "wsq-smart-1" };
  } catch { return null; }
}

/** PURE. The public half, as a JWKS document. */
function publicJwks(key) {
  if (!key) return { keys: [] };
  const { d, key_ops, ext, ...pub } = key.jwk;
  return { keys: [{ ...pub, kid: key.kid, use: "sig", alg: "ES256", key_ops: ["verify"] }] };
}

/** Signs a JWT (ES256) with the hospital's key. */
async function signJwt(key, claims) {
  const h = b64url(utf8(JSON.stringify({ alg: "ES256", typ: "JWT", kid: key.kid })));
  const p = b64url(utf8(JSON.stringify(claims)));
  const k = await crypto.subtle.importKey("jwk", key.jwk, ALG.ES256.importAlg, false, ["sign"]);
  const sig = await crypto.subtle.sign(ALG.ES256.verifyAlg, k, utf8(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

/* ---- a registered jwks_uri, fetched through the hardened fetch and cached -------------------- */

const JWKS_CACHE = new Map();
function jwksFetcher(env, fetchImpl) {
  const kv = env && env.WSQ_TX_KV;
  const doFetch = fetchImpl || (typeof fetch === "function" ? makeSafeFetch(fetch) : null);
  return async (uri, fresh) => {
    const key = `jwks:${uri}`;
    if (!fresh) {
      const mem = JWKS_CACHE.get(key);
      if (mem && mem.expiresAt > Date.now()) return mem.keys;
      if (kv && typeof kv.get === "function") { try { const s = await kv.get(key); if (s) { const keys = JSON.parse(s); JWKS_CACHE.set(key, { keys, expiresAt: Date.now() + JWKS_CACHE_MS }); return keys; } } catch { /* fall through to fetch */ } }
    }
    if (!doFetch) return [];
    try {
      const res = await doFetch(uri, { method: "GET", headers: { Accept: "application/json" } });
      if (!res || !res.ok) return [];
      const body = await res.json();
      const keys = body && Array.isArray(body.keys) ? body.keys.filter((k) => k && typeof k === "object") : [];
      JWKS_CACHE.set(key, { keys, expiresAt: Date.now() + JWKS_CACHE_MS });
      if (kv && typeof kv.put === "function") { try { await kv.put(key, JSON.stringify(keys), { expirationTtl: Math.ceil(JWKS_CACHE_MS / 1000) }); } catch { /* cache only */ } }
      return keys;
    } catch { return []; }
  };
}
function resetJwksCache() { JWKS_CACHE.clear(); }

/* ---- grants ------------------------------------------------------------------------------------ */

/** PURE. The grant record. Only digests of secrets ever live here. */
function SmartGrant(input) {
  const i = input || {};
  return {
    resourceType: GRANT_TYPE, id: i.id,
    kind: i.kind,                                   // "code" | "token" | "jti" | "authz" | "launch" | "refresh"
    clientId: i.clientId, clientKind: i.clientKind,
    subject: i.subject, subjectKind: i.subjectKind, // "human" | "service"
    scopes: i.scopes || [],
    readTypes: i.readTypes === undefined ? null : i.readTypes,
    patientId: i.patientId || null, encounterId: i.encounterId || null,
    redirectUri: i.redirectUri || null,
    codeChallenge: i.codeChallenge || null,
    params: i.params || null,                       // an authz transaction's request, awaiting consent
    familyId: i.familyId || null,                   // refresh tokens: the chain they belong to
    nonce: i.nonce || null,
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

/* ---- the consent screen ------------------------------------------------------------------------ */

const esc = (s) => str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * PURE. The consent page. Everything the clinician is agreeing to is on it in plain words: the
 * application by its registered name, each scope it will get and each it will NOT, the patient it
 * is confined to (or a field to name one), and how long the token lives. The form carries the
 * transaction id as its anti-forgery token: unguessable, single-use, bound to this clinician.
 * No script, no external asset, no em-dash.
 */
function consentPage(model) {
  const m = model || {};
  const scopeWords = (s) => {
    const p = parseScope(s);
    if (p) return `${p.context === "patient" ? "Read this patient's" : p.context === "user" ? "Read, as you, any" : "Read"} ${p.resource === "*" ? "record" : p.resource} data`;
    return { launch: "Use the patient and encounter you launched it for", "launch/patient": "Be confined to one patient you name below", openid: "Know who you are (your identity, not your password)", fhirUser: "See your FHIR user identity", offline_access: "Keep access after you leave (a refresh token)", online_access: "Keep access while you are signed in (a refresh token)" }[s] || s;
  };
  const li = (list, cls) => (list && list.length ? `<ul class="${cls}">${list.map((s) => `<li><code>${esc(s)}</code> - ${esc(scopeWords(s))}</li>`).join("")}</ul>` : "<p>none</p>");
  const patientBlock = m.patient
    ? `<p class="ctx">Confined to patient <strong>${esc(m.patient.display || m.patient.id)}</strong>${m.encounter ? ` (encounter ${esc(m.encounter)})` : ""}.</p>`
    : m.needsPatient ? `<label>Patient this application may see (MRN or record id)<input name="patient" required autocomplete="off" value="${esc(m.patientInput || "")}"></label>${m.patientError ? `<p class="err">${esc(m.patientError)}</p>` : ""}` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allow ${esc(m.clientName)}?</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#111}main{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}h1{font-size:20px;margin:0 0 8px}code{background:#eef;padding:1px 4px;border-radius:4px}ul{padding-left:20px}.no li{color:#666}.ctx{background:#eef9f0;padding:8px 12px;border-radius:8px}label{display:block;margin:12px 0}input{display:block;width:100%;padding:8px;font-size:16px;border:1px solid #bbb;border-radius:6px;margin-top:4px}.err{color:#b00020}button{font-size:16px;padding:10px 18px;border-radius:8px;border:0;margin-right:8px}.allow{background:#0b6e4f;color:#fff}.deny{background:#ddd}small{color:#555}</style></head>
<body><main><h1>Allow ${esc(m.clientName)} to read this record as you?</h1>
<p>Signed in as <strong>${esc(m.who)}</strong> at <strong>${esc(m.hospital)}</strong>.</p>
<h2>It will be able to</h2>${li(m.granted, "yes")}
<h2>It asked for, and will NOT get</h2>${li(m.dropped, "no")}
${patientBlock}
<p><small>The token acts as you, read-only, for at most ${esc(String(Math.round((m.tokenTtlSeconds || 3600) / 60)))} minutes${m.refresh ? ", and may be refreshed for up to " + esc(String(Math.round((m.refreshTtlSeconds || 86400) / 3600))) + " hours" : ""}. Every read it makes is recorded against your name. You can revoke it at any time.</small></p>
<form method="post" action="${esc(m.action)}"><input type="hidden" name="authz" value="${esc(m.authz)}"><button class="allow" name="decision" value="allow">Allow</button><button class="deny" name="decision" value="deny">Deny</button></form>
</main></body></html>`;
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
const rateDeps = (env) => ({ kv: env && env.WSQ_RL_KV, binding: env && env.WSQ_RL });

/* ---- launch: the ward starts an application for one patient ---------------------------------- */

/**
 * An EHR launch. The clinician, on the ward, names the application and the patient (and encounter)
 * they are looking at; the application then arrives at /smart/authorize with `launch=<token>` and
 * the context is fixed before the consent screen is even drawn. Five minutes, single use.
 * ctx: { migration, config, base, clientId, patientId, encounterId?, actorDeps, recordDeps }
 */
async function createLaunch(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, error: "not_found" };
  const client = findClient(ctx.config, ctx.clientId);
  if (!client || client.kind !== "public") return { ok: false, status: 400, error: "invalid_client", detail: "launch is for a registered public application" };
  if (!client.scopes.includes("launch")) return { ok: false, status: 400, error: "invalid_client", detail: "this application is not registered for launch" };
  if (!str(ctx.patientId)) return { ok: false, status: 422, error: "patient_required" };
  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps); }
  catch (e) { const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502; return { ok: false, status, error: status === 401 ? "auth" : "permission", detail: str(e && e.message) }; }
  // The patient must be one this clinician can read, through the governed store.
  const reader = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
  let patient = null;
  try { patient = await reader.get("Patient", str(ctx.patientId)); } catch { patient = null; }
  if (!patient) return { ok: false, status: 404, error: "not_found", detail: "no such patient here" };
  const launch = randomToken(32);
  const now = new Date();
  const grant = SmartGrant({ id: await grantIdFor("launch", launch), kind: "launch", clientId: client.clientId, clientKind: client.kind, subject: resolved.actor.id, subjectKind: "human", scopes: [], readTypes: [], patientId: patient.id, encounterId: str(ctx.encounterId) || null, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + LAUNCH_TTL_SECONDS * 1000).toISOString(), issuedBy: resolved.actor.id });
  try { await serviceFor(ctx, grantActor()).put(grant); } catch { return { ok: false, status: 502, error: "server_error" }; }
  await audit(ctx, "smart.launch", { actor: resolved.actor.id, scope: { clientId: client.clientId } });
  return { ok: true, launch, iss: str(ctx.base), expiresInSeconds: LAUNCH_TTL_SECONDS, launchUrl: null };
}

/* ---- authorize -------------------------------------------------------------------------------- */

/** Everything the authorize endpoint validates about a request BEFORE anyone is asked anything. */
async function checkAuthorizeRequest(request, env, ctx, p) {
  const mig = ctx.migration;
  const clientId = str(p.get("client_id")), redirectUri = str(p.get("redirect_uri")), state = str(p.get("state"));
  const client = findClient(ctx.config, clientId);
  /* Errors about the CLIENT or the REDIRECT are never redirected: an attacker who controls the
   * redirect_uri would otherwise receive the error, and the user's browser would be sent to it. */
  if (!client) return { fail: oauthError(400, "invalid_client", "unknown client_id") };
  if (client.kind !== "public") return { fail: oauthError(400, "unauthorized_client", "a backend client uses client_credentials, not the authorization endpoint") };
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { fail: oauthError(400, "invalid_request", "redirect_uri must exactly match one registered for this client") };

  const rl = await rateHit(rateDeps(env), { key: `smart:authz:${mig.tenantId}:${clientId}`, limit: 60, windowMs: 60000 });
  if (!rl.allowed) return { fail: { ok: false, status: 429, body: { error: "temporarily_unavailable", error_description: "too many authorization requests; retry later" }, retryAfter: rl.retryAfterSeconds } };

  // From here, errors MAY go back to the registered redirect_uri, per OAuth.
  const back = (error, detail) => ({ fail: { ok: false, status: 302, redirect: `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(detail)}${state ? "&state=" + encodeURIComponent(state) : ""}` } });
  if (str(p.get("response_type")) !== "code") return back("unsupported_response_type", "response_type must be code");
  const challenge = str(p.get("code_challenge")), method = str(p.get("code_challenge_method"));
  if (!challenge || method !== "S256") return back("invalid_request", "PKCE with S256 is required");
  const aud = str(p.get("aud"));
  if (aud && aud !== str(ctx.base)) return back("invalid_request", "aud must be this FHIR server");

  const { granted, dropped } = grantScopes(p.get("scope"), client.scopes, ["user", "patient"]);
  const key = signingKey(env);
  const finalGranted = granted.filter((s) => key || (s !== "openid" && s !== "fhirUser"));
  const finalDropped = [...dropped, ...granted.filter((s) => !finalGranted.includes(s))];
  if (!finalGranted.some((s) => parseScope(s))) return back("invalid_scope", `no requested resource scope is registered for this client${finalDropped.length ? ": " + finalDropped.join(" ") : ""}`);
  if (finalGranted.some((s) => parseScope(s) && parseScope(s).context === "patient") && !finalGranted.includes("launch") && !finalGranted.includes("launch/patient")) {
    return back("invalid_scope", "patient/ scopes need a patient context: request launch (EHR launch) or launch/patient (standalone)");
  }

  // The clinician authorising. They must be able to read this hospital's record themselves.
  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps); }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { fail: { ok: false, status, body: { error: status === 401 ? "login_required" : "access_denied", error_description: str(e && e.message) } } };
  }

  // An EHR launch names its patient before anyone is asked. The launch must be this clinician's and this client's.
  let context = { patientId: null, encounterId: null };
  const launchToken = str(p.get("launch"));
  if (finalGranted.includes("launch")) {
    if (!launchToken) return back("invalid_request", "scope launch needs the launch parameter the ward issued");
    let lg = null;
    try { lg = await serviceFor(ctx, grantActor()).get(GRANT_TYPE, await grantIdFor("launch", launchToken)); } catch { lg = null; }
    if (!lg || lg.kind !== "launch" || lg.clientId !== client.clientId || lg.subject !== resolved.actor.id || lg.redeemedAt || !grantLive(lg, new Date().toISOString()).ok) return back("invalid_request", "the launch is not valid for this application and clinician, or has expired");
    context = { patientId: lg.patientId, encounterId: lg.encounterId, launchGrant: lg };
  }
  return { client, redirectUri, state, challenge, granted: finalGranted, dropped: finalDropped, resolved, context, back, needsPatient: !context.patientId && finalGranted.includes("launch/patient"), nonce: str(p.get("nonce")) || null };
}

/**
 * GET: the consent screen. Nothing is granted until the clinician says so on it.
 * ctx: { migration, config, base, params (URLSearchParams), actorDeps, recordDeps }
 * Returns { html } for the page, or an OAuth result.
 */
async function authorize(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const p = ctx.params;
  const c = await checkAuthorizeRequest(request, env, ctx, p);
  if (c.fail) return c.fail;

  // The pending transaction. Its id is the form's anti-forgery token: unguessable and bound to this clinician.
  const authz = randomToken(32);
  const now = new Date();
  const params = {};
  for (const [k, v] of p.entries()) params[k] = v;
  const grant = SmartGrant({
    id: await grantIdFor("authz", authz), kind: "authz", clientId: c.client.clientId, clientKind: c.client.kind,
    subject: c.resolved.actor.id, subjectKind: "human", scopes: c.granted, readTypes: readTypesFor(c.granted),
    patientId: c.context.patientId, encounterId: c.context.encounterId, redirectUri: c.redirectUri, codeChallenge: c.challenge, params, nonce: c.nonce,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + AUTHZ_TTL_SECONDS * 1000).toISOString(), issuedBy: c.resolved.actor.id,
  });
  try { await serviceFor(ctx, grantActor()).put(grant); }
  catch { return { ok: false, status: 502, body: { error: "server_error", error_description: "could not record the authorization request" } }; }
  const ttl = Math.min(MAX_TOKEN_TTL_SECONDS, Math.max(60, Number(ctx.config.smart.tokenTtlSeconds) || DEFAULT_TOKEN_TTL_SECONDS));
  const refreshTtl = Math.min(MAX_REFRESH_TTL_SECONDS, Math.max(300, Number(ctx.config.smart.refreshTtlSeconds) || DEFAULT_REFRESH_TTL_SECONDS));
  const html = consentPage({
    clientName: c.client.name, who: c.resolved.actor.display || c.resolved.actor.id, hospital: str(ctx.hospitalName) || mig.tenantId,
    granted: c.granted, dropped: c.dropped, patient: c.context.patientId ? { id: c.context.patientId, display: c.context.launchGrant ? c.context.patientId : c.context.patientId } : null, encounter: c.context.encounterId,
    needsPatient: c.needsPatient, action: `${str(ctx.base)}/smart/authorize`, authz, tokenTtlSeconds: ttl, refresh: c.granted.includes("offline_access") || c.granted.includes("online_access"), refreshTtlSeconds: refreshTtl,
  });
  return { ok: true, status: 200, html, authz, granted: c.granted, dropped: c.dropped };
}

/**
 * POST: the clinician's decision. The transaction must be theirs, live and unspent; a standalone
 * patient launch must name a patient this clinician can read. Allow issues the code; deny sends
 * access_denied to the application.
 * ctx: { migration, config, base, form (URLSearchParams), actorDeps, recordDeps }
 */
async function decide(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const f = ctx.form;
  const authz = str(f.get("authz")), decision = str(f.get("decision"));
  if (!authz) return oauthError(400, "invalid_request", "authz is required");
  const svc = serviceFor(ctx, grantActor());
  let g = null;
  try { g = await svc.get(GRANT_TYPE, await grantIdFor("authz", authz)); } catch { g = null; }
  const now = new Date();
  if (!g || g.kind !== "authz" || g.redeemedAt || !grantLive(g, now.toISOString()).ok) return oauthError(400, "invalid_request", "the authorization request is not valid or has expired; start again");
  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps); }
  catch (e) { const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502; return { ok: false, status, body: { error: status === 401 ? "login_required" : "access_denied" } }; }
  if (resolved.actor.id !== g.subject) return oauthError(403, "access_denied", "this authorization request belongs to another user");
  const client = findClient(ctx.config, g.clientId);
  if (!client) return oauthError(400, "invalid_client", "the client is no longer registered");
  const redirectUri = g.redirectUri, state = str(g.params && g.params.state);
  const back = (error, detail) => ({ ok: false, status: 302, redirect: `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(detail)}${state ? "&state=" + encodeURIComponent(state) : ""}` });
  const { meta, version, ...rest } = g;
  const spend = async (extra) => svc.put({ ...rest, ...extra, redeemedAt: now.toISOString() }, { expectedVersion: version });

  if (decision !== "allow") {
    try { await spend({}); } catch { /* a deny that cannot be recorded is still a deny */ }
    await audit(ctx, "smart.authorize.denied", { actor: resolved.actor.id, scope: { clientId: client.clientId } });
    return back("access_denied", "the user denied the request");
  }

  // Standalone launch: the clinician names the patient. Resolved through THEIR governed read.
  let patientId = g.patientId, encounterId = g.encounterId;
  if (!patientId && g.scopes.includes("launch/patient")) {
    const wanted = str(f.get("patient"));
    const reader = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    let found = null;
    if (wanted) {
      try { found = await reader.get("Patient", await resolveId(reader, "Patient", wanted)); } catch { found = null; }
      /* An MRN is an IDENTIFIER, so it is resolved through the identity index rather than by
       * scanning a roster of the latest 1000 patients. The scan told a clinician "No patient here
       * matches that MRN" for anybody who happened to sit outside that roster - on a hospital of any
       * real size, most of the register - and the app then launched with no patient context at all.
       * The lookup is exact, tenant-scoped, and costs the same at any population. */
      if (!found) {
        try { found = ((await reader.findPatientsByIdentifier({ mrn: wanted })) || [])[0] || null; } catch { found = null; }
      }
    }
    if (!found) {
      const ttl = Math.min(MAX_TOKEN_TTL_SECONDS, Math.max(60, Number(ctx.config.smart.tokenTtlSeconds) || DEFAULT_TOKEN_TTL_SECONDS));
      return { ok: true, status: 200, html: consentPage({ clientName: client.name, who: resolved.actor.display || resolved.actor.id, hospital: str(ctx.hospitalName) || mig.tenantId, granted: g.scopes, dropped: [], needsPatient: true, patientInput: wanted, patientError: wanted ? "No patient here matches that MRN or id." : "Name the patient this application may see.", action: `${str(ctx.base)}/smart/authorize`, authz, tokenTtlSeconds: ttl }) };
    }
    patientId = found.id;
  }

  const code = randomToken(32);
  const codeGrant = SmartGrant({
    id: await grantIdFor("code", code), kind: "code", clientId: client.clientId, clientKind: client.kind,
    subject: g.subject, subjectKind: "human", scopes: g.scopes, readTypes: g.readTypes, patientId, encounterId,
    redirectUri, codeChallenge: g.codeChallenge, nonce: g.nonce,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString(), issuedBy: g.subject,
  });
  try {
    await svc.put(codeGrant);
    await spend({ tokenGrantId: codeGrant.id });
    if (g.scopes.includes("launch") && str(g.params && g.params.launch)) {
      const lg = await svc.get(GRANT_TYPE, await grantIdFor("launch", str(g.params.launch)));
      if (lg && !lg.redeemedAt) { const { meta: lm, version: lv, ...lrest } = lg; await svc.put({ ...lrest, redeemedAt: now.toISOString(), tokenGrantId: codeGrant.id }, { expectedVersion: lv }); }
    }
  } catch (e) { return { ok: false, status: 502, body: { error: "server_error", error_description: "could not record the authorization" } }; }
  await audit(ctx, "smart.authorize", { actor: g.subject, scope: { clientId: client.clientId, scopes: g.scopes, patient: !!patientId } });
  return { ok: true, status: 302, redirect: `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}${state ? "&state=" + encodeURIComponent(state) : ""}`, granted: g.scopes };
}

/* ---- token ------------------------------------------------------------------------------------ */

/**
 * The token endpoint. Form-encoded, per OAuth.
 * ctx: { migration, config, base, form (URLSearchParams), recordDeps, fetchImpl? }
 */
async function token(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const f = ctx.form;
  const grantType = str(f.get("grant_type"));
  const clientId = str(f.get("client_id")) || (decodeJws(f.get("client_assertion")) || { payload: {} }).payload.sub || "";
  const client = findClient(ctx.config, clientId);
  if (!client) return oauthError(401, "invalid_client", "unknown client");

  const rl = await rateHit(rateDeps(env), { key: `smart:token:${mig.tenantId}:${client.clientId}`, limit: 30, windowMs: 60000 });
  if (!rl.allowed) return { ok: false, status: 429, body: { error: "temporarily_unavailable", error_description: "too many token requests; retry later" }, retryAfter: rl.retryAfterSeconds };

  const svc = serviceFor(ctx, grantActor());
  const now = new Date();
  const ttl = Math.min(MAX_TOKEN_TTL_SECONDS, Math.max(60, Number(ctx.config.smart.tokenTtlSeconds) || DEFAULT_TOKEN_TTL_SECONDS));
  const refreshTtl = Math.min(MAX_REFRESH_TTL_SECONDS, Math.max(300, Number(ctx.config.smart.refreshTtlSeconds) || DEFAULT_REFRESH_TTL_SECONDS));
  const key = signingKey(env);

  const mint = async ({ subject, subjectKind, scopes, issuedBy, patientId, encounterId, familyId }) => {
    const access = randomToken(32);
    const g = SmartGrant({
      id: await grantIdFor("token", access), kind: "token", clientId: client.clientId, clientKind: client.kind,
      subject, subjectKind, scopes, readTypes: readTypesFor(scopes), patientId: patientId || null, encounterId: encounterId || null, familyId: familyId || null,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(), issuedBy,
    });
    await svc.put(g);
    return { access, grantId: g.id };
  };
  const mintRefresh = async ({ subject, scopes, familyId, patientId, encounterId, issuedBy }) => {
    const refresh = randomToken(32);
    const g = SmartGrant({
      id: await grantIdFor("refresh", refresh), kind: "refresh", clientId: client.clientId, clientKind: client.kind,
      subject, subjectKind: "human", scopes, readTypes: readTypesFor(scopes), patientId: patientId || null, encounterId: encounterId || null, familyId,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + refreshTtl * 1000).toISOString(), issuedBy,
    });
    await svc.put(g);
    return refresh;
  };
  const idTokenFor = async ({ subject, scopes, nonce, display }) => {
    if (!key || !scopes.includes("openid")) return null;
    const iat = Math.floor(now.getTime() / 1000);
    const claims = { iss: str(ctx.base), sub: subject, aud: client.clientId, iat, exp: iat + ttl, ...(nonce ? { nonce } : {}), ...(display ? { name: display } : {}) };
    if (scopes.includes("fhirUser")) claims.fhirUser = `${str(ctx.base)}/Practitioner/${encodeURIComponent(subject)}`;
    return signJwt(key, claims);
  };
  const response = (minted, scopes, extra) => ({ ok: true, status: 200, body: { access_token: minted.access, token_type: "Bearer", expires_in: ttl, scope: scopes.join(" "), ...extra } });

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

    let minted, refresh = null, idToken = null;
    try {
      minted = await mint({ subject: g.subject, subjectKind: g.subjectKind, scopes: g.scopes, issuedBy: g.subject, patientId: g.patientId, encounterId: g.encounterId });
      const { meta, version, ...rest } = g;
      /* The code is spent in the same breath. A second exchange of the same code would otherwise
       * mint a second token, which is exactly the replay PKCE exists to stop. */
      await svc.put({ ...rest, redeemedAt: now.toISOString(), tokenGrantId: minted.grantId }, { expectedVersion: version });
      if (g.scopes.includes("offline_access") || g.scopes.includes("online_access")) refresh = await mintRefresh({ subject: g.subject, scopes: g.scopes, familyId: minted.grantId, patientId: g.patientId, encounterId: g.encounterId, issuedBy: g.subject });
      idToken = await idTokenFor({ subject: g.subject, scopes: g.scopes, nonce: g.nonce });
    } catch (e) {
      if (e instanceof GovernanceError) return oauthError(500, "server_error", "could not record the grant");
      return oauthError(500, "server_error", "could not issue the token");
    }
    await audit(ctx, "smart.token", { actor: g.subject, scope: { clientId: client.clientId, grant: "authorization_code", scopes: g.scopes, patient: !!g.patientId } });
    return response(minted, g.scopes, { ...(g.patientId ? { patient: g.patientId } : {}), ...(g.encounterId ? { encounter: g.encounterId } : {}), ...(refresh ? { refresh_token: refresh } : {}), ...(idToken ? { id_token: idToken } : {}) });
  }

  if (grantType === "refresh_token") {
    if (client.kind !== "public") return oauthError(400, "unauthorized_client", "refresh tokens are issued to applications a person authorised");
    const presented = str(f.get("refresh_token"));
    if (!presented) return oauthError(400, "invalid_request", "refresh_token is required");
    let g = null;
    try { g = await svc.get(GRANT_TYPE, await grantIdFor("refresh", presented)); } catch { g = null; }
    const deny = oauthError(400, "invalid_grant", "the refresh token is not valid");
    if (!g || g.kind !== "refresh" || g.clientId !== client.clientId) return deny;
    if (g.redeemedAt) {
      /* A ROTATED TOKEN PRESENTED AGAIN. Either the client lost track, or somebody else has a copy.
       * The server cannot tell which, so the whole family dies: every live token descended from the
       * same authorisation is revoked, and the person authorises again. */
      let family = [];
      try { family = ((await svc.list(GRANT_TYPE, 1000)) || []).filter((x) => x && x.familyId === g.familyId && !x.revokedAt && (x.kind === "refresh" || x.kind === "token")); } catch { family = []; }
      for (const x of [...family, ...(g.familyId ? [] : [])]) { try { const { meta, version, ...rest } = x; await svc.put({ ...rest, revokedAt: now.toISOString(), revokedBy: "smart:refresh-reuse" }, { expectedVersion: version }); } catch { /* best effort, one by one */ } }
      try { const fam = await svc.get(GRANT_TYPE, g.familyId); if (fam && !fam.revokedAt) { const { meta, version, ...rest } = fam; await svc.put({ ...rest, revokedAt: now.toISOString(), revokedBy: "smart:refresh-reuse" }, { expectedVersion: version }); } } catch { /* the first token of the family */ }
      await audit(ctx, "smart.refresh.reuse", { actor: g.subject, scope: { clientId: client.clientId, family: g.familyId } });
      return deny;
    }
    if (!grantLive(g, now.toISOString()).ok) return deny;
    // The scope may be narrowed on refresh, never widened.
    const askedScopes = str(f.get("scope")) ? str(f.get("scope")).split(/\s+/).filter((s) => g.scopes.includes(s)) : g.scopes;
    const scopes = askedScopes.some((s) => parseScope(s)) ? askedScopes : g.scopes;
    let minted, refresh, idToken = null;
    try {
      minted = await mint({ subject: g.subject, subjectKind: "human", scopes, issuedBy: g.subject, patientId: g.patientId, encounterId: g.encounterId, familyId: g.familyId });
      const { meta, version, ...rest } = g;
      await svc.put({ ...rest, redeemedAt: now.toISOString(), tokenGrantId: minted.grantId }, { expectedVersion: version });
      refresh = await mintRefresh({ subject: g.subject, scopes, familyId: g.familyId, patientId: g.patientId, encounterId: g.encounterId, issuedBy: g.subject });
      idToken = await idTokenFor({ subject: g.subject, scopes });
    } catch (e) { return oauthError(500, "server_error", "could not issue the token"); }
    await audit(ctx, "smart.token", { actor: g.subject, scope: { clientId: client.clientId, grant: "refresh_token", scopes } });
    return response(minted, scopes, { ...(g.patientId ? { patient: g.patientId } : {}), ...(g.encounterId ? { encounter: g.encounterId } : {}), refresh_token: refresh, ...(idToken ? { id_token: idToken } : {}) });
  }

  if (grantType === "client_credentials") {
    if (client.kind !== "backend") return oauthError(400, "unauthorized_client", "this client is a public application; use the authorization code flow");
    if (str(f.get("client_assertion_type")) !== JWT_BEARER) return oauthError(400, "invalid_request", `client_assertion_type must be ${JWT_BEARER}`);
    const v = await verifyClientAssertion(f.get("client_assertion"), client, { tokenEndpoint: `${str(ctx.base)}/smart/token`, jwksFetch: jwksFetcher(env, ctx.fetchImpl) });
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
    return response(minted, granted, {});
  }

  return oauthError(400, "unsupported_grant_type", "authorization_code, refresh_token or client_credentials");
}

/* ---- the bearer, on a read ------------------------------------------------------------------- */

/**
 * Turns a Bearer token into the actor a FHIR read runs as. Returns null when there is no bearer,
 * so the caller can fall back to the ordinary session; returns {error} for a bearer that is bad.
 * `patientId` and `compartmentTypes` tell the read layer what to fence.
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
  const compartmentTypes = compartmentTypesFor(g.scopes);
  return { actor, tenant: { id: mig.tenantId }, role: "smart", source: `smart:${g.clientKind}`, grantId: g.id, scopes: g.scopes, patientId: g.patientId || null, encounterId: g.encounterId || null, compartmentTypes: g.patientId ? compartmentTypes : null };
}

/** Ends a token, or a refresh token and everything it can mint. The bearer itself, or a person with the hospital's admin capability. */
async function revoke(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !smartEnabled(ctx.config)) return { ok: false, status: 404, body: { error: "not_found" } };
  const tok = str(ctx.form && ctx.form.get("token"));
  if (!tok) return oauthError(400, "invalid_request", "token is required");
  const svc = serviceFor(ctx, grantActor());
  let g = null;
  try { g = await svc.get(GRANT_TYPE, await grantIdFor("token", tok)); } catch { g = null; }
  if (!g) { try { g = await svc.get(GRANT_TYPE, await grantIdFor("refresh", tok)); } catch { g = null; } }
  // RFC 7009: an unknown token is a 200. Revocation is not an oracle either.
  if (!g || g.revokedAt) return { ok: true, status: 200, body: {} };
  const bearer = await resolveBearer(request, env, ctx);
  const self = bearer && bearer.actor && bearer.actor.id === g.subject;
  let by = self ? g.subject : null;
  if (!by) {
    try { const r = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps); by = r.actor.id; }
    catch { return oauthError(401, "invalid_client", "revoking somebody else's token needs the hospital's own session"); }
  }
  const now = new Date().toISOString();
  try {
    const { meta, version, ...rest } = g;
    await svc.put({ ...rest, revokedAt: now, revokedBy: by }, { expectedVersion: version });
    if (g.kind === "refresh" && g.familyId) {
      const family = ((await svc.list(GRANT_TYPE, 1000)) || []).filter((x) => x && x.familyId === g.familyId && !x.revokedAt && x.id !== g.id);
      for (const x of family) { try { const { meta: xm, version: xv, ...xr } = x; await svc.put({ ...xr, revokedAt: now, revokedBy: by }, { expectedVersion: xv }); } catch { /* one by one */ } }
    }
  } catch { return oauthError(500, "server_error", "could not record the revocation"); }
  await audit(ctx, "smart.revoke", { actor: by, scope: { clientId: g.clientId, kind: g.kind } });
  return { ok: true, status: 200, body: {} };
}

export {
  GRANT_TYPE, CODE_TTL_SECONDS, AUTHZ_TTL_SECONDS, LAUNCH_TTL_SECONDS, DEFAULT_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TTL_SECONDS, MAX_REFRESH_TTL_SECONDS, ASSERTION_MAX_LIFETIME_SECONDS, JWT_BEARER, SCOPE_RESOURCES, SPECIAL_SCOPES,
  smartEnabled, findClient, parseScope, grantScopes, readTypesFor, compartmentTypesFor, pkceMatches, randomToken, smartConfiguration,
  decodeJws, verifyClientAssertion, signingKey, publicJwks, signJwt, jwksFetcher, resetJwksCache, SmartGrant, grantLive, consentPage,
  createLaunch, authorize, decide, token, resolveBearer, revoke,
};
