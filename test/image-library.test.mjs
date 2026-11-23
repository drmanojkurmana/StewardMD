/* Image Library: builder index, pure helpers, flag. Node tests, no browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildAll, canonicalSystem, captionOf, commonsSrc, commonsTitle, kindOf, tidyCommonsCaption, writeIndex } from "../tools/build-image-library.mjs";

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

test("builder: teaching animations are listed and every GIF file ships", () => {
  const anims = Object.values(data().bySystem).flat().filter((e) => e.f === "Animations");
  assert.ok(anims.length >= 158, "animations in the bank, got " + anims.length);
  for (const e of anims) {
    assert.equal(e.k, "Animation");
    assert.ok(fs.existsSync(path.join(import.meta.dirname, "..", e.s)), "GIF file exists: " + e.s);
  }
  const sh = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts/build-www.sh"), "utf8");
  assert.ok(sh.includes("media/anim"), "build-www copies media/anim (left out with SMD_REMOTE_MEDIA=1)");
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

/* Commons pathology and histology (tools/fetch-commons-pathology.mjs -> kb/imglib/commons-pathology.json). */
import { stripHtml, titleFromFile, trimCaption, kindFor, usableCaption } from "../tools/fetch-commons-pathology.mjs";

test("commons import: helpers keep the uploader's text and drop empty captions", () => {
  assert.equal(stripHtml('<div lang="en">Micrograph of <b>Barrett</b>&nbsp;oesophagus. H&amp;E stain.</div>'), "Micrograph of Barrett oesophagus. H&E stain.");
  assert.equal(titleFromFile("File:Adenocarcinoma_of_the_colon_--_high_mag.jpg"), "Adenocarcinoma of the colon, high mag");
  assert.equal(titleFromFile("File:Liver_biopsy_(2).png"), "Liver biopsy");
  const long = "First sentence about the slide with enough words to pass the cut. ".repeat(12);
  const t = trimCaption(long);
  assert.ok(t.length <= 500 && t.endsWith("."), "trimmed at a sentence end");
  assert.equal(kindFor("Pap stain cervical smear", "Histopathology"), "Cytology");
  assert.equal(kindFor("Gross pathology of the liver", "Histopathology"), "Gross specimen");
  assert.equal(kindFor("Normal kidney cortex", "Histology"), "Histology");
  assert.equal(usableCaption("Own work", "x"), false);
  assert.equal(usableCaption("Micrograph", "x"), false);
  assert.equal(usableCaption("Micrograph of a hepatocellular carcinoma. H&E stain.", "Hcc"), true);
  assert.equal(tidyCommonsCaption("Micrograph of a chondroblastoma . H&E stain . Related images Intermed. mag. Very high mag."), "Micrograph of a chondroblastoma. H&E stain.");
  assert.equal(commonsSrc("https://upload.wikimedia.org/wikipedia/commons/3/3d/X.jpg?utm_source=commons.wikimedia.org"), "https://upload.wikimedia.org/wikipedia/commons/3/3d/X.jpg");
  assert.equal(commonsSrc("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/X.png/960px-X.png"), "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/X.png/960px-X.png");
  assert.equal(commonsSrc("https://example.com/x.jpg"), "");
  assert.equal(commonsTitle("Mucinous carcinoma", "x"), "Mucinous carcinoma");
  assert.equal(commonsTitle("Dsrct1", "Desmoplastic small round cell tumor. H&E stain."), "Desmoplastic small round cell tumor");
});

