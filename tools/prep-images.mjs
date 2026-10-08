#!/usr/bin/env node
// PrepNucleus image pilot. Dev-only. Attaches openly licensed (Wikimedia Commons: CC0, PD, CC-BY, CC-BY-SA) images to bank MCQs.
// COPYRIGHT: the repo is public. Nothing this tool downloads enters git. Data lives in ~/prep-data/img/ (override --dir),
// images later go to R2 (prep-bank/...), never to git. Licence and author come from Commons extmetadata, never guessed.
//
//   node tools/prep-images.mjs pick   [--bank prep/bank/v1] [--n-visual 60] [--n-hallmark 40]   -> picks.json (candidates for hand curation)
//   node tools/prep-images.mjs search [--queries queries.json]   queries.json: { itemId: ["commons query", ...] }  -> cands.json
//   node tools/prep-images.mjs fetch                              download 1024px thumbs of every candidate, webp -> raw/
//   node tools/prep-images.mjs batches [--size 10]                verifier input files -> batches/b<k>.json (items + candidate files)
//   node tools/prep-images.mjs finalize [--sheets DIR]            merge verdicts/*.json -> pilot.json, credits.txt, contact sheets
//   node tools/prep-images.mjs test                               self-test of the pure helpers
//
// Item shape reused from PYQ: field `img` = array of webp file names, rendered by PREP_PYQ.figure() next to the stem.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const DIR = opt("dir", path.join(os.homedir(), "prep-data", "img"));
const BANK = opt("bank", "prep/bank/v1");
const UA = "StewardMD-PrepNucleus-image-pilot/1.0 (https://stewardmd.com; contact drmanojkurmana@gmail.com)";

// ---- pure helpers (tested) ----
export const OK_LICENCE = [/^cc0/i, /^pd\b/i, /^public domain/i, /^cc[- ]by(-sa)?[- ]\d/i, /^cc[- ]by(-sa)?$/i];
export function licenceOk(code) {
  if (!code) return false;
  const c = String(code).trim();
  if (/-nc|-nd|\bnc\b|\bnd\b|fair use|non-?free|gfdl-?only|copyrighted/i.test(c)) return false;
  return OK_LICENCE.some((r) => r.test(c));
}
export function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim(); }
export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); }
export const VISUAL_STEM = /\b(image|images|picture|photograph|shown|given (below|here)|seen in the|x-?ray|radiograph|ecg|ekg|ct scan|mri|angiogra|histolog|smear|fundus|fundoscop|specimen|instrument|identify|corkscrew|pile of plates|string of beads|appearance|sign)\b/i;
export function visualScore(q) {
  let s = 0;
  if (/\b(image|picture|photograph|shown|figure|diagram)\b/i.test(q)) s += 3;
  if (/identify|instrument|specimen|smear|fundus|ecg|x-?ray|angiogra|mri|ct\b/i.test(q)) s += 2;
  if (/corkscrew|plates|string of beads|appearance|sign\b|pattern/i.test(q)) s += 1;
  return s;
}
export const NEG_STEM = /\b(shown (by|to|in the (graph|table))|has shown|have shown|been shown|studies? (have )?shown|is shown in (graph|table)|graph|flow ?chart|pathway|formula|bar chart|pie chart|histogram|scatter|curve|logo|symbol|sticker|the following (table|data))\b|\b(instrument|device|apparatus|equipment|procedure|operation|incision|maneuver|manoeuvre|test|splint|suture|knot|drug|structure|muscle|nerve|artery|vessel|bone|nerve marked|marked) (is |are )?(shown|depicted|given)\b/i;
export const POS_STEM = /\b(x-?rays?|radiograph\w*|ecg|ekg|ct|mri|hrct|barium|angiogra\w*|ultrasound|usg|fundus|fundoscop\w*|slit lamp|smear|histolog\w*|histopatholog\w*|photomicrograph|specimen|appearance|sign|picture|photograph|image|figure|seen in the|identify)\b/i;
export function prefilter(q) { if (!POS_STEM.test(q)) return false; if (NEG_STEM.test(q) && !/(x-?ray|radiograph|ecg|ct\b|mri|smear|histolog|fundus|sign\b|appearance)/i.test(q)) return false; return true; }
export function pickDiverse(items, n, perSubject) {
  const out = [], cnt = {};
  for (const it of items) { if (out.length >= n) break; if ((cnt[it.subject] || 0) >= perSubject) continue; cnt[it.subject] = (cnt[it.subject] || 0) + 1; out.push(it); }
  return out;
}

