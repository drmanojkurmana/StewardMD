/* MaiK never talks to the doctor about its reference material (owner, 2026-09-26: "why is agent tell
 * the passage yu sent is irrelavant?"). Pins functions/_maik_metatalk.js, the server-side safety net
 * on the final answer text: meta-talk goes, clinical sentences that merely share a word stay. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubMetaTalk, metaTalkStream } from "../functions/_maik_metatalk.js";

// Whole sentences that talk ABOUT the material: dropped.
const DROPPED = [
  "The passage you sent is irrelevant to this question.",
  "The provided sources do not cover paediatric dosing.",
  "The provided StewardMD knowledge focuses on Factor XII deficiency, which is characterized by a prolonged aPTT [1].",
  "The retrieved passages discuss a different condition.",
  "The excerpt above describes gout, not septic arthritis.",
  "Unfortunately the knowledge base does not cover this drug.",
  "The StewardMD Knowledge Base does not mention a loading dose.",
  "The provided context focuses on hepatitis rather than your question.",
  "The text provided is not relevant to your question.",
  "These sources do not mention the paediatric dose.",
  "My reference notes are about a different condition.",
  "The information in the prompt is limited.",
  "You sent me a passage about asthma, but the question is about COPD.",
  "The sources that you provided only discuss adults.",
  "Snippets 2 and 3 are about tuberculosis.",
  "The notes focus on iron deficiency instead.",
];
for (const s of DROPPED) {
  test("dropped: " + s, () => {
    const out = scrubMetaTalk("Start with an ANA and anti-CCP.\n" + s + "\nCheck a CBC.");
    assert.equal(out, "Start with an ANA and anti-CCP.\nCheck a CBC.");
  });
}

// Lead-ins and reporting frames: the frame goes, the clinical content stays.
const REWRITTEN = [
  ["Based on the text provided, the next step is an anti-CCP test.", "The next step is an anti-CCP test."],
  ["According to the provided sources, first-line therapy is methotrexate.", "First-line therapy is methotrexate."],
  ["Based on the information you provided, this is likely inflammatory arthritis.", "This is likely inflammatory arthritis."],
  ["The provided text states that ceftriaxone 2 g IV daily is first line.", "Ceftriaxone 2 g IV daily is first line."],
  ["Give ceftriaxone 2 g IV daily, as per the provided text.", "Give ceftriaxone 2 g IV daily."],
  ["- In the retrieved notes, amoxicillin is first line.", "- Amoxicillin is first line."],
  ["**Based on the passages provided, you're asking about RA workup.**", "**You're asking about RA workup.**"],
];
for (const [inp, want] of REWRITTEN) test("rewritten: " + inp, () => assert.equal(scrubMetaTalk(inp), want));

// Clinical sentences that share a word with the material: untouched, byte for byte.
const KEPT = [
  "Delayed passage of meconium beyond 48 hours suggests Hirschsprung disease.",
  "The nasal passages are narrowed in croup.",
  "In the context of sepsis, start antibiotics within one hour.",
  "The likely sources here are the urinary tract and the lungs.",
  "Achieve source control within 6 to 12 hours; common sources include abscesses and infected devices.",
  "Ensure the patient education materials provided at discharge are in their language.",
  "Based on the evidence, statins reduce cardiovascular mortality.",
  "The evidence given in RECOVERY is not directly applicable to children.",
  "Given her age and renal function, reduce the dose.",
  "The notes you shared mention a penicillin allergy, so avoid amoxicillin.",
  "The material you shared earlier suggests TB exposure.",
  "The sources of fever are usually infective.",
  "The evidence does not address paediatric patients.",
  "Guidelines do not cover this rare scenario; discuss with a specialist.",
  "The context provided by the history is key.",
  "The information you provided (age 71, creatinine 1.2) means the dose should be reduced.",
  "Rheumatoid factor is positive in about 70-80% of RA and is not specific; check anti-CCP.",
  "Risk factors include smoking, diabetes and hypertension.",
  "Troponin is not relevant in this setting until symptoms are cardiac.",
  "See the StewardMD Drug Index for brand availability.",
  "First-line is amoxicillin 500 mg TDS (StewardMD Knowledge Base [1]).",
  "| Diagnosis | RF | Anti-CCP |",
  "| Sjogren syndrome | +/- | - |",
  "### The provided sources",
  "@@MORE@@",
  "@@REFINE: renal impairment | pregnant | the provided text@@",
];
for (const s of KEPT) test("kept: " + s, () => assert.equal(scrubMetaTalk(s), s));

test("a sentence that points back at a dropped one goes with it; an unrelated 'This' stays", () => {
  const inp = "- The provided StewardMD knowledge focuses on Factor XII deficiency [1]. This is not directly relevant to the presentation.\n" +
    "- Order ANA and anti-CCP. This is the key first step.";
  assert.equal(scrubMetaTalk(inp), "- Order ANA and anti-CCP. This is the key first step.");
  assert.equal(scrubMetaTalk("Order ANA. This is not relevant for men."), "Order ANA. This is not relevant for men.", "no drop before it: kept");
});

test("an answer shaped like the owner's transcript keeps every clinical line", () => {
  const ans = [
    "**You're asking about next steps for a raised RF with high inflammatory markers. I'm assuming an adult with no prior diagnosis.**",
    "",
    "Rationale:",
    "- A positive RF with raised CRP and ESR suggests an inflammatory or autoimmune process [1] [2].",
    "- The provided StewardMD knowledge focuses on Factor XII deficiency, which is usually discovered incidentally [1]. This is not directly relevant to the patient's presentation.",
    "",
    "| Diagnosis | RF | Anti-CCP |",
    "|---|---|---|",
    "| Rheumatoid arthritis | + | + |",
    "@@MORE@@",
    "Next steps: order ANA and anti-CCP.",
  ].join("\n");
  const out = scrubMetaTalk(ans);
  assert.ok(!/provided|Factor XII|not directly relevant/i.test(out), out);
  for (const keep of ["**You're asking", "Rationale:", "suggests an inflammatory", "| Rheumatoid arthritis | + | + |", "@@MORE@@", "order ANA and anti-CCP"]) assert.ok(out.includes(keep), "lost: " + keep);
});

test("streaming: same result as the whole-answer scrub whatever the chunking", () => {
  const ans = "Start with ANA.\nThe passage you sent is irrelevant. Check anti-CCP.\n- Based on the text provided, treat early.\n@@REFINE: a | b@@";
  const want = scrubMetaTalk(ans);
  for (const size of [1, 3, 7, 40, 1000]) {
    const f = metaTalkStream();
    let got = "";
    for (let i = 0; i < ans.length; i += size) got += f.push(ans.slice(i, i + size));
    got += f.flush();
    assert.equal(got, want, "chunk size " + size);
  }
  assert.equal(want, "Start with ANA.\nCheck anti-CCP.\n- Treat early.\n@@REFINE: a | b@@");
});

test("empty and meta-free text pass through unchanged", () => {
  assert.equal(scrubMetaTalk(""), "");
  assert.equal(scrubMetaTalk(undefined), undefined);
  const plain = "**Amoxicillin** 500 mg TDS for 5 days.\n\n- Review at 48 h.";
  assert.equal(scrubMetaTalk(plain), plain);
});
