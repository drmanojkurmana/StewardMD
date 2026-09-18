// Tests for connect-agent/analyser/queue.mjs (durable on-disk retry queue).
// Run: node --test --test-concurrency=1 test/connect-agent/analyser-queue.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQueue, drainOnce } from '../../connect-agent/analyser/queue.mjs';

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'analyser-queue-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('enqueue writes atomically and dedupes by messageId', async () => {
  await withTmpDir(async (dir) => {
    const queue = createQueue(dir);
    await queue.init();
    const first = await queue.enqueue('msg-1', { analyserId: 'A1', specimenId: 'S1', results: [] });
    assert.equal(first.created, true);
    const second = await queue.enqueue('msg-1', { analyserId: 'A1', specimenId: 'S1', results: [{ v: 'different' }] });
    assert.equal(second.created, false);
    const due = await queue.listDue();
    assert.equal(due.length, 1);
    assert.deepEqual(due[0].results, []); // the original enqueue, not the no-op's payload
    const files = await readdir(path.join(dir, 'queue', 'pending'));
    assert.deepEqual(files, ['msg-1.json']); // no stray .tmp files left behind
  });
});

test('drainOnce removes the item on a done outcome', async () => {
  await withTmpDir(async (dir) => {
    const queue = createQueue(dir);
    await queue.init();
    await queue.enqueue('msg-1', { analyserId: 'A1' });
    const results = await drainOnce(queue, async () => ({ action: 'done', outcome: 'queued' }));
    assert.equal(results.length, 1);
    assert.equal((await queue.counts()).pending, 0);
  });
});

test('drainOnce dead-letters on a permanent failure and records the status', async () => {
  await withTmpDir(async (dir) => {
    const queue = createQueue(dir);
    await queue.init();
    await queue.enqueue('msg-1', { analyserId: 'A1' });
    await drainOnce(queue, async () => ({ action: 'dead', status: 422, error: 'unmatched' }));
    const counts = await queue.counts();
    assert.equal(counts.pending, 0);
    assert.equal(counts.dead, 1);
    const files = await readdir(path.join(dir, 'queue', 'dead'));
    const dead = JSON.parse(await readFile(path.join(dir, 'queue', 'dead', files[0]), 'utf8'));
    assert.equal(dead.lastStatus, 422);
    assert.equal(dead.lastError, 'unmatched');
    assert.ok(dead.deadAt);
  });
});

test('drainOnce backs off (increases nextAt) on a retryable failure and keeps it pending', async () => {
  await withTmpDir(async (dir) => {
    const queue = createQueue(dir);
    await queue.init();
    await queue.enqueue('msg-1', { analyserId: 'A1' });
    const before = (await queue.listDue())[0];
    await drainOnce(queue, async () => ({ action: 'retry', delayMs: 60000, error: 'http-503' }));
    const dueNow = await queue.listDue();
    assert.equal(dueNow.length, 0); // not due again immediately
    const counts = await queue.counts();
    assert.equal(counts.pending, 1);
    const dueLater = await queue.listDue(Date.now() + 61000);
    assert.equal(dueLater.length, 1);
    assert.equal(dueLater[0].attempts, before.attempts + 1);
    assert.ok(dueLater[0].nextAt > before.nextAt);
  });
});

test('a credential failure (401) keeps the item pending via retry', async () => {
  await withTmpDir(async (dir) => {
    const queue = createQueue(dir);
    await queue.init();
    await queue.enqueue('msg-1', { analyserId: 'A1' });
    await drainOnce(queue, async () => ({ action: 'retry', delayMs: 300000, error: 'credential-401' }));
    assert.equal((await queue.counts()).pending, 1);
    assert.equal((await queue.counts()).dead, 0);
  });
});

test('survives a restart: a new queue instance over the same dir sees pending items as due', async () => {
  await withTmpDir(async (dir) => {
    const first = createQueue(dir);
    await first.init();
    await first.enqueue('msg-1', { analyserId: 'A1' });

    const second = createQueue(dir); // simulates a process restart
    await second.init();
    const sent = [];
    await drainOnce(second, async (item) => { sent.push(item.messageId); return { action: 'done' }; });
    assert.deepEqual(sent, ['msg-1']);
    assert.equal((await second.counts()).pending, 0);
  });
});
