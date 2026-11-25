/* ResearchMD Phase 2.4 import parsers: RIS, BibTeX and CSV -> the contract
 * record shape, deterministic output, stable identifier-less externalIds,
 * clear refusals on malformed input. No network, no D1.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-import.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRIS, parseBibTeX, parseCSV, parseCSL, parseEndNoteXML, parseNBIB, parseImport, matchesExistingRecord } from "../functions/api/research/_connectors/import.js";

const RIS = [
  "TY  - JOUR",
  "TI  - Aspirin and outcomes: a trial",
  "AU  - Smith, John A",
  "AU  - Doe, Jane",
  "PY  - 2020",
  "DO  - 10.1000/ris.1",
  "JO  - Test Journal",
  "VL  - 12",
  "IS  - 3",
  "SP  - 100",
  "EP  - 110",
  "AB  - An abstract.",
  "ER  - ",
  "TY  - JOUR",
  "TI  - No identifier entry",
  "AU  - Lee, K",
  "Y1  - 2019",
  "ER  - ",
  "",
].join("\r\n");

const BIBTEX = [
  "@article{smith2021,",
  "  title = {Beta {Blockers} and Risk},",
  "  author = {Brown, Alice and Green, Bob},",
  "  year = {2021},",
  "  doi = {10.1000/bib.1},",
  "  journal = {J Tests},",
  "  volume = {7},",
  "  pages = {1--9}",
  "}",
  "@misc{noId,",
  "  title = {Grey literature},",
  "  author = {White, C},",
  "  year = {2018}",
  "}",
].join("\n");

const CSV = [
  "title,authors,year,doi,journal",
  '"Alpha, beta and gamma","Smith J; Jones A",2020,10.1000/csv.1,"J, Tests"',
  '"Plain title","Solo B",2019,,',
].join("\n");

test("RIS: entries, authors, year, DOI, extra tags; identifier-less entry gets a stable key", () => {
  const entries = parseRIS(RIS);
  assert.equal(entries.length, 2);
  const a = entries[0];
  assert.equal(a.source, "import:ris");
  assert.equal(a.externalId, "10.1000/ris.1");
  assert.equal(a.title, "Aspirin and outcomes: a trial");
  assert.deepEqual(a.authors, ["Smith John A", "Doe Jane"]);
  assert.equal(a.year, 2020);
  assert.equal(a.doi, "10.1000/ris.1");
  assert.equal(a.extra.tags.JO[0], "Test Journal", "native tags kept for audit");
  const b = entries[1];
  assert.equal(b.year, 2019, "Y1 is a year tag too");
  assert.match(b.externalId, /^t[0-9a-f]{8}$/, "no DOI/PMID: stable title-hash key");
  assert.deepEqual(parseRIS(RIS), entries, "deterministic");
});

test("BibTeX: brace stripping, 'and' author lists, field extraction", () => {
  const entries = parseBibTeX(BIBTEX);
  assert.equal(entries.length, 2);
  const a = entries[0];
  assert.equal(a.source, "import:bibtex");
  assert.equal(a.title, "Beta Blockers and Risk", "inner braces stripped");
  assert.deepEqual(a.authors, ["Brown Alice", "Green Bob"]);
  assert.equal(a.year, 2021);
  assert.equal(a.externalId, "10.1000/bib.1");
  assert.equal(a.extra.type, "article");
  assert.equal(a.extra.key, "smith2021");
  const b = entries[1];
  assert.equal(b.title, "Grey literature");
  assert.match(b.externalId, /^t[0-9a-f]{8}$/);
  assert.deepEqual(parseBibTeX(BIBTEX), entries, "deterministic");
});

test("CSV: quoted commas, semicolon author lists, missing DOI", () => {
  const entries = parseCSV(CSV);
  assert.equal(entries.length, 2);
  const a = entries[0];
  assert.equal(a.source, "import:csv");
  assert.equal(a.title, "Alpha, beta and gamma", "quoted comma preserved");
  assert.deepEqual(a.authors, ["Smith J", "Jones A"]);
  assert.equal(a.year, 2020);
  assert.equal(a.externalId, "10.1000/csv.1");
  assert.equal(a.extra.row.journal, "J, Tests");
  const b = entries[1];
  assert.equal(b.doi, "");
  assert.match(b.externalId, /^t[0-9a-f]{8}$/);
  assert.deepEqual(parseCSV(CSV), entries, "deterministic");
});

test("CSV: tab and semicolon delimiters, flexible headers", () => {
  const tabbed = "Title\tAuthor\tYear\tDOI\nTab study\tSmith J\t2020\t10.1000/tab";
  const t = parseCSV(tabbed);
  assert.equal(t[0].title, "Tab study");
  assert.equal(t[0].externalId, "10.1000/tab");
  const semis = "title;author;year;doi\nSemi study;Jones B;2021;10.1000/semi";
  assert.equal(parseCSV(semis)[0].title, "Semi study");
});

test("parsers: contract guarantees and clear refusals", () => {
  for (const entries of [parseRIS(RIS), parseBibTeX(BIBTEX), parseCSV(CSV)]) {
    for (const e of entries) {
      assert.ok(e.externalId, "externalId never empty");
      assert.equal(typeof e.title, "string", "title is a string, never null");
      assert.ok(Array.isArray(e.authors));
      assert.ok(e.year === null || Number.isInteger(e.year));
      assert.equal(typeof e.doi, "string");
      assert.ok(e.extra && typeof e.extra === "object");
    }
  }
  assert.throws(() => parseRIS("just some text"), (e) => e.code === "invalid_search");
  assert.throws(() => parseBibTeX("no entries here"), (e) => e.code === "invalid_search");
  assert.throws(() => parseCSV("title"), (e) => e.code === "invalid_search", "header without rows");
  assert.throws(() => parseCSV("a,b\n1,2"), (e) => e.code === "invalid_search", "no title/doi/pmid column");
  assert.throws(() => parseImport("xlsx", "x"), (e) => e.code === "invalid_search");
  assert.throws(() => parseRIS("TY  - JOUR\nER  - "), (e) => e.code === "invalid_search", "entry with no title/DOI/PMID");
  assert.equal(parseImport("ris", RIS).length, 2);
  assert.equal(parseImport("bibtex", BIBTEX).length, 2);
  assert.equal(parseImport("csv", CSV).length, 2);
});

const CSL = JSON.stringify([
  {
    id: "smith2020",
    type: "article-journal",
    title: "Synthetic aspirin cohort",
    author: [{ family: "Smith", given: "John" }, { family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020]] },
    DOI: "https://doi.org/10.1000/csl.1",
    PMID: "33445566",
    "container-title": "Test Journal",
    volume: "4",
    page: "10-18",
    abstract: "A synthetic abstract about a made up cohort.",
  },
]);

const ENDNOTE = [
  "<xml><records>",
  "<record>",
  "<rec-number>1</rec-number>",
  "<titles><title>Synthetic endnote trial</title></titles>",
  "<authors><author>Smith, John</author><author>Doe, Jane</author></authors>",
  "<dates><year>2020</year></dates>",
  "<electronic-resource-num>10.1000/en.1</electronic-resource-num>",
  "<secondary-title>Test Journal</secondary-title>",
  "<volume>4</volume><number>2</number><pages>10-18</pages>",
  "<abstract>A synthetic abstract.</abstract>",
  "</record>",
  "</records></xml>",
].join("");

const NBIB = [
  "PMID- 99887766",
  "TI  - Synthetic nbib cohort",
  "FAU - Doe, Jane Q",
  "FAU - Lee, Ken",
  "AU  - Doe JQ",
  "DP  - 2019 Mar",
  "JT  - Test Journal",
  "VI  - 3",
  "IP  - 1",
  "PG  - 10-18",
  "LID - 10.1000/nbib.1 [doi]",
  "AB  - A synthetic abstract about a made up cohort.",
  "",
].join("\n");

test("CSL-JSON: Zotero array, Mendeley items wrapper, DOI and PMID", () => {
  const entries = parseCSL(CSL);
  assert.equal(entries.length, 1);
  const a = entries[0];
  assert.equal(a.source, "import:csl-json");
  assert.equal(a.title, "Synthetic aspirin cohort");
  assert.deepEqual(a.authors, ["Smith John", "Doe Jane"]);
  assert.equal(a.year, 2020);
  assert.equal(a.doi, "10.1000/csl.1");
  assert.equal(a.externalId, "10.1000/csl.1");
  assert.equal(a.extra.pmid, "33445566");
  assert.equal(a.extra.containerTitle, "Test Journal");
  assert.equal(a.extra.key, "smith2020");
  const wrapped = JSON.stringify({ items: JSON.parse(CSL) });
  assert.deepEqual(parseCSL(wrapped), entries);
  assert.deepEqual(parseCSL(JSON.stringify(JSON.parse(CSL)[0])), entries);
  assert.equal(parseImport("csl-json", CSL).length, 1);
  assert.equal(parseImport("json", CSL)[0].source, "import:csl-json");
  assert.equal(parseImport("csl", CSL)[0].externalId, "10.1000/csl.1");
  assert.throws(() => parseCSL("not json"), (e) => e.code === "invalid_search");
  assert.throws(() => parseCSL("[]"), (e) => e.code === "invalid_search");
});

test("EndNote XML: record, authors, DOI, year", () => {
  const entries = parseEndNoteXML(ENDNOTE);
  assert.equal(entries.length, 1);
  const a = entries[0];
  assert.equal(a.source, "import:endnote-xml");
  assert.equal(a.title, "Synthetic endnote trial");
  assert.deepEqual(a.authors, ["Smith John", "Doe Jane"]);
  assert.equal(a.year, 2020);
  assert.equal(a.doi, "10.1000/en.1");
  assert.equal(a.externalId, "10.1000/en.1");
  assert.equal(a.extra.journal, "Test Journal");
  assert.equal(a.extra.volume, "4");
  assert.equal(parseImport("endnote-xml", ENDNOTE).length, 1);
  assert.equal(parseImport("xml", ENDNOTE)[0].source, "import:endnote-xml");
  assert.equal(parseImport("endnote", ENDNOTE)[0].title, "Synthetic endnote trial");
  assert.throws(() => parseEndNoteXML("<xml></xml>"), (e) => e.code === "invalid_search");
});

test("NBIB: PMID, FAU authors, DOI in LID, continuation lines", () => {
  const continued = NBIB.replace("A synthetic abstract about a made up cohort.", "A synthetic abstract\n      about a made up cohort.");
  const entries = parseNBIB(continued);
  assert.equal(entries.length, 1);
  const a = entries[0];
  assert.equal(a.source, "import:nbib");
  assert.equal(a.title, "Synthetic nbib cohort");
  assert.deepEqual(a.authors, ["Doe Jane Q", "Lee Ken"]);
  assert.equal(a.year, 2019);
  assert.equal(a.doi, "10.1000/nbib.1");
  assert.equal(a.externalId, "10.1000/nbib.1");
  assert.equal(a.extra.pmid, "99887766");
  assert.ok(a.extra.abstract.includes("made up cohort"));
  assert.equal(parseImport("nbib", NBIB).length, 1);
  assert.equal(parseImport("medline", NBIB)[0].source, "import:nbib");
  assert.throws(() => parseNBIB("not a medline file"), (e) => e.code === "invalid_search");
});

test("matchesExistingRecord: DOI, PMID and title against records already in the project", () => {
  const csl = parseCSL(CSL)[0];
  const byDoi = matchesExistingRecord([
    { id: "rec_old", source: "crossref", externalId: "10.1000/csl.1", title: "Other title", authors: ["Other A"], year: 1999, doi: "HTTPS://doi.org/10.1000/CSL.1" },
  ], csl);
  assert.equal(byDoi, "rec_old");

  const pmidOnly = parseNBIB("PMID- 99887766\nTI  - Synthetic pmid paper\nFAU - Patel, R\nDP  - 2018\n")[0];
  assert.equal(pmidOnly.externalId, "99887766");
  assert.equal(pmidOnly.doi, "");
  const byPmid = matchesExistingRecord([
    { id: "rec_pm", source: "pubmed", externalId: "99887766", title: "Different title", authors: ["Other A"], year: 2001, doi: "" },
  ], pmidOnly);
  assert.equal(byPmid, "rec_pm");

  const byTitle = matchesExistingRecord([
    { id: "rec_title", source: "import:ris", externalId: "t00000000", title: "Synthetic endnote trial", authors: ["Smith John"], year: 2020, doi: "" },
  ], parseEndNoteXML(ENDNOTE.replace("10.1000/en.1", ""))[0]);
  assert.equal(byTitle, "rec_title");
  assert.equal(matchesExistingRecord([
    { id: "rec_other", source: "pubmed", externalId: "1", title: "Unrelated", authors: ["Zed Q"], year: 2011, doi: "10.1000/nope" },
  ], csl), "");
});

test("identifier-less keys are stable across parses and distinct across entries", () => {
  const one = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2020\nER  - ");
  const two = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2020\nER  - ");
  assert.equal(one[0].externalId, two[0].externalId, "re-importing the same entry hits the same key");
  const other = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2021\nER  - ");
  assert.notEqual(one[0].externalId, other[0].externalId, "a different year is a different entry");
});