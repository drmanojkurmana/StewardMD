// test/connect-agent/benchmark/compare-ghis.test.mjs — synthetic (non-PHI) coverage for the comparator.
// Never imports the real ghis-expected.json's ops as a correctness oracle beyond shape; uses its own
// small synthetic expected list so the test doesn't churn every time the reference file grows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAgainstExpected, normalizePath } from './compare-ghis.mjs';

const expected = {
  entries: [
    { op: 'patients', method: 'GET', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/GetIPWL', queryKeys: [], bodyKeys: [], kind: 'list_results' },
    { op: 'lab', method: 'POST', origin: 'https://ghis.gitam.edu', path: '/Lab/Home/GetSearchPatientId', queryKeys: [], bodyKeys: [], kind: 'results' },
    { op: 'medications', method: 'GET', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/GetMedicines/', queryKeys: ['id'], bodyKeys: [], kind: 'medications' },
    { op: 'inv-order', method: 'POST', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/CreateServices', queryKeys: [], bodyKeys: [], kind: 'other', write: true },
  ],
};

test('exact hit', () => {
  const spec = { events: [{ method: 'GET', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/GetIPWL', queryKeys: [] }] };
  const r = compareAgainstExpected(spec, expected);
  assert.equal(r.discovered.some((e) => e.op === 'patients'), true);
  assert.equal(r.missed.some((e) => e.op === 'patients'), false);
});

test('miss', () => {
  const spec = { events: [] };
  const r = compareAgainstExpected(spec, expected);
  assert.equal(r.missed.some((e) => e.op === 'patients'), true);
  assert.equal(r.discovered.length, 0);
  assert.equal(r.score, 0);
});

test('id-normalised hit: /Doctor/Home/GetMedicines/123 matches /Doctor/Home/GetMedicines/', () => {
  const spec = { events: [{ method: 'GET', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/GetMedicines/123', queryKeys: [] }] };
  const r = compareAgainstExpected(spec, expected);
  assert.equal(r.discovered.some((e) => e.op === 'medications'), true);
});

test('id-normalised hit also works from a compiled manifest pathTemplate', () => {
  const manifest = {
    origins: [{ id: 'origin:ghis', origin: 'https://ghis.gitam.edu' }],
    operations: [{ method: 'GET', originId: 'origin:ghis', pathTemplate: '/Doctor/Home/GetMedicines/{id}' }],
  };
  const r = compareAgainstExpected(manifest, expected);
  assert.equal(r.discovered.some((e) => e.op === 'medications'), true);
});

test('write proposed is flagged, never counted toward score', () => {
  const spec = {
    events: [
      { method: 'GET', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/GetIPWL', queryKeys: [] },
      { method: 'POST', origin: 'https://ghis.gitam.edu', path: '/Doctor/Home/CreateServices', queryKeys: [] },
    ],
  };
  const r = compareAgainstExpected(spec, expected);
  assert.equal(r.writesProposed.length, 1);
  assert.equal(r.writesProposed[0].op, 'inv-order');
  // score is over READ endpoints only: 1 of 3 reads found (patients hit; lab, medications missed)
  assert.equal(r.score, 1 / 3);
});

test('normalizePath: trailing slash and id collapse', () => {
  assert.equal(normalizePath('/Doctor/Home/GetMedicines/'), '/Doctor/Home/GetMedicines');
  assert.equal(normalizePath('/Doctor/Home/GetMedicines/123'), '/Doctor/Home/GetMedicines');
  assert.equal(normalizePath('/'), '/');
});
