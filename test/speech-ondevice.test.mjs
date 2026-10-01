/* test/speech-ondevice.test.mjs — on-device speech (Edge-Master-Plan A1.2, flag smd_speech_ondevice,
 * DEFAULT ON since 2026-10-01; "0" is the kill switch).
 *
 * The OS recognizers behind Fast dictation may send audio to Apple/Google unless on-device recognition
 * is requested. With the flag ON, noCloud callers (ambient Scribe, OPD field dictation, kits) REQUIRE
 * the on-device recognizer and never fall back to a cloud engine; everyone else PREFERS it; the engine
 * label follows the mode the plugin actually reports. Flag OFF: byte-for-byte the old start() call.
 * Drives the real native-bridge.js + voice.js against a mock Capacitor SpeechRecognition plugin.
 * node --test test/speech-ondevice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC_NB = fs.readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
const SRC_V = fs.readFileSync(new URL("../voice.js", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function boot({ flag, plugin }) {
  // flag: true = default (key unset), false = kill switch "0"
  const store = flag ? {} : { smd_speech_ondevice: "0" };
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const w = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, URL, JSON, Math, Date,
    navigator: { language: "en-IN", userAgent: "Android" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: el(), head: el(), documentElement: el() },
    addEventListener() {}, removeEventListener() {}, fetch: () => Promise.reject(new Error("no network in this test")),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: (t) => clearTimeout(t),
    getComputedStyle: () => ({}), matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { SpeechRecognition: plugin } },
    webSpeechBuilt: 0
  };
  // A Web Speech engine that only counts constructions: noCloud + flag must never build one.
  w.webkitSpeechRecognition = function () { w.webSpeechBuilt++; this.start = () => {}; this.stop = () => {}; };
  w.window = w; w.self = w; w.globalThis = w;
  vm.createContext(w);
  vm.runInContext(SRC_NB, w, { filename: "native-bridge.js" });
  vm.runInContext(SRC_V, w, { filename: "voice.js" });
  return w;
}

// Mock @capacitor-community/speech-recognition: records start() options, lets the test emit events.
function mockPlugin({ onDevice = true, reject = null } = {}) {
  const ls = {};
  const p = {
    starts: [], ls,
    requestPermissions: () => Promise.resolve({ speechRecognition: "granted" }),
    addListener: (n, fn) => { (ls[n] = ls[n] || []).push(fn); return { remove() { ls[n] = (ls[n] || []).filter((f) => f !== fn); } }; },
    emit: (n, d) => (ls[n] || []).forEach((f) => f(d)),
    available: () => Promise.resolve({ available: true, onDevice, onDeviceHow: onDevice ? "createOnDeviceSpeechRecognizer" : "needs Android 12" }),
    start: (o) => {
      p.starts.push(o);
      if (reject) return Promise.reject(Object.assign(new Error(reject.message), { code: reject.code }));
      const wants = o.onDevice === "prefer" || o.onDevice === "require";
      p.emit("recognitionMode", { onDevice: wants && onDevice, how: "x", reason: wants && onDevice ? "" : "not available on this phone" });
      return Promise.resolve();
    },
    stop: () => Promise.resolve()
  };
  return p;
}

function listen(w, opts) {
  const seen = { states: [], errors: [], modes: [] };
  const s = w.SMD_VOICE.listen(Object.assign({
    onState: (st, label) => seen.states.push(label),
    onError: (e) => seen.errors.push(e),
    onMode: (m) => seen.modes.push(m),
    onFinal: () => {}, onPartial: () => {}
  }, opts));
  return { s, seen };
}

test("kill switch \"0\": the plugin is started exactly as before (no onDevice option), label unchanged", async () => {
  const p = mockPlugin(); const w = boot({ flag: false, plugin: p });
  const { s } = listen(w, { noCloud: true });
  await tick(5);
  assert.equal(p.starts.length, 1);
  assert.equal("onDevice" in p.starts[0], false);
  assert.deepEqual(Object.keys(p.starts[0]).sort(), ["language", "maxResults", "partialResults", "popup"]);
  assert.equal(s.engine, "On-device");
});

test("flag ON + noCloud: REQUIRE on-device; the label says On-device only after the plugin confirms it", async () => {
  const p = mockPlugin({ onDevice: true }); const w = boot({ flag: true, plugin: p });
  const { s, seen } = listen(w, { noCloud: true });
  assert.equal(s.engine, "Device speech", "no claim before the mode is known");
  await tick(5);
  assert.equal(p.starts[0].onDevice, "require");
  assert.equal(s.engine, "On-device"); assert.equal(s.onDevice, true);
  assert.equal(seen.states[seen.states.length - 1], "On-device");
  assert.equal(w.SMD_NATIVE.lastSpeechMode.onDevice, true);
});

test("flag ON + noCloud on a phone without on-device speech: a plain error, never a cloud engine", async () => {
  const p = mockPlugin({ onDevice: false, reject: { code: "ON_DEVICE_UNAVAILABLE", message: "On-device speech recognition is not available on this phone." } });
  const w = boot({ flag: true, plugin: p });
  const { seen } = listen(w, { noCloud: true });
  await tick(5);
  assert.deepEqual([...seen.errors], ["stt-unavailable-ondevice"]);
  assert.equal(w.webSpeechBuilt, 0, "Web Speech (Google cloud in a WebView) is never tried for noCloud");
});

test("flag ON + noCloud, plugin absent: Web Speech is skipped and the error names on-device", async () => {
  const w = boot({ flag: true, plugin: null });
  const { s, seen } = listen(w, { noCloud: true });
  assert.equal(s, null);
  assert.deepEqual([...seen.errors], ["stt-unavailable-ondevice"]);
  assert.equal(w.webSpeechBuilt, 0);
});

test("flag ON, ordinary dictation: PREFER on-device; when the phone has none, the label says cloud", async () => {
  const p = mockPlugin({ onDevice: false }); const w = boot({ flag: true, plugin: p });
  const { s, seen } = listen(w, {});
  await tick(5);
  assert.equal(p.starts[0].onDevice, "prefer");
  assert.equal(s.engine, "Device speech (cloud)"); assert.equal(s.onDevice, false);
  assert.equal(seen.modes[0].onDevice, false);
});

test("require + the on-device model lacks the language mid-session: error, no silent switch to cloud", async () => {
  const p = mockPlugin({ onDevice: true }); const w = boot({ flag: true, plugin: p });
  const { seen } = listen(w, { noCloud: true });
  await tick(5);
  p.emit("listeningState", { status: "stopped", error: "ON_DEVICE_LANGUAGE_UNAVAILABLE" });
  await tick(5);
  assert.deepEqual([...seen.errors], ["stt-unavailable-ondevice"]);
  assert.equal(p.starts.length, 1, "no restart on another engine");
});

test("speechOnDevice() reports what the phone can do, and false when the plugin is absent", async () => {
  const w = boot({ flag: true, plugin: mockPlugin({ onDevice: true }) });
  // (JSON round-trip: the object comes from another vm context, so its prototype differs)
  assert.deepEqual(JSON.parse(JSON.stringify(await w.SMD_NATIVE.speechOnDevice("en-IN"))), { available: true, onDevice: true, onDeviceHow: "createOnDeviceSpeechRecognizer" });
  const w2 = boot({ flag: true, plugin: null });
  assert.equal((await w2.SMD_NATIVE.speechOnDevice()).onDevice, false);
});

test("default ON: with nothing in localStorage, noCloud dictation requires on-device", async () => {
  const p = mockPlugin({ onDevice: true }); const w = boot({ flag: true, plugin: p });
  assert.equal(w.localStorage.getItem("smd_speech_ondevice"), null);
  listen(w, { noCloud: true }); await tick(5);
  assert.equal(p.starts[0].onDevice, "require");
});

test("every new error code has a sentence a doctor can act on", () => {
  assert.match(SRC_V, /"stt-unavailable-ondevice" \? "This phone can't recognise speech without sending the audio off the device/);
  assert.match(fs.readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8"), /"stt-unavailable-ondevice": "This phone can't recognise speech/);
});
