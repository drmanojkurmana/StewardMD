/* wardsynq/wardsynq-nhcx-adapter.js - owner S4: an NHCX (India National Health Claims Exchange, HCX protocol)
 * payer adapter that actually sends, built only from the published specification.
 *
 * SOURCES (read 2026-09-16):
 *   - HCX protocol OpenAPI: https://raw.githubusercontent.com/Swasth-Digital-Health-Foundation/standards/main/API%20Definitions/openapi_hcx.yaml
 *     paths /coverageeligibility/check, /preauth/submit, /claim/submit, /hcx/status and their on_* callbacks;
 *     bearer JWT; body {"payload": "<JWE>"}; JOSE header fixed {"alg":"RSA-OAEP","enc":"A256GCM"}; protocol
 *     headers x-hcx-sender_code, x-hcx-recipient_code, x-hcx-api_call_id, x-hcx-correlation_id, x-hcx-timestamp
 *     (x-hcx-workflow_id optional); aad = ASCII(BASE64URL(protected header)), 128-bit tag; 202 answers
 *     {timestamp, api_call_id, correlation_id}.
 *   - Message structure: https://docs.hcxprotocol.io/hcx-technical-specifications/open-protocol/key-components-building-blocks/message-structure
 *   - Status API (Task; on_status carries the ClaimResponse or CoverageEligibilityResponse bundle):
 *     https://docs.hcxprotocol.io/hcx-technical-specifications/open-protocol/key-components-building-blocks/api-structure/supporting-apis
 *   - Token: POST <gateway>/participant/auth/token/generate, form-encoded username, participant_code, secret,
 *     answers access_token: https://github.com/Swasth-Digital-Health-Foundation/hcx-platform/blob/master/docs/user-manuals/How%20to%20generate%20an%20access%20token%20to%20make%20use%20of%20protocol%20APIs/README.md
 *   - Callback security (RS256 bearer JWT, then decrypt with our own private key):
 *     https://docs.hcxprotocol.io/hcx-technical-specifications/open-protocol/data-security-and-privacy/api-security
 *   - NRCeS FHIR IG for ABDM: https://nrces.in/ndhm/fhir/r4/StructureDefinition-ClaimBundle.html (Bundle.type
 *     collection, entry:Claim 1..*), StructureDefinition-Claim.html, StructureDefinition-CoverageEligibilityRequestBundle.html
 *     (entry:CoverageEligibilityRequest 1..1), StructureDefinition-CoverageEligibilityRequest.html,
 *     ValueSet-ndhm-claim-type.html, ValueSet-ndhm-diagnostic-type.html.
 *
 * x-hcx-timestamp. The OpenAPI schema text says "Unix timestamp" with example "1629057611000", but the spec's own
 * example JWE header, the integrator SDKs (Java HCXOutgoingRequest: yyyy-MM-dd'T'HH:mm:ssZ; JavaScript:
 * new Date().toISOString()) and the gateway's validator (hcx-platform api-gateway DateTimeUtils: joda
 * new DateTime(timestamp), which parses ISO 8601 only) all use ISO 8601. The gateway is what refuses a request,
 * so ISO 8601 it is.
 *
 * RSA-OAEP here is the JOSE algorithm of that name (RFC 7518 section 4.3): OAEP with SHA-1 and MGF1-SHA-1.
 * Only WebCrypto (crypto.subtle) is used. Nothing here knows a hospital, a payer or a storage binding.
 *
 * STATES, never stronger than what happened: "sent" is the gateway's 202 (it accepted the envelope for routing;
 * the payer has not seen it); acknowledged/approved/refused only ever come from a verified callback
 * (functions/_wardsynq/nhcx.js). Missing configuration is "not_configured" naming each piece; any failure is
 * "failed" with a plain note. NOT verified against a live NHCX sandbox: mocked transport only.
 */

import { buildFhirClaim, mapClaimResponse } from "./wardsynq-fhir-claim-adapter.js";

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const enc = new TextEncoder(), dec = new TextDecoder();
const TIMEOUT_MS = 15000;

