/* PrepNucleus offline teacher (prep-teacher.js, LayerC Phase 6): "Why is B wrong?" on the phone's own model.
 * What must hold: the grounding is the item's own stem, options, key, exp, kp, per-option reasons r and source sentences
 * (stem, options and key always; the rest within the cap); the number check is gate 9b's (functions/_prep-core.js) to the
 * digit; every drug the answer names must be in the grounding (drug lexicon + suffix rule; capitalised terms without a
 * lexicon); a failed check, "not covered", an empty answer or a model error shows the stored explanation with a note;
 * nothing is called without grounding; and NO server is ever called: the only call is SMD_MAIK_LOCAL.answer with no
 * Knowledge Base retrieval, and on the web (or with no model downloaded) the screen says so and calls nothing.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-teacher.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as CORE from "../functions/_prep-core.js";

const req = createRequire(import.meta.url);
const T = req("../prep-teacher.js");
const LEX = req("../drug-lexicon.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "prep-teacher.js"), "utf8");

/* ---------------- fixtures ---------------- */
const MEDMCQA = {
  id: "m1", q: "A 30-year-old man on long-term therapy develops gingival hyperplasia. Which drug is responsible?",
  o: ["Phenytoin", "Valproate", "Lamotrigine", "Levetiracetam"], a: 0,
  exp: "Phenytoin causes gingival hyperplasia in about 50% of patients on long-term therapy."
};
const LAYER_C = {
  id: "q_c1", q: "Serum ferritin below which value confirms depleted iron stores?", o: ["15 ng/mL", "50 ng/mL", "100 ng/mL", "300 ng/mL"], a: 0,
  exp: "Serum ferritin below 15 ng/mL confirms depleted iron stores.", kp: "Ferritin under 15 ng/mL: iron stores are empty.",
  r: ["Serum ferritin below 15 ng/mL confirms depleted iron stores.", "50 ng/mL can still be seen with low stores when inflammation raises ferritin.",
    "100 ng/mL is used as a cut-off in chronic kidney disease, not for confirming depletion.", "300 ng/mL suggests iron overload or inflammation."],
  src: { sn: [3], h: "Iron deficiency anaemia" }, deckId: "d1", _s: "deck", _m: "deck-d1"
};
const SENTS = [{ n: 3, tx: "Serum ferritin below 15 ng/mL confirms depleted iron stores." }];

/* ---------------- grounding and prompt ---------------- */
test("grounding: stem, options, key, the chosen option's reason first, exp, kp, other reasons, source sentences", () => {
  const g = T.groundingText(LAYER_C, 1, SENTS);
  const lines = g.split("\n");
  assert.equal(lines[0], "Question: " + LAYER_C.q);
  assert.deepEqual(lines.slice(1, 5), ["A. 15 ng/mL", "B. 50 ng/mL", "C. 100 ng/mL", "D. 300 ng/mL"]);
  assert.equal(lines[5], "Correct answer: A. 15 ng/mL");
  assert.equal(lines[6], "Why B is wrong: " + LAYER_C.r[1]);
  assert.equal(lines[7], "Explanation: " + LAYER_C.exp);
  assert.ok(!g.includes("Why A is right"), "r[a] equal to exp is not repeated");
  assert.ok(g.includes("Exam pearl: " + LAYER_C.kp));
  assert.ok(g.includes("About C: ") && g.includes("About D: "));
  assert.ok(g.includes("Source: " + SENTS[0].tx));
  // MedMCQA item: no r, no kp, no sources.
  const m = T.groundingText(MEDMCQA, 1, []);
  assert.ok(m.includes("Explanation: " + MEDMCQA.exp) && !m.includes("Why") && !m.includes("Exam pearl"));
});

test("grounding cap: stem, options and key always go in; extras stop at the cap", () => {
  const long = Object.assign({}, LAYER_C, { exp: "x ".repeat(2000), kp: "y ".repeat(2000), r: ["r ".repeat(900), "s ".repeat(900), "t ".repeat(900), "u ".repeat(900)] });
  const g = T.groundingText(long, 1, Array.from({ length: 20 }, (_, i) => "Sentence " + i + " " + "z ".repeat(400)));
  assert.ok(g.length <= T.LIM.total + 200, "capped (" + g.length + ")");
  assert.ok(g.startsWith("Question: ") && g.includes("D. 300 ng/mL") && g.includes("Correct answer: A."));
});

