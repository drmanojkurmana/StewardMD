// functions/_connect/abdm/no-phi.js — Stage-6 Task-6 (spec §14.3 item 3 / R16): the no-PHI + residency guard.
//
// THE INVARIANT (R16): a raw ABHA / careContextReference / decrypted-FHIR value can NEVER reach a KV key or
// value, a log line, a URL/path, or a D1 column — only HMACs (patientAbhaHash / careContextHash), ids, ISO
// timestamps, counts and opaque tokens leave the process. Two mechanisms enforce it, belt AND suspenders:
//   • RUNTIME  — guardedKvPut() refuses to kv.put() a key or value that looksLikePhi() (fail-closed). The
//                Connect KV writes — the NON-PHI outbound access-token cache and the inbound REQUEST-ID nonce
//                cache (R16) — are exactly the writes this wraps.
//   • STATIC   — the codebase-audit sweep in test/connect/abdm/no-phi-sweep.test.mjs proves no log/URL/D1/KV
//                write across functions/_connect/** carries a raw value. This module is the runtime half.
//
// VERIFY: adopt guardedKvPut at the Connect KV call-sites (token cache in gateway.js#session, nonce cache in
// ingress.js#handleIngress) — a surgical wrap, not a new binding. Until adopted, the static sweep is the proof
// those writes are PHI-free; guardedKvPut is the guarantee that any FUTURE write stays PHI-free.
//
// looksLikePhi is a CONSERVATIVE detector: it errs toward calling a value PHI (so a leak is blocked), yet the
// explicit non-PHI shapes (hex HMAC, UUID, ISO timestamp, count, opaque token) return false so the legitimate
// token/nonce writes are never wrongly refused.

export class PhiLeakError extends Error {
  constructor(message, where) {
    super(message);
    this.name = "PhiLeakError";
    this.where = where || null;
  }
}

// ── Residency reality, sourced here for the T9 owner-onboarding.md DPIA section (R16/R17). ──────────────────
// Cloudflare KV is GLOBALLY replicated, so PHI in KV would be an implicit cross-border transfer — hence KV is
// PHI-free by policy AND by the guardedKvPut guard. R2/D1 take a jurisdiction/location hint where the platform
// offers one, but true India-only residency is NOT guaranteed at the edge — the gap is an explicit owner DPIA
// item, not an assumed "India-only." R17: the HMAC salt must have enough entropy (and a rotation plan) to
// resist a low-entropy-ABHA brute force of the pseudonyms.
export const RESIDENCY = Object.freeze({
  kv: "Cloudflare KV is globally replicated — PHI-free by policy AND enforced by guardedKvPut (R16).",
  r2: "R2 with an India jurisdiction/location hint where offered; not a hard residency guarantee.",
  d1: "D1 stores only HMACs/ids/ciphertext; India location hint where offered.",
  gap: "True India-only residency is NOT guaranteed at the edge — cross-border edge-compute reality is a DPIA item.",
  saltRotation: "R17: HMAC salt needs high entropy + a rotation plan (low-entropy-ABHA brute-force risk).",
  dpia: "Residency gap + salt rotation are explicit owner DPIA items, documented in owner-onboarding.md (T9).",
});

// Known ABDM realm markers — a strong, unambiguous ABHA-address signal (…@sbx, …@abdm, …). Kept broad so an
// unlisted realm still trips the GENERIC handle@realm rule below (no realm false-negative, R16 adversarial).
const ABHA_REALM = /@(?:sbx|abdm|ndhm|pmjay|hcx|abha|swasth|pahuat)\b/i;
// A generic ABHA address: <handle>@<bare-realm-word> with NO dot after the realm (so an email `x@y.com` and a
// package path do not match) — catches realms the list above misses.
const ABHA_GENERIC = /(?:^|[^\w.@/])[\w.+-]{1,64}@[a-z][a-z0-9]{1,20}(?![\w.])/i;
// A 14-digit ABHA number, bare or hyphen-grouped (12-3456-7890-1234), not part of a longer digit run.
const ABHA_NUMBER = /(?<![\d-])\d{2}-?\d{4}-?\d{4}-?\d{4}(?![\d-])/;

// Fast NON-PHI allow-list — these opaque shapes are what legitimately flow to KV/D1, and MUST pass.
const HEX = /^[0-9a-f]{16,128}$/i;                                             // HMAC / SHA digest
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/;
const COUNT = /^-?\d{1,10}(?:\.\d+)?$/;                                        // small count / nonce value (<=10 digits)

function containsFhir(o, depth) {
  if (o == null || depth > 6) return false;
  if (Array.isArray(o)) return o.some((x) => containsFhir(x, depth + 1));
  if (typeof o === "object") {
    if (typeof o.resourceType === "string" && o.resourceType.length > 0) return true;
    return Object.keys(o).some((k) => containsFhir(o[k], depth + 1));
  }
  return false;
}

function looksLikeFhirString(s) {
  const t = s.trim();
  if (t[0] !== "{" && t[0] !== "[") return /"resourceType"\s*:/.test(t); // only inspect JSON-ish text
  let obj;
  try { obj = JSON.parse(t); } catch { return /"resourceType"\s*:/.test(t); }
  return containsFhir(obj, 0);
}

// looksLikePhi(value) -> boolean. Conservative: raw-ABHA-address / 14-digit-ABHA / FHIR-ish JSON → true;
// HMAC hex, UUID, ISO timestamp, small count and opaque token → false. Objects are inspected for nested FHIR
// (a decrypted Bundle smuggled inside an audit scope/resourceCounts blob still trips it).
export function looksLikePhi(value) {
  if (value == null) return false;
  if (typeof value === "number" || typeof value === "boolean") return false;   // counts / flags are never PHI
  if (typeof value === "object") {
    try { return containsFhir(value, 0) || looksLikePhi(JSON.stringify(value)); } catch { return true; } // unserializable → fail-closed
  }
  const s = String(value);
  if (s.length === 0) return false;
  // NON-PHI fast-path (opaque tokens/ids that legitimately reach KV/D1).
  if (HEX.test(s) || UUID.test(s) || ISO.test(s) || COUNT.test(s)) return false;
  // PHI signals.
  if (ABHA_REALM.test(s)) return true;
  if (ABHA_GENERIC.test(s)) return true;
  if (ABHA_NUMBER.test(s)) return true;
  if (looksLikeFhirString(s)) return true;
  return false;
}

// assertNoPhi(value, where) -> void. Throws PhiLeakError if value looksLikePhi. `where` labels the call-site.
export function assertNoPhi(value, where) {
  if (looksLikePhi(value)) throw new PhiLeakError("PHI-shaped value blocked at " + (where || "unknown"), where);
}

// guardedKvPut(kv, key, value, opts) -> Promise. The KV write guard: refuse a PHI-shaped KEY or VALUE before
// any kv.put. Fail-closed — on a PHI hit it throws and NOTHING is written; otherwise it delegates to kv.put.
export async function guardedKvPut(kv, key, value, opts) {
  assertNoPhi(key, "kv.key");
  assertNoPhi(value, "kv.value");
  return kv.put(key, value, opts);
}
