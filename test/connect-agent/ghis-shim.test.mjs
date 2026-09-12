// test/connect-agent/ghis-shim.test.mjs - the adapter answers the GHIS proxy's endpoints in its shapes.
//   node --test test/connect-agent/ghis-shim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveGhisProxy, labOrders, needsPatientSections, patientIdOf } from '../../connect-agent/phone/ghis-shim.mjs';

const patient = { patientId: 'K001', episodeId: 'V9' };
const sections = [
  { resource: 'medications', rows: [{ 'Drug Name': 'Amoxicillin', Dose: '500 mg', Route: 'PO', Frequency: 'TDS', Duration: '5 days', 'Start Date': '01/09/2026' }, { 'Drug Name': '', Dose: '' }] },
  { resource: 'labs', rows: [
    { 'Test Name': 'Haemoglobin', Result: '11.2', Units: 'g/dL', 'Reference Range': '13 - 17', 'Reported On': '02/09/2026', Department: 'Haematology' },
    { 'Test Name': 'WBC', Result: '9.1', Units: '10^3/uL', 'Reference Range': '4 - 11', 'Reported On': '02/09/2026', Department: 'Haematology' },
    { 'Test Name': 'Creatinine', Result: '1.4', Units: 'mg/dL', 'Reference Range': '0.6 - 1.2', 'Reported On': '03/09/2026', Department: 'Biochemistry' },
  ] },
  { resource: 'radiology', rows: [{ Study: 'CXR PA', 'Study Date': '02/09/2026', Impression: 'Right lower zone consolidation', Doctor: 'Dr Rao' }] },
  { resource: 'notes', rows: [{ Date: '01/09/2026', Author: 'Dr Rao', Note: 'Fever 3 days, productive cough.' }] },
  { resource: 'discharge', rows: [{ Summary: 'Improved, discharged on oral antibiotics.' }] },
];

test('status, patients and the write gate need no patient read', () => {
  assert.deepEqual(serveGhisProxy({ path: '/status' }).body, { connected: true, userId: 'adapter' });
  assert.deepEqual(serveGhisProxy({ path: '/patients', patients: [{ patientId: 'K001' }] }).body, [{ patientId: 'K001' }]);
  assert.equal(serveGhisProxy({ method: 'POST', path: '/prescribe' }).status, 501);
  assert.equal(serveGhisProxy({ method: 'POST', path: '/login' }), null, 'auth routes go to the real proxy');
  assert.equal(serveGhisProxy({ path: '/warm' }), null);
  assert.equal(needsPatientSections('/lab?patientId=K001'), true);
  assert.equal(needsPatientSections('/status'), false);
  assert.equal(patientIdOf('/lab-detail?renderId=a0&episodeId=V9&patientId=K001'), 'K001');
});

test('medications rows take the proxy row shape', () => {
  const { rows } = serveGhisProxy({ path: '/medications?patientId=K001', sections, patient }).body;
  assert.equal(rows.length, 1, 'an empty drug row is dropped');
  assert.deepEqual(rows[0], { productCode: '', drugText: 'Amoxicillin', route: 'PO', dosage: '500 mg', frequency: 'TDS', duration: '5 days', dept: '', dateTime: '01/09/2026' });
});

test('a flat results table becomes lab orders per department and day, each with its tests', () => {
  const { orders } = serveGhisProxy({ path: '/lab?patientId=K001', sections, patient }).body;
  assert.equal(orders.length, 2);
  assert.equal(orders[0].serviceName, 'Haematology (2 tests)');
  assert.equal(orders[0].episodeId, 'V9');
  assert.equal(orders[1].serviceName, 'Creatinine');
  const det = serveGhisProxy({ path: '/lab-detail?renderId=' + orders[0].renderId + '&episodeId=V9', sections, patient }).body;
  assert.equal(det.group, 'Haematology');
  assert.deepEqual(det.tests.map((t) => [t.test, t.result, t.units, t.range]), [['Haemoglobin', '11.2', 'g/dL', '13 - 17'], ['WBC', '9.1', '10^3/uL', '4 - 11']]);
  assert.deepEqual(labOrders([], patient).orders, []);
});

test('radiology orders and their reports, history entries, and the merged profile', () => {
  const { orders } = serveGhisProxy({ path: '/radiology?patientId=K001', sections, patient }).body;
  assert.deepEqual(orders, [{ resultid: 'a0', visitId: 'V9', date: '02/09/2026', description: 'CXR PA', printType: 'manual' }]);
  const rep = serveGhisProxy({ path: '/radiology-report?resultid=a0&type=manual', sections, patient }).body;
  assert.equal(rep.testName, 'CXR PA');
  assert.equal(rep.report, 'Right lower zone consolidation');
  assert.equal(rep.doctor, 'Dr Rao');
  const { entries } = serveGhisProxy({ path: '/history?patientId=K001&visitId=V9', sections, patient }).body;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].by, 'Dr Rao');
  assert.match(entries[0].text, /Fever 3 days/);
  assert.match(entries[1].text, /^Discharge summary: /);
  const prof = serveGhisProxy({ path: '/profile?patientId=K001', sections, patient }).body;
  assert.equal(prof.labs.length, 2);
  assert.equal(prof.radiology.length, 1);
  assert.equal(prof.medications[0].drugText, 'Amoxicillin');
});
