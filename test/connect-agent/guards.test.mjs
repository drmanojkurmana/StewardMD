// test/connect-agent/guards.test.mjs - the 2026-11-12 safety pass on the Connect Agent (after
// goodnight000/api-anything): never another patient's data, the two-patient proof, empty vs changed,
// no live value in a stored request, pacing, and a readable repair.
//   node --test --experimental-test-module-mocks --experimental-sqlite test/connect-agent/guards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGuards, guardsOn, isIdentityKey, sameId, foreignRows, guardSections, randomLooking, secretConstant, scrubConstants, patientIdsOf } from '../../connect-agent/phone/guards.mjs';
import { answerShape, executeProven, fetchInPage, parseFetchExpression, PACE, HospitalBusy, retryAfterMs, resetPace, paceState } from '../../connect-agent/phone/adapter-runtime.mjs';
import { readPatientDetails } from '../../connect-agent/phone/runtime.mjs';
import { valuesOf, pivotOf, otherRows, substituted, crossVerdict, crossCheck, proveView, rowsForChain, PROVE_SOURCES } from '../../connect-agent/phone/prove.mjs';
import { serveGhisProxy } from '../../connect-agent/phone/ghis-shim.mjs';
import { cleanObservedViews, describeRepair, keyShaped } from '../../functions/api/connect/agent/[[path]].js';

const json = (o, status = 200, extra = {}) => ({ result: JSON.stringify(Object.assign({ status, contentType: 'application/json', url: 'x', text: typeof o === 'string' ? o : JSON.stringify(o) }, extra)) });

test('the guards flag is on by default and can be forced off', () => {
  setGuards(null);
  assert.equal(guardsOn(), true);
  setGuards(false); assert.equal(guardsOn(), false);
  setGuards(null); assert.equal(guardsOn(), true);
});

/* ---- identity ---- */

test('identity keys: patient ids and MRNs count, visits, row ids and render ids do not', () => {
  for (const k of ['patientId', 'Patient ID', 'patient.id', 'MRN', 'MR No.', 'UHID', 'uhid_no', 'PatientMRN', 'RegNo']) assert.equal(isIdentityKey(k), true, k);
  for (const k of ['id', 'Render_ID', 'VisitNo', 'episode_id', 'resultid', 'Test', 'Drug Name']) assert.equal(isIdentityKey(k), false, k);
});

test('sameId tolerates the hospital prefix and nothing else', () => {
  assert.equal(sameId('MR900001', 'mr-900001'), true);
  assert.equal(sameId('MR900001', '900001'), true);
  assert.equal(sameId('MR900001', 'MR900002'), false);
  assert.equal(sameId('12', 'MR12'), false, 'too short to tell');
});

test('foreignRows counts rows that name someone else; rows that name nobody are not judged', () => {
  const me = { patientId: 'MR900001' };
  assert.equal(foreignRows([{ Drug: 'Paracetamol' }, { Drug: 'Ceftriaxone' }], me), 0);
  assert.equal(foreignRows([{ Drug: 'Paracetamol', PatientID: 'MR900001' }], me), 0);
  assert.equal(foreignRows([{ Drug: 'Metformin', PatientID: 'MR900002' }, { Drug: 'X', PatientID: 'MR900001' }], me), 1);
  assert.equal(foreignRows([{ Drug: 'Metformin', PatientID: 'NA' }], me), 0, 'a non-id value proves nothing');
  assert.deepEqual(patientIdsOf({ patientId: 'MR1234', _row: { UHID: 'U-55512' } }), ['MR1234', 'U55512']);
});

test('guardSections drops a section that carries another patient, keeps the rest', () => {
  const out = guardSections([
    { resource: 'labs', rows: [{ Test: 'Hb', 'Patient ID': 'MR900002' }] },
    { resource: 'medications', rows: [{ Drug: 'Paracetamol' }] },
    { resource: 'radiology', unreadable: 'not-proven' },
  ], { patientId: 'MR900001' });
  assert.deepEqual(out[0], { resource: 'labs', unreadable: 'other-patient' });
  assert.equal(out[1].rows.length, 1);
  assert.deepEqual(out[2], { resource: 'radiology', unreadable: 'not-proven' });
});

