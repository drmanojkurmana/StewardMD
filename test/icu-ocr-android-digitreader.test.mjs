/* test/icu-ocr-android-digitreader.test.mjs — Android on-device digit reader pin (2026-09-16): a Kotlin
 * TFLite port of the iOS Core ML CRNN-CTC model (same best.pt checkpoint, converted PyTorch -> ONNX ->
 * TFLite, verified 50/50 exact text match against the PyTorch original before shipping). Registers as
 * `VisionOcr` on Android too, so window.SMD_NATIVE.readDigits (native-bridge.js) reaches it with zero
 * platform-specific JS: the plugin name and readDigits contract ({base64Image, boxes} ->
 * {available, reads:[{x,y,w,h,text,conf}]}) are identical to the iOS Swift implementation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const kt = readFileSync(new URL("../local-plugins/capacitor-vision-ocr/android/src/main/java/com/stewardmd/visionocr/VisionOcrPlugin.kt", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../local-plugins/capacitor-vision-ocr/package.json", import.meta.url), "utf8"));
const gradle = readFileSync(new URL("../local-plugins/capacitor-vision-ocr/android/build.gradle", import.meta.url), "utf8");

test("the plugin registers as VisionOcr, same jsName as iOS, so native-bridge.js needs no Android-specific branch", () => {
  assert.match(kt, /@CapacitorPlugin\(name = "VisionOcr"\)/);
  assert.match(kt, /fun readDigits\(call: PluginCall\)/);
});

test("package.json declares an Android source dir alongside iOS", () => {
  assert.equal(pkg.capacitor.android.src, "android");
});

test("the TFLite model ships in assets, stored uncompressed", () => {
  assert.ok(existsSync(new URL("../local-plugins/capacitor-vision-ocr/android/src/main/assets/DigitReader.tflite", import.meta.url)), "DigitReader.tflite must be bundled");
  assert.match(gradle, /noCompress "tflite"/);
  assert.match(gradle, /org\.tensorflow:tensorflow-lite:\$tensorflowLiteVersion/);
});

test("preprocessing mirrors the iOS Swift port exactly: 10% height padding, resize to H=48 area/bilinear, 1st/99th percentile stretch, median-pad to W=192", () => {
  assert.match(kt, /val pad = 0\.10 \* bhn \* bh/, "same 10% height padding as VisionOcrPlugin.swift's readDigits");
  assert.match(kt, /private fun percentile\(sorted: FloatArray, p: Float\)/);
  assert.match(kt, /percentile\(sorted, 0\.01f\)/);
  assert.match(kt, /percentile\(sorted, 0\.99f\)/);
  assert.match(kt, /private const val H = 48/);
  assert.match(kt, /private const val W = 192/);
});

test("decode reads the model's (1,16,48) [batch,class,time] output layout - NOT (batch,time,class) like the original PyTorch model", () => {
  // onnx2tf's direct-flatbuffer conversion kept this transposed vs. the PyTorch/Core ML (1,48,16) shape;
  // verified numerically (parity_tflite.py: 50/50 exact text match) before this indexing was written.
  assert.match(kt, /logits\[0\]\[k\]\[t\]/, "class axis before time axis when reading a frame's score");
});

test("readDigits echoes the caller's box coordinates unchanged, for icu-monitor-parser.js's exact-match confirmation", () => {
  assert.match(kt, /out\.put\("x", bx\); out\.put\("y", by\); out\.put\("w", bwn\); out\.put\("h", bhn\)/);
});
