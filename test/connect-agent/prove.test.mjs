// test/connect-agent/prove.test.mjs -- an endpoint is saved only once its answer carries what the screen shows.
//   node --test test/connect-agent/prove.test.mjs
// Synthetic GHIS-shaped data (made-up ids and names); the real GHIS endpoint list is never given to discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consideredCells, overlapOf, accepted, paramsOf, todayFormat, rowsForChain, proveView, createProofBook, safeParams } from '../../connect-agent/phone/prove.mjs';
import { executeView, parseFetchExpression, PAGE_TOKENS, provenValue } from '../../connect-agent/phone/adapter-runtime.mjs';
import { mapRows } from '../../connect-agent/phone/runtime.mjs';
import { redactEndpoints } from '../../connect-agent/phone/deep-crawl.mjs';

const HOST = 'https://ghis.example.test';
const WL_JSON = JSON.stringify({ data: [
  { MRNo: 'MR900001', VisitNo: 'IP5550001', PatientName: 'TEST ALPHA', BedName: 'B-12' },
  { MRNo: 'MR900002', VisitNo: 'IP5550002', PatientName: 'TEST BRAVO', BedName: 'B-14' },
] });
const MEDS_HTML = '<table><tr><th>Drug</th><th>Route</th><th>Frequency</th></tr><tr><td>Tab Paracetamol 650 mg</td><td>Oral</td><td>TDS</td></tr><tr><td>Inj Ceftriaxone 1 g</td><td>IV</td><td>BD</td></tr></table>';
const FORM_HTML = '<table><tr><th>Chief complaint</th></tr><tr><td><textarea></textarea></td></tr></table><table><tr><th>Vitals</th></tr></table>';
const MEDS_SCREEN = ['Tab Paracetamol 650 mg', 'Oral', 'TDS', 'Inj Ceftriaxone 1 g', 'IV', 'BD'];

test('overlap: the medicines fragment carries the screen, the assessment form and a signature lookup do not', () => {
  const cells = consideredCells(MEDS_SCREEN);
  assert.deepEqual(cells, ['tabparacetamol650mg', 'oral', 'tds', 'injceftriaxone1g']);
  assert.equal(accepted(overlapOf(cells, MEDS_HTML, 'text/html')), true);
  assert.equal(accepted(overlapOf(cells, FORM_HTML, 'text/html')), false);
  assert.equal(accepted(overlapOf(cells, '{"Signature":"x"}', 'application/json')), false);
  assert.equal(accepted(overlapOf(consideredCells(['TEST ALPHA', 'B-12', 'MR900001']), WL_JSON, 'application/json')), true);
});

test('paramsOf traces every field: ward-list column, joined visit id, parent row, mode constant, token, today', () => {
  const wl = { label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') };
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/GetMedicines/?id=MR900001', body: null }, [wl]), { id: { from: 'worklist', field: 'MRNo' } });
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/Searchnew', body: '__RequestVerificationToken=abc&recordNo=MR900001-IP5550001' }, [wl]),
    { __RequestVerificationToken: { token: true }, recordNo: { from: 'worklist', fields: ['MRNo', 'VisitNo'], join: '-' } });
  const now = new Date(2026, 8, 13);
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/GetIPWL?NursingStationId=&Type=IPWorkList&length=10&sdate=13-Sep-2026', body: null }, [], now),
    { NursingStationId: { empty: true }, Type: { constant: 'IPWorkList' }, length: { page: 'size' }, sdate: { today: 'DD-Mon-YYYY' } });
  const labs = { label: 'labs', rows: rowsForChain(JSON.stringify([{ parameter_long_desc: 'CBC', ServiceRenderId: 'R77001', episode_id: 'IP5550001' }]), 'application/json') };
  assert.deepEqual(paramsOf({ url: HOST + '/Lab/Home/GetPrintLabResultDetailsAuth', body: 'Render_ID=R77001&Episode_Id=IP5550001&Result_Type=a' }, [labs, wl]),
    { Render_ID: { from: 'labs', field: 'ServiceRenderId' }, Episode_Id: { from: 'labs', field: 'episode_id' }, Result_Type: { constant: 'a' } });
  // An HTML list row's onclick argument is a field too (radiology result id).
  const radio = { label: 'radiology', rows: rowsForChain('<table><tr><th>Study</th></tr><tr onclick="openReport(\'RS44001\',\'n\')"><td>CT BRAIN</td></tr></table>', 'text/html') };
  assert.deepEqual(paramsOf({ url: HOST + '/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001', body: null }, [radio, wl]), { resultid: { from: 'radiology', field: '_args.0' } });
  assert.equal(todayFormat('2026-09-13', now), 'YYYY-MM-DD');
  assert.deepEqual(safeParams({ id: { from: 'worklist', field: 'col123' }, x: { constant: 'a' } }), { id: { unmapped: true }, x: { constant: 'a' } });
});

/* A fake hospital page: the replay buffer the observer keeps, the cells on screen, and the answers a
 * re-issued request gets. Dispatches on the page-realm function names. */
