/**
 * Phase 04 unit tests for research-ondevice-jobs.js (window.SMD_RMD_JOBS).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CP = require("../research-ondevice-checkpoint.js");
const JOBS = require("../research-ondevice-jobs.js");

function makeMemoryCp() {
  const m = new Map();
  CP._setBackend({
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    put: async (k, v) => { m.set(k, JSON.stringify(v)); },
    remove: async (k) => { m.delete(k); },
    list: async (prefix) => {
      const out = [];
      for (const [k, v] of m.entries()) {
        if (!prefix || k.startsWith(prefix)) out.push({ key: k, value: JSON.parse(v) });
      }
      return out;
    },
  });
  return CP;
}

function makeFakeClock(initial = 1000) {
  let now = initial;
  let nextId = 1;
  const timers = new Map();

  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        let earliest = null;
        for (const [id, t] of timers.entries()) {
          if (t.at <= target && (!earliest || t.at < earliest.t.at)) {
            earliest = { id, t };
          }
        }
        if (!earliest) break;
        timers.delete(earliest.id);
        now = earliest.t.at;
        earliest.t.fn();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
  };
  return clock;
}

/* Drains every pending promise chain: one setImmediate turn runs only after
 * the microtask queue is empty, so a few turns settle chains of any length
 * (checkpoint reads and writes add several hops before each device try). */
async function flushMicrotasks(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

test("success on first try clears count and emits privacy line", async () => {
  const cp = makeMemoryCp();
  const statuses = [];
  let devCalls = 0;
  let cloudCalls = 0;

  const out = await JOBS.runWithFallback(
    "pdf",
    async (ctx) => {
      devCalls++;
      assert.equal(ctx.tryNumber, 1);
      return { pages: [{ page: 1, text: "hello" }] };
    },
    async () => { cloudCalls++; },
    {
      checkpointStore: cp,
      jobKey: "pdf:p1:first",
      onStatus: (s) => statuses.push(s),
    }
  );

  assert.equal(out.ok, true);
  assert.equal(out.source, "device");
  assert.equal(devCalls, 1);
  assert.equal(cloudCalls, 0);
  const saved = await cp.get("pdf:p1:first");
  assert.equal(saved.running, false);
  assert.equal(saved.finished, true);
  assert.equal(saved.failCount, 0);
  assert.equal(statuses[0].privacyLine, "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.");
});

test("fail, retry (1 of 2, then 2 of 2) with 3s wait, then succeed and clear count", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  const statuses = [];
  let devCalls = 0;
  let cloudCalls = 0;

  const promise = JOBS.runWithFallback(
    "stats",
    async (ctx) => {
      devCalls++;
      if (devCalls === 1) throw Object.assign(new Error("boom 1"), { code: "stats_failed" });
      if (devCalls === 2) throw Object.assign(new Error("boom 2"), { code: "device_failed" });
      return { ok: true, tryNumber: ctx.tryNumber };
    },
    async () => { cloudCalls++; },
    {
      checkpointStore: cp,
      jobKey: "stats:p1:retry",
      clock,
      onStatus: (s) => statuses.push(s),
    }
  );

  await flushMicrotasks();
  assert.equal(devCalls, 1);
  assert.equal(statuses.find((s) => s.state === "retrying")?.message, "Retrying on this device (1 of 2)");

  await clock.advance(3000);
  assert.equal(devCalls, 2);
  assert.equal(statuses.filter((s) => s.state === "retrying")[1]?.message, "Retrying on this device (2 of 2)");

  await clock.advance(3000);
  const res = await promise;
  assert.equal(res.ok, true);
  assert.equal(res.source, "device");
  assert.equal(devCalls, 3);
  assert.equal(cloudCalls, 0);
  const saved = await cp.get("stats:p1:retry");
  assert.equal(saved.failCount, 0);
  assert.equal(saved.finished, true);
});

