// Validates patient handouts in kb/handouts/*.json.
// Exit code 1 on any error. Warnings do not fail the run.
// usage: node kb/tools/validate-handouts.mjs [handoutsDir]
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] || join(HERE, "..", "handouts");

export const FOOTER = "This leaflet gives general information. Follow your doctor's advice.";
export const REQUIRED_HEADINGS = [
  "What it is",
  "Common symptoms",
  "Tests you may need",
  "General treatment",
  "What you can do at home",
  "Follow-up",
];
const DOSE = /\b\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|mL|units?|IU|mmol|mEq)\b/i;
const EM_DASH = /[—–]|\s--\s/;

export function validateHandout(h, fileId) {
  const errors = [];
  const warnings = [];
  if (!h || typeof h !== "object") return { errors: ["not an object"], warnings };
  if (typeof h.id !== "string" || !h.id) errors.push("id missing");
  if (fileId && h.id !== fileId) errors.push(`id ${h.id} does not match file ${fileId}`);
  if (typeof h.title !== "string" || h.title.trim().length < 5) errors.push("title missing or too short");
  if (h.status !== "ai_drafted") errors.push(`status must be "ai_drafted", got ${h.status}`);
  if (!Array.isArray(h.urgent) || h.urgent.length === 0) errors.push("urgent[] must have at least one item");
  if (!Array.isArray(h.sections)) {
    errors.push("sections must be an array");
    return { errors, warnings };
  }
  const headings = h.sections.map((s) => s && s.h);
  for (const req of REQUIRED_HEADINGS) {
    if (!headings.includes(req)) errors.push(`missing section "${req}"`);
  }
  for (const s of h.sections) {
    if (!s || typeof s.h !== "string" || !Array.isArray(s.items) || s.items.length === 0) {
      errors.push("section needs h and a non-empty items[]");
      continue;
    }
    for (const it of s.items) if (typeof it !== "string" || !it.trim()) errors.push(`empty item in "${s.h}"`);
  }
  const last = h.sections[h.sections.length - 1];
  if (!last || last.h !== "Important" || last.items[last.items.length - 1] !== FOOTER) {
    errors.push("last section must be 'Important' ending with the required footer");
  }
  const all = [...h.sections.flatMap((s) => s.items || []), ...(h.urgent || [])];
  for (const t of all) {
    if (typeof t !== "string") continue;
    if (EM_DASH.test(t)) errors.push(`dash character in: ${t.slice(0, 60)}`);
    if (DOSE.test(t)) errors.push(`possible dose in: ${t.slice(0, 60)}`);
    if (/\b(stop|discontinue|change your (medicine|medication|dose))\b/i.test(t) && !/do not stop|ask your doctor/i.test(t)) {
      warnings.push(`check wording (medicine change): ${t.slice(0, 60)}`);
    }
  }
  return { errors, warnings };
}

export function validateDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const report = { files: files.length, failed: [], warnings: 0 };
  for (const f of files) {
    let h;
    try {
      h = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      report.failed.push({ file: f, errors: [`invalid JSON: ${e.message}`] });
      continue;
    }
    const { errors, warnings } = validateHandout(h, f.replace(/\.json$/, ""));
    report.warnings += warnings.length;
    if (errors.length) report.failed.push({ file: f, errors });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateDir(DIR);
  for (const f of r.failed) console.error(`FAIL ${f.file}: ${f.errors.join("; ")}`);
  console.log(`handouts: ${r.files} files, ${r.failed.length} failed, ${r.warnings} warnings`);
  process.exit(r.failed.length ? 1 : 0);
}
