// test/connect-agent/adapter-runtime.test.mjs - endpoint replay inside the doctor's browser session:
// authenticated GET and POST from discovered names, tokens from the page, JSON and HTML answers,
// pagination widening, ordered prerequisites, and the login page as a named failure.
//   node --test test/connect-agent/adapter-runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchExpression, parseFetchExpression, fillFields, idCandidates, replayPlan, classifyResponse, rowsFromJson, rowsFromHtml,
  executeView, tokenFor, PAGE_TOKENS, NotSignedIn, FETCH_TIMEOUT_MS,
  provenValue, unscopedField, executeProven, UnscopedRequest,
} from '../../connect-agent/phone/adapter-runtime.mjs';

const ORIGIN = 'https://ghis.example';
const patient = { patientId: 'MR25168764', episodeId: 'IPMR260027226' };

// A tiny HTML parser good enough for READ_ROWS: tables with tr/td/th, one level, no nesting.
function miniParse(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const cells = [];
    const cellRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(m[1]))) cells.push({ tag: c[1].toLowerCase(), textContent: c[2].replace(/<[^>]+>/g, '') });
    rows.push({ cells, tds: cells.filter((x) => x.tag === 'td') });
  }
  const mk = (r) => ({
    querySelectorAll: (sel) => (sel === 'td' ? r.tds : sel === 'th' ? [] : []),
    querySelector: () => null,
    textContent: r.cells.map((x) => x.textContent).join(' '),
  });
  return {
    querySelectorAll: (sel) => (/tr/.test(sel) ? rows.map(mk) : (sel === 'th' ? [] : [])),
    querySelector: () => null,
  };
}

// The fake hospital page: answers fetch expressions by url and method, like GHIS would.
function fakePlugin(routes, tokens = { __RequestVerificationToken: 'tok123' }) {
  const calls = [];
  return {
    calls,
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify(tokens) };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      calls.push(req);
      const key = req.method + ' ' + req.url.replace(ORIGIN, '');
      const r = routes(key, req);
      return { result: JSON.stringify(Object.assign({ status: 200, contentType: 'text/html', url: req.url, text: '' }, r || { status: 404 })) };
    },
  };
}

test('fetchExpression carries method, url, credentials and the form body; the seam reads it back', () => {
  const e = fetchExpression({ method: 'POST', url: ORIGIN + '/Doctor/Home/Searchnew', body: 'a=1&recordNo=MR1' });
  assert.match(e, /credentials:"include"/);
  assert.match(e, /X-Requested-With/);
  assert.deepEqual(parseFetchExpression(e).body, 'a=1&recordNo=MR1');
  assert.equal(parseFetchExpression(e).method, 'POST');
});

test('fillFields: tokens from the page, hospital numbers and visit ids from the patient, in that order of preference', () => {
  assert.deepEqual(idCandidates('recordNo', patient), ['MR25168764', 'MR25168764-IPMR260027226', 'IPMR260027226']);
  assert.deepEqual(idCandidates('Visitid', patient), ['IPMR260027226', 'MR25168764']);
  assert.deepEqual(idCandidates('id', patient), ['MR25168764', 'IPMR260027226']);
  assert.deepEqual(idCandidates('sort', patient), []);
  assert.deepEqual(fillFields(['__RequestVerificationToken', 'recordNo'], { patient, tokens: { __RequestVerificationToken: 'tok123' } }), { __RequestVerificationToken: 'tok123', recordNo: 'MR25168764' });
  assert.equal(tokenFor('csrf_token', { __RequestVerificationToken: 'x' }), 'x', 'a lone token serves any token-like field');
});

test('replayPlan orders POST prerequisites before keyed data GETs, widens pagination, and drops pings and the page shell', () => {
  const view = { endpoints: [
    { method: 'GET', path: '/Doctor/Home' }, { method: 'POST', path: '/Doctor/Home/Searchnew', bodyKeys: ['__RequestVerificationToken', 'recordNo'], requestKind: 'form' },
    { method: 'GET', path: '/Doctor/Home/CheckSession' }, { method: 'GET', path: '/Doctor/Home/GetMedicines/?id' },
    { method: 'GET', path: '/Doctor/Home/GetIPWL?draw&start&length' },
  ] };
  const plan = replayPlan(view, patient);
  assert.equal(plan.prerequisites.length, 1);
  assert.equal(plan.prerequisites[0].path, '/Doctor/Home/Searchnew');
  assert.deepEqual(plan.calls.map((c) => c.url), ['/Doctor/Home/GetMedicines/?id=MR25168764', '/Doctor/Home/GetMedicines/?id=IPMR260027226', '/Doctor/Home/GetIPWL?draw=&start=0&length=1000']);
  assert.deepEqual(replayPlan({ endpoints: [] }, patient).calls, []);
});