/* ---- live values ---- */

test('randomLooking flags keys, not mode words', () => {
  for (const v of ['aB3dE5fG7hJ9kL1m', 'Zq8xW2pL5vN7rT4yK1', 'xQ9fKe2LmZ0aB7cD6eF5gH4iJ']) assert.equal(randomLooking(v), true, v);
  for (const v of ['IPWorkList', 'InPatientWorkList', 'Arrived and Occupied', 'docopdlist', 'a', '2026-11-12']) assert.equal(randomLooking(v), false, v);
  assert.equal(keyShaped('aB3dE5fG7hJ9kL1m'), true, 'the server applies the same rule');
  assert.equal(keyShaped('InPatientWorkList'), false);
});

test('scrubConstants turns a live session value into a token or an untraced field', () => {
  const live = ['sess-abc123xyz', 'theme-dark'];
  assert.equal(secretConstant('sess-abc123xyz', live), true);
  assert.equal(secretConstant('IPWorkList', live), false);
  const { params, changed } = scrubConstants({ Type: { constant: 'IPWorkList' }, s: { constant: 'sess-abc123xyz' }, csrf: { constant: 'aB3dE5fG7hJ9kL1m' }, id: { from: 'worklist', field: 'MRNo' } }, live);
  assert.equal(changed, 2);
  assert.deepEqual(params, { Type: { constant: 'IPWorkList' }, s: { unmapped: true }, csrf: { token: true }, id: { from: 'worklist', field: 'MRNo' } });
});

/* ---- empty vs changed ---- */

test('answerShape tells an empty list from an answer that is not the screen at all', () => {
  const view = { headers: ['Drug', 'Route', 'Frequency'] };
  assert.equal(answerShape({ kind: 'json', resp: { status: 200, text: '[]' }, rows: [], view }), 'empty-list');
  assert.equal(answerShape({ kind: 'json', resp: { status: 200, text: '{"data":[]}' }, rows: [], view }), 'empty-list');
  assert.equal(answerShape({ kind: 'json', resp: { status: 200, text: '"{\\"rows\\":[]}"' }, rows: [], view }), 'empty-list');
  assert.equal(answerShape({ kind: 'json', resp: { status: 200, text: '{"error":"moved"}' }, rows: [], view }), 'no-structure');
  assert.equal(answerShape({ kind: 'html', resp: { status: 200, text: '<table><tr><th>Drug</th><th>Route</th><th>Frequency</th></tr></table>' }, rows: [], view }), 'empty-list');
  assert.equal(answerShape({ kind: 'html', resp: { status: 200, text: '<p>No records found</p>' }, rows: [], view }), 'empty-list');
  assert.equal(answerShape({ kind: 'html', resp: { status: 200, text: '<html><body><h1>Dashboard</h1></body></html>' }, rows: [], view }), 'no-structure');
  assert.equal(answerShape({ kind: 'html', resp: { status: 404, text: 'Not Found' }, rows: [], view }), 'no-structure');
  assert.equal(answerShape({ kind: 'json', resp: { status: 200, text: '[{"a":1}]' }, rows: [{ a: '1' }], view }), 'rows');
});

const provenView = (resourceHint, path, headers = ['Drug', 'Route']) => ({ resourceHint, pathTemplate: 'https://h/home', rowsSelector: 'tr', headers, proof: { status: 'proven' }, endpoints: [{ method: 'GET', path, role: 'data', params: { id: { from: 'worklist', field: 'patientId' } } }] });
const quietPage = (answer) => ({
  async navigate() {}, async currentUrl() { return { url: 'https://h/home' }; },
  async evaluate({ expression }) { const req = parseFetchExpression(expression); return req ? answer(req) : { result: '{}' }; },
});

