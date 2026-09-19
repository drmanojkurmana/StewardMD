// test/connect-agent/verify.test.mjs - the adapter is proven against real patients before approval.
//   node --test test/connect-agent/verify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyViews, judge, columnsOf, localVerdict } from '../../connect-agent/phone/verify.mjs';
import { parseFetchExpression, PAGE_TOKENS } from '../../connect-agent/phone/adapter-runtime.mjs';
import { phiGate, shapeAnswer } from '../../functions/_connect/agent/brain.js';

// Node has no DOMParser: a tiny table parser stands in for it (same shape as the runtime test's).
function miniParse(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while ((m = trRe.exec(html))) { const cells = []; const cellRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi; let c; while ((c = cellRe.exec(m[1]))) cells.push({ tag: c[1].toLowerCase(), textContent: c[2].replace(/<[^>]+>/g, '') }); rows.push({ cells, tds: cells.filter((x) => x.tag === 'td') }); }
  const mk = (r) => ({ querySelectorAll: (sel) => (sel === 'td' ? r.tds : []), querySelector: () => null, getAttribute: () => '', textContent: r.cells.map((x) => x.textContent).join(' ') });
  return { querySelectorAll: (sel) => (/tr/.test(sel) ? rows.map(mk) : []), querySelector: () => null };
}

const ORIGIN = 'https://ghis.example';

