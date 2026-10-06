#!/usr/bin/env node
// PrepNucleus Layer B source packs. Dev-only, never shipped, costs nothing (no model call). Plan: vault/plans/PrepNucleus.md
// 6.3 (D2 sources; quality rules: no verbatim reuse, no source name in the app). Feeds tools/prep-fill.mjs.
//
// RUN
//   node tools/prep-packs.mjs [--module <id>[,<id>]] [--shortfall prep/fill/shortfall.json] [--tax prep/taxonomy]
//       [--packs prep/fill/packs] [--extra ~/prep-data/packs-statpearls] [--cache ~/prep-data/statpearls-cache]
//       [--threshold 0.30] [--no-sp] [--dry] [--sample 30] [--stats <file.json>]
//
// WHAT, per shortfall module that has no hand-made pack (a pack.json without "gen": "prep-packs" is never touched)
//   1. Repo KB ($0). kb/clinical-protocols, kb/diseases (+ kb/treatments of the same id), kb/reference, kb/protocols
//      (oncology regimens), kb/onco/staging are flattened to text (ids, sources, references, review, provenance,
//      hashes, slugs and any sentence naming a book are dropped) and matched to the module with BM25 (module title x2 +
//      section title + scope terms vs document title and aliases x3 + text). A doc is used when its normalised score
//      (BM25 over the query's best possible score) is >= --threshold and >= REL x the module's top score.
//   2. StatPearls for gaps ($0). A module whose KB text is under its word target (about 140 words per question needed,
//      1,500 to 6,000) gets up to 3 StatPearls chapters: E-utilities esearch db=books (<= 3 requests a second, tool and
//      email params, retry with backoff) + esummary give chapter accessions; chapters are re-ranked on their titles. The
//      Bookshelf pages answer bots with a reCAPTCHA and efetch has no book text, so the text comes from the NCBI
//      Literature Archive bundle (one streamed pass over ftp litarch statpearls_NBK430685.tar.gz, only the wanted
//      article-*.nxml are kept, gzipped, in --cache). Kept sections: everything except references, review questions,
//      continuing education, team/nursing, equipment/personnel/preparation; tables, figures and citation marks dropped.
//   3. Write. KB only -> prep/fill/packs/<module>/ (committed). ANY StatPearls text -> --extra/<module>/ (never in the
//      repo: it is public and StatPearls is CC BY-NC-ND). Each pack: NN-<srcId>.txt ("#" headings) + pack.json
//      { srcPack: [{ id: kb-<file> | sp-nbk<id>, title, url? }], avoid: [...], gen: "prep-packs", words }.
//      A pack is capped at CAP_WORDS words.
//   --dry writes nothing; --sample N prints N random module -> doc matches (for precision checks); --stats writes the
//   coverage summary JSON that the report is built from.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BOOK_RE } from "./prep-fill.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CAP_WORDS = 6000;
export const MIN_WORDS = 1500;
export const WORDS_PER_Q = 140;   // ~1.5 facts a needed question (overgen 1.15 x extract 1.3), ~12 facts a 1,100-word chunk
export const REL = 0.5;
export const MAX_KB_DOCS = 6;
export const SP_MAX = 3;
const NCBI = { tool: "stewardmd-prep", email: "drmanojkurmana@gmail.com" };
const LITARCH = "https://ftp.ncbi.nlm.nih.gov/pub/litarch/3d/12/statpearls_NBK430685.tar.gz";
const home = (p) => String(p).replace(/^~(?=\/|$)/, os.homedir());

// =====================================================================================================================
// Text: tokenizer and BM25
// =====================================================================================================================
const STOP = new Set(("a an the and or of in on at to for from by with without into over under than as is are was were be been being " +
  "it its this that these those which who whom whose what when where why how not no nor but if then else also only other " +
  "such can may might will would should could must do does did has have had per via vs versus about after before between " +
  "during within each any all both more most less least very use used using including include includes based type types " +
  // medical-generic words that carry no topic on their own
  "disease diseases disorder disorders syndrome syndromes condition conditions management manage treatment treatments therapy " +
  "therapies clinical clinically diagnosis diagnostic patient patients approach principles principle overview basics general " +
  "evaluation assessment features feature presentation care adult adults common related associated major minor key main " +
  "first second new current role update updates concept concepts aspects part parts introduction medicine medical").split(/\s+/));