test('responses: login page and 401 are login; JSON lists and HTML tables become rows', () => {
  assert.equal(classifyResponse({ status: 401, text: '' }), 'login');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', text: '<form><input type="password" name="p"></form>', url: ORIGIN + '/Login' }), 'login');
  assert.equal(classifyResponse({ status: 200, contentType: 'application/json', text: '[]' }), 'json');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', text: '{"data":[{"a":1}]}' }), 'json');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', text: '"[{\\"ServiceRenderId\\":123}]"' }), 'json', 'double-encoded JSON is classified as json');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', text: '   ' }), 'empty');
  assert.deepEqual(rowsFromJson({ data: [{ Drug: 'Amoxicillin', dose: { qty: '500', unit: 'mg' } }] }), [{ Drug: 'Amoxicillin', 'dose.qty': '500', 'dose.unit': 'mg' }]);
  assert.deepEqual(rowsFromJson([{ a: 1 }, 'x']), [{ a: '1' }, { value: 'x' }]);
  assert.deepEqual(rowsFromJson('[{"ServiceRenderId":123,"parameter_long_desc":"CBP"}]'), [{ ServiceRenderId: '123', parameter_long_desc: 'CBP' }], 'stringified JSON array parses cleanly');
  const rows = rowsFromHtml('<table><tr><th>Drug</th><th>Dose</th></tr><tr><td>Amoxicillin</td><td>500 mg</td></tr></table>', { rowsSelector: '#accordionEx table tbody tr', headers: ['Drug', 'Dose'] }, miniParse);
  assert.deepEqual(rows, [{ Drug: 'Amoxicillin', Dose: '500 mg' }], 'the view selector missed the bare fragment, any table row was read with the view headers');
});

test('executeView replays GHIS style: activation POST with the page token, then the medicines call, answered as an HTML fragment', async () => {
  const seen = [];
  const plugin = fakePlugin((key, req) => {
    seen.push(key);
    if (key === 'POST /Doctor/Home/Searchnew') { assert.equal(req.body, '__RequestVerificationToken=tok123&recordNo=MR25168764'); return { text: 'ok' }; }
    if (key === 'GET /Doctor/Home/GetMedicines/?id=MR25168764') return { text: '<div><table><tr><td>P1</td><td>Amoxicillin</td></tr></table></div>' };
    return { status: 404 };
  });
  const view = { resourceHint: 'medications', rowsSelector: '#accordionEx table.tbl-bordered tbody tr', headers: ['Prod. Code', 'Drug Name'],
    endpoints: [{ method: 'POST', path: '/Doctor/Home/Searchnew', bodyKeys: ['__RequestVerificationToken', 'recordNo'], requestKind: 'form' }, { method: 'GET', path: '/Doctor/Home/CheckSession' }, { method: 'GET', path: '/Doctor/Home/GetMedicines/?id' }] };
  const out = await executeView({ plugin, origin: ORIGIN, view, patient, parseHtml: miniParse });
  assert.equal(out.via, 'endpoint');
  assert.deepEqual(out.rows, [{ 'Prod. Code': 'P1', 'Drug Name': 'Amoxicillin' }]);
  assert.deepEqual(seen.slice(0, 2), ['POST /Doctor/Home/Searchnew', 'GET /Doctor/Home/GetMedicines/?id=MR25168764'], 'activation first, then the data call');
  assert.ok(!seen.some((k) => /CheckSession/.test(k)), 'session pings are never replayed');
});

