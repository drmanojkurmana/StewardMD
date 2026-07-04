/* StewardMD — MaiK knowledge COVERAGE MATRIX builder (Phase 2, lawful coverage program).
 *
 * Reports WHAT the knowledge base can answer, per disease × capability dimension, built from
 * the SAME dist globals the running app loads (KB_CORE / KB_ENRICHMENT.byId / KB_RAG.treatments)
 * so the matrix reflects production retrieval, not the raw source files. It records presence of
 * structured, paraphrased content — it copies NO source text. Output feeds the gap report.
 *
 * USAGE: node kb/tools/build-coverage-matrix.mjs   → writes kb/manifest/coverage-matrix.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const ROOT = new URL("../../", import.meta.url).pathname;
const win = {}; const ctx = { window: win }; createContext(ctx);
for (const f of ["kb.core.js", "kb.enrichment.js", "kb.rag.js"]) {
  runInContext(readFileSync(ROOT + "kb/dist/" + f, "utf8"), ctx);
}
const EN = win.KB_ENRICHMENT.byId, CORE = win.KB_CORE.diseases, TX = (win.KB_RAG && win.KB_RAG.treatments) || {};

const len = (x) => Array.isArray(x) ? x.length : 0;
const has = (x) => !!(x && (typeof x === "string" ? x.trim() : (Array.isArray(x) ? x.length : true)));

// Capability dimensions: what a clinician might ask that this disease could ground.
const DIMS = {
  overview:        "Definition / one-line identity of the condition",
  clinicalFeatures:"Signs, symptoms, clinical pearls",
  pathophysiology: "Mechanism / why it happens",
  differential:    "Differentials + infection/non-infection mimics (with why)",
  investigations:  "Which tests to order",
  redFlags:        "Danger signs / when to escalate",
  severity:        "Severity classification / risk stratification",
  prognosis:       "Expected course / outcome",
  diagnosticScoring:"Participates in the deterministic differential engine (rule/find-map)",
  management:      "How to manage / treat (recommendations, framework)",
  drugTherapy:     "Names specific drug(s) / regimen by composition",
  dosing:          "Explicit dose / route / frequency / duration stated",
  stewardship:     "Antimicrobial stewardship (framework / de-escalation)",
};

// Normalize a compound system string to a primary specialty bucket.
// Order matters: more specific rules first. Tropical/TB win over generic "infectious".
const SPEC_MAP = [
  [/tropical/i, "Infectious / Tropical"], [/tubercul/i, "Infectious / Tropical"],
  [/toxicolog|poison/i, "Toxicology"],
  [/cardio|cardiac/i, "Cardiology"], [/pulmon|respirat/i, "Pulmonology"],
  [/neuro|nervous|cerebell|spinocerebellar|autonomic/i, "Neurology"],
  [/gastro|hepato|hepatology|\bgi\b|biliary/i, "GI / Hepatology"],
  [/nephro|renal/i, "Nephrology"], [/endocrin|metabolic/i, "Endocrine / Metabolic"],
  [/rheumat|musculoskeletal/i, "Rheumatology / MSK"], [/haemat|hematolog/i, "Hematology"], [/oncolog/i, "Oncology"],
  [/derm|skin/i, "Dermatology"], [/critical care|\bicu\b/i, "Critical Care"],
  [/emergency|allerg/i, "Emergency / Allergy"],
  [/vascular/i, "Vascular"], [/genitourinary|urolog|reproductive/i, "Genitourinary / Repro"],
  [/nutrition/i, "Nutrition"], [/immunolog/i, "Immunology"],
  [/environmental|occupational/i, "Environmental / Occupational"],
  [/infectious|infection|spirochet|viral|parasitolog|exanthem/i, "Infectious Diseases"],
  [/systemic|multisystem|functional/i, "Systemic / Other"],
];
function specialtyOf(system) {
  const s = String(system || "");
  for (const [re, name] of SPEC_MAP) if (re.test(s)) return name;
  return s.split("/")[0].trim() || "Other";
}

function capsFor(id) {
  const e = EN[id] || {}, c = CORE[id] || null, t = TX[id] || null;
  const stw = t && t.stewardship;
  const recs = (t && t.recommendations) || [];
  const drugRefs = recs.flatMap((r) => r.drugRefs || []);
  return {
    overview: true,
    clinicalFeatures: has(e.clinicalPearls),
    pathophysiology: has(e.pathophysiology),
    differential: len(e.additionalDifferentials) + len(e.infectionMimics) + len(e.nonInfectiousMimics) > 0,
    investigations: has(e.additionalInvestigations) || (c && has(c.investigations)),
    redFlags: has(e.redFlags) || (c && has(c.redFlags)),
    severity: has(e.severityClassification),
    prognosis: has(e.prognosis),
    diagnosticScoring: !!c,
    management: !!(t && (recs.length || (stw && (len(stw.framework) || stw.deescalation)))),
    drugTherapy: drugRefs.some((d) => has(d.composition) || has(d.regimenLabel)),
    dosing: drugRefs.some((d) => has(d.dose)),
    stewardship: !!(stw && (len(stw.framework) || stw.deescalation)),
  };
}

const perDisease = [], bySpec = {}, dimTotals = Object.fromEntries(Object.keys(DIMS).map((k) => [k, 0]));
let diagCount = 0, refCount = 0;
for (const id of Object.keys(EN)) {
  const e = EN[id], spec = specialtyOf(e.system), caps = capsFor(id);
  const tier = CORE[id] ? "diagnostic" : "reference";
  if (tier === "diagnostic") diagCount++; else refCount++;
  perDisease.push({ id, name: e.name, specialty: spec, system: e.system, tier, caps });
  bySpec[spec] = bySpec[spec] || { total: 0, diagnostic: 0, reference: 0, dims: Object.fromEntries(Object.keys(DIMS).map((k) => [k, 0])) };
  bySpec[spec].total++; bySpec[spec][tier]++;
  for (const k of Object.keys(DIMS)) if (caps[k]) { bySpec[spec].dims[k]++; dimTotals[k]++; }
}
perDisease.sort((a, b) => a.specialty.localeCompare(b.specialty) || a.name.localeCompare(b.name));

const N = perDisease.length;
const out = {
  generated: "build-coverage-matrix.mjs",
  note: "Presence of structured, paraphrased content per capability — no source text is stored. Reflects the runtime store (KB_CORE + KB_ENRICHMENT.byId + KB_RAG.treatments).",
  totals: { diseases: N, diagnostic: diagCount, reference: refCount, treatmentsWithDrugTherapy: dimTotals.drugTherapy, treatmentsWithDosing: dimTotals.dosing },
  dimensions: DIMS,
  dimensionCoveragePct: Object.fromEntries(Object.keys(DIMS).map((k) => [k, Math.round((dimTotals[k] / N) * 1000) / 10])),
  bySpecialty: bySpec,
  perDisease,
};
mkdirSync(ROOT + "kb/manifest", { recursive: true });
writeFileSync(ROOT + "kb/manifest/coverage-matrix.json", JSON.stringify(out, null, 2));

// console summary
console.log(`Coverage matrix: ${N} diseases (${diagCount} diagnostic, ${refCount} reference)`);
console.log("\nCapability coverage across all diseases:");
for (const k of Object.keys(DIMS)) console.log(`  ${String(out.dimensionCoveragePct[k]).padStart(5)}%  ${k}`);
console.log("\nBy specialty (count · has-management · has-regimen):");
Object.entries(bySpec).sort((a, b) => b[1].total - a[1].total).forEach(([s, v]) =>
  console.log(`  ${String(v.total).padStart(3)}  ${s.padEnd(22)} mgmt=${String(v.dims.management).padStart(3)}  drug=${String(v.dims.drugTherapy).padStart(3)}  dose=${String(v.dims.dosing).padStart(3)}`));
console.log("\n→ kb/manifest/coverage-matrix.json");
