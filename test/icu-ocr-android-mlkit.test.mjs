/* test/icu-ocr-android-mlkit.test.mjs — Android on-device OCR pin (2026-09-16): @capacitor-mlkit/text-recognition
 * (Google ML Kit, off-the-shelf, on-device, free) is the Android counterpart to the iOS VisionOcr plugin.
 * SMD_NATIVE.ocr() must fall through to it when VisionOcr is absent, and normalize its pixel boxes to the
 * SAME [0,1] top-left {text,x,y,w,h} shape iOS returns, since icu-monitor-parser.js is platform-agnostic. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");

test("ocr() falls back to ML Kit's TextRecognition plugin when VisionOcr (iOS) is absent", () => {
  assert.match(bridge, /var MLK = P && P\.TextRecognition;/);
  assert.match(bridge, /MLK\.processImage\(\{ path: path \}\)/);
});

test("ML Kit needs a file path, not a data URL: the image is written to CACHE and cleaned up", () => {
  assert.match(bridge, /function writeTempImage\(dataUrl\)/);
  assert.match(bridge, /P\.Filesystem\.writeFile\(\{ path: name, data: b64, directory: "CACHE" \}\)/);
  assert.match(bridge, /function removeTempImage\(uri\)/);
  assert.match(bridge, /\.finally\(function \(\) \{ removeTempImage\(path\); \}\)/);
});

test("ML Kit's pixel boxes are normalized to [0,1] top-left using the image's natural size", () => {
  assert.match(bridge, /function ocrImageSize\(dataUrl\)/, "natural size read via a throwaway <img>");
  assert.match(bridge, /x: r\.left \/ W, y: r\.top \/ H, w: \(r\.right - r\.left\) \/ W, h: \(r\.bottom - r\.top\) \/ H/);
});
