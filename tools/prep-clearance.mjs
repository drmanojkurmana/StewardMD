#!/usr/bin/env node
/* Mark held images cleared: node tools/prep-clearance.mjs --ids id1,id2 --out sidecar.json
 * Writes a versioned clearance sidecar { v, cleared: [ids], at } the app/tooling reads to
 * release items flagged hold:"rights" (overlay maikheld1). No IDs = no-op listing. */
import fs from "node:fs";
export function applyClearance(items, cleared) { const s = new Set(cleared || []); return items.map((it) => { if (it && it.hold === "rights" && s.has(String(it.img && it.img[0] || it.id))) { const c = { ...it }; delete c.hold; return c; } return it; }); }
export function isLive(it, cleared) { return !(it && it.hold === "rights") || new Set(cleared || []).has(String(it.img && it.img[0] || it.id)); }
if (process.argv[1] && process.argv[1].endsWith("prep-clearance.mjs")) {
  const a = process.argv.slice(2); const gi = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ""; };
  const ids = (gi("--ids") || "").split(",").filter(Boolean);
  const out = gi("--out") || "clearance-sidecar.json";
  fs.writeFileSync(out, JSON.stringify({ v: 1, cleared: ids, at: new Date().toISOString() }, null, 1));
  console.log(ids.length ? `cleared ${ids.length} image id(s) -> ${out}` : "no --ids given; wrote empty sidecar (nothing released)");
}
