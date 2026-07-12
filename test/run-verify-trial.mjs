/* StewardMD — one-time 7-day trial decision (functions/api/verify-doctor.js decideTrial).
 * The "Skip for now" button grants ONE 7-day provisional trial per account (no prescription).
 * decideTrial() is the pure core: given the stored doctor record + now, decide the outcome.
 *   • no record / no prior trial      → grant a fresh trial (status:"trial", grant:true)
 *   • trial active                    → status:"trial" (no re-grant)
 *   • trial window elapsed            → status:"trial_expired" (stays gated — one trial only)
 *   • already verified                → status:"verified" (skip the trial entirely)
 * USAGE: node test/run-verify-trial.mjs
 */
import { decideTrial } from "../functions/api/verify-doctor.js";

const DAY = 86400000;
const NOW = 1_800_000_000_000; // fixed instant so assertions are deterministic
const DAYS = 7;

let fails = 0;
const chk = (name, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${name}${d ? " — " + d : ""}`); if (!ok) fails++; };

// 1) First-time skip → grant a fresh 7-day trial.
{
  const r = decideTrial(null, NOW, DAYS);
  const until = Date.parse(r.provisionalUntil || "");
  chk("fresh account grants a trial", r.status === "trial" && r.grant === true, JSON.stringify(r));
  chk("trial window is ~7 days out", Math.round((until - NOW) / DAY) === DAYS, `until=${r.provisionalUntil}`);
}

// 2) Trial already active → return trial, do NOT re-grant.
{
  const rec = { uid: "u1", trialStartedAt: new Date(NOW - 2 * DAY).toISOString(), provisionalUntil: new Date(NOW + 5 * DAY).toISOString() };
  const r = decideTrial(rec, NOW, DAYS);
  chk("active trial returns trial", r.status === "trial", JSON.stringify(r));
  chk("active trial does NOT re-grant", !r.grant, JSON.stringify(r));
}

// 3) Trial window elapsed → expired, no second trial.
{
  const rec = { uid: "u1", trialStartedAt: new Date(NOW - 10 * DAY).toISOString(), provisionalUntil: new Date(NOW - 3 * DAY).toISOString() };
  const r = decideTrial(rec, NOW, DAYS);
  chk("elapsed trial is trial_expired", r.status === "trial_expired", JSON.stringify(r));
  chk("elapsed trial does NOT re-grant", !r.grant, JSON.stringify(r));
}

// 4) Already verified → no trial.
{
  chk("verified (claim record) skips trial", decideTrial({ uid: "u1", verified: true, regNo: "MH-123" }, NOW, DAYS).status === "verified");
  chk("verified (status record) skips trial", decideTrial({ uid: "u1", status: "verified", regNo: "MH-9" }, NOW, DAYS).status === "verified");
}

console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — one-time 7-day trial decision correct"}`);
process.exitCode = fails ? 1 : 0;
