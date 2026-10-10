// PrepNucleus floating glass tab bar (prep-nav.js + prep-nav.css): pure rules, contrast of the shipped tints, wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = createRequire(import.meta.url)(join(ROOT, "prep-nav.js"));
const css = fs.readFileSync(join(ROOT, "prep-nav.css"), "utf8");

test("tabs: Home, Learn, Tests, You; Learn only with lessons", () => {
  assert.deepEqual(P.tabsFor(true).map((t) => t.label), ["Home", "Learn", "Tests", "You"]);
  assert.deepEqual(P.tabsFor(false).map((t) => t.id), ["home", "tests", "you"]);
});

test("current tab is the nearest tab root down the stack", () => {
  assert.equal(P.tabOf(["home"]), "home");
  assert.equal(P.tabOf(["home", null, null]), "home");          // home > subject > module
  assert.equal(P.tabOf(["home", "you", null]), "you");          // home > menu > bookmarks
  assert.equal(P.tabOf(["home", "learn", null]), "learn");      // home > learn > a subject's lessons
  assert.equal(P.tabOf([]), "home");
});

test("shown only on a browse screen with nothing over it", () => {
  assert.equal(P.showOn({ screen: true }), true);
  assert.equal(P.showOn({ screen: false }), false);
  assert.equal(P.showOn({ screen: true, sheet: true }), false);
  assert.equal(P.showOn({ screen: true, viewer: true }), false);
  assert.equal(P.showOn({ screen: true, keyboard: true }), false);
  assert.equal(P.showOn(null), false);
});

test("a press: switch, pop to the tab's root, or scroll to the top", () => {
  assert.deepEqual(P.pressOf("home", "tests", -1, 1), { k: "go" });
  assert.deepEqual(P.pressOf("home", "home", 0, 1), { k: "top" });
  assert.deepEqual(P.pressOf("home", "home", 0, 3), { k: "pop", i: 0 });
  assert.deepEqual(P.pressOf("learn", "learn", 1, 3), { k: "pop", i: 1 });
  assert.deepEqual(P.pressOf("you", "you", 1, 2), { k: "top" });
});

// The shipped tints and inks, read from prep-nav.css, keep 4.5:1 over any page colour PrepNucleus paints under the bar.
function rgba(s) { const m = /rgba?\(([^)]+)\)/.exec(s); const p = m[1].split(",").map((x) => parseFloat(x)); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
function hex(s) { const h = s.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function block(sel) { const i = css.indexOf(sel + " {"); return css.slice(i, css.indexOf("}", i)); }
function val(b, name) { return new RegExp("--" + name + ":\\s*([^;]+);").exec(b)[1].trim(); }
const PAGES = [[255, 255, 255], [0, 0, 0], [0x1a, 0x1a, 0x2e], [0x16, 0x21, 0x3e], [0x0f, 0x34, 0x60], [0xef, 0xc0, 0x7b], [0xf3, 0xf2, 0xee], [0x13, 0x20, 0x3d]];
test("labels keep 4.5:1 on the glass over white, black, Midnight, Navy, Prussian, amber, paper and ink", () => {
  const light = block(".pn-root"), dark = block("body.dark .pn-root");
  const ink = { light: hex("#2a3654"), dark: hex(val(dark, "pnv-ink")) };
  assert.equal(val(light, "pnv-ink"), "#2a3654");
  const on = { light: hex("#0f3460"), dark: hex("#efc07b") };   // var(--pn-c-prussian), var(--pn-c-amber)
  for (const [k, b] of [["light", light], ["dark", dark]]) {
    const t = rgba(val(b, "pnv-tint")), pill = rgba(val(b, "pnv-pill"));
    const off = P.worst(ink[k], t.c, t.a, PAGES), sel = P.worst(on[k], t.c, t.a, PAGES, pill.c, pill.a);
    assert.ok(off >= 4.5, k + " unselected " + off.toFixed(2));
    assert.ok(sel >= 4.5, k + " selected " + sel.toFixed(2));
  }
});

test("contrast helper matches WCAG", () => {
  assert.equal(Math.round(P.contrast([0, 0, 0], [255, 255, 255]) * 10) / 10, 21);
  assert.equal(P.contrast([119, 119, 119], [255, 255, 255]).toFixed(2), "4.48");
});

test("lens map: an SVG data URL sized to the bar, neutral inside", () => {
  const u = P.lensMap(358, 64, 13);
  assert.match(u, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(u.slice(u.indexOf(",") + 1));
  assert.match(svg, /width="358" height="64"/);
  assert.match(svg, /fill="rgb\(128,128,0\)"/);
  assert.match(svg, /x="13" y="13" width="332" height="38"/);
});

test("lens only in Chromium (never WebKit, iOS browsers or Firefox)", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
  const wv = "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36";
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const crios = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
  const ff = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
  assert.equal(P.lensOk(chrome, true), true);
  assert.equal(P.lensOk(wv, true), true);
  assert.equal(P.lensOk(chrome, false), false);
  assert.equal(P.lensOk(ios, true), false);
  assert.equal(P.lensOk(crios, true), false);
  assert.equal(P.lensOk(ff, true), false);
});

test("CSS: one backdrop-filter layer, url() only under .pnv-lens, fallbacks for reduced transparency, contrast and motion", () => {
  assert.match(css, /\.pn-root \.pnv\.pnv-lens \{ backdrop-filter: var\(--pnv-lensf\); \}/);
  assert.ok(!/-webkit-backdrop-filter:[^;]*url\(/.test(css), "WebKit never gets url()");
  for (const q of ["prefers-reduced-transparency: reduce", "prefers-contrast: more", "prefers-reduced-motion: reduce"]) assert.ok(css.includes("@media (" + q + ")"), q);
  assert.match(css, /\.pn-root\.pn-navon > \.pn-body \{ padding-bottom: calc\(var\(--pnv-h\) \+ var\(--pnv-b\) \+ 28px\)/);
  assert.match(css, /--pnv-b: max\(12px, calc\(env\(safe-area-inset-bottom, 0px\) - 8px\)\)/);
  assert.match(css, /width: min\(420px, calc\(100% - 32px\)\)/);
  assert.match(css, /#smdPrep\.pn-root \{ overflow: clip; \}/);
});

test("wiring: loader lists prep-nav (optional), prep.js attaches, syncs after every paint, detaches, exposes the tab roots", () => {
  const loader = fs.readFileSync(join(ROOT, "prep-loader.js"), "utf8"), prep = fs.readFileSync(join(ROOT, "prep.js"), "utf8");
  assert.match(loader, /"prep-nav\.css"\]/);
  assert.match(loader, /"prep-tide\.js", "prep-nav\.js"/);
  assert.match(loader, /"prep-nav\.js": 1/);
  assert.match(prep, /G\.PREP_NAV\.attach\(root, HOST\)/);
  assert.match(prep, /G\.PREP_NAV\.sync\(root\)/);
  assert.match(prep, /G\.PREP_NAV\.detach\(\)/);
  assert.match(prep, /screens: \{ mocks: renderMocks, menu: renderMenu \}/);
  assert.match(prep, /a\.indexOf\("n-"\) === 0 && G\.PREP_NAV/);
  // the browse screens the bar shows on carry their markers
  for (const m of ['pn-body pn-mocks', 'pn-body pn-mtl', 'pn-body pn-bml', 'pn-body pn-dll']) assert.ok(prep.includes(m), m);
});