test('a server failure is the read\'s error, never "none"; a changed answer is reported as changed', async () => {
  const secs = await readPatientDetails({
    plugin: quietPage((req) => (/Meds/.test(req.url) ? json('<h1>Server Error</h1>', 500, { contentType: 'text/html' }) : /Labs/.test(req.url) ? json('{"error":"moved"}') : json('[]'))),
    origin: 'https://h', patient: { patientId: 'K100' }, settleMs: 0,
    replay: [provenView('medications', '/Meds?id'), provenView('labs', '/Labs?id', ['Test', 'Result']), provenView('radiology', '/Rad?id', ['Study'])],
  });
  const by = Object.fromEntries(secs.map((s) => [s.resource, s]));
  assert.match(by.medications.error, /HTTP 500/);
  assert.deepEqual(by.labs, { resource: 'labs', unreadable: 'changed' });
  assert.deepEqual(by.radiology.rows, [], 'an empty list is still "none"');
  const shim = serveGhisProxy({ path: '/lab?patientId=K100', sections: secs, patient: { patientId: 'K100' } }).body;
  assert.match(shim.unreadable, /different screen/);
});

test('with the guards off a server failure reads as before (empty)', async () => {
  setGuards(false);
  try {
    const secs = await readPatientDetails({ plugin: quietPage(() => json('<h1>Server Error</h1>', 500, { contentType: 'text/html' })), origin: 'https://h', patient: { patientId: 'K100' }, settleMs: 0, replay: [provenView('medications', '/Meds?id')] });
    assert.deepEqual(secs[0].rows, []);
  } finally { setGuards(null); }
});

/* ---- never another patient ---- */

test('readPatientDetails refuses rows that name another patient', async () => {
  const secs = await readPatientDetails({
    plugin: quietPage(() => json([{ Drug: 'Metformin', Route: 'PO', PatientId: 'MR900002' }])),
    origin: 'https://h', patient: { patientId: 'MR900001' }, settleMs: 0, replay: [provenView('medications', '/Meds?id')],
  });
  assert.deepEqual(secs[0], { resource: 'medications', unreadable: 'other-patient' });
  const shim = serveGhisProxy({ path: '/medications?patientId=MR900001', sections: secs, patient: { patientId: 'MR900001' } }).body;
  assert.equal(shim.rows.length, 0);
  assert.match(shim.unreadable, /different patient/);
});

/* A hospital that keeps the current patient in its session: the activation POST sets it, reads answer
 * for whoever is active. */
function sessionHospital({ refuseActivationFor = null, latencyMs = 15 } = {}) {
  const state = { active: null, log: [] };
  const plugin = {
    async navigate() {}, async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (!req) return { result: '{}' };
      await new Promise((r) => setTimeout(r, latencyMs));
      if (req.method === 'POST') {
        const id = new URLSearchParams(req.body).get('recordNo');
        state.log.push('activate ' + id);
        if (id === refuseActivationFor) return { result: JSON.stringify({ status: 0, error: 'refused' }) };
        state.active = id;
        return json('{}');
      }
      state.log.push('read for ' + state.active);
      return json([{ Drug: state.active === 'MR1' ? 'Paracetamol' : 'Metformin', Route: 'PO' }]);
    },
  };
  const replay = [
    { resourceHint: 'patient', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['x'], proof: { status: 'proven' }, endpoints: [{ method: 'POST', path: '/Activate', role: 'prerequisite', bodyKeys: ['recordNo'], params: { recordNo: { from: 'worklist', field: 'patientId' } } }, { method: 'GET', path: '/Profile?id', role: 'data', params: { id: { from: 'worklist', field: 'patientId' } } }] },
    { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug', 'Route'], proof: { status: 'proven' }, endpoints: [{ method: 'GET', path: '/Meds', role: 'data', params: {} }] },
  ];
  return { state, plugin, replay };
}