test('executeView tries the joined record-visit form when the first activation yields nothing, and names a login page', async () => {
  let activated = '';
  const plugin = fakePlugin((key, req) => {
    if (key === 'POST /x/activate') { activated = /recordNo=([^&]*)/.exec(req.body)[1]; return { text: 'ok' }; }
    if (key.startsWith('GET /x/labs?recordNo=')) return activated === 'MR25168764-IPMR260027226' ? { contentType: 'application/json', text: '[{"Test":"Hb","Result":"11"}]' } : { text: '' };
    return { status: 404 };
  });
  const view = { resourceHint: 'labs', headers: [], endpoints: [{ method: 'POST', path: '/x/activate', bodyKeys: ['__RequestVerificationToken', 'recordNo'] }, { method: 'GET', path: '/x/labs?recordNo' }] };
  const out = await executeView({ plugin, origin: ORIGIN, view, patient, parseHtml: miniParse });
  assert.equal(activated, 'MR25168764-IPMR260027226');
  assert.deepEqual(out.rows, [{ Test: 'Hb', Result: '11' }]);
  assert.equal(out.kind, 'json');

  const expired = fakePlugin(() => ({ status: 200, url: ORIGIN + '/Login', text: '<form><input type="password"></form>' }));
  await assert.rejects(executeView({ plugin: expired, origin: ORIGIN, view: { endpoints: [{ method: 'GET', path: '/x/labs?recordNo' }] }, patient, parseHtml: miniParse }), (e) => e instanceof NotSignedIn && /login page/.test(e.message));
  assert.equal(await executeView({ plugin, origin: ORIGIN, view: { endpoints: [] }, patient }), null, 'no replayable call: the caller falls back to the page');
});

test('every in-page request has its own deadline: a hospital that never answers is aborted', async () => {
  assert.equal(parseFetchExpression(fetchExpression({ method: 'GET', url: 'https://h/x' })).timeoutMs, FETCH_TIMEOUT_MS);
  const expr = fetchExpression({ method: 'GET', url: 'https://h/x', timeoutMs: 30 });
  assert.equal(parseFetchExpression(expr).timeoutMs, 30);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  try {
    const t0 = Date.now();
    const out = JSON.parse(await new Function('return ' + expr)());
    assert.equal(out.status, 0);
    assert.match(out.error, /aborted/);
    assert.ok(Date.now() - t0 < 2000, 'aborted at its deadline');
  } finally { globalThis.fetch = realFetch; }
});

test('an untraceable patient key is filled from the patient, never sent empty', () => {
  const patient = { patientId: 'MR900001', episodeId: 'IP5550001' };
  assert.equal(provenValue('patient_id', { unmapped: true }, { patient }), 'MR900001', 'a patient key falls back to this patient');
  assert.equal(provenValue('Episode_Id', { unmapped: true }, { patient }), 'IP5550001', 'a visit key falls back to this visit');
  assert.equal(provenValue('DeptID', { unmapped: true }, { patient }), '', 'an ordinary filter is still sent empty');
  assert.equal(provenValue('DeptID', { empty: true }, { patient }), '', 'a proven-empty filter stays empty');
});

test('a request that would go out without the patient is refused, not sent', async () => {
  const patient = { patientId: 'MR900001' };
  assert.equal(unscopedField({ url: '/Lab/Home/Get?patient_id=&DeptID=', body: null }, patient), 'patient_id');
  assert.equal(unscopedField({ url: '/Lab/Home/Get?patient_id=MR900001&DeptID=', body: null }, patient), null);
  assert.equal(unscopedField({ url: '/Lab/Home/Get', body: 'Render_ID=&patient_id=' }, patient), 'patient_id');
  assert.equal(unscopedField({ url: '/Doctor/Home/GetIPWL?PatientId=', body: null }, {}), null, 'the ward list has no patient and is not scoped');

  // executeProven refuses rather than reading whatever the hospital returns for everyone.
  let sent = 0;
  const plugin = { async currentUrl() { return { url: 'https://h/Lab' }; }, async evaluate() { sent += 1; return { result: '{}' }; } };
  const view = { resourceHint: 'labs', pathTemplate: 'https://h/Lab', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Lab/Home/Get?patient_id', role: 'data', params: { patient_id: { empty: true } } }] };
  await assert.rejects(executeProven({ plugin, origin: 'https://h', view, patient }), (e) => e.name === 'UnscopedRequest');
  assert.equal(sent, 0, 'the unscoped request was never issued to the hospital');
});

test('a detail request whose chain key is missing is refused, not sent with an empty id', async () => {
  let sent = 0;
  const plugin = { async currentUrl() { return { url: 'https://h/Lab' }; }, async evaluate() { sent += 1; return { result: '{}' }; } };
  const view = { resourceHint: 'labs-detail', detailOf: 'labs', pathTemplate: 'https://h/Lab', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'proven' },
    endpoints: [{ method: 'POST', path: '/Lab/Home/GetPrintLabResultDetailsAuth', bodyKeys: ['Render_ID', 'Episode_Id'], requestKind: 'form', role: 'data',
      params: { Render_ID: { from: 'labs', field: 'ServiceRenderId' }, Episode_Id: { from: 'labs', field: 'episode_id' } } }] };
  // the parent row is missing ServiceRenderId: the chain is broken
  await assert.rejects(executeProven({ plugin, origin: 'https://h', view, patient: { patientId: 'MR1' }, parentRow: { episode_id: 'IP1' } }), (e) => e.name === 'UnscopedRequest');
  assert.equal(sent, 0, 'a detail request with no render id never reaches the hospital');
  // with the row intact it goes through
  sent = 0;
  const ok = { async currentUrl() { return { url: 'https://h/Lab' }; }, async evaluate() { sent += 1; return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: 'x', text: '[]' }) }; } };
  await executeProven({ plugin: ok, origin: 'https://h', view, patient: { patientId: 'MR1' }, parentRow: { ServiceRenderId: 'R1', episode_id: 'IP1' } });
  assert.ok(sent > 0, 'a complete chain is still sent');
});

