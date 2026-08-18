// functions/_connect/abdm/abha.js — ABDM M1: ABHA creation + verification over the V3 APIs.
//
// V3 ONLY. A V1/V2 M1 implementation is rejected at Sandbox Exit, so there is deliberately no legacy
// path here. Contracts are taken from the official M1 Postman collection (18-08-2025) and the ABHA V3
// swagger; see docs/connect/abdm/V3-SPEC-RECONCILIATION.md.
//
// PHI DISCIPLINE (DPDP + no-phi.js R16): Aadhaar, OTP, mobile and ABHA numbers are request-scoped only.
// Nothing in this module logs, caches or persists them - the caller decides what to keep, and the only
// durable forms allowed downstream are the HMAC pseudonym, the ABHA address, and last-4 of the number.
// Every identifier ABDM asks for is RSA-encrypted before it leaves us.

import { abhaUrl } from "./config.js";

export class AbhaError extends Error {
  constructor(message, opts = {}) { super(message); this.code = opts.code || null; this.status = opts.status || 0; }
}

// ── Consent (cert CRT_ABHA_102: the published consent text must be shown AND recorded) ──────────────
export const ENROL_CONSENT = { code: "abha-enrollment", version: "1.4" };

// ── Scopes, verbatim from the collection. Wrong scope combinations are a common 400 source. ─────────
export const SCOPES = {
  enrolByAadhaar:    ["abha-enrol"],
  enrolMobileVerify: ["abha-enrol", "mobile-verify"],
  enrolDlFlow:       ["abha-enrol", "mobile-verify", "dl-flow"],
  loginAadhaar:      ["abha-login", "aadhaar-verify"],
  loginMobile:       ["abha-login", "mobile-verify"],
  loginPassword:     ["abha-login", "password-verify"],
  searchAbha:        ["search-abha"],
  findAbhaMobile:    ["abha-login", "search-abha", "mobile-verify"],
  findAbhaAadhaar:   ["abha-login", "search-abha", "aadhaar-verify"],
  addressLoginMobile:  ["abha-address-login", "mobile-verify"],
  addressLoginAadhaar: ["abha-address-login", "aadhaar-verify"],
};

const uuid = () => globalThis.crypto.randomUUID();
// ABDM wants zero-UTC ISO with exactly milliseconds (FAQ Q6).
const stamp = (now) => new Date(typeof now === "function" ? now() : (now || Date.now())).toISOString();

/**
 * Headers for every ABHA V3 call. `token` is the gateway session bearer. The per-user tokens ABDM
 * issues are distinct headers, NOT Authorization: X-token (session-scoped user), T-token (pre-verify
 * user selection), R-token (refresh), Transaction_Id (address suggestions).
 */
export function abhaHeaders({ token, xToken, tToken, rToken, txnId, now } = {}) {
  const h = { "Content-Type": "application/json", "REQUEST-ID": uuid(), TIMESTAMP: stamp(now) };
  if (token) h.Authorization = "Bearer " + token;
  if (xToken) h["X-token"] = "Bearer " + xToken;
  if (tToken) h["T-token"] = "Bearer " + tToken;
  if (rToken) h["R-token"] = "Bearer " + rToken;
  if (txnId) h.Transaction_Id = txnId;
  return h;
}

// ── RSA field encryption ────────────────────────────────────────────────────────────────────────────
// Aadhaar / mobile / OTP / password / index are encrypted with the ABHA public key using
// RSA/ECB/OAEPWithSHA-1AndMGF1Padding, i.e. WebCrypto RSA-OAEP with SHA-1 (FAQ Q9/Q11).
const CERT_KV_KEY = "connect:abdm:abha:cert";
const CERT_TTL_SEC = 21600; // 6h - the key rotates rarely, but never cache it indefinitely

/** Fetch (and KV-cache) the ABHA public key as base64 SPKI. */
export async function getPublicKey(cfg, deps) {
  const { fetch: doFetch, kv, token, now } = deps;
  if (kv) {
    try { const c = await kv.get(CERT_KV_KEY); if (c) return c; } catch { /* cache miss is fine */ }
  }
  const res = await doFetch(abhaUrl(cfg, "/profile/public/certificate"), { headers: abhaHeaders({ token, now }) })
    .catch((e) => { throw new AbhaError("certificate fetch failed: " + e.message); });
  if (!res.ok) throw new AbhaError("certificate HTTP " + res.status, { status: res.status });
  let key;
  const text = await res.text();
  try { key = JSON.parse(text).publicKey; } catch { key = text; }   // endpoint has returned both shapes
  key = String(key || "").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  if (!key) throw new AbhaError("certificate response carried no public key");
  // A public key is not PHI, so this cache is safe under the no-PHI residency guard.
  if (kv) { try { await kv.put(CERT_KV_KEY, key, { expirationTtl: CERT_TTL_SEC }); } catch { /* best effort */ } }
  return key;
}

