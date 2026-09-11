/* test/wardsynq-advisory-authoring.test.mjs — checking a hospital's rules before its ward runs them.
 *
 * node --test test/wardsynq-advisory-authoring.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAMPLE, NOISY_AT, SILENT_AT, readDryRun } from "../functions/_wardsynq/advisory-authoring.js";
import { compileAdvisories } from "../functions/_wardsynq/advisories.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/advisory-authoring.js", import.meta.url), "utf8");
const rules = [
  { id: "r-quiet", message: "Send cultures first", level: "info" },
  { id: "r-loud", message: "Review date needed", level: "info" },
  { id: "r-ok", message: "Check renal function", level: "warn" },
];

test("A RULE THAT NEVER FIRES IS THE FAILURE A VALIDATOR MISSES", () => {
  /* It is well-formed and simply silent. Nobody notices, because nothing happens, and the hospital
   * believes it has a safety net it does not have. */
  const rows = readDryRun(rules, { "r-loud": 150, "r-ok": 12 }, 200);
  const quiet = rows.find((r) => r.id === "r-quiet");
  assert.equal(quiet.fired, 0);
  assert.equal(quiet.silent, true);
  assert.match(quiet.reading, /fired on NONE/);
  assert.match(quiet.reading, /safety net that is not there/);
  // Every rule appears, including the silent one - a rule missing from the report is the one an
  // author most needs to see.
  assert.equal(rows.length, 3);
});

test("A RULE THAT FIRES ON EVERYTHING IS REPORTED, because alert fatigue makes its neighbours worse", () => {
  const rows = readDryRun(rules, { "r-loud": 150, "r-ok": 12 }, 200);
  const loud = rows.find((r) => r.id === "r-loud");
  assert.equal(loud.noisy, true);
  assert.equal(loud.share, 0.75);
  assert.match(loud.reading, /75%/);
  assert.match(loud.reading, /less effective too/);

  // An ordinary rule is neither, and says so plainly.
  const ok = rows.find((r) => r.id === "r-ok");
  assert.equal(ok.noisy, undefined);
  assert.equal(ok.silent, undefined);
  assert.match(ok.reading, /Fired on 12 of the last 200/);
});

test("NO SAMPLE IS NOT A CLEAN BILL: share is null, never zero", () => {
  /* "It fired on none of 200 orders" and "there were no orders" are different facts and only one of
   * them is about the rule. */
  const rows = readDryRun(rules, {}, 0);
  assert.equal(rows[0].share, null);
  assert.equal(rows[0].silent, undefined, "silence is not claimed when nothing was tried");
  assert.match(rows[0].reading, /no recent orders/);
  assert.ok(/sampleWarning/.test(SRC), "and the response says so at the top level too");
});

test("IT REPORTS, IT DOES NOT REFUSE", () => {
  /* "Every intravenous antibiotic needs a review date" is MEANT to fire constantly. A checker that
   * rejected a rule on its firing rate would be overruling a clinical decision it cannot see. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/status: 4\d\d, error: "too_noisy"|reject.*noisy/i.test(code));
  assert.ok(/may still be right/.test(SRC));
  assert.equal(NOISY_AT, 0.5);
  assert.equal(SILENT_AT, 1);
  assert.equal(SAMPLE, 200);
});

test("IT USES THE ENGINE'S OWN COMPILER, so the checker and the engine cannot disagree", () => {
  /* A separate validator would be a second opinion about what a valid rule is, and an author would
   * be told a rule is fine by the checker and have it silently dropped by the engine. */
  assert.ok(/import \{ compileAdvisories, evaluateAdvisories \} from "\.\/advisories\.js"/.test(SRC));

  /* And the compiler's own rejections are passed through unchanged. A rule dropped by the engine and
   * not reported here would be a rule an author believes they have. */
  const compiled = compileAdvisories([
    { message: "no id here", when: [{ kind: "always" }] },
    { id: "no-condition", message: "fine" },
    { id: "ok", message: "fine", when: [{ kind: "always" }] },
  ]);
  assert.deepEqual(compiled.rules.map((r) => r.id), ["ok"]);
  assert.deepEqual(compiled.problems.map((p) => p.reason).sort(), ["no_condition", "no_id"]);
  assert.ok(/rejected: compiled\.problems \|\| \[\]/.test(SRC), "and an absent problems list is an empty one, not undefined");
});

test("IT CHANGES NOTHING: no config is written and nothing is activated", () => {
  /* Making the check the same act as the deployment would mean the only way to find out what a rule
   * does is to ship it, which is the situation this closes. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/svc\.put\(/.test(code));
  assert.ok(!/"record:write"/.test(code));
  assert.ok(/"record:read"/.test(code));
  assert.ok(/Nothing has been saved and nothing is active/.test(SRC));
  // And it restates the invariant the whole feature rests on.
  assert.ok(/can never block an order/.test(SRC));
});
