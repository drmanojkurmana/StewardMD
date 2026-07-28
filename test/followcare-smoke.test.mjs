// FollowCare AI — end-to-end SMOKE TEST (all phases, local, no network/secrets/PHI).
// Runs a full simulated patient journey through the REAL modules exactly as the server orchestrates them:
// flag -> enroll/schedule -> daily adaptive check-ins -> scoring/escalation -> adaptive scheduling ->
// doctor summary/risk -> recovery twin/deterioration/prevention -> cohort analytics -> FHIR/CSV/rules.
// Prints a readable trace AND asserts the key clinical outcomes. Does NOT touch production or the flag default.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };
globalThis.location = { search: "" };
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
["followcare-flags.js", "followcare-pathways.js", "followcare-engine.js", "followcare-assessment.js",
 "followcare-schedule.js", "followcare-ai.js", "followcare-analytics.js", "followcare-integration.js",
 "followcare-intel.js"].forEach(load);
const FLAGS = globalThis.SMD_FOLLOWCARE_FLAGS, PW = globalThis.FollowCarePathways, ENG = globalThis.FollowCareEngine,
  AS = globalThis.FollowCareAssessment, SCH = globalThis.FollowCareSchedule, AI = globalThis.FollowCareAI,
  AN = globalThis.FollowCareAnalytics, INT = globalThis.FollowCareIntegration, INTEL = globalThis.FollowCareIntel;
const G0 = { g_chestpain: "no", g_breathless_rest: "no", g_syncope: "no", g_confusion: "no", g_bleeding: "no", g_seizure: "no", g_stroke_fast: "no", g_anaphylaxis: "no", g_selfharm: "no" };
const A = o => Object.assign({}, G0, o);
const DISCHARGE = Date.UTC(2026, 6, 1, 0, 0, 0), DAY = 86400000;
const log = (...a) => console.log("   " + a.join(" "));

test("SMOKE 0 — flag default ON (owner-enabled); can be disabled via ?fc=0/set", () => {
  assert.equal(FLAGS.on(), true);
  FLAGS.set("smd_followcare", false); assert.equal(FLAGS.on(), false);
  FLAGS.set("smd_followcare", true); assert.equal(FLAGS.on(), true);
  log("flag smd_followcare default ON; ?fc=0 disables  ✓");
});

test("SMOKE 1 — enroll + schedule a pneumonia episode", () => {
  const sch = SCH.scheduleFor("pneumonia", DISCHARGE, { pathways: PW, sendHour: 9 });
  assert.equal(sch.length, PW.get("pneumonia").schedule.length);
  log("enrolled Pneumonia; check-ins on days", PW.get("pneumonia").schedule.join(","), " ✓");
});

test("SMOKE 2 — DETERIORATING patient: green → red, with adaptive scheduling + intelligence", () => {
  const history = [];
  function checkin(day, ans, prevScore, prevAns) {
    const scored = AS.scoreAssessment("pneumonia", A(ans), { engine: ENG, pathways: PW, dayOffset: day, previousScore: prevScore, previousAnswers: prevAns, answers: A(ans) });
    const r = scored.result;
    const ai = AI.nextInterval(r, PW.get("pneumonia"), day);
    history.push({ dayOffset: day, score: r.recoveryScore, escalation: r.escalation });
    log("day " + day + ": score " + r.recoveryScore + " · " + r.escalation.toUpperCase() +
      " · risk " + AI.riskPercent(r) + "% · next=" + (ai.deltaHours != null ? ai.deltaHours + "h" : "day " + ai.dayOffset) +
      (scored.notifyClinician ? " · NOTIFY DOCTOR" : ""));
    return { r, scored, ans: A(ans) };
  }
  const d1 = checkin(1, { overall: "better", fever: "yes", fever_days: 1, cough: 1, breathless: 0, spo2: 96, meds_taken: "taken" }, null, null);
  const d3 = checkin(3, { overall: "same", fever: "yes", fever_days: 3, cough: 2, breathless: 1, spo2: 94, meds_taken: "skipped" }, d1.r.recoveryScore, d1.ans);
  const d5 = checkin(5, { overall: "worse", fever: "yes", fever_days: 5, cough: 3, breathless: 3, spo2: 88, meds_taken: "skipped" }, d3.r.recoveryScore, d3.ans);

  assert.equal(d5.r.escalation, "red", "severe breathlessness + low SpO2 must be RED");
  assert.equal(d5.scored.notifyClinician, true);
  assert.ok(d5.r.recoveryScore < d1.r.recoveryScore, "score fell as patient deteriorated");
  assert.ok(["orange", "red"].includes(d3.r.escalation), "day-3 decline escalated (got " + d3.r.escalation + ")");
  // adaptive scheduling: a steady amber reschedules sooner (12h); a red is urgent (0h, not a routine check-in)
  assert.equal(AI.nextInterval({ escalation: "orange", trend: "stable", recoveryScore: 60, readmissionRisk: "moderate" }, PW.get("pneumonia"), 3).deltaHours, 12);
  assert.equal(AI.nextInterval(d5.r, PW.get("pneumonia"), 5).deltaHours, 0);

  // Phase 5 intelligence on the deteriorating course
  const twin = INTEL.recoveryTwin(PW.get("pneumonia"), 5, d5.r);
  const pred = INTEL.predictDeterioration(history, d5.r, PW.get("pneumonia"));
  const prev = INTEL.preventionPlan(d5.r, "pneumonia");
  log("recovery twin: actual " + twin.actual + " vs expected " + twin.expected + " → " + twin.status);
  log("deterioration prediction: " + pred.likelihood + (pred.windowHours ? " (~" + pred.windowHours + "h)" : ""));
  log("prevention (suggestions, doctor decides): " + prev.actions.join(" · "));
  assert.equal(twin.status, "behind");
  assert.equal(pred.likelihood, "high");
  assert.ok(prev.actions.length >= 1);

  // Phase 2 doctor 30-second summary
  const ds = AI.doctorSummary(d5.r, { disease: "Pneumonia" });
  log("DOCTOR CARD → score " + ds.recoveryScore + " · " + ds.riskPercent + "% risk · " + ds.recommendation);
  assert.match(ds.recommendation, /urgent/i);
});

