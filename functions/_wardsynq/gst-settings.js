/* functions/_wardsynq/gst-settings.js - the hospital's GST settings (gst-packages, 2026-09-17). PURE.
 *
 * WHERE THE LAW IS NOT SETTLED, THE HOSPITAL'S CHARTERED ACCOUNTANT DECIDES. The GST treatment review of hospital
 * package billing (17 September 2026, Section 3) lists the questions no notification, circular or ruling answers.
 * Each one is a setting here whose default is the review's safest reading, so a hospital that never opens the screen
 * is billed on that reading. Choosing anything else needs the chartered accountant's written opinion reference and
 * date, and every change needs a reason (the route audits it). The screen is Admin > Price list > GST settings.
 *
 *   pkgRoomValuation           a room above Rs 5,000 a day inside a package is carved out and taxed at 5 percent;
 *                              valued at the hospital's published per-day tariff (default), the payer's own per-day
 *                              room rate on the package, or a proportional split of the package price (review 2.3).
 *   recipientOfCashlessClaims  who receives the service in a cashless claim (s.2(93)(a) CGST Act): the patient
 *                              (default, B2C, insurer named as payer only) or the insurer, TPA or scheme (B2B).
 *   placeOfSupply              where a health service is performed (default, CGST + SGST; IGST Act s.12(4), probable)
 *                              or the registered recipient's state (IGST across states).
 *   intensiveCareUnits         only ICU, CCU, ICCU and NICU are named; specialty ICUs (PICU, MICU, SICU) are exempt
 *                              by default (probable); HDU and step-down are ordinary rooms unless chosen otherwise.
 *   roomChargeBasis            the bed tariff as billed is the room charge (default), or daily nursing charges billed
 *                              separately count toward the Rs 5,000 test and are taxed with the room.
 *   dischargeMedsAsComposite   take-home medicines at discharge billed outside a package are taxed at the item's rate
 *                              (default) or treated as part of the exempt in-patient supply.
 *   gstTdsDeductorSchemes      government schemes the hospital has confirmed are notified GST TDS deductors (s.51);
 *                              none by default. Only a note on the bill: nothing is deducted here.
 *   aggregateTurnoverRs        the highest aggregate turnover in any financial year from 2017-18, INCLUDING exempt
 *                              supplies (s.2(6)); e-invoicing applies above Rs 5 crore (Notification 10/2023-CT).
 */

export const EINVOICE_TURNOVER_THRESHOLD = 50000000;
export const TDS_SCHEMES = Object.freeze(["pmjay", "state", "cghs", "echs"]);

/* Each choice setting: its allowed values, the first being the default. */
export const GST_CHOICES = Object.freeze({
  pkgRoomValuation: Object.freeze(["published_tariff", "scheme_rate", "proportional_split"]),
  recipientOfCashlessClaims: Object.freeze(["patient", "payer"]),
  placeOfSupply: Object.freeze(["where_performed", "recipient_state"]),
  intensiveCareUnits: Object.freeze(["named_and_specialty", "named_only", "include_hdu"]),
  roomChargeBasis: Object.freeze(["bed_tariff", "bed_and_daily_nursing"]),
  dischargeMedsAsComposite: Object.freeze(["taxed", "composite"]),
});
export const GST_SETTING_KEYS = Object.freeze([...Object.keys(GST_CHOICES), "gstTdsDeductorSchemes", "aggregateTurnoverRs", "caOpinionRef", "caOpinionDate"]);

const str = (v) => (v == null ? "" : String(v)).trim();

