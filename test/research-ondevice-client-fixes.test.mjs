/* Targeted unit & integration tests for review items 1, 2, 6, 9, 13, 17, 18.
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite --test-timeout=30000 test/research-ondevice-client-fixes.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url);
const readSrc = (name) => fs.readFileSync(new URL(name, ROOT), "utf8");

function makeMemoryCp(CP) {
  const backend = { records: {} };
  CP._setBackend(backend);
  return {
    has: (k) => Object.prototype.hasOwnProperty.call(backend.records, k),
    get: (k) => backend.records[k],
    clear: () => { backend.records = {}; },
  };
}

function stripCommentsStringsAndRegexes(src) {
  const out = [];
  let i = 0;
  let prev = "";
  const n = src.length;
  const regexAllowedAfter = new Set(["", "(", "[", "{", ",", ";", ":", "=", "!", "&", "|", "?", "+", "-", "*", "%", "~", "^", "<", ">", "\n"]);
  while (i < n) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      out.push(q, q);
      prev = q;
      continue;
    }
    if (ch === "/" && (regexAllowedAfter.has(prev) || /\b(?:return|throw|case|in|instanceof|typeof|void|delete|new|else|do)$/.test(out.slice(-12).join("")))) {
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]" && inClass) inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        else if (src[i] === "\n") break;
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++;
      out.push(" /re/ ");
      prev = "/";
      continue;
    }
    out.push(ch);
    if (!/[ \t\r]/.test(ch)) prev = ch;
    i++;
  }
  return out.join("");
}

describe("ES5 + no em/en dash invariants on all modified app files", () => {
  const FILES = [
    "research-screen-masterchart.js",
    "research-screen-thesis.js",
    "research-ondevice-stats.js",
    "research-ondevice-draft.js",
    "research-po-prompts.js",
    "research-screen-manuscript.js",
    "research-ondevice-jobs.js",
    "research-ondevice-pdf.js",
    "research-screen-extract.js",
    "research-screen-find.js",
    "research-po-gates.js",
  ];

  test("no ES6+ forbidden syntax, regex lookbehinds, or em/en dashes", () => {
    const rawForbidden = ["\u2014", "\u2013"];
    const codeForbidden = [
      ["=>", /=>/],
      ["let", /\blet\s+/],
      ["const", /\bconst\s+/],
      ["class", /\bclass\s+/],
      ["Array.from", /\bArray\.from\b/],
      [".includes(", /\.includes\(/],
      ["Object.assign", /\bObject\.assign\b/],
    ];
    for (const f of FILES) {
      const src = readSrc(f);
      for (const tok of rawForbidden) {
        assert.equal(src.indexOf(tok), -1, f + " contains forbidden em/en dash " + tok);
      }
      assert.equal(/\(\?<[!=]/.test(src), false, f + " contains ES2018 lookbehind");
      const noStrings = stripCommentsStringsAndRegexes(src);
      for (const [label, re] of codeForbidden) {
        assert.equal(re.test(noStrings), false, f + " contains forbidden ES6+ token " + label);
      }
      assert.equal(noStrings.indexOf("`"), -1, f + " contains template literal backtick");
    }
  });
});

/* ==================== Items 1 & 6: MasterChart ==================== */

