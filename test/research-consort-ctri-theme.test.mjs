/* test/research-consort-ctri-theme.test.mjs
 * Live BUG-07 (part) + BUG-10 (part): CONSORT and CTRI must use the --rmd-*
 * theme tokens instead of hardcoded dark cards, the CONSORT banner must not
 * invent a step when consort is not a journey step, and the CONSORT svg must
 * not carry height="auto" (console error). Token pairs are contrast-checked
 * in BOTH themes (>= 4.5:1).
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-consort-ctri-theme.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

function lum(hex) {
  const c = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = parts.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* The token values research.js injectCSS defines for light and dark themes. */
const THEMES = [
  {
    name: "light",
    acc: "#1b41bf", accSoft: "#e4e9f8", warn: "#a34e1c", warnSoft: "#fdebdf",
    bad: "#b42318", ink: "#111c44", mut: "#5b607a", panel: "#fffdf9", bg: "#f8f1e4"
  },
  {
    name: "dark",
    acc: "#8aa6ff", accSoft: "#1b2a66", warn: "#f59e71", warnSoft: "#3a2418",
    bad: "#ff7b6e", ink: "#f8f1e4", mut: "#a7b0cc", panel: "#111c44", bg: "#0a1230"
  }
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
      setItem: function (k, v) { ls.set(k, String(v)); }
    },
    Promise: Promise, Error: Error, Object: Object, Array: Array, RegExp: RegExp,
    String: String, JSON: JSON, Math: Math,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    addEventListener: function () {},
    navigator: {}
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read("research.js"), ctx);
  vm.runInContext(read("research-screen-consort.js"), ctx);
  vm.runInContext(read("research-screen-ctri.js"), ctx);
  return { win: win, ctx: ctx };
}

function stubStore(win, studyType) {
  win.SMD_RESEARCH.store = {
    getActiveProject: function () {
      return { id: "prj_theme", serverId: "prj_theme", title: "Theme test", studyType: studyType };
    }
  };
}

function stripSvg(html) {
  return String(html).replace(/<svg[\s\S]*?<\/svg>/g, "");
}

function render(container, screen) {
  screen.render(container);
}

describe("CONSORT + CTRI theme tokens and honest banner (BUG-07, BUG-10)", () => {
  const container = { innerHTML: "", querySelector: function () { return null; }, querySelectorAll: function () { return []; } };

  test("CONSORT renders with theme tokens, no hardcoded dark cards in the form", () => {
    const sb = createSandbox();
    stubStore(sb.win, "Randomized Controlled Trial");
    container.innerHTML = "";
    render(container, sb.win.SMD_RESEARCH.screens.consort);
    const html = stripSvg(container.innerHTML);

    for (const hex of ["#071318", "#0D1D23", "#1f363d", "#42CDB5", "#8ea3a6"]) {
      assert.ok(html.indexOf(hex) < 0, "form HTML must not hardcode " + hex);
    }
    assert.ok(html.indexOf("color:#fff") < 0 && html.indexOf("color: #fff") < 0, "no white text on themed cards");
    assert.ok(html.indexOf("var(--rmd-panel)") >= 0, "cards use --rmd-panel");
    assert.ok(html.indexOf("var(--rmd-fill)") >= 0, "inputs use --rmd-fill");
    assert.ok(html.indexOf("var(--rmd-acc)") >= 0, "headings use --rmd-acc");
    assert.ok(html.indexOf("var(--rmd-ink)") >= 0, "input text uses --rmd-ink");
  });

  test("CONSORT banner names the screen instead of a fake Step 1 of 9 and invented Next", () => {
    const sb = createSandbox();
    stubStore(sb.win, "Randomized Controlled Trial");
    container.innerHTML = "";
    render(container, sb.win.SMD_RESEARCH.screens.consort);
    const text = stripSvg(container.innerHTML).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    assert.ok(text.indexOf("Step 1 of 9") < 0, "no fake step number when consort is not a journey step");
    assert.ok(text.indexOf("Next: Master chart") < 0, "no invented Next label");
    assert.ok(text.indexOf("CONSORT flow for this trial") >= 0, "banner names the screen honestly");
  });

  test("CONSORT svg drops height=\"auto\" but keeps viewBox scaling", () => {
    const sb = createSandbox();
    stubStore(sb.win, "Randomized Controlled Trial");
    container.innerHTML = "";
    render(container, sb.win.SMD_RESEARCH.screens.consert || sb.win.SMD_RESEARCH.screens.consort);
    const svg = container.innerHTML.slice(container.innerHTML.indexOf("<svg"));

    assert.ok(svg.indexOf('height="auto"') < 0, "no height=auto attribute (console error)");
    assert.ok(svg.indexOf('viewBox="0 0 740 560"') >= 0, "viewBox keeps the aspect ratio");
    assert.ok(svg.indexOf('width="100%"') >= 0, "width 100% keeps it responsive");
  });

  test("CTRI renders with theme tokens, no hardcoded dark cards", () => {
    const sb = createSandbox();
    stubStore(sb.win, "Randomized Controlled Trial");
    container.innerHTML = "";
    render(container, sb.win.SMD_RESEARCH.screens.ctri);
    const html = container.innerHTML;

    for (const hex of ["#071318", "#0D1D23", "#1f363d", "#42CDB5", "#8ea3a6", "#ff6b6b"]) {
      assert.ok(html.indexOf(hex) < 0, "CTRI HTML must not hardcode " + hex);
    }
    assert.ok(html.indexOf("color:#fff") < 0, "no white text on themed inputs");
    assert.ok(html.indexOf("var(--rmd-fill)") >= 0, "inputs use --rmd-fill");
    assert.ok(html.indexOf("var(--rmd-ink)") >= 0, "input text uses --rmd-ink");
    assert.ok(html.indexOf("var(--rmd-mut)") >= 0, "hint uses --rmd-mut");
    assert.ok(html.indexOf("var(--rmd-acc-soft)") >= 0, "notice uses --rmd-acc-soft");
  });

  test("CTRI stays a real journey step (Step 4 of 9, Next: Randomise)", () => {
    const sb = createSandbox();
    stubStore(sb.win, "Randomized Controlled Trial");
    container.innerHTML = "";
    render(container, sb.win.SMD_RESEARCH.screens.ctri);
    const text = container.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    assert.ok(text.indexOf("Step 4 of 9") >= 0, "CTRI is step 4 of the RCT journey");
    assert.ok(text.indexOf("Next: Randomise") >= 0, "Next label is the real next step");
  });

  test("every token pair used by CONSORT/CTRI meets 4.5:1 in light and dark", () => {
    for (const theme of THEMES) {
      const pairs = [
        ["heading on card", theme.acc, theme.panel],
        ["banner text on acc-soft", theme.acc, theme.accSoft],
        ["warn banner text on warn-soft", theme.warn, theme.warnSoft],
        ["error text on panel", theme.bad, theme.panel],
        ["input text on fill over panel", theme.ink, theme.panel],
        ["hint text on card", theme.mut, theme.panel]
      ];
      for (const [label, fg, bg] of pairs) {
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5, theme.name + ": " + label + " contrast " + ratio.toFixed(2) + ":1 for " + fg + " on " + bg);
      }
    }
  });
});
