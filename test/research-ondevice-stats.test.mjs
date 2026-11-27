/* Unit tests for research-ondevice-stats.js, research-stats-worker.js,
 * and on-device masterchart linear/PH extensions.
 *
 * Run: node --test test/research-ondevice-stats.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const WORKER = require("../research-stats-worker.js");
const OD = require("../research-ondevice-stats.js");

function close(a, b, tol = 1e-6) {
  assert.ok(Math.abs(a - b) <= tol, "got " + a + ", want " + b);
}

test("ES5 and no em/en dashes in all touched/new app files", function () {
  const files = [
    "../research-stats.js",
    "../research-stats-worker.js",
    "../research-ondevice-stats.js",
    "../research-screen-masterchart.js"
  ];
  const forbidden = ["=>", "let ", "const ", "class ", "`", "Array.from", ".includes(", "Object.assign", "\u2014", "\u2013"];
  files.forEach(function (f) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    forbidden.forEach(function (tok) {
      assert.equal(src.indexOf(tok), -1, f + " has forbidden token " + tok);
    });
  });
});

test("flag isEnabled defaults ON and turns off only when localStorage holds '0'", function () {
  assert.equal(OD.isEnabled(), true);
  const prevLS = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: (k) => (k === "smd_rmd_ondevice_stats_v2" ? "0" : null) };
    assert.equal(OD.isEnabled(), false);
    globalThis.localStorage = { getItem: () => "1" };
    assert.equal(OD.isEnabled(), true);
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
});

test("hand-checked 2x2 OLS linear regression and HC3 via SMD_RMD_ONDEVICE_STATS", async function () {
  /* x = [1, 2, 3, 4], y = [2, 4, 5, 4] (same fixture as test_stats_job.py):
   * xbar = 2.5, ybar = 3.75, Sxx = 5, Sxy = 3.5 -> slope = 0.7, intercept = 2.0.
   * yhat = [2.7, 3.4, 4.1, 4.8], resid = [-0.7, 0.6, 0.9, -0.8], ssr = 2.30, sst = 4.75.
   * sigma^2 = 2.30 / 2 = 1.15, R2 = 1 - 2.30/4.75 = 49/95.
   * adjR2 = 1 - (46/95)*(3/2) = 26/95. F = (2.45/1)/(2.30/2) = 4.9/2.3.
   */
  const rows = [
    { y: 2, x: 1 },
    { y: 4, x: 2 },
    { y: 5, x: 3 },
    { y: 4, x: 4 }
  ];
  const res = await OD.run({ family: "linear", formula: "y ~ x" }, rows);
  assert.equal(res.family, "linear");
  assert.equal(res.engine, "js");
  assert.equal(res.engineVersion, STATS.ENGINE_VERSION);
  assert.match(res.dataHash, /^[0-9a-f]{64}$/);
  assert.equal(res.n, 4);
  assert.equal(res.dfResidual, 2);
  close(res.coefficients[0].estimate, 2.0, 1e-10);
  close(res.coefficients[1].estimate, 0.7, 1e-10);
  close(res.coefficients[1].se, Math.sqrt(1.15 / 5), 1e-10);
  close(res.r2, 49 / 95, 1e-10);
  close(res.adjR2, 26 / 95, 1e-10);
  close(res.fStatistic, 4.9 / 2.3, 1e-10);
  close(res.sigma, Math.sqrt(1.15), 1e-10);
  /* Result must never carry raw rows or column arrays */
  assert.equal(res.rows, undefined);
  assert.equal(res.columns, undefined);
  assert.equal(res.y, undefined);
  assert.equal(res.x, undefined);

  /* Hand-checked HC3: h = [0.7, 0.3, 0.3, 0.7] -> (e/(1-h))^2 */
  const hc3 = await OD.run({ family: "linear", formula: "y ~ x", robust: "HC3" }, rows);
  assert.equal(hc3.robust, "HC3");
  close(hc3.coefficients[0].estimate, 2.0, 1e-10);
  close(hc3.coefficients[1].estimate, 0.7, 1e-10);
  assert.notEqual(hc3.coefficients[1].se, res.coefficients[1].se);

  /* Intercept-only y ~ 1 */
  const intOnly = await OD.run({ family: "linear", formula: "y ~ 1" }, rows);
  assert.equal(intOnly.coefficients.length, 1);
  close(intOnly.coefficients[0].estimate, 3.75, 1e-10);
  assert.equal(intOnly.fStatistic, null);
});

