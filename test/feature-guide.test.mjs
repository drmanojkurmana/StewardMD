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
