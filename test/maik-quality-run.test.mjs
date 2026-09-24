/* test/maik-quality-run.test.mjs — the quality harness's own logic (audit T19), no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checks, claimsOf, parity } from "../scripts/maik-quality-run.mjs";

test("objective checks: a real answer passes, a refusal / object leak / provider name fails", () => {
  const c = { expectedTopic: "cholangitis" };
  const good = "Acute cholangitis needs urgent biliary drainage (ERCP) within 24 to 48 hours plus antibiotics such as piperacillin-tazobactam; assess severity with the Tokyo guidelines.";
  assert.deepEqual(Object.values(checks(c, good)).every(Boolean), true);
  assert.equal(checks(c, "I can only help with medical and clinical questions.").notRefusal, false);
  assert.equal(checks(c, good + " [object Object]").noObject, false);
  assert.equal(checks(c, good + " Powered by Gemini.").noProvider, false);
  assert.equal(checks(c, "Pneumonia is treated with amoxicillin 1 g three times daily for five days in most adults.").onTopic, false);
});

test("parity: dose numbers only one engine gave are surfaced", () => {
  const p = parity("Amlodipine 5 mg daily; losartan 50 mg daily.", "Amlodipine 10 mg daily; losartan 50 mg daily.");
  assert.deepEqual(p.onlyCloudDoses, ["5mg"]); assert.deepEqual(p.onlyOfflineDoses, ["10mg"]);
  assert.ok(p.sharedDrugs.includes("amlodipine") && p.sharedDrugs.includes("losartan"));
  assert.deepEqual(claimsOf("no numbers here").doses, []);
});
