#!/usr/bin/env node
// Build the NEET-SS Medical Oncology recall overlay (set iniss2, module son-iniss-recalls) from the owner's private files:
// the stewardmd-mcq-v1 JSON an LLM filled from the recall PDF, and the PDF's text (pdftotext -layout), which carries the
// confidence label and the "Recall caveat" the JSON dropped. No AI, no network. Each JSON question is checked against the
// PDF (same number, same answer letter, same stem start) so a conversion slip fails the build instead of shipping.
// The JSON's why_wrong strings are one template sentence per option ("... is not the best answer because it does not match
// ..."), which teaches nothing: they are dropped, the item keeps its explanation. Question text never enters git; the
// output goes outside the repo (--out), then `tools/prep-upload-bank.mjs` or the owner's R2 upload puts it at
// overlay/iniss2/ss-medical-oncology/son-iniss-recalls.json.
//
// USAGE: node tools/prep-neetss-recalls.mjs --json <mcq.json> --txt <pdftotext-layout.txt> --out <file>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SET = "iniss2";
export const MODULE = "son-iniss-recalls";
export const SUBJECT = "ss-medical-oncology";
const LETTERS = ["A", "B", "C", "D"];
const SOURCE = "NEET-SS Medical Oncology recall, 24-27 Oct 2026 (reconstructed, not the official paper)";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export const clean = (s) => String(s == null ? "" : s).replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Part I of the PDF text -> { n: { title, conf, caveat, stem } }. Part I ends where "PART II" starts. */
export function parsePdf(txt) {
  const a = txt.indexOf("PART I - "), b = txt.indexOf("PART II - ");
  if (a < 0 || b < 0 || b < a) throw new Error("PART I / PART II headings not found in the PDF text");
  const lines = txt.slice(a, b).split("\n").map((l) => l.replace(/\s+$/, ""));
  const out = {};
  let cur = null;
  const head = /^\s*Q(\d+)\.\s+(.*?)\s*\[([A-Z /]+)\]\s*$/;
  const skip = /^(NEET-SS Medical Oncology \||Reconstructed recall;)/;
  for (const l of lines) {
    const m = head.exec(l);
    if (m) { cur = out[+m[1]] = { title: clean(m[2]), conf: m[3] === "HIGH CONFIDENCE" ? "high" : "reconstructed", caveat: "", stem: [], cav: false }; continue; }
    if (!cur || skip.test(l.trim())) continue;
    const t = l.trim();
    if (/^Recall caveat:/.test(t)) { cur.cav = true; cur.caveat = t.replace(/^Recall caveat:\s*/, ""); continue; }
    if (/^Evidence refs:/.test(t)) { cur.cav = false; continue; }
    if (cur.cav) { if (t) cur.caveat += " " + t; continue; }
    if (t) cur.stem.push(t);
  }
  for (const n of Object.keys(out)) { out[n].caveat = clean(out[n].caveat); out[n].stem = clean(out[n].stem.join(" ")); }
  return out;
}

/* One JSON question + its PDF record -> an overlay item, or an error string. */
export function toItem(q, n, p, errors) {
  const err = (m) => errors.push("Q" + n + ": " + m);
  const a = LETTERS.indexOf(String(q.answer || "").trim().toUpperCase());
  if (a < 0) { err("answer is not A to D"); return null; }
  if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => !clean(o))) { err("needs 4 non-empty options"); return null; }
  if (!clean(q.q) || !clean(q.explanation)) { err("empty stem or explanation"); return null; }
  if (!p) err("not found in the PDF");
  else {
    const first = norm(q.q).split(" ").slice(0, 6).join(" ");
    if (first && !norm(p.stem).includes(first) && !/^recall/i.test(q.q)) err("stem does not start like the PDF's: " + first);
  }
  let exp = clean(q.explanation);
  if (p && p.caveat) exp += " Recall note: " + p.caveat;
  const it = {
    id: "nssrec-" + String(n).padStart(2, "0"),
    q: clean(q.q), o: q.options.map(clean), a, exp,
    t: MODULE, d: [1, 2, 3].includes(+q.difficulty) ? +q.difficulty : 2, prov: "SMD", gen: "hand", set: SET,
    source: SOURCE + (p && p.conf === "reconstructed" ? "; key reconstructed, wording uncertain" : ""),
  };
  const kp = clean(q.key_point);
  if (kp && !exp.startsWith(kp)) it.kp = kp;
  return it;
}

export function build(json, txt) {
  const errors = [];
  if (json.format !== "stewardmd-mcq-v1" || !Array.isArray(json.questions)) throw new Error("not a stewardmd-mcq-v1 file");
  const pdf = parsePdf(txt);
  const items = [];
  json.questions.forEach((q, i) => {
    const n = i + 1;
    const it = toItem(q, n, pdf[n], errors);
    if (it) items.push(it);
  });
  // every JSON answer must equal the PDF's bold answer letter
  const pdfAns = {};
  const a = txt.indexOf("PART I - "), b = txt.indexOf("PART II - ");
  let cur = 0;
  for (const l of txt.slice(a, b).split("\n")) {
    const m = /^\s*Q(\d+)\.\s/.exec(l); if (m) { cur = +m[1]; continue; }
    // pdftotext -layout: option lines are indented 4 spaces, the answer banner ("B. Continue ...") 3
    const k = /^ {3}([A-D])(?:\.\s| is )/.exec(l);
    if (cur && k && !pdfAns[cur]) pdfAns[cur] = k[1];
  }
  json.questions.forEach((q, i) => {
    const n = i + 1, want = pdfAns[n];
    if (want && want !== String(q.answer).trim().toUpperCase()) errors.push("Q" + n + ": JSON answer " + q.answer + " but the PDF banner says " + want);
    if (!want) errors.push("Q" + n + ": no answer banner found in the PDF");
  });
  const dup = new Set();
  for (const it of items) { const k = norm(it.q); if (dup.has(k)) errors.push(it.id + ": duplicate stem"); dup.add(k); }
  return { items, errors };
}

function main() {
  const json = JSON.parse(fs.readFileSync(arg("--json"), "utf8"));
  const txt = fs.readFileSync(arg("--txt"), "utf8");
  const out = arg("--out");
  if (!out) { console.error("--out <file> is required (outside the repo: recall text never enters git)"); process.exit(2); }
  const { items, errors } = build(json, txt);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ topic: MODULE, set: SET, v: 1, items }, null, 1) + "\n");
  console.log("items=" + items.length + " reconstructed=" + items.filter((x) => /reconstructed, wording/.test(x.source)).length + " -> " + out);
  if (errors.length) { console.error("FAIL (" + errors.length + "):"); for (const e of errors) console.error("  - " + e); process.exit(1); }
  console.log("OK");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
