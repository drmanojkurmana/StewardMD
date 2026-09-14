// test/connect-agent/ghis-shim.test.mjs - the adapter answers the GHIS proxy's endpoints in its shapes.
//   node --test test/connect-agent/ghis-shim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveGhisProxy, labOrders, detailFor, getLabDetail, needsPatientSections, patientIdOf, normalizeAnalyte, normalizeResult, canonicalLabName, numResult, parseReportSections, sectionBody } from '../../connect-agent/phone/ghis-shim.mjs';

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

test('short hospital analyte labels normalize to the names ICU, calculators and Dx match', () => {
  assert.equal(normalizeAnalyte('Hb'), 'Haemoglobin');
  assert.equal(normalizeAnalyte('HB%'), 'Haemoglobin');
  assert.equal(normalizeAnalyte('Hgb'), 'Haemoglobin');
  assert.equal(normalizeAnalyte('Haemoglobin'), 'Haemoglobin');
  assert.equal(normalizeAnalyte('PLT'), 'Platelet Count');
  assert.equal(normalizeAnalyte('Platelet Count'), 'Platelet Count');
  assert.equal(normalizeAnalyte('W.B.C.'), 'WBC');
  assert.equal(normalizeAnalyte('Total WBC'), 'WBC');
  assert.equal(normalizeAnalyte('White Blood Cell Count'), 'WBC');
  assert.equal(normalizeAnalyte('K+'), 'Potassium');
  assert.equal(normalizeAnalyte('K'), 'Potassium');
  assert.equal(normalizeAnalyte('Serum K'), 'Potassium');
  assert.equal(normalizeAnalyte('Na+'), 'Sodium');
  assert.equal(normalizeAnalyte('S. Sodium'), 'Sodium');
  assert.equal(normalizeAnalyte('S. Creatinine'), 'Creatinine');
  assert.equal(normalizeAnalyte('Sr Creatinine'), 'Creatinine');
  // Guarded lookalikes must pass through untouched.
  for (const raw of ['HbA1c', 'MCH', 'MCHC', 'Mean corpuscular haemoglobin', 'Plateletcrit', 'MPV', 'Urine Creatinine', 'Creatinine Clearance', 'Vitamin K', 'Urea', 'TLC', 'TC', 'FBS', 'WBC Differential']) {
    assert.equal(normalizeAnalyte(raw), raw, raw + ' must not be renamed');
  }
  // Lab-detail tests keep the hospital's own label and carry the canonical key plus the
  // numeric value, so calculators match without manual entry.
  const det = serveGhisProxy({ path: '/lab-detail?renderId=a0&episodeId=V9&patientId=K001', sections: [
    { resource: 'labs', rows: [{ 'Test Name': 'Hb', Result: '1,41,000', Units: '/cumm', Department: 'Haematology' }] },
  ], patient }).body;
  assert.equal(det.tests[0].test, 'Hb');
  assert.equal(det.tests[0].canonical, 'Haemoglobin');
  assert.equal(det.tests[0].numValue, 141000);
});

test('canonicalLabName maps every calculator synonym set; unknowns pass through', () => {
  const cases = [
    ['hb', 'Haemoglobin'], ['Haemoglobin', 'Haemoglobin'], ['HEMOGLOBIN', 'Haemoglobin'],
    ['Platelets', 'Platelet Count'], ['Platelet Count', 'Platelet Count'], ['PLT', 'Platelet Count'],
    ['WBC', 'WBC'], ['Total Count', 'WBC'], ['TC', 'WBC'], ['White Blood Cells', 'WBC'],
    ['Creatinine', 'Creatinine'], ['Serum Creatinine', 'Creatinine'],
    ['Urea', 'Urea'], ['Blood Urea', 'Urea'], ['BUN', 'Urea'],
    ['Sodium', 'Sodium'], ['Na+', 'Sodium'], ['Serum Sodium', 'Sodium'],
    ['Potassium', 'Potassium'], ['K+', 'Potassium'], ['Serum Potassium', 'Potassium'],
    ['Total Bilirubin', 'Total Bilirubin'], ['Bilirubin Total', 'Total Bilirubin'], ['TBIL', 'Total Bilirubin'],
    ['Direct Bilirubin', 'Direct Bilirubin'], ['DBIL', 'Direct Bilirubin'],
    ['SGOT', 'AST'], ['AST', 'AST'],
    ['SGPT', 'ALT'], ['ALT', 'ALT'],
    ['Albumin', 'Albumin'], ['Serum Albumin', 'Albumin'],
    ['INR', 'INR'], ['PT/INR', 'INR'], ['Prothrombin Time', 'INR'],
  ];
  for (const [raw, canonical] of cases) assert.equal(canonicalLabName(raw), canonical, raw);
  for (const raw of ['HbA1c', 'MCH', 'Vitamin K', 'Urine Creatinine', 'FBS', 'ESR']) {
    assert.equal(canonicalLabName(raw), raw, raw + ' must pass through untouched');
  }
  assert.equal(canonicalLabName(''), '');
});

