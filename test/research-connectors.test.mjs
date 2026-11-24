/* ResearchMD Phase 2.3 connectors: required params/headers from the 2.0b terms
 * report, cursor/retstart paging, normalise() contract shape, 429/5xx retry
 * with bounded exponential backoff, and the Semantic Scholar licence refusal.
 * No network: every test injects a fixture fetch, a recording sleep and a fast
 * token bucket.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-connectors.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as pubmed from "../functions/api/research/_connectors/pubmed.js";
import * as europepmc from "../functions/api/research/_connectors/europepmc.js";
import * as crossref from "../functions/api/research/_connectors/crossref.js";
import * as s2 from "../functions/api/research/_connectors/semanticscholar.js";
import { createBucket, backoffDelay, ConnectorError } from "../functions/api/research/_connectors/_http.js";

const EMAIL = "support@example.com";
function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}
/* Recording transport: no real waits, no real network, no shared bucket. */
function harness(responder) {
  const calls = [];
  const delays = [];
  return {
    calls, delays,
    opts: {
      contactEmail: EMAIL,
      apiKey: "unit-test-key",
      bucket: createBucket(10000),
      sleep: async (ms) => { delays.push(ms); },
      random: () => 0.5,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return responder(String(url), init, calls.length - 1);
      },
    },
  };
}

/* ---- PubMed ------------------------------------------------------------------ */

function pubmedResponder(count) {
  return (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("esummary.fcgi")) {
      const ids = u.searchParams.get("id").split(",");
      const result = { uids: ids };
      for (const id of ids) result[id] = { uid: id, title: "Paper " + id, authors: [{ name: "Smith J" }], pubdate: "2020 Jan" };
      return jsonResponse({ result });
    }
    if (u.searchParams.get("retmax") === "0")
      return jsonResponse({ header: { type: "esearch", version: "0.3" },
        esearchresult: { count: String(count), webenv: "WE", querykey: "1", querytranslation: "asthma[MeSH Terms]" } });
    const retstart = parseInt(u.searchParams.get("retstart") || "0", 10);
    const retmax = parseInt(u.searchParams.get("retmax"), 10);
    const idlist = [];
    for (let i = retstart; i < Math.min(retstart + retmax, count); i++) idlist.push(String(100000 + i));
    return jsonResponse({ esearchresult: { idlist } });
  };
}

test("pubmed: tool/email/api_key on every request, history paging, dateTo bound", async () => {
  const h = harness(pubmedResponder(1200));
  const out = await pubmed.search("asthma", { languages: ["english"] }, "2026-11-23", h.opts);
  assert.equal(out.totalCount, 1200);
  assert.equal(out.ids.length, 1200, "ids.length must equal totalCount");
  assert.equal(out.ids[0], "100000");
  assert.equal(out.ids[1199], "101199");
  assert.equal(out.metadata.apiVersion, "esearch-0.3");
  assert.ok(out.metadata.executedAt);
  assert.equal(out.metadata.queryEcho, "asthma[MeSH Terms]");
  const searches = h.calls.filter((c) => c.url.includes("esearch"));
  assert.equal(searches.length, 4, "head + 3 pages of 500");
  for (const c of h.calls) {
    const u = new URL(c.url);
    assert.equal(u.searchParams.get("tool"), "StewardMD_ResearchMD");
    assert.equal(u.searchParams.get("email"), EMAIL);
    assert.equal(u.searchParams.get("api_key"), "unit-test-key");
    assert.equal(u.searchParams.get("retmode"), "json");
    assert.ok(u.host === "eutils.ncbi.nlm.nih.gov");
  }
  const head = new URL(searches[0].url);
  assert.equal(head.searchParams.get("usehistory"), "y");
  assert.equal(head.searchParams.get("maxdate"), "2026/11/23");
  assert.equal(head.searchParams.get("datetype"), "crdt");
  assert.ok(head.searchParams.get("term").includes("english[Language]"));
  assert.ok(searches[1].url.includes("WebEnv=WE") && searches[1].url.includes("query_key=1"));
});

