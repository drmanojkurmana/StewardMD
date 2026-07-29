/* test/ai-usage.test.mjs — AI Control Center usage-engine foundation (Phase 1, pure). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_MODULES, isAiModule, aiModuleList, moduleDailyLimit,
  MODEL_RATES, modelRate, estCostInr, resolveModel, MODEL_HARD_DEFAULT, buildUsageRecord,
} from "../functions/_ai_usage.js";

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