describe("Items 1 & 6: research-screen-masterchart.js IPD ethics check and scope/formula", () => {
  function loadMasterchart(opts = {}) {
    const apiCalls = [];
    const win = {
      document: {
        getElementById: () => ({ id: "rmdMcCss" }),
        head: { appendChild: () => {} },
        createElement: () => ({ style: {}, setAttribute: () => {} }),
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      SMD_RESEARCH_STATS: require("../research-stats.js"),
      SMD_RMD_ONDEVICE_STATS: opts.onDeviceStats || require("../research-ondevice-stats.js"),
      SMD_RMD_JOBS: opts.jobs || null,
      SMD_RESEARCH: {
        esc: (s) => String(s == null ? "" : s),
        store: {
          getActiveProject: () => ({ id: "prj_mc", serverId: "prj_mc" }),
        },
        api: {
          request: async (method, url, body) => {
            apiCalls.push({ method, url, body });
            if (opts.onApi) return opts.onApi(method, url, body);
            return {};
          },
        },
      },
    };
    win.window = win;
    win.globalThis = win;
    const ctx = vm.createContext(Object.assign(win, {
      Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math,
      isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
    }));
    vm.runInContext("var module = { exports: {} };", ctx);
    vm.runInContext(readSrc("research-screen-masterchart.js"), ctx);
    return { win, mcExports: ctx.module.exports, apiCalls };
  }

  test("Item 1: checkMcEthicsApproval fails closed on config:null, incomplete evidence, expired evidence, and passes when valid", async () => {
    let configResp = { config: null };
    let evidenceResp = { evidence: [{ id: "e1", kind: "irb_approval", status: "approved", expiresTs: null }] };
    const { mcExports } = loadMasterchart({
      onApi: async (_m, url) => (url.endsWith("/ipd-config") ? configResp : evidenceResp),
    });

    // config: null with approved evidence must fail closed!
    assert.equal(await mcExports.checkMcEthicsApproval("prj_mc"), false);

    // IN consent config requires BOTH irb_approval/exemption_waiver AND consent_basis
    configResp = {
      config: {
        dataRegion: "IN",
        jurisdictions: ["IN"],
        identifiabilityTier: "coded_pseudonymised",
        legalBasis: { IN: "consent" },
        attestation: { responsibility: true },
        agreements: {},
      },
    };
    assert.equal(await mcExports.checkMcEthicsApproval("prj_mc"), false, "missing consent_basis must fail");

    // Expired irb_approval must fail
    evidenceResp = {
      evidence: [
        { id: "e1", kind: "irb_approval", status: "approved", expiresTs: Date.now() - 10000 },
        { id: "e2", kind: "consent_basis", status: "approved", expiresTs: null },
      ],
    };
    assert.equal(await mcExports.checkMcEthicsApproval("prj_mc"), false, "expired evidence must fail");

    // Pending consent_basis must fail
    evidenceResp = {
      evidence: [
        { id: "e1", kind: "irb_approval", status: "approved", expiresTs: Date.now() + 60000 },
        { id: "e2", kind: "consent_basis", status: "pending", expiresTs: null },
      ],
    };
    assert.equal(await mcExports.checkMcEthicsApproval("prj_mc"), false, "pending evidence must fail");

    // Both approved & unexpired -> passes
    evidenceResp = {
      evidence: [
        { id: "e1", kind: "irb_approval", status: "approved", expiresTs: Date.now() + 60000 },
        { id: "e2", kind: "consent_basis", status: "approved", expiresTs: null },
      ],
    };
    assert.equal(await mcExports.checkMcEthicsApproval("prj_mc"), true);
  });

  test("Item 6: Survival and Logistic run without ReferenceError and cloud fallback posts model.formula", async () => {
    const { win, mcExports, apiCalls } = loadMasterchart({
      onApi: async (_m, url) => {
        if (url.endsWith("/ipd-config")) {
          return {
            config: {
              dataRegion: "IN", jurisdictions: ["IN"], identifiabilityTier: "coded_pseudonymised",
              legalBasis: { IN: "consent" }, attestation: { responsibility: true }, agreements: {},
            },
          };
        }
        if (url.endsWith("/ipd-evidence")) {
          return {
            evidence: [
              { id: "e1", kind: "irb_approval", status: "approved", expiresTs: null },
              { id: "e2", kind: "consent_basis", status: "approved", expiresTs: null },
            ],
          };
        }
        return { job: { id: "sj_1", status: "queued" } };
      },
    });
    const JOBS = require("../research-ondevice-jobs.js");
    const CP = require("../research-ondevice-checkpoint.js");
    makeMemoryCp(CP);
    win.SMD_RMD_CHECKPOINT = CP;
    win.SMD_RMD_JOBS = JOBS;

    let html = "";
    const controls = {};
    const container = {
      get innerHTML() { return html; },
      set innerHTML(v) {
        html = v;
        for (const k of Object.keys(controls)) delete controls[k];
      },
      onclick: null,
      querySelector: (sel) => {
        const m = sel.match(/^#([A-Za-z0-9_-]+)$/);
        if (m) {
          if (!controls[m[1]]) controls[m[1]] = { value: "", checked: false, onchange: null };
          return controls[m[1]];
        }
        return null;
      },
      querySelectorAll: () => [],
    };
    win.SMD_RESEARCH.screens.masterchart.render(container, { projectId: "prj_mc" });

    // Exercise Survival through real click handlers on the sample dataset
    const findBtn = (attrVal) => ({
      getAttribute: (a) => (a === "data-rmd-mc" ? attrVal : null),
      parentNode: null,
    });
    container.onclick({ target: findBtn("sample") });
    await new Promise((r) => setTimeout(r, 20));
    container.onclick({ target: findBtn("continue-identifiers") });
    container.onclick({ target: findBtn("continue-columns") });
    container.onclick({
      target: {
        getAttribute: (a) => (a === "data-rmd-mc-choice" ? "survival" : null),
        parentNode: null,
      },
    });
    controls.rmdMcTime.value = "Hospital stay days";
    controls.rmdMcTime.onchange();
    controls.rmdMcEvent.value = "Complication";
    controls.rmdMcEvent.onchange();
    container.onclick({ target: findBtn("run") });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(html.indexOf("ReferenceError"), -1, "Survival must not throw ReferenceError");
    assert.ok(html.indexOf("Kaplan") >= 0 || html.indexOf("survival") >= 0, "Survival rendered results via runWithDeviceFallback");

    // Verify Logistic also runs via runWithDeviceFallback without ReferenceError
    container.onclick({ target: findBtn("to-question") });
    container.onclick({
      target: {
        getAttribute: (a) => (a === "data-rmd-mc-choice" ? "logistic" : null),
        parentNode: null,
      },
    });
    assert.equal(html.indexOf("ReferenceError"), -1, "Logistic must not throw ReferenceError");

    // Verify runMcCloudFallback handles missing ipdDatasetId cleanly
    const unavail = await mcExports.runMcCloudFallback("prj_mc", { family: "linear", outcome: "bp", predictors: ["age", "bmi"] }, {});
    assert.equal(unavail.unavailable, true);

    // Verify runMcCloudFallback posts model.formula for linear and logistic when datasetId is present
    await mcExports.runMcCloudFallback("prj_mc", { family: "linear", outcome: "bp", predictors: ["age", "bmi"], datasetId: "ipd_1", robust: "HC3" }, { kind: "stats" });
    await mcExports.runMcCloudFallback("prj_mc", { family: "logistic", outcome: "comp", predictors: ["age", "sex"], datasetId: "ipd_1" }, { kind: "stats" });
    const statsJobsCalls = apiCalls.filter((c) => c.method === "POST" && c.url === "/v1/projects/prj_mc/stats-jobs");
    assert.equal(statsJobsCalls.length, 2);
    assert.equal(statsJobsCalls[0].body.model.formula, "bp ~ age + bmi");
    assert.equal(statsJobsCalls[0].body.model.robust, "HC3");
    assert.equal(statsJobsCalls[1].body.model.formula, "comp ~ age + sex");
  });
});

/* ==================== Item 2: Thesis PDF fallback ==================== */

describe("Item 2: research-screen-thesis.js routes missing-OCR and readPdfLocal errors through runWithFallback", () => {
  function loadThesisEnv(opts = {}) {
    const uploads = [];
    const fallbackCalls = [];
    const messages = [];
    const win = {
      document: {
        getElementById: () => null,
        head: { appendChild: () => {} },
        createElement: () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      FormData: class FakeFormData {
        constructor() { this.fields = []; }
        append(k, v) { this.fields.push([k, v]); }
      },
      SMD_RMD_ONDEVICE_PDF: opts.ondevicePdf || {
        isEnabled: () => true,
        hasNativeOcr: () => false,
        sha256: async () => "b".repeat(64),
      },
      SMD_RMD_JOBS: opts.jobs || null,
      SMD_RMD_CHECKPOINT: opts.cp || null,
      SMD_RESEARCH: {
        esc: (s) => String(s == null ? "" : s),
        p2: {
          loadingHtml: (t) => String(t),
          friendlyError: (e) => ({ message: (e && e.message) || "Error" }),
        },
        store: {
          getActiveProject: () => ({ id: "prj_th", serverId: "prj_th" }),
        },
        api: {
          upload: async (url, fd) => {
            uploads.push({ url, fd });
            return { artifact: { id: "art_th", jobId: "j_th", filename: "thesis.pdf" } };
          },
          request: async () => ({ status: "succeeded" }),
        },
      },
      pdfjsLib: opts.pdfjsLib,
    };
    win.window = win;
    win.globalThis = win;
    const ctx = vm.createContext(Object.assign(win, {
      Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math, Uint8Array, ArrayBuffer,
      isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
    }));
    vm.runInContext("var module = { exports: {} };", ctx);
    vm.runInContext(readSrc("research-screen-thesis.js"), ctx);

    const container = {
      innerHTML: "",
      querySelector: (sel) => {
        if (sel === "#rmdThesisMsg") return { set innerHTML(v) { messages.push(v); } };
        return null;
      },
      querySelectorAll: () => [],
    };
    win.SMD_RESEARCH.screens.thesis.render(container);
    return { thesis: ctx.module.exports, container, uploads, fallbackCalls, messages };
  }

  test("scanned PDF with hasNativeOcr()===false gates uploadPdfServer behind runWithFallback", async () => {
    const CP = require("../research-ondevice-checkpoint.js");
    makeMemoryCp(CP);
    const JOBS = require("../research-ondevice-jobs.js");
    let noticeShown = false;
    let quotaChecked = false;
    const origRunWithFallback = JOBS.runWithFallback;
    const wrappedJobs = Object.assign({}, JOBS, {
      runWithFallback: (kind, runDev, runCloud, opts) => origRunWithFallback(kind, runDev, runCloud, Object.assign({}, opts, {
        retryDelayMs: 1,
        checkQuota: async () => {
          quotaChecked = true;
          return { plan: "pro", allowance: 25, used: 0, remaining: 25 };
        },
        onNeedsCloud: async (info) => {
          noticeShown = true;
          assert.equal(info.kind, "pdf");
          return { action: "cancel" };
        },
      })),
    });

    const fakePdfjs = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
          destroy: () => {},
        }),
      }),
    };

    const { thesis, container, uploads } = loadThesisEnv({ jobs: wrappedJobs, cp: CP, pdfjsLib: fakePdfjs });
    const file = {
      name: "scanned.pdf",
      type: "application/pdf",
      size: 1024,
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 scanned").buffer,
    };

    thesis.handleFile(file, container);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(noticeShown, true, "privacy notice must be shown when native OCR is missing");
    assert.equal(quotaChecked, false, "quota not consumed on cancel");
    assert.equal(uploads.length, 0, "uploadPdfServer must NOT run without Continue");
  });

  test("non-password readPdfLocal error gates uploadPdfServer behind runWithFallback", async () => {
    const CP = require("../research-ondevice-checkpoint.js");
    makeMemoryCp(CP);
    const JOBS = require("../research-ondevice-jobs.js");
    let noticeShown = false;
    let quotaChecked = false;
    const origRunWithFallback = JOBS.runWithFallback;
    const wrappedJobs = Object.assign({}, JOBS, {
      runWithFallback: (kind, runDev, runCloud, opts) => origRunWithFallback(kind, runDev, runCloud, Object.assign({}, opts, {
        retryDelayMs: 1,
        checkQuota: async () => {
          quotaChecked = true;
          return { plan: "pro", allowance: 25, used: 0, remaining: 25 };
        },
        onNeedsCloud: async () => {
          noticeShown = true;
          return { action: "continue" };
        },
      })),
    });

    const brokenPdfjs = {
      getDocument: () => ({ promise: Promise.reject(new Error("corrupt pdf header")) }),
    };

    const { thesis, container, uploads } = loadThesisEnv({ jobs: wrappedJobs, cp: CP, pdfjsLib: brokenPdfjs });
    const file = {
      name: "broken.pdf",
      type: "application/pdf",
      size: 1024,
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 broken").buffer,
    };

    thesis.handleFile(file, container);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(noticeShown, true, "privacy notice must be shown before upload");
    assert.equal(quotaChecked, true, "quota check must run on Continue");
    assert.equal(uploads.length, 1, "uploadPdfServer runs after Continue");
    const fallbackField = uploads[0].fd.fields.find((p) => p[0] === "fallback");
    assert.ok(fallbackField, "fallbackMeta attached to upload");
    assert.equal(JSON.parse(fallbackField[1]).kind, "pdf");
  });
});

