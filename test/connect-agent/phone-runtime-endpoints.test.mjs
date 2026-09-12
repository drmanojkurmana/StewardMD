// test/connect-agent/phone-runtime-endpoints.test.mjs - patient views read through the calls the
// hospital's own pages make (endpoint replay inside the browser session), and ids never stored in paths.
//   node --test test/connect-agent/phone-runtime-endpoints.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPatientDetails, endpointCandidates, fillPath } from '../../connect-agent/phone/runtime.mjs';
import { redactPageUrl } from '../../connect-agent/phone/deep-crawl.mjs';
import { redactPathValues } from '../../functions/api/connect/agent/[[path]].js';

const ORIGIN = 'https://ghis.example';
const patient = { patientId: 'MR25168764', episodeId: 'IPMR260027226' };
// The live GHIS adapter's views, as captured (medications on the shared Doctor Home, labs by recordNo).
const REPLAY = [
  { resourceHint: 'worklist', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#data_tables1 tbody tr', headers: ['Patient ID', 'Visit ID', 'Patient name'] },
  { resourceHint: 'medications', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#accordionEx table.tbl-bordered tbody tr', headers: ['Prod. Code', 'Drug Name', 'Route', 'Dosage', 'Qty', 'Freq'],
    endpoints: [{ method: 'GET', path: '/Doctor/Home' }, { method: 'POST', path: '/Doctor/Home/Searchnew' }, { method: 'GET', path: '/Doctor/Home/CheckSession' }, { method: 'GET', path: '/Doctor/Home/GetMedicines/?id' }] },
  { resourceHint: 'labs', pathTemplate: ORIGIN + '/LabResults/Home?recordNo={id}', rowsSelector: '#datatable1 tbody tr', headers: [] },
];

test('endpointCandidates keeps keyed GET data calls, fills the patient slot, and drops the page shell and session pings', () => {
  assert.deepEqual(endpointCandidates(REPLAY[1], patient), ['/Doctor/Home/GetMedicines/?id=MR25168764', '/Doctor/Home/GetMedicines/?id=IPMR260027226']);
  assert.deepEqual(endpointCandidates({ endpoints: [{ method: 'GET', path: '/x/PatientprofileVisits/?Visitid' }] }, patient), ['/x/PatientprofileVisits/?Visitid=IPMR260027226', '/x/PatientprofileVisits/?Visitid=MR25168764']);
  assert.deepEqual(endpointCandidates({}, patient), []);
});

test('fillPath fills placeholders and an identifier an older capture left in a query', () => {
  assert.equal(fillPath('/LabResults/Home?recordNo={id}', patient), '/LabResults/Home?recordNo=MR25168764');
  assert.equal(fillPath('/LabResults/Home?recordNo=MR2427352', patient), '/LabResults/Home?recordNo=MR25168764');
  assert.equal(fillPath('/Doctor/Home/GetMedicines/?id=#', patient), '/Doctor/Home/GetMedicines/?id=MR25168764');
});

test('redaction: the phone never stores an id in a page url and the server never returns one', () => {
  assert.equal(redactPageUrl('https://ghis.example/LabResults/Home?recordNo=MR2427352'), 'https://ghis.example/LabResults/Home?recordNo={id}');
  assert.equal(redactPageUrl('https://ghis.example/Radio/Home?recordNo=MR25168764&tab=2'), 'https://ghis.example/Radio/Home?recordNo={id}&tab=2');
  assert.equal(redactPageUrl('https://ghis.example/Doctor/Home'), 'https://ghis.example/Doctor/Home');
  assert.equal(redactPathValues('https://ghis.example/Radio/Home?recordNo=MR25168764'), 'https://ghis.example/Radio/Home?recordNo={id}');
});

test('readPatientDetails skips the shared Doctor Home for medications, reads the medicines call with a fallback selector, and reads labs by recordNo', async () => {
  const visited = [];
  const pages = {
    [ORIGIN + '/Doctor/Home/GetMedicines/?id=MR25168764']: { table: [{ 'Prod. Code': 'P1', 'Drug Name': 'Amoxicillin', Route: 'PO', Dosage: '500 mg', Qty: '1', Freq: 'TDS' }] },
    [ORIGIN + '/LabResults/Home?recordNo=MR25168764']: { recorded: [{ 'Test': 'Hb', 'Result': '11' }] },
  };
  let url = ORIGIN + '/Doctor/Home';
  const plugin = {
    async navigate(a) { url = a.url; visited.push(a.url); },
    async currentUrl() { return { url }; },
    async evaluate({ expression }) {
      if (expression.indexOf('password') >= 0 && expression.indexOf('READ_ROWS') < 0) return { result: 'ok' };
      if (expression.indexOf('_length') >= 0 && expression.indexOf('READ_ROWS') < 0) return { result: '0' };
      const page = pages[url] || {};
      if (/"rowsSelector":"table tbody tr"/.test(expression)) return { result: JSON.stringify(page.table || []) };
      if (/"rowsSelector":"#datatable1 tbody tr"/.test(expression)) return { result: JSON.stringify(page.recorded || []) };
      return { result: '[]' };
    },
  };
  const sections = await readPatientDetails({ plugin, origin: ORIGIN, replay: REPLAY, patient, settleMs: 0, maxWaitMs: 5 });
  const meds = sections.find((s) => s.resource === 'medications');
  assert.equal(meds.rows[0]['Drug Name'], 'Amoxicillin');
  assert.ok(!visited.includes(ORIGIN + '/Doctor/Home'), 'the shared worklist page was not re-read for medications');
  assert.ok(visited.includes(ORIGIN + '/Doctor/Home/GetMedicines/?id=MR25168764'));
  const labs = sections.find((s) => s.resource === 'labs');
  assert.equal(labs.rows[0].Test, 'Hb');
  assert.ok(visited.includes(ORIGIN + '/LabResults/Home?recordNo=MR25168764'));
});
