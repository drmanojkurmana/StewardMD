/* Build data/dose-rules.json for the dose calculator, plus a coverage report for review.
 *
 *   node scripts/build-dose-rules.mjs   writes data/dose-rules.json.gz (shipped), plus data/dose-rules.json
 *                                       and data/dose-rules-report.json (working copies, gitignored)
 *
 * Source: worker/data/gold/*.json (the authored monographs, 1,532 molecules). Parsing rules and the
 * "only unambiguous numbers become calculations" policy are in scripts/lib/dose-parse.mjs.
 * The report lists, per drug, what became calculable and what stayed text, so the owner can review
 * the extraction before the calculator flag (smd_dose_calc) is turned on.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDrug } from "./lib/dose-parse.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = join(ROOT, "worker/data/gold");

const drugs = [];
for (const f of readdirSync(SRC).sort()) {
  if (!f.endsWith(".json")) continue;
  let g; try { g = JSON.parse(readFileSync(join(SRC, f), "utf8")); } catch (e) { console.error("skip (bad JSON):", f); continue; }
  if (!g || !g.generic) continue;
  drugs.push(parseDrug(g));
}
drugs.sort((a, b) => a.name.localeCompare(b.name));

// Shipped file: compact keys, no report-only fields.
const ship = {
  version: new Date().toISOString().slice(0, 10),
  source: "worker/data/gold (StewardMD monographs)",
  drugs: drugs.map((d) => ({
    n: d.name, c: d.cls, k: d.kind, q: d.quick,
    rows: d.rows.map((r) => ({ k: r.kind, pop: r.pop, b: r.basis, ctx: r.c, rt: r.r, d: r.d, t: r.t, note: r.n,
      p: r.parts.map((p) => ({ per: p.per, lo: p.lo, hi: p.hi, u: p.unit, tm: p.time, l: p.label, up: p.upTo || undefined, src: p.src })),
      cap: r.caps.map((c) => ({ v: c.value, u: c.unit, per: c.per || undefined, tm: c.time, src: c.src })) })),
    ren: { text: d.renal.text, m: d.renal.measure, bands: d.renal.bands, dia: d.renal.dialysis },
    hep: { text: d.hepatic.text, cp: d.hepatic.classes }
  }))
};
const shipJson = JSON.stringify(ship);
writeFileSync(join(ROOT, "data/dose-rules.json"), shipJson);                          // working copy (gitignored)
writeFileSync(join(ROOT, "data/dose-rules.json.gz"), gzipSync(shipJson, { level: 9 })); // what the app loads

// Report.
const count = (pred) => drugs.filter(pred).length;
const rows = drugs.flatMap((d) => d.rows.map((r) => ({ drug: d.name, r })));
const report = {
  built: ship.version,
  drugs: drugs.length,
  byKind: { perkg: count((d) => d.kind === "perkg"), perm2: count((d) => d.kind === "perm2"), fixed: count((d) => d.kind === "fixed"), text: count((d) => d.kind === "text") },
  rows: rows.length,
  rowsByKind: ["perkg", "perm2", "fixed", "text"].reduce((o, k) => (o[k] = rows.filter((x) => x.r.kind === k).length, o), {}),
  rowsRejected: rows.filter((x) => x.r.rejected).map((x) => ({ drug: x.drug, d: x.r.d, rejected: x.r.rejected })),
  withCaps: rows.filter((x) => x.r.caps.length).length,
  nonActualWeight: rows.filter((x) => x.r.basis !== "actual" && x.r.kind === "perkg").map((x) => ({ drug: x.drug, basis: x.r.basis, d: x.r.d })),
  renal: { withBands: count((d) => d.renal.bands.length > 0), withDialysis: count((d) => !!d.renal.dialysis), textOnly: count((d) => d.renal.text && !d.renal.bands.length) },
  hepatic: { withChildPugh: count((d) => Object.keys(d.hepatic.classes).length > 0) },
  perkgDrugs: drugs.filter((d) => d.kind === "perkg").map((d) => ({
    drug: d.name,
    rows: d.rows.filter((r) => r.kind === "perkg").map((r) => ({ pop: r.pop, ctx: r.c, d: r.d, parts: r.parts.map((p) => p.src + (p.label ? " [" + p.label + "]" : "")), caps: r.caps.map((c) => c.src), basis: r.basis }))
  })),
  renalBands: drugs.filter((d) => d.renal.bands.length).map((d) => ({ drug: d.name, bands: d.renal.bands.map((b) => ({ range: (b.lo || 0) + "-" + (b.hi == null ? "up" : b.hi), src: b.src, advice: b.advice, factor: b.factor, every: b.every, avoid: b.avoid })) })),
  hepaticClasses: drugs.filter((d) => Object.keys(d.hepatic.classes).length).map((d) => ({ drug: d.name, classes: d.hepatic.classes }))
};
writeFileSync(join(ROOT, "data/dose-rules-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ drugs: report.drugs, byKind: report.byKind, rows: report.rows, rowsByKind: report.rowsByKind, rejected: report.rowsRejected.length, withCaps: report.withCaps, nonActualWeight: report.nonActualWeight.length, renal: report.renal, hepatic: report.hepatic }, null, 1));
