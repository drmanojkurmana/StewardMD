/* ResearchMD on-device PDF extraction & OCR unit tests.
 * Run: node --test test/research-ondevice-pdf.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ondevice = require("../research-ondevice-pdf.js");

function makeFakeCanvasFactory(log) {
  return function createCanvas(w, h) {
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({}),
      toDataURL: (mime, quality) => {
        if (log) log.renders.push({ w: canvas.width, h: canvas.height, mime, quality });
        return "data:image/jpeg;base64,FAKE";
      }
    };
    if (log) log.canvases.push(canvas);
    return canvas;
  };
}

function makeFakePdfjs(pagesSpec, opts = {}) {
  const calls = { getPage: [], cleanup: [] };
  const pdf = {
    numPages: opts.numPages != null ? opts.numPages : pagesSpec.length,
    destroyed: false,
    destroy() { this.destroyed = true; },
    async getPage(n) {
      calls.getPage.push(n);
      const spec = pagesSpec[n - 1];
      if (!spec) throw new Error("missing page " + n);
      const width = spec.width || 600;
      const height = spec.height || 800;
      return {
        getViewport({ scale }) {
          const s = scale || 1;
          return {
            width: width * s,
            height: height * s,
            transform: [s, 0, 0, -s, 0, height * s]
          };
        },
        async getTextContent() {
          return { items: spec.items || [] };
        },
        render({ viewport }) {
          return {
            promise: Promise.resolve({ w: viewport.width, h: viewport.height })
          };
        },
        cleanup() {
          calls.cleanup.push(n);
        }
      };
    }
  };
  return {
    calls,
    pdfjs: {
      getDocument() {
        if (opts.openError) return { promise: Promise.reject(opts.openError) };
        return { promise: Promise.resolve(pdf) };
      }
    }
  };
}

function fakeBytes(label) {
  return new TextEncoder().encode("%PDF-1.4 " + (label || "sample"));
}

describe("research-ondevice-pdf", () => {
  test("1. text page -> ocr false, words in points, text matches extract.py joining", async () => {
    const { pdfjs, calls } = makeFakePdfjs([
      {
        width: 612,
        height: 792,
        items: [
          { str: "Table 1", transform: [12, 0, 0, 12, 72, 700], width: 42, height: 12 },
          { str: "shows", transform: [12, 0, 0, 12, 120, 700], width: 34, height: 12 },
          { str: "120 patients enrolled.", transform: [12, 0, 0, 12, 72, 680], width: 110, height: 12 }
        ]
      }
    ]);
    const res = await ondevice.extract(fakeBytes("text1"), { pdfjs });
    assert.equal(res.engine, "ondevice");
    assert.equal(res.engineVersion, "rod1");
    assert.equal(res.ocr, false);
    assert.equal(res.ocrEngine, null);
    assert.equal(res.partial, false);
    assert.equal(res.nextPage, 2);
    assert.match(res.sha256, /^[0-9a-f]{64}$/);
    assert.equal(res.pages.length, 1);

    const p = res.pages[0];
    assert.equal(p.n, 1);
    assert.equal(p.width, 612);
    assert.equal(p.height, 792);
    assert.equal(p.ocr, false);
    assert.deepEqual(p.tables, []);
    assert.equal(p.text, "Table 1 shows\n120 patients enrolled.");
    assert.equal(p.words.length, 6);
    assert.deepEqual(p.words[0], { t: "Table", x0: 72, y0: 80, x1: 102, y1: 92 });
    assert.deepEqual(p.words[1], { t: "1", x0: 108, y0: 80, x1: 114, y1: 92 });
    assert.deepEqual(p.words[2], { t: "shows", x0: 120, y0: 80, x1: 154, y1: 92 });
    assert.deepEqual(calls.cleanup, [1]);
  });

  test("2. image page 600x800 pt, box x .1 y .2 w .5 h .05 -> x0 60, y0 160, x1 360, y1 200", async () => {
    const log = { renders: [], canvases: [] };
    const { pdfjs, calls } = makeFakePdfjs([{ width: 600, height: 800, items: [] }]);
    const ocrOpts = [];
    const progress = [];
    const res = await ondevice.extract(fakeBytes("img1"), {
      pdfjs,
      createCanvas: makeFakeCanvasFactory(log),
      ocrEngine: "vision",
      onProgress: (cur, tot) => { progress.push([cur, tot]); },
      ocr: async (dataUrl, opts) => {
        ocrOpts.push({ dataUrl, opts });
        return {
          text: "Line one\nLine two",
          lines: ["Line one", "Line two"],
          boxes: [{ text: "Sample", x: 0.1, y: 0.2, w: 0.5, h: 0.05 }]
        };
      }
    });
    assert.equal(res.ocr, true);
    assert.equal(res.ocrEngine, "vision");
    assert.equal(ocrOpts.length, 1);
    assert.deepEqual(ocrOpts[0].opts, { languageCorrection: true });
    assert.deepEqual(progress, [[1, 1]]);
    assert.deepEqual(calls.cleanup, [1]);
    assert.equal(log.renders[0].mime, "image/jpeg");
    assert.equal(log.renders[0].quality, 0.9);
    // 800 * (200/72) = 2222.22 <= 2400, so long side = 2222
    assert.equal(log.renders[0].h, 2222);
    assert.equal(log.canvases[0].width, 0);
    assert.equal(log.canvases[0].height, 0);

    const p = res.pages[0];
    assert.equal(p.ocr, true);
    assert.deepEqual(p.tables, []);
    assert.equal(p.text, "Line one\nLine two");
    assert.deepEqual(p.words, [{ t: "Sample", x0: 60, y0: 160, x1: 360, y1: 200 }]);
  });

  test("2b. long side capped at 2400 px when dpi exceeds cap", async () => {
    const log = { renders: [], canvases: [] };
    const { pdfjs } = makeFakePdfjs([{ width: 1000, height: 1500, items: [] }]);
    await ondevice.extract(fakeBytes("bigpage"), {
      pdfjs,
      dpi: 200,
      createCanvas: makeFakeCanvasFactory(log),
      ocr: async () => ({ text: "ok", lines: ["ok"], boxes: [] })
    });
    // 1500 * 200/72 = 4166 > 2400 -> capped at 2400 px
    assert.equal(log.renders[0].h, 2400);
    assert.equal(log.renders[0].w, 1600);
  });

  test("3. mixed doc -> top-level ocr true only if any page is ocr", async () => {
    const log = { renders: [], canvases: [] };
    const textOnly = makeFakePdfjs([
      { width: 600, height: 800, items: [{ str: "Enough selectable text here on page one.", transform: [12, 0, 0, 12, 50, 700], width: 200, height: 12 }] },
      { width: 600, height: 800, items: [{ str: "Enough selectable text here on page two.", transform: [12, 0, 0, 12, 50, 700], width: 200, height: 12 }] }
    ]);
    const rText = await ondevice.extract(fakeBytes("alltext"), { pdfjs: textOnly.pdfjs });
    assert.equal(rText.ocr, false);
    assert.equal(rText.ocrEngine, null);

    const mixed = makeFakePdfjs([
      { width: 600, height: 800, items: [{ str: "Enough selectable text here on page one.", transform: [12, 0, 0, 12, 50, 700], width: 200, height: 12 }] },
      { width: 600, height: 800, items: [] }
    ]);
    const rMixed = await ondevice.extract(fakeBytes("mixed"), {
      pdfjs: mixed.pdfjs,
      createCanvas: makeFakeCanvasFactory(log),
      ocrEngine: "mlkit",
      ocr: async () => ({ text: "Scanned page", lines: ["Scanned page"], boxes: [] })
    });
    assert.equal(rMixed.ocr, true);
    assert.equal(rMixed.ocrEngine, "mlkit");
    assert.equal(rMixed.pages[0].ocr, false);
    assert.equal(rMixed.pages[1].ocr, true);
  });

  test("4. resume with nextPage 3 and same sha256 skips pages 1 and 2; different sha256 starts at 1", async () => {
    const pages = [
      { width: 600, height: 800, items: [{ str: "Page one text content long enough.", transform: [12, 0, 0, 12, 50, 700], width: 180, height: 12 }] },
      { width: 600, height: 800, items: [{ str: "Page two text content long enough.", transform: [12, 0, 0, 12, 50, 700], width: 180, height: 12 }] },
      { width: 600, height: 800, items: [{ str: "Page three text content long enough.", transform: [12, 0, 0, 12, 50, 700], width: 180, height: 12 }] }
    ];
    const bytes = fakeBytes("resume-doc");
    const hash = await ondevice.sha256(bytes);
    const { pdfjs, calls } = makeFakePdfjs(pages);
    const partial = {
      sha256: hash,
      nextPage: 3,
      pages: [
        { n: 1, width: 600, height: 800, text: "p1", words: [], tables: [], ocr: false },
        { n: 2, width: 600, height: 800, text: "p2", words: [], tables: [], ocr: false }
      ]
    };
    const resumed = await ondevice.extract(bytes, { pdfjs, resume: partial });
    assert.deepEqual(calls.getPage, [3]);
    assert.equal(resumed.pages.length, 3);
    assert.equal(resumed.pages[0].text, "p1");
    assert.equal(resumed.pages[2].text, "Page three text content long enough.");

    const fresh = makeFakePdfjs(pages);
    const wrongHash = await ondevice.extract(bytes, {
      pdfjs: fresh.pdfjs,
      resume: Object.assign({}, partial, { sha256: "0".repeat(64) })
    });
    assert.deepEqual(fresh.calls.getPage, [1, 2, 3]);
    assert.equal(wrongHash.pages[0].text, "Page one text content long enough.");
  });

  test("5. no native OCR and an image page -> rejects ocr-unavailable", async () => {
    const origCap = globalThis.Capacitor;
    const origNative = globalThis.SMD_NATIVE;
    delete globalThis.Capacitor;
    delete globalThis.SMD_NATIVE;
    try {
      assert.equal(ondevice.hasNativeOcr(), false);
      const { pdfjs } = makeFakePdfjs([{ width: 600, height: 800, items: [] }]);
      await assert.rejects(
        () => ondevice.extract(fakeBytes("no-ocr"), { pdfjs }),
        (err) => err && err.code === "ocr-unavailable" && err.page === 1
      );
    } finally {
      if (origCap !== undefined) globalThis.Capacitor = origCap;
      if (origNative !== undefined) globalThis.SMD_NATIVE = origNative;
    }
  });

  test("5b. detects vision vs mlkit via Capacitor.Plugins", () => {
    const origCap = globalThis.Capacitor;
    try {
      globalThis.Capacitor = { Plugins: { VisionOcr: { detectText: () => {} } } };
      assert.equal(ondevice.detectOcrEngine(), "vision");
      assert.equal(ondevice.hasNativeOcr(), true);

      globalThis.Capacitor = { Plugins: { TextRecognition: { processImage: () => {} } } };
      assert.equal(ondevice.detectOcrEngine(), "mlkit");
      assert.equal(ondevice.hasNativeOcr(), true);

      globalThis.Capacitor = { Plugins: {} };
      assert.equal(ondevice.detectOcrEngine(), null);
      assert.equal(ondevice.hasNativeOcr(), false);
    } finally {
      if (origCap === undefined) delete globalThis.Capacitor;
      else globalThis.Capacitor = origCap;
    }
  });

  test("6. ocr rejects on page 4 -> ocr-failed, err.page 4, onPage called for pages 1 to 3", async () => {
    const log = { renders: [], canvases: [] };
    const pages = [1, 2, 3, 4].map(() => ({ width: 600, height: 800, items: [] }));
    const { pdfjs } = makeFakePdfjs(pages);
    const seenPartials = [];
    let callN = 0;
    await assert.rejects(
      () => ondevice.extract(fakeBytes("fail4"), {
        pdfjs,
        createCanvas: makeFakeCanvasFactory(log),
        ocr: async () => {
          callN++;
          if (callN === 4) throw new Error("vision boom");
          return { text: "p" + callN, lines: ["p" + callN], boxes: [] };
        },
        onPage(partial) {
          seenPartials.push({ count: partial.pages.length, nextPage: partial.nextPage, partial: partial.partial });
        }
      }),
      (err) => err && err.code === "ocr-failed" && err.page === 4
    );
    assert.deepEqual(seenPartials, [
      { count: 1, nextPage: 2, partial: true },
      { count: 2, nextPage: 3, partial: true },
      { count: 3, nextPage: 4, partial: true }
    ]);
  });

  test("7. over default maxPages (200) -> too-many-pages", async () => {
    const { pdfjs } = makeFakePdfjs([], { numPages: 201 });
    await assert.rejects(
      () => ondevice.extract(fakeBytes("many"), { pdfjs }),
      (err) => err && err.code === "too-many-pages"
    );
  });

  test("8. signal.aborted between pages -> aborted", async () => {
    const pages = [
      { width: 600, height: 800, items: [{ str: "Page one text content long enough.", transform: [12, 0, 0, 12, 50, 700], width: 180, height: 12 }] },
      { width: 600, height: 800, items: [{ str: "Page two text content long enough.", transform: [12, 0, 0, 12, 50, 700], width: 180, height: 12 }] }
    ];
    const { pdfjs, calls } = makeFakePdfjs(pages);
    const signal = { aborted: false };
    await assert.rejects(
      () => ondevice.extract(fakeBytes("abort"), {
        pdfjs,
        signal,
        onPage() { signal.aborted = true; }
      }),
      (err) => err && err.code === "aborted"
    );
    assert.deepEqual(calls.getPage, [1]);
  });

  test("9. PasswordException -> password", async () => {
    const err = new Error("Password required");
    err.name = "PasswordException";
    const { pdfjs } = makeFakePdfjs([], { openError: err });
    await assert.rejects(
      () => ondevice.extract(fakeBytes("locked"), { pdfjs }),
      (e) => e && e.code === "password"
    );
  });

  test("10. page-level rejections from getPage, getTextContent and render carry err.code and err.page", async () => {
    const badGetPage = {
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 2,
            async getPage(n) {
              if (n === 2) throw new Error("corrupt page 2");
              return {
                getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
                getTextContent: async () => ({ items: [{ str: "Enough selectable text on page one.", transform: [12, 0, 0, 12, 50, 700], width: 200, height: 12 }] }),
                cleanup() {}
              };
            }
          })
        };
      }
    };
    await assert.rejects(
      () => ondevice.extract(fakeBytes("bad-getpage"), { pdfjs: badGetPage }),
      (e) => e && e.code === "pdf-open-failed" && e.page === 2
    );

    const badText = {
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 1,
            async getPage() {
              return {
                getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
                getTextContent: async () => { throw new Error("text stream failed"); },
                cleanup() {}
              };
            }
          })
        };
      }
    };
    await assert.rejects(
      () => ondevice.extract(fakeBytes("bad-text"), { pdfjs: badText }),
      (e) => e && e.code === "pdf-open-failed" && e.page === 1
    );

    const log = { renders: [], canvases: [] };
    const badRender = {
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 1,
            async getPage() {
              return {
                getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
                getTextContent: async () => ({ items: [] }),
                render: () => ({ promise: Promise.reject(new Error("canvas render exploded")) }),
                cleanup() {}
              };
            }
          })
        };
      }
    };
    await assert.rejects(
      () => ondevice.extract(fakeBytes("bad-render"), {
        pdfjs: badRender,
        createCanvas: makeFakeCanvasFactory(log),
        ocr: async () => ({ text: "ok", lines: ["ok"], boxes: [] })
      }),
      (e) => e && e.code === "ocr-failed" && e.page === 1
    );
    assert.equal(log.canvases[0].width, 0);
    assert.equal(log.canvases[0].height, 0);
  });
});
