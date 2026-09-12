// connect-agent/phone/runtime.mjs: header -> patient mapping, the page-side row reader (against a
// hand-built DOM stub, jsdom is not available), picker labels, and the worklist/detail readers
// against a fake plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldForHeader, mapRow, mapRows, READ_ROWS, readRowsExpression, hospitalLabel, isGimsrOrigin, fillPath, readWorklist, readPatientDetails } from '../../connect-agent/phone/runtime.mjs';

test('fieldForHeader tolerates the labels Indian EMRs actually use', () => {
  assert.equal(fieldForHeader('UHID'), 'mrn');
  assert.equal(fieldForHeader('MR No'), 'mrn');
  assert.equal(fieldForHeader('Patient ID'), 'mrn');
  assert.equal(fieldForHeader('Patient Name'), 'name');
  assert.equal(fieldForHeader('Age/Sex'), 'age');
  assert.equal(fieldForHeader('Gender'), 'gender');
  assert.equal(fieldForHeader('Bed No'), 'bed');
  assert.equal(fieldForHeader('Ward'), 'dept');
  assert.equal(fieldForHeader('Consultant'), 'doctor');
  assert.equal(fieldForHeader('Visit No'), 'episode');
  assert.equal(fieldForHeader('S.No'), null);
});

test('mapRow builds the renderPatients shape and splits Age/Sex', () => {
  const p = mapRow({ 'S.No': '1', 'UHID': 'K001', 'Patient Name': 'Ravi Kumar', 'Age/Sex': '45 / M', 'Bed No': '12A', 'Ward': 'MICU', 'Consultant': 'Rao' });
  assert.equal(p.patientId, 'K001');
  assert.equal(p.episodeId, 'K001');
  assert.equal(p.patientFirstName, 'Ravi Kumar');
  assert.equal(p.dob, '45');
  assert.equal(p.gender, 'M');
  assert.equal(p.bedName, '12A');
  assert.equal(p.deptDescription, 'MICU');
  assert.equal(p.employeeFirstName, 'Rao');
  assert.deepEqual(mapRows([{ 'S.No': '1' }, { 'Name': 'X' }]).map((r) => r.patientFirstName), ['X']);
});

// Minimal DOM stub: the reader only touches querySelectorAll / querySelector / textContent.
function el(text, children = [], sel = {}) {
  return { textContent: text, querySelectorAll: (q) => sel[q] || children.filter((c) => c.tag === q), querySelector: (q) => (sel[q] || [])[0] || null };
}
function cell(t) { return Object.assign(el(t), { tag: 'td' }); }

test('READ_ROWS reads table cells by header and skips header-only rows', () => {
  const rows = [
    Object.assign(el('', [], { td: [] })),
    el('', [cell('K001'), cell(' Ravi  Kumar '), cell('45 / M')]),
    el('', [cell('K002'), cell('Sita'), cell('30 / F')]),
  ];
  const doc = { querySelectorAll: (q) => (q === '#wl tr' ? rows : []) };
  const out = JSON.parse(READ_ROWS(doc, { rowsSelector: '#wl tr', headers: ['UHID', 'Patient Name', 'Age/Sex'] }));
  assert.deepEqual(out, [
    { UHID: 'K001', 'Patient Name': 'Ravi Kumar', 'Age/Sex': '45 / M' },
    { UHID: 'K002', 'Patient Name': 'Sita', 'Age/Sex': '30 / F' },
  ]);
  assert.equal(mapRows(out)[1].gender, 'F');
});

test('READ_ROWS block view resolves cellSelectors per row', () => {
  const row = el('', [], { 'div:nth-of-type(1) b': [el('Amoxicillin')], 'div:nth-of-type(2)': [el('500 mg TDS')] });
  const doc = { querySelectorAll: (q) => (q === '.rx' ? [row] : []) };
  const out = JSON.parse(READ_ROWS(doc, { rowsSelector: '.rx', headers: ['Drug', 'Dose'], cellSelectors: ['div:nth-of-type(1) b', 'div:nth-of-type(2)'] }));
  assert.deepEqual(out, [{ Drug: 'Amoxicillin', Dose: '500 mg TDS' }]);
});

