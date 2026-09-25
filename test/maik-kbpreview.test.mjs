/* MaiK audit follow-ups (2026-09-25): the Knowledge Base preview while the model writes, one figure
 * search per topic, and Knowledge Base footers that render. Browser behaviour is in
 * test/run-maik-kbpreview-ui.mjs; this pins the pieces it relies on. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const KB = readFileSync(new URL("../kb/ai/maik-kb.js", import.meta.url), "utf8");

test("the preview uses the same strict gate as the instant Knowledge Base path, and is on by default", () => {
  assert.match(H, /if \(_kbOn\) \{\n\s*var _lf = _strictKB\(\);/);
  assert.match(H, /if \(!_kbOn && !active && window\.MaiKKB && maikKB\(\) && maikKbPreviewOn\(\)\) \{\n\s*_pvKB = _strictKB\(\);/);
  assert.match(H, /function maikKbPreviewOn\(\) \{ try \{ return localStorage\.getItem\("smd_maik_kb_preview"\) !== "0";/);
});

test("a failed model call keeps the preview as the answer", () => {
  assert.match(H, /if \(r && r\.error && _pvKB\) \{ finishKB\(_pvKB, pkg, "preview"\); return; \}/);
});

test("figures: one search per topic per session, one strip per topic per thread", () => {
  const fn = H.slice(H.indexOf("function maikFiguresStrip("), H.indexOf("function maikRenderAnswer("));
  assert.match(fn, /_maikFigMemo\[fkey\] \|\| \(_maikFigMemo\[fkey\] = SMD_AI\.figures\(/);
  assert.match(fn, /if \(shown\(\)\) return;/);
  assert.match(fn, /strip\.setAttribute\("data-topic", fkey\)/);
});

test("Knowledge Base footers use *italics* (the renderer has no _italics_) and carry no em dash", () => {
  assert.doesNotMatch(KB, /_" \+ citeSrc\(t\)|citeSrc\(t\) \+ "[^"]*_"/);
  assert.doesNotMatch(KB, /decision-support \u2014/);
  assert.match(KB, /"\\n\*" \+ citeSrc\(t\) \+ " · decision-support, verify with local protocol\.\*"/);
});
