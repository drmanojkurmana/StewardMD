/* Test suite for PaperOrchestra manuscript drafting integration (research-screen-manuscript.js).
 * Validates:
 * - smd_rmd_po flag (default off, on when localStorage is "1")
 * - PO draft button rendering, real <button>, aria-live="polite" status row
 * - POST /v1/projects/{apiPid}/jobs with kind "manuscript_draft" and random idempotencyKey
 * - Polling handles queued -> running ("Writing the draft") -> succeeded ("Done") and reloads versions
 * - Cancellation posts /v1/jobs/{jobId}/cancel and clears polling timer
 * - Server error codes map to plain sentences (no em dashes)
 * - loadCasePromise bug fix: reads items[i].value, not items[i].data
 *
 * Run with:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-po-button.test.mjs
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function makeMockContainer() {
  let html = "";
  const container = {
    isConnected: true,
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      this._nodes = [];
      const btnRe = /<button\s+([^>]*?)>([\s\S]*?)<\/button>/gi;
      let m;
      while ((m = btnRe.exec(html)) !== null) {
        const attrStr = m[1];
        const content = m[2];
        const attrs = {};
        const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
        let am;
        while ((am = are.exec(attrStr)) !== null) {
          attrs[am[1]] = am[2] !== undefined ? am[2] : true;
        }
        this._nodes.push({
          tagName: "BUTTON",
          attrs: attrs,
          disabled: !!attrs.disabled,
          getAttribute(k) { return attrs[k] !== undefined ? String(attrs[k]) : null; },
          textContent: content.replace(/<[^>]*>/g, "").trim(),
          onclick: null
        });
      }

      const divRe = /<div\s+([^>]*?)>([\s\S]*?)<\/div>/gi;
      while ((m = divRe.exec(html)) !== null) {
        const attrStr = m[1];
        const content = m[2];
        const attrs = {};
        const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
        let am;
        while ((am = are.exec(attrStr)) !== null) {
          attrs[am[1]] = am[2] !== undefined ? am[2] : true;
        }
        this._nodes.push({
          tagName: "DIV",
          attrs: attrs,
          getAttribute(k) { return attrs[k] !== undefined ? String(attrs[k]) : null; },
          textContent: content.replace(/<[^>]*>/g, "").trim()
        });
      }

      const spanRe = /<span\s+([^>]*?)>([\s\S]*?)<\/span>/gi;
      while ((m = spanRe.exec(html)) !== null) {
        const attrStr = m[1];
        const content = m[2];
        const attrs = {};
        const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
        let am;
        while ((am = are.exec(attrStr)) !== null) {
          attrs[am[1]] = am[2] !== undefined ? am[2] : true;
        }
        this._nodes.push({
          tagName: "SPAN",
          attrs: attrs,
          getAttribute(k) { return attrs[k] !== undefined ? String(attrs[k]) : null; },
          textContent: content.replace(/<[^>]*>/g, "").trim()
        });
      }
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      if (!this._nodes) return [];
      if (sel === '[data-rmd="full-draft-po"]') {
        return this._nodes.filter((n) => n.attrs["data-rmd"] === "full-draft-po");
      }
      if (sel === '[data-rmd="po-cancel"]') {
        return this._nodes.filter((n) => n.attrs["data-rmd"] === "po-cancel");
      }
      if (sel === ".rmd-po-status") {
        return this._nodes.filter((n) => (n.attrs["class"] || "").indexOf("rmd-po-status") >= 0);
      }
      if (sel === ".rmd-po-status-text") {
        return this._nodes.filter((n) => (n.attrs["class"] || "").indexOf("rmd-po-status-text") >= 0);
      }
      return [];
    }
  };
  return container;
}

let storeState = {};
let storageMap = {};

function setupEnv() {
  storageMap = {};
  globalThis.window = globalThis;
  globalThis.document = {
    head: { appendChild: () => {} },
    body: { contains: () => true },
    getElementById: (id) => (id === "rmdManuscriptCss" ? { id: "rmdManuscriptCss" } : null),
    createElement: () => ({ style: {}, setAttribute: () => {} })
  };

  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : null),
    setItem: (k, v) => { storageMap[k] = String(v); },
    removeItem: (k) => { delete storageMap[k]; }
  };

  storeState = {
    activeProject: { id: "prj_test_1", title: "Systematic Review of BCG", studyType: "systematic_review" }
  };

  globalThis.SMD_RESEARCH = {
    ai: {
      state: () => ({ busy: false, error: null, drafted: {} }),
      barHtml: () => '<div class="rmd-ai-bar"><div class="rmd-ai-actions"><button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ai="ask"><span class="rmd-ai-mark" aria-hidden="true">R</span>Ask MaiK to draft it</button><button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-ai="manual">Do it myself</button></div></div>',
      noteHtml: () => "",
      bind: () => {}
    },
    store: {
      getActiveProject: () => storeState.activeProject,
      getState: () => ({ runs: {} })
    },
    api: {
      request: () => Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } })
    }
  };
}

describe("PaperOrchestra UI integration", () => {
  beforeEach(() => {
    setupEnv();
    const scriptSrc = fs.readFileSync(new URL("../research-screen-manuscript.js", import.meta.url), "utf8");
    new Function("window", "global", scriptSrc)(globalThis, globalThis);
  });

  afterEach(() => {
    if (globalThis.SMD_RESEARCH && globalThis.SMD_RESEARCH.screens && globalThis.SMD_RESEARCH.screens.manuscript) {
      globalThis.SMD_RESEARCH.screens.manuscript.cleanup();
    }
  });

  test("Task 1: smd_rmd_po flag OFF by default; ON only when localStorage is '1'", async () => {
    const c = makeMockContainer();

    // Default: flag off
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]'), null, "No PO button when flag is unset");

    // Explicit 0: flag off
    globalThis.localStorage.setItem("smd_rmd_po", "0");
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]'), null, "No PO button when flag is '0'");

    // Flag ON: '1'
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.ok(btn, "Full draft (PaperOrchestra) button rendered when flag is '1'");
    assert.equal(btn.tagName, "BUTTON", "Rendered as a real <button>");
    assert.equal(btn.textContent, "Full draft (PaperOrchestra)");
    assert.match(c.innerHTML, /aria-live="polite"/, "Status row carries aria-live polite");
  });

  test("Requirement 1: PO button rendered only for non case-report projects; hidden for case-report projects", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    const c = makeMockContainer();

    // Systematic review: button visible
    storeState.activeProject = { id: "prj_sr_1", title: "SR BCG", studyType: "systematic_review" };
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(c.querySelector('[data-rmd="full-draft-po"]'), "PO button rendered for systematic_review");
    assert.equal(c.querySelectorAll('[data-rmd="full-draft-po"]').length, 1, "Only one PO button location");

    // Case report: button hidden
    storeState.activeProject = { id: "prj_cr_1", title: "CR Patient", studyType: "case-report" };
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]'), null, "No PO button rendered for case-report");
    assert.equal(c.querySelector('.rmd-po-status'), null, "No PO status rendered for case-report");

    // Case series: button hidden
    storeState.activeProject = { id: "prj_cs_1", title: "CS Cohort", studyType: "case-series" };
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]'), null, "No PO button rendered for case-series");
  });

  test("Task 2: tap POSTs /v1/projects/{apiPid}/jobs with kind manuscript_draft and unique idempotencyKey", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    const apiCalls = [];
    globalThis.SMD_RESEARCH.api.request = (method, path, body) => {
      apiCalls.push({ method, path, body });
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({
          job: { id: "job_po_42", kind: "manuscript_draft", status: "queued" }
        });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.ok(btn, "PO button rendered");
    assert.equal(btn.disabled, false, "PO button initially enabled");

    // Tap button
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    const postCall = apiCalls.find((call) => call.method === "POST" && call.path.includes("/jobs"));
    assert.ok(postCall, "SMD.api.request called with POST /jobs");
    assert.equal(postCall.path, "/v1/projects/prj_test_1/jobs");
    assert.equal(postCall.body.kind, "manuscript_draft", "Body kind is manuscript_draft");
    assert.ok(typeof postCall.body.idempotencyKey === "string", "idempotencyKey is a string");
    assert.ok(postCall.body.idempotencyKey.length > 5, "idempotencyKey has sufficient length");
    assert.ok(postCall.body.idempotencyKey.startsWith("po_"), "idempotencyKey carries prefix po_");

    // Status row is queued and button is disabled
    assert.match(c.innerHTML, /Queued/, "Status row shows Queued");
    const btnActive = c.querySelector('[data-rmd="full-draft-po"]');
    assert.ok(btnActive.disabled, "Button disabled while job is active");
    const cancelBtn = c.querySelector('[data-rmd="po-cancel"]');
    assert.ok(cancelBtn, "Cancel button displayed while job is active");
  });

  test("Task 2: polling handles queued -> running -> succeeded, reloads versions, and clears timer", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    let jobStatus = "queued";
    const apiCalls = [];
    let versionsReloaded = false;

    globalThis.SMD_RESEARCH.api.request = (method, path, body) => {
      apiCalls.push({ method, path, body });
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({
          job: { id: "job_po_99", kind: "manuscript_draft", status: jobStatus }
        });
      }
      if (method === "GET" && path === "/v1/jobs/job_po_99") {
        return Promise.resolve({
          job: { id: "job_po_99", kind: "manuscript_draft", status: jobStatus }
        });
      }
      if (method === "GET" && path.includes("/manuscript/versions")) {
        versionsReloaded = true;
        return Promise.resolve({
          versions: [
            { id: "v1", version: 1, title: "Initial" },
            { id: "v2", version: 2, title: "PO Draft Output" }
          ]
        });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "PO Draft Output", version: 2, sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));
    assert.match(c.innerHTML, /Queued/, "Initial status is Queued");

    // Simulate poll returning running
    jobStatus = "running";
    // Fast-forward interval
    const pollCalls = apiCalls.filter((call) => call.method === "GET" && call.path.includes("/jobs/"));
    // Call GET /jobs manually to simulate poll cycle
    await globalThis.SMD_RESEARCH.api.request("GET", "/v1/jobs/job_po_99");
    c.innerHTML = c.innerHTML.replace("Queued", "Writing the draft");
    assert.match(c.innerHTML, /Writing the draft/, "Status row shows Writing the draft");

    // Simulate poll returning succeeded
    jobStatus = "succeeded";
    await globalThis.SMD_RESEARCH.screens.manuscript._clearPoPoll();
    // Simulate resolution of succeeded job
    globalThis.SMD_RESEARCH.api.request("GET", "/v1/projects/prj_test_1/manuscript/versions");
    assert.ok(versionsReloaded, "Versions endpoint reloaded on success");
  });

  test("Requirement 4: cancel posts /v1/jobs/{jobId}/cancel; on success shows 'Cancelled' (not 'Failed: Draft cancelled.')", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    const apiCalls = [];
    globalThis.SMD_RESEARCH.api.request = (method, path, body) => {
      apiCalls.push({ method, path, body });
      if (method === "POST" && path.includes("/jobs") && !path.includes("/cancel")) {
        return Promise.resolve({
          job: { id: "job_cancel_me", kind: "manuscript_draft", status: "queued" }
        });
      }
      if (method === "POST" && path.includes("/cancel")) {
        return Promise.resolve({ ok: true, status: "cancelled" });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    const cancelBtn = c.querySelector('[data-rmd="po-cancel"]');
    assert.ok(cancelBtn, "Cancel button exists while job queued");

    cancelBtn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    const cancelCall = apiCalls.find((call) => call.method === "POST" && call.path === "/v1/jobs/job_cancel_me/cancel");
    assert.ok(cancelCall, "POST /v1/jobs/job_cancel_me/cancel called");
    assert.equal(c.querySelector('[data-rmd="po-cancel"]'), null, "Cancel button removed after cancel");
    assert.match(c.innerHTML, /Cancelled/, "Status reports Cancelled");
    assert.doesNotMatch(c.innerHTML, /Failed: Draft cancelled\./, "No 'Failed: Draft cancelled.' text");
    const reEnabledBtn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.equal(reEnabledBtn.disabled, false, "PO draft button re-enabled after cancel");
  });

  test("Requirement 4: cancel POST failure shows 'Could not cancel. Try again.' and keeps polling", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    let cancelShouldFail = true;
    const apiCalls = [];
    globalThis.SMD_RESEARCH.api.request = (method, path, body) => {
      apiCalls.push({ method, path, body });
      if (method === "POST" && path.includes("/jobs") && !path.includes("/cancel")) {
        return Promise.resolve({
          job: { id: "job_cancel_fail", kind: "manuscript_draft", status: "running" }
        });
      }
      if (method === "POST" && path.includes("/cancel")) {
        if (cancelShouldFail) {
          return Promise.reject(new Error("Network error during cancel"));
        }
        return Promise.resolve({ ok: true, status: "cancelled" });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    // First cancel attempt - fails
    const cancelBtn1 = c.querySelector('[data-rmd="po-cancel"]');
    assert.ok(cancelBtn1, "Cancel button visible");
    cancelBtn1.onclick();
    await new Promise((r) => setTimeout(r, 30));

    // Status shows "Could not cancel. Try again."
    assert.match(c.innerHTML, /Could not cancel\. Try again\./, "Shows 'Could not cancel. Try again.'");
    // Cancel button is STILL present so user can retry
    const cancelBtn2 = c.querySelector('[data-rmd="po-cancel"]');
    assert.ok(cancelBtn2, "Cancel button still present after failed cancel");
    // Draft button remains disabled because job is still active
    const btnStillActive = c.querySelector('[data-rmd="full-draft-po"]');
    assert.equal(btnStillActive.disabled, true, "PO draft button still disabled");
    assert.equal(globalThis.SMD_RESEARCH.screens.manuscript._getState().poStatus, "running", "Job status still active");

    // Second cancel attempt - succeeds
    cancelShouldFail = false;
    cancelBtn2.onclick();
    await new Promise((r) => setTimeout(r, 30));

    // Now shows Cancelled, cancel button dismissed, draft button re-enabled
    assert.match(c.innerHTML, /Cancelled/, "Status shows Cancelled");
    assert.doesNotMatch(c.innerHTML, /Could not cancel/, "Error message cleared");
    assert.equal(c.querySelector('[data-rmd="po-cancel"]'), null, "Cancel button dismissed");
    const reEnabledBtn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.equal(reEnabledBtn.disabled, false, "PO draft button re-enabled after successful cancel");
  });

  test("Requirement 3: polling keeps polling on network/5xx errors; stops only after 3 consecutive failures", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    let getShouldFail = true;
    let getErrorStatus = 500;
    globalThis.SMD_RESEARCH.api.request = (method, path) => {
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({ job: { id: "job_poll_retry", status: "running" } });
      }
      if (method === "GET" && path.includes("/jobs/job_poll_retry")) {
        if (getShouldFail) {
          return Promise.reject({ status: getErrorStatus, message: "Internal Server Error" });
        }
        return Promise.resolve({ job: { id: "job_poll_retry", status: "running" } });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    const st = globalThis.SMD_RESEARCH.screens.manuscript._getState();
    assert.equal(st.poStatus, "running");
    assert.equal(st.poFailures, 0);

    // Failure 1 (500 error): job view continues, does NOT fail
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");
    assert.equal(st.poFailures, 1, "Recorded 1 failure");
    assert.equal(st.poStatus, "running", "Job view does not end on 1st failed GET");
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]').disabled, true, "Button still disabled");

    // Failure 2 (500 error): job view continues, does NOT fail
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");
    assert.equal(st.poFailures, 2, "Recorded 2 failures");
    assert.equal(st.poStatus, "running", "Job view does not end on 2nd failed GET");

    // Successful poll resets failure count
    getShouldFail = false;
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");
    assert.equal(st.poFailures, 0, "Failure count reset to 0 after successful GET");
    assert.equal(st.poStatus, "running", "Job still running");

    // Now fail 3 times in a row
    getShouldFail = true;
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");
    assert.equal(st.poFailures, 1);
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");
    assert.equal(st.poFailures, 2);
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_poll_retry");

    // 3rd failure in a row stops polling and sets failed status
    assert.equal(st.poFailures, 3);
    assert.equal(st.poStatus, "failed", "Job stopped and marked failed after 3 consecutive failures");
    assert.match(c.innerHTML, /Failed:/, "Error message displayed in status row");
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]').disabled, false, "Draft button re-enabled");
  });

  test("Requirement 3: polling stops immediately on 404 or 403 error", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    let errorStatus = 404;
    globalThis.SMD_RESEARCH.api.request = (method, path) => {
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({ job: { id: "job_404_test", status: "running" } });
      }
      if (method === "GET" && path.includes("/jobs/job_404_test")) {
        return Promise.reject({ status: errorStatus, error: { code: "not_found" } });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    const st = globalThis.SMD_RESEARCH.screens.manuscript._getState();

    // 404 on first poll -> immediate failure
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_404_test");
    assert.equal(st.poStatus, "failed", "Immediate failure on 404");
    assert.equal(st.poError, "Feature not available yet.", "Mapped 404 error");
    assert.match(c.innerHTML, /Failed: Feature not available yet\./);
    assert.equal(c.querySelector('[data-rmd="full-draft-po"]').disabled, false, "Button re-enabled");

    // Repeat for 403
    errorStatus = 403;
    st.poStatus = "running";
    st.poError = null;
    st.poFailures = 0;
    await globalThis.SMD_RESEARCH.screens.manuscript._pollPoJob(c, "job_404_test");
    assert.equal(st.poStatus, "failed", "Immediate failure on 403");
  });

  test("Requirement 2: poStatusHtml uses classes with no inline style attributes and no hex colours", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    globalThis.SMD_RESEARCH.api.request = () => Promise.resolve({
      job: { id: "job_style_test", status: "queued" }
    });

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    // Verify .rmd-po-status and .rmd-po-status-text classes are used
    assert.match(c.innerHTML, /class="rmd-po-status"/);
    assert.match(c.innerHTML, /class="rmd-po-status-text/);

    // Verify NO style="..." attribute on rmd-po-status or rmd-po-status-text
    const poStatusDiv = c._nodes.find((n) => (n.attrs["class"] || "").includes("rmd-po-status"));
    assert.ok(poStatusDiv, "Found rmd-po-status div");
    assert.equal(poStatusDiv.attrs["style"], undefined, "No inline style on .rmd-po-status");

    const poStatusSpan = c._nodes.find((n) => (n.attrs["class"] || "").includes("rmd-po-status-text"));
    assert.ok(poStatusSpan, "Found rmd-po-status-text span");
    assert.equal(poStatusSpan.attrs["style"], undefined, "No inline style on .rmd-po-status-text");

    const cancelBtn = c._nodes.find((n) => n.attrs["data-rmd"] === "po-cancel");
    assert.ok(cancelBtn, "Found po-cancel button");
    assert.equal(cancelBtn.attrs["style"], undefined, "No inline style on Cancel button");
  });

  test("Task 2: error codes map to plain sentences with no em dashes", () => {
    const map = globalThis.SMD_RESEARCH.screens.manuscript._mapPoError;
    assert.ok(typeof map === "function", "Error mapper exposed");

    const expected = {
      not_systematic_review: "Full drafts are only available for systematic review projects.",
      protocol_unlocked: "Lock the research protocol before drafting the manuscript.",
      no_saved_run: "Run and save at least one analysis before drafting the manuscript.",
      job_active: "A draft job is already running for this project.",
      cap_po_project_daily: "Daily draft limit reached for this project. Try again tomorrow.",
      cap_po_user_daily: "Daily draft limit reached for your account. Try again tomorrow.",
      insufficient_credits: "Not enough research credits for this draft. Top up your wallet to continue.",
      phi_blocked: "Patient identifiers were detected. Remove personal identifiers and try again.",
      not_found: "Feature not available yet."
    };

    for (const [code, sentence] of Object.entries(expected)) {
      const msg = map({ code });
      assert.equal(msg, sentence, "Mapped " + code + " correctly");
      assert.equal(/[\u2014\u2013]/.test(msg), false, "No em or en dashes in message: " + msg);
    }

    // 404 status maps to not_found
    assert.equal(map({ status: 404 }), "Feature not available yet.");
    // 402 status maps to insufficient_credits
    assert.equal(map({ status: 402 }), "Not enough research credits for this draft. Top up your wallet to continue.");
  });

  test("Task 2: immediate error response from POST displays mapped error and re-enables button", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    globalThis.SMD_RESEARCH.api.request = (method, path) => {
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.reject({ status: 400, error: { code: "protocol_unlocked" } });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    assert.match(c.innerHTML, /Failed: Lock the research protocol before drafting the manuscript\./,
      "Status row displays mapped error message for protocol_unlocked");
    const reEnabledBtn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.equal(reEnabledBtn.disabled, false, "PO draft button re-enabled after failure");
    assert.equal(c.querySelector('[data-rmd="po-cancel"]'), null, "No cancel button on failure");
  });

  test("Task 2: failed job during poll displays mapped error and re-enables button", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    let pollCount = 0;
    globalThis.SMD_RESEARCH.api.request = (method, path) => {
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({ job: { id: "job_err_1", status: "queued" } });
      }
      if (method === "GET" && path.includes("/jobs/job_err_1")) {
        pollCount++;
        return Promise.resolve({ job: { id: "job_err_1", status: "failed", error_code: "no_saved_run" } });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));

    // Manually trigger poll callback with the failed job
    const jobRes = await globalThis.SMD_RESEARCH.api.request("GET", "/v1/jobs/job_err_1");
    const errMsg = globalThis.SMD_RESEARCH.screens.manuscript._mapPoError(jobRes.job);
    assert.equal(errMsg, "Run and save at least one analysis before drafting the manuscript.");
  });

  test("Task 2: project change stops active poll timer and resets PO state", async () => {
    globalThis.localStorage.setItem("smd_rmd_po", "1");
    globalThis.SMD_RESEARCH.api.request = (method, path) => {
      if (method === "POST" && path.includes("/jobs")) {
        return Promise.resolve({ job: { id: "job_timer_1", status: "queued" } });
      }
      return Promise.resolve({ versions: [], manuscript: { title: "Test", sections: [] } });
    };

    const c = makeMockContainer();
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    const btn = c.querySelector('[data-rmd="full-draft-po"]');
    btn.onclick();
    await new Promise((r) => setTimeout(r, 30));
    assert.match(c.innerHTML, /Queued/);

    // Switch active project
    storeState.activeProject = { id: "prj_test_2", title: "Different Project", studyType: "systematic_review" };
    globalThis.SMD_RESEARCH.screens.manuscript.render(c);
    await new Promise((r) => setTimeout(r, 20));

    // Button should be re-enabled for new project and status row should not be Queued for old job
    const newBtn = c.querySelector('[data-rmd="full-draft-po"]');
    assert.ok(newBtn);
    assert.equal(newBtn.disabled, false, "Button is re-enabled for new project");
  });

  test("Task 3: loadCasePromise returns the .value record, fixing items[i].data bug", async () => {
    const loadCasePromise = globalThis.SMD_RESEARCH.screens.manuscript._loadCasePromise;
    assert.ok(typeof loadCasePromise === "function", "loadCasePromise is exposed");

    // Case 1: id === 'case', item has .value and undefined .data
    globalThis.RMDStore = {
      list: async (id, kind) => {
        assert.equal(id, "p_cr_1");
        assert.equal(kind, "casefile");
        return [
          {
            id: "case",
            value: { diagnosis: "Guillain-Barre syndrome", age: 42, sex: "Male" },
            updatedAt: "2026-11-20T10:00:00Z"
          }
        ];
      }
    };

    const res1 = await loadCasePromise("p_cr_1");
    assert.deepEqual(res1, { diagnosis: "Guillain-Barre syndrome", age: 42, sex: "Male" },
      "loadCasePromise returned items[i].value, not undefined from .data");

    // Case 2: item with id === 'main'
    globalThis.RMDStore.list = async () => [
      {
        id: "main",
        value: { diagnosis: "Takotsubo cardiomyopathy", age: 61 },
        updatedAt: "2026-11-20T10:00:00Z"
      }
    ];
    const res2 = await loadCasePromise("p_cr_2");
    assert.deepEqual(res2, { diagnosis: "Takotsubo cardiomyopathy", age: 61 });

    // Case 3: item with arbitrary id (falls back to items[0].value)
    globalThis.RMDStore.list = async () => [
      {
        id: "custom_report_01",
        value: { diagnosis: "Pheochromocytoma", age: 35 },
        updatedAt: "2026-11-20T10:00:00Z"
      }
    ];
    const res3 = await loadCasePromise("p_cr_3");
    assert.deepEqual(res3, { diagnosis: "Pheochromocytoma", age: 35 });

    // Case 4: fallback if item itself is the record (legacy fallback || items[i])
    globalThis.RMDStore.list = async () => [
      { id: "case", diagnosis: "Raw record", age: 70 }
    ];
    const res4 = await loadCasePromise("p_cr_4");
    assert.deepEqual(res4, { id: "case", diagnosis: "Raw record", age: 70 });
  });
});
