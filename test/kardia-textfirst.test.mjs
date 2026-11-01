/* Kardia text first path: with WebGL forced off, the Echo Lab and
 * AngioLAB tabs render the calm text pane with every view listed and
 * linked, and Learn and Calculators render without throwing.
 * Run: node --test --experimental-test-module-mocks test/kardia-textfirst.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TF = require("../kardia-textfirst.js");
const LINKS = require("../kardia-links.js");
const viewsData = JSON.parse(readFileSync("kardia/views.json", "utf8"));
const learnIndex = JSON.parse(readFileSync("kardia/learn/index.json", "utf8"));

test("detectWebGL: false when every context is null, true when one works, probed once", () => {
  TF.resetForTest();
  let calls = 0;
  const off = TF.detectWebGL(() => ({ getContext: () => { calls++; return null; } }));
  assert.equal(off, false);
  assert.equal(TF.detectWebGL(() => { throw new Error("must not probe again"); }), false, "cached after one probe");
  assert.ok(calls >= 1);
  TF.resetForTest();
  const on = TF.detectWebGL(() => ({ getContext: (t) => (t === "webgl" ? { getExtension: () => null } : null) }));
  assert.equal(on, true);
  TF.resetForTest();
});

test("Echo text rows: every view in views.json, with probe position and what you should see", () => {
  const rows = TF.echoRows(viewsData, learnIndex.lessons, LINKS);
  assert.equal(rows.length, viewsData.views.length, "one row per view");
  assert.equal(rows.length, 43);
  for (const v of viewsData.views) {
    const r = rows.find((x) => x.id === v.id);
    assert.ok(r, v.id + " listed");
    assert.equal(r.name, v.name);
    assert.equal(r.position, v.probe.position, v.id + " probe position");
    assert.ok(r.see.length > 0, v.id + " says what you should see");
    for (const lm of v.landmarks) assert.ok(r.see.includes(lm.name), v.id + " lists " + lm.name);
  }
});

test("Echo text rows: every view links to its Learn lesson through kardia-links", () => {
  const rows = TF.echoRows(viewsData, learnIndex.lessons, LINKS);
  for (const r of rows) {
    assert.ok(r.lessonId, r.id + " has a lesson");
    assert.ok(learnIndex.lessons[r.lessonId], r.id + " lesson exists in the index");
    assert.equal(learnIndex.lessons[r.lessonId].view, r.id, r.id + " lesson teaches this view");
    assert.equal(r.link, "stewardmd://kardia/lesson/" + r.lessonId);
    assert.deepEqual(LINKS.parse(r.link), { kind: "lesson", id: r.lessonId });
  }
  assert.equal(rows.find((r) => r.id === "tte_plax").lessonId, "view_plax");
  assert.equal(rows.find((r) => r.id === "tte_a4c").lessonId, "view_a4c");
  assert.equal(rows.find((r) => r.id === "tee_me_4c").lessonId, "tee_me_4c");
});

test("Angio text rows: every standard projection with its angles", () => {
  const rows = TF.angioRows(LINKS);
  assert.equal(rows.length, TF.ANGIO_VIEWS.length);
  assert.ok(rows.length >= 12, "the standard set is listed");
  for (const r of rows) {
    assert.ok(r.name && r.system && r.angles && r.range, r.id + " has name, system and angles");
    assert.ok(/LAO|RAO|AP/.test(r.angles), r.id + " angles name the gantry");
  }
  assert.ok(rows.find((r) => r.id === "lao-caudal").name.includes("spider"));
});

test("host wiring: text pane in both lab tabs, existing retry elements kept, 20 second rule", () => {
  const host = readFileSync("kardia.js", "utf8");
  assert.ok(host.includes('id="krdProbeErr"'), "Echo error element kept");
  assert.ok(host.includes('id="krdAngioErr"'), "Angio error element kept");
  assert.ok(host.includes('data-act="kecho-probe-retry"'), "Echo retry kept");
  assert.ok(host.includes('data-act="kangio-retry"'), "Angio retry kept");
  assert.ok(host.includes('id="krdTextEchoSlot"') && host.includes("textEchoPaneHtml()"), "Echo text pane rendered");
  assert.ok(host.includes('id="krdTextAngioSlot"') && host.includes("textAngioPaneHtml()"), "Angio text pane rendered");
  assert.ok(host.includes("LAB_TIMEOUT_MS = 20000"), "frames get 20 seconds");
  assert.ok(host.includes('data-act="kecho-text-try3d"') && host.includes('data-act="kangio-text-try3d"'), "Try 3D again in both panes");
  assert.ok(host.includes('data-act="ktext-lesson"'), "pane rows open lessons");
  assert.ok(host.includes("Needs internet"), "offline is labelled plainly");
  assert.ok(host.includes("TF.detect3D()"), "3D support probed through the shared helper");
  assert.ok(!/—|–/.test(host.split("Text first path")[1].split("function echoBase")[0]), "no em or en dash in the new pane copy");
});

test("loader loads the text first module before the host; build ships root Kardia files", () => {
  const loader = readFileSync("kardia-loader.js", "utf8");
  assert.ok(loader.includes('"kardia-textfirst.js"'), "loader lists the new file");
  assert.ok(loader.indexOf('"kardia-textfirst.js"') < loader.indexOf('"kardia.js"'), "text first helpers load before the host");
  const build = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(/kardia-\*\.js/.test(build), "root globs ship the new file in the app bundle");
});

test("Learn and Calculators need no WebGL: guarded 2D only, host catches a throw", () => {
  const calc = readFileSync("kardia-calc.js", "utf8");
  assert.ok(calc.includes('getContext("2d")'), "calculator figures use a 2D canvas");
  assert.ok(!/getContext\("webgl/.test(calc), "calculators never ask for WebGL");
  const practice = readFileSync("kardia-practice.js", "utf8");
  assert.ok(!/getContext\("webgl/.test(practice), "practice drills never ask for WebGL");
  assert.ok(practice.includes("not loaded on this device"), "knobology already falls back to text");
  const host = readFileSync("kardia.js", "utf8");
  assert.ok(host.includes("Calculators could not open here"), "a calculator throw shows text, not a blank tab");
  assert.ok(host.includes("Cases could not open here"), "a case throw shows text, not a blank tab");
  assert.ok(host.includes("Drills could not open here"), "a drill throw shows text, not a blank tab");
});

test("text builders never throw without WebGL, lessons or network", () => {
  TF.resetForTest();
  assert.equal(TF.detectWebGL(() => ({ getContext: () => null })), false);
  assert.doesNotThrow(() => TF.echoRows(viewsData, learnIndex.lessons, LINKS));
  assert.doesNotThrow(() => TF.echoRows(null, null, null));
  assert.doesNotThrow(() => TF.angioRows(null));
  assert.equal(TF.isOffline({ onLine: false }), true);
  assert.equal(TF.isOffline({ onLine: true }), false);
  TF.resetForTest();
});
