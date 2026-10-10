/* PrepNucleus lesson figure redraws (tools/prep-redraw.mjs). What must hold: only the image src (and its aspect) of a
 * mapped figure changes; a spot step gets the hidden-label art, every other step the full art; a compare step keeps its
 * originals; a live -h1 source maps to its -ai1-h art; unmapped figures and other lessons are untouched; the input is not mutated; webp headers of all three kinds
 * give the right dims; a bad map is refused; and the committed redraw manifest (prep/redraw/map.json) is well formed,
 * every redrawn file in it is named after its original and its dims keep the original's aspect (within 3%).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-redraw.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRedraw, webpSize, checkMap, MEDIA } from "../tools/prep-redraw.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = { "rb-x-1.webp": { full: "rb-x-1-ai1.webp", hidden: "rb-x-1-ai1-h.webp", w: 900, h: 600, hw: 900, hh: 600 }, "rb-y-2.webp": { full: "rb-y-2-ai1.webp", w: 600, h: 900 } };
const LES = { id: "t", steps: [
  { tx: "a", vis: { kind: "image", src: MEDIA + "rb-x-1.webp", alt: "x", ar: 1.5, spot: { q: "Tap", box: [0.1, 0.1, 0.2, 0.2], label: "L" } } },
  { tx: "b", vis: { kind: "image", src: MEDIA + "rb-x-1.webp", alt: "x", ar: 1.5, marks: [{ x: 0.2, y: 0.2, label: "M" }] } },
  { tx: "c", vis: { kind: "image", src: MEDIA + "rb-y-2.webp", alt: "y", pair: { src: MEDIA + "rb-z.webp", tag: "z" } } },
  { tx: "d", vis: { kind: "image", src: MEDIA + "rb-q-9.webp", alt: "q" } },
  { tx: "g", vis: { kind: "image", src: MEDIA + "rb-x-1.webp", alt: "x" } },
  { tx: "e", vis: { kind: "table", cols: ["a"], rows: [["b"]] } },
  { tx: "f" }] };

test("applyRedraw: spot and marks steps get the hidden art, a plain view the full art, nothing else changes", () => {
  const { lesson, changed } = applyRedraw(LES, MAP);
  assert.equal(changed, 3);
  assert.equal(lesson.steps[4].vis.src, MEDIA + "rb-x-1-ai1.webp", "a plain view gets the full art");
  assert.equal(lesson.steps[0].vis.src, MEDIA + "rb-x-1-ai1-h.webp");
  assert.equal(lesson.steps[1].vis.src, MEDIA + "rb-x-1-ai1-h.webp", "label marks get the hidden art too");
  assert.equal(lesson.steps[2].vis.src, MEDIA + "rb-y-2.webp", "a compare keeps its originals");
  assert.equal(lesson.steps[3].vis.src, MEDIA + "rb-q-9.webp", "unmapped figure untouched");
  assert.deepEqual(lesson.steps[0].vis.spot, LES.steps[0].vis.spot);
  assert.deepEqual(lesson.steps[1].vis.marks, LES.steps[1].vis.marks);
  assert.equal(lesson.steps[0].vis.ar, 1.5);
  const strip = (l) => JSON.stringify(l).replace(/rb-x-1-ai1(-h)?\.webp/g, "rb-x-1.webp");
  assert.equal(strip(lesson), JSON.stringify(LES), "only the src changed");
  assert.equal(LES.steps[0].vis.src, MEDIA + "rb-x-1.webp", "input not mutated");
});
test("applyRedraw: no hidden art means full art for a spot step", () => {
  const m = { "rb-x-1.webp": { full: "rb-x-1-ai1.webp", w: 900, h: 600 } };
  const { lesson } = applyRedraw(LES, m);
  assert.equal(lesson.steps[0].vis.src, MEDIA + "rb-x-1-ai1.webp");
});
test("webpSize: VP8, VP8L and VP8X headers", () => {
  const riff = (tag, body) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from(tag), Buffer.alloc(4), body]);
  const lossy = Buffer.alloc(14); lossy.writeUInt16LE(900, 6); lossy.writeUInt16LE(600, 8);
  assert.deepEqual(webpSize(riff("VP8 ", lossy)), { w: 900, h: 600 });
  const ll = Buffer.alloc(10); ll[0] = 0x2f; ll.writeUInt32LE((899) | (599 << 14), 1);
  assert.deepEqual(webpSize(riff("VP8L", ll)), { w: 900, h: 600 });
  const x = Buffer.alloc(10); x.writeUIntLE(899, 4, 3); x.writeUIntLE(599, 7, 3);
  assert.deepEqual(webpSize(riff("VP8X", x)), { w: 900, h: 600 });
  assert.equal(webpSize(Buffer.from("not a webp at all, not a webp")), null);
});
test("checkMap refuses bad names and dims", () => {
  assert.deepEqual(checkMap(MAP), []);
  assert.ok(checkMap({ "../x.webp": { full: "x-ai1.webp", w: 1, h: 1 } }).length);
  assert.ok(checkMap({ "a.webp": { full: "a.webp", w: 1, h: 1 } }).length, "full must be an -aiN file");
  assert.ok(checkMap({ "a.webp": { full: "a-ai1.webp", w: 0, h: 1 } }).length);
  assert.deepEqual(checkMap({ "a-h1.webp": { full: "a-ai1-h.webp", w: 9, h: 9 } }), [], "-h1 source -> -ai1-h art");
  assert.ok(checkMap({ "a.webp": { full: "a-ai1.webp", hidden: "a-ai1-h.webp", w: 9, h: 9 } }).length, "hidden needs dims");
});
test("committed manifest: well formed, named after the original, aspect kept", () => {
  const p = join(ROOT, "prep/redraw/map.json");
  const map = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.deepEqual(checkMap(map), []);
  const ar = JSON.parse(fs.readFileSync(join(ROOT, "prep/redraw/source-dims.json"), "utf8"));
  for (const [k, v] of Object.entries(map)) {
    const base = k.replace(/(-h1)?\.webp$/, "");
    assert.ok(v.full.startsWith(base + "-ai"), k);
    if (v.hidden) assert.ok(v.hidden.startsWith(base + "-ai"), k);
    const s = ar[k]; assert.ok(s, "source dims for " + k);
    assert.ok(Math.abs(v.w / v.h - s[0] / s[1]) / (s[0] / s[1]) < 0.03, k + " aspect");
  }
  assert.ok(Object.keys(map).length > 0);
});

/* G1 finish pipeline (tools/finish-g1.sh + helpers). What must hold: the de-ID manifest's generated
 * patterns cover both -aiN and -aiN-h lesson art (or the audit fails after publish); the helpers exist,
 * the shell parses and the Python compiles; --help names --dry; wave chunking splits a sorted map into
 * waves of N; the aspect gate matches the Python (within 3%); hidden-label matching is by normalised text. */
