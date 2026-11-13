// Today in Medical History: split the 366-day source into one small file per month
// (data/history/MM.json), so the app fetches ~25 KB for the current month, never the whole year.
// Run: node scripts/history/build-history.mjs [source.json]
// App-facing text carries no em-dash: an em-dash in a summary becomes ", " (every one in the
// source is a parenthetical or appositive break, which a comma reads the same as).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = process.argv[2] || join(ROOT, "data/history/source/medical-history-365.json");
const OUT = join(ROOT, "data/history");

export function clean(s) {
  return String(s || "").replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, "-").replace(/\s+/g, " ").trim();
}

// Banner pictures (optional): data/history/img/MM-DD.webp for the day, MM-DD-2.webp for its second event.
// An event with no picture of its own shows the day's picture, else the app draws its category.
function imgFor(key, i, has) {
  if (i > 0 && has(key + "-" + (i + 1) + ".webp")) return key + "-" + (i + 1) + ".webp";
  return has(key + ".webp") ? key + ".webp" : undefined;
}

export function build(src, has = (f) => existsSync(join(OUT, "img", f))) {
  const months = {};
  for (const d of src.days) {
    const mm = String(d.month).padStart(2, "0");
    const key = mm + "-" + String(d.day).padStart(2, "0");
    if (key !== d.date) throw new Error("date mismatch " + d.date);
    (months[mm] ||= {})[key] = d.events
      .map((e) => ({ y: e.year, t: clean(e.title), s: clean(e.summary), c: clean(e.category), sp: clean(e.specialty), u: e.sourceUrl }))
      .sort((a, b) => a.y - b.y)
      .map((e, i) => { const img = imgFor(key, i, has); return img ? { ...e, img } : e; });
  }
  return months;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = JSON.parse(readFileSync(SRC, "utf8"));
  const months = build(src);
  mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const [mm, days] of Object.entries(months)) {
    writeFileSync(join(OUT, mm + ".json"), JSON.stringify(days) + "\n");
    n += Object.values(days).reduce((a, x) => a + x.length, 0);
  }
  console.log("months", Object.keys(months).length, "events", n);
}
