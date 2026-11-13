// Today in Medical History: merge the world dataset (366 days) and the India dataset (158 days) and split
// them into one small file per month (data/history/MM.json), so the app fetches ~25 KB for the current month.
// India events carry in:1. An India event that repeats a world event (same day, same year, a shared name such as
// "Ronald" or "Joshi") replaces it: the India write-up says more about the Indian side.
// Run: node scripts/history/build-history.mjs
// App-facing text carries no em-dash: an em-dash in a summary becomes ", " (every one in the
// source is a parenthetical or appositive break, which a comma reads the same as).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "data/history/source/medical-history-365.json");
const SRC_IN = join(ROOT, "data/history/source/indian-medical-history.json");
const STOP = new Set(["birth", "death", "first", "india", "indian", "passing", "discovers", "established", "becomes", "founded", "medical", "hospital"]);
const words = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w)));
export function sameEvent(a, b) {
  if (a.year !== b.year) return false;
  const wa = words(a.title);
  for (const w of words(b.title)) if (wa.has(w)) return true;
  return false;
}
const OUT = join(ROOT, "data/history");

export function clean(s) {
  return String(s || "").replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, "-").replace(/\s+/g, " ").trim();
}

// Banner pictures (optional): data/history/img/MM-DD-YYYY.webp, matched to the event by date AND year, so a
// picture can never land on the wrong event. Holographic glow art on pure black (the app screen-blends it, so the
// black drops out on any theme). An event with no picture shows its category's line drawing.
// Each event gets an id, MM-DD-YYYY (a second event in the same year that day gets a "b"); its banner picture,
// when one ships, is data/history/img/<id>.webp, so a picture can never land on the wrong event. Pictures are
// holographic glow art on pure black (the app screen-blends them, so the black drops out on any theme).
export function build(src, india = { days: [] }, has = (f) => existsSync(join(OUT, "img", f))) {
  const byDay = {};
  for (const d of src.days) {
    const key = String(d.month).padStart(2, "0") + "-" + String(d.day).padStart(2, "0");
    if (key !== d.date) throw new Error("date mismatch " + d.date);
    byDay[key] = d.events.map((e) => ({ e, in: 0 }));
  }
  for (const d of india.days) {
    const key = String(d.month).padStart(2, "0") + "-" + String(d.day).padStart(2, "0");
    if (key !== d.date) throw new Error("india date mismatch " + d.date);
    const list = (byDay[key] ||= []);
    for (const e of d.events) {
      const i = list.findIndex((x) => !x.in && sameEvent(x.e, e));
      if (i >= 0) list.splice(i, 1);
      list.push({ e, in: 1 });
    }
  }
  const months = {};
  for (const key of Object.keys(byDay).sort()) {
    const used = {};
    (months[key.slice(0, 2)] ||= {})[key] = byDay[key]
      .sort((a, b) => a.e.year - b.e.year || a.in - b.in)
      .map(({ e, in: ind }) => {
        let id = key + "-" + e.year;
        if (used[id]) id += "b";
        used[id] = 1;
        const o = { id, y: e.year, t: clean(e.title), s: clean(e.summary), c: clean(e.category), sp: clean(e.specialty), u: e.sourceUrl };
        if (ind) o.in = 1;
        if (has(id + ".webp")) o.img = id + ".webp";
        return o;
      });
  }
  return months;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = JSON.parse(readFileSync(SRC, "utf8"));
  const india = existsSync(SRC_IN) ? JSON.parse(readFileSync(SRC_IN, "utf8")) : { days: [] };
  const months = build(src, india);
  mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const [mm, days] of Object.entries(months)) {
    writeFileSync(join(OUT, mm + ".json"), JSON.stringify(days) + "\n");
    n += Object.values(days).reduce((a, x) => a + x.length, 0);
  }
  console.log("months", Object.keys(months).length, "events", n);
}
