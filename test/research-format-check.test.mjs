import "./helpers/json-import-attr.mjs";
/* Journal format check. Pure checks plus the GET route.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-format-check.test.mjs
 */
import { test, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildFormatChecks } = await import("../functions/api/research/_format_check.js");

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CHECKS = [
  "word_count", "abstract", "title_length", "tables_figures", "reference_count",
  "reference_style", "run_tokens", "citations", "keywords", "required_sections",
  "reporting_checklist",
];

function section(id, heading, text) {
  return { id, heading, text };
}
function passing() {
  return {
    title: "BCG and admission",
    sections: [
      section("abstract", "Abstract", "Background: Adults with tuberculosis.\nMethods: A cohort was followed.\nResults: Admission was lower.\nConclusion: BCG may help."),
      section("keywords", "Keywords", "tuberculosis; BCG; admission"),
      section("introduction", "Introduction", "Why the study was done is stated here."),
      section("methods", "Methods", "What was done is stated here."),
      section("results", "Results", "The effect was {{run:r1.effect}}. Table 1 and Figure 1 are shown. See [1]."),
      section("discussion", "Discussion", "What the findings mean is stated here."),
      section("ethics", "Ethics", "The board approved the study."),
      section("funding", "Funding", "The work had no external funder."),
      section("conflicts", "Conflicts of interest", "The authors report no conflicts."),
      section("data_availability", "Data availability", "The data are in the supplement."),
    ],
    references: [{ key: "smith2020", authors: ["Smith J"], year: 2020 }],
    journal: {
      id: "bmj",
      name: "The BMJ",
      wordLimits: { abstract: 250, main: 3000 },
      referenceStyle: "vancouver",
      limits: { titleWords: 20, tables: 5, figures: 5, references: 30 },
    },
    resolvedTokens: new Set(["r1.effect"]),
    studyType: "cohort",
    checklist: { total: 22, filled: 22, plain: "STROBE (the observational study report checklist)" },
  };
}
function byId(checks, id) {
  return checks.find((c) => c.check === id);
}