test('two patients read at once through one browser are queued, so each gets their own chart', async () => {
  const h = sessionHospital();
  const [a, b] = await Promise.all([
    readPatientDetails({ plugin: h.plugin, origin: 'https://h', replay: h.replay, patient: { patientId: 'MR1' }, settleMs: 0 }),
    readPatientDetails({ plugin: h.plugin, origin: 'https://h', replay: h.replay, patient: { patientId: 'MR2' }, settleMs: 0 }),
  ]);
  assert.match(JSON.stringify(a.find((s) => s.resource === 'medications')), /Paracetamol/);
  assert.match(JSON.stringify(b.find((s) => s.resource === 'medications')), /Metformin/);
  assert.ok(!/Metformin/.test(JSON.stringify(a)), 'patient one never got patient two\'s medicines: ' + h.state.log.join(', '));
});

test('a failed activation after another patient reads nothing', async () => {
  const h = sessionHospital({ refuseActivationFor: 'MR2' });
  await readPatientDetails({ plugin: h.plugin, origin: 'https://h', replay: h.replay, patient: { patientId: 'MR1' }, settleMs: 0 });
  const b = await readPatientDetails({ plugin: h.plugin, origin: 'https://h', replay: h.replay, patient: { patientId: 'MR2' }, settleMs: 0 });
  assert.ok(b.every((s) => s.unreadable === 'not-activated'), JSON.stringify(b));
  assert.ok(!/Paracetamol/.test(JSON.stringify(b)), 'patient one\'s medicines were not shown as patient two\'s');
  assert.match(serveGhisProxy({ path: '/medications?patientId=MR2', sections: b, patient: { patientId: 'MR2' } }).body.unreadable, /did not switch to this patient/);
});

/* ---- pacing ---- */

test('requests through one browser are capped in flight and spaced', async () => {
  let inFlight = 0, peak = 0;
  const starts = [];
  const plugin = { async evaluate() { starts.push(Date.now()); inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 40)); inFlight -= 1; return json('[]'); } };
  await Promise.all(Array.from({ length: 10 }, (_, i) => fetchInPage(plugin, { method: 'GET', url: 'https://h/x' + i })));
  assert.ok(peak <= PACE.maxConcurrent, 'peak ' + peak);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= Math.floor(PACE.minGapMs * 0.7) - 2, 'gap ' + (starts[i] - starts[i - 1]));
});

test('a 429 with Retry-After pauses the browser; calls in the pause fail at once', async () => {
  const plugin = { calls: 0, async evaluate() { plugin.calls += 1; return json('slow down', 429, { retryAfter: '20' }); } };
  await fetchInPage(plugin, { method: 'GET', url: 'https://h/a' });
  const st = paceState(plugin);
  assert.ok(st.coolUntil - Date.now() > 15000 && st.coolUntil - Date.now() <= 20000, 'cool-down follows Retry-After');
  await assert.rejects(fetchInPage(plugin, { method: 'GET', url: 'https://h/b' }), (e) => e instanceof HospitalBusy && e.retryAfterMs > 0);
  assert.equal(plugin.calls, 1, 'nothing was sent during the pause');
  resetPace(plugin);
  assert.equal(retryAfterMs('120'), 120000);
  assert.ok(Number.isNaN(retryAfterMs('')));
});

test('executeProven: a 503 on the data call is HospitalBusy, not an empty chart', async () => {
  const plugin = quietPage(() => json('busy', 503));
  await assert.rejects(executeProven({ plugin, origin: 'https://h', view: provenView('labs', '/Labs?id'), patient: { patientId: 'K100' } }), (e) => e.name === 'HospitalBusy');
  resetPace(plugin);
});

/* ---- the two-patient proof (pure parts) ---- */

const WARD = [{ MRNo: 'MR900001', VisitNo: 'IP1', Name: 'A' }, { MRNo: 'MR900002', VisitNo: 'IP2', Name: 'B' }, { MRNo: 'MR900003', VisitNo: '', Name: 'C' }];
const parents = [{ label: 'worklist', rows: WARD }];

