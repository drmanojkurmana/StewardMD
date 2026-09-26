/* MaiK never talks to the doctor about its reference material (owner, 2026-09-26: "why is agent tell
 * the passage yu sent is irrelavant?"). Pins functions/_maik_metatalk.js, the server-side safety net
 * on the final answer text: meta-talk goes, clinical sentences that merely share a word stay. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubMetaTalk, metaTalkStream } from "../functions/_maik_metatalk.js";
import { DROPPED, REWRITTEN, KEPT } from "./fixtures/maik-metatalk-cases.mjs";

for (const s of DROPPED) {
  test("dropped: " + s, () => {
    const out = scrubMetaTalk("Start with an ANA and anti-CCP.\n" + s + "\nCheck a CBC.");
    assert.equal(out, "Start with an ANA and anti-CCP.\nCheck a CBC.");
  });
}

for (const [inp, want] of REWRITTEN) test("rewritten: " + inp, () => assert.equal(scrubMetaTalk(inp), want));

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

test("a citation after a dropped sentence goes with it; after a kept sentence it stays", () => {
  assert.equal(scrubMetaTalk("The provided sources focus on gout. [2] Treat the pain. [1]"), "Treat the pain. [1]");
});

test("empty and meta-free text pass through unchanged", () => {
  assert.equal(scrubMetaTalk(""), "");
  assert.equal(scrubMetaTalk(undefined), undefined);
  const plain = "**Amoxicillin** 500 mg TDS for 5 days.\n\n- Review at 48 h.";
  assert.equal(scrubMetaTalk(plain), plain);
});