test("three counted failures trigger needs_cloud with verbatim notice, device metadata, and Cancel/Continue", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  let devCalls = 0;
  let cloudMeta = null;
  let cloudCp = null;
  let noticeSeen = null;

  const pPdf = JOBS.runWithFallback(
    "pdf",
    async () => {
      devCalls++;
      await cp.put("pdf:p1:3fail", { page: devCalls, running: true });
      throw Object.assign(new Error("ocr error"), { code: "ocr-failed" });
    },
    async (latestCp, meta) => {
      cloudCp = latestCp;
      cloudMeta = meta;
      return { artifact: { id: "art_1" } };
    },
    {
      checkpointStore: cp,
      jobKey: "pdf:p1:3fail",
      clock,
      retryDelayMs: 10,
      getDeviceInfo: async () => ({
        model: "iPhone16,1", platform: "ios", operatingSystem: "ios", osVersion: "18.1", appVersion: "2.4.0"
      }),
      checkQuota: async () => ({ plan: "pro", allowance: 25, used: 2, remaining: 23 }),
      onNeedsCloud: async (info) => {
        noticeSeen = info;
        return { action: "continue" };
      },
    }
  );

  await flushMicrotasks();
  await clock.advance(10);
  await clock.advance(10);
  const out = await pPdf;

  assert.equal(devCalls, 3);
  assert.equal(noticeSeen.state, "needs_cloud");
  assert.equal(noticeSeen.notice, JOBS.NOTICES.pdf);
  assert.equal(out.ok, true);
  assert.equal(out.source, "cloud");
  assert.equal(cloudCp.page, 3);
  assert.equal(cloudMeta.reasons.length, 3);
  assert.equal(cloudMeta.device.model, "iPhone16,1");
  assert.equal(cloudMeta.device.osVersion, "18.1");
  assert.equal(cloudMeta.appVersion, "2.4.0");
  assert.equal(cloudMeta.engine, "ondevice:pdf");

  // Also test Cancel on draft notice keeps job on device without calling runCloud
  let draftCloudCalls = 0;
  let draftNotice = null;
  const pDraft = JOBS.runWithFallback(
    "draft",
    async () => { throw Object.assign(new Error("unavailable"), { code: "device_failed" }); },
    async () => { draftCloudCalls++; },
    {
      checkpointStore: cp,
      jobKey: "draft:p1:cancel",
      clock,
      retryDelayMs: 10,
      onNeedsCloud: async (info) => { draftNotice = info; return { action: "cancel" }; },
    }
  );
  await flushMicrotasks();
  await clock.advance(10);
  await clock.advance(10);
  const outCancel = await pDraft;
  assert.equal(draftNotice.notice, JOBS.NOTICES.draft);
  assert.equal(draftCloudCalls, 0);
  assert.equal(outCancel.ok, false);
  assert.equal(outCancel.state, "cancelled_to_device");
  assert.equal(outCancel.tryAgain, true);

  // Stats notice verbatim + Continue blocked unless hasEthicsApproval
  let statsNotice = null;
  const pStats = JOBS.runWithFallback(
    "stats",
    async () => { throw Object.assign(new Error("Worker construction failed"), {}); },
    async () => { assert.fail("runCloud must not run without ethics approval"); },
    {
      checkpointStore: cp,
      jobKey: "stats:p1:ethics",
      clock,
      retryDelayMs: 10,
      hasEthicsApproval: false,
      onNeedsCloud: async (info) => { statsNotice = info; return { action: "continue" }; },
    }
  );
  await flushMicrotasks();
  await clock.advance(10);
  await clock.advance(10);
  const outStats = await pStats;
  assert.equal(statsNotice.notice, JOBS.NOTICES.stats);
  assert.equal(statsNotice.hasEthicsApproval, false);
  assert.equal(outStats.ok, false);
  assert.equal(outStats.code, "ipd_gate");
});

test("Continue with remaining === 0 shows limit/free notice and does not call runCloud", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  let cloudCalls = 0;

  for (const [plan, expectedCode, expectedMsg] of [
    [{ plan: "pro", allowance: 25, used: 25, remaining: 0 }, "cloud_fallback_limit", JOBS.NOTICES.limitReached],
    [{ plan: "free", allowance: 0, used: 0, remaining: 0 }, "cloud_fallback_free", JOBS.NOTICES.freePlan],
  ]) {
    const p = JOBS.runWithFallback(
      "pdf",
      async () => { throw Object.assign(new Error("fail"), { code: "ocr-unavailable" }); },
      async () => { cloudCalls++; },
      {
        checkpointStore: cp,
        jobKey: "pdf:quota:" + plan.plan,
        clock,
        retryDelayMs: 5,
        checkQuota: async () => plan,
        onNeedsCloud: async () => ({ action: "continue" }),
      }
    );
    await flushMicrotasks();
    await clock.advance(5);
    await clock.advance(5);
    const res = await p;
    assert.equal(res.ok, false);
    assert.equal(res.code, expectedCode);
    assert.equal(res.message, expectedMsg);
  }
  assert.equal(cloudCalls, 0);
});

