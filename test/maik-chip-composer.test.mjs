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

test("the polished grid puts the chip in the bottom row's own track, hugging Send, with a 44px target", () => {
  // 2026-09-26 symmetry pass: the chip has its own minmax(0,auto) track right of the flexible spacer,
  // so it takes its full width first and truncates only when the row is truly full.
  assert.match(CSS, /#maikModelChip\{grid-column:6;grid-row:2;[^}]*min-height:44px/);
  assert.match(CSS, /#maikSend\{grid-column:7;grid-row:2/);
  // Audit T05: the length pill has its own content-sized cell (it was auto-placed into a 44 px track and clipped).
  assert.match(CSS, /grid-template-columns:auto auto auto auto minmax\(8px,1fr\) minmax\(0,auto\) 44px/);
  assert.match(CSS, /#maikLen\{grid-column:4;grid-row:2;[^}]*min-height:44px/);
  // Extract findings moved to the text row, so it no longer takes width from the chip when it shows.
  assert.match(CSS, /#maikExtract\{grid-column:7;grid-row:1;/);
  assert.doesNotMatch(CSS, /#maikExtract\.show\) #maikModelChip/);
  assert.doesNotMatch(CSS, /#maikModelChip\{grid-column:3;grid-row:1/, "the old header placement is gone");
});

test("the header grid has no column for the chip (its third column is Close)", () => {
  // The second track is minmax(0,1fr) since #1236 made every grid column track minmax(0,1fr) repo-wide
  // (a bare 1fr keeps its min-content width and can overflow the phone). The third, auto, is Close.
  assert.match(CSS, /\.maik-hd-row\{grid-template-columns:44px minmax\(0,1fr\) auto;gap:4px 8px\}/);
  assert.match(CSS, /#maikClose\{grid-column:3;grid-row:1;/);
  assert.doesNotMatch(CSS, /minmax\(110px,150px\)/);
});
