// ipad-native.js: the hardware-keyboard map is navigation only, and leaves typing alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keyAction, SHORTCUTS } = require("../ipad-native.js");
const k = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...o });

test("Command shortcuts map to navigation actions", () => {
  assert.equal(keyAction(k("[", { metaKey: true })), "back");
  assert.equal(keyAction(k(",", { metaKey: true })), "settings");
  assert.equal(keyAction(k("/", { metaKey: true })), "help");
  assert.equal(keyAction(k("1", { metaKey: true })), "tab1");
  assert.equal(keyAction(k("5", { ctrlKey: true })), "tab5");
  assert.equal(keyAction(k("6", { metaKey: true })), null);
});

test("typing in a field keeps Cmd+digit for the field, not the tab bar", () => {
  assert.equal(keyAction(k("2", { metaKey: true }), { typing: true }), null);
  assert.equal(keyAction(k("[", { metaKey: true }), { typing: true }), "back");
});

test("Escape only closes what this layer owns", () => {
  assert.equal(keyAction(k("Escape")), null);
  assert.equal(keyAction(k("Escape"), { sheetOpen: true }), "sheet-close");
  assert.equal(keyAction(k("Escape"), { sheetOpen: true, helpOpen: true }), "help-close");
});

test("plain keys, Option, Shift and IME composition are ignored", () => {
  assert.equal(keyAction(k("1")), null);
  assert.equal(keyAction(k("[", { metaKey: true, altKey: true })), null);
  assert.equal(keyAction(k("[", { metaKey: true, shiftKey: true })), null);
  assert.equal(keyAction(k("1", { metaKey: true, isComposing: true })), null);
});