test("prompt: wrong answer asks why it is wrong; right or none asks why the key is right", () => {
  const g = T.groundingText(MEDMCQA, 1, []);
  assert.match(T.promptFor(MEDMCQA, 1, g), /^GROUNDING:\n[\s\S]+\n\nTASK: The student chose B\. Explain why B is wrong and why A is the correct answer, using only the grounding\.$/);
  assert.match(T.promptFor(MEDMCQA, 0, g), /TASK: Explain why A is the correct answer and why the other options are not/);
  assert.match(T.promptFor(MEDMCQA, -1, g), /TASK: Explain why A is the correct answer/);
  assert.match(T.SYSTEM, /ONLY the facts in the GROUNDING/);
});

test("teachable: needs exp, kp, a reason or a source sentence beyond the stem and options", () => {
  assert.equal(T.teachable(MEDMCQA, []), true);
  assert.equal(T.teachable({ q: "Q", o: ["a", "b", "c", "d"], a: 1 }, []), false);
  assert.equal(T.teachable({ q: "Q", o: ["a", "b", "c", "d"], a: 1 }, SENTS), true);
  assert.equal(T.teachable({ q: "Q", o: ["a", "b", "c", "d"], a: 1, kp: "pearl" }, []), true);
  assert.equal(T.teachable({ q: "Q", o: ["a"], exp: "e" }, []), false, "no key");
});

/* ---------------- the check ---------------- */
test("numbers: the same canonical digits and the same misses as gate 9b (functions/_prep-core.js)", () => {
  const samples = ["12,400 cells", "0.50 mg", "1,00,000 copies", "007 and 7.0", "about 50% of 30-year-olds", "B12 and 2.5 g/dL", "none"];
  for (const s of samples) assert.deepEqual(T.numbersIn(s), CORE.numbersIn(s), s);
  const pairs = [["Give 20 mg twice", "dose is 20 mg"], ["three weeks, 3 times, 4 days", "three weeks"], ["0.5 or 0.50", "half a tablet"], ["15 and 16", "15"]];
  for (const [t, src] of pairs) assert.deepEqual(T.missingNumbers(t, src), [...new Set(CORE.missingNumbers(t, src))], t);
});

test("check: a grounded answer passes; an added number or drug fails", () => {
  const g = T.groundingText(MEDMCQA, 1, []);
  assert.deepEqual(T.check("B is wrong: valproate is not the cause. Phenytoin causes gingival hyperplasia in about 50% of patients on long-term therapy.", g, LEX),
    { ok: true, numbers: [], drugs: [], terms: [] });
  const bad = T.check("Valproate causes tremor at 20 mg/kg, and amlodipine can also cause gum overgrowth.", g, LEX);
  assert.equal(bad.ok, false); assert.deepEqual(bad.numbers, ["20"]); assert.deepEqual(bad.drugs, ["amlodipine"]);
  // A suffix-rule drug outside the lexicon is caught too ("zorbimycin" is no real drug).
  assert.deepEqual(T.check("Zorbimycin would be wrong here.", g, LEX).drugs, ["zorbimycin"]);
  // A brand the grounding names by its generic is the same drug (lexicon brand map: eptoin -> phenytoin, when present).
  const brand = Object.keys(LEX.brands).find((b) => LEX.brands[b] === "phenytoin");
  if (brand) assert.equal(T.check("A is right: " + brand + " causes it.", g, LEX).ok, true, brand);
  // "1." list markers are layout, not figures; number words in the grounding back digits.
  assert.equal(T.check("1. Phenytoin is the answer.\n2. Valproate is not.", g, LEX).ok, true);
  assert.equal(T.check("It takes 3 weeks.", "It takes three weeks.", LEX).ok, true);
});

test("check without a lexicon: suffix-rule drugs and capitalised terms inside a sentence must be in the grounding", () => {
  const g = T.groundingText(MEDMCQA, 1, []);
  assert.equal(T.check("B is wrong. Phenytoin is the answer, not Valproate.", g, null).ok, true);
  const r = T.check("B is wrong because Valproate is linked to Kawasaki disease and fluconazole.", g, null);
  assert.equal(r.ok, false); assert.deepEqual(r.terms, ["kawasaki"]); assert.deepEqual(r.drugs, ["fluconazole"]);
  assert.deepEqual(T.capsTerms("Option B is wrong. Phenytoin is right.\nNifedipine too, unlike Option C."), [], "sentence and line starts, Option");
});

test("cleanAnswer drops markdown bold and headings", () => {
  assert.equal(T.cleanAnswer("## Why\n**Phenytoin** is right.\n\n\n\nDone."), "Why\nPhenytoin is right.\n\nDone.");
});

