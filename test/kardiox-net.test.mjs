/* test/kardiox-net.test.mjs — KardioXApiClient: decode, retry/backoff, error codes, version guard, timeout. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const NET = require("../kardiox-net.js");
const MOD = require("../kardiox-models.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

const AF_JSON = MOD.samples.afWithRvr;
const resp = (status, body) => ({ status, json: () => Promise.resolve(body) });
const opts = (fetchImpl, extra) => Object.assign({ fetch: fetchImpl, backoffMs: [0, 0, 0], timerFn: setTimeout, timeoutMs: 40, sessionId: "s1" }, extra || {});

// 200 → parses to ECGAnalysis
{
  let calls = 0;
  const c = NET.makeApiClient(opts(() => { calls++; return Promise.resolve(resp(200, AF_JSON)); }));
  const stages = [];
  const a = await c.analyze({ id: "i", data: "x" }, (s) => stages.push(s));
  ok("200 → AF ECGAnalysis", a.verdict === "Atrial fibrillation" && a.measurements.qtcMs === 468);
  ok("emits upload + report stages", stages.indexOf("upload") >= 0 && stages.indexOf("report") >= 0 && calls === 1);
}

// 503 then 200 → retries and succeeds
{
  let calls = 0;
  const c = NET.makeApiClient(opts(() => { calls++; return Promise.resolve(calls === 1 ? resp(503, { error: { code: "pipeline_unavailable" } }) : resp(200, AF_JSON)); }));
  const a = await c.analyze({ id: "i" });
  ok("503 then 200 → retried + succeeded", a.verdict === "Atrial fibrillation" && calls === 2);
}

// 400 bad_image → typed error
{
  const c = NET.makeApiClient(opts(() => Promise.resolve(resp(400, { error: { code: "bad_image", message: "blurry", stage: "quality" } }))));
  let err;
  try { await c.analyze({ id: "i" }); } catch (e) { err = e; }
  ok("400 → bad_image typed error", err && err.code === "bad_image" && err.stage === "quality");
}

// 422 layout_undetected
{
  const c = NET.makeApiClient(opts(() => Promise.resolve(resp(422, {}))));
  let err; try { await c.analyze({ id: "i" }); } catch (e) { err = e; }
  ok("422 → layout_undetected", err && err.code === "layout_undetected");
}

// 429 always → exhausts retries → rate_limited
{
  let calls = 0;
  const c = NET.makeApiClient(opts(() => { calls++; return Promise.resolve(resp(429, {})); }, { maxRetries: 2 }));
  let err; try { await c.analyze({ id: "i" }); } catch (e) { err = e; }
  ok("429 exhausts retries → rate_limited", err && err.code === "rate_limited" && calls === 3);
}

// version mismatch (major 2)
{
  const c = NET.makeApiClient(opts(() => Promise.resolve(resp(200, Object.assign({}, AF_JSON, { schemaVersion: "2.0" })))));
  let err; try { await c.analyze({ id: "i" }); } catch (e) { err = e; }
  ok("schemaVersion major mismatch rejected", err && err.code === "version_mismatch");
}

// timeout: fetch never resolves → 504 timeout after retries
{
  let calls = 0;
  const c = NET.makeApiClient(opts(() => { calls++; return new Promise(() => {}); }, { maxRetries: 1, timeoutMs: 20 }));
  let err; try { await c.analyze({ id: "i" }); } catch (e) { err = e; }
  ok("hung request → timeout error after retry", err && err.code === "timeout" && calls === 2);
}

// shouldRetry helper
ok("shouldRetry 5xx/429/504 yes, 400 no", NET.shouldRetry(503) && NET.shouldRetry(429) && NET.shouldRetry(504) && !NET.shouldRetry(400));

console.log(`\nkardiox-net: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