// A hospital whose worklist and medications calls answer; radiology's call answers a doctor list.
function fakePlugin() {
  const asked = [];
  return {
    asked,
    async navigate() {}, async wait() {},
    async currentUrl() { return { url: ORIGIN + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify({ __RequestVerificationToken: 't' }) };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      asked.push(req.method + ' ' + req.url.replace(ORIGIN, ''));
      const reply = (o) => ({ result: JSON.stringify(Object.assign({ status: 200, contentType: 'application/json', url: req.url }, o)) });
      if (req.url.indexOf('/GetIPWL') >= 0) return reply({ text: JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', episodeId: 'V1', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'B', episodeId: 'V2', bedName: 'B2' }]) });
      if (req.url.indexOf('/GetMedicines/?id=MR1') >= 0) return reply({ contentType: 'text/html', text: '<table><tr><td>P1</td><td>Amoxicillin</td><td>500 mg</td></tr></table>' });
      if (req.url.indexOf('/Doctors?dept=') >= 0) return reply({ text: JSON.stringify([{ doctorName: 'Dr Rao', department: 'Medicine' }]) });
      return reply({ text: '' });
    },
  };
}

const VIEWS = () => ([
  { resourceHint: 'worklist', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['Patient ID', 'Patient name'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type&start&length' }] },
  { resourceHint: 'medications', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#rx tr', headers: ['Prod. Code', 'Drug Name', 'Dosage'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetMedicines/?id' }] },
  { resourceHint: 'radiology', pathTemplate: ORIGIN + '/Radio/Home', rowsSelector: '#r tr', headers: ['Doctor', 'Department'], endpoints: [{ method: 'GET', path: '/Radio/Home/Doctors?dept' }] },
  { resourceHint: 'labs', pathTemplate: ORIGIN + '/LabResults/Home?recordNo={id}', rowsSelector: '#datatable1 tbody tr', headers: [] },
]);

test('verifyViews reads the ward through the adapter, replays each view for real patients, records the outcome, and names what failed', async () => {
  const plugin = fakePlugin();
  const views = VIEWS();
  const brain = { verify: async (p) => {
    assert.ok(!JSON.stringify(p).includes('Amoxicillin') && !JSON.stringify(p).includes('MR1'), 'the brain sees structure only');
    if (p.resource === 'radiology') return { ok: false, resource: 'none', confidence: 0.9, reason: 'these columns are a doctor list', suggestion: 'ask-doctor' };
    return { ok: true, resource: p.resource, confidence: 0.9, reason: 'looks right', suggestion: 'ok' };
  } };
  const phases = [];
  const out = await verifyViews({ plugin, origin: ORIGIN, views, brain, parseHtml: miniParse, notify: (phase, extra) => phases.push(extra.checking) });
  assert.equal(out.patients.length, 2);
  assert.deepEqual(out.failed, ['radiology']);
  const by = Object.fromEntries(out.checks.map((c) => [c.resource, c]));
  assert.equal(by.worklist.ok, true); assert.equal(by.worklist.rows, 2); assert.equal(by.worklist.via, 'endpoint');
  assert.equal(by.medications.ok, true); assert.equal(by.medications.rows, 1); assert.equal(by.medications.via, 'endpoint');
  assert.equal(by.radiology.ok, false); assert.match(by.radiology.reason, /doctor list/);
  assert.equal(views[1].verified.ok, true, 'the outcome travels with the view');
  assert.equal(views[3].verified.via, 'none', 'a view without a discovered call is read from its page later, not failed');
  assert.ok(!views[3].verified.ok && !out.failed.includes('labs'), 'no call, no failure: the page path remains');
  assert.ok(plugin.asked.some((k) => k.startsWith('GET /Doctor/Home/GetMedicines/?id=MR1')), 'each patient view was replayed for the first real patient');
  assert.ok(phases.includes('medications') && phases.includes('worklist'));
});

test('without a brain the local verdict passes rows and fails empties; columns are PHI-free', async () => {
  assert.equal((await judge({ brain: null, resource: 'labs', rows: [{ Test: 'Hb' }], kind: 'json' })).ok, true);
  assert.equal(localVerdict('labs', [], 'json').suggestion, 'ask-doctor');
  assert.deepEqual(columnsOf([{ 'Patient ID': 'x', _href: '/p/1', 'Bed 101': 'y' }]), ['Patient ID', 'Bed #']);
});

test('the brain verify op passes the gate with counts and columns only, and its answer is clamped', () => {
  const g = phiGate({ op: 'verify', origin: ORIGIN, resource: 'medications', headers: ['Drug Name', 'Dosage'], rowCount: 4, kind: 'html', path: '/Doctor/Home/GetMedicines/' });
  assert.equal(g.ok, true, g.reason);
  assert.equal(phiGate({ op: 'verify', origin: ORIGIN, resource: 'medications', headers: ['MR123456'], rowCount: 1 }).ok, false);
  assert.equal(phiGate({ op: 'verify', origin: ORIGIN, resource: 'medications', headers: ['Drug'], rowCount: 'lots' }).ok, false);
  assert.deepEqual(shapeAnswer(g.clean, { ok: true, resource: 'medications', confidence: 0.8, reason: 'drugs with doses', suggestion: 'ok' }), { ok: true, resource: 'medications', confidence: 0.8, reason: 'drugs with doses', suggestion: 'ok' });
  assert.equal(shapeAnswer(g.clean, { ok: 'yes', suggestion: 'delete' }).ok, false);
  assert.equal(shapeAnswer(g.clean, { ok: false, suggestion: 'delete' }).suggestion, 'ask-doctor');
});

/* VERIFIED ON A REAL PATIENT, OR NOT PROVEN. A proven call that answers no rows for every real patient
 * checked loses its proof, so the approval gate refuses it and the doctor is asked again (GHIS's lab
 * print shell was approved as labs and read empty for every patient, 2026-09-17). */
test('verifyViews withdraws the proof of a call that answers no rows for every real patient', async () => {
  const plugin = fakePlugin();
  const views = VIEWS();
  const shell = { resourceHint: 'labs', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#divLabSaveResult table tbody tr', headers: ['TEST NAME', 'RESULTS'], proof: { status: 'proven', kind: 'html', hits: 3, cells: 3, overlap: 1 }, endpoints: [{ method: 'GET', path: '/Doctor/Home/OTLabPrintsSecretary/?id', role: 'data', params: { id: { from: 'worklist', field: 'patientId' } } }] };
  views[3] = shell;
  const out = await verifyViews({ plugin, origin: ORIGIN, views, parseHtml: miniParse });
  assert.ok(out.failed.includes('labs'));
  assert.equal(shell.proof.status, 'no-rows');
  assert.equal(shell.proof.wasProven, true);
  assert.equal(views[1].proof, undefined, 'a view that verified with rows is untouched');
});


/* AN EMPTY LIST IS NOT A BROKEN CALL. Most inpatients have no scans: on the owner's live ward only one
 * of seven had a radiology study. Verification sampled the first two patients, both answered an honest
 * empty list, and the agent withdrew the proof of a perfectly good endpoint - "radiology: not proven
 * (no rows came back)", which then left radiology-detail with no row to open and blocked approval
 * (live GHIS run 3, 2026-09-18). It must keep looking down the ward before condemning the call. */
test('verifyViews keeps looking for a patient who has one when the first patients have an empty list', async () => {
  const WARD = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ patientId: 'MR' + n, patientFirstName: 'P' + n, episodeId: 'V' + n, bedName: 'B' + n }));
  const tried = [];
  const plugin = {
    async navigate() {}, async wait() {},
    async currentUrl() { return { url: ORIGIN + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify({ __RequestVerificationToken: 't' }) };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      const reply = (o) => ({ result: JSON.stringify(Object.assign({ status: 200, contentType: 'application/json', url: req.url }, o)) });
      if (req.url.indexOf('/GetIPWL') >= 0) return reply({ text: JSON.stringify(WARD) });
      const who = (req.url.match(/recordNo=(MR\d+)/) || [])[1];
      if (who) {
        tried.push(who);
        // only the sixth patient on the ward has had a scan; everyone else gets a well-formed empty list
        const rows = who === 'MR6' ? '<tr><td>21710420</td><td>17-Dec-2024</td><td>MRI BRAIN PLAIN</td></tr>' : '';
        return reply({ contentType: 'text/html', text: '<table><tr><th>Service ID</th><th>Date</th><th>Description</th></tr>' + rows + '</table>' });
      }
      return reply({ text: '' });
    },
  };
  const views = [
    { resourceHint: 'worklist', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['Patient ID', 'Patient name'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type&start&length' }] },
    { resourceHint: 'radiology', pathTemplate: ORIGIN + '/Radio/Home', rowsSelector: '#r tr', headers: ['Service ID', 'Date', 'Description'], proof: { status: 'proven' },
      endpoints: [{ method: 'GET', path: '/Radio/Home?recordNo', params: { recordNo: { from: 'worklist', field: 'patientId' } } }] },
  ];
  const brain = { verify: async (p) => ({ ok: true, resource: p.resource, confidence: 0.9, reason: 'looks right', suggestion: 'ok' }) };
  const out = await verifyViews({ plugin, origin: ORIGIN, views, brain, parseHtml: miniParse });
  const by = Object.fromEntries(out.checks.map((c) => [c.resource, c]));
  assert.ok(tried.length > 2, 'more than the first two patients were tried: ' + tried.join(','));
  assert.equal(by.radiology.ok, true, 'the endpoint is verified once a patient with a scan is found: ' + by.radiology.reason);
  assert.equal(by.radiology.rows, 1);
  assert.ok(!out.failed.includes('radiology'), 'a correct call is not condemned by patients who have no scans');
  assert.equal(views[1].proof.status, 'proven', 'its proof stands');
});


/* A LIST THE DOCTOR SHOWED STILL NEEDS ITS DETAIL. The chain was explored only for a list the agent had
 * found by searching for the patient itself (view.searched). On the live ward the doctor showed the lab
 * list during the guided ask, so searched was never set, no chain was ever attempted and the run
 * finished with no labs-detail at all - which the approval gate requires (live GHIS run 3, 2026-09-18).
 * Being shown a screen is not a reason to skip learning what opening a row does. */
test('verifyViews explores the detail chain for a list the doctor showed, not only one it searched for', async () => {
  const plugin = {
    async navigate() {}, async wait() {},
    async currentUrl() { return { url: ORIGIN + '/Lab/Home' }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify({ __RequestVerificationToken: 't' }) };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      const reply = (o) => ({ result: JSON.stringify(Object.assign({ status: 200, contentType: 'application/json', url: req.url }, o)) });
      if (req.url.indexOf('/GetIPWL') >= 0) return reply({ text: JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', episodeId: 'V1' }]) });
      if (req.url.indexOf('/GetSearchPatientId') >= 0) {
        return reply({ contentType: 'text/html', text: '<table><tr><th>Order ID</th><th>Test</th></tr><tr><td>OR1</td><td>CBC</td></tr></table>' });
      }
      return reply({ text: '' });
    },
  };
  const labs = {
    resourceHint: 'labs', pathTemplate: ORIGIN + '/Lab/Home', rowsSelector: '#example15 tbody tr',
    headers: ['Order ID', 'Test'], proof: { status: 'proven' },
    // the doctor walked here during the guided ask; the agent never had to search
    guidedPath: ['a "Lab reports"', 'td "CBC"'],
    endpoints: [{ method: 'POST', path: '/Lab/Home/GetSearchPatientId', role: 'data', bodyKeys: ['patient_id'], params: { patient_id: { from: 'worklist', field: 'patientId' } } }],
  };
  const views = [
    { resourceHint: 'worklist', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['Patient ID'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type&start&length' }] },
    labs,
  ];
  const book = { prove: async () => null, note: () => {} };
  const brain = { verify: async (p) => ({ ok: true, resource: p.resource, confidence: 0.9, reason: 'looks right', suggestion: 'ok' }) };
  await verifyViews({ plugin, origin: ORIGIN, views, brain, book, parseHtml: miniParse });
  assert.ok(labs.chain, 'the chain was attempted for the list the doctor showed');
});


/* SILENCE WAS THE BUG. Run 6 (owner's iPhone, 2026-09-18) finished looking healthy - 763 real patients,
 * five of the six gate resources proven - and was then refused approval: "not endpoint-complete: no
 * proven backend request for labs-detail". The chain block only ever pushed to `checks`, so a lab list
 * that proved while its detail did not never reached `failed`, never became a gap, and the doctor was
 * never asked. Reporting the miss is what lets the run ask for it instead of failing at the very end. */
test('a proven list whose detail never proved is reported, so it can be asked for', async () => {
  const plugin = {
    async navigate() {}, async wait() {},
    async currentUrl() { return { url: ORIGIN + '/Lab/Home' }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: JSON.stringify({ __RequestVerificationToken: 't' }) };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      const reply = (o) => ({ result: JSON.stringify(Object.assign({ status: 200, contentType: 'application/json', url: req.url }, o)) });
      if (req.url.indexOf('/GetIPWL') >= 0) return reply({ text: JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', episodeId: 'V1' }]) });
      if (req.url.indexOf('/GetSearchPatientId') >= 0) {
        return reply({ contentType: 'text/html', text: '<table><tr><th>Order ID</th><th>Test</th></tr><tr><td>OR1</td><td>CBC</td></tr></table>' });
      }
      return reply({ text: '' });
    },
  };
  const views = [
    { resourceHint: 'worklist', pathTemplate: ORIGIN + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['Patient ID'], endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type&start&length' }] },
    { resourceHint: 'labs', pathTemplate: ORIGIN + '/Lab/Home', rowsSelector: '#example15 tbody tr', headers: ['Order ID', 'Test'], proof: { status: 'proven' }, searched: true,
      endpoints: [{ method: 'POST', path: '/Lab/Home/GetSearchPatientId', role: 'data', bodyKeys: ['patient_id'], params: { patient_id: { from: 'worklist', field: 'patientId' } } }] },
  ];
  const book = { prove: async () => null, note: () => {} };
  const brain = { verify: async (p) => ({ ok: true, resource: p.resource, confidence: 0.9, reason: 'looks right', suggestion: 'ok' }) };
  const out = await verifyViews({ plugin, origin: ORIGIN, views, brain, book, parseHtml: miniParse });
  assert.ok(out.failed.includes('labs-detail'),
    'labs proved but no labs-detail did, so it must be reported as missing: ' + JSON.stringify(out.failed));
  assert.ok(!out.failed.includes('radiology-detail'),
    'a detail whose parent list never proved is not the doctor\'s problem to fix: ' + JSON.stringify(out.failed));
});
