// The tab bar has one "current" mark, Home's pill. The old "last opened" line under Drugs / MaiK sat off the
// icon on the floating bar and doubled the selection (owner 2026-11-13). Browser check: run-premium-motion-ui 10b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../tab-bar.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("tab-bar.js no longer draws a last-opened line", () => {
  assert.doesNotMatch(src, /createElement\("i"\)/);
  assert.doesNotMatch(src, /setItem\("smd_tab_sel"|setItem\(KEY/);
});
test("a line left by an older bundle is removed, and Home keeps re-tap to top", () => {
  assert.match(src, /querySelectorAll\("\.rnav-tab-ind"\)/);
  assert.match(src, /getAttribute\("data-act"\) !== "home"/);
});
test("tab-bar.js token is bumped", () => {
  assert.match(html, /tab-bar\.js\?v=pm4-noind1/);
});