/* ==================== Item 9: Draft checkpoint, AI wait, abort, deferredFail ==================== */

describe("Item 9: Manuscript & on-device draft fixes", () => {
  const PROMPTS = require("../research-po-prompts.js");
  const GATES = require("../research-po-gates.js");
  const CP = require("../research-ondevice-checkpoint.js");
  const DRAFT = require("../research-ondevice-draft.js");
  const JOBS = require("../research-ondevice-jobs.js");

  beforeEach(async () => {
    await makeMemoryCp(CP);
  });

  test("saveCheckpoint merges runner fields, beginAiWait covers /token, and opts.signal.aborted stops DRAFT.run", async () => {
    const manifest = {
      v: 1, projectId: "p1", jobId: "job_m9",
      protocol: { title: "Trial X", question: "Q?", lockHash: "a".repeat(64), lockedAt: "2026-11-01T00:00:00Z" },
      evidence: [], runs: [], references: [],
    };
    await CP.put("draft:job_m9", { running: true, finished: false, failCount: 2, reasons: [{ try: 1 }], jobKey: "draft:job_m9" });

    const aiWaitEvents = [];
    const ac = new AbortController();
    let gwCall = 0;

    await assert.rejects(() => DRAFT.run({
      job: { id: "job_m9", projectId: "p1", createdBy: "u1" },
      manifest,
      token: "tok-expired",
    }, {
      checkpoint: CP,
      signal: ac.signal,
      beginAiWait: () => aiWaitEvents.push("begin"),
      endAiWait: () => aiWaitEvents.push("end"),
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        gwCall++;
        if (gwCall === 1) return { status: 401, data: { error: { code: "unauthorized" } } };
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n{\"section_plan\":[{\"section_title\":\"Abstract\"}]}\n```", usage: { inputTokens: 5, outputTokens: 5 } } };
        }
        ac.abort();
        return { status: 200, data: { text: "\\section*{Abstract}\nDone.", usage: { inputTokens: 5, outputTokens: 5 } } };
      },
      apiRequest: async (_m, path) => {
        if (path.endsWith("/token")) return { token: "tok-fresh" };
        return { ok: true };
      },
    }), (err) => err && err.code === "cancelled");

    // beginAiWait/endAiWait called for: 401 gateway call, /token refresh, retry outline gateway call, section gateway call
    assert.equal(aiWaitEvents.filter((e) => e === "begin").length, 4);
    assert.equal(aiWaitEvents.filter((e) => e === "end").length, 4);

    // Runner metadata preserved in draft:job_m9
    const saved = await CP.get("draft:job_m9");
    assert.equal(saved.failCount, 2);
    assert.equal(saved.reasons.length, 1);
    assert.equal(saved.running, true);
  });

  test("manuscript.js uses runner:draft key, shows Continue draft on status:failed, and flushes deferredFail on cancel/quota", async () => {
    const cpMap = makeMemoryCp(CP);
    for (const outcome of [
      { action: "cancel", expectedCode: "device_failed" },
      { action: "quota_free", expectedCode: "device_failed" },
      { action: "quota_limit", expectedCode: "device_failed" },
    ]) {
      cpMap.clear();
      const apiCalls = [];
      const storageMap = {};
      const win = {
        document: {
          head: { appendChild: () => {} },
          body: { contains: () => true },
          getElementById: () => ({ id: "rmdManuscriptCss" }),
          createElement: () => ({ style: {}, setAttribute: () => {} }),
        },
        localStorage: {
          getItem: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : null),
          setItem: (k, v) => { storageMap[k] = String(v); },
          removeItem: (k) => { delete storageMap[k]; },
        },
        fetch: async () => ({
          status: 400,
          text: async () => JSON.stringify({ error: { code: "bad_request", message: "bad" } }),
        }),
        SMD_RMD_CHECKPOINT: CP,
        SMD_RMD_PO_PROMPTS: PROMPTS,
        SMD_RMD_PO_GATES: GATES,
        SMD_RMD_ONDEVICE_DRAFT: Object.assign({}, DRAFT, {
          run: (bundle, runOpts) => DRAFT.run(bundle, Object.assign({}, runOpts, { sleep: () => Promise.resolve() })),
        }),
        SMD_RMD_JOBS: {
          TIMEOUTS: JOBS.TIMEOUTS,
          NOTICES: JOBS.NOTICES,
          DEVICE_PRIVACY_LINE: JOBS.DEVICE_PRIVACY_LINE,
          isEnabled: () => true,
          classifyError: JOBS.classifyError,
          updateCheckpoint: JOBS.updateCheckpoint,
          runWithFallback: (kind, runDev, runCloud, opts) => JOBS.runWithFallback(kind, runDev, runCloud, Object.assign({}, opts, {
            checkpointStore: CP,
            retryDelayMs: 1,
            checkQuota: async () => outcome.action === "quota_free"
              ? { plan: "free", allowance: 0, used: 0, remaining: 0 }
              : { plan: "pro", allowance: 25, used: 25, remaining: 0 },
            onNeedsCloud: async () => outcome.action === "cancel"
              ? { action: "cancel" }
              : { action: "continue" },
          })),
        },
        SMD_RESEARCH: {
          ai: { state: () => ({ busy: false, error: null, drafted: {} }), barHtml: () => "", noteHtml: () => "", bind: () => {} },
          store: {
            getActiveProject: () => ({ id: "prj_m", serverId: "prj_m", title: "SR", studyType: "systematic_review" }),
            getState: () => ({ runs: {} }),
          },
          api: {
            request: async (method, path, body) => {
              apiCalls.push({ method, path, body });
              if (method === "POST" && path.endsWith("/jobs")) {
                return {
                  job: { id: "job_ui_" + outcome.action, projectId: "prj_m", status: "queued", runner: "device" },
                  manifest: { v: 1, projectId: "prj_m", protocol: { title: "SR", lockHash: "a".repeat(64) }, evidence: [], runs: [], references: [] },
                  token: "tok-bad", // enters on-device runner, then gateway transport (no fetch) fails -> counted device_failed
                };
              }
              return { versions: [] };
            },
          },
        },
      };
      win.window = win;
      win.globalThis = win;
      const ctx = vm.createContext(Object.assign(win, {
        Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math,
        isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
      }));
      vm.runInContext(readSrc("research-ondevice-draft.js"), ctx);
      vm.runInContext(readSrc("research-screen-manuscript.js"), ctx);

      let html = "";
      const container = {
        _nodes: [],
        get innerHTML() { return html; },
        set innerHTML(v) {
          html = v;
          this._nodes = [];
          const btnRe = /<button\s+([^>]*?)>([\s\S]*?)<\/button>/gi;
          let m;
          while ((m = btnRe.exec(html)) !== null) {
            const attrs = {};
            const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
            let am;
            while ((am = are.exec(m[1])) !== null) attrs[am[1]] = am[2] !== undefined ? am[2] : true;
            this._nodes.push({ tagName: "BUTTON", attrs, textContent: m[2].trim(), onclick: null });
          }
        },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) {
          const m = sel.match(/\[([^=]+)="([^"]+)"\]/);
          if (!m) return [];
          return this._nodes.filter((n) => n.attrs[m[1]] === m[2]);
        },
      };

      win.SMD_RESEARCH.screens.manuscript.render(container);
      await new Promise((r) => setTimeout(r, 20));
      container.querySelector('[data-rmd="full-draft-po"]').onclick();
      await new Promise((r) => setTimeout(r, 20));
      container.querySelector('[data-rmd="po-start"]').onclick();
      await new Promise((r) => setTimeout(r, 60));

      const runnerKey = "runner:draft:job_ui_" + outcome.action;
      assert.ok(cpMap.has(runnerKey), "runner metadata stored under runner:draft: prefix");

      const dfCall = apiCalls.find((c) => c.method === "POST" && c.path.endsWith("/device-fail"));
      assert.ok(dfCall, "deferred /device-fail flushed on " + outcome.action);
      assert.equal(dfCall.body.code, outcome.expectedCode);

      const msState = win.SMD_RESEARCH.screens.manuscript._getState();
      assert.equal(msState.poStatus, "failed", outcome.action + " sets poStatus=failed");
      assert.ok(msState.poError && msState.poError.length > 5, outcome.action + " sets clear poError");

      // Even if draft checkpoint has status:"failed", Continue draft must appear on reopen
      await CP.put("draft:job_ui_" + outcome.action, {
        jobId: "job_ui_" + outcome.action,
        projectId: "prj_m",
        status: "failed",
        manifest: { v: 1, projectId: "prj_m" },
        updatedAt: new Date().toISOString(),
      });
      win.SMD_RESEARCH.screens.manuscript.render(container);
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(container.querySelector('[data-rmd="po-continue"]'), "Continue draft shown for failed-try checkpoint");
    }
  });

  test("concise IMRAD outline default omits verbose Related Work queries, while tryNumber > 1 scopes gateway stepId", async () => {
    const clinicalOut = PROMPTS.buildOutlinePrompt({ ideaMd: "BCG trial", experimentalLogMd: "RR 0.5", templateTex: PROMPTS.IMRAD_TEMPLATE });
    assert.ok(clinicalOut.prompt.indexOf("\"intro_related_work_plan\": set strictly to {}") >= 0);
    assert.equal(clinicalOut.prompt.indexOf("Related Work Strategy (Micro-Level Technical Baselines, 30-50 papers)"), -1);
    const fullLitOut = PROMPTS.buildOutlinePrompt({ ideaMd: "ML", experimentalLogMd: "acc", withLiterature: true });
    assert.ok(fullLitOut.prompt.indexOf("Related Work Strategy") >= 0);

    await CP._setBackend({ records: {} });
    const seenSteps = [];
    await assert.rejects(() => DRAFT.run({
      job: { id: "job_retry_scope", projectId: "p1", createdBy: "u1" },
      manifest: {
        v: 1, projectId: "p1",
        protocol: { title: "SR", question: "Q?", pico: { population: "A", intervention: "B", comparator: "C", outcome: "D" }, design: "sr", eligibility: "e", outcomes: ["D"], lockHash: "a".repeat(64), lockedAt: "2026-11-01T00:00:00Z" },
        evidence: [{ studyId: "s1", label: "S1", values: [{ field: "n", value: 10, verified: true, locator: { page: 1 }, quote: "n=10" }] }],
        runs: [], references: [],
      },
      token: "tok-1",
    }, {
      checkpoint: CP,
      tryNumber: 2,
      gatewayTimeoutMs: 50,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        seenSteps.push(payload.stepId);
        if (payload.stepId === "outline:t2") {
          return new Promise(() => {}); // hang on first outline attempt in try 2
        }
        return { status: 200, data: { text: "bad json", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async () => ({ ok: true }),
    }));
    assert.ok(seenSteps.includes("outline:t2"), "try 2 uses :t2 suffix on outline stepId and times out cleanly");
  });
});