/* Two proven ward lists (GHIS): the proof traced labs' id to the HTML list's "Patient ID" header, but
 * the runtime reads rows from the hospital-wide JSON list keyed patientId. The row is still this
 * patient's, so a patient-keyed field falls back to the patient's own id instead of going out blank
 * (owner's iPhone drawer: "never learned which field carries the patient", 2026-09-17). */
test('provenValue: a worklist column name from another proven list falls back to the patient id', () => {
  const patient = { patientId: 'MR900001' };
  Object.defineProperty(patient, '_row', { value: { patientId: 'MR900001', patientFirstName: 'X' }, enumerable: false });
  assert.equal(provenValue('id', { from: 'worklist', field: 'Patient ID' }, { patient }), 'MR900001');
  assert.equal(provenValue('id', { from: 'worklist', field: 'patientId' }, { patient }), 'MR900001', 'a matching key is read from the row');
  assert.equal(provenValue('Dept_ID', { from: 'worklist', field: 'Department' }, { patient }), '', 'a non-patient key with no such column stays blank');
});

/* An expired GHIS session answers a 302 to the login host; following it cross-origin gave the bare
 * "Load failed" for every read (owner's iPhone, 2026-09-17). The page-side fetch no longer follows,
 * reports the redirect as status 302, and the runtime reads that as the login page. */
test('fetchExpression: a redirect is reported as the login page, never followed cross-origin', () => {
  const expr = fetchExpression({ method: 'GET', url: 'https://ghis.example/Doctor/Home/GetMedicines/?id=MR1' });
  assert.ok(expr.includes('redirect:"manual"'), 'redirects must not be followed');
  assert.ok(expr.includes('opaqueredirect'), 'an opaque redirect must be turned into a status');
  assert.ok(parseFetchExpression(expr), 'the test seam still parses the request out');
  assert.equal(classifyResponse({ status: 302, redirected: true, text: '' }), 'login');
  assert.equal(classifyResponse({ status: 200, contentType: 'application/json', text: '[]' }), 'json');
});

/* A joined worklist field (GHIS recordNo = "Patient ID"-"Visit ID") was traced against the doctor's own
 * HTML list; the hospital-wide JSON list has no such columns and the patient read carries no list row
 * at all. Each part falls back to the id the patient carries, as a single field already does. */
test('provenValue: a joined worklist field falls back to the patient ids when the row lacks the columns', () => {
  const src = { from: 'worklist', fields: ['Patient ID', 'Visit ID'], join: '-' };
  assert.equal(provenValue('recordNo', src, { patient: { patientId: 'K1', episodeId: 'E1' } }), 'K1-E1');
  const p2 = { patientId: 'K1', episodeId: 'E1' };
  Object.defineProperty(p2, '_row', { value: { patientId: 'K1', episodeId: 'E1' }, enumerable: false });
  assert.equal(provenValue('recordNo', src, { patient: p2 }), 'K1-E1');
  const p3 = { patientId: 'K1', episodeId: 'E1' };
  Object.defineProperty(p3, '_row', { value: { 'Patient ID': 'P9', 'Visit ID': 'V9' }, enumerable: false });
  assert.equal(provenValue('recordNo', src, { patient: p3 }), 'P9-V9', 'a row that carries the columns wins');
});
