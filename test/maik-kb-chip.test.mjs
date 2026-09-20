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

test("the chip renders only when a REAL KB page exists behind it", () => {
  const i = HOME.indexOf('data-kb-more="');
  assert.ok(i > 0, "the chip exists");
  const block = HOME.slice(Math.max(0, i - 900), i + 400);
  assert.match(block, /if \(_kbOk\)/, "guarded on an openable page, not merely on having an id");
  assert.match(block, /hasDiseaseRef/, "asks the KB whether a page exists");
  assert.match(block, /Read more in StewardMD KB/, "states where it goes");
  // Cannot verify -> do not promise. A missing guard must fail closed, not open.
  assert.match(block, /\? *false/, "fails closed when the reference module is absent");
});

test("the existence check uses the SAME lookups as the page it offers", () => {
  const i = REASON.indexOf("function hasDiseaseRef");
  assert.ok(i > 0, "the guard exists");
  const guard = REASON.slice(i, i + 700);
  for (const src of ["SYNDROMES", "DDX_NI", "KB_ENRICHMENT"]) {
    assert.ok(guard.includes(src), `checks ${src}, the same source openDiseaseRef resolves from`);
  }
  assert.match(REASON, /hasDiseaseRef: hasDiseaseRef/, "exported for home.js");
});

test("it opens the curated record and never silently does nothing", () => {
  const i = HOME.indexOf('closest("[data-kb-more]")');
  assert.ok(i > 0, "the click is handled");
  const block = HOME.slice(i, i + 1600);
  assert.match(block, /SMD_REASON\.openRef\(/, "uses openRef, the documented entry point from outside the workspace");
  assert.doesNotMatch(block, /SMD_REASON\.openDiseaseRef/,
    "never the raw internal: it assumes the reasoning workspace is already on screen and throws cold");
  assert.match(block, /toast\(/, "says so when the reference module is not loaded");
  // 2026-09-21: openRef existed only on window.DX; the chip checks SMD_REASON. Look INSIDE that object.
  const sr = REASON.slice(REASON.indexOf("window.SMD_REASON = {"));
  const srObj = sr.slice(0, sr.indexOf("\n  };"));
  assert.match(srObj, /openRef: function/, "SMD_REASON itself exposes openRef, the object the chip calls");
  assert.match(srObj, /hasDiseaseRef: hasDiseaseRef/, "next to hasDiseaseRef, which the chip's render guard uses");
});

/* THE BUG THIS FILE EXISTS FOR (owner, 2026-09-20: "clicking on chips not taking me to disease").
 * #maikSheet is z-index 999; .dx-overlay is 850. Opening the disease page with the sheet still up
 * renders it BEHIND MaiK - fully working, completely invisible. home.js already documents this trap
 * for the copilot tool chips ("exactly what the chips don't do anything looks like"); the KB chip
 * walked into it too. */
test("the sheet is CLOSED before the disease page opens, or it renders behind MaiK", () => {
  const i = HOME.indexOf('closest("[data-kb-more]")');
  const block = HOME.slice(i, i + 1600);
  const closeAt = block.indexOf("close()");
  const openAt = block.indexOf("SMD_REASON.openRef(");
  assert.ok(closeAt > 0, "MaiK is closed first");
  assert.ok(openAt > closeAt, "the reference opens AFTER the sheet closes");
  assert.match(block, /setTimeout\([\s\S]{0,200}?18\d\)/,
    "opens on the same settle delay the working tool chips use");
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
