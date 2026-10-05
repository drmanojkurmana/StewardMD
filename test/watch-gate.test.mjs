// Apple Watch UI must render only on iOS native (window.SMD_HAS_WATCH, set in native-bridge.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => readFileSync(join(ROOT, f), "utf8");

// Run native-bridge.js under a Capacitor stub and return the gate it computes.
function gate(platform) {
  const win = { document: { addEventListener() {}, querySelector: () => null, documentElement: {}, readyState: "complete" },
    addEventListener() {}, location: { search: "" }, navigator: { userAgent: "" }, setTimeout, clearTimeout };
  if (platform) win.Capacitor = { getPlatform: () => platform, isNativePlatform: () => platform !== "web", Plugins: {} };
  win.window = win; win.self = win; win.globalThis = win;
  try { vm.runInContext(rd("native-bridge.js"), vm.createContext(win)); } catch (e) { /* later bridge code may need more shims; the gate is set first */ }
  return win.SMD_HAS_WATCH;
}

test("gate is true on ios only", () => {
  assert.equal(gate("ios"), true);
  assert.equal(gate("android"), false);
  assert.equal(gate(null), false); // web: no Capacitor
  assert.equal(gate("web"), false);
});

// Calculator card markup, lifted from calculators.js and run for real per platform.
const src = rd("calculators.js");
const a = src.indexOf("function calcCardHTML(c){"), b = src.indexOf("function renderList(){");
assert.ok(a > 0 && b > a, "found calcCardHTML");
const card = (hasWatch) => new Function("window", "isWatchFav", "openId", "mcIco", "mcCatIco", "esc",
  src.slice(a, b) + "; return calcCardHTML;")({ SMD_HAS_WATCH: hasWatch }, () => false, null, () => "", () => "", (s) => s)({ id: "x", title: "T", desc: "D", cat: "c" });

test("calculator card: Apple Watch wording only on ios", () => {
  assert.match(card(true), /Apple Watch/);
  assert.doesNotMatch(card(false), /Apple Watch/);
  assert.doesNotMatch(card(undefined), /Apple Watch/);
});

test("ICU Code Blue card and KardiQ X watch row use the same gate", () => {
  assert.match(rd("icu.js"), /return \(window\.SMD_HAS_WATCH\s*\?\s*'<div class="icu-card" style="border-color:var\(--danger\)">/);
  assert.match(rd("kardiox-screens.js"), /window\.SMD_HAS_WATCH \? soonRow\('watch', 'Apple Watch'\)/);
});
