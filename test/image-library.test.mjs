/* Image Library: builder index, pure helpers, flag. Node tests, no browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildAll, canonicalSystem, captionOf, kindOf, writeIndex } from "../tools/build-image-library.mjs";

const require = createRequire(import.meta.url);
const PURE = require("../image-library.js");

let DATA = null;
function data() { if (!DATA) DATA = buildAll(); return DATA; }

test("builder: every entry has src and caption, no duplicates", () => {
  const d = data();
  assert.ok(d.total > 5000, "central bank holds thousands of images, got " + d.total);
  const seen = new Set();
  for (const slug of Object.keys(d.bySystem)) {
    for (const e of d.bySystem[slug]) {
      assert.ok(e.s && e.s.length > 3, "entry has src");
      assert.ok(e.c && e.c.trim().length > 0, "entry has caption: " + e.s);
      assert.ok(e.t && e.t.trim().length > 0, "entry has title: " + e.s);
      assert.ok(!seen.has(e.s), "no duplicate src: " + e.s);
      seen.add(e.s);
    }
  }
  assert.equal(seen.size, d.total);
});

test("builder: ECGs sit under Cardiology with ECG kind, eye images under Eye", () => {
  const d = data();
  const cardio = d.bySystem["cardiology"] || [];
  const ecgs = cardio.filter((e) => e.k === "ECG");
  assert.ok(ecgs.length > 800, "ECG library merged (shared tracings deduped), got " + ecgs.length);
  assert.ok(cardio.filter((e) => e.f === "ECG library").every((e) => e.k === "ECG"));
  const eye = d.bySystem["eye"] || [];
  assert.ok(eye.length > 150, "eye bank populated, got " + eye.length);
  assert.ok(eye.some((e) => e.f === "Ophthalmós"));
  assert.ok(eye.some((e) => e.f === "Eye atlas"));
});

test("builder: sources are all represented", () => {
  const d = data();
  const froms = new Set();
  for (const slug of Object.keys(d.bySystem)) d.bySystem[slug].forEach((e) => froms.add(e.f));
  for (const f of ["Library", "Lessons", "ECG library", "Eye atlas", "Ophthalmós", "Tokós", "Narkē", "CliniX"]) {
    assert.ok(froms.has(f), "source present: " + f);
  }
});

test("builder: per-system split stays phone-sized and index totals agree", () => {
  const d = data();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imglib-"));
  const sizes = writeIndex(dir, d);
  const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  assert.equal(ix.total, d.total);
  assert.equal(ix.systems.reduce((a, s) => a + s.count, 0), d.total);
  assert.ok(ix.systems.every((s) => s.sample), "every system has a sample thumbnail");
  for (const slug of Object.keys(sizes)) {
    assert.ok(sizes[slug] < 700 * 1024, slug + " under 700 KB, got " + sizes[slug]);
  }
  assert.ok(fs.statSync(path.join(dir, "index.json")).size < 64 * 1024, "index.json is small");
});

test("builder: caption fallback never invents text", () => {
  assert.equal(captionOf({ caption: "A caption" }), "A caption");
  assert.equal(captionOf({ alt: { en: "Alt text" }, title: "T" }), "Alt text");
  assert.equal(captionOf({ title: "Only title" }), "Only title");
  assert.equal(captionOf({}), "");
});

test("builder: canonical system folding", () => {
  assert.equal(canonicalSystem("Endocrine / Adrenal"), "Endocrine and Metabolic");
  assert.equal(canonicalSystem("Respiratory"), "Respiratory");
  assert.equal(canonicalSystem("Neurology / Developmental epileptic encephalopathy"), "Neurology");
  assert.equal(canonicalSystem("Infectious disease"), "Infectious Diseases");
  assert.equal(canonicalSystem("Cardiology"), "Cardiology");
});

test("builder: kind inference from data", () => {
  assert.equal(kindOf("12-lead ECG shows STEMI", "Illustration"), "ECG");
  assert.equal(kindOf("OCT macular B-scan", "Illustration"), "OCT");
  assert.equal(kindOf("Colour fundus photograph", "Illustration"), "Fundus");
  assert.equal(kindOf("A plain diagram", "Illustration"), "Illustration");
});

test("client pure: search and filters", () => {
  const items = [
    { t: "Mitral stenosis", c: "Opening snap and diastolic murmur", f: "Library", k: "Illustration", o: "stewardmd" },
    { t: "Normal sinus rhythm", c: "Upright P in lead II", f: "ECG library", k: "ECG", o: "other" },
  ];
  assert.equal(PURE.filterItems(items, { q: "diastolic" }).length, 1);
  assert.equal(PURE.filterItems(items, { q: "mitral murmur" }).length, 1);
  assert.equal(PURE.filterItems(items, { kind: "ECG" }).length, 1);
  assert.equal(PURE.filterItems(items, { from: "Library", q: "snap" }).length, 1);
  assert.equal(PURE.filterItems(items, { q: "zzz" }).length, 0);
});

test("client pure: native image URL prefixing", () => {
  globalThis.SMD_API_BASE = "https://stewardmd.in";
  assert.equal(PURE.imgUrl("/api/prep/bank/v1/kb/media/x.webp"), "https://stewardmd.in/api/prep/bank/v1/kb/media/x.webp");
  assert.equal(PURE.imgUrl("https://upload.wikimedia.org/a.jpg"), "https://upload.wikimedia.org/a.jpg");
  delete globalThis.SMD_API_BASE;
});
