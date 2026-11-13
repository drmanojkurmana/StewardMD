// RadioAnatome Immersive CT — pure helpers + the data contract the view depends on.
// Run: node test/atlas-imm.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas3d.js"), "utf8");
const mod = { exports: {} };
new Function("window", "document", "module", SRC)({ addEventListener() {} }, undefined, mod);
const P = mod.exports;
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

ok("immersive helpers exported", ["immShownX", "immNearestPin", "immNearestSlice", "immPlaceLabels", "immWindowUrl", "immRegionSlices"].every((k) => typeof P[k] === "function"));

// --- whole-body region chips jump to the middle of their anchor's run of slices ---
const RS = [{ i: 1, pins: [{ s: "brain" }] }, { i: 2, pins: [{ s: "brain" }] }, { i: 3, pins: [{ s: "brain" }, { s: "heart" }] }, { i: 4, pins: [{ s: "heart" }] }, { i: 5, pins: [] }];
const regs = P.immRegionSlices(RS, [["head", "Head", "brain"], ["chest", "Chest", "heart"], ["pelvis", "Pelvis", "urinary-bladder"]]);
ok("immRegionSlices: middle of each run, absent anchors dropped", JSON.stringify(regs) === JSON.stringify([{ id: "head", label: "Head", i: 2 }, { id: "chest", label: "Chest", i: 3 }]));

// --- native geometry fallback: R2 first, then the committed copy on the API host ---
const modN = { exports: {} };
new Function("window", "document", "module", SRC)({ addEventListener() {}, SMD_IS_NATIVE: true, localStorage: { getItem() { return null; } } }, undefined, modN);
const nb = modN.exports.dataBases();
ok("native: R2 first, the API host's committed copy last (new bodies load before an R2 upload)", nb.join() === "https://models.stewardmd.in/atlas3d,https://stewardmd.in/atlas/3d");
ok("native fallback maps chunk paths onto the API host", modN.exports.dataUrl("/atlas/3d/body-skeletal-10.01c457d3.bin.gz", nb[1]) === "https://stewardmd.in/atlas/3d/body-skeletal-10.01c457d3.bin.gz");

// --- display flip is its own inverse (a tap on the mirrored image maps back to the stored pin) ---
ok("immShownX mirrors only when flipped", P.immShownX(30, true) === 70 && P.immShownX(30, false) === 30);
ok("immShownX twice is the identity", P.immShownX(P.immShownX(12.5, true), true) === 12.5);

// --- nearest pin, measured in pixels of the real box (not raw percent) ---
const pins = [{ s: "liver", x: 30, y: 50 }, { s: "spleen", x: 70, y: 50 }, { s: "aorta", x: 50, y: 60 }];
ok("tap on a pin returns it", P.immNearestPin(pins, 30, 50, 400, 300, 40).s === "liver");
ok("tap between pins returns the nearer one", P.immNearestPin(pins, 46, 58, 400, 300, 40).s === "aorta");
ok("tap far from every pin returns null", P.immNearestPin(pins, 5, 5, 400, 300, 40) === null);
// 10% of a 400 px wide box is 40 px; 10% of a 300 px tall box is 30 px: the same percent is not the same distance
ok("distance uses box pixels: 9% across a 400 px box (36 px) is in", P.immNearestPin([{ s: "a", x: 59, y: 0 }], 50, 0, 400, 300, 40) !== null);
ok("distance uses box pixels: 11% across a 400 px box (44 px) is out", P.immNearestPin([{ s: "a", x: 61, y: 0 }], 50, 0, 400, 300, 40) === null);
ok("no pins, no hit", P.immNearestPin([], 50, 50, 400, 300, 40) === null && P.immNearestPin(null, 50, 50, 400, 300, 40) === null);

// --- nearest slice that pins a structure ---
const slices = [{ i: 1, pins: [{ s: "liver" }] }, { i: 2, pins: [] }, { i: 3, pins: [{ s: "small-bowel" }] }, { i: 9, pins: [{ s: "small-bowel" }] }];
ok("nearest slice with the structure, by canonical id", P.immNearestSlice(slices, "SMALL_BOWEL", 7) === 9 && P.immNearestSlice(slices, "SMALL_BOWEL", 4) === 3);
ok("a structure on no slice gives null", P.immNearestSlice(slices, "PROSTATE", 2) === null);

// --- labels never overlap, never leave the box ---
const items = [{ x: 100, y: 100, w: 80, h: 20 }, { x: 110, y: 104, w: 80, h: 20 }, { x: 300, y: 100, w: 80, h: 20 }, { x: 5, y: 60, w: 80, h: 20 }];
const kept = P.immPlaceLabels(items, 320, 240);
ok("overlapping second label is dropped", kept.indexOf(0) >= 0 && kept.indexOf(1) < 0);
ok("labels are clamped inside the box", kept.every((i) => items[i].l >= 0 && items[i].l + items[i].w <= 320 && items[i].t >= 0));
const boxes = kept.map((i) => [items[i].l, items[i].t, items[i].l + items[i].w, items[i].t + items[i].h]);
ok("kept labels do not overlap", boxes.every((a, i) => boxes.every((b, j) => i === j || !(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]))));

