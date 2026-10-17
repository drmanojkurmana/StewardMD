#!/usr/bin/env node
/* PrepNucleus content parity: everything the app reads from R2 (via /api/prep/bank/) must exist there.
 *
 * Merging a content PR does not put anything in R2: indexes, overlay files and lesson images are uploaded by a
 * separate step, and when that step is skipped the app silently shows less (owner 2026-10-17: 1,110 interventional
 * radiology MCQs, 42 modules and 42 lessons merged on 15-16 October and were never uploaded, so no phone could see
 * them). This tool is the guard: it reads the live bank with the tools credential and fails when the repo says a file
 * exists that R2 does not have.
 *
 *   node tools/prep-r2-parity.mjs            report; exit 1 on any gap
 *   node tools/prep-r2-parity.mjs --json     machine-readable report on stdout
 *   node tools/prep-r2-parity.mjs --fix-list the missing keys, one per line (input for prep-r2-sync.mjs)
 *
 * Checks (each is a hard failure unless marked info):
 *   1. subject index: every topic id in the repo index is in the live index of that subject and version
 *   2. overlay files: every (set, subject, module) in prep/bank/overlay-counts.json exists live
 *   3. lesson images: every image src in prep/lessons/v1/*.json exists live
 *   4. bank module files: every topic with a file and count > 0 in a repo index exists live (info when count comes
 *      only from overlays)
 * Auth: X-SMD-Tool from SMD_TOOL_TOKEN or ~/.config/stewardmd/tool-token (never printed). BASE overrides the host. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "https://stewardmd.in").replace(/\/$/, "") + "/api/prep/bank/";
const argv = process.argv.slice(2);
const tokenFile = path.join(os.homedir(), ".config/stewardmd/tool-token");
const TOKEN = process.env.SMD_TOOL_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "");
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const H = { "X-SMD-Tool": TOKEN, Origin: "https://stewardmd.in" };

async function get(key, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + key, { headers: H });
      if (r.status === 404) return { status: 404 };
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 500 * (i + 1))); continue; }
      return { status: r.status, body: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
    } catch (e) { await new Promise((s) => setTimeout(s, 500 * (i + 1))); }
  }
  return { status: 0 };
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const tax = rd("prep/taxonomy.json");
const subjects = []; for (const b of tax.branches) for (const s of b.subjects) subjects.push({ id: s.id, bv: s.bv });
const prepSrc = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
const VER = (/VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(prepSrc) || [])[1] || "v5";
const gaps = { index: [], overlay: [], image: [], module: [], info: [] };

if (!TOKEN) { console.error("no tools credential (SMD_TOOL_TOKEN or ~/.config/stewardmd/tool-token)"); process.exit(2); }

// 1 + 4: indexes and bank module files
const idxFiles = [];
for (const s of subjects) {
  const v = s.bv || VER, rel = `prep/bank/${v}/${s.id}/index.json`;
  if (fs.existsSync(path.join(ROOT, rel))) idxFiles.push({ sid: s.id, v, rel });
}
await pool(idxFiles, 8, async (f) => {
  const repo = rd(f.rel), live = await get(`${f.v}/${f.sid}/index.json`);
  let have = new Set();
  if (live.status !== 200) gaps.index.push({ key: `${f.v}/${f.sid}/index.json`, why: "missing live (HTTP " + live.status + ")", missing: (repo.topics || []).map((t) => t.id) });
  else {
    have = new Set(JSON.parse(live.body.toString("utf8")).topics.map((t) => t.id));
    const miss = (repo.topics || []).filter((t) => !have.has(t.id)).map((t) => t.id);
    if (miss.length) gaps.index.push({ key: `${f.v}/${f.sid}/index.json`, why: miss.length + " topic(s) not live: " + miss.slice(0, 6).join(", ") + (miss.length > 6 ? ", ..." : ""), missing: miss });
  }
  // Bank module files named by the repo index with questions in them (a module with only overlay items has count 0).
  const files = (repo.topics || []).filter((t) => t.file && (t.count || 0) > 0);
  const res = await pool(files, 8, async (t) => ({ t, r: await get(`${f.v}/${f.sid}/${t.file}`) }));
  for (const { t, r } of res) if (r.status === 404) gaps.module.push({ key: `${f.v}/${f.sid}/${t.file}`, why: "index lists " + t.count + " item(s), file not live" });
});

// 2: overlay files
const counts = rd("prep/bank/overlay-counts.json").sets || {};
const ov = [];
for (const [set, subs] of Object.entries(counts)) for (const [sid, mods] of Object.entries(subs)) for (const mid of Object.keys(mods)) ov.push(`overlay/${set}/${sid}/${mid}.json`);
const ovRes = await pool(ov, 16, async (k) => ({ k, r: await get(k) }));
for (const { k, r } of ovRes) if (r.status === 404) gaps.overlay.push({ key: k, why: "not live" });
else if (r.status !== 200) gaps.info.push({ key: k, why: "HTTP " + r.status });

// 3: lesson images
const imgs = new Set();
const lessonDir = path.join(ROOT, "prep/lessons/v1");
for (const f of fs.readdirSync(lessonDir)) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const d = JSON.parse(fs.readFileSync(path.join(lessonDir, f), "utf8"));
  for (const s of d.steps || []) {
    const v = s.vis || {};
    for (const src of [v.src, v.pair && v.pair.src]) if (src && /^v\d+\/lessons\/media\//.test(src)) imgs.add(src);
  }
}
const imgRes = await pool([...imgs], 16, async (k) => ({ k, r: await get(k) }));
for (const { k, r } of imgRes) if (r.status === 404) gaps.image.push({ key: k, why: "not live" });

const total = gaps.index.length + gaps.overlay.length + gaps.image.length + gaps.module.length;
const summary = { checked: { indexes: idxFiles.length, overlays: ov.length, images: imgs.size }, gaps: { index: gaps.index.length, overlay: gaps.overlay.length, image: gaps.image.length, module: gaps.module.length } };
if (argv.includes("--fix-list")) { fs.writeSync(1, [...gaps.index, ...gaps.overlay, ...gaps.image, ...gaps.module].map((g) => g.key).join("\n") + "\n"); process.exit(total ? 1 : 0); }
// fs.writeSync, not console.log: process.exit() right after a piped console.log truncates at the 64 KB pipe buffer.
if (argv.includes("--json")) { fs.writeSync(1, JSON.stringify({ summary, gaps }, null, 1) + "\n"); process.exit(total ? 1 : 0); }
console.log("PrepNucleus R2 parity", JSON.stringify(summary.checked));
for (const k of ["index", "overlay", "image", "module"]) {
  console.log(`  ${k}: ${gaps[k].length} gap(s)`);
  for (const g of gaps[k].slice(0, 8)) console.log(`    ${g.key}  (${g.why})`);
  if (gaps[k].length > 8) console.log(`    ... ${gaps[k].length - 8} more`);
}
console.log(total ? `FAIL: ${total} file(s) the app expects are not in R2` : "OK: R2 has everything the repo lists");
process.exit(total ? 1 : 0);
