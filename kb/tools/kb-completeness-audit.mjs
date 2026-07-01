/* StewardMD — Knowledge Base Completeness Audit (Phase 6, QA only)
 *
 * Compares the Harrison-derived KB (window.KB_ENRICHMENT: ids + names + aliases)
 * against a curated reference list of clinically-important Harrison entities and
 * reports which are PRESENT vs MISSING (with the matched KB id). Produces a
 * completeness report to run BEFORE importing any missing entity. Imports nothing;
 * flags no duplicates. Extend REFERENCE[] toward the full Harrison index over time.
 *
 * USAGE: node kb/tools/kb-completeness-audit.mjs   (writes validation/kb-completeness.md)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTDIR = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/validation";
mkdirSync(OUTDIR, { recursive: true });

// load KB_ENRICHMENT
const g = {}; const window = g;
new Function("window", readFileSync(join(ROOT, "kb", "dist", "kb.enrichment.js"), "utf8"))(window);
const byId = (g.KB_ENRICHMENT && g.KB_ENRICHMENT.byId) || {};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// build a searchable blob of every id, name, alias
const kbTokens = [];
for (const id in byId) { const e = byId[id]; kbTokens.push(norm(id), norm(e.name)); (e.aliases || []).forEach((a) => kbTokens.push(norm(a))); }
const kbBlob = " " + kbTokens.join("  ") + " ";
const present = (syns) => syns.some((s) => { const n = norm(s); return n && (kbBlob.indexOf(" " + n + " ") >= 0 || kbBlob.indexOf(n) >= 0); });

// Curated reference list of clinically-important Harrison entities (seed; extensible).
// Each: [canonical, ...synonyms]. Focused on rare/important syndromes commonly audited.
const REFERENCE = [
  ["Hemophagocytic lymphohistiocytosis", "HLH", "haemophagocytic"],
  ["POEMS syndrome", "POEMS", "osteosclerotic myeloma"],
  ["Castleman disease", "castleman", "angiofollicular lymph node hyperplasia"],
  ["IgG4-related disease", "igg4"],
  ["Behçet disease", "behcet", "behçet"],
  ["Whipple disease", "whipple", "tropheryma"],
  ["Adult-onset Still disease", "still disease", "AOSD", "systemic juvenile idiopathic"],
  ["Sarcoidosis", "sarcoid"],
  ["Amyloidosis", "amyloid"],
  ["Antiphospholipid syndrome", "antiphospholipid", "APS"],
  ["Systemic lupus erythematosus", "lupus", "SLE"],
  ["Systemic sclerosis", "scleroderma", "systemic sclerosis"],
  ["Granulomatosis with polyangiitis", "wegener", "GPA", "granulomatosis with polyangiitis"],
  ["Eosinophilic granulomatosis with polyangiitis", "churg strauss", "EGPA"],
  ["Microscopic polyangiitis", "microscopic polyangiitis"],
  ["Giant cell arteritis", "giant cell arteritis", "temporal arteritis"],
  ["Takayasu arteritis", "takayasu"],
  ["Polyarteritis nodosa", "polyarteritis nodosa", "PAN"],
  ["Kawasaki disease", "kawasaki"],
  ["Familial Mediterranean fever", "familial mediterranean fever", "FMF"],
  ["Relapsing polychondritis", "relapsing polychondritis"],
  ["Sjögren syndrome", "sjogren", "sjögren"],
  ["Dermatomyositis / polymyositis", "dermatomyositis", "polymyositis", "inflammatory myopath"],
  ["Mixed connective tissue disease", "mixed connective tissue", "MCTD"],
  ["Hemochromatosis", "hemochromatosis", "haemochromatosis"],
  ["Wilson disease", "wilson"],
  ["Porphyria", "porphyria"],
  ["Thrombotic thrombocytopenic purpura", "TTP", "thrombotic thrombocytopenic"],
  ["Haemolytic uraemic syndrome", "HUS", "haemolytic uraemic", "hemolytic uremic"],
  ["Disseminated intravascular coagulation", "DIC", "disseminated intravascular"],
  ["Paroxysmal nocturnal haemoglobinuria", "PNH", "paroxysmal nocturnal"],
  ["Multiple myeloma", "myeloma", "plasma cell"],
  ["Waldenström macroglobulinaemia", "waldenstrom", "macroglobulin"],
  ["Myelodysplastic syndrome", "myelodysplastic", "MDS"],
  ["Polycythaemia vera", "polycythaemia vera", "polycythemia vera"],
  ["Pheochromocytoma", "pheochromocytoma", "phaeochromocytoma"],
  ["Carcinoid syndrome", "carcinoid", "neuroendocrine tumor"],
  ["Addison disease / adrenal insufficiency", "addison", "adrenal insufficiency"],
  ["Cushing syndrome", "cushing"],
  ["Acromegaly", "acromegaly"],
  ["Diabetic ketoacidosis", "ketoacidosis", "DKA"],
  ["Hyperosmolar hyperglycaemic state", "hyperosmolar", "HHS"],
  ["Thyroid storm", "thyroid storm", "thyrotoxic crisis"],
  ["Myxoedema coma", "myxoedema coma", "myxedema coma"],
  ["Guillain-Barré syndrome", "guillain", "GBS"],
  ["Myasthenia gravis", "myasthenia"],
  ["Multiple sclerosis", "multiple sclerosis"],
  ["Neuromyelitis optica", "neuromyelitis optica", "NMO", "devic"],
  ["Amyotrophic lateral sclerosis", "amyotrophic lateral sclerosis", "ALS", "motor neuron"],
  ["Creutzfeldt-Jakob / prion disease", "prion", "creutzfeldt"],
  ["Autoimmune encephalitis", "autoimmune encephalitis", "anti-NMDA"],
  ["Leptospirosis", "leptospirosis", "weil"],
  ["Scrub typhus", "scrub typhus", "orientia"],
  ["Rickettsial disease", "rickettsial", "spotted fever"],
  ["Brucellosis", "brucell"],
  ["Melioidosis", "melioidosis", "burkholderia pseudomallei"],
  ["Leishmaniasis (kala-azar)", "leishmaniasis", "kala azar"],
  ["Dengue", "dengue"],
  ["Chikungunya", "chikungunya"],
  ["Enteric fever (typhoid)", "typhoid", "enteric fever"],
  ["Infective endocarditis", "endocarditis"],
  ["Toxic shock syndrome", "toxic shock"],
  ["Tumour lysis syndrome", "tumour lysis", "tumor lysis"],
  ["Serotonin syndrome", "serotonin syndrome"],
  ["Neuroleptic malignant syndrome", "neuroleptic malignant", "NMS"],
  ["Haemophagocytic / macrophage activation syndrome", "macrophage activation", "MAS"],
  ["Reactive arthritis", "reactive arthritis", "reiter"],
  ["Ankylosing spondylitis / axial spondyloarthritis", "ankylosing", "spondyloarthritis"]
];

const rows = REFERENCE.map(([name, ...syns]) => ({ name, present: present([name, ...syns]) }));
const missing = rows.filter((r) => !r.present);
const found = rows.filter((r) => r.present);

const md = [];
md.push(`# StewardMD — Knowledge Base Completeness Audit`);
md.push(`KB entities: **${Object.keys(byId).length}** (Harrison-derived). Reference checklist: **${REFERENCE.length}** clinically-important entities (seed list — extend toward the full Harrison index).`);
md.push(`\n**Present: ${found.length}/${REFERENCE.length}** · **Missing: ${missing.length}**`);
md.push(`\n## Missing entities (candidates to import — review before adding; do not duplicate)`);
md.push(missing.length ? missing.map((r) => `- ❌ ${r.name}`).join("\n") : "None — all reference entities present.");
md.push(`\n## Present (matched in KB)`);
md.push(found.map((r) => `- ✅ ${r.name}`).join("\n"));
md.push(`\n> Note: matching is name/alias-based against KB_ENRICHMENT; a "missing" flag means no alias matched and warrants a manual check (the entity may exist under a broader chapter). This is an audit — nothing is imported.`);
writeFileSync(OUTDIR + "/kb-completeness.md", md.join("\n") + "\n");
writeFileSync(OUTDIR + "/kb-completeness.json", JSON.stringify({ kbEntities: Object.keys(byId).length, reference: REFERENCE.length, present: found.length, missing: missing.map((r) => r.name) }, null, 2));
console.log(`KB entities: ${Object.keys(byId).length} · reference checklist: ${REFERENCE.length}`);
console.log(`Present: ${found.length} · Missing: ${missing.length}`);
console.log(`Missing: ${missing.map((r) => r.name).join(", ") || "none"}`);
console.log(`-> ${OUTDIR}/kb-completeness.md`);
