// Before swapping the AI provider for a faster one (2026-09-24) we need to know whether a discovery
// run is actually waiting on the AI. These pin the one property that makes the answer trustworthy.
// node --test test/connect-agent/timing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunTimer } from '../../connect-agent/phone/timing.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('overlapping calls count once: four 200ms calls in parallel are ~200ms of waiting, not 800', async () => {
  const timer = createRunTimer();
  const brain = timer.wrap({ async verify() { await sleep(200); return { ok: true }; } }, 'ai');
  await Promise.all([brain.verify(), brain.verify(), brain.verify(), brain.verify()]);
  const b = timer.report().buckets.ai;
  assert.equal(b.calls, 4);
  assert.ok(b.busySec >= 0.1 && b.busySec <= 0.4, 'busy time is the union of the intervals, got ' + b.busySec);
  // per-method totals are summed on purpose: they rank which question is expensive
  assert.ok(b.slowest[0].sec >= 0.6, 'the per-method total is the sum, got ' + b.slowest[0].sec);
});

test('sequential calls add up', async () => {
  const timer = createRunTimer();
  const brain = timer.wrap({ async classify() { await sleep(120); return 1; } }, 'ai');
  await brain.classify();
  await brain.classify();
  assert.ok(timer.report().buckets.ai.busySec >= 0.2, 'two back-to-back calls are both waited for');
});

test('the wrapper is invisible to callers: properties, return values, errors and `this` all survive', async () => {
  const timer = createRunTimer();
  const raw = {
    platform: 'ios',
    n: 3,
    async evaluate() { return { result: this.n }; },
    sync() { return 'plain'; },
    async boom() { throw new Error('hospital said no'); },
  };
  const p = timer.wrap(raw, 'browser');
  assert.equal(p.platform, 'ios', 'plain properties pass through (browserOf reads plugin.platform)');
  assert.equal(typeof p.drainRequests, 'undefined', 'a method the object lacks is still absent, so feature checks still work');
  assert.deepEqual(await p.evaluate(), { result: 3 }, 'methods run against the original object');
  assert.equal(p.sync(), 'plain', 'synchronous methods are timed and returned as-is');
  await assert.rejects(() => p.boom(), /hospital said no/, 'a failing call still fails, and is still timed');
  assert.equal(timer.report().buckets.browser.calls, 3);
});

/* The plugin clients are Object.freeze()d. Proxying a frozen object directly throws on the first
 * method read ("'evaluate' is a read-only and non-configurable data property"), which the orchestration
 * test caught - in production it would have ended every discovery run on its first browser call. */
test('a frozen object can be wrapped: the plugin client is frozen and must still be timed', async () => {
  const timer = createRunTimer();
  const frozen = Object.freeze({ platform: 'android', async evaluate() { return { result: 'ok' }; } });
  const p = timer.wrap(frozen, 'browser');
  assert.deepEqual(await p.evaluate(), { result: 'ok' });
  assert.equal(p.platform, 'android');
  assert.ok('evaluate' in p, "feature checks like 'drainRequests' in plugin still see the real methods");
  assert.equal(timer.report().buckets.browser.calls, 1);
});

test('a missing brain stays missing: no AI configured means no AI bucket, not a crash', () => {
  const timer = createRunTimer();
  assert.equal(timer.wrap(null, 'ai'), null);
  assert.equal(timer.report().buckets.ai, undefined);
});

test('the report carries no patient data: only method names, counts and seconds', async () => {
  const timer = createRunTimer();
  const brain = timer.wrap({ async mapColumns(x) { return x; } }, 'ai');
  await brain.mapColumns({ patientName: 'SHOULD NOT APPEAR', mr: 'MR26167289' });
  const s = JSON.stringify(timer.report());
  assert.ok(!/SHOULD NOT APPEAR|MR26167289/.test(s), s);
});