/** RSA-OAEP(SHA-1) encrypt one field value; returns base64. */
export async function rsaEncrypt(spkiB64, plaintext) {
  if (!spkiB64) throw new AbhaError("no public key for field encryption");
  const der = b64ToBytes(spkiB64);
  let key;
  try {
    key = await globalThis.crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-1" }, false, ["encrypt"]);
  } catch (e) { throw new AbhaError("public key import failed: " + e.message); }
  const ct = await globalThis.crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(String(plaintext)))
    .catch((e) => { throw new AbhaError("field encryption failed: " + e.message); });
  return bytesToB64(new Uint8Array(ct));
}

// ── Validation (cert CRT_ABHA_104/105: the UI must reject these before we ever call ABDM) ───────────
export const isAadhaar = (v) => /^[0-9]{12}$/.test(String(v || "").replace(/\s/g, ""));
export const isMobile = (v) => /^[6-9][0-9]{9}$/.test(String(v || "").replace(/\s/g, ""));
export const isOtp = (v) => /^[0-9]{6}$/.test(String(v || "").trim());
export const isAbhaNumber = (v) => /^[0-9]{14}$/.test(String(v || "").replace(/[-\s]/g, ""));
export const isAbhaAddress = (v) => /^[A-Za-z0-9._-]{1,}@[A-Za-z]{2,}$/.test(String(v || "").trim());

/** ABHA numbers are shown grouped 4-4-4-2 and stored only as last-4 + HMAC elsewhere. */
export const formatAbhaNumber = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : String(v || "");
};
export const abhaLast4 = (v) => String(v || "").replace(/\D/g, "").slice(-4);

// ── Error normalisation ─────────────────────────────────────────────────────────────────────────────
// ABDM returns THREE different error shapes and M1 uses all of them. Observed live 2026-08-18.
//   1. { code, message, timestamp }               documented codes: ABDM-1227 quota, ABDM-1094 token/flow mismatch
//   2. { error: { code, message } }               gateway style
//   3. { <fieldName>: "<message>", timestamp }    M1 field validation, e.g. {"loginId":"Invalid LoginId"}
// The third is the one integrators trip over (FAQ Q10) and it carries no code, so preserve the field name.
export function abhaErrorFrom(json, status) {
  const body = json || {};
  const nested = body.error && typeof body.error === "object" ? body.error : null;
  const src = nested || body;
  if (src.message || src.code) {
    return new AbhaError(String(src.message || ("ABHA HTTP " + status)), { code: src.code || null, status });
  }
  const field = Object.keys(body).find((k) => k !== "timestamp" && typeof body[k] === "string");
  if (field) {
    const e = new AbhaError(String(body[field]), { code: null, status });
    e.field = field;                                   // lets the UI attach the message to the right input
    return e;
  }
  return new AbhaError("ABHA HTTP " + status, { status });
}

// ── Transport ───────────────────────────────────────────────────────────────────────────────────────
async function call(cfg, deps, { path, method = "POST", body, addressFlow, xToken, tToken, rToken, txnId }) {
  const { fetch: doFetch, token, now } = deps;
  const url = abhaUrl(cfg, path, addressFlow);
  const init = { method, headers: abhaHeaders({ token, xToken, tToken, rToken, txnId, now }) };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res;
  try { res = await doFetch(url, init); }
  catch (e) { throw new AbhaError("ABHA request failed: " + e.message); }
  const text = await res.text().catch(() => "");
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) throw abhaErrorFrom(json, res.status);
  return json || {};
}

// ── ABHA CREATION, Aadhaar OTP (cert CRT_ABHA_101..115 - the mandatory private-integrator path) ─────

/** Step 1: OTP to the Aadhaar-linked mobile. `aadhaar` is plaintext here and encrypted before sending. */
export async function enrolSendAadhaarOtp(cfg, deps, { aadhaar }) {
  if (!isAadhaar(aadhaar)) throw new AbhaError("Aadhaar number must be 12 digits");
  const pub = await getPublicKey(cfg, deps);
  return call(cfg, deps, { path: "/enrollment/request/otp", body: {
    txnId: "", scope: SCOPES.enrolByAadhaar, loginHint: "aadhaar",
    loginId: await rsaEncrypt(pub, String(aadhaar).replace(/\s/g, "")), otpSystem: "aadhaar",
  } });
}

/**
 * Step 2: verify the Aadhaar OTP and create the ABHA number. `mobile` is the patient's chosen
 * communication number. Returns ABDM's profile + tokens; the caller must show the 14-digit number.
 */