test("dataHash matches job.py row-order behavior (order-sensitive, no row sorting)", async function () {
  const rowsA = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];
  const rowsB = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];
  const rowsReordered = [{ y: 4, x: 4 }, { y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }];

  const rA = await OD.run({ family: "linear", formula: "y ~ x" }, rowsA);
  const rB = await OD.run({ family: "linear", formula: "y ~ x" }, rowsB);
  const rRe = await OD.run({ family: "linear", formula: "y ~ x" }, rowsReordered);

  assert.equal(rA.dataHash, rB.dataHash);
  assert.notEqual(rA.dataHash, rRe.dataHash, "job.py never sorts rows, so reordered rows have a distinct dataHash");
  assert.equal(rA.manifest.dataHash, rA.dataHash);
});

test("spec validation and Python error codes", async function () {
  const rows = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];

  await assert.rejects(() => OD.run(null, rows), (e) => e.code === "invalid_spec");
  await assert.rejects(() => OD.run({ family: "neural-net" }, rows), (e) => e.code === "invalid_spec");
  await assert.rejects(() => OD.run({ family: "linear" }, rows), (e) => e.code === "invalid_spec");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x + x" }, rows), (e) => e.code === "invalid_formula");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x * z" }, rows), (e) => e.code === "invalid_formula");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x - 1" }, rows), (e) => e.code === "invalid_formula");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x + y" }, rows), (e) => e.code === "invalid_formula");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x", robust: "HC9" }, rows), (e) => e.code === "invalid_robust");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ missing" }, rows), (e) => e.code === "invalid_spec");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x" }, []), (e) => e.code === "dataset_invalid");
  await assert.rejects(() => OD.run({ family: "linear", formula: "y ~ x" }, [{ y: 1, x: 1 }, { y: 2, x: 2 }]), (e) => e.code === "too_few_rows");

  /* Logistic errors */
  await assert.rejects(
    () => OD.run({ family: "logistic", formula: "y ~ x" }, [{ y: 2, x: 1 }, { y: 0, x: 2 }, { y: 1, x: 3 }]),
    (e) => e.code === "outcome_not_binary"
  );
  await assert.rejects(
    () => OD.run({ family: "logistic", formula: "y ~ x" }, [{ y: 1, x: 1 }, { y: 1, x: 2 }, { y: 1, x: 3 }]),
    (e) => e.code === "outcome_constant"
  );
  await assert.rejects(
    () => OD.run({ family: "logistic", formula: "y ~ x" }, [
      { y: 0, x: 1 }, { y: 0, x: 2 }, { y: 0, x: 3 }, { y: 1, x: 4 }, { y: 1, x: 5 }, { y: 1, x: 6 }
    ]),
    (e) => e.code === "logistic_not_converged"
  );

  /* Survival no_events */
  await assert.rejects(
    () => OD.run({ family: "km", time: "t", event: "e" }, [{ t: 1, e: 0 }, { t: 2, e: 0 }, { t: 3, e: 0 }]),
    (e) => e.code === "no_events"
  );
  await assert.rejects(
    () => OD.run({ family: "cox", time: "t", event: "e", covariates: ["x"] }, [
      { t: 1, e: 0, x: 1 }, { t: 2, e: 0, x: 2 }, { t: 3, e: 0, x: 3 }
    ]),
    (e) => e.code === "no_events"
  );

  /* Diagnostic zero_cell with correctionControl: "none" */
  await assert.rejects(
    () => OD.run(
      { family: "diagnostic", columns: { TP: "TP", FN: "FN", FP: "FP", TN: "TN" }, correctionControl: "none" },
      [{ TP: 10, FN: 0, FP: 2, TN: 20 }, { TP: 12, FN: 2, FP: 3, TN: 18 }]
    ),
    (e) => e.code === "zero_cell"
  );
});

test("ceilings: ceiling_rows and ceiling_seconds (terminating worker)", async function () {
  const rows = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];
  await assert.rejects(
    () => OD.run({ family: "linear", formula: "y ~ x" }, rows, { maxRows: 2 }),
    (e) => e.code === "ceiling_rows"
  );

  /* > 100000 default maxRows */
  const over = new Array(100001).fill({ y: 1, x: 2 });
  await assert.rejects(
    () => OD.run({ family: "linear", formula: "y ~ x" }, over),
    (e) => e.code === "ceiling_rows"
  );

  /* Mock Worker that never replies -> ceiling_seconds + terminate() */
  let terminated = 0;
  function HangingWorker() {}
  HangingWorker.prototype.addEventListener = function () {};
  HangingWorker.prototype.removeEventListener = function () {};
  HangingWorker.prototype.postMessage = function () {};
  HangingWorker.prototype.terminate = function () { terminated += 1; };

  await assert.rejects(
    () => OD.run({ family: "linear", formula: "y ~ x" }, rows, { Worker: HangingWorker, maxSeconds: 0.02 }),
    (e) => e.code === "ceiling_seconds"
  );
  assert.equal(terminated, 1);
  OD.terminateWorker();
});

