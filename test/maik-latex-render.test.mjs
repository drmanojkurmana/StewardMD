/* test/maik-latex-render.test.mjs — LaTeX must never reach the bubble (owner screenshot, 2026-09-19).
 * The answer read "patients $>35$ years old" and "defined as $\ge 3$ RBC/HPF": models wrap
 * inequalities in math delimiters and we do not render maths. maikMarkdown() unwraps them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// maikMarkdown lives inside reasoning.js's IIFE; run the file with a window shim and read it back.
const SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const win = { location: { href: "https://stewardmd.in/", search: "" }, navigator: { onLine: true },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {}, querySelector: () => null, head: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }) };
win.window = win;
try { new Function("window", "document", "localStorage", "navigator", "location", SRC)(win, win.document, win.localStorage, win.navigator, win.location); } catch (e) { /* browser-only tails are fine */ }
const md = win.SMD_MaiK && win.SMD_MaiK.renderMarkdown;

test("reasoning.js exposes the markdown renderer", () => { assert.equal(typeof md, "function"); });

test("inline math delimiters are unwrapped, not printed", () => {
  const out = md("Unexplained microscopic hematuria in patients $>35$ years old.");
  assert.match(out, /&gt;35 years old/, "unwrapped, then HTML-escaped as it must be");
  assert.doesNotMatch(out, /\$/);
});

test("LaTeX operators become their characters", () => {
  const out = md("microscopic urinalysis (defined as $\\ge 3$ RBC/HPF), 5 \\times 10^9, \\mu g doses");
  assert.match(out, /≥\s?3 RBC\/HPF/);
  assert.match(out, /×/);
  assert.match(out, /µg/);
  assert.doesNotMatch(out, /\$|\\ge|\\times|\\mu/);
});

test("display math and \\( \\) wrappers too", () => {
  assert.doesNotMatch(md("CrCl $$<30$$ mL/min"), /\$/);
  assert.doesNotMatch(md("dose \\(2 g\\) IV"), /\\\(|\\\)/);
});

test("a lone dollar amount is left alone (no false unwrap across lines)", () => {
  const out = md("The kit costs $40 and the assay costs $60.");
  assert.match(out, /\$40/);
  assert.match(out, /\$60/);
});

test("markdown still works around the unwrap", () => {
  const out = md("**Red flags:** gross hematuria in any adult $>35$ years.");
  assert.match(out, /<b>Red flags:<\/b>/);
  assert.match(out, /&gt;35 years/);
});
