/* StewardMD — RAG grounding test (Phase: true RAG for the Gemini explainer)
 *
 * Validates, with NO real network:
 *  (1) kb/ai/interface.mjs over the real KB — retrieve() returns cited chunks;
 *      getGroundingContext() returns KB-only cited knowledge + provenance + drugRefs;
 *      resolveTreatment() resolves ICMR ▸ guideline ▸ Harrison and keeps the hospital
 *      overlay SEPARATE.
 *  (2) the Cloudflare AI Function /explain GROUNDED path — a compact package is
 *      rendered into a KB-primary prompt (rule engine owns the diagnosis), Gemini is
 *      called (stubbed), mode:"grounded" + citations returned; the prompt carries the
 *      retrieved knowledge + treatment; NO patient identifiers are transmitted.
 *  (3) fail-safe: no GEMINI_API_KEY → {enabled:false}; legacy summary path still works.
 *
 * USAGE: node test/run-rag.mjs      (exit 0 = pass, 1 = fail). No browser/network.
 */
import { createStewardAI, loadStoreFromDisk } from "../kb/ai/interface.mjs";
import { onRequest } from "../functions/api/ai/[[path]].js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0; const ok = (c, m, x) => { console.log((c ? "✅ " : "❌ ") + m + (x !== undefined ? " — " + x : "")); if (!c) fails++; };

/* ---- (1) interface.mjs over real KB ---- */
const store = await loadStoreFromDisk(ROOT);
const txById = {}; for (const k in store.treatments) { const t = store.treatments[k]; if (t && t.diseaseId) txById[t.diseaseId] = t; }
store.treatments = txById;
const ai = createStewardAI(store, { flags: { ai: false } });
ok(ai.stats.chunks > 10000, "chunk corpus loaded", ai.stats.chunks + " chunks");

const ret = ai.retrieve("community acquired pneumonia cough fever consolidation", 5);
ok(ret.length > 0 && ret.every((r) => r.source && r.source.ref), "retrieve() returns page-cited chunks", ret.length + " chunks, all cited");

const g = ai.getGroundingContext("CAP");
ok(!!g && g.knowledge.length > 0 && g.knowledge.every((c) => c.source), "getGroundingContext(CAP) is KB-only + cited", g && g.knowledge.length + " chunks");
ok(!!g && g.provenance.length > 0, "grounding carries provenance", g && g.provenance.join("; ").slice(0, 60));
ok(!!g && g.drugRefs.length > 0, "grounding carries drug references", g && g.drugRefs.slice(0, 4).join(","));

const t = ai.resolveTreatment("CAP", "GIMSR");
ok(!!t && JSON.stringify(t.precedence) === JSON.stringify(["icmr", "guideline", "harrison"]), "resolveTreatment precedence ICMR ▸ guideline ▸ Harrison");
ok(!!t && !!t.default && !!t.default.tier, "treatment default resolved", t && t.default && t.default.tier);
ok(!!t && t.overlayApplied && t.overlay && t.overlay.hospitalId === "GIMSR", "hospital overlay applied SEPARATELY (not merged into default)");

/* ---- build a browser-shaped package (what StewardRAG.buildPackage emits) ---- */
const pkg = {
  schema: "steward-rag-1", hospitalId: "GIMSR",
  patientCase: { age: 68, sex: "M", findings: ["Cough", "Fever", "Breathlessness (dyspnea)"], cultures: [{ organism: "S. pneumoniae", sensitivities: ["penicillin-S", "ceftriaxone-S"] }] },
  reasoning: { gate: { cls: "infective" }, dominantSystem: "Respiratory", differential: [
    { id: "CAP", name: "Community Acquired Pneumonia", class: "infective", confidence: 82, supporting: ["Cough", "Fever"], contradictory: [], missing: ["CXR"] } ] },
  grounding: [{ diseaseId: "CAP", name: "Community Acquired Pneumonia", class: "infective",
    knowledge: g.knowledge.slice(0, 6), provenance: g.provenance, drugRefs: g.drugRefs.slice(0, 6) }],
  retrieved: ret,
  treatment: t,
  refs: { drug: g.drugRefs.slice(0, 6), calculators: ["curb65"], icuProtocols: [], stewardship: [] },
  question: "Why pneumonia and what next?"
};

/* ---- (2) Function grounded path with a STUBBED Gemini ---- */
let captured = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured = { url: String(url), body: init && init.body ? JSON.parse(init.body) : null };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Leading dx fits per Harrison 22e. Decision-support only." }] } }] }) };
};
const req = (obj) => new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://stewardmd.in" }, body: JSON.stringify(obj) });

const rGrounded = await (await onRequest({ request: req({ package: pkg }), env: { GEMINI_API_KEY: "x" }, params: { path: ["explain"] } })).json();
ok(rGrounded.mode === "grounded", "explain uses GROUNDED mode when a package is sent", rGrounded.mode);
ok(Array.isArray(rGrounded.citations) && rGrounded.citations.length > 0, "grounded response returns citations", (rGrounded.citations || []).join("; ").slice(0, 50));
const prompt = captured && captured.body && captured.body.contents[0].parts[0].text || "";
ok(/PRIMARY SOURCE/.test(prompt) && /own medical knowledge is SECONDARY/i.test(prompt), "prompt instructs KB-primary, model-knowledge-secondary");
ok(/AUTHORITATIVE/.test(prompt) && /rule engine/i.test(prompt), "prompt marks the deterministic diagnosis authoritative");
ok(/RETRIEVED STEWARDMD KNOWLEDGE/.test(prompt) && /TREATMENT RESOLUTION/.test(prompt), "prompt carries retrieved knowledge + treatment resolution");
ok(/GIMSR/.test(prompt) && /SEPARATE/.test(prompt), "hospital overlay presented separately in prompt");
// privacy: package + prompt carry NO identifiers
const sent = JSON.stringify(captured.body);
ok(!/"name"\s*:/.test(JSON.stringify(pkg.patientCase)) && !/mrn|uhid|patientId|"bed"/i.test(sent), "no patient identifiers transmitted");

/* ---- (3) fail-safe + legacy ---- */
const rStatus = await (await onRequest({ request: new Request("https://stewardmd.in/api/ai/status", { headers: { Origin: "https://stewardmd.in" } }), env: {}, params: { path: ["status"] } })).json();
ok(rStatus.enabled === false, "no GEMINI_API_KEY → {enabled:false}");
const rOff = await (await onRequest({ request: req({ package: pkg }), env: {}, params: { path: ["explain"] } })).json();
ok(rOff.enabled === false || rOff.error === "ai-disabled", "explain with no key → ai-disabled (client falls back to rule-based)");
const rLegacy = await (await onRequest({ request: req({ summary: "1. CAP 82/100" }), env: { GEMINI_API_KEY: "x" }, params: { path: ["explain"] } })).json();
ok(rLegacy.mode === "summary" && !!rLegacy.text, "legacy summary path still works (backward compatible)");

globalThis.fetch = realFetch;
console.log(`\n${fails === 0 ? "ALL GREEN — RAG chain grounds Gemini on retrieved StewardMD KB (engine owns dx), no identifiers sent" : fails + " failed"}`);
process.exit(fails ? 1 : 0);
