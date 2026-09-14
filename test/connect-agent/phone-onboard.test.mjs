// test/connect-agent/phone-onboard.test.mjs - the universal 6-tap onboarding script.
//   node --test test/connect-agent/phone-onboard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REASSURANCE, ONBOARD_STEPS, ONBOARD_ORDER, FOLLOWUP_STEPS, onboardStep, guidedPrompt, stepLabel } from '../../connect-agent/phone/onboard.mjs';
import { ASK_ORDER, ASK_PROMPTS, GAP_PROMPTS } from '../../connect-agent/phone/index.mjs';

test('the universal script is six steps with the exact doctor-facing sentences', () => {
  assert.equal(ONBOARD_STEPS.length, 6);
  assert.deepEqual(ONBOARD_STEPS.map((s) => s.instruction), [
    'Sign in to your hospital portal.',
    'Show me your admitted / inpatient patient list, then tap Done.',
    'Tap on any patient to open their chart, then tap Done.',
    'Open the Lab / Investigations tab.',
    'Open the Radiology / Imaging tab.',
    'Open the Medications / Prescriptions tab.',
  ]);
  assert.deepEqual(ONBOARD_ORDER, ['signin', 'worklist', 'patient', 'labs', 'radiology', 'medications']);
  ONBOARD_STEPS.forEach((s, i) => {
    assert.equal(s.step, i + 1);
    assert.equal(s.total, 6);
  });
});

test('every ask names what to tap and reassures that the AI learns the layout', () => {
  for (const s of ONBOARD_STEPS.concat(FOLLOWUP_STEPS)) {
    const prompt = guidedPrompt(s.gap);
    assert.ok(prompt.indexOf(s.instruction) === 0, s.gap + ' starts with its instruction');
    assert.ok(prompt.endsWith(REASSURANCE), s.gap + ' ends with the reassurance');
    assert.match(prompt, /tap|Open|Show|Sign in/, s.gap + ' says what to tap');
    assert.ok(prompt.indexOf('—') < 0, s.gap + ' has no em-dash (app-facing text)');
  }
  assert.equal(guidedPrompt('signin'), 'Sign in to your hospital portal. ' + REASSURANCE);
  assert.equal(guidedPrompt('unknown-gap'), null);
  assert.equal(stepLabel('worklist'), 'Step 2 of 6');
  assert.equal(stepLabel('labs'), 'Step 4 of 6');
  assert.equal(stepLabel('notes'), '');
  assert.ok(onboardStep('radiology') && onboardStep('radiology').step === 5);
});

test('the engine asks from the onboard script, with reassurance on every ask', () => {
  for (const gap of ASK_ORDER) {
    assert.equal(ASK_PROMPTS[gap], guidedPrompt(gap), gap + ' manual ask is the onboard prompt');
    assert.ok(GAP_PROMPTS[gap].endsWith(REASSURANCE), gap + ' auto fallback ends with the reassurance');
    assert.ok(GAP_PROMPTS[gap].indexOf('—') < 0, gap + ' fallback has no em-dash');
  }
});
