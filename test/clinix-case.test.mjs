import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const copd = JSON.parse(readFileSync(join(ROOT, "clinix/diseases/copd.json"), "utf8"));
const CASE = copd.cases[0];

/* The patient is deterministic ---------------------------------------------- */

test("the patient answers from the script, matched on cues", () => {
  const hit = M.matchAsk(CASE, "Do you smoke?");
  assert.ok(hit);
  assert.equal(hit.key, "smoking");
  assert.ok(hit.topic.reply.indexOf("bidis") >= 0);
});

test("cue matching is case and punctuation insensitive", () => {
  assert.equal(M.matchAsk(CASE, "How long have you had the COUGH?!").key, "cough");
  assert.equal(M.matchAsk(CASE, "any ankle swelling").key, "ankle_swelling");
});

test("the patient does NOT improvise when the question is unscripted", () => {
  // A simulated patient that invents a symptom teaches a wrong pattern, which is worse than a
  // patient who says they did not understand.
  assert.equal(M.matchAsk(CASE, "what is your favourite colour"), null);
  const fb = M.unmatchedReply(CASE);
  assert.ok(fb.length > 5);
  assert.ok(fb.indexOf("not sure") >= 0);
});

test("a more specific question wins over a vaguer one", () => {
  // "chest pain" must reach chest_pain, not be swallowed by a broader topic.
  assert.equal(M.matchAsk(CASE, "do you get chest pain").key, "chest_pain");
  // Scoring is by matched-cue LENGTH, so the specific phrasing wins over the generic one.
  assert.equal(M.matchAsk(CASE, "how much can you do before you stop").key, "dyspnea_grade");
});

test("REGRESSION: a loose single-word cue must not hijack an off-topic question", () => {
  // Found by this suite: "what is your favourite colour" matched the SPUTUM topic, because
  // "colour" was a bare cue and matching was raw substring. Two fixes: cues match whole words
  // only and are scored by length, and the genuinely ambiguous cues were tightened.
  // Genuinely off-topic: none of these contains a clinical keyword from the case. A question that
  // DOES contain one (e.g. "how does the inhaler work") is correctly routed to that topic, because
  // a patient asked about their inhaler should answer about their inhaler.
  const offTopic = [
    "what is your favourite colour",
    "do you know how this works",
    "what is the weather like",
    "can you spell your name",
    "how much does it cost"
  ];
  for (const q of offTopic) {
    const hit = M.matchAsk(CASE, q);
    assert.equal(hit, null, `'${q}' wrongly matched topic '${hit && hit.key}'`);
  }
});

test("a cue never fires on a fragment of a longer word", () => {
  // " cough " must not match inside "coughing up" is fine (different word), but it must not match
  // a substring of an unrelated word either.
  assert.equal(M.matchAsk(CASE, "scoughs"), null);
});

/* Exam findings are keyed by SKILL ID -------------------------------------- */

test("ONE MODEL: case exam findings are keyed by the same skill ids the lessons teach", () => {
  const f = M.caseFinding(CASE, "skill.exam.resp.percussion");
  assert.ok(f, "percussion in a case must reuse the lesson's skill id");
  assert.ok(f.finding.indexOf("Hyperresonant") >= 0);
  assert.equal(M.caseFinding(CASE, "skill.not.a.real.skill"), null);
});

test("every exam key in the case is a real skill id from the packs", () => {
  const shared = {};
  for (const f of ["clinix/skills/core.json", "clinix/skills/respiratory.json"]) {
    Object.assign(shared, JSON.parse(readFileSync(join(ROOT, f), "utf8")).skills);
  }
  Object.assign(shared, copd.skills);
  for (const id of Object.keys(CASE.exam)) {
    assert.ok(shared[id], `case examines '${id}', which is not a skill anywhere in the packs`);
  }
});

/* Scoring ------------------------------------------------------------------- */

test("a thorough workup with the right diagnosis scores 'good'", () => {
  const r = M.scoreCase(CASE, {
    asked: Object.keys(CASE.history),
    examined: Object.keys(CASE.exam),
    investigated: CASE.essentialInvestigations,
    differential: "COPD, heart failure, pneumonia, tuberculosis",
    diagnosis: "COPD with an infective exacerbation and cor pulmonale"
  });
  assert.equal(r.diagnosis.correct, true);
  assert.equal(r.verdict, "good");
  assert.equal(r.history.pct, 100);
  assert.equal(r.investigations.unnecessary.length, 0);
});

test("GUESSING IS CAUGHT: the right diagnosis after two questions is not a pass", () => {
  // This is the whole reason the score is not a single percentage. A student who names COPD having
  // asked almost nothing has not worked the patient up, and a blended mark would hide that.
  const r = M.scoreCase(CASE, {
    asked: ["presenting"],
    examined: [],
    investigated: [],
    diagnosis: "COPD"
  });
  assert.equal(r.diagnosis.correct, true, "the answer itself is right");
  assert.equal(r.verdict, "right-answer-thin-workup", "but the encounter is not");
  assert.ok(r.history.missedKey.length > 5);
});