test("SMOKE 3 — RECOVERING patient → recovered at end of window", () => {
  const good = A({ overall: "better", fever: "no", fever_days: 0, cough: 0, breathless: 0, spo2: 99, meds_taken: "taken" });
  const s = AS.scoreAssessment("pneumonia", good, { engine: ENG, pathways: PW, dayOffset: 14, previousScore: 96, answers: good });
  log("day 14: score " + s.result.recoveryScore + " · " + s.result.escalation + " · recovered=" + s.recovered);
  assert.equal(s.result.escalation, "green");
  assert.equal(s.recovered, true);
});

test("SMOKE 4 — safety: incomplete/blank red-flag never scores green; hypoglycaemia 62 escalates", () => {
  const blankRedFlag = ENG.assess("dengue", A({ overall: "same", warning_abdo: "no", warning_vomit: "no", warning_lethargy: "no", fever: "no", hydration: "yes" }), { pathways: PW });
  assert.notEqual(blankRedFlag.escalation, "green");
  const hypo = ENG.assess("diabetes", A({ overall: "same", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 62, meds_taken: "taken" }), { pathways: PW });
  log("blank dengue red-flag → " + blankRedFlag.escalation + " (needsReview " + blankRedFlag.needsReview + ") · glucose 62 → " + hypo.escalation);
  assert.ok(hypo.escalation === "orange" || hypo.escalation === "red");
});

test("SMOKE 5 — Phase 3 cohort analytics + Phase 4 FHIR/CSV/rules", () => {
  const cohort = [
    { episodeId: "1", disease: "Pneumonia", specialty: "Respiratory", status: "escalated", escalation: "red", risk: "very_high", riskPercent: 90, score: 38, needsReview: true, nextDueMs: DISCHARGE, createdMs: DISCHARGE - 5 * DAY },
    { episodeId: "2", disease: "Pneumonia", specialty: "Respiratory", status: "recovered", escalation: "green", risk: "low", riskPercent: 10, score: 95, recoveredMs: DISCHARGE, createdMs: DISCHARGE - 11 * DAY, lastDayDone: 14 },
    { episodeId: "3", disease: "Heart Failure", specialty: "Cardiology", status: "active", escalation: "orange", risk: "moderate", riskPercent: 55, score: 60, nextDueMs: DISCHARGE, createdMs: DISCHARGE - 3 * DAY, lastDayDone: 2 },
  ];
  const cc = AN.commandCenter(cohort, DISCHARGE), q = AN.quality(cohort), ins = AN.insights(cohort);
  log("command center → active " + cc.active + " · need review " + cc.needReview + " · high risk " + cc.highRisk);
  log("quality → completion " + q.followUpCompletionPct + "% · escalation " + q.escalationRatePct + "% · readmission " + q.readmission7dPct + " (needs ADT feed)");
  log("smart queue order → " + AN.smartQueue(cohort).map(e => e.episodeId).join(","));
  assert.equal(AN.smartQueue(cohort)[0].episodeId, "1");
  assert.equal(q.readmission7dPct, null);

  const csv = "Name,Mobile,Diagnosis,Discharge Date\nRamesh,9876543210,Pneumonia,2026-07-10\nDevi,9876500000,CHF,2026-07-11";
  const imp = INT.fromDischargeCSV(csv);
  log("CSV import → " + imp.rows.length + " enrollable rows (" + imp.rows.map(r => r.pathwayId).join(",") + ")");
  assert.equal(imp.rows.length, 2);

  const bundle = INT.toFHIR(cohort[0], [{ dayOffset: 1, score: 70, escalation: "yellow", redFlags: [] }], { emrPatientId: "P1" });
  log("FHIR export → Bundle with " + bundle.entry.length + " resources (" + bundle.entry.map(e => e.resource.resourceType).join(",") + ")");
  assert.equal(bundle.resourceType, "Bundle");

  const actions = INT.evalRules(INT.defaultRules(), { type: "assessment", escalation: "red" });
  log("automation on RED → " + actions.join(", "));
  assert.ok(actions.includes("notify_doctor"));

  log("\n   ✅ SMOKE TEST PASSED — full FollowCare pipeline (Phases 1-5) works end-to-end.");
});
