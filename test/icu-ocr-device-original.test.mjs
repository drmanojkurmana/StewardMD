/* test/icu-ocr-device-original.test.mjs — source-level (icu.js / image-engine.js / native-bridge.js
 * are WebView IIFEs) pins for the 2026-09-14 on-device OCR fixes:
 *   1. Private Device OCR gets the ORIGINAL capture, not the 900px/q0.6 JPEG made for cloud tokens.
 *   2. Numeric screens turn Vision's language correction off (it rewrote digits and "PHILIPS"). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const icu = read("icu.js"), engine = read("image-engine.js"), reasoning = read("reasoning.js"), bridge = read("native-bridge.js");
const swift = read("local-plugins/capacitor-vision-ocr/ios/Sources/VisionOcrPlugin/VisionOcrPlugin.swift");

test("ICU passes the uncompressed capture alongside the compressed one (both snapshot entry points)", () => {
  assert.match(icu, /compressImage\(dataUrl, function \(d\) \{ runSnap\(kind, out, d, dataUrl\); \}\);/, "step buttons");
  assert.match(icu, /doOcr\(kind, d, meta \? meta\.kb \+ " KB" : "", dataUrl\);/, "camera / photos import");
  assert.match(icu, /function runSnap\(kind, out, dataUrl, original\)/);
  assert.match(icu, /function doOcr\(kind, dataUrl, note, original\)/);
  const calls = icu.match(/SMD_IMAGE_ENGINE\.process\(\{ image: dataUrl, kind: [^}]*\}\)/g) || [];
  assert.ok(calls.length >= 4, "found the process() calls");
  for (const c of calls) assert.match(c, /original: original/, "every process() call forwards the original: " + c);
});

test("image-engine routes the ORIGINAL to device OCR and the compressed image to AI Vision", () => {
  assert.match(engine, /var original = opts\.original \|\| image;/);
  assert.match(engine, /function route\(engine, image, kind, original\)/);
  assert.match(engine, /routeAI\(image, kind\) : routeDevice\(original \|\| image, kind\)/,
    "cloud keeps paying for the small image; the free engine gets the pixels");
});

test("numeric kinds disable language correction; case sheets keep it", () => {
  assert.match(reasoning, /var numeric = \/\^\(\?:monitor\|vitals\|abg\|labs\|mapped\|ventilator\|all\)\$\/\.test\(String\(kind\)\)/);
  assert.match(reasoning, /window\.SMD_NATIVE\.ocr\(dataUrl, \{ languageCorrection: !numeric \}\)/);
  assert.match(bridge, /languageCorrection: !\(opts && opts\.languageCorrection === false\)/, "default stays ON for older callers");
  assert.match(swift, /request\.usesLanguageCorrection = call\.getBool\("languageCorrection"\) \?\? true/);
  assert.match(swift, /"conf": Double\(top\.confidence\)/, "per-line confidence is returned for diagnostics");
});

test("readImageLocal hands the boxes to the parser and returns them", () => {
  assert.match(reasoning, /parseFieldsOnDevice\(text, kind, boxes\) \|\| \{\};/, "non-monitor kinds: text parser still gets the boxes");
  assert.match(reasoning, /var fullObs = boxes\.map\(function \(b\) \{ return \{ text: b\.text, conf: b\.conf, x: b\.x, y: b\.y, w: b\.w, h: b\.h, q: b\.q \}; \}\);/, "monitor kinds: the 2-D parser gets the boxes (with Vision's quadrilateral)");
  assert.match(reasoning, /V2\.parseMonitor\(obsM, \{ px: px, imageSize: ctx\.imageSize, twoScale: \{ ran: !!\(ctx\.crop && !ctx\.crop\.error\) \}, unlabeledAuto: relaxed, detections: ctx\.detections \|\| undefined \}\)/);
  assert.match(reasoning, /V2\.tileRegions\(ctx\.obs, ctx\.detections, ctx\.imageSize\)/, "detected tiles with no digits are re-read");
  assert.match(reasoning, /V2\.applyConfirmation\(ctx\.obs, b\)/, "the second tile read can only confirm");
  assert.match(reasoning, /window\.SMD_NATIVE\.readDigits\(dataUrl, dboxes\)/, "the digit reader reads the original capture");
  assert.match(reasoning, /V2\.applyDigitReads\(ctx\.obs, r\.reads\)/, "digit reads can only confirm or conflict");
  assert.match(bridge, /TR\.readDigits\(\{ base64Image: b64, boxes: boxes \}\)/);
  assert.match(swift, /forResource: "DigitReader", withExtension: "mlmodelc"/);
  assert.match(reasoning, /window\.SMD_NATIVE\.detectVitals\(dataUrl\)/, "the on-device detector runs on the original capture");
  assert.match(reasoning, /\{ mode: "fields", fields: fields, lines: lines, boxes: boxes, source: "on-device" \}/);
});
