import { test } from "node:test";
import assert from "node:assert";
import M from "../clinix-model.js";

/* Fixtures ------------------------------------------------------------------ */

function skill(over) {
  return Object.assign({
    id: "skill.exam.resp.expansion",
    kind: "exam",
    system: "respiratory",
    title: "Chest expansion",
    oneLine: "Symmetry and amount of chest wall movement",
    why: "It localises the side of disease and quantifies restriction.",
    steps: [{ text: "Stand behind the seated patient." }, { text: "Grip the chest with thumbs floating." }],
    normal: "Both thumbs move apart symmetrically by 3 to 5 cm.",
    abnormal: "Reduced overall, or one side lags behind the other.",
    significance: "Asymmetry localises pathology to the lagging side.",
    pitfalls: ["Anchoring the thumbs to the chest wall, which hides the movement."],
    media: [],
    probes: [
      { level: 1, q: "Where do you stand?", a: "Behind the patient.", accept: ["behind"] },
      { level: 2, q: "One side lags. Which side is diseased?", a: "The lagging side.", accept: ["lagging", "same side"] }
    ],
    rubric: [
      { id: "consent", text: "Obtains consent", critical: true },
      { id: "position", text: "Positions the patient correctly" }
    ],
    sources: [{ source: "Harrison 22e", locator: "p.2249-2259" }],
    review: { status: "approved" }
  }, over || {});
}

/* Review gate --------------------------------------------------------------- */

test("review gate: only approved/published reach a student", () => {
  assert.equal(M.isRenderable(skill({ review: { status: "approved" } })), true);
  assert.equal(M.isRenderable(skill({ review: { status: "published" } })), true);
  assert.equal(M.isRenderable(skill({ review: { status: "ai_drafted" } })), false);
  assert.equal(M.isRenderable(skill({ review: { status: "draft" } })), false);
  assert.equal(M.isRenderable(skill({ review: { status: "in_review" } })), false);
  assert.equal(M.isRenderable(skill({ review: { status: "deprecated" } })), false);
});

test("review gate: a missing/garbled review status fails CLOSED as draft", () => {
  assert.equal(M.reviewStatus({}), "draft");
  assert.equal(M.reviewStatus({ review: { status: "totally-made-up" } }), "draft");
  assert.equal(M.isRenderable({}), false);
});

test("review gate: the draft flag opens everything except deprecated", () => {
  const o = { allowDraft: true };
  assert.equal(M.isRenderable(skill({ review: { status: "ai_drafted" } }), o), true);
  assert.equal(M.isRenderable(skill({ review: { status: "deprecated" } }), o), false,
    "deprecated stays hidden even for an author");
});

/* Licence gate -------------------------------------------------------------- */

test("licence gate: media renders only when positively cleared", () => {
  const cleared = { id: "m1", kind: "image", caption: "Barrel chest", licence: "CC BY 4.0", attribution: "Wikimedia", cleared: true, src: "/x.jpg" };
  assert.equal(M.mediaRenderable(cleared), true);
  assert.equal(M.mediaRenderable(Object.assign({}, cleared, { cleared: false })), false);
  assert.equal(M.mediaRenderable(Object.assign({}, cleared, { cleared: undefined })), false,
    "absence of a licence record is a refusal, not a default-allow");
  assert.equal(M.mediaRenderable(Object.assign({}, cleared, { licence: "" })), false);
  assert.equal(M.mediaRenderable(Object.assign({}, cleared, { attribution: "" })), false);
  assert.equal(M.mediaRenderable(null), false);
});

test("licence gate: an embed is only iframed when the rights holder permits it", () => {
  const base = { id: "m2", kind: "embed", caption: "Percussion technique", licence: "YouTube standard", attribution: "Osmosis", cleared: true, sourceUrl: "https://youtu.be/x" };
  assert.equal(M.isEmbeddable(base), false, "embeddable must be explicitly true");
  assert.equal(M.isEmbeddable(Object.assign({}, base, { embeddable: true })), true);
  assert.equal(M.isEmbeddable(Object.assign({}, base, { embeddable: true, sourceUrl: "" })), false);
});

/* Validators ---------------------------------------------------------------- */

