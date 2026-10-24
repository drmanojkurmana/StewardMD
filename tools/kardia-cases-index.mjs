// Builds kardia/cases/index.json from kardia/cases/*.json (one file per case).
// The index is the case list the Kardia Cases screen fetches: id, title, level,
// pathology and review status only, so the list stays small and each case file
// loads on demand. Fixture cases for tests live in test/fixtures/kardia-cases/
// and are indexed the same way when passed as the source directory.
// Usage: node tools/kardia-cases-index.mjs [casesDir] [outFile]
// Defaults: kardia/cases and kardia/cases/index.json in place.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEVELS = ["mbbs", "resident", "fellow", "sonographer"];

export function summarise(c, file) {
  const errors = [];
  if (!c || typeof c !== "object") return { errors: [file + ": not an object"] };
  if (!c.id || typeof c.id !== "string") errors.push(file + ": id missing");
  if (!c.title) errors.push(file + ": title missing");
  if (LEVELS.indexOf(c.level) < 0) errors.push(file + ": level must be one of " + LEVELS.join(", "));
  if (!c.pathology || !c.pathology.id) errors.push(file + ": pathology.id missing");
  if (!c.stem) errors.push(file + ": stem missing");
  if (!Array.isArray(c.history)) errors.push(file + ": history must be a list");
  if (!c.vitals || typeof c.vitals.hr !== "number") errors.push(file + ": vitals.hr missing");
  if (!c.exam || !c.exam.auscultation) errors.push(file + ": exam.auscultation missing");
  if (!c.ecg || !c.ecg.rhythm) errors.push(file + ": ecg.rhythm missing");
  if (!Array.isArray(c.echoTasks)) errors.push(file + ": echoTasks must be a list");
  if (!c.report || !Array.isArray(c.report.required)) errors.push(file + ": report.required must be a list");
  if (!c.diagnosis || !c.diagnosis.answer) errors.push(file + ": diagnosis.answer missing");
  if (!c.management || !c.management.model) errors.push(file + ": management.model missing");
  if (errors.length) return { errors };
  return {
    errors,
    entry: {
      id: c.id,
      title: c.title,
      level: c.level,
      pathology: { id: c.pathology.id, severity: c.pathology.severity || null },
      file: file,
      review: (c.review && c.review.status) || "ai_drafted",
    },
  };
}

export function build(casesDir) {
  const errors = [];
  const entries = [];
  const files = existsSync(casesDir)
    ? readdirSync(casesDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort()
    : [];
  const seen = new Set();
  for (const f of files) {
    let c;
    try { c = JSON.parse(readFileSync(join(casesDir, f), "utf8")); }
    catch (e) { errors.push(f + ": unreadable: " + e.message); continue; }
    const r = summarise(c, f);
    if (r.errors.length) { errors.push(...r.errors); continue; }
    if (seen.has(r.entry.id)) { errors.push(f + ": duplicate id " + r.entry.id); continue; }
    seen.add(r.entry.id);
    entries.push(r.entry);
  }
  entries.sort((a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : a.title < b.title ? -1 : 1));
  return { index: { v: 1, review: "ai_drafted", cases: entries }, errors };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const casesDir = process.argv[2] ? join(ROOT, process.argv[2]) : join(ROOT, "kardia", "cases");
  const outFile = process.argv[3] ? join(ROOT, process.argv[3]) : join(casesDir, "index.json");
  const { index, errors } = build(casesDir);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(index, null, 1) + "\n");
  console.log("wrote " + outFile + " with " + index.cases.length + " case(s)");
}