const SPELL = [[/haem/g, "hem"], [/^oe/g, "e"], [/aem/g, "em"], [/paed/g, "ped"], [/oestr/g, "estr"], [/our$/g, "or"], [/isation$/g, "ization"], [/yse$/g, "yze"]];
export function stem(t) {
  for (const [re, to] of SPELL) t = t.replace(re, to);
  if (t.length > 4 && /ies$/.test(t)) return t.slice(0, -3) + "y";
  if (t.length > 3 && /[^su]s$/.test(t)) return t.slice(0, -1);
  return t;
}
export function tokenize(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)
    .filter((t) => t && (t.length > 1 || /\d/.test(t)) && !STOP.has(t)).map(stem).filter((t) => !STOP.has(t));
}
/* bm25(docs) -> { score(qTokens) -> Float64Array, norm(qTokens) -> best possible score, idf(t) }.
 * docs: [{ tokens: string[] }]. Query tokens may repeat (repeat = weight). */
export function bm25(docs, k1 = 1.2, b = 0.75) {
  const N = docs.length, df = new Map(), tfs = [], lens = [];
  for (const d of docs) {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfs.push(tf); lens.push(d.tokens.length);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const avg = lens.reduce((a, x) => a + x, 0) / Math.max(1, N);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  const qw = (q) => { const w = new Map(); for (const t of q) w.set(t, (w.get(t) || 0) + 1); return w; };
  return {
    idf, df,
    score(q) {
      const out = new Float64Array(N);
      for (const [t, w] of qw(q)) {
        if (!df.has(t)) continue;
        const i = idf(t);
        for (let d = 0; d < N; d++) {
          const f = tfs[d].get(t);
          if (f) out[d] += w * i * (f * (k1 + 1)) / (f + k1 * (1 - b + b * lens[d] / avg));
        }
      }
      return out;
    },
    norm(q) { let s = 0; for (const [t, w] of qw(q)) s += w * idf(t) * (k1 + 1); return s || 1; },
  };
}

// =====================================================================================================================
// KB flattening
// =====================================================================================================================
const SKIP_KEY = /^(?:id|ids|.*Id|.*Ids|.*Ref|.*Refs|refs?|references|sources?|coding|provenance|review|contentHash|importedAt|pages|sourceEdition|edition|url|urls|version|lifecycleState|caps|institution|icon|scribe|target|class|precedence|tier|crossLinks|associatedFindings|schemaVersion|_note|referenceOnly|compiled|status|basis|unit|query|evidence|kind|line|gapMessage|matching)$/;
const SRC_RE = /\b(?:harrison|devita|campbell|nccn|statpearls|uptodate|medscape|bailey|sabiston|robbins|\d{1,2}(?:st|nd|rd|th)\s+ed\b|\d{2}e\b|edition\b)|\bpp?\.\s?\d|\bchap\.|\bsource[:-]|\bline \d+|\blocator\b/i;
const keyLabel = (k) => { const s = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const sluggy = (s) => !/\s/.test(s) && (/^[a-z0-9]+$/.test(s) || /[_-]/.test(s) && /^[\w.-]+$/.test(s) || /^[a-z]+[A-Z]\w*$/.test(s));
const CONTAINER = new Set(["sections", "items", "versions", "enrichment", "reference", "harrison", "recommendations", "decision"]);
const PLAIN = new Set(["summary", "text", "notes", "note", "description", "why", "label", "name", "introduction"]);
export const words = (s) => (String(s).match(/\S+/g) || []).length;
const clean = (s) => String(s).replace(/\s+/g, " ").trim();
const SRC_G = new RegExp(SRC_RE.source, "gi");
/* scrub(s) -> s without parenthetical citations that name a source, then without any sentence still naming one. */
export function scrub(s) {
  s = clean(s).replace(/\s*[([][^()[\]]*[)\]]/g, (m) => (SRC_G.test(m) || BOOK_RE.test(m) ? ((SRC_G.lastIndex = 0), "") : ((SRC_G.lastIndex = 0), m)));
  if (!SRC_RE.test(s) && !BOOK_RE.test(s)) return s;
  return s.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).filter((x) => !SRC_RE.test(x) && !BOOK_RE.test(x)).join(" ");
}
const keepStr = (s) => { s = scrub(s); return s && !sluggy(s) ? s : ""; };
/* flattenJson(obj) -> plain text: "# " heading lines for prose keys, one line per prose string, short string lists
 * joined on one line. Skips ids, sources, references, review, provenance, hashes, slugs and source-naming strings. */
export function flattenJson(obj, title) {
  const lines = [];
  const head = (h) => { if (lines.length && lines[lines.length - 1].startsWith("# ")) lines.pop(); lines.push("# " + h); };
  const walk = (o, key) => {
    if (o == null) return;
    if (typeof o === "string") { const s = keepStr(o); if (s) lines.push(s); return; }
    if (typeof o !== "object") return;
    if (Array.isArray(o)) {
      if (o.every((x) => typeof x === "string")) {
        const xs = o.map(keepStr).filter(Boolean);
        if (!xs.length) return;
        if (xs.every((x) => words(x) <= 6)) lines.push((key && keepStr(keyLabel(key)) ? keyLabel(key) + ": " : "") + xs.map((x) => x.replace(/[.;,]+$/, "")).join("; ") + ".");
        else lines.push(...xs);
        return;
      }
      for (const x of o) walk(x, key);
      return;
    }
    const ents = Object.entries(o).filter(([k]) => !SKIP_KEY.test(k) && !(k === "code" && typeof o.label === "string"));
    if (typeof o.code === "string" && typeof o.label === "string") { const l = keepStr(o.label); if (l) lines.push(clean(o.code) + ": " + l); ents.splice(0, ents.length, ...ents.filter(([k]) => k !== "label")); }
    if (typeof o.title === "string" && keepStr(o.title)) head(keepStr(o.title));
    const leafE = ents.filter(([k, v]) => typeof v === "string" && k !== "title").map(([k, v]) => [k, keepStr(v)]).filter(([, v]) => v);
    const leaf = leafE.map(([, v]) => v);
    if (leaf.length > 1 && leaf.every((x) => words(x) <= 14)) lines.push(leaf.map((x) => x.replace(/[.;,]+$/, "")).join(", ") + ".");
    else for (const [k, x] of leafE) { if (words(x) > 15 && !PLAIN.has(k) && keepStr(keyLabel(k))) head(keyLabel(k)); lines.push(x); }
    for (const [k, v] of ents) {
      if (typeof v === "string" || v == null || typeof v !== "object") continue;
      const prose = !Array.isArray(v) || v.some((x) => typeof x === "object" || words(x) > 6);
      if (prose && !/^\d+$/.test(k) && !CONTAINER.has(k) && keepStr(keyLabel(k))) head(keyLabel(k));
      walk(v, k);
    }
  };
  if (title) lines.push("# " + title);
  walk(obj, "");
  while (lines.length && lines[lines.length - 1].startsWith("# ")) lines.pop();
  return lines.join("\n");
}

const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const listJson = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJson(p)); else if (e.name.endsWith(".json")) out.push(p);
  }
  return out.sort();
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((s) => typeof s === "string");

