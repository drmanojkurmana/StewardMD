/* BUG-09: GRADE loads server-saved runs when the device has none.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-grade-server-runs.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function makeContainer() {
  let html = "";
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function boot(project, runsResponse) {
  globalThis.window = globalThis;
  globalThis.innerWidth = 1024;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document = {
    head: { appendChild: () => {} },
    body: { contains: () => true },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {} }),
    addEventListener: () => {}
  };
  globalThis.matchMedia = undefined;
  globalThis.SMD_RESEARCH_GRADE = {
    assessOutcome: () => ({ symbols: "++++", certainty: "High", startedAt: "now", downgrades: [], upgrades: [] }),
    suggestImprecision: () => null,
    suggestInconsistency: () => null,
    summaryOfFindings: () => ({ rows: [], columns: [] }),
    summaryOfFindingsText: () => "",
    nnt: () => ""
  };
  const calls = [];
  globalThis.SMD_RESEARCH = {
    screens: {},
    store: {
      getActiveProject: () => project,
      getState: () => ({ runs: {} })
    },
    ai: {
      state: () => ({}),
      barHtml: () => '<div class="rmd-ai-bar"></div>',
      noteHtml: () => "",
      bind: () => {},
      clearNote: () => {}
    },
    api: {
      request: async (method, path) => {
        calls.push({ method, path });
        if (method === "GET" && /\/runs\?limit=50$/.test(path)) return runsResponse;
        throw new Error("Unexpected " + method + " " + path);
      }
    }
  };
  const src = fs.readFileSync(new URL("../research-screen-grade.js", import.meta.url), "utf8");
  new Function("window", "global", src)(globalThis, globalThis);
  return { calls, screen: globalThis.SMD_RESEARCH.screens.grade };
}

const SERVER_RUN = {
  id: "run_srv_1",
  projectId: "prj_g_srv",
  measure: "RR",
  model: "random_dl",
  test: "wald",
  level: 0.95,
  manifest: { measure: "RR", inputs: [] },
  result: { pooled: { effect: -1, ciLower: -1.7, ciUpper: -0.3 } },
  createdAt: Date.now()
};

describe("BUG-09: GRADE server runs", () => {
  test("a saved server run is offered when the device has no local runs", async () => {
    const project = { id: "prj_g", serverId: "prj_g_srv", title: "BCG review", studyType: "Systematic Review" };
    const env = boot(project, { runs: [SERVER_RUN] });
    const c = makeContainer();
    env.screen.render(c);
    for (let i = 0; i < 40 && !/Outcomes \(1\)/.test(c.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));

    assert.ok(env.calls.some((x) => x.method === "GET" && x.path === "/v1/projects/prj_g_srv/runs?limit=50"),
      "GET /runs is called with the server project id");
    assert.match(c.innerHTML, /Outcomes \(1\)/, "the server run is listed");
    assert.doesNotMatch(c.innerHTML, /No saved runs yet/, "the empty state is not shown when the server has a run");
    assert.equal(env.screen._getState().selectedRunId, SERVER_RUN.id, "the first server run is selected");
  });

  test("practice projects never hit the server and keep the empty state", async () => {
    const project = { id: "prj_bcg_1994", practice: true, title: "Practice", studyType: "Systematic Review" };
    const env = boot(project, { runs: [SERVER_RUN] });
    const c = makeContainer();
    env.screen.render(c);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.calls.length, 0, "no server request for a practice project");
    assert.match(c.innerHTML, /No saved runs yet/, "practice project keeps the empty state");
  });
});