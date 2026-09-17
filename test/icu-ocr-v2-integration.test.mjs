/* test/icu-ocr-v2-integration.test.mjs — source-level pins for wiring icu-monitor-parser.js into the
 * app (reasoning.js / image-engine.js / icu.js / index.html / the VisionOcr plugin):
 *   - monitor kinds go through the 2-D parser with the original pixels; vitals are never auto-filled
 *     from flattened text; only AUTO_ACCEPTED values reach the fields; unlabeledAuto is opt-in only
 *   - two-scale: the numeric region is cropped from the ORIGINAL, read again on-device, mapped back
 *     and merged BEFORE parsing; a crop failure falls back to the full pass
 *   - image-quality gate: RETAKE_PHOTO extracts nothing and says why; AI Vision only on tap
 *   - the AI-Vision fallback is offered only when core vitals need review, and every outcome is counted
 *   - ART and NIBP are surfaced separately; debug mode dumps evidence and draws the overlay */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const reasoning = read("reasoning.js"), engine = read("image-engine.js"), icu = read("icu.js"), html = read("index.html");
const plugin = read("local-plugins/capacitor-vision-ocr/ios/Sources/VisionOcrPlugin/VisionOcrPlugin.swift");

test("index.html loads the parser before reasoning.js", () => {
  const a = html.indexOf('src="/icu-monitor-parser.js'), b = html.indexOf('src="/reasoning.js');
  assert.ok(a > 0 && b > a, "parser script tag precedes reasoning.js");
});

test("readImageLocal: monitor kinds use the 2-D parser; text-only vitals are dropped; strict unless explicitly opted in", () => {
  assert.match(reasoning, /var monitorKind = \/\^\(\?:monitor\|vitals\|all\)\$\/\.test\(String\(kind\)\)/);
  assert.match(reasoning, /if \(kind === "all"\) delete f0\.vitals; else if \(monitorKind\) f0 = \{\};/, "no 2-D evidence → no auto-filled vitals");
  assert.match(reasoning, /if \(typeof res\.values\[k\] === "number"\) vitals\[k\] = res\.values\[k\];/, "only AUTO_ACCEPTED numerics");
  assert.match(reasoning, /relaxed = localStorage\.getItem\("smd_icu_unlabeled_auto"\) === "1"/, "relaxed policy is an explicit opt-in");
  assert.doesNotMatch(reasoning, /unlabeledAuto: true/, "never enabled by default in the app");
});

test("two-scale: crop the ORIGINAL at the parser's region, OCR on-device again, map back, merge, then parse", () => {
  assert.match(reasoning, /region = imageSize \? V2\.monitorRegion\(fullObs, imageSize\) : null/);
  assert.match(reasoning, /smdCropDataUrl\(dataUrl, region\)/, "crop comes from the original capture, not the 900px cloud copy");
  assert.match(reasoning, /window\.SMD_NATIVE\.ocr\(cropUrl, \{ languageCorrection: false \}\)/);
  assert.match(reasoning, /V2\.mergeObservations\(fullObs, V2\.mapCropObservations\(cb, region\)\)/);
  assert.match(reasoning, /\.catch\(function \(\) \{ return \{ obs: fullObs, crop: \{ region: region, error: "crop-ocr-failed" \} \}; \}\)/, "crop failure → full pass only");
  assert.match(reasoning, /ctx\.imageSmoothingQuality = "high"/);
});

test("plugin returns Vision's quadrilateral for the tilt/perspective gate", () => {
  assert.match(plugin, /"q": \[Double\(observation\.topLeft\.x\), Double\(1\.0 - observation\.topLeft\.y\),/);
});

test("quality gate: RETAKE_PHOTO extracts nothing, explains why, AI Vision only on tap", () => {
  assert.match(reasoning, /quality: \{ status: res\.quality\.status, issues: res\.quality\.issues \}/);
  assert.match(engine, /r\.monitor\.quality\.status === "RETAKE_PHOTO"/);
  assert.match(engine, /stat\("local_retake"\);/);
  assert.match(engine, /title: "Retake the photo"/);
});

test("ART and NIBP are surfaced separately, never merged", () => {
  assert.match(reasoning, /sources: \{ art: res\.fields\.art \? \{[^}]*\} : null, nibp: res\.fields\.nibp \? \{/);
});

test("image-engine: AI Vision offered only when core vitals need review, only on tap; counters cover every outcome", () => {
  assert.match(engine, /var core = \(r\.monitor && r\.monitor\.review \|\| \[\]\)\.filter\(function \(k\) \{ return \/\^\(\?:hr\|spo2\|sbp\|dbp\|map\|rr\)\$\/\.test\(k\); \}\);/);
  assert.match(engine, /stat\(core\.length \? "local_needs_review" : "local_success"\);/);
  assert.match(engine, /if \(!core\.length\) return r;/, "high-confidence local read returns without any dialog or network");
  // hybrid (2026-09-16): the second reader follows the user's own answer-engine choice (aiAvailable() reads
  // that same policy) — Cloud/Auto checks with AI Vision, Local checks with the downloaded vision pack.
  assert.match(engine, /if \(aiAvailable\(\) && online\(\) && getConsent\(\)\) return hybridCheck\(r, image, kind\);/);
  assert.match(engine, /if \(!aiAvailable\(\) && localVisionReady\(\)\) return localHybridCheck\(r, image, kind\);/);
  assert.match(engine, /if \(!aiAvailable\(\) \|\| !online\(\)\) return r;/, "neither reader available → the on-device result stands");
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
