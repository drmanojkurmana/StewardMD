import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 1 free APIs:
 * - Step 1.1: NCBI key fallback (RESEARCH_NCBI_API_KEY -> NCBI_API_KEY -> none)
 *   and 10 req/s keyed vs 3 req/s unkeyed bucket selection + api_key URL param.
 * - Step 1.3: ClinicalTrials.gov API v2 connector, caching, 5xx -> unavailable,
 *   gateway switch (RESEARCH_TRIALS_ENABLED=1), and project route auth.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-trials.test.mjs
 */
import { test, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-bob": { sub: "u-bob", email: "bob@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};

const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
  },
});

const pubmed = await import("../functions/api/research/_connectors/pubmed.js");
const efetch = await import("../functions/api/research/_connectors/pubmed_efetch.js");
const ct = await import("../functions/api/research/_connectors/clinicaltrials.js");
const gateway = await import("../functions/api/research/_gateway.js");
const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const MIGRATION_0003 = readFileSync(new URL("../docs/research/contracts/phase-3/0003_research_v3.sql", import.meta.url), "utf8");

function jsonRes(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function xmlRes(xml, status = 200) {
  return new Response(xml, { status, headers: { "content-type": "application/xml" } });
}

/* Hand-written fixture matching the ClinicalTrials.gov API v2 /studies shape,
 * including extra sections (contactsLocationsModule, sponsorCollaboratorsModule)
 * that normalise() MUST drop. */
const CT_STUDY_FIXTURE = {
  protocolSection: {
    identificationModule: {
      nctId: "NCT04280705",
      briefTitle: "Adaptive COVID-19 Treatment Trial (ACTT-1)",
      officialTitle: "A Multicenter, Adaptive, Randomized Blinded Controlled Trial",
      organization: { fullName: "NIAID", class: "NIH" },
    },
    statusModule: {
      overallStatus: "COMPLETED",
      startDateStruct: { date: "2020-02-21", type: "ACTUAL" },
    },
    sponsorCollaboratorsModule: {
      leadSponsor: { name: "National Institute of Allergy and Infectious Diseases", class: "NIH" },
    },
    designModule: {
      studyType: "INTERVENTIONAL",
      phases: ["PHASE3"],
      enrollmentInfo: { count: 1062, type: "ACTUAL" },
    },
    armsInterventionsModule: {
      armGroups: [
        { label: "Remdesivir", type: "EXPERIMENTAL", description: "200 mg IV loading dose then 100 mg IV daily" },
        { label: "Placebo", type: "PLACEBO_COMPARATOR", description: "Matching IV placebo daily" },
      ],
      interventions: [
        { type: "DRUG", name: "Remdesivir" },
      ],
    },
    outcomesModule: {
      primaryOutcomes: [
        { measure: "Time to recovery", description: "Day of first clinical improvement", timeFrame: "Day 1 through Day 29" },
      ],
      secondaryOutcomes: [
        { measure: "Mortality at Day 28", timeFrame: "Day 28" },
      ],
    },
    contactsLocationsModule: {
      centralContacts: [{ name: "Trial Contact", email: "private-contact@example.org", phone: "555-0100" }],
    },
  },
  hasResults: true,
};

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

function freshEnv(extra = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  D._db.exec(MIGRATION_0003);
  return {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "unit-callback-secret",
    ...extra,
  };
}

async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const req = new Request("https://stewardmd.in/api/research/" + path, {
    method,
    headers,
    ...(payload !== undefined ? { body: payload } : {}),
  });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

/* ---- Step 1.1: NCBI key fallback -------------------------------------------- */

describe("Step 1.1: NCBI API key fallback and bucket selection", () => {
  test("resolveNcbiApiKey prefers RESEARCH_NCBI_API_KEY, falls back to NCBI_API_KEY, trims whitespace", () => {
    assert.equal(pubmed.resolveNcbiApiKey({ env: { RESEARCH_NCBI_API_KEY: "k_primary", NCBI_API_KEY: "k_fallback" } }), "k_primary");
    assert.equal(pubmed.resolveNcbiApiKey({ env: { RESEARCH_NCBI_API_KEY: "   ", NCBI_API_KEY: " k_fallback " } }), "k_fallback");
    assert.equal(pubmed.resolveNcbiApiKey({ env: { NCBI_API_KEY: "k_fallback" } }), "k_fallback");
    assert.equal(pubmed.resolveNcbiApiKey({ RESEARCH_NCBI_API_KEY: "", NCBI_API_KEY: "k_direct" }), "k_direct");
    assert.equal(pubmed.resolveNcbiApiKey({ env: { RESEARCH_NCBI_API_KEY: "  ", NCBI_API_KEY: "\t" } }), "");
    assert.equal(pubmed.resolveNcbiApiKey({}), "");
  });

  test("bucket selection uses 10 req/s only when a non-empty key is present, 3 req/s otherwise", () => {
    assert.equal(pubmed.selectBucket({ env: { RESEARCH_NCBI_API_KEY: "k1" } }).ratePerSec, 10);
    assert.equal(pubmed.selectBucket({ env: { NCBI_API_KEY: "k2" } }).ratePerSec, 10);
    assert.equal(pubmed.selectBucket({ env: { RESEARCH_NCBI_API_KEY: "   ", NCBI_API_KEY: "" } }).ratePerSec, 3);
    assert.equal(pubmed.selectBucket({}).ratePerSec, 3);

    assert.equal(efetch.selectBucket({ env: { RESEARCH_NCBI_API_KEY: "k1" } }).ratePerSec, 10);
    assert.equal(efetch.selectBucket({ env: { NCBI_API_KEY: "k2" } }).ratePerSec, 10);
    assert.equal(efetch.selectBucket({ env: {} }).ratePerSec, 3);
    assert.equal(efetch.selectBucket({ apiKey: "   " }).ratePerSec, 3);
  });

  test("pubmed.search and efetchAbstracts attach api_key for both env names, omit when absent, and pace unkeyed vs keyed buckets", async () => {
    const seenUrls = [];
    const mockFetch = async (url) => {
      const u = String(url);
      seenUrls.push(u);
      const parsed = new URL(u);
      if (u.includes("esummary.fcgi")) {
        return jsonRes({ result: { uids: ["101"], "101": { uid: "101", title: "T", pubdate: "2024" } } });
      }
      if (u.includes("efetch.fcgi")) {
        return xmlRes("<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>101</PMID><Article><ArticleTitle>T</ArticleTitle><Abstract><AbstractText>Abs</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>");
      }
      if (parsed.searchParams.get("retmax") === "0") {
        return jsonRes({ header: { version: "0.3" }, esearchresult: { count: "1", webenv: "W", querykey: "1" } });
      }
      return jsonRes({ esearchresult: { idlist: ["101"] } });
    };

    /* 1. RESEARCH_NCBI_API_KEY */
    /* Past clock: a future one leaves the shared module buckets ahead of real time and later real-clock tests wait forever. */
    let clock = Date.now() - 1e9;
    const sleepsA = [];
    await pubmed.search("asthma", {}, null, {
      contactEmail: "support@example.com",
      env: { RESEARCH_NCBI_API_KEY: "key_research" },
      fetch: mockFetch,
      now: () => clock,
      sleep: async (ms) => { sleepsA.push(ms); clock += ms; },
    });
    assert.equal(new URL(seenUrls[0]).searchParams.get("api_key"), "key_research");

    /* 2. Fallback NCBI_API_KEY */
    seenUrls.length = 0;
    await pubmed.search("asthma", {}, null, {
      contactEmail: "support@example.com",
      env: { NCBI_API_KEY: "key_ncbi" },
      fetch: mockFetch,
      now: () => clock,
      sleep: async (ms) => { sleepsA.push(ms); clock += ms; },
    });
    assert.equal(new URL(seenUrls[0]).searchParams.get("api_key"), "key_ncbi");

    await efetch.efetchAbstracts(["101"], {
      contactEmail: "support@example.com",
      env: { NCBI_API_KEY: "key_efetch" },
      fetch: mockFetch,
      now: () => clock,
      sleep: async (ms) => { sleepsA.push(ms); clock += ms; },
    });
    assert.equal(new URL(seenUrls[seenUrls.length - 1]).searchParams.get("api_key"), "key_efetch");

    /* 3. No key: api_key omitted AND 3 req/s bucket throttles 4th rapid request */
    seenUrls.length = 0;
    const unkeyedSleeps = [];
    clock += 10000; /* refill module-level bucket completely */
    for (let i = 0; i < 2; i++) {
      await pubmed.search("asthma", {}, null, {
        contactEmail: "support@example.com",
        env: { RESEARCH_NCBI_API_KEY: "  ", NCBI_API_KEY: "" },
        fetch: mockFetch,
        now: () => clock,
        sleep: async (ms) => { unkeyedSleeps.push(ms); clock += ms; },
      });
    }
    /* 2 searches * 2 requests = 4 requests at same instant -> 3/s bucket must pause >= 1 time */
    assert.ok(unkeyedSleeps.length >= 1, "expected 3 req/s bucket to throttle 4th request");
    for (const u of seenUrls) {
      assert.equal(new URL(u).searchParams.has("api_key"), false, "no api_key param when unkeyed");
    }

    await efetch.efetchAbstracts(["101"], {
      contactEmail: "support@example.com",
      env: {},
      fetch: mockFetch,
      now: () => clock + 10000,
      sleep: async () => {},
    });
    assert.equal(new URL(seenUrls[seenUrls.length - 1]).searchParams.has("api_key"), false);
  });

  test("[[path]].js search run and _gateway.js literatureSearchRoute honour NCBI_API_KEY fallback", { skip: SKIP }, async (t) => {
    const env = freshEnv({ NCBI_API_KEY: "fallback_gateway_key" });
    const p = await call(env, "POST", "v1/projects", "tok-alice", { title: "NCBI fallback" });
    assert.equal(p.http, 201);

    const fetched = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      const u = String(url);
      fetched.push(u);
      const parsed = new URL(u);
      if (u.includes("esummary.fcgi")) {
        return jsonRes({ result: { uids: ["55"], "55": { uid: "55", title: "Paper 55", pubdate: "2024" } } });
      }
      if (u.includes("efetch.fcgi")) {
        return xmlRes("<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>55</PMID><Article><ArticleTitle>Paper 55</ArticleTitle><Abstract><AbstractText>Body</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>");
      }
      if (parsed.searchParams.get("retmax") === "0") {
        return jsonRes({ header: { version: "0.3" }, esearchresult: { count: "1", webenv: "WE", querykey: "1" } });
      }
      return jsonRes({ esearchresult: { idlist: ["55"] } });
    });

    const sr = await call(env, "POST", "v1/projects/" + p.project.id + "/searches", "tok-alice", {
      database: "pubmed",
      query: "asthma",
    });
    assert.equal(sr.http, 201, JSON.stringify(sr));
    assert.ok(fetched.length >= 2);
    for (const u of fetched) {
      assert.equal(new URL(u).searchParams.get("api_key"), "fallback_gateway_key");
    }

    /* Gateway literatureSearchRoute */
    fetched.length = 0;
    const jobId = "job_ncbi_fb";
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?,?,?,?,?,?)"
    ).run(jobId, p.project.id, "pdf_extract", "running", "idem_ncbi", "u-alice", Date.now());
    const bodyRaw = JSON.stringify({ jobId, projectId: p.project.id, query: "asthma", databases: ["pubmed"], limit: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", env.RESEARCH_CALLBACK_SECRET).update(ts + "." + bodyRaw).digest("hex");
    const req = new Request("https://stewardmd.in/api/research/v1/internal/literature-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Research-Timestamp": ts, "X-Research-Signature": sig },
      body: bodyRaw,
    });
    const gwRes = await onRequest({ request: req, env, params: { path: ["v1", "internal", "literature-search"] } });
    assert.equal(gwRes.status, 200);
    assert.ok(fetched.length >= 3);
    for (const u of fetched) {
      assert.equal(new URL(u).searchParams.get("api_key"), "fallback_gateway_key");
    }
  });
});

