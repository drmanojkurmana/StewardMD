// test/connect-agent/prove.test.mjs -- an endpoint is saved only once its answer carries what the screen shows.
//   node --test test/connect-agent/prove.test.mjs
// Synthetic GHIS-shaped data (made-up ids and names); the real GHIS endpoint list is never given to discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consideredCells, overlapOf, accepted, paramsOf, todayFormat, rowsForChain, proveView, createProofBook, safeParams, learnColumns, screenRows, navToReplayEntries, INJECT_REPLAY_SRC, widenRequest, reportWords } from '../../connect-agent/phone/prove.mjs';
import { executeView, parseFetchExpression, PAGE_TOKENS, provenValue, applyColumns } from '../../connect-agent/phone/adapter-runtime.mjs';
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
const NARRATIVE_TEXT = 'no acute intracranial hemorrhage midline shift ventricles normal study reviewed impression final report issued today morning routine screening';

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

/* GHIS ver_b27ed367 2026-09-17: a page-side JS bug sends id=undefined literally. Recorded as a
 * {constant} it would replay id=undefined for every patient forever; it is not a value. */
test('paramsOf: a recorded "undefined"/"null"/"NaN" value is not a value', () => {
  const wl = { label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') };
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/OTLabPrintsSecretary/?id=undefined', body: null }, [wl]), { id: { empty: true } });
  assert.deepEqual(paramsOf({ url: HOST + '/x?a=NULL&b=NaN', body: null }, [wl]), { a: { empty: true }, b: { empty: true } });
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/GetIPWL?Type=IPWorkList', body: null }, [wl]), { Type: { constant: 'IPWorkList' } });
});

/* F3 REGRESSION: findField used to stop at row 200, so a widened hospital-wide worklist (757 rows on a
 * live run) left the doctor's own row unmapped whenever it sat past that cutoff. */
test('paramsOf: a 757-row worklist maps a field whose only matching row is past the old 200-row cutoff', () => {
  const rows = [];
  for (let i = 0; i < 757; i += 1) rows.push({ MRNo: 'MR9' + String(100000 + i), VisitNo: 'IP5' + String(550000 + i), PatientName: 'PATIENT ' + i });
  const wl = { label: 'worklist', rows };
  // Row 600: single-field match.
  assert.deepEqual(paramsOf({ url: HOST + '/Doctor/Home/GetMedicines/?id=MR9100600', body: null }, [wl]), { id: { from: 'worklist', field: 'MRNo' } });
  // Row 650: a joined id where BOTH halves are past row 200.
  assert.deepEqual(
    paramsOf({ url: HOST + '/Doctor/Home/Searchnew', body: 'recordNo=MR9100650-IP5550650' }, [wl]),
    { recordNo: { from: 'worklist', fields: ['MRNo', 'VisitNo'], join: '-' } },
  );
});

test('learnColumns binds each screen column to the response field by VALUE, never by what the key is named', () => {
  // The real GHIS lab-result defect: the payload puts ValueType and LowValue AHEAD of the result, and
  // a name guess (/value|result/) grabs ValueType. The screen shows test, result, units, range.
  const headers = ['Test', 'Result', 'Units', 'Range'];
  const screen = [
    ['Haemoglobin', '11.2', 'g/dL', '13 - 17'],
    ['WBC', '9.1', '10^3/uL', '4 - 11'],
    ['Creatinine', '1.4', 'mg/dL', '0.6 - 1.2'],
  ];
  const resp = [
    { ValueType: 'N', TestName: 'Haemoglobin', LowValue: '13', HighValue: '17', Result: '11.2', Units: 'g/dL' },
    { ValueType: 'N', TestName: 'WBC', LowValue: '4', HighValue: '11', Result: '9.1', Units: '10^3/uL' },
    { ValueType: 'N', TestName: 'Creatinine', LowValue: '0.6', HighValue: '1.2', Result: '1.4', Units: 'mg/dL' },
  ];
  const cols = learnColumns(headers, screen, resp);
  assert.deepEqual(cols.Test, { key: 'TestName' });
  assert.deepEqual(cols.Result, { key: 'Result' }, 'Result binds to the field whose values are on screen, not ValueType');
  assert.deepEqual(cols.Units, { key: 'Units' });
  assert.deepEqual(cols.Range, { keys: ['LowValue', 'HighValue'], join: ' - ' }, 'a joined range column maps to both fields and the joiner');

  // applyColumns then renames the raw rows to the screen's own labels, keeping the raw fields too.
  const named = applyColumns({ columns: cols }, resp);
  assert.equal(named[0].Result, '11.2');
  assert.equal(named[0].Range, '13 - 17');
  assert.equal(named[0].TestName, 'Haemoglobin', 'raw fields survive so a chained id is still readable');
});

test('learnColumns stays within a phone budget on a ward-sized list (668 rows x 30 fields, 8 headers)', () => {
  // It runs synchronously on the app WebView's only thread; the first version froze an iPhone for
  // 30-40s per view on exactly this shape. Same answer, but it must be fast.
  const headers = ['MR', 'Name', 'Bed', 'Age', 'Sex', 'Ward', 'Doctor', 'Range'];
  const rows = [], screen = [];
  for (let i = 0; i < 668; i += 1) {
    const r = { MRNo: 'MR9' + String(100000 + i), PatientName: 'PATIENT NUMBER ' + i, BedName: 'B-' + (i % 40), AgeYears: String(20 + (i % 60)), Gender: i % 2 ? 'Male' : 'Female', WardName: 'WARD ' + (i % 7), Consultant: 'DR X ' + (i % 9), Low: String(i % 13), High: String(17 + (i % 5)) };
    for (let k = 0; k < 21; k += 1) r['extra' + k] = 'v' + ((i * 7 + k) % 97);
    rows.push(r);
    screen.push([r.MRNo, r.PatientName, r.BedName, r.AgeYears, r.Gender, r.WardName, r.Consultant, r.Low + ' - ' + r.High]);
  }
  const t = Date.now();
  const cols = learnColumns(headers, screen, rows);
  const ms = Date.now() - t;
  assert.deepEqual(cols.MR, { key: 'MRNo' });
  assert.deepEqual(cols.Name, { key: 'PatientName' });
  assert.deepEqual(cols.Range, { keys: ['Low', 'High'], join: ' - ' });
  assert.ok(ms < 400, 'learnColumns took ' + ms + 'ms on a ward-sized list; must stay well under a second on a phone');
});

test('learnColumns refuses a column no response field reproduces on screen (never a guess)', () => {
  const cols = learnColumns(['Result', 'Comment'], [['11.2', 'looks fine'], ['9.1', 'within range']],
    [{ Result: '11.2', Flag: 'H' }, { Result: '9.1', Flag: '' }]);
  assert.deepEqual(cols.Result, { key: 'Result' });
  assert.equal(cols.Comment, undefined, 'the free-text comment matches no field, so it stays unmapped');
});

test('screenRows accepts both the row-structured screen and the older flat list', () => {
  assert.deepEqual(screenRows([['a', 'b'], ['c', 'd']]), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(screenRows(['a', 'b', 'c']), [['a', 'b', 'c']]);
  assert.deepEqual(screenRows(null), []);
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

test('proveView takes the lab search list, not the whole visit page that also shows the lab names (ver_b16da370)', async () => {
  const VISIT_PAGE = '<html><body><table><tr><th>Test</th></tr><tr><td>Complete blood count</td></tr><tr><td>Serum creatinine</td></tr></table><table>' +
    '<tr><td>Pulse</td><td>Blood pressure</td></tr>'.repeat(40) + '</table></body></html>';
  const LABS_JSON = JSON.stringify([
    { parameter_long_desc: 'Complete blood count', ServiceRenderId: 'R77001' },
    { parameter_long_desc: 'Serum creatinine', ServiceRenderId: 'R77002' },
  ]);
  const entries = [
    { seq: 21, method: 'POST', url: HOST + '/Doctor/Home/Searchnew', body: '__RequestVerificationToken=abc&recordNo=MR900001-IP5550001', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'html', keys: ['Test'], rows: 42, tables: 2 } },
    { seq: 22, method: 'POST', url: HOST + '/Lab/Home/GetSearchPatientId', body: '__RequestVerificationToken=abc&patient_id=MR900001&DeptID=', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'json', keys: ['parameter_long_desc'], rows: 2 } },
  ];
  const page = fakePage({
    entries,
    screen: [['Complete blood count'], ['Serum creatinine']],
    answers: { 21: { status: 200, contentType: 'text/html', text: VISIT_PAGE }, 22: { status: 200, contentType: 'application/json', text: LABS_JSON } },
  });
  // Gemini ranks the visit page first, as it did on the live run.
  const brain = { async pickEndpoint() { return { ranked: [{ index: 0, role: 'data' }, { index: 1, role: 'data' }] }; } };
  const view = { resourceHint: 'labs', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Test'] };
  await proveView({ client: page, view, brain, parents: [{ label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') }] });
  assert.deepEqual(page.executed, [21, 22], 'every candidate is replayed, not only the first that carries the screen');
  assert.equal(view.proof.status, 'proven');
  assert.equal(view.endpoints.find((e) => e.role === 'data').path.split('?')[0], '/Lab/Home/GetSearchPatientId');
});

test('proveView asks Gemini about the ward list too: an out-patient queue is not the admitted list', async () => {
  const OPD_HTML = '<table><tr><th>Patient ID</th><th>Name</th><th>Visit type</th></tr><tr><td>MR900001</td><td>TEST ALPHA</td><td>OPD</td></tr><tr><td>MR900002</td><td>TEST BRAVO</td><td>OPD</td></tr></table>';
  const entries = [{ seq: 31, method: 'GET', url: HOST + '/Doctor/Home/DashboardUnit?type=docopdlist', body: null, xhr: true, status: 200, shape: { kind: 'html', keys: ['Patient ID', 'Name', 'Visit type'], rows: 2, tables: 1 } }];
  const judged = [];
  const brain = { async verify(p) { judged.push(p); return { ok: false, resource: 'none', confidence: 0.9, reason: 'out-patient queue' }; } };
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID', 'Name', 'Visit type'] };
  await proveView({
    client: fakePage({ entries, screen: [['MR900001', 'TEST ALPHA', 'OPD'], ['MR900002', 'TEST BRAVO', 'OPD']], answers: { 31: { status: 200, contentType: 'text/html', text: OPD_HTML } } }),
    view, brain,
  });
  assert.equal(judged.length, 1, 'the ward list reply was judged');
  assert.equal(judged[0].resource, 'worklist');
  assert.ok(!/MR900001|ALPHA/.test(JSON.stringify(judged[0])), 'only structure reached the model');
  assert.equal(view.proof.status, 'unproven');
  assert.equal(view.endpoints, undefined);
});

test('navToReplayEntries keeps only main-frame GET reports on the hospital origin', () => {
  const out = navToReplayEntries({ requests: [
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetopcardReport?id=OP77&patid=MR9' },
    { method: 'POST', url: 'https://ghis.gitam.edu/Doctor/Home/CreateDrugs' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Content/site.css' },
    { method: 'GET', url: 'https://analytics.example/collect?x=1' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
  ] }, { pageOrigin: 'https://ghis.gitam.edu' });
  assert.deepEqual(out, [
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetopcardReport?id=OP77&patid=MR9' },
  ], 'writes, assets, beacons and a foreign origin are dropped; a repeat is deduped');
});

test('INJECT_REPLAY_SRC pushes nav entries into the replay buffer with monotonic seq', () => {
  const win = { __SMD_REPLAY__: { seq: 5, list: [{ seq: 5, url: 'x' }] } };
  new Function('window', 'entries', 'return (' + INJECT_REPLAY_SRC + ')(entries)')(win, [{ method: 'GET', url: 'https://h/GetReport?resultid=RS1' }]);
  assert.equal(win.__SMD_REPLAY__.list.length, 2);
  const added = win.__SMD_REPLAY__.list[1];
  assert.equal(added.seq, 6);
  assert.equal(added.method, 'GET');
  assert.equal(added.url, 'https://h/GetReport?resultid=RS1');
  assert.equal(added.xhr, false);
});

test('a radiology report opened by navigation is proven and keyed to its list row', async () => {
  const REPORT = '<html><body><h3>CT BRAIN PLAIN</h3><p>No acute intracranial abnormality. Ventricles normal.</p></body></html>';
  // The report GET was injected from the native nav log: it is in the buffer as a page-shaped entry.
  const entries = [{ seq: 51, method: 'GET', url: HOST + '/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001', body: null, reqCt: '', xhr: false, status: 200, shape: { kind: 'unknown', page: true } }];
  const view = { resourceHint: 'radiology-detail', detailOf: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'body', headers: ['Impression'] };
  const radRow = { description: 'CT BRAIN PLAIN', _args: ['RS44001'], resultid: 'RS44001' };
  await proveView({
    client: fakePage({ entries, screen: [['No acute intracranial abnormality. Ventricles normal.']], answers: { 51: { status: 200, contentType: 'text/html', text: REPORT } } }),
    view, parents: [{ label: 'radiology', rows: [radRow] }],
  });
  assert.equal(view.proof.status, 'proven', JSON.stringify(view.proof));
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.equal(data.path.split('?')[0], '/Radiology/Home/GetRadiologyResultPrint');
  assert.deepEqual(data.params.resultid, { from: 'radiology', field: 'resultid' });
});

/* B2 REGRESSION. A page-load candidate (shell: page:true, xhr:false) used to be accepted ONLY when
 * chained(paramsOf(...)) traced its key to a parent row - so a doctor demonstrating radiology for a
 * patient the crawl never proved a worklist row for (no parents to trace against) stayed unproven
 * forever, even though the request plainly carries a patient/visit identifier (recordNo). Now a
 * page-load candidate whose query carries a NON-EMPTY patient/visit key is also accepted. */
test('proveView: a radiology report opened by navigation, with no traceable parent, is still proven because its query carries a patient key', async () => {
  const REPORT = '<html><body><h3>CT BRAIN PLAIN</h3><p>No acute intracranial abnormality. Ventricles normal.</p></body></html>';
  const entries = [{ seq: 61, method: 'GET', url: HOST + '/Radio/Home?recordNo=MR900001', body: null, reqCt: '', xhr: false, status: 200, shape: { kind: 'unknown', page: true } }];
  const view = { resourceHint: 'radiology-detail', detailOf: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'body', headers: ['Impression'] };
  const screen = [['No acute intracranial abnormality. Ventricles normal.']];
  // No `parents`: nothing to trace recordNo against, so chained() is false here.
  await proveView({ client: fakePage({ entries, screen, answers: { 61: { status: 200, contentType: 'text/html', text: REPORT } } }) , view });
  assert.equal(view.proof.status, 'proven', JSON.stringify(view.proof));
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.equal(data.path.split('?')[0], '/Radio/Home');
  assert.deepEqual(data.params.recordNo, { unmapped: true }, 'untraceable, but still a patient key: proven, not silently constant');
});

test('proveView: a page-load candidate with no patient/visit key in its query is still refused, even with no traceable parent', async () => {
  const REPORT = '<html><body><h3>CT BRAIN PLAIN</h3><p>No acute intracranial abnormality. Ventricles normal.</p></body></html>';
  const entries = [{ seq: 62, method: 'GET', url: HOST + '/Radio/Home', body: null, reqCt: '', xhr: false, status: 200, shape: { kind: 'unknown', page: true } }];
  const view = { resourceHint: 'radiology-detail', detailOf: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'body', headers: ['Impression'] };
  const screen = [['No acute intracranial abnormality. Ventricles normal.']];
  await proveView({ client: fakePage({ entries, screen, answers: { 62: { status: 200, contentType: 'text/html', text: REPORT } } }), view });
  assert.equal(view.proof.status, 'unproven', JSON.stringify(view.proof));
  assert.equal(view.endpoints, undefined);
});

test('reportWords: the longest string on screen, its distinct 5+ letter words, only when there are at least 8', () => {
  assert.deepEqual(reportWords([['a b c'], ['too short']]), [], 'fewer than 8 qualifying words is a header, not a report');
  assert.deepEqual(
    reportWords([['MR900010'], [NARRATIVE_TEXT]]),
    ['acute', 'intracranial', 'hemorrhage', 'midline', 'shift', 'ventricles', 'normal', 'study', 'reviewed', 'impression', 'final', 'report', 'issued', 'today', 'morning', 'routine', 'screening'],
  );
});

/* F2 REGRESSION (ver_05ce2f04): radiology-detail's real answer carried the report prose but only 0.14 of
 * the demographic-header cells -- rejected outright before this fix (accepted() needs ratio>=0.5). The
 * report's own words now decide it; the whole-page shell that also "contains" everything stays refused. */
test('proveView: a radiology-detail report is proven by its prose when its cells barely overlap; the whole-page shell stays refused', async () => {
  const view = { resourceHint: 'radiology-detail', detailOf: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'body', headers: ['Impression'] };
  const screen = [['MR900010', 'TEST GAMMA', 'IP5550010', 'STUDYCODE77', 'DRJONES'], [NARRATIVE_TEXT]];
  const demographicCells = consideredCells(screen[0]);
  const report = '<div><h4>CT BRAIN PLAIN</h4><p>' + NARRATIVE_TEXT + '</p></div>';
  const entries = [
    { seq: 81, method: 'GET', url: HOST + '/Radiology/Home/GetRadiologyResultPrint?resultid=RS44010', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['result'], rows: 1 } },
    { seq: 82, method: 'GET', url: HOST + '/Radio/Home', body: null, reqCt: '', xhr: false, status: 200, shape: { kind: 'unknown', page: true } },
  ];
  const answers = {
    81: { status: 200, contentType: 'application/json', text: JSON.stringify({ result: report }) },
    82: { status: 200, contentType: 'text/html', text: '<html><body><h4>CT BRAIN PLAIN</h4><p>' + NARRATIVE_TEXT + '</p><p>MR900010 TEST GAMMA IP5550010</p></body></html>' },
  };
  // Proof the fix is needed at all: the demographic cells alone, against the real data answer, do not clear the bar.
  assert.equal(accepted(overlapOf(demographicCells, answers[81].text, answers[81].contentType)), false, 'cells alone stay under the 0.5 ratio / 3 hits bar');

  await proveView({ client: fakePage({ entries, screen, answers }), view });
  assert.equal(view.proof.status, 'proven', JSON.stringify(view.proof));
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.equal(data.path.split('?')[0], '/Radiology/Home/GetRadiologyResultPrint', 'the report call is proven, not the whole-page shell');
});

/* An ordinary list (no detailOf, not narrative) gets no prose fallback: weak cell overlap still fails. */
test('proveView: a non-narrative list at 14% cell overlap is still not proven', async () => {
  const screen = [['Haemoglobin', 'Complete blood count', 'ServiceRenderId77', 'Section Haematology', 'OrderedBy DrX', 'StatusPending', 'CollectedToday']];
  const entries = [{ seq: 91, method: 'GET', url: HOST + '/Lab/Home/GetSomething?id=RS1', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['other'], rows: 1 } }];
  const answers = { 91: { status: 200, contentType: 'application/json', text: '{"other":"nothing relevant except Haemoglobin mention here"}' } };
  const view = { resourceHint: 'labs', pathTemplate: HOST + '/Lab/Home', rowsSelector: 'tr', headers: ['Test'] };
  await proveView({ client: fakePage({ entries, screen, answers }), view });
  assert.equal(view.proof.status, 'unproven');
  assert.equal(view.endpoints, undefined);
});

test('widenRequest empties only the filters nothing could be traced to', () => {
  const entry = { method: 'GET', url: HOST + '/Doctor/Home/GetIPWL?NursingStationId=&PatientId=&FloorId=&Emp_ID=4471&Dept_ID=12&Type=IPWorkList&__RequestVerificationToken=abc', body: null, reqCt: '' };
  const params = { Emp_ID: { unmapped: true }, Dept_ID: { unmapped: true }, Type: { constant: 'IPWorkList' }, __RequestVerificationToken: { token: true } };
  const wide = widenRequest(entry, params);
  assert.ok(wide);
  const q = new URL(wide.url).searchParams;
  assert.equal(q.get('Emp_ID'), '', 'an untraceable filter is emptied');
  assert.equal(q.get('Dept_ID'), '');
  assert.equal(q.get('Type'), 'IPWorkList', 'a mode constant is kept');
  assert.equal(q.get('__RequestVerificationToken'), 'abc', 'the token is kept');

  // A patient-scoped request is NEVER widened: that would read every patient's labs.
  const labs = { method: 'POST', url: HOST + '/Lab/Home/GetSearchPatientId', body: '__RequestVerificationToken=abc&patient_id=MR900001&DeptID=', reqCt: 'application/x-www-form-urlencoded' };
  assert.equal(widenRequest(labs, { patient_id: { from: 'worklist', field: 'MRNo' }, __RequestVerificationToken: { token: true }, DeptID: { empty: true } }), null, 'nothing untraceable and filled: no widening');
  const scoped = { method: 'GET', url: HOST + '/Lab/Home/Get?patient_id=MR900001', body: null, reqCt: '' };
  assert.equal(widenRequest(scoped, { patient_id: { from: 'worklist', field: 'MRNo' } }), null, 'a row-traced id is never emptied');
});

test('the ward list is saved in the form that returns every in-patient, not the doctor filtered one', async () => {
  const MINE = JSON.stringify([{ patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' }]);
  const ALL = JSON.stringify([
    { patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' },
    { patientId: 'MR3', patientFirstName: 'CHARLIE', bedName: 'B3' }, { patientId: 'MR4', patientFirstName: 'DELTA', bedName: 'B4' },
  ]);
  const filtered = HOST + '/Doctor/Home/GetIPWL?Emp_ID=4471&Type=IPWorkList';
  const entries = [{ seq: 61, method: 'GET', url: filtered, body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['patientId'], rows: 2 } }];
  const answers = { 61: { status: 200, contentType: 'application/json', text: MINE } };
  const page = {
    executed: [],
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['MR1', 'ALPHA', 'B1'], ['MR2', 'BRAVO', 'B2']]) };
      if (expression.includes('PROVE_EXEC_REQ')) {
        // the widened replay: filters emptied, Type kept
        const m = /"url":"([^"]+)"/.exec(expression);
        page.executed.push(m && m[1]);
        return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: /Emp_ID=&/.test(m[1]) || /Emp_ID=$/.test(m[1]) ? ALL : MINE }) };
      }
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify(answers[61]) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'] };
  await proveView({ client: page, view });
  assert.equal(view.proof.status, 'proven');
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.match(data.path, /Type=IPWorkList/, 'the mode constant is saved');
  assert.deepEqual(data.params.Emp_ID, { empty: true }, 'the doctor filter is saved EMPTY, so every in-patient comes back');
  assert.equal(view.proof.population, 4, 'the saved request is the one that returned more rows in the fixture');
});

test('widening never touches a patient-scoped call, even when tracing failed completely', async () => {
  // parents: [] is the real GHIS case: the worklist proof failed, so nothing can be traced.
  const MINE = JSON.stringify([{ test: 'Haemoglobin', value: '11.2' }]);
  const ALL = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ test: 'Haemoglobin', value: '11.' + i })));
  const entries = [{ seq: 71, method: 'GET', url: HOST + '/Lab/Home/GetSearchPatientId?patient_id=MR900001&DeptID=', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['test'], rows: 1 } }];
  let widened = null;
  const page = {
    async currentUrl() { return { url: HOST + '/Lab/Home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['Haemoglobin', '11.2']]) };
      if (expression.includes('PROVE_EXEC_REQ')) { widened = expression; return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: ALL }) }; }
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: MINE }) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'labs', pathTemplate: HOST + '/Lab/Home', rowsSelector: 'tr', headers: ['Test', 'Value'] };
  await proveView({ client: page, view, parents: [] });
  assert.equal(widened, null, 'a patient-scoped resource is never widened: the whole hospital is never fetched');
  const p = (view.endpoints.find((e) => e.role === 'data') || {}).params || {};
  assert.notDeepEqual(p.patient_id, { empty: true }, 'the patient id is never saved as empty');
});