const PROFILE = (name) => `https://nrces.in/ndhm/fhir/r4/StructureDefinition/${name}`;
const PATHS = Object.freeze({ claim: "/claim/submit", preauthorization: "/preauth/submit", eligibility: "/coverageeligibility/check", status: "/hcx/status" });

/* ---- bytes, PEM and a minimal DER walk ------------------------------------------------------------ */

function b64uEncode(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(text) {
  const s = str(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PURE. A PEM (newlines optional: a pasted single line works) to { label, der }. Null when it is not one. */
function pemDecode(pem) {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(str(pem));
  if (!m) return null;
  try { return { label: m[1], der: b64uDecode(m[2].replace(/\s+/g, "")) }; } catch { return null; }
}

/** PURE. One DER TLV at pos: { tag, start (of the header), body, end }. Throws on a truncated element. */
function tlv(der, pos) {
  const tag = der[pos];
  let len = der[pos + 1], p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (!n || n > 4) throw new Error("unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[p + i];
    p += n;
  }
  if (tag === undefined || p + len > der.length) throw new Error("truncated DER");
  return { tag, start: pos, body: p, end: p + len };
}
const children = (der, el) => { const out = []; for (let p = el.body; p < el.end;) { const c = tlv(der, p); out.push(c); p = c.end; } return out; };

/** PURE. The SubjectPublicKeyInfo of an X.509 certificate (RFC 5280 section 4.1), or a bare PUBLIC KEY PEM. */
function spkiFromPem(pem) {
  const p = pemDecode(pem);
  if (!p) throw new Error("not a PEM certificate");
  if (p.label === "PUBLIC KEY") return p.der;
  if (p.label !== "CERTIFICATE") throw new Error("not a certificate");
  const cert = tlv(p.der, 0);
  const tbs = children(p.der, cert)[0];
  const f = children(p.der, tbs);
  const at = f[0] && f[0].tag === 0xa0 ? 1 : 0;           // [0] version is optional (v1 certificates omit it)
  const spki = f[at + 5];                                  // serial, signature, issuer, validity, subject, SPKI
  if (!spki || spki.tag !== 0x30) throw new Error("certificate has no public key");
  return p.der.slice(spki.start, spki.end);
}

const OAEP = { name: "RSA-OAEP", hash: "SHA-1" };
const importEncryptionKey = (certPem) => crypto.subtle.importKey("spki", spkiFromPem(certPem), OAEP, false, ["encrypt"]);
const importVerifyKey = (certPem) => crypto.subtle.importKey("spki", spkiFromPem(certPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
function importDecryptionKey(pkcs8Pem) {
  const p = pemDecode(pkcs8Pem);
  if (!p || p.label !== "PRIVATE KEY") throw new Error("not a PKCS8 private key");
  return crypto.subtle.importKey("pkcs8", p.der, OAEP, false, ["decrypt"]);
}

/* ---- JWE compact serialization (RFC 7516), RSA-OAEP + A256GCM -------------------------------------- */

/** header: the protected header object (alg/enc are set here). payload: object or string. */
async function encryptJwe(header, payload, publicKey) {
  const protectedB64 = b64uEncode(enc.encode(JSON.stringify({ ...header, alg: "RSA-OAEP", enc: "A256GCM" })));
  const cek = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = new Uint8Array(await crypto.subtle.encrypt(OAEP, publicKey, cek));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(protectedB64), tagLength: 128 },
    aesKey, enc.encode(typeof payload === "string" ? payload : JSON.stringify(payload))));
  return [protectedB64, b64uEncode(encryptedKey), b64uEncode(iv), b64uEncode(sealed.slice(0, -16)), b64uEncode(sealed.slice(-16))].join(".");
}

/** PURE. The protected header of a compact JWE, NOT authenticated (routing only). Null when malformed. */
function peekJweHeader(compact) {
  const parts = str(compact).split(".");
  if (parts.length !== 5) return null;
  try { const h = JSON.parse(dec.decode(b64uDecode(parts[0]))); return h && typeof h === "object" ? h : null; } catch { return null; }
}

/** Decrypts and authenticates (the GCM tag covers the protected header). Throws on anything wrong. */
async function decryptJwe(compact, privateKey) {
  const parts = str(compact).split(".");
  if (parts.length !== 5) throw new Error("not a compact JWE");
  const header = peekJweHeader(compact);
  if (!header || header.alg !== "RSA-OAEP" || header.enc !== "A256GCM") throw new Error("unsupported JWE algorithm");
  const cek = await crypto.subtle.decrypt(OAEP, privateKey, b64uDecode(parts[1]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const ct = b64uDecode(parts[3]), tag = b64uDecode(parts[4]);
  const joined = new Uint8Array(ct.length + tag.length); joined.set(ct); joined.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64uDecode(parts[2]), additionalData: enc.encode(parts[0]), tagLength: 128 }, aesKey, joined);
  const text = dec.decode(plain);
  let payload; try { payload = JSON.parse(text); } catch { payload = text; }
  return { header, payload };
}

/** RS256 bearer JWT from the gateway: signature with the configured certificate, then exp and iat. */
async function verifyJwtRs256(token, certPem, nowMs, skewS = 60) {
  const parts = str(token).split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let head, claims;
  try { head = JSON.parse(dec.decode(b64uDecode(parts[0]))); claims = JSON.parse(dec.decode(b64uDecode(parts[1]))); } catch { return { ok: false, reason: "malformed" }; }
  if (!head || head.alg !== "RS256") return { ok: false, reason: "algorithm" };
  let good = false;
  try { good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await importVerifyKey(certPem), b64uDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)); }
  catch { return { ok: false, reason: "key" }; }
  if (!good) return { ok: false, reason: "signature" };
  const now = (nowMs || Date.now()) / 1000;
  if (!(Number(claims.exp) > now - skewS)) return { ok: false, reason: "expired" };
  if (!(Number(claims.iat) <= now + skewS)) return { ok: false, reason: "issued_in_future" };
  return { ok: true, claims };
}

