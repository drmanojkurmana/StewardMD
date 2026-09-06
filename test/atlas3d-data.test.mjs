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
const ref = parts.filter((p) => !p[10]), live = parts.filter((p) => p[10] === 1), wb = parts.filter((p) => p[10] === 2);
ok("2,227 BodyParts3D meshes shipped (2,234 upstream minus 7 exact duplicates)", ref.length === 2227 && provenance.rejected.length === 7);
ok("66 living-CT surfaces appended after them (source flag 1): 38 organs/vessels/muscles, 27 bones, 1 body surface", live.length === 66 && parts.length === 2293 && live.every((p, k) => parts[2227 + k] === p));
ok("every living-CT part has a torso region and a side only where sided; all but the body surface and costal cartilages name a canonical structure", live.every((p) => ["CHEST", "ABDOMEN", "PELVIS", "SPINE", "BODY"].includes(manifest.regions[p[4]]) && (p[11] === null || p[11] === "left" || p[11] === "right")) && live.filter((p) => !p[9]).map((p) => p[1]).sort().join("|") === "Body surface (skin)|Costal cartilages" && live.filter((p) => p[9]).every((p) => onto[p[9]]));
ok("living skeleton: T10-L5 + S1 vertebrae, sacrum, lower ribs, hip bones, femurs on the bone canonicals", (() => { const sk = live.filter((p) => manifest.systems[p[3]].id === "skeletal"); const c = {}; sk.forEach((p) => { c[p[9] || "none"] = (c[p[9] || "none"] || 0) + 1; }); return sk.length === 27 && c.THORACIC_VERTEBRA === 3 && c.LUMBAR_VERTEBRA === 5 && c.SACRUM === 2 && c.RIB === 12 && c.HIP_BONE === 2 && c.FEMUR === 2 && c.none === 1; })());
ok("the body surface is one integumentary part spanning the whole scan", (() => { const s = live.filter((p) => manifest.systems[p[3]].id === "integumentary"); return s.length === 1 && manifest.regions[s[0][4]] === "BODY" && (s[0][8][4] - s[0][8][1]) > 0.4; })());
ok("sources: reference body + living CT", manifest.sources.length === 2 && manifest.sources[1].id === "live" && manifest.sources[1].modules.length === 3);
ok("every rejection is an exact duplicate", provenance.rejected.every((r) => /exact duplicate/.test(r.reason)));
const ids = new Set(parts.map((p) => p[0]));
ok("part ids are unique", ids.size === parts.length);
ok("no rejected id shipped", provenance.rejected.every((r) => !ids.has(r.id)));
const seenKey = new Set();
let dup = 0;
for (const p of parts) { const k = p[1].toLowerCase() + "|" + p[8].map((v) => v.toFixed(4)).join(","); if (seenKey.has(k)) dup++; seenKey.add(k); }
ok("no exact (name, bounds) duplicate remains", dup === 0);
ok("every part has a name, a system and a region; every BodyParts3D part an FMA id", parts.every((p) => p[1].trim() && manifest.systems[p[3]] && manifest.regions[p[4]]) && ref.every((p) => /^FMA\d+$/.test(p[2])));
ok("every part's canonical id exists in the ontology", parts.every((p) => !p[9] || onto[p[9]]));
const BRAIN_VENTRICLES = ["Third ventricle", "Fourth ventricle", "Left lateral ventricle", "Right lateral ventricle", "Interventricular foramen"];
ok("brain ventricles are filed under the nervous system (upstream had them under 'cardiac')",
  parts.filter((p) => BRAIN_VENTRICLES.includes(p[1])).length === 5 && parts.filter((p) => BRAIN_VENTRICLES.includes(p[1])).every((p) => manifest.systems[p[3]].id === "nervous"));