/* ---- Step 1.3: ClinicalTrials.gov API v2 connector -------------------------- */

describe("Step 1.3: ClinicalTrials.gov v2 connector", () => {
  test("normalise extracts strictly the 9 kept fields and drops contacts/extras", () => {
    const norm = ct.normalise(CT_STUDY_FIXTURE);
    assert.deepEqual(Object.keys(norm).sort(), [
      "arms", "enrollment", "nct", "phase", "primaryOutcome", "resultsPosted", "source", "status", "title",
    ]);
    assert.equal(norm.nct, "NCT04280705");
    assert.equal(norm.title, "Adaptive COVID-19 Treatment Trial (ACTT-1)");
    assert.equal(norm.phase, "PHASE3");
    assert.equal(norm.status, "COMPLETED");
    assert.equal(norm.enrollment, 1062);
    assert.deepEqual(norm.arms, [
      { label: "Remdesivir", type: "EXPERIMENTAL", description: "200 mg IV loading dose then 100 mg IV daily" },
      { label: "Placebo", type: "PLACEBO_COMPARATOR", description: "Matching IV placebo daily" },
    ]);
    assert.deepEqual(norm.primaryOutcome, [
      { measure: "Time to recovery", timeFrame: "Day 1 through Day 29" },
    ]);
    assert.equal(norm.resultsPosted, true);
    assert.equal(norm.source, "ClinicalTrials.gov");
    assert.equal(JSON.stringify(norm).includes("private-contact@example.org"), false);
  });

  test("NCT validation rejects malformed IDs before hitting network", async () => {
    let called = 0;
    const fetchSpy = async () => { called++; return jsonRes(CT_STUDY_FIXTURE); };
    for (const bad of ["", "NCT123", "nct04280705", "NCT042807059", "12345678", "NCT1234ABCD"]) {
      await assert.rejects(
        () => ct.lookup(bad, { fetch: fetchSpy }),
        (e) => e.code === "invalid_search"
      );
    }
    assert.equal(called, 0);
  });

  test("search maps condition, intervention, status, phase (filter.advanced), pageSize, pageToken", async () => {
    ct.clearCache();
    const urls = [];
    const out = await ct.search(
      {
        condition: "COVID-19",
        intervention: "Remdesivir",
        phase: ["PHASE2", "PHASE3"],
        status: "COMPLETED",
        pageSize: 15,
        pageToken: "tok_next_1",
      },
      {
        fetch: async (url) => {
          urls.push(String(url));
          return jsonRes({ studies: [CT_STUDY_FIXTURE], nextPageToken: "tok_next_2", totalCount: 42 });
        },
        bucket: { acquire: async () => {} },
      }
    );
    assert.equal(urls.length, 1);
    const u = new URL(urls[0]);
    assert.equal(u.origin + u.pathname, "https://clinicaltrials.gov/api/v2/studies");
    assert.equal(u.searchParams.get("query.cond"), "COVID-19");
    assert.equal(u.searchParams.get("query.intr"), "Remdesivir");
    assert.equal(u.searchParams.get("filter.overallStatus"), "COMPLETED");
    assert.equal(u.searchParams.get("filter.advanced"), "AREA[Phase](PHASE2 OR PHASE3)");
    assert.equal(u.searchParams.get("pageSize"), "15");
    assert.equal(u.searchParams.get("pageToken"), "tok_next_1");
    assert.equal(out.available, true);
    assert.equal(out.studies.length, 1);
    assert.equal(out.studies[0].nct, "NCT04280705");
    assert.equal(out.nextPageToken, "tok_next_2");
    assert.equal(out.totalCount, 42);
    assert.equal(out.source, "ClinicalTrials.gov");
  });

  test("cache hit on second call avoids network (both Cache API and memory fallback)", async () => {
    ct.clearCache();
    const store = new Map();
    const cacheShim = {
      async match(req) { return store.has(req.url) ? store.get(req.url).clone() : undefined; },
      async put(req, res) { store.set(req.url, res); },
    };
    let fetchCount = 0;
    const opts = {
      cache: cacheShim,
      bucket: { acquire: async () => {} },
      fetch: async () => { fetchCount++; return jsonRes(CT_STUDY_FIXTURE); },
    };
    const first = await ct.lookup("NCT04280705", opts);
    const second = await ct.lookup("NCT04280705", opts);
    assert.equal(fetchCount, 1);
    assert.deepEqual(second, first);

    /* Also test search cache hit with fallback memory cache */
    ct.clearCache();
    let searchCount = 0;
    const memOpts = {
      bucket: { acquire: async () => {} },
      fetch: async () => { searchCount++; return jsonRes({ studies: [CT_STUDY_FIXTURE], totalCount: 1 }); },
    };
    await ct.search({ condition: "asthma", phase: "PHASE3" }, memOpts);
    await ct.search({ phase: "PHASE3", condition: "asthma" }, memOpts);
    assert.equal(searchCount, 1);
  });

  test("5xx -> unavailable and never cached", async () => {
    ct.clearCache();
    let calls = 0;
    const opts = {
      sleep: async () => {},
      random: () => 0.5,
      maxRetries: 1,
      bucket: { acquire: async () => {} },
      fetch: async () => {
        calls++;
        if (calls <= 2) return jsonRes({ error: "down" }, 503);
        return jsonRes(CT_STUDY_FIXTURE);
      },
    };
    const down = await ct.lookup("NCT04280705", opts);
    assert.equal(down.available, false);
    assert.equal(down.reason, "unavailable");
    assert.equal(down.trial, null);
    assert.equal(down.source, "ClinicalTrials.gov");

    /* Subsequent call after recovery succeeds (was not poisoned in cache) */
    const up = await ct.lookup("NCT04280705", opts);
    assert.equal(up.available, true);
    assert.equal(up.trial.nct, "NCT04280705");

    /* Search 5xx -> unavailable */
    const sDown = await ct.search({ condition: "asthma" }, {
      sleep: async () => {},
      random: () => 0.5,
      maxRetries: 1,
      bucket: { acquire: async () => {} },
      fetch: async () => jsonRes({}, 502),
    });
    assert.equal(sDown.available, false);
    assert.equal(sDown.reason, "unavailable");
    assert.deepEqual(sDown.studies, []);
  });

  test("rate bucket enforces <= 50 req/min", () => {
    assert.ok(ct.selectBucket().ratePerSec <= 50 / 60 + 1e-9);
  });

  test("a bucket slower than 1 req/s still lets requests through (no infinite wait)", async () => {
    const { createBucket } = await import("../functions/api/research/_connectors/_http.js");
    const b = createBucket(50 / 60);
    let clock = 0;
    const sleeps = [];
    const sleep = async (ms) => { sleeps.push(ms); clock += ms; };
    await b.acquire(() => clock, sleep);
    assert.equal(sleeps.length, 0, "first request is immediate");
    await b.acquire(() => clock, sleep);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 1100 && sleeps[0] <= 1300, "second waits about 1.2 s, got " + sleeps[0]);
  });
});

