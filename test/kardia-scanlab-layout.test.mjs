import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../kardia-scanlab.css", import.meta.url), "utf8");
const hostCss = readFileSync(new URL("../kardia.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");

test("phone layout is a scrolling column: scene, coach, monitor, picker, then tutorial below", () => {
  assert.match(css, /\.ksl-wrap\{[^}]*overflow:visible/);
  assert.match(css, /\.ksl-pickerbar\{[^}]*position:static/);
  assert.ok(!/\.ksl-pickerbar\{[^}]*position:sticky/.test(css), "picker is never sticky over the monitor");
  assert.match(css, /\.ksl-stage\{[^}]*min-height:260px/);
  assert.match(css, /\.ksl-monitor-wrap\{[^}]*aspect-ratio:4\/3[^}]*min-height:280px/);
  assert.match(css, /\.ksl-coach\{[^}]*position:static/);
  assert.match(hostCss, /\.krd-root \{\s*height:100dvh/);
  const scene = js.indexOf('class="ksl-scene-col"');
  const coach = js.indexOf('id="kslCoach"');
  const monitor = js.indexOf('class="ksl-monitor-col"');
  const result = js.indexOf('id="kslResult"');
  const picker = js.indexOf('class="ksl-pickerbar"');
  const tutorial = js.indexOf('id="kslTutorial"');
  assert.ok(scene > 0 && coach > scene && monitor > coach && result > monitor && picker > result && tutorial > picker, "coach under scene, monitor before picker, tutorial below picker");
  assert.ok(js.includes('T.byId("plax")'), "first open starts at PLAX");
});

test("SyncProbe is a 44px round icon button in the scene row; its text label lives in tutorial and Practice sheet", () => {
  assert.match(js, /class="ksl-iconbtn" id="kslSyncProbe"[^>]*aria-label="Use a phone as the probe"/);
  assert.match(css, /\.ksl-iconbtn\{width:44px;height:44px/);
  assert.ok(js.includes('id="kslTutSyncProbe"') && js.includes("<span>Use a phone as the probe</span>"), "tutorial keeps the text label");
  assert.ok(js.includes('id="kslPracticeSyncProbe"') && js.includes("Practice this view"), "Practice sheet keeps the text label");
  assert.match(css, /\.ksl-viewname\{[^}]*max-width:calc\(100% - 182px\)/, "view title chip leaves the icon row clear");
});

test("result clears after 2.5s and tab strips scroll with an edge fade", () => {
  assert.ok(js.includes("}, 2500);"), "result toast clears after 2.5 seconds");
  assert.match(hostCss, /\.krd-tabs \{[^}]*overflow-x: auto/);
  assert.match(hostCss, /\.krd-tabs \{[^}]*mask-image: linear-gradient\(to right, #000 0, #000 calc\(100% - 28px\), transparent 100%\)/);
  assert.match(css, /\.ksl-windows\{[^}]*overflow-x:auto[^}]*mask-image:linear-gradient\(to right,#000 0,#000 calc\(100% - 24px\),transparent 100%\)/);
});

test("accessibility gates: names, focus, reduced motion", () => {
  assert.ok(js.includes('aria-label="Use a phone as the probe"'));
  assert.match(css, /focus-visible\{outline:2px solid var\(--sp-acc\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