test("format check: each item can pass, warn and fail", () => {
  const ok = buildFormatChecks(passing());
  assert.deepEqual(ok.map((c) => c.check), CHECKS);
  for (const c of ok) {
    assert.equal(c.status, "pass", c.check + " " + c.detail);
    assert.match(c.label, /\(/);
    assert.equal(c.detail.includes("\u2014") || c.detail.includes("\u2013"), false);
  }

  const overWords = passing();
  overWords.journal.wordLimits = { abstract: 250, main: 1 };
  assert.equal(byId(buildFormatChecks(overWords), "word_count").status, "fail");
  const noWordLimit = passing();
  noWordLimit.journal.wordLimits = { abstract: 250, main: null };
  assert.equal(byId(buildFormatChecks(noWordLimit), "word_count").status, "warn");
  const withinWords = passing();
  assert.match(byId(buildFormatChecks(withinWords), "word_count").detail, /within the 3000 word limit/);

  const noAbstract = passing();
  noAbstract.sections = noAbstract.sections.filter((s) => s.id !== "abstract");
  assert.equal(byId(buildFormatChecks(noAbstract), "abstract").status, "fail");
  const looseAbstract = passing();
  looseAbstract.sections[0].text = "Adults were followed and admission was lower.";
  assert.match(byId(buildFormatChecks(looseAbstract), "abstract").detail, /missing/);
  assert.equal(byId(buildFormatChecks(looseAbstract), "abstract").status, "fail");
  const longAbstract = passing();
  longAbstract.journal.wordLimits.abstract = 5;
  assert.equal(byId(buildFormatChecks(longAbstract), "abstract").status, "fail");
  const noAbstractLimit = passing();
  noAbstractLimit.journal.wordLimits.abstract = null;
  assert.equal(byId(buildFormatChecks(noAbstractLimit), "abstract").status, "warn");

  const emptyTitle = passing();
  emptyTitle.title = "  ";
  assert.equal(byId(buildFormatChecks(emptyTitle), "title_length").status, "fail");
  const longTitle = passing();
  longTitle.journal.limits.titleWords = 1;
  assert.equal(byId(buildFormatChecks(longTitle), "title_length").status, "fail");
  const noTitleLimit = passing();
  noTitleLimit.journal.limits.titleWords = null;
  assert.equal(byId(buildFormatChecks(noTitleLimit), "title_length").status, "warn");

  const tooManyTables = passing();
  tooManyTables.journal.limits.tables = 0;
  assert.equal(byId(buildFormatChecks(tooManyTables), "tables_figures").status, "fail");
  const tooManyFigures = passing();
  tooManyFigures.journal.limits.figures = 0;
  assert.equal(byId(buildFormatChecks(tooManyFigures), "tables_figures").status, "fail");
  const noDisplayLimit = passing();
  noDisplayLimit.journal.limits.tables = null;
  noDisplayLimit.journal.limits.figures = null;
  assert.equal(byId(buildFormatChecks(noDisplayLimit), "tables_figures").status, "warn");

  const tooManyRefs = passing();
  tooManyRefs.journal.limits.references = 0;
  assert.equal(byId(buildFormatChecks(tooManyRefs), "reference_count").status, "fail");
  const noRefLimit = passing();
  noRefLimit.journal.limits.references = null;
  assert.equal(byId(buildFormatChecks(noRefLimit), "reference_count").status, "warn");

  const mixed = passing();
  mixed.sections[4].text += " (Smith, 2020)";
  assert.equal(byId(buildFormatChecks(mixed), "reference_style").status, "fail");
  const authorYear = passing();
  authorYear.journal.referenceStyle = "harvard";
  authorYear.sections[4].text = "The effect was {{run:r1.effect}}. See (Smith, 2020).";
  assert.equal(byId(buildFormatChecks(authorYear), "reference_style").status, "pass");
  const wrongFamily = passing();
  wrongFamily.journal.referenceStyle = "apa";
  assert.equal(byId(buildFormatChecks(wrongFamily), "reference_style").status, "fail");
  const noStyle = passing();
  noStyle.journal.referenceStyle = null;
  assert.equal(byId(buildFormatChecks(noStyle), "reference_style").status, "warn");
  const keysOnly = passing();
  keysOnly.sections[4].text = "The effect was {{run:r1.effect}}. See [@smith2020].";
  assert.equal(byId(buildFormatChecks(keysOnly), "reference_style").status, "warn");

  const unresolved = passing();
  unresolved.resolvedTokens = new Set();
  assert.equal(byId(buildFormatChecks(unresolved), "run_tokens").status, "fail");
  assert.match(byId(buildFormatChecks(unresolved), "run_tokens").detail, /\{\{run:r1\.effect\}\}/);
  const malformed = passing();
  malformed.sections[4].text += " {{run:bad}}";
  assert.equal(byId(buildFormatChecks(malformed), "run_tokens").status, "fail");
  const noTokens = passing();
  noTokens.sections[4].text = "Table 1 and Figure 1 are shown. See [1].";
  assert.equal(byId(buildFormatChecks(noTokens), "run_tokens").status, "pass");
  const ci = passing();
  ci.sections[4].text = "The interval was {{run:r1.ci}}. Table 1 and Figure 1 are shown. See [1].";
  ci.resolvedTokens = new Set(["r1.ciLower", "r1.ciUpper"]);
  assert.equal(byId(buildFormatChecks(ci), "run_tokens").status, "pass");

  const uncited = passing();
  uncited.references.push({ key: "lee2019", authors: ["Lee K"], year: 2019 });
  assert.equal(byId(buildFormatChecks(uncited), "citations").status, "fail");
  assert.match(byId(buildFormatChecks(uncited), "citations").detail, /lee2019/);
  const missingCite = passing();
  missingCite.sections[4].text += " Also [2].";
  assert.equal(byId(buildFormatChecks(missingCite), "citations").status, "fail");
  assert.match(byId(buildFormatChecks(missingCite), "citations").detail, /\[2\]/);
  const none = passing();
  none.references = [];
  none.sections[4].text = "The effect was {{run:r1.effect}}. Table 1 and Figure 1 are shown.";
  assert.equal(byId(buildFormatChecks(none), "citations").status, "warn");
  const byAuthor = passing();
  byAuthor.sections[4].text = "The effect was {{run:r1.effect}}. Table 1 and Figure 1 are shown. (Smith, 2020)";
  assert.equal(byId(buildFormatChecks(byAuthor), "citations").status, "pass");

  const twoKeys = passing();
  twoKeys.sections[1].text = "tuberculosis; BCG";
  assert.equal(byId(buildFormatChecks(twoKeys), "keywords").status, "fail");
  const noKeys = passing();
  noKeys.sections = noKeys.sections.filter((s) => s.id !== "keywords");
  assert.equal(byId(buildFormatChecks(noKeys), "keywords").status, "fail");
  const seven = passing();
  seven.sections[1].text = "a; b; c; d; e; f; g";
  assert.equal(byId(buildFormatChecks(seven), "keywords").status, "fail");

  const missingEthics = passing();
  missingEthics.sections = missingEthics.sections.filter((s) => s.id !== "ethics");
  const req = byId(buildFormatChecks(missingEthics), "required_sections");
  assert.equal(req.status, "fail");
  assert.match(req.detail, /Ethics \(approval and consent\)/);
  assert.equal(req.sectionId, "ethics");

  const emptyList = passing();
  emptyList.checklist = { total: 22, filled: 0, plain: "STROBE (the observational study report checklist)" };
  assert.equal(byId(buildFormatChecks(emptyList), "reporting_checklist").status, "fail");
  assert.match(byId(buildFormatChecks(emptyList), "reporting_checklist").detail, /0%/);
  const partial = passing();
  partial.checklist.filled = 1;
  assert.equal(byId(buildFormatChecks(partial), "reporting_checklist").status, "warn");
  const unknown = passing();
  unknown.checklist = null;
  unknown.studyType = "qualitative";
  assert.equal(byId(buildFormatChecks(unknown), "reporting_checklist").status, "warn");
  const unset = passing();
  unset.checklist = null;
  unset.studyType = "";
  assert.match(byId(buildFormatChecks(unset), "reporting_checklist").detail, /not set/);
});

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-bob": { sub: "u-bob", email: "bob@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});
const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return [];
    },
  };
}
function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return { RESEARCH_MODE: "pilot", RESEARCH_DB: D, RESEARCH_CONTACT_EMAIL: "support@example.com" };
}
function sql(env) { return env.RESEARCH_DB._db; }
async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