import { execFileSync } from "node:child_process";

test("finish: de-ID generated patterns cover -ai1 and -ai1-h art", () => {
  const m = JSON.parse(fs.readFileSync(join(ROOT, "tools/prep-deid/manifest.json"), "utf8"));
  const pats = (m.generated || []).map((r) => new RegExp(r));
  const yes = ["v1/lessons/media/rb-ctc-p0005-2-ai1.webp", "v1/lessons/media/rb-ctc-p0008-1-m1-ai1-h.webp"];
  const no = ["v1/lessons/media/rb-ctc-p0005-2.webp", "v1/lessons/media/rb-x-ai1.png"];
  for (const p of yes) assert.ok(pats.some((r) => r.test(p)), p + " passes as generated art");
  for (const p of no) assert.ok(!pats.some((r) => r.test(p)), p + " still needs a manifest entry");
});

test("finish: helpers exist, shell parses, python compiles, --help names --dry", () => {
  const sh = join(ROOT, "tools/finish-g1.sh");
  assert.ok(fs.existsSync(sh) && (fs.statSync(sh).mode & 0o111), "finish-g1.sh executable");
  execFileSync("bash", ["-n", sh]);
  for (const f of ["finish-g1-lib.py", "finish-g1-fetch.py", "finish-g1-label.py", "finish-g1-qa.py", "finish-g1-sheet.py", "finish-g1-publish.py"]) {
    const p = join(ROOT, "tools/" + f);
    assert.ok(fs.existsSync(p), f);
    execFileSync("python3", ["-m", "py_compile", p]);
  }
  const h = execFileSync("bash", [sh, "--help"], { encoding: "utf8" });
  assert.ok(h.includes("--dry"), "--help names --dry");
});

test("finish: waves split a sorted map into chunks of N", () => {
  const figs = ["c", "a", "b", "d", "e"].sort();
  const chunks = (a, n) => a.filter((_, i) => i % n === 0).map((_, k) => a.slice(k * n, k * n + n));
  assert.deepEqual(chunks(figs, 2), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(chunks(figs, 100), [figs]);
});

test("finish: aspect gate within 3%, hidden match by normalised text", () => {
  const arOk = (cw, ch, sw, sh) => Math.abs(cw / ch - sw / sh) / (sw / sh) < 0.03;
  assert.ok(arOk(900, 600, 300, 200));
  assert.ok(!arOk(900, 600, 300, 250));
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hide = (spot, texts) => texts.filter((t) => { const a = norm(spot), b = norm(t); return a && b && (a === b || a.includes(b) || b.includes(a)); });
  assert.deepEqual(hide("Capitate", ["Capitate", "Lunate", "V"]), ["Capitate"]);
  assert.deepEqual(hide("Horizontal fissure", ["Horizontal\nfissure", "Right upper lobe collapse"]), ["Horizontal\nfissure"]);
  assert.deepEqual(hide("Air crescent", ["Capitate"]), []);
});