test("pubmed: short page fails the run, missing contact refuses, bad filters refuse", async () => {
  const short = harness((url) => {
    const u = new URL(url);
    if (u.searchParams.get("retmax") === "0")
      return jsonResponse({ esearchresult: { count: "10", webenv: "WE", querykey: "1" } });
    return jsonResponse({ esearchresult: { idlist: ["1", "2"] } });
  });
  await assert.rejects(() => pubmed.search("asthma", {}, null, short.opts),
    (e) => e instanceof ConnectorError && e.code === "search_failed");

  const noEmail = harness(pubmedResponder(1));
  delete noEmail.opts.contactEmail;
  await assert.rejects(() => pubmed.search("asthma", {}, null, noEmail.opts),
    (e) => e.code === "invalid_search" && /RESEARCH_CONTACT_EMAIL/.test(e.message));

  const badFilter = harness(pubmedResponder(1));
  await assert.rejects(() => pubmed.search("asthma", { species: ["humans"] }, null, badFilter.opts),
    (e) => e.code === "invalid_search");
  assert.equal(badFilter.calls.length, 0, "input errors never hit the network");
});

test("pubmed: 429 retries with jittered backoff, then search_rate_limited; 5xx then search_failed", async () => {
  let n = 0;
  const flaky = harness((url) => {
    n++;
    if (n === 1) return jsonResponse({ error: "slow down" }, 429);
    return pubmedResponder(1)(url);
  });
  const out = await pubmed.search("asthma", {}, null, flaky.opts);
  assert.equal(out.totalCount, 1);
  assert.equal(flaky.delays.length, 1);
  assert.ok(flaky.delays[0] >= 500 && flaky.delays[0] <= 1000, "first backoff ~1s with jitter, got " + flaky.delays[0]);

  const always429 = harness(() => jsonResponse({}, 429));
  await assert.rejects(() => pubmed.search("asthma", {}, null, always429.opts),
    (e) => e.code === "search_rate_limited");
  assert.equal(always429.calls.length, 6, "1 attempt + 5 retries");
  assert.equal(always429.delays.length, 5);
  assert.ok(always429.delays.every((d) => d <= 60000), "backoff capped at 60s");
  assert.ok(always429.delays[4] > always429.delays[0], "backoff grows");

  const always503 = harness(() => jsonResponse({}, 503));
  await assert.rejects(() => pubmed.search("asthma", {}, null, always503.opts),
    (e) => e.code === "search_failed");
  assert.equal(always503.calls.length, 6);

  const retryAfter = harness((url, init, i) => {
    if (i === 0) return jsonResponse({}, 429, { "retry-after": "3" });
    return pubmedResponder(1)(url);
  });
  await pubmed.search("asthma", {}, null, retryAfter.opts);
  assert.ok(retryAfter.delays[0] >= 3000, "Retry-After is a floor");
});

test("pubmed: normalise maps an esummary record to the contract shape", () => {
  const rec = pubmed.normalise({
    uid: "12345678", title: "A trial of X", authors: [{ name: "Smith JA" }, { name: "Jones B" }],
    pubdate: "2020 Mar 15", elocationid: "doi: 10.1000/x.2020", source: "NLM", volume: "12",
  });
  assert.equal(rec.source, "pubmed");
  assert.equal(rec.externalId, "12345678");
  assert.equal(rec.title, "A trial of X");
  assert.deepEqual(rec.authors, ["Smith JA", "Jones B"]);
  assert.equal(rec.year, 2020);
  assert.equal(rec.doi, "10.1000/x.2020");
  assert.equal(rec.extra.volume, "12", "extra keeps native leftovers");
  assert.throws(() => pubmed.normalise({ title: "no uid" }), (e) => e.code === "invalid_search");
  const noYear = pubmed.normalise({ uid: "1", title: "", pubdate: "in press" });
  assert.equal(noYear.title, "", "title falls back to empty string, never null");
  assert.equal(noYear.year, null);
});

test("pubmed: peak-hours rule (terms rule 4)", () => {
  /* November 2026: ET = UTC-5. Mon 15:00 ET peak; Mon 22:00 ET off; Sun noon off. */
  assert.equal(pubmed.isPeakHours(Date.parse("2026-11-23T20:00:00Z")), true);
  assert.equal(pubmed.isPeakHours(Date.parse("2026-11-24T03:00:00Z")), false);
  assert.equal(pubmed.isPeakHours(Date.parse("2026-11-22T17:00:00Z")), false);
});