test('numResult strips units and prefixes; narratives and ranges become null', () => {
  assert.equal(numResult('< 0.1'), 0.1);
  assert.equal(numResult('12.4 gm/dl'), 12.4);
  assert.equal(numResult('1,41,000'), 141000);
  assert.equal(numResult('11.2'), 11.2);
  assert.equal(numResult('> 400'), 400);
  assert.equal(numResult('NEGATIVE'), null);
  assert.equal(numResult('5-8/hpf'), null);
  assert.equal(numResult(''), null);
  assert.equal(numResult(null), null);
});

test('learned column roles win over key-name guesses (a misleading ValueType/Value payload)', () => {
  // The response labels its columns unhelpfully: Value is a code, ValueType is the number the doctor
  // saw. Discovery learned the roles (role -> screen header) by value; the shim must read those, not
  // the field a /value|result/ guess would grab.
  const roleSections = [{
    resource: 'labs',
    roles: { testName: 'Analyte', result: 'ValueType', unit: 'UOM', reference: 'NormalRange', date: 'RunOn', department: 'Section' },
    rows: [
      { Analyte: 'Sodium', Value: 'NA_CODE', ValueType: '138', UOM: 'mmol/L', NormalRange: '135 - 145', RunOn: '04/09/2026', Section: 'Biochemistry' },
      { Analyte: 'Potassium', Value: 'K_CODE', ValueType: '4.2', UOM: 'mmol/L', NormalRange: '3.5 - 5.1', RunOn: '04/09/2026', Section: 'Biochemistry' },
    ],
  }];
  const { orders } = serveGhisProxy({ path: '/lab?patientId=K001', sections: roleSections, patient }).body;
  assert.equal(orders[0].serviceName, 'Biochemistry (2 tests)');
  const det = serveGhisProxy({ path: '/lab-detail?renderId=' + orders[0].renderId, sections: roleSections, patient }).body;
  assert.deepEqual(det.tests.map((t) => [t.test, t.result, t.units, t.range]), [
    ['Sodium', '138', 'mmol/L', '135 - 145'],
    ['Potassium', '4.2', 'mmol/L', '3.5 - 5.1'],
  ], 'result reads ValueType (the on-screen number), never the Value code');
});

