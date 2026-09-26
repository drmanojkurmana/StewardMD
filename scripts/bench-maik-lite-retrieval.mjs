#!/usr/bin/env node
/* MaiK Lite retrieval bench (2026-09-26). A small on-device model answers from the evidence it is
 * given, so the evidence caps the answer: this runs the REAL offline retrieval (maik-local.js
 * retrieveGrounding over kb/ai/maik-lite-rag.js) against the REAL book for every clinical question in
 * test/maik-eval/live-cases.json, and reports how many of each case's key points the chosen passages
 * contain. No model runs. The book is not in the repo (it is downloaded on the phone):
 *   curl -o /tmp/maik-lite-kb.jsonl https://models.stewardmd.in/maik/maik-lite-kb.jsonl
 *   (its sha256 must equal SHA256 in kb/ai/maik-lite-kb-store.js)
 *   node scripts/bench-maik-lite-retrieval.mjs --book /tmp/maik-lite-kb.jsonl [--router] [--json out.json]
 * --router passes each case's topic as the router's disease, the way home.js does when the knowledge
 * router matched; without it, retrieval works from the question's own words (router missed).
 * --src <file> benches a changed copy of maik-local.js (path relative to the repo root); --quiet prints the summary only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export async function bench({ bookPath, router = false, cases, src = "maik-local.js" }) {
  const RAG = require("../kb/ai/maik-lite-rag.js");
  const rows = readFileSync(bookPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const t0 = Date.now(), book = new RAG.Book(rows), buildMs = Date.now() - t0;
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama: {} } },
    SMD_MAIK_RAG: RAG, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } } },
  };
  new Function("window", readFileSync(new URL(src, ROOT), "utf8"))(win);   // --src: A/B a changed copy
  const L = win.SMD_MAIK_LOCAL, out = [];
  for (const c of cases.filter((c) => c.category !== "decline-hedge" && !c.priorTurns)) {
    const g = await L.retrieveGrounding("maik-lite", c.message, router ? c.topic : "", null);
    const ev = g ? g.evidenceText : "";
    const hits = c.requiredElements.map((e) => new RegExp(e.re, "i").test(ev));
    out.push({
      id: c.id, category: c.category, topic: c.topic, question: c.message, grounded: !!g,
      keyPoints: hits.filter(Boolean).length, of: hits.length,
      missing: c.requiredElements.filter((e, i) => !hits[i]).map((e) => e.name),
      heads: g ? g.passages.map((p) => String(p.heading || "").slice(0, 80)) : [], anchors: g ? g.anchors : [],
    });
  }
  const grounded = out.filter((r) => r.grounded);
  const cov = (rs) => rs.length ? Math.round(1000 * rs.reduce((s, r) => s + r.keyPoints / r.of, 0) / rs.length) / 10 : 0;
  return {
    summary: {
      when: new Date().toISOString(), rows: rows.length, buildMs, router, questions: out.length,
      grounded: grounded.length, keyPointCoveragePct: cov(out), keyPointCoverageWhenGroundedPct: cov(grounded),
      fullCoverage: out.filter((r) => r.keyPoints === r.of).length,
      groundedButNoKeyPoint: grounded.filter((r) => r.keyPoints === 0).map((r) => r.id + " " + r.topic),
    },
    rows: out,
  };
}

if (process.argv[1] && process.argv[1].endsWith("bench-maik-lite-retrieval.mjs")) {
  const bookPath = arg("--book");
  if (!bookPath) { console.error("--book <path to maik-lite-kb.jsonl> is required (see the header)"); process.exit(2); }
  const { cases } = JSON.parse(readFileSync(new URL("test/maik-eval/live-cases.json", ROOT), "utf8"));
  const r = await bench({ bookPath, router: process.argv.includes("--router"), cases, src: arg("--src", "maik-local.js") });
  if (!process.argv.includes("--quiet")) for (const x of r.rows) console.log(`${x.id} ${x.grounded ? "G" : "-"} ${x.keyPoints}/${x.of} ${x.topic}${x.missing.length ? "  missing: " + x.missing.join(", ") : ""}`);
  console.log("\n" + JSON.stringify(r.summary, null, 1));
  const j = arg("--json"); if (j) writeFileSync(j, JSON.stringify(r, null, 1));
}
