/* ResearchMD phase 05: native background PDF job (scanned pages read by one native job that keeps going
 * when the app is put away). Uses a fake native plugin; the real iOS and Android code needs a device build.
 * Run: node --test test/research-ondevice-native-job.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ondevice = require("../research-ondevice-pdf.js");

function makeFakePdfjs(pagesSpec) {
  const calls = { getPage: [] };
  const pdf = {
    numPages: pagesSpec.length,
    destroy() {},
    async getPage(n) {
      calls.getPage.push(n);
      const spec = pagesSpec[n - 1];
      const width = spec.width || 600, height = spec.height || 800;
      return {
        getViewport({ scale }) { const s = scale || 1; return { width: width * s, height: height * s, transform: [s, 0, 0, -s, 0, height * s] }; },
        async getTextContent() { return { items: spec.items || [] }; },
        render() { return { promise: Promise.resolve() }; },
        cleanup() {}
      };
    }
  };
  return { calls, pdfjs: { getDocument() { return { promise: Promise.resolve(pdf) }; } } };
}

const TEXT_ITEMS = [{ str: "Methods section with enough text", transform: [12, 0, 0, 12, 72, 700], width: 200, height: 12 }];
const fakeBytes = (l) => new TextEncoder().encode("%PDF-1.4 " + l);
const fakeCanvas = (w, h) => ({ width: w, height: h, getContext: () => ({}), toDataURL: () => "data:image/jpeg;base64,FAKE" });

// A fake SMD_NATIVE.pdfJob. `script` is the list of states getPdfJob returns in turn (the last repeats).
function makeFakeJob(script, opts = {}) {
  const log = { start: [], get: 0, read: [], cancel: [], clear: [], removed: [], listenerRemoved: 0, wrote: 0 };
  let i = 0, listenerFn = null;
  const job = {
    log,
    available: () => true,
    async writeTempPdf(u8) { log.wrote = u8.length; return "file:///cache/tmp.pdf"; },
    removeTempPdf(uri) { log.removed.push(uri); },
    async start(o) {
      log.start.push(o);
      if (opts.startError) throw new Error(opts.startError);
      if (listenerFn) listenerFn({ jobKey: o.jobKey, done: 1, total: o.pages.length });
      return { started: true };
    },
    async get(key) { log.get++; const s = script[Math.min(i++, script.length - 1)]; return typeof s === "function" ? s(key) : s; },
    async readPage(key, n) {
      log.read.push(n);
      if (opts.missing === n) throw new Error("page-not-ready");
      return { n, width: 1, height: 1, text: "Scanned " + n, words: [{ t: "Box", x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], tables: [], ocr: true, coords: "normalized" };
    },
    async cancel(key) { log.cancel.push(key); },
    async clear(key) { log.clear.push(key); },
    async onProgress(fn) { listenerFn = fn; return { remove() { log.listenerRemoved++; } }; }
  };
  return job;
}

describe("research-ondevice-pdf native job (phase 05)", () => {
  test("scanned pages go to one native job; pages merged in order, boxes converted to points", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: TEXT_ITEMS }, { items: [] }, { width: 300, height: 400, items: [] }]);
    const job = makeFakeJob([{ state: "running", donePages: [] }, { state: "done", donePages: [2, 3] }]);
    const progress = [];
    const res = await ondevice.extract(fakeBytes("mixed"), { pdfjs, nativeJob: job, nativePollMs: 0, onProgress: (c, t) => progress.push([c, t]) });
    assert.equal(job.log.start.length, 1);
    const s = job.log.start[0];
    assert.deepEqual(s.pages, [2, 3]);
    assert.equal(s.dpi, 200);
    assert.equal(s.path, "file:///cache/tmp.pdf");
    assert.match(s.jobKey, /^rmd-[0-9a-f]{40}-200$/);
    assert.deepEqual(job.log.read, [2, 3]);
    assert.deepEqual(res.pages.map((p) => p.n), [1, 2, 3]);
    assert.equal(res.ocr, true);
    assert.equal(res.partial, false);
    assert.equal(res.nextPage, 4);
    assert.deepEqual(res.pages[1].words[0], { t: "Box", x0: 60, y0: 160, x1: 360, y1: 200 });
    assert.deepEqual(res.pages[2].words[0], { t: "Box", x0: 30, y0: 80, x1: 180, y1: 100 });
    assert.equal(res.pages[2].width, 300);
    assert.equal(res.pages[2].text, "Scanned 3");
    assert.deepEqual(job.log.removed, ["file:///cache/tmp.pdf"]);
    assert.equal(job.log.clear.length, 1);
    assert.equal(job.log.listenerRemoved, 1);
    assert.ok(progress.some(([c, t]) => c === 3 && t === 3), "progress from native events");
  });

  test("checkpoints never skip a waiting scanned page", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: TEXT_ITEMS }, { items: [] }, { items: TEXT_ITEMS }]);
    const job = makeFakeJob([{ state: "done", donePages: [2] }]);
    const snaps = [];
    await ondevice.extract(fakeBytes("snap"), { pdfjs, nativeJob: job, nativePollMs: 0, onPage: (s) => snaps.push({ next: s.nextPage, partial: s.partial, n: s.pages.map((p) => p.n) }) });
    // Page 1 done, page 2 waiting: next stays 2 even after page 3 (text) is read.
    assert.deepEqual(snaps[0], { next: 2, partial: true, n: [1] });
    assert.deepEqual(snaps[1], { next: 2, partial: true, n: [1, 3] });
    assert.deepEqual(snaps[snaps.length - 1], { next: 4, partial: false, n: [1, 2, 3] });
  });

  test("paused while the app is open: started again, and paused time is reported", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }]);
    const job = makeFakeJob([
      { state: "running", donePages: [] },
      { state: "paused", donePages: [] },
      { state: "paused", donePages: [] },
      { state: "running", donePages: [] },
      { state: "done", donePages: [1] }
    ]);
    const states = [];
    const res = await ondevice.extract(fakeBytes("pause"), { pdfjs, nativeJob: job, nativePollMs: 0, onNativeState: (e) => states.push(e.state) });
    assert.equal(job.log.start.length, 2, "restarted once");
    assert.deepEqual(states, ["running", "paused", "running", "done"]);
    assert.equal(res.pages.length, 1);
  });

  test("progress also comes from polling when the native listener is silent", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }, { items: [] }, { items: [] }]);
    const job = makeFakeJob([
      { state: "running", donePages: [] },
      { state: "running", donePages: [1] },
      { state: "running", donePages: [1, 2] },
      { state: "done", donePages: [1, 2, 3] }
    ]);
    delete job.onProgress;
    const progress = [];
    await ondevice.extract(fakeBytes("pollprog"), { pdfjs, nativeJob: job, nativePollMs: 0, onProgress: (c) => progress.push(c) });
    // The first pass reports each page as it is opened; the native poll then reports pages as they finish.
    assert.deepEqual(progress, [1, 2, 3, 1, 2, 3]);
  });

  test("a job that keeps stopping fails as ocr-failed (counted by the retry logic)", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }]);
    const job = makeFakeJob([{ state: "paused", donePages: [] }]);
    await assert.rejects(ondevice.extract(fakeBytes("stuck"), { pdfjs, nativeJob: job, nativePollMs: 0 }), (e) => e.code === "ocr-failed");
    assert.equal(job.log.removed.length, 1, "temp PDF removed");
  });

  test("native failure codes map to the phase 01 error codes", async () => {
    for (const [code, want] of [["password", "password"], ["pdf-open-failed", "pdf-open-failed"], ["boom", "ocr-failed"]]) {
      const { pdfjs } = makeFakePdfjs([{ items: [] }]);
      const job = makeFakeJob([{ state: "failed", error: code }]);
      await assert.rejects(ondevice.extract(fakeBytes("f" + code), { pdfjs, nativeJob: job, nativePollMs: 0 }), (e) => e.code === want);
    }
  });

  test("a lost page file fails as ocr-failed with the page number", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }, { items: [] }]);
    const job = makeFakeJob([{ state: "done", donePages: [1] }], { missing: 2 });
    await assert.rejects(ondevice.extract(fakeBytes("lost"), { pdfjs, nativeJob: job, nativePollMs: 0 }), (e) => e.code === "ocr-failed" && e.page === 2);
  });

  test("cancel while waiting: job cancelled, rejects aborted", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }]);
    const ac = new AbortController();
    const job = makeFakeJob([() => { ac.abort(); return { state: "running", donePages: [] }; }]);
    await assert.rejects(ondevice.extract(fakeBytes("abort"), { pdfjs, nativeJob: job, nativePollMs: 0, signal: ac.signal }), (e) => e.code === "aborted");
    assert.equal(job.log.cancel.length, 1);
  });

  test("abort while sleeping in wait() clears timer via opts.clock, cancels native job, and rejects immediately (Item 10)", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }]);
    const ac = new AbortController();
    const job = makeFakeJob([{ state: "running", donePages: [] }]);
    let cleared = 0;
    const fakeClock = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => { cleared += 1; clearTimeout(id); }
    };
    const t0 = Date.now();
    const p = ondevice.extract(fakeBytes("abort-during-wait"), {
      pdfjs,
      nativeJob: job,
      nativePollMs: 30000,
      clock: fakeClock,
      signal: ac.signal
    });
    setTimeout(() => ac.abort(), 15);
    await assert.rejects(p, (e) => e && e.code === "aborted");
    assert.ok(Date.now() - t0 < 1000, "aborted immediately without waiting 30s");
    assert.equal(cleared >= 1, true, "wait timer cleared");
    assert.equal(job.log.cancel.length, 1, "native job cancelled");
    assert.equal(job.log.removed.length, 1, "temp PDF removed");
    assert.equal(job.log.listenerRemoved, 1, "progress listener removed");
  });

  test("job cannot start (older build): scanned pages are read page by page instead", async () => {
    const { pdfjs } = makeFakePdfjs([{ items: [] }, { items: TEXT_ITEMS }]);
    const job = makeFakeJob([{ state: "done" }], { startError: "not implemented" });
    const origCap = globalThis.Capacitor, origNative = globalThis.SMD_NATIVE;
    globalThis.Capacitor = { Plugins: { VisionOcr: { detectText() {} } } };
    let ocrCalls = 0;
    globalThis.SMD_NATIVE = { ocr: async () => { ocrCalls++; return { lines: ["inline"], boxes: [{ text: "In", x: 0, y: 0, w: 0.5, h: 0.5 }] }; } };
    try {
      const res = await ondevice.extract(fakeBytes("fallback"), { pdfjs, nativeJob: job, nativePollMs: 0, createCanvas: fakeCanvas });
      assert.equal(ocrCalls, 1);
      assert.deepEqual(res.pages.map((p) => p.n), [1, 2]);
      assert.equal(res.pages[0].text, "inline");
      assert.equal(res.ocrEngine, "vision");
      assert.equal(job.log.removed.length, 1);
    } finally {
      if (origCap === undefined) delete globalThis.Capacitor; else globalThis.Capacitor = origCap;
      if (origNative === undefined) delete globalThis.SMD_NATIVE; else globalThis.SMD_NATIVE = origNative;
    }
  });

  test("kill switch smd_rmd_od_native_job=0 and a custom ocr function both keep the page-by-page path", async () => {
    const job = makeFakeJob([{ state: "done" }]);
    const ocr = async () => ({ lines: ["x"], boxes: [] });
    const a = makeFakePdfjs([{ items: [] }]);
    await ondevice.extract(fakeBytes("custom"), { pdfjs: a.pdfjs, nativeJob: job, ocr, createCanvas: fakeCanvas });
    assert.equal(job.log.start.length, 0);

    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const store = { smd_rmd_od_native_job: "0" };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: { getItem: (k) => (k in store ? store[k] : null) } });
    try {
      assert.equal(ondevice.isNativeJobEnabled(), false);
      assert.equal(ondevice.isEnabled(), true);
      store.smd_rmd_od_native_job = "1";
      assert.equal(ondevice.isNativeJobEnabled(), true);
      store.smd_rmd_ondevice_ocr = "0";
      assert.equal(ondevice.isNativeJobEnabled(), false, "needs the main on-device flag too");
    } finally {
      if (desc) Object.defineProperty(globalThis, "localStorage", desc); else delete globalThis.localStorage;
    }
  });
});

describe("native-bridge pdfJob wrappers", () => {
  function loadBridge(plugins) {
    const win = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: plugins },
      addEventListener() {}, navigator: { userAgent: "" },
      document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
      localStorage: { getItem() { return null; }, setItem() {} },
      fetch: () => Promise.resolve(), location: { href: "https://localhost/" }
    };
    win.window = win;
    const ctx = vm.createContext(Object.assign(win, { btoa, setTimeout, setInterval: () => 0, clearInterval() {}, requestAnimationFrame() {}, console, Promise, Uint8Array, ArrayBuffer }));
    vm.runInContext(readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8"), ctx);
    return win.SMD_NATIVE.pdfJob;
  }

  test("absent plugin: available() false, calls reject or no-op safely", async () => {
    const J = loadBridge({});
    assert.equal(J.available(), false);
    await assert.rejects(J.start({}), /native-job-unavailable/);
    await assert.rejects(J.get("k"), /native-job-unavailable/);
    await assert.rejects(J.readPage("k", 1), /native-job-unavailable/);
    await J.cancel("k");
    await J.clear("k");
    assert.equal(await J.onProgress(() => {}), null);
    await assert.rejects(J.writeTempPdf(new Uint8Array(3)), /native-job-unavailable/);
  });

  test("writeTempPdf writes a big PDF in chunks whose base64 joins back to the same bytes", async () => {
    const writes = [];
    const Filesystem = {
      async writeFile(o) { writes.push(o); return { uri: "file:///cache/" + o.path }; },
      async appendFile(o) { writes.push(o); }
    };
    const J = loadBridge({ Filesystem, VisionOcr: { startPdfJob() {}, getPdfJob() {}, readPdfJobPage() {} } });
    assert.equal(J.available(), true);
    const u8 = new Uint8Array(2_000_000);
    for (let i = 0; i < u8.length; i++) u8[i] = (i * 7) % 256;
    const uri = await J.writeTempPdf(u8);
    assert.match(uri, /^file:\/\/\/cache\/smd-rmdod-\d+-\d+\.pdf$/);
    assert.ok(writes.length > 1);
    assert.ok(writes.every((w) => w.directory === "CACHE" && w.path === writes[0].path));
    const joined = Buffer.concat(writes.map((w) => Buffer.from(w.data, "base64")));
    assert.ok(joined.equals(Buffer.from(u8)));
  });
});
