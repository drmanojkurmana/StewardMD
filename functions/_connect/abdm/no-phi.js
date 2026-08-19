// functions/_connect/abdm/no-phi.js — Stage-6 Task-6 (spec §14.3 item 3 / R16): the no-PHI + residency guard.
//
// THE INVARIANT (R16), stated HONESTLY after the dual-adversarial review:
//   • The raw ABHA (a national health identifier) is ALWAYS HMAC'd (patientAbhaHash) before it reaches a KV
//     key/value, a log line, a URL, or a D1 column. It never leaves the process in the clear.
//   • The `careContextReference` is a PROTOCOL-VISIBLE identifier (like a FHIR reference): ABDM discovery
//     RETURNS it raw to the HIU and the serve side MATCHES on it, so it is stored raw in the D1 `ref` /
//     `care_contexts` columns BY DESIGN. That is an explicit, ACCEPTED exception — NOT a leak — but it is
//     still kept out of KV keys, logs and URLs (data-minimisation); audit rows carry `careContextHash`.
//   • Decrypted FHIR content is request-scoped and NEVER persisted or logged.
//
// Two mechanisms enforce the ABHA/decrypted-content half, belt AND suspenders:
//   • RUNTIME  — guardedKvPut() refuses to kv.put() a PHI-shaped key or value (fail-closed). WIRED at the real
//                Connect KV writes: the outbound access-token cache (gateway.js), the inbound REQUEST-ID nonce
//                cache (ingress.js) and the discovery rate-limit counter (hip.js). makeAuditSink() (audit.js)
//                runs scrubPhi() over scope/resourceCounts BEFORE the D1 write so a PHI value smuggled into a
//                free-form blob is redacted, never persisted. linkCareContext() rejects a PHI-shaped `display`.
//   • STATIC   — the codebase-audit sweep in test/connect/abdm/no-phi-sweep.test.mjs proves no log/URL/KV write
//                across functions/_connect/** carries a raw ABHA (strict) or a careContextReference (kept out
//                of KV/log/URL), while accepting the careContextReference in a D1 column (protocol-visible).
//
// looksLikePhi is CONSERVATIVE: it errs toward calling a value PHI (so a leak is blocked), yet the explicit
// non-PHI shapes (hex HMAC, UUID, ISO timestamp, small count, opaque token) return false so the legitimate
// token/nonce/counter writes are never wrongly refused.

export class PhiLeakError extends Error {
  constructor(message, where) {
    super(message);
    this.name = "PhiLeakError";
    this.where = where || null;
  }
}

// ── Residency reality, sourced here for the T9 owner-onboarding.md DPIA section (R16/R17). ──────────────────
export const RESIDENCY = Object.freeze({
  kv: "Cloudflare KV is globally replicated — PHI-free by policy AND enforced by guardedKvPut (R16).",
  r2: "R2 with an India jurisdiction/location hint where offered; not a hard residency guarantee.",
  d1: "D1 stores only HMACs/ids/ciphertext + the protocol-visible careContextReference (ref/care_contexts); India location hint where offered.",
  careContextReference: "Protocol-visible identifier (returned raw to the HIU, matched on serve) — stored raw in ref/care_contexts BY DESIGN; an accepted exception, not a leak. The ABHA is always HMAC'd.",
  gap: "True India-only residency is NOT guaranteed at the edge — cross-border edge-compute reality is a DPIA item.",
  saltRotation: "R17: HMAC salt needs high entropy + a rotation plan (low-entropy-ABHA brute-force risk).",
  dpia: "Residency gap + salt rotation + the careContextReference exception are explicit owner DPIA items (owner-onboarding.md, T9).",
});

// ── PHI signals ─────────────────────────────────────────────────────────────────────────────────────────────
// Known ABDM realm markers — a strong, unambiguous ABHA-address signal (…@sbx, …@abdm, …). Kept broad so an
// unlisted realm still trips the GENERIC handle@realm rule below (no realm false-negative, R16 adversarial).
const ABHA_REALM = /@(?:sbx|abdm|ndhm|pmjay|hcx|abha|swasth|pahuat)\b/i;
// A generic ABHA address: <handle>@<bare-realm-word> with NO dot after the realm (so an email `x@y.com` and a
// package path do not match) — catches realms the list above misses.
const ABHA_GENERIC = /(?:^|[^\w.@/])[\w.+-]{1,64}@[a-z][a-z0-9]{1,20}(?![\w.])/i;

