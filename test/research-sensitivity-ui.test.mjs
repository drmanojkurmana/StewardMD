// The Run screen's sensitivity helpers (leave-one-out, fixed-effect check,
// funnel data, Egger test) must go through the same engine functions the
// library exposes. This test loads the real screen file in a VM and checks
// every branch against engine.run/funnel/egger on a known dataset, including
// the k>=3 and k>=10 gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

function loadRunScreen() {
  const ctx = { console, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(repo + 'research-engine.js', 'utf8'), ctx, { filename: 'research-engine.js' });
  runInContext(readFileSync(repo + 'research-screen-run.js', 'utf8'), ctx, { filename: 'research-screen-run.js' });
  return ctx;
}

// Ten binary studies with spread in both the effect and the standard error,
// so Egger has variation in se and a non-zero residual variance.
const STUDIES = [
  [4, 123, 11, 139],
  [6, 306, 29, 303],
  [3, 231, 11, 220],
  [62, 13598, 248, 12867],
  [33, 5069, 47, 5808],
  [180, 1541, 372, 1451],
  [8, 2545, 10, 629],
  [505, 88391, 499, 88391],
  [29, 7499, 45, 7277],
  [17, 1716, 65, 1665]
].map((v, i) => ({
  id: 'st_' + (i + 1),
  label: 'Study ' + (i + 1),
  verified: true,
  inputs: { events1: v[0], n1: v[1], events2: v[2], n2: v[3] }
}));

function project(studies, extra = {}) {
  return {
    measure: 'RR', model: 'random_reml', test: 'knha', level: 0.95,
    studies, createdAt: 1,
    ...extra
  };
}

// Flat engine shape for reference calls.
function flat(studies) {
  return studies.map((s) => ({ id: s.id, label: s.label, verified: true, ...s.inputs }));
}

test('leave-one-out refits the active model and returns one row per study', () => {
  const ctx = loadRunScreen();
  const screen = ctx.SMD_RESEARCH.screens.run;
  const out = screen.analyzeSensitivity(project(STUDIES), 'loo');
  assert.equal(out.kind, 'loo');
  assert.equal(out.rows.length, 10);
  const engine = ctx.SMD_RESEARCH_ENGINE;
  const firstRest = STUDIES.slice(1);
  const refit = engine.run(project(flat(firstRest)));
  assert.ok(Math.abs(out.rows[0].effect - refit.pooled.effect) < 1e-12);
  assert.equal(out.rows[0].id, 'st_1');
  for (const row of out.rows) {
    assert.ok(row.ciLower < row.ciUpper);
    assert.ok(Number.isFinite(row.i2));
  }
});

test('leave-one-out needs at least three studies', () => {
  const ctx = loadRunScreen();
  const screen = ctx.SMD_RESEARCH.screens.run;
  assert.throws(() => screen.analyzeSensitivity(project(STUDIES.slice(0, 2)), 'loo'), /three included studies/);
});

test('fixed-effect check uses the fixed model and Wald CI', () => {
  const ctx = loadRunScreen();
  const engine = ctx.SMD_RESEARCH_ENGINE;
  const screen = ctx.SMD_RESEARCH.screens.run;
  const out = screen.analyzeSensitivity(project(STUDIES), 'fixed');
  const refit = engine.run(project(flat(STUDIES), { model: 'fixed', test: 'wald' }));
  assert.equal(out.result.model, 'fixed');
  assert.equal(out.result.test, 'wald');
  assert.equal(out.result.pooled.effect, refit.pooled.effect);
  assert.equal(out.result.pooled.ciLower, refit.pooled.ciLower);
});

test('funnel data matches the engine and has one point per study', () => {
  const ctx = loadRunScreen();
  const engine = ctx.SMD_RESEARCH_ENGINE;
  const screen = ctx.SMD_RESEARCH.screens.run;
  const out = screen.analyzeSensitivity(project(STUDIES), 'funnel');
  const ref = engine.funnel(project(flat(STUDIES)));
  assert.equal(out.data.points.length, 10);
  assert.deepEqual(out.data.points, ref.points);
  assert.equal(out.data.fe.effect, ref.fe.effect);
});

test('Egger runs at ten studies and rejects fewer', () => {
  const ctx = loadRunScreen();
  const screen = ctx.SMD_RESEARCH.screens.run;
  const out = screen.analyzeSensitivity(project(STUDIES), 'egger');
  assert.equal(out.egger.k, 10);
  assert.ok(out.egger.df === 8);
  assert.ok(out.egger.p >= 0 && out.egger.p <= 1);
  assert.ok(Number.isFinite(out.egger.t));
  assert.throws(() => screen.analyzeSensitivity(project(STUDIES.slice(0, 9)), 'egger'), /at least 10 studies/);
});

test('analyzeSensitivity rejects an unknown check', () => {
  const ctx = loadRunScreen();
  assert.throws(() => ctx.SMD_RESEARCH.screens.run.analyzeSensitivity(project(STUDIES), 'bogus'), /Unknown check/);
});
