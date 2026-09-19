/* test/clinix-dx.test.mjs - the diagnosis vocabulary, the pickers and the management MCQ.
 *
 * Owner, 2026-09-19: "in ddx, dx give him 100s of diagnosis and he will pickup one and give hints
 * too, and plan also give mcq options so he will select." Three free-text boxes became a searchable
 * vocabulary, a graded hint ladder and a select-all-that-apply plan.
 *
 * Marking is where this can go quietly wrong, so most of these tests are about marking rather than
 * search: an accept list that carries "heart failure", "CCF" and "cardiac failure" describes ONE
 * concept, and a student who picked one of them has not missed the other two.
 *
 * Run against the real shipped content and the real 365-entry vocabulary.
 *
 * node --test test/clinix-dx.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DX from "../clinix-dx.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VOCAB = JSON.parse(readFileSync(join(ROOT, "clinix/dx-vocabulary.json"), "utf8"));
const CASES = {};
for (const f of readdirSync(join(ROOT, "clinix/diseases"))) {
  const d = JSON.parse(readFileSync(join(ROOT, "clinix/diseases", f), "utf8"));
  for (const c of (d.cases || [])) CASES[d.id] = { ...c, system: d.system || c.system };
}
const caseOf = (id) => { const c = CASES[id]; assert.ok(c, "case content missing: " + id); return c; };

/* ── the vocabulary ──────────────────────────────────────────────────────────────────────────── */

test("the vocabulary is the hundreds of diagnoses the owner asked for, and is well formed", () => {
  assert.equal(VOCAB.version, "dx1");
  assert.ok(VOCAB.dx.length >= 300, "only " + VOCAB.dx.length + " diagnoses");
  const sysIds = new Set(VOCAB.systems.map((s) => s.id));
  const names = new Set();
  for (const d of VOCAB.dx) {
    assert.ok(d.n && typeof d.n === "string", "every entry has a name");
    assert.ok(sysIds.has(d.s), `${d.n} is filed under an unknown system "${d.s}"`);
    assert.equal(names.has(d.n.toLowerCase()), false, "duplicate diagnosis: " + d.n);
    names.add(d.n.toLowerCase());
    if (d.syn) assert.ok(Array.isArray(d.syn), d.n + " synonyms must be a list");
  }
  for (const s of VOCAB.systems) assert.ok(VOCAB.dx.some((d) => d.s === s.id), "empty system: " + s.id);
});

test("search finds a diagnosis by name, by abbreviation and despite a typo", () => {
  const names = (q) => DX.search(VOCAB, q, { limit: 10 }).map((d) => d.n.toLowerCase());
  assert.ok(names("copd").some((n) => n.includes("obstructive")), "by abbreviation");
  assert.ok(names("heart failure").some((n) => n.includes("heart failure")), "by name");
  assert.ok(names("ccf").some((n) => n.includes("cardiac failure")), "by synonym");
  assert.ok(names("pneumonia").length > 0);
  assert.ok(names("astma").some((n) => n.includes("asthma")), "one-letter typo still lands");
  assert.deepEqual(DX.search(VOCAB, "", { limit: 5 }).length, 0, "an empty query matches nothing");
});

test("an exact name outranks a diagnosis that merely contains the word", () => {
  assert.match(DX.search(VOCAB, "asthma", { limit: 5 })[0].n, /asthma/i);
  assert.match(DX.search(VOCAB, "tuberculosis", { limit: 5 })[0].n, /tuberculosis/i);
});

test("the system filter narrows the list without emptying it", () => {
  const resp = DX.bySystem(VOCAB, "resp", 100);
  assert.ok(resp.length > 10, "the respiratory system has a real list");
  assert.ok(resp.every((d) => d.s === "resp"));
  assert.ok(DX.search(VOCAB, "pneumonia", { system: "resp" }).every((d) => d.s === "resp"));
  assert.equal(DX.vocabSystemFor("respiratory"), "resp");
  assert.equal(DX.vocabSystemFor("cardiovascular"), "cvs");
});

test("the picker never opens on an empty box", () => {
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    const list = DX.shortlist(VOCAB, c, c.system, 12);
    assert.ok(list.length > 0, "empty shortlist for " + id);
  }
});

/* ── hints ───────────────────────────────────────────────────────────────────────────────────── */

