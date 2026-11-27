/* BUG-01: online study/run writes reach the server.
 *
 * Reproduces the live failure: createStudy / saveRunResult only wrote
 * localStorage and called queueAction without an error, so the queue dropped
 * the item while online. The server study count and /runs stayed empty and
 * PaperOrchestra answered 409 no_saved_run.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-store-sync.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SMD = require("../research.js");
const STORE = require("../research-store.js");

const PID = "prj_srv_sync";

function memoryStorage() {
  const data = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; }
  };
}

function setOnline(v) {
  try {
    Object.defineProperty(globalThis.navigator, "onLine", { value: v, configurable: true, writable: true });
  } catch (e) {}
}

function adoptProject() {
  STORE.adoptServerProject({ id: PID, title: "BCG review", studyType: "Systematic Review" });
  assert.equal(STORE.serverProjectId(PID), PID);
}

let studySeq = 0;
let calls = [];

function mockServer(opts) {
  const o = opts || {};
  studySeq = 0;
  calls = [];
  const studies = {};
  SMD.api.request = async (method, path, body) => {
    calls.push({ method, path, body });
    const studyMatch = path.match(/^\/v1\/projects\/([^/]+)\/studies$/);
    if (method === "POST" && studyMatch) {
      studySeq += 1;
      const id = "st_srv_" + studySeq;
      const row = {
        id, projectId: studyMatch[1], label: body.label, measure: body.measure,
        inputs: body.inputs, locator: body.locator, quote: body.quote || "",
        verified: false, version: 1, createdAt: Date.now(), updatedAt: Date.now()
      };
      studies[id] = row;
      return { study: row };
    }
    const one = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)$/);
    if (method === "PUT" && one) {
      const row = studies[one[2]];
      if (!row) {
        const e = new Error("Study not found");
        e.status = 404;
        throw e;
      }
      if (body.version !== row.version) {
        const e = new Error("Study changed on the server (409 stale_version)");
        e.status = 409;
        e.code = "stale_version";
        throw e;
      }
      if (body.label !== undefined) row.label = body.label;
      if (body.inputs !== undefined) row.inputs = body.inputs;
      if (body.locator !== undefined) row.locator = body.locator;
      if (body.quote !== undefined) row.quote = body.quote;
      if (body.verified !== undefined) row.verified = !!body.verified;
      row.version += 1;
      row.updatedAt = Date.now();
      return { study: row };
    }
    if (method === "GET" && studyMatch) {
      return { studies: Object.keys(studies).map((k) => studies[k]) };
    }
    if (method === "POST" && /\/runs$/.test(path)) {
      if (o.rejectRun) {
        const e = new Error(o.rejectRun.message || "At least 2 studies are required for a run");
        e.status = o.rejectRun.status || 400;
        e.code = o.rejectRun.code || "invalid_run";
        throw e;
      }
      const pins = body.studyVersions || [];
      for (const p of pins) {
        if (!studies[p.studyId]) {
          const e = new Error("Study not found: " + p.studyId);
          e.status = 404;
          throw e;
        }
      }
      return { run: { id: "run_srv_1", projectId: PID, version: 1 } };
    }
    if (method === "GET" && /\/runs/.test(path)) return { runs: [] };
    throw new Error("Unexpected " + method + " " + path);
  };
}

function studyData(label, citation) {
  return {
    label,
    measure: "RR",
    inputs: { events1: 4, n1: 100, events2: 10, n2: 100 },
    locator: { kind: "manual", citation },
    quote: "quoted",
    verified: true
  };
}

describe("BUG-01: online writes are sent now, queued only offline", () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
    globalThis.window = globalThis;
    setOnline(true);
    STORE.clearQueue();
    STORE.clearLastServerError();
  });

  test("createStudy POSTs, adopts the server id, then verifies; saveRunResult POSTs mapped pins", async () => {
    adoptProject();
    mockServer();

    const s1 = STORE.createStudy(PID, studyData("Trial A", "JAMA 2020;1:1"));
    const s2 = STORE.createStudy(PID, studyData("Trial B", "NEJM 2021;2:2"));
    const local1 = s1.id;
    const local2 = s2.id;

    await STORE.pendingSync();

    const posts = calls.filter((c) => c.method === "POST" && /\/studies$/.test(c.path));
    assert.equal(posts.length, 2, "Both online studies are sent immediately");
    assert.equal(posts[0].path, "/v1/projects/" + PID + "/studies", "Studies use the server project id");
    const puts = calls.filter((c) => c.method === "PUT" && /\/studies\/st_srv_/.test(c.path));
    assert.equal(puts.length, 2, "Clinician-verified studies are verified on the server");
    assert.equal(puts[0].body.verified, true);

    const stored = STORE.getStudies(PID);
    assert.deepEqual(stored.map((s) => s.id).sort(), ["st_srv_1", "st_srv_2"], "Local rows keep the server ids");
    assert.ok(stored.every((s) => s.version === 2), "Local versions follow the server after verification");
    assert.equal(STORE.getQueue().length, 0, "Nothing is queued while online");

    /* The manifest still carries the ids captured when Calculate ran. */
    const manifest = {
      measure: "RR", model: "random_dl", test: "wald", level: 0.95,
      inputs: [
        { id: local1, version: 2, events1: 4, n1: 100, events2: 10, n2: 100 },
        { id: local2, version: 2, events1: 4, n1: 100, events2: 10, n2: 100 }
      ]
    };
    let doneErr = "not-called";
    let serverRun = null;
    STORE.saveRunResult({ pooled: { effect: -0.5 } }, manifest, function (err, run) {
      doneErr = err;
      serverRun = run;
    });
    await STORE.pendingSync();

    const runPost = calls.filter((c) => c.method === "POST" && /\/runs$/.test(c.path)).pop();
    assert.ok(runPost, "Run is sent to the server");
    assert.equal(runPost.path, "/v1/projects/" + PID + "/runs");
    assert.deepEqual(runPost.body.studyVersions, [
      { studyId: "st_srv_1", version: 2 },
      { studyId: "st_srv_2", version: 2 }
    ], "Pins are remapped to server ids and versions");
    assert.equal(doneErr, null, "Run upload reports no error");
    assert.equal(serverRun && serverRun.id, "run_srv_1", "Server run id is returned to the screen");
    assert.equal(STORE.getQueue().length, 0, "Successful run is not queued");
  });

  test("a server validation message reaches the caller and is never queued", async () => {
    adoptProject();
    mockServer({ rejectRun: { status: 400, code: "invalid_run", message: "At least 2 studies are required for a run" } });

    const s1 = STORE.createStudy(PID, studyData("Only Trial", "Lancet 2022;3:3"));
    const local1 = s1.id;
    await STORE.pendingSync();

    const manifest = {
      measure: "RR", model: "random_dl", test: "wald", level: 0.95,
      inputs: [{ id: local1, version: 2, events1: 4, n1: 100, events2: 10, n2: 100 }]
    };
    let seen = null;
    STORE.saveRunResult({ pooled: { effect: -0.5 } }, manifest, function (err) { seen = err; });
    await STORE.pendingSync();

    assert.ok(seen, "Server rejection is reported to the run screen");
    assert.equal(seen.message, "At least 2 studies are required for a run", "Server sentence is shown unchanged");
    assert.equal(STORE.getQueue().length, 0, "A 4xx answer is not retried from the offline queue");
  });

  test("offline writes queue, then drain through the existing flush code", async () => {
    adoptProject();
    setOnline(false);
    calls = [];
    SMD.api.request = async () => {
      const e = new Error("Cannot reach the research service. Check the connection and retry.");
      e.code = "network";
      e.status = 0;
      throw e;
    };

    const s1 = STORE.createStudy(PID, studyData("Offline Trial", "BMJ 2023;4:4"));
    const local1 = s1.id;
    const manifest = {
      measure: "RR", model: "random_dl", test: "wald", level: 0.95,
      inputs: [{ id: local1, version: 1, events1: 4, n1: 100, events2: 10, n2: 100 }]
    };
    STORE.saveRunResult({ pooled: { effect: -0.5 } }, manifest);
    await STORE.pendingSync();

    const queuedTypes = STORE.getQueue().map(function (q) { return q.type; });
    assert.equal(calls.length, 0, "Nothing is sent while offline");
    assert.equal(STORE.getQueue().length, 2, "Study and run are queued offline: " + JSON.stringify(queuedTypes));
    assert.deepEqual(queuedTypes.sort(), ["run_create", "study_create"], "Study and run are not reclassified on the way out");

    /* Back online, the existing drainQueue flushes both queued items. */
    setOnline(true);
    SMD.api.request = async (method, path) => {
      calls.push({ method, path });
      if (method === "POST" && /\/studies$/.test(path)) return { study: { id: "st_srv_9", version: 1, verified: false } };
      if (method === "POST" && /\/runs$/.test(path)) return { run: { id: "run_srv_9", version: 1 } };
      throw new Error("Unexpected " + method + " " + path);
    };
    const drained = await SMD.drainQueue();
    assert.equal(drained, 2, "Both queued items are sent when back online");
    assert.equal(STORE.getQueue().length, 0, "Queue is empty after the drain");
    assert.ok(calls.some((c) => c.method === "POST" && /\/studies$/.test(c.path)), "Queued study was flushed");
    assert.ok(calls.some((c) => c.method === "POST" && /\/runs$/.test(c.path)), "Queued run was flushed");
  });
});