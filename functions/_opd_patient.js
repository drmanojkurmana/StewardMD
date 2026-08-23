/* functions/_opd_patient.js — OPD patient identity: registration model, validation, MR numbers.
 *
 * PURE + dependency-free (like _queue_roles.js / _clinic_billing.js) so it is fully unit-tested and
 * reused IDENTICALLY by the phone app, the staff web console and the server. Firestore I/O lives in
 * _opd_patient_store.js. The front-ends must never re-implement any rule in here — three separate MR
 * generators is exactly how the queue and billing drifted apart.
 *
 * ABDM: this is "capture + validate now, verify later". Every field ABDM requires at registration is
 * modelled and validated OFFLINE (ABHA number checksum, ABHA address shape, E.164 mobile, gender,
 * date of birth, address with pincode) plus an explicit consent record, because ABDM linkage is not
 * lawful without recorded patient consent. No gateway calls are made here; when M2 credentials arrive
 * the verification layer sits on top of this model without changing it.
 *
 * MR NUMBER — the one rule, in one place:
 *   • StewardMD EMR / personal clinic  -> WE issue it: SMD-<CLINIC>-NNNNN, from an atomic per-org
 *     counter (never from a list length — deleting a patient must never recycle a discharged MR).
 *   • Hospital / GHIS / EMR Connect     -> the HOSPITAL issues it. We never mint one. Until the EMR
 *     returns it the patient carries a clearly-marked provisional id (TMP-…) which is replaced on link,
 *     so a provisional can never be mistaken for a real hospital MR.
 */

// ---- small helpers ---------------------------------------------------------------------------
const s = (x) => String(x == null ? "" : x).trim();
const digits = (x) => s(x).replace(/\D/g, "");
export const GENDERS = ["male", "female", "other"];
export const VISIT_TYPES = ["new", "followup"];
export const MR_SOURCES = ["stewardmd", "ghis", "connect", "provisional"];

// ---- mobile (E.164, India-first) -------------------------------------------------------------
// The queue already sends WhatsApp/SMS from this number, so it is stored in ONE canonical shape.
// Accepts 9876543210, 09876543210, +91 98765 43210, 91-9876543210.
export function normalizeMobile(raw) {
  let d = digits(raw);
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return "";
  if (!/^[6-9]/.test(d)) return "";          // Indian mobile numbers start 6-9
  return "+91" + d;
}
export function isValidMobile(raw) { return !!normalizeMobile(raw); }
// Display form for a desk/slip: +91 98765 43210
export function formatMobile(e164) {
  const d = digits(e164).slice(-10);
  return d.length === 10 ? "+91 " + d.slice(0, 5) + " " + d.slice(5) : s(e164);
}

// ---- ABHA number (14 digits, Verhoeff check digit) --------------------------------------------
// ABDM issues ABHA numbers as 14 digits with a trailing Verhoeff checksum, displayed as 12-3456-7890-1234.
// Validating offline stops a mistyped number entering the record months before the gateway would.
const V_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]
];
const V_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
export function verhoeffOk(numStr) {
  const d = digits(numStr);
  if (!d) return false;
  let c = 0;
  const rev = d.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[i % 8][Number(rev[i])]];
  return c === 0;
}
export function normalizeAbhaNumber(raw) {
  const d = digits(raw);
  return d.length === 14 ? d : "";
}
export function isValidAbhaNumber(raw) {
  const d = normalizeAbhaNumber(raw);
  return !!d && verhoeffOk(d);
}
export function formatAbhaNumber(raw) {
  const d = normalizeAbhaNumber(raw);
  return d ? d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10) + "-" + d.slice(10) : s(raw);
}
// ABHA address ("PHR address"): username@suffix, e.g. asha.kumar@abdm or 12345678@sbx.
export function normalizeAbhaAddress(raw) {
  const v = s(raw).toLowerCase();
  if (!v) return "";
  const m = v.match(/^([a-z0-9](?:[a-z0-9._-]{0,44}[a-z0-9])?)@([a-z][a-z0-9]{1,15})$/);
  return m ? m[1] + "@" + m[2] : "";
}
export function isValidAbhaAddress(raw) { return !!normalizeAbhaAddress(raw); }

