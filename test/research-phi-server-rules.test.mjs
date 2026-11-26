/* ResearchMD server PHI rules (functions/api/research/_phi.js) and the T1
 * suggestion gate (_suggest.js).
 *
 * Covers the rules added to scan() and its phi.py twin:
 *   phone/indian_mobile_spaced, abha (address, 2-4-4-4 number, labelled
 *   unbroken), dates/full_date (user mode only), address/house_locality.
 * Plus the route proof that extraction and screening suggestions keep the
 * published-literature exemption (publicLiterature), so a day-level date in a
 * paper abstract or PDF passes while user-typed text stays strict.
 *
 * Synthetic data only. No em or en dashes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-server-rules.test.mjs
 */
import "./helpers/json-import-attr.mjs";
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});

const llm = { calls: [], impl: async () => "mock answer" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { scan } = await import("../functions/api/research/_phi.js");
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
    batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
  };
}
function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value) { objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { text: async () => text, json: async () => JSON.parse(text), body: text };
    },
    async delete(key) { objects.delete(key); },
    async head(key) { return objects.has(key) ? { key } : null; },
  };
}
function kvShim() {
  const m = new Map();
  return {
    _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
  };
}
function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return {
    RESEARCH_MODE: "pilot", RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
    RESEARCH_R2: r2Shim(),
  };
}
function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}
async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function makeProject(env, token) {
  const r = await call(env, "POST", "v1/projects", token, { title: "PHI rules" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
const LOC = { kind: "manual", citation: "Synthetic 2024", page: "1", quote: "supporting text" };
async function makeStudy(env, pid, token) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/studies", token,
    { measure: "RR", inputs: { events1: 4, n1: 123, events2: 11, n2: 139 }, locator: LOC, quote: "supporting text", label: "Study" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.study;
}
function seedArtifact(env, pid, pagesText) {
  const db = env.RESEARCH_DB._db;
  const now = Date.now();
  const sha = "c".repeat(64);
  const pdfId = "pdf_seed_" + pid;
  const jobId = "job_seed_" + pid;
  const artId = "art_seed_" + pid;
  const r2Key = "projects/" + pid + "/pdf/" + sha + ".pdf";
  db.prepare("INSERT OR IGNORE INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,?,?,?,?)")
    .run(pdfId, pid, sha, r2Key, 1000, "u-alice", now);
  const resultKey = "projects/" + pid + "/jobs/" + jobId + "/result.json";
  const result = { jobId, idempotencyKey: "k", status: "done", usage: { pages: pagesText.length, seconds: 1 },
    ocr: false, sha256: sha, pages: pagesText.map((t, i) => ({ n: i + 1, width: 612, height: 792, ocr: false, text: t, words: [], tables: [] })) };
  env.RESEARCH_R2._objects.set(resultKey, JSON.stringify(result));
  db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,result_r2_key,usage_json,created_by,created_ts,completed_ts) VALUES (?,?, 'pdf_extract','succeeded',?,?,?,?,?,?,?)")
    .run(jobId, pid, "seed:" + pid, r2Key, resultKey, JSON.stringify({ pages: pagesText.length, seconds: 1 }), "u-alice", now, now);
  db.prepare("INSERT INTO research_extraction_artifacts (id,project_id,pdf_id,filename,sha256,bytes,pages,job_id,status,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?, 'succeeded',?,?)")
    .run(artId, pid, pdfId, "synthetic.pdf", sha, 1000, pagesText.length, jobId, "u-alice", now);
  return { artId };
}
function resetLlm(impl) {
  llm.calls.length = 0;
  llm.impl = impl || (async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) {
      opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 };
      opts.meta.model = opts.model;
    }
    return "{}";
  });
}

/* ---- scan() rules ---------------------------------------------------------- */