test('valuesOf, pivotOf, otherRows and substituted rebuild a request for a second row', () => {
  const pre = { method: 'POST', url: 'https://h/Activate', body: 'tok=abc&recordNo=MR900001-IP1', reqCt: 'application/x-www-form-urlencoded' };
  const data = { method: 'GET', url: 'https://h/Meds?id=MR900001&Type=IPWorkList', body: null };
  const ps = [{ recordNo: { from: 'worklist', fields: ['MRNo', 'VisitNo'], join: '-' }, tok: { token: true } }, { id: { from: 'worklist', field: 'MRNo' }, Type: { constant: 'IPWorkList' } }];
  assert.deepEqual(valuesOf(pre), { tok: 'abc', recordNo: 'MR900001-IP1' });
  assert.equal(pivotOf(ps, parents), 'worklist');
  assert.equal(pivotOf([{ Type: { constant: 'x' } }], parents), null);
  const traced = [{ key: 'recordNo', src: ps[0].recordNo, value: 'MR900001-IP1' }, { key: 'id', src: ps[1].id, value: 'MR900001' }];
  const rows = otherRows(WARD, traced, 2);
  assert.deepEqual(rows.map((r) => r.MRNo), ['MR900002'], 'a row missing a traced part (no visit) is not used');
  assert.deepEqual(substituted(pre, ps[0], 'worklist', rows[0]), { url: 'https://h/Activate', body: 'tok=abc&recordNo=MR900002-IP2' });
  assert.equal(substituted(data, ps[1], 'worklist', rows[0]).url, 'https://h/Meds?id=MR900002&Type=IPWorkList');
  const j = substituted({ url: 'https://h/x', body: '{"pid":900001,"k":"v"}' }, { pid: { from: 'worklist', field: 'Num' } }, 'worklist', { Num: '900002' });
  assert.equal(j.body, '{"pid":900002,"k":"v"}', 'a JSON number stays a number');
});

test('crossVerdict: the same answer twice, or the first patient again, is refused', () => {
  const A = { text: '[{"Drug":"Paracetamol"}]', contentType: 'application/json' };
  const B = { text: '[{"Drug":"Metformin"}]', contentType: 'application/json' };
  const rowsA = rowsForChain(A.text, 'application/json');
  assert.equal(crossVerdict({ first: A, second: A, firstRows: rowsA, secondRows: rowsA, otherPatient: true }), 'same-answer');
  assert.equal(crossVerdict({ first: A, second: B, firstRows: rowsA, secondRows: rowsForChain(B.text, 'application/json'), otherPatient: true }), 'differs');
  assert.equal(crossVerdict({ first: A, second: { text: '[]', contentType: 'application/json' }, firstRows: rowsA, secondRows: [], otherPatient: true }), 'none');
  const withId = (d, id) => ({ text: JSON.stringify([{ Drug: d, PatientID: id }]), contentType: 'application/json' });
  assert.equal(crossVerdict({ first: withId('X', 'MR900001'), second: withId('Y', 'MR900001'), firstRows: rowsForChain(withId('X', 'MR900001').text), secondRows: rowsForChain(withId('Y', 'MR900001').text), otherPatient: true }), 'carries-first-patient');
});