/* kbDocs(root) -> [{ id, title, kind, aliases, text, words }]. id is the neutral srcPack slug kb-<file>. */
export function kbDocs(root = ROOT) {
  const K = (p) => path.join(root, "kb", p);
  const raw = [];
  for (const f of listJson(K("clinical-protocols"))) { const j = readJ(f); if (j && j.title) raw.push({ f, kind: "clinical protocol", title: j.title, aliases: asList(j.aliases), j }); }
  const treat = new Map(listJson(K("treatments")).map((f) => [path.basename(f, ".json"), readJ(f)]));
  const usedTreat = new Set();
  for (const f of listJson(K("diseases"))) {
    const j = readJ(f); if (!j || !j.name) continue;
    const b = path.basename(f, ".json"), t = treat.get(b);
    if (t) usedTreat.add(b);
    raw.push({ f, kind: "disease page", title: j.name, aliases: asList(j.aliases), j, extra: t ? { treatment: t } : null });
  }
  for (const [b, t] of treat) if (t && !usedTreat.has(b)) raw.push({ f: K("treatments/" + b + ".json"), kind: "treatment page", title: t.regimenLabel || b.replace(/[_-]/g, " "), aliases: [], j: t });
  for (const f of listJson(K("reference"))) { const j = readJ(f); if (j && j.name) raw.push({ f, kind: "reference page", title: j.name, aliases: asList(j.aliases), j }); }
  for (const f of listJson(K("protocols"))) { const j = readJ(f); if (j && j.name) raw.push({ f, kind: "oncology regimen", title: j.name, aliases: asList(j.histology), j }); }
  for (const f of listJson(K("onco/staging"))) { const j = readJ(f); if (j && j.name) raw.push({ f, kind: "staging page", title: j.name + " staging", aliases: [], j }); }
  const seen = new Set(), out = [];
  for (const r of raw) {
    let id = ("kb-" + slug(path.basename(r.f, ".json"))).slice(0, 57);
    while (seen.has(id)) id = id.replace(/(-\d+)?$/, (m) => "-" + ((Number(m.slice(1)) || 1) + 1));
    seen.add(id);
    let text = flattenJson(r.j, clean(r.title));
    if (r.extra) text += "\n" + flattenJson(r.extra.treatment, clean(r.title) + ": treatment");
    out.push({ id, title: "StewardMD " + r.kind + ": " + clean(r.title), name: clean(r.title), kind: r.kind, aliases: r.aliases, text, words: words(text), file: path.relative(root, r.f) });
  }
  return out;
}

