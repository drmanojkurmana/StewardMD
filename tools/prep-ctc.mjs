#!/usr/bin/env node
// PrepNucleus CTC: a scanned two-volume radiology review book (US board level) -> NEET-SS (srd-*) and NEET-PG (rad-*)
// MCQs, Learn lessons with the book's own figures, all checked. Dev-only, never shipped. COSTS MONEY (Vertex Batch,
// gemini-3.1-flash-lite) only through the radmax / radbook `run` commands it drives, never in `units` or `book catalog`.
//
// HOLD: the book's use needs the author's signed permission. Until the lead confirms it, nothing built here may be
// uploaded, merged or shipped: no R2 upload, no OTA. `book upload` refuses.
//
// PRIVATE DATA: the PDF, its page text, its figures and every generated item or lesson live under --dir (default
// ~/prep-data/radnotes/ctc). This file holds only page ranges and module mapping, no book text (the repo is public).
//
//   python3 -P tools/prep-ctc-figs.py --pdf <dir>/ctc.pdf        figure crops from the page images -> figs.ctc.json
//   (page text: <dir>/src/ctc.pages.json, [{ p, t, chars }], PyMuPDF get_text of the OCR layer)
//   node tools/prep-ctc.mjs book catalog|dry-run|run --part figqa|outline|lessons|quiz|votes-prep|votes-apply|assemble
//       the radbook lesson pipeline on this book (dir <dir>/book); figqa also feeds the image MCQs
//   node tools/prep-ctc.mjs units [--no-img]                     MCQ units (page windows x bank, figures) -> work/units.json
//   PREP_RADMAX_LOG=<dir>/work/log.tsv node tools/prep-radmax.mjs dry-run|run --dir <dir> --run R --idp ct- ...
//   node tools/prep-radmax.mjs haiku-prep|assemble --dir <dir> ... --set radmax3     (see the radmax header)
//   node tools/prep-ctc.mjs finish [--mcq out/mcq]               blurred figures into the bank, counts per module and level
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanText, parseModelJson } from "../functions/_prep-core.js";
import { cleanPage, segments, slate, itemsFor, RAD_MODULES, SRD_MODULES } from "./prep-radmax.mjs";
import * as RB from "./prep-radbook.mjs";

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const writeJson = (p, o, pretty = true) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, pretty ? JSON.stringify(o, null, 1) : JSON.stringify(o)); };

