/* functions/_wardsynq/fhir-id.js - a FHIR-conformant id for every canonical record id. PURE.
 *
 * R4 says an id is 1 to 64 characters of [A-Za-z0-9.-]. WardSynQ's canonical ids are built from the
 * ids of the things they came from - an order from its admission, a report from its order, an
 * observation from its report and its code - and a fourth-generation id is longer than 64. The
 * canonical id is the record's identity everywhere inside WardSynQ and is NOT changed for this;
 * it is mapped at the FHIR boundary, deterministically, and mapped back on every read.
 *
 * A canonical id that already conforms and is short enough (48, so that a Provenance id built on
 * top of it also fits) is used verbatim. Anything else becomes `wsq-` + 48 hex characters of its
 * SHA-256: 52 characters, unique for any practical purpose, and the same on every export. The
 * canonical id travels beside it as an Identifier under urn:stewardmd:record-id, so a receiver
 * always holds the real key, and a hashed id is resolved back by the caller (fhir.js) through the
 * governed reads.
 *
 * The hash is computed synchronously so mapping stays pure and usable inside a mapper; WebCrypto's
 * digest is asynchronous. This is FIPS 180-4 SHA-256, nothing clever.
 */

const str = (v) => (v == null ? "" : String(v).trim());

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** PURE. SHA-256 of a UTF-8 string, as lowercase hex. Synchronous. */
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** The identifier system a FHIR resource carries its canonical WardSynQ id under. Ours. */
const RECORD_ID_SYSTEM = "urn:stewardmd:record-id";

const CONFORMS = /^[A-Za-z0-9.-]{1,64}$/;
const HASHED = /^wsq-[0-9a-f]{48}$/;

/** PURE. The hashed form of a canonical id: the same 52 characters every time. */
function hashedId(canonicalId) { return `wsq-${sha256Hex(str(canonicalId)).slice(0, 48)}`; }

/** PURE. The FHIR id for a canonical id: verbatim when it conforms and fits `max` (64 by default), else hashed. */
function fhirId(canonicalId, max) {
  const id = str(canonicalId);
  if (!id) return "";
  if (CONFORMS.test(id) && id.length <= (max || 64)) return id;
  return hashedId(id);
}

/** PURE. Whether a FHIR id is a hash that must be resolved back to a canonical id. */
function isHashedId(id) { return HASHED.test(str(id)); }

/** Two-letter codes so a Provenance id names its target's type and still fits in 64 characters. */
const TYPE_CODE = Object.freeze({
  Patient: "pt", Encounter: "en", Condition: "cn", AllergyIntolerance: "ai", Observation: "ob", MedicationRequest: "mr",
  MedicationAdministration: "ma", ServiceRequest: "sr", DiagnosticReport: "dr", DocumentReference: "dc", Consent: "cs",
});
const CODE_TYPE = Object.freeze(Object.fromEntries(Object.entries(TYPE_CODE).map(([t, c]) => [c, t])));

/** PURE. The Provenance id for one version of a resource: `<typecode>-<id>-v<version>`, the id
 *  verbatim when the whole thing fits in 64 characters and hashed otherwise. */
function provenanceId(fhirType, canonicalId, version) {
  const code = TYPE_CODE[fhirType];
  if (!code) return null;
  const v = `v${version === null || version === undefined ? "0" : version}`;
  return `${code}-${fhirId(canonicalId, 64 - code.length - v.length - 2)}-${v}`;
}

/** PURE. A Provenance id back to { fhirType, fhirId, version }, or null. */
function parseProvenanceId(id) {
  const m = /^([a-z]{2})-(.+)-v(\d+)$/.exec(str(id));
  if (!m || !CODE_TYPE[m[1]]) return null;
  return { fhirType: CODE_TYPE[m[1]], fhirId: m[2], version: Number(m[3]) };
}

export { sha256Hex, RECORD_ID_SYSTEM, fhirId, hashedId, isHashedId, TYPE_CODE, provenanceId, parseProvenanceId };
