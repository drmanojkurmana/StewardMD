// The OTA bundle is ~48MB. node --test test/ota-range.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../functions/_ota.js';

const SIZE = 48201308;

test('parseRange turns an HTTP Range into R2 offset/length so a 48MB bundle can resume', () => {
  assert.deepEqual(parseRange('bytes=0-1023', SIZE), { offset: 0, length: 1024 });
  assert.deepEqual(parseRange('bytes=1000-', SIZE), { offset: 1000, length: SIZE - 1000 });
  assert.deepEqual(parseRange('bytes=-500', SIZE), { offset: SIZE - 500, length: 500 });
  // an end past the object is clamped rather than refused: that is what a resuming client sends
  assert.deepEqual(parseRange('bytes=10-' + (SIZE + 99), SIZE), { offset: 10, length: SIZE - 10 });
});

test('parseRange refuses what is not a single satisfiable byte range, so the route answers a plain 200', () => {
  for (const h of [null, '', 'bytes=', 'items=0-1', 'bytes=abc-def', 'bytes=' + SIZE + '-', 'bytes=50-10'])
    assert.equal(parseRange(h, SIZE), null, 'refused: ' + h);
  assert.equal(parseRange('bytes=0-10', 0), null, 'no size, no range');
});
