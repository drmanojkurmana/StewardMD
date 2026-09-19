/* test/clinix-lexicon.test.mjs — the case patient understands how students actually type.
 *
 * Reported 2026-09-19: "each student talks english differently how will he ask exact question as we
 * programmed". The old matcher was a whole-word substring test against the author's cue phrases, so
 * anything the author had not foreseen ("how many pillows u sleep with", "sob on exertion", "since
 * how many days fever") fell through to the fallback and read as a broken app.
 *
 * These cases are run against the REAL shipped content in clinix/diseases/*.json, not a fixture, so
 * a content edit that breaks a phrasing fails here. The negative half matters as much as the
 * positive half: a simulated patient that answers small talk from a case script is inventing
 * clinical content, which is the one thing this engine must never do.
 *
 * node --test test/clinix-lexicon.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import L from "../clinix-lexicon.js";
import M from "../clinix-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = {};
for (const f of readdirSync(join(ROOT, "clinix/diseases"))) {
  const d = JSON.parse(readFileSync(join(ROOT, "clinix/diseases", f), "utf8"));
  for (const c of (d.cases || [])) CASES[d.id] = c;
}
const caseOf = (id) => { const c = CASES[id]; assert.ok(c, "case content missing: " + id); return c; };
const ask = (id, q) => L.match(caseOf(id).history, q).key;

/* ── the phrasings students actually use ─────────────────────────────────────────────────────── */

test("the opening question, however it is phrased", () => {
  const ccf = "congestive-cardiac-failure";
  for (const q of ["hello sir what brings u here today", "wat is ur problem", "kya takleef hai",
                   "why have you come to hospital", "tell me what happened"]) {
    assert.equal(ask(ccf, q), "presenting", q);
  }
});

test("breathlessness: lay words, chat-speak and the functional grading question", () => {
  const ccf = "congestive-cardiac-failure";
  for (const q of ["do u get breathless on walking", "sob on exertion?", "how far can u walk before stopping",
                   "can you climb stairs", "breathing problem while doing work", "are you short of breath"]) {
    assert.equal(ask(ccf, q), "dyspnea_grade", q);
  }
});

test("orthopnea is asked about pillows and lying down far more often than by name", () => {
  const ccf = "congestive-cardiac-failure";
  for (const q of ["how many pillows do u sleep with", "are you able to lie down flat",
                   "do you wake up at night gasping", "can u sleep flat"]) {
    assert.equal(ask(ccf, q), "orthopnea", q);
  }
});

test("Indian-English and vernacular phrasings reach the right topic", () => {
  assert.equal(ask("congestive-cardiac-failure", "any swelling of legs"), "swelling");
  assert.equal(ask("congestive-cardiac-failure", "swollen ankles?"), "swelling");
  assert.equal(ask("congestive-cardiac-failure", "how much salt in ur food"), "diet_salt");
  assert.equal(ask("congestive-cardiac-failure", "do u take pain killers"), "nsaid");
  assert.equal(ask("congestive-cardiac-failure", "sugar problem?"), "diabetes");
  assert.equal(ask("congestive-cardiac-failure", "any known bp problem"), "hypertension_history");
  assert.equal(ask("copd", "what fuel do u cook with"), "biomass");
});

test("typos are tolerated when the word opens the same way", () => {
  assert.equal(ask("congestive-cardiac-failure", "breathlessnes on exersion"), "dyspnea_grade");
  // ...but a nonsense word must NOT acquire a letter and become a symptom.
  assert.equal(ask("copd", "scoughs"), null);
  assert.equal(ask("copd", "can you spell your name"), null, "spell is one edit from swell");
});

test("ownership: a question about the family is not a question about the patient's own habit", () => {
  assert.equal(ask("copd", "do u smoke"), "smoking");
  assert.equal(ask("copd", "how many cigarettes per day"), "smoking");
  assert.equal(ask("copd", "does ur father smoke"), "family");
  assert.equal(ask("copd", "anyone in family with asthma"), "family");
});

test("a rare term settles a question that a common one cannot", () => {
  // "coughing up blood" contains cough (three topics) and hemoptysis (one). Without the rarity
  // tiebreak these tied exactly and the matcher refused to answer at all.
  assert.equal(ask("copd", "coughing up blood?"), "haemoptysis");
  // "blood in sputum" fits the sputum topic and the haemoptysis topic equally and genuinely, so
  // the matcher offers both rather than picking one. That is the designed behaviour, not a miss.
  const bs = L.match(caseOf("copd").history, "any blood in sputum");
  assert.ok(bs.key === "haemoptysis" || bs.suggestions.some((x) => x.key === "haemoptysis"), "haemoptysis reachable");
  assert.equal(ask("copd", "any cough"), "cough");
  assert.equal(ask("copd", "do u bring up any phlegm"), "sputum");
});

test("an exact topic name beats a longer cue that merely shares a word with it", () => {
  assert.equal(ask("copd", "do u use inhalers"), "inhalers");
  assert.equal(ask("copd", "how many times admitted last year"), "exacerbations");
});

