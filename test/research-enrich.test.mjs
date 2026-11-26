/* ResearchMD Phase 1 enrichment: Crossref retraction parsing/cache, OpenAlex
 * batching/cache/key handling, the unavailable route contract, and the client
 * flag/states. No network: every connector test injects a fixture fetch and a
 * no-wait sleep.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-enrich.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as crossref from "../functions/api/research/_connectors/crossref.js";
import * as openalex from "../functions/api/research/_connectors/openalex.js";
import { enrichRetractionRoute, enrichOpenAlexRoute } from "../functions/api/research/_enrich.js";
import { createBucket } from "../functions/api/research/_connectors/_http.js";

const require = createRequire(import.meta.url);
const EMAIL = "support@example.com";
const KEY = "fake-openalex-key";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

function harness(responder) {
  const calls = [];
  return {
    calls,
    opts: {
      contactEmail: EMAIL,
      apiKey: KEY,
      bucket: createBucket(100000),
      sleep: async () => {},
      random: () => 0.5,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return responder(String(url), init, calls.length - 1);
      },
    },
  };
}

function fakeCache() {
  const map = new Map();
  return {
    async match(key) {
      const value = map.get(String(key));
      if (!value) return undefined;
      return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    },
    async put(key, res) {
      map.set(String(key), await res.json());
    },
  };
}

function routeApi(body) {
  const out = { calls: 0 };
  out.api = {
    bodyJson: async () => body,
    json: (payload, status, headers) => ({ payload, status, headers }),
    err: (status, code, message) => ({ error: { status, code, message } }),
  };
  return out.api;
}

/* ---- Crossref retractions ---------------------------------------------------- */

function crossrefResponder(items) {
  return (url) => {
    const u = new URL(url);
    assert.ok(u.pathname.endsWith("/works"));
    assert.equal(u.searchParams.get("mailto"), EMAIL);
    assert.ok((u.searchParams.get("filter") || "").includes("updates:"));
    return jsonResponse({ message: { items } });
  };
}

const NOTICES = [
  {
    DOI: "10.9000/notice-retraction",
    "update-to": [{ DOI: "10.1000/retracted", type: "retraction", updated: { "date-parts": [[2010, 2, 6]] } }],
  },
  {
    DOI: "10.9000/notice-eoc",
    "update-to": [{ DOI: "10.1000/concern", type: "expression_of_concern", updated: { "date-parts": [[2020, 1, 2]] } }],
  },
  {
    DOI: "10.9000/notice-correction",
    "update-to": [{ DOI: "10.1000/clean", type: "correction", updated: { "date-parts": [[2021, 3, 4]] } }],
  },
];

test("crossref: retracted, expression of concern and none parse from update-to", async () => {
  const h = harness(crossrefResponder(NOTICES));
  const map = await crossref.retractionsForDois(
    ["https://doi.org/10.1000/retracted", "10.1000/concern", "10.1000/clean"],
    h.opts);
  assert.deepEqual(map["10.1000/retracted"], {
    status: "retracted", date: "2010-02-06", noticeDoi: "10.9000/notice-retraction",
    source: "Crossref / Retraction Watch",
  });
  assert.deepEqual(map["10.1000/concern"], {
    status: "expression_of_concern", date: "2020-01-02", noticeDoi: "10.9000/notice-eoc",
    source: "Crossref / Retraction Watch",
  });
  assert.equal(map["10.1000/clean"].status, "none", "a correction is not a retraction");
  assert.equal(map["10.1000/clean"].noticeDoi, "");
  assert.equal(map["10.1000/clean"].source, "Crossref / Retraction Watch");
  assert.equal(h.calls.length, 1, "one batched request");
  const filter = new URL(h.calls[0].url).searchParams.get("filter");
  assert.equal(filter, "updates:10.1000/retracted,updates:10.1000/concern,updates:10.1000/clean");
});

test("crossref: a retraction outranks an expression of concern for the same DOI", async () => {
  const items = [
    { DOI: "10.9000/eoc", "update-to": [{ DOI: "10.1000/both", type: "expression_of_concern", updated: { "date-parts": [[2022, 1, 1]] } }] },
    { DOI: "10.9000/ret", "update-to": [{ DOI: "10.1000/both", type: "retraction", updated: { "date-parts": [[2020, 1, 1]] } }] },
  ];
  const h = harness(crossrefResponder(items));
  const r = await crossref.retractionForDoi("10.1000/both", h.opts);
  assert.equal(r.status, "retracted");
  assert.equal(r.noticeDoi, "10.9000/ret");
});

