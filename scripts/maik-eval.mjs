/* scripts/maik-eval.mjs — MaiK decision-layer regression net (offline, deterministic, zero-token).
 *
 * Loads the SAME modules the app uses (KB_ENRICHMENT ×2 + MaiKScope + MaiKKB + MaiKBrain) and runs a
 * golden set of naive-doctor prompts through MaiKBrain.resolve(), then mirrors the shipped home.js
 * gate to get the EFFECTIVE app behavior (answer | ask | refuse). Exits non-zero on any regression.
 *
 * This guards the classification layer — the exact class of bug that hit us: false-refusing real
 * clinical questions, over-asking on common terms, and the disambiguation loop. It does NOT grade
 * answer prose (that needs the live model — see scripts/maik-answer-eval.mjs).
 *
 * Run:  node --max-old-space-size=4096 scripts/maik-eval.mjs        (or: npm run eval:maik)
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {}; ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.console = console;
vm.createContext(ctx);
for (const f of ["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/ai/maik-scope.js", "kb/ai/maik-kb.js", "kb/ai/maik-brain.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f }); }
  catch (e) { console.error("LOAD FAIL", f, e.message); process.exit(2); }
}
const B = ctx.MaiKBrain;
if (!B || !B.resolve) { console.error("MaiKBrain.resolve unavailable"); process.exit(2); }

// Mirror the SHIPPED home.js never-guess gate: only a LEXICAL acronym blocks; refuse stays; else answer.
function effective(r) {
  if (!r) return "answer";
  if (r.decision === "refuse") return "refuse";
  if (r.decision === "ask" && r.ambiguity && r.ambiguity.kind === "lexical") return "ask";
  return "answer";
}

// Golden set. Each is [prompt, expectedEffective, note]. Grouped so a regression names itself.
const GOLDEN = [
  // ── must ANSWER: core clinical (dosing / dx / mgmt / abx / emergencies / peds / obs) ──
  ["paracetamol dose", "answer"], ["amoxicillin dose for a child", "answer"],
  ["how much adrenaline in anaphylaxis", "answer"], ["insulin dose in dka", "answer"],
  ["vancomycin dosing", "answer"], ["how to treat malaria", "answer"], ["management of acute mi", "answer"],
  ["copd exacerbation treatment", "answer"], ["how to manage septic shock", "answer"],
  ["status epilepticus management", "answer"], ["hyperkalemia treatment", "answer"],
  ["management of stroke", "answer"], ["uti treatment in pregnancy", "answer"],
  ["best antibiotic for pneumonia", "answer"], ["drug for hypertension", "answer"],
  ["neonatal sepsis antibiotics", "answer"], ["eclampsia management", "answer"], ["febrile seizure", "answer"],
  ["snake bite management", "answer"], ["op poisoning treatment", "answer"], ["how to read an ecg", "answer"],
  ["hyponatremia correction rate", "answer"], ["steroid dose in copd", "answer"],
  // ── false-refusal guards (fixed 2026-08-16 — allow-list gaps) ──
  ["dengue warning signs", "answer", "was refused"], ["ors preparation", "answer", "was refused"],
  ["what is normal bp", "answer", "was refused"], ["treatment of typhoid", "answer"],
  ["cholera management", "answer"], ["chikungunya", "answer"], ["measles complications", "answer"],
  // ── over-asking guards: dominant-meaning acronyms answer, not ask (fixed 2026-08-16) ──
  ["mi treatment", "answer", "was ask: MI/mitral incompetence"], ["dm management", "answer"],
  ["ra treatment", "answer", "was ask: RA/right atrium"],
  // ── disambiguation-loop guard: the combined chip payload must ANSWER, not re-ask (fixed 2026-08-16) ──
  ["Pulmonary Treatment of Tuberculosis", "answer", "combined chip payload"],
  ["CNS Treatment of Tuberculosis", "answer", "combined chip payload"],
  // ── genuinely ambiguous acronyms must still ASK ──
  ["ms", "ask", "multiple sclerosis vs mitral stenosis"], ["pe", "ask", "PE vs pleural effusion"],
  // ── non-clinical must still REFUSE (scope firewall) ──
  ["hello", "refuse"], ["write me a poem", "refuse"], ["tell me a joke", "refuse"],
  ["what is the weather", "refuse"], ["write python code for a website", "refuse"],
];

let fails = [];
for (const [q, exp, note] of GOLDEN) {
  let r; try { r = B.resolve(q, {}); } catch (e) { fails.push(`ERROR "${q}": ${e.message}`); continue; }
  const eff = effective(r);
  if (eff !== exp) {
    const opts = (r.ambiguity && r.ambiguity.options || []).map((o) => typeof o === "string" ? o : (o.label || o.name)).slice(0, 5);
    fails.push(`"${q}" → ${eff}${opts.length ? " [" + opts.join(", ") + "]" : ""}  (expected ${exp}${note ? "; " + note : ""})`);
  }
}

console.log(`MaiK decision eval — KB entries: ${Object.keys((ctx.KB_ENRICHMENT && ctx.KB_ENRICHMENT.byId) || {}).length}`);
console.log(`${GOLDEN.length - fails.length}/${GOLDEN.length} passed`);
if (fails.length) { console.error("\nREGRESSIONS:"); fails.forEach((f) => console.error("  ✗ " + f)); process.exit(1); }
console.log("✓ no regressions");
