/* StewardMD - the per-day price, from the SAME live prices /api/billing/plans serves.
 *
 * Marketing copy quotes "under 20 rupees a day", so it must be derived from the real plan amounts
 * (KV override > env > default, via cfgPrice) and never hard-coded in an email body. Per-day figures
 * round UP (Math.ceil), so a price change can only ever make the email understate the saving, never
 * overstate it. Amounts are paise, as in functions/api/billing/[[path]].js.
 */
import { cfgPrice } from "./_billingcfg.js";

export const DEFAULTS = {
  PRO_PRICE_MONTHLY: 59900, PRO_PRICE_ANNUAL: 499900,
  STUDENT_PRICE_MONTHLY: 19900, CORESIDENT_PRICE_MONTHLY: 29900,
  PHYSICIAN_PRICE_MONTHLY: 149900, PHYSICIANPRO_PRICE_MONTHLY: 249900,
};

export function rupees(env, key) { return cfgPrice(env, key, DEFAULTS[key]) / 100; }
export function perDay(rupeesTotal, days) { return Math.ceil(rupeesTotal / days); }
export function inr(n) { return "₹" + Number(n).toLocaleString("en-IN"); }

// Everything an email may quote. Month = 30 days, year = 365, so a monthly and an annual figure are
// comparable side by side.
export function dayPrices(env) {
  const pro = rupees(env, "PRO_PRICE_MONTHLY"), annual = rupees(env, "PRO_PRICE_ANNUAL");
  const trainee = rupees(env, "STUDENT_PRICE_MONTHLY"), cores = rupees(env, "CORESIDENT_PRICE_MONTHLY");
  const phys = rupees(env, "PHYSICIAN_PRICE_MONTHLY");
  return {
    pro: { month: pro, day: perDay(pro, 30) },
    annual: { year: annual, day: perDay(annual, 365), month: Math.ceil(annual / 12) },
    trainee: { month: trainee, day: perDay(trainee, 30) },
    coresident: { month: cores, day: perDay(cores, 30), perSeatDay: perDay(cores / 2, 30) },
    physician: { month: phys, day: perDay(phys, 30) },
  };
}
