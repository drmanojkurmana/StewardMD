/* StewardMD — MaiK usage-metering / quota / circuit-breaker unit tests (pure Node, mock KV).
 * Proves: per-user daily request & token quotas, monthly quota, OCR quota, per-user rate
 * limit, global cost circuit breaker, account isolation, and NO PHI in stored usage.
 * USAGE: node test/run-maik-usage.mjs
 */
import { checkQuota, recordUsage, adminReport, estTokens } from "../functions/_usage.js";
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

function mockKv() {
  const m = new Map();
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, v); },
    async list({ prefix, cursor, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix || "")).map((name) => ({ name })); return { keys, list_complete: true, cursor: null }; },
    delRl(id) { m.delete("maik:rl:" + id); },
  };
}
function req(ip, auth) { const h = { "CF-Connecting-IP": ip || "1.1.1.1" }; if (auth) h["Authorization"] = auth; return { url: "https://stewardmd.in/api/ai/explain", headers: { get: (k) => h[k] || null } }; }
async function runOnce(env, request, type) { const g = await checkQuota(env, request, type); if (g.ok) await recordUsage(g, { inTok: 100, outTok: 100, status: "success" }); return g; }

(async () => {
  // A — per-user daily request quota (general)
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_GUEST_DAILY_LIMIT: 2 };
    let g1 = await runOnce(env, req("10.0.0.1"), "general"); kv.delRl("ip:*"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k));
    let g2 = await runOnce(env, req("10.0.0.1"), "general"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k));
    let g3 = await checkQuota(env, req("10.0.0.1"), "general");
    chk("daily request quota: 3rd blocked after limit 2", g1.ok && g2.ok && !g3.ok && g3.reason === "daily-requests");
  }
  // B — daily token quota
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_DAILY_TOKEN_LIMIT: 150, MAIK_GENERAL_DAILY_LIMIT: 99 };
    await runOnce(env, req("10.0.0.2"), "general"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k)); // 200 tokens recorded > 150
    const g = await checkQuota(env, req("10.0.0.2"), "general");
    chk("daily token quota blocks next request", !g.ok && g.reason === "daily-tokens");
  }
  // C — monthly token quota
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_MONTHLY_TOKEN_LIMIT: 150, MAIK_DAILY_TOKEN_LIMIT: 1e9, MAIK_GENERAL_DAILY_LIMIT: 99 };
    await runOnce(env, req("10.0.0.3"), "general"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k));
    const g = await checkQuota(env, req("10.0.0.3"), "general");
    chk("monthly token quota blocks safely", !g.ok && g.reason === "monthly-tokens");
  }
  // D — per-user rate limit
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_RATE_LIMIT_SECONDS: 3, MAIK_GENERAL_DAILY_LIMIT: 99 };
    const g1 = await runOnce(env, req("10.0.0.4"), "general");
    const g2 = await checkQuota(env, req("10.0.0.4"), "general"); // immediate 2nd → rate blocked
    chk("per-user rate limit blocks rapid 2nd call", g1.ok && !g2.ok && g2.reason === "rate");
  }
  // E — global circuit breaker (hard stop)
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_PROJECT_DAILY_COST_HARD_STOP_INR: 0.001, MAIK_GENERAL_DAILY_LIMIT: 99 };
    await runOnce(env, req("10.0.0.5"), "general"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k)); // accrues cost > hard stop
    const g = await checkQuota(env, req("10.0.0.9"), "general"); // different user still blocked globally
    chk("global circuit breaker hard-stops all provider calls", !g.ok && g.reason === "circuit-breaker");
  }
  // F — account isolation
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_GUEST_DAILY_LIMIT: 1 };
    await runOnce(env, req("10.0.0.6"), "general"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k));
    const gA = await checkQuota(env, req("10.0.0.6"), "general"); // A exhausted
    const gB = await checkQuota(env, req("10.0.0.7"), "general"); // B independent
    chk("account isolation: user A quota does not affect user B", !gA.ok && gB.ok);
  }
  // G — OCR quota
  {
    const kv = mockKv(); const env = { MAIK_KV: kv, MAIK_OCR_DAILY_LIMIT: 1 };
    await runOnce(env, req("10.0.0.8"), "ocr"); [...kv._m.keys()].filter(k=>k.startsWith("maik:rl")).forEach(k=>kv._m.delete(k));
    const g = await checkQuota(env, req("10.0.0.8"), "ocr");
    chk("OCR daily quota blocks safely", !g.ok && g.reason === "ocr-daily");
  }
  // H — NO PHI stored
  {
    const kv = mockKv(); const env = { MAIK_KV: kv };
    const g = await checkQuota(env, req("10.0.0.11"), "general");
    if (g.ok) await recordUsage(g, { inTok: 100, outTok: 100, status: "success" });
    const blob = JSON.stringify([...kv._m.entries()]);
    const clean = !/patient|mrn|prompt|question|report|meropenem|dka|hypotension|chest pain|@/i.test(blob) && !blob.includes("10.0.0.11"); // raw IP hashed, no content
    chk("no PHI / prompt / raw-identifier in stored usage", clean, "keys=" + [...kv._m.keys()].map(k => k.split(":").slice(0, 2).join(":")).join(","));
  }
  // I — admin aggregate returns totals, no content
  {
    const kv = mockKv(); const env = { MAIK_KV: kv };
    const g = await checkQuota(env, req("10.0.0.12"), "general"); if (g.ok) await recordUsage(g, { inTok: 50, outTok: 50, status: "success" });
    const rep = await adminReport(env);
    chk("admin report aggregates (requests≥1, breaker status present)", rep.enabled && rep.daily.requests >= 1 && !!rep.circuitBreaker.status);
  }
  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — quotas, rate limit, circuit breaker, isolation, no-PHI verified"}`);
  process.exitCode = fails ? 1 : 0;
})();
