/* functions/_region.js — what country a hospital is in, and the few things that actually follow.
 *
 * WardSynQ was written India-first, and that was right: it is where the first hospitals are. But
 * "India-first" had become "India-only" in places that are not a matter of taste - a US hospital
 * could not register a single patient, because the phone validator rejects every number that is not
 * a +91 mobile. This file is the ONE place that says what a region implies, so the answer cannot
 * drift between the registration desk, the ward and the prescription.
 *
 * WHAT THIS IS NOT. It is not localisation, not translation, and not a claim of regulatory
 * readiness. Being able to store a US phone number and a Celsius temperature is table stakes; HIPAA,
 * ONC certification, US Core conformance, DEA schedules for controlled substances and X12 claims are
 * none of them things a source file can grant, and nothing here should be read as granting them.
 *
 * DEFAULT IS INDIA, DELIBERATELY. Every hospital that exists today was created without a region and
 * is an Indian one; defaulting to IN means not a single existing record changes meaning. A US
 * hospital is an explicit choice its owner makes.
 *
 * PURE. No I/O, no dates, no randomness - so every rule here is unit-testable, and the desk and the
 * server can never disagree about whether a number is valid.
 */

const digits = (v) => String(v == null ? "" : v).replace(/\D+/g, "");

export const REGIONS = Object.freeze(["IN", "US"]);
export const DEFAULT_REGION = "IN";

/** PURE. The region an org is in. Anything unrecognised is India, for the reason in the header. */
export function regionOf(org) {
  const r = String((org && org.region) || "").toUpperCase();
  return REGIONS.includes(r) ? r : DEFAULT_REGION;
}

/* ---------------------------------------------------------------- telephone
 *
 * Stored E.164 either way, because that is what an SMS gateway wants and it is unambiguous. What
 * differs is which shapes are accepted and what counts as valid.
 */

/** PURE. India: a 10-digit mobile starting 6-9. Accepts 9876543210, 09876543210, +91 98765 43210. */
function normalizeIN(raw) {
  let d = digits(raw);
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return "";
  if (!/^[6-9]/.test(d)) return "";
  return "+91" + d;
}

/** PURE. US/NANP: 10 digits, area code and exchange both starting 2-9. Accepts 1-prefixed forms. */
function normalizeUS(raw) {
  let d = digits(raw);
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return "";
  // NANP: neither the area code nor the exchange may begin 0 or 1, and N11 area codes are service
  // codes (411, 911), never a subscriber. A number failing these is a typo, not a rare valid one.
  if (!/^[2-9]/.test(d) || !/^[2-9]/.test(d.slice(3))) return "";
  if (/^[0-9]11/.test(d)) return "";
  return "+1" + d;
}

/** PURE. E.164 for this region, or "" when the number is not valid there. */
export function normalizePhone(raw, region) {
  return regionOf({ region }) === "US" ? normalizeUS(raw) : normalizeIN(raw);
}
export function isValidPhone(raw, region) { return !!normalizePhone(raw, region); }

/** PURE. How a desk or a slip shows it: "+91 98765 43210" / "+1 (415) 555-0142". */
export function formatPhone(e164, region) {
  const d = digits(e164).slice(-10);
  if (d.length !== 10) return String(e164 == null ? "" : e164);
  return regionOf({ region }) === "US"
    ? `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** What a form should say it wants. Never guessed by the UI; asked for here. */
export function phoneLabel(region) {
  return regionOf({ region }) === "US" ? "Mobile number (10 digits)" : "Mobile number (10-digit Indian)";
}

/* ---------------------------------------------------------------- postcode
 *
 * India: 6 digits, always. US: a ZIP is 5 digits, or 9 with the +4 extension - a real shape a US
 * hospital's own address book already uses ("90210-1234"), not an edge case. This was hardcoded to
 * exactly 6 digits everywhere (the server AND the input's maxlength), so a US ZIP+4 could not even
 * be typed, let alone saved.
 */
export function isValidPostcode(raw, region) {
  const d = digits(raw);
  return regionOf({ region }) === "US" ? (d.length === 5 || d.length === 9) : d.length === 6;
}
export function postcodeLabel(region) { return regionOf({ region }) === "US" ? "ZIP code" : "PIN code"; }

/* ---------------------------------------------------------------- clinical units
 *
 * THIS IS THE DANGEROUS ONE. A temperature recorded in the wrong unit is not a cosmetic problem: 37.1
 * stored as Fahrenheit is profound hypothermia, and it will be read by somebody who was not in the
 * room. The units below are what a clinician in that country writes WITHOUT thinking about units,
 * which is exactly why the record must state the unit explicitly rather than inherit a default.
 */
export const UNITS = Object.freeze({
  IN: Object.freeze({ temp: "C", weight: "kg", height: "cm" }),
  US: Object.freeze({ temp: "F", weight: "lb", height: "in" }),
});

/** PURE. The unit a clinician in this region writes a vital in, unless the hospital says otherwise. */
export function unitsFor(region) { return UNITS[regionOf({ region })] || UNITS[DEFAULT_REGION]; }

/* ---------------------------------------------------------------- prescriber registration
 *
 * The number that makes a signature mean something. India: a state medical council or NMC
 * registration, which has no national check digit, so it is stored as written and its truth rests on
 * whoever asserted it. US: an NPI, which DOES carry a Luhn check digit over the number prefixed with
 * the NANP-style issuer 80840 - so a mistyped NPI can be caught here, offline, the same way
 * _opd_patient.js already catches a mistyped ABHA with its Verhoeff digit.
 *
 * A DEA number is a SEPARATE thing and deliberately absent: it authorises controlled substances, and
 * this product does not implement controlled-substance prescribing. Storing one would imply a
 * capability that is not there.
 */

/** PURE. Luhn over 80840 + the 9-digit NPI base, compared to the 10th digit. */
function npiValid(d) {
  if (!/^\d{10}$/.test(d)) return false;
  const body = "80840" + d.slice(0, 9);
  let sum = 0, dbl = true;                       // rightmost body digit is doubled
  for (let i = body.length - 1; i >= 0; i--) {
    let n = body.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

/**
 * PURE. Is this a usable prescriber registration for the region?
 *
 * India returns true for anything non-empty ON PURPOSE: council formats vary by state and there is
 * no checksum to lean on, so refusing a real doctor's real number because it did not match a
 * guessed pattern would be worse than accepting it. The record already says WHO vouched for it
 * (wardsynq-actors.js credentialSource), which is the honest control here.
 */
export function isValidPrescriberId(raw, region) {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return false;
  return regionOf({ region }) === "US" ? npiValid(digits(v)) : true;
}

/** What the Admin Center asks for. */
export function prescriberIdLabel(region) {
  return regionOf({ region }) === "US" ? "NPI (10 digits)" : "Medical council registration number";
}

/* ---------------------------------------------------------------- presentation */

/** PURE. Date field order, for a form that must not be ambiguous about 03/04. */
export function dateOrder(region) { return regionOf({ region }) === "US" ? "MDY" : "DMY"; }
/** PURE. The hospital's money. Not a conversion: a US hospital bills dollars, an Indian one rupees. */
export function currency(region) { return regionOf({ region }) === "US" ? { code: "USD", symbol: "$" } : { code: "INR", symbol: "₹" }; }
