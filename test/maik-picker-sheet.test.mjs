/* test/maik-picker-sheet.test.mjs — the model picker scrolls, closes, and shows bars per model.
 * Owner screenshot 2026-09-21: twelve rows overflowed the screen, no scroll, no way back, prose only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");
const picker = SRC.slice(SRC.indexOf("function openPicker()"), SRC.indexOf("function wireChip("));

test("the sheet is height-capped and the row list scrolls inside it", () => {
  assert.match(picker, /id="maikModelSheetInner" style="display:flex;flex-direction:column;[^"]*max-height:min\(88dvh,88vh\)/);
  assert.match(picker, /id="maikModelRows" role="listbox" style="flex:1 1 auto;min-height:0;overflow-y:auto/);
});

test("there is a 44px close button and it closes the picker", () => {
  assert.match(picker, /data-mk-close="1" aria-label="Close" style="width:44px;height:44px/);
  assert.match(picker, /closest\("\[data-mk-close\]"\)\)\) closePicker\(\)/);
});

test("on-device rows carry Depth and Speed bars plus the size; hosted rows do not", () => {
  assert.match(picker, /function metersHTML\(o\) \{\n\s+if \(!o\.pack\) return "";/);
  assert.match(picker, /meterHTML\("Depth", depth\) \+ meterHTML\("Speed", speed\)/);
  assert.match(picker, /M\.sizeLabel\(o\.pack\)/);
  assert.match(picker, /aria-label="' \+ label \+ ' ' \+ n \+ ' of 3"/, "bars are readable by a screen reader");
});

test("the redundant OFFLINE badge is dropped on on-device rows", () => {
  assert.match(picker, /var badge = \(o\.pack && o\.badge === "OFFLINE"\) \? "" : o\.badge;/);
});
