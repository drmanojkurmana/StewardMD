/* remote-media.js path mapping and tools/upload-app-media.mjs file list (owner 2026-11-12: lessons, lesson diagrams and
 * CliniX photos from R2 on first view, signed-in only). The R2 key, the server route and the loader must agree.
 *   node --test test/remote-media.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const RM = require("../remote-media.js");
const { listFiles, SOURCES, contentType } = await import("../tools/upload-app-media.mjs");
const bank = await import("../functions/api/prep/bank/[[path]].js");
const gated = (p) => /^v\d{1,3}\/lessons\/media\//.test(p) || /^app\//.test(p);

test("bundle paths map to app/<same path> only when the bundle leaves them out", () => {
  for (const s of ["/clinix/media/practicals/a-b.webp", "/clinix/media/skills/s_k.webp", "/prep/lessons/media/x-y.svg", "capacitor://localhost/clinix/media/practicals/a-b.webp"]) {
    const k = RM.key(s, { remoteBundle: true, isGated: gated });
    assert.match(k, /^app\/(?:clinix|prep)\//, s);
    assert.equal(RM.key(s, { remoteBundle: false, isGated: gated }), null, s + " stays local while bundled");
  }
});

test("teaching animations (media/anim) load from R2 when left out of the app, and the server serves that path", () => {
  assert.equal(RM.key("/media/anim/gif011_immune-response.webp", { remoteBundle: true, isGated: gated }), "app/media/anim/gif011_immune-response.webp");
  assert.equal(RM.key("/media/anim/gif011_immune-response.webp", { remoteBundle: false, isGated: gated }), null);
  assert.ok(SOURCES.some((s) => s.dir === "media/anim"), "upload tool sends media/anim");
  for (const f of ["gif011_immune-response.av1.mp4", "gif011_immune-response.mp4"]) {
    assert.equal(RM.key("/media/anim/" + f, { remoteBundle: true, isGated: gated }), "app/media/anim/" + f);
    assert.ok(SOURCES.find((s) => s.dir === "media/anim").re.test(f), "upload tool sends " + f);
  }
});

test("gated bank pictures are claimed (signature dropped), public ones and other images are left alone", () => {
  assert.equal(RM.key("https://stewardmd.in/api/prep/bank/v1/lessons/media/x-y.webp?s=1&exp=2&sig=3", { isGated: gated }), "v1/lessons/media/x-y.webp");
  for (const s of ["/api/prep/bank/v1/kb/media/x-y.webp", "/clinix-logo.png", "blob:abc", "data:image/png;base64,AA", "/clinix/media/../secret.webp", "/api/prep/bank/v1/lessons/media/../../x.webp"]) {
    assert.equal(RM.key(s, { remoteBundle: true, isGated: gated }), null, s);
  }
});

test("every file the upload sends has a route the server answers", () => {
  const www = fs.mkdtempSync(path.join(os.tmpdir(), "rm-"));
  for (const s of SOURCES) fs.mkdirSync(path.join(www, s.dir), { recursive: true });
  fs.writeFileSync(path.join(www, "prep/lessons/v1/index.json"), "{}");
  fs.writeFileSync(path.join(www, "prep/lessons/v1/ana-axilla.json"), "{}");
  fs.writeFileSync(path.join(www, "prep/lessons/media/ana-abduction-phases.svg"), "<svg/>");
  fs.writeFileSync(path.join(www, "prep/lessons/media/ATTRIBUTION.md"), "x");
  fs.writeFileSync(path.join(www, "clinix/media/practicals/obg-ins-veress-needle.webp"), "x");
  fs.writeFileSync(path.join(www, "clinix/media/skills/skill-exam-surg-gastric_outlet_obstruction.webp"), "x");
  const files = listFiles(www);
  assert.deepEqual(files.map((f) => f.rel).sort(), ["clinix/media/practicals/obg-ins-veress-needle.webp", "clinix/media/skills/skill-exam-surg-gastric_outlet_obstruction.webp", "prep/lessons/media/ana-abduction-phases.svg", "prep/lessons/v1/ana-axilla.json"]);
  for (const f of files) {
    assert.equal(f.key, "prep-bank/app/" + f.rel);
    assert.equal(bank.bankPath({ path: ("app/" + f.rel).split("/") }), "app/" + f.rel, f.rel);
  }
});

test("the real repo content all passes the server route (no file would be refused after upload)", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = listFiles(root);
  const bad = files.filter((f) => bank.bankPath({ path: ("app/" + f.rel).split("/") }) !== "app/" + f.rel);
  assert.deepEqual(bad.map((f) => f.rel), []);
  assert.ok(files.some((f) => f.rel === "media/anim/gif011_immune-response.mp4"), "animation clips are uploaded");
  assert.ok(files.some((f) => f.rel.startsWith("surgx/media/") && f.rel.endsWith(".webp")), "SurgX pictures are uploaded");
  assert.ok(files.some((f) => f.rel.startsWith("kardia/media/clips/") && f.rel.endsWith(".mp4")), "Kardia clips are uploaded");
  assert.ok(files.some((f) => f.rel.startsWith("tokos/learn/") && f.rel.endsWith(".svg")), "Tokos diagrams are uploaded");
  assert.ok(files.some((f) => f.rel.startsWith("ophthalmos/learn/media/") && f.rel.endsWith(".webp")), "Ophthalmos pictures are uploaded");
  assert.equal(files.some((f) => f.rel.endsWith(".json") && /^(?:surgx|tokos|ophthalmos|kardia)\//.test(f.rel)), false, "manifests and credits stay in the app");
  assert.equal(files.some((f) => f.rel.endsWith(".gif")), false, "SurgX GIFs stay in the app");
  assert.equal(files.some((f) => f.rel.includes("probelab")), false, "ProbeLab stays in the app");
});

test("each new bundle prefix maps to app/<same path>, and a dot-dot inside the bundle collapses", () => {
  const opts = { remoteBundle: true, isGated: gated };
  const rows = [
    ["/surgx/media/acl-reconstruction/04_eua.webp", "app/surgx/media/acl-reconstruction/04_eua.webp"],
    ["/kardia/media/clips/tte-a2c-2.mp4", "app/kardia/media/clips/tte-a2c-2.mp4"],
    ["/kardia/learn/diagrams/dop_cw.svg", "app/kardia/learn/diagrams/dop_cw.svg"],
    ["/tokos/media/ctg/1020.svg", "app/tokos/media/ctg/1020.svg"],
    ["/tokos/learn/diagrams/gy5-fibroid.svg", "app/tokos/learn/diagrams/gy5-fibroid.svg"],
    ["/tokos/learn/media/../diagrams/gy5-fibroid.svg", "app/tokos/learn/diagrams/gy5-fibroid.svg"],
    ["/tokos/learn/media/real/gy5-fibroid.webp", "app/tokos/learn/media/real/gy5-fibroid.webp"],
    ["/ophthalmos/learn/media/photos/sim-amd.webp", "app/ophthalmos/learn/media/photos/sim-amd.webp"],
    ["/ophthalmos/learn/diagrams/pg-ted.svg", "app/ophthalmos/learn/diagrams/pg-ted.svg"],
    ["capacitor://localhost/surgx/media/prk/still.png", "app/surgx/media/prk/still.png"],
    ["/surgx/media/prk/still.jpg", "app/surgx/media/prk/still.jpg"],
  ];
  for (const [src, want] of rows) {
    assert.equal(RM.key(src, opts), want, src);
    assert.equal(RM.key(src, { remoteBundle: false, isGated: gated }), null, src + " stays local while bundled");
  }
  for (const src of ["/surgx/media/lap-cholecystectomy/gif09_cvs.gif", "/surgx/media/manifest.json", "/narke/learn/media/x.svg", "/kardia/probelab/assets/media/CinePLAX.mp4", "/tokos/learn/../../secret.webp"]) {
    assert.equal(RM.key(src, opts), null, src);
  }
});

test("resolve returns the original path when remote media is off, and the bank key when it is on", async () => {
  const pic = "/ophthalmos/learn/media/photos/sim-amd.webp";
  assert.equal(await RM.resolve(pic, { remoteBundle: false }), pic);
  assert.equal(await RM.resolve(pic, { off: true, remoteBundle: true }), pic);
  assert.equal(await RM.resolve(pic, { remoteBundle: true, isGated: gated }), "app" + pic);
  assert.equal(await RM.resolve("/narke/learn/media/x.svg", { remoteBundle: true, isGated: gated }), "/narke/learn/media/x.svg");
  assert.equal(await RM.resolve("/tokos/learn/media/../diagrams/gy5-fibroid.svg", { remoteBundle: true, isGated: gated }), "app/tokos/learn/diagrams/gy5-fibroid.svg");
  let seen = "";
  assert.equal(await RM.resolve(pic, { remoteBundle: true, isGated: gated, load: (k) => { seen = k; return "blob:" + k; } }), "blob:app" + pic);
  assert.equal(seen, "app" + pic);
});

function fakeEl(tag, attrs, extra) {
  const a = Object.assign({}, attrs);
  return Object.assign({
    tagName: tag.toUpperCase(),
    localName: tag.toLowerCase(),
    parentNode: null,
    autoplay: false,
    played: 0,
    loaded: 0,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(a, k) ? a[k] : null; },
    setAttribute(k, v) { a[k] = String(v); },
    removeAttribute(k) { delete a[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(a, k); },
    setAttributeNS(_ns, k, v) { a["xlink:" + k] = String(v); },
    play() { this.played += 1; return Promise.resolve(); },
    pause() {},
    load() { this.loaded += 1; },
  }, extra || {});
}

test("video, source and SVG image swap the same way as img", () => {
  const img = fakeEl("img", { src: "/surgx/media/prk/still.webp" });
  RM.applySwap(img, "loading");
  assert.match(img.getAttribute("src"), /^data:image\/gif/);
  RM.applySwap(img, "ok", "blob:pic");
  assert.equal(img.getAttribute("src"), "blob:pic");

  const video = fakeEl("video", { src: "/kardia/media/clips/tte-a2c-2.mp4" }, { autoplay: true });
  RM.applySwap(video, "loading");
  assert.equal(video.getAttribute("src"), null);
  assert.equal(video.getAttribute("preload"), "none");
  RM.applySwap(video, "ok", "blob:clip");
  assert.equal(video.getAttribute("src"), "blob:clip");
  assert.equal(video.played, 1);
  RM.applySwap(video, "fail", "signin");
  assert.equal(video.getAttribute("src"), null);
  assert.match(video.getAttribute("poster"), /^data:image\/svg\+xml/);

  const parent = fakeEl("video", {}, { autoplay: true });
  const source = fakeEl("source", { src: "/kardia/media/clips/tte-a2c-2.mp4" });
  source.parentNode = parent;
  RM.applySwap(source, "loading");
  assert.equal(source.getAttribute("src"), null);
  assert.equal(parent.getAttribute("preload"), "none");
  RM.applySwap(source, "ok", "blob:clip");
  assert.equal(source.getAttribute("src"), "blob:clip");
  assert.equal(parent.loaded, 1);
  assert.equal(parent.played, 1);

  const svg = fakeEl("image", { href: "/tokos/media/instruments/in-01.webp", "xlink:href": "/tokos/media/instruments/in-01.webp" });
  assert.equal(RM.mediaKind(svg), "svgimage");
  assert.equal(RM.mediaPath(svg), "/tokos/media/instruments/in-01.webp");
  RM.applySwap(svg, "loading");
  assert.match(svg.getAttribute("href"), /^data:image\/gif/);
  assert.match(svg.getAttribute("xlink:href"), /^data:image\/gif/);
  RM.applySwap(svg, "fail", "offline");
  assert.match(svg.getAttribute("href"), /^data:image\/svg\+xml/);
});

test("upload content types cover png, jpeg, svg and mp4", () => {
  assert.equal(contentType("a.mp4"), "video/mp4");
  assert.equal(contentType("a.av1.mp4"), "video/mp4");
  assert.equal(contentType("a.svg"), "image/svg+xml");
  assert.equal(contentType("a.png"), "image/png");
  assert.equal(contentType("a.jpg"), "image/jpeg");
  assert.equal(contentType("a.jpeg"), "image/jpeg");
  assert.equal(contentType("a.webp"), "image/webp");
  assert.equal(contentType("a.json"), "application/json");
});