// =====================================================================================================================
// Modules and matching
// =====================================================================================================================
/* shortfallModules(taxDir, shortfallFile) -> [{ id, subject, title, section, scope, fill }] in shortfall order. */
export function shortfallModules(taxDir, sfFile, only) {
  const tax = new Map();
  for (const f of fs.readdirSync(taxDir).filter((x) => x.endsWith(".json"))) {
    const s = readJ(path.join(taxDir, f));
    for (const sec of s.sections || []) for (const m of sec.modules || []) tax.set(m.id, { id: m.id, subject: s.id, subjectTitle: s.title, title: m.title, section: sec.title, scope: m.scope || "" });
  }
  const sf = readJ(sfFile);
  let rows = (sf && sf.modules) || [];
  if (only) rows = only.map((id) => rows.find((r) => r.module === id) || { module: id, fill: 40 });
  return rows.filter((r) => tax.has(r.module)).map((r) => ({ ...tax.get(r.module), fill: r.fill | 0 }));
}
export const scopeTerms = (m) => String(m.scope || "").split(/[,;]/).map(clean).filter(Boolean);
export const moduleQuery = (m) => [...tokenize(m.title), ...tokenize(m.title), ...tokenize(m.section), ...tokenize(scopeTerms(m).join(" "))];
export const docTokens = (d) => { const t = tokenize([d.name, ...d.aliases].join(" ")); return [...t, ...t, ...t, ...tokenize(d.text)]; };
export const targetWords = (fill) => Math.min(CAP_WORDS, Math.max(MIN_WORDS, Math.round((fill || 0) * WORDS_PER_Q)));

/* matchDocs(index, docs, module, threshold) -> [{ doc, s }] best first: s >= threshold and >= REL x top, at most MAX_KB_DOCS. */
export function matchDocs(index, docs, m, threshold) {
  const q = moduleQuery(m), sc = index.score(q), n = index.norm(q);
  const ranked = Array.from(sc, (s, i) => ({ i, s: s / n })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 25);
  if (!ranked.length) return [];
  const top = ranked[0].s;
  return ranked.filter((x) => x.s >= threshold && x.s >= REL * top).slice(0, MAX_KB_DOCS).map((x) => ({ doc: docs[x.i], s: x.s }));
}

/* capParts(parts, max) -> parts trimmed in order so the total stays <= max words (whole lines; a part reduced to
 * headings only is dropped). parts: [{ id, text, ... }] */
export function capParts(parts, max = CAP_WORDS) {
  const out = [];
  let left = max;
  for (const p of parts) {
    if (left <= 0) break;
    const keep = [];
    let w = 0;
    for (const line of p.text.split("\n")) {
      const lw = words(line);
      if (w + lw > left) break;
      keep.push(line); w += lw;
    }
    while (keep.length && keep[keep.length - 1].startsWith("# ")) { w -= words(keep.pop()); }
    if (!keep.some((l) => !l.startsWith("# "))) continue;
    out.push({ ...p, text: keep.join("\n"), words: w });
    left -= w;
  }
  return out;
}

