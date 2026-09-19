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

console.log(`atlas3d-pure: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
