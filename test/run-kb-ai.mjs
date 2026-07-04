/* StewardMD Phase-4 test — RAG index integrity + AI interface (AI DISABLED) +
 * evidence engine + NO-NETWORK guarantee. Pure node (no Chrome).
 *
 * USAGE: node test/run-kb-ai.mjs     (exit 0 = pass, 1 = fail)
 * NOT shipped — development/test tooling only.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createStewardAI, loadStoreFromDisk, DEFAULT_FLAGS } from "../kb/ai/interface.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// ---- 0. No-network static guard: the interface module must not reference fetch/XHR/http ----
const ifaceSrc = readFileSync(join(ROOT, "kb", "ai", "interface.mjs"), "utf8");
ok(!/\bfetch\s*\(|XMLHttpRequest|require\(['"]https?['"]\)|from ['"]node:http|axios|undici/.test(ifaceSrc),
  "interface.mjs contains NO network primitives (fetch/XHR/http/axios)");

// ---- 1. RAG index integrity ----
const idxPath = join(ROOT, "kb", "dist", "kb.index.json");
ok(existsSync(idxPath), "kb.index.json exists (run build-kb-index.mjs)");
const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { chunks: [] };
const chunks = index.chunks || [];
ok(chunks.length > 500, `index has substantial chunks (${chunks.length})`);
// valid ids = diagnostic diseases + reference diseases (the RAG index spans both)
const realIds = new Set([
  ...readdirSync(join(ROOT, "kb", "diseases")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")),
  ...(existsSync(join(ROOT, "kb", "reference")) ? readdirSync(join(ROOT, "kb", "reference")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")) : []),
]);
let badEmbed = 0, noSrc = 0, badLink = 0, noDz = 0;
for (const c of chunks) {
  if (c.embedding !== null) badEmbed++;
  if (!c.source || !c.source.ref) noSrc++;
  if (!c.diseaseId || !realIds.has(c.diseaseId)) noDz++;
  (c.crossLinks || []).forEach((l) => { if (!realIds.has(l)) badLink++; });
}
ok(badEmbed === 0, `every chunk embedding is null (${badEmbed} non-null)`);
ok(noSrc === 0, `every chunk has a source ref (${noSrc} missing)`);
ok(noDz === 0, `every chunk maps to a real disease (${noDz} bad)`);
ok(badLink === 0, `every crossLink resolves to a real disease id (${badLink} dangling)`);

// ---- 2. AI interface — DISABLED by default, fully functional ----
const store = await loadStoreFromDisk(ROOT);
const ai = createStewardAI(store);
ok(ai.flags.ai === false && ai.flags.gemini === false, "flags: ai & gemini default OFF");
ok(DEFAULT_FLAGS.ai === false, "DEFAULT_FLAGS.ai is OFF");
ok(ai.isAIEnabled() === false, "isAIEnabled() === false with no provider");
ok(ai.stats.diseases === 144 && ai.stats.treatments === 140, `store loaded (dz=${ai.stats.diseases} tx=${ai.stats.treatments} pol=${ai.stats.policies})`);

// ---- 3. RAG retrieval — deterministic + relevant ----
const r1 = ai.retrieve("meningitis neck stiffness photophobia", 5);
const r2 = ai.retrieve("meningitis neck stiffness photophobia", 5);
ok(JSON.stringify(r1) === JSON.stringify(r2), "retrieve() is deterministic");
ok(r1.length > 0 && r1.some((x) => x.diseaseId === "MENINGITIS"), `retrieve() surfaces MENINGITIS (top: ${r1[0] && r1[0].diseaseId}/${r1[0] && r1[0].section})`);
const rCap = ai.retrieve("community acquired pneumonia CURB-65 severity", 5);
ok(rCap.some((x) => x.diseaseId === "CAP" || x.diseaseId === "SEVERE_CAP"), "retrieve() surfaces CAP/SEVERE_CAP for pneumonia query");

// ---- 4. Grounding context — KB-sourced + page-cited only ----
const ctx = ai.getGroundingContext("CAP");
ok(ctx && ctx.knowledge.length > 0, `getGroundingContext(CAP) returns ${ctx ? ctx.knowledge.length : 0} chunks`);
ok(ctx && ctx.provenance.length > 0, `grounding has provenance refs (${ctx && ctx.provenance.join(", ").slice(0, 60)})`);
ok(ctx && ctx.knowledge.every((k) => k.source && k.source.ref), "every grounding chunk carries a source");

// ---- 5. Evidence engine — precedence resolution ----
const rt = ai.resolveTreatment("CAP");
ok(rt && Array.isArray(rt.precedence) && rt.precedence[0] === "icmr", `CAP precedence starts with icmr (${rt && rt.precedence.join("▸")})`);
ok(rt && rt.default && rt.default.drugRefs.length > 0, `CAP default rec resolved with drug compositions (${rt && rt.default && rt.default.drugRefs.join(",")})`);
const rtH = ai.resolveTreatment("CAP", "GIMSR");
ok(rtH && rtH.default, "resolveTreatment with hospital still yields a default (overlay never silently replaces it)");
ok(rtH && (rtH.overlayApplied === false || (rtH.overlayApplied === true && rtH.conflicts.length > 0)), "hospital overlay, if applied, is recorded as a conflict (both kept)");

// ---- 6. explain() seam — AI-off passthrough of rule-based reasoning ----
const ex = ai.explain({ diseaseId: "MENINGITIS", ruleBasedReason: "Rule-based: bacterial meningitis suspected." });
ok(ex.mode === "rule-based" && ex.aiEnabled === false, "explain() returns rule-based output with AI off");
ok(ex.text === "Rule-based: bacterial meningitis suspected.", "explain() passes the existing rule-based reason through verbatim");
ok(ex.grounding && ex.grounding.provenance.length > 0, "explain() attaches grounding context for future post-validation");

// ---- 7. Provider seam exists but is never auto-called / no network ----
let providerCalled = false;
const ai2 = createStewardAI(store, { flags: { ai: true }, provider: null });
ok(ai2.isAIEnabled() === false, "ai=true but provider=null still reports AI disabled (fail-safe)");
const ex2 = ai2.explain({ diseaseId: "CAP", ruleBasedReason: "rb" });
ok(ex2.text === "rb", "with no provider, explain() still returns rule-based text (no crash, no network)");

console.log(`\n${fails === 0 ? "ALL GREEN — RAG index + AI interface + evidence engine sound; AI disabled & no network" : fails + " checks FAILED"}`);
process.exitCode = fails === 0 ? 0 : 1;
