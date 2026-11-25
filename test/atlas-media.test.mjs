// RadioAnatome on the media host — the reader builds media.stewardmd.in URLs (owner 2026-11-17).
// atlas/ (~5,200 files) moved off Pages to the stewardmd-public-media bucket
// (tools/atlas-media-sync.mjs, scripts/pages-build.sh excludes atlas/); atlas.js and
// atlas3d.js resolve /atlas/ paths through one media base with a fallback to the old
// relative path (kill switch: window.SMD_ATLAS_MEDIA = "").
// Run: node test/atlas-media.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

const load = (file, win) => {
  const mod = { exports: {} };
  const src = readFileSync(join(ROOT, file), "utf8");
  new Function("window", "document", "module", src)(Object.assign({ addEventListener() {} }, win || {}), undefined, mod);
  return mod.exports;
};

const A = load("atlas.js");
ok("atlas.js exports the media helpers", ["mediaBase", "mediaUrl", "mediaRel", "netUrl"].every((k) => typeof A[k] === "function"));
ok("mediaUrl maps a slice onto the media host", A.mediaUrl("/atlas/brain-mri-axial-t1/001.webp") === "https://media.stewardmd.in/atlas/brain-mri-axial-t1/001.webp");
ok("mediaUrl maps a windowed variant", A.mediaUrl("/atlas/ct-head-axial/w/bone/001.webp") === "https://media.stewardmd.in/atlas/ct-head-axial/w/bone/001.webp");
ok("mediaUrl maps atlas JSON too", A.mediaUrl("/atlas/modules.json") === "https://media.stewardmd.in/atlas/modules.json");
ok("mediaUrl leaves non-atlas paths alone", A.mediaUrl("/api/x") === "/api/x" && A.mediaUrl("") === "");
ok("mediaRel round-trips a media URL to the old relative path", A.mediaRel("https://media.stewardmd.in/atlas/brain-mri-axial-t1/001.webp") === "/atlas/brain-mri-axial-t1/001.webp");
ok("netUrl sends slice images to the media host on every host", A.netUrl("/atlas/ct-head-axial/001.webp") === "https://media.stewardmd.in/atlas/ct-head-axial/001.webp");
ok("netUrl sends JSON to the media host too (fetchJson/one() fall back to the bundle)", A.netUrl("/atlas/modules.json") === "https://media.stewardmd.in/atlas/modules.json");

const Aoff = load("atlas.js", { SMD_ATLAS_MEDIA: "" });
ok("kill switch: media disabled falls back to the old relative path", Aoff.mediaUrl("/atlas/modules.json") === "/atlas/modules.json" && Aoff.netUrl("/atlas/ct-head-axial/001.webp") === "/atlas/ct-head-axial/001.webp");

const T = load("atlas3d.js");
ok("atlas3d.js exports the media helpers", ["mediaBase", "mediaUrl", "imgUrl", "dataBases", "dataUrl"].every((k) => typeof T[k] === "function"));
ok("3d slice images resolve to the media host", T.imgUrl("/atlas/ct-live-body-axial/001.webp") === "https://media.stewardmd.in/atlas/ct-live-body-axial/001.webp");
ok("web chunk bases end at the media host", T.dataBases().join() === ",https://models.stewardmd.in/atlas3d,https://media.stewardmd.in/atlas/3d");
ok("dataUrl maps a chunk onto the media host", T.dataUrl("/atlas/3d/skeletal-0.bin.gz", "https://media.stewardmd.in/atlas/3d") === "https://media.stewardmd.in/atlas/3d/skeletal-0.bin.gz");

const Tn = load("atlas3d.js", { SMD_IS_NATIVE: true, localStorage: { getItem() { return null; } } });
ok("native chunk bases: models first, media last", Tn.dataBases().join() === "https://models.stewardmd.in/atlas3d,https://media.stewardmd.in/atlas/3d");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
