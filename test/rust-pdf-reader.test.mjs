/* The Rust PDF reader (vendor/rust-pdf) and where the app uses it: ResearchMD's phone reader and PrepNucleus deck creation.
 * Run: node --test test/rust-pdf-reader.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = req("../vendor/rust-pdf/rust-pdf.js");
const ondevice = req("../research-ondevice-pdf.js");
const SR = req("../prep-source.js");
R.setWasm(readFileSync(join(ROOT, "vendor/rust-pdf/research_pdf.wasm")));

// A small real PDF: a 16 pt heading and two 10 pt body lines on page 1, an empty page 2 (a "scan").
function makePdf() {
  const c1 = "BT /F1 16 Tf 72 720 Td (Acute myeloid leukaemia) Tj ET\n" +
    "BT /F1 10 Tf 72 690 Td (More than twenty percent myeloblasts in the marrow.) Tj 0 -14 Td (Auer rods are needle shaped granules.) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 612 792] >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 7 0 R >>",
    "<< /Length " + c1.length + " >>\nstream\n" + c1 + "\nendstream",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const x = out.length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + x + "\n%%EOF\n";
  return new TextEncoder().encode(out);
}

test("the Rust reader reads text, words and lines, marks the empty page for OCR, and returns null on junk", async () => {
  const res = await R.extract(makePdf(), {});
  assert.equal(res.pages.length, 2);
  assert.match(res.pages[0].text, /^Acute myeloid leukaemia\nMore than twenty percent/);
  assert.ok(res.pages[0].words.length > 10 && res.pages[0].words[0].t === "Acute");
  assert.equal(res.pages[1].needs_ocr, true);
  const ln = await R.lines(makePdf(), [1, 2]);
  assert.deepEqual(ln.pages[0].lines.map((l) => [l.tx, l.size]), [["Acute myeloid leukaemia", 16],
    ["More than twenty percent myeloblasts in the marrow.", 10], ["Auer rods are needle shaped granules.", 10]]);
  assert.deepEqual(ln.pages[1].lines, []);
  assert.equal(await R.extract(new TextEncoder().encode("not a pdf"), {}), null, "a failure means: use the old reader");
});

/* ---------- ResearchMD phone reader ---------- */
function fakePdfjs(n, log) {
  const pdf = {
    numPages: n,
    async getPage(p) {
      log.getPage.push(p);
      return {
        getViewport: ({ scale }) => ({ width: 612 * (scale || 1), height: 792 * (scale || 1), transform: [scale || 1, 0, 0, -(scale || 1), 0, 792 * (scale || 1)] }),
        async getTextContent() { log.text.push(p); return { items: [] }; },
        render: () => ({ promise: Promise.resolve() }),
        cleanup() {},
      };
    },
  };
  return { getDocument: () => ({ promise: Promise.resolve(pdf) }) };
}
const canvas = () => ({ width: 1, height: 1, getContext: () => ({}), toDataURL: () => "data:image/jpeg;base64,X" });

test("phone reader: Rust pages are used as they are (with tables), the scanned page still goes to OCR", async () => {
  const log = { getPage: [], text: [] }, ocrd = [];
  const res = await ondevice.extract(makePdf(), {
    pdfjs: fakePdfjs(2, log), rust: R, createCanvas: canvas,
    ocr: async () => { ocrd.push(1); return { text: "Scanned page text", lines: ["Scanned page text"], boxes: [] }; },
  });
  assert.equal(res.engineVersion, "rod1-rs1");
  assert.deepEqual(log.text, [2], "pdf.js text reading is skipped for the page Rust read");
  assert.equal(ocrd.length, 1);
  assert.equal(res.pages[0].ocr, false);
  assert.match(res.pages[0].text, /^Acute myeloid leukaemia/);
  assert.ok(Array.isArray(res.pages[0].tables));
  assert.equal(res.pages[1].ocr, true);
  const server = await R.extract(makePdf(), {});
  assert.deepEqual(res.pages[0].words, server.pages[0].words, "the same words the server reader gives");
});

test("phone reader: off switch and a Rust failure both fall back to pdf.js", async () => {
  for (const rust of [false, { extract: async () => { throw new Error("wasm broke"); } }, { extract: async () => null }]) {
    const log = { getPage: [], text: [] };
    const res = await ondevice.extract(makePdf(), { pdfjs: fakePdfjs(1, log), rust, createCanvas: canvas,
      ocr: async () => ({ text: "x", lines: ["x"], boxes: [] }) }).catch((e) => e);
    assert.deepEqual(log.text, [1]);
    assert.equal(res.engineVersion, "rod1");
  }
});

/* ---------- PrepNucleus deck creation ---------- */
test("deck creation: Rust lines replace pdf.js text reading; pages Rust left out use pdf.js", async () => {
  const ln = await R.lines(makePdf(), [1]);
  const rl = SR.rustToLines(ln);
  assert.deepEqual(rl[1][0], { tx: "Acute myeloid leukaemia", size: 16 });
  assert.equal(SR.rustToLines(null), null);
  const asked = [];
  const body = "Induction combines cytarabine with an anthracycline for seven days in fit adults with acute myeloid leukaemia. " +
    "All trans retinoic acid treats the promyelocytic subtype and arsenic trioxide is added in low risk disease.";
  const doc = { getPage: async (p) => ({ id: p, getTextContent: async () => { asked.push(p); return { items: [{ str: body, transform: [10, 0, 0, 10, 50, 700], width: 500, hasEOL: true }] }; } }) };
  const rich = { 1: [{ tx: "AML", size: 16 }, { tx: body, size: 10 }] };
  const rd = await SR.readPages(doc, [1, 2], null, { rustLines: rich });
  assert.deepEqual(asked, [2]);
  assert.deepEqual(rd.pages.map((p) => p.p), [1, 2]);
  assert.equal(rd.pages[0].lines[0].tx, "AML");
});