ok("systems: 15, with colours and descriptions", manifest.systems.length === 15 && manifest.systems.every((s) => /^#[0-9a-f]{6}$/i.test(s.color) && s.desc.length > 40));

// --- chunks: files, checksums, index ranges ---
const files = readdirSync(D3).filter((f) => f.endsWith(".bin.gz"));
const allChunks = manifest.chunks.concat(manifest.lod ? manifest.lod.chunks : []);
ok("every chunk file (full + LOD) is referenced and vice versa", files.length === allChunks.length && allChunks.every((c) => files.includes(c.url.split("/").pop())));
ok("LOD set: 20 reference-body chunks at ~60% of the triangles", manifest.lod && manifest.lod.chunks.length === 20 && manifest.lod.stats.triangles < manifest.stats.triangles * 0.7);
ok("living-CT chunks carry the source flag and never mix systems", manifest.chunks.filter((c) => c.src === 1).length === 13 && manifest.chunks.every((c) => c.system));
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
ok("each body streams within budget (living CT + whole body under 20 MB each, LOD under 25 MB, three bodies under 60 MB total) — streamed from R2 per source, never bundled", manifest.stats.gz_bytes < 60e6 && manifest.lod.stats.gz < 25e6 && manifest.live.stats.gz < 20e6);
// --- slice planes (living CT): every torso slice registered, on a monotonic line ---
const planes = manifest.planes;
ok("72 slice planes: 24 per living-torso module", Object.keys(planes).length === 3 && Object.values(planes).every((m) => Object.keys(m).length === 24));
ok("planes are monotonic along their axis and carry a textured quad frame", Object.values(planes).every((m) => { const ks = Object.keys(m).map(Number).sort((a, b) => a - b); const pos = ks.map((k) => m[k].pos); const inc = pos.every((v, i) => !i || v > pos[i - 1]), dec = pos.every((v, i) => !i || v < pos[i - 1]); return (inc || dec) && ks.every((k) => m[k].tl && m[k].u && m[k].v && ["x", "y", "z"].includes(m[k].axis)); }));
ok("living-CT parts sit inside the registered slab (axial plane range)", (() => { const ax = planes["ct-live-torso-axial"]; const ys = Object.values(ax).map((p) => p.pos); const lo = Math.min(...ys) - 0.05, hi = Math.max(...ys) + 0.05; return live.every((p) => p[8][1] >= lo && p[8][4] <= hi); })());
ok("bones and skin come from the same scan: bone canonicals now carry living surfaces", ["LUMBAR_VERTEBRA", "THORACIC_VERTEBRA", "SACRUM", "RIB", "HIP_BONE", "FEMUR"].every((k) => manifest.canon[k] && manifest.canon[k].live && manifest.canon[k].live.length));
ok("every CT link into a living-torso module carries a plane flag", Object.values(manifest.links).flat().filter((l) => planes[l.m]).every((l) => l.plane === 1));
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
  const has3d = canon[cid] && (canon[cid].kind === "concept" || canon[cid].kind === "composite" || (canon[cid].live && canon[cid].live.length));
  if (has3d && hasCT) ctLinked++;
  if (has3d && hasMRI) mriLinked++;
}
ok("every CT/MRI link targets a shipped module, a declared structure and a slice that pins it", linkOk);
ok("at least 43 mesh-mapped structures are CT-linked (living CT fills liver, lungs, heart)", ctLinked >= 43);
ok("LIVER, LUNG lobes and HEART now have living-CT surfaces", ["LIVER", "LOWER_LOBE_LEFT", "LOWER_LOBE_RIGHT", "UPPER_LOBE_LEFT", "MIDDLE_LOBE_RIGHT", "HEART"].every((k) => canon[k].live && canon[k].live.length));
ok("KIDNEY has sided living-CT parts", canon.KIDNEY.left.live.length === 1 && canon.KIDNEY.right.live.length === 1 && canon.KIDNEY.live.length === 2);
ok("at least 13 mesh-mapped structures are MRI-linked", mriLinked >= 13);
console.log(`   CT<->3D linked: ${ctLinked}   MRI<->3D linked: ${mriLinked}`);

console.log(`atlas3d-data: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
