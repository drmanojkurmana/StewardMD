/* test/research-search-query-phi.test.mjs
 * Literature search screen (research-screen-search.js): the online topic search
 * runs the client PHI scanner before sending, refuses patient information, and
 * shows the provider hint under the input. Normal topic searches still reach
 * /find-studies unchanged.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-search-query-phi.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCREEN_SRC = readFileSync(join(ROOT, "research-screen-search.js"), "utf8");
const PHI_SRC = readFileSync(join(ROOT, "research-phi.js"), "utf8");

const HINT = "Search words go to PubMed, Europe PMC, Crossref, ClinicalTrials.gov and OpenAlex (mostly US-hosted). Do not type patient information.";
const PHI_MESSAGE = "Remove patient information from the search words before searching.";

function makeElement(attrs) {
  return {
    attrs: attrs || {},
    onclick: null,
    oninput: null,
    onkeydown: null,
    onchange: null,
    value: "",
    disabled: false,
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    addEventListener: function () {},
    removeEventListener: function () {},
    focus: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

function makeContainer() {
  const topicInput = makeElement({ id: "rmd_topic_q" });
  const topicButton = makeElement({ "data-rmd": "topic-search" });
  const container = {
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v == null ? "" : v); },
    querySelector: function (sel) {
      if (sel === "#rmd_topic_q" && this._html.indexOf('id="rmd_topic_q"') >= 0) return topicInput;
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === '[data-rmd="topic-search"]' && this._html.indexOf('data-rmd="topic-search"') >= 0) {
        return [topicButton];
      }
      return [];
    }
  };
  return { container, topicInput, topicButton };
}

function createSandbox(options) {
  const opts = options || {};
  const calls = [];
  const project = opts.project || { id: "loc_proj", serverId: "p1", title: "BCG review", role: "owner" };
  const win = {
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return makeElement(); },
      getElementById: function () { return null; },
      head: { appendChild: function () {} },
      body: { appendChild: function () {} }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    navigator: { onLine: true },
    Date: Date,
    Math: Math,
    Promise: Promise,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.SMD_RESEARCH = {
    esc: function (s) {
      if (s == null) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    p2: {
      errHtml: function (err) {
        return '<div class="rmd-err">' + String((err && err.message) || err || "") + "</div>";
      },
      loadingHtml: function () { return '<div class="rmd-loading"></div>'; },
      fmtTs: function () { return ""; }
    },
    store: {
      getActiveProject: function () { return project; }
    },
    api: {
      request: function (method, path, body) {
        calls.push({ method: method, path: path, body: body });
        return Promise.resolve(opts.response || { results: [] });
      }
    },
    ai: {
      state: function () { return null; },
      clearNote: function () {},
      bind: function () {},
      barHtml: function () { return ""; },
      noteHtml: function () { return ""; }
    },
    navigate: function () {},
    screens: {}
  };

  const ctx = vm.createContext(win);
  vm.runInContext(PHI_SRC, ctx);
  vm.runInContext(SCREEN_SRC, ctx);
  return { win: win, calls: calls };
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function topicSends(calls) {
  return calls.filter((c) => c.method === "POST" && /\/find-studies$/.test(c.path || ""));
}

describe("literature search query PHI guard", () => {
  test("the provider hint sits under the search input and explains where words go", async () => {
    const sb = createSandbox();
    const dom = makeContainer();
    sb.win.SMD_RESEARCH.screens.search.render(dom.container);
    await flush();
    assert.ok(dom.container.innerHTML.indexOf(HINT) >= 0, "hint line rendered verbatim");
    assert.ok(dom.container.innerHTML.indexOf('class="rmd-field-hint"') >= 0, "uses the screen hint class");
  });

  test("a query with a name and phone number is never sent and shows the PHI message", async () => {
    const sb = createSandbox();
    const dom = makeContainer();
    sb.win.SMD_RESEARCH.screens.search.render(dom.container);
    await flush();

    dom.topicInput.value = "Ramesh 9876543210";
    dom.topicInput.oninput.call(dom.topicInput);
    dom.topicButton.onclick();
    await flush();

    assert.equal(topicSends(sb.calls).length, 0, "no topic search is sent for a PHI query");
    assert.ok(dom.container.innerHTML.indexOf(PHI_MESSAGE) >= 0, "existing PHI block message shown");
  });

  test("a normal topic query still reaches /find-studies", async () => {
    const sb = createSandbox({
      project: { id: "p1", serverId: "p1", title: "BCG review", role: "owner" },
      response: { results: [{ title: "BCG vaccine trial", authors: ["A Author"], year: 2024, source: "pubmed" }] }
    });
    const dom = makeContainer();
    sb.win.SMD_RESEARCH.screens.search.render(dom.container);
    await flush();

    dom.topicInput.value = "BCG vaccine tuberculosis randomised trial";
    dom.topicInput.oninput.call(dom.topicInput);
    dom.topicButton.onclick();
    await flush();

    const sends = topicSends(sb.calls);
    assert.equal(sends.length, 1, "one topic search for a clean query");
    assert.equal(sends[0].path, "/v1/projects/p1/find-studies");
    assert.deepEqual(JSON.parse(JSON.stringify(sends[0].body)),
      { q: "BCG vaccine tuberculosis randomised trial", limit: 30 });
    assert.ok(dom.container.innerHTML.indexOf("BCG vaccine trial") >= 0, "results render");
    assert.equal(dom.container.innerHTML.indexOf(PHI_MESSAGE), -1, "no PHI message for a clean query");
  });
});