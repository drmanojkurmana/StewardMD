/* test/research-bug12-live-fixes.test.mjs
 * Live BUG-12 (part): find sheet abstracts render entities once (decode once,
 * escape once), the search run error banner sits next to the button that
 * triggered it, and the institution screen shows a real empty state without
 * requesting inst_default or showing mock data.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-bug12-live-fixes.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

function makeEl(attrs) {
  return {
    onclick: null,
    onsubmit: null,
    onchange: null,
    oninput: null,
    onkeydown: null,
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    attrs: attrs || {},
    getAttribute: function (k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    appendChild: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    focus: function () {}
  };
}

function createSandbox(opts) {
  const options = opts || {};
  const ls = new Map();
  const calls = [];
  const win = {
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return makeEl(); },
      getElementById: function (id) { return options.elements && options.elements[id] ? options.elements[id] : null; },
      head: { appendChild: function () {} },
      body: { appendChild: function () {} }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: function (k) { return ls.has(k) ? ls.get(k) : null; },
      setItem: function (k, v) { ls.set(k, String(v)); }
    },
    Promise: Promise, Error: Error, Object: Object, Array: Array, RegExp: RegExp,
    String: String, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    addEventListener: function () {},
    navigator: { onLine: true },
    fetch: async function (url, init) {
      const p = decodeURIComponent(String(url));
      calls.push({ url: p, init: init, method: (init && init.method) || "GET" });
      const handler = options.route && options.route(p, init);
      if (handler) return handler;
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify({}); }
      };
    }
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  for (const f of (options.files || ["research.js"])) {
    vm.runInContext(read(f), ctx);
  }
  return { win: win, ctx: ctx, calls: calls, ls: ls };
}

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

describe("Find sheet decodes source entities once (BUG-12)", () => {
  test("PubMed abstract with &amp; renders as a single &amp;, never &amp;amp;", async () => {
    const queryInput = makeEl();
    queryInput.value = "BCG tuberculosis";
    const outcomeInput = makeEl();
    const searchBtn = makeEl();
    const sheet = makeEl();
    sheet.querySelectorAll = function (sel) {
      if (sel === '[data-find="search"]') return [searchBtn];
      return [];
    };
    const elements = {
      rmdFindSheet: sheet,
      researchMD: makeEl(),
      rmd_find_query: queryInput,
      rmd_find_outcome: outcomeInput
    };
    const sb = createSandbox({
      elements: elements,
      files: ["research.js", "research-screen-find.js"],
      route: function (p) {
        if (p.indexOf("/find-studies") >= 0) {
          return {
            ok: true, status: 200,
            text: async function () {
              return JSON.stringify({
                results: [
                  {
                    pmid: "31234",
                    title: "Iron &amp; tuberculosis review",
                    abstract: "BACKGROUND &amp; OBJECTIVES: Iron status and tuberculosis. METHODS &amp; DESIGN: cohort.",
                    authors: ["Patel R"],
                    journal: "J Synth",
                    year: 2024
                  }
                ]
              });
            }
          };
        }
        if (p.indexOf("/protocols") >= 0) {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ protocols: [] }); } };
        }
        return null;
      }
    });
    sb.win.SMD_RESEARCH.store = {
      getActiveProject: function () {
        return { id: "p1", serverId: "p1", title: "Find sheet test" };
      }
    };

    sb.win.SMD_RESEARCH.find.open({ id: "p1", serverId: "p1", title: "Find sheet test" });
    assert.ok(sheet.innerHTML.indexOf("Find and add studies") >= 0, "sheet rendered");

    assert.ok(searchBtn.onclick, "search button bound");
    searchBtn.onclick.call(searchBtn);
    await sleep(20);

    const html = sheet.innerHTML;
    assert.ok(html.indexOf("&amp;amp;") < 0, "no double-escaped entity");
    assert.ok(html.indexOf("BACKGROUND &amp; OBJECTIVES") >= 0, "entity decoded then escaped once");
    assert.ok(html.indexOf("Iron &amp; tuberculosis") >= 0, "title entity decoded then escaped once");
  });
});

describe("Search run error banner sits by the Run button (BUG-12)", () => {
  test("429 error renders under the search-run button, not above the query", async () => {
    const runBtn = makeEl();
    const queryTa = makeEl();
    queryTa.value = "BCG AND tuberculosis";
    const container = {
      innerHTML: "",
      querySelector: function (sel) {
        if (sel === "#rmd_search_query") return queryTa;
        if (sel === "#rmd_topic_q") return makeEl();
        return null;
      },
      querySelectorAll: function (sel) {
        if (sel === '[data-rmd="search-run"]') return [runBtn];
        return [];
      }
    };
    const sb = createSandbox({
      files: ["research.js", "research-screen-search.js"],
      route: function (p, init) {
        if (p.indexOf("/searches?limit") >= 0) {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ searchRuns: [] }); } };
        }
        if (p.indexOf("/searches") >= 0 && init && init.method === "POST") {
          return {
            ok: false, status: 429,
            text: async function () { return JSON.stringify({ error: { code: "rate_limited", message: "This search matched too many articles for daytime PubMed limits." } }); }
          };
        }
        return null;
      }
    });
    sb.win.SMD_RESEARCH.store = {
      getActiveProject: function () {
        return { id: "p1", serverId: "p1", title: "Search banner test", studyType: "Systematic Review & Meta-Analysis" };
      }
    };

    sb.win.SMD_RESEARCH.screens.search.render(container);
    await sleep(20);
    assert.ok(queryTa.oninput, "query textarea bound after load");
    queryTa.oninput.call(queryTa);
    runBtn.onclick.call(runBtn);
    await sleep(30);

    const html = container.innerHTML;
    assert.ok(/rate limit/i.test(html), "the 429 message renders");
    const btnIdx = html.indexOf('data-rmd="search-run"');
    const errIdx = html.indexOf('data-rmd="search-run-error"');
    assert.ok(btnIdx >= 0, "run button present");
    assert.ok(errIdx > btnIdx, "error banner is after the run button, right beside it");
    assert.ok(html.indexOf("Enter a query") < 0, "no stale validation error");
    const queryIdx = html.indexOf('id="rmd_search_query"');
    assert.ok(queryIdx < errIdx, "error comes after the query textarea too, i.e. at the bottom of the card");
  });
});

describe("Institution screen empty state without inst_default (BUG-12)", () => {
  test("no institutions: exactly one request, a clear empty state, no mock data", async () => {
    const container = {
      innerHTML: "",
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    };
    const sb = createSandbox({
      files: ["research.js", "research-screen-institution.js"],
      route: function (p) {
        if (p === "/api/research/v1/institutions") {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ institutions: [] }); } };
        }
        return null;
      }
    });

    sb.win.SMD_RESEARCH.screens.institution.render(container);
    await sleep(30);

    assert.equal(sb.calls.filter((c) => c.url.indexOf("/api/research/v1/institutions") >= 0).length, 1,
      "only the institutions list is requested, never seats/projects/onboarding");
    assert.ok(!sb.calls.some((c) => c.url.indexOf("inst_default") >= 0), "no inst_default request");

    const html = container.innerHTML;
    assert.ok(html.indexOf("No institution workspace yet") >= 0, "clear empty state");
    assert.ok(html.indexOf("not part of an institution workspace") >= 0, "empty state explains itself");
    assert.ok(html.indexOf("Medical Research Institute") < 0, "no mock institution name");
    assert.ok(html.indexOf("u_admin") < 0, "no mock members");
    assert.ok(html.indexOf("Institutional Review 2026") < 0, "no mock projects");
  });

  test("a real institution still loads seats, projects and onboarding", async () => {
    const container = {
      innerHTML: "",
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    };
    const sb = createSandbox({
      files: ["research.js", "research-screen-institution.js"],
      route: function (p) {
        if (p === "/api/research/v1/institutions") {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ institutions: [{ id: "inst_a", name: "City Medical College" }] }); } };
        }
        if (p.indexOf("/v1/institutions/inst_a/seats") >= 0) {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ seats: 12, used: 3, members: [{ uid: "u_one", role: "admin", createdTs: 1700000000000 }] }); } };
        }
        if (p.indexOf("/v1/institutions/inst_a/projects") >= 0) {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ projects: [{ id: "prj_i", title: "Sepsis bundle audit", discipline: "medicine" }] }); } };
        }
        if (p.indexOf("/v1/institutions/inst_a/onboarding") >= 0) {
          return { ok: true, status: 200, text: async function () { return JSON.stringify({ items: [{ key: "pilot", label: "Pilot agreement signed", done: false, source: "manual" }] }); } };
        }
        return null;
      }
    });

    sb.win.SMD_RESEARCH.screens.institution.render(container);
    await sleep(30);

    assert.equal(sb.calls.filter((c) => c.url.indexOf("/v1/institutions/inst_a/") >= 0).length, 3, "all three detail calls for a real institution");
    const html = container.innerHTML;
    assert.ok(html.indexOf("City Medical College") >= 0, "institution name renders");
    assert.ok(html.indexOf("3 of 12 seats used") >= 0, "seat counts render");
    assert.ok(html.indexOf("Sepsis bundle audit") >= 0, "institution projects render");
  });

  test("a failed load shows the error instead of looking like no institution", async () => {
    const container = {
      innerHTML: "",
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    };
    const sb = createSandbox({
      files: ["research.js", "research-screen-institution.js"],
      route: function (p) {
        if (p === "/api/research/v1/institutions") {
          return {
            ok: false, status: 503,
            text: async function () { return JSON.stringify({ error: { code: "unavailable", message: "Cannot reach the research service. Check the connection and retry." } }); }
          };
        }
        return null;
      }
    });

    sb.win.SMD_RESEARCH.screens.institution.render(container);
    await sleep(30);

    const html = container.innerHTML;
    assert.ok(html.indexOf("rmd-banner-error") >= 0, "load error is visible as an error banner");
    assert.ok(html.indexOf("Code: unavailable") >= 0 || html.indexOf("No connection") >= 0, "the failure reason is shown");
    assert.ok(html.indexOf("No institution workspace yet") < 0, "error is not mislabelled as the empty state");
  });
});