/* ---- Step 1.3: Gateway switch & Routes ------------------------------------- */

describe("Step 1.3: Gateway switch and API routes", () => {
  test("gateway switch RESEARCH_TRIALS_ENABLED off vs on", { skip: SKIP }, async (t) => {
    assert.equal(gateway.trialsEnabled({}), false);
    assert.equal(gateway.trialsEnabled({ RESEARCH_TRIALS_ENABLED: "0" }), false);
    assert.equal(gateway.trialsEnabled({ RESEARCH_TRIALS_ENABLED: "1" }), true);
    assert.equal(Boolean(gateway.searchDatabases({}).clinicaltrials), false);
    assert.equal(Boolean(gateway.searchDatabases({ RESEARCH_TRIALS_ENABLED: "1" }).clinicaltrials), true);

    const envOff = freshEnv();
    const p = await call(envOff, "POST", "v1/projects", "tok-alice", { title: "GW Trials" });
    const jobId = "job_ct_1";
    envOff.RESEARCH_DB._db.prepare(
      "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?,?,?,?,?,?)"
    ).run(jobId, p.project.id, "pdf_extract", "running", "idem_ct", "u-alice", Date.now());

    const gwSend = async (env, databases) => {
      const raw = JSON.stringify({ jobId, projectId: p.project.id, query: "covid", databases, limit: 2 });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", env.RESEARCH_CALLBACK_SECRET).update(ts + "." + raw).digest("hex");
      const req = new Request("https://stewardmd.in/api/research/v1/internal/literature-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Research-Timestamp": ts, "X-Research-Signature": sig },
        body: raw,
      });
      const res = await onRequest({ request: req, env, params: { path: ["v1", "internal", "literature-search"] } });
      return { http: res.status, ...(await res.json()) };
    };

    const offRes = await gwSend(envOff, ["clinicaltrials"]);
    assert.equal(offRes.http, 404);
    assert.equal(offRes.error.code, "not_found");

    ct.clearCache();
    t.mock.method(globalThis, "fetch", async () => jsonRes({ studies: [CT_STUDY_FIXTURE], totalCount: 1 }));
    const envOn = Object.assign({}, envOff, { RESEARCH_TRIALS_ENABLED: "1" });
    const onRes = await gwSend(envOn, ["clinicaltrials"]);
    assert.equal(onRes.http, 200);
    assert.equal(onRes.records.length, 1);
    assert.equal(onRes.records[0].source, "clinicaltrials");
    assert.equal(onRes.records[0].externalId, "NCT04280705");
  });

  test("project routes enforce Firebase auth, membership isolation, server switch, and clean unavailable", { skip: SKIP }, async (t) => {
    ct.clearCache();
    const envOff = freshEnv();
    const p = await call(envOff, "POST", "v1/projects", "tok-alice", { title: "Trials Project" });
    const pid = p.project.id;
    await call(envOff, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });

    /* Unauthenticated -> 401 */
    assert.equal((await call(envOff, "GET", "v1/projects/" + pid + "/trials", null)).http, 401);
    assert.equal((await call(envOff, "POST", "v1/projects/" + pid + "/trials/search", null, { condition: "asthma" })).http, 401);
    assert.equal((await call(envOff, "GET", "v1/projects/" + pid + "/trials/NCT04280705", null)).http, 401);

    /* Disabled switch -> 404 not_found for member */
    const statusOff = await call(envOff, "GET", "v1/projects/" + pid + "/trials", "tok-alice");
    assert.equal(statusOff.http, 404);
    assert.equal(statusOff.error.code, "not_found");
    assert.equal((await call(envOff, "POST", "v1/projects/" + pid + "/trials/search", "tok-alice", { condition: "asthma" })).http, 404);
    assert.equal((await call(envOff, "GET", "v1/projects/" + pid + "/trials/NCT04280705", "tok-alice")).http, 404);

    /* Enabled switch */
    const envOn = Object.assign({}, envOff, { RESEARCH_TRIALS_ENABLED: "1" });
    /* Outsider -> 404 project_not_found */
    const outsider = await call(envOn, "GET", "v1/projects/" + pid + "/trials", "tok-eve");
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
    assert.equal((await call(envOn, "POST", "v1/projects/" + pid + "/trials/search", "tok-eve", { condition: "asthma" })).http, 404);

    /* Viewer role CAN read trials */
    const statusOn = await call(envOn, "GET", "v1/projects/" + pid + "/trials", "tok-bob");
    assert.equal(statusOn.http, 200);
    assert.equal(statusOn.available, true);

    /* PHI blocked before network */
    let netCalls = 0;
    let mode = "ok";
    t.mock.method(globalThis, "fetch", async (url) => {
      netCalls++;
      if (mode === "down") return jsonRes({}, 503);
      if (String(url).endsWith("/studies/NCT04280705")) return jsonRes(CT_STUDY_FIXTURE);
      if (String(url).endsWith("/studies/NCT99999999")) return jsonRes({ message: "not found" }, 404);
      return jsonRes({ studies: [CT_STUDY_FIXTURE], totalCount: 1 });
    });

    const phiRes = await call(envOn, "POST", "v1/projects/" + pid + "/trials/search", "tok-alice", {
      condition: "patient MRN 12345",
    });
    assert.equal(phiRes.http, 400);
    assert.equal(phiRes.error.code, "phi_in_query");
    assert.equal(netCalls, 0);

    const searchRes = await call(envOn, "POST", "v1/projects/" + pid + "/trials/search", "tok-bob", {
      condition: "COVID-19",
      phase: "PHASE3",
    });
    assert.equal(searchRes.http, 200);
    assert.equal(searchRes.available, true);
    assert.equal(searchRes.studies.length, 1);
    assert.equal(searchRes.studies[0].nct, "NCT04280705");

    const lookupRes = await call(envOn, "GET", "v1/projects/" + pid + "/trials/NCT04280705", "tok-alice");
    assert.equal(lookupRes.http, 200);
    assert.equal(lookupRes.available, true);
    assert.equal(lookupRes.trial.nct, "NCT04280705");

    const notFoundNct = await call(envOn, "GET", "v1/projects/" + pid + "/trials/NCT99999999", "tok-alice");
    assert.equal(notFoundNct.http, 404);
    assert.equal(notFoundNct.error.code, "trial_not_found");

    const badNct = await call(envOn, "GET", "v1/projects/" + pid + "/trials/bad", "tok-alice");
    assert.equal(badNct.http, 400);
    assert.equal(badNct.error.code, "invalid_search");

    /* Upstream 5xx -> clean 200 { available: false } */
    ct.clearCache();
    mode = "down";
    const downRes = await call(envOn, "POST", "v1/projects/" + pid + "/trials/search", "tok-alice", {
      condition: "diabetes",
    });
    assert.equal(downRes.http, 200);
    assert.equal(downRes.available, false);
    assert.equal(downRes.reason, "unavailable");
  });
});