/* ---- Europe PMC ---------------------------------------------------------------- */

test("europepmc: polite User-Agent, json/lite/cursorMark paging, normalise", async () => {
  const h = harness((url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get("format"), "json");
    if (u.searchParams.get("resultType") === "core") {
      return jsonResponse({ resultList: [
        { id: "111", source: "MED", pmid: "111", doi: "10.1000/a", title: "A", pubYear: "2020",
          authorList: { author: [{ lastName: "Smith", initials: "JA" }] }, license: "cc by" },
        { id: "PMC222", source: "PMC", pmcid: "PMC222", title: "B", pubYear: "2021", authorString: "Jones B, Lee C" },
      ] });
    }
    assert.equal(u.searchParams.get("resultType"), "lite");
    assert.ok(Number(u.searchParams.get("pageSize")) <= 1000);
    const cursor = u.searchParams.get("cursorMark");
    if (cursor === "*")
      return jsonResponse({ hitCount: 3, nextCursorMark: "c2", resultList: [{ id: "111", source: "MED" }, { id: "PMC222", source: "PMC" }] });
    assert.equal(cursor, "c2");
    return jsonResponse({ hitCount: 3, nextCursorMark: "c3", resultList: [{ id: "333", source: "AGR" }] });
  });
  const out = await europepmc.search("asthma", {}, "2026-11-23", h.opts);
  assert.deepEqual(out.ids, ["MED:111", "PMC:PMC222", "AGR:333"]);
  assert.equal(out.totalCount, 3);
  for (const c of h.calls) {
    const ua = c.init.headers["User-Agent"];
    assert.match(ua, /StewardMD-ResearchMD\/1\.0/);
    assert.ok(ua.includes("mailto:" + EMAIL), "descriptive UA with maintainer contact");
  }
  const first = new URL(h.calls[0].url);
  assert.ok(first.searchParams.get("query").includes("FIRST_PDATE:[* TO 2026-11-23]"), "dateTo binds the query");

  const raws = await europepmc.fetchRecords(out.ids.slice(0, 2), h.opts);
  const a = europepmc.normalise(raws[0]);
  assert.equal(a.source, "europe_pmc");
  assert.equal(a.externalId, "111", "PMID preferred as the dedup key");
  assert.deepEqual(a.authors, ["Smith JA"]);
  assert.equal(a.extra.license, "cc by", "licence kept for the Phase 3 full-text gate");
  const b = europepmc.normalise(raws[1]);
  assert.equal(b.externalId, "PMC222");
  assert.deepEqual(b.authors, ["Jones B", "Lee C"]);
  assert.throws(() => europepmc.normalise({}), (e) => e.code === "invalid_search");
});

test("europepmc: short cursor page fails the run", async () => {
  const h = harness(() => jsonResponse({ hitCount: 50, nextCursorMark: "same", resultList: [{ id: "1", source: "MED" }] }));
  await assert.rejects(() => europepmc.search("asthma", {}, null, h.opts), (e) => e.code === "search_failed");
});

/* ---- Crossref -------------------------------------------------------------------- */

