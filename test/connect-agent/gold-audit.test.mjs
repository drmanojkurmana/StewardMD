// test/connect-agent/gold-audit.test.mjs -- grading an adapter against the hand-built GHIS proxy.
//   node --test test/connect-agent/gold-audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRows, endpointAudit, runGoldAudit, GOLD_ENDPOINTS } from '../../connect-agent/phone/gold-audit.mjs';
import { serveGhisProxy } from '../../connect-agent/phone/ghis-shim.mjs';

const spec = (name) => GOLD_ENDPOINTS.find((s) => s.endpoint === name);

test('compareRows: same rows and fields is "same"; a missing field or row is "partial"; nothing is "missing"', () => {
  const gold = { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: 'Oral', frequency: 'TDS' }, { drugText: 'Inj Ceftriaxone 1 g', route: 'IV', frequency: 'BD' }] };
  assert.equal(compareRows(spec('medications'), gold, { rows: gold.rows.map((r) => ({ ...r, drugText: r.drugText.toUpperCase() })) }).verdict, 'same');
  const partial = compareRows(spec('medications'), gold, { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: '', frequency: 'TDS' }] });
  assert.equal(partial.verdict, 'partial');
  assert.deepEqual(partial.fields.route, { gold: 2, adapter: 0, equal: 0 });
  assert.equal(compareRows(spec('medications'), gold, { rows: [] }).verdict, 'missing');
  assert.ok(!JSON.stringify(partial).includes('Paracetamol'), 'the grade carries no value');
});

test('endpointAudit reports the proven call per view against the proxy\'s upstream call', () => {
  const rows = endpointAudit([
    { resourceHint: 'medications', proof: { status: 'proven', overlap: 1, brain: true, model: 'gemini-3.8-flash' }, endpoints: [{ method: 'POST', path: '/Doctor/Home/Searchnew', role: 'prerequisite' }, { method: 'GET', path: '/Doctor/Home/GetMedicines/?id', role: 'data' }] },
    { resourceHint: 'radiology', proof: { status: 'proven' }, endpoints: [{ method: 'GET', path: '/Doctor/Home/GetSignatureBYid?id', role: 'data' }] },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.view, r]));
  assert.equal(by.medications.same, true);
  assert.equal(by.medications.proof.model, 'gemini-3.8-flash');
  assert.equal(by.radiology.same, false);
  assert.equal(by.labs.adapter, null);
});

test('runGoldAudit walks the ward list, each patient\'s endpoints and the lab chain through the shim', async () => {
  const goldBodies = {
    '/patients': [{ patientId: 'MR900001', episodeId: 'IP1', patientFirstName: 'TEST ALPHA', bedName: 'B-12' }],
    '/medications': { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: 'Oral' }] },
    '/lab': { orders: [{ serviceName: 'Complete blood count', orderDate: '12-09-2026', renderId: 'R1', episodeId: 'IP1' }] },
    '/lab-detail': { group: 'Complete blood count', tests: [{ test: 'Haemoglobin', result: '11.2', units: 'g/dL', range: '12 - 16' }] },
    '/radiology': { orders: [] }, '/history': { entries: [] },
  };
  const sections = [
    { resource: 'medications', rows: [{ Drug: 'Tab Paracetamol 650 mg', Route: 'Oral' }] },
    { resource: 'labs', rows: [{ 'Test name': 'Complete blood count', 'Order date': '12-09-2026' }] },
    { resource: 'labs-detail', rows: [{ _of: 'Complete blood count', Parameter: 'Haemoglobin', Result: '11.2', Units: 'g/dL', 'Reference range': '12 - 16' }] },
  ];
  const patients = [{ patientId: 'MR900001', episodeId: 'IP1', patientFirstName: 'TEST ALPHA' }];
  const report = await runGoldAudit({
    replay: [],
    gold: async (p) => goldBodies[p.split('?')[0]],
    adapter: async (p) => serveGhisProxy({ path: p, patients, sections, patient: patients[0] }).body,
  });
  assert.equal(report.worklist.verdict, 'partial', 'the adapter ward list has no bed or department here');
  const g = Object.fromEntries(report.patients[0].grades.map((x) => [x.endpoint, x]));
  assert.equal(g.medications.matched, 1);
  assert.equal(g.lab.matched, 1);
  assert.equal(g['lab-detail'].matched, 1);
  assert.deepEqual(g['lab-detail'].fields.result, { gold: 1, adapter: 1, equal: 1 });
  assert.equal(g.radiology.verdict, 'both-empty');
});
