// img-compress.js — the shared vision compressor. The pure parts are tested here; the canvas and
// pdf.js paths need a browser and are checked on device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const SMD_IMG = createRequire(import.meta.url)("../img-compress.js");

const { planScale, tokenEstimate, dataUrlBytes, textLayerUsable, pickMode, PRESETS, DEFAULTS } = SMD_IMG;

// ── scaling: the token lever ────────────────────────────────────────────────────────────────────────
test("a big photo is scaled so the LONG edge hits the target, keeping aspect", () => {
  const p = planScale(4032, 3024, 900);
  assert.equal(p.w, 900);
  assert.equal(p.h, 675);
  assert.ok(Math.abs(4032 / 3024 - p.w / p.h) < 0.01);
});

test("portrait is handled by the long edge, not width", () => {
  const p = planScale(3024, 4032, 900);
  assert.equal(p.h, 900);
  assert.equal(p.w, 675);
});

test("a small image is NEVER upscaled - enlarging invents detail and costs tokens", () => {
  const p = planScale(640, 480, 900);
  assert.equal(p.scale, 1);
  assert.equal(p.w, 640);
  assert.equal(p.h, 480);
});

test("a zero-size image does not divide by zero", () => {
  assert.deepEqual(planScale(0, 0, 900), { w: 0, h: 0, scale: 1 });
});

// ── the token model ─────────────────────────────────────────────────────────────────────────────────
test("tokens scale with AREA, so halving the long edge is a ~4x saving", () => {
  const big = tokenEstimate(1800, 1350);
  const half = tokenEstimate(900, 675);
  assert.ok(half > 0);
  assert.ok(big / half > 3.5 && big / half < 4.5, "expected ~4x, got " + (big / half).toFixed(2));
});

test("a 12MP phone photo downscaled to 900px is a ~20x token saving", () => {
  const before = tokenEstimate(4032, 3024);
  const p = planScale(4032, 3024, 900);
  const after = tokenEstimate(p.w, p.h);
  assert.ok(before / after > 15, "expected >15x, got " + (before / after).toFixed(1));
});

test("JPEG quality is absent from the token model, because it does not affect tokens", () => {
  // The point of the whole file: quality is a BYTES lever, dimensions are the TOKEN lever.
  assert.equal(tokenEstimate.length, 3);           // (w, h, perTokenPx) - no quality parameter
  assert.equal(tokenEstimate(900, 675), tokenEstimate(900, 675));
});

// ── byte accounting ─────────────────────────────────────────────────────────────────────────────────
test("data-URL byte size accounts for base64 padding", () => {
  const b64 = Buffer.from("x".repeat(1000)).toString("base64");
  const url = "data:image/jpeg;base64," + b64;
  const got = dataUrlBytes(url);
  assert.ok(Math.abs(got - 1000) <= 2, "got " + got);
});

test("a malformed data-URL reports zero rather than throwing", () => {
  assert.equal(dataUrlBytes("not-a-data-url"), 0);
  assert.equal(dataUrlBytes(null), 0);
  assert.equal(dataUrlBytes(undefined), 0);
});

// ── PDF: text layer vs OCR (the big saving) ─────────────────────────────────────────────────────────
test("a real lab-report text layer is used, not OCR'd", () => {
  const text = "HAEMOGLOBIN 13.4 g/dL  TOTAL LEUCOCYTE COUNT 8200 /cumm  PLATELET COUNT 244000 /cumm "
    + "SERUM CREATININE 0.9 mg/dL  BLOOD UREA 24 mg/dL  SODIUM 138 POTASSIUM 4.1 CHLORIDE 102";
  assert.equal(textLayerUsable(text), true);
  assert.equal(pickMode(text), "text");
});

test("the stray characters a SCANNED page yields are not mistaken for a text layer", () => {
  // A scan often still produces a little junk text; "has any text" would be the wrong test.
  assert.equal(textLayerUsable(""), false);
  assert.equal(textLayerUsable("  \n \t "), false);
  assert.equal(textLayerUsable("Page 1"), false);
  assert.equal(textLayerUsable("l1 ' . , 0"), false);
  assert.equal(pickMode("Page 1 of 2"), "image");
});

test("the text-layer thresholds are tunable per call", () => {
  const short = "Na 138 K 4.1 Cl 102";
  assert.equal(textLayerUsable(short), false);
  assert.equal(textLayerUsable(short, { minChars: 10, minWords: 4 }), true);
});

test("single characters do not count as words", () => {
  const spaced = "a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m";
  assert.equal(textLayerUsable(spaced), false, "spaced single letters are OCR noise, not a text layer");
});

// ── presets reflect how legible the source is ───────────────────────────────────────────────────────
test("dense reports get more pixels than monitor screens", () => {
  assert.ok(PRESETS.report.maxEdge > PRESETS.screen.maxEdge,
    "a lab report needs more resolution than a monitor display");
  assert.ok(PRESETS.strip.maxEdge > PRESETS.screen.maxEdge,
    "blister-pack print is smaller than a monitor's glyphs");
});

test("every preset stays at or above the clinical legibility floor", () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    assert.ok(p.maxEdge >= DEFAULTS.minEdge, name + " is below the legibility floor");
    assert.ok(p.quality >= 0.55 && p.quality <= 0.85, name + " quality out of range");
  }
});
