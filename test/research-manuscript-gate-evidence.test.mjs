// A manuscript drafted by the app must pass the release gates: the run's
// model/test names and study count live outside result_json's numeric walk,
// and trial-level numbers a human verified on the extraction screen are
// traceable evidence, not hand-typed results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateManuscript, tokenTable, numbersInText, verifiedEvidenceNumbers } from "../functions/api/research/_manuscript.js";

function fakeDb(tables) {
  return {
    prepare(sql) {
      const rows = /research_studies/.test(sql) ? (tables.studies || []) : (tables.runs || []);
      return { bind: () => ({ all: async () => ({ results: rows }) }) };
    },
  };
}

const RUN = {
  id: "run_x",
  measure: "RR",
  result_json: JSON.stringify({
    model: "random_reml",
    test: "knha",
    pooled: { effect: Math.log(0.83), ciLower: Math.log(0.64), ciUpper: Math.log(1.07) },
    heterogeneity: { i2: 0, tau2: 0, q: 4.54, df: 3 },
    weights: [1.2, 2.4, 40.1, 56.3],
  }),
  manifest_json: JSON.stringify({ inputs: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }),
};

test("tokenTable derives k and exposes model/test metadata", async () => {
  const table = await tokenTable(fakeDb({ runs: [RUN] }), "p1", {});
  assert.equal(table["run_x.k"].value, 4);
  assert.equal(table["run_x.studies"].value, 4);
  assert.equal(table["run_x.model"].value, "random_reml");
  assert.equal(table["run_x.test"].value, "knha");
});

test("total n is published only when every analysed trial reports arm counts", async () => {
  const withCounts = Object.assign({}, RUN, {
    result_json: JSON.stringify(Object.assign(JSON.parse(RUN.result_json), { weights: [50, 50] })),
    manifest_json: JSON.stringify({ inputs: [
      { id: "a", values: { n1: 100, n2: 100 } },
      { id: "b", values: { n1: 50, n2: 60 } },
    ] }),
  });
  const full = await tokenTable(fakeDb({ runs: [withCounts] }), "p1", {});
  assert.equal(full["run_x.n"].value, 310);

  const partial = Object.assign({}, RUN, {
    result_json: JSON.stringify(Object.assign(JSON.parse(RUN.result_json), { weights: [50, 50] })),
    manifest_json: JSON.stringify({ inputs: [
      { id: "a", values: { n1: 100, n2: 100 } },
      { id: "b", values: { effect: 0.7, ciLower: 0.4, ciUpper: 1.2 } },
    ] }),
  });
  const missing = await tokenTable(fakeDb({ runs: [partial] }), "p1", {});
  assert.equal(missing["run_x.n"], undefined, "a partial denominator is not a result");
});

test("excluded trials are not counted in the published total", async () => {
  const run = Object.assign({}, RUN, {
    result_json: JSON.stringify(Object.assign(JSON.parse(RUN.result_json), { weights: [100], excluded: ["b"] })),
    manifest_json: JSON.stringify({ inputs: [
      { id: "a", values: { n1: 100, n2: 100 } },
      { id: "b", values: { n1: 900, n2: 900 } },
    ] }),
  });
  const table = await tokenTable(fakeDb({ runs: [run] }), "p1", {});
  assert.equal(table["run_x.n"].value, 200);
  assert.equal(table["run_x.k"].value, 1);
});

test("a draft using k, model and test resolves and passes the gate", async () => {
  const table = await tokenTable(fakeDb({ runs: [RUN] }), "p1", {});
  const sections = [{
    id: "results",
    heading: "Results",
    text: "We included {{run:run_x.k}} studies. The model was {{run:run_x.model}} with the {{run:run_x.test}} test; the pooled estimate was {{run:run_x.estimate}}.",
  }];
  const report = gateManuscript(sections, [], table, { requireRunTokens: true });
  assert.deepEqual(report.gateFailures, []);
  assert.equal(report.gatesPassed, true);
});

test("measurement units and timepoints are not treated as results", async () => {
  const table = await tokenTable(fakeDb({ runs: [RUN] }), "p1", {});
  const sections = [{
    id: "abstract",
    heading: "Abstract",
    text: "PPH was defined as blood loss of 500 mL or more, assessed at birth and up to 24 hours.",
  }];
  const report = gateManuscript(sections, [], table, { requireRunTokens: true });
  assert.deepEqual(report.gateFailures, []);
});

test("numbers verified on the extraction screen are traceable in the draft", async () => {
  const table = await tokenTable(fakeDb({ runs: [RUN] }), "p1", {});
  const evidence = numbersInText("PPH occurred in 186 of 1128 women versus 215 of 1117 (16.5% vs. 19.2%).");
  const sections = [{
    id: "results",
    heading: "Results",
    text: "One trial reported 186/1128 versus 215/1117 events (16.5% versus 19.2%).",
  }];
  const blocked = gateManuscript(sections, [], table, { requireRunTokens: true });
  assert.ok(blocked.gateFailures.some((f) => f.token === "186"), "without evidence it is blocked");
  const passed = gateManuscript(sections, [], table, { requireRunTokens: true, traceableNumbers: evidence });
  assert.deepEqual(passed.gateFailures, []);
});

test("an invented number is still blocked when evidence numbers are supplied", async () => {
  const table = await tokenTable(fakeDb({ runs: [RUN] }), "p1", {});
  const evidence = numbersInText("PPH occurred in 186 of 1128 women.");
  const sections = [{
    id: "results",
    heading: "Results",
    text: "The pooled effect was 0.99 with a risk difference of 0.37.",
  }];
  const report = gateManuscript(sections, [], table, { requireRunTokens: true, traceableNumbers: evidence });
  const tokens = report.gateFailures.map((f) => f.token);
  assert.ok(tokens.includes("0.99"));
  assert.ok(tokens.includes("0.37"));
});

test("verifiedEvidenceNumbers reads verified quotes and extraction inputs only", async () => {
  const db = fakeDb({ studies: [
    { quote: "RR 0.71 (95% CI 0.38 to 1.79).", inputs_json: JSON.stringify({ effect: 0.71, ciLower: 0.38, ciUpper: 1.79 }) },
  ] });
  const set = await verifiedEvidenceNumbers(db, "p1");
  assert.ok(set.has("0.71"));
  assert.ok(set.has("1.79"));
  assert.ok(!set.has("0.86"));
});
