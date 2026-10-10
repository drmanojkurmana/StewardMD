#!/usr/bin/env node
// PrepNucleus image audit (owner rule 2026-10-10: every real clinical image the app serves must be de-identified).
// Lists every image the app can reach (lessons index + lesson files, each subject's bank version from
// prep/taxonomy.json, the overlay sets named in prep.js OVERLAYS, the PYQ items file, card files) and fails when one is
// not in the de-identification manifest tools/prep-deid/manifest.json, so a new image cannot ship unchecked.
//
//   node tools/prep-deid-audit.mjs [--api https://stewardmd.in/api/prep/bank/] [--manifest FILE] [--json]
//
// Manifest: { v, images: { "<bank path>": "clean" | "cleaned" | "drawing" }, stacks: { "<stack base>": "clean" },
// generated: [regex strings] }. "clean" = checked, nothing to remove; "cleaned" = a de-identified copy;
// "drawing" = not a real scan (drawings are redrawn separately); generated = path patterns of newly drawn figures
// (no real scan inside). Exit 1 on any unlisted path. Network: reads the live bank API (read only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const IMG = /\.(webp|png|jpe?g|gif|svg)$/i;

// Every image string and stack under an item or lesson, with the app's resolution of bare names.
export function collect(obj, resolve, onImg, onStack) {
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "stack" && v && typeof v === "object" && v.base) onStack(v.base); else walk(v); }
    else if (typeof o === "string" && IMG.test(o) && !/\s/.test(o) && !/^(https?:|data:)/.test(o)) onImg(resolve(o.replace(/^\/?api\/prep\/bank\//, "")));
  };
  walk(obj);
}

export function overlaysFromApp(src) {
  const m = /var OVERLAYS = G\.SMD_PREP_OVERLAYS \|\| (\{[^;]*\});/.exec(src);
  if (!m) throw new Error("OVERLAYS not found in prep.js");
  return JSON.parse(m[1].replace(/([{,]\s*)([a-z][a-z0-9-]*)\s*:/g, '$1"$2":'));
}

// get(path) -> parsed JSON or null (404). Returns { images: Map<path, [where]>, stacks: Map<base, [where]> }.
export async function enumerate(get, { taxonomy, overlays, pyqVer = "v5", jobs = 12 }) {
  const images = new Map(), stacks = new Map();
  const add = (m, k, w) => { if (!m.has(k)) m.set(k, []); m.get(k).push(w); };
  const pool = async (arr, fn) => { let i = 0; await Promise.all(Array.from({ length: jobs }, async () => { while (i < arr.length) await fn(arr[i++]); })); };
  const lix = await get("v1/lessons/index.json");
  if (lix) await pool(Object.keys(lix.modules), async (k) => {
    const p = "v" + (lix.modules[k].r || 1) + "/lessons/" + k + ".json", j = await get(p);
    if (j) collect(j, (s) => (s.includes("/") ? s : "v1/lessons/media/" + s), (s) => add(images, s, p), (b) => add(stacks, b, p));
  });
  const files = [];
  for (const b of taxonomy.branches) for (const s of b.subjects) {
    const bv = s.bv || "v5";
    for (const sec of s.sections) for (const m of sec.modules) {
      files.push({ p: bv + "/" + s.id + "/mcq/" + m.id + ".json", bare: bv + "/img/" });
      for (const set of overlays[s.id] || []) files.push({ p: "overlay/" + set + "/" + s.id + "/" + m.id + ".json", bare: "img/" + set.replace(/\d+$/, "") + "/" });
    }
  }
  await pool(files, async (f) => {
    const j = await get(f.p); if (!j) return;
    collect(j.items || [], (s) => (s.includes("/") ? s : f.bare + s), (s) => add(images, s, f.p), (b) => add(stacks, b, f.p));
  });
  const pix = await get(pyqVer + "/pyq/index.json");
  if (pix && pix.file) {
    const p = pyqVer + "/pyq/" + pix.file, j = await get(p);
    if (j) collect(j.items || j, (s) => (s.includes("/") ? s : pyqVer + "/pyq/img/" + s), (s) => add(images, s, p), (b) => add(stacks, b, p));
  }
  const cix = await get("v1/cards/index.json");
  if (cix) await pool(Object.keys(cix.modules || {}), async (m) => {
    const p = "v1/cards/" + m + ".json", j = await get(p);
    if (j) collect(j, (s) => (s.includes("/") ? s : "v1/cards/img/" + s), (s) => add(images, s, p), (b) => add(stacks, b, p));
  });
  return { images, stacks };
}

export function audit(found, manifest) {
  const gen = (manifest.generated || []).map((r) => new RegExp(r));
  const ok = new Set(["clean", "cleaned", "drawing"]);
  const missing = [];
  for (const [p, where] of found.images) {
    const st = (manifest.images || {})[p];
    if (ok.has(st)) continue;
    if (!st && gen.some((r) => r.test(p))) continue;
    missing.push({ path: p, status: st || "unlisted", where: where.slice(0, 3) });
  }
  for (const [b, where] of found.stacks) if ((manifest.stacks || {})[b] !== "clean") missing.push({ path: "stack:" + b, status: "unlisted", where: where.slice(0, 3) });
  return { images: found.images.size, stacks: found.stacks.size, missing };
}

export function fetcher(api) {
  return async (p) => {
    for (let t = 0; t < 4; t++) {
      const r = await fetch(api + p, { headers: { "User-Agent": "Mozilla/5.0 prep-deid-audit" } });
      if (r.status === 404) return null;
      if (r.ok) return r.json();
      await new Promise((s) => setTimeout(s, 1500 * (t + 1)));
    }
    throw new Error("fetch failed " + p);
  };
}

async function main() {
  const a = process.argv.slice(2), opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const api = opt("--api", "https://stewardmd.in/api/prep/bank/");
  const manifest = JSON.parse(fs.readFileSync(opt("--manifest", path.join(ROOT, "tools/prep-deid/manifest.json")), "utf8"));
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/taxonomy.json"), "utf8"));
  const app = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
  const pyqVer = (/PYQ_VER = G\.SMD_PREP_PYQ_VER \|\| "(v\d+)"/.exec(app) || [])[1] || "v5";
  const found = await enumerate(fetcher(api), { taxonomy, overlays: overlaysFromApp(app), pyqVer });
  const r = audit(found, manifest);
  if (a.includes("--json")) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`images ${r.images}, stacks ${r.stacks}, not de-identified ${r.missing.length}`);
    for (const m of r.missing.slice(0, 40)) console.log(" ", m.status, m.path, "<-", m.where.join(", "));
  }
  process.exit(r.missing.length ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(2); });
