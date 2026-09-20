/* test/maik-pdf-attach.test.mjs — the on-device attach button takes a PDF, not only a photo.
 *
 * Owner, 2026-09-20: "give offline models picture upload button also accept pdf files".
 *
 * The staging code already handled PDFs (detect → rasterise page 1 → hand the JPEG to the vision
 * encoder, which takes pixels and cannot parse a PDF). What was missing is that nothing on the MaiK
 * path ever LOADED pdf.js: maikPdfFirstPageDataUrl() read window.pdfjsLib and rejected when it was
 * absent. pdf.js is lazy-loaded by icu.js and medlist.js, so a PDF attached in MaiK only worked if
 * the clinician had already opened ICU or MedList in the same session — otherwise "Could not read
 * that PDF", which reads as "the button doesn't take PDFs".
 *
 * home.js has no unit harness (9k lines of UI), so these are source + filesystem invariants, the
 * same approach maik-engine.test.mjs uses. The behaviour they protect is offline-first: a phone
 * with no network must still rasterise a PDF from the bundled vendor copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const BUILD = readFileSync(new URL("../scripts/build-www.sh", import.meta.url), "utf8");

test("the attach input accepts PDFs as well as images", () => {
  const tag = INDEX.includes('id="maikImgFile"') ? INDEX : HOME;
  const m = tag.match(/<input[^>]*id="maikImgFile"[^>]*>/);
  assert.ok(m, "the MaiK file input exists");
  assert.match(m[0], /accept="[^"]*image\/\*/, "still accepts images");
  assert.match(m[0], /accept="[^"]*application\/pdf/, "accepts PDFs");
});

test("the button tells the clinician it takes a PDF", () => {
  const btn = HOME.match(/<button[^>]*id="maikImg"[^>]*>/);
  assert.ok(btn, "the attach button exists");
  assert.match(btn[0], /aria-label="[^"]*PDF/i, "the accessible name mentions PDF");
  assert.match(btn[0], /title="[^"]*PDF/i, "the tooltip mentions PDF");
});

test("the PDF path LOADS pdf.js instead of giving up when it is absent", () => {
  const i = HOME.indexOf("function maikPdfFirstPageDataUrl");
  assert.ok(i > 0, "the rasteriser exists");
  const fn = HOME.slice(i, i + 1200);
  assert.match(fn, /maikLoadPdfJs\(\)/, "it goes through the loader");
  assert.doesNotMatch(fn, /if \(!lib\) return Promise\.reject/,
    "the old bail-out-when-missing branch is gone");
});

test("the loader prefers the BUNDLED copy over the CDN, because offline is the point", () => {
  // The source URLs live in constants declared just above the loader, so the window starts there.
  const i = HOME.indexOf('var PDFJS_L = "/vendor/pdfjs/pdf.min.js"');
  assert.ok(i > 0, "the loader's source constants exist");
  assert.ok(HOME.indexOf("function maikLoadPdfJs", i) > i, "the loader follows them");
  const fn = HOME.slice(i, i + 1800);
  const local = fn.indexOf("/vendor/pdfjs/pdf.min.js");
  const cdn = fn.indexOf("cdnjs.cloudflare.com");
  assert.ok(local > 0, "the local vendor path is used");
  assert.ok(cdn > 0, "a CDN fallback exists for web sessions with no bundle");
  assert.ok(local < cdn, "local is attempted before the CDN");
  assert.match(fn, /workerSrc/, "the pdf.js worker is pointed at a real source");
});

test("the bundled pdf.js actually exists and ships in the OTA bundle", () => {
  for (const f of ["pdf.min.js", "pdf.worker.min.js"]) {
    const p = new URL("../vendor/pdfjs/" + f, import.meta.url);
    assert.ok(existsSync(p), `vendor/pdfjs/${f} is present`);
    assert.ok(statSync(p).size > 10000, `vendor/pdfjs/${f} is a real build, not a stub`);
  }
  assert.match(BUILD, /cp -R vendor "\$WWW\/"/, "build-www.sh copies vendor/ into www/");
});

test("only page 1 is rasterised — a 4096 context cannot hold a multi-page document", () => {
  const i = HOME.indexOf("function maikPdfFirstPageDataUrl");
  const fn = HOME.slice(i, i + 1200);
  assert.match(fn, /getPage\(1\)/, "page 1 only");
  assert.match(fn, /toDataURL\("image\/jpeg"/, "handed to the encoder as pixels");
});