describe("format check route", { concurrency: false, skip: SKIP }, () => {
  test("auth, journal, manuscript and each stored limit", async () => {
    const env = freshEnv();
    const created = await call(env, "POST", "v1/projects", "tok-alice", {
      title: "Format", studyType: "cohort", researchQuestion: "Does BCG reduce admission?",
    });
    assert.equal(created.http, 201, JSON.stringify(created));
    const pid = created.project.id;
    const outsider = await call(env, "GET", "v1/projects/" + pid + "/format-check?journal=bmj", "tok-eve");
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
    const missing = await call(env, "GET", "v1/projects/" + pid + "/format-check", "tok-alice");
    assert.equal(missing.http, 400);
    assert.equal(missing.error.code, "invalid_body");
    const unknown = await call(env, "GET", "v1/projects/" + pid + "/format-check?journal=nope", "tok-alice");
    assert.equal(unknown.http, 404);
    assert.equal(unknown.error.code, "journal_not_found");
    const bare = await call(env, "GET", "v1/projects/" + pid + "/format-check?journal=bmj", "tok-alice");
    assert.equal(bare.http, 404);
    assert.equal(bare.error.code, "manuscript_not_found");

    const now = Date.now();
    sql(env).prepare("INSERT INTO research_runs (id,project_id,measure,result_json,created_by,created_ts) VALUES ('r1',?,'RR',?,'u-alice',?)")
      .run(pid, JSON.stringify({ effect: 0.5 }), now);
    sql(env).prepare("INSERT INTO research_manuscript_versions (id,project_id,version,title,status,references_json,created_by,created_ts) VALUES ('mv1',?,1,?,'draft',?,'u-alice',?)")
      .run(pid, "BCG and hospital admission", JSON.stringify([{ key: "smith2020", authors: ["Smith J"], year: 2020 }]), now);
    const sections = [
      ["abstract", "Abstract", "Background: Adults with tuberculosis.\nMethods: A cohort was followed.\nResults: Admission was lower.\nConclusion: BCG may help."],
      ["keywords", "Keywords", "tuberculosis; BCG; admission"],
      ["introduction", "Introduction", "Why the study was done is stated here."],
      ["methods", "Methods", "What was done is stated here."],
      ["results", "Results", "The effect was {{run:r1.effect}}. Table 1 and Figure 1 are shown. See [1]."],
      ["discussion", "Discussion", "What the findings mean is stated here."],
      ["ethics", "Ethics", "The board approved the study."],
      ["funding", "Funding", "The work had no external funder."],
      ["conflicts", "Conflicts of interest", "The authors report no conflicts."],
      ["data_availability", "Data availability", "The data are in the supplement."],
    ];
    sections.forEach((s, i) => {
      sql(env).prepare("INSERT INTO research_manuscript_sections (version_id,section_id,heading,level,text,sort_order,updated_by,updated_ts) VALUES ('mv1',?,?,1,?,?, 'u-alice',?)")
        .run(s[0], s[1], s[2], i, now);
    });

    const member = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
    assert.ok(member.http === 200 || member.http === 201, JSON.stringify(member));
    const view = await call(env, "GET", "v1/projects/" + pid + "/format-check?journal=bmj", "tok-bob");
    assert.equal(view.http, 200, JSON.stringify(view));
    assert.equal(view.requestId, undefined);
    assert.equal(view.journalId, "bmj");
    assert.equal(view.journalName, "The BMJ");
    assert.deepEqual(view.checks.map((c) => c.check), CHECKS);
    const status = Object.fromEntries(view.checks.map((c) => [c.check, c.status]));
    assert.equal(status.word_count, "warn");
    assert.equal(status.abstract, "warn");
    assert.equal(status.title_length, "warn");
    assert.equal(status.tables_figures, "warn");
    assert.equal(status.reference_count, "warn");
    assert.equal(status.reference_style, "pass");
    assert.equal(status.run_tokens, "pass");
    assert.equal(status.citations, "pass");
    assert.equal(status.keywords, "pass");
    assert.equal(status.required_sections, "pass");
    assert.equal(status.reporting_checklist, "fail");
    assert.match(byId(view.checks, "reporting_checklist").detail, /0 of/);
    const blob = JSON.stringify(view.checks);
    assert.equal(blob.includes("\u2014") || blob.includes("\u2013"), false);
    for (const c of view.checks) assert.match(c.label, /\(/);

    sql(env).prepare("UPDATE research_journals SET word_limit_main=1, word_limit_abstract=5 WHERE id='bmj'").run();
    sql(env).prepare("INSERT INTO research_checklist_manual (project_id,guideline_id,item_num,text,updated_by,updated_ts) VALUES (?,'strobe','1a','Title states the design.','u-alice',?)")
      .run(pid, now);
    const again = await call(env, "GET", "v1/projects/" + pid + "/format-check?journal=bmj", "tok-alice");
    assert.equal(again.http, 200, JSON.stringify(again));
    assert.equal(byId(again.checks, "word_count").status, "fail");
    assert.equal(byId(again.checks, "abstract").status, "fail");
    assert.equal(byId(again.checks, "reporting_checklist").status, "warn");
    assert.match(byId(again.checks, "reporting_checklist").detail, /1 of/);
  });
});
