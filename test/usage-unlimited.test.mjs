/* Guard: AI has NO per-user restrictions by default (launch decision 2026-07-31).
 *
 * Owners were admin-exempt from the per-user throttles (rate limit + daily/monthly token caps +
 * per-category daily request caps), so "AI only works for my account / guests." checkQuota now skips
 * those throttles for EVERY caller unless env MAIK_ENFORCE_CAPS="1"; the project-wide daily-COST
 * circuit breaker and usage metering still run. This locks that in at the source level (checkQuota
 * needs live KV + a signed token to run, so we assert the gating shape instead). */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "functions/_usage.js"), "utf8");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

ok(/function aiUnlimited\(env\)/.test(src) && /MAIK_ENFORCE_CAPS\) !== "1"/.test(src) && /catch \(e\) \{ return true; \}/.test(src),
  "aiUnlimited default true; opt back into caps via MAIK_ENFORCE_CAPS='1'");
ok(/const exempt = admin \|\| aiUnlimited\(env\);/.test(src), "exempt = owner/admin OR the unlimited default");

// every per-user throttle is gated on !exempt (not !admin), so normal accounts aren't blocked
ok(!/\bif \(!admin\b/.test(src) && !/&& !admin\b/.test(src), "no per-user throttle still keys off !admin");
ok((src.match(/!exempt/g) || []).length >= 4, "rate limit + daily tokens + monthly + per-category caps all use !exempt");

// the project-wide COST circuit breaker must STILL apply (it is NOT a per-user restriction)
ok(/breakerCost >= hardStop/.test(src), "global daily-cost circuit breaker retained (wallet safety)");
// ...and it now reads an ATOMIC D1 counter (exact under concurrency) so it can't be defeated by the
// KV read-modify-write race that undercounts a burst (fail-safe: falls back to KV when D1 absent).
ok(/ai_cost_daily/.test(src) && /ON CONFLICT\(day\)/.test(src) && /readDailyCostInr/.test(src),
  "global cost breaker backed by an atomic D1 counter (no KV race/undercount)");

console.log(`\nALL ${pass} PASS — AI unlimited per-user (owner-parity for all accounts); only the global cost breaker remains`);
