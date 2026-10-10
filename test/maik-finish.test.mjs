/* test/maik-finish.test.mjs - why a MaiK Cloud answer stops, and a "Know more" that restates the lead.
 * Owner, 2026-10-10: the answer stopped at "| Diagnosis/Option | Distinguishing Features" and Know more
 * repeated the same opening and stopped at the same place.
 * node --test test/maik-finish.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finishAnalysis, betterAttempt, dropRepeatedLead } from "../functions/_maik_finish.js";

test("STOP and empty are complete; everything else is a cut answer worth one retry", () => {
  for (const f of ["STOP", "", undefined, "FINISH_REASON_UNSPECIFIED"]) assert.equal(finishAnalysis(f).cut, false, String(f));
  assert.deepEqual([finishAnalysis("MAX_TOKENS").kind, finishAnalysis("MAX_TOKENS").moreTokens], ["length", true]);
  assert.equal(finishAnalysis("RECITATION").kind, "recitation");
  for (const f of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]) assert.equal(finishAnalysis(f).kind, "filter", f);
  assert.equal(finishAnalysis("OTHER").kind, "other");
  assert.ok(["MAX_TOKENS", "RECITATION", "SAFETY", "OTHER"].every((f) => finishAnalysis(f).retry));
});

test("betterAttempt: complete beats cut, then longer beats shorter", () => {
  const cut = { text: "short", finish: "SAFETY" }, whole = { text: "a much longer complete answer", finish: "STOP" };
  assert.equal(betterAttempt(cut, whole), whole);
  assert.equal(betterAttempt(whole, cut), whole);
  assert.equal(betterAttempt({ text: "ab", finish: "SAFETY" }, { text: "abcdef", finish: "MAX_TOKENS" }).text, "abcdef", "both cut: the longer one");
  assert.equal(betterAttempt({ text: "long complete", finish: "STOP" }, { text: "x", finish: "STOP" }).text, "long complete");
});

const LEAD = "**You're asking about the differential diagnosis for organophosphate/cholinergic poisoning.** The key is recognizing the cholinergic toxidrome, which presents with both muscarinic and nicotinic signs, though vital signs can be mixed.\n\nHere's a breakdown of conditions that can mimic organophosphate poisoning:\n\n| Diagnosis/Option | Distinguishing Features";

test("dropRepeatedLead removes the restated opening and keeps the real detail", () => {
  const t2 = LEAD.split("\n\n").slice(0, 2).join("\n\n") + "\n\n**Rationale**\nCholinesterase inhibition causes ...\n\n| Option | Feature |\n|---|---|\n| Carbamate | Short |";
  const out = dropRepeatedLead(t2, LEAD);
  assert.ok(out.startsWith("**Rationale**"), out.slice(0, 60));
  assert.ok(/Carbamate/.test(out));
  assert.ok(!/You're asking about/.test(out));
});

test("a paragraph that only LOOKS similar further down is never removed", () => {
  const t2 = "**Rationale**\nCholinesterase ...\n\nYou're asking about the differential diagnosis for organophosphate/cholinergic poisoning, so remember carbamates.";
  assert.equal(dropRepeatedLead(t2, LEAD), t2, "removal stops at the first new paragraph");
});

test("if everything is a repeat the text is returned as is, never blank", () => {
  const same = LEAD;
  assert.equal(dropRepeatedLead(same, LEAD), same);
});

test("no lead, or already-new text: unchanged", () => {
  assert.equal(dropRepeatedLead("Some detail.", ""), "Some detail.");
  assert.equal(dropRepeatedLead("**Rationale**\nx", LEAD), "**Rationale**\nx");
  assert.equal(dropRepeatedLead("", LEAD), "");
});

import { looksCutOff } from "../functions/_maik_finish.js";
test("looksCutOff: the screenshot's stop (a table header and nothing after it)", () => {
  assert.equal(looksCutOff("Lead.\n\n| Diagnosis/Option | Distinguishing Features"), true, "row cut mid cell");
  assert.equal(looksCutOff("Lead.\n\n| Diagnosis/Option | Distinguishing Features |"), true, "a header with no body");
  assert.equal(looksCutOff("Lead.\n\n| A | B |\n|---|---|\n| 1 | 2 |"), false, "a finished table");
  assert.equal(looksCutOff("Lead.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nRed flag: intubate."), false);
  assert.equal(looksCutOff("Plain answer ending normally."), false);
  assert.equal(looksCutOff(""), false);
});
test("a STOP answer that ends mid-table loses to a complete retry", () => {
  const cutT = { text: "Lead.\n\n| A | B", finish: "STOP" }, ok = { text: "Lead.\n\n| A | B |\n|---|---|\n| 1 | 2 |", finish: "STOP" };
  assert.equal(betterAttempt(cutT, ok), ok);
  assert.equal(betterAttempt(ok, cutT), ok);
});

test("the explain handler uses them: retry once on a cut answer, tell the client, and drop a restated lead", () => {
  const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
  assert.match(SRC, /from "\.\.\/\.\.\/_maik_finish\.js"/);
  assert.match(SRC, /const _fa = \(!_fa0\.cut && looksCutOff\(text\)\)/, "a STOP that ends mid-table is treated as cut");
  assert.match(SRC, /betterAttempt\(_first, \{ text: t2/, "the better of the two attempts is kept");
  assert.match(SRC, /_tier === 2 && body && body\.priorLead\) text = dropRepeatedLead\(/, "Know more drops a restated lead");
  assert.match(SRC, /cutShort: _cutShort \|\| undefined/, "the client is told when it is still cut");
});