if (import.meta.url === "file://" + process.argv[1] && cmd === "test") {
  const assert = (c, m) => { if (!c) { console.error("FAIL " + m); process.exit(1); } };
  assert(licenceOk("CC BY-SA 4.0"), "ccbysa"); assert(licenceOk("CC0")); assert(licenceOk("Public domain")); assert(licenceOk("CC BY 3.0"), "ccby");
  assert(!licenceOk("CC BY-NC 4.0"), "nc"); assert(!licenceOk("CC BY-ND 2.0"), "nd"); assert(!licenceOk("Fair use"), "fair"); assert(!licenceOk(""), "empty");
  assert(stripHtml("<a href='x'>A &amp; B</a>") === "A & B", "strip");
  assert(slug("File:Foo Bar.jpg") === "file-foo-bar-jpg", "slug");
  assert(visualScore("Identify the instrument shown in the image") >= 5, "score");
  assert(pickDiverse([{ subject: "a" }, { subject: "a" }, { subject: "b" }], 3, 1).length === 2, "diverse");
  assert(openiLicence("http://creativecommons.org/licenses/by/4.0/").code === "CC BY 4.0", "oi by"); assert(!openiLicence("http://creativecommons.org/licenses/by-nc/4.0/"), "oi nc"); assert(!openiLicence("http://creativecommons.org/licenses/by-sa/4.0/"), "oi sa"); assert(openiLicence("https://creativecommons.org/publicdomain/zero/1.0/").code === "CC0", "oi cc0"); assert(!openiLicence(""), "oi empty");
  console.log("ok");
  process.exit(0);
}

const j = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const w = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadBank() {
  const out = [];
  for (const sub of fs.readdirSync(BANK)) {
    const d = path.join(BANK, sub, "mcq");
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".json")) continue;
      const m = j(path.join(d, f));
      for (const it of m.items) out.push({ ...it, subject: sub, module: f.replace(/\.json$/, "") });
    }
  }
  return out;
}

async function api(params) {
  const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ format: "json", origin: "*", ...params });
  for (let a = 0; a < 4; a++) {
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
    return r.json();
  }
  throw new Error("commons api failed");
}