test('widenRequest refuses a patient-keyed parameter even when tracing failed', () => {
  const entry = { method: 'GET', url: HOST + '/Doctor/Home/GetIPWL?PatientId=MR900001&Emp_ID=4471&Type=IPWorkList', body: null, reqCt: '' };
  const params = { PatientId: { unmapped: true }, Emp_ID: { unmapped: true }, Type: { constant: 'IPWorkList' } };
  const q = new URL(widenRequest(entry, params).url).searchParams;
  assert.equal(q.get('PatientId'), 'MR900001', 'a patient-keyed filter is never emptied, even unmapped');
  assert.equal(q.get('Emp_ID'), '', 'a doctor filter still widens');
});

/* GHIS-SHAPED FIXTURE, NOT A LIVE HOSPITAL. The real in-patient population can only be checked on the
 * owner's phone against the hospital (Task 8); what is proven here is that the widened request is the
 * one SAVED, and that replay sends exactly it: mode constant kept, live page token filled, doctor
 * filter empty. */
test('the widened ward list round-trips: what proof saved is what replay sends', async () => {
  const MINE = JSON.stringify([{ patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' }]);
  const ALL = JSON.stringify([
    { patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' },
    { patientId: 'MR3', patientFirstName: 'CHARLIE', bedName: 'B3' }, { patientId: 'MR4', patientFirstName: 'DELTA', bedName: 'B4' },
  ]);
  const recorded = HOST + '/Doctor/Home/GetIPWL?NursingStationId=&PatientId=&FloorId=&Emp_ID=4471&Dept_ID=1207&Type=IPWorkList&__RequestVerificationToken=abc';
  const entries = [{ seq: 71, method: 'GET', url: recorded, body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['patientId'], rows: 2 } }];
  const page = {
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['MR1', 'ALPHA', 'B1'], ['MR2', 'BRAVO', 'B2']]) };
      if (expression.includes('PROVE_EXEC_REQ')) {
        const m = /"url":"([^"]+)"/.exec(expression);
        return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: /Emp_ID=(&|")/.test(m[1]) ? ALL : MINE }) };
      }
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: MINE }) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'] };
  await proveView({ client: page, view });
  assert.equal(view.proof.status, 'proven');
  assert.equal(view.proof.population, 4, 'the recorded form answered 2, the widened form 4: the widened one is saved');

  // Now the real replay path over exactly what proof saved.
  const sent = [];
  const plugin = {
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: '{"__RequestVerificationToken":"tok9"}' };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      sent.push(req.url);
      return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[{"patientId":"MR1"},{"patientId":"MR2"},{"patientId":"MR3"},{"patientId":"MR4"}]' }) };
    },
  };
  const out = await executeView({ plugin, origin: HOST, view, patient: {} });
  assert.equal(out.rows.length, 4, 'replay returns the whole in-patient population');
  const url = sent.find((u) => /GetIPWL/.test(u));
  assert.match(url, /Type=IPWorkList/, 'the mode constant is replayed');
  assert.match(url, /__RequestVerificationToken=tok9/, 'the live page token is replayed');
  assert.match(url, /Emp_ID=(&|$)/, 'the doctor filter is replayed EMPTY');
});
