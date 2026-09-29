/* Clinical Bulletins phase 2: automatic intake from journals (PubMed) and new FDA approvals (openFDA).
 *
 * Network is mocked (the real APIs were checked by hand on 2026-09-28; see functions/_journal_sources.js).
 * What must hold: PubMed asks only for the last 7 days, newest first, never retracted papers, and keeps
 * structured abstracts; openFDA keeps ONLY original NDA/BLA approvals dated inside the window (the live API
 * returned a 2022 approval for a 2026 window, which this rule drops); journal sources are seeded once and an
 * owner's deletion sticks; a pipeline run turns new papers into updates that appear as Review Desk
 * candidates, and a second run with nothing new makes no AI call. Nothing here reaches a disease page.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/journal-intake.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

let AI_CALLS = 0;
mock.module("../functions/_summarize.js", {
  namedExports: {
    summarizeDocument: async (_env, meta) => { AI_CALLS++; return { ok: true, data: { title: meta.title, organization: meta.organization, summary: "Summary of " + meta.title, importance: "high", est_read_min: 2, keywords: ["k"], doi: meta.doi, pmid: meta.pmid, official_url: meta.url } }; },
    diffDocument: async () => ({ ok: true, changes: [] }),
    classifyDocument: async () => ({ ok: false }),
  },
});
const realSearch = await import("../functions/_search.js");
mock.module("../functions/_search.js", { namedExports: { ...realSearch, tinyfishSearch: async () => [] } });

const { parsePubmedXml, fetchPubMed } = await import("../functions/_pubmed.js");
const { selectNewApprovals, fetchOpenFdaApprovals, pickIndication } = await import("../functions/_openfda.js");
const { seedJournalSourcesOnce, JOURNAL_SOURCES, SEED_KEY, seedKey } = await import("../functions/_journal_sources.js");
const { runPipeline } = await import("../functions/_updates_pipeline.js");

const LONG = "x".repeat(320);
function article({ pmid, title, doi, abstract, y = "2026", m = "09", d = "16", pubTypes = ["Randomized Controlled Trial"], articleDate = true }) {
  return `<PubmedArticle><MedlineCitation><PMID Version="1">${pmid}</PMID><Article><Journal><Title>The New England journal of medicine</Title><ISOAbbreviation>N Engl J Med</ISOAbbreviation><JournalIssue><PubDate><Year>${y}</Year><Month>Sep</Month><Day>17</Day></PubDate></JournalIssue></Journal>` +
    `<ArticleTitle>${title}</ArticleTitle>${doi ? `<ELocationID EIdType="doi" ValidYN="Y">${doi}</ELocationID>` : ""}<Abstract>${abstract}</Abstract>` +
    (articleDate ? `<ArticleDate DateType="Electronic"><Year>${y}</Year><Month>${m}</Month><Day>${d}</Day></ArticleDate>` : "") +
    `<PublicationTypeList>${pubTypes.map((p) => `<PublicationType UI="D0">${p}</PublicationType>`).join("")}</PublicationTypeList></Article></MedlineCitation>` +
    `<PubmedData><ArticleIdList><ArticleId IdType="pubmed">${pmid}</ArticleId>${doi ? `<ArticleId IdType="doi">${doi}</ArticleId>` : ""}</ArticleIdList></PubmedData></PubmedArticle>`;
}
const XML = `<?xml version="1.0"?><PubmedArticleSet>` +
  article({ pmid: "111", title: "Drug A vs placebo in heart failure &amp; CKD", doi: "10.1056/A1", abstract: `<AbstractText Label="BACKGROUND">Why ${LONG}</AbstractText><AbstractText Label="RESULTS">HR 0.72 &lt; 1</AbstractText>` }) +
  article({ pmid: "222", title: "No DOI trial", doi: "", abstract: `<AbstractText>${LONG}</AbstractText>`, m: "Aug", d: "3", articleDate: false }) +
  article({ pmid: "333", title: "Too short", doi: "10.1/short", abstract: "<AbstractText>Brief.</AbstractText>" }) +
  `</PubmedArticleSet>`;

const realFetch = globalThis.fetch;
function withFetch(handler) { globalThis.fetch = async (url, init) => handler(String(url), init); }
function restore() { globalThis.fetch = realFetch; }
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const textRes = (t) => ({ ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) });

/* ---------------- PubMed ---------------- */

