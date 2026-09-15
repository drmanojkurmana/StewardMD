// connect-agent/phone/runtime.mjs: header -> patient mapping, the page-side row reader (against a
// hand-built DOM stub, jsdom is not available), picker labels, and the worklist/detail readers
// against a fake plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldForHeader, mapRow, mapRows, READ_ROWS, readRowsExpression, hospitalLabel, isGimsrOrigin, fillPath, readWorklist, readPatientDetails, reproveWorklist } from '../../connect-agent/phone/runtime.mjs';
import { parseFetchExpression } from '../../connect-agent/phone/adapter-runtime.mjs';

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

test('mapRow handles direct camelCase properties from API responses', () => {
  const p = mapRow({
    patientId: 'MR26167311',
    episodeId: 'IPMR260026514',
    patientFirstName: 'Mr. SOMAYAJULA BALA SUBRAHMANYAM',
    gender: 'Male',
    bedName: 'Room9',
    deptDescription: 'GENERAL MEDICINE',
    employeeFirstName: 'Dr VAMSI KRISHNA',
    dob: '56',
    queueStatus: 'Arrived and Occupied'
  });
  assert.equal(p.patientId, 'MR26167311');
  assert.equal(p.episodeId, 'IPMR260026514');
  assert.equal(p.patientFirstName, 'Mr. SOMAYAJULA BALA SUBRAHMANYAM');
  assert.equal(p.dob, '56');
  assert.equal(p.gender, 'Male');
  assert.equal(p.bedName, 'Room9');
  assert.equal(p.deptDescription, 'GENERAL MEDICINE');
  assert.equal(p.employeeFirstName, 'Dr VAMSI KRISHNA');
  assert.equal(p.queueStatus, 'Arrived and Occupied');
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

test('readPatientDetails never opens a page: an unproven screen is unreadable, a proven one replays its call', async () => {
  const navigated = [];
  const plugin = {
    async navigate(a) { navigated.push(a.url); },
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (!req) return { result: '{}' };
      const text = /GetMeds/.test(req.url) ? '[{"Drug":"Amox"}]' : '[]';
      return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text }) };
    },
  };
  const proven = (resourceHint, path) => ({ resourceHint, pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'], proof: { status: 'proven' }, endpoints: [{ method: 'GET', path, role: 'data', params: { id: { from: 'worklist', field: 'patientId' } } }] });
  const replay = [
    { resourceHint: 'labs', pathTemplate: 'https://h/labs/{id}', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'unproven' } },
    proven('medications', '/GetMeds?id'),
    proven('radiology', '/GetRad?id'),
  ];
  const secs = await readPatientDetails({ plugin, origin: 'https://h', replay, patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(navigated, [], 'no page was loaded');
  assert.deepEqual(secs.find((s) => s.resource === 'labs'), { resource: 'labs', unreadable: 'not-proven' });
  assert.deepEqual(secs.find((s) => s.resource === 'medications').rows, [{ Drug: 'Amox' }]);
  assert.deepEqual(secs.find((s) => s.resource === 'radiology').rows, [], 'proven and empty is an empty answer, not a missing one');
});

test('the GIMSR sign-in host gets no built-in ward list call: only what discovery recorded is sent', async () => {
  const sent = [];
  const plugin = {
    async navigate() {},
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (req) { sent.push(req.url); return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[]' }) }; }
      return { result: '[]' };
    },
  };
  const replay = [{ resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Doctor/Home/DashboardUnit?type', role: 'data', params: { type: { constant: 'docopdlist' } } }] }];
  await assert.rejects(readWorklist({ plugin, origin: 'https://gimsrlogin.gitam.edu', replay, settleMs: 0, maxWaitMs: 5 }), /no patient rows found/);
  assert.ok(sent.length > 0, 'the recorded call was sent');
  assert.ok(!sent.some((u) => /GetIPWL/.test(u)), 'no call the adapter never recorded: ' + JSON.stringify(sent));
});

test('a refused unscoped request is reported unreadable, not as an empty result', async () => {
  const plugin = {
    async navigate() { throw new Error('the patient read must never navigate'); },
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate() { return { result: '{}' }; },
  };
  const replay = [{ resourceHint: 'labs', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Lab/Get?patient_id', role: 'data', params: { patient_id: { empty: true } } }] }];
  const secs = await readPatientDetails({ plugin, origin: 'https://h', replay, patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(secs.find((s) => s.resource === 'labs'), { resource: 'labs', unreadable: 'not-scoped' });
});

test('a proven worklist that returns nothing does not scrape: it throws for repair', async () => {
  let navigated = 0;
  const plugin = {
    async navigate() { navigated += 1; },
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (req) return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[]' }) };
      return { result: '[]' };
    },
  };
  const replay = [{ resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type=IPWorkList', role: 'data', params: { Type: { constant: 'IPWorkList' } } }] }];
  await assert.rejects(readWorklist({ plugin, origin: 'https://gimsrlogin.gitam.edu', replay, settleMs: 0, maxWaitMs: 5 }), /no patient rows found/);
  assert.equal(navigated, 0, 'a proven adapter never navigates a page to scrape');
});

test('reproveWorklist proves a backend request on the screen the doctor showed', async () => {
  const IPWL = JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'C', bedName: 'B2' }]);
  const plugin = {
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home/Nurseipwlnew' }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      if (expression.indexOf('__SMD_REPLAY__') >= 0 && expression.indexOf('PROVE') < 0) return { result: '0' };
      if (expression.indexOf('PROVE_LIST') >= 0) return { result: JSON.stringify([{ seq: 1, method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetIPWL?Type=IPWorkList', body: null, xhr: true, status: 200, shape: { kind: 'json', keys: ['patientId'], rows: 2 } }]) };
      if (expression.indexOf('PROVE_SCREEN') >= 0) return { result: JSON.stringify([['MR1', 'A', 'B1'], ['MR2', 'C', 'B2']]) };
      if (expression.indexOf('PROVE_EXEC') >= 0) return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: 'x', text: IPWL }) };
      return { result: '[]' };
    },
  };
  const view = { resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'] };
  const out = await reproveWorklist({ plugin, origin: 'https://ghis.gitam.edu', view });
  assert.ok(out, 'a backend request was proven');
  assert.equal(out.endpoints.find((e) => e.role === 'data').path.split('?')[0], '/Doctor/Home/GetIPWL');
});
