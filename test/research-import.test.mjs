/* ResearchMD Phase 2.4 import parsers: RIS, BibTeX and CSV -> the contract
 * record shape, deterministic output, stable identifier-less externalIds,
 * clear refusals on malformed input. No network, no D1.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-import.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRIS, parseBibTeX, parseCSV, parseImport } from "../functions/api/research/_connectors/import.js";

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

test("identifier-less keys are stable across parses and distinct across entries", () => {
  const one = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2020\nER  - ");
  const two = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2020\nER  - ");
  assert.equal(one[0].externalId, two[0].externalId, "re-importing the same entry hits the same key");
  const other = parseRIS("TY  - JOUR\nTI  - Same Title\nAU  - Smith, J\nPY  - 2021\nER  - ");
  assert.notEqual(one[0].externalId, other[0].externalId, "a different year is a different entry");
});