async function searchOne(q) {
  const r = await api({ action: "query", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "8", prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1024", iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|ObjectName|UsageTerms|Restrictions|AttributionRequired|NonFree" });
  const pages = Object.values((r.query && r.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
    const m = ii.extmetadata || {}, lic = m.LicenseShortName && m.LicenseShortName.value;
    if (!/^image\/(jpeg|png)$/.test(ii.mime)) continue;
    if (!licenceOk(lic)) continue;
    if (m.NonFree && /true|1/i.test(m.NonFree.value)) continue;
    if (m.Restrictions && stripHtml(m.Restrictions.value)) continue; // personality / trademark restrictions: skip
    if (ii.width < 300 || ii.height < 300) continue;
    const author = stripHtml(m.Artist && m.Artist.value) || stripHtml(m.Credit && m.Credit.value);
    if (!author) continue; // attribution must be machine-readable
    out.push({ title: p.title, page: ii.descriptionurl, url: ii.url, thumb: ii.thumburl, licence: lic, licenceUrl: (m.LicenseUrl && m.LicenseUrl.value) || "", author, desc: stripHtml(m.ImageDescription && m.ImageDescription.value).slice(0, 300), w: ii.width, h: ii.height });
  }
  return out;
}

// NLM Open-i (PMC Open Access figures). Only CC BY and CC0 article licences (machine-readable licenseURL); NC/ND/SA/unknown are dropped.
export function openiLicence(url) {
  const u = String(url || "").toLowerCase();
  let m;
  if (/creativecommons\.org\/publicdomain\/zero\//.test(u)) return { code: "CC0", url };
  if ((m = u.match(/creativecommons\.org\/licenses\/by\/(\d\.\d)/))) return { code: "CC BY " + m[1], url };
  return null;
}
async function searchOpenI(q) {
  const u = "https://openi.nlm.nih.gov/api/search?" + new URLSearchParams({ query: q, m: "1", n: "10" });
  let r;
  for (let a = 0; a < 3; a++) { r = await fetch(u, { headers: { "User-Agent": UA } }); if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; } break; }
  if (!r || !r.ok) return [];
  let d; try { d = await r.json(); } catch { return []; }
  const out = [];
  for (const x of d.list || []) {
    const lic = openiLicence(x.licenseURL); if (!lic || !x.pmcid || !x.image || !x.imgLarge) continue;
    const authors = stripHtml(x.authors); if (!authors) continue;
    const cap = stripHtml(x.image.caption);
    if (/\b(panels?|\(a\)|\(b\)|\bA\)|\bB\))/.test(cap) && /\b(A\)|\(a\)|panel)/.test(cap)) { /* multi-panel: keep only if verifier accepts; flagged in desc */ }
    out.push({ title: `File:openi-PMC${x.pmcid}-${x.image.id}`, source: "openi", pmcid: "PMC" + x.pmcid, figure: x.image.id, page: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${x.pmcid}/`, url: "https://openi.nlm.nih.gov" + x.imgLarge, thumb: "https://openi.nlm.nih.gov" + x.imgLarge, licence: lic.code, licenceUrl: lic.url, author: authors.length > 140 ? authors.split(",").slice(0, 3).join(",") + " et al." : authors, desc: ("PMC article: " + stripHtml(x.title) + ". Caption: " + cap).slice(0, 400), w: 512, h: 512 });
  }
  return out;
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (cmd === "pick") {
    const nV = +opt("n-visual", 60), nH = +opt("n-hallmark", 40);
    const bank = loadBank();
    const vis = bank.filter((it) => visualScore(it.q) >= 3 && it.q.length < 400).sort((a, b) => visualScore(b.q) - visualScore(a.q));
    const hall = bank.filter((it) => /(characteristic|classic|pathognomonic|hallmark|sign|appearance)/i.test(it.exp || "") && /(x-?ray|radiograph|ct\b|mri|histolog|biopsy|fundus|ecg|skin|lesion|rash|instrument|smear|barium|angiogra)/i.test(it.q + " " + (it.exp || "")) && !/\bnot\b/i.test(it.q));
    const shuffle = (a) => { let s = 7; return a.map((x) => [((s = (s * 9301 + 49297) % 233280) / 233280), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); };
    const pv = pickDiverse(shuffle(vis), nV * 3, 12).slice(0, nV * 3);
    const ph = pickDiverse(shuffle(hall), nH * 3, 8);
    w(path.join(DIR, "pool.json"), { visual: pv.map(slimIt), hallmark: ph.map(slimIt) });
    console.log("pool", pv.length, ph.length, "(curate down to picks.json by hand: { visual:[ids], hallmark:[ids] })");
  } else if (cmd === "select") {
    // all visual-stem candidates -> items.json (full run). --exclude ids.json (8-char prefixes) are dropped.
    const ex = new Set(fs.existsSync(opt("exclude", "")) ? j(opt("exclude")) : []);
    const items = loadBank().filter((it) => it.q.length < 1200 && prefilter(it.q) && !ex.has(it.id.slice(0, 8))).map((it) => ({ id: it.id, subject: it.subject, module: it.module, q: it.q, o: it.o, a: it.a, exp: (it.exp || "").slice(0, 700) }));
    w(path.join(DIR, "picks.json"), items);
    const by = {}; for (const it of items) by[it.subject] = (by[it.subject] || 0) + 1;
    console.log("selected", items.length, by);
  } else if (cmd === "qbatches") {
    // inputs for the Haiku query step: ~50 items per file, compact
    const items = j(path.join(DIR, "picks.json")), size = +opt("size", 50); fs.mkdirSync(path.join(DIR, "qbatches"), { recursive: true });
    for (let i = 0; i * size < items.length; i++) w(path.join(DIR, "qbatches", `q${i}.json`), items.slice(i * size, (i + 1) * size).map((it) => ({ id: it.id, q: it.q.slice(0, 500), answer: it.o[it.a], exp: it.exp.slice(0, 250) })));
    console.log("qbatches", Math.ceil(items.length / size));
  } else if (cmd === "qmerge") {
    // merge Haiku query-step output (qout/*.json) -> queries.json { id: [queries] } (skipped items omitted)
    const dir = path.join(DIR, "qout"), qs = {}; let n = 0, skipped = 0;
    for (const f of fs.readdirSync(dir)) { let a; try { a = j(path.join(dir, f)); } catch { console.error("bad json", f); continue; } for (const r of a) { n++; if (r.skip || !r.queries || !r.queries.length) skipped++; else qs[r.id] = r.queries.slice(0, 3).map((x) => String(x).replace(/["':()]/g, " ").trim()).filter(Boolean); } }
    w(path.join(DIR, "queries.json"), qs); console.log("items", n, "skipped", skipped, "to search", Object.keys(qs).length);
  } else if (cmd === "search") {
    const qs = j(opt("queries", path.join(DIR, "queries.json")));
    const cf = path.join(DIR, "cands.json"), out = fs.existsSync(cf) ? j(cf) : {};
    const subj = {}; if (fs.existsSync(path.join(DIR, "picks.json"))) for (const p of j(path.join(DIR, "picks.json"))) subj[p.id] = p.subject;
    const PRI = { radiology: 0, pathology: 1 }, IMG = /radiograph|x-?ray|\bct\b|\bmri\b|ultrasound|histolog|micrograph|smear|angiogra|barium|ecg|cytolog|biopsy/i;
    const useOpenI = (id, list) => PRI[subj[id]] !== undefined || list.some((q) => IMG.test(q));
    const todo = Object.entries(qs).filter(([id]) => !(id in out) || (argv.includes("--redo") && !out[id].length)).sort((a, b) => (PRI[subj[a[0]]] ?? 9) - (PRI[subj[b[0]]] ?? 9));
    const qcache = new Map(); let done = 0;
    const lim = +opt("limit", 1e9), conc = +opt("conc", 3);
    const work = todo.slice(0, lim);
    async function one([id, list]) {
      const seen = new Map();
      for (const q of list) {
        let r = qcache.get(q);
        if (!r) { try { r = await searchOne(q); } catch (e) { console.error(id, q, e.message); r = []; } qcache.set(q, r); await sleep(250); }
        for (const c of r) if (!seen.has(c.title)) seen.set(c.title, { ...c, query: q });
        if (seen.size >= 3) break; // enough from the more specific queries
      }
      const oi = [];
      if (useOpenI(id, list) && !argv.includes("--no-openi")) for (const q of list.slice(0, 2)) {
        const k = "oi:" + q; let r = qcache.get(k);
        if (!r) { try { r = await searchOpenI(q); } catch (e) { r = []; } qcache.set(k, r); await sleep(300); }
        for (const c of r) if (!oi.some((z) => z.title === c.title)) oi.push({ ...c, query: q });
        if (oi.length >= 3) break;
      }
      out[id] = [...[...seen.values()].slice(0, 3), ...oi.slice(0, 2)];
      if (++done % 50 === 0) { w(cf, out); console.log("searched", done, "/", work.length); }
    }
    let k = 0; await Promise.all(Array.from({ length: conc }, async () => { while (k < work.length) await one(work[k++]); }));
    w(cf, out); console.log("search done", done, "with cands", Object.values(out).filter((v) => v.length).length);
  } else if (cmd === "fetch") {
    // 1024px webp -> raw/, 800px jpg for the verifiers -> view/. Resumable, 3 workers. Only items in picks.json.
    const c = j(path.join(DIR, "cands.json")); fs.mkdirSync(path.join(DIR, "raw"), { recursive: true }); fs.mkdirSync(path.join(DIR, "view"), { recursive: true });
    const bf0 = path.join(DIR, "batched.json"), batched0 = new Set(fs.existsSync(bf0) ? j(bf0) : []), PRI0 = { radiology: 0, pathology: 1 };
    const pk0 = j(path.join(DIR, "picks.json")), order = pk0.filter((p) => !batched0.has(p.id) && (c[p.id] || []).length).sort((a, b) => (PRI0[a.subject] ?? 9) - (PRI0[b.subject] ?? 9)).slice(0, +opt("limit", 1e9));
    const jobs = []; for (const p of order) for (const x of c[p.id]) { x.file = `${slug(x.title.replace(/^File:/, ""))}.webp`; jobs.push(x); }
    const seen = new Set(), uniq = jobs.filter((x) => !seen.has(x.file) && seen.add(x.file));
    let k = 0, n = 0;
    const freeMb = () => +execFileSync("df", ["-m", os.homedir()]).toString().trim().split("\n").pop().split(/\s+/)[3];
    await Promise.all(Array.from({ length: 3 }, async (_, wi) => { while (k < uniq.length) {
      const x = uniq[k++], out = path.join(DIR, "raw", x.file), vw = path.join(DIR, "view", x.file.replace(/\.webp$/, ".jpg"));
      if (fs.existsSync(out) && fs.existsSync(vw)) continue;
      if (wi === 0 && n % 100 === 0 && freeMb() < 800) { console.error("PAUSE: free disk under 800 MB"); process.exit(3); }
      const tmp = path.join(os.tmpdir(), `pi-${process.pid}-${wi}` + (path.extname(x.thumb).split("?")[0] || ".jpg"));
      try {
        const r = await fetch(x.thumb, { headers: { "User-Agent": UA } });
        if (!r.ok) { x.err = "http " + r.status; await sleep(2000); continue; }
        fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
        execFileSync("cwebp", ["-quiet", "-q", "80", ...(x.source === "openi" ? [] : ["-resize", "1024", "0"]), tmp, "-o", out]);
        execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "800", tmp, "--out", vw], { stdio: "ignore" });
      } catch (e) { x.err = String(e.message).slice(0, 80); try { fs.unlinkSync(out); } catch {} }
      if (++n % 100 === 0) console.log("fetched", n, "/", uniq.length);
      await sleep(400);
    } }));
    console.log("fetched; size:", execFileSync("du", ["-sh", path.join(DIR, "raw"), path.join(DIR, "view")]).toString().trim().replace(/\n/g, " "));
  } else if (cmd === "batches") {
    // verifier round 1 input: ~10 items per file, only items with a fetched candidate and not batched before. Radiology and pathology first.
    const size = +opt("size", 10), bf = path.join(DIR, "batched.json");
    const picks = j(path.join(DIR, "picks.json")), c = j(path.join(DIR, "cands.json")), done = new Set(fs.existsSync(bf) ? j(bf) : []);
    const PRI = { radiology: 0, pathology: 1 };
    const fileOf = (x) => `${slug(x.title.replace(/^File:/, ""))}.webp`;
    const have = (x) => fs.existsSync(path.join(DIR, "raw", fileOf(x))) && fs.existsSync(path.join(DIR, "view", fileOf(x).replace(/\.webp$/, ".jpg")));
    const ready = picks.filter((p) => !done.has(p.id) && (c[p.id] || []).some(have)).sort((a, b) => (PRI[a.subject] ?? 9) - (PRI[b.subject] ?? 9));
    const lim = +opt("limit", 1e9); const take = ready.slice(0, lim);
    fs.mkdirSync(path.join(DIR, "batches"), { recursive: true });
    let k = fs.readdirSync(path.join(DIR, "batches")).length;
    for (let i = 0; i < take.length; i += size) {
      const part = take.slice(i, i + size).map((p) => ({ id: p.id, q: p.q.slice(0, 700), o: p.o, answer: p.o[p.a], exp: (p.exp || "").slice(0, 500), candidates: c[p.id].filter(have).map((x) => ({ file: path.join(DIR, "view", fileOf(x).replace(/\.webp$/, ".jpg")), title: x.title, desc: x.desc })) }));
      w(path.join(DIR, "batches", `b${k++}.json`), part);
    }
    w(bf, [...done, ...take.map((p) => p.id)]);
    console.log("new batches", Math.ceil(take.length / size), "items", take.length, "waiting", ready.length - take.length, "no-candidate items", picks.length - picks.filter((p) => (c[p.id] || []).length).length);
  } else if (cmd === "batches2") {
    // verifier round 2 input: every item verifier 1 accepted (verdicts/), with only the chosen image. ~10 items per file.
    const size = +opt("size", 10), bf = path.join(DIR, "batched2.json"), done = new Set(fs.existsSync(bf) ? j(bf) : []);
    const items = {}; for (const f of fs.readdirSync(path.join(DIR, "batches"))) for (const it of j(path.join(DIR, "batches", f))) items[it.id] = it;
    const acc = [];
    for (const f of fs.readdirSync(path.join(DIR, "verdicts"))) { let a; try { a = j(path.join(DIR, "verdicts", f)); } catch { console.error("bad verdict file", f); continue; } for (const r of a) if (r.pick && r.pick.file && items[r.id] && !done.has(r.id)) { const it = { ...items[r.id] }, fn = r.pick.file.split("/").pop(); it.candidates = it.candidates.filter((c) => c.file.endsWith(fn)); if (it.candidates.length) acc.push(it); } }
    fs.mkdirSync(path.join(DIR, "batches2"), { recursive: true });
    let k = fs.readdirSync(path.join(DIR, "batches2")).length;
    for (let i = 0; i < acc.length; i += size) w(path.join(DIR, "batches2", `c${k++}.json`), acc.slice(i, i + size));
    w(bf, [...done, ...acc.map((x) => x.id)]);
    console.log("round-2 batches", Math.ceil(acc.length / size), "items", acc.length);
  } else if (cmd === "prune") {
    // delete raw/view files that no pending or accepted item needs (disk cap)
    const c = j(path.join(DIR, "cands.json"));
    const readV = (d) => { const o = {}, dir = path.join(DIR, d); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { let a; try { a = j(path.join(dir, f)); } catch { continue; } for (const r of a) o[r.id] = r; } return o; };
    const v1 = readV("verdicts"), v2 = readV("verdicts2"), batched = new Set(fs.existsSync(path.join(DIR, "batched.json")) ? j(path.join(DIR, "batched.json")) : []);
    const fileOf = (x) => `${slug(x.title.replace(/^File:/, ""))}.webp`, bn = (k) => k.file.replace(/^.*\//, "").replace(/\.jpg$/, ".webp");
    const keep = new Set();
    for (const [id, list] of Object.entries(c)) for (const x of list) {
      const f = fileOf(x);
      if (!batched.has(id) || !v1[id]) { keep.add(f); continue; }          // not verified yet
      if (v1[id].pick && bn(v1[id].pick) === f && !v2[id]) keep.add(f);      // awaiting vote 2
      if (v1[id].pick && v2[id] && v2[id].pick && bn(v2[id].pick) === f && bn(v1[id].pick) === f) keep.add(f); // accepted
    }
    let del = 0, freed = 0;
    for (const dn of ["raw", "view"]) { const d = path.join(DIR, dn); if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) { const base = f.replace(/\.jpg$/, ".webp"); const keepIt = keep.has(base); if (!keepIt && !(dn === "view" && keep.has(base))) { freed += fs.statSync(path.join(d, f)).size; fs.unlinkSync(path.join(d, f)); del++; } } }
    console.log("pruned", del, "files", (freed / 1e6).toFixed(0), "MB");
  } else if (cmd === "stage") {
    // copy accepted images (final.json) into <dir>/stage for tools/prep-upload-bank.mjs --dir <stage> --as v5/img
    const fin = j(path.join(DIR, "..", "final.json")), st = path.join(DIR, "..", "stage"); fs.mkdirSync(st, { recursive: true }); let n = 0;
    for (const o of fin) for (const f of o.img) { const src = [path.join(DIR, "raw", f), path.join(DIR, "..", "raw", f)].find((q) => fs.existsSync(q)); if (!src) { console.error("missing", f); continue; } fs.copyFileSync(src, path.join(st, f)); n++; }
    console.log("staged", n, "files in", st);
  } else if (cmd === "finalize") {
    await finalize();
  } else { console.error("usage: see header"); process.exit(1); }
}
function slimIt(it) { return { id: it.id, subject: it.subject, module: it.module, q: it.q, o: it.o, a: it.a, exp: (it.exp || "").slice(0, 700) }; }

export function cleanAuthor(a) {
  let t = stripHtml(a).replace(/^(Own work|Photograph by|Image by|Author:?)\s*/i, "").replace(/\s*\(?https?:\/\/\S+\)?/g, "").replace(/\s*;\s*/g, ", ").trim();
  if (t.length > 110) t = t.split(",").slice(0, 3).join(",").trim() + " et al.";
  if (t.length > 110) t = t.slice(0, 107).trim() + "...";
  return t || "Unknown author";
}

async function finalize() {
  const picks = Object.fromEntries(j(path.join(DIR, "picks.json")).map((p) => [p.id, p])), c = j(path.join(DIR, "cands.json"));
  const readV = (d) => { const o = {}, dir = path.join(DIR, d); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { let a; try { a = j(path.join(dir, f)); } catch { continue; } for (const r of a) o[r.id] = r; } return o; };
  const v1 = readV("verdicts"), v2 = readV("verdicts2");
  const base = (k) => k.file.replace(/^.*\//, "").replace(/\.jpg$/, ".webp");
  const out = [], rej = {}, reasons = {};
  const why = (id, r) => { rej[id] = r; reasons[r.split(":")[0]] = (reasons[r.split(":")[0]] || 0) + 1; };
  for (const id of Object.keys(picks)) {
    const A = v1[id] && v1[id].pick, B = v2[id] && v2[id].pick, list = c[id] || [];
    if (!list.length) { why(id, "no candidate found"); continue; }
    if (!v1[id]) { why(id, "not verified"); continue; }
    if (!A) { why(id, "verifier 1 rejected all: " + (v1[id].reason || "")); continue; }
    if (!v2[id]) { why(id, "no second vote"); continue; }
    if (!B || base(B) !== base(A)) { why(id, "verifier 2 rejected: " + ((v2[id].reason) || "")); continue; }
    const x = list.find((k) => `${slug(k.title.replace(/^File:/, ""))}.webp` === base(A)); if (!x) { why(id, "file missing"); continue; }
    const p = picks[id];
    out.push({ id, subject: p.subject, module: p.module, img: [base(A)], imgPlace: A.placement === "stem" && B.placement === "stem" ? "stem" : "exp", licence: x.licence, licenceUrl: x.licenceUrl || "", author: cleanAuthor(x.author), source_url: x.page, source: x.source || "commons", title: x.title.replace(/^File:/, "") });
  }
  // keep the retained pilot picks (Commons only; their files live in the pilot raw/ dir)
  const pk = path.join(DIR, "..", "pilot-kept.json"), have = new Set(out.map((o) => o.id));
  if (fs.existsSync(pk)) for (const x of j(pk)) if (!have.has(x.id)) out.push({ id: x.id, subject: x.subject, module: x.module, img: x.img, imgPlace: x.place === "stem" ? "stem" : "exp", licence: x.licence, licenceUrl: x.licenceUrl || "", author: cleanAuthor(x.author), source_url: x.source_url, source: "commons", title: x.img[0], pilot: true });
  w(path.join(DIR, "..", "final.json"), out); w(path.join(DIR, "rejected.json"), rej); w(path.join(DIR, "reasons.json"), reasons);
  const seen = new Set(), cr = [];
  for (const o of out) for (const f of o.img) if (!seen.has(f)) { seen.add(f); cr.push(`${f} | ${o.title} | ${o.author} | ${o.licence} | ${o.source_url}`); }
  fs.writeFileSync(path.join(DIR, "..", "credits.txt"), cr.join("\n") + "\n");
  const st = out.filter((o) => o.imgPlace === "stem").length;
  console.log("accepted", out.length, "stem", st, "exp", out.length - st, "images", seen.size, "rejection reasons", reasons);
}
main().catch((e) => { console.error(e); process.exit(1); });
