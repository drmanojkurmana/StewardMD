/* test/verify-prompt.test.mjs — the verify prompt must come back on every app open.
 *
 * OWNER 2026-08-27: "ask them to verify on every app opening". Before this, one tap on the skip
 * button silenced the gate for the whole provisional window, so an account could reach the day-7
 * deletion sweep having been asked exactly once. That is the failure this guards.
 *
 * evaluate() needs live Firebase, so these are structural assertions over the source. They are
 * deliberately about the SHAPE that makes the behaviour possible (a per-open latch, a pending
 * exemption), because those are what a later refactor would quietly drop.
 *
 * node --test test/verify-prompt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../verify.js", import.meta.url), "utf8");
const body = (fn) => {
  const i = SRC.indexOf("function " + fn);
  assert.ok(i > -1, fn + " not found");
  return SRC.slice(i, i + 3000);
};

test("there is a per-app-open latch, not a per-call one", () => {
  assert.match(SRC, /var _promptedThisOpen = false/,
    "a module-level latch: evaluate() fires on every auth and account change, so a bare re-render would loop");
  // It must be set before rendering, or the same open re-prompts on the next auth event.
  const ev = body("evaluate");
  assert.ok(ev.indexOf("_promptedThisOpen = true") < ev.indexOf('render("forced"'),
    "latch must be set BEFORE the render, otherwise evaluate()'s own churn re-opens it");
});

test("a provisional (skipped) account is asked again, instead of being left alone", () => {
  const ev = body("evaluate");
  assert.match(ev, /if \(provisional\)/);
  assert.match(ev, /!_promptedThisOpen/, "the provisional branch must be able to re-prompt");
  assert.match(ev, /render\("forced", d\)/, "and it re-opens the real gate, not a toast");
});

test("PENDING REVIEW is exempt — never nag someone who already sent their proof", () => {
  const ev = body("evaluate");
  assert.match(ev, /d\.status !== "pending"/,
    "an intern waiting on the owner's review must not be asked again every single app open");
});

test("the prompt stays dismissible — unverified keeps the free tier, it is not a hard block", () => {
  // The skip button is what makes this a prompt rather than a lockout. If it ever disappears from
  // the forced gate, an unverified doctor is bricked instead of downgraded.
  assert.match(SRC, /verifySkipBtn/);
  assert.match(SRC, /mode === "forced" && !verified/, "skip is offered exactly on the forced gate");
  assert.match(SRC, /continue on the free plan/i, "and it says what it actually does now");
});

test("the panel is never hijacked by the re-prompt", () => {
  // openPanel() is the user deliberately opening Account and Verification. Re-rendering it as the
  // forced gate under them would replace what they asked for.
  const ev = body("evaluate");
  assert.match(ev, /dataset\.mode !== "panel"/);
});

test("no em-dash in the strings this change touched (app-facing text rule)", () => {
  for (const s of ["continue on the free plan", "free plan"]) {
    const i = SRC.indexOf(s);
    if (i < 0) continue;
    const line = SRC.slice(SRC.lastIndexOf("\n", i) + 1, SRC.indexOf("\n", i));
    assert.ok(!/—/.test(line), `em-dash in app-facing line: ${line.trim().slice(0, 90)}`);
  }
});
