/* test/research-ai-draft-phi-client.test.mjs
 * Client-side PHI redaction and scan gate on POST /ai-draft in research.js.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-ai-draft-phi-client.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHI_INDIA_SRC = readFileSync(join(ROOT, "phi-india.js"), "utf8");
const RESEARCH_PHI_SRC = readFileSync(join(ROOT, "research-phi.js"), "utf8");
const RESEARCH_SRC = readFileSync(join(ROOT, "research.js"), "utf8");
const REASONING_SRC = readFileSync(join(ROOT, "reasoning.js"), "utf8");
const REDACT_FN_BODY = REASONING_SRC.slice(
  REASONING_SRC.indexOf("  function redactPHI(text) {"),
  REASONING_SRC.indexOf("  window.SMD_redactPHI = redactPHI;")
);

const EXPECTED_MSG = "Remove patient identifiers (names, IDs, phone numbers, dates) before drafting.";

function createSandbox(opts) {
  const options = opts || {};
  const fetchCalls = [];
  const capCalls = [];
  const store = new Map();

  const win = {
    document: {
      querySelector: function () { return null; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return {}; }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: function (k) { return store.has(k) ? store.get(k) : null; },
      setItem: function (k, v) { store.set(k, String(v)); }
    },
    Promise: Promise,
    Error: Error,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    String: String,
    JSON: JSON,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    fetch: async function (url, init) {
      fetchCalls.push({ url: url, init: init });
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({ draft: { ok: true }, model: "mock", costInr: 0 });
        }
      };
    }
  };

  if (options.withCapacitor) {
    win.Capacitor = {
      Plugins: {
        CapacitorHttp: {
          request: async function (reqOpts) {
            capCalls.push(reqOpts);
            return { status: 200, data: { draft: { ok: true } } };
          }
        }
      }
    };
  }

  win.window = win;
  win.self = win;
  win.globalThis = win;

  const ctx = vm.createContext(win);

  if (options.loadPhiIndia !== false) {
    vm.runInContext(PHI_INDIA_SRC, ctx);
  }
  if (options.loadRedactPhi !== false) {
    vm.runInContext(
      "(function (window) {\n" + REDACT_FN_BODY + "\n  window.SMD_redactPHI = redactPHI;\n})(window);",
      ctx
    );
  }
  if (options.loadResearchPhi !== false) {
    vm.runInContext(RESEARCH_PHI_SRC, ctx);
  }

  vm.runInContext(RESEARCH_SRC, ctx);

  return { win: win, ctx: ctx, fetchCalls: fetchCalls, capCalls: capCalls };
}

describe("research.js apiRequest client PHI gate for POST /ai-draft", () => {
  test("clean nested input passes through to fetch, redacted copy sent, caller body unchanged", async () => {
    const sb = createSandbox();
    const callerBody = {
      task: "manuscript_draft",
      input: {
        title: "Sepsis lactate clearance cohort",
        notes: ["Mean lactate 3.2 mmol/L", { detail: "No adverse events reported" }]
      }
    };
    const snapshot = JSON.stringify(callerBody);

    const res = await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", callerBody);
    assert.equal(res.draft.ok, true);
    assert.equal(sb.fetchCalls.length, 1);
    assert.equal(sb.fetchCalls[0].url, "/api/research/v1/projects/p1/ai-draft");
    assert.equal(sb.fetchCalls[0].init.body, snapshot);
    assert.equal(JSON.stringify(callerBody), snapshot);

    // Query-string variant also matches /\/ai-draft(\?|$)/
    await sb.win.SMD_RESEARCH.api.request("post", "/v1/projects/p1/ai-draft?section=methods", callerBody);
    assert.equal(sb.fetchCalls.length, 2);
  });

  test("input with 10-digit Indian mobile and Aadhaar-like ID is redacted without mutating caller body", async () => {
    const sb = createSandbox();
    const callerBody = {
      task: "case_report_draft",
      input: {
        caseText: "Contact 9876543210, Aadhaar 1234 5678 9012, alt 999988887777.",
        nested: ["Masked XXXX XXXX 1234"]
      }
    };
    const origText = callerBody.input.caseText;
    const origNested = callerBody.input.nested[0];

    await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", callerBody);
    assert.equal(sb.fetchCalls.length, 1);

    const sent = JSON.parse(sb.fetchCalls[0].init.body);
    assert.doesNotMatch(sent.input.caseText, /9876543210/);
    assert.doesNotMatch(sent.input.caseText, /1234 5678 9012/);
    assert.doesNotMatch(sent.input.caseText, /999988887777/);
    assert.doesNotMatch(sent.input.nested[0], /XXXX XXXX 1234/);
    assert.match(sent.input.caseText, /\[redacted\]/);

    // Caller object must remain completely untouched
    assert.equal(callerBody.input.caseText, origText);
    assert.equal(callerBody.input.nested[0], origNested);
  });

  test("residual PHI hits from RMDPhi.scan block request and do not call fetch or leak matched text", async () => {
    // Case A: real RMDPhi.scan catches "March 12" (unredacted by base redactPHI)
    const sbReal = createSandbox();
    const secretDate = "March 12";
    await assert.rejects(
      async () => {
        await sbReal.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
          task: "case_report_draft",
          input: { notes: ["Admitted on " + secretDate + " with fever"] }
        });
      },
      (err) => {
        assert.ok(err instanceof sbReal.win.Error);
        assert.equal(err.code, "phi_blocked");
        assert.equal(err.status, 0);
        assert.equal(err.message, EXPECTED_MSG);
        assert.equal(err.message.indexOf(secretDate), -1);
        return true;
      }
    );
    assert.equal(sbReal.fetchCalls.length, 0);

    // Case B: if a 10-digit mobile and Aadhaar-like ID survive upstream redaction, RMDPhi.scan blocks and fetch is not called
    const sbPassThroughRedactor = createSandbox();
    sbPassThroughRedactor.win.SMD_redactPHI = function (s) { return s; };
    sbPassThroughRedactor.win.SMD_PHI_INDIA = { apply: function (s) { return s; } };
    const mobile = "9876543210";
    const aadhaar = "1234 5678 9012";
    await assert.rejects(
      async () => {
        await sbPassThroughRedactor.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
          task: "polish",
          input: { text: "Mobile " + mobile + " Aadhaar " + aadhaar }
        });
      },
      (err) => {
        assert.equal(err.code, "phi_blocked");
        assert.equal(err.status, 0);
        assert.equal(err.message, EXPECTED_MSG);
        assert.equal(err.message.indexOf(mobile), -1);
        assert.equal(err.message.indexOf(aadhaar), -1);
        return true;
      }
    );
    assert.equal(sbPassThroughRedactor.fetchCalls.length, 0);
  });

  test("any one missing PHI module blocks with code phi_blocked and does not call fetch or CapacitorHttp", async () => {
    const configs = [
      { name: "missing SMD_redactPHI", opts: { loadRedactPhi: false, withCapacitor: true } },
      { name: "missing SMD_PHI_INDIA", opts: { loadPhiIndia: false, withCapacitor: true } },
      { name: "missing RMDPhi", opts: { loadResearchPhi: false, withCapacitor: true } },
      { name: "SMD_PHI_INDIA.apply not a function", opts: { withCapacitor: true }, mutate: (w) => { w.SMD_PHI_INDIA = {}; } },
      { name: "RMDPhi.scan not a function", opts: { withCapacitor: true }, mutate: (w) => { w.RMDPhi = {}; } }
    ];

    for (const cfg of configs) {
      const sb = createSandbox(cfg.opts);
      if (cfg.mutate) cfg.mutate(sb.win);
      await assert.rejects(
        async () => {
          await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
            task: "protocol",
            input: { text: "Clean clinical trial text" }
          });
        },
        (err) => {
          assert.equal(err.code, "phi_blocked", cfg.name);
          assert.equal(err.status, 0, cfg.name);
          assert.equal(err.message, EXPECTED_MSG, cfg.name);
          return true;
        }
      );
      assert.equal(sb.fetchCalls.length, 0, cfg.name + " must not call fetch");
      assert.equal(sb.capCalls.length, 0, cfg.name + " must not call CapacitorHttp");
    }
  });

  test("non /ai-draft paths and non-POST methods are untouched (no PHI processing)", async () => {
    const sb = createSandbox({ loadRedactPhi: false, loadPhiIndia: false, loadResearchPhi: false });
    const payload = { input: { note: "9876543210 and 1234 5678 9012" } };
    const snap = JSON.stringify(payload);

    await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/studies", payload);
    await sb.win.SMD_RESEARCH.api.request("GET", "/v1/projects/p1/ai-draft");
    await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft/subpath", payload);

    assert.equal(sb.fetchCalls.length, 3);
    assert.equal(sb.fetchCalls[0].init.body, snap);
    assert.equal(sb.fetchCalls[2].init.body, snap);
  });

  test("false positives pass through unblocked and unaltered", async () => {
    const sb = createSandbox();
    const falsePositives = [
      "doi:10.1016/j.jhep.2023.01.012",
      "PMID: 31234567",
      "Na 138 mmol/L, K 4.2",
      "n = 1234 patients",
      "95% CI 1.12 to 2.34"
    ];

    for (const text of falsePositives) {
      const res = await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
        task: "polish",
        input: { text: text }
      });
      assert.equal(res.draft.ok, true, "Expected pass-through for: " + text);
      const sent = JSON.parse(sb.fetchCalls[sb.fetchCalls.length - 1].init.body);
      assert.equal(sent.input.text, text, "Expected unaltered text for: " + text);
    }
    assert.equal(sb.fetchCalls.length, falsePositives.length);
  });
});
