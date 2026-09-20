/* test/maik-kb-chip.test.mjs — "Read more in StewardMD KB" under a grounded answer.
 *
 * Owner, 2026-09-20: "we have all disease, drugs, ecgs in our app ... once i ask Myocardial
 * Infarction why not show read more in StewardMD KB chip glowing below?"
 *
 * The chip opens the CURATED disease record (reasoning.js openDiseaseRef) rather than spending
 * another model call: local, instant, no tokens, works offline, and for a named-disease question
 * usually more complete than the generated prose above it.
 *
 * The invariant worth protecting is that it can never promise a page that does not exist, and that
 * it still appears OFFLINE - which is the whole reason the id is captured in send() rather than read
 * at render time, since maik-local.js strips pkg.grounding before an on-device answer renders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const REASON = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

test("the KB disease id is captured in send(), BEFORE the on-device engine strips grounding", () => {
  const i = HOME.indexOf("_maikKbId = (_g0 && _g0.diseaseId)");
  assert.ok(i > 0, "the id is captured from pkg.grounding");
  // It must be captured in the package pipeline, not inside the renderer.
  const before = HOME.slice(Math.max(0, i - 1200), i);
  assert.match(before, /\.then\(function \(pkg\)/, "captured while the package is in hand");
  // And the strip it is racing really does exist, so this test fails loudly if that changes.
  assert.match(LOCAL, /pkg\.grounding = \[\]/, "maik-local.js still strips grounding before render");
});

test("the chip renders only when a disease id was actually captured", () => {
  const i = HOME.indexOf('data-kb-more="');
  assert.ok(i > 0, "the chip exists");
  const block = HOME.slice(Math.max(0, i - 700), i + 400);
  assert.match(block, /if \(_maikKbId\)/, "guarded on a real id - never a dead link");
  assert.match(block, /Read more in StewardMD KB/, "states where it goes");
});

test("it opens the curated record and never silently does nothing", () => {
  const i = HOME.indexOf('closest("[data-kb-more]")');
  assert.ok(i > 0, "the click is handled");
  const block = HOME.slice(i, i + 900);
  assert.match(block, /SMD_REASON\.openDiseaseRef/, "opens the KB disease reference");
  assert.match(block, /toast\(/, "says so when the reference module is not loaded");
  assert.match(REASON, /openDiseaseRef: openDiseaseRef/, "reasoning.js exports it");
});

test("it sits ABOVE the token-spending refine chips", () => {
  const kb = HOME.indexOf('data-kb-more="');
  const refine = HOME.indexOf("var refineHTML = maikRefineHTML(");
  assert.ok(kb > 0 && refine > 0, "both exist");
  assert.ok(kb < refine, "the free, curated route is offered before the ones that cost tokens");
});

test("it glows, but not forever, and respects reduced motion", () => {
  assert.match(HOME, /animation:maikKbGlow [\d.]+s ease-out 3/, "the pulse is finite (3 runs)");
  assert.match(HOME, /@keyframes maikKbGlow/, "the glow keyframes exist");
  assert.match(HOME, /prefers-reduced-motion:reduce\)\{\.maik-kbmore\{animation:none/,
    "reduced motion drops the animation");
  assert.match(HOME, /\.maik-kbmore:focus-visible/, "keyboard focus is visible");
});

test("the chip is a control, so it is stripped from exported/shared answers", () => {
  assert.match(HOME, /\.maik-know,\.maik-perf,\.maik-webbusy,\.maik-kbmore/,
    "excluded from the export clone alongside the other controls");
});
