// Screening must load every page of records. The list API caps a page at 100;
// a 150-record review used to show only the first 100 (and, with dedup hiding,
// as few as 13), so records after page one could never be screened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

function loadScreen(apiRequest) {
  const ctx = { console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.SMD = { api: { request: apiRequest }, p2: {}, store: {} };
  ctx.SMD_RESEARCH = ctx.SMD;
  createContext(ctx);
  runInContext(readFileSync(repo + 'research-screen-screening.js', 'utf8'), ctx, { filename: 'research-screen-screening.js' });
  return ctx.SMD_RESEARCH.screens.screening;
}

test('fetchAllPages walks nextCursor until the list is exhausted', async () => {
  const calls = [];
  const api = async (method, url) => {
    calls.push(url);
    if (!/cursor=/.test(url)) {
      return { records: Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i })), nextCursor: 'CUR1' };
    }
    return { records: Array.from({ length: 50 }, (_, i) => ({ id: 'r' + (100 + i) })) };
  };
  const screen = loadScreen(api);
  const out = await screen.fetchAllPages('/v1/projects/p/records', 'records');
  assert.equal(out.length, 150);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].indexOf('cursor=CUR1') !== -1);
});

test('fetchAllPages stops when nextCursor is absent', async () => {
  let n = 0;
  const api = async () => { n++; return { groups: [{ id: 'g' }] }; };
  const screen = loadScreen(api);
  const out = await screen.fetchAllPages('/v1/projects/p/dedup-groups', 'groups');
  assert.equal(out.length, 1);
  assert.equal(n, 1);
});
