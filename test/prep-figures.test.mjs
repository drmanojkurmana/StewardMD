/* PDF figure filter (prep-source.js), owner bug 2026-10-09: a scanned page of notes (a "Lymphoma" text page with a
 * table and a boxed tip) was cut out whole and became a question image ("Based on the table provided in the image...").
 * What must hold, on synthetic fixtures (test/fixtures/prep-figures/make-pdf.mjs, parsed by the vendored pdf.js):
 *   a digital page with an embedded chest film and text -> one candidate, exactly the film's box;
 *   a digital page of text and a ruled table -> no candidate;
 *   a scanned page of text, a table and a dark boxed tip -> no candidate, no figure region;
 *   a scanned page with a film printed in it -> no whole-page candidate, one region over the film only;
 *   an embedded picture of a table -> its pixels read as text, so it is never kept;
 *   the film under an OCR text layer -> out;
 * and the pixel classifier: a film is a picture, a line diagram is a diagram, text and tables are text, blank is blank.
 * node --test test/prep-figures.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeFigurePdf, PIX } from "./fixtures/prep-figures/make-pdf.mjs";

const require = createRequire(import.meta.url);
const SR = require("../prep-source.js");

// The browser scales a cut down to about 480 px (a page to 720) before it reads its pixels; the same box average here.
function down(c, max) {
  const k = Math.min(1, max / Math.max(c.w, c.h)), w = Math.round(c.w * k), h = Math.round(c.h * k), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y / k); yy < Math.min(c.h, Math.floor((y + 1) / k)); yy++) for (let xx = Math.floor(x / k); xx < Math.min(c.w, Math.floor((x + 1) / k)); xx++) { s += c.g[yy * c.w + xx]; n++; }
    g[y * w + x] = n ? Math.round(s / n) : 255;
  }
  return { w, h, g };
}
let parsed = null;
async function pages() {
  if (parsed) return parsed;
  const lib = require("../vendor/pdfjs/pdf.min.js");
  lib.GlobalWorkerOptions.workerSrc = require.resolve("../vendor/pdfjs/pdf.worker.min.js");
  const doc = await lib.getDocument({ data: new Uint8Array(Buffer.from(makeFigurePdf(), "latin1")), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p), ol = await pg.getOperatorList(), tc = await pg.getTextContent();
    out.push({ p, view: pg.view, imgs: SR.imageBoxes(ol.fnArray, ol.argsArray, lib.OPS), text: SR.textBoxes(tc.items) });
  }
  await doc.destroy();
  return (parsed = out);
}
const NAMES = ["xrayPage", "textPage", "scanText", "scanXray", "textImg", "ocrXray"];
const P = (n) => NAMES.indexOf(n) + 1;

test("figures: the embedded film is the one candidate on its page, cropped to the film's box only", async () => {
  const ps = await pages(), picks = SR.pickImages(ps);
  const film = picks.filter((x) => x.p === P("xrayPage"));
  assert.equal(film.length, 1);
  assert.deepEqual(film[0].box, [178, 300, 418, 588], "the film's own box, not the page");
  assert.ok(SR.pageShare(film[0], ps[0].view) < 0.2);
});

test("figures: a text page, a scanned text page and a picture of a table give no image question", async () => {
  const ps = await pages(), picks = SR.pickImages(ps), scans = SR.scanPages(ps);
  assert.equal(picks.filter((x) => x.p === P("textPage")).length, 0, "no pictures on a page of text");
  assert.equal(picks.filter((x) => x.p === P("scanText") || x.p === P("scanXray")).length, 0, "a page scan is never a candidate itself");
  assert.deepEqual(scans.map((x) => x.p), [P("scanText"), P("scanXray")], "both scans go to region search");
  const t = down(PIX.scanText(), 720);
  assert.deepEqual(SR.figureRegions(t.g, t.w, t.h), [], "no figure inside a scanned page of text, a table and a boxed tip");
  // The picture of a table passes the size rules, so its pixels decide: text, never kept.
  const ti = picks.find((x) => x.p === P("textImg"));
  assert.ok(ti, "the table picture is a size candidate");
  const c = down(PIX.textImg(), 480), k = SR.classifyPixels(c.g, c.w, c.h);
  assert.equal(k.kind, "text"); assert.equal(SR.figureOk(k.kind, false), false);
});

test("figures: a film printed on a scanned page is found as one region, inside the film", async () => {
  const ps = await pages(), sp = SR.scanPages(ps).find((x) => x.p === P("scanXray"));
  const d = down(PIX.scanXray(), 720), regs = SR.figureRegions(d.g, d.w, d.h);
  assert.equal(regs.length, 1);
  // The film sits at x 266..726, y 383..935 of the 992 x 1403 scan (make-pdf.mjs); the region must cover most of it and
  // not run into the text above or below.
  const k = 992 / d.w, r = regs[0], x0 = r.x * k, y0 = r.y * k, x1 = (r.x + r.w) * k, y1 = (r.y + r.h) * k;
  assert.ok(x0 >= 240 && x1 <= 760 && y0 >= 340 && y1 <= 980, JSON.stringify([x0, y0, x1, y1]));
  assert.ok((x1 - x0) * (y1 - y0) >= 0.8 * 460 * 552, "covers the film");
  assert.ok(sp && sp.w === 992 && sp.h === 1403);
});

test("figures: a film under an OCR text layer is out; a few labels on a figure are fine", async () => {
  const ps = await pages();
  assert.equal(SR.pickImages(ps).filter((x) => x.p === P("ocrXray")).length, 0);
  const box = [100, 100, 400, 400];
  assert.equal(SR.textInBox([{ box: [120, 120, 140, 130], n: 1 }, { box: [300, 300, 320, 310], n: 2 }], box).chars, 3);
  const pg = { p: 1, view: [0, 0, 600, 800], imgs: [{ id: "f", w: 400, h: 400, box }], text: [{ box: [120, 120, 140, 130], n: 1 }, { box: [300, 300, 320, 310], n: 2 }] };
  assert.equal(SR.pickImages([pg]).length, 1, "labels A and BC stay");
  pg.text.push({ box: [110, 200, 390, 212], n: 60 });
  assert.equal(SR.pickImages([pg]).length, 0, "a line of text across it is out");
});

test("figures: pixel classes, and page scans by share of the page", () => {
  const f = down(PIX.film(), 480);
  assert.equal(SR.classifyPixels(f.g, f.w, f.h).kind, "picture");
  const st = down(PIX.scanText(), 480);
  assert.equal(SR.classifyPixels(st.g, st.w, st.h).kind, "text");
  // A line diagram: a circle and two leader lines with two short labels.
  const w = 300, h = 300, g = new Uint8Array(w * h).fill(250);
  for (let a = 0; a < 720; a++) { const x = Math.round(150 + 90 * Math.cos(a / 114.6)), y = Math.round(150 + 90 * Math.sin(a / 114.6)); for (let t = 0; t < 3; t++) g[(y + t) * w + x] = 20; }
  for (let i = 0; i < 80; i++) { g[(60 + i) * w + 60 + i] = 20; g[(60 + i) * w + 61 + i] = 20; }
  for (let y = 40; y < 52; y++) for (let x = 20; x < 60; x += 4) g[y * w + x] = 20;
  assert.equal(SR.classifyPixels(g, w, h).kind, "diagram");
  assert.equal(SR.classifyPixels(new Uint8Array(100 * 100).fill(255), 100, 100).kind, "blank");
  const flat = new Uint8Array(200 * 200).fill(70);
  for (let i = 0; i < 4000; i++) flat[i] = 250;
  assert.equal(SR.classifyPixels(flat, 200, 200).kind, "text", "a flat dark box (text on a fill) is not a picture");
  const view = [0, 0, 595, 842];
  assert.equal(SR.isPageScan({ box: [0, 0, 595, 842] }, view), true);
  assert.equal(SR.isPageScan({ box: [0, 0, 595, 400] }, view), false);
  assert.equal(SR.figureOk("diagram", true), false, "a scan region must be a picture");
  assert.equal(SR.figureOk("diagram", false), true);
  const g2 = SR.toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1);
  assert.deepEqual(Array.from(g2), [76, 255], "red is dark-ish grey, transparent is paper");
});