/* ---- FHIR bundles per the NRCeS profiles ------------------------------------------------------------- */

const SCT = "http://snomed.info/sct";
const ref = (resourceType, id) => ({ reference: `${resourceType}/${id}` });
const entry = (resource) => ({ fullUrl: `${resource.resourceType}/${resource.id}`, resource });
const refuse = (missing) => ({ missing });

/** The insurer, provider and coverage every request names, from configuration and the record only. */
function parties(record, payer, created) {
  const insurer = { resourceType: "Organization", id: "insurer", identifier: [{ value: str(payer.recipientCode) }], name: str(payer.name) || str(payer.id) };
  const provider = { resourceType: "Organization", id: "provider", identifier: [{ value: str(payer.senderCode) }], name: str(payer.providerName) };
  const coverage = { resourceType: "Coverage", id: "coverage", status: "active", subscriberId: str(record.policyNumber),
    identifier: [{ value: str(record.policyNumber) }], beneficiary: ref("Patient", str(record.patientId)), payor: [ref("Organization", "insurer")] };
  const patient = { resourceType: "Patient", id: str(record.patientId), identifier: [{ system: "urn:wardsynq:patient", value: str(record.patientId) }] };
  return { insurer, provider, coverage, patient, created };
}

function configMissing(payer) {
  const m = [];
  if (!str(payer && payer.senderCode)) m.push("this hospital's participant code");
  if (!str(payer && payer.recipientCode)) m.push("the payer's participant code");
  if (!str(payer && payer.providerName)) m.push("the hospital name as the payer knows it");
  return m;
}

