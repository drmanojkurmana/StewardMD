/* Probe: what does the REAL buildPackage() ground a question on? (lexical/native path, hybrid off)
 * USAGE: node test/run-maik-route-probe.mjs "melena workup" "malena workup" ... */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStewardAI, rrf } from "../kb/ai/interface.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LS = { smd_hybrid: "0" };
global.window = global;
global.document = { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) };
global.localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: (k) => { delete LS[k]; } };
global.__loadIface = () => Promise.resolve({ createStewardAI, rrf });
const load = (f) => vm.runInThisContext(fs.readFileSync(join(ROOT, f), "utf8"), { filename: f });
["kb/dist/kb.core.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "dxmgmt.js"].forEach(load);
const src = fs.readFileSync(join(ROOT, "kb/ai/steward-ai.browser.js"), "utf8");
vm.runInThisContext(src.replace(/import\("\/kb\/ai\/interface\.mjs[^"]*"\)/, "globalThis.__loadIface()"), { filename: "steward-ai.browser.js" });
const RAG = window.StewardRAG; await RAG.ready();
const emptyAssess = { infectious: [], nonInfectious: [], gate: null, dominantSystem: null };
for (const q of process.argv.slice(2)) {
  const pkg = await RAG.buildPackage(emptyAssess, { question: q });
  const tm = pkg.topicMatch || {};
  console.log(JSON.stringify({ q, matched: tm.matched, mode: tm.mode, topic: tm.topic, grounded: tm.grounded, nearest: tm.nearest, resolver: tm.resolver, grounding: (pkg.grounding || []).map((g) => g && g.name) }));
}
