/* Regression guard: MaiK must ROUTE common short/lay queries to the right disease, and must NOT
 * confidently ground a lone common-word/body hit on a clinically-wrong disease.
 *
 * Bugs (19 Jul 2026, persona stress-test): "how to treat MI" → Decompensated cirrhosis (the 2-char
 * "mi" was dropped by tokenize so the ACS alias never matched); "heart attack" → Panic attack and
 * "loose motions" → Loose anagen syndrome (no lay-term alias); "high fever what to do" →
 * Tick-borne relapsing fever (a lone body-only hit was treated as confident). Fixes: keep {mi,af}
 * in tokenize; add lay-term aliases (heart attack → ACS, loose motions → diarrhoea); and make the
 * relevance gate require a NAME/ALIAS match (or ≥2 covered terms) — a lone BODY-ONLY hit degrades
 * to general knowledge instead of confidently describing the wrong disease.
 *
 * Drives the REAL buildPackage() over the REAL KB in a minimal browser shim (hybrid vector arm
 * OFF → the deterministic lexical/native path). USAGE: node test/maik-routing.test.mjs (also
 * under `npm test`). */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStewardAI, rrf } from "../kb/ai/interface.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const LS = { smd_hybrid: "0" };
global.window = global;
global.document = { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) };
global.localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: (k) => { delete LS[k]; } };
global.__loadIface = () => Promise.resolve({ createStewardAI, rrf });

