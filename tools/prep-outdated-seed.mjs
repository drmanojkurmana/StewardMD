#!/usr/bin/env node
// Seed outdated-guidance marks from student reports, never deleting anything.
//
//   node tools/prep-outdated-seed.mjs --from reports.json [--min 1] [--out outdated-ids.json]
//   node tools/prep-outdated-seed.mjs --live --token <X-Admin-Token> [--api https://stewardmd.in/api] [--min 1] [--out outdated-ids.json]
//
// Input: the owner reports export (GET /api/prep/flag?top=1): { items: [{ itemId, n, reasons, subject, module }] }.
// Output: [<item id>, ...] with at least --min outdated reports, sorted, for tools/prep-item-edits.mjs --outdated.
// Prints a JSON report (counts plus one row per marked item for owner review). Read-only: it fetches reports and
// writes the ids file only; marking bank files (item-edits) and publishing a new version stay separate owner steps,
// and no report, item or flag is ever deleted or hidden by this tool.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* selectOutdated(reports, min) -> [{ itemId, subject, module, n, outdated }] for reports with >= min outdated. */
export function selectOutdated(reports, min = 1) {
  const out = [];
  for (const r of (reports && reports.items) || []) {
    const id = r && r.itemId != null ? String(r.itemId) : "";
    const k = r && r.reasons && Number(r.reasons.outdated) || 0;
    if (!id || k < min) continue;
    out.push({ itemId: id, subject: r.subject || "", module: r.module || "", n: r.n || 0, outdated: k });
  }
  out.sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  return out;
}

async function liveReports(api, token) {
  const r = await fetch(api.replace(/\/?$/, "/") + "prep/flag?top=1", { headers: { "X-Admin-Token": token } });
  if (r.status === 403) throw new Error("owner token rejected (403)");
  if (!r.ok) throw new Error("reports HTTP " + r.status);
  return r.json();
}

function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const min = Math.max(1, Number(arg("--min", 1)) || 1);
  const outP = arg("--out", null);
  const done = (reports) => {
    const rows = selectOutdated(reports, min);
    const report = { reports: ((reports && reports.items) || []).length, min, marked: rows.length,
      ids: rows.map((x) => x.itemId), rows };
    if (outP) fs.writeFileSync(outP, JSON.stringify(report.ids) + "\n");
    console.log(JSON.stringify(report));
  };
  if (argv.includes("--live")) {
    const token = arg("--token", "");
    if (!token) throw new Error("--live needs --token <X-Admin-Token>");
    return liveReports(arg("--api", "https://stewardmd.in/api"), token).then(done);
  }
  const from = arg("--from", null);
  if (!from) throw new Error("--from reports.json or --live --token is required");
  done(JSON.parse(fs.readFileSync(from, "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  Promise.resolve(main()).catch((e) => { console.error(e.message || e); process.exit(1); });
