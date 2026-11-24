import "./helpers/json-import-attr.mjs";
/* ResearchMD Ask MaiK case report drafts and publication consent.
 * SQLite D1 mock and a mocked provider.
 * No em or en dashes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-ai-draft-casereport.test.mjs
 */
import { test, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-bob": { sub: "u-bob", email: "bob@example.com", email_verified: true },
};

const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});

const llm = { calls: [], impl: async () => "{}" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 60, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { TASKS } = await import("../functions/api/research/_ai_draft.js");
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
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
  };
}

function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}

function resetLlm(impl) {
  llm.calls.length = 0;
  llm.impl = impl || (async () => "{}");
}

async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path, {
    method,
    headers,
    ...(payload !== undefined ? { body: payload } : {}),
  });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

async function makeProject(env, studyType = "case_report") {
  const r = await call(env, "POST", "v1/projects", "tok-alice", {
    title: "A rare presentation of adult onset Still disease",
    studyType,
    researchQuestion: "Clinical features and outcome of a rare adult onset Still disease presentation.",
  });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}

async function setRole(env, pid, uid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid, role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}

describe("case report AI drafts and consent", { concurrency: false, skip: SKIP }, () => {
  test("both tasks registered in TASKS", () => {
    assert.ok(TASKS.includes("publication_consent"), "publication_consent is registered");
    assert.ok(TASKS.includes("case_report_draft"), "case_report_draft is registered");
  });

  test("consent output has every required element in both languages", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env);

    const consentSample = {
      english: "PATIENT CONSENT FOR PUBLICATION\n\n" +
        "1. What will be published: Clinical details, history, and clinical images.\n" +
        "2. Reach: The article may be published in a medical journal and read worldwide online.\n" +
        "3. Anonymity: My name will not be published. However, complete anonymity cannot be guaranteed.\n" +
        "4. Withdrawal: I can withdraw consent at any time before publication.\n" +
        "5. Medical care: My medical care and treatment will not be affected in any way.\n" +
        "6. List of images: Pre-treatment and post-treatment rash photographs.\n" +
        "7. Signature block: Patient Signature / Thumb impression: ________ Date: ________\n" +
        "8. Next of kin / representative: Representative Signature: ________ Relationship: ________\n" +
        "9. Witness Signature: ________ Date: ________\n\n" +
        "Note: Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal's instructions.",
      local: "ప్రచురణ కొరకు రోగి సమ్మతి పత్రం (Telugu)\n\n" +
        "1. ప్రచురించబడే వివరాలు: వైద్య వివరాలు మరియు చిత్రాలు.\n" +
        "2. పఠనం: ప్రపంచవ్యాప్తంగా ఆన్ లైన్ లో చదవవచ్చు.\n" +
        "3. గోప్యత: పేరు ప్రచురించబడదు.\n" +
        "4. ఉపసంహరణ: ప్రచురణకు ముందు ఎప్పుడైనా సమ్మతిని ఉపసంహరించుకోవచ్చు.\n" +
        "5. వైద్య సంరక్షణ: వైద్య చికిత్సపై ఎలాంటి ప్రభావం ఉండదు.\n" +
        "6. చిత్రాల జాబితా: చికిత్సకు ముందు మరియు తరువాత ఫోటోలు.\n" +
        "7. సంతకం: రోగి సంతకం: ________ తేదీ: ________\n" +
        "8. ప్రతినిధి సంతకం: ________\n" +
        "9. సాక్షి సంతకం: ________\n\n" +
        "గమనిక: సమర్పించడానికి ముందు రోగి లేదా బంధువుల సంతకం తీసుకోండి.",
      languageName: "Telugu"
    };

    resetLlm(async () => JSON.stringify(consentSample));

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "publication_consent",
      input: { language: "Telugu", includesImages: true, journalName: "BMJ Case Reports" }
    });

    assert.equal(res.http, 200, JSON.stringify(res));
    assert.equal(res.draft.task, "publication_consent");
    assert.equal(res.draft.status, "unverified");
    assert.equal(res.draft.languageName, "Telugu");
    assert.ok(res.draft.english.includes("PATIENT CONSENT FOR PUBLICATION"));
    assert.ok(res.draft.english.includes("What will be published"));
    assert.ok(res.draft.english.includes("medical care and treatment will not be affected"));
    assert.ok(res.draft.english.includes("withdraw consent"));
    assert.ok(res.draft.english.includes("Signature"));
    assert.ok(res.draft.english.includes("Next of kin"));
    assert.ok(res.draft.english.includes("Some journals insist on their own form"));
    assert.ok(res.draft.local.length > 50, "local language version provided");

    // Check system prompt instruction coverage
    const callSystem = llm.calls[0].opts.system;
    assert.ok(callSystem.includes("COPE and ICMJE"));
    assert.ok(callSystem.includes("What will be published"));
    assert.ok(callSystem.includes("worldwide including online access"));
    assert.ok(callSystem.includes("withdraw consent at any time"));
    assert.ok(callSystem.includes("Medical care and treatment will not be affected"));
    assert.ok(callSystem.includes("Signature or thumb impression with witness"));
    assert.ok(callSystem.includes("Next of kin or legally acceptable representative option"));
    assert.ok(callSystem.includes("Some journals insist on their own form"));
  });

  test("draft parsed to the contract shape for case_report_draft", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env);

    const crSections = {
      sections: {
        title: "Adult onset Still disease presenting with acute liver dysfunction",
        abstract: "A 45-year-old female presented with high grade spiking fevers, evanescent salmon-pink rash, and arthralgia.",
        introduction: "Adult onset Still disease is a rare systemic autoinflammatory disorder of unknown etiology.",
        casePresentation: "Day 1: Patient presented with 39 C fever and joint pain. Day 3: Liver enzymes elevated with ferritin 4500 ng/mL.",
        timeline: "Day 1: Presentation. Day 3: Liver injury identified. Day 7: Remission achieved on steroids.",
        discussion: "This case highlights the importance of recognising acute hepatic involvement in autoinflammatory illness.",
        conclusion: "Prompt immunosuppressive therapy led to full biochemical recovery.",
        patientPerspective: "The patient reported rapid relief of debilitating fevers within 48 hours of starting treatment.",
        learningPoints: [
          "Hyperferritinemia exceeding 4000 ng/mL is a strong clue.",
          "Early corticosteroid intervention halts progressive hepatic involvement."
        ]
      }
    };

    resetLlm(async () => JSON.stringify(crSections));

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: {
        caseText: "Day 1: 45-year-old female presented with high grade fever. Day 3: Ferritin was 4500 ng/mL."
      }
    });

    assert.equal(res.http, 200, JSON.stringify(res));
    assert.equal(res.draft.task, "case_report_draft");
    assert.equal(res.draft.status, "unverified");
    assert.ok(res.draft.sections, "sections object exists");
    assert.equal(res.draft.sections.title, "Adult onset Still disease presenting with acute liver dysfunction");
    assert.equal(res.draft.sections.abstract.length > 20, true);
    assert.equal(res.draft.sections.casePresentation.length > 20, true);
    assert.equal(res.draft.sections.learningPoints.length, 2);
    assert.equal(res.draft.sections.learningPoints[0], "Hyperferritinemia exceeding 4000 ng/mL is a strong clue.");
  });

  test("402 on empty wallet", async () => {
    const env = freshEnv();
    // No wallet funded
    const proj = await makeProject(env);

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: { caseText: "Day 1: Patient presented with mild rash." }
    });

    assert.equal(res.http, 402, "empty wallet returns 402");
    assert.equal(res.error.code, "insufficient_credits");
  });

  test("viewer 403 on ai-draft", async () => {
    const env = freshEnv();
    fundWallet(env, "bob@example.com", 50);
    const proj = await makeProject(env);
    await setRole(env, proj.id, "u-bob", "viewer");

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-bob", {
      task: "publication_consent",
      input: { language: "English" }
    });

    assert.equal(res.http, 403, "viewer role gets 403");
  });

  test("scan-hit refusal on caseText for case_report_draft", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env);
    resetLlm();

    // Plant a phone number in caseText
    const resPhone = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: { caseText: "Day 1: Patient contacted hospital at 9876543210 for urgent admission." }
    });

    assert.equal(resPhone.http, 422, "scan-hit refused with 422");
    assert.equal(resPhone.error.code, "phi_blocked");
    assert.equal(resPhone.error.message, "Patient identifiers detected in case text.");
    assert.equal(llm.calls.length, 0, "LLM was not called when scan hit detected");

    // Plant a date in caseText
    const resDate = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: { caseText: "Patient was admitted on 12/03/2026 with fever." }
    });

    assert.equal(resDate.http, 422, "date scan-hit refused with 422");
    assert.equal(resDate.error.code, "phi_blocked");
    assert.equal(llm.calls.length, 0, "LLM was not called");
  });

  test("PHI-gate refusal on assembled prompt", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env);
    resetLlm();

    // Plant a 10-digit phone number in journalName input for publication_consent
    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "publication_consent",
      input: {
        language: "English",
        journalName: "Journal contact 9876543210"
      }
    });

    assert.equal(res.http, 422, "PHI gate refused with 422");
    assert.equal(res.error.code, "phi_blocked");
    assert.equal(llm.calls.length, 0, "LLM was not called");
  });
});
