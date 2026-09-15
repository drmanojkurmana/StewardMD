/* test/icu-hybrid-merge.test.mjs — hybrid check: device OCR + AI Vision on the monitor crop. A value auto-fills
 * only when both readers agree; any disagreement or single-reader value stays NEEDS_REVIEW. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const M = createRequire(import.meta.url)("../icu-monitor-parser.js");
const SRC = readFileSync(new URL("../image-engine.js", import.meta.url), "utf8");
const meta = (fields) => ({ fields, review: Object.keys(fields).filter((k) => fields[k].status === "NEEDS_REVIEW") });

test("device AUTO + AI agrees stays AUTO; device AUTO + AI differs goes to review", () => {
  const r = M.hybridMerge({ hr: 72, spo2: 97 }, meta({ hr: { status: "AUTO_ACCEPTED" }, spo2: { status: "AUTO_ACCEPTED" } }), { hr: 72, spo2: 91 });
  assert.equal(r.fields.hr, 72);
  assert.equal(r.fields.spo2, undefined);
  assert.equal(r.meta.fields.spo2.status, "NEEDS_REVIEW");
  assert.match(r.meta.fields.spo2.reason, /AI Vision reads 91/);
});

test("device REVIEW with the same suggestion as AI becomes AUTO; a different one stays review", () => {
  const r = M.hybridMerge({}, meta({ rr: { status: "NEEDS_REVIEW", suggested: 16, reason: "confidence 0.84 below 0.85" }, hr: { status: "NEEDS_REVIEW", suggested: 88 } }), { rr: 16, hr: 86 });
  assert.equal(r.fields.rr, 16);
  assert.equal(r.meta.fields.rr.status, "AUTO_ACCEPTED");
  assert.equal(r.fields.hr, undefined);
  assert.match(r.meta.fields.hr.reason, /AI Vision reads 86/);
});

test("AI-only values are suggestions, never AUTO", () => {
  const r = M.hybridMerge({}, meta({ spo2: { status: "NOT_FOUND" } }), { spo2: 96, etco2: "38" });
  assert.deepEqual(r.fields, {});
  assert.equal(r.meta.fields.spo2.status, "NEEDS_REVIEW");
  assert.equal(r.meta.fields.etco2.suggested, 38);
});

test("pressure source questions are not answered by digit agreement; BP halves fill together", () => {
  const r = M.hybridMerge({}, meta({ sbp: { status: "NEEDS_REVIEW", suggested: 120, reason: "pressure source (ART / NIBP) not identified" }, dbp: { status: "NEEDS_REVIEW", suggested: 80, reason: "pressure source (ART / NIBP) not identified" } }), { sbp: 120, dbp: 80 });
  assert.equal(r.fields.sbp, undefined);
  assert.equal(r.meta.fields.sbp.status, "NEEDS_REVIEW");
  const h = M.hybridMerge({ sbp: 120, dbp: 80, map: 93 }, meta({ sbp: { status: "AUTO_ACCEPTED" }, dbp: { status: "AUTO_ACCEPTED" }, map: { status: "AUTO_ACCEPTED" } }), { sbp: 120, dbp: 70 });
  assert.equal(h.fields.sbp, undefined, "dbp disagreed, so sbp and map go to review too");
  assert.equal(h.fields.map, undefined);
});

test("inputs are not mutated and non-numeric AI values are ignored", () => {
  const f = { hr: 72 }, m = meta({ hr: { status: "AUTO_ACCEPTED" } });
  M.hybridMerge(f, m, { hr: "seventy", rr: null });
  assert.deepEqual(f, { hr: 72 });
  assert.equal(m.fields.hr.status, "AUTO_ACCEPTED");
});

test("digit reader: same digits confirm, different confident digits conflict, low confidence abstains, never adds", () => {
  const b = (text, x) => ({ text, conf: 1, x, y: 0.1, w: 0.1, h: 0.05 });
  const obs = [b("16", 0.1), b("98", 0.3), b("3° 22", 0.5), b("120", 0.7)];
  const r = M.applyDigitReads(obs, [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.05, text: "16", conf: 0.9995 },
    { x: 0.3, y: 0.1, w: 0.1, h: 0.05, text: "96", conf: 0.9999 },
    { x: 0.5, y: 0.1, w: 0.1, h: 0.05, text: "22", conf: 0.9999 },
    { x: 0.7, y: 0.1, w: 0.1, h: 0.05, text: "126", conf: 0.99 },
    { x: 0.9, y: 0.1, w: 0.1, h: 0.05, text: "55", conf: 1 }
  ]);
  assert.equal(r.length, 4, "a read with no matching OCR box adds nothing");
  assert.equal(r[0].confirmed, true);
  assert.match(r[1].ocrConflict, /digit reader 96/);
  assert.equal(r[2].confirmed, true, "stray label glyphs are not a disagreement");
  assert.equal(r[3].confirmed, undefined, "below 0.999 the reader abstains");
  assert.equal(obs[0].confirmed, undefined, "input not mutated");
  assert.deepEqual(M.digitReadBoxes([b("HR", 0), b("72", 0.2)]), [{ x: 0.2, y: 0.1, w: 0.1, h: 0.05 }]);
});

// ── end to end through image-engine.js: device read -> automatic AI check on the crop -> merged result ──
function load({ local, ai, consent = true, hybrid }) {
  const sent = [];
  const store = Object.assign(consent ? { "stewardmd.aiVisionPhiConsent": "true" } : {}, hybrid === "0" ? { smd_icu_hybrid: "0" } : {});
  const node = () => ({ setAttribute() {}, appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(_v) {}, get innerHTML() { return ""; }, addEventListener() {}, textContent: "" });
  const win = {
    navigator: { onLine: true },
    localStorage: { _d: store, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    document: { createElement: node, getElementById: () => null, head: node(), body: node(), querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {}, Capacitor: { isNativePlatform: () => true, Plugins: {} },
    SMD_NATIVE: { ocr: () => Promise.resolve({}) },
    SMD_ICU_MONITOR: M,
    SMD_AI: {
      readImageLocal: async () => JSON.parse(JSON.stringify(local)),
      cropImage: async (img, reg) => { sent.push({ crop: reg }); return "data:image/jpeg;base64,CROP"; },
      vision: async (img, kind) => { sent.push({ img, kind }); return ai; }
    }
  };
  win.window = win;
  new Function("window", "document", "localStorage", "navigator", SRC)(win, win.document, win.localStorage, win.navigator);
  return { E: win.SMD_IMAGE_ENGINE, sent };
}
const LOCAL = { mode: "fields", fields: { hr: 72 }, lines: [], monitor: { fields: { hr: { status: "AUTO_ACCEPTED" }, rr: { status: "NEEDS_REVIEW", suggested: 16, reason: "confidence 0.84 below 0.85" }, spo2: { status: "NEEDS_REVIEW", suggested: 97 } }, review: ["rr", "spo2"], stats: { crop: { region: { x: 0.1, y: 0.2, w: 0.6, h: 0.5, scale: 2 } } } } };

test("with consent, review fields trigger an automatic AI check of the MONITOR CROP; agreement fills, disagreement stays review", async () => {
  const { E, sent } = load({ local: LOCAL, ai: { fields: { hr: 72, rr: 16, spo2: 95 } } });
  const r = await E.process({ image: "data:image/jpeg;base64,FULL", kind: "monitor", engineOverride: "device" });
  assert.deepEqual(sent[0].crop, { x: 0.1, y: 0.2, w: 0.6, h: 0.5, maxLong: 1280 });
  assert.equal(sent[1].img, "data:image/jpeg;base64,CROP", "only the crop is uploaded");
  assert.equal(r.fields.hr, 72);
  assert.equal(r.fields.rr, 16, "device suggestion confirmed by AI Vision");
  assert.equal(r.fields.spo2, undefined, "97 vs 95 stays review");
  assert.equal(r.monitor.fields.spo2.status, "NEEDS_REVIEW");
});

test("AI failure returns the device result unchanged; smd_icu_hybrid=0 never uploads automatically", async () => {
  const a = load({ local: LOCAL, ai: { error: "timeout" } });
  const r = await a.E.process({ image: "x", kind: "monitor", engineOverride: "device" });
  assert.deepEqual(r.fields, { hr: 72 });
  const b = load({ local: LOCAL, ai: { fields: { rr: 16 } }, hybrid: "0" });
  b.E.process({ image: "x", kind: "monitor", engineOverride: "device" }).catch(() => {});   // the dialog needs a real DOM; only the absence of an upload is asserted
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(b.sent.length, 0, "no automatic upload when switched off (the clinician gets the dialog)");
});
