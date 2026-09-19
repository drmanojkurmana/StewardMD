/* What a control's LABEL says the view is. The medication rule is the one that bit a real hospital:
 * GHIS calls the chart "Treatment chart", never "Medications", so a crawl that had already opened it
 * still stopped to ask the doctor where medicines live (device, 2026-09-12).
 *
 *   node --test test/connect-agent/phone-hints.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceHintFor } from '../../connect-agent/phone/deep-crawl.mjs';

test('the medication chart is recognised under the names Indian EMRs actually use', () => {
  for (const label of ['Medications', 'Drug chart', 'Treatment chart', 'Treatment sheet', 'Rx', 'Prescription', 'Pharmacy indent', 'MAR', 'Dosage']) {
    assert.equal(resourceHintFor(label), 'medications', `${label} should read as the medication chart`);
  }
});

test('the other clinical views keep their own labels', () => {
  assert.equal(resourceHintFor('Lab results'), 'labs');
  assert.equal(resourceHintFor('Investigations'), 'labs');
  assert.equal(resourceHintFor('Radiology reports'), 'radiology');
  assert.equal(resourceHintFor('Discharge summary'), 'discharge');
  assert.equal(resourceHintFor('Visit history'), 'history');
  assert.equal(resourceHintFor('Patient details'), 'patient');
  assert.equal(resourceHintFor('Appointments'), 'unknown');
});
