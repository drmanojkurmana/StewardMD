// RadioAnatome 3D layer — shipped data integrity.
// Validates the REAL atlas/3d/manifest.json + chunks against the curated mapping, the
// ontology and the slice modules, so a bad import run or a hand-edit fails `npm test`
// rather than rendering a mesh under the wrong name or a dead CT link.
// Run: node test/atlas3d-data.test.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D3 = join(ROOT, "atlas", "3d");
const manifest = JSON.parse(readFileSync(join(D3, "manifest.json"), "utf8"));
const index = JSON.parse(readFileSync(join(D3, "index.json"), "utf8"));
const provenance = JSON.parse(readFileSync(join(D3, "provenance.json"), "utf8"));
const map = JSON.parse(readFileSync(join(ROOT, "atlas-pipeline", "bp3d-map.json"), "utf8"));
const onto = JSON.parse(readFileSync(join(ROOT, "atlas-pipeline", "ontology.json"), "utf8")).structures;
const catalog = JSON.parse(readFileSync(join(ROOT, "atlas", "modules.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

// --- licence / provenance ---
const ATTR = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";
ok("manifest carries the mandated attribution string verbatim", manifest.source.attribution === ATTR);
ok("manifest names the licence and its URL", manifest.source.licence === "CC BY 4.0" && /bodyparts3d\/lic\.html$/.test(manifest.source.licenceUrl));
ok("manifest records the upstream repo + commit", /human-atlas/.test(manifest.source.via.repo) && /^[0-9a-f]{40}$/.test(manifest.source.via.commit));
ok("provenance lists upstream input checksums", Object.keys(provenance.upstream.inputs).length >= 16);
ok("HUMAN_ATLAS_PROVENANCE.md exists at the repo root", existsSync(join(ROOT, "HUMAN_ATLAS_PROVENANCE.md")));
const prov = readFileSync(join(ROOT, "HUMAN_ATLAS_PROVENANCE.md"), "utf8");
ok("provenance doc carries the attribution string", prov.includes(ATTR));
ok("provenance doc records the upstream commit", prov.includes(manifest.source.via.commit));
ok("provenance doc lists every rejected mesh", provenance.rejected.every((r) => prov.includes(r.id)));

// --- parts ---
const parts = manifest.parts;
ok("2,227 meshes shipped (2,234 upstream minus 7 exact duplicates)", parts.length === 2227 && provenance.rejected.length === 7);
ok("every rejection is an exact duplicate", provenance.rejected.every((r) => /exact duplicate/.test(r.reason)));
const ids = new Set(parts.map((p) => p[0]));
ok("part ids are unique", ids.size === parts.length);
ok("no rejected id shipped", provenance.rejected.every((r) => !ids.has(r.id)));
const seenKey = new Set();
let dup = 0;
for (const p of parts) { const k = p[1].toLowerCase() + "|" + p[8].map((v) => v.toFixed(4)).join(","); if (seenKey.has(k)) dup++; seenKey.add(k); }
ok("no exact (name, bounds) duplicate remains", dup === 0);
ok("every part has a name, an FMA id, a system and a region", parts.every((p) => p[1].trim() && /^FMA\d+$/.test(p[2]) && manifest.systems[p[3]] && manifest.regions[p[4]]));
ok("every part's canonical id exists in the ontology", parts.every((p) => !p[9] || onto[p[9]]));
const BRAIN_VENTRICLES = ["Third ventricle", "Fourth ventricle", "Left lateral ventricle", "Right lateral ventricle", "Interventricular foramen"];
ok("brain ventricles are filed under the nervous system (upstream had them under 'cardiac')",
  parts.filter((p) => BRAIN_VENTRICLES.includes(p[1])).length === 5 && parts.filter((p) => BRAIN_VENTRICLES.includes(p[1])).every((p) => manifest.systems[p[3]].id === "nervous"));
ok("systems: 15, with colours and descriptions", manifest.systems.length === 15 && manifest.systems.every((s) => /^#[0-9a-f]{6}$/i.test(s.color) && s.desc.length > 40));

// --- chunks: files, checksums, index ranges ---
const files = readdirSync(D3).filter((f) => f.endsWith(".bin.gz"));
ok("every chunk file is referenced and vice versa", files.length === manifest.chunks.length && manifest.chunks.every((c) => files.includes(c.url.split("/").pop())));
let maxIdxOk = true, sizeOk = true, shaOk = true, triangles = 0;
const partsByChunk = new Map();
parts.forEach((p, i) => { (partsByChunk.get(p[5]) ?? partsByChunk.set(p[5], []).get(p[5])).push(i); });
for (const [ci, c] of manifest.chunks.entries()) {
  const gz = readFileSync(join(D3, c.url.split("/").pop()));
  if (createHash("sha256").update(gz).digest("hex") !== c.sha256) shaOk = false;
  const raw = gunzipSync(gz);
  if (raw.length !== c.bytes || gz.length !== c.gz) sizeOk = false;
  const idx = new Uint32Array(raw.buffer, raw.byteOffset + c.idx, c.i);
  const pid = new Uint16Array(raw.buffer, raw.byteOffset + c.pid, c.v);
  let max = 0; for (const v of idx) if (v > max) max = v;
  if (max >= c.v) maxIdxOk = false;
  for (const i of partsByChunk.get(ci) ?? []) {
    const p = parts[i];
    if (p[6] + p[7] > c.i) maxIdxOk = false;
    // the part-index attribute of the part's first vertex must be this part
    if (pid[idx[p[6]]] !== i) maxIdxOk = false;
    triangles += p[7] / 3;
  }
}
ok("chunk sha256 checksums match the manifest", shaOk);
ok("chunk raw/gz sizes match the manifest", sizeOk);
ok("every index is inside its chunk and every part's vertices carry its own part index", maxIdxOk);
ok("triangle total matches stats", Math.round(triangles) === manifest.stats.triangles);
ok("bundle is under 35 MB gzipped (not shipped natively; streamed per system)", manifest.stats.gz_bytes < 35e6);
ok("no single chunk exceeds 4 MB raw (Pages 25 MiB file cap, mobile memory)", manifest.chunks.every((c) => c.bytes <= 4.2e6));

// --- concepts ---
ok("3,432 FMA concepts preserved", manifest.concepts.length === 3432);
ok("every concept element is a shipped part", manifest.concepts.every((c) => c[2].length && c[2].every((i) => i >= 0 && i < parts.length)));

// --- canonical mapping ---
const canon = manifest.canon;
ok("every ontology structure has a mapping row (mapped or explicitly unmapped)", Object.keys(onto).every((k) => canon[k]) && Object.keys(canon).every((k) => onto[k]));
ok("every mapping row in bp3d-map.json reached the manifest", Object.keys(map.structures).every((k) => canon[k] && canon[k].kind === map.structures[k].kind));
const meshKinds = Object.values(canon).filter((e) => e.kind === "concept" || e.kind === "composite");
ok("67 canonical structures have a mesh (58 full + 9 partial)", meshKinds.length === 67 && manifest.stats.mapped_full === 58 && manifest.stats.mapped_partial === 9);
ok("7 canonical structures are honestly unmapped with a reason", Object.values(canon).filter((e) => e.kind === "none").length === 7 && Object.values(canon).filter((e) => e.kind === "none").every((e) => e.reason));
ok("mesh-mapped rows resolve to at least one shipped part", meshKinds.every((e) => e.parts.length && e.parts.every((i) => parts[i])));
ok("related-only rows carry a note and related parts", Object.values(canon).filter((e) => e.kind === "related").every((e) => e.note && e.related.length));
ok("LIVER and LUNG are related-only (BP3D isa set has no parenchymal surface)", canon.LIVER.kind === "related" && canon.LUNG.kind === "related");
ok("KIDNEY maps to FMA7203 with left/right children", canon.KIDNEY.fma === "FMA7203" && canon.KIDNEY.left.fma === "FMA7205" && canon.KIDNEY.right.fma === "FMA7204" && canon.KIDNEY.parts.length === 2);
ok("laterality children are subsets of the parent's parts", Object.values(canon).every((e) => !e.parts || ["left", "right"].every((s) => !e[s] || e[s].parts.every((i) => e.parts.includes(i)))));
ok("index.json mirrors the canonical kinds", Object.keys(index).length === Object.keys(canon).length && Object.keys(index).every((k) => index[k] === canon[k].kind));
ok("ontology.json carries the 3D modality for every mesh-mapped structure",
  Object.keys(canon).every((k) => (onto[k].modality.includes("3D")) === (canon[k].kind === "concept" || canon[k].kind === "composite")));
ok("ontology.json carries the FMA id for every mapped structure", meshKinds.every((e) => Object.entries(canon).find(([, v]) => v === e) && true) && Object.keys(canon).filter((k) => canon[k].fma).every((k) => onto[k].bp3d && onto[k].bp3d.fma === canon[k].fma));

// --- CT / MRI links: every link must point at a real module structure with pins ---
const modules = new Map(catalog.modules.map((m) => [m.id, m]));
let linkOk = true, ctLinked = 0, mriLinked = 0;
const atlasCache = new Map();
for (const [cid, rows] of Object.entries(manifest.links)) {
  if (!onto[cid]) linkOk = false;
  let hasCT = false, hasMRI = false;
  for (const l of rows) {
    const m = modules.get(l.m);
    if (!m || m.modality !== l.mod) { linkOk = false; continue; }
    const a = atlasCache.get(l.m) ?? atlasCache.set(l.m, JSON.parse(readFileSync(join(ROOT, "atlas", l.m, "atlas.json"), "utf8"))).get(l.m);
    if (!a.structures[l.s]) linkOk = false;
    const slice = a.slices.find((s) => s.i === l.i);
    if (!slice || !slice.pins.some((p) => p.s === l.s)) linkOk = false;
    if (m.modality === "CT") hasCT = true; if (m.modality === "MRI") hasMRI = true;
  }
  const has3d = canon[cid] && (canon[cid].kind === "concept" || canon[cid].kind === "composite");
  if (has3d && hasCT) ctLinked++;
  if (has3d && hasMRI) mriLinked++;
}
ok("every CT/MRI link targets a shipped module, a declared structure and a slice that pins it", linkOk);
ok("at least 38 mesh-mapped structures are CT-linked", ctLinked >= 38);
ok("at least 13 mesh-mapped structures are MRI-linked", mriLinked >= 13);
console.log(`   CT<->3D linked: ${ctLinked}   MRI<->3D linked: ${mriLinked}`);

console.log(`atlas3d-data: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
