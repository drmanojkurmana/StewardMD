/* functions/_rx_store.js — prescription verification records: I/O only.
 * ===========================================================================
 * Thin persistence over the PURE rules in ../rx-validity.js. Every DECISION — how long a
 * prescription is valid, which prescriptions are verifiable at all, what the lifecycle states are —
 * lives there and is unit-tested. This file moves documents and enforces WHO may write them.
 * Mirrors functions/_pglog_store.js conventions (fsGet/fsCommit/wCreate/wUpdate + a trailing `deps`
 * so the whole flow can be driven against fakes in node).
 *
 * THREE THINGS THIS FILE OWNS, AND THE MODEL DOES NOT
 * --------------------------------------------------
 * 1. IDENTITY. "so no one can fake it" is the whole requirement, and it is decided here. The
 *    doctor's name, registration number and verified status are read from the VERIFIED FIREBASE
 *    TOKEN's custom claims — set by admin approval in functions/api/verifications — and a
 *    client-supplied doctor/regNo/verified is IGNORED, always. If the client could name its own
 *    prescriber, the QR would attest to nothing: anyone could mint a prescription carrying someone
 *    else's registration number, which is precisely the forgery this exists to prevent.
 * 2. TIME. issuedAt is the server clock. A client-supplied issue date could be back-dated to
 *    resurrect an expired prescription, so it is never accepted.
 * 3. WHAT IS STORED. Drugs, prescriber, validity. NEVER the patient — no name, age, sex, MRN,
 *    diagnosis or contact. A pharmacist scanning the QR is answering "did this doctor really write
 *    these drugs, and is it still valid?", and nothing on this record can answer anything else. The
 *    record is PHI-free by construction, which is what makes a public verify page safe at all.
 *
 * Dose/frequency/duration ARE stored next to each drug name. They are not patient data, and without
 * them a tampered quantity ("10 tablets" overwritten as "100") is undetectable — which is the
 * forgery this feature exists to catch.
 */
