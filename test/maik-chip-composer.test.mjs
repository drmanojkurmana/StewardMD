/* test/maik-chip-composer.test.mjs — the model chip lives in the composer, not the header.
 *
 * Owner screenshot, 2026-09-20 ("MAIK UI ISSUE NOT FITTING"): the chip sat in a 150px header slot
 * where "MAiK Lite (not ready)" could never fit; the sketch drew it into the composer's bottom row,
 * between the tool buttons and Send. That cell is the one flexible slot in the composer grid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../maik-polish.css", import.meta.url), "utf8");

test("the chip is rendered inside the composer, after the tool buttons and before the textarea", () => {
  const shell = HOME.slice(HOME.indexOf("function maikShellHTML()"), HOME.indexOf("function maikShellHTML()") + 9000);
  const hdr = shell.slice(shell.indexOf('<div class="maik-hd">'), shell.indexOf('<div class="maik-body"'));
  assert.doesNotMatch(hdr, /chipHTML\(\)/, "no chip in the header any more");
  const cmp = shell.slice(shell.indexOf('<div class="maik-cmp">'));
  const chipAt = cmp.indexOf("SMD_MAIK_ENGINE.chipHTML()");
  assert.ok(chipAt > 0, "chip is in the composer");
  assert.ok(cmp.indexOf('id="maikImgFile"') < chipAt && chipAt < cmp.indexOf('id="maikQ"'), "placed after the tool buttons, before the textarea");
});

test("the polished grid puts the chip in the flexible bottom-row cell, hugging Send, with a 44px target", () => {
  assert.match(CSS, /#maikModelChip\{grid-column:4;grid-row:2;justify-self:end;[^}]*min-height:44px/);
  assert.match(CSS, /#maikSend\{grid-column:5;grid-row:2/);
  assert.match(CSS, /\.maik-cmp-in:has\(#maikExtract\.show\) #maikModelChip\{max-width:calc\(100% - 52px\)!important\}/, "yields to the extract button when it shows");
  assert.doesNotMatch(CSS, /#maikModelChip\{grid-column:3;grid-row:1/, "the old header placement is gone");
});

test("the header grid no longer reserves a third column for it", () => {
  assert.match(CSS, /\.maik-hd-row\{grid-template-columns:44px 1fr;gap:4px 8px\}/);
  assert.doesNotMatch(CSS, /minmax\(110px,150px\)/);
});
