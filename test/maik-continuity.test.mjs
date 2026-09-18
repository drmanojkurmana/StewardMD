/* test/maik-continuity.test.mjs — on-device conversation continuity (owner, 2026-09-18).
 * The three live failures, pinned: "FUO" -> "tell me the exact definition" must carry the FUO turn;
 * "treatment of hypertension" -> "tell me doses" must carry the DRUG NAMES and retrieve on hypertension;
 * "UTI treatment" -> "wrong, it's nitrofurantoin" must carry the UTI turn. And the old topic-bleed
 * regression stays fixed: "Polycystic Kidney Disease" after a fever answer starts fresh. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

function load({ reply = "ok", searched = [] } = {}) {
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: reply, ms: 5 }), cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const passage = { heading: "Hypertension > Treatment", page: "p.1", text: "Amlodipine 5 to 10 mg once daily; losartan 50 to 100 mg once daily; hydrochlorothiazide 12.5 to 25 mg daily.", chunk: 1 };
  const book = { search: (q) => { searched.push(q); return [[12.5, 0]]; }, cite: () => passage, idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return win.SMD_MAIK_LOCAL;
}
const L = load();
const HTN = [{ role: "user", text: "Treatment of hypertension?" },
  { role: "assistant", text: "First-line therapy is a thiazide, an ACE inhibitor or ARB, or a calcium channel blocker.\n- Amlodipine\n- Losartan\n- Hydrochlorothiazide\nVerify against local protocol.\n\nSource: StewardMD Knowledge Base - based on standard medical resources." }];
const FUO = [{ role: "user", text: "FUO" }, { role: "assistant", text: "FUO is fever of unknown origin: a prolonged fever without a diagnosis after initial evaluation." }];
const UTI = [{ role: "user", text: "Treatment of UTI?" }, { role: "assistant", text: "Uncomplicated cystitis is treated with TMP-SMX 160/800 mg twice daily for 3 days." }];
const FEVER = [{ role: "user", text: "Treatment of Fever" }, { role: "assistant", text: "Acetaminophen 650 mg every 6 hours as needed." }];

test("'tell me the exact definition' after FUO carries the FUO turn", () => {
  assert.equal(L.continues("Tell me the exact definition", FUO), true);
  assert.match(L.buildPrompt({ question: "Tell me the exact definition", history: FUO }), /Recent conversation:[\s\S]*fever of unknown origin/);
});

test("'tell me doses' after hypertension carries the DRUG NAMES (bullets survive the cap) and retrieves on hypertension", () => {
  const p = L.buildPrompt({ question: "tell me doses", history: HTN });
  assert.match(p, /Amlodipine \| Losartan \| Hydrochlorothiazide/);
  assert.doesNotMatch(p, /Source: StewardMD|Verify against local protocol/, "footer lines are not carried");
  assert.match(L.ragQuestion({ question: "tell me doses", history: HTN }), /^Treatment of hypertension\? tell me doses$/);
});

test("a correction that names a different drug still continues the conversation", () => {
  assert.equal(L.continues("Wrong, it's nitrofurantoin", UTI), true);
  assert.equal(L.continues("No, nitrofurantoin is the drug of choice", UTI), true);
  assert.match(L.buildPrompt({ question: "Wrong, it's nitrofurantoin", history: UTI }), /TMP-SMX/);
});

test("same subject named again continues; a NEW subject starts fresh (the fever -> PKD bleed stays fixed)", () => {
  assert.equal(L.continues("Side effects of acetaminophen", FEVER), true);
  assert.equal(L.continues("Polycystic Kidney Disease", FEVER), false);
  assert.equal(L.continues("empiric antibiotic for meningitis", FEVER), false);
  assert.doesNotMatch(L.buildPrompt({ question: "Polycystic Kidney Disease", history: FEVER }), /fever|Acetaminophen/i);
  assert.equal(L.ragQuestion({ question: "Polycystic Kidney Disease", history: FEVER }), "Polycystic Kidney Disease");
  assert.equal(L.continues("Treatment of hypertension?", []), false, "no history, nothing to continue");
});

test("PRODUCTION SHAPE: home.js sends {q, a} turns (_maikTurns); they are read, not rendered as empty 'Doctor:' lines", () => {
  const turns = [{ q: "Treatment of hypertension?", a: "First-line: a thiazide, ACE inhibitor/ARB or calcium channel blocker. - Amlodipine - Losartan - Hydrochlorothiazide Verify against local protocol." }];
  assert.equal(L.continues("tell me doses", turns), true);
  const p = L.buildPrompt({ question: "tell me doses", history: turns });
  assert.match(p, /Doctor: Treatment of hypertension\?/);
  assert.match(p, /MaiK: .*Amlodipine.*Losartan/);
  assert.doesNotMatch(p, /Doctor: \n|Doctor: $/m, "no empty speaker lines");
  assert.match(L.ragQuestion({ question: "tell me doses", history: turns }), /^Treatment of hypertension\? tell me doses$/);
});

test("carry(): opening line plus bullets/figures, capped, footer stripped", () => {
  const c = L.carry("Opening sentence. [1]\n- Amlodipine 5 mg [1]\nSome prose without numbers.\n- Losartan 50 mg\nVerify against local protocol.\nSource: StewardMD Knowledge Base - based on standard medical resources.");
  assert.equal(c, "Opening sentence. | Amlodipine 5 mg | Losartan 50 mg");
  assert.ok(L.carry("x\n" + Array.from({ length: 80 }, (_, i) => "- drug" + i + " 10 mg").join("\n")).length <= 701);
});

test("end to end: the follow-up is grounded on the previous topic and its doses are checked", async () => {
  const searched = [];
  const L2 = load({ reply: "Amlodipine 5 to 10 mg once daily.\n- Losartan 50 to 100 mg daily.\n- Atenolol 50 mg daily.\nVerify against local protocol.", searched });
  const r = await L2.answer({ question: "tell me doses", history: HTN }, { pack: "maik-lite" }, null);
  assert.match(searched[0], /Treatment of hypertension\?/, "retrieval query carries the previous subject");
  assert.equal(r.grounded, true);
  const plain = r.text.replace(/\*\*/g, "");   // emphasize() bolds drugs and doses for the renderer
  assert.match(plain, /Amlodipine 5 to 10 mg/); assert.match(plain, /Losartan 50 to 100 mg/);
  assert.doesNotMatch(plain, /Atenolol/, "a dose for a drug the passage does not have is left out");
  assert.match(plain, /Left out: 1 statement/);
});