test("crossref: mailto param + polite UA, select minimisation, cursor deep paging, rate headers", async () => {
  const itemA = { DOI: "10.1000/a", title: ["A"], author: [{ family: "Smith", given: "JA" }], published: { "date-parts": [[2020, 3]] } };
  const itemB = { DOI: "10.1000/b", title: ["B"], author: [{ name: "Jones B" }], published: { "date-parts": [[2021]] } };
  const h = harness((url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get("mailto"), EMAIL, "polite pool fail-safe");
    assert.equal(u.searchParams.get("select"), "DOI,title,author,published,abstract,URL,container-title");
    assert.ok(Number(u.searchParams.get("rows")) <= 1000);
    if ((u.searchParams.get("filter") || "").startsWith("doi:"))
      return jsonResponse({ message: { "total-results": 2, items: [itemA, itemB] } });
    const cursor = u.searchParams.get("cursor");
    const items = cursor === "*" ? [itemA] : [itemB];
    return jsonResponse({ message: { "total-results": 2, items, "next-cursor": cursor === "*" ? "c2" : undefined } },
      200, { "x-rate-limit-limit": "10", "x-rate-limit-interval": "1s", "x-concurrency-limit": "3", "x-api-pool": "polite" });
  });
  const out = await crossref.search("asthma", { type: "journal-article" }, "2026-11-23", h.opts);
  assert.deepEqual(out.ids, ["10.1000/a", "10.1000/b"]);
  assert.equal(out.totalCount, 2);
  assert.equal(out.rateHeaders["x-api-pool"], "polite");
  for (const c of h.calls) assert.match(c.init.headers["User-Agent"], /mailto:support@example\.com/);
  const first = new URL(h.calls[0].url);
  assert.equal(first.searchParams.get("cursor"), "*");
  const filter = first.searchParams.get("filter");
  assert.ok(filter.includes("until-pub-date:2026-11-23"));
  assert.ok(filter.includes("type:journal-article"));
  assert.equal(new URL(h.calls[1].url).searchParams.get("cursor"), "c2");

  const raws = await crossref.fetchRecords(out.ids, h.opts);
  const a = crossref.normalise(raws[0]);
  assert.equal(a.source, "crossref");
  assert.equal(a.externalId, "10.1000/a");
  assert.deepEqual(a.authors, ["Smith JA"]);
  assert.equal(a.year, 2020);
  assert.equal(a.title, "A");
  assert.equal(crossref.normalise(raws[1]).authors[0], "Jones B");
  assert.throws(() => crossref.normalise({ title: ["no doi"] }), (e) => e.code === "invalid_search");
});

test("crossref: 429 backoff then search_rate_limited; unknown filter refuses before any request", async () => {
  const h = harness(() => jsonResponse({}, 429));
  await assert.rejects(() => crossref.search("asthma", {}, null, h.opts), (e) => e.code === "search_rate_limited");
  assert.equal(h.calls.length, 6);
  const bad = harness(() => jsonResponse({ message: { "total-results": 0, items: [] } }));
  await assert.rejects(() => crossref.search("asthma", { license: "cc by" }, null, bad.opts), (e) => e.code === "invalid_search");
  assert.equal(bad.calls.length, 0);
});

/* ---- Semantic Scholar: licence refusal ---------------------------------------------- */

test("semantic scholar: stub refuses commercial use, never calls the network", async () => {
  const h = harness(() => jsonResponse({ total: 0, data: [] }));
  assert.equal(s2.enabled, false);
  await assert.rejects(() => s2.search("asthma", {}, null, h.opts), (e) => {
    assert.equal(e.code, "invalid_search");
    assert.match(e.message, /commercial/i);
    assert.match(e.message, /AI2|Expanded Commercial License/);
    return true;
  });
  await assert.rejects(() => s2.fetchRecords(["x"], h.opts), (e) => e.code === "invalid_search");
  assert.equal(h.calls.length, 0, "the stub must not query S2 under the standard licence");
});

/* ---- Shared transport ---------------------------------------------------------------- */

test("backoff: 1s doubling with jitter, 60s cap; bucket spaces requests", async () => {
  assert.equal(backoffDelay(0, () => 0.5), 750);
  assert.equal(backoffDelay(1, () => 0.5), 1500);
  assert.equal(backoffDelay(2, () => 0.5), 3000);
  assert.ok(backoffDelay(20, () => 0.99) <= 60000);
  assert.equal(backoffDelay(0, () => 0, 5000), 5000, "Retry-After floor wins");

  let clock = 0;
  const waits = [];
  const bucket = createBucket(2); /* 2 req/s */
  const sleep = async (ms) => { waits.push(ms); clock += ms; };
  const now = () => clock;
  for (let i = 0; i < 4; i++) await bucket.acquire(now, sleep);
  assert.ok(waits.length >= 1, "a 2/s bucket must pause the 3rd and 4th acquire");
  assert.ok(waits.every((w) => w > 0));
});