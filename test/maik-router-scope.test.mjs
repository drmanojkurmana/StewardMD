/* maik-router-scope.test.mjs — the client must not out-refuse the firewall, and must not dead-end
 * a real clinical question into a clarifying prompt.
 *
 * From a real device transcript (20 Aug 2026), all four of these came from ONE conversation:
 *   "PCOD?"                                 -> "Could you tell me the condition, symptoms..."
 *   "What is PCOD?"                          -> "MaiK is for healthcare professionals..."
 *   "What is SGLT2 drugs mechanism of action?"-> "MaiK is for healthcare professionals..."
 *   "Side effects?"                          -> "Could you tell me the condition, symptoms..."
 *
 * Two independent causes, both asserted here at source level (home.js is a 5MB browser IIFE):
 *   1. the scope GATE refused the firewall's "no signal" bucket as if it meant "not medical"
 *   2. maikRoute kept its OWN small clinical keyword regex, so a query the firewall had already
 *      accepted could still be clarified away
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MaiKScope = require("../kb/ai/maik-scope.js");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");

test("client scope gate refuses ONLY a positively-identified non-clinical query", () => {
  assert.match(HOME, /if \(_scope && _scope\.medical === false && _scope\.certain === true\) \{/,
    "the gate must require certainty; medical===false alone includes 'not in our vocabulary'");
  assert.ok(!/if \(_scope && _scope\.medical === false\) \{/.test(HOME),
    "the old certainty-free gate must be gone");
});

test("short-query clarify defers to the firewall instead of a rival keyword list", () => {
  // The old guard was a hand-maintained ~40-term regex living in maikRoute. Any clinical term absent
  // from it (pcod, side effects) was clarified away even though MaiKScope called it medical.
  assert.ok(!/dka\|op\|tb\|uti\|copd\|ards\|hiv\|mi\|pe\|sepsis\|shock\|fever\|pain\|dose\|drug\|poison/.test(HOME),
    "the duplicate clinical keyword list should be gone");
  const guard = HOME.match(/if \(isShort && toks\.length <= 2\) \{[\s\S]{0,500}?\n {6}\}/);
  assert.ok(guard, "short-query guard not found");
  assert.match(guard[0], /MaiKScope\.classify\(n\)\.medical/, "must ask the firewall");
});

test("the scripted conversational replies are gone", () => {
  // Owner, on seeing them: "THIS IS manufactured TEXT REMOVE IT / WHY IS HI NOT BEING DIRECTED
  // DIRECTLY TO GEMMA TO RESPOND". A greeting now reaches the selected engine.
  assert.ok(!HOME.includes("Hello. I can help with clinical knowledge"), "canned greeting still present");
  assert.ok(!HOME.includes("I’m well, thank you."), "canned how-are-you still present");
  assert.ok(!HOME.includes("You’re welcome. Let me know"), "canned thanks still present");
  assert.ok(!/var MAIK_ACK =/.test(HOME), "MAIK_ACK is dead once the ack reply is gone");
  assert.match(HOME, /if \(byeHit \|\| \(casualHit && isShort && greetOnly\)\) return \{ kind: "clinical" \}/,
    "greetings must route to the model");
});

test("the non-clinical TOPIC deflection is kept (it is scope, not a greeting)", () => {
  assert.match(HOME, /I focus on clinical knowledge, drug information, calculators/);
});

test("app-facing MaiK chrome carries no em-dash", () => {
  // CLAUDE.md: no em-dash in app-facing text; MaiK's AI *output* is the only exemption.
  for (const s of ["Educational clinical reference. Verify with local protocol.",
                   "I\\u2019m MaiK. I focus on clinical knowledge"]) {
    assert.ok(HOME.includes(s), "expected de-dashed string: " + s);
  }
});

test("every question from the device transcript now reaches an engine", () => {
  for (const q of ["Hi", "Treatment of Fever", "PCOD?", "What is PCOD?", "Polycystic Kidney Disease",
                   "What is SGLT2 drugs mechanism of action?", "Linagliptin mechanism of action",
                   "Side effects?", "Side effects of Linagliptin"]) {
    assert.equal(MaiKScope.isRefusable(q), false, "still refused: " + q);
  }
});