/* ==================== Item 13: PDF screens merge onPage checkpoint ==================== */

describe("Item 13: extract, find, and thesis merge onPage into stored checkpoint", () => {
  test("extract, find, and thesis preserve runner failCount/reasons/jobKey during onPage", async () => {
    const CP = require("../research-ondevice-checkpoint.js");
    const JOBS = require("../research-ondevice-jobs.js");
    makeMemoryCp(CP);

    const sha = "c".repeat(64);
    const makeFakeOd = () => ({
      isEnabled: () => true,
      hasNativeOcr: () => true,
      sha256: async () => sha,
      extract: async (_u8, opts) => {
        await opts.onPage({ pages: [{ n: 1, text: "p1", words: [], tables: [], ocr: true }], sha256: sha, ocr: true, partial: true, nextPage: 2 });
        return { pages: [{ n: 1, text: "p1", words: [], tables: [], ocr: true }], sha256: sha, ocr: true, partial: false, nextPage: 2 };
      },
    });

    // Check extract screen
    {
      const key = "pdf:prj_e:" + sha;
      await CP.put(key, { jobKey: key, running: true, finished: false, failCount: 2, reasons: [{ try: 1 }, { try: 2 }] });
      let seenDuringPage = null;
      const origPut = CP.put;
      const spyCp = Object.assign({}, CP, {
        put: async (k, v) => {
          if (v && Array.isArray(v.pages)) seenDuringPage = v;
          return origPut(k, v);
        },
      });
      const win = {
        document: { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({ style: {}, setAttribute: () => {} }) },
        localStorage: { getItem: () => null, setItem: () => {} },
        SMD_RMD_ONDEVICE_PDF: makeFakeOd(),
        SMD_RMD_CHECKPOINT: spyCp,
        SMD_RMD_JOBS: {
          updateCheckpoint: JOBS.updateCheckpoint,
          runWithFallback: async (_k, runDev) => ({ ok: true, source: "device", result: await runDev({ checkpoint: { failCount: 0, reasons: [] } }) }),
        },
        SMD_RESEARCH: {
          esc: (s) => String(s || ""),
          pdf: { pageByN: () => null, fitPage: () => {} },
          p2: { loadingHtml: (t) => String(t), friendlyError: (e) => ({ message: String(e && e.message) }) },
          store: { getActiveProject: () => ({ id: "prj_e", serverId: null }), getStudies: () => [{ id: "st_1", title: "S1" }] },
          api: {
            request: async (_m, url) => {
              if (String(url).indexOf("/studies") >= 0 && String(url).indexOf("/extraction") < 0) {
                return { studies: [{ id: "st_1", title: "S1" }] };
              }
              return { extraction: null };
            },
          },
        },
      };
      win.window = win;
      win.globalThis = win;
      const ctx = vm.createContext(Object.assign(win, {
        Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math, Uint8Array, ArrayBuffer,
        isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
      }));
      vm.runInContext(readSrc("research-screen-extract.js"), ctx);
      let fileInput = { files: [] };
      let uploadBtn = null;
      const htmlBox = {
        _h: "",
        get innerHTML() { return this._h; },
        set innerHTML(v) {
          this._h = v;
          if (v.indexOf("extract-upload-pdf") >= 0) {
            uploadBtn = { onclick: null };
          }
        },
        querySelector: (s) => {
          if (s === "#rmdExtractPdfFile") return fileInput;
          return null;
        },
        querySelectorAll: (s) => {
          if (s === '[data-rmd="extract-upload-pdf"]' && uploadBtn) return [uploadBtn];
          return [];
        },
      };
      win.SMD_RESEARCH.screens.extract.render(htmlBox, { projectId: "prj_e", studyId: "st_1" });
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(uploadBtn && typeof uploadBtn.onclick === "function", "extract upload button bound");
      fileInput.files = [{ name: "s.pdf", type: "application/pdf", size: 200, arrayBuffer: async () => new Uint8Array(10).buffer }];
      uploadBtn.onclick();
      await new Promise((r) => setTimeout(r, 40));
      assert.ok(seenDuringPage, "extract onPage wrote checkpoint");
      assert.equal(seenDuringPage.failCount, 2, "extract onPage preserved stored failCount");
      assert.equal(seenDuringPage.reasons.length, 2, "extract onPage preserved stored reasons");
      assert.equal(seenDuringPage.jobKey, key, "extract onPage preserved stored jobKey");
    }

    // Check thesis screen onPage merge
    {
      const key = "pdf:prj_t:" + sha;
      await CP.put(key, { jobKey: key, running: true, finished: false, failCount: 1, reasons: [{ try: 1 }] });
      let seenDuringPage = null;
      const origPut = CP.put;
      const spyCp = Object.assign({}, CP, {
        put: async (k, v) => {
          if (v && Array.isArray(v.pages)) seenDuringPage = v;
          return origPut(k, v);
        },
      });
      const win = {
        document: { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({ style: {}, setAttribute: () => {} }) },
        localStorage: { getItem: () => null, setItem: () => {} },
        pdfjsLib: {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 1,
              getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
              destroy: () => {},
            }),
          }),
        },
        SMD_RMD_ONDEVICE_PDF: makeFakeOd(),
        SMD_RMD_CHECKPOINT: spyCp,
        SMD_RMD_JOBS: {
          updateCheckpoint: JOBS.updateCheckpoint,
          runWithFallback: async (_k, runDev) => ({ ok: true, source: "device", result: await runDev({ checkpoint: { failCount: 0, reasons: [] } }) }),
        },
        SMD_RESEARCH: {
          esc: (s) => String(s || ""),
          p2: { loadingHtml: (t) => String(t), friendlyError: (e) => ({ message: String(e && e.message) }) },
          store: { getActiveProject: () => ({ id: "prj_t", serverId: null }) },
          api: { request: async () => ({}) },
        },
      };
      win.window = win;
      win.globalThis = win;
      const ctx = vm.createContext(Object.assign(win, {
        Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math, Uint8Array, ArrayBuffer,
        isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
      }));
      vm.runInContext("var module = { exports: {} };", ctx);
      vm.runInContext(readSrc("research-screen-thesis.js"), ctx);
      const container = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
      win.SMD_RESEARCH.screens.thesis.render(container);
      ctx.module.exports.handleFile({ name: "th.pdf", type: "application/pdf", size: 200, arrayBuffer: async () => new Uint8Array(10).buffer }, container);
      await new Promise((r) => setTimeout(r, 40));
      assert.ok(seenDuringPage, "thesis onPage wrote checkpoint");
      assert.equal(seenDuringPage.failCount, 1, "thesis onPage preserved stored failCount");
      assert.equal(seenDuringPage.reasons.length, 1, "thesis onPage preserved stored reasons");
      assert.equal(seenDuringPage.jobKey, key, "thesis onPage preserved stored jobKey");
    }
  });
});

