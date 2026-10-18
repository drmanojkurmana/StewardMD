#!/usr/bin/env node
/* Validates a CliniX disease pathway (or a system module) outside the manifest, with the same model the app uses plus the
   case, OSCE and teaching rules the shipped content follows.
   node tools/clinix-disease-validate.mjs clinix/diseases/<id>.json --packs core,paediatrics [--src book-section.txt ...] [--kb kb/reference/<id>.json]
   --packs: skill pack ids (from clinix/manifest.json skillPacks) whose skills the disease may reference.
   Exit 1 on any ERROR. Warnings are for the lead's review. */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = createRequire(import.meta.url)(join(ROOT, "clinix-model.js"));
const args = process.argv.slice(2); const files = []; const srcs = []; let packs = []; let kbFile = null; let moduleMode = false;
for (let i = 0; i < args.length; i++) { if (args[i] === "--packs") packs = args[++i].split(","); else if (args[i] === "--src") srcs.push(args[++i]); else if (args[i] === "--kb") kbFile = args[++i]; else if (args[i] === "--module") moduleMode = true; else files.push(args[i]); }
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const manifest = read(join(ROOT, "clinix/manifest.json")); const media = read(join(ROOT, "clinix/media/manifest.json")).media || {};
let errors = 0, warns = 0; let cur = "";
const err = (m) => { errors++; console.log(`ERROR ${cur}: ${m}`); }; const warn = (m) => { warns++; console.log(`warn  ${cur}: ${m}`); };
const shared = {}; for (const pid of packs) { const p = manifest.skillPacks.find((x) => x.id === pid); if (!p) { console.log(`unknown pack ${pid}`); process.exit(2); } Object.assign(shared, read(join(ROOT, "clinix", p.file)).skills); }
const srcText = srcs.map((f) => readFileSync(f, "utf8")).join("\n") + (kbFile && existsSync(kbFile) ? "\n" + readFileSync(kbFile, "utf8") : "");
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9% ]+/g, " ").split(/\s+/).filter(Boolean);
const shingles = (w, n = 7) => { const o = new Set(); for (let i = 0; i + n <= w.length; i++) o.add(w.slice(i, i + n).join(" ")); return o; };
const srcSet = srcText ? shingles(words(srcText)) : null; const nums = (t) => new Set(String(t).match(/\d+(?:\.\d+)?/g) || []); const srcNums = srcText ? nums(srcText) : null;
const OK_SRC = ["StewardMD Clinical KB", "Macleod", "Alagappan", "Harrison", "GOLD", "GINA", "WHO", "Indian Medical Council", "NMC", "FOGSI", "IAP", "Indian Academy of Pediatrics", "Williams Obstetrics", "Berek", "Nelson", "Bailey", "Dewhurst", "Oxford", "NICE", "RCOG", "ACOG", "ICMR", "MoHFW", "National Health Mission", "AAP", "Schwartz", "Sabiston", "Browse", "Russell", "ATLS"];
// every other shipped skill id, to refuse a duplicate definition
const known = {}; for (const pk of manifest.skillPacks) { const f = join(ROOT, "clinix", pk.file); if (existsSync(f)) for (const id of Object.keys(read(f).skills || {})) known[id] = pk.id; }
for (const f of files) {
  cur = f; let d; try { d = read(f); } catch (e) { err("invalid JSON: " + e.message); continue; }
  const isPack = !d.chapters; const local = d.skills || {}; const skills = Object.assign({}, shared, local);
  const ownPack = manifest.skillPacks.find((x) => f.replace(/\\/g, '/').endsWith('clinix/' + x.file));
  for (const id of Object.keys(local)) if (known[id] && !(ownPack && ownPack.id === known[id])) err(`skill id ${id} is already defined in pack ${known[id]}; do not redefine a shared skill (reference it)`);
  const v = M.validatePack({ skills, media, diseases: isPack ? [] : [d] }); v.errors.forEach(err);
  // identity
  if (isPack) { if (!d.system) err("pack needs system"); } else for (const k of ["id", "name", "fullName", "system", "kbRef", "oneLine", "estMinutes"]) if (d[k] == null || d[k] === "") err("missing " + k);
  if (d.review && d.review.status !== "ai_drafted") err('review.status must be "ai_drafted"');
  if (!moduleMode && d.kbRef && !existsSync(join(ROOT, "kb/reference", d.kbRef + ".json"))) warn(`kbRef ${d.kbRef} is not a file in kb/reference (use a real id)`);
  // chapters
  const ids = (d.chapters || []).map((c) => c.id); if (!isPack && !moduleMode && ids.length < 10) err(`only ${ids.length} chapters; a disease pathway has about 14`);
  if (!isPack && !moduleMode && !ids.includes("case")) err("no case chapter");
  for (const ch of d.chapters || []) { for (const s of ch.skills || []) if (!skills[s]) err(`chapter ${ch.id} lists unknown skill ${s}`); for (const e of Object.keys(ch.emphasis || {})) if (!(ch.skills || []).includes(e)) err(`chapter ${ch.id} emphasises ${e} which is not in the chapter`); }
  // skills
  const treatment = Object.values(local).filter((s) => s.kind === "treatment");
  if (!isPack && !moduleMode && !treatment.length) warn("no treatment skill");
  for (const [id, s] of Object.entries(local)) {
    if (s.teach && (s.sources || []).length < 2) err(`${id} teaches (has teach blocks) so it needs at least 2 sources (the KB entry plus one standard text or guideline)`);
    for (const x of s.sources || []) if (!OK_SRC.some((k) => String(x.source).includes(k))) (s.teach ? err : warn)(`${id} cites an unrecognised source "${x.source}"; use StewardMD Clinical KB (locator = kb file id and section) plus a standard text or guideline you are certain exists, never a private author`);
    if (!(s.sources || []).length) err(`${id} has no source`); for (const x of s.sources || []) if (!x.source || !x.locator || x.locator.length < 3) err(`${id} source needs source and locator`);
    if (s.kind === "treatment" && !(s.dosingNote && s.dosingNote.indexOf("does not prescribe") > 0)) err(`${id} treatment skill needs the dosingNote that says CliniX does not prescribe`);
    if ((s.kind === "exam" || s.kind === "general_exam") && !((s.pitfalls || []).length)) err(`${id} exam skill needs at least one named common mistake in pitfalls`);
    if (!(s.probes || []).length) warn(`${id} has no probes (viva questions)`);
    for (const b of s.teach || []) { for (const para of String(b.body || "").split(/\n\s*\n/)) if (para.trim().length > 460) err(`${id} block "${b.heading}" has a ${para.trim().length}-char paragraph (max 460, break it)`); if (b.table && b.table.cols.length > 4) err(`${id} table "${b.heading}" has more than 4 columns`); }
    if (s.teach && s.teach.length < 2) err(`${id} has fewer than 2 teaching blocks`);
  }
  // OSCE and viva
  const st = (d.osce && d.osce.stations) || []; if (!isPack && !moduleMode && st.length < 2) err("need at least 2 OSCE stations");
  for (const s of st) { for (const k of s.skills || []) if (!skills[k]) err(`station ${s.id} unknown skill ${k}`); if (!(s.seconds >= 240 && s.seconds <= 900)) warn(`station ${s.id} seconds ${s.seconds} outside 240 to 900`); if ((s.examinerQuestions || []).length < 3) warn(`station ${s.id} has fewer than 3 examiner questions`); }
  for (const k of (d.viva && d.viva.skills) || []) if (!skills[k]) err(`viva unknown skill ${k}`);
  if (!isPack && !moduleMode && ((d.viva && d.viva.skills) || []).length < 6) warn("viva has fewer than 6 skills");
  // cases
  if (!isPack && !moduleMode && !(d.cases || []).length) err("no simulated-patient case");
  for (const c of d.cases || []) {
    const w = `case ${c.id}`;
    for (const k of ["id", "initialVitals", "title", "opening", "fallback", "patient", "history", "exam", "essentialInvestigations", "investigations", "differentialModel", "diagnosis", "managementModel", "teachingPoints"]) if (c[k] == null) err(`${w} missing ${k}`);
    const p = c.patient || {}; for (const k of ["name", "age", "sex", "occupation", "residence"]) if (p[k] == null) err(`${w} patient.${k} missing`);
    const hist = c.history || {}; const hk = Object.keys(hist); if (hk.length < 12) warn(`${w} has only ${hk.length} history topics (medicine cases have about 19)`);
    if (!hist.presenting) err(`${w} history needs a "presenting" topic`);
    for (const [k, t] of Object.entries(hist)) { if (!Array.isArray(t.cues) || t.cues.length < 2) err(`${w} history.${k} needs at least 2 cues`); if (!t.reply || t.reply.length < 8) err(`${w} history.${k} needs a reply`); }
    for (const [k, t] of Object.entries(c.exam || {})) { if (!skills[k]) err(`${w} exam finding keyed to unknown skill ${k}`); if (!t.finding || typeof t.abnormal !== "boolean") err(`${w} exam.${k} needs finding and abnormal`); }
    const inv = c.investigations || {}; for (const k of c.essentialInvestigations || []) if (!inv[k]) err(`${w} essential investigation ${k} not defined`);
    for (const [k, t] of Object.entries(inv)) for (const f2 of ["label", "result", "note"]) if (!t[f2]) err(`${w} investigation ${k} missing ${f2}`);
    for (const m of ["differentialModel", "diagnosis", "managementModel"]) { const o = c[m] || {}; if (!o.answer || !Array.isArray(o.accept) || o.accept.length < 2) err(`${w} ${m} needs answer and accept[] of at least 2`); }
    if ((c.teachingPoints || []).length < 3) err(`${w} needs at least 3 teachingPoints`);
    if (c.review && c.review.status !== "ai_drafted") err(`${w} review.status must be ai_drafted`);
  }
  // text hygiene, copy, numbers
  const all = JSON.stringify(d); if (/[–—‒―]/.test(all)) err("em or en dash in content (use a comma, colon or hyphen)"); if (/lorem ipsum/i.test(all)) err("lorem ipsum");
  if (/Dr\.? [A-Z][a-z]+ (?:Das|Dutta|Ghai|Meharban)/.test(all)) warn("a private author name may appear; cite the standard texts only");
  if (srcSet) { const sh = shingles(words(all)); let hit = 0; for (const s of sh) if (srcSet.has(s)) hit++; const r = sh.size ? hit / sh.size : 0; if (r > 0.45) err(`${Math.round(r * 100)}% of 7-word sequences copied from the sources`); else if (r > 0.25) warn(`${Math.round(r * 100)}% of 7-word sequences match the sources`); }
  if (srcNums) { const bad = [...nums(all)].filter((n) => n.length > 2 && !srcNums.has(n)); if (bad.length > 25) warn(`${bad.length} numbers are not in the sources (check for invention): ${bad.slice(0, 15).join(", ")}`); }
  console.log(`${f}: ${Object.keys(local).length} own skills, ${(d.cases || []).length} case(s), ${st.length} station(s), ${(d.chapters || []).length} chapters`);
}
console.log(`${errors} errors, ${warns} warnings`); process.exit(errors ? 1 : 0);
