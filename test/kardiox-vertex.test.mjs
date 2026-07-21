/* test/kardiox-vertex.test.mjs — Vertex AI (Gemini) SECONDARY-opinion fallback. Exercises every
 * decision path: the 4 trigger conditions, protected high-confidence consensus, cache dedupe, audit
 * log, graceful unavailability, never-overwrite, source attribution, and the E.analyze integration. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
globalThis.window = globalThis;
["kardiox-fusion.js", "kardiox-engines.js", "kardiox-vertex.js"].forEach(f => new Function(read(f))());
const V = globalThis.SMD_KARDIOX_VERTEX, E = globalThis.SMD_KARDIOX_ENGINES;
ok("vertex layer exposed", !!V && typeof V.makeVertexLayer === "function" && V.LABEL === "AI Clinical Reasoning (Secondary Opinion)");

const rep = (o = {}) => Object.assign({
  primaryDiagnosis: "Atrial fibrillation", confidence: 0.9,
  differentials: [{ diagnosis: "Atrial fibrillation", probability: 0.9, supportingModels: ["ecglib", "heartgpt"] }],
  agreement: [{ diagnosis: "Atrial fibrillation", models: [{ engine: "ecglib" }, { engine: "heartgpt" }] }],
  disagreement: [], modelContributions: [{ model: "ecglib", diagnoses: [{ code: "AFIB", label: "Atrial fibrillation", probability: 0.99 }] }],
  emergencyFlags: ["Atrial fibrillation"], measurements: { ventRateBpm: 120 }
}, o);

// ── gate: the 4 trigger conditions + the protected-consensus guard ──
ok("R1 high-confidence consensus → NOT consulted (protected)", (() => { const g = V.shouldConsult(rep({ confidence: 0.95 }), {}); return !g.consult && g.protectedConsensus; })());
ok("R2 low fusion confidence → consult", V.shouldConsult(rep({ confidence: 0.55 }), {}).consult);
ok("R3 specialist disagreement → consult", V.shouldConsult(rep({ confidence: 0.95, disagreement: [{ diagnosis: "PVC" }] }), {}).consult);
ok("R4 poor ECG quality → consult", V.shouldConsult(rep({ confidence: 0.95 }), { quality: 0.3 }).consult);
ok("R5 no finding + poor quality → consult (out-of-class)", V.shouldConsult(rep({ confidence: 0, differentials: [], agreement: [], emergencyFlags: [] }), { quality: 0.3 }).consult);
ok("R6 no finding + clean ECG → NOT consult (confident normal, no wasteful call)", !V.shouldConsult(rep({ confidence: 0, differentials: [], agreement: [], emergencyFlags: [] }), { quality: 1.0 }).consult);

// ── consult + cache + audit log (mock caller) ──
let calls = 0;
const mockCaller = async () => { calls++; return { differential: [{ dx: "AF with RVR", p: 0.8 }], reasoning: "irregularly irregular RR, no P waves", missingInformation: ["prior ECG", "electrolytes"], recommendedInvestigations: ["troponin", "TSH", "echo"], uncertainty: "moderate — single continuous lead only" }; };
const layer = V.makeVertexLayer({ caller: mockCaller, now: () => "T" });
const lowRep = rep({ confidence: 0.55 });
const vr1 = await layer.consult(lowRep, { age: 70, sex: "M", symptoms: ["palpitations"] });
ok("consulted → labeled secondary opinion", vr1.consulted && vr1.label === V.LABEL && vr1.source === "vertex-ai" && vr1.reasons.length);
ok("secondary opinion carries all requested fields", vr1.differential.length && vr1.reasoning && vr1.missingInformation.length && vr1.recommendedInvestigations.length && vr1.uncertainty);
ok("audit log recorded invoke + success", layer.log.some(l => l.event === "invoke") && layer.log.some(l => l.event === "success"));
const vr2 = await layer.consult(lowRep, { age: 70, sex: "M", symptoms: ["palpitations"] });
ok("identical consult → CACHE hit, no duplicate API call", vr2.cached === true && calls === 1 && layer.log.some(l => l.event === "cache_hit"));

// ── graceful unavailability (never fails) ──
const failLayer = V.makeVertexLayer({ caller: async () => { throw new Error("503 vertex down"); }, now: () => "T" });
const vf = await failLayer.consult(rep({ confidence: 0.55 }), {});
ok("Vertex down → available:false + uncertainty notice (no throw)", vf.consulted && vf.available === false && /unavailable/i.test(vf.uncertaintyNotice));

// ── merge: never overwrite specialist primary; label + source attribution ──
const r = rep({ confidence: 0.55 }); layer.mergeIntoReport(r, vr1);
ok("merge keeps specialist primary (never overwritten by Vertex)", r.primaryDiagnosis === "Atrial fibrillation" && r.primarySource === "specialist-ensemble");
ok("secondary opinion attached, clearly labeled + sourced", r.secondaryOpinion.label === V.LABEL && r.secondaryOpinion.source === "vertex-ai");
ok("differential carries specialist source attribution", /specialist/.test(r.differentials[0].source || ""));
const r2 = rep({ confidence: 0.55 }); failLayer.mergeIntoReport(r2, vf);
ok("failure merge surfaces the uncertainty notice", /unavailable/i.test(r2.uncertaintyNotice || ""));
const r3 = rep({ confidence: 0.95 }); const vp = await layer.consult(r3, {}); layer.mergeIntoReport(r3, vp);
ok("protected consensus → not consulted, specialist primary intact", r3.secondaryOpinion.consulted === false && r3.secondaryOpinion.protectedConsensus && r3.primaryDiagnosis === "Atrial fibrillation");

// ── integration through E.analyze: disagreement triggers the fallback, secondaryOpinion attaches ──
function dataFor(f) { if (/ecglib_AFIB/.test(f)) return [4]; if (/ecglib_PVC/.test(f)) return [4]; if (/ecglib_/.test(f)) return [-4]; if (/ecg_diagnosis/.test(f)) return [-4, -4, -4, -4, -4, -4, -4, -4, -4]; if (/heartgpt/.test(f)) return [0.02]; return [-4]; }
const fakeOrt = { Tensor: function (t, d, s) { this.type = t; this.data = d; this.dims = s; } };
const leads = []; for (let c = 0; c < 12; c++) { const L = new Array(5000); for (let i = 0; i < 5000; i++) L[i] = Math.sin(i / 20); leads.push(L); }
const eLayer = V.makeVertexLayer({ caller: mockCaller, now: () => "T" });
const rep2 = await E.analyze(leads, { ort: fakeOrt, ready: (f) => !/nstemi/.test(f), load: (f) => ({ run: async () => ({ logit: { data: Float32Array.from(dataFor(f)) } }) }), vertex: eLayer, patient: { age: 66, sex: "F" } });
ok("E.analyze + vertex → report carries a secondaryOpinion (source-labeled)", !!rep2.secondaryOpinion && rep2.secondaryOpinion.source === "vertex-ai" && rep2.primarySource === "specialist-ensemble");

console.log(`\nkardiox-vertex: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