// ---- age / date of birth ----------------------------------------------------------------------
// A desk usually knows the age, not the birth date; ABDM wants a date. Store BOTH: the stated age as
// given, and a derived birthDate flagged `approx` so nobody later mistakes 01-Jan for a real birthday.
export function birthDateFromAge(years, months, nowMs) {
  const y = Math.max(0, Math.min(130, Math.round(Number(years) || 0)));
  const m = Math.max(0, Math.min(11, Math.round(Number(months) || 0)));
  if (!y && !m) return "";
  const d = new Date(Number(nowMs) || Date.now());
  const by = d.getUTCFullYear() - y;
  const bm = d.getUTCMonth() - m;
  const nd = new Date(Date.UTC(by, bm, 1));
  return nd.toISOString().slice(0, 10);
}
export function ageFromBirthDate(iso, nowMs) {
  const t = Date.parse(s(iso));
  if (isNaN(t)) return null;
  const b = new Date(t), n = new Date(Number(nowMs) || Date.now());
  let y = n.getUTCFullYear() - b.getUTCFullYear();
  let m = n.getUTCMonth() - b.getUTCMonth();
  if (n.getUTCDate() < b.getUTCDate()) m -= 1;
  if (m < 0) { y -= 1; m += 12; }
  return y < 0 ? null : { years: y, months: m };
}
export function isValidBirthDate(iso, nowMs) {
  const t = Date.parse(s(iso));
  if (isNaN(t)) return false;
  const n = Number(nowMs) || Date.now();
  return t <= n && t > n - 131 * 365.25 * 86400000;
}