import { fsGet, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import RXV from "../rx-validity.js";

const COL = "rx_verifications";
const path = (code) => `${COL}/${code}`;

/* Random bytes from the platform CSPRNG. Math.random is not acceptable for a handle that is the
 * only thing standing between a stranger and someone else's prescription record. */
function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

// Keep only the fields a verifier needs, and cap them, so a caller cannot use this as free storage.
function cleanDrugs(drugs) {
  const s = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  return [].concat(drugs || []).slice(0, 30).map((d) => {
    const o = { name: s(d && (d.generic || d.name || d), 120) };
    const dose = s(d && d.dose, 60), freq = s(d && d.freq, 60), dur = s(d && d.duration, 60);
    if (dose) o.dose = dose;
    if (freq) o.freq = freq;
    if (dur) o.duration = dur;
    return o;
  }).filter((d) => d.name);
}

/* Issue a record. `claims` is the DECODED, VERIFIED Firebase token — the caller must have verified
 * it already; this function trusts nothing else about who the prescriber is.
 * body = { drugs[], category, country, physicianExpiry } */
export async function issue(env, claims, body, deps) {
  const now = (deps && deps.now) || Date.now;
  const commit = (deps && deps.fsCommit) || fsCommit;
  const get = (deps && deps.fsGet) || fsGet;
  const rnd = (deps && deps.randomBytes) || randomBytes;

  const uid = claims && (claims.sub || claims.user_id);
  if (!uid) return { status: 401, body: { ok: false, error: "sign_in_required" } };

  const drugs = cleanDrugs(body && body.drugs);
  if (!drugs.length) return { status: 400, body: { ok: false, error: "no_drugs" } };

  // Scope, decided by the rules module: habit-forming, antibiotic, or explicitly scheduled.
  if (!RXV.requiresVerification(drugs)) {
    return { status: 200, body: { ok: true, issued: false, reason: "not_in_scope" } };
  }

  const issuedAt = now();
  const v = RXV.validity({
    issuedAt,
    country: body && body.country,
    category: body && body.category,
    drugs,
    physicianExpiry: body && body.physicianExpiry,
  });

  // The prescriber, from the token's custom claims ONLY (see the header).
  const doctor = {
    uid,
    name: String(claims.name || claims.displayName || "").trim().slice(0, 120),
    regNo: String(claims.regNo || "").trim().slice(0, 60),
    verified: claims.verified === true,
  };

  // Retry on the astronomically unlikely collision rather than silently overwriting a real record.
  let code = "";
  for (let i = 0; i < 5; i++) {
    const c = RXV.normalizeCode(RXV.newCode(rnd));
    // eslint-disable-next-line no-await-in-loop
    const existing = await get(env, path(c)).catch(() => null);
    if (!existing) { code = c; break; }
  }
  if (!code) return { status: 503, body: { ok: false, error: "could_not_allocate_code" } };

  const rec = {
    code,
    issuedAt,
    validUntil: v.validUntil,
    days: v.days,
    basis: v.basis,
    refillsAllowed: v.refillsAllowed,
    schedule: v.schedule || "",
    category: String((body && body.category) || "").slice(0, 40),
    country: String((body && body.country) || "IN").toUpperCase().slice(0, 4),
    cappedFromPhysician: !!v.cappedFromPhysician,
    drugs,
    doctor,
    // NO patient fields. Deliberate, and asserted by test/rx-store.test.mjs.
  };
  await commit(env, [wCreate(env, path(code), rec)]);
  return {
    status: 200,
    body: {
      ok: true, issued: true, code, issuedAt,
      validUntil: v.validUntil, days: v.days, schedule: v.schedule,
      refillsAllowed: v.refillsAllowed, cappedFromPhysician: !!v.cappedFromPhysician,
      reasons: RXV.verificationReasons(drugs),
    },
  };
}

export async function lookup(env, code, deps) {
  const get = (deps && deps.fsGet) || fsGet;
  const c = RXV.normalizeCode(code);
  if (!c || c.length < 12) return null;
  // fsGet resolves to the Firestore envelope {id,name,fields,updateTime}; the record is under
  // .fields, the same unwrap _pglog_store.js does at every read. Returning the envelope left every
  // caller reading rec.drugs / rec.doctor / rec.code as undefined, and it failed in the worst way:
  // the doc WAS found, so /verify said "Valid prescription" while showing "(not recorded)" for the
  // prescriber and "0 drugs" - a check that confirms nothing. revoke() went the same way, since
  // rec.doctor.uid never matched the caller and it always answered 403 not_the_prescriber.
  try { const doc = await get(env, path(c)); return doc ? (doc.fields || null) : null; } catch (e) { return null; }
}

/* Revoke — the prescriber withdrawing their own prescription (a wrong drug, a lost sheet). Never a
 * delete: the record must keep saying "this was revoked" to anyone who scans a paper copy still in
 * circulation, which is the entire point of revocation. */
export async function revoke(env, claims, code, reason, deps) {
  const commit = (deps && deps.fsCommit) || fsCommit;
  const now = (deps && deps.now) || Date.now;
  const rec = await lookup(env, code, deps);
  if (!rec) return { status: 404, body: { ok: false, error: "not_found" } };
  const uid = claims && (claims.sub || claims.user_id);
  if (!uid || !rec.doctor || rec.doctor.uid !== uid) {
    return { status: 403, body: { ok: false, error: "not_the_prescriber" } };
  }
  if (rec.revokedAt) return { status: 200, body: { ok: true, alreadyRevoked: true } };
  await commit(env, [wUpdate(env, path(RXV.normalizeCode(code)), {
    revokedAt: now(),
    revokedReason: String(reason || "").slice(0, 200),
  })]);
  return { status: 200, body: { ok: true, revoked: true } };
}