/**
 * PURE. A ClaimBundle for a claim or a pre-authorisation, or { missing: [...] } naming each mandatory element
 * the record cannot fill. Nothing is defaulted into a mandatory element that the record does not say.
 * Claim.type: the NRCeS ndhm-claim-type code for inpatient care (737481003) because every claim and
 * pre-authorisation in this build is for an admission. diagnosis.type: 89100005 "Final diagnosis
 * (discharge)" when the record carries a discharge, else 148006 "Preliminary diagnosis".
 */
function buildClaimBundle(record, payer, { use = "claim", now, bundleId } = {}) {
  const isPre = use === "preauthorization";
  const missing = configMissing(payer);
  const codes = (record.codes || []).map((c) => str(typeof c === "string" ? c : c && c.code)).filter(Boolean);
  if (!str(record.id)) missing.push(isPre ? "the pre-authorisation id" : "the claim id");
  if (!str(record.patientId)) missing.push("the patient");
  if (!codes.length) missing.push("at least one diagnosis code (Claim.diagnosis)");
  if (!str(record.policyNumber)) missing.push("the policy number (Claim.insurance.coverage)");
  const amount = num(isPre ? (record.requestedAmount != null ? record.requestedAmount : record.authorizedAmount) : record.submittedAmount);
  if (!(Array.isArray(record.lines) && record.lines.length) && amount == null) missing.push(isPre ? "the requested amount" : "the submitted amount");
  if (missing.length) return refuse(missing);

  const created = str(now) || new Date().toISOString();
  const p = parties(record, payer, created);
  const base = buildFhirClaim({ ...record, codes: codes.map((code) => ({ code })) }, { use, payer, now: created });
  const dxType = str(record.dischargedAt) ? { code: "89100005", display: "Final diagnosis (discharge)" } : { code: "148006", display: "Preliminary diagnosis" };
  const claim = {
    ...base, id: str(record.id),
    meta: { profile: [PROFILE("Claim")] },
    identifier: [{ system: isPre ? "urn:wardsynq:preauth" : "urn:wardsynq:claim", value: str(record.id) }],
    type: { coding: [{ system: SCT, code: "737481003", display: "Inpatient care management" }] },
    patient: ref("Patient", p.patient.id),
    insurer: ref("Organization", "insurer"), provider: ref("Organization", "provider"),
    insurance: [{ sequence: 1, focal: true, coverage: ref("Coverage", "coverage") }],
    diagnosis: codes.map((code, i) => ({ sequence: i + 1, diagnosisCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code }] }, type: [{ coding: [{ system: SCT, ...dxType }] }] })),
  };
  return {
    bundle: {
      resourceType: "Bundle", id: str(bundleId) || crypto.randomUUID(), meta: { profile: [PROFILE("ClaimBundle")] },
      type: "collection", timestamp: created,
      entry: [entry(claim), entry(p.patient), entry(p.insurer), entry(p.provider), entry(p.coverage)],
    },
  };
}

/**
 * PURE. A CoverageEligibilityRequestBundle. check: { id, patientId, policyNumber, purpose?, entererId }.
 * enterer is the staff member who asked (Practitioner, by this hospital's staff id); facility is the hospital.
 */