/* A fake page for crossCheck/proveView: the server answers medicines for the ACTIVATED patient. */
function provingPage({ ignoresId }) {
  const state = { active: 'MR900001', sent: [] };
  const meds = { MR900001: '<table><tr><th>Drug</th></tr><tr><td>Tab Paracetamol 650</td></tr><tr><td>Inj Ceftriaxone 1 g</td></tr></table>', MR900002: '<table><tr><th>Drug</th></tr><tr><td>Tab Metformin 500</td></tr></table>' };
  const answer = (method, url, body) => {
    state.sent.push(method + ' ' + url.replace('https://h', '') + (body ? ' ' + body : ''));
    if (method === 'POST') { state.active = new URLSearchParams(body).get('recordNo').split('-')[0]; return { status: 200, contentType: 'text/html', text: '<p>ok</p>' }; }
    const id = new URL(url).searchParams.get('id');
    const who = ignoresId ? state.active : (id === state.active ? id : '');
    return { status: 200, contentType: 'text/html', text: meds[who] || '<table><tr><th>Drug</th></tr></table>' };
  };
  const entries = [
    { seq: 1, method: 'POST', url: 'https://h/Activate', body: 'recordNo=MR900001-IP1', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'html' } },
    { seq: 2, method: 'GET', url: 'https://h/Meds?id=MR900001', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'html', keys: ['Drug'] } },
  ];
  const client = {
    state,
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['Tab Paracetamol 650'], ['Inj Ceftriaxone 1 g']]) };
      if (expression.includes('PROVE_EXEC_REQ')) { const req = JSON.parse(/\)\((\{[\s\S]*\})\)$/.exec(expression)[1]); return { result: JSON.stringify(answer(req.method, req.url, req.body)) }; }
      if (expression.includes('PROVE_EXEC')) { const seq = Number(/\)\((\d+)\)$/.exec(expression)[1]); const e = entries.find((x) => x.seq === seq); return { result: JSON.stringify(answer(e.method, e.url, e.body)) }; }
      if (expression.includes('document.cookie')) return { result: JSON.stringify(['sess-abc123xyz']) };
      return { result: null };
    },
  };
  return client;
}

test('proveView keeps a call that answers the second patient differently, and puts the first one back', async () => {
  const page = provingPage({ ignoresId: false });
  const view = { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'] };
  await proveView({ client: page, view, parents });
  assert.equal(view.proof.status, 'proven');
  assert.equal(view.proof.crossCheck, 'differs');
  assert.ok(page.state.sent.some((s) => /recordNo=MR900002-IP2/.test(s)), 'patient two was activated for the check: ' + page.state.sent.join(' | '));
  assert.equal(page.state.sent.at(-1), 'POST /Activate recordNo=MR900001-IP1', 'the last thing sent puts patient one back');
  assert.equal(page.state.active, 'MR900001');
});

test('proveView refuses a call the server answers for whoever is active, whatever id it names', async () => {
  const page = provingPage({ ignoresId: true });
  const view = { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'] };
  const cc = await crossCheck({
    client: { async evaluate({ expression }) { if (expression.includes('PROVE_EXEC_REQ')) { const req = JSON.parse(/\)\((\{[\s\S]*\})\)$/.exec(expression)[1]); return { result: JSON.stringify({ status: 200, contentType: 'text/html', text: page.state.active === 'X' ? '' : '<table><tr><th>Drug</th></tr><tr><td>Tab Paracetamol 650</td></tr></table>' }) }; } return { result: null }; } },
    e: { method: 'GET', url: 'https://h/Meds?id=MR900001', body: null }, pre: [], parents,
    firstResp: { status: 200, contentType: 'text/html', text: '<table><tr><th>Drug</th></tr><tr><td>Tab Paracetamol 650</td></tr></table>' },
    firstRows: [{ Drug: 'Tab Paracetamol 650' }],
  });
  assert.equal(cc.verdict, 'same-answer');
  // The same hospital through proveView: activation is NOT part of this view's proof (the id is ignored).
  const p2 = provingPage({ ignoresId: true });
  const entriesNoPre = { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'] };
  const orig = p2.evaluate;
  p2.evaluate = async ({ expression }) => (expression.includes('PROVE_LIST') ? { result: JSON.stringify([{ seq: 2, method: 'GET', url: 'https://h/Meds?id=MR900001', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'html', keys: ['Drug'] } }]) } : orig({ expression }));
  await proveView({ client: p2, view: entriesNoPre, parents });
  assert.equal(entriesNoPre.proof.status, 'same-answer');
  assert.equal(entriesNoPre.endpoints, undefined, 'nothing is saved');
  assert.equal(view.endpoints, undefined);
});

test('proveView never stores a live session value as a constant', async () => {
  const entries = [{ seq: 5, method: 'GET', url: 'https://h/Meds?id=MR900001&s=sess-abc123xyz&Type=IPWorkList', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'html', keys: ['Drug'] } }];
  const html = '<table><tr><th>Drug</th></tr><tr><td>Tab Paracetamol 650</td></tr><tr><td>Inj Ceftriaxone 1 g</td></tr></table>';
  const client = {
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['Tab Paracetamol 650'], ['Inj Ceftriaxone 1 g']]) };
      // Patient one's medicines for patient one's id; anyone else gets their own (an empty chart here).
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify({ status: 200, contentType: 'text/html', text: /MR900001/.test(expression) || /\((\d+)\)$/.test(expression) ? html : '<table><tr><th>Drug</th></tr><tr><td>Tab Metformin 500</td></tr></table>' }) };
      if (expression.includes('document.cookie')) return { result: JSON.stringify(['sess-abc123xyz']) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'] };
  await proveView({ client, view, parents });
  assert.equal(view.proof.crossCheck, 'differs');
  const params = view.endpoints.find((e) => e.role === 'data').params;
  assert.deepEqual(params.s, { unmapped: true });
  assert.deepEqual(params.Type, { constant: 'IPWorkList' });
  assert.ok(!/sess-abc123xyz/.test(JSON.stringify(view)), 'the session value is nowhere in the view');
  assert.equal(PROVE_SOURCES.execRequest({ method: 'GET', url: 'u' }).includes('PROVE_EXEC_REQ'), true);
});

