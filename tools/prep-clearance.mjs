#!/usr/bin/env node
/* Image clearance admin switch for held pools (overlay maikheld1).
 * Items flagged hold:"rights" are excluded by the app (prep.js usable() drops any
 * item with a hold flag). Clearing releases them through a versioned sidecar:
 *
 *   node tools/prep-clearance.mjs --ids rb-ctc-p0003-1.webp,rb-r11-4-121-6.webp --out sidecar.json
 *   node tools/prep-clearance.mjs --pool rb-ctc --csv .fleet-reports/PrepNucleus-image-clearance.csv --out sidecar.json
 *   node tools/prep-clearance.mjs --list --csv .fleet-reports/PrepNucleus-image-clearance.csv
 *
 * Sidecar: { v: 2, cleared: [image ids], at: ISO date }. Tooling/app merges the
 * cleared list and treats matching held items as live (isLive/applyClearance).
 * Owner direction (2026-10-13): diagram figures are redrawn as StewardMD
 * originals and published live instead (maikpearl1); this switch is only for
 * source images themselves (including scans, which are never redrawn). */
import fs from "node:fs";
export function applyClearance(items, cleared) { const s = new Set(cleared || []); return items.map((it) => { if (it && it.hold === "rights" && s.has(String(it.img && it.img[0] || it.id))) { const c = { ...it }; delete c.hold; return c; } return it; }); }
export function isLive(it, cleared) { return !(it && it.hold === "rights") || new Set(cleared || []).has(String(it.img && it.img[0] || it.id)); }
export function idsForPool(csvText, pool) {
  const out = [];
  for (const line of String(csvText || "").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    if (cells[0] === pool || (pool && cells[1] && cells[1].startsWith(pool))) out.push(cells[1]);
  }
  return out;
}
if (process.argv[1] && process.argv[1].endsWith("prep-clearance.mjs")) {
  const a = process.argv.slice(2); const gi = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ""; };
  let ids = (gi("--ids") || "").split(",").filter(Boolean);
  const csvPath = gi("--csv"), pool = gi("--pool");
  if (csvPath && pool) ids = ids.concat(idsForPool(fs.readFileSync(csvPath, "utf8"), pool));
  if (a.includes("--list")) {
    console.log(ids.length ? ids.join("\n") : "no ids matched (pass --ids or --pool with --csv)");
    process.exit(ids.length ? 0 : 1);
  }
  const out = gi("--out") || "clearance-sidecar.json";
  fs.writeFileSync(out, JSON.stringify({ v: 2, cleared: [...new Set(ids)], at: new Date().toISOString() }, null, 1));
  console.log(ids.length ? `cleared ${new Set(ids).size} image id(s) -> ${out}` : "no ids given; wrote empty sidecar (nothing released)");
}