function buildEligibilityBundle(check, payer, { now, bundleId } = {}) {
  const missing = configMissing(payer);
  if (!str(check.id)) missing.push("the eligibility check id");
  if (!str(check.patientId)) missing.push("the patient");
  if (!str(check.policyNumber)) missing.push("the policy number (insurance.coverage)");
  if (!str(check.entererId)) missing.push("the staff member asking (enterer)");
  if (missing.length) return refuse(missing);
  const created = str(now) || new Date().toISOString();
  const p = parties(check, payer, created);
  const enterer = { resourceType: "Practitioner", id: "enterer", identifier: [{ system: "urn:wardsynq:staff", value: str(check.entererId) }] };
  const facility = { resourceType: "Location", id: "facility", name: str(payer.providerName), managingOrganization: ref("Organization", "provider") };
  const purpose = ["auth-requirements", "benefits", "discovery", "validation"].includes(str(check.purpose)) ? str(check.purpose) : "validation";
  const cer = {
    resourceType: "CoverageEligibilityRequest", id: str(check.id), meta: { profile: [PROFILE("CoverageEligibilityRequest")] },
    identifier: [{ system: "urn:wardsynq:eligibility", value: str(check.id) }],
    status: "active", priority: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/processpriority", code: "normal" }] },
    purpose: [purpose], patient: ref("Patient", p.patient.id), created,
    enterer: ref("Practitioner", "enterer"), provider: ref("Organization", "provider"), insurer: ref("Organization", "insurer"),
    facility: ref("Location", "facility"), insurance: [{ focal: true, coverage: ref("Coverage", "coverage") }],
  };
  return {
    bundle: {
      resourceType: "Bundle", id: str(bundleId) || crypto.randomUUID(), meta: { profile: [PROFILE("CoverageEligibilityRequestBundle")] },
      type: "collection", timestamp: created,
      entry: [entry(cer), entry(p.patient), entry(p.insurer), entry(p.provider), entry(p.coverage), entry(enterer), entry(facility)],
    },
  };
}

/** PURE. The /hcx/status Task: focus names our record, input names the entity type. The correlation id goes in the header. */
function buildStatusTask({ recordId, entityType, now }) {
  return {
    resourceType: "Task", id: crypto.randomUUID(), status: "requested", intent: "order",
    code: { text: "status" },
    focus: { identifier: { system: entityType === "preauthorization" ? "urn:wardsynq:preauth" : entityType === "coverageeligibility" ? "urn:wardsynq:eligibility" : "urn:wardsynq:claim", value: str(recordId) } },
    input: [{ type: { text: "entity_type" }, valueString: entityType }],
    authoredOn: str(now) || new Date().toISOString(),
  };
}

/* ---- responses ------------------------------------------------------------------------------------ */

const resources = (payload) => {
  if (!payload || typeof payload !== "object") return [];
  if (payload.resourceType === "Bundle") return (payload.entry || []).map((e) => e && e.resource).filter(Boolean);
  return [payload];
};

/**
 * PURE. A decrypted callback payload to what it says: { kind: "claim"|"eligibility"|null, outcome, disposition,
 * preAuthRef, adjudication, disallowances, inforce, benefits, errors, payerReference }. Payer figures, never recomputed.
 */
function parseNhcxResponse(payload) {
  const all = resources(payload);
  const cr = all.find((r) => r.resourceType === "ClaimResponse");
  if (cr) {
    const m = mapClaimResponse(200, cr);
    return { kind: "claim", use: str(cr.use) || null, outcome: str(cr.outcome) || null, disposition: str(cr.disposition) || null, preAuthRef: str(cr.preAuthRef) || null,
      payerReference: m.payerReference, adjudication: m.adjudication || null, disallowances: m.disallowances || [], errors: m.state === "failed" ? [m.note] : [] };
  }
  const er = all.find((r) => r.resourceType === "CoverageEligibilityResponse");
  if (er) {
    const insurance = (er.insurance || [])[0] || {};
    const benefits = [];
    for (const it of insurance.item || []) {
      for (const b of it.benefit || []) {
        const type = str(b.type && (b.type.text || (b.type.coding && b.type.coding[0] && (b.type.coding[0].display || b.type.coding[0].code))));
        const allowed = b.allowedMoney ? num(b.allowedMoney.value) : num(b.allowedUnsignedInt);
        const used = b.usedMoney ? num(b.usedMoney.value) : num(b.usedUnsignedInt);
        if (type) benefits.push({ type, allowed, used });
      }
    }
    const errors = (er.error || []).map((e) => str(e.code && (e.code.text || (e.code.coding && e.code.coding[0] && (e.code.coding[0].display || e.code.coding[0].code))))).filter(Boolean);
    return { kind: "eligibility", outcome: str(er.outcome) || null, disposition: str(er.disposition) || null, inforce: typeof insurance.inforce === "boolean" ? insurance.inforce : null,
      benefits: benefits.slice(0, 50), errors, payerReference: str(er.id) || null };
  }
  return { kind: null };
}

