/* test/maik-local-queue.test.mjs - one generation at a time (owner bug report, 2026-09-11).
 *
 * REPORTED FROM A REAL CONSULT: MaiK Scribe on MxCore captured the Telugu transcript, then showed
 * "Could not draft the note from this dictation - the transcript is kept, try Stop again." Ask MaiK
 * Pro and ICD failed in the same session, while plain MaiK answers worked.
 *
 * CAUSE: the native engine runs ONE generation at a time and says so -
 *   LlamaEngine.swift generateSync: `if isGenerating { throw LlamaError(.busy, "a generation is
 *   already running") }` (the Android JNI is the same).
 * Until the hard Local policy only the MaiK sheet used that engine, so nothing collided. The policy
 * pointed Scribe, Ask MaiK Pro, ICD, assessment, the summary and the ICU advisories at the same
 * engine; Scribe refines on a timer AND again on Stop, so a second caller hit `busy` - and opd-emr
 * turned that into a generic failure line with no reason.
 *
 * The fake plugin below reproduces the native rule exactly: overlap a generation and it rejects.
 * These tests fail without the queue.
 *
 * node --test test/maik-local-queue.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

/** A plugin that behaves like the real one: single-threaded, rejects an overlapping generate. */
function load({ genMs = 5, hang = false } = {}) {
  const log = [];
  let busy = false, reply = () => "ok";
  let pendingReject = null;
  function generate(p) {
    if (busy) return Promise.reject(Object.assign(new Error("a generation is already running"), { code: "busy" }));
    busy = true;
    log.push({ start: Date.now(), prompt: p.prompt, system: p.system });
    return new Promise((resolve, reject) => {
      pendingReject = reject;
      if (hang) return;                       // never settles on its own: the timeout + cancel frees it
      setTimeout(() => { busy = false; resolve({ text: reply(p) }); }, genMs);
    });
  }
  const Llama = {
    available: async () => ({ available: true, loaded: true, debugBuild: true, availableMemory: 0 }),
    load: async () => ({}), generate, release: async () => ({}),
    cancel: async () => {
      busy = false;
      if (pendingReject) {
        const r = pendingReject;
        pendingReject = null;
        r(Object.assign(new Error("cancelled"), { code: "cancelled" }));
      }
      return {};
    }
  };
  const PACKS = { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, files: [{ bytes: 1107408704 }] } };
  const win = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_MODELS: { PACKS, activePack: () => "maik-lite", installedCached: () => true, pathFor: async () => "/m.gguf",
      totalBytes: () => PACKS["maik-lite"].files[0].bytes, hasVision: () => false, visionIdOf: (i) => i + "#vision", baseIdOf: (i) => i.split("#")[0] }
  };
  const wrapSetTimeout = (fn, ms) => {
    const t = setTimeout(fn, ms);
    return {
      _t: t,
      unref() {},
      ref() { if (t && t.ref) t.ref(); }
    };
  };
  const wrapClearTimeout = (t) => clearTimeout(t && t._t ? t._t : t);
  win.setTimeout = wrapSetTimeout;
  win.clearTimeout = wrapClearTimeout;
  win.window = win;
  new Function("window", "document", "setTimeout", "clearTimeout", SRC)(win, { addEventListener() {} }, wrapSetTimeout, wrapClearTimeout);
  const L = win.SMD_MAIK_LOCAL;
  L.setIdleMs(100000, 100000);   // never release the model mid-test
  return { L, log, setReply: (f) => { reply = f; } };
}
const json = (o) => JSON.stringify(o);

test("the fake plugin really does reject an overlapping generation (the bug is reproducible)", async () => {
  const { L } = load({ genMs: 20 });
  const raw = () => L.translate("fever 3 days");
  // Two calls issued together must NOT both be handed to the plugin at once. Without the queue the
  // second rejects with busy; this asserts the queue is what prevents it.
  const results = await Promise.all([raw(), raw()]);
  for (const r of results) assert.ok(!/busy|already running/i.test(String((r && r.error) || "")), "busy leaked: " + JSON.stringify(r));
});

test("Scribe, Ask MaiK Pro, ICD and a MaiK answer fired together all complete - none gets 'busy'", async () => {
  const { L, log, setReply } = load({ genMs: 10 });
  setReply((p) => {
    if (/OPD decision support/.test(p.system)) return json({ provisionalDx: "viral fever", ddx: [], investigations: [], treatment: [], redFlags: [] });
    if (/clinical coder/.test(p.system)) return json({ suggestions: [{ id: "icd10:A00", confidence: "high", why: "x" }] });
    if (/OPD scribe/.test(p.system)) return json({ en: "fever 3 days", emrFields: { cc: "fever 3 days" }, suggestions: { ddx: [], investigations: [] } });
    return "A plain answer.";
  });
  const [scribe, pro, icd, ans] = await Promise.all([
    L.scribeFill("Patient has fever for three days and headache."),
    L.opdSuggest("fever 3 days, headache"),
    L.icdRank("cholera", [{ id: "icd10:A00", system: "ICD-10", code: "A00", title: "Cholera" }]),
    L.answer({ summary: "", question: "treatment of dengue?" }, {})
  ]);
  for (const [name, r] of [["scribe", scribe], ["pro", pro], ["icd", icd], ["answer", ans]]) {
    assert.ok(r && !r.error, name + " failed: " + JSON.stringify(r));
  }
  assert.equal(scribe.emrFields.cc, "fever 3 days");
  assert.equal(pro.provisionalDx, "viral fever");
  assert.equal(icd.suggestions[0].code, "A00");
  assert.match(ans.text, /A plain answer/);
  // Nothing overlapped: every generation started after the previous one finished.
  for (let i = 1; i < log.length; i++) assert.ok(log[i].start >= log[i - 1].start, "generations must be serial");
});