/* ==================== Item 17: research-po-gates.js ES5 lookbehind removal ==================== */

describe("Item 17: research-po-gates.js ES5 regex parity without lookbehinds", () => {
  const GATES = require("../research-po-gates.js");

  test("scanPhi preserves exact boundary & overlapping matches without lookbehinds", () => {
    // Adjacent invalid + valid phone: "9+91 9876543210" -> must catch 9876543210
    const pHit = GATES.scanPhi("Call 9+91 9876543210 now");
    assert.equal(pHit.blocked, true);
    assert.ok(pHit.hits.some((h) => h.category === "phone"));

    // 13-digit run must not trigger 12-digit Aadhaar or 10-digit NHS
    assert.equal(GATES.scanPhi("Value 9999999999999").blocked, false);

    // Full date after letter still matches in user mode, after digit does not
    assert.equal(GATES.scanPhi("a12/01/2020", { mode: "user" }).blocked, true);
    assert.equal(GATES.scanPhi("112/01/2020", { mode: "user" }).blocked, false);
  });

  test("latexToText and gates behave identically without lookbehinds", () => {
    const tex =
      "\\begin{tabular}{ll}\n" +
      "A & B \\\\\n" +
      "C \\& D & E \\\\\n" +
      "\\end{tabular}\n" +
      "\\begin{itemize}\n" +
      "  \\item First\n" +
      "  \\item[x] Second\n" +
      "\\end{itemize}\n" +
      "Inline $x + y$, display $$a + b$$, parens \\(c\\), brackets \\[d\\], escaped \\$50 and Table~1 and \\~.";
    const txt = GATES.latexToText(tex);
    assert.ok(txt.includes("A | B"));
    assert.ok(txt.includes("C & D | E"));
    assert.ok(txt.includes("- First"));
    assert.ok(txt.includes("- x Second"));
    assert.ok(txt.includes("x + y") && txt.includes("a + b") && txt.includes("c") && txt.includes("d"));
    assert.ok(txt.includes("escaped $50"));
    assert.ok(txt.includes("Table 1"));

    // I2 and v1.2 number gate checks (matches pre-ES5-refactor offsets exactly)
    assert.deepEqual(GATES.checkNumbers([
      { id: "results", heading: "Results", text: "Heterogeneity I2 was 50% and software v1.2 was used." },
    ], {}), [
      { gate: "untokenised_number", section: "results", start: 41, end: 42, number: "2" },
    ]);

    // Sentence split preserves terminal punctuation
    const claim = GATES.checkClaimLinks([
      { id: "discussion", heading: "Discussion", text: "First sentence!  The drug reduced mortality?We saw this." },
    ]);
    assert.ok(claim.some((v) => v.gate === "claim_without_source"));
  });
});