test("validateSkill: a well-formed exam skill passes", () => {
  const v = M.validateSkill(skill());
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test("validateSkill: 'why' is mandatory - a skill that cannot say why is not teachable", () => {
  const v = M.validateSkill(skill({ why: undefined }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("skill.why required") === 0));
});

test("validateSkill: an exam skill must state normal, abnormal and significance", () => {
  const v = M.validateSkill(skill({ normal: undefined, abnormal: undefined, significance: undefined }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("skill.normal") === 0));
  assert.ok(v.errors.some((e) => e.indexOf("skill.abnormal") === 0));
  assert.ok(v.errors.some((e) => e.indexOf("skill.significance") === 0));
});

test("validateSkill: sources are mandatory - no source, no teaching", () => {
  assert.equal(M.validateSkill(skill({ sources: [] })).ok, false);
  assert.equal(M.validateSkill(skill({ sources: undefined })).ok, false);
});

test("validateSkill: probe levels are bounded 1-4 and need a model answer", () => {
  assert.equal(M.validateSkill(skill({ probes: [{ level: 7, q: "?", a: "!" }] })).ok, false);
  assert.equal(M.validateSkill(skill({ probes: [{ level: 1, q: "?" }] })).ok, false);
});

test("validateSkill: an MCQ probe with correctIndex out of range is rejected", () => {
  const v = M.validateSkill(skill({ probes: [{ level: 1, q: "?", a: "b", options: ["a", "b"], correctIndex: 5 }] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("correctIndex out of range") >= 0));
});

test("validateMedia: a CLEARED asset must carry real provenance", () => {
  const v = M.validateMedia({ id: "m", kind: "image", caption: "a caption", cleared: true });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("media.licence required") >= 0));
  assert.ok(v.errors.some((e) => e.indexOf("media.attribution required") >= 0));
  assert.ok(v.errors.some((e) => e.indexOf("media.src required") >= 0));
});

test("validateMedia: an UNCLEARED asset must carry a sourcing note instead of a placeholder licence", () => {
  // Demanding a licence string before the media is sourced only produces "TBD", and a placeholder
  // in a licence field reads as provenance. Demand the work order instead.
  const noNote = M.validateMedia({ id: "m", kind: "image", caption: "a caption", cleared: false });
  assert.equal(noNote.ok, false);
  assert.ok(noNote.errors.some((e) => e.indexOf("media.note required") >= 0));

  const withNote = M.validateMedia({
    id: "m", kind: "image", caption: "a caption", cleared: false,
    licence: "", attribution: "", note: "Needs an openly-licensed lateral chest photograph."
  });
  assert.deepEqual(withNote.errors, []);
});

test("validateMedia: a cleared embed needs a sourceUrl rather than a src", () => {
  const v = M.validateMedia({
    id: "m", kind: "embed", caption: "a caption", cleared: true,
    licence: "YouTube standard", attribution: "Osmosis", sourceUrl: "https://youtu.be/x"
  });
  assert.deepEqual(v.errors, []);
});

test("validateDisease: chapter ids must come from the fixed pathway spine", () => {
  const ok = M.validateDisease({ id: "copd", name: "COPD", system: "respiratory", chapters: [{ id: "history", title: "History" }] });
  assert.equal(ok.ok, true);
  const bad = M.validateDisease({ id: "copd", name: "COPD", system: "respiratory", chapters: [{ id: "freestyle", title: "Whatever" }] });
  assert.equal(bad.ok, false);
});

test("validatePack: catches a disease referencing a skill that does not exist", () => {
  const pack = {
    skills: { "skill.exam.resp.expansion": skill() },
    media: {},
    diseases: [{
      id: "copd", name: "COPD", system: "respiratory",
      chapters: [{ id: "systemic_exam", title: "Examination", skills: ["skill.exam.resp.expansion", "skill.does.not.exist"] }]
    }]
  };
  const v = M.validatePack(pack);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("unknown skill 'skill.does.not.exist'") >= 0));
});

test("validatePack: catches a skill referencing media that does not exist", () => {
  const pack = { skills: { "skill.exam.resp.expansion": skill({ media: ["media.ghost"] }) }, media: {}, diseases: [] };
  const v = M.validatePack(pack);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("unknown media 'media.ghost'") >= 0));
});

test("validatePack: catches a key/id mismatch in the skill table", () => {
  const v = M.validatePack({ skills: { "wrong.key": skill() }, media: {}, diseases: [] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.indexOf("does not match skill.id") >= 0));
});

/* LEARN projection ---------------------------------------------------------- */

test("compileLesson: TEACH comes before ASK - you cannot quiz someone you never taught", () => {
  // The first version asked a hook question second, which only works for a student who already
  // half-knows the material. For someone meeting it for the first time it is a quiz on something
  // nobody taught them, which is exactly how the module read as interactive rather than as a
  // teacher. Order is now: show, teach, how, why, reveal, ask, practise, check.
  const s = skill({ media: ["m1"], teach: [{ heading: "What it is", body: "..." }, { heading: "Why", points: ["a"] }] });
  const t = M.compileLesson(s);
  const kinds = t.map((x) => x.kind);

  assert.equal(kinds[0], "show", "media leads - watch it before reading about it");

  const firstTeach = kinds.indexOf("teach");
  const firstAsk = kinds.indexOf("ask");
  const firstTell = kinds.indexOf("tell");
  const firstReveal = kinds.indexOf("reveal");

  assert.ok(firstTeach >= 0, "a skill with teaching content produces teaching turns");
  assert.ok(firstTeach < firstTell, "teaching comes before the how-to steps");
  assert.ok(firstAsk > firstTeach, "THE RULE: the student is taught before being asked anything");
  assert.ok(firstAsk > firstTell, "and after being told how to do it");
  assert.ok(firstReveal > firstTell, "findings are still revealed only after the teaching");
});