test("PubMed XML: structured abstract, decoded entities, DOI, electronic date, month names", () => {
  const r = parsePubmedXml(XML);
  assert.equal(r.length, 3);
  assert.equal(r[0].pmid, "111");
  assert.equal(r[0].title, "Drug A vs placebo in heart failure & CKD");
  assert.match(r[0].abstract, /^Background: Why x+ Results: HR 0\.72 < 1$/);
  assert.equal(r[0].doi, "10.1056/A1");
  assert.equal(r[0].journal, "N Engl J Med");
  assert.equal(new Date(r[0].ts).toISOString().slice(0, 10), "2026-09-16");
  assert.equal(new Date(r[1].ts).toISOString().slice(0, 10), "2026-09-17", "falls back to PubDate when no ArticleDate");
  assert.deepEqual(r[0].pubTypes, ["Randomized Controlled Trial"]);
});

test("PubMed fetch: last 7 days, newest first, retractions excluded, abstract required, doi/pmid keys", async () => {
  const seen = [];
  withFetch((url) => {
    seen.push(url);
    if (url.indexOf("esearch.fcgi") >= 0) return jsonRes({ esearchresult: { idlist: ["111", "222", "333"] } });
    if (url.indexOf("efetch.fcgi") >= 0) return textRes(XML);
    throw new Error("unexpected " + url);
  });
  try {
    const out = await fetchPubMed('"N Engl J Med"[ta]', { days: 7, limit: 12, env: { NCBI_API_KEY: "k1" } });
    const s = decodeURIComponent(seen[0]);
    for (const part of ["reldate=7", "datetype=mhda", "sort=pub_date", "retmax=12", "tool=stewardmd", "email=", "api_key=k1", 'NOT ("Retracted Publication"[pt] OR "Published Erratum"[pt])']) assert.ok(s.indexOf(part) >= 0, part);
    assert.match(seen[1], /efetch\.fcgi\?db=pubmed&retmode=xml&rettype=abstract&id=111,222,333/);
    assert.deepEqual(out.map((o) => o.docKey), ["pmid:222", "doi:10.1056/A1"], "short abstract dropped; newest first (222 is dated 17 Sep, 111 is 16 Sep)");
    assert.equal(out[1].url, "https://doi.org/10.1056/A1");
    assert.equal(out[0].url, "https://pubmed.ncbi.nlm.nih.gov/222/");
  } finally { restore(); }
});

test("PubMed fetch: calls are spaced for NCBI's limit and a 429 is retried once", async () => {
  const times = []; let n = 0;
  withFetch((url) => {
    times.push(Date.now()); n++;
    if (n === 1) return jsonRes({}, 429);
    if (url.indexOf("esearch.fcgi") >= 0) return jsonRes({ esearchresult: { idlist: ["111"] } });
    return textRes(XML);
  });
  try {
    const out = await fetchPubMed("x", {});
    assert.equal(out.length, 1);
    assert.equal(times.length, 3, "429, retried esearch, efetch");
    assert.ok(times[1] - times[0] >= 1000, "waits before the retry");
    assert.ok(times[2] - times[1] >= 340, "spaces the next call");
  } finally { restore(); }
});

test("PubMed fetch: no ids means no efetch call; HTTP errors throw for the crawl log", async () => {
  let calls = 0;
  withFetch(() => { calls++; return jsonRes({ esearchresult: { idlist: [] } }); });
  try { assert.deepEqual(await fetchPubMed("x", {}), []); assert.equal(calls, 1); } finally { restore(); }
  withFetch(() => jsonRes({}, 503));   // not a 429: no retry
  try { await assert.rejects(() => fetchPubMed("x", {}), /esearch HTTP 503/); } finally { restore(); }
});

