/* StewardMD - Medical Updates: journal and regulator sources for Clinical Bulletins, seeded ONCE.
 *
 * Every query here was run against the live API on 2026-09-28 before it was written down. PubMed papers in
 * the last 30 days: batch 1 core 37, cardiology 11, oncology 17; batch 2 general 19, guidelines 8, Lancet
 * specialty 15, IM specialty 24, India 5, meta-analyses 2. openFDA: 15 new NDA/BLA approvals in 60 days.
 * runPipeline() calls seedJournalSourcesOnce() before each crawl. Sources come in numbered batches (`seed`);
 * each batch is inserted once (INSERT OR IGNORE) and recorded as bulletin_settings 'seed_journal_sources_v<N>',
 * so a later batch reaches sites that already have the first, and an owner who disables or deletes a source in
 * Admin > Medical Sources keeps that choice. functions/db/seed_sources_journals.sql is the
 * hand-runnable copy. New items land in the bell feed and the Review Desk queue; nothing reaches a disease
 * page until a registered doctor signs a bulletin for it.
 */
import { ensureBulletinSchema } from "./_bulletins_schema.js";

const NOT_OPINION = ' NOT ("Comment"[pt] OR "Letter"[pt] OR "Editorial"[pt])';
const TRIALS = '("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt])';
const PUBMED = "https://pubmed.ncbi.nlm.nih.gov";
export const JOURNAL_SOURCES = [
  {
    seed: 1, id: "openfda-approvals", name: "FDA new drug and biologic approvals (openFDA)", type: "drug_approval",
    workspace: "internal_medicine", branch: "", parser_type: "openfda", priority: 15, query: "",
    homepage: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm",
  },
  {
    seed: 1, id: "pubmed-core", name: "NEJM, Lancet, JAMA, BMJ: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 60,
    query: '("N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt])' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
  {
    seed: 1, id: "pubmed-cardio", name: "Circulation, Eur Heart J, JACC: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "cardiology", parser_type: "pubmed", priority: 70,
    query: '("Circulation"[ta] OR "Eur Heart J"[ta] OR "J Am Coll Cardiol"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt])' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
  {
    seed: 1, id: "pubmed-onc", name: "J Clin Oncol, Lancet Oncol, JAMA Oncol: phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "oncology", parser_type: "pubmed", priority: 70,
    query: '("J Clin Oncol"[ta] OR "Lancet Oncol"[ta] OR "JAMA Oncol"[ta]) AND "Clinical Trial, Phase III"[pt]' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
  /* ---- batch 2 (2026-09-28, owner: "NEJM, BMJ, popular journals and studies") ---- */
  {
    seed: 2, id: "pubmed-general", name: "Ann Intern Med, JAMA Intern Med, Nature Medicine, NEJM Evidence: trials", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 65, homepage: PUBMED,
    query: '("Ann Intern Med"[ta] OR "JAMA Intern Med"[ta] OR "Nat Med"[ta] OR "NEJM Evid"[ta]) AND ' + TRIALS + NOT_OPINION,
  },
  {
    seed: 2, id: "pubmed-guidelines", name: "Practice guidelines in major general and specialty journals", type: "guideline",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 55, homepage: PUBMED,
    query: '("Practice Guideline"[pt] OR "Guideline"[pt]) AND ("N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta] OR "Ann Intern Med"[ta] OR ' +
      '"Circulation"[ta] OR "Eur Heart J"[ta] OR "J Am Coll Cardiol"[ta] OR "Diabetes Care"[ta] OR "Chest"[ta] OR "Clin Infect Dis"[ta] OR "Kidney Int"[ta] OR ' +
      '"Gastroenterology"[ta] OR "Hepatology"[ta] OR "Intensive Care Med"[ta] OR "J Clin Oncol"[ta])' + NOT_OPINION,
  },
  {
    seed: 2, id: "pubmed-lancet-specialty", name: "Lancet specialty journals: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 75, homepage: PUBMED,
    query: '("Lancet Infect Dis"[ta] OR "Lancet Respir Med"[ta] OR "Lancet Diabetes Endocrinol"[ta] OR "Lancet Gastroenterol Hepatol"[ta] OR ' +
      '"Lancet Neurol"[ta] OR "Lancet HIV"[ta] OR "Lancet Haematol"[ta] OR "Lancet Psychiatry"[ta] OR "Lancet Rheumatol"[ta]) AND ' + TRIALS + NOT_OPINION,
  },
  {
    seed: 2, id: "pubmed-im-specialty", name: "Internal medicine specialty journals: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 75, homepage: PUBMED,
    query: '("Diabetes Care"[ta] OR "Kidney Int"[ta] OR "J Am Soc Nephrol"[ta] OR "Am J Respir Crit Care Med"[ta] OR "Chest"[ta] OR ' +
      '"Gastroenterology"[ta] OR "Hepatology"[ta] OR "Clin Infect Dis"[ta] OR "Intensive Care Med"[ta] OR "Crit Care Med"[ta] OR "Blood"[ta] OR ' +
      '"Ann Rheum Dis"[ta]) AND ' + TRIALS + NOT_OPINION,
  },
  {
    seed: 2, id: "pubmed-india", name: "Indian journals: trials, meta-analyses and guidelines", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 65, homepage: PUBMED,
    query: '("Indian J Med Res"[ta] OR "Natl Med J India"[ta] OR "J Assoc Physicians India"[ta] OR "Lancet Reg Health Southeast Asia"[ta] OR ' +
      '"Indian Pediatr"[ta]) AND (' + TRIALS + ' OR "Meta-Analysis"[pt] OR "Practice Guideline"[pt] OR "Guideline"[pt])' + NOT_OPINION,
  },
  {
    seed: 2, id: "pubmed-meta", name: "NEJM, Lancet, JAMA, BMJ, Annals, JAMA IM: meta-analyses and systematic reviews", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 80, homepage: PUBMED,
    query: '("N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta] OR "Ann Intern Med"[ta] OR "JAMA Intern Med"[ta]) AND ' +
      '("Meta-Analysis"[pt] OR "Systematic Review"[pt])' + NOT_OPINION,
  },
];
export const SEED_KEY = "seed_journal_sources_v1";
export function seedKey(n) { return "seed_journal_sources_v" + n; }

// Inserts every batch not yet recorded; returns the batch numbers seeded this call ([] when nothing new).
export async function seedJournalSourcesOnce(env) {
  const db = env && env.UPDATES_DB;
  if (!db) return [];
  await ensureBulletinSchema(db);
  const now = Date.now(), seeded = [];
  const batches = Array.from(new Set(JOURNAL_SOURCES.map((s) => s.seed))).sort((a, b) => a - b);
  for (const n of batches) {
    const done = await db.prepare("SELECT value FROM bulletin_settings WHERE key = ?").bind(seedKey(n)).first();
    if (done) continue;
    const stmts = JOURNAL_SOURCES.filter((s) => s.seed === n).map((s) => db.prepare(
      "INSERT OR IGNORE INTO sources (id, name, workspace, branch, type, homepage, guideline_page, rss_url, query, parser_type, priority, enabled, created_ts) " +
      "VALUES (?,?,?,?,?,?,'','',?,?,?,1,?)"
    ).bind(s.id, s.name, s.workspace, s.branch, s.type, s.homepage, s.query, s.parser_type, s.priority, now));
    stmts.push(db.prepare("INSERT OR IGNORE INTO bulletin_settings (key, value, updated_by, updated_ts) VALUES (?, '1', 'system', ?)").bind(seedKey(n), now));
    await db.batch(stmts);
    seeded.push(n);
  }
  return seeded;
}