/* ---- server ---- */

test('the server keeps the two-patient result and refuses an unknown one', () => {
  const base = { resourceHint: 'medications', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'] };
  const [ok] = cleanObservedViews([Object.assign({}, base, { proof: { status: 'proven', crossCheck: 'differs' } })]);
  assert.equal(ok.proof.crossCheck, 'differs');
  const [refused] = cleanObservedViews([Object.assign({}, base, { proof: { status: 'same-answer', crossCheck: 'same-answer' } })]);
  assert.equal(refused.proof.status, 'same-answer');
  assert.throws(() => cleanObservedViews([Object.assign({}, base, { proof: { status: 'proven', crossCheck: 'maybe' } })]), /crossCheck invalid/);
  const [k] = cleanObservedViews([Object.assign({}, base, { proof: { status: 'proven' }, endpoints: [{ method: 'GET', path: '/Meds?s', role: 'data', params: { s: { constant: 'aB3dE5fG7hJ9kL1m' } } }] })]);
  assert.deepEqual(k.endpoints[0].params.s, { unmapped: true }, 'a key-shaped constant is not stored');
});

test('describeRepair says what changed, by kind, never by value', () => {
  const before = { resourceHint: 'worklist', pathTemplate: 'https://h/Doctor/Home', headers: ['MR No', 'Bed'], endpoints: [{ method: 'GET', path: '/GetIPWL?Type', role: 'data', params: { Type: { constant: 'IPWorkList' } } }] };
  const after = { resourceHint: 'worklist', pathTemplate: 'https://h/Nurse/Home', headers: ['MR No', 'Ward'], endpoints: [{ method: 'POST', path: '/GetWard', role: 'data', params: { unit: { from: 'worklist', field: 'Unit' }, Type: { constant: 'IPWorkList' } } }] };
  const lines = describeRepair(before, after);
  assert.deepEqual(lines, [
    'worklist: page /Doctor/Home -> /Nurse/Home',
    'worklist: data call GET /GetIPWL -> POST /GetWard',
    'worklist: field unit: absent -> from worklist',
    'worklist: columns +Ward -Bed',
  ]);
  assert.ok(!/IPWorkList/.test(lines.join(' ')), 'a constant\'s value is never printed');
  assert.deepEqual(describeRepair(before, before), ['worklist: the same request was learned again (nothing changed)']);
});
