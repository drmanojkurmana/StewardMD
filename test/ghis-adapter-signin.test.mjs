// The approved adapter's sign-in wait (ghis-ward.js, ghisOpenAdapterHospital). On Android the doctor
// signed in and was left on the hospital's logged-in page for ever (owner, 2026-09-24): after ~28 s with
// the login form still up, the wait STOPPED checking and relied only on a native "loggedIn" event that
// never came. These drive the real decision function, extracted from the file between its markers.
// node --test test/ghis-adapter-signin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../ghis-ward.js', import.meta.url), 'utf8');
const body = src.split('/*SIGNIN_VERDICT_START*/')[1].split('/*SIGNIN_VERDICT_END*/')[0];
const verdictOf = new Function(body + '; return ghisSignInVerdict;')();

/** Replay a sequence of page states through the same update rule the loop uses. */
function run(states) {
  let quiet = 0, polls = 0;
  for (let i = 0; i < states.length; i += 1) {
    const st = states[i];
    if (st === 'ok') quiet += 1; else quiet = 0;
    polls = st === 'login' ? 0 : polls + 1;
    const v = verdictOf({ state: st, quiet, polls });
    if (v === 'resolve' || v === 'fail') return { v, at: i };
  }
  return { v: 'waiting' };
}

test('a doctor still typing when the checks run out is not abandoned: signing in later still resolves', () => {
  const typing = Array(120).fill('login');                 // ~3 minutes on the login form
  const r = run(typing.concat(['ok', 'ok']));
  assert.equal(r.v, 'resolve', 'the wait keeps watching the login form and notices the sign-in');
});

test('the login form is never a failure, however long it stays up', () => {
  assert.equal(run(Array(500).fill('login')).v, 'waiting', 'still waiting for the doctor, never failed');
});

test('a page that never loads is still reported, so the doctor is not left staring at nothing', () => {
  const r = run(Array(60).fill('blank'));
  assert.equal(r.v, 'fail');
  assert.equal(r.at, 39, 'after the same ~28 s budget as before');
});

test('the load budget restarts after sign-in: time spent typing does not fail a slow landing page', () => {
  const r = run(Array(100).fill('login').concat(Array(20).fill('blank'), ['ok', 'ok']));
  assert.equal(r.v, 'resolve', 'twenty slow checks after a long sign-in are within a fresh budget');
});

test('already signed in from last time still resolves on two quiet checks', () => {
  assert.deepEqual(run(['ok', 'ok']), { v: 'resolve', at: 1 });
});

test('a page still loading its frames counts as usable: the check no longer needs readyState complete', () => {
  assert.ok(!/readyState===['"]complete['"]/.test(src), "readyState 'complete' never arrives on some Android pages");
  assert.ok(/readyState!==['"]loading['"]/.test(src), "'interactive' is accepted as a usable page");
});
