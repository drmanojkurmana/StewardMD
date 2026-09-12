// test/connect-agent/adapter-runtime.test.mjs - endpoint replay inside the doctor's browser session:
// authenticated GET and POST from discovered names, tokens from the page, JSON and HTML answers,
// pagination widening, ordered prerequisites, and the login page as a named failure.
//   node --test test/connect-agent/adapter-runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchExpression, parseFetchExpression, fillFields, idCandidates, replayPlan, classifyResponse, rowsFromJson, rowsFromHtml,
  executeView, tokenFor, PAGE_TOKENS, NotSignedIn,
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
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', text: '   ' }), 'empty');
  assert.deepEqual(rowsFromJson({ data: [{ Drug: 'Amoxicillin', dose: { qty: '500', unit: 'mg' } }] }), [{ Drug: 'Amoxicillin', 'dose.qty': '500', 'dose.unit': 'mg' }]);
  assert.deepEqual(rowsFromJson([{ a: 1 }, 'x']), [{ a: '1' }, { value: 'x' }]);
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