test("offline, cancel, and every data-problem code trigger zero retries and zero cloud", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  const nonCountedCodes = [
    "offline",
    "cancelled",
    "password",
    "too-many-pages",
    "invalid_formula",
    "zero_cell",
    "no_events",
    "convergence_warning",
    "logistic_not_converged",
    "cox_not_converged",
    "invalid_spec",
    "ipd_gate",
    "gate_failed",
    "phi_blocked",
    "ceiling_calls",
    "invalid_snapshot",
  ];

  for (const code of nonCountedCodes) {
    let devCalls = 0;
    let cloudCalls = 0;
    await assert.rejects(
      () => JOBS.runWithFallback(
        "stats",
        async () => {
          devCalls++;
          throw Object.assign(new Error("err " + code), { code });
        },
        async () => { cloudCalls++; },
        { checkpointStore: cp, jobKey: "stats:nc:" + code, clock, retryDelayMs: 5 }
      ),
      (err) => err && err.code === code
    );
    assert.equal(devCalls, 1, "must not retry for " + code);
    assert.equal(cloudCalls, 0, "must not call cloud for " + code);
  }
});

test("crash detection counts running:true on start as a failed try and resumes from checkpoint", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  const statuses = [];
  let seenResume = null;

  await cp.put("pdf:p1:crash", {
    running: true,
    finished: false,
    sha256: "abc",
    pages: [{ page: 1, text: "saved p1" }],
  });

  const p = JOBS.runWithFallback(
    "pdf",
    async (ctx) => {
      seenResume = ctx.checkpoint;
      return { sha256: "abc", pages: [{ page: 1, text: "saved p1" }, { page: 2, text: "done" }] };
    },
    async () => assert.fail("should not need cloud"),
    {
      checkpointStore: cp,
      jobKey: "pdf:p1:crash",
      clock,
      onStatus: (s) => statuses.push(s),
    }
  );

  await flushMicrotasks();
  assert.equal(statuses.some((s) => s.message === "Retrying on this device (1 of 2)"), true);
  await clock.advance(3000);
  const out = await p;
  assert.equal(out.ok, true);
  assert.equal(out.source, "device");
  assert.equal(seenResume.pages[0].text, "saved p1");
  assert.equal(seenResume.failCount, 1);
  assert.equal(seenResume.reasons[0].rule, "crash_or_oom");
});

test("too-slow foreground timers with fake clock, background pause, and AI wait exclusion for drafts", async () => {
  const cp = makeMemoryCp();

  // 1. PDF per-page > 30s
  {
    const clock = makeFakeClock(0);
    let devCalls = 0;
    const p = JOBS.runWithFallback(
      "pdf",
      async (ctx) => {
        devCalls++;
        if (devCalls < 4) return new Promise(() => {});
        return { pages: [] };
      },
      async () => ({ cloud: true }),
      {
        checkpointStore: cp,
        jobKey: "pdf:slowpage",
        clock,
        retryDelayMs: 100,
        checkQuota: async () => ({ plan: "pro", allowance: 25, used: 0, remaining: 25 }),
        onNeedsCloud: async () => ({ action: "continue" }),
      }
    );
    await flushMicrotasks();
    await clock.advance(30002); // try 1 exceeds 30s
    await clock.advance(100);   // retry delay
    await clock.advance(30002); // try 2 exceeds 30s
    await clock.advance(100);
    await clock.advance(30002); // try 3 exceeds 30s
    const out = await p;
    assert.equal(devCalls, 3);
    assert.equal(out.ok, true);
    assert.equal(out.source, "cloud");
  }

  // 2. Stats model > 2 min, pausing while app backgrounded via appStateChange
  {
    const clock = makeFakeClock(0);
    let appListener = null;
    let devCalls = 0;
    let timedOut = false;

    const p = JOBS.runWithFallback(
      "stats",
      () => new Promise((_res, rej) => { devCalls++; }),
      async () => ({ cloud: true }),
      {
        checkpointStore: cp,
        jobKey: "stats:fgpause",
        clock,
        retryDelayMs: 10,
        appPlugin: {
          addListener: (ev, fn) => {
            if (ev === "appStateChange") appListener = fn;
            return { remove: () => {} };
          },
        },
        onNeedsCloud: async () => { timedOut = true; return { action: "cancel" }; },
      }
    );

    await flushMicrotasks();
    await clock.advance(60000); // 1 min foreground
    appListener({ isActive: false }); // backgrounded
    await clock.advance(600000); // 10 min in background: must NOT trigger 2 min timeout!
    assert.equal(devCalls, 1);
    appListener({ isActive: true }); // back in foreground with 60s left
    await clock.advance(59000); // still under 2 min active foreground (119s total)
    assert.equal(devCalls, 1);
    await clock.advance(1005); // crosses 2 min active foreground -> try 1 times out (retry wait of 10 ms not over yet)
    assert.equal(devCalls, 1);
    await clock.advance(10);
    assert.equal(devCalls, 2);
    await clock.advance(120002);
    await clock.advance(10);
    await clock.advance(120002);
    const out = await p;
    assert.equal(timedOut, true);
    assert.equal(out.state, "cancelled_to_device");
  }

  // 3. Draft step > 5 min excludes AI wait time
  {
    const clock = makeFakeClock(0);
    const p = JOBS.runWithFallback(
      "draft",
      async (ctx) => {
        // 4 min local work
        await new Promise((r) => clock.setTimeout(r, 4 * 60 * 1000));
        // 10 min waiting on AI reply (excluded from 5 min draft step budget)
        ctx.beginAiWait();
        await new Promise((r) => clock.setTimeout(r, 10 * 60 * 1000));
        ctx.endAiWait();
        // 30s more local work -> total active step = 4m30s < 5m!
        await new Promise((r) => clock.setTimeout(r, 30 * 1000));
        return { manuscript: "ok" };
      },
      async () => assert.fail("AI wait should not count toward 5 min step timeout"),
      { checkpointStore: cp, jobKey: "draft:aiwait", clock }
    );
    await flushMicrotasks();
    await clock.advance(4 * 60 * 1000);
    await clock.advance(10 * 60 * 1000);
    await clock.advance(30 * 1000);
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.source, "device");
    assert.deepEqual(res.result, { manuscript: "ok" });
  }
});