/** PURE. The settings as the org config holds them, every absent or unknown value read as its default. */
export function readGstSettings(wardsynqCfg) {
  const g = wardsynqCfg && wardsynqCfg.gst && typeof wardsynqCfg.gst === "object" ? wardsynqCfg.gst : {};
  const out = {};
  for (const k of Object.keys(GST_CHOICES)) out[k] = GST_CHOICES[k].includes(g[k]) ? g[k] : GST_CHOICES[k][0];
  out.gstTdsDeductorSchemes = Array.isArray(g.gstTdsDeductorSchemes) ? TDS_SCHEMES.filter((s) => g.gstTdsDeductorSchemes.includes(s)) : [];
  const t = Number(g.aggregateTurnoverRs);
  out.aggregateTurnoverRs = g.aggregateTurnoverRs == null || g.aggregateTurnoverRs === "" || !Number.isFinite(t) ? null : t;
  out.caOpinionRef = str(g.caOpinionRef) || null;
  out.caOpinionDate = str(g.caOpinionDate) || null;
  return out;
}

/** PURE. Which settings differ from the review's default (the ones that need the chartered accountant's opinion). */
export function nonDefaultKeys(settings) {
  const s = settings || {};
  return Object.keys(GST_CHOICES).filter((k) => s[k] !== GST_CHOICES[k][0]).concat((s.gstTdsDeductorSchemes || []).length ? ["gstTdsDeductorSchemes"] : []);
}

/** PURE. A full settings object from what the screen sent: { value, errors }. Absent keys keep what is saved. */
export function validateGstSettings(input, beforeCfg) {
  const errors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value: null, errors: { settings: "Send the settings as an object." } };
  for (const k of Object.keys(input)) if (!GST_SETTING_KEYS.includes(k)) errors[k] = "This is not one of the GST settings.";
  const value = readGstSettings(beforeCfg);
  for (const k of Object.keys(GST_CHOICES)) {
    if (input[k] === undefined) continue;
    if (!GST_CHOICES[k].includes(input[k])) errors[k] = `Choose one of: ${GST_CHOICES[k].join(", ")}.`;
    else value[k] = input[k];
  }
  if (input.gstTdsDeductorSchemes !== undefined) {
    const v = input.gstTdsDeductorSchemes;
    if (!Array.isArray(v) || v.some((s) => !TDS_SCHEMES.includes(s))) errors.gstTdsDeductorSchemes = `Schemes are among: ${TDS_SCHEMES.join(", ")}.`;
    else value.gstTdsDeductorSchemes = TDS_SCHEMES.filter((s) => v.includes(s));
  }
  if (input.aggregateTurnoverRs !== undefined) {
    const t = str(input.aggregateTurnoverRs);
    if (!t) value.aggregateTurnoverRs = null;
    else if (!/^\d{1,14}$/.test(t)) errors.aggregateTurnoverRs = "Aggregate turnover is a whole number of rupees, or blank for not entered.";
    else value.aggregateTurnoverRs = Number(t);
  }
  if (input.caOpinionRef !== undefined) value.caOpinionRef = str(input.caOpinionRef).slice(0, 200) || null;
  if (input.caOpinionDate !== undefined) {
    const d = str(input.caOpinionDate);
    if (d && !(/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)))) errors.caOpinionDate = "The opinion date is a date (YYYY-MM-DD).";
    else value.caOpinionDate = d || null;
  }
  if (!Object.keys(errors).length && nonDefaultKeys(value).length && !(value.caOpinionRef && value.caOpinionDate)) {
    errors.caOpinionRef = "A setting other than the default needs your chartered accountant's written opinion reference and its date.";
  }
  return { value, errors };
}

/** PURE. The settings a save changes. */
export function changedGstKeys(beforeCfg, value) {
  const before = readGstSettings(beforeCfg);
  return GST_SETTING_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(value[k]));
}

/** PURE. Whether e-invoicing applies: aggregate turnover including exempt supplies above Rs 5 crore. Not entered
 *  means not known, and the IRN route says so rather than guessing either way. */
export function einvoiceApplicability(settings) {
  const t = settings && settings.aggregateTurnoverRs;
  if (t == null) return { applies: false, reason: "turnover_not_entered" };
  return t > EINVOICE_TURNOVER_THRESHOLD ? { applies: true } : { applies: false, reason: "below_threshold" };
}
