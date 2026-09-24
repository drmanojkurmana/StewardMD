// clinix-audio.js must actually LOAD. 163e67f41 deleted has/labelOf/hintOf while the exported API still
// named them, so building the API threw "ReferenceError: has is not defined" on every page load and
// window.SMD_CLINIX_AUDIO was never set (2026-09-25). test/clinix-audio.test.mjs reads the file as text
// and never runs it, which is how CI stayed green. This one runs it.
// node --test test/clinix-audio-loads.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('the module loads, and every name its API exports is real', () => {
  const A = require('../clinix-audio.js');
  for (const k of ['has', 'available', 'play', 'stopAll', 'labelOf', 'hintOf', 'getAudioMetadata', 'listAudioAssets']) {
    assert.equal(typeof A[k], 'function', k + ' is exported, so it must exist');
  }
  const kind = Object.keys(A.KINDS)[0];
  assert.equal(A.has(kind), true, 'a known sound is found');
  assert.equal(A.has('no-such-sound'), false, 'an unknown one is not');
  assert.ok(A.labelOf(kind), 'a known sound has a label');
  assert.equal(A.labelOf('no-such-sound'), '', 'an unknown one has none, and does not throw');
});
