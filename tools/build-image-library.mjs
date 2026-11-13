/* build-image-library.mjs - ONE central image bank index for the Image Library.
 * Reads every captioned image source in the app (no hand copying, no image files
 * duplicated) and writes a compact per-system index:
 *   kb/dist/imglib/index.json    { v, total, systems: [{slug,name,count,sample}] }
 *   kb/dist/imglib/<slug>.json   { v, system, name, items: [entry, ...] }
 * Entry: { s src, t title, c caption, a alt, ar, k kind, o origin, f from,
 *          ri ref id, rn ref name, cr credit, li licence, lk link kind }
 * Caption rule: caption, else alt, else title/finding text. Never invented.
 * Run: node tools/build-image-library.mjs [--out <dir>] [--quiet]
 * Pure helpers are exported for test/image-library.test.mjs. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placement } from "../kb/tools/kb-placement.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function slugify(name) {
  return String(name || "other").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
}
export function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
export function captionOf(o) {
  return clean(o.caption) || clean(typeof o.alt === "object" ? (o.alt && o.alt.en) : o.alt) ||
    clean(o.finding) || clean(o.title) || clean(o.dx) || clean(o.name) || "";
}
export function kindOf(text, fallback) {
  const t = String(text || "").toLowerCase();
  if (/\becg\b|electrocardiogram/.test(t)) return "ECG";
  if (/\boct\b|optical coherence/.test(t)) return "OCT";
  if (/fundus|retinal photograph/.test(t)) return "Fundus";
  if (/x-ray|xray|radiograph|chest film/.test(t)) return "X-ray";
  if (/\bct\b|computed tomography/.test(t)) return "CT";
  if (/\bmri\b|magnetic resonance/.test(t)) return "MRI";
  if (/ultrasound|sonograph|echocardiogram|\becho\b/.test(t)) return "Ultrasound";
  if (/histolog|biopsy|microscop/.test(t)) return "Histology";
  if (/slit lamp|slit-lamp/.test(t)) return "Slit lamp";
  return fallback || "Illustration";
}
/* Commons descriptions: drop the gallery cross-links some uploaders append ("Related images: Low mag. High mag.")
 * and the space wiki markup leaves before punctuation. Wording is otherwise the uploader's. */
export function tidyCommonsCaption(s) {
  return clean(s).replace(/\s*\bRelated images?\b[\s\S]*$/i, "").replace(/\s+([.,;:])/g, "$1").trim();
}
/* A Commons file name is the title unless it is mostly codes ("Dsrct1", "Dabska histo2"); then the opening words
 * of the uploader's caption stand in, cut at a sentence or clause end. */
export function commonsTitle(title, caption) {
  const t = clean(title), words = t.split(/[\s,]+/).filter((w) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(w));
  if (words.length >= 2) return t;
  const c = clean(caption).replace(/^(this|the) (image|picture|photo|micrograph) (shows|is)\s+/i, "");
  const first = c.split(/(?<=[a-z)])\.\s|;\s/)[0];
  const cut = first.length <= 70 ? first : first.slice(0, 70).replace(/[\s,]+\S*$/, "");
  return (cut.charAt(0).toUpperCase() + cut.slice(1)).replace(/[.,;:]$/, "") || t;
}
/* Commons thumbnails come from upload. or thumb.wikimedia.org; the API adds utm tracking parameters, dropped here. */
export function commonsSrc(src) {
  const u = String(src || "");
  return /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(u) ? u.replace(/\?.*$/, "") : "";
}
export function originOf(text) {
  const t = String(text || "");
  if (/wikimedia|commons\.wikimedia|upload\.wikimedia/i.test(t)) return "commons";
  if (/stewardmd|maik/i.test(t)) return "stewardmd";
  return "other";
}
/* Resolve a bank path (v1/...) or root path the way kb-figure.js imgUrl does. */
export function bankUrl(src) {
  const p = String(src || "").replace(/^\/+/, "");
  return /^v\d{1,3}\//.test(p) ? "/api/prep/bank/" + p : "/" + p;
}
function normJoin(base, file) {
  const parts = (base + "/" + file).split("/");
  const out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return "/" + out.join("/");
}
const STOP = new Set(["the", "and", "of", "in", "with", "for", "to", "a", "an", "on", "by", "from", "its", "case", "long", "short"]);
function words(t) { return new Set(String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !STOP.has(x))); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function listJSON(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
}
/* Extract a top-level JS array literal assigned to `name` from a content file. */
function jsArray(file, name) {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(new RegExp("var " + name + " = (\\[[\\s\\S]*?\\]);"));
  if (!m) return [];
  return JSON.parse(m[1]);
}

