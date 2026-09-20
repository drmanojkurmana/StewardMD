/* test/maik-haptics.test.mjs — MaiK's haptic vocabulary and a resolver that never caches "absent". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const HAP = readFileSync(new URL("../haptics.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const ENG = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

function loadHaptics(win) { new Function("window", "document", "location", "localStorage", "navigator", HAP)(win, win.document, win.location, win.localStorage, win.navigator); return win.SMD_HAPTICS; }
function stubWin(plugins, registerPlugin) {
  const calls = [];
  const P = { impact: async (o) => { calls.push(["impact", o.style]); }, notification: async (o) => { calls.push(["notification", o.type]); }, selectionStart: async () => { calls.push(["selection"]); }, selectionChanged: async () => {}, selectionEnd: async () => {} };
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: plugins(P), registerPlugin: registerPlugin ? () => P : undefined },
    document: { addEventListener() {} }, location: { search: "" }, localStorage: { getItem: () => null, setItem() {} }, navigator: {}, performance: { now: () => 0 }, setTimeout, calls, P };
  return win;
}

test("resolver: an early call before the plugin is proxied does NOT poison later calls", () => {
  const win = stubWin(() => ({}), false);
  const H = loadHaptics(win);
  assert.equal(H.supported(), false, "not there yet");
  win.Capacitor.Plugins.Haptics = win.P;         // bridge proxies it later
  assert.equal(H.supported(), true, "found on the next call");
});

test("resolver: falls back to Capacitor.registerPlugin when Plugins.Haptics is absent (buildless app)", () => {
  const H = loadHaptics(stubWin(() => ({}), true));
  assert.equal(H.supported(), true);
});

test("MaiK vocabulary: send medium, stop heavy, start light, done success, error error, pick selection", () => {
  const i = HOME.indexOf("var MAIK_HAPTIC = ");
  assert.ok(i > 0);
  assert.match(HOME.slice(i, i + 200), /send: "medium", stop: "heavy", start: "light", done: "success", error: "error", pick: "selection"/);
  assert.match(HOME, /maikHaptic\(_maikBusy \? "stop" : "send"\)/, "send button press");
  assert.match(HOME, /if \(was && !busy\) \{[^\n]*maikHaptic\("done"\)/, "answer complete fires on the busy->idle edge");
  assert.match(HOME, /_perfTTFT = maikNow\(\); try \{ maikHaptic\("start"\)/, "first streamed chunk");
  assert.equal((ENG.match(/SMD_HAPTICS\.selection\(\)/g) || []).length, 2, "model pick + KB switch are selection ticks");
});