// =====================================================================================================================
// Chapters (PDF pages). rad / srd: the module hint per bank ("" = the writer picks from the whole list; null = no
// items for that bank: no fitting module). pri: a thin area of the live banks (breast, intervention, nuclear medicine,
// neuro, head and neck, physics-like pages), asked for more items a page. Strategy and study-advice pages are skipped.
// =====================================================================================================================
export const CTC_CHAPTERS = [
  { id: "msk", title: "Musculoskeletal", pages: [1, 118], rad: "rad-musculoskeletal", srd: "srd-msk-tumour, srd-msk-joint or srd-msk-metabolic (srd-emergency for acute trauma)", lmods: ["srd-msk-joint", "srd-msk-tumour", "srd-msk-metabolic", "srd-emergency", "rad-musculoskeletal"] },
  { id: "brain", title: "Brain", pages: [121, 229], pri: true, rad: "rad-neuroradiology", srd: "srd-neuro-vascular, srd-neuro-tumour or srd-neuro-metabolic (srd-anat-neuro for pure anatomy)", lmods: ["srd-neuro-vascular", "srd-neuro-tumour", "srd-neuro-metabolic", "srd-anat-neuro", "rad-neuroradiology"] },
  { id: "headneck", title: "Head and neck", pages: [230, 269], pri: true, rad: "rad-neuroradiology", srd: "srd-hn-skullbase or srd-hn-neck", lmods: ["srd-hn-skullbase", "srd-hn-neck", "rad-neuroradiology"] },
  { id: "spine", title: "Spine", pages: [270, 290], pri: true, rad: "rad-neuroradiology or rad-musculoskeletal", srd: "srd-msk-joint, srd-neuro-metabolic or srd-neuro-tumour", lmods: ["srd-msk-joint", "srd-neuro-metabolic", "srd-neuro-tumour", "rad-neuroradiology"] },
  { id: "vascular", title: "Vascular", pages: [293, 336], rad: "rad-cardiovascular (rad-ultrasound for Doppler)", srd: "srd-cardiac-vascular", lmods: ["srd-cardiac-vascular", "srd-ir", "rad-cardiovascular"] },
  { id: "ir", title: "Interventional", pages: [339, 439], pri: true, rad: "rad-interventional", srd: "srd-ir", lmods: ["srd-ir", "rad-interventional"] },
  { id: "breast", title: "Breast imaging", pages: [443, 512], pri: true, rad: "rad-obgyn-breast", srd: "srd-breast (srd-physics for mammography quality and regulation)", lmods: ["srd-breast", "srd-physics", "rad-obgyn-breast"] },
  { id: "review", title: "Differentials and high-yield review", pages: [521, 574], rad: "", srd: "", lmods: null },
  { id: "chest", title: "Chest", pages: [616, 683], rad: "rad-chest", srd: "srd-chest-ild or srd-chest-focal (srd-emergency for trauma, srd-anat-body for pure anatomy)", lmods: ["srd-chest-focal", "srd-chest-ild", "srd-emergency", "srd-anat-body", "rad-chest"] },
  { id: "cardiac", title: "Cardiac", pages: [686, 719], rad: "rad-cardiovascular", srd: "srd-cardiac-vascular", lmods: ["srd-cardiac-vascular", "rad-cardiovascular"] },
  { id: "peds", title: "Paediatrics", pages: [722, 829], rad: "rad-paediatric", srd: "srd-paeds", lmods: ["srd-paeds", "rad-paediatric"] },
  { id: "gi-lumen", title: "Luminal gastrointestinal tract", pages: [832, 871], rad: "rad-gi", srd: "srd-abd-bowel", lmods: ["srd-abd-bowel", "rad-gi"] },
  { id: "gi-solid", title: "Peritoneum, liver, biliary tree, pancreas and spleen", pages: [872, 920], rad: "rad-hepatobiliary (rad-gi for peritoneum and spleen)", srd: "srd-abd-liver (srd-abd-peritoneum for peritoneum and spleen)", lmods: ["srd-abd-liver", "srd-abd-peritoneum", "rad-hepatobiliary"] },
  { id: "gu", title: "Urinary tract", pages: [924, 969], rad: "rad-genitourinary", srd: "srd-gu-kidney", lmods: ["srd-gu-kidney", "rad-genitourinary"] },
  // no NEET-SS module takes gynaecology or obstetrics: those pages feed rad-* only; male pelvis and fetal anomalies feed srd
  { id: "gyn-obs", title: "Uterus, ovary, pregnancy and placenta", pages: [972, 999], rad: "rad-obgyn-breast (rad-ultrasound for technique)", srd: null, lmods: ["rad-obgyn-breast"] },
  { id: "male", title: "Male pelvis and scrotum", pages: [1000, 1014], rad: "rad-genitourinary", srd: "srd-gu-kidney", lmods: ["srd-gu-kidney", "rad-genitourinary"] },
  { id: "pregnancy", title: "Early pregnancy, placenta, fetal anomalies and twins", pages: [1015, 1039], rad: "rad-obgyn-breast", srd: "srd-paeds (fetal and neonatal anomalies only)", lmods: ["rad-obgyn-breast", "srd-paeds"] },
  { id: "endo", title: "Adrenal, thyroid and parathyroid", pages: [1042, 1058], pri: true, rad: "rad-genitourinary (adrenal), rad-ultrasound or rad-nm-scans (thyroid, parathyroid)", srd: "srd-gu-kidney (adrenal) or srd-hn-neck (thyroid, parathyroid)", lmods: ["srd-hn-neck", "srd-gu-kidney", "rad-nm-scans"] },
  { id: "nukes", title: "Nuclear medicine", pages: [1062, 1128], pri: true, rad: "rad-nm-scans", srd: "srd-nuclear", lmods: ["srd-nuclear", "rad-nm-scans"] },
  { id: "nukes-safety", title: "Radionuclide therapy, dosimetry and radiation safety", pages: [1129, 1139], pri: true, rad: "rad-nm-scans or rad-radiation-protection", srd: "srd-nuclear or srd-physics", lmods: ["srd-nuclear", "srd-physics", "rad-radiation-protection"] },
];
export const chapterOf = (p) => CTC_CHAPTERS.find((c) => p >= c.pages[0] && p <= c.pages[1]) || null;