const SYS_DISPLAY = { eye: "Eye", cardiology: "Cardiology" };
function sysName(slug, raw) { return SYS_DISPLAY[slug] || clean(raw) || slug; }
/* Canonical first level: source system strings are free text (500+ variants), so
 * every source is folded into one specialty list the phone can show. */
export function canonicalSystem(raw) {
  const t = String(raw || "").toLowerCase();
  if (/\bpsych|\bmental\b|behavioral|behavioural|substance/.test(t)) return "Psychiatry";
  if (/neuro|nervous|brain|spinal|neuromuscular|epilep/.test(t)) return "Neurology";
  if (/ophthalm|eye|visual|retin|ocular/.test(t)) return "Eye";
  if (/cardio|vascular|heart|hypertens/.test(t)) return "Cardiology";
  if (/respir|pulmon|thorac|lung|airway|sleep/.test(t)) return "Respiratory";
  if (/\brenal\b|nephro|genitourinary|urolog|kidney|urinary/.test(t)) return "Renal and Urology";
  if (/gastro|hepat|biliary|intestinal|colorectal|pancrea|anorectal|peritoneum|abdominal/.test(t)) return "Gastroenterology";
  if (/endocrin|metabol|diabet|thyroid|adrenal|pituitary|genetic/.test(t)) return "Endocrine and Metabolic";
  if (/infect|microbiol|parasit|tropical|viral|bacterial|mycos|spirochet|helminth/.test(t)) return "Infectious Diseases";
  if (/haem|hemat|blood|transfusion|reticuloendothelial/.test(t)) return "Haematology";
  if (/oncol|cancer|malignan|sarcoma|tumour|tumor|leukaem|leukem|lymphoma/.test(t)) return "Oncology";
  if (/musculo|orthopaed|rheumat|bone|joint|spine|skeletal|connective tissue|hand and peripheral/.test(t)) return "Orthopaedics and Rheumatology";
  if (/skin|dermat|integument|tricholog|nail/.test(t)) return "Dermatology";
  if (/obstetric|gynaec|gynec|reproductive|women|fetal|placent/.test(t)) return "Obstetrics and Gynaecology";
  if (/paediatric|pediatric|child|neonat|infant/.test(t)) return "Paediatrics";
  if (/anaesthe|anesthe/.test(t)) return "Anaesthesia";
  if (/emergency|critical care|trauma|intensive/.test(t)) return "Emergency and Critical Care";
  if (/radiolog|imaging|radiodiagnosis/.test(t)) return "Radiology";
  if (/\bent\b|otorhino|ear|nose|throat|laryng|audiolog|salivary|maxillofacial|dental|oral/.test(t)) return "ENT and Head and Neck";
  if (/forensic|toxicolog|envenomation|occupational|environmental/.test(t)) return "Forensic and Toxicology";
  if (/community|population|epidemiolog|biostatistic|statistics|public health|health promotion|preventive/.test(t)) return "Community Medicine";
  if (/anatomy|embryolog/.test(t)) return "Anatomy";
  if (/physiolog/.test(t)) return "Physiology";
  if (/biochem|molecular|cellular|lipid|nutrition/.test(t)) return "Biochemistry";
  if (/pharmacolog/.test(t)) return "Pharmacology";
  if (/patholog|laboratory medicine|immunolog|allergy|immune/.test(t)) return "Pathology and Immunology";
  if (/clinical skills|professional behaviours/.test(t)) return "Clinical Skills";
  if (/surger|surgical|operative|transplant|plastic|breast|general surgery/.test(t)) return "Surgery";
  if (/medicine|medical|internal|chronic|acute care|geriatric|multisystem|systemic|rehabilitation|palliative|functional/.test(t)) return "Medicine";
  return "Medicine";
}