test("holdClock stops the too-slow clock while a background job is paused by the OS", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  let ctxRef = null;
  let finish = null;
  const p = JOBS.runWithFallback(
    "pdf",
    (ctx) => { ctxRef = ctx; return new Promise((r) => { finish = r; }); },
    async () => assert.fail("held time must not count as slow"),
    { checkpointStore: cp, jobKey: "pdf:hold", clock, appPlugin: { addListener: () => ({ remove() {} }) } }
  );
  await flushMicrotasks();
  await clock.advance(20000); // 20 s of a 30 s page budget
  ctxRef.holdClock(true);
  await clock.advance(10 * 60 * 1000); // paused by the OS for 10 min
  ctxRef.holdClock(false);
  await clock.advance(9000); // 29 s counted in total
  finish({ pages: [] });
  const out = await p;
  assert.equal(out.ok, true);
  assert.equal(out.source, "device");
  assert.equal(out.attempts, 1);
});

test("cancelled_to_device resets failCount so Try again retries on device and preserves checkpoint progress (Item 13)", async () => {
  const cp = makeMemoryCp();
  const clock = makeFakeClock(0);
  let triesRun1 = 0;
  const p1 = JOBS.runWithFallback(
    "pdf",
    async () => {
      triesRun1++;
      await JOBS.updateCheckpoint(cp, "pdf:p1:retry-after-cancel", { pages: [{ n: 1, text: "saved" }], running: true });
      throw Object.assign(new Error("ocr boom"), { code: "ocr-failed" });
    },
    async () => assert.fail("cloud must not run on cancel"),
    {
      checkpointStore: cp,
      jobKey: "pdf:p1:retry-after-cancel",
      clock,
      retryDelayMs: 5,
      onNeedsCloud: async () => ({ action: "cancel" }),
    }
  );
  await flushMicrotasks();
  await clock.advance(5);
  await clock.advance(5);
  const out1 = await p1;
  assert.equal(out1.state, "cancelled_to_device");
  assert.equal(triesRun1, 3);

  const savedAfterCancel = await cp.get("pdf:p1:retry-after-cancel");
  assert.equal(savedAfterCancel.failCount, 0);
  assert.equal(savedAfterCancel.pages[0].text, "saved");

  let triesRun2 = 0;
  let seenResume = null;
  const p2 = JOBS.runWithFallback(
    "pdf",
    async (ctx) => {
      triesRun2++;
      seenResume = ctx.checkpoint;
      return { pages: [{ n: 1, text: "saved" }, { n: 2, text: "done" }] };
    },
    async () => assert.fail("should retry on device instead of jumping straight to cloud"),
    {
      checkpointStore: cp,
      jobKey: "pdf:p1:retry-after-cancel",
      clock,
      retryDelayMs: 5,
      onNeedsCloud: async () => assert.fail("needs_cloud must not fire before 3 device tries"),
    }
  );
  await flushMicrotasks();
  const out2 = await p2;
  assert.equal(triesRun2, 1);
  assert.equal(out2.ok, true);
  assert.equal(out2.source, "device");
  assert.equal(seenResume.pages[0].text, "saved");
});
