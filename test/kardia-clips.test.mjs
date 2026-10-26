/* test/kardia-clips.test.mjs - Kardia real patient clips (kardia-clips.js):
 * selection by view and pathology over the real credits catalogue,
 * video detection and attribution. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

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

test("the catalogue holds 100 clips indexed by view and pathology", () => {
  assert.equal(credits.clips.length, 100);
  const idx = CLIPS.indexClips(credits.clips);
  assert.equal(idx.all.length, 100);
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

test("bundled clips resolve to a local URL that exists in the bundle source", () => {
  const bundled = credits.clips.filter((c) => c.localFile);
  assert.equal(bundled.length, 62, "62 de-identified clips are bundled");
  for (const c of bundled) {
    assert.equal(CLIPS.isBundled(c), true, c.file);
    const local = CLIPS.localClipUrl(c, "/kardia/");
    assert.equal(local, "/kardia/media/clips/" + c.file, c.file + " local URL");
    assert.equal(CLIPS.clipUrl(c, null, "/kardia/"), local, c.file + " resolves local first");
    assert.ok(existsSync(new URL("../kardia/media/clips/" + c.file, import.meta.url)), c.file + " exists under kardia/media/clips/");
    assert.ok(CLIPS.isVideo(c), c.file + " bundled clip is a video");
  }
  const hostedOnly = credits.clips.filter((c) => !c.localFile);
  assert.equal(hostedOnly.length, 38, "the earlier hosted clips remain as network fallback entries");
  for (const c of hostedOnly) {
    assert.equal(CLIPS.clipUrl(c, null, "/kardia/"), c.url, c.file + " falls back to its hosted url");
  }
  /* Every Scan Lab view with a bundled clip resolves locally. */
  for (const view of ["tte_plax", "tte_a4c", "tte_psax_mv", "tte_subcostal_4c"]) {
    const hit = CLIPS.chooseClip(CLIPS.indexClips(credits.clips), { view });
    assert.ok(hit, view + " has a clip");
    assert.ok(CLIPS.localClipUrl(hit, "/kardia/").startsWith("/kardia/media/clips/"), view + " resolves to a bundled local URL, got " + (hit && hit.file));
  }
  const build = readFileSync(new URL("../scripts/build-www.sh", import.meta.url), "utf8");
  assert.ok(build.includes("kardia/media/clips"), "build-www.sh copies the bundled clips into www/");
  /* Round 7: the TOF PLAX sweep (tetralogy-of-fallot-2) is filed under
   * tte_plax, so PLAX plays from the bundle at target. IVC is the one
   * Scan Lab view with no bundled clip in the 62-clip set. */
  const plax = CLIPS.chooseClip(CLIPS.indexClips(credits.clips), { view: "tte_plax" });
  assert.ok(plax && CLIPS.isBundled(plax), "PLAX resolves to a bundled clip");
  const ivcBundled = credits.clips.filter((c) => c.view === "tte_subcostal_ivc" && c.localFile);
  assert.equal(ivcBundled.length, 0, "IVC has no bundled clip in the 62-clip set");
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