export function buildAll(root = ROOT) {
  const items = [];
  const seen = new Set();
  let dupes = 0;
  const push = (e) => {
    if (!e.s || !e.c) return;
    if (seen.has(e.s)) { dupes++; return; }
    seen.add(e.s);
    items.push(e);
  };
  const taxSubjects = {};
  const tax = readJSON(path.join(root, "prep/taxonomy.json"));
  if (tax) for (const b of tax.branches || []) for (const s of b.subjects || []) {
    taxSubjects[s.id] = typeof s.name === "object" ? s.name.en : s.name;
  }
  const subjectName = (id) => taxSubjects[id] || String(id || "General").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  /* Where every image can be read (owner 2026-11-13): the PrepNucleus lesson that shows it (opened for Pro) and the
     Knowledge Library article that holds it (kb-placement.mjs: the shipped article, never a bare unbundled page).
     Lessons reuse KB figure files, so both are keyed by the image URL. */
  const P = placement(root);
  const lessonBySrc = new Map(), articleBySrc = new Map();
  for (const f of listJSON(path.join(root, "prep/lessons/v1"))) {
    if (f === "index.json") continue;
    const d = readJSON(path.join(root, "prep/lessons/v1", f));
    if (!d || !Array.isArray(d.steps) || !d.module || !d.subject) continue;
    d.steps.forEach((st, i) => {
      const v = st && st.vis;
      if (!v || v.kind !== "image" || !v.src) return;
      const u = bankUrl(v.src);
      if (!lessonBySrc.has(u)) lessonBySrc.set(u, []);
      lessonBySrc.get(u).push({ ls: f.replace(/\.json$/, ""), lm: d.module, lsj: d.subject, lst: i, words: words(d.title) });
    });
  }
  for (const dir of ["kb/diseases", "kb/reference"]) {
    for (const f of listJSON(path.join(root, dir))) {
      const d = readJSON(path.join(root, dir, f));
      if (!d || !d.id || !Array.isArray(d.figures)) continue;
      const t = P.target(d.id); if (!t) continue;
      for (const fig of d.figures) if (fig && fig.type === "image" && fig.src) { const u = bankUrl(fig.src); if (!articleBySrc.has(u) || t === d.id) articleBySrc.set(u, t); }
    }
  }
  // Several lessons can reuse one image: the one whose title shares most words with the image's title and caption.
  const links = (u, text) => {
    const o = {}, all = lessonBySrc.get(u) || [], ka = articleBySrc.get(u), w = words(text);
    let ls = null, best = -1;
    for (const l of all) { let n = 0; for (const x of l.words) if (w.has(x)) n++; if (n > best) { best = n; ls = l; } }
    if (ls) { o.ls = ls.ls; o.lm = ls.lm; o.lsj = ls.lsj; o.lst = ls.lst; }
    if (ka) { o.ka = ka; o.kn = clean(P.name(ka)); }
    return o;
  };
  const push0 = push;
  const pushL = (e) => push0(Object.assign(e, links(e.s, e.t + " " + e.c + " " + (e.rn || ""))));

  /* 1. Knowledge Library figures (kb/reference + kb/diseases figures[] type image) */
  for (const dir of ["kb/reference", "kb/diseases"]) {
    for (const f of listJSON(path.join(root, dir))) {
      const d = readJSON(path.join(root, dir, f));
      if (!d || !Array.isArray(d.figures)) continue;
      const system = canonicalSystem(clean(d.system) || "General");
      for (const fig of d.figures) {
        if (!fig || fig.type !== "image" || !/^v\d{1,3}\/kb\/media\/[a-z0-9-]{2,80}\.webp$/.test(String(fig.src || ""))) continue;
        const cap = captionOf(fig);
        if (!cap) continue;
        pushL({ s: bankUrl(fig.src), t: clean(fig.title) || clean(d.name), c: cap, a: clean(fig.alt),
          ar: Number(fig.ar) || null, k: kindOf(fig.title + " " + cap, "Illustration"),
          o: originOf(fig.caption + " " + (fig.licence || "")), f: "Library", ri: d.id, rn: clean(d.name),
          cr: "", li: "", lk: "kb", sys: slugify(system), sysName: sysName(slugify(system), system) });
      }
    }
  }

  /* 2. PrepNucleus lesson images (prep/lessons/v1 steps vis kind image) */
  for (const f of listJSON(path.join(root, "prep/lessons/v1"))) {
    if (f === "index.json") continue;
    const d = readJSON(path.join(root, "prep/lessons/v1", f));
    if (!d || !Array.isArray(d.steps)) continue;
    const system = canonicalSystem(subjectName(d.subject));
    d.steps.forEach((st, i) => {
      const v = st && st.vis;
      if (!v || v.kind !== "image" || !v.src) return;
      const cap = captionOf(v);
      if (!cap) return;
      pushL({ s: bankUrl(v.src), t: clean(d.title), c: cap, a: clean(v.alt), ar: Number(v.ar) || null,
        k: kindOf(cap, "Illustration"), o: originOf(cap), f: "Lessons", ri: d.module || f.replace(/\.json$/, ""),
        rn: clean(d.title), cr: "", li: "", lk: "lesson", sys: slugify(system), sysName: system, step: i });
    });
  }

  /* 3. ECG library (KardiqX base 100 + textbook pack, the prep-imglearn ECG atlas) */
  for (const [file, name] of [["kardiox-content.js", "ECGS"], ["kardiox-content-pack.js", "PACK"]]) {
    let list = [];
    try { list = jsArray(path.join(root, file), name); } catch { list = []; }
    for (const e of list) {
      if (!e || !e.ecgImage) continue;
      const cap = clean(e.pearl) || clean((e.diagnosticCriteria || [])[0]) || clean(e.overview) || clean(e.title);
      if (!cap) continue;
      push({ s: e.ecgImage, t: clean(e.title), c: cap, a: clean(e.title), ar: null, k: "ECG", o: "other",
        f: "ECG library", ri: e.id, rn: clean(e.title), cr: clean((e.references || [])[0] || e.source || ""),
        li: "", lk: "ecg", sys: "cardiology", sysName: "Cardiology" });
    }
  }

  /* 4. Eye atlas + PSM chart atlas (prep-imglearn manifests, R2 maikimg bank) */
  for (const [file, from, lk] of [["prep/imglearn/eye.json", "Eye atlas", "eye"], ["prep/imglearn/psm.json", "Chart atlas", "prep"]]) {
    const m = readJSON(path.join(root, file));
    for (const c of (m && m.items) || []) {
      if (!c || !c.img) continue;
      const cap = captionOf({ caption: c.reason, finding: c.finding, title: c.dx });
      if (!cap) continue;
      push({ s: "/api/prep/bank/img/maikimg/" + c.img, t: clean(c.dx), c: cap, a: clean(c.dx), ar: null,
        k: kindOf(c.modality + " " + c.dx, "Clinical photo"), o: originOf((c.credit || "") + " " + (c.licence || "")),
        f: from, ri: c.img, rn: clean(c.dx), cr: clean(c.credit), li: clean(c.licence), lk,
        sys: from === "Eye atlas" ? "eye" : "community-medicine",
        sysName: from === "Eye atlas" ? "Eye" : "Community Medicine" });
    }
  }

  /* 5. Specialty learn media (credits.json): Ophthalmós, Tokós, Narkē */
  const LEARN = [
    ["ophthalmos/learn/media/credits.json", "/ophthalmos/learn/media", "Ophthalmós", "eye", "Eye", "ophthalmos"],
    ["tokos/learn/media/credits.json", "/tokos/learn/media", "Tokós", "obstetrics-and-gynaecology", "Obstetrics and Gynaecology", "tokos"],
    ["narke/learn/media/credits.json", "/narke/learn/media", "Narkē", "anaesthesia", "Anaesthesia", "narke"],
  ];
  for (const [file, base, from, sys, name, lk] of LEARN) {
    const d = readJSON(path.join(root, file));
    for (const m of (d && d.items) || []) {
      if (!m || !m.file) continue;
      const cap = captionOf(m);
      if (!cap) continue;
      const en = (x) => clean(typeof x === "object" ? (x && x.en) : x);
      push({ s: normJoin(base, m.file), t: en(m.caption).slice(0, 80) || m.id, c: cap, a: en(m.alt),
        ar: m.w && m.h ? +(m.w / m.h).toFixed(4) : null,
        k: kindOf(en(m.alt) + " " + cap, m.kind === "photo" ? "Clinical photo" : "Illustration"),
        o: originOf((m.source || "") + " " + (m.author || "") + " " + (m.licence || "")),
        f: from, ri: m.id, rn: en(m.caption).slice(0, 80) || m.id, cr: clean(m.author), li: clean(m.licence),
        lk, sys, sysName: name });
    }
  }

  /* 6. CliniX skill images (only licence-cleared, file-backed media) */
  const cx = readJSON(path.join(root, "clinix/media/manifest.json"));
  for (const id of Object.keys((cx && cx.media) || {})) {
    const m = cx.media[id];
    if (!m || m.kind !== "image" || !m.src || m.cleared !== true) continue;
    const cap = captionOf(m);
    if (!cap) continue;
    push({ s: m.src, t: cap.slice(0, 80), c: cap, a: cap, ar: null, k: kindOf(cap, "Clinical photo"),
      o: originOf((m.sourceUrl || "") + " " + (m.attribution || "") + " " + (m.licence || "")),
      f: "CliniX", ri: id, rn: cap.slice(0, 80), cr: clean(m.attribution), li: clean(m.licence),
      lk: "clinix", sys: "clinical-skills", sysName: "Clinical Skills" });
  }

  /* 7. PrepNucleus pearl figures (our own SVGs with credits) */
  const pearl = readJSON(path.join(root, "prep/pearl-figs/credits.json"));
  for (const c of Array.isArray(pearl) ? pearl : []) {
    if (!c || !c.id) continue;
    const system = canonicalSystem(subjectName(c.subject));
    push({ s: "/prep/pearl-figs/" + c.id, t: clean(c.title), c: clean(c.title), a: clean(c.title), ar: null,
      k: "Illustration", o: "stewardmd", f: "Pearls", ri: c.id, rn: clean(c.title),
      cr: clean(c.author), li: clean(c.licence), lk: "prep", sys: slugify(system), sysName: system });
  }

  /* 8. Openly licensed pathology and histology micrographs from Wikimedia Commons (tools/fetch-commons-pathology.mjs:
   *    CC BY, CC BY-SA, CC0 or public domain only; the uploader's own English description is the caption). The
   *    viewer shows author and licence and links to the Commons file page, which is the attribution CC BY asks for. */
  const COMMONS_BUDGET = 680 * 1024, sysBytes = new Map();
  for (const it of items) sysBytes.set(it.sys, (sysBytes.get(it.sys) || 0) + JSON.stringify(it).length);
  const cp = readJSON(path.join(root, "kb/imglib/commons-pathology.json"));
  for (const m of (cp && cp.items) || []) {
    const src = commonsSrc(m && m.src);
    if (!src || !m.licence || !/^https:\/\/commons\.wikimedia\.org\//.test(String(m.page || ""))) continue;
    const cap = tidyCommonsCaption(m.caption);
    if (cap.length < 20) continue;
    const system = clean(m.system) || "Pathology and Immunology";
    /* Title stands in for alt and ref name (the viewer falls back to it), and each system file keeps a byte budget
     * so the per-system download stays phone-sized: the in-app sources fill first, Commons tops up. */
    const e = { s: src, t: commonsTitle(m.title, cap), c: cap, ar: m.w && m.h ? +(m.w / m.h).toFixed(3) : null,
      k: clean(m.kind) || "Histopathology", o: "commons", f: m.kind === "Histology" ? "Commons histology" : "Commons pathology",
      cr: tidyCommonsCaption(m.author).slice(0, 100), li: clean(m.licence), lk: "commons", u: m.page,
      sys: slugify(system), sysName: sysName(slugify(system), system) };
    const len = JSON.stringify(e).length;
    if ((sysBytes.get(e.sys) || 0) + len > COMMONS_BUDGET) continue;
    sysBytes.set(e.sys, (sysBytes.get(e.sys) || 0) + len);
    push(e);
  }

  /* Group by system, stable order: count desc, then name. */
  const bySys = new Map();
  for (const e of items) {
    if (!bySys.has(e.sys)) bySys.set(e.sys, { slug: e.sys, name: e.sysName, items: [] });
    bySys.get(e.sys).items.push(e);
  }
  const systems = [...bySys.values()].map((g) => ({
    slug: g.slug, name: g.name, count: g.items.length, sample: g.items[0] ? g.items[0].s : "",
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const bySystem = {};
  for (const g of bySys.values()) bySystem[g.slug] = g.items.map(({ sys, sysName, ...rest }) => rest);
  return { total: items.length, dupes, systems, bySystem };
}

export function writeIndex(outDir, data) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith(".json")) fs.unlinkSync(path.join(outDir, f));
  const index = { v: 1, total: data.total, systems: data.systems };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));
  const sizes = {};
  for (const s of data.systems) {
    const body = JSON.stringify({ v: 1, system: s.slug, name: s.name, items: data.bySystem[s.slug] });
    fs.writeFileSync(path.join(outDir, s.slug + ".json"), body);
    sizes[s.slug] = Buffer.byteLength(body);
  }
  return sizes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const oi = process.argv.indexOf("--out");
  const outDir = oi >= 0 ? path.resolve(process.argv[oi + 1]) : path.join(ROOT, "kb/dist/imglib");
  const data = buildAll(ROOT);
  const sizes = writeIndex(outDir, data);
  if (!process.argv.includes("--quiet")) {
    console.log(`image-library: ${data.total} images, ${data.dupes} duplicates skipped, ${data.systems.length} systems`);
    for (const s of data.systems) console.log(`  ${s.slug}: ${s.count} (${Math.round(sizes[s.slug] / 1024)} KB)`);
    console.log(`  index.json: ${Math.round(fs.statSync(path.join(outDir, "index.json")).size / 1024)} KB -> ${outDir}`);
  }
}