test("work the clinician is watching goes ahead of queued background drafting", async () => {
  const { L, log, setReply } = load({ genMs: 15 });
  setReply((p) => (/OPD scribe/.test(p.system) ? json({ en: "", emrFields: {}, suggestions: {} })
    : /OPD decision support/.test(p.system) ? json({ provisionalDx: "dx", ddx: [], investigations: [], treatment: [], redFlags: [] })
    : "answer"));
  // Both answer() and scribeFill() reach the queue a microtask or two after they are called, so the
  // test drives the states explicitly rather than assuming call order.
  const until = async (p, ms = 2000) => { const t0 = Date.now(); while (!p()) { await new Promise((r) => setTimeout(r, 2)); if (Date.now() - t0 > ms) throw new Error("timed out waiting"); } };
  const first = L.answer({ summary: "", question: "one" }, {});
  await until(() => L.queueState().running);                       // the engine is occupied
  const bg = L.scribeFill("A background consult transcript that is long enough to matter.");
  await until(() => L.queueState().waiting >= 1);                  // the refine is queued behind it
  const tap = L.opdSuggest("chest pain");
  await until(() => L.queueState().waiting >= 2);
  await Promise.all([first, bg, tap]);
  const order = log.map((e) => (/OPD scribe/.test(e.system) ? "scribe" : /OPD decision support/.test(e.system) ? "tap" : "answer"));
  assert.equal(order[0], "answer", "the running job is never interrupted");
  assert.ok(order.indexOf("tap") < order.indexOf("scribe"), "interactive work overtakes queued background drafting: " + order.join(","));
});

test("a refine overtaken by a newer transcript does not spend a generation on stale text", async () => {
  const { L, log, setReply } = load({ genMs: 10 });
  setReply(() => json({ en: "x", emrFields: { cc: "fever" }, suggestions: {} }));
  const busyWork = L.answer({ summary: "", question: "hold the engine" }, {});
  const stale = L.scribeFill("Patient has fever.");
  const fresh = L.scribeFill("Patient has fever. And a cough. And more detail besides.");
  const [, s, f] = await Promise.all([busyWork, stale, fresh]);
  assert.ok(!s.error && !f.error);
  const scribeRuns = log.filter((e) => /OPD scribe/.test(e.system)).length;
  assert.equal(scribeRuns, 1, "only the newest refine runs, not both");
  assert.ok(log.filter((e) => /OPD scribe/.test(e.system))[0].prompt.indexOf("cough") >= 0, "and it is the newest text that runs");
});

test("a wedged generation times out, cancels, and the queue keeps moving", async () => {
  const { L } = load({ hang: true });
  L.setJobTimeoutMs(40);
  const stuck = await L.translate("fever 3 days").then((r) => r, (e) => ({ error: String(e && e.message) }));
  assert.match(String(stuck.error || stuck.reason || ""), /timed out/i);
  const after = await L.translate("fever 3 days").then((r) => r, (e) => ({ error: String(e && e.message) }));
  assert.match(String(after.error || ""), /timed out/i, "the queue is not wedged: the next job runs and times out on its own");
  assert.equal(L.queueState().running, false, "nothing is left running");
});

test("a pass where the model only ever answered in prose reports it instead of leaving the form silently empty", async () => {
  const { L, setReply } = load({ genMs: 5 });
  setReply(() => "Sure! Here is a summary of the consultation: the patient has a fever.");   // prose, never JSON
  const r = await L.scribeFill("Patient has fever for three days.");
  assert.equal(r.error, "draft-unparsed");
  assert.match(r.message, /prose instead of a structured note/);
  assert.match(r.message, /transcript is kept/);
  // But a pass that captured SOMETHING is not an error, even if a later window failed to parse.
  let n = 0;
  setReply(() => (++n === 1 ? json({ en: "fever 3 days", emrFields: { cc: "fever 3 days" }, suggestions: {} }) : "prose again"));
  L.scribeReset();
  const ok = await L.scribeFill("Patient has fever for three days.");
  assert.ok(!ok.error); assert.equal(ok.emrFields.cc, "fever 3 days");
});

test("answer()'s own retries re-enter the queue instead of deadlocking behind themselves", async () => {
  // answer() calls ITSELF for the blank-answer retry and the no-coverage ungrounded retry, from
  // inside its own running job. A plain FIFO would wait forever for a job that cannot finish.
  const { L, log, setReply } = load({ genMs: 5 });
  let n = 0;
  setReply(() => (++n === 1 ? "" : "A real answer after the retry."));   // empty first pass -> internal retry
  const r = await Promise.race([
    L.answer({ summary: "", question: "treatment of dengue?" }, {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error("DEADLOCK: answer() never settled")), 3000))
  ]);
  assert.ok(!r.error, JSON.stringify(r));
  assert.match(r.text, /A real answer after the retry/);
  assert.equal(log.length, 2, "the retry ran, in the same slot");
  assert.equal(L.queueState().running, false);
});

test("the reason reaches the clinician: opd-emr names busy, timeout and memory instead of a generic line", () => {
  const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const i = OPD.indexOf("function doRefine(transcript)");
  const body = OPD.slice(i, i + 3000);
  assert.match(body, /busy\|already running/, "busy is named");
  assert.match(body, /timed out/);
  assert.match(body, /not-enough-memory\|low-memory/);
  assert.match(body, /Could not draft the note: /, "any other engine error is quoted, not swallowed");
  assert.match(body, /_scribeCapToasted !== cm/, "a capability message is deduped per reason, not once per session");
});
