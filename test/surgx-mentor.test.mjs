/* test/surgx-mentor.test.mjs - Senior Surgeon Mode has a screen (2026-09-11).
 *
 * The "surgx-mentor" mode existed as a server quota bucket and, since the hard Local policy, as an
 * on-device persona prompt, with no client caller. The case view now carries an "Ask the senior
 * surgeon" card. This pins the wiring: the card renders, the handler exists, the call goes through
 * SMD_AI with mode "surgx-mentor" (so the answer-engine chooser governs it), and a refusal's message
 * is rendered rather than swallowed. Static checks on the source, like the other surgx-* tests.
 *
 * node --test test/surgx-mentor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../surgx-screens.js", import.meta.url), "utf8");
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

test("the case view renders the mentor card and the handler routes to askMentor()", () => {
  const rc = SRC.slice(SRC.indexOf("function renderCase(k)"), SRC.indexOf("function renderDecision("));
  assert.match(rc, /Ask the senior surgeon/);
  assert.match(rc, /data-sgx="mentor"/);
  assert.match(rc, /id="sgxMentorQ"/);
  assert.match(SRC, /if \(act === "mentor"\) \{ askMentor\(\); return; \}/);
});

test("askMentor() calls SMD_AI with mode surgx-mentor, carries the case context, and shows a refusal's message", () => {
  const fn = SRC.slice(SRC.indexOf("function askMentor()"), SRC.indexOf("function renderCase(k)"));
  assert.match(fn, /mode: "surgx-mentor"/);
  assert.match(fn, /SURGICAL TEACHING CASE \(simulated, not a real patient\)/);
  assert.match(fn, /Decisions so far/);
  assert.match(fn, /me\.err = \(r && r\.message\)/, "a LOCAL_CAPABILITY_REQUIRED or kb-only message is what the surgeon sees");
  assert.ok(!/fetch\(/.test(fn), "no direct network call: the transport is SMD_AI");
});

test("the on-device persona for that mode exists", () => {
  assert.match(LOCAL, /"surgx-mentor": SURG_SYS/);
  assert.match(LOCAL, /Senior Surgeon Mode/);
});