// Level mix per bank: NEET-PG items lean Easy and Moderate, NEET-SS items lean Hard and Very Hard; four levels in both.
export const BIAS = {
  rad: { fmt: [["vignette", 0.24], ["recognition", 0.2], ["true-false", 0.18], ["match", 0.13], ["reasoning", 0.25]], dif: [["Easy", 0.34], ["Moderate", 0.38], ["Hard", 0.2], ["Very Hard", 0.08]] },
  srd: { fmt: [["vignette", 0.3], ["recognition", 0.1], ["true-false", 0.17], ["match", 0.13], ["reasoning", 0.3]], dif: [["Easy", 0.1], ["Moderate", 0.27], ["Hard", 0.35], ["Very Hard", 0.28]] },
};

/* textUnits(pages) -> { units, skipped }: page windows (2 pages; 1 page in a thin-area chapter), one unit per bank.
 * Items per window: srd min(4, itemsFor + extra), rad about 60% of that (at least 1). */
export function textUnits(pages, opts = {}) {
  const units = [], skipped = [];
  const byP = new Map(pages.map((x) => [x.p, x]));
  const inCh = new Set();
  for (const c of CTC_CHAPTERS) {
    let win = [];
    const flush = () => {
      if (!win.length) return;
      const ps = win.map((x) => x.p), segs = win.flatMap((x) => segments(x.p, x.t));
      const base = win.reduce((a, x) => a + itemsFor(cleanPage(x.t).length), 0);
      const nS = Math.min(4, base + (c.pri ? 1 : 0)), nR = Math.max(1, Math.round(nS * (c.srd === null ? 1 : 0.6)));
      const uid = "ctc-" + c.id + "-p" + ps[0] + (ps.length > 1 ? "-" + ps[ps.length - 1] : "");
      const common = { src: "ctc", section: c.title, chapter: c.id, pages: ps, segs, header: "", kind: "text" };
      if (c.srd !== null && nS > 0) units.push({ ...common, uid: uid + "-s", bank: "srd", modHint: c.srd || "", want: slate(nS, uid + "s", BIAS.srd) });
      if (c.rad !== null && base > 0) units.push({ ...common, uid: uid + "-r", bank: "rad", modHint: c.rad || "", want: slate(c.srd === null ? Math.min(4, nR + 1) : nR, uid + "r", BIAS.rad) });
      win = [];
    };
    for (let p = c.pages[0]; p <= c.pages[1]; p++) {
      inCh.add(p);
      const pg = byP.get(p); if (!pg) continue;
      const n = cleanPage(pg.t).length;
      if (n < 350) { skipped.push({ p, why: n < 60 ? "blank, divider or picture-only page" : "too little text (figures used as image items)" }); flush(); continue; }
      win.push(pg);
      if (win.length >= (c.pri ? 1 : 2) || win.reduce((a, x) => a + cleanPage(x.t).length, 0) > 3800) flush();
    }
    flush();
  }
  for (const pg of pages) if (!inCh.has(pg.p)) skipped.push({ p: pg.p, why: "study strategy, advice or back matter (no radiology content)" });
  if (opts.only) return { units: units.filter((u) => opts.only.includes(u.chapter)), skipped };
  return { units, skipped };
}