test("REGRESSION: examHit>0 used to be enough to pass - one exam tap, correct dx, full history is not a real workup", () => {
  const r = M.scoreCase(CASE, {
    asked: Object.keys(CASE.history),
    examined: [Object.keys(CASE.exam)[0]],
    investigated: CASE.essentialInvestigations,
    diagnosis: "COPD with an infective exacerbation and cor pulmonale"
  });
  assert.equal(r.diagnosis.correct, true);
  assert.equal(r.verdict, "right-answer-thin-workup", "one exam finding out of many must not read as 'good'");
});

test("REGRESSION: investigations never used to gate the verdict - ordering nothing is not a real workup", () => {
  const r = M.scoreCase(CASE, {
    asked: Object.keys(CASE.history),
    examined: Object.keys(CASE.exam),
    investigated: [],
    diagnosis: "COPD with an infective exacerbation and cor pulmonale"
  });
  assert.equal(r.diagnosis.correct, true);
  assert.equal(r.verdict, "right-answer-thin-workup", "skipping every investigation must not read as 'good'");
});

test("a thorough workup with the WRONG diagnosis reads as incomplete", () => {
  const r = M.scoreCase(CASE, {
    asked: Object.keys(CASE.history),
    examined: Object.keys(CASE.exam),
    investigated: CASE.essentialInvestigations,
    diagnosis: "pulmonary fibrosis"
  });
  assert.equal(r.diagnosis.correct, false);
  assert.equal(r.verdict, "incomplete");
});

test("missed KEY history topics are named, so the student can see what they skipped", () => {
  const r = M.scoreCase(CASE, { asked: ["presenting", "cough"], examined: [], investigated: [] });
  assert.ok(r.history.missedKey.indexOf("smoking") >= 0);
  assert.ok(r.history.missedKey.indexOf("inhaler_technique") >= 0);
  assert.equal(r.history.missedKey.indexOf("presenting"), -1);
});

test("ordering a test that was not indicated is counted, not ignored", () => {
  // A panel is not a plan. Non-indicated tests are reported back with the reason.
  const r = M.scoreCase(CASE, {
    asked: [], examined: [],
    investigated: ["spirometry", "a1at", "tft", "dda"]
  });
  assert.equal(r.investigations.essential, 1);
  assert.ok(r.investigations.unnecessary.indexOf("a1at") >= 0);
  assert.ok(r.investigations.unnecessary.indexOf("tft") >= 0);
  assert.equal(r.investigations.unnecessary.indexOf("spirometry"), -1);
});

test("an untouched case scores zero without throwing", () => {
  const r = M.scoreCase(CASE, {});
  assert.equal(r.history.asked, 0);
  assert.equal(r.diagnosis.correct, false);
  assert.equal(r.verdict, "incomplete");
});

/* Content integrity --------------------------------------------------------- */

test("the case is authored as ai_drafted, so the review gate holds for cases too", () => {
  assert.equal(M.isRenderable(CASE), false);
  assert.equal(M.isRenderable(CASE, { allowDraft: true }), true);
});

test("every history topic has cues and a reply, so no topic is unreachable", () => {
  for (const k of Object.keys(CASE.history)) {
    const t = CASE.history[k];
    assert.ok(Array.isArray(t.cues) && t.cues.length, `${k} has no cues and can never be asked`);
    assert.ok(t.reply && t.reply.length > 5, `${k} has no reply`);
  }
});

test("every essential investigation actually exists in the case", () => {
  for (const id of CASE.essentialInvestigations) {
    assert.ok(CASE.investigations[id], `essential test '${id}' is not defined`);
  }
});

test("every investigation states whether it was indicated, and gives a teaching note", () => {
  for (const id of Object.keys(CASE.investigations)) {
    const ix = CASE.investigations[id];
    assert.ok(typeof ix.indicated === "boolean", `${id} does not say whether it was indicated`);
    assert.ok(ix.result && ix.result.length > 5, `${id} has no result`);
    assert.ok(ix.note && ix.note.length > 10,
      `${id} has no note. An ordered test that teaches nothing back is a wasted turn.`);
  }
});

test("the case carries teaching points, so a finished encounter explains itself", () => {
  assert.ok(Array.isArray(CASE.teachingPoints) && CASE.teachingPoints.length >= 5);
});

test("the case has enough KEY history topics to make the workup check meaningful", () => {
  const keys = Object.keys(CASE.history).filter((k) => CASE.history[k].key);
  assert.ok(keys.length >= 8, `only ${keys.length} key topics; the thin-workup check would be trivial to pass`);
});

test("no em-dash in the case content", () => {
  const raw = readFileSync(join(ROOT, "clinix/diseases/copd.json"), "utf8");
  assert.equal(raw.indexOf("—"), -1);
});

/* The student's words, not the author's ------------------------------------- */

