// test/connect/abdm/mock-gateway.mjs — adversarial mock ABDM gateway (+ HIP, wired in Stage 4). Test harness, not shipped.
import { ENDPOINTS, FIELDS } from "../../../functions/_connect/abdm/gateway.js";
import { CONSENT_FIELDS, HIREQUEST_FIELDS } from "../../../functions/_connect/abdm/hiu.js";
import { attachTransactionId, advanceStatus } from "../../../functions/_connect/abdm/state.js";
import { sealBundle, sharedSecret, generateKeyPair, nonce } from "../../../functions/_connect/abdm/fidelius.js";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const pathOf = (url) => new URL(url).pathname;

export function makeMockGateway(opts = {}) {
  const calls = [];
  const behavior = {
    sessionExpiresIn: opts.sessionExpiresIn ?? 300,
    failSession: !!opts.failSession,
    // independent adversarial delivery knobs — combinable; Stage 4 consumes (stored-not-consumed here)
    outOfOrder: false,
    duplicate: false,
    partial: false,
    retryAfterAck: false,
    callbackDelayMs: 0,
  };
  async function fetch(url, init = {}) {
    const path = pathOf(url);
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch {}
    calls.push({ path, headers: { ...(init.headers || {}) }, body });   // shallow-copy: no by-reference sharing
    if (path === ENDPOINTS.sessions) {
      if (behavior.failSession) return json({ error: "invalid_client" }, 401);
      return json({ [FIELDS.resAccessToken]: "mock-token-" + calls.length, tokenType: "bearer", [FIELDS.resExpiresIn]: behavior.sessionExpiresIn });
    }
    if ([ENDPOINTS.consentInit, ENDPOINTS.consentFetch, ENDPOINTS.hiRequest, ENDPOINTS.hiNotify].includes(path)) {
      return json({}, 202);      // ABDM is fire-and-forget; the real work comes back via webhooks (Stage 4)
    }
    return json({ error: "not_found", path }, 404);
  }
  return { fetch, calls, behavior, setBehavior: (b) => Object.assign(behavior, b) };
}

