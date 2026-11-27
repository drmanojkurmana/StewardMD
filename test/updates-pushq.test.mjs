/* Medical Updates push queue (functions/_updates_pushq.js, 2026-11-27). The crawl used to fan the push
 * out inside its own exhausted invocation and every failure was swallowed, so no phone got a banner.
 * Now the crawl enqueues and a fresh invocation drains, logging sent/total. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, drain, pickPerWorkspace, pushMessage } from "../functions/_updates_pushq.js";

function kv() {
  const m = new Map();
  return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}

test("one job per workspace, highest importance wins, in-app deep link", () => {
  const jobs = pickPerWorkspace([
    { id: "a", workspace: "internal_medicine", importance: "normal", title: "A", type: "guideline" },
    { id: "b", workspace: "internal_medicine", importance: "high", title: "B", type: "drug_approval", summary: "Line one\nline two" },
    { id: "c", workspace: "surgery", importance: "normal", title: "C" },
  ]);
  assert.equal(jobs.length, 2);
  const im = jobs.find((j) => j.workspace === "internal_medicine");
  assert.equal(im.id, "b");
  assert.equal(im.msg.title, "New Drug Approval: B");
  assert.equal(im.msg.body, "Line one");
  assert.equal(im.msg.url, "/?u=b");
  assert.equal(pushMessage(null).url, "/");
});

test("enqueue never sends; drain sends once, clears, and logs sent/total", async () => {
  const store = kv(); const env = { PUSH_KV: store };
  const sends = [], logs = [];
  const r = await enqueue(env, [{ id: "x", workspace: "internal_medicine", title: "X" }]);
  assert.equal(r.queued, 1);
  assert.equal(sends.length, 0);
  const deps = { native: async (m, o) => { sends.push([m, o]); return { sent: 2, total: 3 }; }, web: async () => ({ sent: 0, total: 0 }), log: async (l) => logs.push(l) };
  const d = await drain(env, deps);
  assert.equal(d.jobs, 1);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0][1], { workspace: "internal_medicine" });
  assert.equal(logs[0].source_id, "push");
  assert.match(logs[0].detail, /native=2\/3/);
  assert.equal(logs[0].status, "ok");
  const again = await drain(env, deps);
  assert.equal(again.jobs, 0);
  assert.equal(sends.length, 1, "a drained job is not sent twice");
});

test("a newer job for the same workspace replaces the queued one", async () => {
  const store = kv(); const env = { PUSH_KV: store };
  await enqueue(env, [{ id: "old", workspace: "surgery", title: "Old" }]);
  await enqueue(env, [{ id: "new", workspace: "surgery", title: "New" }]);
  const q = JSON.parse(store.m.get("updates:pushq"));
  assert.equal(q.length, 1);
  assert.equal(q[0].id, "new");
});

test("a send that reaches nobody is logged as an error, and a throw is captured", async () => {
  const env = { PUSH_KV: kv() }, logs = [];
  await enqueue(env, [{ id: "z", workspace: "ent", title: "Z" }]);
  const d = await drain(env, { native: async () => { throw new Error("Too many subrequests"); }, web: async () => ({ sent: 0, total: 0 }), log: async (l) => logs.push(l) });
  assert.equal(logs[0].status, "error");
  assert.match(logs[0].detail, /Too many subrequests/);
  assert.match(d.results[0].error, /Too many/);
});
