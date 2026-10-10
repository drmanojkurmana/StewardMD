#!/usr/bin/env node
/* PrepNucleus lesson figure redraws: swap a lesson figure for its redrawn art without touching anything else.
 *
 * Redrawn art lives beside the original under v1/lessons/media/: <base>-ai1.webp (all teaching labels) and, when a
 * step quizzes a label that the art would give away, <base>-ai1-h.webp (that label left out). The originals and the
 * older -h1 files stay on R2 for rollback.
 *
 *   applyRedraw(lesson, map) -> { lesson, changed }   pure: swaps vis.src by image name, nothing else
 *   webpSize(buf)                                    -> { w, h } from a VP8 / VP8L / VP8X header
 *   checkMap(map)                                    -> problems[] (paths, names, dims)
 *
 *   node tools/prep-redraw.mjs publish --stage DIR --map map.json [--only id,id] [--dry]
 *     Re-downloads the LIVE lessons index and every affected LIVE lesson right before upload (never a stale local
 *     copy: another job edits lessons too), applies the swaps, writes v{r+1}/lessons/<id>.json, uploads media
 *     (immutable) then lessons, then re-reads the live index once more and bumps only the changed revisions, then
 *     refreshes the shareable-ID index (tools/prep-ids.mjs publish --yes, then verify).
 *   node tools/prep-redraw.mjs verify --map map.json
 *     Every live lesson: every image it references answers 200; every redrawn file has the dims in the map.
 *
 * map.json: { "<orig name>.webp": { "full": "<base>-ai1.webp", "hidden": "<base>-ai1-h.webp"?, "w": 900, "h": 700,
 *             "hw"?: 900, "hh"?: 700 } }. "hidden" is used for steps that carry a spot or label marks (the
 *             label they ask for or overlay is left out of that art); every other step gets "full". A live "-h1" source
 *             (already a quiz variant) maps "full" to its "-ai1-h" art. A step with a compare pair is left alone.
 */
import fs from "node:fs";
import path from "node:path";

export const MEDIA = "v1/lessons/media/";
const NAME = /^[a-z0-9][a-z0-9._-]*\.webp$/;