// ---- MR numbers --------------------------------------------------------------------------------
export function clinicCodeOf(orgCode) {
  return s(orgCode).replace(/^SMD-/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "CLINIC";
}
// OUR id. seq comes from an atomic counter, never a collection length.
export function makeClinicMrn(orgCode, seq) {
  const n = Math.max(1, Math.round(Number(seq) || 0));
  return "SMD-" + clinicCodeOf(orgCode) + "-" + String(n).padStart(5, "0");
}
// A patient queued in a hospital workplace before the EMR has issued an MR. Deliberately ugly and
// obviously temporary: it must never be transcribed onto a form as if it were a hospital number.
export function makeProvisionalMrn(seq) {
  const n = Math.max(1, Math.round(Number(seq) || 0));
  return "TMP-" + String(n).padStart(6, "0");
}
export function isProvisionalMrn(mrn) { return /^TMP-\d{4,}$/i.test(s(mrn)); }
export function isClinicMrn(mrn) { return /^SMD-[A-Z0-9]+-\d{4,}$/i.test(s(mrn)); }

// Which system owns this patient's MR, given the workplace. THE rule, in one place.
//   native  -> we issue     |  ghis / connect -> the hospital issues, we only record
export function mrSourceFor(workplaceMode) {
  const m = s(workplaceMode).toLowerCase();
  if (m === "ghis") return "ghis";
  if (m === "connect") return "connect";
  return "stewardmd";
}
// Decide what MR this registration gets. Returns { mrn, mrSource, needsAllocation, pending }.
// `allocatedMrn`/`provisionalMrn` are supplied by the store when this says it needs one.
export function resolveMrn(workplaceMode, suppliedMrn) {
  const source = mrSourceFor(workplaceMode);
  const supplied = s(suppliedMrn);
  if (source === "stewardmd") {
    // A clinic patient never carries a hospital number: if one was typed, keep it as a reference only.
    return { mrSource: "stewardmd", needsAllocation: !supplied || !isClinicMrn(supplied), mrn: isClinicMrn(supplied) ? supplied : "", pending: false, hospitalRef: isClinicMrn(supplied) ? "" : supplied };
  }
  if (supplied) return { mrSource: source, needsAllocation: false, mrn: supplied, pending: false, hospitalRef: "" };
  // Hospital workplace, no MR yet -> queue them now on a provisional, swap on link.
  return { mrSource: "provisional", needsAllocation: true, mrn: "", pending: true, hospitalRef: "" };
}

// ---- registration validation --------------------------------------------------------------------
// Required at the desk: name, mobile, gender, age (or DOB). Everything else optional. Errors are keyed
// by field so a form can render them inline instead of one modal alert.
export const REQUIRED_FIELDS = ["name", "mobile", "gender", "age"];
export function validateRegistration(input, nowMs) {
  const o = input || {};
  const errors = {};
  const name = s(o.name).replace(/\s+/g, " ");
  if (name.length < 2) errors.name = "Enter the patient's full name.";
  else if (name.length > 80) errors.name = "Name is too long.";

  const mobile = normalizeMobile(o.mobile);
  if (!s(o.mobile)) errors.mobile = "Mobile number is required - the queue sends updates to it.";
  else if (!mobile) errors.mobile = "Enter a valid 10-digit Indian mobile number.";

  const gender = s(o.gender).toLowerCase();
  if (!gender) errors.gender = "Select the patient's gender.";
  else if (GENDERS.indexOf(gender) < 0) errors.gender = "Select male, female or other.";

  let birthDate = s(o.birthDate), ageYears = null, ageMonths = null, approxDob = false;
  if (birthDate) {
    if (!isValidBirthDate(birthDate, nowMs)) errors.age = "Enter a real date of birth.";
    else { const a = ageFromBirthDate(birthDate, nowMs); ageYears = a ? a.years : null; ageMonths = a ? a.months : null; }
  } else if (s(o.ageYears) !== "" || s(o.ageMonths) !== "") {
    const y = Number(o.ageYears || 0), m = Number(o.ageMonths || 0);
    if (!isFinite(y) || !isFinite(m) || y < 0 || y > 130 || m < 0 || m > 11) errors.age = "Enter a valid age.";
    else if (!y && !m) errors.age = "Enter the patient's age.";
    else { ageYears = Math.round(y); ageMonths = Math.round(m); birthDate = birthDateFromAge(y, m, nowMs); approxDob = true; }
  } else {
    errors.age = "Enter the patient's age or date of birth.";
  }

  // ---- optional, but validated when present ----
  let abhaNumber = "", abhaAddress = "";
  if (s(o.abhaNumber)) {
    abhaNumber = normalizeAbhaNumber(o.abhaNumber);
    if (!abhaNumber) errors.abhaNumber = "An ABHA number is 14 digits.";
    else if (!verhoeffOk(abhaNumber)) errors.abhaNumber = "That ABHA number's check digit is wrong - re-enter it.";
  }
  if (s(o.abhaAddress)) {
    abhaAddress = normalizeAbhaAddress(o.abhaAddress);
    if (!abhaAddress) errors.abhaAddress = "An ABHA address looks like name@abdm.";
  }
  const pincode = digits(o.pincode);
  if (s(o.pincode) && pincode.length !== 6) errors.pincode = "A PIN code is 6 digits.";

  const visitType = VISIT_TYPES.indexOf(s(o.visitType).toLowerCase()) > -1 ? s(o.visitType).toLowerCase() : "new";

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    patient: {
      name, mobile, gender,
      birthDate, approxDob, ageYears, ageMonths,
      abhaNumber, abhaAddress,
      // ABDM linkage is unlawful without recorded consent, so it is part of the record from day one -
      // never an afterthought bolted on when the gateway is wired up.
      abhaConsent: !!(abhaNumber || abhaAddress) && !!o.abhaConsent,
      address: s(o.address).slice(0, 200), district: s(o.district).slice(0, 60),
      state: s(o.state).slice(0, 60), pincode,
      visitType,
      referredBy: s(o.referredBy).slice(0, 80),
      mrnSupplied: s(o.mrn)
    }
  };
}

// A patient carrying ABHA identifiers but no recorded consent must not be linked to ABDM. The form
// blocks it; this is the server-side truth the linking layer will read.
export function abhaLinkable(p) {
  return !!(p && (p.abhaNumber || p.abhaAddress) && p.abhaConsent);
}

// Cheap duplicate key: same mobile at the same clinic is almost always the same person returning.
export function duplicateKey(orgId, mobile) {
  const m = normalizeMobile(mobile);
  return m ? s(orgId) + "__" + m : "";
}
