/* test/followcare-ux.test.mjs — the UX floor for the FollowCare + MAiTRI overlay.
 *
 * Pass done 2026-08-27 with the ui-ux-pro-max rule set. These are the findings that were real,
 * pinned here because each is invisible until the person it affects hits it: a keyboard user, a
 * doctor with a reduced-motion setting, a thumb on a ward round, or dark mode at 3am.
 *
 * Source-level assertions: css() is a private closure that builds one string, and mounting it needs
 * a DOM. What matters is that these rules SHIP; a regression here is someone deleting a line.
 *
 * node --test test/followcare-ux.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../followcare.js", import.meta.url), "utf8");

test("the close button meets the 44x44 touch minimum", () => {
  // It was 34x34. Most-tapped control on the overlay, used one-handed on a ward round.
  const x = SRC.match(/\.fc-hd \.fc-x\{[^}]*\}/);
  assert.ok(x, ".fc-x rule not found");
  assert.match(x[0], /width:44px/);
  assert.match(x[0], /height:44px/);
  assert.ok(!/width:3\dpx/.test(x[0]), "back under the minimum");
});

test("keyboard focus is visible, and visible on the teal header too", () => {
  // There was exactly ONE :focus rule in the module before this.
  assert.match(SRC, /\.fc-sheet :focus-visible\{outline:[^}]*\}/, "no focus ring on the sheet");
  // A teal ring on the teal header is invisible, so that one has to invert.
  assert.match(SRC, /\.fc-hd :focus-visible\{outline-color:#fff/, "focus ring would vanish on the header");
  assert.match(SRC, /body\.dark \.fc-sheet :focus-visible/, "dark mode needs its own ring colour");
});

test("focus-visible, not focus — so touch users never see a stray ring", () => {
  const rings = SRC.match(/:focus-visible/g) || [];
  assert.ok(rings.length >= 3, `expected the ring rules, found ${rings.length}`);
});

test("reduced motion reaches the CSS, including the INFINITE hero animations", () => {
  // The pre-existing _RM guard only covered the motion.dev helpers. .mai-aura and .mai-dot run
  // `infinite`: unstoppable continuous motion on a clinical dashboard.
  assert.match(SRC, /@media \(prefers-reduced-motion:reduce\)\{/, "no CSS reduced-motion block");
  const block = SRC.slice(SRC.indexOf("@media (prefers-reduced-motion:reduce){"));
  assert.match(block, /animation-iteration-count:1!important/, "infinite animations must be stopped");
  assert.match(block, /\.mai-aura\{animation:none/, "the MAiTRI aura is the loudest one");
  assert.match(block, /transition-duration:\.001ms!important/);
});

test("the infinite animations still exist to be guarded (the guard is not dead code)", () => {
  // If these stop being infinite the guard is harmless, but this should be revisited rather than
  // silently passing against nothing.
  assert.match(SRC, /\.mai-aura\{[^}]*animation:maiAura [^}]*infinite/);
  assert.match(SRC, /\.mai-dot\{animation:maiPulse [^}]*infinite/);
});

test("the 'soon' chip is not the brightest thing on a dark screen", () => {
  // Light amber (#ffe9c7) on a dark card, marking the LEAST important item.
  assert.match(SRC, /body\.dark \.fc-sheet \.fc-act \.fc-soon[^}]*\}/, "no dark rule for .fc-soon");
  const dark = SRC.match(/body\.dark \.fc-sheet \.fc-act \.fc-soon[^{]*\{([^}]*)\}/);
  assert.ok(!/#ffe9c7/.test(dark[1]), "still the light-mode fill in dark mode");
});

test("the urgent badge uses text presentation, so iOS does not draw a colour emoji", () => {
  // A bare U+26A0 renders as the yellow-and-black emoji on iOS, inside a red-styled clinical badge.
  const red = SRC.match(/red:\s*\{[^}]*\}/);
  assert.ok(red, "the red escalation entry moved");
  assert.match(red[0], /\\u26a0\\ufe0e/, "variation selector-15 missing from the urgent icon");
});

test("severity is never carried by colour alone", () => {
  // The rule the ui-ux-pro-max accessibility set flags hardest. The module already satisfied it;
  // this keeps it that way.
  for (const level of ["red", "orange", "yellow", "green"]) {
    const m = SRC.match(new RegExp(level + ":\\s*\\{[^}]*\\}"));
    assert.ok(m, `escalation ${level} not found`);
    assert.match(m[0], /label:\s*"[^"]+"/, `${level} lost its text label`);
  }
});
