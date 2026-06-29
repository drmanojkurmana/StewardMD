/* StewardMD KB — treatment / stewardship / policy migration (T1).
 *
 * Lossless capture of the legacy clinical content into the KB:
 *   kb/treatments/<id>.json   — first-line + alternatives + stewardship metadata +
 *                               pathogens-ref + references + guideline metadata
 *                               (infective from SYNDROMES; non-infective from DX_MGMT)
 *   kb/policies/<profile>.json — hospital policy overlays (8 profiles × diseases)
 *   kb/diseases/<id>.json      — enriched in place with references, decision status,
 *                               and the "why this" reason source (for the T2 flip)
 *
 * Drugs are REFERENCED by composition (the Drug Index stays the only pharmacology
 * DB); the regimen's own dose/route/duration is treatment guidance, not drug data.
 *
 * USAGE: node kb/tools/build-treatments.mjs <engine-tx.json>
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const txDump = JSON.parse(readFileSync(process.argv[2] || join(process.env.CLAUDE_JOB_DIR || "/tmp", "engine-tx.json"), "utf8"));

// load DX_MGMT (non-infective treatment briefs) from the repo module
const g = {}; global.window = g; await import(join(ROOT, "dxmgmt.js")); const DX_MGMT = g.DX_MGMT || {};

const TREAT = join(ROOT, "kb", "treatments");
const POL = join(ROOT, "kb", "policies");
rmSync(TREAT, { recursive: true, force: true }); mkdirSync(TREAT, { recursive: true });
rmSync(POL, { recursive: true, force: true }); mkdirSync(POL, { recursive: true });

function composition(drug) {
  return String(drug || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/\bif\b.*$/, "").replace(/[^a-z0-9 +/-]/g, " ").replace(/\s+/g, " ").trim();
}
function drugRefs(list) {
  return (list || []).map((d) => ({ composition: composition(d.drug), regimenLabel: d.drug || null, dose: d.dose || null, route: d.route || null, freq: d.frequency || d.freq || null, duration: d.duration || null, coverage: d.coverage || null, why: d.why || null }));
}
const REVIEW = { status: "approved", reviewedBy: null, reviewedAt: null };

// ---- infective treatments (from SYNDROMES) ----
let infN = 0;
for (const id of Object.keys(txDump.syndromes)) {
  const s = txDump.syndromes[id];
  const recs = [];
  if (s.firstLine && s.firstLine.length) recs.push({ tier: "guideline", line: "empiric", drugRefs: drugRefs(s.firstLine), evidence: { source: "StewardMD (Harrison/IDSA-aligned)", refs: s.references || [] } });
  (s.alternatives || []).forEach((a) => recs.push({ tier: "guideline", line: "alternative", drugRefs: drugRefs([a]), evidence: { source: "StewardMD", refs: s.references || [] } }));
  const obj = {
    id, diseaseId: id, class: "infective",
    precedence: ["icmr", "guideline", "harrison"],
    recommendations: recs,
    stewardship: { coverageMatrix: s.coverageMatrix || null, deescalation: s.deescalation || null, regimens: s.regimens || null, toxicityFactors: s.toxicityFactors || null, framework: s.stewardship || null },
    references: s.references || [],
    decision: { status: s.decisionStatus || null, label: s.decisionLabel || null },
    antibioticRelevant: s.antibioticRelevant !== false,
    review: REVIEW, version: 1,
  };
  writeFileSync(join(TREAT, id + ".json"), JSON.stringify(obj, null, 2) + "\n");
  infN++;
}

// ---- non-infective treatments (from DX_MGMT) ----
let niN = 0;
for (const id of Object.keys(DX_MGMT)) {
  const m = DX_MGMT[id];
  const obj = {
    id, diseaseId: id, class: "non_infective",
    precedence: ["icmr", "guideline", "harrison"],
    recommendations: [{ tier: "guideline", line: "management", steps: m.tx || [], evidence: { source: m.src || "Harrison 22e", refs: m.src ? [m.src] : [] } }],
    confirm: m.dx || null, investigations: (m.ix || []).map((x) => ({ test: x })), disposition: m.dispo || null,
    references: m.src ? [m.src] : [],
    review: REVIEW, version: 1,
  };
  writeFileSync(join(TREAT, id + ".json"), JSON.stringify(obj, null, 2) + "\n");
  niN++;
}

// ---- hospital policy overlays (one file per profile) ----
let polN = 0;
for (const profile of txDump.policyProfiles || []) {
  const byProfile = (txDump.policies || {})[profile] || {};
  const entries = {};
  for (const did of Object.keys(byProfile)) if (byProfile[did]) entries[did] = byProfile[did];
  writeFileSync(join(POL, profile + ".json"), JSON.stringify({ hospitalId: profile, diseases: entries, review: REVIEW, version: 1 }, null, 2) + "\n");
  polN++;
}

// ---- enrich disease files in place (references, decision, reason source) ----
let enr = 0;
for (const f of readdirSync(join(ROOT, "kb", "diseases"))) {
  if (!f.endsWith(".json")) continue;
  const path = join(ROOT, "kb", "diseases", f);
  const d = JSON.parse(readFileSync(path, "utf8"));
  const s = txDump.syndromes[d.id];
  if (s) { // infective
    if (s.references) d.references = s.references;
    if (s.reasonSrc) d.reasonSource = s.reasonSrc;            // captured for the T2 byte-identical flip
    d.decision = { status: s.decisionStatus || null, label: s.decisionLabel || null };
  } else if (DX_MGMT[d.id]) { // non-infective
    if (DX_MGMT[d.id].src) d.references = [DX_MGMT[d.id].src];
  }
  writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
  enr++;
}

console.log(`treatments: ${infN} infective + ${niN} non-infective = ${infN + niN}`);
console.log(`policy profiles: ${polN} (${(txDump.policyProfiles || []).join(", ")})`);
console.log(`diseases enriched: ${enr}`);
