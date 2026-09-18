/* test/pdf-engines.test.mjs — the PDF/raster engines load on demand, not on every cold start.
 *
 * 551 KB (vendor-html2canvas 194 KB + vendor-jspdf 357 KB) used to parse at every app launch for two
 * features most sessions never reach. This pins the replacement so a later edit cannot quietly put
 * them back, and cannot break the two things that make the swap safe:
 *   - the promise is cached, so N concurrent exports inject each script once;
 *   - ensure() NEVER rejects, because every call site branches on the globals being absent and an
 *     unhandled rejection would be a new failure mode rather than a fixed one.
 *
 * node --test test/pdf-engines.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("..", import.meta.url);
const SRC = readFileSync(new URL("pdf-engines.js", ROOT), "utf8");
const INDEX = readFileSync(new URL("index.html", ROOT), "utf8");

/* A DOM stub that records injected <script>s and lets a test settle them. `fail` makes every
 * injection error, which is how the "load failed" contract is exercised. */
function sandbox({ fail = false } = {}) {
  const injected = [];
  const el = () => ({ setAttribute(k, v) { this[k] = v; }, set src(v) { this._src = v; }, get src() { return this._src; } });
  const g = {
    document: {
      _q: [],
      createElement: () => el(),
      querySelector(sel) { return injected.find((s) => sel.includes(s._src)) || null; },
      head: { appendChild(s) { injected.push(s); setTimeout(() => (fail ? s.onerror : s.onload)(), 0); } },
      documentElement: {},
    },
    setTimeout,
  };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(SRC, g, { filename: "pdf-engines.js" });
  return { g, injected };
}

test("the loader exposes SMD_PDF_ENGINES and does NOT clobber SMD_PDF", () => {
  const { g } = sandbox();
  assert.equal(typeof g.SMD_PDF_ENGINES.ensure, "function");
  assert.equal(g.SMD_PDF, undefined,
    "native-bridge.js owns window.SMD_PDF (fromHtml); taking that name would break MaiK/onco/report export");
});

test("both engines are injected on first use, and exactly once across concurrent calls", async () => {
  const { g, injected } = sandbox();
  // three simultaneous exports, as a doctor tapping twice would produce
  const [a, b, c] = await Promise.all([g.SMD_PDF_ENGINES.ensure(), g.SMD_PDF_ENGINES.ensure(), g.SMD_PDF_ENGINES.ensure()]);
  const srcs = injected.map((s) => s._src);
  assert.equal(srcs.filter((s) => s.includes("html2canvas")).length, 1, "html2canvas injected once");
  assert.equal(srcs.filter((s) => s.includes("jspdf")).length, 1, "jspdf injected once");
  // no globals in the stub, so has() is false: the contract is it resolves false, never throws
  assert.equal(a, false); assert.equal(b, false); assert.equal(c, false);
});

test("already-present engines short-circuit with no injection at all", async () => {
  const { g, injected } = sandbox();
  g.html2canvas = function () {}; g.jspdf = { jsPDF: function () {} };
  assert.equal(await g.SMD_PDF_ENGINES.ensure(), true);
  assert.equal(injected.length, 0, "a second export must not re-fetch what is already loaded");
  assert.equal(g.SMD_PDF_ENGINES.loaded(), true);
});

test("a FAILED load resolves false and never rejects", async () => {
  const { g } = sandbox({ fail: true });
  await assert.doesNotReject(async () => {
    assert.equal(await g.SMD_PDF_ENGINES.ensure(), false);
  });
});

test("a failed load is retryable — the cached promise is cleared", async () => {
  const { g } = sandbox({ fail: true });
  await g.SMD_PDF_ENGINES.ensure();
  g.html2canvas = function () {}; g.jsPDF = function () {};      // engines arrive later
  assert.equal(await g.SMD_PDF_ENGINES.ensure(), true, "a retry after a failure must be able to succeed");
});

test("index.html no longer parses the 551 KB eagerly", () => {
  assert.equal(/<script[^>]*src="\/vendor-html2canvas\.js/.test(INDEX), false, "html2canvas must not be an eager tag");
  assert.equal(/<script[^>]*src="\/vendor-jspdf\.js/.test(INDEX), false, "jspdf must not be an eager tag");
  assert.ok(/<script[^>]*src="\/pdf-engines\.js/.test(INDEX), "the on-demand loader is loaded instead");
});

test("every consumer waits for the loader before reading the globals", () => {
  for (const f of ["native-bridge.js", "prescription.js"]) {
    const s = readFileSync(new URL(f, ROOT), "utf8");
    assert.ok(s.includes("SMD_PDF_ENGINES.ensure"), `${f} must ensure() before using the engines`);
  }
});
