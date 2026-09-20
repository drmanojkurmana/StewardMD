/* test/maik-thread-continuity.test.mjs — "is this a new question or a connected one?"
 *
 * Owner, 2026-09-20, with four exported conversations: "context and continuity along the models are
 * not working as it works in chatgpt ... it doesnt even understand when is user asking a individual
 * question or connected question." The transcripts, pinned here one by one:
 *
 *   conv 6  "Hematuria Workup" then "Afib Ecg"        -> answered as hematuria + AF anticoagulation
 *   conv 4  DKA potassium thread, then "WHAT IS SLE EXPLAIN ME LIKE IM DUMB" -> answered about DKA potassium
 *   conv 4  "Thank you maik" (on-device)              -> another paragraph about potassium
 *   conv 5  "Iris in aids", Regenerate                -> own bubble became "IRIS: Iris in aids", then "IRIS: IRIS: ..."
 *   conv 5  "IRIS IN HIV" (on-device)                 -> first-line ART regimen, IRIS never mentioned
 *   conv 5  Scrub typhus asked twice                  -> second answer one " | "-separated line
 *   conv 5  "...Intralesional vinblasVerify against local protocol." -> budget cut mid-word
 *   conv 7  two orphan "I couldn't map that to any findings" MaiK turns with no question
 *   all     lists and citation marks glued in the PDF ("PaclitaxelPomalidomide", "3Fluids")
 *
 * The root cause of the first two was home.js gluing the live topic onto ANY short clinical message
 * unless the KB resolver was CONFIDENT it named a disease; acronyms and non-disease topics never clear
 * that bar. The new rule: a message continues the thread only when it brings no subject the thread has
 * not already mentioned (maikNovelTokens).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const SERVER = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const grab = (re, label) => { const m = HOME.match(re); assert.ok(m, "could not extract " + label + " from home.js"); return m[0]; };

// ── the classifier, extracted and run for real ──────────────────────────────────────────────────
const norm = grab(/function maikNorm\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikNorm");
const deslangVar = grab(/var _MAIK_DESLANG = \{[^}]*\};/, "_MAIK_DESLANG");
const deslangFn = grab(/function maikDeslang\(s\)\s*\{[\s\S]*?\n {4}\}/, "maikDeslang");
const generic = grab(/var GENERIC_FU = \/\^\([^\n]*\$\/;/, "GENERIC_FU");
const filler = grab(/var MAIK_FU_FILLER = \/\^\([^\n]*\$\/;/, "MAIK_FU_FILLER");
const acro = grab(/var MAIK_ACRO_OK = \/\^\([^\n]*\$\/;/, "MAIK_ACRO_OK");
const bag = grab(/function maikThreadBag\(\)\s*\{[\s\S]*?\n {4}\}/, "maikThreadBag");
const novel = grab(/function maikNovelTokens\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikNovelTokens");
const mk = new Function(`
  var _maikTopic = null, _maikTurns = [];
  ${norm}\n${deslangVar}\n${deslangFn}\n${generic}\n${filler}\n${acro}\n${bag}\n${novel}
  return { novel: maikNovelTokens, set: function (topic, turns) { _maikTopic = topic; _maikTurns = turns || []; } };
`)();
const thread = (topic, q, a) => mk.set({ topic: topic, question: q, ts: Date.now() }, [{ q: q, a: a }]);
const isFollowUp = (q) => mk.novel(q).length === 0;

const HEMATURIA_A = "You're asking about the clinical workup for hematuria. Confirm with microscopic urinalysis, differentiate glomerular from non-glomerular, rule out infection, CT urogram and cystoscopy for high-risk patients.";
const DKA_A = "In a DKA patient with potassium <4.5 meq/L, we should replace potassium via infusion because total-body stores are depleted. Assess serum potassium immediately; initiate intravenous potassium replacement while continuing insulin infusion to prevent hypokalemia.";
const IRIS_A = "IRIS is immune reconstitution inflammatory syndrome, a paradoxical worsening after starting antiretroviral therapy.";

test("conv 6: 'Afib Ecg' after a hematuria answer is a NEW question", () => {
  thread("Hematuria Workup", "Hematuria Workup", HEMATURIA_A);
  assert.deepEqual(mk.novel("Afib Ecg"), ["afib"]);   // ECG is a test, not a subject; AF is
  assert.equal(isFollowUp("Afib Ecg"), false);
});

test("conv 4: 'WHAT IS SLE EXPLAIN ME LIKE IM DUMB' after DKA is a NEW question (a shouted message still carries its subject)", () => {
  thread("DKA with potassium 4.5 meq", "How to treat DKA with potassium 4.5 meq", DKA_A);
  assert.ok(mk.novel("WHAT IS SLE EXPLAIN ME LIKE IM DUMB").indexOf("sle") >= 0, "SLE is the new subject");
  assert.equal(isFollowUp("WHAT IS SLE EXPLAIN ME LIKE IM DUMB"), false);
});

test("conv 4: 'insulin infusion' right after an answer that discussed insulin infusion CONTINUES the thread", () => {
  thread("DKA with potassium 4.5 meq", "How to treat DKA with potassium 4.5 meq", DKA_A);
  assert.equal(isFollowUp("insulin infusion"), true);
});

test("conv 5: 'How to treat Scrub Typhus?' after IRIS is a NEW question", () => {
  thread("IRIS", "What IS IRIS?", IRIS_A);
  assert.equal(isFollowUp("How to treat Scrub Typhus?"), false);
});

test("the owner's 2026-09-19 continuity cases still continue", () => {
  thread("Hematuria Workup", "Hematuria Workup", HEMATURIA_A);
  for (const q of ["Just tell me which investigations should I send? In one line", "How to diagnose it", "and the dose?",
                   "give in detail", "what about in pregnancy", "wat iz da treatment doze?", "TELL ME DOSES", "cystoscopy timing"]) {
    assert.equal(isFollowUp(q), true, "expected a follow-up: " + q);
  }
});

test("a bare acronym in a normally-cased message is a subject; notation is not", () => {
  thread("DKA", "How to treat DKA", DKA_A);
  assert.equal(isFollowUp("MI"), false, "MI is a new subject");
  assert.equal(isFollowUp("what about SLE"), false);
  assert.equal(isFollowUp("IV or PO?"), true, "IV/PO are notation, not topics");
  assert.equal(isFollowUp("IV potassium?"), true, "notation plus a word the answer used");
  assert.equal(isFollowUp("ok"), true);
});

test("prefix matching lets inflections through without a stemmer", () => {
  thread("Atrial fibrillation", "AF anticoagulation", "Anticoagulant choice depends on the CHA2DS2-VASc score; a DOAC such as apixaban is preferred.");
  assert.equal(isFollowUp("which anticoagulants are safest in renal impairment"), true);
  assert.equal(isFollowUp("apixaban dose"), true);
});

// ── how home.js applies it ────────────────────────────────────────────────────────────────────
test("the continuity block glues the topic on ONLY when the message brings no new subject", () => {
  const i = HOME.indexOf("if (!_own && _fwc <= 14 && !maikNovelTokens(q).length) {");
  assert.ok(i > 0, "the novelty check gates the topic prefix");
  assert.ok(HOME.slice(i, i + 200).indexOf("_maikFollowUp = true;") > 0, "a glued message is recorded as a follow-up");
  assert.doesNotMatch(HOME, /if \(!_own && _fwc <= 14\) \{/, "the old confident-only rule is gone");
});

test("mid-thread, a bare acronym or unresolved new word is asked FRESH instead of being glued to the topic", () => {
  const i = HOME.indexOf('if (/^[A-Z][A-Z0-9]{1,5}\\??$/.test(q.trim()) || maikNovelTokens(q).length) {');
  assert.ok(i > 0, "the clarify branch checks for a new subject first");
  assert.match(HOME.slice(i, i + 200), /runClinical\(q, q, "concise", active, maikCanonTopic\(q\)\)/);
});

test("the server is told when the clinician moved to a new topic, and its prompt says so", () => {
  assert.match(HOME, /if \(pkg && pkg\.history && pkg\.history\.length && !_maikFollowUp\) pkg\.newTopic = true;/);
  assert.match(SERVER, /pkg\.newTopic\s*\n\s*\? "=== RECENT CONVERSATION \(background only: the clinician has moved to a NEW question/);
});

test("conv 5: Regenerate re-runs the resolved call and Edit restores the TYPED text (no 'IRIS: IRIS: ...' stacking)", () => {
  const fb = HOME.match(/function _answerFeedback\(host, meta\) \{[\s\S]*?var up = mk\("Yes", "up"\)/);
  assert.ok(fb, "feedback row found");
  assert.match(fb[0], /act\("Regenerate"[\s\S]*?runClinical\(question, retrieval, depth, active, topicLabel\)/);
  assert.doesNotMatch(fb[0], /act\("Regenerate"[\s\S]*?send\(\);[\s\S]*?act\("Edit"/, "Regenerate never goes back through send()");
  assert.match(fb[0], /act\("Edit", function \(\) \{ try \{ qEl\.value = userQ;/);
  assert.match(HOME, /_maikUserQ = q; _maikFollowUp = false;/, "send() records the typed text");
});

test("conv 7: the extract button's failure is a toast, never a MaiK turn", () => {
  const i = HOME.indexOf("SMD_AI.extract(q, \"reasoning\", catalog)");
  assert.ok(i > 0);
  const block = HOME.slice(i, i + 900);
  assert.match(block, /if \(!keys\.length\) \{ toast\(/);
  assert.doesNotMatch(block, /if \(!keys\.length\) \{ bubble\(/);
});

test("export text is block-aware: list items, headings and citation marks no longer glue together", () => {
  assert.match(HOME, /function maikBubbleText\(el\)/);
  assert.match(HOME, /var t = maikBubbleText\(el\);/, "maikTranscript uses it");
  assert.match(HOME, /b\.tagName === "LI" \? "\\n- " : "\\n"/);
  assert.match(HOME, /querySelectorAll\("sup"\)/);
});

// ── routing: thanks and the name, on every engine ─────────────────────────────────────────────
const lev = grab(/function maikLev\([\s\S]*?\n {4}\}/, "maikLev");
const cas = grab(/var MAIK_CASUAL = \[[^\]]*\];/, "MAIK_CASUAL");
const route = grab(/function maikRoute\(q, active\)\s*\{[\s\S]*?\n {4}\}/, "maikRoute");
const MaiKScope = require("../kb/ai/maik-scope.js");
let ENGINE = "local";
const maikRoute = new Function("window", `${norm}\n${lev}\n${cas}\nfunction isPatientSpecific(){return false;}\n${route}\nreturn maikRoute;`)(
  { MaiKScope, SMD_MAIK_ENGINE: { effective: () => ENGINE } });

test("conv 4: 'Thank you maik' is answered as thanks on the ON-DEVICE engine too", () => {
  ENGINE = "local";
  const r = maikRoute("Thank you maik", false);
  assert.equal(r.kind, "casual");
  assert.equal(r.reply, "Anytime.");
  ENGINE = "cloud";
  assert.equal(maikRoute("thanks!", false).kind, "casual");
});

test("a thanks that carries a question keeps its question", () => {
  ENGINE = "cloud";
  assert.notEqual(maikRoute("ok tell me the dose", false).kind, "casual");
  assert.notEqual(maikRoute("thanks, and the paediatric dose?", false).kind, "casual");
});

test("conv 5: 'Why is your name MAIK?' gets the actual answer", () => {
  const r = maikRoute("Why is your name MAIK?", false);
  assert.equal(r.kind, "casual");
  assert.match(r.reply, /Medical AI Knowledge/);
});

// ── the on-device engine ─────────────────────────────────────────────────────────────────────
function loadLocal() {
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: "ok", ms: 5 }), cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(null) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", LOCAL)(win, win.localStorage);
  return win.SMD_MAIK_LOCAL;
}
const L = loadLocal();

test("conv 5: the regimen rule is applied to TREATMENT questions only", () => {
  assert.match(L.systemFor("How to treat Scrub Typhus?"), /first-line regimen/);
  assert.doesNotMatch(L.systemFor("IRIS IN HIV"), /first-line regimen/);
  assert.match(L.systemFor("IRIS IN HIV"), /Answer the question that was asked/);
  assert.match(L.systemFor("What is IRIS?"), /Verify against local protocol/);
  assert.match(LOCAL, /\(pk\.system \|\| systemFor\(pkg && pkg\.question\)\)/, "answer() uses it");
});

test("conv 5: history is carried with '; ', not ' | ', so the model does not copy pipes into its answer", () => {
  const c = L.carry("Doxycycline 100 mg twice daily is first line.\n- Azithromycin 500 mg daily\nVerify against local protocol.");
  assert.equal(c, "Doxycycline 100 mg twice daily is first line; Azithromycin 500 mg daily");
  assert.doesNotMatch(c, /\|/);
});

test("conv 5: a budget-cut answer is finished at the last full sentence and flagged", () => {
  const cut = L.finishCut("Kaposi sarcoma in AIDS is treated with antiretroviral therapy first. Liposomal doxorubicin is the preferred systemic agent for advanced disease. Local options include intralesional vinblas");
  assert.equal(cut.truncated, true);
  assert.match(cut.text, /advanced disease\.$/);
  const ok = L.finishCut("Doxycycline 100 mg twice daily for 7 days.\n- Photosensitivity\n- GI upset");
  assert.equal(ok.truncated, false, "a list item at the end is a legitimate ending");
  assert.equal(ok.text.endsWith("GI upset"), true);
  assert.equal(L.finishCut("Yes.").truncated, false);
  assert.match(LOCAL, /var cut = finishCut\(text\); text = cut\.text;/, "answer() applies it before the grounding gate");
});

// ── conv "maik-conversation 4" (owner, 2026-09-21 02:51) ─────────────────────────────────────────
const MYO_A = "Myocarditis is an inflammatory condition of the heart muscle, often caused by viral infections or autoimmune processes. The pathophysiology involves direct cellular injury from viruses or autoimmune responses.";
test("conv 4b: 'Is MRI used to diagnose?' after Myocarditis is a FOLLOW-UP (a modality is not a subject)", () => {
  thread("Myocarditis", "Myocarditis", MYO_A);
  assert.deepEqual(mk.novel("Is MRI used to diagnose?"), []);
  assert.deepEqual(mk.novel("Is MRI used to diagnose it?"), []);
  assert.deepEqual(mk.novel("what about troponin"), ["troponin"], "a specific test the thread never named still reads as new; acceptable");
});
test("conv 4b: the misspelt essay request continues the topic (it went to malaria)", () => {
  thread("Myocarditis", "Myocarditis", MYO_A);
  assert.deepEqual(mk.novel("Give me detailed answer Pathophsyooly pathogensis climical features diagnosis treatment full essay"), []);
});
test("typo tolerance never swallows a real new subject", () => {
  thread("Myocarditis", "Myocarditis", MYO_A);
  for (const q of ["How to treat Covid 19 tell me in detail", "dengue management in detail", "explain more about meningitis", "hepatitis b essay", "psoriasis in detail", "angina"])
    assert.ok(mk.novel(q).length > 0, "expected a new subject in: " + q);
});
test("the detail branch of the resolver defers to the same novelty test", () => {
  const i = HOME.indexOf("var DETAIL_RE = ");
  assert.ok(i > 0);
  assert.match(HOME.slice(i, i + 1600), /if \(maikNovelTokens\(q\)\.length\) return null;/);
});