function fakePage({ entries, screen, answers, url = HOST + '/Doctor/Home' }) {
  const executed = [];
  return {
    executed,
    async currentUrl() { return { url }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify(screen) };
      if (expression.includes('PROVE_EXEC')) {
        const seq = Number(/\)\((\d+)\)$/.exec(expression)[1]);
        executed.push(seq);
        return { result: JSON.stringify(answers[seq] || { status: 0 }) };
      }
      return { result: null };
    },
  };
}
const MEDS_ENTRIES = [
  { seq: 11, method: 'POST', url: HOST + '/Doctor/Home/Searchnew', body: '__RequestVerificationToken=abc&recordNo=MR900001-IP5550001', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'html', keys: ['Chief complaint', 'Vitals'], rows: 2, tables: 2 } },
  { seq: 12, method: 'GET', url: HOST + '/Doctor/Home/GetSignatureBYid?id=MR900001', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['Signature'], rows: 1 } },
  { seq: 13, method: 'GET', url: HOST + '/Doctor/Home/GetMedicines/?id=MR900001', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'html', keys: ['Drug', 'Route', 'Frequency'], rows: 3, tables: 1 } },
];
const MEDS_ANSWERS = {
  11: { status: 200, contentType: 'text/html', text: FORM_HTML },
  12: { status: 200, contentType: 'application/json', text: '{"Signature":"x"}' },
  13: { status: 200, contentType: 'text/html', text: MEDS_HTML },
};

test('proveView: Gemini ranks the wrong call first, execution against the screen rejects it and keeps the medicines call', async () => {
  const page = fakePage({ entries: MEDS_ENTRIES, screen: MEDS_SCREEN, answers: MEDS_ANSWERS });
  const asked = [];
  const brain = { async pickEndpoint(p) { asked.push(p); return { ranked: [{ index: 0, role: 'data' }, { index: 1, role: 'lookup' }, { index: 2, role: 'data' }], model: 'gemini-3.8-flash' }; } };
  const view = { resourceHint: 'medications', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#meds tbody tr', headers: ['Drug', 'Route', 'Frequency'], endpoints: [{ method: 'GET', path: '/guessed' }] };
  const wl = { label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') };
  const { proven } = await proveView({ client: page, view, brain, label: 'tap Treatment chart', parents: [wl] });

  // The brain saw structure only: paths, key names, labels. No id, no name, no drug.
  const sent = JSON.stringify(asked[0]);
  assert.ok(!/MR900001|TEST ALPHA|Paracetamol|abc/.test(sent), sent);
  assert.equal(asked[0].candidates[2].path, '/Doctor/Home/GetMedicines/');
  assert.deepEqual(page.executed, [11, 12, 13], 'replayed in the brain order until one matched the screen');

  assert.equal(view.proof.status, 'proven');
  assert.equal(view.proof.brain, true);
  assert.equal(view.proof.model, 'gemini-3.8-flash');
  assert.deepEqual(view.endpoints.map((e) => [e.role, e.method, e.path]), [
    ['prerequisite', 'POST', '/Doctor/Home/Searchnew'],
    ['data', 'GET', '/Doctor/Home/GetMedicines/?id'],
  ]);
  assert.deepEqual(view.endpoints[1].params, { id: { from: 'worklist', field: 'MRNo' } });
  assert.deepEqual(view.endpoints[0].params.recordNo, { from: 'worklist', fields: ['MRNo', 'VisitNo'], join: '-' });
  assert.equal(view.endpoints[1].proof.hits, 4);
  assert.ok(!/MR900001|abc/.test(JSON.stringify(view)), 'nothing identifying is saved');
  assert.equal(proven.rows.length, 2);
});

test('proveView without a brain still proves by the screen; nothing matching keeps no endpoint at all', async () => {
  const view = { resourceHint: 'medications', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Drug'] };
  await proveView({ client: fakePage({ entries: MEDS_ENTRIES, screen: MEDS_SCREEN, answers: MEDS_ANSWERS }), view });
  assert.equal(view.proof.status, 'proven');
  assert.equal(view.proof.brain, false);
  assert.equal(view.endpoints.find((e) => e.role === 'data').path, '/Doctor/Home/GetMedicines/?id');

  const wrong = { resourceHint: 'labs', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Test'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetMedicines/?id' }] };
  await proveView({ client: fakePage({ entries: MEDS_ENTRIES, screen: ['Haemoglobin', '11.2 g/dL', 'Platelet count'], answers: MEDS_ANSWERS }), view: wrong });
  assert.equal(wrong.proof.status, 'unproven');
  assert.equal(wrong.endpoints, undefined, 'an unproven endpoint is never saved');
});

test('proof book chains a detail view to its proven list row', async () => {
  const book = createProofBook({ brain: null });
  const wlView = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['MR No', 'Name'] };
  await book.prove({ client: fakePage({ entries: [{ seq: 1, method: 'GET', url: HOST + '/Doctor/Home/GetIPWL?Type=IPWorkList', body: null, xhr: true, status: 200, shape: { kind: 'json', keys: ['MRNo'], rows: 2 } }], screen: ['MR900001', 'TEST ALPHA', 'MR900002', 'TEST BRAVO'], answers: { 1: { status: 200, contentType: 'application/json', text: WL_JSON } } }), view: wlView, since: 0 });
  const LABS_JSON = JSON.stringify([{ parameter_long_desc: 'Complete blood count', ServiceRenderId: 'R77001', episode_id: 'IP5550001' }]);
  const labs = { resourceHint: 'labs', pathTemplate: HOST + '/Lab/Home', rowsSelector: 'tr', headers: ['Test'] };
  await book.prove({ client: fakePage({ entries: [{ seq: 2, method: 'POST', url: HOST + '/Lab/Home/GetSearchPatientId', body: '__RequestVerificationToken=abc&patient_id=MR900001&DeptID=', xhr: true, status: 200, shape: { kind: 'json', keys: ['parameter_long_desc'], rows: 1 } }], screen: ['Complete blood count'], answers: { 2: { status: 200, contentType: 'application/json', text: LABS_JSON } } }), view: labs });
  assert.deepEqual(labs.endpoints[0].params, { __RequestVerificationToken: { token: true }, patient_id: { from: 'worklist', field: 'MRNo' }, DeptID: { empty: true } });
  const detail = { resourceHint: 'labs-detail', detailOf: 'labs', pathTemplate: HOST + '/Lab/Home', rowsSelector: 'tr', headers: ['Parameter', 'Result'] };
  await book.prove({ client: fakePage({ entries: [{ seq: 3, method: 'POST', url: HOST + '/Lab/Home/GetPrintLabResultDetailsAuth', body: 'Render_ID=R77001&Episode_Id=IP5550001&Result_Type=a', xhr: true, status: 200, shape: { kind: 'html', keys: ['Parameter'], rows: 2 } }], screen: ['Haemoglobin', '11.2'], answers: { 3: { status: 200, contentType: 'text/html', text: '<table><tr><th>Parameter</th><th>Result</th></tr><tr><td>Haemoglobin</td><td>11.2</td></tr></table>' } } }), view: detail, parent: 'labs' });
  assert.equal(detail.proof.status, 'proven');
  assert.deepEqual(detail.endpoints[0].params, { Render_ID: { from: 'labs', field: 'ServiceRenderId' }, Episode_Id: { from: 'labs', field: 'episode_id' }, Result_Type: { constant: 'a' } });
  assert.deepEqual(book.trace.map((t) => [t.resource, t.status]), [['worklist', 'proven'], ['labs', 'proven'], ['labs-detail', 'proven']]);
});

