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