/* ---- the exchange ---------------------------------------------------------------------------------- */

/** The protected header for one call. ISO 8601 timestamp: see the header of this file. */
function protocolHeader({ senderCode, recipientCode, apiCallId, correlationId, workflowId, now } = {}) {
  return {
    "x-hcx-sender_code": str(senderCode), "x-hcx-recipient_code": str(recipientCode),
    "x-hcx-api_call_id": str(apiCallId) || crypto.randomUUID(), "x-hcx-correlation_id": str(correlationId) || crypto.randomUUID(),
    "x-hcx-timestamp": str(now) || new Date().toISOString(),
    ...(str(workflowId) ? { "x-hcx-workflow_id": str(workflowId) } : {}),
  };
}

/** What a payer connector must carry before anything is sent. secrets: the opened connector secrets. */
function connectionMissing(payer, secrets) {
  const m = [];
  if (!/^https:\/\//i.test(str(payer && payer.endpoint))) m.push("the NHCX gateway URL");
  if (!str(payer && payer.senderCode)) m.push("this hospital's participant code");
  if (!str(payer && payer.recipientCode)) m.push("the payer's participant code");
  if (!str(payer && payer.username)) m.push("the NHCX user name");
  if (!str(secrets && secrets.secret)) m.push("the NHCX participant secret");
  if (!str(secrets && secrets.encryptionCert)) m.push("the payer's encryption certificate");
  return m;
}

async function timed(fetchImpl, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetchImpl(url, { ...init, redirect: "manual", signal: controller.signal }); } finally { clearTimeout(timer); }
}
const bodyOf = async (res) => { try { return await res.json(); } catch { return null; } };
const errText = (b) => str(b && b.error && (b.error.message || b.error.code)).slice(0, 160);

/** POST <gateway>/participant/auth/token/generate. Returns { ok, token } or { ok:false, detail, httpStatus }. */
async function generateToken({ gatewayUrl, username, participantCode, secret, fetchImpl }) {
  const form = [["username", username], ["participant_code", participantCode], ["secret", secret]].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(str(v))}`).join("&");
  let res;
  try { res = await timed(fetchImpl, `${str(gatewayUrl).replace(/\/+$/, "")}/participant/auth/token/generate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form }); }
  catch (e) { return { ok: false, detail: `The NHCX gateway could not be reached for a token (${str(e && e.message).slice(0, 80)}). Nothing was sent.` }; }
  const b = await bodyOf(res);
  if (res.status !== 200 || !b || !str(b.access_token)) return { ok: false, httpStatus: res.status, detail: `The NHCX gateway refused the token request (HTTP ${res.status})${errText(b) ? `: ${errText(b)}` : ""}. Nothing was sent.` };
  return { ok: true, token: str(b.access_token) };
}

/**
 * One protocol call. ctx: { payer, secrets, path, fhir, correlationId?, workflowId?, now, fetch, beforeSend(exchange)? }
 * beforeSend runs after encryption and before the POST; when it throws, nothing is sent (the correlation lookup
 * must exist before a callback can arrive). Returns an adapter result { state, note, exchange? }.
 */
