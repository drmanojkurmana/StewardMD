/* functions/_credits.js — per-user daily AI-cost cap + prepaid credit balance.
 *
 * Daily cap = free rupees of AI per day. Today's accumulated AI cost lives in the existing rollup
 * (aiu:doc:<doctorId>:<day>.cost, written by _ai_usage.recordAiUsage). Once that reaches the cap, AI is
 * blocked with 429 { reason:"ai-cost-cap" } UNLESS the user has credits. Credits are a persistent
 * prepaid rupee balance (buy ₹50 -> +₹25 of AI allowance; CREDIT_CONVERSION=0.5), spent only for cost
 * ABOVE the daily cap. Consumption is debited lazily on each gate call: we charge the balance for the
 * over-cap spend seen so far today, tracking chargedToday so we never double-charge.
 *
 * ponytail: gate reads cost accumulated by PRIOR calls (this call's cost lands on the next gate), so a
 * user can overshoot by at most one in-flight call before the block bites. Fine for a soft rupee cap.
 *
 * FAIL-OPEN + INERT: any store error → allow; and the whole cap is off unless env AI_COST_CAP_ON="1",
 * so this changes nothing until the owner flips it (after payment works). Deps-injectable store for tests.
 */

function _day(now) { return new Date(now || Date.now()).toISOString().slice(0, 10); }
function _nextMidnightMs(now) { const d = new Date(now || Date.now()); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
function r2(n) { return Math.round(n * 100) / 100; }

export function costCapOn(env) { return String(env && env.AI_COST_CAP_ON) === "1"; }
export function creditConversion(env) { const v = Number(env && env.CREDIT_CONVERSION); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5; }

// Resolve a user's daily rupee cap: per-user KV override > env per-role > env global > 0 (unlimited).
export async function dailyCostCap(env, store, email, role) {
  if (store && email) {
    try { const raw = await store.get("ai:costcap:" + String(email).toLowerCase()); if (raw != null && raw !== "") { const v = Number(raw); if (Number.isFinite(v) && v >= 0) return v; } } catch (e) {}
  }
  if (role) { const rv = Number(env && env["AI_COST_CAP_" + String(role).toUpperCase()]); if (Number.isFinite(rv) && rv >= 0) return rv; }
  const gv = Number(env && env.AI_DAILY_COST_CAP_INR);
  return Number.isFinite(gv) && gv >= 0 ? gv : 0;   // 0 = unlimited
}
export async function setUserCostCap(store, email, inr) {
  if (!store || !email) return false;
  const key = "ai:costcap:" + String(email).toLowerCase();
  try {
    if (inr == null || inr === "") { await store.delete(key); return true; }   // clear → env/role default
    const n = Number(inr); if (!Number.isFinite(n) || n < 0) return false;
    await store.put(key, String(n)); return true;
  } catch (e) { return false; }
}

// ---- credit balance (persistent prepaid rupees) ----
function creditKey(id) { return "maik:credit:" + id; }
export async function getCreditRecord(store, id) {
  if (!store || !id) return { balance: 0, day: "", chargedToday: 0 };
  try { return (await store.get(creditKey(id), "json")) || { balance: 0, day: "", chargedToday: 0 }; } catch (e) { return { balance: 0, day: "", chargedToday: 0 }; }
}
export async function getCredits(store, id) { return r2((await getCreditRecord(store, id)).balance || 0); }
export async function putCreditRecord(store, id, rec) { try { await store.put(creditKey(id), JSON.stringify(rec)); } catch (e) {} }

// Buy: ₹purchaseInr paid → +₹(purchaseInr*conversion) allowance. Returns new balance.
export async function addCredits(env, store, id, purchaseInr) {
  const rec = await getCreditRecord(store, id);
  const add = r2(Math.max(0, Number(purchaseInr) || 0) * creditConversion(env));
  rec.balance = r2((rec.balance || 0) + add);
  await putCreditRecord(store, id, rec);
  return { balance: rec.balance, added: add };
}
// Admin: set absolute balance (grant/adjust/revoke → 0).
export async function adminSetCredits(store, id, inr) {
  const rec = await getCreditRecord(store, id);
  rec.balance = r2(Math.max(0, Number(inr) || 0));
  await putCreditRecord(store, id, rec);
  return { balance: rec.balance };
}

// Pre-call gate. cap = today's free rupee cap (0/negative = unlimited → always ok). Debits credits for
// over-cap spend accumulated so far today, then decides. Returns { ok, reason?, resetAt, cap, dayCost, credits }.
export async function checkCostCap(env, store, doctorId, cap, now) {
  if (!store || !doctorId || !(cap > 0)) return { ok: true, unlimited: true, cap: cap || 0 };
  const day = _day(now);
  let dayCost = 0;
  try { const d = await store.get("aiu:doc:" + doctorId + ":" + day, "json"); dayCost = (d && +d.cost) || 0; } catch (e) { return { ok: true }; }
  const rec = await getCreditRecord(store, doctorId);
  if (rec.day !== day) { rec.day = day; rec.chargedToday = 0; }        // new day → reset the day's charge tally
  const overage = Math.max(0, dayCost - cap);
  const newCharge = overage - (rec.chargedToday || 0);
  if (newCharge > 0 && rec.balance > 0) {                              // lazily debit credits for over-cap spend
    const charge = Math.min(newCharge, rec.balance);
    rec.balance = r2(rec.balance - charge); rec.chargedToday = r2((rec.chargedToday || 0) + charge);
  }
  if (newCharge > 0 || rec.day === day) await putCreditRecord(store, doctorId, rec);
  const resetAt = _nextMidnightMs(now);
  if (dayCost < cap) return { ok: true, cap, dayCost: r2(dayCost), credits: r2(rec.balance), resetAt };
  if (rec.balance > 0) return { ok: true, onCredits: true, cap, dayCost: r2(dayCost), credits: r2(rec.balance), resetAt };
  return { ok: false, reason: "ai-cost-cap", cap, dayCost: r2(dayCost), credits: 0, resetAt };
}
