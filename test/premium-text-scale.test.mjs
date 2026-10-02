// power-state.js text scale (Premium-Feel plan B3): clamp 85-200%, iOS uses -webkit-text-size-adjust,
// Android asks SmdDevice.setTextZoom, kill switch smd_text_scale="0".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../power-state.js", import.meta.url), "utf8");

function boot({ platform, scale, killed }) {
  const calls = [], listeners = {}, style = { html: {}, body: {} };
  const plugin = {
    getPowerState: () => Promise.resolve({ lowPower: false }),
    getTextScale: () => Promise.resolve({ scale }),
    setTextZoom: (o) => { calls.push(o.percent); return Promise.resolve(); },
    addListener: (n, cb) => { listeners[n] = cb; },
  };
  const win = {
    Capacitor: { Plugins: { SmdDevice: plugin }, getPlatform: () => platform },
    dispatchEvent() {},
  };
  const ctx = {
    window: win, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: (k) => (k === "smd_text_scale" && killed ? "0" : null) },
    document: { documentElement: { style: style.html, classList: { toggle() {} } }, body: { style: style.body } },
    setTimeout, Promise, Math, Number, isFinite,
  };
  vm.runInNewContext(SRC, ctx);
  return { win, calls, listeners, style };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("clamp: 85% to 200%, junk falls back to 100%", () => {
  const { win } = boot({ platform: "ios", scale: 1 });
  const c = win.SMD_TEXT.clamp;
  assert.equal(c(1), 1); assert.equal(c(1.35), 1.35); assert.equal(c(3.1), 2); assert.equal(c(0.5), 0.85);
  assert.equal(c(undefined), 1); assert.equal(c("x"), 1); assert.equal(c(0), 1);
});

test("iOS applies the system size as -webkit-text-size-adjust on html and body", async () => {
  const { win, style, calls } = boot({ platform: "ios", scale: 1.41 });
  await tick(); await tick();
  assert.equal(style.html.webkitTextSizeAdjust, "141%");
  assert.equal(style.body.webkitTextSizeAdjust, "141%");
  assert.equal(win.SMD_TEXT.scale, 1.41);
  assert.deepEqual(calls, []);
});

test("Android asks the plugin for WebView textZoom, clamped", async () => {
  const { calls, style } = boot({ platform: "android", scale: 2.4 });
  await tick(); await tick();
  assert.deepEqual(calls, [200]);
  assert.equal(style.html.webkitTextSizeAdjust, undefined);
});

test("iOS live change re-applies; kill switch keeps 100%", async () => {
  const live = boot({ platform: "ios", scale: 1 });
  await tick(); await tick();
  live.listeners.textScaleChange({ scale: 1.76 });
  assert.equal(live.style.html.webkitTextSizeAdjust, "176%");
  const off = boot({ platform: "android", scale: 1.5, killed: true });
  await tick(); await tick();
  assert.deepEqual(off.calls, []);
});