export async function enrolVerifyAadhaarOtp(cfg, deps, { txnId, otp, mobile }) {
  if (!txnId) throw new AbhaError("txnId is required");
  if (!isOtp(otp)) throw new AbhaError("OTP must be 6 digits");
  const pub = await getPublicKey(cfg, deps);
  const otpBlock = { txnId, otpValue: await rsaEncrypt(pub, String(otp).trim()) };
  if (mobile) {
    if (!isMobile(mobile)) throw new AbhaError("mobile number is not a valid Indian mobile");
    otpBlock.mobile = String(mobile).replace(/\s/g, "");   // sent in the clear per the collection
  }
  return call(cfg, deps, { path: "/enrollment/enrol/byAadhaar", body: {
    authData: { authMethods: ["otp"], otp: otpBlock }, consent: { ...ENROL_CONSENT },
  } });
}

/** Communication-mobile verification when it differs from the Aadhaar-linked one (CRT_ABHA_109). */
export async function enrolSendMobileOtp(cfg, deps, { txnId, mobile }) {
  if (!isMobile(mobile)) throw new AbhaError("mobile number is not a valid Indian mobile");
  const pub = await getPublicKey(cfg, deps);
  return call(cfg, deps, { path: "/enrollment/request/otp", body: {
    txnId: txnId || "", scope: SCOPES.enrolMobileVerify, loginHint: "mobile",
    loginId: await rsaEncrypt(pub, String(mobile).replace(/\s/g, "")), otpSystem: "abdm",
  } });
}

export async function enrolVerifyMobileOtp(cfg, deps, { txnId, otp }) {
  if (!isOtp(otp)) throw new AbhaError("OTP must be 6 digits");
  const pub = await getPublicKey(cfg, deps);
  return call(cfg, deps, { path: "/enrollment/auth/byAbdm", body: {
    scope: SCOPES.enrolMobileVerify,
    authData: { authMethods: ["otp"], otp: { timeStamp: stamp(deps.now), txnId, otpValue: await rsaEncrypt(pub, String(otp).trim()) } },
  } });
}

/** At least three suggestions must be offered (CRT_ABHA_112). Note the Transaction_Id HEADER. */
export async function abhaAddressSuggestions(cfg, deps, { txnId }) {
  if (!txnId) throw new AbhaError("txnId is required");
  return call(cfg, deps, { path: "/enrollment/enrol/suggestion", method: "GET", txnId });
}

export async function createAbhaAddress(cfg, deps, { txnId, abhaAddress, preferred = 1 }) {
  if (!txnId) throw new AbhaError("txnId is required");
  if (!abhaAddress) throw new AbhaError("abhaAddress is required");
  return call(cfg, deps, { path: "/enrollment/enrol/abha-address", body: { txnId, abhaAddress, preferred } });
}

// ── ABHA VERIFICATION (cert VRFY_ABHA_101..405) ─────────────────────────────────────────────────────
// loginHint decides what loginId means; otpSystem decides where the OTP goes. Both are load-bearing.

const LOGIN_HINTS = { "abha-number": 1, "abha-address": 1, aadhaar: 1, mobile: 1, index: 1 };

export async function loginSendOtp(cfg, deps, { loginHint, loginId, otpSystem, scope, txnId, addressFlow }) {
  if (!LOGIN_HINTS[loginHint]) throw new AbhaError("unsupported loginHint: " + loginHint);
  const pub = await getPublicKey(cfg, deps);
  const body = {
    scope: scope || (otpSystem === "aadhaar" ? SCOPES.loginAadhaar : SCOPES.loginMobile),
    loginHint, loginId: await rsaEncrypt(pub, String(loginId).replace(/[-\s]/g, "")), otpSystem: otpSystem || "abdm",
  };
  if (txnId) body.txnId = txnId;
  const path = addressFlow ? "/login/abha/request/otp" : "/profile/login/request/otp";
  return call(cfg, deps, { path, body, addressFlow });
}

export async function loginVerifyOtp(cfg, deps, { txnId, otp, scope, addressFlow }) {
  if (!txnId) throw new AbhaError("txnId is required");
  if (!isOtp(otp)) throw new AbhaError("OTP must be 6 digits");
  const pub = await getPublicKey(cfg, deps);
  const path = addressFlow ? "/login/abha/verify" : "/profile/login/verify";
  return call(cfg, deps, {
    path, addressFlow,
    body: { scope: scope || SCOPES.loginMobile, authData: { authMethods: ["otp"], otp: { txnId, otpValue: await rsaEncrypt(pub, String(otp).trim()) } } },
  });
}

/** Auth methods available for an ABHA address, before choosing how to verify it. */
export async function addressSearchAuthMethods(cfg, deps, { abhaAddress }) {
  if (!isAbhaAddress(abhaAddress)) throw new AbhaError("ABHA address looks malformed");
  return call(cfg, deps, { path: "/login/abha/search", body: { abhaAddress }, addressFlow: true });
}

