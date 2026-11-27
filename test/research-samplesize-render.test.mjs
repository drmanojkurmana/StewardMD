/* test/research-samplesize-render.test.mjs
 * Live BUG-06: the Plan screen must read the sample size engine's real return
 * shape (withDropout is a number, totals live in totalWithDropout) for every aim.
 * Renders the real screen in a vm sandbox and scans the produced HTML.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-samplesize-render.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const AIMS = [
  "two_proportions",
  "two_means",
  "single_proportion",
  "single_mean",
  "correlation",
  "case_control",
  "time_to_event"
];

function createSandbox() {
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
      setItem: function (k, v) { ls.set(k, String(v)); },
      removeItem: function (k) { ls.delete(k); }
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
    navigator: {}
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read("research-samplesize.js"), ctx);
  vm.runInContext(read("research.js"), ctx);
  vm.runInContext(read("research-screen-start.js"), ctx);
  win.SMD_RESEARCH.store = {
    getActiveProject: function () {
      return { id: "prj_ss_render", title: "Sample size render test" };
    }
  };
  return { win: win, ctx: ctx };
}

function createContainer() {
  const aimSel = { onchange: null };
  const dropEl = { oninput: null };
  const container = {
    innerHTML: "",
    querySelector: function (sel) {
      if (sel === "#rmd_ss_aim") return aimSel;
      if (sel === "#rmd_ss_dropout") return dropEl;
      return null;
    },
    querySelectorAll: function () { return []; }
  };
  container._aimSel = aimSel;
  container._dropEl = dropEl;
  return container;
}

function asText(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("Plan screen renders the sample size engine's real shape (BUG-06)", () => {
  test("every aim renders a result with no undefined or NaN tokens", () => {
    const sb = createSandbox();
    const container = createContainer();
    sb.win.SMD_RESEARCH.screens.plan.render(container);
    assert.ok(container._aimSel.onchange, "aim select is bound");

    for (const aim of AIMS) {
      container._aimSel.onchange.call({ value: aim });
      const html = container.innerHTML;
      assert.ok(html.indexOf('id="rmd_ss_aim"') >= 0, aim + " screen rendered");
      const boxIdx = html.indexOf('class="rmd-data-box"');
      assert.ok(boxIdx >= 0, aim + " shows a result box");
      assert.ok(html.indexOf("undefined") < 0, aim + " HTML must not contain undefined");
      assert.ok(html.indexOf("NaN") < 0, aim + " HTML must not contain NaN");
    }
  });

  test("two_proportions result box shows real numbers: 121 per group, 134 with dropout (268 total)", () => {
    const sb = createSandbox();
    const container = createContainer();
    sb.win.SMD_RESEARCH.screens.plan.render(container);
    container._aimSel.onchange.call({ value: "two_proportions" });
    const text = asText(container.innerHTML);

    assert.match(text, /121 per group \(242 total\)/);
    assert.match(text, /With 10% loss to follow-up: 134 per group \(268 total\)/);
    assert.match(text, /Continuity-corrected: 134 per group \(268 total; \d+ with dropout\)/);
  });

  test("single-group aims show n total plus a numeric dropout total, never object reads", () => {
    const sb = createSandbox();
    const container = createContainer();
    sb.win.SMD_RESEARCH.screens.plan.render(container);

    container._aimSel.onchange.call({ value: "single_proportion" });
    assert.match(asText(container.innerHTML), /385 total/);
    assert.match(asText(container.innerHTML), /With 10% loss to follow-up: 427 total/);

    container._aimSel.onchange.call({ value: "single_mean" });
    assert.match(asText(container.innerHTML), /With 10% loss to follow-up: \d+ total/);

    container._aimSel.onchange.call({ value: "correlation" });
    assert.match(asText(container.innerHTML), /With 10% loss to follow-up: \d+ total/);
  });

  test("zero dropout hides the dropout line instead of printing a number equal to n", () => {
    const sb = createSandbox();
    const container = createContainer();
    sb.win.SMD_RESEARCH.screens.plan.render(container);
    container._dropEl.oninput.call({ value: "0" });

    const text = asText(container.innerHTML);
    assert.ok(text.indexOf("loss to follow-up:") < 0, "no dropout line when dropout is 0");
    assert.match(text, /Continuity-corrected: 134 per group \(268 total\)/);
    assert.ok(text.indexOf("with dropout)") < 0, "continuity line omits the dropout suffix at 0% dropout");
  });

  test("CTRI target sample size and AI inputs read totalWithDropout, not withDropout.total", () => {
    const sb = createSandbox();
    const container = createContainer();
    sb.win.SMD_RESEARCH.screens.plan.render(container);
    container._aimSel.onchange.call({ value: "two_proportions" });
    const html = container.innerHTML;

    assert.match(html, /id="rmd_ctri_n"[^>]*value="268"/, "CTRI target size uses totalWithDropout");
    assert.ok(html.indexOf("withDropout.total") < 0, "screen source no longer reads withDropout.total");
    assert.ok(html.indexOf("r.withDropout.nPerGroup") < 0, "screen source no longer reads withDropout.nPerGroup");
  });
});
