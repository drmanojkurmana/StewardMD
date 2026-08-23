import { test } from "node:test";
import assert from "node:assert";
import T from "../clinix-tutor.js";

/* The dose guard is the load-bearing test in this file. The server prompt tells the model not to
 * give a dose, but a prompt is a request. This is the mechanism. */

test("DOSE GUARD: a reply containing a drug dose is replaced, not passed through", () => {
  const withDose = "For an exacerbation give prednisolone 40 mg daily for five days.";
  const r = T.sanitize(withDose);
  assert.equal(r.blocked, true);
  assert.equal(r.text, T.DOSE_REFUSAL);
  assert.equal(r.text.indexOf("40 mg"), -1, "the dose must not survive anywhere in the output");
  assert.equal(r.original, withDose, "the original is kept for debugging, not for display");
});

test("DOSE GUARD: catches the shapes a model actually emits", () => {
  const cases = [
    "prednisolone 40 mg daily",
    "salbutamol 2.5 mg nebulised",
    "amoxicillin 500mg TDS",
    "give 1 g of magnesium",
    "adrenaline 0.5 ml of 1:1000",
    "hydrocortisone 200 mcg",
    "5 mg/kg loading dose",
    "10 units of insulin",
    "two puffs, 100 micrograms each",
    "azithromycin 500 mg OD for three days"
  ];
  for (const c of cases) {
    assert.equal(T.looksLikeDose(c), true, `missed a dose in: ${c}`);
  }
});

test("DOSE GUARD: does NOT fire on the numbers a respiratory lesson legitimately contains", () => {
  // False positives cost a re-ask, but a guard that blocks normal teaching is a guard that gets
  // turned off. These are all real strings from the COPD content.
  const safe = [
    "target a saturation of 88 to 92 percent rather than 94 or above",
    "a post-bronchodilator FEV1/FVC ratio below 0.7",
    "Mild FEV1 80 percent or above; moderate 50 to under 80; severe 30 to under 50",
    "a PaCO2 above 45 mmHg indicates acute ventilatory failure",
    "cough with sputum on most days for three months in two consecutive years",
    "a 40 pack-year smoking history",
    "Harrison 22e p.2249-2259",
    "stops for breath after walking about 100 metres",
    "each thumb moving about 2.5 to 5 cm from the midline",
    "hold the pressure for at least fifteen seconds",
    "the trachea sits three to four finger-breadths from the notch",
    "a 62-year-old man with four years of breathlessness"
  ];
  for (const s of safe) {
    assert.equal(T.looksLikeDose(s), false, `false positive on: ${s}`);
  }
});

test("DOSE GUARD: the refusal still teaches rather than just refusing", () => {
  const r = T.sanitize("give theophylline 200 mg BD");
  assert.ok(r.text.indexOf("class") > 0, "it should redirect to the drug class");
  assert.ok(r.text.indexOf("treatment section") > 0, "and point at where the reviewed dose lives");
  assert.ok(r.text.indexOf("guideline") > 0, "and keep the guideline-confirmation rule in front of them");
});

test("markers meant for the doctor UI are stripped", () => {
  // icu.js:7267 does the same. CliniX has no chips to render these into.
  assert.equal(T.stripMarkers("Answer.\n@@REFINE: renal impairment | pregnancy@@"), "Answer.");
  assert.equal(T.stripMarkers("Short.@@MORE@@Long."), "Short.\n\nLong.");
  assert.equal(T.stripMarkers("  padded  "), "padded");
});

test("sanitize strips markers before checking for a dose", () => {
  // A dose hidden after a @@MORE@@ marker must not slip through because of ordering.
  const r = T.sanitize("Use a steroid.@@MORE@@Prednisolone 40 mg daily.");
  assert.equal(r.blocked, true);
  assert.equal(r.text.indexOf("40 mg"), -1);
});

test("sanitize passes clean teaching text through untouched", () => {
  const good = "You check the JVP because it tells you the filling pressure of the right heart. " +
    "In COPD a raised JVP with dependent oedema points to cor pulmonale.";
  const r = T.sanitize(good);
  assert.equal(r.blocked, false);
  assert.equal(r.text, good);
});