/* ---------------- openFDA ---------------- */

const sub = (type, status, date, cls, docs) => ({ submission_type: type, submission_status: status, submission_status_date: date, submission_class_code: cls, application_docs: docs || [] });
const APPS = [
  { application_number: "NDA215866", sponsor_name: "LILLY", openfda: { brand_name: ["MOUNJARO"], generic_name: ["TIRZEPATIDE"] }, products: [{}],
    submissions: [sub("ORIG", "AP", "20220513", "TYPE 1"), sub("SUPPL", "AP", "20260910", "EFFICACY")] },          // old approval, new supplement: DROP
  { application_number: "NDA220359", sponsor_name: "ASTRAZENECA", openfda: { brand_name: ["ETCAMAH"], generic_name: ["CAMIZESTRANT"], pharm_class_epc: ["Estrogen Receptor Antagonist [EPC]"] }, products: [{ dosage_form: "TABLET", route: "ORAL" }],
    submissions: [sub("ORIG", "AP", "20260904", "TYPE 1", [{ type: "Letter", url: "http://www.accessdata.fda.gov/drugsatfda_docs/appletter/2026/220359Orig1s000ltr.pdf" }])] },
  { application_number: "ANDA203136", sponsor_name: "GENERIC", openfda: { brand_name: ["X"] }, products: [{}], submissions: [sub("ORIG", "AP", "20260905", "UNKNOWN")] },   // generic: DROP
  { application_number: "NDA299999", sponsor_name: "NEWFORM", openfda: { brand_name: ["Y"] }, products: [{}], submissions: [sub("ORIG", "AP", "20260906", "TYPE 3")] },     // new dosage form: DROP
  { application_number: "BLA761463", sponsor_name: "SCHOLAR", openfda: {}, products: [{ brand_name: "ISEMBYLD", active_ingredients: [{ name: "APITEGROMAB-MSTN" }, { name: "APITEGROMAB-MSTN" }] }], submissions: [sub("ORIG", "AP", "20260911", null)] },
  { application_number: "NDA288888", sponsor_name: "PENDING", openfda: { brand_name: ["Z"] }, products: [{}], submissions: [sub("ORIG", "TA", "20260907", "TYPE 1")] },     // tentative: DROP
];

test("openFDA rule: only original NDA (type 1/2/4) or BLA approvals dated inside the window", () => {
  const got = selectNewApprovals(APPS, "20260829", "20260928");
  assert.deepEqual(got.map((a) => a.application), ["NDA220359", "BLA761463"]);
  assert.equal(got[0].url, "https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2026/220359Orig1s000ltr.pdf", "http letter upgraded to https");
  assert.equal(got[1].generic, "apitegromab-mstn", "duplicate ingredient names collapse");
  assert.match(got[1].url, /^https:\/\/www\.accessdata\.fda\.gov\/scripts\/cder\/daf\/index\.cfm\?event=overview\.process&ApplNo=761463$/);
});

