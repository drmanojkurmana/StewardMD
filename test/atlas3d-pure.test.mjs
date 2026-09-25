// RadioAnatome 3D layer — pure helpers (no WebGL, no DOM).
// Run: node test/atlas3d-pure.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas3d.js"), "utf8");
const mod = { exports: {} };
new Function("window", "document", "module", SRC)({ addEventListener() {} }, undefined, mod);
const P = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

ok("exports present", ["canonicalOf", "parseManifest", "search", "unionBounds", "fitDistance", "encodePick", "decodePick", "canonOfPart", "linksFor", "regionParts", "perspective", "lookAt", "mul", "eyeFrom"].every((k) => typeof P[k] === "function"));

ok("canonicalOf matches ontology.py canonical()", P.canonicalOf("small-bowel") === "SMALL_BOWEL" && P.canonicalOf("kidney") === "KIDNEY" && P.canonicalOf(null) === "");

// --- a tiny manifest ---
const m = {
  systems: [{ id: "skeletal", name: "Skeleton", color: "#e2d9ba", desc: "bones" }, { id: "urinary", name: "Urinary", color: "#b47961", desc: "kidneys" }],
  regions: ["HEAD", "ABDOMEN"],
  chunks: [{ id: "skeletal-0", url: "/atlas/3d/skeletal-0.bin.gz", system: "skeletal", bytes: 10 }],
  parts: [
    ["FJ1", "Left kidney", "FMA7205", 1, 1, 0, 0, 30, [-0.1, 1.0, -0.05, -0.02, 1.12, 0.03], "KIDNEY"],
    ["FJ2", "Right kidney", "FMA7204", 1, 1, 0, 30, 30, [0.02, 1.0, -0.05, 0.1, 1.12, 0.03], "KIDNEY"],
    ["FJ3", "Frontal bone", "FMA52734", 0, 0, 0, 60, 9, [-0.07, 1.6, -0.02, 0.07, 1.7, 0.1], null],
    ["FJ4", "Left renal artery", "FMA14751", 0, 1, 0, 69, 9, [-0.05, 1.05, 0, 0, 1.07, 0.02], null],
  ],
  concepts: [["FMA7203", "kidney", [0, 1]], ["FMA46565", "skull", [2]], ["FMA14751", "left renal artery", [3]]],
  canon: { KIDNEY: { kind: "concept", fma: "FMA7203", name: "Kidney", parts: [0, 1], left: { fma: "FMA7205", parts: [0] }, right: { fma: "FMA7204", parts: [1] } } },
  links: { KIDNEY: [{ m: "ct-live-torso-axial", s: "kidney", i: 12, mod: "CT", t: "Torso - CT · Axial" }] },
  explain: { kidney: "filters blood" },
};
const d = P.parseManifest(m);
ok("parseManifest expands compact part rows", d.parts.length === 4 && d.parts[0].name === "Left kidney" && d.parts[0].canon === "KIDNEY" && d.parts[2].canon === null);
ok("parseManifest indexes concepts per part", d.conceptsOfPart[0].length === 1 && d.conceptsOfPart[0][0].id === "FMA7203");
ok("parseManifest maps FMA ids (incl. laterality) back to canonical ids", d.fmaToCanon.FMA7203 === "KIDNEY" && d.fmaToCanon.FMA7205 === "KIDNEY");
ok("parseManifest tolerates a missing canon/links block", P.parseManifest({ parts: [], concepts: [] }).parts.length === 0);

// --- search ---
const hits = P.search("kidney", d, 10);
ok("search: the RadioAnatome structure (CT/MRI) ranks first, then the FMA concept, then meshes", hits[0].type === "canon" && hits[0].cid === "KIDNEY" && hits[1].type === "concept" && hits[1].id === "FMA7203");
ok("search: both kidney meshes returned", hits.filter((h) => h.type === "part").length === 2);
ok("search: word-start beats substring", P.search("renal", d, 10)[0].name === "left renal artery" || P.search("renal", d, 10)[0].name === "Left renal artery");
ok("search: one character returns nothing", P.search("k", d, 10).length === 0);
ok("search: respects limit", P.search("kidney", d, 1).length === 1);
ok("search: unknown query is empty", P.search("zzzz", d, 10).length === 0);

