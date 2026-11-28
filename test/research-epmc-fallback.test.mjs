// Europe PMC: a slow core-record fetch must not leave a run with zero records.
// The search keeps its lite records on a COMPLETE search too, so the route can
// fall back when fetchRecords times out on a cold response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, fetchRecords } from '../functions/api/research/_connectors/europepmc.js';

const OPTS = { contactEmail: 'test@example.com' };

function page(results, extra = {}) {
  return new Response(JSON.stringify({
    hitCount: extra.hitCount ?? results.length,
    nextCursorMark: extra.next ?? '*',
    resultList: { result: results }
  }), { status: 200 });
}

test('a complete search keeps lite records for the timeout fallback', async () => {
  const res = await search('tranexamic acid postpartum', {}, null, {
    ...OPTS,
    fetch: async () => page([{ source: 'MED', id: '111', pmid: '111', title: 'Trial' }])
  });
  assert.equal(res.partial, undefined);
  assert.equal(res.ids.length, 1);
  assert.ok(Array.isArray(res.liteRecords));
  assert.equal(res.liteRecords.length, 1);
});

test('a complete search without lite records omits the array', async () => {
  const res = await search('x', {}, null, {
    ...OPTS,
    fetch: async () => page([], { hitCount: 0 })
  });
  assert.equal(res.liteRecords, undefined);
});

test('core fetch batches at 25 ids and returns every record', async () => {
  const ids = [];
  for (let i = 1; i <= 30; i++) ids.push('MED:' + i);
  const calls = [];
  const out = await fetchRecords(ids, {
    ...OPTS,
    fetch: async (url) => {
      const q = decodeURIComponent(String(url));
      calls.push(q);
      const found = (q.match(/EXT_ID:\d+/g) || []).map((m) => Number(m.split(':')[1]));
      return page(found.map((n) => ({ source: 'MED', id: String(n), pmid: String(n), title: 'T' + n })));
    }
  });
  assert.equal(calls.length, 2);
  assert.equal((calls[0].match(/EXT_ID:/g) || []).length, 25);
  assert.equal((calls[1].match(/EXT_ID:/g) || []).length, 5);
  assert.equal(out.length, 30);
});

test('a timed-out core fetch under partialOnBudget returns what it has instead of throwing', async () => {
  const calls = [];
  const out = await fetchRecords(['MED:1'], {
    ...OPTS,
    partialOnBudget: true,
    maxRetries: 1,
    sleep: async () => {},
    fetch: async () => { calls.push(1); throw new Error('The request took too long'); }
  });
  assert.deepEqual(out, []);
  assert.ok(calls.length >= 1 && calls.length <= 2, 'one attempt plus at most one retry');
});