// =====================================================================================================================
// StatPearls (NCBI E-utilities + Literature Archive bundle)
// =====================================================================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
/* ncbi(url, cacheFile) -> JSON. Cached; <= 3 requests a second; retry with backoff on 429, 5xx and network errors. */
async function ncbi(endpoint, params, cacheFile, fetchFn = fetch) {
  if (cacheFile && fs.existsSync(cacheFile)) return readJ(cacheFile);
  const qs = new URLSearchParams({ ...params, retmode: "json", tool: NCBI.tool, email: NCBI.email });
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}.fcgi?${qs}`;
  for (let a = 0; ; a++) {
    const wait = lastCall + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const r = await fetchFn(url);
      if (r.ok) {
        const j = await r.json();
        if (j && !j.error && !(j.esearchresult && j.esearchresult.ERROR)) { if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(j)); } return j; }
        throw new Error("ncbi error " + JSON.stringify(j.error || j.esearchresult.ERROR));
      }
      if (r.status !== 429 && r.status < 500) throw Object.assign(new Error(`ncbi ${r.status}`), { fatal: true });
      throw new Error(`ncbi ${r.status}`);
    } catch (e) {
      if (e.fatal || a >= 5) throw e;
      await sleep(1000 * 2 ** a);
    }
  }
}
const titleWords = (m) => String(m.title).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1 && !STOP.has(x) && !/^\d+$/.test(x)).slice(0, 6);
const quote = (s) => `"${s.replace(/"/g, "")}"`;
/* spTerms(module) -> esearch terms, StatPearls chapters only: [title words AND-ed OR up to 3 scope terms, then a
 * looser fallback with every title word and scope term OR-ed]. */
export function spTerms(m) {
  const t = titleWords(m), sc = scopeTerms(m);
  const tail = " AND statpearls[book] AND chapter[type]";
  return [
    `(${[t.length ? `(${t.join(" ")})` : "", ...sc.slice(0, 3).map(quote)].filter(Boolean).join(" OR ")})` + tail,
    `(${[...t, ...sc.slice(0, 6).map(quote)].join(" OR ")})` + tail,
  ];
}
async function spSearch(term, cacheDir, fetchFn) {
  const h = crypto.createHash("sha1").update(term).digest("hex").slice(0, 16);
  const es = await ncbi("esearch", { db: "books", term, retmax: "40", sort: "relevance" }, path.join(cacheDir, "search", h + ".json"), fetchFn);
  const ids = (es.esearchresult && es.esearchresult.idlist) || [];
  if (!ids.length) return [];
  const sm = await ncbi("esummary", { db: "books", id: ids.join(",") }, path.join(cacheDir, "summary", h + ".json"), fetchFn);
  const res = (sm && sm.result) || {};
  return ids.map((uid, rank) => {
    const r = res[uid];
    if (!r || r.book !== "statpearls") return null;
    const art = /^statpearls\/(?:chapter\/)?(article-\d+)/.exec(r.id || "");
    const ttl = r.rtype === "chapter" ? [0, r.title] : /role="document" type="chapter"[^>]*><Title>([^<]+)<\/Title>/.exec(r.bookinfo || "");
    if (!art || !ttl || !r.chapteraccessionid || /\(Archived\)/i.test(ttl[1])) return null;
    return { nbk: r.chapteraccessionid, article: art[1], title: decodeEnt(ttl[1]), rank };
  }).filter(Boolean);
}
/* spRank(module, chapters, idf) -> chapters scored on their titles against the module query (title words x2; each
 * title word the module does not mention costs), best first, s >= 3 only. */
