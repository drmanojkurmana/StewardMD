/* Merge and validate Mechanism mastery parts into prep/figures/mastery.json.
 *   node tools/figures/dev/mastery-merge.mjs [--keep-parts]     reads prep/figures/mastery-part/*.json ({ "<figure-id>": { trigger, target, mechanism, manifestation, intervention, adverse } })
 * Rules (the same ones test/fig-mastery.test.mjs enforces): every field present, short, no em or en dashes, no doses; unknown ids and bad entries are reported and skipped. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PARTS = path.join(ROOT, "prep/figures/mastery-part"), OUT = path.join(ROOT, "prep/figures/mastery.json");
export const FIELDS = ["trigger", "target", "mechanism", "manifestation", "intervention", "adverse"];
const plainLen = (v) => (typeof v === "string" ? v.replace(/\*\*/g, "").trim().length : 0);
export function problems(e) {
  const out = [];
  for (const f of FIELDS) {
    const v = e && e[f];
    if (typeof v !== "string" || plainLen(v) < 12) { out.push(`${f} missing or too short`); continue; }
    const plain = v.replace(/\*\*/g, "");
    if (plain.trim().split(/\s+/).length > 60) out.push(`${f} over 60 words`);
    const marks = (v.match(/\*\*/g) || []).length;
    if (marks % 2 || marks > 10) out.push(`${f} has unbalanced or too many ** key-term marks`);
    if (/\*/.test(plain)) out.push(`${f} has stray asterisks`);
    if (marks === 0) out.push(`${f} marks no key terms with **`);
    if (/[–—]/.test(v)) out.push(`${f} has an em or en dash`);
    if (/\b\d+(\.\d+)?\s?(mg|mcg|ug|g|ml|mL|units?|IU|mmol|mEq|%)(\/|\b)/.test(v)) out.push(`${f} has a dose or lab number`);
  }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reg = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "prep/figures/figures.json"), "utf8")).figures.map((f) => f.id));
  const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { v: 1, items: {} };
  let added = 0, bad = 0;
  for (const f of fs.existsSync(PARTS) ? fs.readdirSync(PARTS).filter((x) => x.endsWith(".json")) : []) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(PARTS, f), "utf8")); } catch (e) { console.log(`${f}: not valid JSON`); continue; }
    for (const [id, e] of Object.entries(j)) {
      const p = reg.has(id) ? problems(e) : ["unknown figure id"];
      if (p.length) { bad++; console.log(`${id}: ${p.join("; ")}`); continue; }
      cur.items[id] = Object.fromEntries(FIELDS.map((k) => [k, e[k].trim()])); added++;
    }
  }
  cur.v = 1; cur.gen = "AI-assisted summaries from the mechanism mastery framework; awaiting clinician review";
  cur.items = Object.fromEntries(Object.entries(cur.items).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(OUT, JSON.stringify(cur, null, 1) + "\n");
  if (!process.argv.includes("--keep-parts") && fs.existsSync(PARTS)) fs.rmSync(PARTS, { recursive: true, force: true });
  const missing = [...reg].filter((id) => !cur.items[id]);
  console.log(`merged ${added}, rejected ${bad}, total ${Object.keys(cur.items).length}, figures without an entry ${missing.length}`);
  if (missing.length) fs.writeFileSync(path.join(ROOT, "prep/figures/.mastery-missing.txt"), missing.join("\n") + "\n");
}
