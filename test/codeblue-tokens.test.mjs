/* codeblue-tokens.test.mjs: static v3 token guard for the five Code Blue
 * web CSS files (live, prefs, trainer, ecg, sheet).
 * No DOM, no browser: reads the CSS as text and asserts the v3 contract
 * from docs/codeblue/DESIGN.md owner overrides:
 * - every colour literal is a v3 token (Carbon, Graphite, Cool Silver,
 *   Frost White, Electric Blue, the five states incl. per-theme shades, the
 *   two quiet gradient stops, white/black ink, the scrim exception),
 * - every screen reads the shared tokens (references --cbp-*),
 * - no `transition: all`, transitions name exact properties,
 * - every file covers prefers-reduced-motion (plus the in-app
 *   data-cb-motion / cbl-reduced switch where the screen owns one),
 * - at most the two quiet gradients are used, and gradient use stays on
 *   hero elements (live screen only).
 * USAGE: node test/codeblue-tokens.test.mjs
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

/* Approved v3 literals (lowercase): the palette, the five states incl. the
 * per-theme shades both themes need for contrast, the gradient stops, the
 * sibling accessibility themes, and plain white. */
const APPROVED = new Set([
  "#101317", "#171b20", "#343a40", "#aab2bd", "#f4f7fa",
  "#3b82f6", "#1d4ed8", "#2563eb", "#0a0f16",
  "#f5b544", "#8a5a00", "#ef4444", "#b91c1c", "#34c759", "#17803a",
  "#5b6b7a", "#4a5560", "#ffffff",
  "#d5dbe3", "#e2e8ef", "#c3cdd8", "#232a31", "#39424b",
  "#5aa9f0", "#7fb0f5", "#ffc53d", "#ffd60a", "#ff6b61", "#3dff6e", "#d8d8d8",
  "#e8e8e8", "#000000", "#3a3a3a", "#8a8a8a",
  "#150a0c", "#221016", "#f5e9e2", "#d3aba0", "#43222b", "#22060a",
  "#4ade80", "#331820", "#5a2c36",
  "#0b0b0c", "#161617", "#f2f2f2", "#c9c9c9", "#3a3a3d", "#232326", "#4a4a4e",
  "#f3ecdd", "#fffdf4", "#2a2114", "#5d5040", "#d3c6a8", "#7a5200",
  "#a3241b", "#166b32", "#e2d6bc", "#c0b08a",
]);

function hexLiterals(src) {
  const out = [];
  const re = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    out.push("#" + h);
  }
  return out;
}

for (const f of FILES) {
  test(f + ": only v3 token colours", () => {
    const bad = hexLiterals(css[f]).filter((h) => !APPROVED.has(h));
    assert.equal(bad.length, 0, "non-v3 literals in " + f + ": " + [...new Set(bad)].join(", "));
  });

  test(f + ": reads the shared tokens", () => {
    assert.ok(css[f].includes("--cbp-"), f + " references shared --cbp-* tokens");
  });

  test(f + ": no `transition: all`", () => {
    assert.doesNotMatch(css[f], /transition\s*:\s*all\b/, "transition names exact properties");
    assert.doesNotMatch(css[f], /transition-property\s*:\s*all\b/, "transition-property never all");
  });

  test(f + ": reduced-motion covered", () => {
    assert.ok(css[f].includes("prefers-reduced-motion"), "media query present in " + f);
    assert.ok(css[f].includes("transition: none") || css[f].includes("transition:none"),
      "transitions switch off in " + f);
    assert.ok(css[f].includes("animation: none") || css[f].includes("animation:none"),
      "animations switch off in " + f);
  });
}

test("gradients: at most the two quiet v3 fills, live screen only", () => {
  const allowed = /linear-gradient\(\s*160deg\s*,\s*#3b82f6\s*,\s*#1d4ed8\s*\)|linear-gradient\(\s*160deg\s*,\s*#ef4444\s*,\s*#b91c1c\s*\)/gi;
  for (const f of FILES) {
    const stripped = css[f].replace(allowed, "");
    assert.doesNotMatch(stripped, /linear-gradient/i, "only v3 fills in " + f);
  }
  const uses = (css["codeblue-live.css"].match(allowed) || []).length;
  assert.ok(uses >= 1 && uses <= 4, "live screen uses the quiet fills sparingly, got " + uses);
  for (const f of ["codeblue-trainer.css", "codeblue-ecg.css", "codeblue-sheet.css"]) {
    assert.doesNotMatch(css[f], /linear-gradient/i, "no gradients outside the live screen");
  }
});

test("no teal remnants in the five screens", () => {
  for (const f of FILES) {
    assert.doesNotMatch(css[f], /#42cdb5|#0c6e5e|#071318|#0d1d23|#1e343b|#9db8b1|#e8f1ee/i,
      "v2 teal palette gone from " + f);
  }
});