test("openFDA fetch: pages until done, adds the label indication, doc keys by application", async () => {
  const urls = [];
  withFetch((url) => {
    urls.push(url);
    if (url.indexOf("drugsfda.json") >= 0) {
      const skip = parseInt((url.match(/skip=(\d+)/) || [])[1], 10);
      if (skip === 0) return jsonRes({ meta: { results: { total: 150 } }, results: APPS.concat(new Array(94).fill({ application_number: "ANDA000001", submissions: [] })) });
      return jsonRes({ meta: { results: { total: 150 } }, results: [APPS[1]] });                              // page 2 repeats one: deduped
    }
    if (url.indexOf("label.json") >= 0 && url.indexOf("NDA220359") >= 0) return jsonRes({ results: [{ indications_and_usage: ["1 INDICATIONS AND USAGE ETCAMAH is indicated for HR-positive, HER2-negative breast cancer."] }] });
    if (url.indexOf("label.json") >= 0) return jsonRes({ error: { code: "NOT_FOUND" } }, 404);
    throw new Error("unexpected " + url);
  });
  try {
    const out = await fetchOpenFdaApprovals({ days: 30, now: Date.parse("2026-09-28T00:00:00Z") });
    assert.equal(urls.filter((u) => u.indexOf("drugsfda.json") >= 0).length, 2, "stops after the last page");
    assert.match(decodeURIComponent(urls[0]), /submission_status_date:\[20260829\+TO\+20260928\]/);
    assert.deepEqual(out.map((o) => o.docKey), ["fda:BLA761463", "fda:NDA220359"]);
    const et = out.find((o) => o.docKey === "fda:NDA220359");
    assert.equal(et.title, "FDA approves Etcamah (camizestrant)");
    assert.match(et.abstract, /Indications and usage \(FDA label\): ETCAMAH is indicated for HR-positive, HER2-negative breast cancer\./);
    assert.match(et.abstract, /Established pharmacologic class: Estrogen Receptor Antagonist \[EPC\]\./);
    assert.match(out[0].abstract, /Indication not yet in openFDA/);
  } finally { restore(); }
});

/* ---------------- seeding + pipeline ---------------- */

