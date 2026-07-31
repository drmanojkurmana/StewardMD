// test/connect/abdm/mock-gateway.mjs — adversarial mock ABDM gateway (+ HIP, wired in Stage 4). Test harness, not shipped.
import { ENDPOINTS, FIELDS } from "../../../functions/_connect/abdm/gateway.js";
import { CONSENT_FIELDS, HIREQUEST_FIELDS } from "../../../functions/_connect/abdm/hiu.js";
import { attachTransactionId, advanceStatus } from "../../../functions/_connect/abdm/state.js";
import { sealBundle, sharedSecret, generateKeyPair, nonce, openEntry, deriveKeyIv } from "../../../functions/_connect/abdm/fidelius.js";
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

// ── Stage-5 Task-9: the end-to-end mock plays a HIU vs the REAL HIP SERVE path (mirror/inverse of the above) ──
// Here the mock is the HEALTH INFORMATION USER. It (1) sends a `discovery` probe -> receives care-contexts;
// (2) fires a JWS-signed `hip-consent-notify` (an inner signed consent artifact) + a `hip-hi-request` carrying
// its OWN fresh HIU keyMaterial (a fresh keypair + nonce) + a dataPushUrl + a transactionId + the consentId —
// BOTH through the REAL handleIngress; (3) captures the HIP's pushed transfer pages at that dataPushUrl (via the
// injected deps.fetch) and DECRYPTS each page with fidelius.openEntry(secret, hiuNonce, pageKeyMaterial.nonce,
// content, checksum) — the MIRRORED roles of hip-crypto.sealForHiu. Real crypto throughout: every webhook body
// (and the inner artifact) is RS256-signed with a key whose public JWK is published as the pinned JWKS, so the
// ingress body-verify runs its REAL verifyJws path — no verify stubs.
//   Behavior knobs: `fuzzyProbe` (discovery sends demographics with NO exact ABHA -> a miss, never fuzzy),
//   `crossPatient` (the hi-request appends a cross-patient careContext ref -> the HIP guard refuses the WHOLE
//   transfer, nothing pushed), `tamper` (decrypt corrupts one ciphertext byte -> openEntry fails closed / GCM
//   auth). `multiRecord` (N pages) and `flagOff` (the HIP flag OFF -> 404) are realized by the caller's
//   careContexts list + a flag-off env respectively; they are accepted here for symmetry/documentation.
export async function makeHipMockHiu({ env, deps, handleIngress, tenantId = "t-hip", now, dataPushUrl = "https://hiu.example.org/abdm/push", knobs = {} } = {}) {
  const nowIso = () => { const n = typeof now === "function" ? now() : now; if (n && typeof n.toISOString === "function") return n.toISOString(); return n || new Date().toISOString(); };
  const behavior = { fuzzyProbe: false, crossPatient: false, crossPatientRef: "cc-B-1", tamper: false, multiRecord: false, flagOff: false, ...knobs };

  // CM signing key -> pinned JWKS (mirrors makeHiuMockGateway; no fixtures on disk). RS256 is in the ingress's
  // INGRESS_ALGS allow-list, so the REAL verifyJws accepts a body signed with this key.
  const rsa = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", rsa.publicKey); jwk.kid = "abdm-cm-1"; jwk.alg = "RS256"; jwk.use = "sig";
  const jwks = { keys: [jwk] };
  const jwksFetch = async () => ({ ok: true, status: 200, json: async () => jwks });

  // OUR fresh HIU half — a fresh X25519 keypair + a fresh 32-byte nonce. This is the material the HIP seals
  // against; we keep the PRIVATE key so we can later decrypt every page (the round-trip proof).
  const kp = await generateKeyPair();
  const hiuNonce = nonce();
  const hiuKeyMaterial = { cryptoAlg: "ECDH", curve: "Curve25519", dhPublicKey: b64(kp.publicKeyRaw), nonce: b64(hiuNonce) };

  const pushedPages = [];   // every page the HIP POSTs to OUR dataPushUrl, in wire order: { url, body }
  const calls = [];
  let cb = 0;

  // deps.fetch seam: capture the HIP's push at OUR dataPushUrl; also resolve the JWKS if body-verify ever fetches
  // it (in practice we inject deps.jwks so this branch is unused — kept for robustness/symmetry). pushPage treats
  // a { status:202 } as success.
  const hiuFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (/certs|jwks/i.test(String(url))) return jwksFetch();
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch {}
    pushedPages.push({ url: String(url), body });
    return { ok: true, status: 202, json: async () => ({}) };
  };

  async function deliver(payload) {
    const body = await signJws({ alg: "RS256", kid: "abdm-cm-1", typ: "JWT" }, payload, rsa.privateKey);
    return handleIngress(env, deps, mockRequest(body, { "REQUEST-ID": "hip-cb-" + (++cb), TIMESTAMP: nowIso(), "X-HIU-ID": tenantId }));
  }

  // The JWS-signed consent artifact (its OWN inner signature) carried inside the hip-consent-notify body — the
  // shape a real CM signs. The ingress verifies the OUTER webbook body; the inner artifact is signed for fidelity.
  async function signedArtifact(consentId, scope, status) {
    const consentDetail = {
      consentId, status, careContexts: scope.careContexts, hiTypes: scope.hiTypes, purpose: scope.purpose,
      permission: { dateRange: scope.dateRange, dataEraseAt: scope.dataEraseAt }, expiry: scope.expiry,
    };
    return { signature: await signJws({ alg: "RS256", kid: "abdm-cm-1", typ: "JWT" }, { consentDetail, status }, rsa.privateKey) };
  }

  // Re-derive the (key,iv) each captured page decrypts under — used by both decryptPages and the caller's
  // composed no-(key,iv)-reuse proof. secret is per-page (a fresh HIP ephemeral pub -> a fresh ECDH secret).
  async function ivHexFor(body) {
    const km = body.keyMaterial;
    const secret = await sharedSecret(kp.privateKey, unb64(km.dhPublicKey));
    const { iv } = await deriveKeyIv(secret, hiuNonce, unb64(km.nonce));
    return [...iv].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  return {
    jwks, jwksFetch, hiuFetch, hiuKeyMaterial, pushedPages, calls, behavior,

    // (1) discovery probe. Exact-identifier by default; `fuzzy` (or knobs.fuzzyProbe) sends demographics ONLY
    //     (no exact ABHA) so the HIP can never match — proving discovery is never fuzzy/demographic.
    fireDiscovery: ({ abhaAddress, sourceId = "hiu-mock", fuzzy = behavior.fuzzyProbe, probe } = {}) => {
      const p = probe || (fuzzy
        ? { tenantId, name: "Synthetic Demographic", gender: "female", yearOfBirth: "1972" }
        : { tenantId, abhaAddress });
      return deliver({ type: "discovery", probe: p, sourceId });
    },

    // (2a) JWS-signed hip-consent-notify (with the inner signed artifact) -> putHipConsent (monotonic status).
    fireConsentNotify: async ({ consentId, status = "GRANTED", scope, patientAbhaHash, hiTypes, expiresAt } = {}) => {
      const payload = { type: "hip-consent-notify", consentId, status, patientAbhaHash, hiTypes, expiresAt };
      if (scope) payload.artifact = await signedArtifact(consentId, scope, status);
      return deliver(payload);
    },

    // (2b) hip-hi-request carrying OUR fresh HIU keyMaterial + the dataPushUrl + a transactionId + the consentId.
    //      `crossPatient` (or knobs) appends a cross-patient careContext ref so the HIP guard refuses the WHOLE
    //      transfer (OverShareError -> nothing pushed).
    fireHiRequest: ({ consentId, careContexts = [], transactionId = "txn-hip-1", pushUrl = dataPushUrl, cross = behavior.crossPatient } = {}) => {
      const ccs = cross ? [...careContexts, behavior.crossPatientRef] : careContexts.slice();
      return deliver({ type: "hip-hi-request", consentId, transactionId, careContexts: ccs, keyMaterial: hiuKeyMaterial, dataPushUrl: pushUrl });
    },

    // A generic signed-webhook escape hatch (e.g. to prove a Stage-4 HIU data-push STILL routes with the HIP flag
    // off). Signs + delivers any payload through the same REAL handleIngress spine.
    fireEvent: (payload) => deliver(payload),

    // (3) Decrypt every captured page with OUR HIU private key, mirroring the seal roles:
    //     openEntry(secret, hiuNonce, hipNonce, content, checksum). `tamper` flips one ciphertext byte BEFORE
    //     openEntry so the GCM tag fails (fail-closed decrypt). Returns the plaintext strings (in wire order).
    decryptPages: async ({ tamper = behavior.tamper } = {}) => {
      const out = [];
      for (const { body } of pushedPages) {
        const km = body.keyMaterial;
        const secret = await sharedSecret(kp.privateKey, unb64(km.dhPublicKey));
        const e = body.entries[0];
        let content = e.content;
        if (tamper) { const raw = [...atob(content)]; raw[raw.length - 1] = String.fromCharCode(raw[raw.length - 1].charCodeAt(0) ^ 1); content = btoa(raw.join("")); }
        out.push(await openEntry(secret, hiuNonce, unb64(km.nonce), content, e.checksum));
      }
      return out;
    },

    // The composed nonce-safety proof helper: the DISTINCT iv each page decrypts under, re-derived via
    // fidelius.deriveKeyIv. A collision would mean a reused (key,iv) — the caller asserts the set size == N.
    deriveIvs: async () => { const ivs = []; for (const { body } of pushedPages) ivs.push(await ivHexFor(body)); return ivs; },
  };
}