test("sanitize handles an empty or absent reply", () => {
  assert.deepEqual(T.sanitize(""), { text: "", blocked: false });
  assert.deepEqual(T.sanitize(null), { text: "", blocked: false });
});

/* Context envelope ---------------------------------------------------------- */

test("buildPrompt puts the student's actual position in front of the model", () => {
  const p = T.buildPrompt({
    systemTitle: "Respiratory", diseaseName: "COPD",
    chapterTitle: "Respiratory examination", skillTitle: "Chest expansion",
    turnHeading: "Why we do it",
    stepWhy: "It localises the side of disease."
  }, "why do I do this?");

  assert.ok(p.indexOf("Respiratory") > 0);
  assert.ok(p.indexOf("COPD") > 0);
  assert.ok(p.indexOf("Chest expansion") > 0);
  assert.ok(p.indexOf("Why we do it") > 0);
  assert.ok(p.indexOf("It localises the side of disease.") > 0,
    "the lesson's own 'why' is given to the model so the tutor agrees with the lesson");
  assert.ok(p.indexOf("STUDENT QUESTION: why do I do this?") > 0);
});

test("buildPrompt feeds recent mistakes in, and tells the model not to read them back", () => {
  const p = T.buildPrompt({
    skillTitle: "Percussion",
    recentMisses: [{ skillId: "skill.exam.resp.expansion" }, { skillId: "skill.gen.clubbing" }]
  }, "how do I percuss?");
  assert.ok(p.indexOf("skill.exam.resp.expansion") > 0);
  assert.ok(p.indexOf("do not read the list back") > 0);
});

test("buildPrompt is bounded, so one long question cannot blow the token budget", () => {
  const p = T.buildPrompt({ skillTitle: "X" }, "a".repeat(5000));
  assert.ok(p.length < 1200, "prompt grew to " + p.length);
});

test("buildPrompt survives an empty context", () => {
  const p = T.buildPrompt(null, "what is COPD?");
  assert.ok(p.indexOf("STUDENT QUESTION: what is COPD?") > 0);
});

/* Scope widening ------------------------------------------------------------ */

test("the exam vocabulary covers the single words that hit the clarify trap", () => {
  // home.js:3748 sends any query of two tokens or fewer with no .medical signal to "clarify".
  // These are exactly what a student types into a tutor box.
  const joined = T.EXAM_VOCAB.join(" ");
  for (const term of ["jvp", "percuss", "auscultat", "clubbing", "fremitus", "osce", "viva"]) {
    assert.ok(joined.indexOf(term) >= 0, `exam vocabulary is missing '${term}'`);
  }
});

test("every vocabulary entry is a valid regular expression", () => {
  for (const v of T.EXAM_VOCAB) {
    assert.doesNotThrow(() => new RegExp(v, "i"), `'${v}' is not a valid regex and would throw at configure() time`);
  }
});

test("widenScope is inert when the CliniX flag is off, so flag-off stays a no-op", () => {
  // No window, no flags -> must not throw and must report that it did nothing.
  assert.equal(T.widenScope(), false);
});

test("answer() degrades honestly when MaiK is absent", async () => {
  assert.equal(T.available(), false, "no window.SMD_AI in node");
  const r = await T.answer({}, "why?");
  assert.equal(r.error, "ai-off", "a missing transport is reported, never faked");
});

/* Viva examiner ------------------------------------------------------------- */

test("judgeVivaAnswer() degrades honestly when MaiK is absent", async () => {
  assert.equal(T.vivaAvailable(), false, "no window.SMD_AI.vivaJudge in node");
  const r = await T.judgeVivaAnswer({ q: "What is a normal liver span?" }, "6 to 12 cm");
  assert.equal(r.error, "ai-off", "a missing transport is reported, never faked, never silently marked correct");
});

test("judgeVivaAnswer() refuses to call out with no question or no answer", async () => {
  const noAnswer = await T.judgeVivaAnswer({ q: "Define shock." }, "");
  assert.equal(noAnswer.error, "no-input");
  const noProbe = await T.judgeVivaAnswer(null, "something");
  assert.equal(noProbe.error, "no-input");
});
