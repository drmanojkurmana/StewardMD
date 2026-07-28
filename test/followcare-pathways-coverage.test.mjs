// FollowCare AI — Phase-2 pathway coverage: every curated pathway (incl. the 17 new ones + Generic) must be
// buildable into an assessment AND scoreable by the engine without throwing, and each DiagnosisMapper target
// must resolve to a real pathway. This is the backward-compat guard for the doctor dashboard + timeline,
// which render from the same assessment/engine path.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
["followcare-pathways.js", "followcare-engine.js", "followcare-assessment.js", "followcare-diagnosis.js", "followcare-intel.js"].forEach(load);
const PW = globalThis.FollowCarePathways, ENG = globalThis.FollowCareEngine,
      AS = globalThis.FollowCareAssessment, DX = globalThis.FollowCareDiagnosis, INTEL = globalThis.FollowCareIntel;

// Synthesize a type-appropriate answer for a question (benign where possible; correctness of scoring isn't the
// point here — surviving every pathway's schema without throwing is).
function answerFor(q) {
  switch (q.type) {
    case "overall": return "better";
    case "yesno": return "no";
    case "scale": return 0;
    case "number": return q.plausible ? q.plausible[1] : 1;
    case "choice": return (q.options && q.options[0]) || "";
    default: return "no";
  }
}

test("every pathway builds an assessment and scores without throwing (dashboard/timeline compat)", () => {
  const ids = PW.list().map(p => p.id);
  assert.ok(ids.length >= 26, "expected the full curated catalogue, got " + ids.length);
  ids.forEach(id => {
    for (let day = 1; day <= 3; day++) {
      const a = AS.buildAssessment(id, day, { pathways: PW, engine: ENG });
      assert.ok(a && Array.isArray(a.questions) && a.questions.length, id + " day " + day + " has no questions");
      const answers = {};
      PW.questionsFor(id).forEach(q => { answers[q.id] = answerFor(q); });
      const r = ENG.assess(id, answers, { previousScore: 90 });
      assert.ok(["green", "yellow", "orange", "red"].includes(r.escalation), id + " → bad escalation " + r.escalation);
      assert.equal(typeof r.recoveryScore, "number", id + " → no numeric score");
      // the doctor dashboard also asks Intel for a prevention plan — must not throw on any pathway id
      const plan = INTEL.preventionPlan(r, id);
      assert.ok(plan && Array.isArray(plan.actions), id + " → prevention plan malformed");
    }
  });
});

test("Generic pathway: benign answers score, but an urgent concern still escalates (never a false all-clear)", () => {
  const calm = {}; PW.questionsFor("generic").forEach(q => { calm[q.id] = answerFor(q); });
  const rCalm = ENG.assess("generic", calm, { previousScore: 90 });
  assert.ok(["green", "yellow"].includes(rCalm.escalation), "calm generic should not be orange/red: " + rCalm.escalation);
  const urgent = Object.assign({}, calm, { urgent_concern: "yes" });
  const rRed = ENG.assess("generic", urgent, { previousScore: 90 });
  assert.equal(rRed.escalation, "red", "generic urgent_concern=yes must be red");
});

test("DiagnosisMapper → pathway → assessment is a closed loop (every mapper target is scoreable)", () => {
  const targets = new Set(["generic"]);
  DX.ICD10_MAP.forEach(r => targets.add(r[1]));
  DX.TEXT_MAP.forEach(r => targets.add(r[1]));
  targets.forEach(id => {
    const pw = PW.get(id);
    assert.ok(pw, "mapper target has no pathway: " + id);
    const a = AS.buildAssessment(id, 1, { pathways: PW, engine: ENG });
    assert.ok(a && a.questions.length, "mapper target not buildable: " + id);
  });
});
