/* WhatsApp bug-testing group report, 2026-08-22: 7 separate "remove this AI emoji" messages, each
 * with a screenshot circling one decorative emoji in the app chrome (banners, badges, tooltips, a
 * contribution CTA). Static source assertions - no browser needed, these are plain string checks
 * against the shipped markup.
 * USAGE: node --test test/wa-bug-emoji.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("home.js: no newspaper emoji on the This Week in Medicine banner/badge", () => {
  const s = read("home.js");
  assert.ok(s.includes('"This Week in Medicine"'.slice(1, -1)) || s.includes(">This Week in Medicine<"));
  assert.ok(!s.includes("📰"), "newspaper emoji should be gone from home.js entirely");
});

test("reasoning.js: no star badge on ICMR, no gear on the Reasoning v2 toggle", () => {
  const s = read("reasoning.js");
  assert.ok(!s.includes("⭐"), "star emoji should be gone from reasoning.js");
  assert.ok(!s.includes("⚙"), "gear glyph should be gone from the Reasoning v2 toggle label");
  assert.ok(s.includes('opt("ICMR", icmr.name)'), "ICMR option no longer carries a decorative extra arg");
});

test("app.js: no microscope emoji in the search empty state", () => {
  const s = read("app.js");
  assert.ok(!s.includes('sp-empty-icon">🔬</div>'), "the empty-state's microscope emoji should be gone");
  assert.ok(s.includes("Search any disease, antibiotic, or calculator"), "the empty-state copy itself is untouched");
  // The shared emoji->icon lookup table's own 🔬 KEY is unrelated (maps to the "flask" icon
  // elsewhere) and is deliberately left alone - this isn't a decorative-emoji bug.
  assert.ok(s.includes('"🔬":"flask"'), "the unrelated emoji->icon lookup entry is untouched");
});

test("onboarding.js: no compass emoji; the two stale 'Coming soon' module tours are gone", () => {
  const s = read("onboarding.js");
  assert.ok(!s.includes("🧭"), "compass emoji should be gone from onboarding.js");
  assert.ok(!s.includes('function soon('), "the dead 'Coming soon' card renderer is removed, not just unused");
  assert.ok(!s.includes('<div class="s">Coming soon</div>'), "no tour should claim a live module is 'Coming soon'");
  assert.ok(!s.includes('<div class="smdt-rp-sec">MODULE TOURS</div>'), "the now-empty Module Tours section header is gone too");
  assert.ok(s.includes('card(obIco("grid"), "App overview"'), "App overview now uses the shared icon set, not a raw emoji");
});

test("index.html: the contribution CTA box carries no emoji", () => {
  const s = read("index.html");
  const i = s.indexOf("Want your name here?");
  assert.ok(i > -1, "contribution box still present");
  const box = s.slice(i - 300, i + 2500);
  for (const e of ["🤝", "🐛", "📋", "💡", "🔧"]) {
    assert.ok(!box.includes(e), `emoji ${e} should be gone from the contribution box`);
  }
  assert.ok(box.includes(">Report a bug<") && box.includes(">Clinical review<") && box.includes(">Suggest a feature<") && box.includes(">Development<"), "the four tag labels are intact");
});

test("antibiogram.js: no rotate emoji in the 'rotate your phone' tooltip", () => {
  const s = read("antibiogram.js");
  assert.ok(!s.includes("🔄"), "rotate emoji should be gone from antibiogram.js");
  assert.ok(s.includes('abIco("refresh")'), "tooltip now uses the shared icon set instead");
});

test("api.js: Drugs Database detail-page close button states what it does (home, not a bare X)", () => {
  const s = read("api.js");
  assert.ok(s.includes('aria-label="Close and return home"'), "aria-label now says what the button actually does");
  assert.ok(s.includes('id="dbClose" aria-label="Close and return home">\' + dbIco("home")'), "close button now renders the home icon, not the close/X icon");
  // The brands-drawer's own dismiss ("X") is a different, correctly-scoped control - untouched.
  assert.ok(s.includes('id="dbDwx" aria-label="Close brands">\' + dbIco("close")'), "the brands drawer's own close button is unchanged");
});
