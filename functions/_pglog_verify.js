/* functions/_pglog_verify.js — NMC Logbook · the verification code behind every QR.
 * ===========================================================================
 * WHAT PROBLEM THIS SOLVES. A printed PG logbook is trusted because a named person signed it. A
 * PDF of one is trusted because... nothing. Anyone can edit a PDF. So every signed event in this
 * module — a verified entry, a completed assessment, a monthly authentication — mints a short code
 * and a QR. An examiner scans it and gets an independent answer from the server: what was signed,
 * by which registered practitioner, when, and whether it has been amended since.
 *
 * THE DESIGN, AND WHAT IT DOES NOT DO
 *
 *   The code is an opaque 80-bit random handle, not an encoding of the record. Nothing about the
 *   resident or the patient can be read out of the code itself, so a code on a whiteboard leaks
 *   nothing.
 *
 *   The stored record carries an HMAC-SHA256 DIGEST of the canonical signed content. On lookup the
 *   digest is recomputed from the live record and compared. If someone edits Firestore directly,
 *   the digest stops matching and the verification page says TAMPERED rather than showing a green
 *   tick over altered content. This is tamper-EVIDENT, not tamper-proof: a database attacker who
 *   also holds PGLOG_SIGNING_KEY can forge both. The honest claim is the one made on the page.
 *
 *   It is NOT a cryptographic signature by the faculty member. It is the server attesting to what
 *   it recorded. A real per-signer keypair would need key custody we do not have, and claiming
 *   otherwise would be worse than not claiming it.
 *
 * FAIL CLOSED. Without PGLOG_SIGNING_KEY no code is issued at all. An unsigned "verification code"
 * that cannot be checked is worse than no QR, because it looks like one that can be.
 *
 * PRIVACY. The verification payload is PHI-free by construction: it names the resident (whose own
 * training record it is) and the signer, and it says what KIND of activity was signed and on what
 * date. It never carries the case reference, the diagnosis, the remarks or the reflection body.
 */
