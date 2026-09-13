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
 * NO TAX RATE LIVES IN THIS FILE, AND NONE IS EVER ASSUMED. Many healthcare services in India are
 * exempt from GST and some items are not; which is which is the hospital's own tax position, set
 * per tariff item by the hospital (and its accountant). A tariff item with no `gstRate` carries no
 * GST line - it is reported as "not configured", never as 0 percent and never as a default slab.
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

/* ---------------------------------------------------------------- GST on an invoice */

/**
 * PURE. The GST owed on priced lines, from the hospital's own tariff.
 *
 * A tariff entry may carry `gstRate` (a percentage the hospital set, 0-100) and/or `gstExempt: true`.
 * - exempt: no tax, and the line says exempt.
 * - a valid rate: tax = line x rate / 100, rounded to paise, per line.
 * - no rate: NO TAX LINE, reported in `unconfigured` - never treated as 0 percent.
 * - a rate that is not a number in 0-100: reported in `invalid`, and no tax line.
 * Region other than IN: `applies: false` and nothing is computed.
 *
 * The CGST/SGST versus IGST split depends on place of supply, which this file does not know, so it
 * is not invented: the total GST is reported and the split is left to the hospital's accounts.
 *
 * @returns {{applies:boolean, lines:object[], totalTax:number, unconfigured:string[], invalid:string[]}}
 */
export function gstForLines(lines, tariff, region) {
  const out = { applies: regionOf({ region }) === "IN", lines: [], totalTax: 0, unconfigured: [], invalid: [] };
  if (!out.applies) return out;
  const table = {};
  for (const k of Object.keys(tariff && typeof tariff === "object" ? tariff : {})) table[s(k).toUpperCase()] = tariff[k];
  for (const l of lines || []) {
    const code = s(l && l.code);
    const entry = table[code.toUpperCase()];
    const e = entry && typeof entry === "object" ? entry : {};
    if (e.gstExempt === true) { out.lines.push({ code, gstRate: null, gstExempt: true, tax: 0 }); continue; }
    if (e.gstRate === undefined || e.gstRate === null || e.gstRate === "") { out.unconfigured.push(code); continue; }
    const rate = Number(e.gstRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { out.invalid.push(code); continue; }
    const tax = round2((Number(l.line) || 0) * rate / 100);
    out.lines.push({ code, gstRate: rate, gstExempt: false, tax });
    out.totalTax = round2(out.totalTax + tax);
  }
  return out;
}
