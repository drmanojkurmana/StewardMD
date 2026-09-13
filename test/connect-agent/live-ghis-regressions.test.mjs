// test/connect-agent/live-ghis-regressions.test.mjs - the failures of the live GHIS run on the Pixel,
// 2026-09-13, each pinned: mode constants in a call, the ward list's page-load call, non-patient rows.
//   node --test test/connect-agent/live-ghis-regressions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactEndpoints, keyWithConstant, stripConstants, mergeEndpointDetails } from '../../connect-agent/phone/deep-crawl.mjs';
import { replayPlan, parseFetchExpression, PAGE_TOKENS } from '../../connect-agent/phone/adapter-runtime.mjs';
import { learnPageLoadCalls } from '../../connect-agent/phone/verify.mjs';
import { readWorklist } from '../../connect-agent/phone/runtime.mjs';

const O = 'https://ghis.example';
const IPWL = O + '/Doctor/Home/GetIPWL?NursingStationId=&PatientId=&FloorId=&Emp_ID=&Dept_ID=&Type=IPWorkList&__RequestVerificationToken=abcSECRETtoken';

test('a mode constant survives redaction, an id or token value never does', () => {
  const [ep] = redactEndpoints([{ method: 'GET', url: IPWL }], O + '/Doctor/Home');
  assert.equal(ep.path, '/Doctor/Home/GetIPWL?NursingStationId&PatientId&FloorId&Emp_ID&Dept_ID&Type=IPWorkList&__RequestVerificationToken');
  assert.equal(keyWithConstant('patient', 'RAVI'), 'patient', 'a name in a non-mode key is dropped');
  assert.equal(keyWithConstant('type', 'MR25168764'), 'type', 'digits are never a constant');
  assert.equal(stripConstants(ep.path), '/Doctor/Home/GetIPWL?NursingStationId&PatientId&FloorId&Emp_ID&Dept_ID&Type&__RequestVerificationToken');
  const merged = mergeEndpointDetails([ep], [{ method: 'GET', path: '/Doctor/Home/GetIPWL', queryKeys: ['NursingStationId', 'PatientId', 'FloorId', 'Emp_ID', 'Dept_ID', 'Type', '__RequestVerificationToken'], xhr: true }]);
  assert.equal(merged[0].xhr, true, 'observer details still merge onto a path that carries a constant');
});

test('the GetIPWL replay sends the constant, the page token, and empty filters', () => {
  const plan = replayPlan({ endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?NursingStationId&PatientId&FloorId&Emp_ID&Dept_ID&Type=IPWorkList&__RequestVerificationToken' }] }, {}, { __RequestVerificationToken: 'tok' });
  assert.deepEqual(plan.calls.map((c) => c.url), ['/Doctor/Home/GetIPWL?NursingStationId=&PatientId=&FloorId=&Emp_ID=&Dept_ID=&Type=IPWorkList&__RequestVerificationToken=tok']);
});

function hospital({ onLoadCall = true } = {}) {
  let url = O + '/Doctor/Home';
  let log = [];
  const plugin = {
    async navigate(a) { url = a.url; if (onLoadCall && /\/Doctor\/Home$/.test(url)) log.push({ method: 'GET', url: IPWL }); },
    async currentUrl() { return { url }; },
    async drainRequests() { const r = log; log = []; return { requests: r }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify({ __RequestVerificationToken: 'tok' }) };
      const req = parseFetchExpression(expression);
      if (req) {
        const ok = /GetIPWL\?.*Type=IPWorkList.*__RequestVerificationToken=tok/.test(req.url);
        const doctors = /DashboardUnit/.test(req.url);
        const text = ok ? JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', episodeId: 'V1' }]) : doctors ? JSON.stringify([{ Doctor: 'Dr Rao', Unit: 'Medicine' }]) : '';
        return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text }) };
      }
      return { result: '[]' };
    },
  };
  return plugin;
}

test('verification learns the ward list call its page makes on load, then the worklist reads through it', async () => {
  const plugin = hospital();
  const view = { resourceHint: 'worklist', pathTemplate: O + '/Doctor/Home', rowsSelector: '#data_tables1 tbody tr', headers: ['Patient ID', 'Patient name'], endpoints: [{ method: 'GET', path: '/Doctor/Home/DashboardUnit?type&sdate&checkbox' }] };
  await learnPageLoadCalls({ plugin, origin: O, view, waitMs: 5 });
  assert.ok(view.endpoints.some((e) => /GetIPWL\?.*Type=IPWorkList/.test(e.path)), JSON.stringify(view.endpoints));
  const via = [];
  const patients = await readWorklist({ plugin, origin: O, replay: [view], settleMs: 0, maxWaitMs: 5, onRead: (r) => via.push(r.via) });
  assert.equal(patients.length, 1);
  assert.equal(patients[0].patientId, 'MR1');
  assert.deepEqual(via, ['endpoint']);
});

test('a call that answers doctors, not patients, is not taken as the ward list', async () => {
  const plugin = hospital({ onLoadCall: false });
  const view = { resourceHint: 'worklist', pathTemplate: O + '/Doctor/Home', rowsSelector: '#data_tables1 tbody tr', headers: ['Patient ID', 'Patient name'], endpoints: [{ method: 'GET', path: '/Doctor/Home/DashboardUnit?type&sdate&checkbox' }] };
  await assert.rejects(readWorklist({ plugin, origin: O, replay: [view], settleMs: 0, maxWaitMs: 5 }), /no patient rows found/);
});
