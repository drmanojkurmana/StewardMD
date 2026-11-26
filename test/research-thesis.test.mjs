import "./helpers/json-import-attr.mjs";
/* ResearchMD thesis_to_paper. SQLite D1 mock and a mocked provider.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-thesis.test.mjs
 */
import { test, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const thesisClient = require("../research-screen-thesis.js");

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
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});
const llm = { calls: [], impl: async () => "{\"text\":\"\"}" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const PAGE = "Table 7. The mean age was 54 years in 120 patients. Smith 2019 BCG. Colditz 1994 doi 10.1001/jama.1994.03510370074034.";

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
    RESEARCH_MODE: "pilot", RESEARCH_DB: D, RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret", MAIK_KV: kvShim(),
  };
}
function fundWallet(env) {
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
}
function resetLlm(impl) {
  llm.calls.length = 0;
  llm.impl = impl || (async () => "{\"text\":\"Short line.\"}");
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
async function makeProject(env) {
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: "Thesis" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
function words(text) {
  return String(text || "").trim() ? String(text).trim().split(/\s+/).length : 0;
}

describe("research thesis to paper", { concurrency: false, skip: SKIP }, () => {
  test("synthetic 3-page thesis masks hard IDs, returns 409 consent_needed for soft hits until consented, then runs AI", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    resetLlm();
    const pages = [
      { n: 1, text: "Background: We studied severe sepsis outcomes in our tertiary hospital." },
      { n: 2, text: "Patients admitted to the Intensive Care Unit during 2024 were included. Refs: Kumar A, Rao B." },
      { n: 3, text: "Study coordinator phone: 9876543210 for queries." },
    ];
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        pages,
      },
    });
    assert.equal(r.http, 409, JSON.stringify(r));
    assert.equal(r.error.code, "consent_needed");
    assert.deepEqual(r.pages, [2]);
    assert.equal(r.maskedCount, 1);
    assert.ok(Array.isArray(r.findings) && r.findings.length > 0);
    assert.equal(r.findings[0].page, 2);
    assert.ok(!r.findings[0].preview.includes("During 2024"), "preview should not be full sentence");
    assert.equal(llm.calls.length, 0);
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_ai_drafts").get().n, 0);

    const consentTs = "2026-11-26T10:00:00.000Z";
    const r2 = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        pages,
        phiConsent: { confirmed: true, timestamp: consentTs },
      },
    });
    assert.equal(r2.http, 200, JSON.stringify(r2));
    assert.equal(llm.calls.length, 1);
    const promptSent = JSON.stringify(llm.calls[0].parts);
    assert.ok(promptSent.includes("[phone]"), "phone number must be masked as [phone] in AI prompt");
    assert.ok(!promptSent.includes("9876543210"), "raw phone number must never reach AI prompt");

    const audit = sql(env).prepare("SELECT event_type, metadata_json FROM research_audit_events WHERE event_type = 'thesis_phi_consent'").get();
    assert.ok(audit, "thesis_phi_consent audit event must be recorded");
    const meta = JSON.parse(audit.metadata_json);
    assert.deepEqual(meta.pages, [2]);
    assert.equal(meta.maskedCount, 1);
    assert.equal(meta.consentTs, consentTs);
  });

  test("hard-only identifiers are auto-masked without consent sheet or phi_blocked", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    resetLlm();
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        pages: [
          { n: 1, text: "Contact: 9876543210, nurse@hospital.org, UHID: H-44219, DOB: 12/03/1984." },
          { n: 2, text: "Results showed n = 42 patients survived with mean age 54 years." },
        ],
      },
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1);
    const promptSent = JSON.stringify(llm.calls[0].parts);
    assert.ok(promptSent.includes("[phone]"));
    assert.ok(promptSent.includes("[email]"));
    assert.ok(promptSent.includes("[ID]"));
    assert.ok(promptSent.includes("[DOB]"));
    assert.ok(!promptSent.includes("9876543210"));
    assert.ok(!promptSent.includes("nurse@hospital.org"));
    assert.ok(!promptSent.includes("H-44219"));
    assert.ok(!promptSent.includes("12/03/1984"));
  });

  test("an invented number is removed and flagged, and locators name the page and table", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    resetLlm(async () => JSON.stringify({
      text: "The mean age was 54 years in 120 patients and 999 were lost.",
      references: [
        { citation: "Smith 2019 BCG", doi: "", pmid: "" },
        { citation: "Colditz 1994", doi: "10.1001/jama.1994.03510370074034", pmid: "000" },
        { citation: "Not in the thesis", doi: "10.1000/missing" },
      ],
    }));
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        wordLimit: 80,
        pages: [{ n: 54, text: PAGE }],
      },
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 1200);
    assert.equal(llm.calls[0].opts.temperature, 0);
    const section = r.draft.sections[0];
    assert.equal(section.id, "results");
    assert.equal(section.text.includes("999"), false);
    assert.ok(section.text.includes("check this number"));
    assert.deepEqual(section.flags, ["check this number"]);
    const values = section.numbers.map((item) => item.value).sort();
    assert.deepEqual(values, ["120", "54"]);
    for (const item of section.numbers) {
      assert.equal(item.locator.page, 54);
      assert.equal(item.locator.table, "Table 7");
      assert.equal(item.locator.label, "From your thesis, page 54, Table 7");
    }
    assert.equal(r.draft.references.length, 2);
    const smith = r.draft.references.find((item) => item.citation === "Smith 2019 BCG");
    const colditz = r.draft.references.find((item) => item.citation === "Colditz 1994");
    assert.equal(smith.flag, "check this reference");
    assert.equal(smith.doi, "");
    assert.equal(colditz.flag, "");
    assert.equal(colditz.doi, "10.1001/jama.1994.03510370074034");
    assert.equal(colditz.pmid, "");
    assert.equal(r.draft.suggestedTables[0].id, "Table 7");
    assert.equal(r.draft.status, "unverified");
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_protocols").get().n, 0);
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_manuscript_sections").get().n, 0);
  });

  test("word limit is respected, design is suggested, and five sections are five calls", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    const long = "alpha beta gamma delta epsilon zeta eta theta iota";
    resetLlm(async () => JSON.stringify({ text: long }));
    const one = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "discussion",
        wordLimit: 8,
        text: "This randomised placebo trial compared two arms. " + long,
      },
    });
    assert.equal(one.http, 200, JSON.stringify(one));
    assert.ok(one.draft.wordCount <= 8);
    assert.equal(words(one.draft.sections[0].text), one.draft.wordCount);
    assert.equal(one.draft.trimmedToWordLimit, true);
    assert.equal(one.draft.suggestion.paperType, "rct");
    assert.equal(one.draft.suggestion.checklist, "CONSORT");
    assert.ok(one.draft.suggestion.label.startsWith("Randomised controlled trial (RCT)"));
    assert.equal(llm.calls.length, 1);

    resetLlm(async () => JSON.stringify({ text: long + " kappa lambda" }));
    const many = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { wordLimit: 12, text: "A systematic review and meta-analysis of the reports. " + long },
    });
    assert.equal(many.http, 200, JSON.stringify(many));
    assert.equal(llm.calls.length, 5);
    assert.equal(many.draft.sections.length, 5);
    assert.ok(many.draft.wordCount <= 12);
    assert.equal(many.draft.suggestion.paperType, "systematic_review");
    assert.equal(many.draft.suggestion.checklist, "PRISMA");
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_ai_drafts WHERE project_id=?").get(project.id).n, 2);
  });

  test("journal word limit, DOCX tip, and viewer refusal", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    const now = Date.now();
    sql(env).prepare("INSERT INTO research_journals (id,name,issn,created_ts,word_limit_main) VALUES ('j-india','Indian Journal','',?,12)")
      .run(now);
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    resetLlm(async () => JSON.stringify({ text: long }));
    const limited = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { section: "abstract", journalId: "j-india", text: "A case series of similar patients. " + long },
    });
    assert.equal(limited.http, 200, JSON.stringify(limited));
    assert.equal(limited.draft.wordLimit, 12);
    assert.ok(limited.draft.wordCount <= 12);
    assert.equal(limited.draft.suggestion.paperType, "case_series");
    assert.equal(limited.draft.suggestion.checklist, "CARE");

    resetLlm();
    const docx = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { format: "docx", filename: "thesis.docx", docxBase64: "abc" },
    });
    assert.equal(docx.http, 422, JSON.stringify(docx));
    assert.equal(docx.error.code, "docx_needs_pdf");
    assert.equal(docx.error.message, "This file is a DOCX (Word document). Export it as PDF (in Word: File, then Save As, then PDF) and upload the PDF.");
    assert.equal(llm.calls.length, 0);

    await setRole(env, project.id, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-bob", {
      task: "thesis_to_paper",
      input: { text: "An observational cohort with no assignment.", section: "introduction" },
    });
    assert.equal(viewer.http, 403);
    assert.equal(viewer.error.code, "not_member");
    const outsider = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-eve", {
      task: "thesis_to_paper",
      input: { text: "An observational cohort.", section: "introduction" },
    });
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
  });
});