test("across the other systems", () => {
  assert.equal(ask("chronic-liver-disease", "how much alcohol do u drink"), "alcohol");
  assert.equal(ask("chronic-liver-disease", "yellowing of eyes"), "jaundice");
  assert.equal(ask("stroke", "any slurring of speech"), "speech");
  assert.equal(ask("tuberculosis", "do u sweat at night"), "night_sweats");
  assert.equal(ask("tuberculosis", "anyone at home with tb"), "tb_contact");
});

/* ── the patient still never improvises ──────────────────────────────────────────────────────── */

test("small talk matches nothing, and offers nothing", () => {
  for (const q of ["what is your favourite colour", "do you know how this works",
                   "what is the weather like", "can you spell your name", "how much does it cost",
                   "what is the capital of france", "hello how are you", "xyz abc"]) {
    const r = L.match(caseOf("copd").history, q);
    assert.equal(r.key, null, q);
    assert.equal(r.suggestions.length, 0, q + " must not even be suggested a topic");
  }
});

test("a genuinely ambiguous question is refused, not guessed", () => {
  // Two topics fitting equally well means the student must be asked which, not answered at random.
  const topics = {
    left_leg: { cues: ["left leg swelling", "swelling"] },
    right_leg: { cues: ["right leg swelling", "swelling"] }
  };
  const r = L.match(topics, "any swelling");
  assert.equal(r.key, null);
  assert.ok(r.suggestions.length >= 2, "both candidates are offered instead");
});

test("a near miss produces suggestions so the student is redirected, not stonewalled", () => {
  const r = L.match(caseOf("copd").history, "tell me about the phlegm colour and amount");
  assert.ok(r.key === "sputum" || r.suggestions.some((s) => s.key === "sputum"));
});

/* ── the shape the rest of the app depends on ────────────────────────────────────────────────── */

test("scores are comparable across cases, so one threshold works everywhere", () => {
  assert.ok(L.ANSWER_AT > L.SUGGEST_AT);
  for (const id of Object.keys(CASES)) {
    const r = L.match(caseOf(id).history, "what brings you in today");
    assert.ok(r.score >= 0 && r.score <= 1, id + " score out of range: " + r.score);
  }
});

test("matchAsk keeps its old shape and askTopics carries the new detail", () => {
  const C = caseOf("copd");
  const hit = M.matchAsk(C, "Do you smoke?");
  assert.equal(hit.key, "smoking");
  assert.ok(hit.topic.reply.indexOf("bidis") >= 0, "callers still read topic.reply");
  const full = M.askTopics(C, "Do you smoke?");
  assert.equal(full.key, "smoking");
  assert.equal(full.confident, true);
  assert.ok(Array.isArray(full.suggestions));
  const missed = M.askTopics(C, "what is the weather like");
  assert.equal(missed.key, null);
  assert.deepEqual(missed.suggestions, []);
});

test("without the lexicon the model falls back to the original cue test", () => {
  const C = caseOf("copd");
  const saved = M.matchAsk(C, "Do you smoke?");
  assert.ok(saved);
  M.setLexicon(null);
  try {
    // The legacy matcher only knows literal cues, which is exactly the old behaviour.
    assert.equal(M.matchAsk(C, "Do you smoke?").key, "smoking");
    assert.equal(M.matchAsk(C, "kya takleef hai"), null, "legacy cannot do lay phrasing");
  } finally {
    M.setLexicon(L);
  }
  assert.equal(M.matchAsk(C, "kya takleef hai") !== null, true, "restored");
});

test("canon is deterministic and strips the question scaffolding", () => {
  assert.deepEqual(L.canon("Do you have ANY swelling, sir?").tokens, L.canon("swelling").tokens);
  assert.deepEqual(L.canon("").tokens, []);
  const a = L.canon("short of breath on exertion").tokens.join(",");
  const b = L.canon("sob on exertion").tokens.join(",");
  assert.equal(a, b);
});

test("every shipped case is matchable: its own key questions reach their own topics", () => {
  // The real regression guard. For each case, ask each KEY topic using the topic's own first cue
  // phrased as a student would, and require it to land on that topic.
  const failures = [];
  for (const id of Object.keys(CASES)) {
    const hist = caseOf(id).history || {};
    for (const key of Object.keys(hist)) {
      if (!hist[key].key) continue;                       // only the topics the case calls essential
      const cue = (hist[key].cues || [])[0];
      if (!cue) continue;
      // The cue verbatim. Sibling topics can legitimately tie (alcohol vs alcohol_quantify), so a
      // suggestion counts: the student is still routed to the right place, just asked to confirm.
      const r = L.match(hist, cue);
      const ok = r.key === key || r.suggestions.some((x) => x.key === key);
      if (!ok) failures.push(`${id}/${key}: "${cue}" -> ${r.key} [${r.suggestions.map((x) => x.key).join(",")}]`);
    }
  }
  assert.deepEqual(failures, [], "key topics unreachable by their own cue");
});
