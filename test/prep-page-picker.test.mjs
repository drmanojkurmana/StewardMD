/* PDF module page picker (owner 2026-10-15): From/To window validation, the next-60 chain, history keys,
 * the outline reader, and the advanced typed ranges behind the toggle. The request payload never changes: a valid
 * window mirrors to the same spec the typed box always used ("752-811").
 * node --test test/prep-page-picker.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const S = req("../prep-source.js");
const EI = req("../emoji-icons.js");

test("cap: one module holds 60 pages", () => {
  assert.equal(S.PAGE_CAP, 60);
});

/* ---------- From/To window ---------- */
test("clampWindow: a single page and a range inside the cap", () => {
  assert.deepEqual(S.clampWindow("752", "752", 4273).sel.length, 1);
  const w = S.clampWindow("752", "811", 4273);
  assert.equal(w.count, 60);
  assert.equal(w.from, 752); assert.equal(w.to, 811);
  assert.equal(w.sel[0], 752); assert.equal(w.sel[59], 811);
});

test("clampWindow: whitespace is fine, empty or non-numeric is said plainly", () => {
  assert.equal(S.clampWindow(" 752 ", " 811 ", 4273).count, 60);
  assert.match(S.clampWindow("", "811", 4273).error, /first and last/);
  assert.match(S.clampWindow("752", "", 4273).error, /first and last/);
  assert.match(S.clampWindow("75a", "811", 4273).error, /first and last/);
  assert.match(S.clampWindow("752-811", "820", 4273).error, /first and last/);
});

test("clampWindow: out of bounds names the book", () => {
  assert.match(S.clampWindow("0", "10", 4273).error, /has 4273 pages/);
  assert.match(S.clampWindow("1", "4274", 4273).error, /has 4273 pages/);
  assert.match(S.clampWindow("5000", "5001", 4273).error, /has 4273 pages/);
});

test("clampWindow: reversed offers a swap", () => {
  const r = S.clampWindow("811", "752", 4273);
  assert.match(r.error, /before the first/);
  assert.deepEqual(r.swap, { from: 752, to: 811 });
  assert.equal(r.fix, undefined);
});

test("clampWindow: over 60 offers the one-tap fix", () => {
  const r = S.clampWindow(752, 900, 4273);
  assert.match(r.error, /149 pages.*up to 60/);
  assert.deepEqual(r.fix, { from: 752, to: 811 });
  assert.equal(r.sel, undefined);
});

test("clampWindow: the fix keeps the start page near the end of the book", () => {
  const r = S.clampWindow(4213, 4273, 4273);
  assert.deepEqual(r.fix, { from: 4213, to: 4272 });
  const ok = S.clampWindow(r.fix.from, r.fix.to, 4273);
  assert.equal(ok.count, 60);
  assert.equal(S.clampWindow(4214, 4273, 4273).count, 60);
});

test("clampWindow: 61 pages is over, 60 is fine", () => {
  assert.ok(S.clampWindow(1, 61, 500).fix);
  assert.equal(S.clampWindow(1, 60, 500).count, 60);
});

/* ---------- the payload stays the same ---------- */
test("windowSpec round-trips through the typed parser", () => {
  assert.equal(S.windowSpec(752, 811), "752-811");
  assert.equal(S.windowSpec(5, 5), "5");
  const r = S.selFromSpec(S.windowSpec(752, 811), 4273);
  assert.equal(r.sel.length, 60);
  assert.equal(r.sel[0], 752); assert.equal(r.sel[59], 811);
});

/* ---------- advanced typed ranges ---------- */
test("selFromSpec: single page, range, multi-range", () => {
  assert.deepEqual(S.selFromSpec("752", 4273).sel, [752]);
  assert.equal(S.selFromSpec("752-811", 4273).sel.length, 60);
  assert.deepEqual(S.selFromSpec("752-755, 800-801", 4273).sel, [752, 753, 754, 755, 800, 801]);
});

