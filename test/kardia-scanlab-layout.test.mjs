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

test("Calculators tab is never cut: 16pt gaps, scroll strip, active tab scrolled into view", () => {
  const hostJs = readFileSync(new URL("../kardia.js", import.meta.url), "utf8");
  const prem = readFileSync(new URL("../kardia-premium.css", import.meta.url), "utf8");
  assert.ok(hostJs.includes("Calculators"), "full Calculators label is kept");
  assert.ok(!hostJs.includes('calc: T("Calc"'), "label is not shortened to Calc");
  assert.match(hostCss, /\.krd-tabs \{[^}]*gap: 16px/);
  assert.match(hostCss, /\.krd-tab \{[^}]*padding: 10px 9px/);
  assert.match(hostCss, /\.krd-tabs \{[^}]*overflow-x: auto/);
  assert.match(prem, /\.krd-tabs \{[^}]*gap: 16px/);
  assert.match(prem, /\.krd-tabs \{[^}]*overflow-x: auto/);
  assert.ok(!/\.krd-tabs \{[^}]*overflow-x: visible/.test(prem), "narrow phones keep the scroller, never squeeze");
  assert.ok(hostJs.includes("scrollActiveTabIntoView"), "active tab is scrolled into view after paint");
  assert.ok(hostJs.includes('inline: "center"'), "active tab is centred in the strip");
  assert.ok((hostJs.match(/scrollActiveTabIntoView\(\);/g) || []).length >= 3, "every tab paint scrolls the active tab into view");
  assert.ok(hostJs.includes("updateKrdTabFade"), "right edge fade hides at the far right");
});

test("scene camera homes closer on the left chest, and double tap returns to it", () => {
  assert.match(js, /HOME_ORBIT = \{ yaw: 2\.6, pitch: 0\.32, dist: 600 \}/);
  assert.ok(js.includes("camera.lookAt(8, 28, -32)"), "look target is raised toward the left chest so the neck stays in frame");
  assert.ok(!js.includes("dist: 700"), "the old far framing is gone");
});

test("tablet: scene and monitor side by side and tall, coaching spans, picker wraps, nothing truncated", () => {
  const tablet = css.slice(css.indexOf("@media(min-width:820px)"));
  assert.match(tablet, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/, "equal columns, each at least 48 percent of the row");
  assert.match(tablet, /minmax\(440px,55dvh\)/, "first row targets 55 percent of the viewport height");
  assert.match(tablet, /"coach coach"/, "coaching line spans under both");
  assert.match(tablet, /\.ksl-scene-col,\.krd-root \.ksl-monitor-col\{display:contents\}/);
  assert.match(tablet, /\.ksl-pickerbar \.ksl-windows\{[^}]*flex-wrap:wrap/, "picker wraps at full width");
  assert.match(tablet, /\.ksl-pickerbar \.ksl-views\{[^}]*flex-wrap:wrap/);
  assert.match(tablet, /\.ksl-tut p\{white-space:normal;overflow:visible;text-overflow:clip/, "tutorial text is never truncated");
  assert.ok(!/\.ksl-tut p\{[^}]*text-overflow:ellipsis/.test(tablet), "no tutorial ellipsis on tablet");
  assert.match(tablet, /\.ksl-under-left,\.krd-root \.ksl-under-right\{display:contents\}/, "readouts and credits are not squeezed into a side column");
  assert.match(tablet, /\.ksl-monitor-head\{[^}]*flex-wrap:nowrap/, "clip label, pill and heart rate keep one uncrowded row");
});

test("overlay covers the page and the tab strip scrolls at 402pt and 375pt; the probe is enlarged", () => {
  const prem = readFileSync(new URL("../kardia-premium.css", import.meta.url), "utf8");
  assert.match(prem, /\.krd-root \{ position: fixed; inset: 0[^}]*height: auto/, "the Kardia overlay fully covers the page behind it, safe areas included");
  assert.match(prem, /@media \(max-width: 430px\)/, "narrow phone tab scroll applies at 402pt and 375pt");
  assert.match(prem, /\.krd-root \.krd-tabs \{[^}]*overflow-x: auto/, "narrow phones scroll, none cut or overlapped");
  assert.match(prem, /\.krd-root \.krd-tab \{[^}]*flex: 0 0 auto/, "tabs keep their width and never squeeze");
  assert.match(js, /setScalar\(1\.5\)/, "probe is scaled up from the contact point");
  assert.match(css, /\.ksl-handle\{[^}]*width:34px/, "the grip ring no longer covers the probe lens");
});

test("accessibility gates: names, focus, reduced motion", () => {
  assert.ok(js.includes('aria-label="Use a phone as the probe"'));
  assert.match(css, /focus-visible\{outline:2px solid var\(--sp-acc\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
