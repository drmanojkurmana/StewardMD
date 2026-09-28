/* StewardMD - Medical Updates: journal and regulator sources for Clinical Bulletins, seeded ONCE.
 *
 * Every query here was run against the live API on 2026-09-28 before it was written down (PubMed returned
 * 37 / 11 / 17 papers for the last 30 days; openFDA returned 15 new NDA/BLA approvals for the last 60).
 * runPipeline() calls seedJournalSourcesOnce() before each crawl; it inserts these rows with INSERT OR
 * IGNORE and then records bulletin_settings 'seed_journal_sources_v1', so an owner who later disables or
 * deletes one in Admin > Medical Sources keeps that choice. functions/db/seed_sources_journals.sql is the
 * hand-runnable copy. New items land in the bell feed and the Review Desk queue; nothing reaches a disease
 * page until a registered doctor signs a bulletin for it.
 */
import { ensureBulletinSchema } from "./_bulletins_schema.js";

const NOT_OPINION = ' NOT ("Comment"[pt] OR "Letter"[pt] OR "Editorial"[pt])';
export const JOURNAL_SOURCES = [
  {
    id: "openfda-approvals", name: "FDA new drug and biologic approvals (openFDA)", type: "drug_approval",
    workspace: "internal_medicine", branch: "", parser_type: "openfda", priority: 15, query: "",
    homepage: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm",
  },
  {
    id: "pubmed-core", name: "NEJM, Lancet, JAMA, BMJ: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "", parser_type: "pubmed", priority: 60,
    query: '("N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt])' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
  {
    id: "pubmed-cardio", name: "Circulation, Eur Heart J, JACC: randomised and phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "cardiology", parser_type: "pubmed", priority: 70,
    query: '("Circulation"[ta] OR "Eur Heart J"[ta] OR "J Am Coll Cardiol"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt])' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
  {
    id: "pubmed-onc", name: "J Clin Oncol, Lancet Oncol, JAMA Oncol: phase 3 trials", type: "trial",
    workspace: "internal_medicine", branch: "oncology", parser_type: "pubmed", priority: 70,
    query: '("J Clin Oncol"[ta] OR "Lancet Oncol"[ta] OR "JAMA Oncol"[ta]) AND "Clinical Trial, Phase III"[pt]' + NOT_OPINION,
    homepage: "https://pubmed.ncbi.nlm.nih.gov",
  },
];
export const SEED_KEY = "seed_journal_sources_v1";

export async function seedJournalSourcesOnce(env) {
  const db = env && env.UPDATES_DB;
  if (!db) return false;
  await ensureBulletinSchema(db);
  const done = await db.prepare("SELECT value FROM bulletin_settings WHERE key = ?").bind(SEED_KEY).first();
  if (done) return false;
  const now = Date.now();
  const stmts = JOURNAL_SOURCES.map((s) => db.prepare(
    "INSERT OR IGNORE INTO sources (id, name, workspace, branch, type, homepage, guideline_page, rss_url, query, parser_type, priority, enabled, created_ts) " +
    "VALUES (?,?,?,?,?,?,'','',?,?,?,1,?)"
  ).bind(s.id, s.name, s.workspace, s.branch, s.type, s.homepage, s.query, s.parser_type, s.priority, now));
  stmts.push(db.prepare("INSERT OR IGNORE INTO bulletin_settings (key, value, updated_by, updated_ts) VALUES (?, '1', 'system', ?)").bind(SEED_KEY, now));
  await db.batch(stmts);
  return true;
}