test("worker handleMessage and Worker path end-to-end", async function () {
  const out = WORKER.handleMessage({ id: 7, fn: "linear", args: [[[2, 1], [4, 2], [5, 3], [4, 4]], ["y", "x"], "y", ["x"], null, null] });
  assert.equal(out.id, 7);
  assert.equal(out.ok, true);
  close(out.result.coefficients[1].estimate, 0.7, 1e-10);

  const badFn = WORKER.handleMessage({ id: 8, fn: "eval", args: [] });
  assert.equal(badFn.id, 8);
  assert.equal(badFn.ok, false);
  assert.equal(badFn.error.code, "invalid_spec");

  /* Mock Worker backed by WORKER.handleMessage */
  function FakeWorker() {
    this.listeners = { message: [], error: [] };
  }
  FakeWorker.prototype.addEventListener = function (t, fn) { this.listeners[t].push(fn); };
  FakeWorker.prototype.removeEventListener = function (t, fn) {
    this.listeners[t] = this.listeners[t].filter((x) => x !== fn);
  };
  FakeWorker.prototype.postMessage = function (msg) {
    const reply = WORKER.handleMessage(msg);
    setTimeout(() => {
      this.listeners.message.slice().forEach((fn) => fn({ data: reply }));
    }, 0);
  };
  FakeWorker.prototype.terminate = function () {};

  const coxCsv = [
    { t: 1, e: 1, x: 0 }, { t: 2, e: 1, x: 1 }, { t: 3, e: 1, x: 0 },
    { t: 4, e: 0, x: 1 }, { t: 5, e: 1, x: 0 }, { t: 6, e: 1, x: 1 }
  ];
  const coxRes = await OD.run(
    { family: "cox", time: "t", event: "e", covariates: ["x"] },
    coxCsv,
    { Worker: FakeWorker }
  );
  assert.equal(coxRes.family, "cox");
  assert.equal(coxRes.engine, "js");
  assert.equal(coxRes.ties, "efron");
  assert.ok(coxRes.phTest && coxRes.phTest.transform === "km");
  assert.equal(coxRes.phTest.terms.length, 1);
  assert.equal(coxRes.rows, undefined);
  OD.terminateWorker();

  const diagRows = [
    { study_id: "a", TP: 47, FN: 9, FP: 101, TN: 738 },
    { study_id: "b", TP: 126, FN: 51, FP: 272, TN: 1543 },
    { study_id: "c", TP: 19, FN: 10, FP: 12, TN: 192 }
  ];
  const diagRes = await OD.run(
    { family: "diagnostic", columns: { TP: "TP", FN: "FN", FP: "FP", TN: "TN" }, id: "study_id" },
    diagRows,
    { Worker: FakeWorker }
  );
  assert.equal(diagRes.family, "diagnostic");
  assert.equal(diagRes.model, "reitsma");
  assert.equal(diagRes.correctionApplied, false);
  assert.ok(diagRes.pooledSens > 0 && diagRes.pooledSens < 1);
  assert.equal(diagRes.rows, undefined);
  OD.terminateWorker();
});

test("Worker constructor throw rejects with worker_construct_failed instead of hanging (Item 7)", async function () {
  OD.terminateWorker();
  function BrokenWorker() {
    throw new Error("Worker blocked by CSP");
  }
  const rows = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];
  await assert.rejects(
    () => OD.run({ family: "linear", formula: "y ~ x" }, rows, { Worker: BrokenWorker }),
    (err) => err && err.code === "worker_construct_failed" && /Worker blocked/.test(err.message)
  );
  OD.terminateWorker();
});

test("opts.signal abort terminates worker and rejects immediately (Item 7)", async function () {
  OD.terminateWorker();
  let terminated = 0;
  function NeverReplyWorker() {
    this.listeners = { message: [], error: [] };
  }
  NeverReplyWorker.prototype.addEventListener = function (t, fn) { this.listeners[t].push(fn); };
  NeverReplyWorker.prototype.removeEventListener = function (t, fn) {
    this.listeners[t] = this.listeners[t].filter((x) => x !== fn);
  };
  NeverReplyWorker.prototype.postMessage = function () {};
  NeverReplyWorker.prototype.terminate = function () { terminated += 1; };

  const ac = new AbortController();
  const rows = [{ y: 2, x: 1 }, { y: 4, x: 2 }, { y: 5, x: 3 }, { y: 4, x: 4 }];
  const p = OD.run({ family: "linear", formula: "y ~ x" }, rows, {
    Worker: NeverReplyWorker,
    maxSeconds: 60,
    signal: ac.signal
  });
  setTimeout(() => ac.abort(), 15);
  await assert.rejects(
    () => p,
    (err) => err && err.code === "aborted"
  );
  assert.equal(terminated, 1);
  OD.terminateWorker();
});
