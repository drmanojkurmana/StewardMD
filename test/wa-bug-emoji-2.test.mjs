/* Second WhatsApp bug-testing batch (2026-08-23, via a friend's PDF export) — static source
 * assertions for the decorative-emoji removals and menu cleanup. Companion to wa-bug-emoji.test.mjs
 * (the first batch); kept separate since this batch came from a different report/session.
 * USAGE: node --test test/wa-bug-emoji-2.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("index.html: My Cases header carries no folder emoji", () => {
  const s = read("index.html");
  assert.ok(!s.includes('class="mcp-title">📂'), "folder emoji should be gone from the My Cases title");
  assert.ok(s.includes('class="mcp-title">My Cases<'), "the title text itself is untouched");
});

test("app.js: My Cases empty state carries no clipboard emoji", () => {
  const s = read("app.js");
  assert.ok(!s.includes('mcp-empty-icon'), "the empty-state icon wrapper is fully removed, not just emptied");
  assert.ok(s.includes("No saved cases yet"), "the empty-state copy itself is untouched");
});

test("index.html: the Medical Disclaimer warning carries no emoji", () => {
  const s = read("index.html");
  assert.ok(!s.includes("⚠️ For qualified"), "warning triangle emoji should be gone");
  assert.ok(s.includes(">For qualified medical professionals only<"), "the warning text itself is untouched");
});

test("electrolytes.js: the Electrolyte Correction screen carries no decorative emoji", () => {
  const s = read("electrolytes.js");
  for (const e of ["🧪", "🧮", "🚨", "💡", "🔴", "🟠", "🟢"]) {
    assert.ok(!s.includes(e), `emoji ${e} should be gone from electrolytes.js`);
  }
  assert.ok(!s.includes("function dot("), "the redundant severity-dot emoji helper is removed entirely, not just unused");
  assert.ok(s.includes("Electrolyte Correction Engine") && s.includes("Analyze & Generate ICU Recommendations"), "the surrounding copy is untouched");
});

test("caseshare.js: the Open shared case modal header carries no magnifying-glass emoji", () => {
  const s = read("caseshare.js");
  assert.ok(!s.includes("🔎"), "magnifying glass emoji should be gone");
  assert.ok(s.includes("<h3>Open shared case</h3>"), "the header text itself is untouched");
});

test("home.js: Notification preferences rows carry no per-category emoji", () => {
  const s = read("home.js");
  const i = s.indexOf("var NOTIF_CATS = [");
  assert.ok(i > -1, "NOTIF_CATS still exists");
  const cats = s.slice(i, s.indexOf("];", i) + 2);
  for (const e of ["🗒️", "🚨", "🧪", "📘", "📣"]) {
    assert.ok(!cats.includes(e), `emoji ${e} should be gone from the notification category list (these emoji legitimately exist elsewhere in home.js, e.g. an unrelated emoji-name lookup table - scoped the check to NOTIF_CATS specifically)`);
  }
  assert.ok(!s.includes("np-cico"), "the now-empty icon wrapper span is removed too, not left empty");
  assert.ok(cats.includes('"Tasks & assignments"') && cats.includes('"General app notifications"'), "the category labels themselves are untouched");
});

test("home.js: the Medical Updates read-time badge carries no clock emoji", () => {
  const s = read("home.js");
  const matches = [...s.matchAll(/fd-read">([^<]*)</g)];
  assert.ok(matches.length === 2, `both read-time badge sites found (${matches.length})`);
  for (const m of matches) assert.ok(!m[1].includes("⏱"), `stopwatch emoji should be gone from the read-time badge (got "${m[1]}")`);
  // A THIRD, unrelated ⏱ (MaiK AI response-time diagnostics, a flagged-off debug display) still
  // legitimately exists elsewhere in home.js - it wasn't part of this report and wasn't touched.
});

test("home.js: the More screen no longer duplicates sidebar navigation", () => {
  const s = read("home.js");
  const i = s.indexOf("function openMore() {");
  assert.ok(i > -1, "openMore() still exists");
  // openSheet(...) is one big call; its closing ");" (followed by the function's own closing brace
  // on the next line) marks the end of the row list, well before the next function() declaration.
  const j = s.indexOf("\n    );", i);
  assert.ok(j > i, "found the end of the row list");
  const body = s.slice(i, j);
  assert.ok(!body.includes("New design"), "the old-UI switch-back toggle is removed from More");
  assert.ok(!body.includes('mi("info", "About StewardMD"'), "About StewardMD (duplicated by the sidebar's combined About & Acknowledgements row) is removed from More");
  assert.ok(!body.includes('mi("award", "Acknowledgements"'), "Acknowledgements is removed from More");
  assert.ok(!body.includes('mi("book", "Guidelines'), "Guidelines & References (duplicated by the sidebar) is removed from More");
  assert.ok(!body.includes('mi("calc", "Calculators"'), "Calculators (duplicated by the sidebar) is removed from More");
  // What SHOULD still be there — this isn't a wholesale gutting of the screen.
  assert.ok(body.includes('"opencase"') && body.includes('"notifprefs"') && body.includes('"account"'), "rows that are NOT duplicated elsewhere stay in More");
});

test("sidebar-redesign.js: confirms the rows removed from More really are reachable elsewhere", () => {
  const s = read("sidebar-redesign.js");
  assert.ok(s.includes('row("calculators", "calc", "Calculators")'), "Calculators exists in the live sidebar");
  assert.ok(s.includes('row("guidelines", "book", "Guidelines &amp; Protocols")'), "Guidelines exists in the live sidebar");
  assert.ok(s.includes('row("ack", "award", "About &amp; Acknowledgements")'), "a combined About & Acknowledgements row exists in the live sidebar");
});

test("home.js: .hv-sheet (the More sheet, and every other sheet) dark-themes", () => {
  const s = read("home.js");
  assert.ok(s.includes("body.dark .hv-sheet{"), "a dark-mode override for .hv-sheet exists (it used to only exist scoped to #homeV2, which .hv-sheet is never a descendant of)");
});
