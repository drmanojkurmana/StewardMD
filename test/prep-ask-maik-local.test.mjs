/* PrepNucleus Ask MaiK on this phone uses the main on-device pipeline (owner 2026-10-11).
 * Regression: on a Mesna MCQ, "How is it given iv or intravesical" repeated the stored acrolein/sulfhydryl
 * explanation instead of answering with the drug monograph (IV dosing). The sheet must use the SAME engine and
 * retrieval as the main MaiK chat (drug index/monographs, KB, protocols) with the MCQ as context, and hand off
 * to MaiK Cloud when the phone cannot answer well instead of repeating the stored text.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-ask-maik-local.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { injectDrugData } from "../scripts/bench-maik-lite-retrieval.mjs";

const req = createRequire(import.meta.url);
const T = req("../prep-teacher.js");
const LEX = req("../drug-lexicon.js");
const SRC_TEACHER = readFileSync(new URL("../prep-teacher.js", import.meta.url), "utf8");
const SRC_LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const RAGm = req("../kb/ai/maik-lite-rag.js");

function bootLocal() {
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama: {} } },
    SMD_MAIK_RAG: Object.assign({}, RAGm, { MIN_SCORE: 0.5 }),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(new RAGm.Book([{ i: 0, headings: ["x"], pages: [1], text: "x" }])) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096 } } },
  };
  injectDrugData(win);
  new Function("window", SRC_LOCAL)(win);
  return win.SMD_MAIK_LOCAL;
}
const L = bootLocal();
const noRouter = (question) => ({ question, topicMatch: { matched: false }, grounding: [] });

/* The owner's case: Mesna MCQ, stored explanation about acrolein/sulfhydryl with no route in it. */
const MESNA_ITEM = {
  id: "mesna-1",
  q: "A patient receiving ifosfamide is given Mesna for uroprotection. What is its mechanism?",
  o: ["Alkylates DNA", "Binds acrolein in urine via sulfhydryl group", "Inhibits xanthine oxidase", "Chelates calcium"],
  a: 1,
  exp: "Mesna provides a sulfhydryl group that binds acrolein, the urotoxic metabolite of ifosfamide, in the urine and detoxifies it.",
};
const MESNA_GROUND = T.groundingText(MESNA_ITEM, 0, []);
const u = (t) => ({ r: "u", t });
const m = (t) => ({ r: "m", t, ok: true });

test("intent: factual drug/disease follow-ups go to retrieval first; templates keep theirs", () => {
  for (const q of [
    "How is it given iv or intravesical",
    "What is the dose of ondansetron?",
    "When is metformin contraindicated?",
    "What are the side effects of amiodarone?",
    "Can I give tramadol with sertraline?",
    "How to treat hyperkalaemia?",
    "How to manage DKA?",
  ]) assert.equal(T.isFactual(q), true, q);
  for (const q of ["Why not B?", "Why is this right?", "Explain simply", "Give a mnemonic", "Tell me about first order kinetics in simple way"])
    assert.equal(T.isFactual(q), false, q);
});

