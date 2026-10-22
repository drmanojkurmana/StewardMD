#!/usr/bin/env node
// Build the INI-SS Medical Oncology recall overlay from the owner's private files.
// Reads .private-iniss/iniss.md (docling markdown of the owner's PDF) + .private-iniss/iniss-fixes.json
// (owner-reviewed corrections) and writes .private-iniss/out/iniss1/ss-medical-oncology/son-iniss-recalls.json.
// No AI, no network, no paraphrase: every string is copied from the source; fixes win verbatim.
// Fails non-zero unless exactly 68 items (42 April-2026 + 26 April-2023) parse fully:
// 4 options each, answer in range, Why Correct present, and a why-wrong text for every wrong option.
// Known source gaps (reported, never invented): MCQ 13 has no why-wrong bullet for option D;
// MCQ 42 has no why-wrong bullets at all. Those blocks fail the check below.
//
// USAGE: node tools/prep-iniss-onc.mjs [--in <md>] [--fixes <json>] [--out <file>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export const SET = "iniss1";
export const MODULE = "son-iniss-recalls";
export const SUBJECT = "ss-medical-oncology";
const LETTERS = ["A", "B", "C", "D"];
export const decodeEnt = (s) => String(s == null ? "" : s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function splitBlocks(md) {
  const cut = md.indexOf("## Section 3");
  const src = cut >= 0 ? md.slice(0, cut) : md;
  const lines = src.split("\n");
  const heads = [];
  lines.forEach((l, i) => { const m = /^## MCQ (\d+)( \(April 2023 - MCQ (\d+)\))?: /.exec(l); if (m) heads.push({ n: +m[1], i }); });
  return heads.map((h, k) => {
    let ls = lines.slice(h.i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length);
    const sc = ls.findIndex((l) => /^## Section /.test(l));
    if (sc >= 0) ls = ls.slice(0, sc);
    return { n: h.n, lines: ls };
  });
}

export function groupLines(lines) {
  const out = [];
  for (const raw of lines) {
    if (/^\s*$/.test(raw)) continue;
    if (/^\s*\|/.test(raw)) { out.push({ bullet: false, text: raw.trim(), table: true }); continue; }
    const m = /^\s*-\s+(.*)$/.exec(raw);
    if (m) { out.push({ bullet: true, text: m[1] }); continue; }
    if (out.length && !out[out.length - 1].table) out[out.length - 1].text += "\n" + raw.trim();
    else out.push({ bullet: false, text: raw.trim() });
  }
  return out;
}

/* "Option A (label): txt" | "Option A: txt" | "Options A, B, and C (labels): txt" | "Options B, C, and D txt" */
export function parseWhyBullet(text) {
  const s = String(text || "").trim();
  const m = /^Options?\s+([A-D](?:\s*(?:,|and|&)\s*(?:and\s+)?[A-D])+|[A-D])\s*(?:\([^)]*\))?\s*(?::\s*|\s+)([\s\S]*)$/.exec(s);
  if (!m) return null;
  const letters = [...new Set(m[1].match(/[A-D]/g) || [])];
  if (!letters.length || !m[2].trim()) return null;
  return { letters, text: m[2].trim() };
}

export function parseBlock(n, lines, errors) {
  const items = groupLines(lines);
  const err = (msg) => errors.push("MCQ " + n + ": " + msg);
  const findIdx = (re) => items.findIndex((g) => g.bullet && re.test(g.text));
  const iTopic = findIdx(/^Topic Discussion:/);
  const iStem = findIdx(/^Question Stem:/);
  const iAns = findIdx(/^Correct Answer:/);
  const iWhy = findIdx(/^Why Correct:/);
  const iWrong = findIdx(/^Why Other Options Are Wrong:/);
  if (iTopic < 0) err("no 'Topic Discussion:' bullet");
  if (iStem < 0) err("no 'Question Stem:' bullet");
  if (iAns < 0) err("no 'Correct Answer:' bullet");
  if (iWhy < 0) err("no 'Why Correct:' bullet");
  if (iWrong < 0) err("no 'Why Other Options Are Wrong:' bullet");
  if (iTopic < 0 || iStem < 0 || iAns < 0 || iWhy < 0 || iWrong < 0) return null;
  const opts = [];
  for (let i = iStem; i < iAns; i++) {
    const g = items[i];
    if (!g.bullet) continue;
    const m = /^([A-D])\.\s+([\s\S]*)$/.exec(g.text);
    if (m) opts.push({ letter: m[1], text: m[2].replace(/\n/g, " ").trim() });
  }
  if (opts.length !== 4 || opts.map((o) => o.letter).join("") !== "ABCD") { err("expected options A-D, found [" + opts.map((o) => o.letter).join(",") + "]"); return null; }
  const am = /^Correct Answer:\s*Option ([A-D])\b/.exec(items[iAns].text);
  if (!am) { err("unparseable Correct Answer: " + JSON.stringify(items[iAns].text.slice(0, 80))); return null; }
  const a = LETTERS.indexOf(am[1]);
  const stem = items[iStem].text.replace(/^Question Stem:\s*/, "").replace(/\n/g, " ").trim();
  if (!stem) err("empty question stem");
  const why = items[iWhy].text.replace(/^Why Correct:\s*/, "").replace(/\n/g, " ").trim();
  if (!why) err("empty Why Correct");
  // Notes: Topic Discussion verbatim as markdown (bullets and pipe tables kept; first bullet's label stripped).
  const notes = [];
  notes.push(items[iTopic].text.replace(/^Topic Discussion:\s*/, ""));
  for (let i = iTopic + 1; i < iStem; i++) {
    const g = items[i];
    if (g.table) notes.push(g.text);
    else if (g.bullet) notes.push("- " + g.text);
    else notes.push(g.text);
  }
  // Stray pipe-table rows after the why-wrong section belong to the Topic Discussion (MCQ 1).
  const strayTable = [];
  for (let i = iWrong + 1; i < items.length; i++) if (items[i].table) strayTable.push(items[i].text);
  if (strayTable.length && !notes.join("\n").includes(strayTable[0])) notes.push("", ...strayTable);
  const others = {};
  let last = null;
  const take = (text, where) => {
    const p = parseWhyBullet(text);
    if (!p) { // wrapped continuation of the previous bullet (e.g. MCQ 7 "- diffuse/...") 
      if (last) { for (const L of last) others[L] = (others[L] + " " + String(text).replace(/\n/g, " ").trim()).trim(); return; }
      err("unparseable why-wrong bullet " + where + ": " + JSON.stringify(String(text).slice(0, 100))); return;
    }
    for (const L of p.letters) { if (others[L]) err("duplicate why-wrong for option " + L); others[L] = p.text.replace(/\n/g, " ").trim(); }
    last = p.letters;
  };
  const head = items[iWrong].text.replace(/^Why Other Options Are Wrong:\s*/, "").trim();
  if (head) take(head, "(header)");
  for (let i = iWrong + 1; i < items.length; i++) {
    const g = items[i];
    if (g.table) continue;
    if (!g.bullet) { if (last) { for (const L of last) others[L] = (others[L] + " " + g.text.replace(/\n/g, " ").trim()).trim(); } else err("non-bullet line in why-wrong section: " + JSON.stringify(g.text.slice(0, 80))); continue; }
    take(g.text, "#" + (i - iWrong));
  }
  for (const L of LETTERS) { if (LETTERS.indexOf(L) !== a && !others[L]) err("missing why-wrong text for option " + L); }
  if (!stem || !why) return null;
  return { n, q: stem, o: opts.map((o) => o.text), a, exp: why, others, notes: notes.join("\n").trim() };
}

export function applyFixes(raw, fixes, errors) {
  const byN = new Map(raw.map((r) => [r.n, r]));
  for (const [group, map] of Object.entries(fixes || {})) {
    if (!["ini-ss-2026-onc", "ini-ss-2023-onc"].includes(group)) { errors.push("fix group unknown: " + group); continue; }
    for (const [ns, fix] of Object.entries(map || {})) {
      const n = +ns;
      if ((group === "ini-ss-2023-onc") !== (n >= 43)) errors.push("fix " + group + "/" + n + ": wrong group for MCQ " + n);
      const r = byN.get(n);
      if (!r) { errors.push("fix " + group + "/" + n + ": no such MCQ in the markdown"); continue; }
      if (fix.q != null) { if (typeof fix.q !== "string" || !fix.q.trim()) errors.push("fix " + n + ": empty q"); else r.q = fix.q; }
      for (const [idx, text] of Object.entries((fix && fix.o) || {})) {
        const k = +idx;
        if (!(k >= 0 && k <= 3)) { errors.push("fix " + n + ": option index out of range: " + idx); continue; }
        if (typeof text !== "string" || !text.trim()) { errors.push("fix " + n + ": empty option " + idx); continue; }
        r.o[k] = text;
      }
    }
  }
}

export function toItem(r) {
  const wrong = {};
  for (const L of LETTERS) if (LETTERS.indexOf(L) !== r.a) wrong[L] = r.others[L];
  return {
    id: "iniss-" + String(r.n).padStart(2, "0"),
    q: decodeEnt(r.q), o: r.o.map(decodeEnt), a: r.a, exp: decodeEnt(r.exp),
    r: [0, 1, 2, 3].map((k) => decodeEnt(k === r.a ? r.exp : r.others[LETTERS[k]])),
    x: { key: decodeEnt(r.exp), others: Object.fromEntries(Object.entries(wrong).map(([k, v]) => [k, decodeEnt(v)])), notes: decodeEnt(r.notes) },
    t: MODULE, d: 3, prov: "SMD", gen: "hand", set: SET,
    source: r.n <= 42 ? "INI-SS Medical Oncology recall April 2026" : "INI-SS Medical Oncology recall April 2023",
  };
}

export function build(mdPath, fixesPath) {
  const errors = [];
  const md = fs.readFileSync(mdPath, "utf8");
  const fixes = JSON.parse(fs.readFileSync(fixesPath, "utf8"));
  const blocks = splitBlocks(md);
  const raw = [];
  for (const b of blocks) { const r = parseBlock(b.n, b.lines, errors); if (r) raw.push(r); }
  const nums = blocks.map((b) => b.n).sort((x, y) => x - y);
  const missing = [];
  for (let n = 1; n <= 68; n++) if (!nums.includes(n)) missing.push(n);
  if (missing.length) errors.push("missing MCQ blocks: " + missing.join(","));
  const extra = nums.filter((n) => n < 1 || n > 68);
  if (extra.length) errors.push("unexpected MCQ blocks: " + extra.join(","));
  const split2026 = raw.filter((r) => r.n <= 42).length, split2023 = raw.filter((r) => r.n >= 43).length;
  applyFixes(raw, fixes, errors);
  raw.sort((x, y) => x.n - y.n);
  const items = raw.map(toItem);
  for (const it of items) {
    if (it.o.length !== 4) errors.push(it.id + ": not 4 options");
    if (!(it.a >= 0 && it.a <= 3)) errors.push(it.id + ": answer out of range");
    if (it.r.some((s) => !s || !String(s).trim())) errors.push(it.id + ": empty per-option reason");
    if (!it.exp.trim()) errors.push(it.id + ": empty exp");
    if (!it.x.notes.trim()) errors.push(it.id + ": empty notes");
  }
  return { items, errors, split2026, split2023, total: blocks.length };
}

function main() {
  const mdPath = arg("--in", path.join(ROOT, ".private-iniss/iniss.md"));
  const fixesPath = arg("--fixes", path.join(ROOT, ".private-iniss/iniss-fixes.json"));
  const outPath = arg("--out", path.join(ROOT, ".private-iniss/out", SET, SUBJECT, MODULE + ".json"));
  const { items, errors, split2026, split2023, total } = build(mdPath, fixesPath);
  // Always write the parsed file and print spot checks so the owner can compare against the PDF;
  // a non-zero exit still flags every structural gap (never guessed, never invented).
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ topic: MODULE, set: SET, v: 1, items }, null, 1) + "\n");
  console.log("68 items check: blocks=" + total + " items=" + items.length + " (42+26 split: " + split2026 + "+" + split2023 + ") -> " + path.relative(ROOT, outPath));
  for (const n of [1, 43, 68]) {
    const it = items.find((x) => x.id === "iniss-" + String(n).padStart(2, "0"));
    if (!it) { console.log("iniss-" + String(n).padStart(2, "0") + " MISSING"); continue; }
    console.log(it.id + " a=" + LETTERS[it.a] + " q=" + JSON.stringify(it.q.slice(0, 120)));
    console.log("  exp[0:80]=" + JSON.stringify(it.exp.slice(0, 80)));
  }
  if (errors.length || total !== 68 || items.length !== 68 || split2026 !== 42 || split2023 !== 26) {
    console.error("FAIL (" + errors.length + "):");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("OK: 68 items (42 April-2026 + 26 April-2023)");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