test("selFromSpec: over-limit, reversed, out of bounds, whitespace", () => {
  assert.match(S.selFromSpec("752-900", 4273).error, /up to 60 pages/);
  assert.match(S.selFromSpec("811-752", 4273).error, /1-20, 25/);
  assert.match(S.selFromSpec("4274", 4273).error, /has 4273 pages/);
  assert.deepEqual(S.selFromSpec(" 752 - 755 , 800 ", 4273).sel, [752, 753, 754, 755, 800]);
  assert.match(S.selFromSpec("", 4273).error, /at least one page/);
});

/* ---------- the next-60 chain ---------- */
test("nextWindow: after the used pages, partial at the end, null when done", () => {
  assert.deepEqual(S.nextWindow([752, 811], 4273), { from: 812, to: 871 });
  assert.deepEqual(S.nextWindow([1, 60], 100), { from: 61, to: 100 });
  assert.deepEqual(S.nextWindow([1, 100], 100), null);
  assert.deepEqual(S.nextWindow([], 4273), { from: 1, to: 60 });
  assert.deepEqual(S.nextWindow([811, 752], 4273), { from: 812, to: 871 });
});

test("pdfHistKey: one slot per file, not per phone", () => {
  assert.equal(S.pdfHistKey("Gray.pdf", 10), "Gray.pdf|10");
  assert.notEqual(S.pdfHistKey("Gray.pdf", 10), S.pdfHistKey("Gray.pdf", 11));
  assert.notEqual(S.pdfHistKey("Gray.pdf", 10), S.pdfHistKey("Elsevier.pdf", 10));
});

/* ---------- chapters from the PDF outline ---------- */
function stubDoc(outline, fail) {
  return {
    getOutline: fail ? () => Promise.reject(new Error("x")) : () => Promise.resolve(outline),
    getDestination: (n) => Promise.resolve(n === "ch2" ? [{ num: 9 }] : null),
    getPageIndex: (r) => Promise.resolve(r.num),
  };
}

test("readOutline: chapters with start pages, depth-first, junk left out", async () => {
  const doc = stubDoc([
    { title: "  Cardio  ", dest: [{ num: 1 }, null], items: [{ title: "ECG", dest: "ch2" }] },
    { title: "", dest: [{ num: 5 }] },
    { title: "Lost", dest: null },
    { title: "Gone", dest: "missing" },
  ]);
  assert.deepEqual(await S.readOutline(doc), [
    { title: "Cardio", page: 2 },
    { title: "ECG", page: 10 },
  ]);
});

test("readOutline: no outline, a broken outline, or no document gives []", async () => {
  assert.deepEqual(await S.readOutline(stubDoc(null)), []);
  assert.deepEqual(await S.readOutline(stubDoc(null, true)), []);
  assert.deepEqual(await S.readOutline(null), []);
  assert.deepEqual(await S.readOutline({}), []);
});

/* ---------- the on-screen book scrubber (emoji-icons.js PAGE_RE) ----------
 * Owner anti-citation rule: "pages 752" style locators are removed from rendered text. Every user-facing picker
 * string is therefore phrased so the scrubber keeps it byte-for-byte ("of total" survives, bare "pages N" does
 * not). CI proved it: "Create module from pages 1 to 60" rendered as "Create module from to 60". */
test("picker strings survive the on-screen book scrubber byte-for-byte", () => {
  for (const s of [
    "Create module from 752 to 811",
    "Create module from 4 pages",
    "752-811 of 4273 done",
    "Make the next module: 812 to 871",
    "Use 752 to 811",
    "Swap to 752-811",
    "Page 10 of 100",
    "Cardio · 30 of 100",
    "10 to 20 of 100",
    "4 of 60 pages selected",
    "Pick up to 60 pages. Make another module for the next part.",
    "Using 1 to 3 (3 pages) to stay under 50 MB.",
    "Only 5 is used to stay under 50 MB.",
    "That is the whole book.",
    "That is the end of the book.",
  ]) assert.equal(EI.display(s), s, JSON.stringify(s) + " must reach the screen unchanged");
});