// =====================================================================================================================
// Figures: the figure check (radbook figqa on this book) decides which crops may carry an image item
// =====================================================================================================================
export const MED_KINDS = ["xray", "ct", "mri", "usg", "angio", "fluoro", "nuclear"];
/* imgOk(q) -> a clear real radiological image that fits its nearby text, no third-party mark, no identifier left. */
export const imgOk = (q, blurred) => !!q && q.medical === true && q.clear === true && MED_KINDS.includes(q.kind) && q.match !== "no" && !String(q.third || "").trim() && (q.ident !== true || !!blurred);
/* imageUnits(figs, pages, qa, blurred, per) -> one image unit per usable figure (at most `per` a page), bank srd unless
 * the chapter has no srd module. */
export function imageUnits(figs, pages, qa, blurred = {}, per = 3) {
  const byP = new Map(pages.map((x) => [x.p, x])), n = {}, out = [];
  for (const f of figs) {
    const c = chapterOf(f.page), q = qa.get(f.id);
    if (!c || !imgOk(q, blurred[f.id])) continue;
    n[f.page] = (n[f.page] || 0) + 1; if (n[f.page] > per) continue;
    const pg = byP.get(f.page), bank = c.srd === null ? "rad" : "srd";
    const segs = [{ id: "cap", tx: "Text next to the figure: " + (cleanText(f.near, 400) || "(none)") }, { id: "seen", tx: "What a checker saw in the image: " + cleanText(q.shows, 200) }].concat(segments(f.page, pg ? pg.t : "").slice(0, 30));
    out.push({ uid: "ctc-fig-" + f.id, src: "ctc", section: c.title, chapter: c.id, bank, modHint: (bank === "srd" ? c.srd : c.rad) || "", pages: [f.page], kind: "img", shows: cleanText(q.shows, 300),
      fig: { id: f.id, file: blurred[f.id] || f.file, caption: cleanText(f.near, 300) || cleanText(q.shows, 200) }, segs, header: "", want: slate(1, f.id, { fmt: [["image", 1]], dif: BIAS[bank].dif }) });
  }
  return out;
}

// =====================================================================================================================
// Lessons: the radbook pipeline with this book's profile
// =====================================================================================================================
export function ctcCatalog(dir, { loadPages }) {
  const root = path.join(dir, ".."), pages = loadPages(dir).ctc || [];
  const figs = readJson(path.join(root, "figs.ctc.json"), []).map((f) => ({ id: f.id, src: "ctc", page: f.page, file: path.join(root, f.file), w: f.w, h: f.h, caption: cleanText(String(f.near || "").split(" | ")[0], 200), fig: "" }));
  const chapters = CTC_CHAPTERS.filter((c) => c.lmods).map((c, k) => ({ id: "ctc-" + c.id, src: "ctc", order: 10 + k * 5, title: c.title, pages: c.pages, mods: c.lmods }));
  writeJson(path.join(dir, "figs.json"), figs);
  writeJson(path.join(dir, "chapters.json"), chapters);
  console.log(JSON.stringify({ figs: figs.length, chapters: chapters.length, pages: pages.length }));
}
export const CTC_BOOK = { name: "ctc", set: "ctcbook", key: "ctcbook", dir: "prep-data/radnotes/ctc/book", srcDir: (dir) => path.join(dir, "..", "src"), sources: { ctc: { tag: "ctc" } }, chapters: [], catalog: ctcCatalog, dropSets: [],
  noUpload: "HOLD: CTC lessons may not be uploaded until the lead confirms the author's signed permission; then use the ship steps in the PR." };

// =====================================================================================================================
// Finish: the assembled bank with blurred figures, counts
// =====================================================================================================================
function finish(dir, args) {
  const mcq = path.resolve(dir, args.mcq || "out/mcq"), blur = readJson(path.join(dir, "work/blur/result.json"), { files: {} }).files;
  const items = readJson(path.join(mcq, "items-full.json"), []);
  let swapped = 0;
  for (const it of items.filter((i) => i.fig)) { const b = blur[it.fig.id]; if (b) { fs.copyFileSync(b, path.join(mcq, "img", "rm-" + it.fig.id + ".webp")); swapped++; } }
  const t = {}; for (const it of items) { const k = it.mod; t[k] = t[k] || { Easy: 0, Moderate: 0, Hard: 0, "Very Hard": 0, image: 0, total: 0 }; t[k][it.dif]++; t[k].total++; if (it.fig) t[k].image++; }
  writeJson(path.join(mcq, "counts.json"), t);
  console.log(JSON.stringify({ items: items.length, blurredSwapped: swapped, modules: Object.keys(t).length }));
}

