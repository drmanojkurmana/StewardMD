/* test/ai-usage.test.mjs — AI Control Center usage-engine foundation (Phase 1, pure). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_MODULES, isAiModule, aiModuleList, moduleDailyLimit,
  MODEL_RATES, modelRate, estCostInr, resolveModel, MODEL_HARD_DEFAULT, buildUsageRecord,
  checkModuleQuota, recordAiUsage, doctorUsageSummary, getModelOverride, setModelOverride,
} from "../functions/_ai_usage.js";

// tiny in-memory KV mock (get / get(_,"json") / put / delete)
function mockKv() {
  const m = new Map();
  return {
    _m: m,
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}
const NOW = 1800000000000; // fixed timestamp so all records land on the same UTC day

test("module registry: known modules + the approved daily caps", () => {
  assert.ok(isAiModule("maik") && isAiModule("ecg") && isAiModule("thorex") && isAiModule("ocr"));
  assert.equal(isAiModule("nope"), false);
  assert.equal(AI_MODULES.ecg.daily, 10);     // ECG 10/day
  assert.equal(AI_MODULES.thorex.daily, 10);  // X-ray 10/day
  assert.equal(AI_MODULES.ocr.daily, 50);     // Vision (ICU + Scan Meds) 50/day
  assert.equal(AI_MODULES.maik.daily, 50);    // MaiK general 50
  assert.equal(AI_MODULES.maik_case.daily, 25); // MaiK case 25
  assert.equal(AI_MODULES.kb.daily, 0);       // Knowledge Base unlimited
  assert.ok(aiModuleList().some((m) => m.id === "ecg" && m.label === "KardiQ X (ECG)"));
});

test("moduleDailyLimit: default + env override + unlimited", () => {
  assert.equal(moduleDailyLimit({}, "ecg"), 10);
  assert.equal(moduleDailyLimit({ AI_LIMIT_ECG: "20" }, "ecg"), 20);   // env override
  assert.equal(moduleDailyLimit({ AI_LIMIT_ECG: "0" }, "ecg"), 0);     // 0 = unlimited (explicit)
  assert.equal(moduleDailyLimit({ AI_LIMIT_ECG: "junk" }, "ecg"), 10); // bad value → default
  assert.equal(moduleDailyLimit({}, "kb"), 0);
  assert.equal(moduleDailyLimit({}, "nope"), 0);
});

test("modelRate: known model + fallback + env override", () => {
  assert.deepEqual(modelRate({}, "gemini-2.5-flash"), { in: 0.007, out: 0.025 });
  assert.deepEqual(modelRate({}, "unknown-model"), { in: 0.007, out: 0.025 }); // DEFAULT_RATE
  assert.deepEqual(modelRate({ "AI_RATE_GEMINI_3_5_FLASH_IN": "0.01", "AI_RATE_GEMINI_3_5_FLASH_OUT": "0.03" }, "gemini-3.5-flash"), { in: 0.01, out: 0.03 });
});

test("estCostInr: tokens + image/audio extras + env cost overrides", () => {
  // 1000 in @0.007 + 1000 out @0.025 = 0.032
  assert.equal(estCostInr({}, "gemini-2.5-flash", 1000, 1000), 0.032);
  // + 2 images @ default 0.35 = 0.70
  assert.equal(estCostInr({}, "gemini-2.5-flash", 1000, 1000, { images: 2 }), 0.732);
  // audio 10s @ 0.02 = 0.20
  assert.equal(estCostInr({}, "gemini-2.5-flash", 0, 0, { audioSeconds: 10 }), 0.2);
  // per-image override
  assert.equal(estCostInr({ AI_COST_PER_IMAGE_INR: "1" }, "gemini-2.5-flash", 0, 0, { images: 1 }), 1);
  assert.equal(estCostInr({}, "gemini-2.5-flash", -5, -5), 0); // negatives clamped
});

test("resolveModel: override (valid) → env → hard default; rejects unknown", () => {
  assert.equal(resolveModel("gemini-3.5-flash", {}), "gemini-3.5-flash");        // admin override wins
  assert.equal(resolveModel(null, { GEMINI_MODEL: "gemini-2.5-flash-lite" }), "gemini-2.5-flash-lite"); // env
  assert.equal(resolveModel(null, {}), MODEL_HARD_DEFAULT);                       // hard default
  assert.equal(resolveModel("not-a-real-model", {}), MODEL_HARD_DEFAULT);         // unknown override ignored
  assert.equal(resolveModel("evil'; DROP", { GEMINI_MODEL: "also-bad" }), MODEL_HARD_DEFAULT); // both bad → default
  assert.ok(MODEL_RATES[resolveModel(null, {})]);                                 // default is a priced model
});

test("buildUsageRecord: normalized metadata, NO prompt/PHI fields, clamps + status", () => {
  const rec = buildUsageRecord({
    requestId: "r1", ts: 1234, hospitalId: "h1", doctorId: "fb:uid1", subscription: "pro",
    module: "ecg", feature: "analyze", model: "gemini-2.5-flash",
    promptTokens: 100, completionTokens: 50, estCostInr: 0.01, latencyMs: 1800, status: "success",
    httpStatus: 200, imageCount: 1,
    // hostile extras that MUST NOT appear:
    prompt: "patient Ramesh MRN 4471 has fever", output: "diagnosis...", patientName: "Ramesh",
  });
  assert.equal(rec.module, "ecg");
  assert.equal(rec.totalTokens, 150);
  assert.equal(rec.provider, "vertex");        // filled from the module registry
  assert.equal(rec.status, "success");
  assert.equal(JSON.stringify(rec).indexOf("Ramesh"), -1, "no patient name leaks into the record");
  assert.equal(JSON.stringify(rec).indexOf("MRN"), -1, "no prompt content leaks");
  assert.equal(rec.prompt, undefined); assert.equal(rec.output, undefined); assert.equal(rec.patientName, undefined);
  // unknown module + bad status normalize
  const r2 = buildUsageRecord({ module: "totally-unknown", status: "weird" });
  assert.equal(r2.module, "unknown");
  assert.equal(r2.status, "success"); // only failed/blocked/timeout are kept; else success
  assert.equal(buildUsageRecord({ status: "failed" }).status, "failed");
});

test("checkModuleQuota + recordAiUsage: per-module daily cap enforced across records", async () => {
  const kv = mockKv(), env = { AI_LIMIT_ECG: "3" }, doc = "fb:u1";
  const rec = () => buildUsageRecord({ doctorId: doc, module: "ecg", model: "gemini-2.5-flash", promptTokens: 10, completionTokens: 5, estCostInr: 0.01, latencyMs: 1000 });
  for (let i = 0; i < 3; i++) {
    const q = await checkModuleQuota(env, kv, "ecg", doc, NOW);
    assert.equal(q.ok, true, "call " + i + " allowed");
    await recordAiUsage(env, kv, rec(), NOW);
  }
  const blocked = await checkModuleQuota(env, kv, "ecg", doc, NOW);
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, "module-daily"); assert.equal(blocked.used, 3); assert.equal(blocked.limit, 3);
  // a DIFFERENT doctor is unaffected (per-doctor isolation)
  assert.equal((await checkModuleQuota(env, kv, "ecg", "fb:u2", NOW)).ok, true);
  // a DIFFERENT module for the same doctor is unaffected
  assert.equal((await checkModuleQuota(env, kv, "thorex", doc, NOW)).ok, true);
});

test("checkModuleQuota: unlimited module + no-store both fail-open (never block)", async () => {
  assert.equal((await checkModuleQuota({}, mockKv(), "kb", "fb:u1", NOW)).ok, true);   // kb daily=0 → unlimited
  assert.equal((await checkModuleQuota({}, null, "ecg", "fb:u1", NOW)).ok, true);      // no store → allow
});

test("doctorUsageSummary: reflects recorded usage + exposes limits", async () => {
  const kv = mockKv(), env = {}, doc = "fb:u3";
  await recordAiUsage(env, kv, buildUsageRecord({ doctorId: doc, module: "maik", model: "gemini-2.5-flash", promptTokens: 100, completionTokens: 100, estCostInr: 0.03, latencyMs: 1800 }), NOW);
  await recordAiUsage(env, kv, buildUsageRecord({ doctorId: doc, module: "ecg", model: "gemini-2.5-flash", promptTokens: 0, completionTokens: 0, estCostInr: 0.35, latencyMs: 2200 }), NOW);
  const s = await doctorUsageSummary(env, kv, doc, NOW);
  assert.equal(s.req, 2);
  assert.equal(s.byModule.maik, 1); assert.equal(s.byModule.ecg, 1);
  assert.equal(s.estCostInr, 0.38);
  assert.equal(s.avgLatencyMs, 2000);
  assert.equal(s.limits.ecg, 10); // default cap surfaced for the UI
});

test("model override: set valid persists; invalid rejected; clear works", async () => {
  const kv = mockKv();
  assert.equal(await getModelOverride(kv), null);
  assert.equal(await setModelOverride(kv, "gemini-3.5-flash"), true);
  assert.equal(await getModelOverride(kv), "gemini-3.5-flash");
  assert.equal(resolveModel(await getModelOverride(kv), {}), "gemini-3.5-flash"); // resolver honours it
  assert.equal(await setModelOverride(kv, "totally-fake-model"), false);          // rejected
  assert.equal(await getModelOverride(kv), "gemini-3.5-flash");                    // unchanged
  assert.equal(await setModelOverride(kv, null), true);                            // clear
  assert.equal(await getModelOverride(kv), null);
});