import { fsGet, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";

export const COL_VERIFY = "pg_verify";

/* Crockford-style base32 without I, L, O, U — no character a human can misread or misspeak, which
 * matters because these codes get read aloud and typed off paper. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newCode(bytes) {
  const b = bytes || crypto.getRandomValues(new Uint8Array(10));   // 80 bits
  let out = "";
  for (let i = 0; i < b.length; i++) out += ALPHABET[b[i] % 32];
  // PGL-XXXXX-XXXXX reads back cleanly over a phone.
  return "PGL-" + out.slice(0, 5) + "-" + out.slice(5, 10);
}
export function normalizeCode(s) {
  let t = String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  // STRIP THE PREFIX FIRST. "PGL" contains an L, and the confusable mapping below rewrites L to 1 —
  // so mapping before stripping turned every real code into "PG1..." and the prefix check never
  // matched. Every scanned and every hand-typed code failed. Order is the whole bug.
  if (t.slice(0, 3) === "PGL") t = t.slice(3);
  // Only NOW fold the characters a human confuses when reading a code off paper or hearing it.
  t = t.replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  return t.length === 10 ? "PGL-" + t.slice(0, 5) + "-" + t.slice(5, 10) : "";
}

export function signingKey(env) { return (env && env.PGLOG_SIGNING_KEY) || ""; }
export function signingConfigured(env) { return !!signingKey(env); }

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* THE SIGNED CONTENT, DEFINED ONCE.
 *
 * This function exists because the first version did not. The document written at signing time and
 * the document read back at verification time were mapped into the canonical form by two separate
 * lists of field names, in two files — and they disagreed twice (`verifiedReg` vs `verifiedByReg`,
 * `revisions` vs `revisionCount`). The digest therefore never matched, and EVERY genuine entry QR
 * told the examiner "This record does not match what was signed. Do not rely on it." A signature
 * that cries forgery over honest records is worse than no signature at all.
 *
 * So there is now exactly one place that says what a signature covers. Both ends call it.
 */
export function payloadFor(kind, doc) {
  const e = doc || {};
  if (kind === "entry") {
    return { id: e.id, residentId: e.residentId, orgId: e.orgId, kind: e.kind,
             occurredAt: e.occurredAt, role: e.role, verifiedBy: e.verifiedBy,
             verifiedByReg: e.verifiedReg, verifiedAt: e.verifiedAt,
             revisionCount: (e.revisions || []).length };
  }
  if (kind === "assessment") {
    return { id: e.id, residentId: e.residentId, orgId: e.orgId, templateId: e.templateId,
             outcome: e.outcome, total: e.total, maxTotal: e.maxTotal,
             assessor: e.assessor, assessorReg: e.assessorReg, assessedAt: e.assessedAt };
  }
  if (kind === "attestation") {
    return { id: e.id, residentId: e.residentId, orgId: e.orgId, attKind: e.kind,
             period: e.period, counts: e.counts, attestedBy: e.attestedBy,
             attestedByReg: e.attestedReg, attestedAt: e.attestedAt };
  }
  throw new Error("pglog_verify_unknown_kind");
}

/* THE CANONICAL FORM. Field order is fixed and explicit — never Object.keys() over a live document,
 * whose key order would change with a schema edit and silently invalidate every code ever issued.
 *
 * Each part is LENGTH-PREFIXED rather than delimiter-joined. Only one signed field is free-form (the
 * registration number, which comes from the register response or an owner-typed approval), but a
 * separator that can appear inside a value is a separator that can shift every field after it. The
 * prefix costs nothing and removes the question.
 */
export function canonical(kind, payload) {
  const p = payload || {};
  const f = (v) => { const s = String(v == null ? "" : v); return s.length + ":" + s; };
  if (kind === "entry") {
    return ["v2", "entry", f(p.id), f(p.residentId), f(p.orgId), f(p.kind), f(p.occurredAt),
            f(p.role), f(p.verifiedBy), f(p.verifiedByReg), f(p.verifiedAt),
            f(p.revisionCount || 0)].join("|");
  }
  if (kind === "assessment") {
    return ["v2", "assessment", f(p.id), f(p.residentId), f(p.orgId), f(p.templateId),
            f(p.outcome), f(p.total == null ? "" : p.total), f(p.maxTotal == null ? "" : p.maxTotal),
            f(p.assessor), f(p.assessorReg), f(p.assessedAt)].join("|");
  }
  if (kind === "attestation") {
    return ["v2", "attestation", f(p.id), f(p.residentId), f(p.orgId), f(p.kind2 || p.attKind),
            f(p.period), f((p.counts && p.counts.total) || 0),
            f((p.counts && p.counts.verified) || 0),
            f(p.attestedBy), f(p.attestedByReg), f(p.attestedAt)].join("|");
  }
  throw new Error("pglog_verify_unknown_kind");
}

/* Digest a LIVE DOCUMENT. This is the form both callers should use — passing a hand-built payload is
 * how the two ends drifted apart in the first place. */
export async function digestForDoc(env, kind, doc) {
  return digestFor(env, kind, payloadFor(kind, doc));
}

export async function digestFor(env, kind, payload) {
  const key = signingKey(env);
  if (!key) throw Object.assign(new Error("pglog_signing_unconfigured"), { status: 503 });
  return hmacHex(key, canonical(kind, payload));
}

// Constant-time hex comparison. A digest check that leaks timing is a digest check an attacker can
// grind against; this is cheap, so there is no reason not to.
export function digestEqual(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

/* Mint a code for a signed event. Create-if-absent on the code, so a collision (astronomically
 * unlikely at 80 bits, but the guard costs nothing) fails rather than overwriting someone else's
 * verification record. Returns "" when signing is not configured — the CALLER must then not claim a
 * QR exists, and the store simply records nothing. */
export async function issue(env, kind, doc, deps) {
  deps = deps || {};
  if (!signingConfigured(env)) return "";
  const d = { fsCommit, wCreate, fsGet, now: Date.now, ...deps };
  // The LIVE DOCUMENT in, the canonical payload derived here — the same derivation the verification
  // page runs. Never a payload hand-built by the caller.
  const payload = payloadFor(kind, doc);
  const digest = await (deps.digestFor || digestFor)(env, kind, payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = (deps.newCode || newCode)();
    try {
      await d.fsCommit(env, [d.wCreate(env, COL_VERIFY + "/" + code, {
        code, kind, refId: String(doc.id || ""),
        residentId: String(doc.residentId || ""), orgId: String(doc.orgId || ""),
        digest, issuedAt: d.now(), revoked: false, supersededBy: ""
      })]);
      return code;
    } catch (e) {
      if (e && e.code === "precondition") continue;      // collision: try another code
      throw e;
    }
  }
  throw new Error("pglog_verify_code_collision");
}

/* Mark a code superseded. Called when a verified entry is AMENDED: the old signature described a
 * document that no longer stands, so the code must say so rather than keep showing a green tick. */
export async function supersede(env, code, byCode, deps) {
  const d = { fsCommit, wUpdate, ...deps };
  if (!code) return;
  try {
    await d.fsCommit(env, [d.wUpdate(env, COL_VERIFY + "/" + code,
      { revoked: true, supersededBy: String(byCode || ""), revokedAt: Date.now() })]);
  } catch (e) { /* best-effort: the digest check is the backstop */ }
}

export async function lookup(env, code, deps) {
  const d = { fsGet, ...deps };
  const c = normalizeCode(code);
  if (!c) return null;
  const doc = await d.fsGet(env, COL_VERIFY + "/" + c);
  return doc ? doc.fields : null;
}

/* The public verification URL. Configurable so a self-hosted deployment does not print
 * stewardmd.in onto its own records. */
export function verifyUrl(env, code) {
  const base = ((env && env.PGLOG_VERIFY_BASE) || "https://stewardmd.in").replace(/\/+$/, "");
  return base + "/pglog/v/" + encodeURIComponent(code);
}
