// MaiK Clinical Copilot (kb/ai/maik-copilot.js) — Part 3 module tests.
// Workflow chains, tool orchestration, proactive safety, gap analytics. Deterministic.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let store = {};
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });
shim("location", { href: "https://stewardmd.in/", search: "" });
const opt = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) {} };
["kb/dist/kb.core.js", "kb/dist/kb.enrichment.js", "drugs.js", "interaction-rules.js", "interactions.js", "calculators.js", "kb/ai/maik-kb.js", "kb/ai/maik-brain.js"].forEach(opt);
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "kb/ai/maik-copilot.js"), "utf8"), { filename: "maik-copilot.js" });
const C = globalThis.MaiKCopilot;
const resolved = (raw, primary) => ({ query: { raw, norm: raw.toLowerCase() }, primary: primary || null, intent: null });

test("module loads", () => { assert.ok(C && typeof C.workflow === "function"); });

test("Stage 2 — workflow chains guide the next clinical step, in order", () => {
  const cap = C.workflow(resolved("community acquired pneumonia treatment"));
  assert.ok(cap && cap.steps.length >= 4, "CAP has an ordered workflow");
  assert.ok(/curb/i.test(cap.steps[0]), "CAP workflow leads with severity (CURB-65)");
  assert.ok(cap.steps.some(s => /antibiotic/i.test(s)) && cap.steps.some(s => /follow-up/i.test(s)));
  const af = C.workflow(resolved("atrial fibrillation"));
  assert.ok(af.steps.some(s => /cha/i.test(s)) && af.steps.some(s => /has-bled/i.test(s)) && af.steps.some(s => /anticoag/i.test(s)));
  assert.equal(C.workflow(resolved("what is the capital of france")), null, "no workflow for a non-clinical / unmapped query");
});

test("Stage 1/10 — orchestrator surfaces launchable tools (calculators present in vm)", () => {
  const tools = C.orchestrate(resolved("severity of community acquired pneumonia", { canonicalName: "Community Acquired Pneumonia" }));
  if (globalThis.MEDCALC) {
    const calc = tools.filter(t => t.kind === "calculator");
    assert.ok(calc.length >= 1, "a calculator tool is orchestrated");
    assert.ok(calc.some(t => t.arg === "curb65"), "CURB-65 launcher is offered with its id");
  }
  // dead launchers are never surfaced
  tools.forEach(t => assert.ok(C.TOOLS[t.kind] && C.TOOLS[t.kind].probe(), "only probe-passing tools are surfaced"));
});

test("Stage 7 — proactive safety flags interactions / high-risk / renal / pregnancy / red-flags", () => {
  const hr = C.safetyScan(resolved("warfarin dose"));
  assert.ok(hr.some(a => a.kind === "high_risk"), "warfarin → high-risk flag");
  const intx = C.safetyScan(resolved("warfarin and amiodarone together"));
  assert.ok(intx.some(a => a.kind === "interaction"), "two drugs → interaction check");
  // R2 AI-safety fix: the DDI hook must actually UPGRADE to a specific warning on a real >= major
  // interaction (it previously passed strings + read .length/.pairs, so it could never fire).
  const iw = intx.find(a => a.kind === "interaction");
  assert.equal(iw.level, "warn", "warfarin + amiodarone (>= major) upgrades to a warn-level interaction alert");
  assert.match(iw.msg, /Interaction flagged/);
  // One-directional: a benign 2-drug pair stays at the generic 'verify' info level and NEVER claims
  // 'no interactions' (the ruleset is a screen, not proof of safety).
  const benign = C.safetyScan(resolved("amlodipine and atorvastatin")).find(a => a.kind === "interaction");
  assert.ok(benign && benign.level === "info", "a benign pair stays info-level, not warn");
  assert.doesNotMatch(benign.msg, /no interaction/i);
  assert.ok(C.safetyScan(resolved("gentamicin in CKD")).some(a => a.kind === "renal"), "CKD → renal adjustment");
  assert.ok(C.safetyScan(resolved("enalapril in pregnancy")).some(a => a.kind === "pregnancy"), "pregnancy → safety-category flag");
  assert.deepEqual(C.safetyScan(resolved("define hypertension")), [], "a benign definition query raises no false alarms");
});

test("Stage 9 — anonymous gap analytics (no LLM training)", () => {
  store = {};
  C.gapLog("unanswered", "rare tropical fever XYZ");
  C.gapLog("unanswered", "rare tropical fever XYZ");
  C.gapLog("low_confidence", "obscure syndrome");
  const r = C.gapReport();
  assert.equal(r.total, 3);
  assert.equal(r.byKind.unanswered, 2);
  assert.ok(r.repeated.some(q => /rare tropical fever/i.test(q)), "repeated unanswered query surfaced as a KB gap");
});