async function nhcxCall(ctx) {
  const { payer, secrets, path, fhir } = ctx;
  const missing = connectionMissing(payer, secrets);
  if (missing.length) return { state: "not_configured", note: `not_configured: nothing was sent to NHCX. Missing: ${missing.join(", ")}.` };
  if (typeof ctx.fetch !== "function") return { state: "not_configured", note: "not_configured: no transport is available. Nothing was sent." };
  const header = protocolHeader({ senderCode: payer.senderCode, recipientCode: payer.recipientCode, correlationId: ctx.correlationId, workflowId: ctx.workflowId, now: ctx.now });
  let jwe;
  try { jwe = await encryptJwe(header, fhir, await importEncryptionKey(secrets.encryptionCert)); }
  catch (e) { return { state: "failed", note: `The payer's encryption certificate could not be used (${str(e && e.message).slice(0, 80)}). Nothing was sent.` }; }
  const tok = await generateToken({ gatewayUrl: payer.endpoint, username: payer.username, participantCode: payer.senderCode, secret: secrets.secret, fetchImpl: ctx.fetch });
  if (!tok.ok) return { state: "failed", note: tok.detail };
  const exchange = { path, correlationId: header["x-hcx-correlation_id"], apiCallId: header["x-hcx-api_call_id"], workflowId: header["x-hcx-workflow_id"] || null,
    senderCode: header["x-hcx-sender_code"], recipientCode: header["x-hcx-recipient_code"], at: header["x-hcx-timestamp"] };
  if (typeof ctx.beforeSend === "function") {
    try { await ctx.beforeSend(exchange); }
    catch { return { state: "failed", note: "The exchange could not be recorded here, so nothing was sent to NHCX. Try again." }; }
  }
  let res;
  try {
    res = await timed(ctx.fetch, `${str(payer.endpoint).replace(/\/+$/, "")}${path}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok.token}` }, body: JSON.stringify({ payload: jwe }) });
  } catch (e) {
    return { state: "failed", exchange, note: `No answer from the NHCX gateway (${str(e && e.message).slice(0, 80)}). Delivery is unknown: use Check status before sending again.` };
  }
  const b = await bodyOf(res);
  if (res.status !== 202) return { state: "failed", exchange, note: `The NHCX gateway did not accept it (HTTP ${res.status})${errText(b) ? `: ${errText(b)}` : ""}.` };
  const echoed = b && str(b.correlation_id);
  return { state: "sent", exchange, note: `Accepted by the NHCX gateway for delivery to the payer (correlation ${exchange.correlationId})${echoed && echoed !== exchange.correlationId ? `; the gateway echoed a different correlation id ${echoed.slice(0, 60)}` : ""}. The payer has not answered yet.` };
}

/**
 * The adapter, under the tpa-adapter contract: submit(record, {use, now}) -> {state, note, exchange?}.
 * deps: { fetch, openSecrets(payer) -> secrets, beforeSend(exchange, {record, use, payer}) }
 */
function NhcxAdapter(payer, deps = {}) {
  return {
    id: `nhcx:${str(payer && payer.id)}`,
    name: `NHCX to ${str(payer && payer.name) || str(payer && payer.id)}`,
    async submit(record, opts = {}) {
      const use = opts.use === "preauthorization" ? "preauthorization" : "claim";
      let secrets = {};
      try { secrets = typeof deps.openSecrets === "function" ? (await deps.openSecrets(payer)) || {} : {}; } catch { secrets = {}; }
      const missing = connectionMissing(payer, secrets);
      if (missing.length) return { state: "not_configured", note: `not_configured: nothing was sent to NHCX. Missing: ${missing.join(", ")}.` };
      const built = buildClaimBundle(record, payer, { use, now: opts.now });
      if (built.missing) return { state: "failed", note: `Not sent to NHCX: the record does not have ${built.missing.join(", ")}.` };
      // The protocol timestamp is the moment of sending, never the record's own date: the gateway refuses a stale one.
      return nhcxCall({ payer, secrets, path: PATHS[use], fhir: built.bundle, fetch: deps.fetch,
        workflowId: str(record.workflowId) || null,
        beforeSend: typeof deps.beforeSend === "function" ? (ex) => deps.beforeSend(ex, { record, use, payer }) : null });
    },
  };
}

export {
  PATHS, PROFILE, b64uEncode, b64uDecode, pemDecode, spkiFromPem, importEncryptionKey, importDecryptionKey, importVerifyKey,
  encryptJwe, decryptJwe, peekJweHeader, verifyJwtRs256, buildClaimBundle, buildEligibilityBundle, buildStatusTask,
  parseNhcxResponse, protocolHeader, connectionMissing, generateToken, nhcxCall, NhcxAdapter,
};
