#!/usr/bin/env node
/* StewardMD - neonatal statements from our own drug monographs (owner 2026-10-01: "see our drug
 * monographs we already have covering all drugs").
 *
 *   node scripts/neo/build-monograph-neonatal.mjs          write data/neo/monograph-neonatal.json
 *   node scripts/neo/build-monograph-neonatal.mjs --check  fail if the file is stale
 *
 * Source: worker/data/gold/*.json (1,532 authored monographs; the same source as data/dose-rules.json.gz).
 * For every drug, every sentence that speaks about newborns (neonate, newborn, preterm, premature,
 * gestational or postmenstrual age, kernicterus, gasping syndrome) is copied VERBATIM with the section it
 * came from. Dose rows that mention newborns are copied whole (context, route, dose, timing, note). The
 * pregnancy and lactation sections are left out: they are about the mother.
 * Nothing is rewritten or calculated here; neo-dose.js shows these as "What our monograph says about
 * newborns" and never turns a child or adult dose into a neonatal one. test/neo-monograph.test.mjs
 * checks every statement is a verbatim part of its monograph.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "worker/data/gold");
const OUT = join(ROOT, "data/neo/monograph-neonatal.json");
/* "preterm" and "premature" count only when they describe the baby: "preterm labour", "premature
 * rupture of membranes" and the like are about the mother and are left out. */
export const NEO_RE = /\bneonat|\bnewborn|\bpre-?term\b(?! (?:labou?r|birth|deliver|rupture|contraction|PROM))|\bpremature (?:infant|neonate|newborn|bab)|\bprematurity\b|gestational age|post-?menstrual|post-?conceptional|kernicterus|gasping syndrome|first (?:week|month|28 days) of life/i;
/* Exposure through the mother (in pregnancy or breast milk) is not a newborn dose or caution for the baby
 * being treated: those sentences, and quick-fact pairs labelled Pregnancy or Lactation, are left out. */
export const MATERNAL = /trimester|in utero|embryo-?fetal|breast ?milk|present in milk|exposed in|during pregnancy/i;
const SKIP = { preg: 1, lact: 1, refs: 1, tags: 1 };
const LABEL = { generic: "Name", cls: "Class", quick: "Quick facts", summary: "Summary", indications: "Uses", dosage: "Dosing", admin: "How to give",
  moa: "How it works", contra: "Do not use / caution", renal: "Kidney", hepatic: "Liver", interactions: "Interactions", se: "Side effects",
  monitoring: "Monitoring", counsel: "Counselling", pk: "Pharmacokinetics", pearls: "Clinical pearls", missed: "Missed dose", overdose: "Overdose", pharm: "Pharmacology" };

function sentences(s) {
  return String(s).split(/(?<=[.;])\s+(?=[A-Z(])/).map((x) => x.trim()).filter(Boolean);
}
export function extract(g) {
  const out = [], seen = new Set();
  const push = (section, text, extra) => { const k = section + "|" + text; if (seen.has(k)) return; seen.add(k); out.push(Object.assign({ section, text }, extra || {})); };
  for (const [key, val] of Object.entries(g)) {
    if (SKIP[key]) continue;
    const label = LABEL[key] || key;
    if (key === "dosage" && Array.isArray(val)) {
      val.forEach((r) => {
        const all = [r.c, r.r, r.d, r.t, r.n].filter(Boolean).join(" ");
        if (NEO_RE.test(all) && !MATERNAL.test(all)) push(label, [r.c, r.r, r.d, r.t, r.n].filter(Boolean).join(" · "), { row: { c: r.c || "", r: r.r || "", d: r.d || "", t: r.t || "", n: r.n || "" } });
      });
      continue;
    }
    const walk = (v, sub) => {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && /^(pregnan|lactat|breast)/i.test(v[0])) return;
      if (typeof v === "string") { sentences(v).forEach((s) => { if (NEO_RE.test(s) && !MATERNAL.test(s)) push(sub ? label + " (" + sub + ")" : label, s); }); }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, sub));
      else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, isNaN(+k) ? k : sub));
    };
    walk(val, null);
  }
  return out;
}
export function build() {
  const drugs = {};
  for (const f of readdirSync(SRC).filter((x) => x.endsWith(".json")).sort()) {
    let g; try { g = JSON.parse(readFileSync(join(SRC, f), "utf8")); } catch (e) { continue; }
    const st = extract(g);
    if (st.length) drugs[g.generic || f.replace(/\.json$/, "")] = st;
  }
  return { schema: 1, kind: "neo-monograph", review: { status: "ai_drafted", by: null, date: null }, title: "What StewardMD's own drug monographs say about newborns", source: "worker/data/gold (StewardMD monographs), the same monographs as the dose calculator",
    note: "Verbatim statements only; pregnancy and lactation sections excluded. Not a neonatal dose unless the statement itself gives one.", drugs };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const doc = build(), txt = JSON.stringify(doc) + "\n";
  if (process.argv.includes("--check")) { const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""; if (cur !== txt) { console.error("data/neo/monograph-neonatal.json is stale: run node scripts/neo/build-monograph-neonatal.mjs"); process.exit(1); } console.log("OK"); }
  else { writeFileSync(OUT, txt); const n = Object.keys(doc.drugs).length, s = Object.values(doc.drugs).reduce((a, x) => a + x.length, 0); console.log(`wrote ${n} drugs, ${s} statements, ${Math.round(txt.length / 1024)} KB`); }
}
