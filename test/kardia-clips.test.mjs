/* test/kardia-clips.test.mjs - Kardia real patient clips (kardia-clips.js):
 * selection by view and pathology over the real credits catalogue,
 * video detection and attribution. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const CLIPS = require("../kardia-clips.js");
const credits = JSON.parse(readFileSync(new URL("../kardia/media/credits.json", import.meta.url), "utf8"));

test("exports: pure helpers, module.exports, ES5 source", () => {
  for (const k of ["isVideo", "clipUrl", "indexClips", "clipsFor", "pathologyOfLesson", "attributionLine"]) {
    assert.equal(typeof CLIPS[k], "function", k);
  }
  const src = readFileSync(new URL("../kardia-clips.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  assert.ok(!/[–—]/.test(src), "no em or en dashes");
});

test("the catalogue holds 38 clips indexed by view and pathology", () => {
  assert.equal(credits.clips.length, 38);
  const idx = CLIPS.indexClips(credits.clips);
  assert.equal(idx.all.length, 38);
  assert.ok(Object.keys(idx.byView).length >= 8, "view clips indexed");
  assert.ok(Object.keys(idx.byPathology).length >= 10, "pathology clips indexed");
});

test("clipsFor selects by view, by pathology, and both without duplicates", () => {
  const byView = CLIPS.clipsFor(credits.clips, { view: "tte_plax" });
  assert.ok(byView.length >= 2, "PLAX has clips");
  assert.ok(byView.every((c) => c.view === "tte_plax"));
  const byPath = CLIPS.clipsFor(credits.clips, { pathology: "mitral_stenosis" });
  assert.ok(byPath.length >= 1);
  assert.ok(byPath.every((c) => c.pathology === "mitral_stenosis"));
  const both = CLIPS.clipsFor(credits.clips, { view: "tte_a4c", pathology: "mitral_stenosis" });
  const files = both.map((c) => c.file);
  assert.equal(new Set(files).size, files.length, "no duplicates");
  assert.ok(both.some((c) => c.view === "tte_a4c"));
  assert.ok(both.some((c) => c.pathology === "mitral_stenosis"));
  assert.deepEqual(CLIPS.clipsFor(credits.clips, { view: "no_such_view" }), []);
  assert.deepEqual(CLIPS.clipsFor(credits.clips, {}), []);
  assert.deepEqual(CLIPS.clipsFor([], { view: "tte_plax" }), []);
  /* Indexed input is accepted as well as the raw array. */
  const idx = CLIPS.indexClips(credits.clips);
  assert.deepEqual(CLIPS.clipsFor(idx, { view: "tte_plax" }).map((c) => c.file), byView.map((c) => c.file));
});

test("every clip view exists in the views catalogue or is a pathology clip", () => {
  const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
  const viewIds = new Set(views.views.map((v) => v.id));
  for (const c of credits.clips) {
    if (c.view) assert.ok(viewIds.has(c.view), c.file + " view " + c.view);
    assert.ok(c.url && /^https:\/\//.test(c.url), c.file + " hosted at its url");
    assert.ok(CLIPS.attributionLine(c).length > 10, c.file + " carries attribution");
  }
});

test("isVideo and clipUrl follow the file type and the test override", () => {
  assert.equal(CLIPS.isVideo({ file: "a.mp4" }), true);
  assert.equal(CLIPS.isVideo({ file: "a.webp" }), false);
  assert.equal(CLIPS.isVideo({ file: "a.png" }), false);
  assert.equal(CLIPS.clipUrl({ url: "https://x/a.mp4" }), "https://x/a.mp4");
  assert.equal(CLIPS.clipUrl({ url: "https://x/a.mp4" }, "/test/fixture.mp4"), "/test/fixture.mp4");
  assert.equal(CLIPS.clipUrl({ url: "https://x/a.mp4" }, ""), "https://x/a.mp4");
});

test("pathology lessons map to their pathology clips", () => {
  assert.equal(CLIPS.pathologyOfLesson({ id: "path_mitral_stenosis" }), "mitral_stenosis");
  assert.equal(CLIPS.pathologyOfLesson({ id: "view_plax" }), null);
  assert.equal(CLIPS.pathologyOfLesson(null), null);
  const lessonClips = CLIPS.clipsFor(credits.clips, {
    view: "tte_plax", pathology: CLIPS.pathologyOfLesson({ id: "path_mitral_stenosis" })
  });
  assert.ok(lessonClips.length >= 2, "a PLAX mitral stenosis lesson finds real clips");
});
