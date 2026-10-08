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
  } else if (cmd === "search") {
    const qs = j(opt("queries", path.join(DIR, "queries.json")));
    const out = fs.existsSync(path.join(DIR, "cands.json")) ? j(path.join(DIR, "cands.json")) : {};
    for (const [id, list] of Object.entries(qs)) {
      if (out[id] && out[id].length && !argv.includes("--redo")) continue;
      const seen = new Map();
      for (const q of list) { try { for (const c of await searchOne(q)) if (!seen.has(c.title)) seen.set(c.title, { ...c, query: q }); } catch (e) { console.error(id, q, e.message); } await sleep(350); }
      out[id] = [...seen.values()].slice(0, 4);
      console.log(id, out[id].length);
      w(path.join(DIR, "cands.json"), out);
    }
  } else if (cmd === "fetch") {
    const c = j(path.join(DIR, "cands.json")); fs.mkdirSync(path.join(DIR, "raw"), { recursive: true });
    for (const [id, list] of Object.entries(c)) for (const x of list) {
      const f = `${slug(x.title.replace(/^File:/, ""))}.webp`; x.file = f;
      const out = path.join(DIR, "raw", f); if (fs.existsSync(out)) continue;
      const tmp = path.join(os.tmpdir(), "pi-" + process.pid + path.extname(x.thumb).split("?")[0]);
      try {
        const r = await fetch(x.thumb, { headers: { "User-Agent": UA } });
        if (!r.ok) { x.err = "http " + r.status; await sleep(1500); continue; }
        fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
        execFileSync("cwebp", ["-quiet", "-q", "80", "-resize", "1024", "0", tmp, "-o", out]);
      } catch (e) { x.err = String(e.message).slice(0, 80); }
      await sleep(600);
    }
    w(path.join(DIR, "cands.json"), c);
    console.log("fetched; size:", execFileSync("du", ["-sh", path.join(DIR, "raw")]).toString().trim());
  } else if (cmd === "batches") {
    const size = +opt("size", 10);
    const picks = j(path.join(DIR, "picks.json")), c = j(path.join(DIR, "cands.json"));
    const ready = picks.filter((p) => (c[p.id] || []).some((x) => x.file && fs.existsSync(path.join(DIR, "raw", x.file))));
    fs.mkdirSync(path.join(DIR, "batches"), { recursive: true });
    for (let i = 0; i * size < ready.length; i++) {
      const part = ready.slice(i * size, (i + 1) * size).map((p) => ({ id: p.id, q: p.q, o: p.o, answer: p.o[p.a], exp: (p.exp || "").slice(0, 600), candidates: c[p.id].filter((x) => x.file && fs.existsSync(path.join(DIR, "raw", x.file))).map((x) => ({ file: path.join(DIR, "view", x.file.replace(/\.webp$/, ".jpg")), title: x.title, desc: x.desc })) }));
      w(path.join(DIR, "batches", `b${i}.json`), part);
    }
    console.log("batches", Math.ceil(ready.length / size), "items with candidates", ready.length, "of", picks.length);
  } else if (cmd === "finalize") {
    await finalize();
  } else { console.error("usage: see header"); process.exit(1); }
}
function slimIt(it) { return { id: it.id, subject: it.subject, module: it.module, q: it.q, o: it.o, a: it.a, exp: (it.exp || "").slice(0, 700) }; }

async function finalize() {
  const picks = j(path.join(DIR, "picks.json")), c = j(path.join(DIR, "cands.json"));
  const vd = {};
  for (const dirn of ["verdicts", "verdicts2"]) {
    const d = path.join(DIR, dirn); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) for (const r of j(path.join(d, f))) (vd[r.id] = vd[r.id] || {})[dirn] = r;
  }
  const out = [], credits = [], rej = {};
  for (const p of picks) {
    const v = vd[p.id]; const a = v && v.verdicts, b = v && v.verdicts2;
    const cand = (c[p.id] || []);
    const norm = (k) => k && k.file ? { ...k, file: k.file.replace(/^.*\//, "").replace(/\.jpg$/, ".webp") } : k;
    const A = norm(a && a.pick), B = norm(b && b.pick);
    let why = "";
    if (!a) why = "no candidate / no verdict";
    else if (!A || !A.file) why = "verifier 1 rejected all: " + (a.reason || "");
    else if (!b) why = "no second vote";
    else if (!B || B.file !== A.file) why = "verifier 2 disagreed: " + (b.reason || "");
    
    if (why) { rej[p.id] = why; continue; }
    const x = cand.find((k) => k.file === A.file); if (!x) { rej[p.id] = "file missing"; continue; }
    out.push({ id: p.id, subject: p.subject, module: p.module, img: [A.file], place: A.placement === "stem" && B.placement === "stem" ? "stem" : "explanation", licence: x.licence, licenceUrl: x.licenceUrl, author: x.author, source_url: x.page, votes: 2 });
    credits.push(`${A.file} | ${x.title.replace(/^File:/, "")} | ${x.author} | ${x.licence} | ${x.page}`);
  }
  w(path.join(DIR, "pilot.json"), out); fs.writeFileSync(path.join(DIR, "credits.txt"), [...new Set(credits)].join("\n") + "\n"); w(path.join(DIR, "rejected.json"), rej);
  console.log("accepted", out.length, "stem", out.filter((o) => o.place === "stem").length, "explanation", out.filter((o) => o.place === "explanation").length, "rejected", Object.keys(rej).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