// --- bounds / camera ---
const b = P.unionBounds(d, [0, 1]);
ok("unionBounds spans both kidneys", near(b[0], -0.1) && near(b[3], 0.1) && near(b[1], 1.0) && near(b[4], 1.12));
ok("unionBounds of nothing is null", P.unionBounds(d, []) === null);
const dist = P.fitDistance(b, 34, 1);
ok("fitDistance is positive and grows with the box", dist > 0 && P.fitDistance([-1, -1, -1, 1, 1, 1], 34, 1) > dist);
ok("fitDistance is larger for a portrait aspect (narrower horizontal fov)", P.fitDistance(b, 34, 0.5) > P.fitDistance(b, 34, 1.5));

// --- pick encoding round trip ---
let round = true;
for (let i = 0; i < 4096; i++) { const c = P.encodePick(i); if (P.decodePick(c[0], c[1], c[2]) !== i) round = false; }
ok("pick colour encodes 4,096 part indices losslessly", round);
ok("background (black) decodes to -1", P.decodePick(0, 0, 0) === -1);

// --- canonical lookups ---
ok("canonOfPart: direct", P.canonOfPart(d, 0) === "KIDNEY");
ok("canonOfPart: via concept membership", P.canonOfPart({ ...d, parts: d.parts.map((p) => ({ ...p, canon: null })) }, 1) === "KIDNEY");
ok("canonOfPart: none", P.canonOfPart(d, 2) === null);
ok("linksFor returns CT rows for KIDNEY and [] otherwise", P.linksFor(d, "KIDNEY").length === 1 && P.linksFor(d, "SKULL").length === 0 && P.linksFor(d, null).length === 0);
ok("regionParts filters by region and null for 'all'", P.regionParts(d, "ABDOMEN").length === 3 && P.regionParts(d, "") === null && P.regionParts(d, "NOPE") === null);

// --- matrices ---
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const persp = P.perspective(34, 1.5, 0.1, 100);
ok("mul by identity is identity", P.mul(persp, I).every((v, i) => near(v, persp[i])));
const view = P.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
ok("lookAt moves the eye to the origin", near(view[14], -5) && near(view[12], 0) && near(view[13], 0));
const eye = P.eyeFrom({ target: [0, 1, 0], yaw: 0, pitch: 0, dist: 2 });
ok("eyeFrom: yaw 0 pitch 0 sits on +z at the target height", near(eye[0], 0) && near(eye[1], 1) && near(eye[2], 2));

// --- chunk validation: an HTML fallback page must never reach DecompressionStream ---
const gz = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]).buffer;
ok("gzip magic is accepted", P.looksLikeChunk(gz, 999));
ok("already-decoded body of the exact raw size is accepted", P.looksLikeChunk(new ArrayBuffer(40), 40));
ok("an HTML fallback page is rejected", P.looksLikeChunk(new TextEncoder().encode("<!doctype html><html>").buffer, 40) === false);
ok("empty body is rejected", P.looksLikeChunk(new ArrayBuffer(0), 0) === false);
const bases = P.dataBases();
ok("web: same-origin first, R2 models host last", bases[0] === "" && bases[bases.length - 1] === "https://models.stewardmd.in/atlas3d");
ok("dataUrl maps the /atlas/3d path onto the R2 key prefix", P.dataUrl("/atlas/3d/skeletal-0.bin.gz", "https://models.stewardmd.in/atlas3d") === "https://models.stewardmd.in/atlas3d/skeletal-0.bin.gz" && P.dataUrl("/atlas/3d/x.bin.gz", "") === "/atlas/3d/x.bin.gz");
const m2 = P.parseManifest({ parts: [["LIVE_liver", "Liver", "FMA7197", 0, 1, 0, 0, 3, [0, 0, 0, 1, 1, 1], "LIVER", 1, null]], concepts: [], sources: [{ id: "bp3d" }, { id: "live" }], planes: { "ct-live-torso-axial": { "5": { axis: "y", pos: 0.9 } } } });
ok("parseManifest reads the source flag, sources and planes", m2.parts[0].src === 1 && m2.sources.length === 2 && m2.planes["ct-live-torso-axial"]["5"].axis === "y");

// --- premium controls ---
ok("ghostAlpha: untouched X-ray keeps today's view (16% ghost with a selection, opaque without)", P.ghostAlpha(true, null) === 0.16 && P.ghostAlpha(false, null) === 1 && P.ghostAlpha(false, undefined) === 1);
ok("ghostAlpha: the slider value wins and is clamped to [0.04, 1]", P.ghostAlpha(true, 0.5) === 0.5 && P.ghostAlpha(false, 0) === 0.04 && P.ghostAlpha(true, 7) === 1);

