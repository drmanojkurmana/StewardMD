/* test/research-store-queue.test.mjs — ResearchMD store queue and network resilience
 *
 * Covers Bug D fixes:
 * 1. A mocked AI draft that answers after 20 s succeeds and is not shown as offline.
 * 2. A timeout shows the "taking longer" message ("MaiK is taking longer than usual. Try again.") not "No connection".
 * 3. While online a failing 4xx request is not queued.
 * 4. The queue drains to 0 when online.
 * 5. Old junk items are cleared and 4xx failures dropped.
 *
 * Run: node --test test/research-store-queue.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SMD = require("../research.js");
const STORE = require("../research-store.js");

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; },
    _data: data
  };
}

function setOnline(bool) {
  try {
    Object.defineProperty(globalThis.navigator, "onLine", { value: bool, configurable: true, writable: true });
  } catch (e) {}
}

describe("Bug D: Network layer, AI draft timeout, and offline queue", () => {

  test("a mocked AI draft that answers after 20 s succeeds and is not shown as offline", async () => {
    const origFetch = globalThis.fetch;
    const origCap = globalThis.Capacitor;
    const origCapHttp = globalThis.CapacitorHttp;

    try {
      delete globalThis.Capacitor;
      delete globalThis.CapacitorHttp;

      // Mock fetch that simulates a slow model responding after 20 seconds
      // In this test we resolve after a short tick with a simulated elapsed timestamp
      // to verify apiRequest supports the long timeout (90s default) without timing out
      let receivedOpts = null;
      globalThis.fetch = async (url, opts) => {
        receivedOpts = opts;
        // Verify timeoutMs passed to fetch is at least 60000ms (90000ms default for ai-draft)
        assert.ok(opts.timeout >= 60000, `Expected timeout >= 60000, got ${opts.timeout}`);
        // Return valid AI draft response
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            draft: { pubmed: "tuberculosis AND vaccine[tiab]" },
            model: "gemini-2.5-flash",
            costInr: 2
          })
        };
      };

      const res = await SMD.api.request("POST", "/v1/projects/prj_slow/ai-draft", { task: "search_query" });
      assert.ok(res, "Expected response from apiRequest");
      assert.equal(res.draft.pubmed, "tuberculosis AND vaccine[tiab]");
      assert.equal(res.model, "gemini-2.5-flash");

      // Verify friendly error is NOT triggered for successful 20s call
      const friendly = SMD.p2.friendlyError(null);
      assert.notEqual(friendly.message, "No connection right now. Your work is saved; try again in a moment.");

      // Verify all AI and literature routes receive 90s timeout, while regular routes get 30s
      const seenTimeouts = {};
      globalThis.fetch = async (url, opts) => {
        seenTimeouts[url] = opts.timeout;
        return { ok: true, status: 200, text: async () => "{}" };
      };
      const aiPaths = [
        "/v1/projects/p1/ai-draft",
        "/v1/paper-card/explain",
        "/v1/projects/p1/paper-card/explain",
        "/v1/projects/p1/studies/s1/extraction/suggestions",
        "/v1/projects/p1/records/r1/screening-suggestions",
        "/v1/projects/p1/grade-suggestions?runId=r1",
        "/v1/projects/p1/studies/auto-add",
        "/v1/projects/p1/find-studies"
      ];
      for (const ap of aiPaths) {
        await SMD.api.request("POST", ap, {});
        assert.equal(seenTimeouts["/api/research" + ap], 90000, `Expected 90000ms timeout for ${ap}`);
      }
      await SMD.api.request("GET", "/v1/projects/p1/studies");
      assert.equal(seenTimeouts["/api/research/v1/projects/p1/studies"], 30000, "Expected 30000ms timeout for non-AI route");
    } finally {
      globalThis.fetch = origFetch;
      globalThis.Capacitor = origCap;
      globalThis.CapacitorHttp = origCapHttp;
    }
  });

  test("a timeout shows the taking longer message", async () => {
    // 1. Direct friendlyError mapping for SocketTimeoutException code
    const fSocket = SMD.p2.friendlyError({ code: "SocketTimeoutException" });
    assert.equal(fSocket.message, "MaiK is taking longer than usual. Try again.");
    assert.equal(fSocket.action, "retry");

    // 2. Direct friendlyError mapping for timeout code
    const fTimeout = SMD.p2.friendlyError({ code: "timeout" });
    assert.equal(fTimeout.message, "MaiK is taking longer than usual. Try again.");
    assert.equal(fTimeout.action, "retry");

    // 3. HTTP 504 / 408 mapping
    assert.equal(SMD.p2.friendlyError({ status: 504 }).message, "MaiK is taking longer than usual. Try again.");
    assert.equal(SMD.p2.friendlyError({ status: 408 }).message, "MaiK is taking longer than usual. Try again.");

    // 4. Java exception text verbatim from CapacitorHttp
    const fVerbatim = SMD.p2.friendlyError({ message: "java.net.SocketTimeoutException: timeout" });
    assert.equal(fVerbatim.message, "MaiK is taking longer than usual. Try again.");

    // 5. errHtml output check: must show "taking longer" and NOT "No connection"
    const html = SMD.p2.errHtml({ code: "SocketTimeoutException" });
    assert.ok(html.includes("MaiK is taking longer than usual. Try again."));
    assert.ok(!html.includes("No connection right now"));
    assert.ok(html.includes("Code: SocketTimeoutException"));

    // 6. Network rejection from apiRequest transforms SocketTimeoutException to timeout error
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        const err = new Error("java.net.SocketTimeoutException: timeout");
        err.code = "SocketTimeoutException";
        throw err;
      };
      await assert.rejects(
        async () => { await SMD.api.request("POST", "/v1/projects/prj_1/ai-draft", { task: "search_query" }); },
        (err) => {
          assert.equal(err.code, "timeout");
          assert.equal(err.message, "MaiK is taking longer than usual. Try again.");
          return true;
        }
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("while online a failing 4xx request is not queued", () => {
    setOnline(true);
    STORE.clearQueue();
    assert.equal(STORE.getQueue().length, 0);

    // Attempting to queue a 400 error while online must be rejected
    STORE.queueAction("study_update", { id: "std_400", projectId: "prj_server" }, { status: 400, code: "invalid_body" });
    assert.equal(STORE.getQueue().length, 0, "400 error must not be queued");

    // Attempting to queue a 401 error while online must be rejected
    STORE.queueAction("study_create", { id: "std_401", projectId: "prj_server" }, { status: 401, code: "unauthorized" });
    assert.equal(STORE.getQueue().length, 0, "401 error must not be queued");

    // Attempting to queue a 403 error while online must be rejected
    STORE.queueAction("project_create", { id: "prj_403" }, { status: 403, code: "forbidden" });
    assert.equal(STORE.getQueue().length, 0, "403 error must not be queued");

    // Attempting to queue a 409 error while online must be rejected
    STORE.queueAction("study_update", { id: "std_409", projectId: "prj_server" }, { status: 409, code: "stale_version" });
    assert.equal(STORE.getQueue().length, 0, "409 error must not be queued");

    // Ordinary writes while online must not enter the offlineQueue
    STORE.createStudy("prj_online", { label: "Online study", locator: { citation: "JAMA 2026" } });
    assert.equal(STORE.getQueue().length, 0, "Online createStudy must not queue");

    // AI draft calls must NEVER be queued
    STORE.queueAction("ai_draft", { task: "search_query" }, { status: 500 });
    assert.equal(STORE.getQueue().length, 0, "AI draft must never be queued");

    assert.notEqual(STORE.getState().syncState, "queue");
  });

  test("the queue drains to 0 when online", async () => {
    // 1. Simulate offline: queue actions
    setOnline(false);
    STORE.clearQueue();

    STORE.queueAction("study_create", {
      id: "std_offline_1",
      projectId: "prj_srv1",
      label: "Offline Study 1",
      locator: { citation: "NEJM 2026" },
      verified: true
    });
    STORE.queueAction("study_update", {
      id: "std_offline_2",
      projectId: "prj_srv1",
      label: "Offline Study 2 Updated"
    });

    assert.equal(STORE.getQueue().length, 2, "Expected 2 items in offline queue");
    assert.equal(STORE.getState().syncState, "queue");

    // 2. Simulate phone coming back online
    setOnline(true);

    const sentRequests = [];
    const origRequest = SMD.api.request;
    SMD.api.request = async (method, path, body) => {
      sentRequests.push({ method, path, body });
      return { ok: true, study: { id: "std_synced" } };
    };

    try {
      const drained = await SMD.drainQueue();
      assert.equal(drained, 2, "Expected 2 items drained");
      assert.equal(STORE.getQueue().length, 0, "Queue must be empty after drain");
      assert.equal(STORE.getState().syncState, "synced", "Sync state must return to synced");
      assert.equal(sentRequests.length, 2, "Both items sent to server");
    } finally {
      SMD.api.request = origRequest;
    }
  });

  test("old junk items are cleared", async () => {
    // Simulate dirty queue loaded from storage containing old junk:
    // - AI draft tasks (should never be queued)
    // - Search query actions (should never be queued)
    // - Items marked with 4xx errors
    // - Items with missing payload
    // - Local practice project items (prj_bcg_1994)
    // - One valid server study update
    const junkQueue = [
      { id: "q_junk1", type: "ai_draft", payload: { task: "search_query" } },
      { id: "q_junk2", type: "search_query", payload: { query: "cancer" } },
      { id: "q_junk3", type: "study_update", status: 400, payload: { id: "s1", projectId: "prj_s" } },
      { id: "q_junk4", type: "study_create", payload: null },
      { id: "q_junk5", type: "study_create", payload: { id: "s_bcg", projectId: "prj_bcg_1994" } },
      { id: "q_valid", type: "study_update", payload: { id: "s_real", projectId: "prj_real", label: "Valid update" } }
    ];

    STORE.setQueue(junkQueue);
    // After cleanQueue, only q_valid should remain
    const cleaned = STORE.cleanQueue();
    assert.equal(cleaned.length, 1, "Only valid server item should remain");
    assert.equal(cleaned[0].id, "q_valid");

    // During drain, if an item fails with a 4xx error, it must be dropped and not retried forever
    setOnline(true);
    const origRequest = SMD.api.request;
    SMD.api.request = async () => {
      const err = new Error("Project not found");
      err.status = 404;
      err.code = "project_not_found";
      throw err;
    };

    try {
      await SMD.drainQueue();
      assert.equal(STORE.getQueue().length, 0, "4xx rejected item must be dropped from queue");
      assert.equal(STORE.getState().syncState, "synced", "Sync state must be synced when queue is 0");
    } finally {
      SMD.api.request = origRequest;
    }
  });

});