// Indian identifiers embedded in free text (bounded runs, so a longer number is not a partial match):
const MOBILE_EMBED = /(?<!\d)[6-9]\d{9}(?!\d)/;                        // 10-digit mobile (leading 6-9)
const AADHAAR_EMBED = /(?<!\d)\d{12}(?!\d)/;                           // 12-digit Aadhaar (bare)
const AADHAAR_GROUP = /\d{4}[\s-]\d{4}[\s-]\d{4}(?![\d-])/;            // 12-digit Aadhaar (4-4-4 grouped)
const ABHA_NUMBER = /(?<![\d-])\d{2}-?\d{4}-?\d{4}-?\d{4}(?![\d-])/;   // 14-digit ABHA number (bare / in-place hyphens)
// Human name in free text — HONORIFIC-prefixed or "Surname, Firstname". Deliberately conservative: a bare
// TitleCase pair ("Discharge Summary", "Blood Test Report") is a legit clinical label, so it is NOT flagged.
const NAME_HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Shri|Smt|Sri|Kum)\b\.?\s+[A-Z][a-z]+/;
const NAME_COMMA = /\b[A-Z][a-z]{2,},\s+[A-Z][a-z]{2,}\b/;

// Fast NON-PHI allow-list — the opaque shapes that legitimately flow to KV/D1, and MUST pass.
const HEX = /^(?=[0-9a-f]*[a-f])[0-9a-f]{16,128}$/i;                   // HMAC/SHA digest — REQUIRES a hex letter, so a long pure-DIGIT id no longer slips through as "hex"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/;
const COUNT = /^-?\d{1,9}(?:\.\d+)?$/;                                 // small count / nonce (<=9 digits, so a 10-digit mobile / 12-digit Aadhaar is NOT swallowed)

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

