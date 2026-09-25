/* Energy (2026-09-25): pins for the home tile-icon pause, the detached FAB probe and the live
 * doctor's parked frame loop. Browser behaviour: test/run-energy-home-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../redesign-system.css", import.meta.url), "utf8");

test("the detached Home FAB is no longer probed; the safety tick skips a hidden app", () => {
  assert.match(H, /if \(fab && fab\.isConnected\) refreshFab\(\);/);
  assert.match(H, /setInterval\(function \(\) \{ if \(!document\.hidden\) scheduleFab\(\); \}, 1200\);/);
});

test("tile icons pause while the home is covered or hidden, and per icon when scrolled away", () => {
  assert.match(H, /var still = document\.hidden \|\| document\.body\.classList\.contains\("maik-open"\) \|\| !homeIsForeground\(\);/);
  assert.match(H, /e\.target\.classList\.toggle\("ai-offscreen", !e\.isIntersecting\)/);
  assert.match(CSS, /#homeV2\.hv-still \.ai-anim, #homeV2\.hv-still \.ai-anim \*[^{]*#homeV2 \.ai-offscreen \*\s*\{ animation-play-state: paused !important; \}/);
});

test("the live doctor parks while hidden, swiped away or asleep, and every wake path resumes him", () => {
  assert.match(H, /if \(document\.hidden \|\| box\.classList\.contains\("mkdoc-hidden"\)\) \{ park\(\); return; \}/);
  assert.match(H, /if \(D\.state === "sleep" && D\.sleepPainted >= 2 && !\(sayBub && sayBub\.isConnected\)\) \{ D\.sleepPainted = 0; park\(\); return; \}/);
  assert.match(H, /function wake\(\) \{\n\s*lastAct = performance\.now\(\); resume\(\);/);
  assert.match(H, /D\.until = dur \? D\.t0 \+ dur : 0; resume\(\);/);
  assert.match(H, /if \(!hide && _mkdResume\) _mkdResume\(\);/);
  assert.match(H, /if \(on && _mkdResume\) _mkdResume\(\);/);
  assert.match(H, /_mkdOnVis = function \(\) \{ if \(!document\.hidden\) resume\(\); \};/);
  assert.match(H, /document\.removeEventListener\("visibilitychange", _mkdOnVis\)/);
});
