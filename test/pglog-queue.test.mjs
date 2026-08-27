/* test/pglog-queue.test.mjs — the offline submit queue.
 *
 * Two callers can start a flush (the boot timer in pglog.js and the `online` listener), and a
 * reconnect fires both. There was no re-entrancy guard and the server has no idempotency key, so the
 * guide could receive the same entry twice. Separately, the pass ended by keeping ONLY the ids that
 * failed - dropping any draft queued WHILE the flush was in flight, after the app had promised the
 * resident it would be submitted once they were back online.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../pglog-store.js", import.meta.url), "utf8");
// saveDraft() bails out with null unless the model is reachable, so load it into the same window.
const MODEL_SRC = readFileSync(new URL("../pglog-model.js", import.meta.url), "utf8");

function loadStore(fetchImpl) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => Array.from(mem.keys())[i],
    get length() { return mem.size; },
  };
  const win = {
    // serverOn() reads the flags object, not localStorage directly.
    SMD_PGLOG_FLAGS: { bool: (k) => k === "smd_pglog_server" },
    localStorage,
    navigator: { onLine: true },                     // online()
    SMD_IDTOKEN: () => "test-token",                 // token()
    addEventListener() {},
    location: { origin: "https://stewardmd.in" },
    fetch: fetchImpl,
  };
  const doc = { addEventListener() {} };
  new Function("window", "module", MODEL_SRC)(win, { exports: {} });   // -> win.SMD_PGLOG_MODEL
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", "document", "fetch",
               SRC)(win, localStorage, mod, doc, fetchImpl);
  return { store: win.SMD_PGLOG_STORE || mod.exports, localStorage };
}

/** Minimal server: every POST /entries mints an id; /submit succeeds. Counts what it was asked. */
function fakeServer() {
  const calls = { created: [], submitted: [] };
  let n = 0;
  const impl = (url, opts) => {
    const u = String(url);
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    if (/\/entries$/.test(u)) {
      const id = "srv-" + (++n);
      calls.created.push({ id, procedureText: body.procedureText });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, entry: { id, status: "draft" } }),
      });
    }
    if (/\/submit$/.test(u)) {
      calls.submitted.push(u);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, entry: { id: "x", status: "submitted" } }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  return { impl, calls };
}

const draftFor = (text) => ({
  kind: "procedure", occurredAt: "2026-08-20", procedureText: text,
  role: "performed_supervised", supervisor: "fb:guide-1", residentId: "res-1",
});

test("two concurrent flushes submit each queued draft exactly once", async () => {
  const server = fakeServer();
  const { store } = loadStore(server.impl);

  const a = store.saveDraft(draftFor("Central venous access"));
  const b = store.saveDraft(draftFor("Lumbar puncture"));
  store.queueDraft(a.id);
  store.queueDraft(b.id);
  assert.equal(store.queued().length, 2, "both drafts are queued");

  // A reconnect fires the boot timer and the online listener together.
  await Promise.all([store.flush(), store.flush()]);

  assert.equal(server.calls.created.length, 2,
    `each draft POSTed once, got ${JSON.stringify(server.calls.created.map((c) => c.procedureText))}`);
  const texts = server.calls.created.map((c) => c.procedureText).sort();
  assert.deepEqual(texts, ["Central venous access", "Lumbar puncture"]);
  assert.equal(store.queued().length, 0, "a fully successful pass empties the queue");
});

test("a draft queued DURING a flush is not dropped from the queue", async () => {
  const server = fakeServer();
  const { store } = loadStore(server.impl);

  const first = store.saveDraft(draftFor("Ascitic tap"));
  store.queueDraft(first.id);

  const flushing = store.flush();
  // Saved and queued while the pass above is still in flight.
  const late = store.saveDraft(draftFor("Pleural tap"));
  store.queueDraft(late.id);
  await flushing;

  // queued() returns the draft OBJECTS, not their ids.
  const stillQueued = store.queued().map((d) => d && d.id);
  assert.ok(stillQueued.indexOf(late.id) > -1,
    `the late draft must still be queued for the next pass, got ${JSON.stringify(stillQueued)}`);
  assert.equal(server.calls.created.length, 1, "and it was not submitted by the pass that predated it");
});
