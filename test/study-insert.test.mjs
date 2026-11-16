/* Study Studio Phase 4 insert unit tests: text, image, stickers, laser, format bar, undo
 * node --test test/study-insert.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const SI = createRequire(import.meta.url)("../study-insert.js");
const P = SI._pure || SI;

test("makeItem: constructs valid item record with page-relative coordinates", () => {
  const item = P.makeItem("doc1", "p1", "text", 0.1, 0.2, 0.4, 0.15, { text: "Hello" });
  assert.equal(item.doc, "doc1");
  assert.equal(item.page, "p1");
  assert.equal(item.kind, "text");
  assert.equal(item.x, 0.1);
  assert.equal(item.y, 0.2);
  assert.equal(item.w, 0.4);
  assert.equal(item.h, 0.15);
  assert.equal(item.rot, 0);
  assert.equal(item.gone, false);
  assert.equal(item.data.text, "Hello");
  assert.ok(item.id.startsWith("it_"));
  assert.ok(item.t > 0);
});

test("moveItemGeom: moves item and clamps to page bounds 0..1", () => {
  const item = P.makeItem("doc1", 1, "image", 0.1, 0.1, 0.3, 0.3);
  P.moveItemGeom(item, 0.05, 0.1);
  assert.equal(item.x, 0.15);
  assert.equal(item.y, 0.2);

  // Clamping to right/bottom: width is 0.3, max x is 0.7
  P.moveItemGeom(item, 0.9, 0.9);
  assert.equal(item.x, 0.7);
  assert.equal(item.y, 0.7);

  // Clamping to left/top
  P.moveItemGeom(item, -1.0, -1.0);
  assert.equal(item.x, 0);
  assert.equal(item.y, 0);
});

test("resizeItemGeom: handles corner handles and enforces min dimensions", () => {
  const item = P.makeItem("doc1", 1, "text", 0.2, 0.2, 0.3, 0.2);
  // Resize SE
  P.resizeItemGeom(item, "se", 0.1, 0.05);
  assert.equal(item.w, 0.4);
  assert.equal(item.h, 0.25);

  // Resize NW (moves origin x, y while changing w, h)
  const item2 = P.makeItem("doc1", 1, "text", 0.3, 0.3, 0.4, 0.3);
  P.resizeItemGeom(item2, "nw", 0.05, 0.05);
  assert.equal(item2.x, 0.35);
  assert.equal(item2.y, 0.35);
  assert.equal(item2.w, 0.35);
  assert.equal(item2.h, 0.25);

  // Enforces minimum dimensions
  const item3 = P.makeItem("doc1", 1, "text", 0.5, 0.5, 0.1, 0.1);
  P.resizeItemGeom(item3, "se", -0.09, -0.09, 0.05, 0.02);
  assert.equal(item3.w, 0.05);
  assert.equal(item3.h, 0.02);
});

test("rotateItemGeom: sets angle and snaps to cardinal angles (0, 90, 180, 270)", () => {
  const item = P.makeItem("doc1", 1, "image", 0.2, 0.2, 0.3, 0.3);
  P.rotateItemGeom(item, 45);
  assert.equal(item.rot, 45);

  // Snapping within 4 degrees of 90
  P.rotateItemGeom(item, 88);
  assert.equal(item.rot, 90);

  // Snapping within 4 degrees of 0/360
  P.rotateItemGeom(item, 358);
  assert.equal(item.rot, 0);
});

test("compressDimensions: preserves small images, scales down large images to 2048px", () => {
  // Small image below 2048
  const s = P.compressDimensions(1024, 768, 2048);
  assert.equal(s.w, 1024);
  assert.equal(s.h, 768);
  assert.equal(s.scale, 1);

  // Large image above 2048 on width
  const l1 = P.compressDimensions(4096, 2048, 2048);
  assert.equal(l1.w, 2048);
  assert.equal(l1.h, 1024);
  assert.equal(l1.scale, 0.5);

  // Large image above 2048 on height
  const l2 = P.compressDimensions(1500, 3000, 2048);
  assert.equal(l2.w, 1024);
  assert.equal(l2.h, 2048);
});

test("laserFilterPoints: discards points older than 1000ms", () => {
  const now = 10000;
  const pts = [
    { x: 0.1, y: 0.1, t: now - 1200 }, // expired
    { x: 0.2, y: 0.2, t: now - 950 },  // kept
    { x: 0.3, y: 0.3, t: now - 200 }   // kept
  ];
  const kept = P.laserFilterPoints(pts, now, 1000);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].x, 0.2);
  assert.equal(kept[1].x, 0.3);
});

test("laserFadeAlpha: computes linear fade opacity over 1s", () => {
  assert.equal(P.laserFadeAlpha(0, 1000), 1);
  assert.equal(P.laserFadeAlpha(500, 1000), 0.5);
  assert.equal(P.laserFadeAlpha(1000, 1000), 0);
  assert.equal(P.laserFadeAlpha(1200, 1000), 0);
});

test("text styles and system fonts: Title, H1, H2, Body definitions", () => {
  assert.ok(P.STYLES.title.size >= 24 && P.STYLES.title.weight === "bold");
  assert.ok(P.STYLES.h1.size >= 20);
  assert.ok(P.STYLES.h2.size >= 16);
  assert.ok(P.STYLES.body.size >= 14);

  assert.ok(P.FONTS.sans.includes("system"));
  assert.ok(P.FONTS.serif.includes("Georgia"));
  assert.ok(P.FONTS.mono.includes("monospace"));
});

test("stickers library: contains required medical icons, arrows, and callouts as inline SVG", () => {
  const reqMedical = ["heart", "lungs", "kidney", "pill", "syringe", "ecg"];
  reqMedical.forEach((k) => {
    assert.ok(P.STICKERS[k], "Missing medical sticker: " + k);
    assert.ok(P.STICKERS[k].startsWith("<svg"), "Must be inline SVG: " + k);
    assert.ok(!P.STICKERS[k].includes("<img"), "Must not be raster image: " + k);
  });

  const reqArrows = ["arrowRight", "arrowLeft", "arrowCurved", "tick", "cross"];
  reqArrows.forEach((k) => {
    assert.ok(P.STICKERS[k], "Missing arrow / mark sticker: " + k);
    assert.ok(P.STICKERS[k].startsWith("<svg"));
  });

  const reqCallouts = ["calloutSpeech", "calloutThought", "calloutBanner"];
  reqCallouts.forEach((k) => {
    assert.ok(P.STICKERS[k], "Missing callout: " + k);
    assert.ok(P.STICKERS[k].startsWith("<svg"));
  });
});

test("sticker labels: provides human-readable labels for all elements (no raw ids)", () => {
  const expectedLabels = {
    heart: "Heart",
    lungs: "Lungs",
    kidney: "Kidney",
    pill: "Pill",
    syringe: "Syringe",
    ecg: "ECG",
    arrowRight: "Arrow right",
    arrowLeft: "Arrow left",
    arrowCurved: "Curved arrow",
    tick: "Tick",
    cross: "Cross",
    calloutSpeech: "Speech callout",
    calloutThought: "Thought callout",
    calloutBanner: "Box callout"
  };

  assert.ok(P.STICKER_LABELS, "STICKER_LABELS map must exist");
  Object.keys(expectedLabels).forEach((k) => {
    assert.equal(P.STICKER_LABELS[k], expectedLabels[k], "Label mismatch for " + k);
    // Ensure no raw camelCase ids remain in the label
    assert.ok(!P.STICKER_LABELS[k].includes("arrowR"));
    assert.ok(!P.STICKER_LABELS[k].includes("calloutS"));
  });
});
