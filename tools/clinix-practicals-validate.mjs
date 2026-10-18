#!/usr/bin/env node
/* Validates CliniX practicals decks: node tools/clinix-practicals-validate.mjs <deck.json...> [--src <source.txt>]
   Checks the schema in docs/clinix/practicals-schema.md, ASCII punctuation, length caps, unique ids, and (with --src) the
   share of 7-word sequences copied from the source text per item (warn over 25 percent, fail over 45 percent). Exit 1 on any error. */
import { readFileSync } from "node:fs";
const args = process.argv.slice(2); let src = null; const files = [];
for (let i = 0; i < args.length; i++) { if (args[i] === "--src") src = readFileSync(args[++i], "utf8"); else files.push(args[i]); }
const KINDS = new Set(["instrument", "device", "drug", "procedure", "method", "staging", "chart", "specimen", "xray", "model", "case-sheet", "exam-step", "topic"]);
const NEEDS_IMAGE = new Set(["instrument", "device", "specimen", "xray", "model", "method", "procedure"]);
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9% ]+/g, " ").split(/\s+/).filter(Boolean);
const shingles = (w, n = 7) => { const o = new Set(); for (let i = 0; i + n <= w.length; i++) o.add(w.slice(i, i + n).join(" ")); return o; };
const srcSet = src ? shingles(words(src)) : null;
const numsOf = (t) => new Set((String(t).match(/\d+(?:\.\d+)?/g) || []));
const srcNums = src ? numsOf(src) : null;
let errors = 0, warns = 0; const ids = new Set();
const err = (id, m) => { errors++; console.log(`ERROR ${id}: ${m}`); }; const warn = (id, m) => { warns++; console.log(`warn  ${id}: ${m}`); };
const texts = (it) => { const t = [it.summary || "", ...(it.aka || [])]; for (const b of it.blocks || []) { t.push(b.title || "", b.text || ""); (b.bullets || []).forEach((x) => t.push(x)); (b.groups || []).forEach((g) => { t.push(g.label || ""); (g.bullets || []).forEach((x) => t.push(x)); }); if (b.table) { t.push(...(b.table.head || [])); (b.table.rows || []).forEach((r) => t.push(...r)); } } for (const v of it.viva || []) t.push(v.q || "", v.a || ""); return t; };
for (const f of files) {
  let d; try { d = JSON.parse(readFileSync(f, "utf8")); } catch (e) { err(f, "invalid JSON: " + e.message); continue; }
  if (d.v !== 1 || !d.subject || !d.section || !d.title || !d.title.en || !Array.isArray(d.items)) err(f, "deck needs v:1, subject, section, title.en, items[]");
  for (const it of d.items || []) {
    const id = it.id || "(no id)"; if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) err(id, "bad id"); if (ids.has(id)) err(id, "duplicate id"); ids.add(id);
    if (!KINDS.has(it.kind)) err(id, "bad kind " + it.kind);
    if (!it.title || !it.title.en) err(id, "title.en missing");
    if (!it.summary || it.summary.length < 20) err(id, "summary missing or too short");
    if (!Array.isArray(it.blocks) || it.blocks.length < 1) err(id, "blocks missing");
    for (const b of it.blocks || []) { if (!b.title) err(id, "block without title"); const n = ["bullets", "text", "groups", "table"].filter((k) => b[k] != null).length; if (n !== 1) err(id, `block "${b.title}" must have exactly one of bullets, text, groups, table`); }
    if (it.viva && (it.viva.length < 2 || it.viva.length > 4)) warn(id, "viva should have 2 to 4 pairs");
    if (!it.viva || !it.viva.length) err(id, "viva missing");
    for (const v of it.viva || []) { if (!v.q || !v.a) err(id, "viva pair incomplete"); else if (words(v.a).length > 45) warn(id, "viva answer over 45 words"); }
    if (NEEDS_IMAGE.has(it.kind) && !(it.image && it.image.brief && it.image.brief.length > 20)) err(id, "image.brief required for kind " + it.kind);
    if (it.image && (it.image.file || it.image.mediaId)) warn(id, "image.file or mediaId set: must be a cleared image, never a book image");
    if (!it.src || !it.src.book) err(id, "src missing"); if (it.review !== "ai_drafted") err(id, 'review must be "ai_drafted"');
    const all = texts(it); const joined = all.join(" ");
    if (/[–—‒―]/.test(joined)) err(id, "em or en dash in text");
    for (const t of all) { if (String(t).length > 240 && !(it.blocks || []).some((b) => b.text === t)) warn(id, "long line (" + String(t).length + ")"); if (/lorem ipsum/i.test(t)) err(id, "lorem"); }
    if (srcNums) { const bad = [...numsOf(joined)].filter((n) => n.length > 1 && !srcNums.has(n) && !(it.unsure || []).join(' ').includes(n)); if (bad.length >= 3) warn(id, `numbers not found in the source (check for invention): ${bad.slice(0, 12).join(', ')}`); }
    if (srcSet) { const sh = shingles(words(joined)); let hit = 0; for (const s of sh) if (srcSet.has(s)) hit++; const r = sh.size ? hit / sh.size : 0; if (r > 0.45) err(id, `copied ${Math.round(r * 100)}% of 7-word sequences from the source`); else if (r > 0.25) warn(id, `${Math.round(r * 100)}% of 7-word sequences match the source`); }
  }
  console.log(`${f}: ${(d.items || []).length} items`);
}
console.log(`${errors} errors, ${warns} warnings`); process.exit(errors ? 1 : 0);