/** When one mobile maps to several ABHA numbers, pick by index then OTP (VRFY_ABHA_301..305). */
export async function findAbhaByMobile(cfg, deps, { mobile }) {
  if (!isMobile(mobile)) throw new AbhaError("mobile number is not a valid Indian mobile");
  const pub = await getPublicKey(cfg, deps);
  return call(cfg, deps, { path: "/profile/account/abha/search", body: {
    scope: SCOPES.searchAbha, mobile: await rsaEncrypt(pub, String(mobile).replace(/\s/g, "")),
  } });
}

export async function findAbhaSendOtp(cfg, deps, { txnId, index, otpSystem = "abdm" }) {
  if (!txnId) throw new AbhaError("txnId is required");
  const pub = await getPublicKey(cfg, deps);
  return call(cfg, deps, { path: "/profile/login/request/otp", body: {
    scope: otpSystem === "aadhaar" ? SCOPES.findAbhaAadhaar : SCOPES.findAbhaMobile,
    loginHint: "index", loginId: await rsaEncrypt(pub, String(index)), otpSystem, txnId,
  } });
}

/** After a mobile-OTP login that matched several accounts, name the one to open. */
export async function loginVerifyUser(cfg, deps, { tToken, abhaNumber, txnId }) {
  if (!tToken) throw new AbhaError("T-token is required");
  return call(cfg, deps, { path: "/profile/login/verify/user", tToken, body: { ABHANumber: String(abhaNumber || "").replace(/[-\s]/g, ""), txnId } });
}

// ── PROFILE + CARD ──────────────────────────────────────────────────────────────────────────────────
// FAQ Q21 trap: the ABHA-ADDRESS flow has its own profile/card endpoints. Using the wrong pair returns
// the misleading ABDM-1094 "X-token expired". `addressFlow` must match how the X-token was obtained.

export function profilePath(addressFlow) { return addressFlow ? "/login/profile/abha-profile" : "/profile/account"; }
export function cardPath(addressFlow) { return addressFlow ? "/login/profile/abha/phr-card" : "/profile/account/abha-card"; }

export async function getProfile(cfg, deps, { xToken, addressFlow }) {
  if (!xToken) throw new AbhaError("X-token is required");
  return call(cfg, deps, { path: profilePath(addressFlow), method: "GET", xToken, addressFlow });
}

export async function getAbhaCard(cfg, deps, { xToken, addressFlow }) {
  if (!xToken) throw new AbhaError("X-token is required");
  return call(cfg, deps, { path: cardPath(addressFlow), method: "GET", xToken, addressFlow });
}

export async function getQrCode(cfg, deps, { xToken }) {
  if (!xToken) throw new AbhaError("X-token is required");
  return call(cfg, deps, { path: "/profile/account/qrCode", method: "GET", xToken });
}

// ── Normalisation ───────────────────────────────────────────────────────────────────────────────────
/**
 * Reduce an ABDM profile to the fields StewardMD registration needs. Name / DOB / gender are
 * Aadhaar-verified and must be rendered NON-EDITABLE (cert CRT_ABHA_306). Returns no Aadhaar.
 */
export function normalizeProfile(p) {
  const src = (p && (p.ABHAProfile || p.abhaProfile || p.profile || p)) || {};
  const dob = src.dob || [src.dayOfBirth, src.monthOfBirth, src.yearOfBirth].filter(Boolean).join("-") || "";
  const addr = src.address || {};
  const num = String(src.ABHANumber || src.abhaNumber || src.healthIdNumber || "").replace(/[-\s]/g, "");
  return {
    abhaNumber: num,
    abhaNumberMasked: num ? "XX-XXXX-XXXX-" + num.slice(-4) : "",
    abhaAddress: src.preferredAbhaAddress || src.abhaAddress || src.phrAddress ||
      (Array.isArray(src.phrAddress) ? src.phrAddress[0] : "") || "",
    name: src.name || [src.firstName, src.middleName, src.lastName].filter(Boolean).join(" ").trim(),
    gender: src.gender || "",
    dob,
    yearOfBirth: String(src.yearOfBirth || (dob.match(/(\d{4})/) || [])[1] || ""),
    mobile: src.mobile || "",
    photo: src.profilePhoto || src.photo || "",
    address: [addr.line || src.address, addr.district || src.districtName, addr.state || src.stateName, addr.pincode || src.pincode]
      .filter((x) => x && typeof x === "string").join(", "),
    kycVerified: String(src.kycVerified ?? src.isKycVerified ?? "") === "true" || src.kycVerified === true,
    verifiedFields: ["name", "gender", "dob"],   // non-editable at registration
  };
}

const b64ToBytes = (s) => Uint8Array.from(atob(String(s).replace(/\s+/g, "")), (c) => c.charCodeAt(0));
function bytesToB64(u8) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
