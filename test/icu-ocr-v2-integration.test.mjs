/* test/icu-ocr-v2-integration.test.mjs — source-level pins for wiring icu-monitor-parser.js into the
 * app (reasoning.js / image-engine.js / icu.js / index.html are WebView IIFEs):
 *   - monitor kinds go through the 2-D parser with the original pixels; vitals are never auto-filled
 *     from flattened text; only AUTO_ACCEPTED values reach the fields
 *   - the AI-Vision fallback is offered only when core vitals need review, only on a tap, and every
 *     outcome is counted; high-confidence local reads make no network call
 *   - debug mode (localStorage smd_icu_ocr_debug=1) dumps evidence and draws the overlay */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const reasoning = read("reasoning.js"), engine = read("image-engine.js"), icu = read("icu.js"), html = read("index.html");

test("index.html loads the parser before reasoning.js", () => {
  const a = html.indexOf('src="/icu-monitor-parser.js'), b = html.indexOf('src="/reasoning.js');
  assert.ok(a > 0 && b > a, "parser script tag precedes reasoning.js");
});

test("readImageLocal: monitor kinds use SMD_ICU_MONITOR.parseMonitor with a pixel source; text-only vitals are dropped", () => {
  assert.match(reasoning, /var monitorKind = \/\^\(\?:monitor\|vitals\|all\)\$\/\.test\(String\(kind\)\)/);
  assert.match(reasoning, /return smdPixelSource\(dataUrl\)\.then\(function \(px\) \{/);
  assert.match(reasoning, /V2\.parseMonitor\(boxes\.map\([\s\S]{0,200}\{ px: px, unlabeledAuto: relaxed \}\)/);
  assert.match(reasoning, /if \(kind === "all"\) delete f0\.vitals; else if \(monitorKind\) f0 = \{\};/, "no 2-D evidence → no auto-filled vitals");
  assert.match(reasoning, /if \(typeof res\.values\[k\] === "number"\) vitals\[k\] = res\.values\[k\];/, "only AUTO_ACCEPTED numerics");
  assert.match(reasoning, /localStorage\.getItem\("smd_icu_unlabeled_auto"\) === "1"/, "relaxed policy is an explicit opt-in");
});

test("pixel source is the original capture on a canvas, capped, and fails soft to null (colour neutral)", () => {
  assert.match(reasoning, /function smdPixelSource\(dataUrl\)/);
  assert.match(reasoning, /var MAX = 2400/);
  assert.match(reasoning, /img\.onerror = function \(\) \{ res\(null\); \};/);
});

test("image-engine: AI Vision offered only when core vitals need review, only on tap; counters cover every outcome", () => {
  assert.match(engine, /var core = \(r\.monitor && r\.monitor\.review \|\| \[\]\)\.filter\(function \(k\) \{ return \/\^\(\?:hr\|spo2\|sbp\|dbp\|map\|rr\)\$\/\.test\(k\); \}\);/);
  assert.match(engine, /stat\(core\.length \? "local_needs_review" : "local_success"\);/);
  assert.match(engine, /if \(!core\.length \|\| !aiAvailable\(\) \|\| !online\(\)\) return r;/, "high-confidence local read returns without any dialog or network");
  assert.match(engine, /if \(f !== "ai"\) return r;/, "dismiss / manual keeps the on-device result");
  assert.match(engine, /stat\("gemini_fallback"\);/); assert.match(engine, /stat\(ar && ar\.mode === "fields" \? "gemini_success" : "gemini_failure"\)/);
  assert.match(engine, /stat\("network_calls"\);\s*return window\.SMD_AI\.vision\(image, kind\)/, "every cloud call is counted");
  assert.match(engine, /stats: stats,/, "SMD_IMAGE_ENGINE.stats() exported");
});

test("debug mode: evidence dump + overlay hook in both review sheets", () => {
  assert.match(reasoning, /localStorage\.getItem\("smd_icu_ocr_debug"\) === "1"/);
  assert.match(reasoning, /window\.__SMD_ICU_OCR_LAST = \{ result: res, boxes: boxes, image: dataUrl, kind: kind \};/);
  assert.match(icu, /function smdOcrOverlay\(el\)/);
  assert.equal((icu.match(/smdOcrOverlay\(el\);/g) || []).length, 2, "single-kind and combined review sheets");
  assert.match(icu, /M\.overlaySVG\(last\.result, last\.boxes, w, h\)/);
});
