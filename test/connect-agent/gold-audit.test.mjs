// test/connect-agent/gold-audit.test.mjs -- grading an adapter against the hand-built GHIS proxy.
//   node --test test/connect-agent/gold-audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRows, endpointAudit, runGoldAudit, GOLD_ENDPOINTS } from '../../connect-agent/phone/gold-audit.mjs';
import { serveGhisProxy } from '../../connect-agent/phone/ghis-shim.mjs';

const spec = (name) => GOLD_ENDPOINTS.find((s) => s.endpoint === name);

/* WAS: "a missing field OR ROW is partial". A short list is now its own verdict, "subset" (Task 2c,
 * owner 2026-09-16), so the partial case here keeps every row and drops only a field. */
test('compareRows: same rows and fields is "same"; a missing field is "partial"; a short list is "subset"; nothing is "missing"', () => {
  const gold = { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: 'Oral', frequency: 'TDS' }, { drugText: 'Inj Ceftriaxone 1 g', route: 'IV', frequency: 'BD' }] };
  assert.equal(compareRows(spec('medications'), gold, { rows: gold.rows.map((r) => ({ ...r, drugText: r.drugText.toUpperCase() })) }).verdict, 'same');
  const partial = compareRows(spec('medications'), gold, { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: '', frequency: 'TDS' }, { drugText: 'Inj Ceftriaxone 1 g', route: 'IV', frequency: 'BD' }] });
  assert.equal(partial.verdict, 'partial');
  assert.deepEqual(partial.fields.route, { gold: 2, adapter: 1, equal: 1 });
  const short = compareRows(spec('medications'), gold, { rows: [{ drugText: 'Tab Paracetamol 650 mg', route: 'Oral', frequency: 'TDS' }] });
  assert.equal(short.verdict, 'subset', 'a row the adapter never returned is never folded into "partial"');
  assert.equal(short.missing, 1);
  assert.equal(compareRows(spec('medications'), gold, { rows: [] }).verdict, 'missing');
  assert.ok(!JSON.stringify(partial).includes('Paracetamol'), 'the grade carries no value');
});

test('an adapter that returns only some of the ward FAILS the audit as a subset', () => {
  const spec = GOLD_ENDPOINTS[0]; // patients
  const gold = [{ patientId: 'MR1' }, { patientId: 'MR2' }, { patientId: 'MR3' }];
  const mine = [{ patientId: 'MR1' }, { patientId: 'MR2' }];
  const out = compareRows(spec, gold, mine);
  assert.equal(out.verdict, 'subset', 'fewer patients than the hand-built adapter is a named failure, not a pass');
  assert.equal(out.missing, 1);
  assert.equal(compareRows(spec, gold, gold).verdict, 'same');
});

test('the same day written two ways counts as the same day, and two different days never do', () => {
  const row = (dateTime) => ({ drugText: 'Tab Paracetamol 650 mg', route: 'Oral', dateTime });
  const same = (a, b) => compareRows(spec('medications'), { rows: [row(a)] }, { rows: [row(b)] }).fields.dateTime.equal === 1;

  // One hospital field, two adapters printing it their own way.
  assert.ok(same('01/02/2026', '2026-02-01'), 'day-first and year-first are the same date');
  assert.ok(same('1-Feb-2026 10:30', '2026-02-01 10:30'), 'a month name does not change the day');
  assert.ok(same('2026-02-01T10:30:00', '01/02/2026 10:30'), 'the same instant, written differently');

  // And the rule must not turn "close enough" into "the same".
  assert.ok(!same('01/02/2026', '03/02/2026'), 'a different day is a different day');
  assert.ok(!same('01/02/2026', '01/02/2025'), 'a different year is a different year');
  assert.ok(!same('01/02/2026 10:30', '01/02/2026 18:45'), 'a different time is a different time');
  // Not everything with numbers in it is a date.
  assert.ok(!same('500 mg', '2026-02-01'), 'a dose is not a date');
  const dose = (a, b) => compareRows(spec('medications'), { rows: [{ drugText: 'x', dosage: a }] }, { rows: [{ drugText: 'x', dosage: b }] }).fields.dosage.equal === 1;
  assert.ok(dose('500 mg', '500mg'), 'punctuation and case never mattered');
  assert.ok(!dose('500 mg', '250 mg'), 'a different dose is never the same dose');
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