test("Mesna route: drug index returns IV dosing, and the chat answer uses it, not the stored text", async () => {
  const [p] = await L.drugEvidence(noRouter("Mesna: How is it given iv or intravesical"));
  assert.match(p.heading, /^StewardMD Drug Index > Mesna/);
  assert.match(p.text, /IV/);
  assert.match(p.text, /240 mg\/m2.*0, 4 and 8 hours/);
  const STORED = T.expOf(MESNA_ITEM);
  const turns = [u("Why is A wrong?"), m("Mesna binds acrolein."), u("How is it given iv or intravesical")];
  const r = await T.teachChat(MESNA_GROUND, turns, {
    lexicon: LEX, local: true,
    generate: () => ({ text: "Mesna is given IV at 240 mg/m2 at 0, 4 and 8 hours with ifosfamide, for a total of 60% of the ifosfamide dose.", grounded: true, engine: "local" }),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /IV/);
  assert.match(r.text, /240/);
  assert.notEqual(r.text, STORED);
  assert.ok(r.text.indexOf("sulfhydryl group that binds acrolein") < 0, "answers the route, does not repeat the stored explanation");
  assert.equal(r.factual, true);
  assert.equal(r.poor, false);
  assert.equal(r.grounded, true);
});

test("paracetamol child dose comes from the drug index, not the MCQ text", async () => {
  const [p] = await L.drugEvidence(noRouter("paracetamol dose for a 12 kg child with fever"));
  assert.match(p.text, /10-15 mg\/kg\/dose/);
  const item = { id: "p1", q: "Fever in a child.", o: ["Paracetamol", "Ibuprofen", "Aspirin", "None"], a: 0, exp: "Paracetamol is an antipyretic." };
  const r = await T.teachChat(T.groundingText(item, 1, []), [u("Why not B?"), m("Paracetamol is the antipyretic."), u("paracetamol dose for a 12 kg child")], {
    lexicon: LEX, local: true, generate: () => ({ text: "Paracetamol 10-15 mg/kg/dose every 4-6 h, max 75 mg/kg/day.", grounded: true }),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /10-15 mg\/kg/);
  assert.notEqual(r.text, T.expOf(item));
});

test("metformin contraindication leads with the renal text", async () => {
  const [p] = await L.drugEvidence(noRouter("metformin dose in reduced eGFR"));
  assert.match(p.text, /Contraindicated when eGFR is below 30/);
  const item = { id: "m1", q: "Diabetes drug.", o: ["Metformin", "Insulin", "Glibenclamide", "None"], a: 0, exp: "Metformin is first line." };
  const r = await T.teachChat(T.groundingText(item, 2, []), [u("Why not C?"), m("Metformin is first line."), u("When is metformin contraindicated?")], {
    lexicon: LEX, local: true, generate: () => ({ text: "Metformin is contraindicated when eGFR is below 30.", grounded: true }),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /eGFR is below 30/);
});

test("tramadol plus sertraline returns the interaction, not the stored text", async () => {
  const ps = await L.drugEvidence(noRouter("can I give tramadol to a patient on sertraline"));
  assert.match(ps[0].text, /Serotonin syndrome/);
  const item = { id: "t1", q: "Pain relief.", o: ["Tramadol", "Paracetamol", "Ibuprofen", "None"], a: 0, exp: "Tramadol is an analgesic." };
  const r = await T.teachChat(T.groundingText(item, 1, []), [u("Why not B?"), m("Tramadol is the analgesic."), u("can I give tramadol to a patient on sertraline")], {
    lexicon: LEX, local: true, generate: () => ({ text: "Tramadol plus sertraline risks serotonin syndrome with agitation and clonus.", grounded: true }),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /[Ss]erotonin syndrome/);
});

test("disease follow-ups are factual and use retrieval; protocol ids still resolve", async () => {
  assert.equal(T.isFactual("How to treat hyperkalaemia?"), true);
  assert.equal(T.isFactual("How to manage DKA?"), true);
  assert.equal(L.labProtocolId("k 6.8 with peaked T, what now"), "hyperkalaemia");
  const item = { id: "d1", q: "Hyperkalaemia ECG.", o: ["Peaked T", "ST elevation", "U wave", "None"], a: 0, exp: "Peaked T waves occur." };
  const r = await T.teachChat(T.groundingText(item, 1, []), [u("Why not B?"), m("Peaked T is the sign."), u("How to treat hyperkalaemia?")], {
    lexicon: LEX, local: true, generate: () => ({ text: "Give calcium for the membrane, then insulin with glucose and salbutamol to shift potassium.", grounded: true }),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /calcium|insulin/);
  assert.notEqual(r.text, T.expOf(item));
});

test("owner handoff: when the phone cannot answer, it says so kindly and never repeats the stored text", async () => {
  assert.match(T.LOCAL_HANDOFF, /on-phone offline AI and I am less experienced/);
  assert.match(T.LOCAL_HANDOFF, /super-specialist, MaiK Cloud/);
  assert.doesNotMatch(T.LOCAL_HANDOFF, /you (failed|did|asked)|blame|wrong/i);
  assert.match(T.LOCAL_HANDOFF_OFFLINE, /offline now; it will work when you are connected/);
  const turns = [u("How is it given iv or intravesical")];
  assert.equal((await T.teachChat(MESNA_GROUND, turns, { generate: () => "The stored explanation does not cover this." })).reason, "not-covered");
  assert.equal((await T.teachChat(MESNA_GROUND, turns, { generate: () => "  " })).reason, "empty");
  assert.equal(T.poorAnswer("I don't know."), true);
  assert.equal(T.poorAnswer("Mesna is given IV at 240 mg/m2."), false);
});

test("no second engine: the teacher calls the main on-device answer with retrieval on", () => {
  assert.ok(SRC_TEACHER.indexOf("SMD_MAIK_LOCAL.answer") >= 0 || SRC_TEACHER.indexOf("local().answer") >= 0, "reuses SMD_MAIK_LOCAL.answer");
  assert.equal(SRC_TEACHER.indexOf("_grounding: null"), -1, "retrieval is not disabled");
  assert.match(SRC_LOCAL, /intravesical/);
});