describe("scan: new deterministic rules", () => {
  test("spaced Indian mobile blocks with prefix, 0 prefix and hyphen", () => {
    for (const text of ["Call 98765 43210", "+91 98765 43210", "Mobile 098765 43210", "Mobile 98765-43210"]) {
      const r = scan(text);
      assert.equal(r.blocked, true, "must block: " + text);
      assert.ok(r.hits.some((h) => h.category === "phone"), "phone category: " + text);
    }
  });

  test("spaced and unspaced mobile are not double reported", () => {
    const r = scan("Mobile 9876543210");
    assert.equal(r.hits.filter((h) => h.category === "phone").length, 1, "one phone hit");
  });

  test("DOI suffix and PMID stay clean", () => {
    for (const text of ["doi:10.1016/j.jhep.2023.01.012", "PMID: 31234567", "DOI 10.1234/6123456789"]) {
      assert.equal(scan(text).blocked, false, "must pass: " + text);
    }
  });

  test("ABHA address, 2-4-4-4 number and labelled unbroken number block", () => {
    const cases = [
      ["ABHA address: ramesh.kumar@abdm", "abha"],
      ["name@sbx", "abha"],
      ["ABHA 12-3456-7890-1234", "abha"],
      ["14 5678 9012 3456", "abha"],
      ["ABHA No 12345678901234", "abha"],
    ];
    for (const [text, category] of cases) {
      const r = scan(text);
      assert.equal(r.blocked, true, "must block: " + text);
      assert.ok(r.hits.some((h) => h.category === category), category + ": " + text);
    }
  });

  test("user mode: any day-level date blocks; default mode allows published dates", () => {
    for (const text of ["Reviewed on 12/03/2021", "Follow-up 2024-03-12", "Surgery on 12 March 2024", "Summary March 12, 2024"]) {
      const r = scan(text, { mode: "user" });
      assert.equal(r.blocked, true, "must block in user mode: " + text);
      assert.ok(r.hits.some((h) => h.category === "dates"), "dates category: " + text);
    }
    for (const text of ["enrolled Jan 2023 to Mar 2024", "between January 2018 and March 2020", "Published 2023"]) {
      assert.equal(scan(text).blocked, false, "must pass: " + text);
      assert.equal(scan(text, { mode: "user" }).blocked, false, "must still pass in user mode: " + text);
    }
    for (const text of ["published 2023-01-15", "between 1 January 2015 and 31 December 2019"]) {
      assert.equal(scan(text).blocked, false, "published date passes default mode: " + text);
      const r = scan(text, { mode: "user" });
      assert.equal(r.blocked, true, "same text blocks in user mode: " + text);
      assert.ok(r.hits.some((h) => h.category === "dates"), "dates category: " + text);
    }
  });

  test("house label plus number blocks only when a locality follows", () => {
    for (const text of ["H.No 12-3-45, Ameerpet", "House No. 221B, Banjara Hills", "#14, 2nd Cross, Indiranagar",
      "Flat 302, Sai Residency", "Door No 5-9-22, Himayatnagar", "D.No 7-1-88, Ameerpet"]) {
      const r = scan(text);
      assert.equal(r.blocked, true, "must block: " + text);
      assert.ok(r.hits.some((h) => h.category === "address"), "address category: " + text);
    }
  });

  test("bare house labels and lowercase flat stay allowed", () => {
    for (const text of ["Table #14 shows", "the #1 cause of death", "a flat 20 mg dose",
      "flat 10% reduction", "Flat 5 patients"]) {
      const r = scan(text);
      assert.equal(r.blocked, false, "must pass: " + text + " hits " + JSON.stringify(r.hits));
    }
  });

  test("required false positives stay allowed", () => {
    const allow = [
      "doi:10.1016/j.jhep.2023.01.012", "PMID: 31234567", "Na 138 mmol/L", "n = 1234",
      "95% CI 1.12-2.34", "enrolled Jan 2023 to Mar 2024", "p = 0.0412",
      "ISRCTN12345678", "NCT01234567", "CTRI/2020/01/023456",
    ];
    for (const text of allow) {
      const r = scan(text);
      assert.equal(r.blocked, false, "must pass: " + text + " hits " + JSON.stringify(r.hits));
    }
  });

  test("hits carry categories only, never the matched text", () => {
    const r = scan("Call 98765 43210, ABHA 12-3456-7890-1234, reviewed on 12/03/2021, H.No 12-3-45");
    assert.equal(r.blocked, true);
    for (const h of r.hits) assert.deepEqual(Object.keys(h).sort(), ["category", "end", "rule", "start"]);
  });
});

/* ---- suggestion routes: published literature keeps the exemption ---------- */

describe("suggestions: published literature keeps the default exemption", () => {
  test("screening suggestion with a phone in the abstract reaches the provider (literature skip)", { skip: SKIP }, async () => {
    resetLlm(async (env, parts, maxTokens, opts) => {
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 80, candidatesTokenCount: 40, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return JSON.stringify({ decision: "include", reasonCode: "", rationale: "Published trial abstract." });
    });
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env, "tok-alice");
    const now = Date.now();
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,'pubmed','9001','Asthma trial','[]',2024,'',?,?)"
    ).run("rec_phi", project.id, JSON.stringify({ abstract: "Adults with asthma. Call 98765 43210 for the data." }), now);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/records/rec_phi/screening-suggestions", "tok-alice");
    assert.equal(r.http, 201, JSON.stringify(r));
    assert.equal(r.suggestion.decision, "include");
    assert.equal(llm.calls.length, 1, "published abstract reaches the provider once");
    const audit = env.RESEARCH_DB._db.prepare(
      "SELECT * FROM research_audit_events WHERE event_type='phi_gate_skipped_public_literature'"
    ).get();
    assert.ok(audit, "phi_gate_skipped_public_literature audit event written");
  });

  test("screening suggestion with a clean abstract still succeeds", { skip: SKIP }, async () => {
    resetLlm(async (env, parts, maxTokens, opts) => {
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 80, candidatesTokenCount: 40, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return JSON.stringify({ decision: "include", reasonCode: "", rationale: "Randomised trial in adults." });
    });
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env, "tok-alice");
    const now = Date.now();
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,'pubmed','9002','Asthma trial','[]',2024,'',?,?)"
    ).run("rec_ok", project.id, JSON.stringify({ abstract: "Adults with asthma randomised to inhaled corticosteroids or placebo." }), now);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/records/rec_ok/screening-suggestions", "tok-alice");
    assert.equal(r.http, 201, JSON.stringify(r));
    assert.equal(r.suggestion.decision, "include");
    assert.equal(r.suggestion.status, "unverified");
    assert.equal(llm.calls.length, 1, "clean abstract reaches the provider once");
  });

  test("extraction suggestion with a phone and a date in the PDF text reaches the provider (literature skip)", { skip: SKIP }, async () => {
    resetLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env, "tok-alice");
    const study = await makeStudy(env, project.id, "tok-alice");
    const seed = seedArtifact(env, project.id, ["Contact 98765 43210 for the trial data, published 2023-01-15."]);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/studies/" + study.id + "/extraction/suggestions",
      "tok-alice", { artifactId: seed.artId, template: "rct_binary" });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1, "published PDF reaches the provider once");
    const audit = env.RESEARCH_DB._db.prepare(
      "SELECT * FROM research_audit_events WHERE event_type='phi_gate_skipped_public_literature'"
    ).get();
    assert.ok(audit, "phi_gate_skipped_public_literature audit event written");
  });
});
