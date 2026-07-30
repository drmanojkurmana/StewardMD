// MaiK Clinical Decision Engine (kb/ai/maik-brain.js) — Phase 0 contract + wiring tests.
// Loads the real KB globals + MaiKScope + MaiKBrain in a vm sandbox and asserts the
// Resolved contract, scope-refuse, and that the deterministic front half is wired
// (broad → overview/ask, specific → answer). No app/UI is involved.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const loadReq = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) { throw new Error("load " + r + ": " + e.message); } };
const loadOpt = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) {} };
["kb/dist/kb.core.js", "kb/dist/kb.clinical.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js", "kb/dist/kb.expanded.js", "dxmgmt.js", "clinical-vocab.js", "kb/ai/maik-kb.js", "kb/ai/maik-scope.js", "kb/ai/maik-brain.js"].forEach(loadReq);
["drugs.js", "interaction-rules.js", "interactions.js", "calculators.js"].forEach(loadOpt);
const { MaiKBrain, MaiKScope, MaiKKB } = globalThis;
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "test/maik-neverguess.json"), "utf8")).cases;
const DECISIONS = ["answer", "overview", "ask", "refuse"];

test("modules load + contract surface", () => {
  assert.ok(MaiKBrain && typeof MaiKBrain.resolve === "function", "MaiKBrain.resolve");
  assert.ok(typeof MaiKBrain.run === "function", "MaiKBrain.run");
  assert.ok(MaiKScope && MaiKKB, "reused modules present");
});

test("resolve() returns the Resolved contract", () => {
  const r = MaiKBrain.resolve("diabetic ketoacidosis treatment");
  for (const k of ["query", "scope", "intent", "entities", "primary", "context", "ambiguity", "decision"]) {
    assert.ok(k in r, "missing key: " + k);
  }
  assert.ok(r.query && typeof r.query.raw === "string" && typeof r.query.lang === "string");
  assert.ok(Array.isArray(r.entities));
  assert.ok(r.ambiguity && DECISIONS.includes(r.ambiguity.decision));
});

test("language detection", () => {
  assert.equal(MaiKBrain.detectLang("what is the treatment of DKA"), "en");
  assert.equal(MaiKBrain.detectLang("मधुमेह का इलाज"), "hi");   // Devanagari
});

test("SAFETY: clearly non-medical → refuse", () => {
  const r = MaiKBrain.resolve("what is the weather today");
  assert.equal(r.decision, "refuse");
  assert.equal(r.scope.medical, false);
});

test("front half is wired: some broad → overview/ask, some specific → answer", () => {
  const dec = c => { try { return MaiKBrain.resolve(c.q, c.context || {}).decision; } catch (e) { return "THROW:" + e.message; } };
  // never throws across the whole corpus, always a valid decision
  for (const c of corpus) { const d = dec(c); assert.ok(DECISIONS.includes(d), c.q + " → " + d); }
  const broad = corpus.filter(c => c.kind === "broad");
  const specific = corpus.filter(c => c.kind === "specific");
  const broadHit = broad.filter(c => ["overview", "ask"].includes(dec(c))).length;
  const specHit = specific.filter(c => dec(c) === "answer").length;
  assert.ok(broadHit >= 1, "at least one broad concept resolves to overview/ask (clinicalDialogue wired)");
  assert.ok(specHit >= 1, "at least one specific concept resolves to answer (resolveTarget wired)");
});

// ── Phase 2: planner + execution + calculator facade ────────────────────────
test("MEDCALC headless facade: run/get/list compute real scores", () => {
  const C = globalThis.MEDCALC;
  if (!C || !C.run) { console.log("  (MEDCALC not loaded in vm — skipping)"); return; }
  const r = C.run("curb65", { conf: true, urea: true, rr: false, bp: false, age: true });
  assert.equal(r && r.value, 3, "CURB-65 with 3 criteria = 3");
  assert.ok(r.interpretation && /severe|admit/i.test(r.interpretation));
  assert.ok(C.get("chadsvasc"), "get(chadsvasc)");
  assert.ok(C.list().length > 100, "list() enumerates the calculators");
  assert.equal(C.run("does_not_exist", {}), null, "unknown id → null (graceful)");
});

test("proactive calculator suggestion (Stage 6) maps conditions → scores", () => {
  const hasId = (arr, id) => arr.some(c => c.id === id);
  assert.ok(hasId(MaiKBrain.suggestCalcs("severity of community acquired pneumonia", { canonicalName: "Community Acquired Pneumonia" }), "curb65"), "CAP → CURB-65");
  const af = MaiKBrain.suggestCalcs("atrial fibrillation anticoagulation", null);
  assert.ok(hasId(af, "chadsvasc") && hasId(af, "hasbled"), "AF → CHA₂DS₂-VASc + HAS-BLED");
  assert.ok(hasId(MaiKBrain.suggestCalcs("stroke severity", null), "nihss"), "stroke → NIHSS");
});

test("planner minimizes Gemini (token optimization, Stage 13)", () => {
  const plan = q => MaiKBrain.plan(MaiKBrain.resolve(q));
  const src = p => p.steps.map(s => s.source);
  // pure drug dose → drug DB, no Gemini
  const dose = plan("ceftriaxone dose");
  assert.ok(src(dose).includes("drugdb"), "dose query plans a drug-DB step");
  assert.equal(dose.needsGemini, false, "pure dose lookup needs no Gemini");
  // guideline comparison → synthesis needed
  const cmp = plan("compare NICE versus ESC hypertension targets");
  assert.equal(cmp.needsGemini, true, "guideline comparison needs Gemini synthesis");
  // an ask/overview decision produces no plan
  assert.deepEqual(MaiKBrain.plan(MaiKBrain.resolve("MS")).steps, [], "ambiguous acronym → no execution plan");
});

test("execute() gathers deterministic evidence (calculators) with no network", () => {
  const p = MaiKBrain.plan(MaiKBrain.resolve("CURB-65 score for this CAP patient"));
  const ex = MaiKBrain.execute(p, MaiKBrain.resolve("CURB-65 score for this CAP patient"));
  assert.ok(ex && Array.isArray(ex.evidence));
  if (globalThis.MEDCALC) {
    const calc = ex.evidence.find(e => e.source === "calculator");
    assert.ok(calc && calc.data.some(c => c.id === "curb65"), "CURB-65 surfaced as evidence with its input schema");
  }
});

test("resolve() latency is well under a frame (one-shot per query)", () => {
  // The front half runs scope + intent + entity + dialogue over the KB name index once per
  // send (not per keystroke), so a low-tens-of-ms budget is imperceptible.
  const t = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) MaiKBrain.resolve("treatment of hyperkalemia");
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / 20;
  assert.ok(ms < 30, "avg " + ms.toFixed(2) + "ms");
});
