// Builds the Learn files the app reads from the content agents' unit files (authoring only; never shipped):
//   <dir>/units/<unitId>.json  -> <dir>/index.json      {v: 1, review, units: [{id, title, level, lessons}], lessons: {id: summary}}
//   unit glossaries            -> <dir>/glossary.json   {v: 1, review, terms} (a term two units define keeps the fuller
//                                 definition; every such collision is listed in the build output)
//   media/credits-<unitId>.json + ../explorer/credits.json -> <dir>/media/credits.json {v: 1, items} (one entry per media id;
//                                 file paths resolve against media/: "diagrams/x.svg" becomes "../diagrams/x.svg")
//   lesson competencies + competency-map.json + the OSCE pack -> docs/tokos/competency-coverage.md (see coverage())
// Units run in syllabus order, MBBS before Resident: ob1..ob12, gy1..gy12, obr1..obr8, gyr1..gyr8, then any other id.
// Every lesson must validate (specialty-data.js validateLesson) and every media file must exist with a permitted licence.
// Usage: node tools/tokos-learn-index.mjs [learnDir]   (default tokos/learn; narke/learn builds Narkē). Exit 1 on any error.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../specialty-data.js");
export const LICENCES = /^(CC0|CC BY \d\.\d|CC BY-SA \d\.\d|ODC-BY 1\.0|Public domain|Original, MAIKNOWLEDGE LLP|Original, StewardMD)$/;
const ORDER = ["ob", "gy", "obr", "gyr", "as", "asr"]; // Tokós, then Narkē (Anaesthesia) MBBS and Resident

export function unitKey(id) {
  const m = /^([a-z]+)(\d+)$/.exec(id), g = m ? ORDER.indexOf(m[1]) : -1;
  return g < 0 ? [9, 0, id] : [g, +m[2], id];
}
function cmp(a, b) { const x = unitKey(a), y = unitKey(b); return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0); }
// What a list needs before the lesson loads (the same summary Ophthalmós's learn index writes, plus test targets).
export function summary(l) {
  const out = { title: l.title, minutes: l.minutes, idea: l.idea, see: l.see.img ? { img: l.see.img } : { diagram: l.see.diagram } };
  const TK = ["clinic", "classes", "mcqTopic", "sim", "tool", "explorer"];
  if (l.test && TK.some((k) => k !== "classes" && l.test[k])) out.test = Object.fromEntries(TK.filter((k) => l.test[k] != null).map((k) => [k, l.test[k]]));
  if (l.review && l.review.verify) out.verify = l.review.verify; // the claims Review Desk lists first
  return out;
}
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

