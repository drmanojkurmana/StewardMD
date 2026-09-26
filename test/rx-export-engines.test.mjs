/* Saving a prescription as JPEG or PDF must actually produce a file.
 *
 * It did not. prescription.js loads html2canvas and jsPDF on demand through window.smdLazy, but
 * lazy-load.js -- the only thing that defines smdLazy -- was never referenced from index.html. The
 * export path then fell back to `window.smdLazy || function () { return Promise.resolve(); }`, and
 * that fallback is the whole bug: it RESOLVED WITHOUT LOADING ANYTHING, so html2canvas stayed
 * undefined, the call threw inside a promise nobody was watching, and tapping Save as JPEG or PDF
 * did nothing at all. No file, no error, no clue.
 *
 * These assertions are deliberately about reachability and honesty rather than rendering: the
 * rendering works, and did all along. What failed was the plumbing that was supposed to bring the
 * engines in, and a fallback that reported a success it had not achieved. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const rxRaw = readFileSync(join(ROOT, "prescription.js"), "utf8");
// Assertions about CODE must not match the comments that explain the bug: the block comment above
// exportRx quotes the old fallback verbatim, and a naive grep scored that as the bug still present.
const rx = rxRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the vendor bundles the export needs are actually in the repo", () => {
  for (const f of ["vendor-html2canvas.js", "vendor-jspdf.js", "lazy-load.js"]) {
    assert.ok(existsSync(join(ROOT, f)), f + " is missing");
  }
});

test("index.html loads the lazy loader, or nothing defines window.smdLazy", () => {
  assert.match(html, /<script src="\/lazy-load\.js\?v=/,
    "lazy-load.js is not referenced: smdLazy is undefined and the export silently does nothing");
  // and it must come before the module that depends on it
  assert.ok(html.indexOf("/lazy-load.js") < html.indexOf("/prescription.js"),
    "lazy-load.js must load before prescription.js");
});

test("the export never falls back to a loader that resolves without loading", () => {
  assert.equal(/smdLazy \|\| function \(\) \{ return Promise\.resolve\(\); \}/.test(rx), false,
    "a fallback that reports success it did not achieve is what made this fail silently");
  assert.ok(rx.includes("function rxLazy"), "there is no real fallback loader");
  assert.ok(/s\.onerror = function \(\) \{ reject\(/.test(rx),
    "the fallback loader must REJECT on failure, not resolve");
});

test("a failure reaches the catch instead of vanishing as an unhandled rejection", () => {
  assert.ok(/return rxIssueVerification\(/.test(rx),
    "the inner promise must be returned or its failure never reaches the catch");
  assert.ok(/return window\.html2canvas\(node/.test(rx),
    "exportRxNow must return its promise so a rasterise failure surfaces");
  assert.ok(/if \(!window\.html2canvas\) throw/.test(rx),
    "a missing engine must fail loudly before anything else runs");
});

test("the doctor is told when an export fails", () => {
  assert.ok(/Could not build the/.test(rxRaw), "there is no user-visible failure message");
});
