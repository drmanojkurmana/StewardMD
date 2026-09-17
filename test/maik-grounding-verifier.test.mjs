/* test/maik-grounding-verifier.test.mjs — claim-level grounding (kb/ai/maik-grounding.js).
 *
 * Seven categories from the owner's brief (2026-09-18), each claim with a GOLD label, so the
 * verifier's own metrics are measured, not asserted by hand: valid grounded claims accepted,
 * unsupported claims blocked, false-rejection rate, precision/recall of the "supported" label.
 * The same cases feed bench/rag-grounding/run.mjs for the per-model battery. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const G = require("../kb/ai/maik-grounding.js");
const R = require("../kb/ai/maik-lite-rag.js");
const CASES = JSON.parse(readFileSync(new URL("../bench/rag-grounding/cases.json", import.meta.url), "utf8"));

const expand = (q) => R.expand(q)[0];
const ACCEPT = { supported: 1, clinician: 1 };

// ── every gold-labelled claim, one assertion each, plus the aggregate metrics ──
const tally = { tp: 0, fn: 0, fp: 0, tn: 0, byCat: {} };
for (const c of CASES) {
  for (const cl of c.claims) {
    test(`${c.category} · ${c.id}: "${cl.text.slice(0, 60)}" -> ${cl.gold}`, () => {
      const g = G.groundAnswer(cl.text, c.passages, c.question || "", { allowGeneral: false, expand });
      const got = g.claims.length ? g.claims[0].status : "meta";
      const goldOk = !!ACCEPT[cl.gold], gotOk = !!ACCEPT[got];
      const cat = (tally.byCat[c.category] = tally.byCat[c.category] || { tp: 0, fn: 0, fp: 0, tn: 0 });
      if (goldOk && gotOk) { tally.tp++; cat.tp++; } else if (goldOk && !gotOk) { tally.fn++; cat.fn++; }
      else if (!goldOk && gotOk) { tally.fp++; cat.fp++; } else { tally.tn++; cat.tn++; }
      if (cl.gold === "contradicted") assert.equal(got, "contradicted", "a conflicting dose must be CONTRADICTED, never merely unsupported: " + JSON.stringify(g.claims[0]));
      else assert.equal(gotOk, goldOk, `expected ${cl.gold}, got ${got}: ${JSON.stringify(g.claims[0] && g.claims[0].why)}`);
      if (cl.refs) assert.deepEqual(g.claims[0].refs, cl.refs, "provenance points at the passage(s) the claim rests on");
    });
  }
}

test("METRICS: false-rejection <= 5%, unsupported blocked >= 95%, supported-label precision >= 0.95 (printed for the record)", () => {
  const acceptedValid = tally.tp / (tally.tp + tally.fn);
  const blocked = tally.tn / (tally.tn + tally.fp);
  const precision = tally.tp / (tally.tp + tally.fp);
  const recall = acceptedValid;
  const out = { valid_grounded_accepted: +acceptedValid.toFixed(3), false_rejection_rate: +(1 - acceptedValid).toFixed(3),
                unsupported_blocked: +blocked.toFixed(3), grounding_precision: +precision.toFixed(3), grounding_recall: +recall.toFixed(3),
                n: tally.tp + tally.fn + tally.fp + tally.tn, byCategory: tally.byCat };
  console.log("grounding verifier metrics:", JSON.stringify(out));
  assert.ok(1 - acceptedValid <= 0.05, "false rejection " + (1 - acceptedValid));
  assert.ok(blocked >= 0.95, "blocked " + blocked);
  assert.ok(precision >= 0.95, "precision " + precision);
});

// ── whole answers: partial support keeps what is grounded, removes the rest, never the whole answer ──
const P = [{ text: "For uncomplicated community-acquired pneumonia in outpatients, amoxicillin 500 mg orally three times daily for 5 to 7 days is first-line. Doxycycline is an alternative for penicillin allergy.", heading: "Pneumonia > Treatment" }];

test("partially supported answer: supported claims stay with [n], the unsupported one is left out, verdict partial", () => {
  const ans = "Amoxicillin 500 mg PO tid for 5-7 days is first-line.\n- Doxycycline is the choice in penicillin allergy.\n- Add azithromycin 500 mg daily for atypical cover.\nVerify against local protocol.";
  const g = G.groundAnswer(ans, P, "Treatment of CAP?", { expand });
  assert.equal(g.verdict, "partial");
  assert.match(g.text, /Amoxicillin 500 mg PO tid for 5-7 days is first-line\. \[1\]/);
  assert.match(g.text, /Doxycycline is the choice in penicillin allergy\. \[1\]/);
  assert.doesNotMatch(g.text, /azithromycin/);
  assert.match(g.text, /Verify against local protocol\.$/);
  assert.equal(g.removed.length, 1); assert.equal(g.removed[0].status, "unsupported");
  assert.equal(g.general, "", "general knowledge is off unless the product allows it");
});

test("general knowledge allowed: the unsupported claim moves under its own heading, never into the KB text", () => {
  const g = G.groundAnswer("Amoxicillin 500 mg tid is first-line. Steroids shorten the hospital stay.", P, "", { allowGeneral: true, expand });
  assert.doesNotMatch(g.text, /Steroids/);
  assert.match(g.general, /Steroids shorten the hospital stay/);
  assert.equal(g.verdict, "partial");
});

test("a contradicted dose is removed even when everything else is right, and the verdict says so", () => {
  const g = G.groundAnswer("Amoxicillin 1 g tid is first-line. Doxycycline for penicillin allergy.", P, "", { expand });
  assert.doesNotMatch(g.text, /1 g/);
  assert.equal(g.removed[0].status, "contradicted");
  assert.match(g.removed[0].why[0], /amoxicillin is dosed 500 mg/);
});

test("nothing supported -> verdict ungrounded and an empty KB text (the caller regenerates or shows the passage)", () => {
  const g = G.groundAnswer("Give ceftriaxone 2 g IV daily. Add vancomycin for MRSA cover.", P, "", { expand });
  assert.equal(g.verdict, "ungrounded");
  assert.equal(g.stats.supported, 0);
});

test("legacy gate would have rejected these paraphrases; the claim verifier accepts them", () => {
  const cases = [["Give 1 g of amoxicillin twice daily.", "Amoxicillin 1000 mg bd is standard."],
                 ["Amoxicillin 500 mg PO q8h for a week.", "Amoxicillin 500 mg orally three times daily for 7 days."]];
  for (const [ans, ev] of cases) {
    assert.equal(R.evidenceGate(ans, ev, "").ok, false, "old gate rejects: " + ans);
    assert.equal(G.groundAnswer(ans, [{ text: ev }], "", { expand }).verdict, "grounded", "new verifier accepts: " + ans);
  }
});

// ── wiring through maik-local.js answer(): real RAG + real verifier, stubbed model ──
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
function loadLocal({ replies, kb = true }) {
  const calls = { generate: [] };
  let n = 0;
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => { calls.generate.push(o); return { text: replies[Math.min(n++, replies.length - 1)], ms: 5 }; },
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const passage = { heading: "Pneumonia > Treatment", page: "p.1", text: P[0].text, chunk: 1 };
  const book = { search: () => [[12.5, 0]], cite: () => passage, idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: R, SMD_MAIK_GROUND: G, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true }, "medmo-4b": { label: "MAiK Cortex", nCtx: 4096, nPredict: 768, noThink: true } },
      caps: (id) => ({ id, kb: kb }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

test("answer(): a non-Lite pack with CAPS.kb is grounded, its paraphrase is kept, the unsupported drug is left out, source line appended", async () => {
  // A real paraphrase of the passage (tid == three times daily, "a week" for 7 days) plus one drug the
  // passage never mentions. NOTE a reply saying "1 g bd" here would be a CONTRADICTION of the 500 mg
  // passage and rightly end in the reference-passage fallback; that is the next test, not this one.
  const { L, calls } = loadLocal({ replies: ["Amoxicillin 500 mg PO tid for a week is first-line.\n- Add azithromycin 500 mg for atypicals.\nVerify against local protocol."] });
  const r = await L.answer({ question: "Treatment of pneumonia?" }, { pack: "medmo-4b" }, null);
  assert.match(calls.generate[0].prompt, /Reference material from the StewardMD Knowledge Base/);
  assert.equal(r.grounded, true);
  assert.equal(r.grounding.verdict, "partial");
  assert.match(r.text, /amoxicillin.*500 mg.*tid/i);
  assert.doesNotMatch(r.text, /azithromycin/);
  assert.match(r.text, /Left out: 1 statement the Knowledge Base did not support\./);
  assert.match(r.text, /Source: StewardMD Knowledge Base - based on standard medical resources\.$/);
  assert.doesNotMatch(r.text, /p\.\d/, "never a page number");
});

test("answer(): nothing supported -> ONE constrained regeneration, then the reference passage, never the unsupported text", async () => {
  const { L, calls } = loadLocal({ replies: ["Ceftriaxone 2 g IV daily plus vancomycin.", "Add linezolid 600 mg bd."] });
  const r = await L.answer({ question: "Treatment of pneumonia?" }, { pack: "maik-lite" }, null);
  assert.equal(calls.generate.length, 2, "exactly one regeneration");
  assert.match(calls.generate[1].prompt, /State only the drugs, doses and figures that appear in the reference material/);
  assert.match(r.text, /could not be verified against the StewardMD Knowledge Base/);
  assert.match(r.text, /amoxicillin 500 mg/i, "the passage itself is shown");
  assert.doesNotMatch(r.text, /linezolid|vancomycin/);
});

test("answer(): a pack without the kb capability is not grounded at all (no retrieval, no source line)", async () => {
  const { L, calls } = loadLocal({ replies: ["Anything at all."], kb: false });
  const r = await L.answer({ question: "Treatment of pneumonia?" }, { pack: "medmo-4b" }, null);
  assert.doesNotMatch(calls.generate[0].prompt, /Reference material/);
  assert.equal(r.grounded, false);
  assert.doesNotMatch(r.text, /Source: StewardMD/);
});