test("compileLesson: every teaching block becomes its own turn, numbered", () => {
  // One idea per screen. A wall of prose is the thing this module exists not to be.
  const s = skill({ teach: [{ heading: "A", body: "x" }, { heading: "B", body: "y" }, { heading: "C", body: "z" }] });
  const teaches = M.compileLesson(s).filter((x) => x.kind === "teach");
  assert.equal(teaches.length, 3);
  assert.equal(teaches[0].index, 0);
  assert.equal(teaches[0].total, 3);
  assert.equal(teaches[2].block.heading, "C");
});

test("compileLesson: a skill with NO teaching content still works", () => {
  // Not every skill needs a taught section, and the ones that do not must not break.
  const t = M.compileLesson(skill());
  assert.equal(t.filter((x) => x.kind === "teach").length, 0);
  assert.ok(t.some((x) => x.kind === "ask"), "it still asks");
  assert.ok(t.some((x) => x.kind === "tell"), "and still tells");
});

test("compileLesson: every lesson explains WHY", () => {
  const t = M.compileLesson(skill());
  assert.ok(t.some((x) => x.kind === "tell" && x.heading === "Why we do it" && x.body));
});

test("compileLesson: disease emphasis is injected for a shared skill", () => {
  const t = M.compileLesson(skill(), { expect: "In COPD expect symmetrically reduced expansion." });
  const em = t.filter((x) => x.emphasis === true);
  assert.equal(em.length, 1);
  assert.equal(em[0].heading, "In this patient");
  assert.ok(em[0].body.indexOf("COPD") >= 0);
});

test("compileLesson: a skill with no media still produces a full lesson", () => {
  const t = M.compileLesson(skill({ media: [] }));
  assert.equal(t.filter((x) => x.kind === "show").length, 0);
  assert.ok(t.length >= 5, "no media must not mean no lesson");
  assert.ok(t.some((x) => x.kind === "doit"), "practice still happens");
});

test("compileLesson: the closing check is a harder probe than the hook", () => {
  const t = M.compileLesson(skill());
  const hook = t.filter((x) => x.kind === "ask")[0];
  const close = t.filter((x) => x.kind === "check")[0];
  assert.ok(hook && close);
  assert.ok(close.probe.level > hook.probe.level);
});

/* OSCE projection - the SAME skill objects --------------------------------- */

test("compileStation: builds a checklist from skills, with no station authoring", () => {
  const st = M.compileStation([skill()], { title: "Respiratory examination", seconds: 300 });
  assert.equal(st.items.length, 2);
  assert.equal(st.maxScore, 2);
  assert.equal(st.criticalCount, 1);
  assert.equal(st.items[0].id, "skill.exam.resp.expansion/consent");
});

test("scoreStation: missing a CRITICAL item fails the station regardless of total", () => {
  const st = M.compileStation([skill()], {});
  const all = M.scoreStation(st, ["skill.exam.resp.expansion/consent", "skill.exam.resp.expansion/position"]);
  assert.equal(all.pct, 100);
  assert.equal(all.passed, true);

  // Got the non-critical item only: 50% on marks, but consent was missed.
  const noConsent = M.scoreStation(st, ["skill.exam.resp.expansion/position"]);
  assert.equal(noConsent.pct, 50);
  assert.equal(noConsent.passed, false);
  assert.equal(noConsent.failedOnCritical, true);
  assert.equal(noConsent.missedCritical[0].text, "Obtains consent");
});

test("scoreStation: reports per-skill results so a station writes competency", () => {
  const st = M.compileStation([skill()], {});
  const r = M.scoreStation(st, ["skill.exam.resp.expansion/consent"]);
  assert.deepEqual(r.perSkill["skill.exam.resp.expansion"], { seen: 2, correct: 1 });
});

/* VIVA projection - the SAME probes ---------------------------------------- */

test("compileViva + nextVivaQuestion: asks one question at a time and never repeats", () => {
  const v = M.compileViva([skill()]);
  assert.equal(v.pool.length, 2);
  const state = { level: 1, asked: {} };
  const first = M.nextVivaQuestion(v, state);
  assert.ok(first);
  state.asked[first.key] = 1;
  const second = M.nextVivaQuestion(v, state);
  assert.ok(second);
  assert.notEqual(second.key, first.key);
});