test("commons import: every merged image is openly licensed, attributed and linked to its Commons page", () => {
  const d = data();
  const all = Object.values(d.bySystem).flat().filter((e) => e.lk === "commons" && e.f !== "Qbank");
  assert.ok(all.length > 300, "pathology and histology images merged, got " + all.length);
  for (const e of all) {
    assert.match(e.s, /^https:\/\/(upload|thumb)\.wikimedia\.org\/[^?]+$/);
    assert.match(e.u, /^https:\/\/commons\.wikimedia\.org\//);
    assert.match(e.li, /^(cc[ -]by(-sa)?[ -]\d|cc0|public domain|pd)/i, "open licence: " + e.li);
    assert.doesNotMatch(e.li, /\bnc\b|\bnd\b/i);
    assert.equal(e.o, "commons");
    assert.ok(["Commons pathology", "Commons histology"].includes(e.f));
  }
  const sys = new Set(Object.keys(d.bySystem).filter((s) => d.bySystem[s].some((e) => e.lk === "commons")));
  for (const s of ["gastroenterology", "dermatology", "oncology", "anatomy"]) assert.ok(sys.has(s), "commons images in " + s);
});

import { bankKey, captionFor, entryFor, firstSentence, titleOf } from "../tools/snapshot-qbank-images.mjs";

test("qbank snapshot: overlay bare names resolve the way the app serves them", () => {
  assert.equal(bankKey("i-01b1aec04712.webp", ["overlay", "maikimg1", "surgery", "sur-periop.json"]), "img/maikimg/i-01b1aec04712.webp");
  assert.equal(bankKey("v16/ss-radiology/img/i-a.webp", ["v16", "ss-radiology"]), "v16/ss-radiology/img/i-a.webp");
  assert.equal(bankKey("i-a.webp", ["v16", "ss-radiology"]), "", "a bare name outside an overlay is not guessed");
  assert.equal(bankKey("../x.webp", ["overlay", "maikimg1"]), "");
});

test("qbank snapshot: caption is the question's own key point, title never names the wrong option", () => {
  const it = { id: "q1", q: "Which is the most likely diagnosis?", o: ["Galeazzi fracture", "Monteggia", "Colles", "Smith"], a: 0,
    kp: "Galeazzi fracture is a distal radius shaft fracture with distal radioulnar joint dislocation. More text here.", exp: "x" };
  assert.equal(captionFor(it), "Galeazzi fracture is a distal radius shaft fracture with distal radioulnar joint dislocation.");
  assert.equal(titleOf(it), "Galeazzi fracture");
  assert.equal(titleOf({ ...it, q: "All of the following are true EXCEPT" }), "", "an EXCEPT key is not what the image shows");
  assert.equal(titleOf({ ...it, meta: { topic: "Forearm fractures" } }), "Forearm fractures");
  assert.equal(firstSentence("short"), "short");
  assert.equal(entryFor({ ...it, kp: "", exp: "" }, "v90/img/fx-a.webp", "orthopaedics", "m", null), null, "no caption, no entry");
  const credit = { author: "Jane Doe", licence: "CC BY-SA 4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" };
  const e = entryFor(it, "v90/img/fx-a.webp", "orthopaedics", "m", credit);
  assert.equal(e.licence, "CC BY-SA 4.0");
  assert.equal(e.page, credit.sourceUrl);
  assert.equal(entryFor(it, "v90/img/fx-a.webp", "orthopaedics", "m", { author: "A", licence: "x", sourceUrl: "https://example.com" }).page, undefined);
});

test("builder: Qbank images join the bank, Commons ones attributed and linked", () => {
  const d = data();
  const qb = Object.values(d.bySystem).flat().filter((e) => e.f === "Qbank");
  assert.ok(qb.length > 500, "Qbank images present, got " + qb.length);
  for (const e of qb) {
    assert.match(e.s, /^\/api\/prep\/bank\/(v\d+|img)\/[\w./-]+\.(webp|png|jpe?g)$/i, "bank URL: " + e.s);
    assert.ok(e.c.length >= 20 && e.t, "caption and title: " + e.s);
    if (e.o === "commons") {
      assert.ok(e.cr && e.li && /^https:\/\/commons\.wikimedia\.org\//.test(e.u), "attributed: " + e.s);
      assert.equal(e.lk, "commons");
    } else assert.equal(e.lk, "prep");
  }
});

test("viewer gesture maths: pinch about an off-centre point keeps that point still", () => {
  const pure = PURE.getViewerPure();
  const t = { x: 20, y: -30 };
  const s = 1.5;
  const s2 = 3.0;
  const f = { x: 120, y: 60 }; // off-centre focal point

  const t2 = pure.zoomAt(t, s, s2, f);

  // The point on the image under f before zoom is q:
  const q = { x: (f.x - t.x) / s, y: (f.y - t.y) / s };
  // After zoom to s2 and translation t2, q must still be under f:
  assert.ok(Math.abs(t2.x + s2 * q.x - f.x) < 1e-9, "X focal point is stationary");
  assert.ok(Math.abs(t2.y + s2 * q.y - f.y) < 1e-9, "Y focal point is stationary");
});

test("viewer gesture maths: pan is clamped to image bounds", () => {
  const pure = PURE.getViewerPure();
  // Image laid out 300x200 in 400x600 stage at 2x scale:
  // Rendered image is 600x400. In W=400, overflow is 200, so bounds.x = 100.
  // In H=600, 400 < 600, so bounds.y = 0 (centred).
  assert.deepEqual(pure.bounds(2, 300, 200, 400, 600), { x: 100, y: 0 });

  // Excessive pan is clamped to bounds:
  assert.deepEqual(pure.clampPan({ x: 500, y: -80 }, 2, 300, 200, 400, 600), { x: 100, y: 0 });
  assert.deepEqual(pure.clampPan({ x: -250, y: 80 }, 2, 300, 200, 400, 600), { x: -100, y: 0 });

  // Pan at 1x fit size is clamped to (0, 0):
  assert.deepEqual(pure.clampPan({ x: 50, y: 50 }, 1, 300, 200, 400, 600), { x: 0, y: 0 });

  // Soft pan applies rubber band resistance past edge:
  const p = pure.softPan({ x: 300, y: 0 }, 2, 300, 200, 400, 600);
  assert.ok(p.x > 100, "moves past the edge");
  assert.ok(p.x < 100 + 400 / 3, "rubber banding limits movement to at most a third of stage");
});

test("viewer gesture maths: swipe navigates only at fit (scale <= 1.01)", () => {
  // At fit size (scale 1.0): horizontal drag triggers navigation
  assert.equal(PURE.shouldSwipeNav(1.0, -80, 10), true, "left swipe at 1x navigates to next");
  assert.equal(PURE.shouldSwipeNav(1.0, 80, 10), true, "right swipe at 1x navigates to prev");
  assert.equal(PURE.shouldSwipeNav(1.01, -70, 5), true, "swipe at threshold 1.01x navigates");

  // While zoomed (scale > 1.01): drag MUST pan the image, never navigate
  assert.equal(PURE.shouldSwipeNav(1.02, -80, 10), false, "drag at 1.02x does not navigate");
  assert.equal(PURE.shouldSwipeNav(2.0, -150, 0), false, "horizontal drag at 2x does not navigate");
  assert.equal(PURE.shouldSwipeNav(2.5, 200, 10), false, "horizontal drag at 2.5x does not navigate");

  // Non-swipe drags at 1x (below threshold or vertical) do not navigate
  assert.equal(PURE.shouldSwipeNav(1.0, -30, 5), false, "small drag (<60px) does not navigate");
  assert.equal(PURE.shouldSwipeNav(1.0, -70, 60), false, "vertical/diagonal drag does not navigate");
});
