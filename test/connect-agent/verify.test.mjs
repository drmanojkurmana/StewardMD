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