test("hints are a ladder, and the top of it is not the answer", () => {
  const c = caseOf("copd");
  const h = DX.hints(c, VOCAB, c.system);
  assert.ok(h.length >= 2, "at least a system hint and a teaching point");
  assert.deepEqual(h.map((x) => x.level), h.map((x) => x.level).slice().sort((a, b) => a - b), "ordered");
  const answer = String(c.diagnosis.answer || "").toLowerCase();
  for (const step of h) {
    assert.ok(step.text && step.text.length > 10, "a hint has to say something");
    assert.equal(step.text.toLowerCase().includes(answer), false, "a hint must not state the diagnosis: " + step.text);
  }
});

test("every shipped case can produce at least one hint", () => {
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    assert.ok(DX.hints(c, VOCAB, c.system).length > 0, "no hint available for " + id);
  }
});

/* ── marking the differential ────────────────────────────────────────────────────────────────── */

test("synonyms of one concept count once, missed or matched", () => {
  const fake = {
    id: "fake",
    differentialModel: { accept: ["heart failure", "ccf", "cardiac failure", "pneumonia"], minMatch: 2 },
    diagnosis: { accept: ["heart failure"], answer: "Heart failure" }
  };
  const one = DX.scoreDifferential(fake, ["Congestive cardiac failure"], VOCAB);
  assert.equal(one.matched.length, 1);
  assert.deepEqual(one.missed.length, 1, "pneumonia is the only genuine miss, not three: " + one.missed.join(", "));
  const both = DX.scoreDifferential(fake, ["Congestive cardiac failure", "Community-acquired pneumonia"], VOCAB);
  assert.equal(both.missed.length, 0);
  assert.equal(both.correct, true);
});

test("the true diagnosis has to be on the list, whatever else is", () => {
  const c = caseOf("copd");
  const accept = c.differentialModel.accept;
  const noTruth = DX.scoreDifferential(c, ["Bronchial asthma"], VOCAB);
  assert.equal(noTruth.hasTruth, false);
  assert.equal(noTruth.correct, false, "breadth does not make up for missing the diagnosis");
  const withTruth = DX.scoreDifferential(c, accept.slice(0, Math.max(2, c.differentialModel.minMatch || 2)), VOCAB);
  assert.equal(withTruth.hasTruth, true);
});

test("a shotgun list is caught, because naming everything is not a differential", () => {
  const c = caseOf("copd");
  const spray = DX.scoreDifferential(c, [
    "Bronchial asthma", "Congestive cardiac failure", "Pulmonary embolism", "Lung cancer",
    "Pneumothorax", "Anaemia", "Hyperthyroidism", "Panic disorder", "Chronic obstructive pulmonary disease"
  ], VOCAB);
  assert.equal(spray.shotgun, true);
  assert.equal(spray.correct, false);
  const focused = DX.scoreDifferential(c, c.differentialModel.accept.slice(0, 3), VOCAB);
  assert.equal(focused.shotgun, false);
});

test("mostly-wrong short lists are shotgun too", () => {
  const fake = {
    id: "f2", differentialModel: { accept: ["asthma"], minMatch: 1 },
    diagnosis: { accept: ["asthma"], answer: "Asthma" }
  };
  const r = DX.scoreDifferential(fake, ["Asthma", "Gout", "Psoriasis", "Migraine"], VOCAB);
  assert.equal(r.shotgun, true, "three unsupported guesses around one right answer");
});

test("every shipped case is passable by its own model differential", () => {
  const failures = [];
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    const accept = (c.differentialModel && c.differentialModel.accept) || [];
    if (!accept.length) continue;
    // Take the model answer down to a focused list: the first few terms plus the true diagnosis.
    const picks = [];
    for (const t of accept) {
      const e = DX.findByTerm(VOCAB, t);
      const name = e ? e.n : t;
      if (!picks.some((p) => p.toLowerCase() === name.toLowerCase())) picks.push(name);
      if (picks.length >= 4) break;
    }
    const truth = (c.diagnosis && c.diagnosis.accept) || [];
    if (truth.length) {
      const e = DX.findByTerm(VOCAB, truth[0]);
      const name = e ? e.n : truth[0];
      if (!picks.some((p) => p.toLowerCase() === name.toLowerCase())) picks.push(name);
    }
    const r = DX.scoreDifferential(c, picks, VOCAB);
    if (!r.correct) failures.push(`${id}: picked [${picks.join(", ")}] -> matched ${r.matched.length}/${r.need}, ` +
      `truth ${r.hasTruth}, shotgun ${r.shotgun}, missed [${r.missed.join(", ")}]`);
  }
  assert.deepEqual(failures, [], "a case the author's own answer cannot pass is a content bug");
});

