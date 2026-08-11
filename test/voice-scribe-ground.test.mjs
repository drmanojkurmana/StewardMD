import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require=createRequire(import.meta.url);
const G = require("../voice-scribe-ground.js");
test("merges engine differential + LLM ddx, engine-first, deduped", () => {
  const r = G.ground("fever with chills, splenomegaly", { ddx:["dengue","malaria"], investigations:["CBC"] }, {
    findings:["fever","splenomegaly"],
    differential:(keys)=>[{dx:"Malaria",score:0.8},{dx:"Enteric fever",score:0.6}],
    investigationsFor:(dx)=>({ "Malaria":["Peripheral smear","Rapid malaria antigen"] }[dx]||[]) });
  const labels = r.ddx.map(d=>d.label.toLowerCase());
  assert.ok(labels.includes("malaria"));                 // engine
  assert.ok(labels.includes("dengue"));                  // ai, not duplicated with engine malaria
  assert.equal(labels.filter(x=>x==="malaria").length, 1);
  assert.equal(r.ddx.find(d=>d.label==="Malaria").source, "engine");
  assert.ok(r.investigations.map(i=>i.label).includes("Peripheral smear"));
});
test("no findings + no llm => empty (never fabricates)", () => {
  const r = G.ground("", {}, { findings:[], differential:()=>[], investigationsFor:()=>[] });
  assert.deepEqual(r.ddx, []); assert.deepEqual(r.investigations, []);
});

// ── Task 6: SAFETY -- "fever and cough" must not surface pneumonia unless the clinician stated it ──
test("SAFETY: 'fever and cough' does not surface pneumonia when neither the engine nor the clinician (LLM ddx) named it", () => {
  // A bare fever+cough transcript, with a differential engine that (correctly, per the real
  // finding set) returns only a viral URI -- no consolidation/crepitations were reported, so
  // pneumonia is not a grounded consideration. LLM also returned no ddx.
  const r = G.ground("patient has fever and cough for two days", { ddx: [], investigations: [] }, {
    findings: ["fever", "cough"],
    differential: () => [{ dx: "Viral URI", score: 0.7 }],
    investigationsFor: () => []
  });
  const labels = r.ddx.map(d => d.label.toLowerCase());
  assert.ok(!labels.includes("pneumonia"), "pneumonia must not be invented from a bare fever+cough complaint");
  assert.deepEqual(labels, ["viral uri"]);
});

test("SAFETY: pneumonia MAY appear, but only sourced + tagged 'ai' when the clinician's own extract named it -- never auto-written, review-only", () => {
  const r = G.ground("cough with crepitations, decreased air entry right base, doctor suspects pneumonia", { ddx: ["Pneumonia"], investigations: [] }, {
    findings: ["fever", "cough"],
    differential: () => [{ dx: "Viral URI", score: 0.7 }],   // engine still doesn't independently reach pneumonia
    investigationsFor: () => []
  });
  const entry = r.ddx.find(d => d.label === "Pneumonia");
  assert.ok(entry, "pneumonia surfaces only because the clinician's own words named it");
  assert.equal(entry.source, "ai", "attributed to the clinician's stated assessment, not the engine -- a review-tagged suggestion, never a confirmed finding");
});