const SCHEMA = readFileSync(new URL("../functions/db/updates_schema.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { _db: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}

test("seeding: journal sources are added once; an owner's deletion or disable sticks", { skip: SKIP }, async () => {
  const D = d1(); D._db.exec(SCHEMA.replace(/-- BEGIN bulletins[\s\S]*?-- END bulletins/, ""));   // pre-bulletins database
  const env = { UPDATES_DB: D };
  assert.deepEqual(await seedJournalSourcesOnce(env), [1, 2]);
  const ids = () => D._db.prepare("SELECT id FROM sources ORDER BY id").all().map((r) => r.id);
  assert.deepEqual(ids(), JOURNAL_SOURCES.map((s) => s.id).sort());
  D._db.prepare("DELETE FROM sources WHERE id = 'pubmed-cardio'").run();
  D._db.prepare("UPDATE sources SET enabled = 0 WHERE id = 'pubmed-onc'").run();
  assert.deepEqual(await seedJournalSourcesOnce(env), []);
  assert.ok(ids().indexOf("pubmed-cardio") < 0, "deleted source is not re-added");
  assert.equal(D._db.prepare("SELECT enabled FROM sources WHERE id = 'pubmed-onc'").get().enabled, 0);
  assert.equal(D._db.prepare("SELECT value FROM bulletin_settings WHERE key = ?").get(SEED_KEY).value, "1");
  for (const s of JOURNAL_SOURCES) if (s.parser_type === "pubmed") assert.match(s.query, /NOT \("Comment"\[pt\] OR "Letter"\[pt\] OR "Editorial"\[pt\]\)$/, s.id);
});

test("seeding: a later batch reaches a site that already has batch 1, without restoring its deletions", { skip: SKIP }, async () => {
  const D = d1(); D._db.exec(SCHEMA);
  const env = { UPDATES_DB: D };
  const b1 = JOURNAL_SOURCES.filter((s) => s.seed === 1);
  for (const s of b1) if (s.id !== "pubmed-cardio") D._db.prepare("INSERT INTO sources (id, name, query, parser_type, type, enabled, created_ts) VALUES (?,?,?,?,?,1,1)").run(s.id, s.name, s.query, s.parser_type, s.type);
  D._db.prepare("INSERT INTO bulletin_settings (key, value) VALUES (?, '1')").run(seedKey(1));    // production state after batch 1, cardio deleted
  assert.deepEqual(await seedJournalSourcesOnce(env), [2]);
  const ids = D._db.prepare("SELECT id FROM sources").all().map((r) => r.id);
  for (const s of JOURNAL_SOURCES.filter((x) => x.seed === 2)) assert.ok(ids.indexOf(s.id) >= 0, s.id + " added");
  assert.ok(ids.indexOf("pubmed-cardio") < 0, "batch 1 deletion still respected");
  assert.equal(new Set(JOURNAL_SOURCES.map((s) => s.id)).size, JOURNAL_SOURCES.length, "ids are unique");
  for (const s of JOURNAL_SOURCES) assert.ok(Number.isInteger(s.seed) && s.seed >= 1, s.id + " has a batch");
});

test("pipeline: journal + FDA items become updates and Review Desk candidates; a rerun makes no AI call", { skip: SKIP }, async () => {
  const D = d1(); D._db.exec(SCHEMA);
  const env = { UPDATES_DB: D, UPDATES_MAX_AI_PER_RUN: "50" };
  // only the seeded journal/FDA sources exist, so every fetch below is one of theirs
  withFetch((url) => {
    if (url.indexOf("esearch.fcgi") >= 0) return jsonRes({ esearchresult: { idlist: ["111", "222"] } });
    if (url.indexOf("efetch.fcgi") >= 0) return textRes(XML);
    if (url.indexOf("drugsfda.json") >= 0) return jsonRes({ meta: { results: { total: APPS.length } }, results: APPS.map((a) => JSON.parse(JSON.stringify(a).replace(/202609(\d\d)/g, (m) => {
      const t = new Date(); return t.toISOString().slice(0, 10).replace(/-/g, "");   // move in-window dates to today
    }))) });
    if (url.indexOf("label.json") >= 0) return jsonRes({ results: [] });
    throw new Error("unexpected " + url);
  });
  try {
    AI_CALLS = 0;
    const r1 = await runPipeline(env);
    assert.equal(r1.ok, true);
    const rows = D._db.prepare("SELECT doc_key, type, source_id FROM updates ORDER BY doc_key").all();
    const keys = rows.map((r) => r.doc_key);
    assert.ok(keys.indexOf("doi:10.1056/A1") >= 0 && keys.indexOf("pmid:222") >= 0, "journal papers stored once despite three PubMed sources");
    assert.equal(keys.filter((k) => k === "doi:10.1056/A1").length, 1);
    assert.ok(keys.indexOf("fda:NDA220359") >= 0 && keys.indexOf("fda:BLA761463") >= 0);
    assert.ok(keys.indexOf("fda:NDA215866") < 0, "old approval with a new supplement is not news");
    assert.equal(rows.find((r) => r.doc_key === "fda:NDA220359").type, "drug_approval");
    // A paper several sources return is stored once, typed by the first source to reach it (lowest priority number).
    const firstPubmed = JOURNAL_SOURCES.filter((x) => x.parser_type === "pubmed").sort((x, y) => x.priority - y.priority)[0];
    assert.equal(rows.find((r) => r.doc_key === "doi:10.1056/A1").type, firstPubmed.type);
    const firstAi = AI_CALLS;
    assert.equal(firstAi, rows.length, "one summary per new item");
    const logs = D._db.prepare("SELECT source_id, detail FROM crawl_logs").all();
    assert.ok(logs.some((l) => /\(pubmed\)$/.test(l.detail)) && logs.some((l) => /\(openfda\)$/.test(l.detail)));

    const r2 = await runPipeline(env);
    assert.equal(AI_CALLS, firstAi, "nothing new, no AI call");
    assert.equal(r2.new, 0);

    const { listCandidates } = await import("../functions/_bulletins_repo.js");
    const cands = await listCandidates(env, Date.now() - 90 * 86400000, 50);
    assert.ok(cands.some((c) => c.id && c.type === "drug_approval") && cands.some((c) => c.type === firstPubmed.type), "new items are Review Desk candidates");
    assert.equal(D._db.prepare("SELECT count(*) AS n FROM bulletins").get().n, 0, "nothing is published to a disease page automatically");
  } finally { restore(); }
});

test("pipeline: when the AI budget runs out, later sources log 'skipped ... AI budget reached', not 'unchanged'", { skip: SKIP }, async () => {
  const D = d1(); D._db.exec(SCHEMA);
  const env = { UPDATES_DB: D, UPDATES_MAX_AI_PER_RUN: "1" };
  withFetch((url) => {
    if (url.indexOf("esearch.fcgi") >= 0) return jsonRes({ esearchresult: { idlist: ["111", "222"] } });
    if (url.indexOf("efetch.fcgi") >= 0) return textRes(XML);
    if (url.indexOf("drugsfda.json") >= 0) return jsonRes({ meta: { results: { total: 0 } }, results: [] });
    throw new Error("unexpected " + url);
  });
  try {
    AI_CALLS = 0;
    await runPipeline(env);
    assert.equal(AI_CALLS, 1);
    const logs = D._db.prepare("SELECT status, detail FROM crawl_logs WHERE detail LIKE '%(pubmed)%'").all();
    assert.ok(logs.some((l) => l.status === "skipped" && /AI budget reached; rest next run$/.test(l.detail)), JSON.stringify(logs.slice(0, 3)));
  } finally { restore(); }
});

test("approval letter: the indication sentence, in either wording FDA uses", () => {
  const letter = "Dear Dr Smith: Please refer to your application. We have completed our review.\n" +
    "This NDA provides for the use of Orzeyful (oveporexton) tablets for the treatment of narcolepsy\ntype 1 (narcolepsy with cataplexy) in adult patients. APPROVAL & LABELING We have completed our review.";
  assert.equal(pickIndication(letter), "This NDA provides for the use of Orzeyful (oveporexton) tablets for the treatment of narcolepsy type 1 (narcolepsy with cataplexy) in adult patients.");
  assert.equal(pickIndication("Isembyld is indicated for the treatment of spinal muscular atrophy (SMA) in adults. Other text."), "Isembyld is indicated for the treatment of spinal muscular atrophy (SMA) in adults.");
  assert.equal(pickIndication("Nothing relevant here."), "");
});

test("openFDA: no label yet -> the approval letter is read with TinyFish Fetch; no key -> the old note", async () => {
  const letterUrl = "https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2026/220359Orig1s000ltr.pdf";
  let tiny = 0;
  withFetch((url, init) => {
    if (url === "https://api.fetch.tinyfish.ai") { tiny++; assert.deepEqual(JSON.parse(init.body).urls, [letterUrl]); return jsonRes({ results: [{ url: letterUrl, text: "We approve. ETCAMAH is indicated for adults with HR-positive, HER2-negative advanced breast cancer. Sincerely." }] }); }
    if (url.indexOf("drugsfda.json") >= 0) return jsonRes({ meta: { results: { total: 1 } }, results: [APPS[1]] });
    if (url.indexOf("label.json") >= 0) return jsonRes({ error: { code: "NOT_FOUND" } }, 404);
    throw new Error("unexpected " + url);
  });
  try {
    const withKey = await fetchOpenFdaApprovals({ days: 30, now: Date.parse("2026-09-28T00:00:00Z"), env: { TINYFISH_API_KEY: "tf" } });
    assert.equal(tiny, 1);
    assert.match(withKey[0].abstract, /Indication \(FDA approval letter\): ETCAMAH is indicated for adults with HR-positive, HER2-negative advanced breast cancer\./);
    const noKey = await fetchOpenFdaApprovals({ days: 30, now: Date.parse("2026-09-28T00:00:00Z"), env: {} });
    assert.equal(tiny, 1, "no TinyFish call without the key");
    assert.match(noKey[0].abstract, /Indication not yet in openFDA; see the approval letter\./);
  } finally { restore(); }
});
