// Builds kardia/catalogue.json: every Kardia view, calculator, lesson and
// case with its id, title and stable deep link. The link rule comes from
// kardia-links.js itself, the same module the app uses, so the committed
// file can never drift from the router. Teach pack links are validated too:
// every teach link must resolve to a catalogue entry.
// Usage: node scripts/kardia-catalogue.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));

const LINKS = require("../kardia-links.js");
const TEACH = require("../kardia-teach.js");
const KCALC = require("../kardia-calc-data.js");

export function build() {
  const errors = [];
  const entries = [];
  const seen = new Set();
  function add(kind, id, title) {
    if (!id) { errors.push(kind + ": missing id"); return; }
    if (seen.has(kind + ":" + id)) { errors.push(kind + ":" + id + " listed twice"); return; }
    seen.add(kind + ":" + id);
    const link = LINKS.link(kind, id);
    if (!link) { errors.push(kind + ":" + id + ": no stable link"); return; }
    const back = LINKS.parse(link);
    if (!back || back.kind !== kind || back.id !== id) { errors.push(kind + ":" + id + ": link does not round trip"); return; }
    entries.push({ kind, id, title: String(title == null ? "" : title), link });
  }
  const views = readJSON("kardia/views.json");
  for (const v of views.views || []) add("view", v.id, v.name);
  for (const c of KCALC.calcs || []) add("calc", c.id, c.name);
  const learn = readJSON("kardia/learn/index.json");
  for (const [id, m] of Object.entries(learn.lessons || {})) add("lesson", id, m.title && m.title.en);
  const cases = readJSON("kardia/cases/index.json");
  for (const c of cases.cases || []) add("case", c.id, c.title);
  const byKindId = new Map(entries.map((e) => [e.kind + ":" + e.id, e]));
  for (const u of TEACH.UNITS || []) {
    for (const l of u.links || []) {
      if (!byKindId.has(l.kind + ":" + l.id)) errors.push("teach " + u.id + ": " + l.kind + "/" + l.id + " is not in the catalogue");
      if (!LINKS.link(l.kind, l.id)) errors.push("teach " + u.id + ": bad link " + l.kind + "/" + l.id);
    }
  }
  entries.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1));
  return { entries, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { entries, errors } = build();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const doc = { v: 1, review: "ai_drafted", counts, entries };
  writeFileSync(ROOT + "kardia/catalogue.json", JSON.stringify(doc, null, 1) + "\n");
  console.log("catalogue.json: " + entries.length + " entries " + JSON.stringify(counts));
}