// --- windowed image paths match atlas.js windowUrl ---
ok("window url beside the slice", P.immWindowUrl("/atlas/m/v2/021.webp", "lung") === "/atlas/m/v2/w/lung/021.webp");
ok("no window = the slice itself", P.immWindowUrl("/atlas/m/v2/021.webp", null) === "/atlas/m/v2/021.webp");

// --- data contract: the view pairs this CT stack with the living body's registered planes ---
const MOD = "ct-live-torso-axial";
const atlas = json(`atlas/${MOD}/atlas.json`), man = json("atlas/3d/manifest.json"), mods = json("atlas/modules.json");
const meta = (mods.modules || mods).find((m) => m.id === MOD);
ok("module meta present with windows, flipX and orient letters", !!meta && meta.windows.length === 3 && meta.flipX === true && meta.orient.left === "R" && meta.orient.right === "L");
ok("one registered axial plane per CT slice", Object.keys(man.planes[MOD]).length === atlas.slices.length && atlas.slices.every((s) => man.planes[MOD][String(s.i)] && man.planes[MOD][String(s.i)].axis === "y"));
ok("slice i sits at array index i-1 (immSlice relies on it)", atlas.slices.every((s, k) => s.i === k + 1));
ok("each plane textures exactly its slice's image", atlas.slices.every((s) => man.planes[MOD][String(s.i)].img === s.img));
ok("planes descend: slice 1 is the most superior (+y up), so 'above the slice' is +y", atlas.slices.every((s, k) => k === 0 || man.planes[MOD][String(s.i)].pos < man.planes[MOD][String(s.i - 1)].pos));
const pinned = new Set(); atlas.slices.forEach((s) => s.pins.forEach((p) => pinned.add(p.s)));
const noLive = [...pinned].filter((s) => { const e = man.canon[P.canonicalOf(s)]; return !e || !(e.live && e.live.length); });
ok("every pinned CT structure has a living-CT surface to highlight (missing: " + noLive.join(", ") + ")", noLive.length === 0);
const noDef = [...pinned].filter((s) => !(atlas.structures[s] && atlas.structures[s].name && atlas.structures[s].category && atlas.categories[atlas.structures[s].category]));
ok("every pinned structure has a name and a category colour (missing: " + noDef.join(", ") + ")", noDef.length === 0);
// --- the whole body (default Immersive module) pairs with the "body" 3D source the same way ---
const BMOD = "ct-live-body-axial", batlas = json(`atlas/${BMOD}/atlas.json`), bmeta = (mods.modules || mods).find((m) => m.id === BMOD);
ok("whole body: 96 axial slices, one registered plane each, textured with its own image", batlas.slices.length === 96 && batlas.slices.every((s, k) => s.i === k + 1 && man.planes[BMOD][String(s.i)] && man.planes[BMOD][String(s.i)].img === s.img && man.planes[BMOD][String(s.i)].axis === "y"));
ok("whole body: planes descend from the vertex (slice 1 most superior)", batlas.slices.every((s, k) => k === 0 || man.planes[BMOD][String(s.i)].pos < man.planes[BMOD][String(s.i - 1)].pos));
ok("whole body: radiological display like the torso (flipX, R/L, A/P)", bmeta.flipX === true && bmeta.orient.left === "R" && bmeta.orient.top === "A" && bmeta.windows.length === 3);
const bpinned = new Set(); batlas.slices.forEach((s) => s.pins.forEach((p) => bpinned.add(p.s)));
const bNoBody = [...bpinned].filter((s) => { const e = man.canon[P.canonicalOf(s)]; return !e || !(e.body && e.body.length); });
ok("every pinned whole-body structure has a whole-body surface to highlight (missing: " + bNoBody.join(", ") + ")", bNoBody.length === 0);
const bRegions = P.immRegionSlices(batlas.slices, [["head", "Head", "brain"], ["neck", "Neck", "thyroid-gland"], ["chest", "Chest", "heart"], ["abdomen", "Abdomen", "kidney"], ["pelvis", "Pelvis", "urinary-bladder"]]);
ok("whole body: all five regions found, head to pelvis in slice order", bRegions.map((r) => r.id).join() === "head,neck,chest,abdomen,pelvis" && bRegions.every((r, k) => !k || r.i > bRegions[k - 1].i));
// the windowed images the view switches to must exist for every slice
import("node:fs").then(({ existsSync }) => {
  const missing = [];
  [[meta, atlas], [bmeta, batlas]].forEach(([mt, at]) => mt.windows.slice(1).forEach((w) => at.slices.forEach((s) => { const f = join(ROOT, P.immWindowUrl(s.img, w.id)); if (!existsSync(f)) missing.push(f); })));
  ok("every slice has every windowed image (" + missing.length + " missing)", missing.length === 0);

  // --- the entry points exist and the www bundle carries what the view reads ---
  const atlasJs = readFileSync(join(ROOT, "atlas.js"), "utf8"), build = readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8");
  ok("catalog card gated on both flags", /function immersive\(\) \{ return threeD\(\) && /.test(atlasJs) && /data-atlas-act="imm"/.test(atlasJs));
  ok("flag defaults ON with a per-device kill switch", /IMM_KEY = "smd_atlas_imm", IMM_QUERY = "immersive", IMM_DEFAULT_ON = true/.test(SRC));
  ok("build-www ships modules.json and every module atlas.json (read natively)", /cp atlas\/modules\.json/.test(build) && /cp "\$d\/atlas\.json"/.test(build));

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
