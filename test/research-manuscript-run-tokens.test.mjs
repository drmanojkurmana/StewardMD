// A manuscript drafted in an earlier session stores {{run:<id>.field}} tokens.
// After a reload the local store is empty, so the screen must fall back to the
// saved server runs instead of blocking Word export with "Missing result".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
function screen() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.SMD = {
    store: { getState: () => ({ runs: {} }), getActiveProject: () => ({ id: 'p1', serverId: 'p1' }) },
    api: { request: () => Promise.resolve(null) },
    p2: {}, ai: { state: () => ({}) }
  };
  ctx.SMD_RESEARCH = ctx.SMD;
  ctx.document = { querySelector: () => null, getElementById: () => null, addEventListener() {}, removeEventListener() {} };
  createContext(ctx);
  runInContext(readFileSync(repo + 'research-screen-manuscript.js', 'utf8'), ctx, { filename: 'research-screen-manuscript.js' });
  return ctx;
}

test('resolveToken falls back to saved server runs after reload', () => {
  const ctx = screen();
  const m = ctx.SMD.screens.manuscript;
  m._getState().projectId = 'p1';
  m._getState().serverRuns = { p1: [{ id: 'run_x', measure: 'RR', result: { pooled: { effect: Math.log(0.83), ciLower: Math.log(0.64), ciUpper: Math.log(1.07) }, heterogeneity: { i2: 0 } } }] };
  const r = m._resolveToken('run_x', 'effect');
  assert.equal(r.resolved, true);
  assert.ok(Math.abs(r.value - 0.83) < 1e-12, 'ratio measure is exponentiated');
  assert.ok(m._findRun('run_x'), 'findRun sees the server run');
});

test('resolveToken still reports a genuinely missing run', () => {
  const ctx = screen();
  const m = ctx.SMD.screens.manuscript;
  m._getState().projectId = 'p1';
  m._getState().serverRuns = { p1: [] };
  assert.equal(m._resolveToken('run_missing', 'effect').resolved, false);
});

test('model and test codes render as the published wording, not engine codes', () => {
  const ctx = screen();
  const m = ctx.SMD.screens.manuscript;
  m._getState().projectId = 'p1';
  m._getState().serverRuns = { p1: [{
    id: 'run_x', measure: 'RR',
    result: { model: 'random_reml', test: 'knha', weights: [1, 2, 3, 4], pooled: { effect: Math.log(0.83) } }
  }] };
  assert.equal(m._resolveToken('run_x', 'model').formatted, 'random-effects (REML)');
  assert.equal(m._resolveToken('run_x', 'test').formatted, 'Knapp-Hartung');
  assert.equal(m._resolveToken('run_x', 'k').formatted, '4');
});

test('a server run resolves even when the local store holds unrelated runs', () => {
  const ctx = screen();
  ctx.SMD_RESEARCH.store.getState = () => ({ runs: { p1: [{ id: 'run_1795866066009', result: { pooled: { effect: 0 } } }] } });
  const m = ctx.SMD.screens.manuscript;
  m._getState().projectId = 'p1';
  m._getState().serverRuns = { p1: [{
    id: 'run_x', measure: 'RR',
    result: { model: 'random_reml', test: 'knha', weights: [1, 2, 3, 4], pooled: { effect: Math.log(0.83) }, heterogeneity: { i2: 0 } }
  }] };
  assert.equal(m._resolveToken('run_x', 'k').formatted, '4');
  assert.equal(m._resolveToken('run_x', 'model').resolved, true);
});