test('readRowsExpression is a self-contained page expression', () => {
  const src = readRowsExpression({ rowsSelector: '#wl tr', headers: ['UHID'], onclickTemplate: 'open(#)' });
  assert.ok(src.startsWith('(function READ_ROWS(doc, view)'));
  assert.ok(src.includes('"rowsSelector":"#wl tr"'));
  assert.ok(!src.includes('onclickTemplate'));
});

test('hospitalLabel derives the short name from the tenant, else the host', () => {
  assert.deepEqual(hospitalLabel('KIMS Hospital', 'https://hims.kims.example'), { name: 'KIMS', subtitle: 'KIMS Hospital · sign in with hims.kims.example' });
  assert.deepEqual(hospitalLabel('', 'https://emr.newcity.example'), { name: 'NEWCITY', subtitle: 'emr.newcity.example · sign in with emr.newcity.example' });
  assert.ok(!hospitalLabel('Apollo Hospitals', 'https://x.y').subtitle.includes('—'));
  assert.equal(isGimsrOrigin('https://gimsrlogin.gitam.edu'), true);
  assert.equal(isGimsrOrigin('https://hims.kims.example'), false);
});

test('fillPath substitutes the patient id into path placeholders', () => {
  assert.equal(fillPath('/labs/{id}', { patientId: 'K 1' }), '/labs/K%201');
  assert.equal(fillPath('/pt/###/meds', { patientId: '7' }), '/pt/7/meds');
  assert.equal(fillPath('/mrn/:patientId', { patientId: '9' }), '/mrn/9');
});

function fakePlugin(pages) {
  const calls = [];
  let url = '';
  return {
    calls,
    navigate: async (a) => { calls.push(['navigate', a.url]); url = a.url; },
    evaluate: async (a) => { calls.push(['evaluate', url]); return { result: JSON.stringify(pages[url] || []) }; },
  };
}

test('readWorklist navigates to the worklist view and maps its rows', async () => {
  const plugin = fakePlugin({ 'https://hims.kims.example/ip/list': [{ UHID: 'K001', 'Patient Name': 'Ravi', Ward: 'MICU' }] });
  const replay = [{ resourceHint: 'worklist', pathTemplate: '/ip/list', rowsSelector: '#wl tr', headers: ['UHID', 'Patient Name', 'Ward'] }];
  const pts = await readWorklist({ plugin, origin: 'https://hims.kims.example', replay, settleMs: 0 });
  assert.equal(pts.length, 1);
  assert.equal(pts[0].patientId, 'K001');
  assert.equal(pts[0].deptDescription, 'MICU');
  assert.deepEqual(plugin.calls[0], ['navigate', 'https://hims.kims.example/ip/list']);
});

test('readWorklist names the reason when nothing usable comes back', async () => {
  await assert.rejects(readWorklist({ plugin: fakePlugin({}), origin: 'https://h', replay: [], settleMs: 0 }), /no worklist view/);
  const replay = [{ resourceHint: 'worklist', pathTemplate: '/x', rowsSelector: 'tr', headers: ['S.No'] }];
  await assert.rejects(readWorklist({ plugin: fakePlugin({ 'https://h/x': [{ 'S.No': '1' }] }), origin: 'https://h', replay, settleMs: 0 }), /no patient rows found at \/x \(1 rows read/);
});

test('readPatientDetails reads each detail view for the patient and keeps per-view errors', async () => {
  const plugin = fakePlugin({ 'https://h/meds/K1': [{ Drug: 'Amox' }] });
  plugin.evaluate = async () => { throw new Error('page gone'); };
  const bad = await readPatientDetails({ plugin, origin: 'https://h', replay: [{ resourceHint: 'labs', pathTemplate: '/labs/{id}', rowsSelector: 'tr', headers: [] }], patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(bad, [{ resource: 'labs', error: 'page gone' }]);
  const good = fakePlugin({ 'https://h/meds/K1': [{ Drug: 'Amox' }] });
  const secs = await readPatientDetails({ plugin: good, origin: 'https://h', replay: [{ resourceHint: 'medications', pathTemplate: '/meds/{id}', rowsSelector: 'tr', headers: ['Drug'] }], patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(secs, [{ resource: 'medications', rows: [{ Drug: 'Amox' }] }]);
});
