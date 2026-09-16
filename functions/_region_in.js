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
/* Characters 3 to 12 are the PAN, or for a tax deductor's registration (14th character D) its TAN (4 letters, 5 digits,
 * a letter): a government payer that holds a GSTIN only as a GST TDS deductor is still a registered recipient for
 * e-invoicing (GST e-invoice FAQ Q9, Q13). The IRP schema itself accepts any 2 digits and 13 characters
 * (https://einv-apisandbox.nic.in/version1.03/generate-irn.html, BuyerDtls.Gstin). */
export function isValidGstin(raw) {
  const g = normalizeGstin(raw);
  if (!/^\d{2}([A-Z]{5}\d{4}[A-Z]|[A-Z]{4}\d{5}[A-Z])[1-9A-Z][A-Z][0-9A-Z]$/.test(g)) return false;
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
 *   services, 999312 medical and dental, 999314 nursing, 999315 ambulance, 999316 laboratory and imaging.
 *
 * THE GST TREATMENT REVIEW OF PACKAGE BILLING (gst-packages, 17 September 2026, Section 2) refines this:
 * - "IN-PATIENT" IS A PROPERTY OF THE STAY, NOT OF THE ITEM KIND (2.1 rule 2). Every good or service supplied to an
 *   admitted patient is exempt composite health care (four advance rulings in four states: medicines, implants,
 *   consumables, food), whether inside a package or billed as an exclusion, unless it is a non-ICU room above Rs 5,000
 *   a day or its Price list row is marked not health care (attendant food or bed, cosmetic procedure, retail). A rate
 *   on the row (set because the item is also sold to outpatients) does not tax it on an in-patient bill.
 * - THE ROOM TEST IS PER DAY (2.1 rules 3, 4): a bed priced per shift or per hour is converted to 24 hours, and the
 *   day's bed lines are added up; the whole day's charge is taxed once it exceeds Rs 5,000, not the excess.
 * - INTENSIVE CARE IS A PRICE LIST CLASS SET BY AN ADMINISTRATOR (2.1 rule 5): ICU, CCU, ICCU, NICU exempt (confirmed);
 *   a specialty ICU exempt by default (probable); HDU and step-down ordinary rooms by default (the hospital's setting).
 * - OUTPATIENTS: consultation, tests, nursing and ambulance are exempt (Sl. 74); a medicine given during the visit is
 *   part of that service; a medicine dispensed to take away is a taxable sale at its own rate (Kerala AAAR
 *   AAR/03/2018 para 14). Take-home medicines at discharge billed outside a package are taxed by default.
 * - RATES ARE NEVER ASSUMED (2.1 rule 6): a taxable line with no rate is listed in `unconfigured`, and the bill is refused.
 * - The printed SAC (2.2): 999311 for anything on an in-patient bill (the principal supply, never a medicine's own HSN),
 *   the row's own 9993xx code where it has one; a taxable good keeps its own HSN from the row.
 */
export const ROOM_THRESHOLD_PER_DAY = 5000;
export const ROOM_GST_RATE = 5;
export const GST_BASIS = Object.freeze({
  ROOM_OVER_THRESHOLD: "room_over_5000_per_day", ICU_ROOM: "intensive_care_room_exempt", HEALTHCARE: "healthcare_exempt",
  INPATIENT_COMPOSITE: "inpatient_composite_exempt", TARIFF_EXEMPT: "exempt_by_price_list", TARIFF_RATE: "price_list_rate",
  PACKAGE: "package_exempt", PACKAGE_ROOM: "package_room_over_5000_per_day", NON_HEALTHCARE: "not_health_care", TAKE_HOME: "take_home_medicine",
});
const HEALTHCARE_KINDS = ["nursing", "visit", "investigation", "service"];
export const SAC = Object.freeze({ INPATIENT: "999311", MEDICAL: "999312", NURSING: "999314", AMBULANCE: "999315", DIAGNOSTIC: "999316" });
const NAMED_ICU = ["ICU", "CCU", "ICCU", "NICU"];

function tableOf(tariff) {
  const table = {};
  for (const k of Object.keys(tariff && typeof tariff === "object" ? tariff : {})) table[s(k).toUpperCase()] = tariff[k];
  return (code) => { const e = table[s(code).toUpperCase()]; return e && typeof e === "object" ? e : {}; };
}
/** PURE. Whether a bed row is an intensive care unit, exempt at any price, under the hospital's intensiveCareUnits setting.
 *  A row marked only with the older `intensiveCare: true` is one of the four named units. */
export function isIntensiveCare(entry, settings) {
  const e = entry || {};
  const cls = s(e.intensiveCareClass).toUpperCase() || (e.intensiveCare === true ? "ICU" : "");
  const units = (settings && settings.intensiveCareUnits) || "named_and_specialty";
  if (NAMED_ICU.includes(cls)) return true;
  if (cls === "ICU_SPECIALTY") return units !== "named_only";
  if (cls === "HDU") return units === "include_hdu";
  return false;
}
/** PURE. A bed row's charge for 24 hours: a price per shift or per hour is converted (review 2.1 rule 4). */
export function perDayTariff(entry) {
  const h = Number(entry && entry.unitHours);
  return round2(Number(entry && entry.amount) * (h >= 1 && h < 24 ? 24 / h : 1));
}
/** The stay day a bed or daily nursing line belongs to (charge-capture.js stayDayItems source ids), or null. */
function dayKey(l) {
  const id = s(l && l.sourceId);
  const m = /^(.*):bed:(\d+)$/.exec(id) || /^(.*?):nursing:.*:(\d+)$/.exec(id);
  return m ? `${m[1]}#${m[2]}` : null;
}

/**
 * PURE. The GST owed on priced lines, from the hospital's own tariff and the rules above.
 *
 * opts.inpatient: the bill is for an admitted patient's stay. opts.settings: the hospital's GST settings
 * (functions/_wardsynq/gst-settings.js readGstSettings; absent means every default).
 * Each line out: { code, kind, hsnSac, taxable, gstRate, gstExempt, tax, basis }.
 * - a bed: the day's room charge over Rs 5000 and not intensive care, 5 percent on the whole line; otherwise exempt.
 *   With roomChargeBasis "bed_and_daily_nursing" the day's nursing lines count toward the test and are taxed with it.
 * - a row marked not health care: its own rate, on any bill.
 * - in-patient: a take-home medicine at discharge at its own rate (unless dischargeMedsAsComposite), all else exempt.
 * - outpatient: nursing, visit, test, service and a medicine given during the visit exempt; anything else at its rate.
 * - no rate where one is needed: NO TAX LINE, listed in `unconfigured` (the caller refuses the bill), never 0 percent.
 *   A rate that is not a number in 0-100: listed in `invalid`. A taxed line with no HSN/SAC: listed in `missingHsnSac`.
 * Region other than IN: `applies: false` and nothing is computed.
 */
export function gstForLines(lines, tariff, region, opts) {
  const o = opts || {}, set = o.settings || {};
  const out = { applies: regionOf({ region }) === "IN", lines: [], totalTax: 0, unconfigured: [], invalid: [], missingHsnSac: [] };
  if (!out.applies) return out;
  const entryOf = tableOf(tariff);
  const withNursing = set.roomChargeBasis === "bed_and_daily_nursing";
  /* The room charge of each stay day: its bed lines, plus its nursing lines when the hospital counts them. */
  const dayCharge = new Map(), taxedDays = new Set();
  for (const l of lines || []) {
    const e = entryOf(l && l.code), k = dayKey(l);
    if (k && (e.kind === "bed" || (withNursing && e.kind === "nursing"))) dayCharge.set(k, round2((dayCharge.get(k) || 0) + (Number(l.line) || 0)));
  }
  const roomTaxed = (l, e) => {
    const k = dayKey(l);
    const perDay = Math.max(perDayTariff(e), k ? dayCharge.get(k) || 0 : round2(l.line));
    if (perDay > ROOM_THRESHOLD_PER_DAY && k) taxedDays.add(k);
    return perDay > ROOM_THRESHOLD_PER_DAY;
  };
  const beds = (lines || []).filter((l) => entryOf(l && l.code).kind === "bed");
  const bedTaxed = new Map(beds.map((l) => [l, !isIntensiveCare(entryOf(l.code), set) && roomTaxed(l, entryOf(l.code))]));
  for (const l of lines || []) {
    const code = s(l && l.code), e = entryOf(code);
    const kind = s(e.kind) || null, rowHsn = s(e.hsnSac) || null, taxable = round2(l && l.line);
    const healthSac = rowHsn && /^9993\d{2}$/.test(rowHsn) ? rowHsn : null;
    const exempt = (basis, hsnSac) => out.lines.push({ code, kind, hsnSac: hsnSac || null, taxable, gstRate: null, gstExempt: true, tax: 0, basis });
    const taxed = (rate, basis, hsnSac) => {
      const tax = round2(taxable * rate / 100);
      out.lines.push({ code, kind, hsnSac: hsnSac || null, taxable, gstRate: rate, gstExempt: false, tax, basis });
      out.totalTax = round2(out.totalTax + tax);
      if (rate > 0 && !hsnSac) out.missingHsnSac.push(code);
    };
    const atRowRate = (basis) => {
      if (e.gstExempt === true) return exempt(GST_BASIS.TARIFF_EXEMPT, rowHsn);
      if (e.gstRate === undefined || e.gstRate === null || e.gstRate === "") return void out.unconfigured.push(code);
      const rate = Number(e.gstRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return void out.invalid.push(code);
      taxed(rate, basis, rowHsn);
    };
    if (kind === "bed") {
      if (isIntensiveCare(e, set)) exempt(GST_BASIS.ICU_ROOM, healthSac || SAC.INPATIENT);
      else if (bedTaxed.get(l)) taxed(ROOM_GST_RATE, GST_BASIS.ROOM_OVER_THRESHOLD, healthSac || SAC.INPATIENT);
      else exempt(GST_BASIS.HEALTHCARE, healthSac || SAC.INPATIENT);
      continue;
    }
    if (kind === "nursing" && withNursing && taxedDays.has(dayKey(l))) { taxed(ROOM_GST_RATE, GST_BASIS.ROOM_OVER_THRESHOLD, healthSac || SAC.INPATIENT); continue; }
    if (e.nonHealthcare === true) { atRowRate(GST_BASIS.NON_HEALTHCARE); continue; }
    if (o.inpatient) {
      if (kind === "medication" && l.takeHome === true && set.dischargeMedsAsComposite !== "composite") { atRowRate(GST_BASIS.TAKE_HOME); continue; }
      exempt(HEALTHCARE_KINDS.includes(kind) ? GST_BASIS.HEALTHCARE : GST_BASIS.INPATIENT_COMPOSITE, healthSac || SAC.INPATIENT);
      continue;
    }
    if (HEALTHCARE_KINDS.includes(kind)) {
      exempt(GST_BASIS.HEALTHCARE, healthSac || (kind === "investigation" ? SAC.DIAGNOSTIC : kind === "nursing" ? SAC.NURSING : l.sourceType === "AmbulanceTrip" ? SAC.AMBULANCE : SAC.MEDICAL));
      continue;
    }
    if (kind === "medication" && l.sourceType === "MedicationAdministration") { exempt(GST_BASIS.HEALTHCARE, healthSac || SAC.MEDICAL); continue; }
    atRowRate(GST_BASIS.TARIFF_RATE);
  }
  return out;
}

/**
 * PURE. The room inside a package (review 2.3, Q1a/Q1b): a non-ICU room above Rs 5,000 a day is carved out of the
 * exempt package and taxed at 5 percent without input tax credit, "to the extent of amount charged for the room".
 *
 * pkg: { code, name, rate, roomRatePerDay?, priceIncludesGst? }. lines: the stay's lines against its package
 * (packages.js applyPackage; a covered charge carries packageIncluded). settings: readGstSettings().
 * Valuation (pkgRoomValuation): published_tariff, each covered non-ICU room day at the hospital's per-day tariff for its
 * bed row, summed over the days above Rs 5,000 and capped at the package price; scheme_rate, the payer's own per-day
 * room rate entered on the package (the tariff when none is entered, said as a fallback); proportional_split, the
 * package price times the room days' tariff over the tariff of everything the package covered, taxed when that share
 * per day exceeds Rs 5,000 (the published tariff when a covered item has no price, said as a fallback).
 * Returns { error: "room_tariff_missing", category } when a covered room day has no bed row (its class and tariff are
 * unknown, so nothing can be worked out), { roomValue: 0, method, fallback } when no day qualifies, else
 * { roomValue, taxable, tax, exemptValue, days, groups, method, fallback, capped, priceIncludesGst, unrecoverableGst }.
 */
export function packageRoomComponent(pkg, lines, tariff, settings) {
  const set = settings || {}, entryOf = tableOf(tariff), price = round2(pkg && pkg.rate);
  const covered = (lines || []).filter((l) => l && l.packageIncluded);
  const withNursing = set.roomChargeBasis === "bed_and_daily_nursing";
  const nursing = new Map();
  if (withNursing) for (const l of covered) { const e = entryOf(l.code), k = dayKey(l); if (k && e.kind === "nursing") nursing.set(k, round2((nursing.get(k) || 0) + Number(e.amount || 0) * (Number(l.quantity) || 1))); }
  const asked = set.pkgRoomValuation || "published_tariff";
  const schemeRate = asked === "scheme_rate" && Number(pkg && pkg.roomRatePerDay) > 0 ? round2(pkg.roomRatePerDay) : null;
  let method = asked === "scheme_rate" && schemeRate == null ? "published_tariff" : asked, fallback = asked !== method;
  const roomDays = [];
  for (const d of covered) {
    const e = entryOf(d.code);
    if (e.kind !== "bed" && !/:bed:\d+$/.test(s(d.sourceId))) continue;
    if (e.kind !== "bed") return { error: "room_tariff_missing", category: s(d.display) || s(d.code) };
    if (isIntensiveCare(e, set)) continue;
    const tariffRate = round2(perDayTariff(e) + (nursing.get(dayKey(d)) || 0));
    roomDays.push({ name: s(e.description) || s(d.code), tariffRate, rate: schemeRate != null ? schemeRate : tariffRate });
  }
  let roomValue = 0, capped = false, qualifying = [];
  if (method === "proportional_split" && roomDays.length) {
    let ssp = 0, unpriced = false;
    for (const l of covered) {
      const e = entryOf(l.code), amt = e.amount === "" || e.amount == null ? NaN : Number(e.amount);
      if (!Number.isFinite(amt)) { unpriced = true; break; }
      ssp += amt * (Number(l.quantity) || 1);
    }
    if (unpriced || !(ssp > 0)) { method = "published_tariff"; fallback = true; }
    else {
      const share = round2(price * roomDays.reduce((n, d) => n + d.tariffRate, 0) / ssp);
      const perDay = round2(share / roomDays.length);
      if (perDay > ROOM_THRESHOLD_PER_DAY) { roomValue = Math.min(share, price); qualifying = roomDays.map((d) => ({ ...d, rate: perDay })); }
    }
  }
  if (method !== "proportional_split") {
    qualifying = roomDays.filter((d) => d.rate > ROOM_THRESHOLD_PER_DAY);
    const sum = round2(qualifying.reduce((n, d) => n + d.rate, 0));
    capped = sum > price;
    roomValue = capped ? price : sum;
  }
  if (!(roomValue > 0)) return { roomValue: 0, method, fallback };
  const groups = [];
  for (const d of qualifying) {
    const g = groups.find((x) => x.name === d.name && x.ratePerDay === d.rate);
    if (g) g.days += 1; else groups.push({ name: d.name, days: 1, ratePerDay: d.rate });
  }
  const inclusive = pkg.priceIncludesGst === true;
  const tax = round2(roomValue * ROOM_GST_RATE / (inclusive ? 100 + ROOM_GST_RATE : 100));
  return { roomValue, taxable: inclusive ? round2(roomValue - tax) : roomValue, tax, exemptValue: round2(price - roomValue), days: qualifying.length, groups,
    method, fallback, capped, priceIncludesGst: inclusive, unrecoverableGst: inclusive ? tax : 0 };
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

/** PURE. A B2B buyer as the cashier typed it: { buyer } or { errors } keyed by field. No GSTIN means no buyer (B2C).
 *  kind: "payer" for an insurer, TPA or scheme paying a cashless claim; "business" for a company or other registered
 *  buyer that is itself liable to pay (the default). */
export function validateBuyer(b) {
  const r = b && typeof b === "object" ? b : {};
  if (!s(r.gstin)) return { buyer: null };
  const buyer = { gstin: normalizeGstin(r.gstin), kind: r.kind === "payer" ? "payer" : "business", legalName: s(r.legalName), address1: s(r.address1), location: s(r.location), pincode: s(r.pincode), stateCode: s(r.stateCode), pos: s(r.pos) || s(r.stateCode) };
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
