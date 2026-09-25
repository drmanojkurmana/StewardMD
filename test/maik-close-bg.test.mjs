/* test/maik-close-bg.test.mjs: MaiK composer symmetry, a findable Close, and backgrounds in dark mode.
 *
 * Owner, 2026-09-26: "the button UI doesnt look well aligned in symmetry in ask maik text box and x
 * close button etc are not visible to many and many are confused how to close, and in dark mode keep
 * existing as one background and give option to change background even in dark mode."
 * The browser half (geometry, contrast, Escape, Android back, live switching) is
 * test/run-maik-close-bg-ui.mjs; these pins keep the pieces it relies on, and run the background
 * logic of maik-atmosphere.js for real in a VM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const P = readFileSync(new URL("../maik-polish.css", import.meta.url), "utf8");
const A = readFileSync(new URL("../maik-atmosphere.js", import.meta.url), "utf8");
const C = readFileSync(new URL("../maik-atmosphere.css", import.meta.url), "utf8");
const I = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function loadAtmo(stored) {
  const store = new Map(stored ? [["smd_maik_atmo_cfg", stored]] : []);
  const ctx = { window: {}, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  vm.createContext(ctx); vm.runInContext(A, ctx);
  return { M: ctx.window.SMD_MAIK_ATMOSPHERE, store };
}
const same = (a, b) => ["color1", "color2", "color3"].every((k) => a[k].toLowerCase() === b[k].toLowerCase()) && a.blend === b.blend && a.speed === b.speed;

test("Close sits in the header's first row, second in the markup, labelled in words", () => {
  const shell = H.slice(H.indexOf("function maikShellHTML()"), H.indexOf('<div class="maik-body"', H.indexOf("function maikShellHTML()")));
  const close = shell.indexOf('id="maikClose"');
  assert.ok(close > shell.indexOf('class="maik-logo-wrap"') && close < shell.indexOf('class="maik-nav-actions"'), "after the logo, before the second row");
  assert.match(shell, /id="maikClose" type="button" title="Close MaiK" aria-label="Close MaiK">' \+ MK\.close \+ '<span class="maik-x-lbl">Close<\/span><\/button>/);
  assert.equal((shell.match(/id="maikClose"/g) || []).length, 1, "one Close");
  assert.match(P, /#maikClose\{grid-column:3;grid-row:1;[^}]*background-color:var\(--mk-ink\);color:var\(--mk-bg\)/, "filled ink on the page colour, both themes");
  assert.match(P, /\.maik-hd-btn\{width:44px;height:44px;border:2px solid transparent;border-radius:22px;[^}]*background-clip:padding-box/, "44px targets drawing a 40px fill");
  assert.match(P, /#maikClose:is\(:hover,:active\)\{background-color:var\(--mk-ink\)!important/, "the press state keeps the fill (no tsoft wash under white text)");
});

test("Escape closes the top MaiK layer and is released on close", () => {
  const f = H.slice(H.indexOf("function maikOnKey(ev)"), H.indexOf('document.addEventListener("keydown", maikOnKey);'));
  assert.ok(f.length > 0, "maikOnKey exists and is registered");
  assert.match(f, /if \(t === qEl && String\(qEl\.value \|\| ""\)\.trim\(\)\) return;/, "never throws away a typed question");
  assert.match(f, /!sheet\.contains\(t\)\)\) return;/, "keys aimed at another overlay are left to it");
  assert.match(f, /if \(back\) back\.click\(\); else maikCloseSide\(\);/, "the sidebar steps back first");
  const close = H.slice(H.indexOf("    function close() {"), H.indexOf("    function scroll(smooth)"));
  assert.match(close, /document\.removeEventListener\("keydown", maikOnKey\);/);
});

test("composer: one row of 44px round controls with margin spacing and the extract button in the text row", () => {
  assert.match(P, /\.maik-cmp-in\{display:grid;grid-template-columns:auto auto auto auto minmax\(8px,1fr\) minmax\(0,auto\) 44px;grid-template-rows:64px 44px;gap:4px 0;/);
  assert.match(P, /\.maik-cmp-in :is\(#maikMic,#maikResearch,#maikImg,#maikExtract,#maikLen,#maikModelChip,#maikSend\)\{box-sizing:border-box;min-width:44px;height:44px;border-radius:22px!important\}/);
  assert.match(P, /\.maik-cmp-in :is\(#maikMic:not\(\.live\):not\(\.prep\),#maikResearch:not\(\.on\),#maikImg:not\(\.has\),#maikExtract,#maikLen,#maikModelChip\)\{border:1px solid var\(--mk-ctl-bd\)!important;background:var\(--mk-ctl-bg\)!important/, "one surface; live/on/has states keep their own colours");
  assert.match(P, /\.maik-cmp-in:has\(#maikExtract\.show\) #maikQ\{padding-right:56px\}/, "text never runs under the extract button");
  assert.match(P, /@media \(max-width:370px\)\{[^}]*minmax\(4px,1fr\)/, "narrow phones tighten to 4px");
  assert.match(P, /:is\(\.maik-hd-btn,\.maik-cmp-in button\):focus-visible\{outline:2px solid var\(--mk-teal\)!important/, "keyboard focus is visible");
});

test("background chooser: a sidebar row next to MaiK buddy, a radiogroup, and every panel hides the others", () => {
  const shell = H.slice(H.indexOf("function maikShellHTML()"), H.indexOf("function maikShellHTML()") + 9000);
  assert.ok(shell.indexOf('id="maikSideBg"') > shell.indexOf('id="maikBuddyPick"'), "right after the buddy chooser");
  assert.match(shell, /id="maikSideBg" type="button" aria-controls="maikBgPick">/);
  assert.match(shell, /<div class="maik-me" id="maikBgPick" hidden><\/div>/);
  assert.match(H, /"\.maik-side\.bg-open \.maik-side-srch,[^"]*#maikSideBg\{display:none\}"/);
  assert.match(H, /"\.maik-side\.me-open [^"]*#maikSideBuddy,\.maik-side\.me-open #maikSideBg\{display:none\}"/);
  assert.match(H, /"\.maik-side\.bd-open [^"]*#maikSideBuddy,\.maik-side\.bd-open #maikSideBg\{display:none\}"/);
  const f = H.slice(H.indexOf("function maikBgShow(on)"), H.indexOf("function maikBgState()"));
  assert.match(f, /role="radiogroup" aria-label="Choose the MaiK background"/);
  assert.match(f, /role="radio" aria-checked="' \+ sel \+ '"/);
  assert.match(H, /SMD_MAIK_ATMOSPHERE\.choose\(maikBgTheme\(\), o\.getAttribute\("data-bg"\)\)/, "a pick applies to the theme on screen");
  assert.match(H, /maikMeShow\(false\); maikBuddyShow\(false\); maikBgShow\(false\);/, "opening the sidebar resets the panel");
  assert.doesNotMatch(f, /—/, "no em-dash in app-facing text");
});

test("the Display sheet edits the theme on screen (it used to edit only light)", () => {
  const f = H.slice(H.indexOf("  function openDisplay() {"), H.indexOf("  function refreshD() {"));
  assert.match(f, /function atmoKey\(\) \{/);
  assert.doesNotMatch(f, /setConfig\(\{\s*light:|\{ light: \{\} \}|getConfig\(\)\.light/);
  assert.match(f, /SMD_MAIK_ATMOSPHERE\.choose\(atmoKey\(\), btn\.getAttribute\("data-pre-id"\)\)/);
});

test("default dark background is exactly the stylesheet's original one", () => {
  // The CSS fallbacks are the old literals, and the dark default palette writes the same values.
  assert.match(C, /#maikSheet \.mk-atmo-dark \{ background:radial-gradient\(ellipse at 12% 0%,var\(--mk-d1-a,rgba\(255,103,31,\.34\)\),transparent 60%\),radial-gradient\(ellipse at 88% 10%,var\(--mk-d3-a,rgba\(6,3,141,\.45\)\),transparent 60%\),radial-gradient\(ellipse at 50% 100%,var\(--mk-d2-a,rgba\(4,106,56,\.22\)\),transparent 65%\); \}/);
  assert.match(A, /'--mk-d1-a', hexToRgba\(cfg\.color1, 0\.34\)\);[\s\S]*'--mk-d2-a', hexToRgba\(cfg\.color2, 0\.22\)\);[\s\S]*'--mk-d3-a', hexToRgba\(cfg\.color3, 0\.45\)\);/);
  const { M } = loadAtmo();
  assert.equal(M.DEFAULT_CONFIG.dark.color1, "#FF671F"); assert.equal(M.DEFAULT_CONFIG.dark.color2, "#046A38"); assert.equal(M.DEFAULT_CONFIG.dark.color3, "#06038D");
  assert.equal(M.choice("dark"), "tiranga"); assert.equal(M.choiceLabel("dark"), "Default");
  assert.ok(same(M.getConfig().dark, M.DEFAULT_CONFIG.dark) && !M.getConfig().dark.plain);
});

test("Plain hides the layer and runs no animation loop", () => {
  assert.match(C, /#maikSheet \.mk-atmo\.mk-atmo-plain \{ display:none; \}/);
  assert.match(A, /layer\.classList\.toggle\('mk-atmo-plain', !!cfg\.plain\);/);
  assert.match(A, /if \(!active\(\) \|\| plainNow\(\)\) return;/);
  assert.match(A, /if \(active\(\) && !plainNow\(\)\) raf = requestAnimationFrame\(frame\);/);
  assert.match(A, /if \(dead \|\| plainNow\(\)\) return;/);
});

test("choices are per theme, persist, and default returns the exact original palette", () => {
  let { M, store } = loadAtmo();
  const list = M.backgrounds("dark");
  assert.deepEqual(Array.from(list, (b) => b.id), ["tiranga", "borealis", "cosmic", "sunset", "glacier", "plain"]);
  assert.match(list[0].name, /\(default\)$/);
  assert.ok(list.every((b) => /var\(--mk-bg\)$/.test(b.preview) && !/—/.test(b.name + b.blurb)));
  M.choose("dark", "cosmic");
  assert.equal(M.choice("dark"), "cosmic"); assert.equal(M.choice("light"), "tiranga", "light keeps its own choice");
  assert.equal(JSON.parse(store.get("smd_maik_atmo_cfg")).dark.color1, "#4f46e5");
  ({ M, store } = loadAtmo(store.get("smd_maik_atmo_cfg")));
  assert.equal(M.choice("dark"), "cosmic", "remembered on this device");
  M.choose("dark", "plain");
  ({ M, store } = loadAtmo(store.get("smd_maik_atmo_cfg")));
  assert.equal(M.choice("dark"), "plain"); assert.equal(M.choiceLabel("dark"), "Plain"); assert.equal(M.choice("light"), "tiranga");
  M.setConfig({ dark: { blend: 0.6 } });
  assert.equal(M.getConfig().dark.plain, false, "editing the palette brings the aurora back");
  assert.equal(M.choice("dark"), "custom");
  M.choose("dark", "tiranga");
  assert.ok(same(M.getConfig().dark, M.DEFAULT_CONFIG.dark), "Default is exactly the original dark palette");
  M.choose("light", "plain");
  assert.equal(M.choice("light"), "plain"); assert.equal(M.choice("dark"), "tiranga");
  const before = JSON.stringify(M.getConfig()); M.choose("dark", "nope");
  assert.equal(JSON.stringify(M.getConfig()), before, "an unknown id changes nothing");
});

test("index.html busts the cache for every changed file", () => {
  assert.match(I, /maik-polish\.css\?v=[^"]*mkclose1"/);
  assert.match(I, /maik-atmosphere\.css\?v=[^"]*mkbg1"/);
  assert.match(I, /maik-atmosphere\.js\?v=[^"]*mkbg1"/);
  assert.match(I, /\/home\.js\?v=[^"]*mkclose1"/);
});