test("crossref: 24h cache means a second lookup makes no request", async () => {
  const cache = fakeCache();
  const h = harness(crossrefResponder(NOTICES));
  const opts = { ...h.opts, cache };
  const first = await crossref.retractionForDoi("10.1000/retracted", opts);
  const calls = h.calls.length;
  const second = await crossref.retractionForDoi("10.1000/retracted", opts);
  assert.deepEqual(second, first);
  assert.equal(h.calls.length, calls, "served from cache");
});

test("crossref: a network failure rejects, and the route reports unavailable", async () => {
  const down = harness(() => { throw new Error("offline"); });
  await assert.rejects(
    () => crossref.retractionForDoi("10.1000/retracted", down.opts),
    (e) => e && e.code === "search_failed");

  const api = routeApi({ doi: "10.1000/retracted" });
  const out = await enrichRetractionRoute({
    request: {}, env: { RESEARCH_CONTACT_EMAIL: EMAIL }, requestId: "r1",
    api, fetch: async () => { throw new Error("offline"); }, cache: null, sleep: async () => {},
  });
  assert.equal(out.status, 200);
  assert.equal(out.payload.available, false);
  assert.deepEqual(out.payload.retractions, {});
});

test("crossref route: a missing contact email is unavailable without any request", async () => {
  let called = 0;
  const api = routeApi({ doi: "10.1000/retracted" });
  const out = await enrichRetractionRoute({
    request: {}, env: {}, requestId: "r2", api,
    fetch: async () => { called++; return jsonResponse({}); },
  });
  assert.equal(out.payload.available, false);
  assert.equal(called, 0);
});

/* ---- OpenAlex ---------------------------------------------------------------- */

function work(doiValue, pmid, related) {
  const n = doiValue.replace(/[^a-z0-9]/gi, "");
  return {
    id: "https://openalex.org/W" + n,
    doi: "https://doi.org/" + doiValue,
    ids: pmid ? { pmid: "https://pubmed.ncbi.nlm.nih.gov/" + pmid } : {},
    title: "Work " + doiValue,
    publication_year: 2020,
    cited_by_count: 1234,
    open_access: { oa_status: "green", oa_url: "https://example.org/free.pdf" },
    best_oa_location: { pdf_url: "https://example.org/free.pdf" },
    related_works: related || [],
  };
}