/* ---------------- teach() with a mocked model ---------------- */
function model(reply) {
  const calls = [];
  const generate = (prompt, system) => { calls.push({ prompt, system }); return typeof reply === "function" ? reply(prompt) : Promise.resolve(reply); };
  return { calls, generate };
}

test("teach: a checked answer is returned, with the prompt and system the model saw", async () => {
  const m = model({ text: "**B** is wrong: valproate is not the cause. Phenytoin causes gingival hyperplasia in about 50% of patients.", model: "MAiK Lite" });
  const r = await T.teach(MEDMCQA, 1, { generate: m.generate, lexicon: LEX });
  assert.equal(r.ok, true); assert.equal(r.model, "MAiK Lite");
  assert.equal(r.text, "B is wrong: valproate is not the cause. Phenytoin causes gingival hyperplasia in about 50% of patients.");
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0].system, T.SYSTEM);
  assert.ok(m.calls[0].prompt.includes("Explanation: " + MEDMCQA.exp) && m.calls[0].prompt.includes("The student chose B"));
});

test("teach: a failed check shows the stored explanation with a note, never the model's text", async () => {
  const m = model({ text: "Valproate is wrong because it needs 20 mg/kg and amlodipine is better." });
  const r = await T.teach(LAYER_C, 1, { generate: m.generate, lexicon: LEX, sents: SENTS });
  assert.equal(r.ok, false); assert.equal(r.reason, "check"); assert.equal(r.note, T.NOTES.check);
  assert.deepEqual(r.check.numbers, ["20"]); assert.deepEqual(r.check.drugs, ["valproate", "amlodipine"], "neither drug is in this item");
  assert.deepEqual(r.fallback, { key: "A. 15 ng/mL", exp: LAYER_C.exp, kp: LAYER_C.kp, why: LAYER_C.r[1], chosen: "B" });
  assert.ok(!JSON.stringify(r).includes("amlodipine is better"));
});

test("teach: not covered, empty, model error and a rejected call all fall back; no grounding calls nothing", async () => {
  for (const [reply, reason] of [
    [{ text: "The stored explanation does not cover this." }, "not-covered"],
    [{ text: "   " }, "empty"], ["", "empty"],
    [{ error: "not-enough-memory:300MB free, 2.1GB needed" }, "model-error"],
    [() => Promise.reject(new Error("boom")), "model-error"],
    [() => { throw new Error("sync boom"); }, "model-error"]
  ]) {
    const r = await T.teach(MEDMCQA, 2, { generate: model(reply).generate, lexicon: LEX });
    assert.equal(r.ok, false, reason); assert.equal(r.reason, reason); assert.equal(r.fallback.exp, MEDMCQA.exp);
  }
  const m = model({ text: "anything" });
  const r = await T.teach({ q: "Q", o: ["a", "b", "c", "d"], a: 1 }, 0, { generate: m.generate });
  assert.equal(r.reason, "no-grounding"); assert.equal(m.calls.length, 0, "no grounding, no model call");
  assert.equal((await T.teach(MEDMCQA, 1, {})).reason, "no-model");
});

/* ---------------- never a server ---------------- */
test("source: no network or server AI path in prep-teacher.js", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\/api\//, /SMD_AI\b/, /explainGrounded/, /https?:/, /importScripts/])
    assert.doesNotMatch(code, bad, String(bad));
  assert.match(code, /local\(\)\.answer\(\{ question: prompt \}, \{ systemOverride: system, _grounding: null, temperature: 0 \}\)/);
});

