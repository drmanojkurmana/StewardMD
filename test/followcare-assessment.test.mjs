// FollowCare AI — Assessment engine + flags unit tests (Phase 1).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };
globalThis.location = { search: "" };
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
["followcare-flags.js", "followcare-pathways.js", "followcare-engine.js", "followcare-assessment.js"].forEach(load);
const FLAGS = globalThis.SMD_FOLLOWCARE_FLAGS, AS = globalThis.FollowCareAssessment;
const G0 = { g_chestpain: "no", g_breathless_rest: "no", g_syncope: "no", g_confusion: "no", g_bleeding: "no", g_seizure: "no", g_stroke_fast: "no", g_anaphylaxis: "no", g_selfharm: "no" };
const clean = o => Object.assign({}, G0, o);

test("flags: master default OFF; sub-flags resolve; set() persists", () => {
  assert.equal(FLAGS.on(), false);
  assert.equal(FLAGS.bool("smd_followcare_portal"), true);
  FLAGS.set("smd_followcare", true);
  assert.equal(FLAGS.on(), true);
  assert.ok(Object.keys(FLAGS.defs()).length >= 5);
});

test("buildAssessment: greeting + pathway questions + all 9 global red-flag probes", () => {
  const a = AS.buildAssessment("pneumonia", 4);
  assert.ok(/Day 4/.test(a.greeting) && /Pneumonia/.test(a.greeting));
  const ids = a.questions.map(q => q.id);
  assert.ok(ids.includes("spo2") && ids.includes("g_chestpain") && ids.includes("g_stroke_fast"));
  assert.equal(ids.filter(i => i.startsWith("g_")).length, 9);
});

test("nextDay: next scheduled offset, null past the end", () => {
  assert.equal(AS.nextDay("pneumonia", 4), 5);
  assert.equal(AS.nextDay("pneumonia", 14), null);
});

test("scoreAssessment GREEN: message + next check-in + no clinician notify", () => {
  const s = AS.scoreAssessment("pneumonia", clean({ overall: "better", fever: "no", fever_days: 0, cough: 0, breathless: 0, spo2: 98, meds_taken: "taken" }), { dayOffset: 3, previousScore: 95 });
  assert.equal(s.escalation, "green");
  assert.equal(s.notifyClinician, false);
  assert.equal(s.nextDay, 5);
  assert.ok(/recovering well/i.test(s.patientMessage));
});

test("scoreAssessment RED: notify + urgent message + no routine next date", () => {
  const s = AS.scoreAssessment("pneumonia", clean({ overall: "same", breathless: 1, spo2: 88, meds_taken: "taken" }), { dayOffset: 3 });
  assert.equal(s.escalation, "red");
  assert.equal(s.notifyClinician, true);
  assert.equal(s.nextDay, null);
  assert.ok(/urgent/i.test(s.patientMessage));
});

test("scoreAssessment ORANGE routes to contact-team message + notifies clinician", () => {
  const s = AS.scoreAssessment("pneumonia", clean({ overall: "same", fever: "no", breathless: 1, spo2: 97, meds_taken: "skipped" }), { dayOffset: 5 });
  assert.equal(s.escalation, "orange");
  assert.equal(s.notifyClinician, true);
  assert.ok(/contact your treating team/i.test(s.patientMessage));
});

test("recovered flag at end of window when green + improving + afebrile", () => {
  const ans = clean({ overall: "better", fever: "no", fever_days: 0, cough: 0, breathless: 0, spo2: 99, meds_taken: "taken" });
  const s = AS.scoreAssessment("pneumonia", ans, { dayOffset: 14, previousScore: 96, answers: ans });
  assert.equal(s.recovered, true);
});
