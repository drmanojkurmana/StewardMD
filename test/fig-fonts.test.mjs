// Interactive figures use a clean system sans, never a code-style monospace (owner rule, 2026-10-18).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const DIR = fileURLToPath(new URL("../prep/figures/", import.meta.url));
const pages = readdirSync(DIR).filter((f) => f.endsWith(".html"));
test("every figure page sets its text font to the system sans, not a monospace stack", () => {
  assert.ok(pages.length > 100);
  const bad = pages.filter((f) => { const s = readFileSync(DIR + f, "utf8"); return /monospace|Menlo|Consolas/i.test(s.replace(/<script[\s\S]*?<\/script>/g, "")) || !s.includes('"SF Pro Text"'); });
  assert.deepEqual(bad, []);
});
test("the shared figure.css keeps the sans override for regenerated pages", () => {
  const css = readFileSync(fileURLToPath(new URL("../tools/figures/figure.css", import.meta.url)), "utf8");
  assert.match(css, /--anatomy-mono:-apple-system/);
});
