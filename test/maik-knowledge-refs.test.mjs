/* Regression guard: MaiK must attach STRUCTURED refs (stewardship / drugs / ICU / calculators)
 * for STANDALONE KNOWLEDGE QUESTIONS, not only for case-derived (differential-present) answers.
 *
 * Bug (19 Jul 2026): kb/ai/steward-ai.browser.js assembled pkg.refs (drug/calculators/
 * icuProtocols/stewardship) BEFORE the knowledge-question gate resolved lead/grounding/
 * treatment. For a standalone question ("when can I de-escalate antibiotics in sepsis?")
 * lead was undefined at refs-build time, so treatment=null and grounding=[] → EVERY ref came
 * out empty. The server (#484) then had nothing to serialise: the coverage matrix,
 * de-escalation regimens, toxicity factors and the whole REFERENCES block never reached the
 * model on the exact path the de-escalation/coverage questions take. Sibling of #482/#483/#484.
 *
 * The fix moves refs assembly to AFTER the gate and derives disease-object refs from the final
 * grounded disease(s). This test drives the REAL buildPackage() in a minimal browser shim.
 * USAGE: node test/maik-knowledge-refs.test.mjs (also under `npm test`). */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStewardAI, rrf } from "../kb/ai/interface.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// ---- minimal browser shim (hybrid vector arm OFF → deterministic lexical path) ----
const LS = { smd_hybrid: "0" };
global.window = global;
global.document = { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) };
global.localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: (k) => { delete LS[k]; } };
global.__loadIface = () => Promise.resolve({ createStewardAI, rrf });

// Real treatment bundle (production stewardship shapes) — cheap (710K).
vm.runInThisContext(fs.readFileSync(join(ROOT, "kb/dist/kb.rag.js"), "utf8"), { filename: "kb.rag.js" });
ok(window.KB_RAG && window.KB_RAG.treatments && window.KB_RAG.treatments.SEPSIS && !!window.KB_RAG.treatments.SEPSIS.stewardship,
  "fixture precondition: KB_RAG.treatments.SEPSIS.stewardship exists");

// Minimal synthetic KB_CORE / KB_ENRICHMENT for ONE disease (SEPSIS) so retrieval resolves it
// without loading the 25 MB enrichment bundle. Shapes mirror the generated dist.
window.KB_CORE = { version: "test", diseases: [{
  id: "SEPSIS", name: "Sepsis", class: "infective", system: "Infectious",
  drugRefs: ["Piperacillin-tazobactam"], calculatorRefs: ["qSOFA"], icuModuleRefs: ["sepsis-bundle"],
  redFlags: ["hypotension", "altered sensorium"],
  investigations: [{ test: "serum lactate", why: "tissue perfusion" }, { test: "blood cultures", why: "source" }],
  matching: { reasoningTemplate: "Sepsis is life-threatening organ dysfunction from a dysregulated response to infection." },
}] };
window.KB_ENRICHMENT = { byId: { SEPSIS: { name: "Sepsis", class: "infective", system: "Infectious", harrison: {
  clinicalPearls: [
    "Sepsis requires prompt empiric antibiotics; de-escalate to the narrowest effective agent once the organism and source are known.",
    "Antibiotic de-escalation and stewardship in sepsis reduce resistance and toxicity without worsening outcomes.",
  ], source: "Harrison 22e", pages: "2310-2324" } } } };
window.DX_MGMT = {};

// Load the REAL client pipeline (patch its interface.mjs URL import to our real module).
let src = fs.readFileSync(join(ROOT, "kb/ai/steward-ai.browser.js"), "utf8");
const patched = src.replace(/import\("\/kb\/ai\/interface\.mjs[^"]*"\)/, "globalThis.__loadIface()");
if (patched === src) throw new Error("could not patch interface.mjs dynamic import — pattern changed");
vm.runInThisContext(patched, { filename: "steward-ai.browser.js" });

const RAG = window.StewardRAG;
ok(await RAG.ready(), "StewardRAG.ready() with the minimal fixture");

const emptyAssess = { infectious: [], nonInfectious: [], gate: null, dominantSystem: null };

// THE BUG: standalone knowledge question — refs must be populated (was all-empty before the fix).
const pk = await RAG.buildPackage(emptyAssess, { question: "when can I de-escalate antibiotics in sepsis?", hospitalId: "GIMSR", caseData: {} });
ok(pk && pk.treatment && pk.treatment.diseaseId === "SEPSIS", "knowledge-Q resolves treatment (SEPSIS)");
ok(pk && pk.refs && pk.refs.stewardship && pk.refs.stewardship.length >= 1,
  "knowledge-Q: refs.stewardship is populated (was 0 — the bug)");
ok(pk && pk.refs && pk.refs.drug && pk.refs.drug.length >= 1,
  "knowledge-Q: refs.drug is populated (was 0 — the bug)");
ok(pk && pk.refs && (pk.refs.calculators.length >= 1 || pk.refs.icuProtocols.length >= 1),
  "knowledge-Q: calculator/ICU refs from the grounded disease are populated (was 0)");

// No regression on the case-derived path (differential present → lead set before the gate).
const cd = await RAG.buildPackage({ infectious: [{ id: "SEPSIS", name: "Sepsis", confidence: 82, inf: true }], nonInfectious: [], gate: null, dominantSystem: "infective" },
  { question: "empiric management", hospitalId: "GIMSR", caseData: {} });
ok(cd && cd.refs && cd.refs.stewardship && cd.refs.stewardship.length >= 1, "case-derived: refs.stewardship still populated (no regression)");
ok(cd && cd.refs && cd.refs.drug && cd.refs.drug.length >= 1, "case-derived: refs.drug still populated (no regression)");

console.log(fails === 0 ? "\nALL PASS — MaiK attaches refs on the knowledge-question path" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