function openAlexResponder(records, relatedRecords) {
  return (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get("api_key"), KEY);
    const filter = u.searchParams.get("filter") || "";
    if (filter.startsWith("openalex_id:")) {
      const ids = filter.slice("openalex_id:".length).split("|");
      return jsonResponse({ results: (relatedRecords || []).filter((r) => ids.includes(r.id.split("/").pop())) });
    }
    if (filter.startsWith("doi:")) {
      const dois = filter.slice(4).split("|").map((d) => d.toLowerCase());
      return jsonResponse({ results: records.filter((r) => dois.includes(String(r.doi).replace(/^https:\/\/doi.org\//, "").toLowerCase())) });
    }
    if (filter.startsWith("pmid:")) {
      const pmids = filter.slice(5).split("|");
      return jsonResponse({ results: records.filter((r) => pmids.includes(String(r.ids.pmid || "").split("/").pop())) });
    }
    throw new Error("unexpected filter " + filter);
  };
}

test("openalex: one request for N DOIs, fields normalised", async () => {
  const records = [work("10.1000/a", "111"), work("10.1000/b", "222")];
  const h = harness(openAlexResponder(records));
  const works = await openalex.lookupWorks({ dois: ["10.1000/a", "10.1000/b"] }, h.opts);
  assert.equal(h.calls.length, 1, "one batched DOI request");
  const filter = new URL(h.calls[0].url).searchParams.get("filter");
  assert.equal(filter, "doi:10.1000/a|10.1000/b");
  assert.equal(works.length, 2);
  const a = works.find((w) => w.doi === "10.1000/a");
  assert.equal(a.citedByCount, 1234);
  assert.equal(a.oaStatus, "green");
  assert.equal(a.bestOaUrl, "https://example.org/free.pdf");
  assert.equal(a.pmid, "111");
  assert.deepEqual(a.relatedWorks, []);
});

test("openalex: PMID path uses the pmid filter", async () => {
  const h = harness(openAlexResponder([work("10.1000/a", "33301246")]));
  const works = await openalex.lookupWorks({ pmids: ["33301246"] }, h.opts);
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].url).searchParams.get("filter"), "pmid:33301246");
  assert.equal(works[0].pmid, "33301246");
});

test("openalex: related works are expanded and capped at five", async () => {
  const ids = ["W1", "W2", "W3", "W4", "W5", "W6"];
  const records = [work("10.1000/a", "", ids.map((id) => "https://openalex.org/" + id))];
  const related = ids.map((id, i) => ({
    id: "https://openalex.org/" + id, doi: "https://doi.org/10.2000/r" + i,
    title: "Related " + id, publication_year: 2018 + i,
  }));
  const h = harness(openAlexResponder(records, related));
  const works = await openalex.lookupWorks({ dois: ["10.1000/a"] }, h.opts);
  assert.equal(h.calls.length, 2, "one DOI batch then one related batch");
  assert.equal(new URL(h.calls[1].url).searchParams.get("filter"), "openalex_id:W1|W2|W3|W4|W5|W6");
  assert.equal(works[0].relatedWorks.length, 5);
  assert.equal(works[0].relatedWorks[0].title, "Related W1");
  assert.equal(works[0].relatedWorks[0].doi, "10.2000/r0");
});

test("openalex: 7-day per-work cache means a second lookup makes no request", async () => {
  const cache = fakeCache();
  const h = harness(openAlexResponder([work("10.1000/a", "111")]));
  const opts = { ...h.opts, cache };
  await openalex.lookupWorks({ dois: ["10.1000/a"] }, opts);
  const calls = h.calls.length;
  const again = await openalex.lookupWorks({ dois: ["10.1000/a"] }, opts);
  assert.equal(h.calls.length, calls, "served from cache");
  assert.equal(again[0].citedByCount, 1234);
});

test("openalex route: missing key is unavailable and never reaches the network", async () => {
  let called = 0;
  const api = routeApi({ doi: "10.1000/a" });
  const out = await enrichOpenAlexRoute({
    request: {}, env: {}, requestId: "r3", api,
    fetch: async () => { called++; return jsonResponse({ results: [] }); },
  });
  assert.equal(out.status, 200);
  assert.equal(out.payload.available, false);
  assert.deepEqual(out.payload.works, []);
  assert.equal(called, 0);
});

test("openalex route: provider failure is unavailable, not an error banner", async () => {
  const api = routeApi({ doi: "10.1000/a" });
  const out = await enrichOpenAlexRoute({
    request: {}, env: { OPENALEX_API_KEY: KEY }, requestId: "r4", api,
    fetch: async () => { throw new Error("offline"); }, cache: null, sleep: async () => {},
  });
  assert.equal(out.status, 200);
  assert.equal(out.payload.available, false);
});

test("openalex route: success returns the OpenAlex credit and works", async () => {
  const h = harness(openAlexResponder([work("10.1000/a", "111")]));
  const api = routeApi({ doi: "10.1000/a" });
  const out = await enrichOpenAlexRoute({
    request: {}, env: { OPENALEX_API_KEY: KEY }, requestId: "r5", api,
    fetch: h.opts.fetch, cache: null,
  });
  assert.equal(out.status, 200);
  assert.equal(out.payload.available, true);
  assert.equal(out.payload.source, "OpenAlex");
  assert.equal(out.payload.works[0].citedByCount, 1234);
});

/* ---- Client: flags, rendering and hidden states ------------------------------ */

const store = {};
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; },
};
globalThis.SMD_RESEARCH = { api: null, screens: {} };
require("../research-screen-papercard.js");
require("../research-screen-studies.js");
const SMD = globalThis.SMD_RESEARCH;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function cardStub() {
  const badge = { innerHTML: "", parentNode: {} };
  const block = { innerHTML: "", parentNode: {} };
  return {
    badge, block,
    querySelector(selector) {
      if (selector === "[data-rmd-enrich-badge]") return badge;
      if (selector === "[data-rmd-enrich]") return block;
      return null;
    },
  };
}

