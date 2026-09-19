/* image-engine-local.test.mjs — the on-device model as a third image engine.
 *
 * Two very different jobs behind one entry point, which is the whole risk:
 *   ICU snapshot AUTOFILLS fields from a monitor/ventilator/ABG photo, so it needs parsed values.
 *   Scan Meds and a plain look at a document want a reading in prose.
 * Returning prose to ICU would mean the doctor re-typing every value off the photo they just took,
 * which defeats the point of photographing the monitor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../image-engine.js", import.meta.url), "utf8");
const SERVER = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

/** Load image-engine.js with a stubbed on-device model that returns `reply`. */
function load(reply, { visionReady = true, onLine = true } = {}) {
  const calls = [];
  const win = {
    navigator: { onLine },
    SMD_MAIK_LOCAL: {
      answer: async (pkg, opts) => { calls.push({ pkg, opts }); return typeof reply === "function" ? reply(pkg, opts) : reply; },
      visionReady: () => visionReady,
      currentPack: () => "maik-mxcore"
    },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    // busy() injects a <style> and builds an overlay, so the stub needs getElementById and a head.
    document: (() => {
      const node = () => ({ setAttribute() {}, appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} },
                            style: {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(_v) {}, get innerHTML() { return ""; },
                            addEventListener() {}, textContent: "" });
      return { createElement: node, getElementById: () => null, head: node(), body: node(),
               querySelector: () => null, querySelectorAll: () => [] };
    })(),
    addEventListener() {}, Capacitor: { isNativePlatform: () => true, Plugins: {} }
  };
  win.window = win;
  new Function("window", "document", "localStorage", "navigator", SRC)(win, win.document, win.localStorage, win.navigator);
  return { E: win.SMD_IMAGE_ENGINE, calls };
}

// ── the on-device model as the OFFLINE ALTERNATIVE to AI Vision (owner, 2026-09-04) ──
test("offline with a projector installed, the on-device model is the recommended engine", () => {
  const { E } = load({ text: "{}" }, { onLine: false });
  assert.equal(E.recommendFor("monitor"), "local");
});

test("offline without a projector, plain OCR stays the recommendation", () => {
  const { E } = load({ text: "{}" }, { onLine: false, visionReady: false });
  assert.equal(E.recommendFor("monitor"), "device");
});

test("a scan that asked for AI Vision while offline is read by the on-device model instead of failing", async () => {
  const { E, calls } = load({ text: '{"hr":88,"spo2":95}' }, { onLine: false });
  const r = await E.process({ image: "/tmp/m.jpg", kind: "monitor", engineOverride: "ai" });
  assert.equal(r.engine, "local");
  assert.equal(r.fields.hr, 88);
  assert.equal(calls.length, 1, "the on-device model was asked exactly once");
});

test("ICU kinds get PARSED FIELDS, so autofill works", async () => {
  const { E, calls } = load({ text: '```json\n{"vitals":{"hr":96,"spo2":91},"abg":{"ph":7.28,"paco2":52}}\n```' });
  const r = await E.process({ image: "file:///tmp/m.jpg", kind: "all", engineOverride: "local" });
  assert.equal(r.mode, "fields");
  assert.equal(r.engine, "local");
  assert.equal(r.fields.vitals.hr, 96);
  assert.equal(r.fields.abg.ph, 7.28);
  // A 4B wraps JSON in a code fence and adds prose; that must not lose a good reading.
  assert.ok(calls[0].opts.systemOverride, "extraction must use the bare extractor prompt, not the interpretive one");
  assert.match(calls[0].opts.systemOverride, /ONLY the JSON/);
});

test("the extractor prompt is NOT the interpretive image prompt", async () => {
  const { E, calls } = load({ text: '{"hr":80}' });
  await E.process({ image: "/tmp/m.jpg", kind: "monitor", engineOverride: "local" });
  // If Interpretation leaked into an extraction request the model would return prose and ICU would
  // autofill nothing.
  assert.ok(!/Interpretation/i.test(calls[0].opts.systemOverride));
});

test("field keys match the cloud engine's own schema, so ICU needs no translation", () => {
  // Copied deliberately from VISION_SYS rather than invented: a translation layer is where a value
  // silently lands in the wrong field.
  for (const key of ["hr", "sbp", "map", "spo2", "etco2", "peep", "plateau", "paco2", "lactate"]) {
    assert.ok(SRC.includes('"' + key + '"'), "on-device schema missing " + key);
    assert.ok(SERVER.includes('\\"' + key + '\\"'), "cloud schema missing " + key);
  }
});

test("unparseable JSON degrades to prose lines instead of failing", async () => {
  const { E } = load({ text: "I can see a monitor but the numbers are blurred." });
  const r = await E.process({ image: "/tmp/m.jpg", kind: "monitor", engineOverride: "local" });
  assert.equal(r.mode, "lines");
  assert.ok(r.lines.length > 0, "a partial reading the doctor can see beats an error");
});

test("trailing commas and stray prose are repaired, not discarded", async () => {
  const { E } = load({ text: 'Here is the reading:\n{"hr":110,"rr":24,}\nHope that helps.' });
  const r = await E.process({ image: "/tmp/m.jpg", kind: "monitor", engineOverride: "local" });
  assert.equal(r.mode, "fields");
  assert.equal(r.fields.hr, 110);
});

test("Scan Meds still gets prose, not JSON", async () => {
  const { E, calls } = load({ text: "Amoxicillin 500 mg capsules." });
  const r = await E.process({ image: "/tmp/m.jpg", kind: "meds", engineOverride: "local" });
  assert.equal(r.mode, "lines");
  assert.equal(calls[0].opts.systemOverride, null, "prose readings keep the normal image prompt");
});

test("the engine is not offered when the projector is missing", async () => {
  const { E } = load({ text: "{}" }, { visionReady: false });
  await assert.rejects(() => E.process({ image: "/tmp/m.jpg", kind: "monitor", engineOverride: "local" }),
    /cannot read images yet/);
});

test("a file:// URI is stripped, because mtmd wants a path", async () => {
  const { E, calls } = load({ text: '{"hr":70}' });
  await E.process({ image: "file:///var/mobile/x.jpg", kind: "monitor", engineOverride: "local" });
  assert.equal(calls[0].opts.images[0], "/var/mobile/x.jpg");
});