/* ==================== Item 18: research-screen-find.js single-request upload ==================== */

function makeFindDomEnv(opts = {}) {
  const docRegistry = {};
  const nodesByAttr = {};
  const fileInputs = [];
  const registerHtml = (el, html) => {
    el._html = html;
    for (const k of Object.keys(nodesByAttr)) delete nodesByAttr[k];
    const addNodes = (attrName, re) => {
      nodesByAttr[attrName] = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        const attrVal = m[1];
        const node = {
          _attr: attrVal,
          disabled: false,
          checked: false,
          files: attrName === "data-find-file" ? [{ name: "paper.pdf", size: 200, arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 x").buffer }] : [],
          textContent: "",
          onclick: null,
          onchange: null,
          getAttribute: (a) => (a === attrName ? attrVal : null),
          setAttribute: (k, v) => { if (k === "disabled") node.disabled = true; },
          removeAttribute: (k) => { if (k === "disabled") node.disabled = false; },
          click: () => {},
        };
        nodesByAttr[attrName].push(node);
        if (attrName === "data-find-file") fileInputs.push(node);
      }
    };
    addNodes("data-find", /data-find=["']([^"']+)["']/g);
    addNodes("data-find-check", /data-find-check=["']([^"']+)["']/g);
    addNodes("data-find-file", /data-find-file=["']([^"']+)["']/g);
  };
  const win = {
    document: {
      getElementById: (id) => docRegistry[id] || null,
      head: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: () => {
        let id = "";
        const el = {
          _html: "",
          style: {},
          attributes: {},
          get innerHTML() { return this._html; },
          set innerHTML(v) { registerHtml(this, v); },
          setAttribute(k, v) { this.attributes[k] = v; if (k === "id") this.id = v; },
          querySelector: (sel) => {
            const m = sel.match(/^\[([a-zA-Z0-9_-]+)=["']([^"']+)["']\]$/);
            if (m && nodesByAttr[m[1]]) return nodesByAttr[m[1]].find((n) => n._attr === m[2]) || null;
            return null;
          },
          querySelectorAll: (sel) => {
            const m = sel.match(/^\[([a-zA-Z0-9_-]+)\]$/);
            if (m && nodesByAttr[m[1]]) return nodesByAttr[m[1]];
            const eq = sel.match(/^\[([a-zA-Z0-9_-]+)=["']([^"']+)["']\]$/);
            if (eq && nodesByAttr[eq[1]]) return nodesByAttr[eq[1]].filter((n) => n._attr === eq[2]);
            return [];
          },
        };
        Object.defineProperty(el, "id", {
          get: () => id,
          set: (v) => { id = String(v); docRegistry[id] = el; },
          configurable: true,
        });
        return el;
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    FormData: class FakeFormData {
      constructor() { this.fields = []; }
      append(k, v) { this.fields.push([k, v]); }
    },
    ...opts.globals,
  };
  win.window = win;
  win.globalThis = win;
  docRegistry["researchMD"] = { appendChild: () => {} };
  docRegistry["rmd_find_query"] = { value: "test query", oninput: null, onkeydown: null };
  docRegistry["rmd_find_outcome"] = { value: "mortality", oninput: null };
  return { win, docRegistry, nodesByAttr, fileInputs };
}

describe("Item 13 & 18: research-screen-find.js onPage merge and single-request /pdf-uploads", () => {
  test("find onPage preserves stored failCount/reasons/jobKey (Item 13)", async () => {
    const CP = require("../research-ondevice-checkpoint.js");
    const JOBS = require("../research-ondevice-jobs.js");
    makeMemoryCp(CP);
    const sha = "e".repeat(64);
    const key = "pdf:prj_find_cp:" + sha;
    await CP.put(key, { jobKey: key, running: true, finished: false, failCount: 2, reasons: [{ try: 1 }, { try: 2 }] });
    let seenDuringPage = null;
    const origPut = CP.put;
    const spyCp = Object.assign({}, CP, {
      put: async (k, v) => {
        if (v && Array.isArray(v.pages)) seenDuringPage = v;
        return origPut(k, v);
      },
    });
    const { win, docRegistry, nodesByAttr, fileInputs } = makeFindDomEnv({
      globals: {
        SMD_RMD_ONDEVICE_PDF: {
          isEnabled: () => true,
          sha256: async () => sha,
          extract: async (_u8, opts) => {
            await opts.onPage({ pages: [{ n: 1, text: "p1", words: [], tables: [], ocr: true }], sha256: sha, ocr: true, partial: true, nextPage: 2 });
            return { pages: [{ n: 1, text: "p1", words: [], tables: [], ocr: true }], sha256: sha, ocr: true, partial: false, nextPage: 2 };
          },
        },
        SMD_RMD_CHECKPOINT: spyCp,
        SMD_RMD_JOBS: {
          updateCheckpoint: JOBS.updateCheckpoint,
          runWithFallback: async (_k, runDev) => ({ ok: true, source: "device", result: await runDev({ checkpoint: { failCount: 0, reasons: [] } }) }),
        },
        SMD_RESEARCH: {
          on: () => true,
          esc: (s) => String(s || ""),
          p2: { flashNotice: () => {}, friendlyError: (e) => ({ message: String(e && e.message) }) },
          api: {
            request: async (_m, url) => {
              if (url.indexOf("/find-studies") >= 0) {
                return { results: [{ source: "pubmed", pmid: "999", title: "Paper", authors: ["A B"], year: 2025, journal: "J" }] };
              }
              if (url.indexOf("/auto-add") >= 0) return { results: [{ status: "needs_pdf" }] };
              return {};
            },
          },
        },
      },
    });
    const ctx = vm.createContext(Object.assign(win, {
      Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math, Uint8Array, ArrayBuffer,
      isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
    }));
    vm.runInContext(readSrc("research-screen-find.js"), ctx);
    win.SMD_RESEARCH.find.open({ id: "prj_find_cp", serverId: "prj_find_cp", title: "Find Proj" });
    docRegistry["rmd_find_query"].onkeydown({ key: "Enter", keyCode: 13, preventDefault: () => {} });
    await new Promise((r) => setTimeout(r, 30));
    const chk = nodesByAttr["data-find-check"][0];
    chk.checked = true;
    chk.onchange();
    nodesByAttr["data-find"].find((n) => n._attr === "add").onclick();
    await new Promise((r) => setTimeout(r, 40));
    const latestInput = fileInputs[fileInputs.length - 1];
    latestInput.onchange.call(latestInput);
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(seenDuringPage, "find onPage wrote checkpoint");
    assert.equal(seenDuringPage.failCount, 2, "find onPage preserved stored failCount");
    assert.equal(seenDuringPage.reasons.length, 2, "find onPage preserved stored reasons");
    assert.equal(seenDuringPage.jobKey, key, "find onPage preserved stored jobKey");
  });

  test("cloud fallback calls POST /v1/projects/:id/pdf-uploads instead of /pdfs + /jobs (Item 18)", async () => {
    const uploads = [];
    const requests = [];
    const CP = require("../research-ondevice-checkpoint.js");
    makeMemoryCp(CP);
    const JOBS = require("../research-ondevice-jobs.js");
    const { win, docRegistry, nodesByAttr, fileInputs } = makeFindDomEnv({
      globals: {
        SMD_RMD_ONDEVICE_PDF: {
          isEnabled: () => true,
          sha256: async () => "d".repeat(64),
          extract: async () => { throw Object.assign(new Error("ocr-failed"), { code: "ocr-failed" }); },
        },
        SMD_RMD_CHECKPOINT: CP,
        SMD_RMD_JOBS: {
          updateCheckpoint: JOBS.updateCheckpoint,
          runWithFallback: (kind, runDev, runCloud, opts) => JOBS.runWithFallback(kind, runDev, runCloud, Object.assign({}, opts, {
            checkpointStore: CP,
            retryDelayMs: 1,
            checkQuota: async () => ({ plan: "pro", allowance: 25, used: 0, remaining: 25 }),
            onNeedsCloud: async () => ({ action: "continue" }),
          })),
        },
        SMD_RESEARCH: {
          on: () => true,
          esc: (s) => String(s || ""),
          p2: { flashNotice: () => {}, friendlyError: (e) => ({ message: String(e && e.message) }) },
          api: {
            upload: async (url, fd) => {
              uploads.push({ url, fd });
              return { artifact: { id: "art_find_1", status: "queued", jobId: "j_find_1" } };
            },
            request: async (m, url, body) => {
              requests.push({ m, url, body });
              if (url.indexOf("/find-studies") >= 0) {
                return { results: [{ source: "pubmed", pmid: "12345", title: "Find Paper", authors: ["A B"], year: 2025, journal: "J" }] };
              }
              if (url.indexOf("/auto-add") >= 0) {
                return { results: [{ status: "needs_pdf" }] };
              }
              return {};
            },
          },
        },
      },
    });

    const ctx = vm.createContext(Object.assign(win, {
      Promise, Error, Object, Array, RegExp, String, JSON, Date, Number, Math, Uint8Array, ArrayBuffer,
      isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, setTimeout, clearTimeout,
    }));
    vm.runInContext(readSrc("research-screen-find.js"), ctx);

    win.SMD_RESEARCH.find.open({ id: "prj_find", serverId: "prj_find", title: "Find Proj" });
    assert.ok(docRegistry["rmdFindSheet"], "rmdFindSheet registered");

    docRegistry["rmd_find_query"].onkeydown({ key: "Enter", keyCode: 13, preventDefault: () => {} });
    await new Promise((r) => setTimeout(r, 30));

    const chk = nodesByAttr["data-find-check"][0];
    chk.checked = true;
    chk.onchange();
    nodesByAttr["data-find"].find((n) => n._attr === "add").onclick();
    await new Promise((r) => setTimeout(r, 40));

    const latestInput = fileInputs[fileInputs.length - 1];
    assert.ok(latestInput && typeof latestInput.onchange === "function", "PDF file input bound");
    latestInput.onchange.call(latestInput);
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].url, "/v1/projects/prj_find/pdf-uploads", "must use single-request /pdf-uploads");
    assert.equal(requests.some((r) => r.url.endsWith("/pdfs") || r.url.endsWith("/jobs")), false, "must not use legacy 2-step /pdfs + /jobs");
  });
});
