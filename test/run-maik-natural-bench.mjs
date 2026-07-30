/* run-maik-natural-bench.mjs — MaiK "natural doctor language" benchmark.
 * Exercises the WHOLE early pipeline with the real KB loaded: scope firewall -> KB resolveTarget
 * (disease) -> classifyIntent -> brain.resolve (ambiguity). Scores how a real doctor's shorthand is
 * understood, across personas + query types. Not a unit test — a measurement (prints a report). */
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const load = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) {} };
["kb/ai/ambig-abbrev.js","kb/dist/kb.core.js","kb/dist/kb.clinical.js","kb/dist/kb.enrichment.js","kb/dist/kb.enrichment.2.js","kb/dist/kb.rag.js","kb/dist/kb.expanded.js","drugs.js","dxmgmt.js","clinical-vocab.js","kb/ai/maik-kb.js","kb/ai/maik-scope.js","kb/ai/maik-brain.js"].forEach(load);
const S = globalThis.MaiKScope, KB = globalThis.MaiKKB, B = globalThis.MaiKBrain;

// persona/type-tagged queries. want: "allow" (clinical, must pass scope + resolve), "ask" (ambiguous
// abbrev -> disambiguate), "block" (non-medical -> refuse). `dz` (optional) = expected disease substring.
const Q = [
  // consultant shorthand
  ["consultant","acs tx","allow"],["consultant","af rate control","allow"],["consultant","vte ppx","allow"],
  ["consultant","stemi door to balloon","allow"],["consultant","septic shock mgmt","allow","sept"],["consultant","hyperkalemia mgmt","allow","hyperkal"],
  // resident shorthand (the complaint set)
  ["resident","rx malaria","allow","malaria"],["resident","cap rx","allow","pneumonia"],["resident","dka protocol","allow","ketoacidosis"],
  ["resident","copd exac rx","allow","copd"],["resident","uti abx","allow"],["resident","pe tx","allow","embolism"],
  ["resident","dengue rx","allow","dengue"],["resident","gout rx","allow","gout"],["resident","migraine ppx","allow","migraine"],
  // MBBS / textbook
  ["mbbs","diabetes treatment","allow","diabetes"],["mbbs","what is nephrotic syndrome","allow","nephrotic"],
  ["mbbs","asthma management","allow","asthma"],["mbbs","causes of hyponatremia","allow","hyponat"],["mbbs","pneumonia treatment","allow","pneumonia"],
  // nurse
  ["nurse","how to give adrenaline","allow"],["nurse","insulin sliding scale","allow"],["nurse","anaphylaxis dose","allow","anaphylax"],
  // typos
  ["typo","diabetis treatment","allow"],["typo","hyperkalemea","allow"],["typo","meningitis empirial","allow","mening"],["typo","pneumonia treatement","allow","pneumonia"],
  // abbreviations
  ["abbrev","copd exac","allow","copd"],["abbrev","chf meds","allow"],["abbrev","mi rx","allow"],["abbrev","tia workup","allow"],["abbrev","aki staging","allow","kidney"],
  // dose
  ["dose","vancomycin dosing","allow"],["dose","warfarin dose","allow"],["dose","atropine dose","allow"],["dose","adrenaline dose","allow"],
  // ambiguous abbreviations -> ASK
  ["ambig","ms","ask"],["ambig","ra","ask"],["ambig","pe","ask"],["ambig","le","ask"],["ambig","dm","ask"],["ambig","as","ask"],["ambig","cf","ask"],["ambig","pd","ask"],
  // non-medical -> BLOCK (leak guard)
  ["leak","rx apple","block"],["leak","MS Dhoni","block"],["leak","PE teacher","block"],["leak","weather today","block"],
  ["leak","write python code","block"],["leak","tell me a joke","block"],["leak","who won the ipl","block"],["leak","apple watch price","block"]
];

function pipe(q) {
  const sc = S.classify(q);
  if (!sc.medical) return { allowed: false, cat: sc.category, ask: false };
  let ask = false, dz = null, intent = null;
  try { const r = B.resolve(q, {}); if (r && r.decision === "ask") ask = true; } catch (e) {}
  try { const t = KB.resolveTarget(q, { question: q, grounding: [], topicMatch: { matched: false } }); if (t && t.confident) dz = (t.name || t.id || "").toLowerCase(); } catch (e) {}
  try { intent = KB.classifyIntent ? KB.classifyIntent(q) : null; } catch (e) {}
  return { allowed: true, ask, dz, intent };
}

const groups = {}, fails = [];
let allowOK = 0, allowN = 0, askedInstead = 0, askOK = 0, askN = 0, blockOK = 0, blockN = 0, dzOK = 0, dzN = 0;
for (const [persona, q, want, dzExp] of Q) {
  const r = pipe(q);
  groups[persona] = groups[persona] || { ok: 0, n: 0 };
  groups[persona].n++;
  let pass = false;
  if (want === "allow") { allowN++; pass = r.allowed; if (pass) allowOK++; if (r.allowed && r.ask) askedInstead++; if (dzExp) { dzN++; if (r.dz && r.dz.includes(dzExp)) dzOK++; else fails.push(`${persona}/${q} -> disease="${r.dz}" expected~"${dzExp}"`); } }
  else if (want === "ask") { askN++; pass = r.allowed && r.ask; if (pass) askOK++; }
  else if (want === "block") { blockN++; pass = !r.allowed; if (pass) blockOK++; }
  if (!pass) fails.push(`${persona}/${want}: "${q}" -> allowed=${r.allowed} ask=${r.ask} cat=${r.cat || ""}`); else groups[persona].ok++;
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
console.log("=== MaiK Natural-Language Benchmark ===");
console.log(`ALLOW  (clinical understood, not falsely refused):      ${allowOK}/${allowN} = ${pct(allowOK, allowN)}%   (of which ${askedInstead} engaged via clarification/subtype chips)`);
console.log(`ASK    (ambiguous abbrev -> disambiguate):               ${askOK}/${askN} = ${pct(askOK, askN)}%`);
console.log(`BLOCK  (non-medical refused, no leak):                   ${blockOK}/${blockN} = ${pct(blockOK, blockN)}%`);
console.log(`DISEASE (correct target on the checked subset):          ${dzOK}/${dzN} = ${pct(dzOK, dzN)}%`);
console.log("by persona:", Object.entries(groups).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join("  "));
if (fails.length) { console.log("\n-- misses --"); fails.forEach(f => console.log("  " + f)); }
const overall = allowOK + askOK + blockOK, overallN = allowN + askN + blockN;
console.log(`\nOVERALL: ${overall}/${overallN} = ${pct(overall, overallN)}%`);
