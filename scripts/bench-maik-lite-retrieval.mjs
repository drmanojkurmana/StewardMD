#!/usr/bin/env node
/* MaiK Lite retrieval bench (2026-09-26). A small on-device model answers from the evidence it is
 * given, so the evidence caps the answer: this runs the REAL offline retrieval against the REAL book for
 * every clinical question in test/maik-eval/live-cases.json and reports how many of each case's key
 * points the chosen evidence contains. No model runs. The book is not in the repo (it is downloaded on
 * the phone):
 *   curl -o /tmp/maik-lite-kb.jsonl https://models.stewardmd.in/maik/maik-lite-kb.jsonl
 *   (its sha256 must equal SHA256 in kb/ai/maik-lite-kb-store.js)
 *   node scripts/bench-maik-lite-retrieval.mjs --book /tmp/maik-lite-kb.jsonl [--router topic|real] [--json out.json]
 * Router modes (how the question reaches the book):
 *   (none)  the question's own words only (the router matched nothing)
 *   topic   each case's topic stands in for the router's disease
 *   real    the REAL router (StewardRAG.buildPackage over the real KB, lexical path, no network) builds
 *           the package, and the REAL answer() consumes it, so the evidence includes the curated
 *           StewardMD passage (withCurated) exactly as the app sends it. The truest number.
 * --src <file> benches a changed copy of maik-local.js (path relative to the repo root); --quiet prints
 * the summary only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const EVIDENCE = /Reference material from the StewardMD Knowledge Base:\n([\s\S]*?)\n\nUsing the reference material above/;

// The router as the app runs it (same boot as test/maik-kb-relevance.test.mjs): the real KB bundles,
// steward-ai.browser.js with its interface.mjs import pointed at the real module, the vector arm off.
export async function bootRouter() {
  const LS = { smd_hybrid: "0" };
  globalThis.window = globalThis;
  globalThis.document = { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) };
  globalThis.localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: (k) => { delete LS[k]; } };
  const iface = await import(new URL("kb/ai/interface.mjs", ROOT));
  globalThis.__loadIface = () => Promise.resolve(iface);
  const load = (f) => vm.runInThisContext(readFileSync(new URL(f, ROOT), "utf8"), { filename: f });
  ["kb/dist/kb.core.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "dxmgmt.js"].forEach(load);
  const src = readFileSync(new URL("kb/ai/steward-ai.browser.js", ROOT), "utf8");
  const patched = src.replace(/import\("\/kb\/ai\/interface\.mjs[^"]*"\)/, "globalThis.__loadIface()");
  if (patched === src) throw new Error("could not patch the interface.mjs import");
  vm.runInThisContext(patched, { filename: "steward-ai.browser.js" });
  await globalThis.window.StewardRAG.ready();
  const empty = { infectious: [], nonInfectious: [], gate: null, dominantSystem: null };
  return (q) => globalThis.window.StewardRAG.buildPackage(empty, { question: q, hospitalId: "GIMSR", caseData: {} });
}

export async function bench({ bookPath, router = "", cases, src = "maik-local.js" }) {
  const RAG = require("../kb/ai/maik-lite-rag.js");
  const rows = readFileSync(bookPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const t0 = Date.now(), book = new RAG.Book(rows), buildMs = Date.now() - t0;
  const prompts = [];
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => { prompts.push(o.prompt); return { text: "Verify locally.", ms: 1 }; },
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }),
  };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: RAG, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      pathFor: async () => "/x.gguf", totalBytes: () => 1 },
  };
  new Function("window", readFileSync(new URL(src, ROOT), "utf8"))(win);   // --src: A/B a changed copy
  const L = win.SMD_MAIK_LOCAL, out = [];
  const route = router === "real" ? await bootRouter() : null;
  for (const c of cases.filter((c) => c.category !== "decline-hedge" && !c.priorTurns)) {
    let ev = "", heads = [], matched = null;
    if (route) {
      const pkg = await route(c.message);
      pkg.question = c.message;
      matched = !!(pkg.topicMatch && pkg.topicMatch.matched);
      prompts.length = 0;
      await L.answer(pkg, { pack: "maik-lite" }, null);
      const m = prompts.length ? EVIDENCE.exec(prompts[0]) : null;
      ev = m ? m[1] : "";
      heads = ev ? (ev.match(/^\[\d+\] \(([^)]*)\)/gm) || []).map((h) => h.replace(/^\[\d+\] \(/, "").slice(0, 80)) : [];
    } else {
      const g = await L.retrieveGrounding("maik-lite", c.message, router === "topic" ? c.topic : "", null);
      ev = g ? g.evidenceText : "";
      heads = g ? g.passages.map((p) => String(p.heading || "").slice(0, 80)) : [];
    }
    const hits = c.requiredElements.map((e) => new RegExp(e.re, "i").test(ev));
    out.push({
      id: c.id, category: c.category, topic: c.topic, question: c.message, grounded: !!ev, routerMatched: matched,
      curated: heads.some((h) => /^StewardMD Knowledge Base >/.test(h)),
      keyPoints: hits.filter(Boolean).length, of: hits.length,
      missing: c.requiredElements.filter((e, i) => !hits[i]).map((e) => e.name), heads,
    });
  }
  const grounded = out.filter((r) => r.grounded);
  const cov = (rs) => rs.length ? Math.round(1000 * rs.reduce((s, r) => s + r.keyPoints / r.of, 0) / rs.length) / 10 : 0;
  return {
    summary: {
      when: new Date().toISOString(), rows: rows.length, buildMs, router: router || "none", questions: out.length,
      grounded: grounded.length, keyPointCoveragePct: cov(out), keyPointCoverageWhenGroundedPct: cov(grounded),
      fullCoverage: out.filter((r) => r.keyPoints === r.of).length,
      groundedButNoKeyPoint: grounded.filter((r) => r.keyPoints === 0).map((r) => r.id + " " + r.topic),
      ...(router === "real" ? { routerMatched: out.filter((r) => r.routerMatched).length, withCuratedPassage: out.filter((r) => r.curated).length } : {}),
    },
    rows: out,
  };
}

if (process.argv[1] && process.argv[1].endsWith("bench-maik-lite-retrieval.mjs")) {
  const bookPath = arg("--book");
  if (!bookPath) { console.error("--book <path to maik-lite-kb.jsonl> is required (see the header)"); process.exit(2); }
  // --router with no value (the first version's flag) means "topic"
  const i = process.argv.indexOf("--router"), next = i > 0 ? process.argv[i + 1] : "";
  const router = i < 0 ? "" : (next === "real" || next === "topic" ? next : "topic");
  const { cases } = JSON.parse(readFileSync(new URL("test/maik-eval/live-cases.json", ROOT), "utf8"));
  const r = await bench({ bookPath, router, cases, src: arg("--src", "maik-local.js") });
  if (!process.argv.includes("--quiet")) for (const x of r.rows) console.log(`${x.id} ${x.grounded ? "G" : "-"}${x.curated ? "C" : " "} ${x.keyPoints}/${x.of} ${x.topic}${x.missing.length ? "  missing: " + x.missing.join(", ") : ""}`);
  console.log("\n" + JSON.stringify(r.summary, null, 1));
  const j = arg("--json"); if (j) writeFileSync(j, JSON.stringify(r, null, 1));
}
