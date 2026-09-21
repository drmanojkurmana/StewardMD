/* test/feature-guide.test.mjs - the in-app feature guides (onboarding.js GUIDES): shape, copy rules
 * and wiring. The browser run is test/run-feature-guide-ui.mjs.
 *
 * node --test test/feature-guide.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../onboarding.js", import.meta.url), "utf8");
const m = src.match(/var GUIDES = (\[[\s\S]*?\n  \]);\n/);
assert.ok(m, "GUIDES literal found");
const GUIDES = new Function("return " + m[1])();
// The hands-on demo is a separate literal, pushed onto GUIDES at runtime. Its steps call helpers
// (findingStep, dxOpen, stewardCard) that live in the module, so they are stubbed for the parse.
const dm = src.match(/var DEMO_GUIDE = (\{[\s\S]*?\n\s*\] \});\n  GUIDES\.unshift\(DEMO_GUIDE\);/);
assert.ok(dm, "DEMO_GUIDE literal found and registered");
const DEMO = new Function("dxOpen", "dxHas", "findingStep", "stewardCard", "stewardOpen", "dxCardOpen", "firstVisible", "document", "window", "DX",
  "return " + dm[1])(
  () => false, () => false,
  (key, label, title, body) => ({ screen: "dx", sel: "#dxSearch", kind: "tap", place: "bottom", title, tapHint: "Type " + label.toLowerCase() + ", then tap the result", body, done: () => false, key }),
  () => null, () => false, () => null, () => null, { querySelector: () => null, getElementById: () => null }, {}, {});
const SCREENS = new Set(["home", "hospital", "drugs", "dosing", "more", "dx", "maik", "calc", "sidebar", "sidebar-exp"]);

test("eight guides, unique ids, each a real walkthrough", () => {
  assert.equal(GUIDES.length, 8);
  assert.equal(new Set(GUIDES.map((g) => g.id)).size, 8);
  for (const g of GUIDES) {
    assert.ok(g.name && g.sub && g.icon, g.id + " has name/sub/icon");
    assert.ok(g.steps.length >= 4, g.id + " has at least 4 steps");
    for (const s of g.steps) {
      assert.ok(SCREENS.has(s.screen), g.id + ": screen " + s.screen);
      assert.ok(s.title && s.body, g.id + ": title + body");
      assert.ok(s.sel === null || typeof s.sel === "string", g.id + ": sel is a selector or null (summary card)");
    }
  }
});

test("copy rules: no em-dash anywhere in the guides, and the safety lines are present", () => {
  const all = JSON.stringify(GUIDES);
  assert.ok(all.indexOf("—") < 0, "no em-dash (CLAUDE.md)");
  assert.match(all, /never changes a prescription, never diagnoses and never stops a medicine/, "FollowCare rule");
  assert.match(all, /decision support: it never makes the diagnosis/, "imaging rule");
  assert.match(all, /weighted evidence, not a probability/, "confidence score is not a probability");
});

test("every screen a step names is one the controller can open", () => {
  const ctl = src.slice(src.indexOf("function gotoScreen("), src.indexOf("function guideController("));
  for (const sc of SCREENS) if (sc !== "home") assert.ok(ctl.indexOf('"' + sc + '"') >= 0, "gotoScreen handles " + sc);
  assert.match(ctl, /gHomeAct\("hospital"\)/); assert.match(ctl, /SMD_askMaik\(""\)/); assert.match(ctl, /MEDCALC\.openList\(\)/); assert.match(ctl, /SB\.open\(\)/);
});

test("the guides are wired into the API and the chooser, and the bundle tokens moved", () => {
  assert.match(src, /guide: function \(id\) \{ try \{ startGuide\(id\); \}/);
  assert.match(src, /guides: function \(\) \{ return GUIDES\.map/);
  assert.match(src, /indexOf\("guide:"\) === 0\) return startGuide/);
  assert.match(src, /guideCardsHTML\(\) \+/, "chooser lists the guides");
  assert.match(src, /else if \(v && v\.indexOf\("guide:"\) === 0\) startGuide\(v\.slice\(6\)\);/);
  const idx = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(idx, /onboarding\.js\?v=[^"]*guides1/);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /var CACHE = "[^"]*guides1/);
});

test("gCloseAll closes everything a guide can open (sheet, MaiK, calculators, sidebar, experimental page)", () => {
  const f = src.slice(src.indexOf("function gCloseAll("), src.indexOf("function gotoScreen("));
  for (const needle of ['getElementById("hvSheet")', 'getElementById("maikClose")', "MEDCALC.close()", '".sbr-set-ov"', "SB.close()"]) assert.ok(f.indexOf(needle) >= 0, needle);
});


test("the hands-on demo: every step is something the student does, and it points at real controls", () => {
  assert.equal(DEMO.id, "demo");
  assert.ok(DEMO.steps.length >= 14, "a full loop: open, add findings, gate, card, commit, stewardship");
  const taps = DEMO.steps.filter((s) => s.kind === "tap");
  assert.ok(taps.length >= 8, "most steps are hands-on taps, not reading");
  for (const t of taps) {
    assert.equal(typeof t.done, "function", t.title + ": a tap step advances on its OUTCOME (done), never on a click it cannot see");
    assert.ok(t.tapHint && t.tapHint.length > 6, t.title + ": tells the student what to do");
    assert.ok(t.sel || t.find, t.title + ": points at a real control");
  }
  // The four findings that make bacterial meningitis lead in the engine (app.js SYNDROMES.MENINGITIS
  // match: fever AND neckStiffness AND (alteredSensorium OR photophobia OR neckStiffness)).
  const keys = taps.map((t) => t.key).filter(Boolean);
  for (const k of ["fever", "headache", "neckStiffness", "photophobia"]) assert.ok(keys.includes(k), "the demo adds " + k);
  // A finding step opens the keyboard and a dropdown under the search box, so its card is pinned
  // to the foot of the visible viewport and the results stay tappable.
  for (const t of taps.filter((t) => t.key)) assert.equal(t.place, "bottom", t.title);
  assert.ok(taps.some((t) => t.sel === '[data-dx-jump="dxReview"]'), "the student switches to the review pane themselves");
  // The stewardship walk covers pathogens, antibiotics, the comment, investigations, de-escalation and evidence.
  const stew = DEMO.steps.filter((s) => s.screen === "steward");
  assert.ok(stew.length >= 6, "six stewardship cards plus the closing card");
  assert.match(DEMO.steps[DEMO.steps.length - 1].cta || "", /Done/);
  // Copy rules: no em-dash anywhere, and it never tells the student a dose.
  const all = JSON.stringify(DEMO.steps.map((s) => [s.title, s.body, s.tapHint]));
  assert.equal(all.indexOf("\u2014"), -1, "no em-dash in the demo copy");
  assert.doesNotMatch(all, /\d+\s?(mg|g)\b/, "the tour never states a dose; the console does, with its source");
  // Start/finish hooks exist: the demo case is cleared and the student's own findings come back.
  assert.equal(typeof DEMO.start, "function"); assert.equal(typeof DEMO.finish, "function");
  assert.match(src, /_demoSaved = \(window\.DX && DX\._state && DX\._state\.f\) \? Object\.keys/, "the student's findings are snapshotted");
  assert.match(src, /DX\.addFindings\(_demoSaved\)/, "and restored when the demo ends");
});

test("hands-on steps are supported by the engine: done() drives tapWatch, find() resolves, place is honoured, screens the student opened are not re-opened", () => {
  assert.match(src, /tapWatch: function \(s\) \{ try \{ return !!\(s\.done && s\.done\(\)\); \}/);
  assert.match(src, /if \(s\.find\) \{ try \{ var el = s\.find\(\);/);
  assert.match(src, /positionCard\(spot, s\.place\)/);
  assert.match(src, /var SCREEN_OPEN = \{ dx: dxOpen, steward: stewardOpen \};/);
  assert.match(src, /if \(SCREEN_OPEN\[name\] && SCREEN_OPEN\[name\]\(\)\) \{ _gScreen = name; cb\(\); return; \}/);
  // gCloseAll closes the Dx workspace too, so a guide that opened it leaves nothing behind.
  const f = src.slice(src.indexOf("function gCloseAll("), src.indexOf("function dxOpen("));
  assert.match(f, /DX\.close\(\)/);
});

test("the card fits every phone: capped to the visible viewport, scrolls inside itself, and the target is scrolled clear of it", () => {
  assert.match(src, /\.smdt-card\{[^}]*max-height:calc\(100dvh - 24px - env\(safe-area-inset-bottom,0px\)\)[^}]*overflow:auto/);
  assert.match(src, /function viewport\(\) \{\s*var vv = window\.visualViewport;/, "positions against the visual viewport (the keyboard shrinks it)");
  assert.match(src, /function fitTargetAndCard\(tgt, s\)/);
  assert.match(src, /_card\.style\.maxHeight = maxH \+ "px"/);
  assert.match(src, /visualViewport\.addEventListener\("resize", reflow\)/, "re-fits when the keyboard opens");
  // the pointing hand is an inline SVG, not an emoji
  const tap = src.slice(src.indexOf('<div class="smdt-tap'), src.indexOf('<div class="smdt-tap') + 400);
  assert.doesNotMatch(tap, /[\u{1F300}-\u{1FAFF}]/u);
});
