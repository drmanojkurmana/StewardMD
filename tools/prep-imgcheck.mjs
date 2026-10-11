#!/usr/bin/env node
// tools/prep-imgcheck.mjs - Gates for image-based MCQs before publish (all image-integration PRs).
// Checks each item: schema shape, 4 distinct distractors, key in range, no "all/none of the above",
// reasoning-pattern explanation (x.key/others/clues), attribution (img + credit + licence),
// and de-dup against bank text (--bank-dir), extra forbidden stems (--extra), and the batch itself.
// Usage: node tools/prep-imgcheck.mjs --items <jsonl> [--bank-dir D] [--extra F] [--out-kept F] [--out-dup F]
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };

export function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
export function tokens(s) { return norm(s).split(" ").filter((w) => w.length > 2); }
export function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
// checkItem(it) -> [problems]. Pure; the app-independent gate.
export function checkItem(it) {
  const p = [];
  if (!it || typeof it !== "object") return ["not-an-object"];
  if (!it.q || String(it.q).length < 30) p.push("stem-missing-or-short");
  if (!Array.isArray(it.o) || it.o.length !== 4) p.push("options-not-4");
  else {
    const seen = new Set();
    it.o.forEach((o, i) => {
      if (!o || String(o).length < 1) p.push("option-empty:" + i);
      const n = norm(o);
      if (seen.has(n)) p.push("option-duplicate:" + i);
      seen.add(n);
      if (/all of the above|none of the above|both a and b/i.test(String(o))) p.push("banned-option-phrase:" + i);
    });
  }
  if (!Number.isInteger(it.a) || it.a < 0 || it.a > 3) p.push("key-out-of-range");
  if (!it.exp || String(it.exp).length < 40) p.push("explanation-missing-or-short");
  if (!Array.isArray(it.r) || it.r.length !== 4) p.push("reasons-not-4");
  if (!it.kp) p.push("pearl-missing");
  if (!it.x || !it.x.key || !it.x.clues) p.push("reasoning-incomplete");
  if (!["recall", "reasoning", "application"].includes(it.cog)) p.push("cog-invalid");
  if (![1, 2, 3].includes(it.d)) p.push("difficulty-invalid");
  if (!it.t) p.push("module-missing");
  if (!Array.isArray(it.img) || !it.img.length) p.push("img-missing");
  if (!it.credit && !it.author) p.push("credit-missing");
  if (!it.licence) p.push("licence-missing");
  if (/[\u2014\u2013]/.test(String(it.q) + it.o)) p.push("dash-style");
  return p;
}
// collectBank(dir) -> [normalized strings] from any .json/.jsonl bank or overlay files.
export function collectBank(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(json|jsonl)$/i.test(f)) continue;
      try {
        const raw = fs.readFileSync(p, "utf8").trim();
        if (!raw) continue;
        const objs = raw.startsWith("[") || (raw.startsWith("{") && !raw.includes("\n{"))
          ? (JSON.parse(raw).items || [JSON.parse(raw)])
          : raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        for (const o of objs) {
          if (o && o.q) { out.push(norm(o.q)); (o.o || []).forEach((x) => out.push(norm(x))); }
        }
      } catch {}
    }
  };
  walk(dir);
  return out;
}
// findDup(item, bankNorms, extraNorms, seenStems) -> reason string or "".
export function findDup(it, bankNorms, extraNorms, seenStems) {
  const nq = norm(it.q);
  if (seenStems.has(nq)) return "dup-in-batch";
  for (const b of bankNorms) {
    if (b === nq) return "dup-bank-exact";
    if (b.length > 40 && nq.length > 40 && (b.includes(nq) || nq.includes(b))) return "dup-bank-contained";
  }
  for (const b of bankNorms) if (jaccard(it.q, b) >= 0.85) return "dup-bank-near";
  for (const b of extraNorms) {
    if (b === nq) return "dup-extra-exact";
    if (jaccard(it.q, b) >= 0.85) return "dup-extra-near";
  }
  return "";
}

async function main() {
  const f = opt("items");
  if (!f) { console.log("Usage: node tools/prep-imgcheck.mjs --items <jsonl> [--bank-dir D] [--extra F] [--out-kept F] [--out-dup F]"); process.exit(2); }
  const items = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const bank = collectBank(opt("bank-dir"));
  const extra = opt("extra") && fs.existsSync(opt("extra"))
    ? fs.readFileSync(opt("extra"), "utf8").split("\n").filter(Boolean).map(norm) : [];
  console.log(`items ${items.length}, bank strings ${bank.length}, extra stems ${extra.length}`);
  const kept = [], dup = [], bad = [];
  const seen = new Set();
  for (const it of items) {
    const probs = checkItem(it);
    if (probs.length) { bad.push({ id: it.id, probs }); continue; }
    const d = findDup(it, bank, extra, seen);
    seen.add(norm(it.q));
    if (d) dup.push({ id: it.id, reason: d });
    else kept.push(it);
  }
  console.log(`kept ${kept.length}, gate-fail ${bad.length}, dup ${dup.length}`);
  for (const b of bad.slice(0, 20)) console.log(" BAD", b.id, b.probs.join(","));
  for (const d of dup.slice(0, 20)) console.log(" DUP", d.id, d.reason);
  if (opt("out-kept")) fs.writeFileSync(opt("out-kept"), kept.map((x) => JSON.stringify(x)).join("\n") + (kept.length ? "\n" : ""));
  if (opt("out-dup")) fs.writeFileSync(opt("out-dup"), dup.map((x) => JSON.stringify(x)).join("\n") + (dup.length ? "\n" : ""));
  process.exit(bad.length || dup.length ? 1 : 0);
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
