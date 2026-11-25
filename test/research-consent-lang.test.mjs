import "./helpers/json-import-attr.mjs";
/* Unit tests: ResearchMD multilingual consent templates and AI draft validation.
 * Verifies all 10 languages (en, te, hi, kn, ta, ml, gu, bn, ur, mr),
 * Unicode script letter validation (>= 60%), 422 invalid_draft when English text
 * is returned under a local language heading, and successful return of both versions.
 * No em or en dashes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-consent-lang.test.mjs
 */
import { test, mock, describe } from "node:test";
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
const { checkScriptRatio, CONSENT_LANGUAGES_LIST } = await import("../functions/api/research/_ai_draft.js");
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
    APP_GATE_KEY: "test-gate",
    GEMINI_API_KEY: "test-gemini",
  };
}

function fundWallet(env, email, inr = 50) {
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
    title: "Clinical Study on Medical Interventions",
    studyType,
    researchQuestion: "Clinical characteristics and outcomes.",
  });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}

describe("multilingual consent templates and script validation", { concurrency: false, skip: SKIP }, () => {
  const rawTemplates = readFileSync(new URL("../data/research-consent-templates.json", import.meta.url), "utf8");
  const templates = JSON.parse(rawTemplates);

  test("template JSON has no em or en dashes", () => {
    const hasDashes = /[\u2013\u2014]/.test(rawTemplates);
    assert.equal(hasDashes, false, "template JSON must not contain em or en dashes");
  });

  test("template JSON has all 10 languages and every required field", () => {
    const EXPECTED_LANGS = ["en", "te", "hi", "kn", "ta", "ml", "gu", "bn", "ur", "mr"];
    assert.equal(templates.source, "StewardMD draft translation, 2026-11");
    assert.ok(templates.languages, "templates.languages object exists");

    for (const code of EXPECTED_LANGS) {
      const l = templates.languages[code];
      assert.ok(l, "Language " + code + " must exist in template");
      assert.equal(l.code, code);
      assert.ok(l.name, "Language " + code + " must have name");
      assert.ok(l.script, "Language " + code + " must have script");
      assert.ok(l.dir, "Language " + code + " must have dir");
      if (code === "ur") {
        assert.equal(l.dir, "rtl", "Urdu must have dir rtl");
      } else {
        assert.equal(l.dir, "ltr", code + " must have dir ltr");
      }

      assert.equal(l.source, "StewardMD draft translation, 2026-11");
      if (code !== "en") {
        assert.equal(
          l.translationCheck,
          "Translation check: have a native speaker or your ethics committee check this translation before use.",
          code + " must have translation check warning"
        );
      }

      // Required headings
      assert.ok(l.headings, code + " must have headings");
      assert.ok(l.headings.participantInformationSheet, code + " must have participantInformationSheet heading");
      assert.ok(l.headings.informedConsentForm, code + " must have informedConsentForm heading");
      assert.ok(l.headings.publicationConsent, code + " must have publicationConsent heading");
      assert.ok(l.headings.signatureBlock, code + " must have signatureBlock heading");

      // Required statements
      assert.ok(Array.isArray(l.statements), code + " statements must be an array");
      assert.ok(l.statements.length >= 3, code + " must have at least 3 statements");

      // Signatures
      assert.ok(l.signature, code + " must have signature line");
      assert.ok(l.thumbImpression, code + " must have thumb impression line");
      assert.ok(l.witness, code + " must have witness line");
      assert.ok(l.representative, code + " must have representative line");
      assert.ok(l.legallyAcceptableRepresentative, code + " must have legallyAcceptableRepresentative line");
      assert.ok(l.date, code + " must have date line");

      // Publication consent
      const pc = l.publicationConsent;
      assert.ok(pc, code + " must have publicationConsent");
      assert.ok(pc.title, code + " publicationConsent must have title");
      assert.ok(pc.whatWillBePublished, code + " publicationConsent must have whatWillBePublished");
      assert.ok(pc.worldwideAccess, code + " publicationConsent must have worldwideAccess");
      assert.ok(pc.anonymity, code + " publicationConsent must have anonymity");
      assert.ok(pc.withdrawal, code + " publicationConsent must have withdrawal");
      assert.ok(pc.medicalCare, code + " publicationConsent must have medicalCare");
      assert.ok(pc.images, code + " publicationConsent must have images");
      assert.ok(pc.note, code + " publicationConsent must have note");
    }
  });

  test("script check accepts real Telugu and Urdu samples and rejects English", () => {
    const teluguSample = "ఈ పత్రం రోగి సమ్మతి కోసం రూపొందించబడింది. వివరాలు పూర్తిగా పరిశీలించబడ్డాయి.";
    const urduSample = "یہ رضامندی کا فارم مریض کے لیے تیار کیا گیا ہے۔ تمام معلومات درج ہیں۔";
    const englishSample = "This is an English text intended to verify script validation and reject fallbacks.";

    // Telugu checks
    const teCheck = checkScriptRatio(teluguSample, "te");
    assert.equal(teCheck.ok, true, "Telugu check must be ok");
    assert.ok(teCheck.ratio >= 0.6, "Telugu sample ratio must be >= 0.6");

    const teEngCheck = checkScriptRatio(englishSample, "te");
    assert.equal(teEngCheck.ok, false, "English in Telugu check must fail ok");
    assert.equal(teEngCheck.ratio, 0, "English text in Telugu must have ratio 0");

    // Urdu checks
    const urCheck = checkScriptRatio(urduSample, "ur");
    assert.equal(urCheck.ok, true, "Urdu check must be ok");
    assert.ok(urCheck.ratio >= 0.6, "Urdu sample ratio must be >= 0.6");

    const urEngCheck = checkScriptRatio(englishSample, "ur");
    assert.equal(urEngCheck.ok, false, "English in Urdu check must fail ok");
    assert.equal(urEngCheck.ratio, 0, "English text in Urdu must have ratio 0");

    // English language check returns 1.0
    const enCheck = checkScriptRatio(englishSample, "en");
    assert.equal(enCheck.ok, true);
    assert.equal(enCheck.ratio, 1.0);
  });

  test("publication_consent returns 422 invalid_draft when English text is returned under te", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env, "case_report");

    // Mock LLM returning English text under local field
    resetLlm(async () => JSON.stringify({
      english: "PATIENT CONSENT FOR PUBLICATION\n\n1. What will be published: Case details.",
      local: "PATIENT CONSENT FOR PUBLICATION\n\n1. What will be published: Case details in English.",
      languageName: "Telugu"
    }));

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "publication_consent",
      input: { language: "Telugu", includesImages: true }
    });

    assert.equal(res.http, 422, "English fallback under Telugu must return 422");
    assert.equal(res.error.code, "invalid_draft");
  });

  test("consent_form returns 422 invalid_draft when English text is returned under te", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 50);
    const proj = await makeProject(env, "clinical_trial");

    // Mock LLM returning English text under translatedVersion
    resetLlm(async () => JSON.stringify({
      englishVersion: {
        participantInformationSheet: {
          title: "Participant Information Sheet",
          purpose: "Purpose of the study.",
          procedures: "Study procedures."
        },
        consentForm: {
          statements: ["I agree to take part."],
          signatureBlock: "Signature: ________"
        }
      },
      translatedVersion: {
        participantInformationSheet: {
          title: "Participant Information Sheet in English",
          purpose: "Study purpose in English.",
          procedures: "Procedures in English."
        },
        consentForm: {
          statements: ["I agree to participate."],
          signatureBlock: "Signature: ________"
        }
      }
    }));

    const res = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "Telugu" }
    });

    assert.equal(res.http, 422, "English fallback under Telugu consent form must return 422");
    assert.equal(res.error.code, "invalid_draft");
  });

  test("publication_consent and consent_form return both versions when valid", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const proj = await makeProject(env, "case_report");

    const validTeluguPub = {
      english: "PATIENT CONSENT FOR PUBLICATION\n\n" +
        "1. What will be published: Details and images.\n" +
        "2. Reach: Worldwide.\n" +
        "3. Anonymity: Maintained.\n" +
        "4. Withdrawal: Allowed.\n" +
        "5. Medical care: Unaffected.\n" +
        "6. List of images: Scans.\n" +
        "7. Signature block: Patient Signature: ________ Date: ________\n" +
        "8. Next of kin: Representative Signature: ________\n" +
        "9. Witness Signature: ________\n\n" +
        "Note: Get the patient to sign this.",
      local: "ప్రచురణ కొరకు రోగి సమ్మతి పత్రం\n\n" +
        "1. ప్రచురించబడే వివరాలు: వైద్య వివరాలు మరియు చిత్రాలు.\n" +
        "2. ప్రపంచవ్యాప్త పఠనం: ఆన్ లైన్ లో ప్రచురించబడుతుంది.\n" +
        "3. గోప్యత: రోగి పేరు ప్రచురించబడదు.\n" +
        "4. ఉపసంహరణ హక్కు: సమ్మతిని ఉపసంహరించుకోవచ్చు.\n" +
        "5. వైద్య సంరక్షణ: చికిత్సపై ఎటువంటి ప్రభావం ఉండదు.\n" +
        "6. చిత్రాల జాబితా: క్లినికల్ ఛాయాచిత్రాలు.\n" +
        "7. సంతకం: రోగి సంతకం: ________ తేదీ: ________\n" +
        "8. చట్టబద్ధమైన ప్రతినిధి సంతకం: ________\n" +
        "9. సాక్షి సంతకం: ________\n\n" +
        "గమనిక: సమర్పించడానికి ముందు రోగి లేదా బంధువుల సంతకం తీసుకోండి.",
      languageName: "Telugu"
    };

    resetLlm(async () => JSON.stringify(validTeluguPub));
    const pubRes = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "publication_consent",
      input: { language: "Telugu", includesImages: true }
    });
    assert.equal(pubRes.http, 200, JSON.stringify(pubRes));
    assert.ok(pubRes.draft.english, "English copy must be returned");
    assert.ok(pubRes.draft.local, "Telugu copy must be returned");
    assert.equal(pubRes.draft.languageName, "Telugu");

    // Now test consent_form with valid Telugu
    const validTeluguConsent = {
      englishVersion: {
        participantInformationSheet: {
          title: "Information for participants",
          purpose: "Study purpose.",
          procedures: "Procedures."
        },
        consentForm: {
          statements: ["I agree to take part."],
          signatureBlock: "Signature: ________"
        }
      },
      translatedVersion: {
        participantInformationSheet: {
          title: "పాల్గొనేవారి సమాచార పత్రం",
          purpose: "ఈ అధ్యయనం యొక్క ఉద్దేశ్యం రోగులకు సహాయం చేయడం.",
          procedures: "అధ్యయనంలో సాధారణ పరీక్షలు నిర్వహించబడతాయి."
        },
        consentForm: {
          statements: ["నేను అధ్యయనంలో పాల్గొనడానికి అంగీకరిస్తున్నాను."],
          signatureBlock: "సంతకం: ________"
        }
      }
    };

    resetLlm(async () => JSON.stringify(validTeluguConsent));
    const consentRes = await call(env, "POST", "v1/projects/" + proj.id + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "Telugu" }
    });
    assert.equal(consentRes.http, 200, JSON.stringify(consentRes));
    assert.ok(consentRes.draft.englishVersion, "English version must be returned");
    assert.ok(consentRes.draft.translatedVersion, "Telugu translated version must be returned");
    assert.equal(consentRes.draft.language, "Telugu");
  });
});