export function spRank(m, chapters, idf) {
  const q = new Set(moduleQuery(m)), titleQ = new Set(tokenize(m.title)), seen = new Set();
  return chapters.filter((c) => !seen.has(c.article) && seen.add(c.article)).map((c) => {
    const ct = [...new Set(tokenize(c.title))];
    let s = 0;
    for (const t of ct) if (q.has(t)) s += idf(t) * (titleQ.has(t) ? 2 : 1);
    const miss = ct.filter((t) => !q.has(t)).length;
    return { ...c, s: s / (1 + 0.5 * miss) - c.rank * 0.01 };
  }).filter((c) => c.s >= 3).sort((a, b) => b.s - a.s);
}
/* spChapters(module, cacheDir, idf) -> [{ nbk, article, title, s }] best first (<= SP_MAX). */
export async function spChapters(m, cacheDir, idf, fetchFn) {
  const [strict, loose] = spTerms(m);
  let got = await spSearch(strict, cacheDir, fetchFn);
  if (spRank(m, got, idf).length < SP_MAX) got = got.concat((await spSearch(loose, cacheDir, fetchFn)).map((c) => ({ ...c, rank: c.rank + 5 })));
  return spRank(m, got, idf).slice(0, SP_MAX);
}
export function decodeEnt(s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
const DROP_SEC = /references|review questions|continuing education|enhancing healthcare team|nursing|interprofessional|disclosure|acknowledg|^equipment$|^personnel$|^preparation$|objectives|patient education|deterrence/i;
/* nxmlToText(xml) -> { title, text }: the chapter body as "#"-headed plain text without references, tables, figures,
 * citation marks or the sections in DROP_SEC. */
export function nxmlToText(xml) {
  const title = clean(decodeEnt(((/<book-part-meta>[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml) || [])[1] || "").replace(/<[^>]+>/g, "")));
  let body = (/<body>([\s\S]*)<\/body>/.exec(xml) || [])[1] || "";
  body = body.replace(/<(ref-list|table-wrap|fig|fn-group|fn|disp-formula|supplementary-material|media|graphic)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<(graphic|media|inline-graphic)\b[^>]*\/>/g, " ").replace(/<xref\b[^>]*>[\s\S]*?<\/xref>/g, "").replace(/<xref\b[^>]*\/>/g, "");
  const parts = body.split(/(<sec\b[^>]*>|<\/sec>)/);
  const stack = [];
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^<sec\b/.test(p)) {
      const t = clean(decodeEnt(((/^\s*<title>([\s\S]*?)<\/title>/.exec(parts[i + 1] || "") || [])[1] || "").replace(/<[^>]+>/g, "")));
      stack.push(stack.some(Boolean) || DROP_SEC.test(t));
      continue;
    }
    if (p === "</sec>") { stack.pop(); continue; }
    if (stack.some(Boolean)) continue;
    out += p.replace(/<title>([\s\S]*?)<\/title>/g, "\n# $1\n").replace(/<\/(p|list-item|title)>/g, "\n").replace(/<[^>]+>/g, " ");
  }
  const lines = decodeEnt(out).split("\n").map((l) => clean(l.replace(/\[\s*\d*(?:\s*[,\u2013-]\s*\d*)*\s*\]/g, "").replace(/\(\s*\)/g, "").replace(/\s+([.,;:])/g, "$1")))
    .map((l) => (l.startsWith("# ") ? l : scrub(l))).filter((l) => l && l !== "#" && !(l.startsWith("# ") && (SRC_RE.test(l) || BOOK_RE.test(l))));
  const keep = [];
  for (const l of lines) { if (l.startsWith("# ") && keep.length && keep[keep.length - 1].startsWith("# ")) keep.pop(); keep.push(l); }
  while (keep.length && keep[keep.length - 1].startsWith("# ")) keep.pop();
  return { title, text: keep.join("\n") };
}
/* tarScan(readable, want(name) -> bool, onFile(name, buf) -> stop?) : a minimal ustar/pax reader over a stream. */
export async function tarScan(readable, want, onFile) {
  let pend = null, mode = "h", left = 0, pad = 0, keep = null, name = "", type = "0", longName = null;
  const done = () => {
    const buf = keep ? Buffer.concat(keep) : null;
    if (type === "L" && buf) longName = buf.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "x" && buf) { const m = /\d+ path=([^\n]*)\n/.exec(buf.toString("utf8")); if (m) longName = m[1]; }
    else if (buf) return onFile(name, buf);
    return false;
  };
  for await (let chunk of readable) {
    if (pend) { chunk = Buffer.concat([pend, chunk]); pend = null; }
    let o = 0;
    while (o < chunk.length) {
      if (mode === "h") {
        if (chunk.length - o < 512) { pend = Buffer.from(chunk.subarray(o)); break; }
        const h = chunk.subarray(o, o + 512); o += 512;
        if (h[0] === 0 && h.every((b) => b === 0)) continue;
        const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
        const pre = str(345, 500);
        name = longName || (pre ? pre + "/" : "") + str(0, 100); longName = null;
        type = String.fromCharCode(h[156] || 48);
        left = parseInt(str(124, 136).trim() || "0", 8); pad = (512 - (left % 512)) % 512;
        keep = type === "L" || type === "x" || ((type === "0" || type === "\0") && want(name)) ? [] : null;
        if (left === 0) { if (done()) return; mode = "h"; } else mode = "d";
      } else if (mode === "d") {
        const n = Math.min(left, chunk.length - o);
        if (keep) keep.push(Buffer.from(chunk.subarray(o, o + n)));
        o += n; left -= n;
        if (left === 0) { if (done()) return; mode = pad ? "p" : "h"; }
      } else {
        const n = Math.min(pad, chunk.length - o);
        o += n; pad -= n;
        if (!pad) mode = "h";
      }
    }
  }
}
/* fetchArticles(articleIds, cacheDir, log) -> fills cacheDir/articles/<article>.nxml.gz for the missing ones with one
 * streamed pass over the Literature Archive bundle (stops as soon as all are found). */
