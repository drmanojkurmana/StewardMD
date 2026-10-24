// Builds kardia/learn/index.json from kardia/learn/lessons/<id>.json.
// Units are the seven echo areas. Teaching order comes from learn/order.json.
// Every lesson is validated with the engine
// schema in specialty-data.js (validateLesson), plus Kardia checks: the id
// uses underscores with an area prefix, levels is the four level array, the
// engine level is mbbs or resident, minutes is present, check is the only
// self check key, and any view reference exists in kardia/views.json.
// Usage: node tools/kardia-learn-index.mjs [learnDir]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../specialty-data.js");
export const UNITS = [
  { id: "views", title: { en: "Views", hi: "Views" }, level: "mbbs" },
  { id: "tee", title: { en: "TEE", hi: "TEE" }, level: "mbbs" },
  { id: "pocus", title: { en: "POCUS", hi: "POCUS" }, level: "mbbs" },
  { id: "measurements", title: { en: "Measurements", hi: "Measurements" }, level: "mbbs" },
  { id: "doppler", title: { en: "Doppler", hi: "Doppler" }, level: "mbbs" },
  { id: "knobology", title: { en: "Knobology", hi: "Knobology" }, level: "mbbs" },
  { id: "pathology", title: { en: "Pathology", hi: "Pathology" }, level: "mbbs" }
];
const VALID_LEVELS = ["mbbs", "resident", "fellow", "sonographer"];
const ID_RE = /^(view|tte|tee|pocus|meas|dop|knob|path)_[a-z0-9_]+$/;
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

export function summary(l) {
  const out = { title: l.title, minutes: l.minutes, idea: l.idea, see: l.see, levels: l.levels, level: l.level };
  if (l.view) out.view = l.view;
  if (l.test) out.test = l.test;
  return out;
}

export function build(dir) {
  const errors = [];
  const lessonsDir = join(dir, "lessons");
  const ids = existsSync(lessonsDir) ? readdirSync(lessonsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
  const viewsDoc = readJSON(join(dir, "..", "views.json"));
  const viewIds = new Set(viewsDoc.views.map((v) => v.id));
  let glossary = {};
  try { glossary = readJSON(join(dir, "glossary.json")).terms || {}; } catch (e) {}
  const lessons = {};
  const members = {};
  const unitOf = {};
  UNITS.forEach((u) => { members[u.id] = []; });
  let order = null;
  const orderPath = join(dir, "order.json");
  if (!existsSync(orderPath)) errors.push("order.json missing in " + dir);
  else {
    try { order = readJSON(orderPath); }
    catch (e) { errors.push("order.json unreadable: " + e.message); }
  }
  for (const lid of ids) {
    const l = readJSON(join(lessonsDir, lid + ".json"));
    const e = D.validateLesson(l, glossary, null);
    if (e.length) errors.push(lid + ": " + e.join("; "));
    if (l.id !== lid) errors.push(lid + ": id does not match the file name");
    if (!ID_RE.test(l.id || "")) errors.push(lid + ": bad id, expected an underscore area prefix");
    if (!Array.isArray(l.levels) || !l.levels.length) errors.push(lid + ": levels must be a non empty array");
    else for (const lv of l.levels) if (VALID_LEVELS.indexOf(lv) < 0) errors.push(lid + ": bad level " + lv);
    if (!(l.minutes > 0)) errors.push(lid + ": minutes missing");
    if (!Array.isArray(l.check) || !l.check.length) errors.push(lid + ": check missing");
    if (l.questions) errors.push(lid + ": questions key must be converted to check");
    if ((l.review && l.review.status ? l.review.status : l.review) !== "ai_drafted") errors.push(lid + ": review must be ai_drafted");
    if (l.view && !viewIds.has(l.view)) errors.push(lid + ": view " + l.view + " missing from views.json");
    if (l.see && l.see.view && !viewIds.has(l.see.view)) errors.push(lid + ": see.view " + l.see.view + " missing from views.json");
    if (l.see && l.see.diagram && !existsSync(join(dir, l.see.diagram))) errors.push(lid + ": diagram " + l.see.diagram + " missing");
    if (!members[l.unit]) { errors.push(lid + ": unknown unit " + l.unit); continue; }
    members[l.unit].push(lid);
    unitOf[lid] = l.unit;
    lessons[lid] = summary(l);
  }
  if (order && typeof order === "object") {
    const known = new Set(ids);
    const seen = new Set();
    for (const u of UNITS) {
      const list = order[u.id];
      if (!Array.isArray(list)) { errors.push("order.json: unit " + u.id + " missing or not a list"); continue; }
      const next = [];
      for (const lid of list) {
        if (seen.has(lid)) { errors.push("order.json: duplicate lesson " + lid); continue; }
        seen.add(lid);
        if (!known.has(lid)) { errors.push("order.json: unknown lesson " + lid); continue; }
        if (unitOf[lid] && unitOf[lid] !== u.id) { errors.push("order.json: " + lid + " listed under " + u.id + " but belongs to " + unitOf[lid]); continue; }
        next.push(lid);
      }
      members[u.id] = next;
    }
    for (const key of Object.keys(order)) {
      if (!UNITS.some((u) => u.id === key)) errors.push("order.json: unknown unit " + key);
    }
    for (const lid of ids) {
      if (!seen.has(lid)) errors.push("order.json: lesson missing " + lid);
    }
  }
  const units = UNITS.map((u) => ({ id: u.id, title: u.title, level: u.level, lessons: members[u.id] }));
  const index = { v: 1, review: "ai_drafted", units, lessons };
  const ve = D.validateIndex(index);
  if (ve.length) errors.push("index: " + ve.join("; "));
  return { index, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || fileURLToPath(new URL("../kardia/learn/", import.meta.url));
  const r = build(dir);
  if (r.errors.length) { console.error(r.errors.join("\n")); process.exit(1); }
  writeFileSync(join(dir, "index.json"), JSON.stringify(r.index, null, 1) + "\n");
  console.log("index.json: " + r.index.units.length + " units, " + Object.keys(r.index.lessons).length + " lessons");
}