test('executeView runs a proven view exactly: activation with the page token and the joined visit id, then the medicines call', async () => {
  const seen = [];
  const plugin = {
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: '{"__RequestVerificationToken":"tok2"}' };
      const req = parseFetchExpression(expression);
      seen.push(req);
      const text = /GetMedicines/.test(req.url) ? MEDS_HTML : '<html><body>ok</body></html>';
      return { result: JSON.stringify({ status: 200, contentType: 'text/html', url: req.url, text }) };
    },
  };
  const [patient] = mapRows([JSON.parse(WL_JSON).data[1]].map((r) => ({ ...r, 'Patient ID': r.MRNo, 'Patient name': r.PatientName })));
  assert.equal(JSON.stringify(patient).includes('VisitNo'), false, 'the list row rides along unserialised');
  const view = {
    resourceHint: 'medications', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#meds tbody tr', headers: ['Drug', 'Route', 'Frequency'],
    proof: { status: 'proven' },
    endpoints: [
      { method: 'POST', path: '/Doctor/Home/Searchnew', bodyKeys: ['__RequestVerificationToken', 'recordNo'], requestKind: 'form', role: 'prerequisite', params: { __RequestVerificationToken: { token: true }, recordNo: { from: 'worklist', fields: ['MRNo', 'VisitNo'], join: '-' } } },
      { method: 'GET', path: '/Doctor/Home/GetMedicines/?id', role: 'data', params: { id: { from: 'worklist', field: 'MRNo' } } },
    ],
  };
  const out = await executeView({ plugin, origin: HOST, view, patient, parseHtml: null });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body, '__RequestVerificationToken=tok2&recordNo=MR900002-IP5550002');
  assert.equal(seen[1].url, HOST + '/Doctor/Home/GetMedicines/?id=MR900002');
  assert.equal(out.proven, true);
  assert.equal(provenValue('Render_ID', { from: 'labs', field: 'ServiceRenderId' }, { parentRow: { ServiceRenderId: 'R1' } }), 'R1');
});

test('the endpoint a proof saves goes through the same redaction as every captured endpoint', () => {
  const [ep] = redactEndpoints([{ method: 'GET', url: HOST + '/Radiology/Home/GetRadiologyResultPrint/2012130687?resultid=RS44001' }], HOST + '/x');
  assert.equal(ep.path, '/Radiology/Home/GetRadiologyResultPrint/#?resultid');
});