const CARD = { doi: "10.1000/retracted", pmid: "111", title: "A study" };

test("client: both flags off means no request and no markup", async () => {
  store.smd_research_retraction = "0";
  store.smd_research_openalex = "0";
  const calls = [];
  SMD.api = { request: async (method, url, body) => { calls.push(url); return { available: true }; } };
  const el = cardStub();
  SMD.paperCard.enrich(el, CARD);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(el.badge.innerHTML, "");
  assert.equal(el.block.innerHTML, "");
});

test("client: flags on render the retraction badge, credits, cited-by and related works", async () => {
  store.smd_research_retraction = "1";
  store.smd_research_openalex = "1";
  const calls = [];
  SMD.api = {
    request: async (method, url, body) => {
      calls.push({ url, body });
      if (url === "/v1/enrich/retraction") {
        return {
          available: true,
          retraction: { status: "retracted", date: "2010-02-06", noticeDoi: "10.9000/notice", source: "Crossref / Retraction Watch" },
        };
      }
      return {
        available: true,
        works: [{
          doi: "10.1000/retracted", pmid: "111", citedByCount: 1234, oaStatus: "green",
          bestOaUrl: "https://example.org/free.pdf",
          relatedWorks: [{ id: "W9", title: "A related work", year: 2019, doi: "10.2000/r9" }],
        }],
      };
    },
  };
  const el = cardStub();
  SMD.paperCard.enrich(el, CARD);
  await flush();
  assert.equal(calls.length, 2);
  assert.match(el.badge.innerHTML, /Retracted/);
  assert.match(el.badge.innerHTML, /6 Feb 2010/);
  assert.match(el.badge.innerHTML, /10\.9000\/notice/);
  assert.match(el.badge.innerHTML, /Retraction data: Crossref \/ Retraction Watch/);
  assert.match(el.block.innerHTML, /Cited by/);
  assert.match(el.block.innerHTML, /1,234/);
  assert.match(el.block.innerHTML, /Green/);
  assert.match(el.block.innerHTML, /Read free copy/);
  assert.match(el.block.innerHTML, /A related work/);
  assert.match(el.block.innerHTML, /Data: OpenAlex/);
});

test("client: unavailable leaves both slots hidden", async () => {
  store.smd_research_retraction = "1";
  store.smd_research_openalex = "1";
  SMD.api = { request: async () => ({ available: false, retractions: {}, works: [] }) };
  const el = cardStub();
  SMD.paperCard.enrich(el, CARD);
  await flush();
  assert.equal(el.badge.innerHTML, "");
  assert.equal(el.block.innerHTML, "");
});

test("client: studies list shows a retraction badge on the row and credit in detail", async () => {
  store.smd_research_retraction = "1";
  SMD.api = {
    request: async () => ({
      available: true,
      retractions: { "10.1000/retracted": { status: "retracted", date: "2010-02-06", noticeDoi: "10.9000/notice" } },
    }),
  };
  const row = { innerHTML: "", getAttribute: () => "s1" };
  const detail = { innerHTML: "", getAttribute: () => "s1" };
  const container = { querySelectorAll: (sel) => (sel.indexOf("row") >= 0 ? [row] : [detail]) };
  SMD.screens.studies.hydrateRetractions(container, [{ id: "s1", locator: { doi: "10.1000/retracted" } }]);
  await flush();
  assert.match(row.innerHTML, /Retracted/);
  assert.match(row.innerHTML, /6 Feb 2010/);
  assert.match(detail.innerHTML, /Retraction data: Crossref \/ Retraction Watch/);
  assert.match(detail.innerHTML, /10\.9000\/notice/);
});

test("client: studies list with the flag off stays untouched", async () => {
  store.smd_research_retraction = "0";
  let calls = 0;
  SMD.api = { request: async () => { calls++; return { available: true }; } };
  const row = { innerHTML: "", getAttribute: () => "s1" };
  const detail = { innerHTML: "", getAttribute: () => "s1" };
  const container = { querySelectorAll: (sel) => (sel.indexOf("row") >= 0 ? [row] : [detail]) };
  SMD.screens.studies.hydrateRetractions(container, [{ id: "s1", locator: { doi: "10.1000/retracted" } }]);
  await flush();
  assert.equal(calls, 0);
  assert.equal(row.innerHTML, "");
  assert.equal(detail.innerHTML, "");
});