// =====================================================================================================================
// Ship tree (built privately, uploaded only after the permission is confirmed): the NEET-SS bank's next version = the
// live version's files + the new srd items; the next radiology overlay set = the live set's items + the new rad items.
// Phones cache bank and overlay files for good, so new content always goes to a new version or set folder.
// =====================================================================================================================
/* mergeShip({ liveBank, liveOv, add, bank, set }) -> { files: { mcq: {m: items}, ov: {m: items} }, imgs: [[from, to]] }.
 * liveBank / liveOv: { module: items }; add: { srd: { m: items }, rad: { m: items } } (items from the assembled run,
 * img like "rm-<fig>.webp"); throws on an id already live. */
export function mergeShip({ liveBank, liveOv, add, bank, set }) {
  const live = new Set([...Object.values(liveBank), ...Object.values(liveOv)].flat().map((i) => i.id)), imgs = [];
  const vh = (it) => (it.meta && it.meta.lvl === "Very Hard" ? { ...it, vh: true } : it);
  const fix = (it, kind) => {
    if (live.has(it.id)) throw new Error("new id already live " + it.id);
    if (!it.img) return vh(it);
    const name = path.basename(String(it.img[0])), to = kind === "srd" ? bank + "/ss-radiology/img/" + name : "img/radmax/" + name;
    imgs.push([name, to]);
    return vh({ ...it, img: [to] });
  };
  const mcq = {}, ov = {};
  for (const [m, list] of Object.entries(liveBank)) mcq[m] = list.slice();
  for (const [m, list] of Object.entries(add.srd || {})) { if (!mcq[m]) throw new Error("no live bank file for " + m); mcq[m] = mcq[m].concat(list.map((i) => fix(i, "srd"))); }
  for (const [m, list] of Object.entries(liveOv)) ov[m] = list.map((i) => (i.img ? { ...i, img: i.img.map((f) => (String(f).includes("/") ? f : "img/radmax/" + f)) } : i));
  for (const [m, list] of Object.entries(add.rad || {})) ov[m] = (ov[m] || []).concat(list.map((i) => ({ ...fix(i, "rad"), set })));
  for (const list of Object.values(ov)) list.forEach((i) => { i.set = set; });
  return { mcq, ov, imgs };
}
async function shipBuild(dir, a) {
  const R = path.join(dir, ".."), repo = path.resolve(a.repo || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const from = a.from || "v9", bank = a.bank || "v10", set = a.set || "radmax3", liveSet = a["live-set"] || "radmax2";
  const { bankIndex } = await import(path.join(repo, "tools/prep-radss.mjs"));
  const tax = readJson(path.join(repo, "prep/taxonomy/ss-radiology.json"), null); if (!tax) throw new Error("taxonomy missing");
  const VL = path.join(R, "ss/out", from, "ss-radiology"), OVL = path.join(R, "max/ship2/overlay", liveSet, "radiology");
  const liveFiles = {}, liveBank = {}, liveOv = {};
  for (const f of fs.readdirSync(path.join(VL, "mcq"))) { const j = readJson(path.join(VL, "mcq", f)); liveFiles[j.module] = j; liveBank[j.module] = j.items; }
  if (JSON.stringify(bankIndex(tax, liveBank)) !== JSON.stringify(readJson(path.join(VL, "index.json")))) throw new Error("bankIndex does not reproduce the live " + from + " index");
  for (const f of fs.readdirSync(OVL)) { const j = readJson(path.join(OVL, f)); liveOv[j.topic] = j.items; }
  const mcqDir = path.resolve(dir, a.mcq || "out/mcq"), add = { srd: {}, rad: {} };
  const nd = path.join(mcqDir, "ss-radiology/mcq"), no = path.join(mcqDir, "overlay/radiology");
  if (fs.existsSync(nd)) for (const f of fs.readdirSync(nd)) { const j = readJson(path.join(nd, f)); add.srd[j.module] = j.items; }
  if (fs.existsSync(no)) for (const f of fs.readdirSync(no)) { const j = readJson(path.join(no, f)); add.rad[j.topic] = j.items; }
  const r = mergeShip({ liveBank, liveOv, add, bank, set });
  const out = path.resolve(dir, a.out || "out/ship"); fs.rmSync(out, { recursive: true, force: true });
  for (const [m, items] of Object.entries(r.mcq)) writeJson(path.join(out, bank, "ss-radiology/mcq", m + ".json"), { ...liveFiles[m], items }, false);
  writeJson(path.join(out, bank, "ss-radiology/index.json"), bankIndex(tax, r.mcq), false);
  for (const [m, items] of Object.entries(r.ov)) writeJson(path.join(out, "overlay", set, "radiology", m + ".json"), { topic: m, set, v: 1, items }, false);
  for (const [name, to] of r.imgs) { const t = path.join(out, to); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(path.join(mcqDir, "img", name), t); }
  const n = (o) => Object.values(o).flat().length;
  const sum = { bank, from, bankLive: n(liveBank), bankAdd: n(add.srd), bankTotal: n(r.mcq), set, liveSet, overlayLive: n(liveOv), overlayAdd: n(add.rad), overlayTotal: n(r.ov), images: r.imgs.length };
  writeJson(path.join(out, "ship-summary.json"), sum);
  console.log(JSON.stringify(sum));
}

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0], rest = argv.slice(1);
  const get = (k) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  const dir = path.resolve(get("dir") || path.join(os.homedir(), "prep-data/radnotes/ctc"));
  if (cmd === "book") {
    RB.useBook(CTC_BOOK);
    const a = rest.includes("--dir") ? rest : rest.concat(["--dir", path.join(dir, "book")]);
    return RB.main(a);
  }
  if (cmd === "units") {
    const pages = readJson(path.join(dir, "src/ctc.pages.json"), []);
    const r = textUnits(pages, { only: get("only") ? get("only").split(",") : null });
    if (!rest.includes("--no-img")) {
      const qa = RB.figQaMap(path.join(dir, "book")), blurred = readJson(path.join(dir, "work/blur/result.json"), { files: {} }).files;
      const figs = readJson(path.join(dir, "figs.ctc.json"), []).map((f) => ({ ...f, file: path.join(dir, f.file) }));
      r.units.push(...imageUnits(figs, pages, qa, blurred));
    }
    writeJson(path.join(dir, "work/units.json"), r, false);
    const by = {}; for (const u of r.units) { const k = u.chapter + ":" + u.bank + ":" + u.kind; by[k] = by[k] || { units: 0, asks: 0 }; by[k].units++; by[k].asks += u.want.length; }
    for (const [k, v] of Object.entries(by)) console.log(k.padEnd(28), "units", v.units, "asks", v.asks);
    console.log("units", r.units.length, "asks", r.units.reduce((a, u) => a + u.want.length, 0), "skipped pages", r.skipped.length);
    return;
  }
  if (cmd === "finish") return finish(dir, { mcq: get("mcq") });
  if (cmd === "shipbuild") return shipBuild(dir, { mcq: get("mcq"), out: get("out"), from: get("from"), bank: get("bank"), set: get("set"), "live-set": get("live-set"), repo: get("repo") });
  console.log("commands: book <radbook command> | units [--no-img] [--only ch,..] | finish [--mcq out/mcq] | shipbuild [--from v9 --bank v10 --live-set radmax2 --set radmax3]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.pending ? "pending: " + e.message : e.stack || e.message); process.exit(e.pending ? 3 : 1); });