test("committing to a diagnosis is marked against the case's accept list", () => {
  const c = caseOf("copd");
  assert.equal(DX.scoreDiagnosis(c, c.diagnosis.accept[0], VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c, "Gout", VOCAB).correct, false);
  assert.equal(DX.scoreDiagnosis(c, "", VOCAB).correct, false);
  assert.equal(DX.scoreDiagnosis(c, "Gout", VOCAB).answer, c.diagnosis.answer);
});

/* ── the management MCQ ──────────────────────────────────────────────────────────────────────── */

test("the plan is a short list of options, not a checklist you can sweep", () => {
  let mcq = 0;
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    if (!c.managementModel || !(c.managementModel.accept || []).length) continue;
    const opts = DX.planOptions(c);
    // A case whose model answer is keyword fragments rather than actions keeps the written plan
    // instead of being forced into an unanswerable multiple choice.
    if (!opts.length) continue;
    mcq++;
    assert.ok(opts.length >= 6 && opts.length <= 12, `${id}: ${opts.length} options is not a usable MCQ`);
    const right = opts.filter((o) => o.correct).length;
    assert.ok(right <= 6, `${id}: ${right} correct answers out of ${opts.length}`);
    assert.ok(right >= 1, `${id}: no correct answer is reachable`);
    assert.ok(opts.length - right >= 3, `${id}: too few distractors to make a real choice`);
    const ids = new Set(opts.map((o) => o.id));
    assert.equal(ids.size, opts.length, id + ": duplicate option ids");
    for (const o of opts) {
      assert.ok(o.text && o.text.length > 5, id + ": an option must read as an action");
      assert.equal(o.text.indexOf("—"), -1, "no em-dash in app-facing text: " + o.text);
    }
  }
});

test("the option order is deterministic per case, so a repaint never reshuffles the answers", () => {
  const c = caseOf("copd");
  assert.deepEqual(DX.planOptions(c).map((o) => o.id), DX.planOptions(c).map((o) => o.id));
  assert.deepEqual(DX.planOptions(c).map((o) => o.text), DX.planOptions(c).map((o) => o.text));
  const other = caseOf("congestive-cardiac-failure");
  assert.notDeepEqual(DX.planOptions(c).map((o) => o.text), DX.planOptions(other).map((o) => o.text));
});

test("a distractor never names something the case actually wants", () => {
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    const accept = (c.managementModel && c.managementModel.accept) || [];
    if (!accept.length) continue;
    for (const o of DX.planOptions(c)) {
      if (o.correct) continue;
      for (const a of accept) {
        assert.equal(o.text.toLowerCase().includes(String(a).toLowerCase()), false,
          `${id}: distractor "${o.text}" names the wanted action "${a}"`);
      }
    }
  }
});

test("picking every option is not a pass, and picking the right ones is", () => {
  const c = caseOf("copd");
  const opts = DX.planOptions(c);
  const all = DX.scorePlan(c, opts.map((o) => o.id), opts);
  assert.equal(all.correct, false, "selecting everything must not score");
  assert.ok(all.wrong.length > 0);
  const right = DX.scorePlan(c, opts.filter((o) => o.correct).map((o) => o.id), opts);
  assert.equal(right.correct, true);
  assert.equal(right.pct, 100);
  assert.equal(right.missed.length, 0);
  const none = DX.scorePlan(c, [], opts);
  assert.equal(none.correct, false);
  assert.equal(none.pct, 0);
});

test("a harmful choice is disqualifying, not a deduction", () => {
  const c = caseOf("copd");
  const opts = DX.planOptions(c);
  const harm = opts.find((o) => o.harm);
  assert.ok(harm, "this case offers at least one actively harmful option to choose");
  const r = DX.scorePlan(c, opts.filter((o) => o.correct).map((o) => o.id).concat([harm.id]), opts);
  assert.equal(r.harmful.length, 1);
  assert.equal(r.correct, false, "every right answer plus one harmful one is still a fail");
  assert.equal(r.harmful[0].text, harm.text, "and the result names which one");
});

test("at least one harmful option exists across the bank, or the harm rule is dead code", () => {
  let harmful = 0;
  for (const id of Object.keys(CASES)) {
    const c = caseOf(id);
    if (!c.managementModel || !(c.managementModel.accept || []).length) continue;
    if (DX.planOptions(c).some((o) => o.harm)) harmful++;
  }
  assert.ok(harmful > 0, "no case ever offers a harmful option");
});

test("scorePlan builds its own options when it is not given any", () => {
  const c = caseOf("copd");
  const r = DX.scorePlan(c, []);
  assert.ok(r.total > 0);
  assert.equal(r.answer, c.managementModel.answer || "");
});
