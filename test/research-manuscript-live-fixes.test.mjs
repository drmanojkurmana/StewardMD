/* BUG-08 / BUG-07 / BUG-12: manuscript fallback, theme tokens, phone action bar.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-manuscript-live-fixes.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../research-screen-manuscript.js", import.meta.url), "utf8");

function boot() {
  globalThis.window = globalThis;
  globalThis.document = {
    head: { appendChild: () => {} },
    body: { contains: () => true },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {} })
  };
  const projects = {};
  globalThis.SMD_RESEARCH = {
    screens: {},
    store: {
      getProject: (id) => projects[id] || null,
      getActiveProject: () => projects.__active || null,
      getState: () => ({ runs: {} })
    },
    api: { request: () => Promise.resolve({}) }
  };
  new Function("window", "global", src)(globalThis, globalThis);
  return { screens: globalThis.SMD_RESEARCH.screens, projects };
}

describe("BUG-08: no demo manuscript leaks into a real project", () => {
  let env;
  beforeEach(() => { env = boot(); });

  test("a new systematic review starts empty with its own title", () => {
    env.projects.prj_new = { id: "prj_new", title: "My sepsis audit", studyType: "Systematic Review & Meta-Analysis" };
    const m = env.screens.manuscript;
    assert.equal(m._isDemoProject(env.projects.prj_new), false);
    const man = m._defaultManuscript("prj_new");
    assert.equal(man.title, "My sepsis audit", "draft title is the project title");
    assert.equal(man.version, 1);
    assert.ok(man.sections.length >= 5, "IMRaD sections are present");
    assert.ok(man.sections.every((s) => s.text === ""), "every section starts empty");
    assert.doesNotMatch(JSON.stringify(man), /BCG|Colditz|0\.49/, "no demo content or demo numbers");
    assert.deepEqual(m._defaultVersions(env.projects.prj_new), [], "no demo version history");
  });

  test("the built-in BCG demo keeps its seeded manuscript and versions", () => {
    env.projects.prj_bcg_1994 = { id: "prj_bcg_1994", title: "BCG Vaccine vs Tuberculosis (Colditz 1994)", studyType: "Systematic Review" };
    const m = env.screens.manuscript;
    assert.equal(m._isDemoProject(env.projects.prj_bcg_1994), true);
    const man = m._defaultManuscript("prj_bcg_1994");
    assert.match(man.title, /BCG vaccination against tuberculosis/i);
    assert.match(JSON.stringify(man), /0\.49/);
    assert.equal(m._defaultVersions(env.projects.prj_bcg_1994).length, 2);
  });

  test("the worked systematic review tutorial keeps the demo", () => {
    env.projects.tut_sr = { id: "tut_sr", serverId: "tut_sr", tutorial: true, tutorialKey: "sr", title: "[Tutorial] BCG", studyType: "Systematic Review & Meta-Analysis" };
    const man = env.screens.manuscript._defaultManuscript("tut_sr");
    assert.match(man.title, /BCG vaccination against tuberculosis/i);
  });
});

describe("BUG-07: case report modal uses theme tokens", () => {
  test("the draft modal no longer hardcodes dark hex colours", () => {
    assert.equal(src.indexOf("#0D1D23"), -1, "no hardcoded modal background");
    assert.equal(src.indexOf("#071318"), -1, "no hardcoded textarea background");
    assert.equal(src.indexOf("#1f363d"), -1, "no hardcoded modal border");
    const modal = src.slice(src.indexOf("function showDraftPreviewModal"), src.indexOf("/* Ask MaiK to draft a manuscript"));
    assert.match(modal, /var\(--rmd-panel\)/, "modal card uses the panel token");
    assert.match(modal, /var\(--rmd-ink\)/, "modal text uses the ink token");
    assert.match(modal, /var\(--rmd-line\)/, "modal borders use the line token");
    assert.match(modal, /var\(--rmd-bad-soft\)/, "findings use the error token");
  });
});

describe("BUG-12: phone manuscript action bar wraps instead of scrolling away", () => {
  test("the 390px rule wraps the action bar and does not hide an overflow strip", () => {
    assert.match(src, /\.rmd-man-actions \{[^}]*flex-wrap: wrap/, "action bar wraps");
    assert.doesNotMatch(src, /\.rmd-man-actions \{[^}]*overflow-x: auto/, "no hidden horizontal strip");
    assert.match(src, /\.rmd-man-actions \.rmd-btn \{[^}]*max-width: 100%/, "buttons stay inside the viewport");
  });
});