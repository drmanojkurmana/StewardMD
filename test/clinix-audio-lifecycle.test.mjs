// clinix-audio.js lifecycle: when a sound ENDS, and what is left behind.
//
// Bug 1: onEnd was setTimeout(onEnd, total) started before ctx.resume() had settled. On iOS the output
// takes ~2 s to wake (SMD-05) and the audio clock does not move until it does, so the soundlab's Stop
// button and trace cleared ~2 s before the sound finished. The end is now timed on ctx.currentTime,
// armed only after resume settles, and fires exactly once, never after stop().
// Bug 2: a handle that ended by itself stayed in `active` with its master gain still connected until
// the next stopAll().
//
// Runs the real module against a minimal fake AudioContext whose clock and resume() the test drives.
// node --test --experimental-test-module-mocks --experimental-sqlite test/clinix-audio-lifecycle.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MOD = require.resolve('../clinix-audio.js');

function param(v) {
  return { value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
}
function node(extra) {
  return Object.assign({
    outs: [], disconnected: false,
    connect(d) { this.outs.push(d); this.disconnected = false; return d; },
    disconnect() { this.outs = []; this.disconnected = true; },
  }, extra);
}

/* A fake context: `state` starts suspended; resume() returns a promise the test settles with
 * ctx.finishResume(). The clock only moves when the test sets ctx.currentTime, as on a real device
 * where it stands still until the output wakes. */
function makeFake({ startState = 'suspended' } = {}) {
  const made = [];
  class FakeCtx {
    constructor() {
      made.push(this);
      this.state = startState; this.currentTime = 0; this.sampleRate = 100;
      this.destination = node({ kind: 'destination' });
      this.gains = []; this.analysers = []; this.resumeCalls = 0;
      this._resolve = null;
    }
    resume() {
      this.resumeCalls++;
      return new Promise((res) => { this._resolve = () => { this.state = 'running'; res(); }; });
    }
    finishResume() { if (this._resolve) this._resolve(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return node({ buffer: null, loop: false, start() {}, stop() {} }); }
    createBiquadFilter() { return node({ type: '', frequency: param(0), Q: param(0) }); }
    createOscillator() { return node({ type: '', frequency: param(0), start() {}, stop() {} }); }
    createGain() { const g = node({ gain: param(1) }); this.gains.push(g); return g; }
    createAnalyser() { const a = node({ fftSize: 0, smoothingTimeConstant: 0 }); this.analysers.push(a); return a; }
  }
  return { FakeCtx, made };
}

// A fresh copy of the module per test: it keeps the context and live handles in closure state.
function load(win) {
  delete require.cache[MOD];
  if (win === undefined) delete globalThis.window; else globalThis.window = win;
  return require(MOD);
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function masterOf(ctx, h) { return ctx.gains.find((g) => g.outs.includes(h.analyser)); }

function setup(opts) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { FakeCtx, made } = makeFake(opts);
  const A = load({ AudioContext: FakeCtx });
  return { A, made };
}
function teardown() { mock.timers.reset(); delete globalThis.window; }

test('onEnd is not called before resume() resolves, however much wall time passes', async () => {
  const { A, made } = setup();
  try {
    let ends = 0;
    const h = A.play('vesicular', { breaths: 1, onEnd: () => { ends++; } });
    assert.ok(h, 'play returned a handle');
    const ctx = made[0];
    assert.equal(ctx.resumeCalls, 1, 'play() resumed the suspended context');
    const soundMs = (h.endsAt - h.startsAt) * 1000;
    // The old wall-clock timer fired at soundMs + 200. Waiting past that with the output still asleep
    // must not end the sound. (Total wall time here stays under the stall backstop, tested below.)
    mock.timers.tick(soundMs + 1000);
    await flush();
    assert.equal(ends, 0, 'ended while the context was still waking');
    assert.equal(A.current(), h, 'still the live sound');

    ctx.finishResume();
    await flush();
    // Output is awake now, but the clock has not reached the end: still not over.
    mock.timers.tick(soundMs + 1000);
    assert.equal(ends, 0, 'ended by wall clock rather than the audio clock');

    ctx.currentTime = h.endsAt + 0.5;
    mock.timers.tick(soundMs + 1000);
    assert.equal(ends, 1, 'ends once the audio clock passes the last event');
  } finally { teardown(); }
});

test('onEnd fires exactly once', async () => {
  const { A, made } = setup({ startState: 'running' });
  try {
    let ends = 0;
    const h = A.play('wheeze', { breaths: 2, onEnd: () => { ends++; } });
    const ctx = made[0];
    ctx.currentTime = h.endsAt + 1;
    mock.timers.tick(60000);
    await flush();
    mock.timers.tick(60000);
    assert.equal(ends, 1);
    h.stop();                      // stopping an ended handle is a harmless no-op
    A.stopAll();
    mock.timers.tick(60000);
    assert.equal(ends, 1, 'stop() after a natural end re-fired onEnd');
  } finally { teardown(); }
});

test('a stopped handle never calls onEnd, before or after resume', async () => {
  const { A, made } = setup();
  try {
    let ends = 0;
    const h = A.play('s1_s2_normal', { onEnd: () => { ends++; } });
    const ctx = made[0];
    h.stop();
    ctx.finishResume();
    await flush();
    ctx.currentTime = h.endsAt + 5;
    mock.timers.tick(120000);
    assert.equal(ends, 0, 'stopped before resume, still ended');
    assert.equal(A.current(), null);

    // and stopped mid-play, via stopAll (the screen-change path)
    const h2 = A.play('bronchial', { breaths: 1, onEnd: () => { ends++; } });
    const m = masterOf(ctx, h2);
    ctx.currentTime = h2.startsAt + 0.5;
    mock.timers.tick(100);
    A.stopAll();
    A.stopAll();                   // idempotent
    ctx.currentTime = h2.endsAt + 5;
    mock.timers.tick(120000);
    assert.equal(ends, 0, 'stopAll()ed handle still called onEnd');
    assert.equal(m.disconnected, true, 'a stopped sound is disconnected after its fade');
  } finally { teardown(); }
});

test('a sound that ends by itself leaves active and is disconnected', async () => {
  const { A, made } = setup({ startState: 'running' });
  try {
    const h = A.play('fine', { breaths: 1 });   // no onEnd: cleanup must not depend on a callback
    const ctx = made[0];
    const master = masterOf(ctx, h);
    assert.ok(master, 'master gain feeds the analyser');
    assert.equal(A.current(), h);
    ctx.currentTime = h.endsAt + 1;
    mock.timers.tick(60000);
    assert.equal(A.current(), null, 'ended handle is still in active');
    assert.equal(master.disconnected, true, 'master gain still connected after the sound ended');
    assert.equal(h.analyser.disconnected, true, 'analyser still connected after the sound ended');
    assert.equal(h.ended(), true);
  } finally { teardown(); }
});

test('playing the same kind again does not stack two sounds', async () => {
  const { A, made } = setup({ startState: 'running' });
  try {
    let ends1 = 0;
    const h1 = A.play('stridor', { breaths: 2, onEnd: () => { ends1++; } });
    const m1 = masterOf(made[0], h1);
    const h2 = A.play('stridor', { breaths: 2 });
    assert.notEqual(h1, h2);
    assert.equal(A.current(), h2, 'the new sound is the live one');
    mock.timers.tick(300);                         // past the 20 ms fade + 200 ms disconnect
    assert.equal(m1.disconnected, true, 'the first sound is still connected');
    assert.notEqual(masterOf(made[0], h2), undefined, 'the second sound is connected');
    made[0].currentTime = h2.endsAt + 1;
    mock.timers.tick(60000);
    assert.equal(ends1, 0, 'the replaced sound fired its onEnd');
    assert.equal(A.current(), null);
  } finally { teardown(); }
});

test('a resume that never settles cannot hold the Stop button up forever', async () => {
  const { A } = setup();
  try {
    let ends = 0;
    const h = A.play('vesicular', { breaths: 1, onEnd: () => { ends++; } });
    mock.timers.tick((h.endsAt - h.startsAt) * 1000 + 16000);
    assert.equal(ends, 1, 'stall backstop fired');
    assert.equal(A.current(), null);
  } finally { teardown(); }
});

test('nothing throws without an AudioContext (node, old WebViews)', () => {
  let A = load(undefined);                         // no window at all
  assert.equal(A.available(), false);
  assert.equal(A.play('vesicular', { onEnd() {} }), null);
  A.stopAll(); A.stopAll();
  assert.equal(A.unlock(), null);
  assert.equal(A.prewarm(), false);
  assert.equal(A.current(), null);
  assert.equal(A.now(), 0);

  A = load({});                                    // a window with no Web Audio
  assert.equal(A.available(), false);
  assert.equal(A.play('wheeze'), null);
  A.stopAll();
  delete globalThis.window;
});
