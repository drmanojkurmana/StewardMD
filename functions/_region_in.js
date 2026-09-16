/* functions/_region_in.js - the India profile: identifiers and tax fields that exist only because a
 * hospital is in India. P2.6.
 *
 * AN ADAPTER, NOT A CORE FIELD. The org and membership models carry one opaque `regionProfile` bag,
 * and this file is the only thing that decides what may go in it. For a hospital whose region is not
 * IN the bag is always empty, so a US hospital can never be handed a GSTIN, and nothing in the
 * clinical core reads these fields at all.
 *
 * FORMAT CHECKS ONLY. A GSTIN that passes here has the right shape and check character; it is not
 * thereby registered, active, or this hospital's. An HFR or HPR id that passes has the right shape;
 * only the ABDM registries can say it exists. Nothing here calls a registry.
 *
 * NO ITEM RATE IS EVER ASSUMED. The rates the law itself fixes for a hospital (room rent, exempt health
 * care, the in-patient composite supply) are applied below with their notifications cited; every other
 * rate is the hospital's own, set per Price list item. An item the law does not settle and the hospital
 * gave no `gstRate` carries no GST line - it is reported as "not configured", never as 0 percent.
 *
 * PURE. No I/O, no clock.
 */

import { regionOf } from "./_region.js";

const s = (v) => (v == null ? "" : String(v).trim());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---------------------------------------------------------------- GSTIN
 *
 * 15 characters: 2-digit state code, the 10-character PAN, the entity number (1-9 or A-Z), a letter
 * (Z today), and a check character. The check character is the published mod-36 scheme: each of the
 * first 14 characters valued 0-9A-Z, weighted 1,2,1,2..., each product folded (quotient + remainder
 * by 36), summed, and the check is (36 - sum mod 36) mod 36. Pinned by test against the GST portal's
 * own example GSTIN.
 */