export async function fetchArticles(ids, cacheDir, log = console.log) {
  const dir = path.join(cacheDir, "articles");
  fs.mkdirSync(dir, { recursive: true });
  const miss = new Set([...ids].filter((a) => !fs.existsSync(path.join(dir, a + ".nxml.gz"))));
  if (!miss.size) return 0;
  log(`streaming the StatPearls bundle for ${miss.size} articles (one pass, only the wanted .nxml are kept)`);
  const ac = new AbortController();
  const r = await fetch(LITARCH, { signal: ac.signal });
  if (!r.ok) throw new Error("litarch " + r.status);
  const src = Readable.fromWeb(r.body), gun = src.pipe(zlib.createGunzip());
  const quiet = () => {};   // the early stop aborts the download on purpose
  src.on("error", quiet); gun.on("error", quiet);
  let got = 0;
  try {
    await tarScan(gun, (n) => miss.has(path.basename(n, ".nxml")), (n, buf) => {
      const a = path.basename(n, ".nxml");
      fs.writeFileSync(path.join(dir, a + ".nxml.gz"), zlib.gzipSync(buf));
      miss.delete(a); got++;
      if (got % 200 === 0) log(`  ${got} articles saved, ${miss.size} to go`);
      return miss.size === 0;
    });
  } finally { ac.abort(); src.destroy(); gun.destroy(); }
  if (miss.size) log(`  not in the bundle: ${[...miss].slice(0, 20).join(", ")}${miss.size > 20 ? " ..." : ""}`);
  return got;
}
const readArticle = (cacheDir, a) => { const f = path.join(cacheDir, "articles", a + ".nxml.gz"); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString("utf8") : null; };

// =====================================================================================================================
// Packs
// =====================================================================================================================
const AVOID = ["Harrison", "DeVita", "Campbell", "NCCN", "StatPearls"];
/* writePack(dir, parts) : NN-<id>.txt per part + pack.json; replaces an earlier generated pack in place. */
export function writePack(dir, parts) {
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".txt") || f === "pack.json") fs.rmSync(path.join(dir, f));
  fs.mkdirSync(dir, { recursive: true });
  parts.forEach((p, i) => fs.writeFileSync(path.join(dir, String(i + 1).padStart(2, "0") + "-" + p.id + ".txt"), p.text + "\n"));
  const srcPack = parts.map((p) => ({ id: p.id, title: p.title, ...(p.url ? { url: p.url } : {}) }));
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ srcPack, avoid: AVOID, gen: "prep-packs", words: parts.reduce((a, p) => a + p.words, 0) }, null, 1) + "\n");
}
const handMade = (dir) => { const j = readJ(path.join(dir, "pack.json")); return !!j && j.gen !== "prep-packs"; };