export function webpSize(buf) {
  const b = Buffer.from(buf);
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const tag = b.toString("ascii", 12, 16);
  if (tag === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (tag === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  if (tag === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  return null;
}

export function checkMap(map) {
  const out = [];
  for (const [k, v] of Object.entries(map || {})) {
    if (!NAME.test(k)) out.push(k + ": bad source name");
    if (!v || !NAME.test(v.full || "") || !/-ai\d+(-h)?\.webp$/.test(v.full)) out.push(k + ": bad full name");
    if (v && v.hidden != null && (!NAME.test(v.hidden) || !/-ai\d+-h\.webp$/.test(v.hidden))) out.push(k + ": bad hidden name");
    if (v && !(v.w > 0 && v.h > 0 && v.w <= 1400 && v.h <= 1400)) out.push(k + ": bad dims");
    if (v && v.hidden && !(v.hw > 0 && v.hh > 0)) out.push(k + ": hidden without dims");
  }
  return out;
}

export function applyRedraw(lesson, map) {
  const l = JSON.parse(JSON.stringify(lesson));
  let changed = 0;
  for (const s of l.steps || []) {
    const v = s && s.vis;
    if (!v || v.kind !== "image" || typeof v.src !== "string" || !v.src.startsWith(MEDIA)) continue;
    if (v.pair) continue;                                          // a compare keeps both originals side by side
    const m = map[v.src.slice(MEDIA.length)];
    if (!m) continue;
    const name = (v.spot || v.marks) && m.hidden ? m.hidden : m.full;
    const w = name === m.hidden ? m.hw : m.w, h = name === m.hidden ? m.hh : m.h;
    v.src = MEDIA + name;
    if (v.ar != null) v.ar = Math.round((w / h) * 1000) / 1000;
    changed++;
  }
  return { lesson: l, changed };
}

// ---- CLI ------------------------------------------------------------------------------------------------------------
const API = "https://stewardmd.in/api/prep/bank/";
async function get(k, json = true) {
  const r = await fetch(API + k + "?t=" + Date.now(), { headers: { "User-Agent": "Mozilla/5.0 prep-redraw" } });
  if (!r.ok) throw new Error(k + " " + r.status);
  return json ? r.json() : Buffer.from(await r.arrayBuffer());
}
function arg(n, d) { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; }

async function publish() {
  const stage = arg("stage"), map = JSON.parse(fs.readFileSync(arg("map"), "utf8")), dry = process.argv.includes("--dry");
  const only = arg("only") ? new Set(arg("only").split(",")) : null;
  const bad = checkMap(map); if (bad.length) throw new Error(bad.join("\n"));
  for (const v of Object.values(map)) for (const n of [v.full, v.hidden].filter(Boolean)) {
    const p = path.join(stage, MEDIA, n); if (!fs.existsSync(p)) throw new Error("missing " + p);
    const d = webpSize(fs.readFileSync(p)), want = n === v.hidden ? [v.hw, v.hh] : [v.w, v.h];
    if (!d || d.w !== want[0] || d.h !== want[1]) throw new Error("dims " + n);
  }
  const ix = await get("v1/lessons/index.json"), bump = {};
  for (const [id, m] of Object.entries(ix.modules)) {
    if (only && !only.has(id)) continue;
    const r = m.r || 1, live = await get(`v${r}/lessons/${id}.json`);
    const { lesson, changed } = applyRedraw(live, map);
    if (!changed) continue;
    fs.mkdirSync(path.join(stage, `v${r + 1}/lessons`), { recursive: true });
    fs.writeFileSync(path.join(stage, `v${r + 1}/lessons/${id}.json`), JSON.stringify(lesson));
    bump[id] = r + 1;
  }
  console.log("lessons changed", Object.keys(bump).length);
  fs.writeFileSync(path.join(stage, "bump.json"), JSON.stringify(bump, null, 1));
  if (dry) return;
  const { putArgs } = await import("./prep-upload-bank.mjs");
  const { spawnSync } = await import("node:child_process");
  const put = (src, key, last) => { const a = putArgs({ src, key: "prep-bank/" + key, last }); for (let t = 1; t <= 4; t++) { if (spawnSync("npx", a, { stdio: "ignore" }).status === 0) return; } throw new Error("upload " + key); };
  for (const v of Object.values(map)) for (const n of [v.full, v.hidden].filter(Boolean)) put(path.join(stage, MEDIA, n), MEDIA + n, false);
  for (const [id, r] of Object.entries(bump)) put(path.join(stage, `v${r}/lessons/${id}.json`), `v${r}/lessons/${id}.json`, false);
  const ix2 = await get("v1/lessons/index.json");                      // re-read: only our revisions change
  for (const [id, r] of Object.entries(bump)) {
    const m = ix2.modules[id]; if (!m) throw new Error("gone " + id);
    if ((m.r || 1) !== r - 1) throw new Error(id + " moved to r" + m.r + " meanwhile: re-run publish");
    m.r = r;
  }
  const P = path.join(stage, "index.json"); fs.writeFileSync(P, JSON.stringify(ix2));
  put(P, "v1/lessons/index.json", true);
  console.log("published", Object.keys(bump).length, "lessons");
  // shareable lesson IDs derive from lesson keys; only their index needs refreshing after new revisions
  for (const a of [["publish", "--yes"], ["verify"]]) {
    const r = spawnSync("node", [new URL("./prep-ids.mjs", import.meta.url).pathname, ...a], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("prep-ids " + a[0] + " failed");
  }
}

async function verify() {
  const map = JSON.parse(fs.readFileSync(arg("map"), "utf8"));
  const want = {};
  for (const v of Object.values(map)) { want[v.full] = [v.w, v.h]; if (v.hidden) want[v.hidden] = [v.hw, v.hh]; }
  const ix = await get("v1/lessons/index.json"), seen = new Map(), bad = [];
  const ids = Object.keys(ix.modules);
  let i = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (i < ids.length) {
      const id = ids[i++], r = ix.modules[id].r || 1, l = await get(`v${r}/lessons/${id}.json`);
      for (const s of l.steps || []) { const v = s && s.vis; if (v && v.kind === "image") seen.set(v.src, id); }
    }
  }));
  const srcs = [...seen.keys()]; i = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (i < srcs.length) {
      const s = srcs[i++], n = s.slice(MEDIA.length);
      try {
        if (want[n]) { const d = webpSize(await get(s, false)); if (!d || d.w !== want[n][0] || d.h !== want[n][1]) bad.push(s + " dims"); }
        else { const r = await fetch(API + s, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0 prep-redraw" } }); if (!r.ok) bad.push(s + " " + r.status); }
      } catch (e) { bad.push(s + " " + e.message); }
    }
  }));
  const used = srcs.filter((s) => want[s.slice(MEDIA.length)]).length;
  console.log(JSON.stringify({ lessons: ids.length, images: srcs.length, redrawnInUse: used, problems: bad.length }));
  if (bad.length) { console.log(bad.slice(0, 40).join("\n")); process.exitCode = 1; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = process.argv[2];
  (c === "publish" ? publish() : c === "verify" ? verify() : Promise.reject(new Error("publish | verify"))).catch((e) => { console.error(e.message); process.exit(1); });
}