test("SYNONYMS: one question asked three ways reaches the same topic", () => {
  // The author wrote the cues in one register. A student types in another, and a patient who
  // stonewalls two phrasings out of three is teaching the author's vocabulary, not history-taking.
  for (const q of ["are you short of breath", "any dyspnoea", "do you get winded",
                   "do you have shortness of breath"]) {
    const hit = M.matchAsk(CASE, q);
    assert.ok(hit, `'${q}' reached no topic at all`);
    assert.ok(/breath|dyspnea|exert/.test(hit.key), `'${q}' reached '${hit.key}'`);
  }
});

test("SYNONYMS: the everyday word and the clinical word are the same question", () => {
  const pairs = [
    ["do you smoke cigarettes", "do you use tobacco"],
    ["do you use a puffer", "do you use an inhaler"],
    ["any ankle swelling", "any ankle oedema"]
  ];
  for (const [a, b] of pairs) {
    const ha = M.matchAsk(CASE, a), hb = M.matchAsk(CASE, b);
    assert.ok(ha && hb, `'${a}' / '${b}' did not both match`);
    assert.equal(ha.key, hb.key, `'${a}' -> ${ha.key} but '${b}' -> ${hb.key}`);
  }
});

test("canon() is a vocabulary map only, and never invents clinical content", () => {
  // It rewrites words into other words. It must not add, drop meaning, or grow the string
  // into something the author never wrote.
  assert.equal(M.canon("Any SOB on exertion?"), "any breathless on exertion");
  assert.equal(M.canon("  MIXED Case, punctuation!!  "), "mixed case punctuation");
  assert.equal(M.canon(""), "");
  assert.equal(M.canon(null), "");
});

test("canon() does not fire inside a longer word", () => {
  // "smoked" -> "smoke" is intended; "smokestack" must be left alone, or a cue could match a word
  // that merely contains one.
  assert.equal(M.canon("smokestack"), "smokestack");
  assert.equal(M.canon("workshop"), "workshop");
});

/* Near misses --------------------------------------------------------------- */

test("NEAR MISS: a question that reaches for a topic gets a rephrase, not a stonewall", () => {
  const near = M.nearMiss(CASE, "and the stuff you bring up, is there ever blood in it");
  assert.ok(near, "a question this close to a scripted topic must not be a dead end");
  assert.ok(CASE.history[near.key], "the near miss names a real topic");
});

test("NEAR MISS: ONE shared word is never enough", () => {
  // This is the whole threshold. A single loose token is exactly how 'what is your favourite
  // colour' used to reach the sputum topic.
  const offTopic = [
    "what is your favourite colour",
    "do you know how this works",
    "what is the weather like",
    "can you spell your name",
    "how much does it cost"
  ];
  for (const q of offTopic) {
    assert.equal(M.matchAsk(CASE, q), null, `'${q}' matched a topic outright`);
    const n = M.nearMiss(CASE, q);
    assert.equal(n, null, `'${q}' was offered a clarification about '${n && n.key}'`);
  }
});

test("NEAR MISS: stopwords alone can never reach a topic", () => {
  for (const q of ["what about it", "and you", "do you have any", "how long has it been"]) {
    assert.equal(M.nearMiss(CASE, q), null, `'${q}' reached a topic on function words alone`);
  }
  assert.deepEqual(M.contentTokens("what do you have"), []);
});

test("NEAR MISS: a clarification is NOT credited as having asked the topic", () => {
  // If a vague question scored as a precise one, the thin-workup check would be free to pass.
  // caseAsk() in clinix-screens.js pushes a clarify turn without touching caseTaken.asked; this
  // locks the model side of that contract: nearMiss reports a topic, it does not mark it.
  const near = M.nearMiss(CASE, "and the stuff you bring up, is there ever blood in it");
  assert.ok(near.key && near.topic, "nearMiss reports what it thinks was meant");
  assert.equal(typeof near.hits, "number");
  assert.ok(!("asked" in near) && !("credit" in near),
    "nearMiss must not carry anything that reads as credit for the topic");
});

test("NEAR MISS: the reply degrades gracefully when the topic has no 'about' phrase", () => {
  // Most authored topics do not carry one yet, and 'do you mean that?' would be worse than useless.
  const plain = M.clarifyReply({ key: "cough", topic: { cues: [] } });
  assert.ok(plain.indexOf("another way") > 0, plain);
  assert.equal(plain.indexOf("mean that"), -1, "must not render the empty-phrase sentence");

  const withAbout = M.clarifyReply({ key: "sputum", topic: { about: "the phlegm you bring up" } });
  assert.ok(withAbout.indexOf("the phlegm you bring up") > 0, withAbout);
});

test("NEAR MISS: an empty or absent question is not a near miss", () => {
  assert.equal(M.nearMiss(CASE, ""), null);
  assert.equal(M.nearMiss(CASE, null), null);
  assert.equal(M.nearMiss(null, "any cough"), null);
});