const box = [-1, 0, -2, 1, 2, 2];
const cutAt = (pl, p) => p[0] * pl[0] + p[1] * pl[1] + p[2] * pl[2] > pl[3];   // the shader's discard test
const ax = P.freeClip("y", 0.5, false, box);
ok("freeClip axial at 50% sits at mid height and removes the upper half", ax[1] === 1 && near(ax[3], 1) && cutAt(ax, [0, 1.5, 0]) && !cutAt(ax, [0, 0.5, 0]));
const axf = P.freeClip("y", 0.5, true, box);
ok("freeClip flip keeps the other half", cutAt(axf, [0, 0.5, 0]) && !cutAt(axf, [0, 1.5, 0]));
const cor = P.freeClip("z", 0.25, false, box), sag = P.freeClip("x", 1, false, box);
ok("freeClip coronal cuts along z (anterior removed), sagittal along x", cor[2] === 1 && near(cor[3], -1) && cutAt(cor, [0, 1, 0]) && sag[0] === 1 && near(sag[3], 1) && !cutAt(sag, [0.99, 1, 0]));
ok("freeClip clamps t and returns null without bounds", near(P.freeClip("y", 5, false, box)[3], 2) && P.freeClip("y", 0.5, false, null) === null);

const hs = { hidden: { 3: true }, faded: { 4: 1 }, isolate: true, bowel: false };
const snap = P.layerSnap(hs);
hs.hidden[9] = true; hs.faded = {};
ok("layerSnap copies hidden/faded so later edits do not leak into history", !snap.hidden[9] && snap.faded[4] === 1 && snap.isolate === true && snap.bowel === false);
const stack = [];
for (let i = 0; i < 35; i++) P.pushHist(stack, { i }, 30);
ok("pushHist keeps the newest 30 and pops newest first", stack.length === 30 && stack[0].i === 5 && stack.pop().i === 34);

const pl0 = P.progressLabel(0, 0), pl1 = P.progressLabel(5 * 1048576, 20 * 1048576), pl2 = P.progressLabel(30, 20);
ok("progressLabel reports bytes and percent", pl0.pct === 0 && pl1.pct === 25 && /25%/.test(pl1.text) && /5\.0 of 20\.0 MB/.test(pl1.text) && pl2.pct === 100);
ok("progressLabel has no em dash or ellipsis", !/[—–…]/.test(pl1.text));

// saved views round trip through part ids
const vd = P.parseManifest({ ...m, sources: [{ id: "bp3d" }, { id: "live" }], planes: { "ct-live-torso-axial": { "5": { axis: "y", pos: 0.9 } } } });
const vs = { src: "bp3d", cam: { target: [0.1, 0.9, 0], yaw: 1.2, pitch: 0.3, dist: 1.5 }, sel: [0, 1], subject: { kind: "canon", cid: "KIDNEY" },
  hidden: { 2: true }, faded: { 3: 1 }, isolate: true, clip: { axis: "z", t: 0.3, flip: true }, xray: 0.4, region: "ABDOMEN", explodeTarget: 0.2, bowel: false, shell: true, plane: { m: "ct-live-torso-axial", i: 5 } };
const ser = P.serializeView(vs, vd, "  Kidneys from behind  ");
ok("serializeView stores part ids, not indices, and trims the name", ser.name === "Kidneys from behind" && ser.sel.join() === "FJ1,FJ2" && ser.hidden.join() === "FJ3" && ser.faded.join() === "FJ4" && ser.subject.cid === "KIDNEY");
const json = JSON.parse(JSON.stringify(ser));
const back = P.restoreView(json, vd);
ok("restoreView round-trips camera, selection, hidden, faded, isolate, clip, x-ray, region, plane",
  back.src === "bp3d" && near(back.cam.yaw, 1.2) && near(back.cam.dist, 1.5) && back.cam.target[0] === 0.1 && back.sel.join() === "0,1" && back.hidden[2] === 1 && back.faded[3] === 1 &&
  back.isolate === true && back.clip.axis === "z" && near(back.clip.t, 0.3) && back.clip.flip === true && near(back.xray, 0.4) && back.region === "ABDOMEN" && near(back.explode, 0.2) && back.plane.i === 5 && back.subject.cid === "KIDNEY");
