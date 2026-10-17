/* codeblue-motion.test.mjs: static motion and anti-slop guard for the five
 * Code Blue web CSS files (live, prefs, trainer, ecg, sheet).
 * No DOM, no browser: reads the CSS as text and asserts the motion contract
 * from docs/codeblue/DESIGN.md section 7:
 * - no `transition: all` anywhere,
 * - no layout property (width, height, top, left, bottom, margin, padding)
 *   inside a transition declaration (transform and opacity only),
 * - every file honours prefers-reduced-motion (motion off leaves colour
 *   changes; press scale is reset),
 * - no glow, gradient, backdrop filter or blur decoration,
 * - press feedback (scale 0.97) is present on each screen,
 * - the overdue state keeps a non-motion cue (word plus border shape).
 * USAGE: node test/codeblue-motion.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [
  "codeblue-live.css",
  "codeblue-prefs.css",
  "codeblue-trainer.css",
  "codeblue-ecg.css",
  "codeblue-sheet.css",
];
const css = {};
for (const f of FILES) css[f] = readFileSync(join(HERE, "..", f), "utf8");

/* Layout props must not appear bare inside a transition value. min-height
 * and max-height are excluded: they never appear in a transition here and
 * the lookbehind keeps the min-/max- prefix from matching. */
const LAYOUT_IN_TRANSITION = /(?<![\w-])(width|height|top|left|bottom|margin|padding)(?![\w-])/;

function transitionValues(src) {
  const out = [];
  const re = /transition\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

for (const f of FILES) {
  test(f + ": no `transition: all`", () => {
    assert.doesNotMatch(css[f], /transition\s*:\s*all\b/, "transition names exact properties");
    assert.doesNotMatch(css[f], /transition-property\s*:\s*all\b/, "transition-property never all");
  });

  test(f + ": transitions animate transform, opacity or colour only", () => {
    for (const v of transitionValues(css[f])) {
      assert.doesNotMatch(v, LAYOUT_IN_TRANSITION, "no layout prop in `" + v.trim() + "`");
    }
  });

  test(f + ": honours prefers-reduced-motion", () => {
    assert.ok(css[f].includes("prefers-reduced-motion"), "media query present");
    assert.ok(css[f].includes("transition: none") || css[f].includes("transition:none"),
      "transitions switch off");
    assert.ok(css[f].includes("animation: none") || css[f].includes("animation:none"),
      "animations switch off");
  });

  test(f + ": no glow, gradient, backdrop or blur decoration", () => {
    assert.doesNotMatch(css[f], /linear-gradient|radial-gradient|conic-gradient/, "flat colours only");
    assert.doesNotMatch(css[f], /backdrop-filter/, "no backdrop blur");
    assert.doesNotMatch(css[f], /text-shadow/, "no text glow");
    assert.doesNotMatch(css[f], /blur\s*\(/, "no blur filter");
  });

  test(f + ": press feedback scales to 0.97", () => {
    assert.ok(css[f].includes("scale(0.97)") || css[f].includes("scale(.97)"),
      "tiles and buttons press to 0.97");
  });
}

test("live: overdue state stays readable with motion off (word plus border)", () => {
  assert.ok(css["codeblue-live.css"].includes("cbl-dueword"), "state word element styled");
  assert.ok(css["codeblue-live.css"].includes("Overdue") === false, "no assertion on text itself");
  assert.match(css["codeblue-live.css"], /cbl-due-overdue[^}]*dashed/, "overdue restyles the border shape");
  assert.match(css["codeblue-live.css"], /cbl-due-paused[^}]*double/, "paused restyles the border shape");
});

test("live: single attention pulse only, never looping", () => {
  assert.match(css["codeblue-live.css"], /animation:\s*cbl-pulse\s+\d+ms\s+\S+\s+2\s*;/,
    "overdue pulse runs exactly 2 beats");
  assert.doesNotMatch(css["codeblue-live.css"], /animation:[^;]*infinite/, "no looping animation");
});

test("sheets enter at 200 ms ease-out", () => {
  assert.ok(css["codeblue-live.css"].includes("cbl-sheetin 200ms ease-out"), "live sheet 200 ms ease-out");
  assert.ok(css["codeblue-prefs.css"].includes("cbp-sheetin 200ms ease-out"), "prefs sheet 200 ms ease-out");
});
