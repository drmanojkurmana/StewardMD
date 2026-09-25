/* test/maik-audit-b.test.mjs — audit batch B (2026-09-25), the parts a browser run does not show.
 * Browser behaviour (offline notice, split storage, sign-out wipe, action order, reason box) is in
 * test/run-maik-audit-b-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");

test("T38: the in-session cache key includes engine and length; a cache hit still enters memory", () => {
  assert.match(H, /return maikNorm\(q\) \+ "\|" \+ eng \+ "\|" \+ maikLenPref\(\) \+ \(active \? "\|case" : ""\);/);
  assert.equal((H.match(/maikCacheKey\(/g) || []).length >= 4, true);
  assert.match(H, /_cm\.innerHTML = _maikCache\[cacheKey\]; maikRememberTurn\(question, maikAnswerText\(_cm\)\);/);
});

test("T44: a question no longer switches MaiK back on behind the doctor's back", () => {
  const rc = H.slice(H.indexOf("function runClinical("), H.indexOf("function runClinical(") + 12000);
  assert.doesNotMatch(rc, /SMD_AI\.setFlag\(true\)/);
});

test("T46: handing a turn to web research leaves the Firestore pause to the research flow", () => {
  assert.match(H, /_fsResumed = true;\n\s*try \{ maikRunWeb\(think, question\); \}/);
});

test("T47: streaming paints are coalesced and never run after Stop or the final render", () => {
  assert.match(H, /if \(_maikStopped \|\| _streamFinal\) return;/);
  assert.match(H, /_paintT = setTimeout\(paint, 50\);/);
  assert.match(H, /_streamFinal = true; if \(_paintT\) \{ clearTimeout\(_paintT\); _paintT = null; \}/);
});

test("T49: MaiK's app-facing copy carries no em-dash in the strings the audit found", () => {
  for (const s of ["No saved conversations yet —", "Voice input hit a snag —", "StewardMD — MaiK conversation", "(optional — no patient details", "Couldn’t make a PDF —", "more than one meaning — which"])
    assert.ok(!H.includes(s), s);
});

test("T64: a follow-up chip marks the turn as a follow-up; LLM-first never auto-runs web research", () => {
  assert.match(H, /_maikFollowUp = true;   \/\/ a chip under an answer continues/);
  assert.match(H, /if \(!maikLLMFirst\(\) && tm && tm\.matched === false &&/);
});

test("T32: evidence reviews left today are remembered from the server's usage and shown", () => {
  assert.match(H, /localStorage\.setItem\("smd_maik_research_use"/);
  assert.match(H, /function maikResearchLeft\(\)/);
});

test("T29 / T48: MaiK listens for sign-out and stores conversations as an index plus one key each", () => {
  assert.match(H, /window\.addEventListener\("smd:signout", maikWipeAccount\)/);
  assert.match(H, /function maikConvHtmlKey\(id\) \{ return "smd_maik_convh_" \+ maikAcctKey\(\) \+ "_" \+ id; \}/);
});