const shuffled = P.parseManifest({ ...m, parts: [m.parts[3], m.parts[2], m.parts[1], m.parts[0]] });
ok("a saved view survives a manifest that re-orders parts", P.restoreView(json, shuffled).sel.sort().join() === "2,3");
ok("restoreView drops unknown parts, bad axes, unknown sources and planes; rejects junk", (() => {
  const r = P.restoreView({ ...json, sel: ["NOPE"], hidden: ["FJ3", "GONE"], clip: { axis: "q" }, src: "mars", plane: { m: "x", i: 1 }, cam: { ...json.cam, dist: 999, pitch: 9 } }, vd);
  return r.sel.length === 0 && r.subject === null && r.isolate === false && Object.keys(r.hidden).join() === "2" && r.clip === null && r.src === "bp3d" && r.plane === null && r.cam.dist === 12 && r.cam.pitch === 1.45 &&
    P.restoreView(null, vd) === null && P.restoreView({ v: 2 }, vd) === null && P.restoreView({ v: 1, cam: {} }, vd) === null;
})());

// quiz pool: unique names, whole structures only, all meshes on screen
const qd = P.parseManifest({ ...m, canon: {
  KIDNEY: { kind: "concept", name: "Kidney", parts: [0, 1], coverage: "full", live: [3] },
  BRAIN: { kind: "concept", name: "Brain", parts: [2], coverage: "partial" },
  LIVER: { kind: "related", name: "Liver", related: [3] },
  A: { kind: "concept", name: "Twin", parts: [2], coverage: "full" }, B: { kind: "composite", name: "twin", parts: [3], coverage: "full" },
  SKULL: { kind: "concept", name: "Skull", parts: [2], coverage: "full" }, VD: { kind: "composite", name: "Ventral (composite)", parts: [2], coverage: "full" },
  CHEST: { kind: "region", name: "Chest" } } });
ok("quizPool keeps unique, whole, fully visible structures only", P.quizPool(qd, 0, () => true).join() === "KIDNEY,SKULL");
ok("quizPool drops a structure with any mesh off screen", P.quizPool(qd, 0, (i) => i !== 1).join() === "SKULL");
ok("quizPool on the living body asks from the live surfaces (a partial reference mesh is fine there)", P.quizPool(qd, 1, () => true).join() === "KIDNEY");
ok("fileSlug makes a safe filename part", P.fileSlug("Left kidney (FMA7205)") === "left-kidney-fma7205" && P.fileSlug("") === "view");

// CC BY credit burned into exported images, per body, from the real manifest + live.json
const BP3D = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";
const realM = JSON.parse(readFileSync(join(ROOT, "atlas/3d/manifest.json"), "utf8"));
const liveSrc = JSON.parse(readFileSync(join(ROOT, "atlas/3d/live.json"), "utf8")).source;
const realD = P.parseManifest(realM);
ok("creditLine: reference body is the licence-mandated string, verbatim", P.creditLine(realD, "bp3d") === BP3D);
ok("creditLine: reference falls back to the verbatim string when the manifest has no source", P.creditLine(P.parseManifest({ parts: [], concepts: [] }), "bp3d") === BP3D);
const liveLine = P.creditLine(realD, "live");
ok("creditLine: living CT is built from live.json (dataset, licence, doi): " + liveLine,
  liveLine === `${liveSrc.dataset}, ${liveSrc.licence}, doi:${liveSrc.doi}` && /TotalSegmentator/.test(liveLine) && /CC BY 4\.0/.test(liveLine) && /10\.5281\/zenodo\.10047292/.test(liveLine));
ok("credit lines carry no em dash", !/[—–]/.test(P.creditLine(realD, "bp3d") + liveLine));
const mono = (s) => s.length * 6;
const wl = P.wrapLines(BP3D, 300, mono);
ok("wrapLines keeps every word, in order, within the width", wl.join(" ") === BP3D && wl.length > 1 && wl.every((l) => mono(l) <= 300 || !/ /.test(l)));
ok("wrapLines: short text is one line, empty is none", P.wrapLines("a b", 300, mono).length === 1 && P.wrapLines("", 300, mono).length === 0);

console.log(`atlas3d-pure: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
