/* The ICU Snapshot sheet could only take camera/photo input: on device the label tap is
 * intercepted and sent to SMD_NATIVE.pickImage, which returns images only. A PDF ABG or lab
 * report - the usual format from a hospital lab - could not be imported there at all.
 * These pin the PDF route on both the native and the web branch. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "icu.js"), "utf8");

test("every Snapshot step offers a PDF / file control", () => {
  // 7a605d9e6 (QA bug sheet) renamed the per-step control data-snapfile -> data-snap-pdf ("Upload PDF"),
  // with its own native pickFile + web <input> handler (snapPdf). Same affordance, new attribute.
  assert.match(SRC, /data-snap-pdf="' \+ s\[2\] \+ '"/, "each step renders a data-snap-pdf button");
  assert.match(SRC, /Upload PDF/, "the control is labelled for PDFs");
  const live = SRC.slice(SRC.indexOf('querySelectorAll("[data-snap-pdf]")'));
  assert.match(live, /SMD_NATIVE\.pickFile\(\{ types: \["application\/pdf"\] \}\)/, "native: the document picker, not pickImage");
  assert.match(live, /snapPdf\(kind, out, /, "both branches feed the shared PDF pipeline");
});

test("native PDF picking uses the document picker, not pickImage", () => {
  const block = SRC.slice(SRC.indexOf('querySelectorAll("[data-snapfile]")'));
  assert.match(block, /SMD_NATIVE\.pickFile\(\{ types: \["application\/pdf", "image\/\*"\] \}\)/, "asks the native picker for PDFs");
  assert.match(block, /handleImportFile\(kind, blob\)/, "feeds the existing pdf.js import pipeline");
});

test("native branch degrades with a message instead of doing nothing", () => {
  const block = SRC.slice(SRC.indexOf('querySelectorAll("[data-snapfile]")'));
  assert.match(block, /File picker unavailable/, "tells the clinician what to do when pickFile is absent");
});

test("web branch accepts PDFs through the same pipeline", () => {
  const web = SRC.slice(SRC.lastIndexOf('querySelectorAll("[data-snapfile]")'));
  assert.match(web, /inp\.accept = "application\/pdf,image\/\*"/, "web file input accepts PDF");
  assert.match(web, /handleImportFile\(kind, f\)/, "web route reuses handleImportFile too");
});

test("handleImportFile still understands PDFs (the pipeline being reused)", () => {
  assert.match(SRC, /if \(file\.type === "application\/pdf"\)/, "PDF branch intact in handleImportFile");
});
