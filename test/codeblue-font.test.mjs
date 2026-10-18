/* codeblue-font.test.mjs: every Code Blue screen uses the shared Inter
 * CodeBlue token. Fails if any Code Blue stylesheet sets a serif or
 * leaves a text container without the shared font-family.
 * USAGE: node --test test/codeblue-font.test.mjs
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

const ROOTS = {
  "codeblue-live.css": "#cblRoot",
  "codeblue-prefs.css": "#cbpRoot",
  "codeblue-trainer.css": "#cbtRoot",
  "codeblue-ecg.css": ".cbecg",
  "codeblue-sheet.css": ".cb-sheet",
};

for (const f of FILES) {
  test(f + ": no serif or Times font-family anywhere", () => {
    assert.doesNotMatch(css[f], /font-family\s*:[^;}]*\b(serif|Times|Georgia)\b/i,
      "serif fallback in " + f);
  });
  test(f + ": relative @font-face resolves from the stylesheet", () => {
    assert.match(css[f], /@font-face\s*\{[^}]*font-family:\s*"Inter CodeBlue"[^}]*src:\s*url\("fonts\/inter-codeblue-opsz\.woff2"\)/,
      "relative font URL in " + f);
  });
  test(f + ": text root uses the one shared token", () => {
    const root = ROOTS[f].replace(/[.#]/g, "\\$&");
    const re = new RegExp(root + "\\s*\\{[^}]*--cbp-font:\\s*\"Inter CodeBlue\", system-ui, sans-serif[^}]*font-family:\\s*var\\(--cbp-font\\)");
    assert.match(css[f], re, ROOTS[f] + " shared font token in " + f);
    const rootBlock = new RegExp(root + "\\s*\\{([^}]*)\\}").exec(css[f]);
    assert.ok(rootBlock, ROOTS[f] + " root block in " + f);
    assert.doesNotMatch(rootBlock[1], /font-variant-numeric\s*:\s*tabular-nums|font-feature-settings[^;]*tnum/,
      ROOTS[f] + " root must not set tabular figures on running text in " + f);
  });
}