test("nextVivaQuestion: a student is never dead-ended when a level is exhausted", () => {
  const v = M.compileViva([skill()]);
  const state = { level: 4, asked: {} };   // no level-4 probes exist
  assert.ok(M.nextVivaQuestion(v, state), "falls back to an available level");
});

test("adaptLevel: escalates on correct, drops back on wrong, stays in bounds", () => {
  assert.equal(M.adaptLevel(1, true, 4), 2);
  assert.equal(M.adaptLevel(4, true, 4), 4);
  assert.equal(M.adaptLevel(2, false, 4), 1);
  assert.equal(M.adaptLevel(1, false, 4), 1);
});

/* Marking ------------------------------------------------------------------- */

test("markAnswer: MCQ marking is exact", () => {
  const p = { level: 1, q: "?", a: "b", options: ["a", "b", "c"], correctIndex: 1 };
  assert.equal(M.markAnswer(p, 1).correct, true);
  assert.equal(M.markAnswer(p, 0).correct, false);
});

test("markAnswer: free text is marked deterministically, offline, without a model", () => {
  const p = { level: 2, q: "One side lags. Which side is diseased?", a: "The lagging side.", accept: ["lagging"] };
  assert.equal(M.markAnswer(p, "the lagging side").correct, true);
  assert.equal(M.markAnswer(p, "The LAGGING side!").correct, true, "case and punctuation insensitive");
  assert.equal(M.markAnswer(p, "the opposite side").correct, false);
});

test("markAnswer: a probe with no accept list asks for a judge rather than guessing", () => {
  const r = M.markAnswer({ level: 3, q: "Discuss.", a: "..." }, "something");
  assert.equal(r.correct, null);
  assert.equal(r.needsJudge, true);
});

/* Competency ---------------------------------------------------------------- */

test("mastery is not one correct answer", () => {
  assert.equal(M.masteryOf({ seen: 1, correct: 1, days: ["2026-08-22"] }).level, "learning",
    "a single lucky answer must not mint competence");
  assert.equal(M.masteryOf({ seen: 4, correct: 4, days: ["2026-08-22", "2026-08-24"] }).level, "mastered");
  assert.equal(M.masteryOf({ seen: 5, correct: 5, days: ["2026-08-22"] }).level, "learning",
    "all on one day is not mastery");
  assert.equal(M.masteryOf({ seen: 10, correct: 4, days: ["a", "b"] }).level, "learning",
    "40 percent accuracy is not mastery");
  assert.equal(M.masteryOf({}).level, "new");
  assert.equal(M.masteryOf({ seen: 3, correct: 0, days: ["a"] }).level, "struggling");
});

test("competencyFor: aggregates a chapter and surfaces the weak skills", () => {
  const ids = ["a", "b", "c"];
  const rec = {};
  rec[M.competencyKey("a")] = { seen: 4, correct: 4, days: ["x", "y"] };   // mastered
  rec[M.competencyKey("b")] = { seen: 5, correct: 1, days: ["x"] };        // weak
  const c = M.competencyFor(ids, rec);
  assert.equal(c.total, 3);
  assert.equal(c.mastered, 1);
  assert.ok(c.weak.indexOf("b") >= 0);
  assert.equal(c.weak.indexOf("a"), -1);
});

/* Pathway ------------------------------------------------------------------- */

test("buildPathway: the review gate applies per skill, and an empty chapter is marked not hidden", () => {
  const skills = {
    "ok": skill({ id: "ok" }),
    "draft": skill({ id: "draft", review: { status: "draft" } })
  };
  const disease = {
    id: "copd", name: "COPD", system: "respiratory",
    chapters: [
      { id: "systemic_exam", title: "Examination", skills: ["ok", "draft"] },
      { id: "treatment", title: "Treatment", skills: ["draft"] }
    ]
  };
  const p = M.buildPathway(disease, skills);
  assert.equal(p[0].count, 1, "the draft skill is filtered out");
  assert.equal(p[1].count, 0);
  assert.equal(p[1].empty, true, "the chapter still appears in the rail so the pathway keeps its shape");
  assert.deepEqual(M.pathwaySkillIds(p), ["ok"]);
});

test("buildPathway: with the draft flag on, an author sees everything", () => {
  const skills = { "draft": skill({ id: "draft", review: { status: "ai_drafted" } }) };
  const disease = { id: "copd", name: "COPD", system: "respiratory", chapters: [{ id: "history", title: "History", skills: ["draft"] }] };
  assert.equal(M.buildPathway(disease, skills, { allowDraft: true })[0].count, 1);
  assert.equal(M.buildPathway(disease, skills)[0].count, 0);
});