describe("on-device DOCX extraction and parsing", () => {
  function buildZip(entries) {
    const localParts = [];
    const cdParts = [];
    let offset = 0;
    for (const entry of entries) {
      const name = entry.name;
      const data = entry.data;
      const compress = entry.compress;
      const customMethod = entry.method;
      const nameBytes = Buffer.from(name, "utf8");
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
      const method = customMethod !== undefined ? customMethod : (compress ? 8 : 0);
      const body = method === 8 ? deflateRawSync(raw) : raw;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt32LE(body.length, 18);
      lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(nameBytes.length, 26);
      localParts.push(lh, nameBytes, body);

      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(method, 10);
      ch.writeUInt32LE(body.length, 20);
      ch.writeUInt32LE(raw.length, 24);
      ch.writeUInt16LE(nameBytes.length, 28);
      ch.writeUInt32LE(offset, 42);
      cdParts.push(ch, nameBytes);
      offset += lh.length + nameBytes.length + body.length;
    }
    const cd = Buffer.concat(cdParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, cd, eocd]);
  }

  test("extracts ~17,700 words and tables from 11.9 MB generated Word (.docx) thesis with images and deflate compression", async () => {
    const paras = [];
    paras.push("<w:p><w:r><w:t>A PROSPECTIVE OBSERVATIONAL STUDY OF CLINICAL OUTCOMES IN CRITICALLY ILL ADULTS</w:t></w:r></w:p>");
    paras.push("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");

    let wordCount = 0;
    let pIdx = 1;
    while (wordCount < 17700) {
      const wordsInP = [];
      for (let w = 0; w < 50; w++) {
        wordsInP.push("word" + (wordCount++));
      }
      paras.push("<w:p><w:r><w:t>" + wordsInP.join(" ") + "</w:t></w:r></w:p>");
      if (pIdx % 7 === 0) {
        paras.push("<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table 7</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pooled risk ratio was 0.49 (95% CI 0.34 to 0.70) across 120 patients.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>");
      }
      if (pIdx % 10 === 0) {
        paras.push("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
      }
      pIdx++;
    }

    const docXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
      paras.join("") +
      "</w:body></w:document>";

    // Generate ~11.9 MB by adding large image chunks under word/media/
    const imgChunk = Buffer.alloc(3.8 * 1024 * 1024, 0x42);
    const entries = [
      { name: "[Content_Types].xml", data: "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>", compress: true },
      { name: "word/document.xml", data: docXml, compress: true },
      { name: "word/media/image1.png", data: imgChunk, compress: false },
      { name: "word/media/image2.png", data: imgChunk, compress: false },
      { name: "word/media/image3.png", data: imgChunk, compress: false }
    ];

    const zipBuf = buildZip(entries);
    assert.ok(zipBuf.length >= 11.4 * 1024 * 1024, "generated file must be ~11.9 MB (actual: " + zipBuf.length + " bytes)");

    const ab = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);
    const t0 = Date.now();
    const pages = await thesisClient.parseDocx(ab);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 3000, "parsing 11.9 MB docx must complete quickly (< 3s, actual: " + elapsed + "ms)");
    assert.ok(pages.length >= 30, "extracted at least 30 pages (actual: " + pages.length + ")");

    let extractedWords = 0;
    for (const p of pages) {
      extractedWords += thesisClient.countWords(p.text);
    }
    assert.ok(extractedWords >= 17700, "extracted at least 17,700 words (actual: " + extractedWords + ")");

    const tablePage = pages.find((p) => p.text.includes("Table 7") && p.text.includes("0.49"));
    assert.ok(tablePage, "table text must be extracted into pages");

    const ver = thesisClient.verifyNumbers("The pooled risk ratio was 0.49 across 120 patients.", pages);
    assert.equal(ver.flags.length, 0);
    const loc = ver.locators.find((l) => l.number === "0.49");
    assert.ok(loc, "verifies number locator");
    assert.equal(loc.table, 7);
  });

  test("handles Windows backslash path separators in ZIP entries", async () => {
    const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
      "<w:p><w:r><w:t>Windows path thesis text.</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    const zipBuf = buildZip([{ name: "word\\document.xml", data: xml, compress: true }]);
    const pages = await thesisClient.parseDocx(zipBuf);
    assert.equal(pages.length, 1);
    assert.match(pages[0].text, /Windows path thesis text/);
  });

  test("reports clear device requirement message when DecompressionStream is missing", async () => {
    const origDS = globalThis.DecompressionStream;
    try {
      delete globalThis.DecompressionStream;
      const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
        "<w:p><w:r><w:t>Some text.</w:t></w:r></w:p>" +
        "</w:body></w:document>";
      const zipBuf = buildZip([{ name: "word/document.xml", data: xml, compress: true }]);
      await assert.rejects(
        async () => { await thesisClient.parseDocx(zipBuf); },
        (err) => {
          assert.match(err.message, /iOS 16\.4\+ or modern Android/);
          assert.doesNotMatch(err.message, /[\u2013\u2014]/);
          return true;
        }
      );
    } finally {
      globalThis.DecompressionStream = origDS;
    }
  });

  test("reports clear error for unsupported ZIP compression methods", async () => {
    const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>";
    const zipBuf = buildZip([{ name: "word/document.xml", data: xml, method: 12 }]);
    await assert.rejects(
      async () => { await thesisClient.parseDocx(zipBuf); },
      (err) => {
        assert.match(err.message, /unsupported compression format/);
        return true;
      }
    );
  });

  test("handleFile routing recognizes .docx extensions and alternate MIME types, and rejects binary .doc", () => {
    const messages = [];
    const container = {
      querySelector: (sel) => {
        if (sel === "#rmdThesisMsg") {
          return {
            set innerHTML(v) { messages.push(v); }
          };
        }
        return null;
      }
    };

    // Legacy binary .doc file
    thesisClient.handleFile({ name: "my_thesis.doc", type: "application/msword", size: 1000 }, container);
    assert.ok(messages.some((m) => m.includes("Older Word (.doc) files are binary format")));

    // Large file > 40 MB
    messages.length = 0;
    thesisClient.handleFile({ name: "huge.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 45 * 1024 * 1024 }, container);
    assert.ok(messages.some((m) => m.includes("larger than 40 MB")));

    // Non-docx invalid format
    messages.length = 0;
    thesisClient.handleFile({ name: "corrupted.docx", type: "application/docx", size: 500, arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer }, container);
  });
});