test("ES5 and house style: no arrow functions, let/const, template literals, classes; no em or en dash", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /=>|\blet\s|\bconst\s|`|\bclass\s/);
  assert.doesNotMatch(SRC, /[\u2013\u2014]/);
});

/* The browser half in a sandbox: window.document present, so the file runs as in the app. fetch, XMLHttpRequest and
   SMD_AI throw and count; the only model is a mocked SMD_MAIK_LOCAL.answer. */
function sandbox(opts) {
  const net = { fetch: 0, xhr: 0, ai: 0 };
  const answers = [];
  const w = {
    document: {}, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), console, Promise, Object, Math, Date, JSON, String, Number, Array, RegExp,
    fetch: () => { net.fetch++; throw new Error("network"); },
    XMLHttpRequest: function () { net.xhr++; throw new Error("network"); },
    SMD_AI: new Proxy({}, { get: () => { net.ai++; return () => { throw new Error("server ai"); }; } }),
    SMD_DRUG_LEXICON: LEX
  };
  w.window = w;
  if (opts.native) w.Capacitor = { isNativePlatform: () => true };
  if (opts.local) w.SMD_MAIK_LOCAL = {
    available: () => true, currentPack: () => "maik-lite",
    answer: (pkg, o) => { answers.push({ pkg, o }); return Promise.resolve(opts.reply); }
  };
  w.SMD_MAIK_MODELS = { PACKS: { "maik-lite": { label: "MAiK Lite" } }, installedCached: () => !!opts.installed, installed: () => Promise.resolve(!!opts.installed), activePack: () => "maik-lite" };
  vm.createContext(w);
  vm.runInContext(SRC, w, { filename: "prep-teacher.js" });
  return { w, net, answers };
}
function host() {
  const h = { stack: [], html: "" };
  const rootEl = { querySelector: (sel) => { const m = /data-pt="(pt\d+)"/.exec(sel); return m && h.html.includes('data-pt="' + m[1] + '"') ? { textContent: "" } : null; } };
  Object.assign(h, {
    push: (v) => { h.stack.push(v); v(); }, paint: (html) => { h.html = html; }, root: () => rootEl,
    bar: (t, sub) => "<header>" + t + "|" + sub + "</header>",
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  });
  return h;
}
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error("timed out"); }

test("app: web (no native runtime): says so, offers nothing else, calls nothing", async () => {
  const s = sandbox({ native: false, local: true, installed: true, reply: { text: "x" } });
  assert.equal(await s.w.PREP_TEACHER.available(), false);
  assert.equal(s.w.PREP_TEACHER.ready(), false);
  const h = host();
  s.w.PREP_TEACHER.explain(MEDMCQA, 1, h);
  await until(() => h.html.includes("needs MaiK on this phone"));
  assert.match(h.html, /Why is B wrong\?\|MaiK offline teacher/);
  assert.match(h.html, /Nothing is sent to a server/);
  assert.ok(!h.html.includes(MEDMCQA.exp), "offers nothing else");
  assert.deepEqual(s.net, { fetch: 0, xhr: 0, ai: 0 }); assert.equal(s.answers.length, 0);
});

test("app: native but the pack is not downloaded: same message, no model call", async () => {
  const s = sandbox({ native: true, local: true, installed: false, reply: { text: "x" } });
  assert.equal(await s.w.PREP_TEACHER.available(), false);
  const h = host();
  s.w.PREP_TEACHER.explain(MEDMCQA, 1, h);
  await until(() => h.html.includes("needs MaiK on this phone"));
  assert.equal(s.answers.length, 0); assert.deepEqual(s.net, { fetch: 0, xhr: 0, ai: 0 });
});

test("app: native with MaiK Lite: one local call, no retrieval, the checked answer on screen, zero network", async () => {
  const reply = { text: "B is wrong: valproate is not the cause. Phenytoin causes gingival hyperplasia in about 50% of patients.", model: "MAiK Lite" };
  const s = sandbox({ native: true, local: true, installed: true, reply });
  assert.equal(await s.w.PREP_TEACHER.available(), true); assert.equal(s.w.PREP_TEACHER.ready(), true);
  const h = host();
  s.w.PREP_TEACHER.explain(MEDMCQA, 1, h);
  await until(() => h.html.includes("MaiK explains"));
  assert.ok(h.html.includes("B is wrong: valproate is not the cause."));
  assert.match(h.html, /Written on this phone by MAiK Lite/);
  assert.equal(s.answers.length, 1);
  const call = s.answers[0];
  assert.equal(call.o._grounding, null, "no Knowledge Base retrieval: the item is the grounding");
  assert.equal(call.o.systemOverride, T.SYSTEM); assert.equal(call.o.temperature, 0);
  assert.ok(call.pkg.question.startsWith("GROUNDING:\nQuestion: "));
  assert.deepEqual(s.net, { fetch: 0, xhr: 0, ai: 0 });
});

test("app: an unchecked answer is never painted; the stored explanation shows with the note", async () => {
  const s = sandbox({ native: true, local: true, installed: true, reply: { text: "Valproate needs 20 mg/kg; amlodipine is the real cause." } });
  const h = host();
  const seen = [];
  const paint = h.paint; h.paint = (html) => { seen.push(html); paint(html); };
  s.w.PREP_TEACHER.explain(MEDMCQA, 1, h);
  await until(() => h.html.includes("not in this question"));
  assert.ok(h.html.includes(MEDMCQA.exp));
  assert.ok(seen.every((x) => !x.includes("amlodipine is the real cause")), "never on screen, not even mid-way");
  assert.deepEqual(s.net, { fetch: 0, xhr: 0, ai: 0 });
});
