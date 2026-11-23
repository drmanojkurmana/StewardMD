/* ResearchMD Phase 5B checklist auto-fill.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-checklist.test.mjs
 *
 * Fixtures live under test/fixtures/research/checklist/ so this file does not
 * read docs/research/checklists (another tool is writing those).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const CHECK = require("../research-checklist.js");

function readJson(name) {
  return JSON.parse(readFileSync(new URL("./fixtures/research/checklist/" + name, import.meta.url), "utf8"));
}

const reported = readJson("snapshot-reported.json");
const emptySnap = readJson("snapshot-empty.json");
const miniPrisma = readJson("mini-prisma.json");
const miniOther = readJson("mini-other.json");

function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    Object.freeze(o);
  }
  return o;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function byNum(filled, num) {
  const row = filled.items.filter(function (it) { return it.num === num; })[0];
  assert.ok(row, "missing item " + num);
  return row;
}

function checklistFrom(id, name, rows) {
  const sections = [];
  const index = {};
  rows.forEach(function (row) {
    if (!index[row[0]]) {
      index[row[0]] = { title: row[0], items: [] };
      sections.push(index[row[0]]);
    }
    index[row[0]].items.push({
      num: row[1],
      topic: row[2],
      text: row[3],
      projectField: row[4]
    });
  });
  return { id: id, name: name, version: "test", sections: sections };
}

const PRISMA_ROWS = [
  ["Title", "1", "Title", "Identify the report as a systematic review in the title.", "manuscript"],
  ["Abstract", "2", "Abstract", "Give a structured abstract.", "manuscript"],
  ["Introduction", "3", "Rationale", "Describe why the review was done.", "manuscript"],
  ["Introduction", "4", "Objectives", "State the objectives.", "protocol"],
  ["Methods", "5", "Eligibility criteria", "State inclusion and exclusion criteria.", "protocol"],
  ["Methods", "6", "Information sources", "List every database and the last search date.", "search"],
  ["Methods", "7", "Search strategy", "Give the full search strategy.", "search"],
  ["Methods", "8", "Selection process", "State how studies were screened.", "screening"],
  ["Methods", "9", "Data collection process", "State how data were extracted.", "extraction"],
  ["Methods", "10a", "Data items", "List the outcomes sought.", "protocol"],
  ["Methods", "10b", "Other variables", "List other variables sought.", "extraction"],
  ["Methods", "11", "Study risk of bias assessment", "State how risk of bias was assessed.", "rob"],
  ["Methods", "12", "Effect measures", "State the effect measures.", "analysis"],
  ["Methods", "13a", "Synthesis methods", "Describe how studies were grouped.", "protocol"],
  ["Methods", "13b", "Data preparation", "Describe data preparation.", "analysis"],
  ["Methods", "13c", "Tabulation and plots", "Describe how results were displayed.", "analysis"],
  ["Methods", "13d", "Synthesis model", "Describe the model and software.", "analysis"],
  ["Methods", "13e", "Heterogeneity methods", "Describe heterogeneity methods.", "analysis"],
  ["Methods", "13f", "Sensitivity methods", "Describe sensitivity methods.", "analysis"],
  ["Methods", "14", "Reporting bias assessment", "Describe how reporting bias was assessed.", "analysis"],
  ["Methods", "15", "Certainty assessment", "Describe how certainty was assessed.", "grade"],
  ["Results", "16a", "Study selection", "Report the flow of records.", "prisma"],
  ["Results", "16b", "Excluded studies", "Cite excluded studies and the reasons.", "prisma"],
  ["Results", "17", "Study characteristics", "Cite each study and its characteristics.", "extraction"],
  ["Results", "18", "Risk of bias in studies", "Present risk of bias judgments.", "rob"],
  ["Results", "19", "Results of individual studies", "Present study estimates.", "extraction"],
  ["Results", "20a", "Results of syntheses", "Summarise characteristics and risk of bias.", "rob"],
  ["Results", "20b", "Results of statistical syntheses", "Present the pooled estimate.", "analysis"],
  ["Results", "20c", "Heterogeneity results", "Present heterogeneity results.", "analysis"],
  ["Results", "20d", "Sensitivity results", "Present sensitivity results.", "analysis"],
  ["Results", "21", "Reporting biases", "Present reporting-bias results.", "analysis"],
  ["Results", "22", "Certainty of evidence", "Present certainty for each outcome.", "grade"],
  ["Discussion", "23a", "Discussion of evidence", "Compare with other evidence.", "manuscript"],
  ["Discussion", "23b", "Limitations of evidence", "Discuss limitations of the included evidence.", "manuscript"],
  ["Discussion", "23c", "Limitations of review", "Discuss limitations of the review methods.", "manuscript"],
  ["Discussion", "23d", "Implications", "Discuss implications.", "manuscript"],
  ["Other information", "24a", "Registration", "Give the registration name and number.", "protocol"],
  ["Other information", "24b", "Protocol access", "Say where the protocol can be read.", "protocol"],
  ["Other information", "24c", "Amendments", "Describe amendments.", "protocol"],
  ["Other information", "25", "Support", "State funding.", "manuscript"],
  ["Other information", "26", "Competing interests", "State competing interests.", "manuscript"],
  ["Other information", "27", "Availability of data", "State where the data are.", "manuscript"]
];

function fullPrisma() {
  return checklistFrom("prisma2020", "PRISMA 2020", PRISMA_ROWS);
}

function stripSrc(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("exports fill and toCsv, including a browser global", function () {
  assert.equal(CHECK.name, "research-checklist");
  assert.equal(CHECK.version, "rmd1");
  assert.equal(typeof CHECK.fill, "function");
  assert.equal(typeof CHECK.toCsv, "function");
  const src = readFileSync(new URL("../research-checklist.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_CHECKLIST.fill, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_CHECKLIST.version, "rmd1");
});

test("checklist, screen, and submission sources stay ES5", function () {
  ["../research-checklist.js", "../research-screen-checklist.js", "../research-submission.js"].forEach(function (rel) {
    const src = stripSrc(rel);
    assert.equal(src.indexOf("=>"), -1, rel + ": no arrow functions");
    assert.ok(!/\b(let|const)\s/.test(src), rel + ": no let/const declarations");
    assert.equal(src.indexOf("`"), -1, rel + ": no template strings");
    assert.ok(!/\bclass\s+[A-Za-z]/.test(src), rel + ": no classes");
    assert.ok(!/\bnew Date\b/.test(src), rel + ": no clock");
    assert.ok(!/\bMath\.random\b/.test(src), rel + ": no random source");
    assert.equal(src.indexOf("direct submission"), -1, rel + ": no direct submission claim");
    assert.equal(src.indexOf("\u2014"), -1, rel + ": no em dash");
    assert.equal(src.indexOf("\u2013"), -1, rel + ": no en dash");
  });
});

test("a complete PRISMA 2020 snapshot fills every item", function () {
  const checklist = fullPrisma();
  const snap = clone(reported);
  deepFreeze(checklist);
  deepFreeze(snap);
  const beforeC = JSON.stringify(checklist);
  const beforeS = JSON.stringify(snap);
  const filled = CHECK.fill(checklist, snap);
  const again = CHECK.fill(checklist, snap);
  assert.equal(JSON.stringify(checklist), beforeC);
  assert.equal(JSON.stringify(snap), beforeS);
  assert.equal(JSON.stringify(filled), JSON.stringify(again));
  assert.equal(filled.items.length, 42);
  assert.equal(filled.checklistId, "prisma2020");
  const bad = filled.items.filter(function (it) { return it.status !== "auto"; }).map(function (it) {
    return it.num + " " + it.status + " :: " + (it.evidence || []).join(" / ");
  });
  assert.deepEqual(bad, []);
  const sum = filled.counts.auto + filled.counts.partial + filled.counts.manual + filled.counts.missing;
  assert.equal(sum, filled.counts.total);
  assert.equal(filled.counts.auto, 42);
  assert.deepEqual(byNum(filled, "1").pointer, { section: "Title", paragraph: 0 });
  assert.equal(byNum(filled, "6").pointer.section, "Information sources");
  assert.deepEqual(byNum(filled, "16a").pointer, { section: "Results", paragraph: 0 });
  assert.equal(byNum(filled, "23d").filled, reported.manuscript.sections[6].paragraphs[3]);
  assert.deepEqual(byNum(filled, "23d").pointer, { section: "Discussion", paragraph: 3 });
  const pooled = byNum(filled, "20b").filled;
  assert.ok(pooled.indexOf(" to ") !== -1, pooled);
  assert.equal(pooled.indexOf("reduced"), -1);
  assert.ok(pooled.indexOf("I2 40") !== -1, pooled);
  const reg = byNum(filled, "24a").filled;
  assert.ok(reg.indexOf("PROSPERO") !== -1, reg);
  assert.ok(reg.indexOf("CRD42025000001") !== -1, reg);
  assert.equal(pooled.indexOf("\u2014"), -1);
});

test("PRISMA objectives need both parts; a generic protocol item does not", function () {
  const onlyQ = { protocol: { question: "What is the effect of BCG?" } };
  const prisma = checklistFrom("prisma2020", "PRISMA 2020", [
    ["Introduction", "4", "Objectives", "State the objectives.", "protocol"]
  ]);
  const row = byNum(CHECK.fill(prisma, onlyQ), "4");
  assert.equal(row.status, "partial");
  assert.ok(row.filled.indexOf("What is the effect of BCG?") !== -1);
  const generic = CHECK.fill(miniOther, onlyQ);
  assert.equal(byNum(generic, "3").status, "auto");
  assert.equal(byNum(generic, "3").num, "3");
});

test("PRISMA information sources need a date; a generic search item does not", function () {
  const snap = { searches: [{ database: "PubMed", query: "BCG AND tuberculosis" }] };
  const prisma = checklistFrom("prisma2020", "PRISMA 2020", [
    ["Methods", "6", "Information sources", "List databases and dates.", "search"]
  ]);
  const row = byNum(CHECK.fill(prisma, snap), "6");
  assert.equal(row.status, "partial");
  assert.ok((row.evidence || []).join(" ").indexOf("last search date") !== -1);
  const generic = checklistFrom("strobe-fixture", "STROBE fixture", [
    ["Methods", "6", "Setting", "Name the data sources.", "search"]
  ]);
  assert.equal(byNum(CHECK.fill(generic, snap), "6").status, "auto");
});

test("a missing search query is partial and an empty search list is missing", function () {
  const partial = checklistFrom("prisma2020", "PRISMA 2020", [
    ["Methods", "7", "Search strategy", "Give the full strategy.", "search"]
  ]);
  const oneMissing = {
    searches: [
      { database: "PubMed", query: "BCG AND tuberculosis", lastSearchDate: "2024-01-15" },
      { database: "Europe PMC", lastSearchDate: "2024-01-16" }
    ]
  };
  const row = byNum(CHECK.fill(partial, oneMissing), "7");
  assert.equal(row.status, "partial");
  assert.ok(row.filled.indexOf("BCG AND tuberculosis") !== -1, row.filled);
  assert.ok((row.evidence || []).join(" ").indexOf("query not recorded") !== -1);
  const none = byNum(CHECK.fill(partial, { searches: [] }), "7");
  assert.equal(none.status, "missing");
  assert.equal(none.pointer, null);
});

test("empty snapshot leaves structured items missing and manual items open", function () {
  const filled = CHECK.fill(miniPrisma, emptySnap);
  ["1", "6", "7", "16a", "22"].forEach(function (num) {
    const row = byNum(filled, num);
    assert.equal(row.status, "missing", num);
    assert.equal(row.pointer, null, num);
  });
  const manual = byNum(filled, "M1");
  assert.equal(manual.status, "manual");
  assert.equal(manual.filled, "");
  assert.equal(filled.counts.missing, 5);
  assert.equal(filled.counts.manual, 1);
  assert.equal(filled.counts.total, 6);
});

test("mini fixture on the partial snapshot shows filled, partial, missing, and manual", function () {
  const filled = CHECK.fill(miniPrisma, readJson("snapshot-partial.json"));
  assert.equal(byNum(filled, "1").status, "auto");
  assert.equal(byNum(filled, "6").status, "auto");
  assert.equal(byNum(filled, "7").status, "partial");
  assert.ok(byNum(filled, "7").filled.indexOf("BCG AND tuberculosis") !== -1);
  assert.equal(byNum(filled, "16a").status, "auto");
  assert.ok(byNum(filled, "16a").filled.indexOf("Records identified") !== -1);
  assert.equal(byNum(filled, "22").status, "missing");
  assert.equal(byNum(filled, "M1").status, "manual");
});

test("manual text is copied and CSV quotes commas, quotes, and paragraph 0", function () {
  const snap = clone(reported);
  snap.manual = { M1: 'Age, site, and "school" cohort' };
  const filled = CHECK.fill(miniPrisma, snap);
  const manual = byNum(filled, "M1");
  assert.equal(manual.status, "manual");
  assert.equal(manual.filled, 'Age, site, and "school" cohort');
  const csv = CHECK.toCsv(filled);
  const lines = csv.split("\n");
  assert.equal(lines[0], "section,number,topic,status,item,filled,evidence,manuscript_section,paragraph");
  assert.ok(csv.indexOf('"Age, site, and ""school"" cohort"') !== -1, csv);
  const title = lines.filter(function (line) { return line.indexOf(",1,Title,") !== -1; })[0];
  assert.ok(title && title.indexOf(",Title,0") !== -1, title);
  const blank = CHECK.toCsv(CHECK.fill(miniPrisma, emptySnap));
  const missingTitle = blank.split("\n").filter(function (line) { return line.indexOf(",1,Title,") !== -1; })[0];
  assert.ok(/,,$/.test(missingTitle), missingTitle);
  assert.equal(blank.indexOf("\u2014"), -1);
});

test("item.number is accepted and a non-PRISMA item does not invent flow counts", function () {
  const filled = CHECK.fill(miniOther, { protocol: { question: "What is the effect of BCG?" } });
  const row = byNum(filled, "3");
  assert.equal(row.status, "auto");
  assert.equal(row.filled.indexOf("Records identified"), -1);
  const unknown = checklistFrom("custom", "Custom list", [
    ["Other", "9", "Mystery", "Describe it.", "nope"]
  ]);
  const miss = byNum(CHECK.fill(unknown, reported), "9");
  assert.equal(miss.status, "missing");
  assert.ok((miss.evidence || []).join(" ").indexOf("not mapped") !== -1);
});

test("discussion without the matching phrase stays partial and unpointed", function () {
  const checklist = checklistFrom("prisma2020", "PRISMA 2020", [
    ["Discussion", "23a", "Discussion of evidence", "Compare with other evidence.", "manuscript"]
  ]);
  const snap = { manuscript: { sections: [{ heading: "Discussion", paragraphs: ["We discuss the findings."] }] } };
  const row = byNum(CHECK.fill(checklist, snap), "23a");
  assert.equal(row.status, "partial");
  assert.equal(row.pointer, null);
});

test("fill rejects a checklist without sections and a non-object snapshot", function () {
  assert.throws(function () { CHECK.fill(null, {}); }, /checklist is required/);
  assert.throws(function () { CHECK.fill({}, {}); }, /checklist requires sections/);
  assert.throws(function () { CHECK.fill(miniPrisma, "nope"); }, /snapshot must be an object/);
  const filled = CHECK.fill(miniPrisma, null);
  assert.equal(filled.counts.total, 6);
  assert.equal(byNum(filled, "M1").status, "manual");
});
