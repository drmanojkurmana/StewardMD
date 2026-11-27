/* test/research-ready-state.test.mjs
 * Live BUG-09 (part): the Submit (ready) screen must use one source of truth.
 * - Checklist approval is read from the project snapshot the Checklist screen
 *   writes (checklistManual entry "checklist_approval"), so both screens agree.
 * - The Submission & Publication pill never says "Ready to Submit" while the
 *   readiness list still shows a Missing item.
 * - format-check is not requested before a manuscript exists (no avoidable 404).
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-ready-state.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const CARE = JSON.parse(read("data/research-checklists/care.json"));

function createSandbox(responses) {
  const calls = [];
  const ls = new Map();
  const win = {
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return {}; },
      getElementById: function () { return null; },
      head: { appendChild: function () {} }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: function (k) { return ls.has(k) ? ls.get(k) : null; },
      setItem: function (k, v) { ls.set(k, String(v)); }
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
    addEventListener: function () {},
    fetch: async function (url, init) {
      const p = decodeURIComponent(String(url));
      calls.push({ url: p, init: init });
      const key = Object.keys(responses).find((k) => p === "/api/research" + k);
      if (!key) {
        return {
          ok: false,
          status: 404,
          text: async function () { return JSON.stringify({ error: { code: "not_found", message: "Unknown Research API endpoint" } }); }
        };
      }
      const r = responses[key];
      if (r.__status) {
        return {
          ok: false,
          status: r.__status,
          text: async function () { return JSON.stringify({ error: { code: r.__code || "not_found", message: "not found" } }); }
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(r); }
      };
    }
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read("research-checklist.js"), ctx);
  vm.runInContext(read("research.js"), ctx);
  win.SMD_RESEARCH.store = {
    getActiveProject: function () {
      return { id: "p1", serverId: "p1", title: "Ready state test", studyType: "Case Report" };
    }
  };
  return { win: win, ctx: ctx, calls: calls };
}

function createContainer() {
  return {
    innerHTML: "",
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

const BASE = {
  "/v1/checklists/care": { checklist: CARE },
  "/v1/projects/p1/checklist-snapshot": { snapshot: {} }
};

function renderReadyAsync(sb, container) {
  sb.win.SMD_RESEARCH.screens.ready.render(container);
  return new Promise(function (resolve) { setTimeout(resolve, 25); });
}

describe("Submit (ready) screen single source of truth (BUG-09)", () => {
  test("unapproved checklist with missing items: Missing item, Draft pill, disabled submit", async () => {
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { manuscript: { id: "m1", status: "draft", sections: [] } }
    }));
    const container = createContainer();
    await renderReadyAsync(sb, container);
    const html = container.innerHTML;

    assert.ok(html.indexOf("Some reporting checklist items are still missing.") >= 0, "missing item is shown");
    assert.ok(html.indexOf("Draft</span>") >= 0, "pill says Draft, not Ready to Submit");
    assert.ok(html.indexOf("Ready to Submit</span>") < 0, "pill must not say Ready to Submit while an item is Missing");
    assert.ok(/data-rmd="submit-paper"[^>]* disabled/.test(html), "Confirm & Submit Paper stays disabled");
    assert.ok(html.indexOf("Complete approval and checklist items above to unlock submit.") >= 0, "disabled reason is shown");
  });

  test("approved checklist via snapshot checklistManual counts as done even when fill counts lag", async () => {
    const approval = JSON.stringify({ approved: true, guidelineId: "care", approvedAt: 1770000000000 });
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { manuscript: { id: "m1", status: "approved", sections: [] } },
      "/v1/projects/p1/checklist-snapshot": { snapshot: { checklistManual: { care: { checklist_approval: approval } } } },
      "/v1/projects/p1/format-check": { checks: [{ check: "word_count", status: "pass", label: "Manuscript word count" }] }
    }));
    const container = createContainer();
    await renderReadyAsync(sb, container);
    const html = container.innerHTML;

    assert.ok(html.indexOf("The reporting checklist is complete.") >= 0, "checklist item reads Done from the approval record");
    assert.ok(html.indexOf("Some reporting checklist items are still missing.") < 0, "no contradictory Missing line");
    assert.ok(html.indexOf("Ready to Submit</span>") >= 0, "pill agrees: Ready to Submit");
    assert.ok(/data-rmd="submit-paper"[^>]*>/.test(html) && !/data-rmd="submit-paper"[^>]* disabled/.test(html), "submit is enabled");
    assert.ok(html.indexOf("Open the submission pack") >= 0, "primary action opens the pack");
    assert.ok(sb.calls.some((c) => c.url.indexOf("/format-check") >= 0), "format-check runs when a manuscript exists");
  });

  test("no manuscript yet: no format-check request, so no avoidable 404", async () => {
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { __status: 404, __code: "manuscript_not_found" }
    }));
    const container = createContainer();
    await renderReadyAsync(sb, container);

    assert.ok(sb.calls.some((c) => c.url.indexOf("/manuscript") >= 0), "the manuscript itself is still checked");
    assert.ok(!sb.calls.some((c) => c.url.indexOf("/format-check") >= 0), "format-check is not requested without a manuscript");
    const html = container.innerHTML;
    assert.ok(html.indexOf("Draft</span>") >= 0, "screen renders with a Draft pill");
    assert.ok(html.indexOf("The manuscript still needs clinician approval.") >= 0, "manuscript approval still reported missing");
  });

  test("approval parsed from a plain string entry and any guideline group", async () => {
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { manuscript: { id: "m1", status: "approved", sections: [] } },
      "/v1/projects/p1/checklist-snapshot": { snapshot: { checklistManual: { other: { checklist_approval: "approved" } } } }
    }));
    const container = createContainer();
    await renderReadyAsync(sb, container);
    assert.ok(container.innerHTML.indexOf("The reporting checklist is complete.") >= 0, "legacy string form is accepted");
  });

  test("a snapshot without computable counts is not treated as complete", async () => {
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { manuscript: { id: "m1", status: "approved", sections: [] } },
      "/v1/projects/p1/checklist-snapshot": { snapshot: { projectTitle: "anything" } }
    }));
    sb.win.SMD_RESEARCH_CHECKLIST = null; // counts cannot be computed
    const container = createContainer();
    await renderReadyAsync(sb, container);
    assert.ok(container.innerHTML.indexOf("Some reporting checklist items are still missing.") >= 0,
      "missing counts no longer pass just because a snapshot exists");
  });

  test("targetJournal from project or thesis store drives format-check and display instead of defaulting to JAMA", async () => {
    let waited = false;
    const sb = createSandbox(Object.assign({}, BASE, {
      "/v1/projects/p1/manuscript": { manuscript: { id: "m1", status: "approved", sections: [] } },
      "/v1/projects/p1/checklist-snapshot": { snapshot: {} },
      "/v1/projects/p1/format-check?journal=ijccm": { journalId: "ijccm", journalName: "Indian Journal of Critical Care Medicine", checks: [{ check: "word_count", status: "pass", detail: "Within limit" }] }
    }));
    sb.win.localStorage.setItem("smd_rmd_thesis_v1", JSON.stringify({
      p1: { journal: { id: "ijccm", shortName: "IJCCM", name: "Indian Journal of Critical Care Medicine", wordLimit: 3000 } }
    }));
    sb.win.SMD_RESEARCH_THESIS = {
      pendingSave: function () {
        return new Promise(function (resolve) { setTimeout(function () { waited = true; resolve(true); }, 5); });
      }
    };
    const container = createContainer();
    await renderReadyAsync(sb, container);
    assert.equal(waited, true, "awaits pending thesis section save before running format-check");
    assert.ok(sb.calls.some((c) => c.url.indexOf("/format-check?journal=ijccm") >= 0), "uses chosen thesis journal ijccm for format-check");
    assert.ok(!sb.calls.some((c) => c.url.indexOf("journal=jama") >= 0), "does not fall back to JAMA when journal is chosen");
    assert.ok(container.innerHTML.indexOf("Indian Journal of Critical Care Medicine") >= 0, "heading shows chosen journal name");
  });
});