// A value whose WHOLE trimmed form is a formatted number (digits + separators only) → collapse + classify.
// Gated to number-only strings so an alphanumeric token (whose hyphens would otherwise collapse into a bogus
// long run) is never touched here; embedded numbers in free text fall to the bounded checks below.
function looksLikeIndianId(s) {
  const t = s.trim();
  if (/^[+(\d][\s+()\-.\d]*$/.test(t)) {
    const d = t.replace(/[\s+()\-.]/g, "");
    const nat = /^91\d{10}$/.test(d) ? d.slice(2) : d;                // drop a 91 country code if a 10-digit national number remains
    if (/^[6-9]\d{9}$/.test(nat)) return true;                        // Indian mobile
    if (/^\d{12}$/.test(d) || /^\d{14}$/.test(d) || /^\d{15,18}$/.test(d)) return true; // Aadhaar / ABHA / VID / long ID (13-digit epoch deliberately excluded)
  }
  return MOBILE_EMBED.test(s) || AADHAAR_EMBED.test(s) || AADHAAR_GROUP.test(s) || ABHA_NUMBER.test(s);
}

// looksLikePhi(value) -> boolean. TRUE for an ABHA address, a 14-digit ABHA, a 12-digit Aadhaar, an Indian
// mobile, FHIR-ish JSON (incl. nested), or an honorific/comma-form name. FALSE for hex HMAC, UUID, ISO
// timestamp, small count and opaque token. Objects are inspected for nested FHIR (a decrypted Bundle smuggled
// inside an audit scope/resourceCounts blob still trips it) then JSON-scanned.
export function looksLikePhi(value) {
  if (value == null) return false;
  if (typeof value === "number" || typeof value === "boolean") return false;   // counts / flags are never PHI
  if (typeof value === "object") {
    try { return containsFhir(value, 0) || looksLikePhi(JSON.stringify(value)); } catch { return true; } // unserializable → fail-closed
  }
  const s = String(value);
  if (s.length === 0) return false;
  if (HEX.test(s) || UUID.test(s) || ISO.test(s) || COUNT.test(s)) return false;   // NON-PHI fast-path
  if (ABHA_REALM.test(s) || ABHA_GENERIC.test(s)) return true;
  if (looksLikeIndianId(s)) return true;
  if (NAME_HONORIFIC.test(s) || NAME_COMMA.test(s)) return true;
  if (looksLikeFhirString(s)) return true;
  return false;
}

// assertNoPhi(value, where) -> void. Throws PhiLeakError if value looksLikePhi. `where` labels the call-site.
export function assertNoPhi(value, where) {
  if (looksLikePhi(value)) throw new PhiLeakError("PHI-shaped value blocked at " + (where || "unknown"), where);
}

const isFhirResource = (o) => o && typeof o === "object" && !Array.isArray(o) && typeof o.resourceType === "string" && o.resourceType.length > 0;

// scrubPhi(value) -> deep copy with every PHI-shaped string leaf replaced by "[REDACTED]" and any FHIR-resource
// node redacted AT ITS OWN LEVEL (siblings preserved). Used by the audit sink so a raw ABHA / name / mobile /
// decrypted Bundle smuggled into a free-form scope/resourceCounts blob is redacted rather than persisted
// (fail-closed but non-destructive: the audit row still writes, and the legit reason/counts survive).
export function scrubPhi(value, depth = 0) {
  if (depth > 8) return "[REDACTED]";                                  // pathological nesting → fail-closed
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return looksLikePhi(value) ? "[REDACTED]" : value;
  if (isFhirResource(value)) return "[REDACTED]";                      // a decrypted FHIR resource node → redact wholesale
  if (Array.isArray(value)) return value.map((v) => scrubPhi(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubPhi(value[k], depth + 1);
    return out;
  }
  return value;
}

// A KV key is a COMPOSITE: a literal namespace plus one or more values, joined by ":". Checking the joined
// string is wrong, and measurably so - a 64-char hex digest sitting next to other text manufactures digit
// runs that look like an Indian mobile, and 7% of `prefix:hipId:<sha256>` keys tripped the guard. The
// consequence was not a leak but a DENIAL: guardedKvPut throws, the caller fails closed, and roughly one
// patient in fourteen could never be rate-limit-cleared to receive a link OTP.
//
// So a key is checked SEGMENT-WISE, and then once more with the individually-safe segments (hex digests,
// UUIDs, ISO timestamps, small counts) removed. A raw ABHA, mobile or Aadhaar in ANY segment still trips
// on that segment; an identifier split across segments still trips on the elided remainder. What no longer
// trips is an artefact of concatenation.
export function assertNoPhiKey(key, where) {
  const s = String(key == null ? "" : key);
  const segments = s.split(":");
  for (const seg of segments) assertNoPhi(seg, where || "kv.key");
  // Elide ONLY the segment shapes that manufacture false digit runs - a hex digest, a UUID, an ISO
  // timestamp. A short numeric segment is NOT elided: eliding those is exactly what would let an
  // identifier split across two segments slip through.
  const kept = segments.filter((seg) => !(HEX.test(seg) || UUID.test(seg) || ISO.test(seg)));
  // Always re-check the remainder, joined two ways: with separators (catches a name or ABHA form that
  // spans a segment boundary) and without (catches an identifier split across segments, which per-segment
  // checking alone would wave through as two harmless short numbers).
  assertNoPhi(kept.join(":"), where || "kv.key");
  assertNoPhi(kept.join(""), where || "kv.key");
}

// guardedKvPut(kv, key, value, opts) -> Promise. The KV write guard: refuse a PHI-shaped KEY or VALUE before
// any kv.put. Fail-closed — on a PHI hit it throws and NOTHING is written; otherwise it delegates to kv.put.
export async function guardedKvPut(kv, key, value, opts) {
  assertNoPhiKey(key, "kv.key");
  assertNoPhi(value, "kv.value");
  return kv.put(key, value, opts);
}
