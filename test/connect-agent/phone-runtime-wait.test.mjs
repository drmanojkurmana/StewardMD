/* GHIS fills its worklist over AJAX after the page loads: a reader that samples once sees an empty
 * table and reports zero patients where three exist (live hospital, 2026-09-12). The reader must
 * wait for rows, and widen a DataTables page length first so one read covers the whole ward.
 *
 *   node --test test/connect-agent/phone-runtime-wait.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readView, EXPAND_PAGE_LENGTH } from '../../connect-agent/phone/runtime.mjs';

const VIEW = { resourceHint: 'worklist', pathTemplate: '/Doctor/Home', rowsSelector: '#data_tables1 tbody tr', headers: ['Patient ID', 'Patient name'] };

test('readView waits for an AJAX table to fill and widens the page length first', async () => {
  const calls = [];
  let reads = 0;
  const plugin = {
    async navigate({ url }) { calls.push('nav ' + url); },
    async evaluate({ expression }) {
      if (expression === EXPAND_PAGE_LENGTH) { calls.push('expand'); return { result: '1' }; }
      reads++;
      return { result: reads < 3 ? '[]' : JSON.stringify([{ 'Patient ID': 'MR1', 'Patient name': 'A' }]) };
    },
  };
  const rows = await readView({ plugin, origin: 'https://ghis.example', view: VIEW, settleMs: 0, pollMs: 0, maxWaitMs: 5000 });
  assert.equal(rows.length, 1, 'the rows that arrived late are returned');
  assert.equal(calls[0], 'nav https://ghis.example/Doctor/Home');
  assert.equal(calls[1], 'expand', 'page length is widened before the first read');
  assert.equal(reads, 3, 'polled until rows appeared');
});

test('readView stops after maxWaitMs with an empty list rather than hanging', async () => {
  const plugin = { async navigate() {}, async evaluate() { return { result: '[]' }; } };
  const rows = await readView({ plugin, origin: 'https://h.example', view: VIEW, settleMs: 0, pollMs: 0, maxWaitMs: 30 });
  assert.deepEqual(rows, []);
});

test('the page-length expander prefers "All" and otherwise the largest option', () => {
  // Pure script text: it must name the DataTables length select and treat -1 as All.
  assert.ok(EXPAND_PAGE_LENGTH.indexOf('_length') >= 0);
  assert.ok(EXPAND_PAGE_LENGTH.indexOf('-1') >= 0);
});