function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith("--")) a.flags.add(k.slice(2)); else { a[k.slice(2)] = v; i++; }
  }
  return a;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv), log = deps.log || console.log, root = deps.root || ROOT;
  const R = (k, d) => path.resolve(root, home(args[k] || d));
  const packs = R("packs", "prep/fill/packs"), extra = R("extra", "~/prep-data/packs-statpearls"), cache = R("cache", "~/prep-data/statpearls-cache");
  const threshold = args.threshold != null ? Number(args.threshold) : 0.3;
  const only = args.module ? String(args.module).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const mods = shortfallModules(R("tax", "prep/taxonomy"), R("shortfall", "prep/fill/shortfall.json"), only)
    .filter((m) => !handMade(path.join(packs, m.id)) && !handMade(path.join(extra, m.id)));
  const docs = kbDocs(root);
  const index = bm25(docs.map((d) => ({ tokens: docTokens(d) })));
  log(`${mods.length} modules without a hand-made pack; KB corpus ${docs.length} docs, ${docs.reduce((a, d) => a + d.words, 0)} words`);

  const plan = mods.map((m) => {
    const hits = matchDocs(index, docs, m, threshold);
    return { m, hits, kb: capParts(hits.map((h) => ({ id: h.doc.id, title: h.doc.title, text: h.doc.text, s: h.s })), targetWords(m.fill)) };
  });
  if (args.sample) {
    const r = rng(Number(args.seed) || 7), pairs = [];
    const floor = args["sample-floor"] != null ? Number(args["sample-floor"]) : threshold;
    for (const p of plan) {
      const q = moduleQuery(p.m), sc = index.score(q), n = index.norm(q);
      const best = Array.from(sc, (s, i) => ({ i, s: s / n })).sort((a, b) => b.s - a.s).slice(0, MAX_KB_DOCS);
      const top = best.length ? best[0].s : 0;
      for (const b of best) if (b.s >= floor && b.s >= REL * top) pairs.push({ m: p.m, d: docs[b.i], s: b.s });
    }
    for (let i = 0; i < Number(args.sample) && pairs.length; i++) {
      const p = pairs.splice(Math.floor(r() * pairs.length), 1)[0];
      log(`${p.s.toFixed(3)}\t${p.m.id} | ${p.m.title} || ${p.d.name} [${p.d.kind}]`);
    }
    return { sample: true };
  }

  // StatPearls for modules whose KB text is short of the target
  const sp = new Map();
  if (!args.flags.has("no-sp")) {
    const gaps = plan.filter((p) => p.kb.reduce((a, x) => a + x.words, 0) < targetWords(p.m.fill));
    log(`${gaps.length} modules short of their word target: StatPearls search (cached, <= 3 requests a second)`);
    let i = 0;
    for (const p of gaps) {
      try { sp.set(p.m.id, await spChapters(p.m, cache, index.idf, deps.fetch)); }
      catch (e) { log(`  ${p.m.id}: search failed, ${e.message}`); }
      if (++i % 50 === 0) log(`  searched ${i}/${gaps.length}`);
    }
    const want = new Set([...sp.values()].flat().map((c) => c.article));
    if (!args.flags.has("dry") || args.flags.has("fetch")) await fetchArticles(want, cache, log);
  }

  const rows = [];
  for (const p of plan) {
    const kbW = p.kb.reduce((a, x) => a + x.words, 0), target = targetWords(p.m.fill);
    const spParts = [];
    for (const c of sp.get(p.m.id) || []) {
      const xml = readArticle(cache, c.article);
      if (!xml) continue;
      const t = nxmlToText(xml);
      if (words(t.text) < 150) continue;
      spParts.push({ id: "sp-" + c.nbk.toLowerCase(), title: "Reference chapter: " + (t.title || c.title), url: `https://www.ncbi.nlm.nih.gov/books/${c.nbk}/`, text: "# " + (t.title || c.title) + "\n" + t.text });
    }
    // KB first, then StatPearls up to the target (never above CAP_WORDS)
    const spCapped = capParts(spParts, Math.max(0, target - kbW)).filter((x) => x.words >= 100);   // no stub tails
    const parts = [...p.kb, ...spCapped];
    const w = parts.reduce((a, x) => a + x.words, 0);
    const where = spCapped.length ? "extra" : p.kb.length ? "repo" : "none";
    rows.push({ module: p.m.id, subject: p.m.subject, title: p.m.title, fill: p.m.fill, target, kbWords: kbW, spWords: w - kbW, words: w, where,
      kb: p.kb.map((x) => ({ id: x.id, s: Number(x.s.toFixed(3)), words: x.words })), sp: spCapped.map((x) => ({ id: x.id, words: x.words })) });
    if (args.flags.has("dry")) continue;
    const repoDir = path.join(packs, p.m.id), extraDir = path.join(extra, p.m.id);
    if (where === "repo") { writePack(repoDir, parts); if (fs.existsSync(extraDir)) fs.rmSync(extraDir, { recursive: true }); }
    else if (where === "extra") { writePack(extraDir, parts); if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true }); }
  }
  const n = (k) => rows.filter(k).length;
  const sum = { modules: rows.length, kbOnly: n((r) => r.kbWords && !r.spWords), spOnly: n((r) => !r.kbWords && r.spWords), both: n((r) => r.kbWords && r.spWords), none: n((r) => !r.words) };
  log(`packs: KB only ${sum.kbOnly}, StatPearls only ${sum.spOnly}, both ${sum.both}, uncovered ${sum.none}${args.flags.has("dry") ? " (dry run, nothing written)" : ""}`);
  if (args.stats) fs.writeFileSync(R("stats", ""), JSON.stringify({ v: 1, threshold, at: new Date().toISOString(), sum, rows }, null, 1) + "\n");
  return { sum, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
