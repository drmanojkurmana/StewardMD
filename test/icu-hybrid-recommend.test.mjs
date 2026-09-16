/* test/icu-hybrid-recommend.test.mjs — priority order (owner, 2026-09-16): Hybrid first, then AI
 * Vision, then plain on-device OCR last; plus "Don't ask me again" (skip the chooser entirely). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../image-engine.js", import.meta.url), "utf8");

function load({ cloudAllowed = true, visionReady = false, consent = false, onLine = true, deviceOcr = true, hybrid } = {}) {
  const store = Object.assign({}, consent ? { "stewardmd.aiVisionPhiConsent": "true" } : {}, hybrid === "0" ? { smd_icu_hybrid: "0" } : {});
  const node = () => ({ setAttribute() {}, appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(_v) {}, get innerHTML() { return ""; }, addEventListener() {}, textContent: "" });
  const win = {
    navigator: { onLine },
    localStorage: { _d: store, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    document: { createElement: node, getElementById: () => null, head: node(), body: node(), querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {}, Capacitor: { isNativePlatform: () => true, Plugins: {} },
    SMD_MAIK_ENGINE: { cloudAllowed: () => cloudAllowed },
    SMD_MAIK_LOCAL: { visionReady: () => visionReady, currentPack: () => "maik-mxcore" },
    SMD_NATIVE: deviceOcr ? { ocr: () => Promise.resolve({}) } : undefined,
    SMD_AI: { vision: () => Promise.resolve({ mode: "fields", fields: { hr: 88 } }) }
  };
  win.window = win;
  new Function("window", "document", "localStorage", "navigator", SRC)(win, win.document, win.localStorage, win.navigator);
  return win.SMD_IMAGE_ENGINE;
}

test("Hybrid (device OCR + AI Vision check) is recommended over AI Vision alone, when consent is already granted", () => {
  const E = load({ cloudAllowed: true, consent: true, onLine: true });
  assert.equal(E.hybridReady(), true);
  assert.equal(E.recommendFor("monitor"), "device");
});

test("Hybrid (device OCR + on-device check) is recommended over AI Vision, with no consent needed", () => {
  const E = load({ cloudAllowed: true, consent: false, visionReady: true, onLine: true });
  assert.equal(E.hybridReady(), true);
  assert.equal(E.recommendFor("monitor"), "device");
});

test("no hybrid path available (no consent, no local vision pack): falls back to AI Vision, matching the old order", () => {
  const E = load({ cloudAllowed: true, consent: false, visionReady: false, onLine: true });
  assert.equal(E.hybridReady(), false);
  assert.equal(E.recommendFor("monitor"), "ai");
});

test("no device OCR at all (web): hybrid can never engage, AI Vision still recommended", () => {
  const E = load({ cloudAllowed: true, consent: true, onLine: true, deviceOcr: false });
  assert.equal(E.hybridReady(), false);
  assert.equal(E.recommendFor("monitor"), "ai");
});

test("hybrid turned off (smd_icu_hybrid=0) never gets recommended even when it could otherwise engage", () => {
  const E = load({ cloudAllowed: true, consent: true, onLine: true, hybrid: "0" });
  assert.equal(E.hybridReady(), false);
  assert.equal(E.recommendFor("monitor"), "ai");
});

test("Local engine policy still wins: AI Vision is never recommended when cloud is disallowed, regardless of hybrid", () => {
  const E = load({ cloudAllowed: false, visionReady: true, onLine: true });
  assert.equal(E.recommendFor("monitor"), "device", "hybrid via the on-device checker, not AI Vision");
});

test("getPref/setPref round-trip all three engines, including local (previously collapsed to device)", () => {
  const E = load({});
  E.setPref("local"); assert.equal(E.getPref(), "local");
  E.setPref("ai"); assert.equal(E.getPref(), "ai");
  E.setPref("device"); assert.equal(E.getPref(), "device");
  E.setPref("bogus"); assert.equal(E.getPref(), "device", "unrecognised values fall back to the private default");
});

test("Don't ask me again: skipChooser persists and process() routes straight through with no picker", async () => {
  const E = load({ cloudAllowed: true, consent: true, onLine: true });
  assert.equal(E.skipChooser(), false);
  E.setPref("ai");
  E.setSkipChooser(true);
  assert.equal(E.skipChooser(), true);
  const r = await E.process({ image: "x", kind: "monitor" });
  assert.equal(r.engine, "ai", "routed straight to the remembered engine, chooseEngine never shown");
  E.setSkipChooser(false);
  assert.equal(E.skipChooser(), false);
});

test("chooseEngine's sheet offers a Don't ask me again button that resolves {remember:true, skip:true}", () => {
  assert.match(SRC, /id="ieSkip"[^>]*>Don.t ask me again<\/button>/);
  assert.match(SRC, /resolve\(\{ engine: sel, remember: true, skip: true \}\)/);
  assert.match(SRC, /if \(choice\.skip\) setSkipChooser\(true\);/);
});
