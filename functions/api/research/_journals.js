/* ResearchMD Phase 5B.3 journal records + matching (ES module, server side).
 * Contract: docs/research/contracts/phase-6/journals.md. The seed below is the
 * SAME data as docs/research/contracts/phase-6/journals.seed.json (a test
 * asserts deep equality so the two cannot drift); Pages functions do not read
 * docs at runtime, so the module embeds it and lazy-seeds research_journals
 * with INSERT OR IGNORE (the global-reasons pattern).
 *
 * Integrity: knowledge snapshot 2026-11-24, NOT live-verified. checkedTs is
 * null until a source check lands; uncertain values are null (plan rule 4).
 * Matching is deterministic keyword/design scoring; no LLM.
 */

export const JOURNAL_SEED = [
  {
    id: "nejm", name: "New England Journal of Medicine", issn: "0028-4793",
    scope: ["general medicine", "internal medicine", "clinical trials", "randomized controlled trials", "cohort studies", "original research"],
    designs: ["rct", "cohort", "observational", "narrative_review"],
    authorInstructionsUrl: "https://www.nejm.org/author-center",
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "lancet", name: "The Lancet", issn: "0140-6736",
    scope: ["general medicine", "global health", "public health", "clinical trials", "randomized controlled trials", "cohort studies"],
    designs: ["rct", "cohort", "observational", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "jama", name: "JAMA", issn: "0098-7484",
    scope: ["general medicine", "internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://jamanetwork.com/journals/jama/pages/instructions-for-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "ama", checkedTs: null,
  },
  {
    id: "bmj", name: "The BMJ", issn: "0959-8138",
    scope: ["general medicine", "primary care", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "public health"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://www.bmj.com/about-bmj/resources-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "annals", name: "Annals of Internal Medicine", issn: "0003-4819",
    scope: ["internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "clinical practice"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "plos_medicine", name: "PLOS Medicine", issn: "1549-1277",
    scope: ["general medicine", "public health", "global health", "clinical trials", "systematic reviews", "meta-analysis", "observational studies", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://journals.plos.org/plosmedicine/s/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "bmc_medicine", name: "BMC Medicine", issn: "1741-7015",
    scope: ["general medicine", "clinical trials", "systematic reviews", "meta-analysis", "observational studies", "public health", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://bmcmedicine.biomedcentral.com/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "jama_internal_medicine", name: "JAMA Internal Medicine", issn: "2168-6106",
    scope: ["internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "health services research"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://jamanetwork.com/journals/jamainternalmedicine/pages/instructions-for-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "ama", checkedTs: null,
  },
  {
    id: "bmj_open", name: "BMJ Open", issn: "2044-6055",
    scope: ["general medicine", "clinical trials", "randomized controlled trials", "cohort studies", "observational studies", "systematic reviews", "meta-analysis", "diagnostic accuracy", "prognosis", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "diagnostic_accuracy", "prognostic", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "systematic_reviews", name: "Systematic Reviews", issn: "2046-4053",
    scope: ["systematic reviews", "meta-analysis", "evidence synthesis", "methodology", "scoping reviews", "open access"],
    designs: ["systematic_review", "meta_analysis"],
    authorInstructionsUrl: "https://systematicreviewsjournal.biomedcentral.com/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
];

async function ensureSeeded(db) {
  const now = Date.now();
  await db.batch(JOURNAL_SEED.map((j) =>
    db.prepare("INSERT OR IGNORE INTO research_journals (id,name,issn,scope_json,designs_json,author_instructions_url,word_limit_abstract,word_limit_main,reference_style,checked_ts,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(j.id, j.name, j.issn, JSON.stringify(j.scope), JSON.stringify(j.designs),
        j.authorInstructionsUrl, j.wordLimits.abstract, j.wordLimits.main,
        j.referenceStyle, j.checkedTs, now)));
}
function journalOf(row) {
  return {
    id: row.id, name: row.name, issn: row.issn || "",
    scope: JSON.parse(row.scope_json || "[]"), designs: JSON.parse(row.designs_json || "[]"),
    authorInstructionsUrl: row.author_instructions_url == null ? null : row.author_instructions_url,
    wordLimits: { abstract: row.word_limit_abstract == null ? null : row.word_limit_abstract,
      main: row.word_limit_main == null ? null : row.word_limit_main },
    referenceStyle: row.reference_style == null ? null : row.reference_style,
    checkedTs: row.checked_ts == null ? null : row.checked_ts,
  };
}

/* GET /v1/journals?q= */
export async function listJournals(ctx, url) {
  const { db, requestId, api } = ctx;
  await ensureSeeded(db);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const rows = (await db.prepare("SELECT * FROM research_journals ORDER BY name ASC").all()).results || [];
  let journals = rows.map(journalOf);
  if (q) journals = journals.filter((j) =>
    j.name.toLowerCase().includes(q) || j.scope.some((s) => s.toLowerCase().includes(q)));
  return api.json({ journals }, 200, { "x-request-id": requestId });
}
/* GET /v1/journals/{id} */
export async function getJournal(ctx, id) {
  const { db, requestId, api } = ctx;
  await ensureSeeded(db);
  const row = await db.prepare("SELECT * FROM research_journals WHERE id=?").bind(id).first();
  if (!row) return api.err(404, "journal_not_found", "Journal not found", requestId);
  return api.json({ journal: journalOf(row) }, 200, { "x-request-id": requestId });
}
/* POST /v1/journals/match {keywords, design?}: deterministic scoring.
 * score = 2 * distinct scope hits + 3 * design match; zero-score omitted. */
export async function matchJournals(ctx, body) {
  const { db, requestId, api } = ctx;
  const keywords = body.keywords;
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 20 ||
      keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 80))
    return api.err(400, "invalid_body", "keywords must be 1-20 strings of 1-80 characters", requestId);
  const design = body.design === undefined ? null : body.design;
  if (design !== null && (typeof design !== "string" || design.length > 80))
    return api.err(400, "invalid_body", "design must be a string", requestId);
  await ensureSeeded(db);
  const kws = keywords.map((k) => k.trim().toLowerCase());
  const rows = (await db.prepare("SELECT * FROM research_journals").all()).results || [];
  const matches = [];
  for (const row of rows) {
    const j = journalOf(row);
    const matchedKeywords = j.scope.filter((s) => {
      const sl = s.toLowerCase();
      return kws.some((k) => sl.includes(k) || k.includes(sl));
    });
    const designMatch = design !== null && j.designs.indexOf(design) >= 0;
    const score = 2 * matchedKeywords.length + (designMatch ? 3 : 0);
    if (score > 0) matches.push({ journal: j, score, matchedKeywords, designMatch });
  }
  matches.sort((a, b) => b.score - a.score || (a.journal.name < b.journal.name ? -1 : 1));
  return api.json({ matches }, 200, { "x-request-id": requestId });
}