// ── Stage-4 Task-9: the end-to-end mock — plays the ABDM GATEWAY (outbound `.post`) AND the CM/HIP (inbound
//    webhooks fired back into the REAL handleIngress + a real Fidelius HIP-encrypt of a synthetic NDHM doc).
//    Fully real crypto: the CM/HIP signs every webhook body (and the inner consent artifact) with an RS256 test
//    key whose public JWK the mock publishes as the pinned JWKS — so the ingress body-signature verify AND
//    verifyConsentArtifact both run their REAL verify path (getPinnedJwks → verifyJws) against it. No stubs.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const bytesToB64url = (bytes) => { const u = new Uint8Array(bytes); let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const strToB64url = (s) => bytesToB64url(enc.encode(s));
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));   // 32-byte inputs only — safe for spread
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function signJws(header, payload, key) {
  const h = strToB64url(JSON.stringify(header)), p = strToB64url(JSON.stringify(payload));
  const sig = await subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, enc.encode(h + "." + p));
  return h + "." + p + "." + bytesToB64url(sig);
}
// Minimal Request-shaped stub the ingress understands: a compact-JWS body + case-insensitive header .get().
function mockRequest(body, headers) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return { method: "POST", url: "https://x/api/connect/ingress/abdm",
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) }, text: async () => body };
}
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// makeHiuMockGateway({ env, deps, handleIngress, tenantId, now, knobs }) — `deps` are the SAME ingress deps
// handleIngress is called with (so the webhooks land on the exact db/r2/kv/audit under test). Returns a harness
// exposing `gateway` (inject as the HIU functions' deps.gateway), `jwksFetch`/`jwks` (inject as the ingress
// deps.fetch so getPinnedJwks resolves this JWKS), and explicit `fire*` inbound-webhook methods the test drives.
export async function makeHiuMockGateway({ env, deps, handleIngress, tenantId = "t1", now, knobs = {} } = {}) {
  const nowIso = () => { const n = typeof now === "function" ? now() : now; return n || new Date().toISOString(); };
  const behavior = { outOfOrder: false, duplicate: false, partial: false, retryAfterAck: false, callbackDelayMs: 0, ...knobs };

  // CM/HIP signing key → pinned JWKS (mirrors jws.test.mjs's in-process key generation; no fixtures on disk).
  const rsa = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", rsa.publicKey); jwk.kid = "abdm-cm-1"; jwk.alg = "RS256"; jwk.use = "sig";
  const jwks = { keys: [jwk] };
  const jwksFetch = async () => ({ ok: true, status: 200, json: async () => jwks });

  const state = { requestIdC: null, consentId: null, requestIdD: null, transactionId: null, hiuKeyMaterial: null, hip: null, acks: [] };
  const calls = [];
  let cb = 0;

  async function deliverWebhook(payload) {
    await sleep(behavior.callbackDelayMs);
    const body = await signJws({ alg: "RS256", kid: "abdm-cm-1", typ: "JWT" }, payload, rsa.privateKey);
    return handleIngress(env, deps, mockRequest(body, { "REQUEST-ID": "cb-" + (++cb), TIMESTAMP: nowIso(), "X-HIU-ID": tenantId }));
  }

  // The outbound ABDM gateway seam (`deps.gateway.post`): capture our correlation ids/keyMaterial, 202-accept.
  const gateway = {
    post: async (endpointKey, body) => {
      calls.push({ endpointKey, body });
      if (endpointKey === "consentInit") { state.requestIdC = body[CONSENT_FIELDS.requestId]; state.consentId = state.consentId || ("consent-" + state.requestIdC); }
      else if (endpointKey === "consentFetch") { state.consentId = body.consentId || state.consentId; }
      else if (endpointKey === "hiRequest") {
        state.requestIdD = body[HIREQUEST_FIELDS.requestId];
        const km = body[HIREQUEST_FIELDS.hiRequest][HIREQUEST_FIELDS.keyMaterial];
        state.hiuKeyMaterial = { dhPublicKey: km[HIREQUEST_FIELDS.dhPublicKey], nonce: km[HIREQUEST_FIELDS.nonce] };
        state.transactionId = state.transactionId || ("txn-" + state.requestIdD);
      } else if (endpointKey === "hiNotify") { state.acks.push(body); }
      return { status: 202, body: {} };
    },
  };

  // The JWS-signed consent artifact (its OWN inner signature — the webhook body is a second, outer JWS).
  async function signedArtifact(scope, { status = "GRANTED" } = {}) {
    const consentDetail = {
      consentId: state.consentId, status,
      careContexts: scope.careContexts, hiTypes: scope.hiTypes, purpose: scope.purpose,
      permission: { dateRange: scope.dateRange, dataEraseAt: scope.dataEraseAt }, expiry: scope.expiry,
    };
    return { signature: await signJws({ alg: "RS256", kid: "abdm-cm-1", typ: "JWT" }, { consentDetail, status }, rsa.privateKey) };
  }

  // Lazily open ONE HIP Fidelius session per transfer against OUR captured keyMaterial (fresh keyMaterial per
  // transfer). Multi-entry seals reuse the session key (like hiu-decrypt's makeSession): the guarantee THIS
  // proves is per-entry ISOLATION + checksum, not per-entry keys (Stage-5 HIP-encrypt owns per-entry material).
  async function hipSession() {
    if (state.hip) return state.hip;
    const hiuPub = unb64(state.hiuKeyMaterial.dhPublicKey), hiuNonce = unb64(state.hiuKeyMaterial.nonce);
    const kp = await generateKeyPair(), hn = nonce();
    const secret = await sharedSecret(kp.privateKey, hiuPub);
    state.hip = { keyMaterial: { dhPublicKey: b64(kp.publicKeyRaw), nonce: b64(hn) }, seal: (pt) => sealBundle(secret, hn, hiuNonce, pt) };
    return state.hip;
  }

  return {
    gateway, jwks, jwksFetch, calls, behavior, state,
    get consentId() { return state.consentId; },
    get transactionId() { return state.transactionId; },
    get hipKeyMaterial() { return state.hip && state.hip.keyMaterial; },
    get acks() { return state.acks; },

    // GRANTED consent notify (echoes our requestId + the minted consentId) → linkConsentId + monotonic status.
    fireConsentNotify: (over = {}) => deliverWebhook({ type: "consent-notification", requestId: state.requestIdC, consentId: state.consentId, status: "GRANTED", ...over }),
    // on-fetch: the double-signed consent artifact → routed to verifyConsentArtifact (the Task-9 wiring).
    fireOnFetch: async (scope, opts = {}) => deliverWebhook({ type: "on-fetch", requestId: state.requestIdC, consentId: state.consentId, artifact: await signedArtifact(scope, opts) }),

    // on-request STATE EFFECT applied via the state helpers directly. The ingress `correlate` has no
    // getTxnByRequestId branch to map a not-yet-attached transaction_id / data-request requestId back to its
    // txn row (a pre-existing gap outside this on-fetch-wiring task), so attach happens here; every OTHER
    // inbound webhook (notify / on-fetch / data-push / junk) still flows through the REAL handleIngress.
    fireOnRequest: async () => {
      await sleep(behavior.callbackDelayMs);
      await attachTransactionId(deps.db, state.requestIdD, state.transactionId, nowIso());
      await advanceStatus(deps.db, state.requestIdD, "CONSENT_GRANTED", "REQUESTED", nowIso());
    },

    // data-push through the REAL ingress: HIP-encrypt the synthetic NDHM doc(s), correlate-before-buffer.
    // `includeConsentId` lets an out-of-order push (before on-request attaches the transaction_id) correlate via
    // the durable consent_id join; a junk push omits it (and uses an unknown transactionId) → 403, R2 untouched.
    // Knobs: `partial` (corrupt entry 0) + `callbackDelayMs` are consumed HERE; the ordering knobs (outOfOrder /
    // duplicate / retryAfterAck) are realized by the test's explicit fire/consume sequencing over these primitives.
    firePush: async ({ docs = [], partial = behavior.partial, transactionId = state.transactionId, includeConsentId = true } = {}) => {
      const hip = await hipSession();
      const entries = [];
      for (let i = 0; i < docs.length; i++) {
        const e = await hip.seal(JSON.stringify(docs[i]));
        let content = e.content;
        if (partial && i === 0) { const raw = [...atob(e.content)]; raw[raw.length - 1] = String.fromCharCode(raw[raw.length - 1].charCodeAt(0) ^ 1); content = btoa(raw.join("")); }
        entries.push({ careContextReference: "cc-" + i, content, checksum: e.checksum });
      }
      const payload = { type: "data-push", transactionId, entries };
      if (includeConsentId) payload.consentId = state.consentId;
      return deliverWebhook(payload);
    },
  };
}
