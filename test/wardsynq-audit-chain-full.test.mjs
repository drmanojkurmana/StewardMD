/* test/wardsynq-audit-chain-full.test.mjs - audit DATA-09: every shipped verification checked only the newest
 * window of the audit chain (200 to 1000 rows), so an old row changed or deleted below it was never found.
 * The whole chain can now be walked in pages (verifyAuditChainFull), and the hourly tick walks it in rotating
 * windows from a cursor kept beside the anchors (sweepAuditChain), keeping a finding until a clean pass.
 *
 * node --test --experimental-sqlite test/wardsynq-audit-chain-full.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { verifyAuditChain, verifyAuditChainFull, sweepAuditChain, readSweep, anchorHead, checkAnchors } from "../functions/_wardsynq/audit-chain.js";
import { runTick } from "../functions/_wardsynq/ops-tick.js";

const T = "t1";
const kvStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
async function hospital(n) {
  const repo = new MemoryRepository();
  for (let i = 0; i < n; i++) await repo.auditOnly(T, { id: `a${i}`, ts: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), actor: "nurse-x", action: "record.read", connectorId: "wardsynq" });
  return repo;
}

test("DATA-09: an old row changed below the newest window is found by the full walk and by nothing else", async () => {
  const repo = await hospital(1500), store = kvStore();
  await anchorHead(repo, T, store, "2026-09-02T00:00:00Z");
  repo.audit[10].actor = "dr-mallory";                      // below the application: who read the chart, changed
  assert.equal((await verifyAuditChain(repo, T, { limit: 1000 })).status, "ok", "the newest window cannot see it");
  assert.equal((await checkAnchors(repo, T, store)).status, "ok", "the anchors cannot see it");
  const full = await verifyAuditChainFull(repo, T);
  assert.equal(full.status, "broken");
  assert.equal(full.atSeq, 11);
});

test("DATA-09: a deleted old row is a gap; a clean chain walks whole across pages", async () => {
  const clean = await hospital(6000);
  const ok = await verifyAuditChainFull(clean, T);
  assert.equal(ok.status, "ok");
  assert.equal(ok.checked, 6000, "every link, over two pages");
  assert.equal(ok.headSeq, 6000);

  const repo = await hospital(1500);
  repo.audit.splice(20, 1);
  const gap = await verifyAuditChainFull(repo, T);
  assert.equal(gap.status, "gap");
  assert.equal(gap.atSeq, 21);
});

test("DATA-09: a bounded walk says partial and resumes where it stopped", async () => {
  const repo = await hospital(1500);
  const a = await verifyAuditChainFull(repo, T, { maxRows: 600 });
  assert.equal(a.status, "partial");
  assert.equal(a.nextSeq, 601);
  const b = await verifyAuditChainFull(repo, T, { fromSeq: a.nextSeq, maxRows: 600 });
  assert.equal(b.status, "partial");
  const c = await verifyAuditChainFull(repo, T, { fromSeq: b.nextSeq, maxRows: 600 });
  assert.equal(c.status, "ok");
  assert.equal(c.toSeq, 1500);
});

test("DATA-09: the rotating sweep walks the whole chain over ticks, keeps a finding, and clears it only after a clean pass from link 1", async () => {
  const repo = await hospital(2500), store = kvStore();
  let w = await sweepAuditChain(repo, T, store, "2026-09-27T01:00:00Z", { maxRows: 1000 });
  assert.equal(w.status, "partial");
  assert.equal((await readSweep(store, T)).nextSeq, 1001);
  w = await sweepAuditChain(repo, T, store, "2026-09-27T02:00:00Z", { maxRows: 1000 });
  w = await sweepAuditChain(repo, T, store, "2026-09-27T03:00:00Z", { maxRows: 1000 });
  assert.equal(w.status, "ok");
  let s = await readSweep(store, T);
  assert.equal(s.lastFullAt, "2026-09-27T03:00:00Z");
  assert.equal(s.nextSeq, 1, "wrapped back to the first link");

  const saved = repo.audit[5].actor;
  repo.audit[5].actor = "dr-mallory";
  w = await sweepAuditChain(repo, T, store, "2026-09-27T04:00:00Z", { maxRows: 1000 });
  assert.equal(w.status, "broken");
  s = await readSweep(store, T);
  assert.equal(s.finding.status, "broken");
  assert.equal(s.finding.atSeq, 6);
  assert.equal(s.finding.foundAt, "2026-09-27T04:00:00Z");
  assert.equal(s.nextSeq, 1);

  repo.audit[5].actor = saved;                                // a restore puts the row back
  await sweepAuditChain(repo, T, store, "2026-09-27T05:00:00Z", { maxRows: 1000 });
  assert.ok((await readSweep(store, T)).finding, "a partial pass does not clear it");
  await sweepAuditChain(repo, T, store, "2026-09-27T06:00:00Z", { maxRows: 1000 });
  await sweepAuditChain(repo, T, store, "2026-09-27T07:00:00Z", { maxRows: 1000 });
  s = await readSweep(store, T);
  assert.equal(s.finding, null, "a clean pass from link 1 to the head closes it");
  assert.equal(s.lastFinding.atSeq, 6, "and it stays on the record");
});

test("DATA-09: rows removed from the end after the cursor passed them are a gap, not a stuck sweep", async () => {
  const repo = await hospital(1500), store = kvStore();
  await sweepAuditChain(repo, T, store, "2026-09-27T01:00:00Z", { maxRows: 1200 });
  repo._chain.splice(1000);                                  // the tail of the chain is cut below the application
  const w = await sweepAuditChain(repo, T, store, "2026-09-27T02:00:00Z", { maxRows: 1200 });
  assert.equal(w.status, "gap");
  assert.equal((await readSweep(store, T)).nextSeq, 1);
});

test("DATA-09: the hourly tick runs the sweep beside the anchor and reports it", async () => {
  const repo = await hospital(300), store = kvStore();
  const t = await runTick(repo, T, { anchorStore: store, nowMs: Date.parse("2026-09-27T01:00:00Z") });
  assert.equal(t.anchor.status, "ok");
  assert.deepEqual(t.auditSweep, { status: "ok", atSeq: null, checked: 300 });
  assert.equal((await readSweep(store, T)).lastFullAt, "2026-09-27T01:00:00.000Z");
  const none = await runTick(repo, T, { nowMs: Date.parse("2026-09-27T01:02:00Z") });
  assert.equal(none.auditSweep, undefined, "no store handed in, no sweep");
});
