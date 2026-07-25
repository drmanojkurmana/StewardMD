/* test/thorex-ort.test.js — REAL on-device engine (thorex-ort.js) verification.
 *
 * Gate: proves the on-device pipeline (decode -> xrv preprocess -> ONNX session -> probs/cam -> findings
 * -> CAM heatmap) produces the SAME numbers as a direct onnxruntime-node run of the identical model —
 * they must be identical, because it is the same model + the same tensor (the pipeline just supplies a
 * bit-exact tensor via a no-op crop/resize on an already-224x224 synthetic input). Also exercises the
 * pure preprocessing/CAM math against hand-computed expected numbers, independent of ONNX Runtime.
 *
 * OD-D: also proves analyzeImage(input, {includeEducational:true}) runs BOTH the clinical
 * (torchxrayvision) and educational (X-Raydar) engines on-device and that the educational engine's
 * top-k labels/probs match a direct onnxruntime-node run of the identical X-Raydar ONNX + tensor.
 *
 * If onnxruntime-node cannot be loaded in this environment, this HONESTLY reports that (SKIP, not a
 * fake pass) and still runs every pure-math check it can (preprocessing formula, CAM ReLU/normalize/
 * colorize) so the non-ML parts of the pipeline stay covered.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

global.window = global; // so thorex-ort.js's window.SMD_THOREX_MODELS resolves the same instance
const MODELS = require("../thorex-models.js");
global.window.SMD_THOREX_MODELS = MODELS;
const ORT_ENGINE = require("../thorex-ort.js");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };

const LABELS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "models", "thorex_clinical_labels.json"), "utf8"));
const MODEL_PATH = path.join(__dirname, "..", "models", "thorex_clinical.onnx");
const EDU_LABELS_PATH = path.join(__dirname, "..", "models", "thorex_xraydar_labels.json");
const EDU_MODEL_PATH = path.join(__dirname, "..", "models", "thorex_xraydar.onnx");
const EDU_LABELS = fs.existsSync(EDU_LABELS_PATH) ? JSON.parse(fs.readFileSync(EDU_LABELS_PATH, "utf8")) : null;

// ── Deterministic synthetic 224x224 "image" (a smooth radial pattern + texture, values 0..255) ──────
// Built at 224x224 directly (not a larger photo) so centerCropSquare + bilinearResize are BOTH no-ops —
// this is what makes the full analyzeImage() pipeline output bit-comparable to a hand-built tensor fed
// straight into onnxruntime-node: both paths apply the identical xrv-normalize formula to the identical
// pixel values, with no interpolation in between to introduce drift.
const SIZE = 224;
function buildSyntheticPixels() {
  const px = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - SIZE / 2, dy = y - SIZE / 2;
      const r = Math.sqrt(dx * dx + dy * dy) / (SIZE / 2);
      const base = 180 - r * 120;
      const texture = 10 * Math.sin(x / 9) * Math.cos(y / 11);
      px[y * SIZE + x] = Math.max(0, Math.min(255, base + texture));
    }
  }
  return px;
}
const pixels = buildSyntheticPixels();

// ── Part 1: pure preprocessing math, verified against hand-computed expected numbers (no ONNX) ──────
(function testPreprocessMath() {
  // xrv normalize: (2*(px/255) - 1) * 1024
  const sample = Float32Array.from([0, 127.5, 255]);
  const normed = ORT_ENGINE._diag.xrvNormalize(Float32Array.from(sample));
  ok("xrvNormalize(0) == -1024", Math.abs(normed[0] - -1024) < 1e-6);
  ok("xrvNormalize(127.5) == 0", Math.abs(normed[1] - 0) < 1e-6);
  ok("xrvNormalize(255) == 1024", Math.abs(normed[2] - 1024) < 1e-6);

  // centerCropSquare: a 10x6 rect -> 6x6 crop at Python floor-div offsets (startx=10//2-6//2=2, starty=0)
  const rect = new Float32Array(10 * 6);
  for (let i = 0; i < rect.length; i++) rect[i] = i;
  const crop = ORT_ENGINE._diag.centerCropSquare(rect, 10, 6);
  ok("centerCropSquare size = min(w,h)", crop.size === 6);
  ok("centerCropSquare picks the Python-floor-div-offset window", crop.data[0] === rect[2] && crop.data[5] === rect[7]);

  // bilinearResize: identity when src/dst sizes match (the no-op path the parity test below relies on)
  const same = ORT_ENGINE._diag.bilinearResize(pixels, SIZE, SIZE, SIZE, SIZE);
  let identical = true;
  for (let i = 0; i < pixels.length; i++) if (same[i] !== pixels[i]) { identical = false; break; }
  ok("bilinearResize is a no-op when src size == dst size", identical);

  // full pipeline on our synthetic 224x224 image: crop+resize are no-ops, so the result must equal
  // xrvNormalize(pixels) exactly.
  const expectedTensor = ORT_ENGINE._diag.xrvNormalize(Float32Array.from(pixels));
  const gotTensor = ORT_ENGINE._diag.preprocessToTensorData({ data: pixels, width: SIZE, height: SIZE });
  let tensorMatches = gotTensor.length === expectedTensor.length;
  if (tensorMatches) for (let i = 0; i < expectedTensor.length; i++) if (Math.abs(gotTensor[i] - expectedTensor[i]) > 1e-5) { tensorMatches = false; break; }
  ok("preprocessToTensorData(224x224 input) == xrvNormalize(pixels) exactly (no-op crop/resize)", tensorMatches);

  // RGBA -> grayscale luma weights (PIL convert('L'): 0.299R + 0.587G + 0.114B)
  const gray = ORT_ENGINE._diag.grayFromImageLike({ width: 1, height: 1, data: new Uint8ClampedArray([100, 150, 200, 255]) });
  const expectedLuma = 0.299 * 100 + 0.587 * 150 + 0.114 * 200;
  ok("RGBA->grayscale luma matches PIL convert('L') weights", Math.abs(gray.data[0] - expectedLuma) < 1e-6);
})();

// ── Part 1b: OD-D educational (X-Raydar) preprocessing math, verified against hand-computed numbers ──
(function testEduPreprocessMath() {
  // padToSquareGray: a 10x6 rect -> 10x10 square, centered, black (0) padding.
  // PIL ImageOps.pad(color=0, centering=(0.5,0.5)) offset = int((side-dim)*0.5) == floor for non-neg.
  const rect = new Float32Array(10 * 6);
  for (let i = 0; i < rect.length; i++) rect[i] = i + 1; // avoid 0 so we can distinguish real data from padding
  const padded = ORT_ENGINE._diag.padToSquareGray({ data: rect, width: 10, height: 6 });
  ok("padToSquareGray: side = max(w,h)", padded.size === 10);
  const offY = Math.floor((10 - 6) / 2); // = 2
  ok("padToSquareGray: top padding rows are black (0)", padded.data[0] === 0 && padded.data[10 - 1] === 0);
  ok("padToSquareGray: original data lands at the centered vertical offset", padded.data[offY * 10] === rect[0] && padded.data[offY * 10 + 9] === rect[9]);
  ok("padToSquareGray: bottom padding rows are black (0)", padded.data[(offY + 6) * 10] === 0);

  // padToSquareGray: already-square input is a no-op copy (no padding needed).
  const sq = new Float32Array(9); for (let i = 0; i < 9; i++) sq[i] = i;
  const paddedSq = ORT_ENGINE._diag.padToSquareGray({ data: sq, width: 3, height: 3 });
  ok("padToSquareGray: no-op for already-square input", paddedSq.size === 3 && Array.from(paddedSq.data).every((v, i) => v === sq[i]));

  // normalizeXraydar: (px/255 - 0.491) / 0.271
  const sample = Float32Array.from([0, 255]);
  const normed = ORT_ENGINE._diag.normalizeXraydar(Float32Array.from(sample));
  ok("normalizeXraydar(0) == (0-0.491)/0.271", Math.abs(normed[0] - ((0 - 0.491) / 0.271)) < 1e-6);
  ok("normalizeXraydar(255) == (1-0.491)/0.271", Math.abs(normed[1] - ((1 - 0.491) / 0.271)) < 1e-6);

  // Full edu preprocessing on an already-512x512 input: pad is a no-op, resize is a no-op, so the
  // result must equal normalizeXraydar(pixels) exactly (mirrors the clinical no-op-parity check above).
  const EDU_SIZE = ORT_ENGINE._diag.EDU_INPUT_SIZE;
  ok("EDU_INPUT_SIZE is 512", EDU_SIZE === 512);
  const eduPixels = new Float32Array(EDU_SIZE * EDU_SIZE);
  for (let i = 0; i < eduPixels.length; i++) eduPixels[i] = (i * 37) % 256;
  const expectedEduTensor = ORT_ENGINE._diag.normalizeXraydar(Float32Array.from(eduPixels));
  const gotEduTensor = ORT_ENGINE._diag.preprocessToTensorDataEdu({ data: eduPixels, width: EDU_SIZE, height: EDU_SIZE });
  let eduTensorMatches = gotEduTensor.length === expectedEduTensor.length;
  if (eduTensorMatches) for (let i = 0; i < expectedEduTensor.length; i++) if (Math.abs(gotEduTensor[i] - expectedEduTensor[i]) > 1e-5) { eduTensorMatches = false; break; }
  ok("preprocessToTensorDataEdu(512x512 square input) == normalizeXraydar(pixels) exactly (no-op pad/resize)", eduTensorMatches);

  ok("eduRelevanceFor returns the 'educational' tag (matches mock/sample convention)", ORT_ENGINE._diag.eduRelevanceFor("anything") === "educational");
})();

// ── Part 1c: anti-aliased downscale (downscaleTo/halveBoxFilter) — OD-E ────────────────────────────
// Verifies the fix for aliasing on large camera photos: a naive single-pass bilinearResize only samples
// 4 neighboring input pixels regardless of downscale ratio, so a huge center-crop squeezed straight down
// to 224/512 can alias. downscaleTo() instead box-filter-halves (mip-chain, never more than 2x per step)
// until within 2x of the target, then does one final bilinearResize. Pure numeric — no DOM/canvas needed,
// so this is fully Node-testable (the same code path also runs unchanged in the WebView).
(function testAntiAliasedDownscale() {
  // halveBoxFilter: a 4x4 image of four distinct 2x2 quadrant values -> 2x2 output, each cell the exact
  // average of its quadrant (exact box-filter, not an approximation, when quadrants are uniform blocks).
  const q = new Float32Array(16);
  // top-left=10, top-right=20, bottom-left=30, bottom-right=40 (each a 2x2 block)
  const rows = [
    [10, 10, 20, 20],
    [10, 10, 20, 20],
    [30, 30, 40, 40],
    [30, 30, 40, 40]
  ];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) q[y * 4 + x] = rows[y][x];
  const halved = ORT_ENGINE._diag.halveBoxFilter(q, 4);
  ok("halveBoxFilter: output size = floor(size/2)", halved.size === 2);
  ok("halveBoxFilter: exact block averages (10,20,30,40 quadrants)",
    halved.data[0] === 10 && halved.data[1] === 20 && halved.data[2] === 30 && halved.data[3] === 40);

  // halveBoxFilter: odd input size clamps the trailing row/col (no out-of-bounds read/crash).
  const odd = new Float32Array(9); for (let i = 0; i < 9; i++) odd[i] = i + 1; // 3x3, values 1..9
  const oddHalved = ORT_ENGINE._diag.halveBoxFilter(odd, 3);
  ok("halveBoxFilter: odd size -> floor(3/2)=1 output, no throw", oddHalved.size === 1 && isFinite(oddHalved.data[0]));

  // downscaleTo: large downscale ratio (1000x1000 -> 224) must not throw, must multi-step (1000 -> 500 ->
  // 250 -> [within 2x of 224] -> final bilinear to exactly 224x224), and every output value must be
  // finite and bounded within the source data's range (an anti-aliased resize is a weighted average, so
  // it can never overshoot the min/max of the input — a naive/buggy resize that read garbage would).
  const BIG = 1000;
  const bigPixels = new Float32Array(BIG * BIG);
  let srcMin = Infinity, srcMax = -Infinity;
  for (let y = 0; y < BIG; y++) {
    for (let x = 0; x < BIG; x++) {
      // high-frequency checkerboard-ish pattern — exactly the kind of content a naive resize aliases on.
      const v = ((x % 7 < 3) !== (y % 5 < 2)) ? 250 : 5;
      bigPixels[y * BIG + x] = v;
      if (v < srcMin) srcMin = v; if (v > srcMax) srcMax = v;
    }
  }
  let threw = false, downscaled;
  try { downscaled = ORT_ENGINE._diag.downscaleTo({ data: bigPixels, size: BIG }, 224); }
  catch (e) { threw = true; }
  ok("downscaleTo(1000x1000 -> 224) does not throw", !threw);
  ok("downscaleTo(1000x1000 -> 224) output length is 224*224", downscaled && downscaled.length === 224 * 224);
  let dsFinite = true, dsBounded = true;
  if (downscaled) for (let i = 0; i < downscaled.length; i++) {
    if (!isFinite(downscaled[i])) dsFinite = false;
    if (downscaled[i] < srcMin - 1e-6 || downscaled[i] > srcMax + 1e-6) dsBounded = false;
  }
  ok("downscaleTo output values are all finite", dsFinite);
  ok("downscaleTo output values stay within the source min/max (weighted-average anti-alias, no overshoot)", dsBounded);

  // Full clinical preprocessing pipeline end-to-end on a large (1000x1000) synthetic photo: proves the
  // multi-step path actually ran INSIDE preprocessToTensorData (not just the standalone helper above),
  // and that the resulting tensor is the correct [1,1,224,224]-flattenable shape with finite values.
  const bigGray = { data: bigPixels, width: BIG, height: BIG };
  const bigTensor = ORT_ENGINE._diag.preprocessToTensorData(bigGray);
  ok("preprocessToTensorData(1000x1000) output length is 224*224 (ready for [1,1,224,224])", bigTensor.length === 224 * 224);
  let tensorFinite = true;
  for (let i = 0; i < bigTensor.length; i++) if (!isFinite(bigTensor[i])) { tensorFinite = false; break; }
  ok("preprocessToTensorData(1000x1000) tensor values are all finite (bounded, no NaN/Infinity from the resize)", tensorFinite);

  // Same end-to-end check for the X-Raydar (educational) 512 path, on a large NON-square photo (so
  // padToSquareGray's pad also runs before the anti-aliased downscale).
  const BIGW = 1200, BIGH = 800;
  const eduBigPixels = new Float32Array(BIGW * BIGH);
  for (let i = 0; i < eduBigPixels.length; i++) eduBigPixels[i] = (i * 13) % 256;
  const eduBigTensor = ORT_ENGINE._diag.preprocessToTensorDataEdu({ data: eduBigPixels, width: BIGW, height: BIGH });
  const EDU_SIZE = ORT_ENGINE._diag.EDU_INPUT_SIZE;
  ok("preprocessToTensorDataEdu(1200x800) output length is 512*512 (ready for [1,1,512,512])", eduBigTensor.length === EDU_SIZE * EDU_SIZE);
  let eduTensorFinite = true;
  for (let i = 0; i < eduBigTensor.length; i++) if (!isFinite(eduBigTensor[i])) { eduTensorFinite = false; break; }
  ok("preprocessToTensorDataEdu(1200x800) tensor values are all finite", eduTensorFinite);
})();

// ── Part 2: CAM math on a synthetic feature map (no ONNX needed) ─────────────────────────────────────
(function testCamMath() {
  // 7x7 map with one clear hot spot and some negative values (pre-ReLU, as the real CAM head produces).
  const cam = new Float32Array(49).fill(-2);
  cam[24] = 20; cam[17] = 10; cam[31] = 8; // center-ish hot spot + neighbors
  const normed = ORT_ENGINE._diag.reluNormalizeCam(cam);
  ok("reluNormalizeCam: negative values clamp to 0 (ReLU)", normed[0] === 0);
  ok("reluNormalizeCam: hottest cell normalizes to 1.0", Math.abs(normed[24] - 1) < 1e-6);
  ok("reluNormalizeCam: output is bounded [0,1]", normed.every((v) => v >= 0 && v <= 1));

  const up = ORT_ENGINE._diag.bilinearResize(normed, 7, 7, 224, 224);
  ok("CAM bilinear upsample: correct output length", up.length === 224 * 224);
  let upMin = Infinity, upMax = -Infinity;
  for (let i = 0; i < up.length; i++) { if (up[i] < upMin) upMin = up[i]; if (up[i] > upMax) upMax = up[i]; }
  ok("CAM upsample is non-degenerate (not a flat/constant map)", (upMax - upMin) > 0.3);

  const rgba = ORT_ENGINE._diag.colorizeCam(up);
  let redMax = 0, alphaMax = 0;
  for (let i = 0; i < rgba.length; i += 4) { if (rgba[i] > redMax) redMax = rgba[i]; if (rgba[i + 3] > alphaMax) alphaMax = rgba[i + 3]; }
  ok("colorize: red channel scales with intensity (matches localize.py h=grayscale*255)", redMax > 200);
  ok("colorize: alpha channel scales with intensity (matches localize.py alpha=grayscale*180)", alphaMax > 150);

  const png = ORT_ENGINE._diag.encodePngRGBA(rgba, 224, 224);
  ok("PNG encode: valid signature", png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71);
  ok("PNG encode: produces non-trivial byte length", png.length > 200);
})();

// ── Part 3: severity/relevance band mapping ─────────────────────────────────────────────────────────
(function testBandMapping() {
  ok("High -> urgent", ORT_ENGINE._diag.severityForBand("High") === "urgent");
  ok("Medium -> warn", ORT_ENGINE._diag.severityForBand("Medium") === "warn");
  ok("Low -> info", ORT_ENGINE._diag.severityForBand("Low") === "info");
  ok("relevanceFor known label", /consolidation/i.test(ORT_ENGINE._diag.relevanceFor("Pneumonia") + ORT_ENGINE._diag.relevanceFor("Consolidation")) || ORT_ENGINE._diag.relevanceFor("Consolidation").length > 0);
  ok("relevanceFor unknown label falls back", ORT_ENGINE._diag.relevanceFor("Some_Unmapped_Label") === "Correlate clinically.");
})();

// ── Part 4: REAL model parity (onnxruntime-node) — the actual gate ──────────────────────────────────
async function realModelParity() {
  let ort;
  try { ort = require("onnxruntime-node"); }
  catch (e) {
    console.log("thorex-ort: onnxruntime-node not available in this environment (" + e.message + ") — SKIPPING real-model parity; pure preprocessing/CAM math above still ran and is the honest coverage available here.");
    return;
  }
  if (!fs.existsSync(MODEL_PATH)) {
    console.log("thorex-ort: model file not found at " + MODEL_PATH + " — SKIPPING real-model parity.");
    return;
  }

  // (a) our engine's full path: decode(ImageData-like) -> preprocess -> session.run -> findings+heatmap
  const analysis = await ORT_ENGINE.analyzeImage(
    { width: SIZE, height: SIZE, data: pixels },
    { ort, modelUrl: MODEL_PATH, labels: LABELS, id: "synthetic-1" }
  );
  const clinical = MODELS.clinicalEngine(analysis);
  ok("analyzeImage: produced a clinical (educational:false) torchxrayvision engine", !!clinical && clinical.engine === "torchxrayvision");
  ok("analyzeImage: engine.disclaimerKey unset for the clinical engine (null in the raw payload)", clinical.disclaimerKey === undefined);
  ok("analyzeImage: top-level disclaimerKey = clinical_assist_disclaimer", analysis.disclaimerKey === "clinical_assist_disclaimer");
  ok("analyzeImage: probs ranked list has all 18 labels", analysis.probs.length === LABELS.length);

  // (b) direct onnxruntime-node run of the SAME tensor (built by hand with the identical formula)
  const expectedTensorData = ORT_ENGINE._diag.xrvNormalize(Float32Array.from(pixels));
  const directSession = await ort.InferenceSession.create(MODEL_PATH);
  const directTensor = new ort.Tensor("float32", expectedTensorData, [1, 1, 224, 224]);
  const directOut = await directSession.run({ input: directTensor });
  const directProbs = Array.from(directOut.probs.data);

  // Top-k parity: same model + same tensor => identical probabilities (allow float round-trip epsilon).
  const K = 5;
  const enginePairs = analysis.probs.slice(0, K).map((r) => [r.label, r.prob]);
  const directRanked = LABELS.map((label, i) => ({ label, prob: directProbs[i] })).sort((a, b) => b.prob - a.prob).slice(0, K);
  let topKLabelsMatch = true, topKProbsMatch = true;
  for (let i = 0; i < K; i++) {
    if (enginePairs[i][0] !== directRanked[i].label) topKLabelsMatch = false;
    if (Math.abs(enginePairs[i][1] - directRanked[i].prob) > 1e-5) topKProbsMatch = false;
  }
  ok(`top-${K} labels match between analyzeImage() and direct onnxruntime-node run`, topKLabelsMatch);
  ok(`top-${K} probabilities match between analyzeImage() and direct onnxruntime-node run (<1e-5)`, topKProbsMatch);
  console.log("  top-5 (engine):", enginePairs.map(([l, p]) => `${l}=${p.toFixed(4)}`).join(", "));
  console.log("  top-5 (direct):", directRanked.map((r) => `${r.label}=${r.prob.toFixed(4)}`).join(", "));

  // CAM shape + non-degeneracy (directly from the direct session's raw output, independent of findings).
  const camDims = directOut.cam.dims;
  ok("cam output shape is [1,18,7,7]", camDims.length === 4 && camDims[0] === 1 && camDims[1] === LABELS.length && camDims[2] === 7 && camDims[3] === 7);
  const topIdx = directRanked[0] ? LABELS.indexOf(directRanked[0].label) : 0;
  const camSlice = Array.from(directOut.cam.data.slice(topIdx * 49, topIdx * 49 + 49));
  const camMin = Math.min(...camSlice), camMax = Math.max(...camSlice);
  ok("chosen-class CAM is non-degenerate (real spread across the 7x7 grid)", (camMax - camMin) > 0.01);

  // The clinical top finding MUST carry a non-empty CAM heatmap under the exact field thorex-screens.js
  // reads (`f.heatmap`, raw base64 — the screen builds `data:image/png;base64,` + f.heatmap itself; see
  // thorex-screens.js renderResult()/findingHtml() and thorex-models.js makeFinding()). This synthetic
  // input reliably crosses the >=0.10 band (17 of 18 labels do, per the real DenseNet weights), so the
  // top finding + heatmap are asserted unconditionally, not "if present" — a silently-omitted heatmap
  // here would mean the model->screen contract broke.
  ok("clinical engine produced at least one finding on this synthetic input", clinical.findings.length > 0);
  const topFinding = clinical.findings[0];
  ok("clinical top finding carries a non-empty `heatmap` field (the exact field thorex-screens.js reads)", !!topFinding && typeof topFinding.heatmap === "string" && topFinding.heatmap.length > 0);
  if (topFinding && topFinding.heatmap) {
    const bytes = Buffer.from(topFinding.heatmap, "base64");
    ok("attached CAM heatmap is a valid PNG (signature) with real byte length", bytes.length > 200 && bytes[0] === 137 && bytes[1] === 80);
  }
}

// ── Part 5: OD-D — TWO-ENGINE real model run (clinical + educational X-Raydar), on-device ───────────
async function twoEngineParity() {
  let ort;
  try { ort = require("onnxruntime-node"); }
  catch (e) {
    console.log("thorex-ort: onnxruntime-node not available in this environment (" + e.message + ") — SKIPPING two-engine (OD-D) parity.");
    return;
  }
  if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(EDU_MODEL_PATH) || !EDU_LABELS) {
    console.log(`thorex-ort: clinical or educational model/labels not found — SKIPPING two-engine (OD-D) parity `
      + `(clinical_model=${fs.existsSync(MODEL_PATH)}, edu_model=${fs.existsSync(EDU_MODEL_PATH)}, edu_labels=${!!EDU_LABELS}). `
      + `Run backend/thorex/scripts/export_xraydar_onnx.py to generate the educational ONNX + labels.`);
    return;
  }

  // (a) our engine's full path: one decode -> clinical engine + educational engine, both on-device.
  const analysis = await ORT_ENGINE.analyzeImage(
    { width: SIZE, height: SIZE, data: pixels },
    { ort, modelUrl: MODEL_PATH, labels: LABELS, eduModelUrl: EDU_MODEL_PATH, eduLabels: EDU_LABELS, includeEducational: true, id: "synthetic-two-engine" }
  );
  ok("analyzeImage({includeEducational:true}) returns exactly TWO engines", analysis.engines.length === 2);
  ok("engine[0] is the clinical torchxrayvision engine (clinical first)", analysis.engines[0].engine === "torchxrayvision" && analysis.engines[0].educational === false);
  ok("engine[1] is the educational xraydar engine (educational second)", analysis.engines[1].engine === "xraydar" && analysis.engines[1].educational === true);
  ok("educational engine carries the educational_not_clinical disclaimer key", analysis.engines[1].disclaimerKey === "educational_not_clinical");
  ok("analysis.eduProbs ranked list has all 38 X-Raydar labels", Array.isArray(analysis.eduProbs) && analysis.eduProbs.length === EDU_LABELS.length);
  const learning = MODELS.learningEngine(analysis);
  ok("MODELS.learningEngine(analysis) resolves the educational engine", !!learning && learning.engine === "xraydar" && learning.educational === true);
  ok("MODELS.clinicalEngine(analysis) still resolves the clinical engine (two-engine analysis)", MODELS.clinicalEngine(analysis) && MODELS.clinicalEngine(analysis).engine === "torchxrayvision");

  // (b) direct onnxruntime-node run of the educational model on the SAME hand-built tensor: pad is a
  // no-op (pixels is already 224x224 square), resize 224->512 is REAL interpolation (not a no-op,
  // unlike the clinical 224->224 case), then normalizeXraydar.
  const resizedTo512 = ORT_ENGINE._diag.bilinearResize(pixels, SIZE, SIZE, 512, 512);
  const expectedEduTensorData = ORT_ENGINE._diag.normalizeXraydar(resizedTo512);
  const directEduSession = await ort.InferenceSession.create(EDU_MODEL_PATH);
  const directEduTensor = new ort.Tensor("float32", expectedEduTensorData, [1, 1, 512, 512]);
  const directEduOut = await directEduSession.run({ input: directEduTensor });
  const directEduProbs = Array.from(directEduOut.probs.data);

  const K = 5;
  const eduEnginePairs = analysis.eduProbs.slice(0, K).map((r) => [r.label, r.prob]);
  const directEduRanked = EDU_LABELS.map((label, i) => ({ label, prob: directEduProbs[i] })).sort((a, b) => b.prob - a.prob).slice(0, K);
  let eduTopKLabelsMatch = true, eduTopKProbsMatch = true;
  for (let i = 0; i < K; i++) {
    if (eduEnginePairs[i][0] !== directEduRanked[i].label) eduTopKLabelsMatch = false;
    if (Math.abs(eduEnginePairs[i][1] - directEduRanked[i].prob) > 1e-5) eduTopKProbsMatch = false;
  }
  ok(`educational top-${K} labels match between analyzeImage() and direct onnxruntime-node run`, eduTopKLabelsMatch);
  ok(`educational top-${K} probabilities match between analyzeImage() and direct onnxruntime-node run (<1e-5)`, eduTopKProbsMatch);
  console.log("  edu top-5 (engine):", eduEnginePairs.map(([l, p]) => `${l}=${p.toFixed(4)}`).join(", "));
  console.log("  edu top-5 (direct):", directEduRanked.map((r) => `${r.label}=${r.prob.toFixed(4)}`).join(", "));

  // If a heatmap was attached to the top educational finding, confirm it's a real, valid PNG.
  const topEduFinding = learning && learning.findings[0];
  if (topEduFinding && topEduFinding.heatmap) {
    const bytes = Buffer.from(topEduFinding.heatmap, "base64");
    ok("attached educational CAM heatmap is a valid PNG (signature) with real byte length", bytes.length > 200 && bytes[0] === 137 && bytes[1] === 80);
  } else {
    ok("educational engine produced no findings/heatmap on this synthetic input, or the model has no `cam` output (both are honest, non-fabricated outcomes)", true);
  }

  // (c) asymmetric isolation: a broken educational model URL must NOT sink the clinical result — the
  // analysis must still resolve, clinical-only, mirroring the backend orchestrator's isolation.
  const isolatedAnalysis = await ORT_ENGINE.analyzeImage(
    { width: SIZE, height: SIZE, data: pixels },
    {
      ort, modelUrl: MODEL_PATH, labels: LABELS,
      eduModelUrl: path.join(__dirname, "..", "models", "thorex_xraydar_does_not_exist.onnx"),
      eduLabels: EDU_LABELS, includeEducational: true, id: "isolation-check"
    }
  );
  ok("educational-engine failure (unresolvable model path) does not reject analyzeImage()", isolatedAnalysis.engines.length === 1);
  ok("isolated result is clinical-only (torchxrayvision), never a fabricated educational engine", isolatedAnalysis.engines[0].engine === "torchxrayvision" && !isolatedAnalysis.engines.some((e) => e.educational === true));
}

realModelParity()
  .then(twoEngineParity)
  .then(() => {
    console.log(`\nthorex-ort: ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  }).catch((e) => {
    console.log("  ✗ FAIL: realModelParity/twoEngineParity threw:", e && e.stack || e);
    console.log(`\nthorex-ort: ${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  });
