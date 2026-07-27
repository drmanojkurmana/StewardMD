// MaiK V2 — deterministic KB Answer Engine (kb/ai/maik-kb.js) regression tests.
// Loads the real KB globals + composer in a vm sandbox and asserts:
//   1. SAFETY: complex/reasoning + absent-topic questions return null (defer to Gemini) — never fabricate.
//   2. COVERAGE: bread-and-butter knowledge questions answer deterministically with the right intent.
//   3. FIDELITY: doses come from the KB verbatim (e.g. ceftriaxone 2 g in severe CAP), not invented.
//   4. LATENCY: compose is sub-5ms.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) { /* read-only built-in (e.g. navigator) — leave it */ } };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const load = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) { throw new Error("load " + r + ": " + e.message); } };
["kb/dist/kb.core.js", "kb/dist/kb.clinical.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "kb/dist/kb.expanded.js", "dxmgmt.js", "clinical-vocab.js", "kb/ai/maik-kb.js"].forEach(load);
const { KB_ENRICHMENT: KE, DX_MGMT: DXM, KB_RAG: KR, MaiKKB } = globalThis;

// Build mock grounding the way buildPackage would (unified name resolution across all stores).
const SPELL = [[/aemia/g, "emia"], [/aemic/g, "emic"], [/ischaem/g, "ischem"], [/oedem/g, "edem"], [/paediatr/g, "pediatr"], [/tumour/g, "tumor"], [/anaem/g, "anem"], [/haemo/g, "hemo"], [/oesophag/g, "esophag"]];
const norm = s => String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
const medNorm = s => { let x = norm(s); for (const [a, b] of SPELL) x = x.replace(a, b); return x; };
const STOP = new Set("what is are the of for in a an treatment treat manage management dose dosing causes cause differential differentials symptoms features investigations investigation workup red flags prognosis pathophysiology how to do i you clinical signs overview about tell me explain".split(" "));
const GENERIC = new Set("acute chronic severe mild moderate syndrome disease disorder primary secondary".split(" "));
const idx = []; const seen = {};
const addIdx = (id, nm) => { if (!id || seen[id]) return; seen[id] = 1; const n = medNorm(nm || id.replace(/_/g, " ")); const toks = n.split(" ").filter(t => t.length >= 4); if (toks.length) idx.push({ id, nm: n, toks, head: toks.slice().sort((a, b) => b.length - a.length)[0] }); };
Object.keys(KE.byId).forEach(id => addIdx(id, KE.byId[id].name));
Object.keys(DXM).forEach(id => addIdx(id, null));
Object.keys(KR.treatments).forEach(id => addIdx(id, null));
function resolveId(q) {
  const qn = medNorm(MaiKKB.expandAbbrev(q));
  const qt = new Set(qn.split(" ").filter(t => t.length >= 4 && !STOP.has(t)));
  let best = null, bestFull = 0, bestCov = 0;
  for (const it of idx) {
    if (qn.indexOf(it.nm) >= 0) { if (it.nm.length > bestFull) { best = it; bestFull = it.nm.length; } continue; }
    if (bestFull || !it.head || !qt.has(it.head)) continue;
    const sig = it.toks.filter(t => !GENERIC.has(t));
    const cov = sig.length ? sig.filter(t => qt.has(t)).length / sig.length : 0;
    if (cov >= 0.5 && cov > bestCov) { best = it; bestCov = cov; }
  }
  return best ? best.id : null;
}
function pkgFor(q) {
  const id = resolveId(q); if (!id) return { question: q, grounding: [], topicMatch: { matched: false } };
  const e = KE.byId[id] || {};
  return { question: q, grounding: [{ diseaseId: id, name: e.name || id.replace(/_/g, " "), knowledge: [] }], topicMatch: { matched: true, mode: "confident" } };
}
const compose = q => MaiKKB.compose(q, pkgFor(q));

test("module + globals load", () => {
  assert.ok(MaiKKB && typeof MaiKKB.compose === "function");
  assert.ok(KE.byId && Object.keys(KE.byId).length > 4000);
});

test("SAFETY: reasoning/comparison questions defer to Gemini (null)", () => {
  ["compare nephrotic and nephritic syndrome", "why would a patient with CKD develop hyperkalemia",
   "45yo male presents with chest pain and dyspnea, differential?", "approach to a patient with acute kidney injury"]
    .forEach(q => assert.strictEqual(compose(q), null, "should defer: " + q));
});

test("SAFETY: absent / non-medical topics defer to Gemini (null)", () => {
  ["what is the flavour of the moon", "latest 2025 trial on empagliflozin", "who won the cricket match"]
    .forEach(q => assert.strictEqual(compose(q), null, "should defer: " + q));
});

test("COVERAGE: knowledge questions answer deterministically with correct intent", () => {
  const cases = [
    ["what is nephrotic syndrome", "definition"],
    ["clinical features of nephrotic syndrome", "features"],
    ["treatment of community acquired pneumonia", "treatment"],
    ["causes of hyperkalemia", "differential"],
    ["investigations for nephrotic syndrome", "investigation"],
    ["red flags in nephrotic syndrome", "redflags"],
    ["pathophysiology of DKA", "pathophysiology"],
    ["treatment of paracetamol poisoning", "treatment"],
    ["prognosis of nephrotic syndrome", "prognosis"]
  ];
  for (const [q, intent] of cases) {
    const r = compose(q);
    assert.ok(r && r.text, "should answer: " + q);
    assert.strictEqual(r.intent, intent, "intent for: " + q);
    assert.ok(r.confidence >= 0.85, "confidence for: " + q);
    assert.ok(r.text.length > 40, "non-trivial answer: " + q);
  }
});

test("TYPO TOLERANCE: misspelled disease names resolve to the correct disease (not a lexical near-miss)", () => {
  const r1 = compose("what is diabetes inspidus");   // misspelled 'insipidus'
  assert.ok(r1 && /insipidus/i.test(r1.text), "diabetes inspidus -> Diabetes insipidus");
  assert.ok(!/latent autoimmune/i.test(r1.text), "must NOT resolve to LADA");
  const r2 = compose("what is nephrotic syndrom");
  assert.ok(r2 && /nephrotic/i.test(r2.text), "nephrotic syndrom -> Nephrotic syndrome");
  assert.strictEqual(compose("what is xyzqwerty"), null, "gibberish must not fuzzy-match to a disease");
});

test("FIDELITY: dose is quoted from the KB, not invented", () => {
  const r = compose("dose of ceftriaxone in severe CAP");
  assert.ok(r && /ceftriaxone/i.test(r.text));
  assert.ok(/2\s*g/i.test(r.text), "KB ceftriaxone dose (2 g) present");
});

test("SAFETY: a named-drug dose query never shows a DIFFERENT drug's dose", () => {
  // amiodarone is not in the KB atrial-fibrillation rate-control regimen → must defer (null),
  // never present metoprolol/diltiazem under an "amiodarone" query.
  for (const q of ["dose of amiodarone in atrial fibrillation", "dose of furosemide in acute kidney injury", "dose of sumatriptan in acute migraine"]) {
    const r = compose(q);
    if (r) {
      const drug = q.match(/dose of (\w+)/)[1];
      assert.ok(new RegExp(drug, "i").test(r.text), "if answered, must contain the named drug (" + drug + "), got: " + r.text.slice(0, 140));
    }
  }
});

test("SAFETY: latest/trial/guideline-update questions defer to reasoning/web", () => {
  ["latest 2025 trial on finerenone in heart failure", "2025 ESC guidelines update on cardiogenic shock",
   "recent RCT on SGLT2 inhibitors", "newly approved drug for migraine", "new evidence on steroids in sepsis"]
    .forEach(q => assert.strictEqual(compose(q), null, "should defer: " + q));
});

test("SAFETY: patient vignettes defer to reasoning", () => {
  ["patient with syncope, systolic murmur and slow-rising pulse", "62 year old man presents with acute chest pain and dyspnea",
   "a patient who presents with fever, rash and joint pain"]
    .forEach(q => assert.strictEqual(compose(q), null, "should defer: " + q));
});

test("LATENCY: compose is sub-5ms", () => {
  const q = "treatment of community acquired pneumonia", p = pkgFor(q);
  MaiKKB.compose(q, p); // warm (build name index if needed)
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) MaiKKB.compose(q, p);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(ms < 5, "avg compose " + ms.toFixed(2) + "ms should be <5ms");
});