const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function normalizeGstin(raw) { return s(raw).toUpperCase().replace(/\s+/g, ""); }
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}
export function isValidGstin(raw) {
  const g = normalizeGstin(raw);
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/.test(g)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/* ---------------------------------------------------------------- ABDM registry ids
 *
 * HFR facility id: "IN" followed by 10 digits, as the Health Facility Registry issues them.
 * HPR professional id: 14 digits, shown grouped like an ABHA number. No check digit is published for
 * either, so only the shape is checked. VERIFY both against the current ABDM registry specification
 * before relying on a refusal: a rule that is wrong here refuses a real facility.
 */
export function normalizeHfrId(raw) { return s(raw).toUpperCase().replace(/[\s-]+/g, ""); }
export function isValidHfrId(raw) { return /^IN\d{10}$/.test(normalizeHfrId(raw)); }
export function normalizeHprId(raw) { return s(raw).replace(/[\s-]+/g, ""); }
export function isValidHprId(raw) { return /^\d{14}$/.test(normalizeHprId(raw)); }

/* ---------------------------------------------------------------- the profile bags */

/**
 * PURE. What an org's regionProfile may hold. Unknown keys are dropped; a non-IN hospital gets {}.
 * Values are stored normalised. Validation (with messages) is validateOrgProfile below; this only
 * decides shape, so a stored document can never carry a field its region does not have.
 */
export function orgProfile(p, region) {
  if (regionOf({ region }) !== "IN" || !p || typeof p !== "object") return {};
  const out = {};
  if (s(p.gstin)) out.gstin = normalizeGstin(p.gstin);
  if (s(p.hfrId)) out.hfrId = normalizeHfrId(p.hfrId);
  return out;
}
export function memberProfile(p, region) {
  if (regionOf({ region }) !== "IN" || !p || typeof p !== "object") return {};
  return s(p.hprId) ? { hprId: normalizeHprId(p.hprId) } : {};
}

/** PURE. Field errors for an org profile write, keyed by field. Empty object means acceptable. */
export function validateOrgProfile(p, region) {
  const errors = {};
  if (!p || typeof p !== "object") return errors;
  const has = s(p.gstin) || s(p.hfrId);
  if (regionOf({ region }) !== "IN") {
    if (has) errors.region = "GSTIN and HFR facility id apply only to a hospital in India.";
    return errors;
  }
  if (s(p.gstin) && !isValidGstin(p.gstin)) errors.gstin = "That GSTIN is not valid. It is 15 characters and its last character is a check character - re-enter it.";
  if (s(p.hfrId) && !isValidHfrId(p.hfrId)) errors.hfrId = "An HFR facility id is IN followed by 10 digits.";
  return errors;
}
export function validateMemberProfile(p, region) {
  const errors = {};
  if (!p || typeof p !== "object" || !s(p.hprId)) return errors;
  if (regionOf({ region }) !== "IN") errors.region = "An HPR id applies only to a hospital in India.";
  else if (!isValidHprId(p.hprId)) errors.hprId = "An HPR id is 14 digits.";
  return errors;
}

/* ---------------------------------------------------------------- GST on an invoice
 *
 * THE LAW THIS APPLIES (gap-claims-gst B, 2026-09-16), each read from the primary text:
 * - Health care services by a clinical establishment are exempt: Notification 12/2017-Central Tax (Rate), serial
 *   74, Heading 9993.
 * - EXCEPT a room [other than ICU/CCU/ICCU/NICU] with room charges exceeding Rs. 5000 per day: Notification
 *   04/2022-Central Tax (Rate) inserts that proviso into serial 74
 *   (https://cbic-gst.gov.in/pdf/central-tax-rate/04_2022-ctr-eng.pdf), and Notification 03/2022-Central Tax (Rate)
 *   inserts entry 31A in Notification 11/2017-Central Tax (Rate), Heading 9993, at 2.5 percent central tax (5
 *   percent GST with the state half) where input tax credit has not been taken
 *   (https://cbic-gst.gov.in/pdf/central-tax-rate/03_2022-ctr-eng.pdf). Both in force from 18 July 2022. The whole
 *   day's room charge is taxed once it exceeds Rs 5000; an intensive care room is exempt at any price. Whether a
 *   room is ICU/CCU/ICCU/NICU is the Price list row's own marker, NEVER guessed from a ward name.
 * - Medicines supplied to an IN-PATIENT are part of the composite supply of health care, taxed as the principal
 *   (exempt) supply: Sections 2(30) and 8(a) CGST Act, applied to hospitals by Circular 32/06/2018-GST
 *   (https://cbic-gst.gov.in/pdf/circularno-32-cgst.pdf; its own text names food to in-patients, medicines follow
 *   the same reasoning, see vault/decisions/Decisions.md 2026-09-16). A medicine sold to an OUTPATIENT is its own
 *   supply, taxed at that medicine's own rate from the Price list.
 * - SAC codes (Annexure to Notification 11/2017-CT(Rate),
 *   https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification11-CGST-Annexure.pdf): 999311 inpatient
 *   services, 999312 medical and dental, 999314 nursing, 999316 laboratory and imaging. The hospital enters them
 *   per Price list row; none is filled in here.
 */
export const ROOM_THRESHOLD_PER_DAY = 5000;
export const ROOM_GST_RATE = 5;
export const GST_BASIS = Object.freeze({
  ROOM_OVER_THRESHOLD: "room_over_5000_per_day", ICU_ROOM: "intensive_care_room_exempt", HEALTHCARE: "healthcare_exempt",
  INPATIENT_COMPOSITE: "inpatient_composite_exempt", TARIFF_EXEMPT: "exempt_by_price_list", TARIFF_RATE: "price_list_rate",
});
const HEALTHCARE_KINDS = ["nursing", "visit", "investigation", "service"];

/**
 * PURE. The GST owed on priced lines, from the hospital's own tariff and the rules above.
 *
 * opts.inpatient: the bill is for an inpatient stay (medicines follow the exempt composite supply).
 * Each line out: { code, kind, hsnSac, taxable, gstRate, gstExempt, tax, basis }.
 * - a bed row: over Rs 5000 a day and not intensive care, 5 percent; otherwise exempt.
 * - a medicine on an inpatient bill: exempt. Anything else with `gstExempt: true`: exempt.
 * - nursing, visit, test or service with no rate: exempt health care (Heading 9993).
 * - a valid rate: tax = line x rate / 100, rounded to paise.
 * - no rate on anything else (an outpatient medicine, a configured entry of no kind): NO TAX LINE, listed in
 *   `unconfigured`, never treated as 0 percent. A rate that is not a number in 0-100: listed in `invalid`.
 * - a taxed line with no HSN/SAC: taxed, and listed in `missingHsnSac` (it cannot go on an e-invoice).
 * Region other than IN: `applies: false` and nothing is computed.
 */
export function gstForLines(lines, tariff, region, opts) {
  const o = opts || {};
  const out = { applies: regionOf({ region }) === "IN", lines: [], totalTax: 0, unconfigured: [], invalid: [], missingHsnSac: [] };
  if (!out.applies) return out;
  const table = {};
  for (const k of Object.keys(tariff && typeof tariff === "object" ? tariff : {})) table[s(k).toUpperCase()] = tariff[k];
  for (const l of lines || []) {
    const code = s(l && l.code);
    const entry = table[code.toUpperCase()];
    const e = entry && typeof entry === "object" ? entry : {};
    const kind = s(e.kind) || null, hsnSac = s(e.hsnSac) || null, taxable = round2(l && l.line);
    const exempt = (basis) => out.lines.push({ code, kind, hsnSac, taxable, gstRate: null, gstExempt: true, tax: 0, basis });
    const taxed = (rate, basis) => {
      const tax = round2(taxable * rate / 100);
      out.lines.push({ code, kind, hsnSac, taxable, gstRate: rate, gstExempt: false, tax, basis });
      out.totalTax = round2(out.totalTax + tax);
      if (rate > 0 && !hsnSac) out.missingHsnSac.push(code);
    };
    if (kind === "bed") {
      if (e.intensiveCare === true) { exempt(GST_BASIS.ICU_ROOM); continue; }
      if (Number(l.amount) > ROOM_THRESHOLD_PER_DAY) { taxed(ROOM_GST_RATE, GST_BASIS.ROOM_OVER_THRESHOLD); continue; }
      exempt(GST_BASIS.HEALTHCARE); continue;
    }
    if (kind === "medication" && o.inpatient) { exempt(GST_BASIS.INPATIENT_COMPOSITE); continue; }
    if (e.gstExempt === true) { exempt(GST_BASIS.TARIFF_EXEMPT); continue; }
    const noRate = e.gstRate === undefined || e.gstRate === null || e.gstRate === "";
    if (noRate && HEALTHCARE_KINDS.includes(kind)) { exempt(GST_BASIS.HEALTHCARE); continue; }
    if (noRate) { out.unconfigured.push(code); continue; }
    const rate = Number(e.gstRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { out.invalid.push(code); continue; }
    taxed(rate, GST_BASIS.TARIFF_RATE);
  }
  return out;
}

/** PURE. CGST and SGST (half each) within a state, IGST across states (Section 8 IGST Act); the caller decides which. */
export function gstSplit(tax, interState) {
  const t = round2(tax);
  if (interState) return { cgst: 0, sgst: 0, igst: t };
  const c = round2(t / 2);
  return { cgst: c, sgst: round2(t - c), igst: 0 };
}

/** PURE. The calendar date in India (IST, UTC+5:30) of an instant, YYYY-MM-DD, or "" when it is not a time. */
export function istDateOf(iso) {
  const ms = Date.parse(s(iso));
  return Number.isFinite(ms) ? new Date(ms + 330 * 60000).toISOString().slice(0, 10) : "";
}
/** PURE. The Indian financial year (April to March) of an instant, as "2627" for 2026-27. */
export function financialYearOf(iso) {
  const d = istDateOf(iso);
  if (!d) return "";
  const y = Number(d.slice(0, 4)), start = Number(d.slice(5, 7)) >= 4 ? y : y - 1;
  return String(start).slice(2) + String(start + 1).slice(2);
}
/** PURE. Section 34(2) CGST Act: a credit note reducing tax is declared no later than 30 November after the end of
 *  the financial year of the supply (or the annual return, if filed earlier; that date is not known here). */
export function section34Deadline(supplyIso) {
  const fy = financialYearOf(supplyIso);
  return fy ? `20${fy.slice(2)}-11-30` : "";
}

/** PURE. A B2B buyer as the cashier typed it: { buyer } or { errors } keyed by field. No GSTIN means no buyer (B2C). */
export function validateBuyer(b) {
  const r = b && typeof b === "object" ? b : {};
  if (!s(r.gstin)) return { buyer: null };
  const buyer = { gstin: normalizeGstin(r.gstin), legalName: s(r.legalName), address1: s(r.address1), location: s(r.location), pincode: s(r.pincode), stateCode: s(r.stateCode), pos: s(r.pos) || s(r.stateCode) };
  const errors = {};
  if (!isValidGstin(buyer.gstin)) errors.gstin = "That GSTIN is not valid.";
  if (buyer.legalName.length < 3 || buyer.legalName.length > 100) errors.legalName = "Legal name is 3 to 100 characters.";
  if (buyer.address1.length < 1 || buyer.address1.length > 100) errors.address1 = "Address is 1 to 100 characters.";
  if (buyer.location.length < 3 || buyer.location.length > 50) errors.location = "Place is 3 to 50 characters.";
  if (!/^[1-9]\d{5}$/.test(buyer.pincode)) errors.pincode = "PIN code is 6 digits.";
  if (!/^\d{2}$/.test(buyer.stateCode) || buyer.stateCode === "00") errors.stateCode = "State code is 2 digits.";
  else if (isValidGstin(buyer.gstin) && buyer.gstin.slice(0, 2) !== buyer.stateCode) errors.stateCode = "The state code does not match the GSTIN.";
  if (!/^\d{2}$/.test(buyer.pos) || buyer.pos === "00") errors.pos = "Place of supply is a 2-digit state code.";
  return Object.keys(errors).length ? { errors } : { buyer };
}
