// KB article image figures: figures[] entries { type: "image", src "v1/kb/media/<name>.webp",
// alt, caption, ar } render as diagram cards through /api/prep/bank/ like lesson media.
// Reader: kb-figure.js (pure helpers) + kb-protocols.js readerHTML. Route: bankPath allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";
import { bucketOf, entryFor, hasV2 } from "../kb/tools/build-kb-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const KBFigure = require(join(ROOT, "kb-figure.js"));

const good = () => ({
  id: "mitral-stenosis-echo",
  type: "image",
  title: "Rheumatic mitral stenosis",
  src: "v1/kb/media/mitral-stenosis-echo.webp",
  alt: "Parasternal long-axis echocardiogram showing thickened mitral leaflets and left atrial enlargement",
  caption: "Rheumatic mitral stenosis with left atrial enlargement. Image: A. Doctor, CC BY 4.0, Wikimedia Commons.",
  ar: 1.5,
});

globalThis.window = globalThis.window || {};
globalThis.window.KBFigure = KBFigure;
globalThis.window.KBHy = { html: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") };
const KBPROTO = require(join(ROOT, "kb-protocols.js"));

test("isImage accepts a complete entry and rejects anything unsafe", () => {
  assert.equal(KBFigure.isImage(good()), true);
  assert.equal(KBFigure.isImage({ ...good(), type: "svg-spec" }), false);
  assert.equal(KBFigure.isImage({ ...good(), src: "v1/lessons/media/x.webp" }), false, "lesson media is not KB media");
  assert.equal(KBFigure.isImage({ ...good(), src: "v1/kb/media/../x.webp" }), false, "traversal never renders");
  assert.equal(KBFigure.isImage({ ...good(), src: "https://example.org/x.webp" }), false, "remote URLs never render");
  assert.equal(KBFigure.isImage({ ...good(), src: "v1/kb/media/x.png" }), false, "only immutable webp ships");
  assert.equal(KBFigure.isImage({ ...good(), alt: "  " }), false, "alt text is required");
  assert.equal(KBFigure.isImage({ ...good(), caption: "" }), false, "caption (with credit) is required");
  assert.equal(KBFigure.isImage(null), false);
});

test("imgUrl sends bank paths through the bank API like lesson figures", () => {
  assert.equal(KBFigure.imgUrl("v1/kb/media/x.webp"), "/api/prep/bank/v1/kb/media/x.webp");
  assert.equal(KBFigure.imgUrl("/v1/kb/media/x.webp"), "/api/prep/bank/v1/kb/media/x.webp");
  assert.equal(KBFigure.imgUrl("v1/kb/media/x.webp", "https://stewardmd.in/api/prep/bank/"), "https://stewardmd.in/api/prep/bank/v1/kb/media/x.webp");
  assert.equal(KBFigure.imgUrl("v1/kb/media/x.webp", "/api/prep/bank/", "https://stewardmd.in"), "https://stewardmd.in/api/prep/bank/v1/kb/media/x.webp");
});

test("imageHTML looks like the reader's diagram cards and escapes everything", () => {
  const html = KBFigure.imageHTML(good(), "/api/prep/bank/v1/kb/media/mitral-stenosis-echo.webp");
  assert.match(html, /<figure class="kbp-diagram-card">/);
  assert.match(html, /<img class="kbp-diagram-img" src="\/api\/prep\/bank\/v1\/kb\/media\/mitral-stenosis-echo\.webp"/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.match(html, /width="1500" height="1000"/, "ar reserves the box before load (no layout jump)");
  assert.match(html, /alt="Parasternal long-axis echocardiogram/);
  assert.match(html, /Wikimedia Commons\./, "credit rides in the caption");
  const evil = KBFigure.imageHTML({ ...good(), title: '<script>alert(1)</script>', caption: 'A "quoted" <b>caption</b>' }, "/api/prep/bank/v1/kb/media/mitral-stenosis-echo.webp");
  assert.doesNotMatch(evil, /<script>/);
  assert.match(evil, /&lt;script&gt;/);
  assert.match(evil, /&quot;quoted&quot;/);
  assert.equal(KBFigure.imageHTML({ ...good(), alt: "" }), "", "invalid entries render nothing");
  assert.match(KBFigure.imageHTML({ ...good(), ar: undefined }), /<img/, "missing ar still renders, without box_dims");
  assert.doesNotMatch(KBFigure.imageHTML({ ...good(), ar: undefined }), /width=/);
});

test("imageKbrHTML speaks the disease page idiom and escapes everything", () => {
  const html = KBFigure.imageKbrHTML(good(), "/api/prep/bank/v1/kb/media/mitral-stenosis-echo.webp");
  assert.match(html, /<figure class="kbr-fig">/);
  assert.match(html, /<img class="kbr-media" src="\/api\/prep\/bank\/v1\/kb\/media\/mitral-stenosis-echo\.webp"/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.match(html, /width="1500" height="1000"/);
  assert.match(html, /<p class="kbr-note">Rheumatic mitral stenosis with left atrial enlargement/);
  assert.doesNotMatch(html, /kbp-diagram/, "disease page keeps its own figure classes");
  assert.equal(KBFigure.imageKbrHTML({ ...good(), src: "https://evil.example/x.webp" }), "");
});

test("the v2 bucket builder carries figures only when present", () => {
  assert.deepEqual(entryFor({}).figures, undefined, "no figures key without figures (byte-identical rebuild)");
  const e = entryFor({ flowcharts: [], valueTables: [], figures: [good()], review: { status: "reviewed" } });
  assert.equal(e.figures.length, 1);
  assert.equal(e.status, "reviewed");
  assert.equal(hasV2({ figures: [good()] }), true, "a figures-only article ships a bucket entry");
  assert.equal(hasV2({}), false);
  assert.equal(hasV2({ flowcharts: [{}] }), true);
  for (const id of ["mitral_stenosis", "CAP", "11_beta_hydroxylase_deficiency"]) {
    const b = bucketOf(id);
    assert.ok(b >= 0 && b < 64, id);
  }
});

test("bankPath serves KB media and nothing around it", () => {
  assert.equal(bankPath({ path: ["v1", "kb", "media", "mitral-stenosis-echo.webp"] }), "v1/kb/media/mitral-stenosis-echo.webp");
  assert.equal(bankPath({ path: ["v12", "kb", "media", "xx.webp"] }), "v12/kb/media/xx.webp");
  assert.equal(bankPath({ path: ["v1", "kb", "media", "..", "x.webp"] }), null);
  assert.equal(bankPath({ path: ["v1", "kb", "media", "x.jpg"] }), null);
  assert.equal(bankPath({ path: ["v1", "kb", "media", "x.webp", "y"] }), null);
  assert.equal(bankPath({ path: ["v1", "kb", "other", "x.webp"] }), null);
  assert.equal(bankPath({ path: ["v1", "lessons", "media", "xx.webp"] }), "v1/lessons/media/xx.webp", "lesson media still served");
});

test("every figures[] entry in every KB reference article is renderable", () => {
  const dir = join(ROOT, "kb", "reference");
  let articles = 0, images = 0, drawn = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!(d.figures || []).length) continue;
    articles++;
    for (const fig of d.figures) {
      if (fig.type === "image") {
        assert.equal(KBFigure.isImage(fig), true, f + ": image entry fails isImage");
        images++;
      } else if (fig.type === "svg-spec") {
        assert.ok(fig.spec && (fig.spec.columns || []).length > 0, f + ": svg-spec without columns");
        drawn++;
      } else {
        assert.fail(f + ": unknown figure type " + fig.type);
      }
    }
  }
  assert.ok(images >= 1, "at least one shipped image figure is covered");
});

test("readerHTML draws image figures in order and keeps drawn-figure jump targets", () => {
  const drawn = {
    id: "pathway", type: "svg-spec", title: "Pathway",
    spec: { columns: [{ header: "A", items: ["a1"] }, { header: "B", items: ["b1"] }], flows: [["a1", "b1"]] },
  };
  const p = {
    id: "demo", title: "Demo", subject: "cardiology", summary: "Demo summary.",
    sections: [{ kind: "recognise", title: "Recognise", items: ["Feature one."] }],
    sources: [{ org: "Society", title: "Guideline", year: 2024, url: "https://example.org/g" }],
    review: { status: "ai_drafted", compiled: "2026-09-25" },
    figures: [{ ...good(), id: "img0", title: "Echo" }, drawn, { type: "image", id: "bad", src: "https://evil.example/x.webp" }],
  };
  const html = KBPROTO.readerHTML(p, { idPrefix: "t" });
  assert.match(html, /id="tFigImg0"/, "image section has its jump target");
  assert.match(html, /data-kbp-jump="tFigImg0">Echo</, "image has its TOC chip");
  assert.match(html, /id="tFig0"/, "the drawn figure keeps its Fig0 target after an earlier image");
  assert.match(html, /kbp-diagram-img/, "image uses the diagram card look");
  assert.doesNotMatch(html, /evil\.example/, "invalid entries render nothing and add no chip");
  assert.doesNotMatch(html, /FigImg2/, "the invalid entry adds no section or chip");
});