const load = (f) => vm.runInThisContext(fs.readFileSync(join(ROOT, f), "utf8"), { filename: f });
load("kb/dist/kb.core.js");
load("kb/dist/kb.enrichment.js");
load("kb/dist/kb.enrichment.2.js");
load("kb/dist/kb.rag.js");
load("dxmgmt.js");
let src = fs.readFileSync(join(ROOT, "kb/ai/steward-ai.browser.js"), "utf8");
const patched = src.replace(/import\("\/kb\/ai\/interface\.mjs[^"]*"\)/, "globalThis.__loadIface()");
if (patched === src) throw new Error("could not patch interface.mjs dynamic import — pattern changed");
vm.runInThisContext(patched, { filename: "steward-ai.browser.js" });

const RAG = window.StewardRAG;
ok(await RAG.ready(), "StewardRAG.ready() with the real KB");

const emptyAssess = { infectious: [], nonInfectious: [], gate: null, dominantSystem: null };
const routeOf = async (q) => {
  const p = await RAG.buildPackage(emptyAssess, { question: q, hospitalId: "GIMSR", caseData: {} });
  const tm = p.topicMatch || {};
  return { name: (p.grounding && p.grounding[0] && p.grounding[0].name) || "", mode: tm.matched === true ? "matched" : (tm.mode || "n/a") };
};
const expect = async (q, re, label) => { const r = await routeOf(q); ok(re.test(r.name), label + "  →  " + (r.name || "(none)") + " [" + r.mode + "]"); };
const forbid = async (q, re, label) => { const r = await routeOf(q); ok(!re.test(r.name), label + "  →  " + (r.name || "(none)") + " [" + r.mode + "]"); };

// --- FIXES: short/lay queries route to the right disease (were mis-routing) ---
await expect("how to treat MI", /coronary|myocardial|ischemic heart/i, "FIX 'how to treat MI' → ACS (2-char abbrev kept by tokenize)");
await expect("heart attack treatment", /coronary|myocardial|ischemic heart/i, "FIX 'heart attack treatment' → ACS (lay-term alias)");
await expect("AF treatment", /atrial fib/i, "FIX 'AF treatment' → atrial fibrillation");
await expect("loose motions treatment", /diarrhea|diarrhoea|dysentery/i, "FIX 'loose motions' → acute diarrhoea (lay-term alias)");

// --- FIXES: C. difficile old-genus / lay / abbreviated forms (KB indexes it as "Clostridioides",
//     so "Clostridium"/"c diff"/"cdiff"/"pseudomembranous colitis" mis-routed to web / wrong colitis) ---
await expect("what is clostridium", /difficile|clostridioides/i, "FIX 'clostridium' (old genus) → C. difficile");
await expect("c diff", /difficile|clostridioides/i, "FIX 'c diff' (abbrev) → C. difficile");
await expect("cdiff treatment", /difficile|clostridioides/i, "FIX 'cdiff' → C. difficile");
await expect("pseudomembranous colitis", /difficile|clostridioides/i, "FIX 'pseudomembranous colitis' → C. difficile (was Ischaemic colitis)");

// --- SAFE: the C_DIFF alias must NOT hijack a plain diarrhoea query ---
await forbid("diarrhoea treatment", /difficile|clostridioides/i, "SAFE plain diarrhoea NOT hijacked to C. difficile");

// --- FIX: instant nearest-KB resolver rescues typos/variants to the VERIFIED KB (assume),
//     instead of dead-ending to slow web research ---
await expect("clostridiym", /difficile|clostridioides/i, "RESOLVER 'clostridiym' (typo) → C. difficile");
await expect("clostridum infection", /difficile|clostridioides/i, "RESOLVER 'clostridum' (typo) → C. difficile");
{ const r = await routeOf("wibblewobble floxytron"); ok(r.mode === "none", "SAFE resolver leaves true gibberish as none (not force-matched)  →  [" + r.mode + "]"); }
{ const r = await routeOf("clostridiym"); ok(r.mode === "assume", "RESOLVER typo lands as ASSUME (stated assumption + refine chip), not silent match  →  [" + r.mode + "]"); }

// --- SAFE: a lone body-only hit must NOT confidently ground a wrong disease ---
await forbid("high fever what to do", /tick|relapsing/i, "SAFE 'high fever what to do' NOT grounded on Tick-borne relapsing fever");

// --- NO REGRESSION: named diseases still route confidently ---
await expect("when can I de-escalate antibiotics in sepsis", /sepsis/i, "NOREG sepsis de-escalation → Sepsis");
await expect("scrub typhus treatment", /scrub typhus/i, "NOREG scrub typhus (name match)");
await expect("dengue treatment", /dengue/i, "NOREG dengue");
await expect("malaria treatment", /malaria/i, "NOREG malaria");
await expect("community acquired pneumonia treatment", /community acquired pneumonia/i, "NOREG CAP");
await expect("meningitis treatment", /mening/i, "NOREG meningitis (qualifier-led name)");

// --- source guards for the three fix mechanisms ---
const iface = fs.readFileSync(join(ROOT, "kb/ai/interface.mjs"), "utf8");
ok(/KEEP_SHORT/.test(iface) && /"mi"/.test(iface) && /"af"/.test(iface) && /KEEP_SHORT\.has\(w\)/.test(iface), "tokenize keeps {mi,af}");
ok(/heart attack/.test(src) && /loose motion/.test(src), "SMD_ALIASES add lay terms (heart attack, loose motions)");
ok(/aliasHit/.test(src) && /nameToksAll \|\| nameHit \|\| aliasHit/.test(src), "gate confidence is name/alias-aware (no lone body-cov)");
ok(/C_DIFF\s*:/.test(src) && /clostridium/.test(src) && /pseudomembranous/.test(src), "SMD_ALIASES has C_DIFF (clostridium/cdiff/pseudomembranous)");
ok(/toks: tokenize\([^)]*c\.aliases/.test(iface), "aliases are retrievable — folded into the lexical toks bag (not just nameToks)");
const reasoning = fs.readFileSync(join(ROOT, "reasoning.js"), "utf8");
ok(/research:\s*function[\s\S]{0,1400}?raceTimeout\(/.test(reasoning), "web research is timeout-bounded (raceTimeout) so the spinner can't hang forever");
ok(/function fuzzyResolve/.test(src) && /fuzzyResolve\(distinctive\)/.test(src) && /function editWithin/.test(src), "instant nearest-KB resolver present (fuzzy/typo tolerance) on the miss path");

console.log(fails === 0 ? "\nALL PASS — MaiK routes short/lay queries correctly" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