test('a two-level lab chain keeps each order distinct: detail rows join by list index, not shared title', () => {
  // Two CBC orders on different days: matching detail rows by title alone lumped both under one order
  // (42 tests under a 14-test order, live 2026-09-14). _rowIndex keeps them apart.
  const chained = [
    { resource: 'labs', roles: { testName: 'Panel', date: 'On' }, rows: [
      { Panel: 'CBC', On: '01/09/2026' }, { Panel: 'CBC', On: '05/09/2026' },
    ] },
    { resource: 'labs-detail', roles: { testName: 'T', result: 'R', unit: 'U' }, rows: [
      { _of: 'CBC', _rowIndex: 0, T: 'Hb', R: '11.2', U: 'g/dL' },
      { _of: 'CBC', _rowIndex: 1, T: 'Hb', R: '12.9', U: 'g/dL' },
      { _of: 'CBC', _rowIndex: 1, T: 'WBC', R: '8.0', U: '10^3/uL' },
    ] },
  ];
  const { orders } = serveGhisProxy({ path: '/lab?patientId=K001', sections: chained, patient }).body;
  assert.equal(orders.length, 2, 'two orders, not collapsed into one');
  const d0 = serveGhisProxy({ path: '/lab-detail?renderId=' + orders[0].renderId, sections: chained, patient }).body;
  const d1 = serveGhisProxy({ path: '/lab-detail?renderId=' + orders[1].renderId, sections: chained, patient }).body;
  assert.deepEqual(d0.tests.map((t) => t.result), ['11.2'], 'first order gets only its own day');
  assert.deepEqual(d1.tests.map((t) => t.result), ['12.9', '8.0'], 'second order gets its two tests, not the first order lumped in');
});

test('detailFor and getLabDetail expose test, canonical and numValue per test', () => {
  const g = { dept: 'Biochemistry', date: '03/09/2026', rows: [
    { 'Test Name': 'SGOT', Result: '44 U/L', Units: 'U/L' },
    { 'Test Name': 'K+', Result: '< 3.5', Units: 'mEq/L' },
  ] };
  for (const fn of [detailFor, getLabDetail]) {
    const d = fn(g);
    assert.equal(d.tests[0].test, 'SGOT');
    assert.equal(d.tests[0].canonical, 'AST');
    assert.equal(d.tests[0].numValue, 44);
    assert.equal(d.tests[1].test, 'K+');
    assert.equal(d.tests[1].canonical, 'Potassium');
    assert.equal(d.tests[1].numValue, 3.5);
  }
  assert.equal(detailFor(null), null);
});

test('thousand-grouped results normalize to plain numbers; narratives pass through', () => {
  assert.equal(normalizeResult('1,41,000'), '141000');
  assert.equal(normalizeResult('11.2'), '11.2');
  assert.equal(normalizeResult('NEGATIVE'), 'NEGATIVE');
  assert.equal(normalizeResult('5-8/hpf'), '5-8/hpf');
  assert.equal(normalizeResult(''), '');
});

test('radiology reports parse into IMPRESSION and FINDINGS sections', () => {
  const raw = 'CLINICAL HISTORY:\nFever with cough.\n\nFINDINGS:\nRight lower zone opacity.\n\nIMPRESSION:\nRight lower zone consolidation.';
  const secs = parseReportSections(raw);
  assert.deepEqual(secs.map((s) => s.heading), ['History', 'Findings', 'Impression']);
  assert.equal(sectionBody(secs, 'Impression'), 'Right lower zone consolidation.');
  assert.equal(sectionBody(secs, 'Findings'), 'Right lower zone opacity.');
  assert.equal(sectionBody(secs, 'Advice'), '');
  // A flat one-line report has no sections: the drawer falls back to the raw text.
  assert.deepEqual(parseReportSections('Right lower zone consolidation'), []);
  assert.deepEqual(parseReportSections(''), []);
  // Single-line manual print with inline markers still splits.
  const inline = parseReportSections('FINDINGS: opacity seen. IMPRESSION: consolidation.');
  assert.equal(sectionBody(inline, 'Impression'), 'consolidation.');
  assert.equal(sectionBody(inline, 'Findings'), 'opacity seen.');
  // The served radiology-report carries both the raw text and the sections.
  const rep = serveGhisProxy({ path: '/radiology-report?resultid=a0&type=manual', sections: [
    { resource: 'radiology', rows: [{ Study: 'CXR PA', 'Study Date': '02/09/2026', Doctor: 'Dr Rao' }] },
    { resource: 'radiology-detail', rows: [{ _of: 'CXR PA', report: raw }] },
  ], patient }).body;
  assert.equal(rep.report, raw, 'raw report text is unchanged for Dx and ICU');
  assert.equal(rep.impression, 'Right lower zone consolidation.');
  assert.equal(rep.findings, 'Right lower zone opacity.');
  assert.equal(rep.sections.length, 3);
});