export function build(dir) {
  const errors = [], unitsDir = join(dir, "units"), mediaDir = join(dir, "media");
  const ids = existsSync(unitsDir) ? readdirSync(unitsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort(cmp) : [];
  const terms = {}, from = {}, collisions = [], items = {}, lessons = {}, units = [], comp = {};
  const size = (v) => JSON.stringify(v.def || "").length;
  for (const id of ids) {
    const u = readJSON(join(unitsDir, id + ".json"));
    if (u.id !== id) errors.push(`units/${id}.json: id ${u.id} does not match the file name`);
    for (const [k, v] of Object.entries(u.glossary || {})) {
      if (!terms[k]) { terms[k] = v; from[k] = id; continue; }
      if (JSON.stringify(terms[k]) === JSON.stringify(v)) continue;
      const keep = size(v) > size(terms[k]) ? id : from[k];
      collisions.push({ id: k, units: [from[k], id], kept: keep });
      if (keep === id) { terms[k] = v; from[k] = id; }
    }
    units.push({ id, title: u.title, level: u.level, lessons: u.lessons || [] });
  }
  const cf = existsSync(mediaDir) ? readdirSync(mediaDir).filter((f) => /^credits-[a-z0-9-]+\.json$/.test(f)).sort().map((f) => [join(mediaDir, f), ""]) : [];
  const ex = join(dir, "..", "explorer", "credits.json");
  if (existsSync(ex)) cf.push([ex, "../../explorer/"]);
  for (const [f, pre] of cf) for (const m0 of readJSON(f).items || []) {
    const m = { ...m0, file: pre + (/^diagrams\//.test(m0.file || "") ? "../" : "") + (m0.file || "") };
    if (items[m.id] && JSON.stringify(items[m.id]) !== JSON.stringify(m)) errors.push(`media ${m.id}: two different entries (${f})`);
    items[m.id] = m;
    if (!LICENCES.test(m.licence || "")) errors.push(`media ${m.id}: licence "${m.licence}" is not permitted`);
    if (!existsSync(join(mediaDir, m.file || ""))) errors.push(`media ${m.id}: file ${m.file} missing`);
  }
  for (const u of units) for (const lid of u.lessons) {
    const p = join(dir, "lessons", lid + ".json");
    if (!existsSync(p)) { errors.push(`${u.id}: lesson ${lid} missing`); continue; }
    const l = readJSON(p), e = D.validateLesson(l, terms, items);
    if (l.id !== lid) e.push("id does not match the file name");
    if (l.unit !== u.id || l.level !== u.level) e.push(`unit/level ${l.unit}/${l.level} do not match ${u.id}/${u.level}`);
    if (l.see && l.see.diagram && !existsSync(join(dir, l.see.diagram))) e.push(`${l.see.diagram} missing`);
    if (e.length) errors.push(`${lid}: ${e.join("; ")}`);
    else lessons[lid] = summary(l);
    for (const c of l.competencies || []) (comp[c] = comp[c] || []).push(lid);
  }
  const index = { v: 1, review: "ai_drafted", units, lessons };
  errors.push(...D.validateIndex(index).map((x) => "index: " + x));
  return { index, glossary: { v: 1, review: "ai_drafted", terms }, credits: { v: 1, items: Object.values(items) }, collisions, competencies: comp, errors };
}

// NMC OG competencies taught somewhere: a lesson listing the code in `competencies`, a shipped tool/drill/explorer/clinic the
// competency map names (items "tool:edd", "clinic:ctg" ...), or an O&G OSCE station tagged with the code. Unit-level map
// entries alone do not count (a unit named in the map may not have the lesson yet).
// Per host: the CliniX OSCE pack and the NMC competency code prefix it is tagged with.
export const HOSTS = { tokos: { name: "Tokós", pack: "clinix/systems/obgyn.json", code: "OG" }, narke: { name: "Narkē", pack: "clinix/systems/anaesthesia.json", code: "AS" } };
export function coverage(root, lessonComp, host = "tokos") {
  const J = (p) => readJSON(join(root, p)), H = HOSTS[host];
  const all = J(host + "/learn/competencies.json").items.map((x) => x.code), map = J(host + "/learn/competency-map.json").map;
  const osce = {};
  const pack = join(root, H.pack);
  if (existsSync(pack)) for (const c of readFileSync(pack, "utf8").match(new RegExp('"' + H.code + '\\d+\\.\\d+"', "g")) || []) osce[c.slice(1, -1)] = 1;
  const shipped = (it) => { const [k, id] = it.split(":"); return k === "clinic" ? existsSync(join(root, host + "/decks", id + ".json")) : existsSync(join(root, host + "-models", k + "-" + id + ".js")); };
  const rows = all.map((code) => {
    const m = map[code] || {}, les = lessonComp[code] || [], items = (m.items || []).filter(shipped), os = osce[code] ? ["OSCE"] : [];
    return { code, lessons: les, items, osce: !!osce[code], units: m.units || [], covered: !!(les.length || items.length || os.length) };
  });
  return { host, total: all.length, covered: rows.filter((r) => r.covered).length, byLesson: rows.filter((r) => r.lessons.length).length, rows };
}
export function coverageMd(c) {
  const pct = (n) => (100 * n / c.total).toFixed(1);
  const gaps = c.rows.filter((r) => !r.covered);
  const H = HOSTS[c.host || "tokos"];
  if (c.host === "narke") return `# Narkē: NMC CBME 2024 AS competency coverage\n\nGenerated by tools/tokos-learn-index.mjs; do not edit by hand. review: ai_drafted (the mapping is AI-drafted and goes to the clinical reviewer).\n\n` +
    `A competency counts as taught when a lesson lists it in \`competencies\`, a shipped tool, drill, explorer or clinic is mapped to it in narke/learn/competency-map.json, or an anaesthesia OSCE station (${H.pack}) is tagged with it.\n\n` +
    `- Taught: ${c.covered} of ${c.total} (${pct(c.covered)}%)\n- By at least one lesson: ${c.byLesson} of ${c.total} (${pct(c.byLesson)}%)\n- Not taught yet: ${gaps.length}\n\n` +
    `## Not taught yet\n\n| Code | Units named in the map |\n|---|---|\n` + gaps.map((r) => `| ${r.code} | ${r.units.join(", ") || "none"} |`).join("\n") +
    `\n\n## All competencies\n\n| Code | Lessons | Tools, drills, explorers, clinics | OSCE |\n|---|---|---|---|\n` +
    c.rows.map((r) => `| ${r.code} | ${r.lessons.join(", ")} | ${r.items.join(", ")} | ${r.osce ? "yes" : ""} |`).join("\n") + "\n";
  return `# Tokós: NMC CBME 2024 OG competency coverage\n\nGenerated by tools/tokos-learn-index.mjs; do not edit by hand. review: ai_drafted (the mapping is AI-drafted and goes to the clinical reviewer).\n\n` +
    `A competency counts as taught when a lesson lists it in \`competencies\`, a shipped tool, drill, explorer or clinic is mapped to it in tokos/learn/competency-map.json, or an O&G OSCE station (clinix/systems/obgyn.json) is tagged with it.\n\n` +
    `- Taught: ${c.covered} of ${c.total} (${pct(c.covered)}%)\n- By at least one lesson: ${c.byLesson} of ${c.total} (${pct(c.byLesson)}%)\n- Not taught yet: ${gaps.length}\n\n` +
    `## Not taught yet\n\n| Code | Units named in the map |\n|---|---|\n` + gaps.map((r) => `| ${r.code} | ${r.units.join(", ") || "none"} |`).join("\n") +
    `\n\n## All competencies\n\n| Code | Lessons | Tools, drills, explorers, clinics | OSCE |\n|---|---|---|---|\n` +
    c.rows.map((r) => `| ${r.code} | ${r.lessons.join(", ")} | ${r.items.join(", ")} | ${r.osce ? "yes" : ""} |`).join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || fileURLToPath(new URL("../tokos/learn/", import.meta.url));
  const r = build(dir);
  if (r.errors.length) { console.error(r.errors.join("\n")); process.exit(1); }
  const out = (p, o) => writeFileSync(join(dir, p), JSON.stringify(o, null, 1) + "\n");
  out("index.json", r.index); out("glossary.json", r.glossary);
  if (existsSync(join(dir, "media"))) out("media/credits.json", r.credits);
  const root = join(dir, "..", ".."), host = /narke[\\/]learn[\\/]?$/.test(dir) ? "narke" : "tokos";
  const hasComp = existsSync(join(root, host, "learn/competencies.json"));
  const cov = hasComp ? coverage(root, r.competencies, host) : { total: 0, covered: 0, byLesson: 0 };
  if (hasComp && existsSync(join(root, "docs"))) { mkdirSync(join(root, "docs", host), { recursive: true }); writeFileSync(join(root, "docs", host, "competency-coverage.md"), coverageMd(cov)); }
  for (const c of r.collisions) console.log(`glossary ${c.id}: defined in ${c.units.join(" and ")}, kept ${c.kept}`);
  console.log(`index.json: ${r.index.units.length} units, ${Object.keys(r.index.lessons).length} lessons; ${Object.keys(r.glossary.terms).length} terms; ${r.credits.items.length} media; competencies ${cov.covered}/${cov.total} (${cov.total ? (100 * cov.covered / cov.total).toFixed(1) : "0.0"}%), by lesson ${cov.byLesson}`);
}
