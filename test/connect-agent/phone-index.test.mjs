// test/connect-agent/phone-index.test.mjs — runPhoneDiscovery's explore-then-ask orchestration against a
// fake plugin client: the crawl finds only the worklist + labs, so the engine hands the screen to the
// doctor for the missing views (guide mode, banner text, NO touch overlay), records where they tapped,
// captures the resulting view, skips what the doctor skips, and returns to agent mode before probing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPhoneDiscovery, GAP_PROMPTS } from '../../connect-agent/phone/index.mjs';

const LABS_RAW = { id: 'labs', class: '', headers: ['Test name', 'Result', 'Unit'], rows: [{ isHeader: false, onclick: null }] };
const RAD_BLOCK = { rootSelector: '#divPrint > div.rreport', labels: ['Study:', 'Reported on:', 'Impression:'], selectors: ['p:nth-of-type(1)', 'p:nth-of-type(2)', 'p:nth-of-type(3)'], repeated: true };

// A fake six-method client. `page` is the current fake screen; `guideTaps` is what the doctor "tapped"
// during the guided step; `guided` becomes true once askDoctor resolved so the capture after Done sees
// the radiology block.
function fakePlugin(state) {
  const modes = [];
  const evals = [];
  return {
    platform: 'android', modes, evals,
    async navigate() { return { ok: true }; },
    async wait() {},
    async snapshot() { return { snapshot: '- heading "Worklist"' }; },
    async click() { return { result: 'ok' }; },
    async closeTab() { return { ok: true }; },
    async currentUrl() { return { url: 'https://emr.example/doctor/home' }; },
    async setMode({ mode, banner }) { modes.push({ mode, banner }); return { ok: true }; },
    async drainRequests() { return { requests: state.requests.splice(0) }; },
    async evaluate({ expression }) {
      const e = String(expression);
      evals.push(e.slice(0, 40));
      if (e.includes('__SMD_CONNECT_OBSERVER__.events')) return { result: '[]' };       // drain
      if (e.startsWith('mw:(')) return { result: JSON.stringify({ installed: true, installId: 'i1' }) }; // install
      if (e.includes('function CRAWL_PAGE_STATE')) return { result: JSON.stringify({ textLen: 5000, hasPasswordInput: false, dataTableCount: 1, anyVisible: true }) };
      if (e.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify({ index: 1 }) };
      if (e.includes('function CRAWL_CLICK_ROW')) { state.page = 'patient'; return { result: 'ok' }; }
      if (e.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(state.page === 'worklist' ? [] : [{ index: 1, label: 'Lab reports', clinical: true }]) };
      if (e.includes('function CRAWL_CLICK_CONTROL')) { state.page = 'labs'; state.requests.push({ method: 'GET', url: 'https://emr.example/Doctor/GetLabs?pid=MR900001' }); return { result: 'ok' }; }
      if (e.includes('function CRAWL_RAW_TABLE')) {
        if (state.page === 'worklist') return { result: JSON.stringify({ id: 'data_tables1', class: '', headers: ['Patient ID', 'Patient name', 'Age', 'Gender'], rows: [{ isHeader: false, onclick: "openPatient('SECRET')" }] }) };
        if (state.page === 'labs') { state.page = 'patient'; return { result: JSON.stringify(LABS_RAW) }; }
        return { result: 'null' };
      }
      if (e.includes('function CRAWL_RAW_BLOCK')) return { result: JSON.stringify(state.guided ? RAD_BLOCK : null) };
      if (e.includes('function CRAWL_GUIDE_PATH')) return { result: JSON.stringify(state.guideTaps) };
      if (e.includes('function CRAWL_ARM_GUIDE') || e.includes('function CRAWL_ARM_OBSERVER')) return { result: 'ok' };
      return { result: null };
    },
  };
}

function fakeApi(calls) {
  return {
    plan: async () => ({ action: 'stop', reason: 'test' }),
    progress: async () => ({ ok: true }),
    discovery: async (body) => { calls.discovery = body; return { candidateVersionId: 'v1', manifest: { operations: [] }, probes: [] }; },
    evidence: async (body) => { calls.evidence = body; return { capabilities: [], evidenceHash: 'sha256:x', state: 'AWAITING_APPROVAL' }; },
  };
}

test('runPhoneDiscovery: asks the doctor for each gap in guide mode, captures the guided view with its tap path, then returns to agent mode', async () => {
  const state = { page: 'worklist', requests: [], guided: false, guideTaps: ['a "Patient profile"', 'h5#sb7 "Radiology"'] };
  const plugin = fakePlugin(state);
  const calls = {};
  const asks = [];
  const phases = [];
  const result = await runPhoneDiscovery({
    plugin, api: fakeApi(calls), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    startUrl: 'https://emr.example/doctor/home',
    caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 },
    onProgress: (p) => phases.push(p.phase),
    askDoctor: async ({ gap, text }) => {
      asks.push(gap);
      // The plugin must be in guide mode WITH the question as the banner while the doctor is asked.
      const last = plugin.modes[plugin.modes.length - 1];
      assert.equal(last.mode, 'guide');
      assert.equal(last.banner, text);
      assert.equal(text, GAP_PROMPTS[gap]);
      if (gap === 'radiology') { state.guided = true; return { done: true }; }
      state.guided = false;
      return { done: false }; // doctor skipped
    },
  });

  // Crawl found worklist + labs; the engine asked for the rest in canonical order, capped at 4.
  // The worklist was found but its read proved nothing against this fake page, so it is asked FIRST.
  assert.deepEqual(asks, ['worklist', 'labs', 'patient', 'notes', 'radiology', 'medications']);
  assert.ok(phases.includes('CRAWLING') && phases.includes('ASKING') && phases.includes('DONE'), phases.join(','));

  // Mode sequence: agent (start) -> guide x4 -> agent (before probes).
  assert.equal(plugin.modes[0].mode, 'agent');
  assert.equal(plugin.modes[plugin.modes.length - 1].mode, 'agent');
  assert.equal(plugin.modes.filter((m) => m.mode === 'guide').length, 6);

  const views = calls.discovery.observedViews;
  const rad = views.find((v) => v.resourceHint === 'radiology');
  assert.ok(rad, JSON.stringify(views));
  assert.equal(rad.guided, true);
  assert.deepEqual(rad.guidedPath, ['a "Patient profile"', 'h5#sb7 "Radiology"']);
  assert.deepEqual(rad.headers, ['Study', 'Reported on', 'Impression']);
  assert.equal(rad.rowsSelector, '#divPrint > div.rreport');
  // Skipped gaps produced no view.
  assert.ok(!views.some((v) => v.resourceHint === 'discharge' || v.resourceHint === 'medications'));
  // The labs click's endpoint rides on the labs view, query VALUE dropped.
  const labs = views.find((v) => v.resourceHint === 'labs');
  assert.deepEqual(labs.endpoints, [{ method: 'GET', path: '/Doctor/GetLabs?pid' }]);
  assert.ok(!JSON.stringify(views).includes('MR900001'));
  assert.ok(!JSON.stringify(views).includes('SECRET'));

  assert.deepEqual(result.found.sort(), ['labs', 'radiology', 'worklist']);
  assert.deepEqual(result.asked, ['worklist', 'labs', 'patient', 'notes', 'radiology', 'medications']);
  assert.ok(result.verification && Array.isArray(result.verification.checks));
});

test('runPhoneDiscovery: no askDoctor -> never leaves agent mode; stopSignal ends the ask loop', async () => {
  const state = { page: 'worklist', requests: [], guided: false, guideTaps: [] };
  const plugin = fakePlugin(state);
  const calls = {};
  await runPhoneDiscovery({ plugin, api: fakeApi(calls), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] }, caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 } });
  assert.ok(plugin.modes.every((m) => m.mode === 'agent'));

  const state2 = { page: 'worklist', requests: [], guided: false, guideTaps: [] };
  const plugin2 = fakePlugin(state2);
  let stop = false;
  const asks = [];
  await runPhoneDiscovery({
    plugin: plugin2, api: fakeApi({}), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] }, caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 },
    stopSignal: () => stop,
    askDoctor: async ({ gap }) => { asks.push(gap); stop = true; return { done: false }; },
  });
  assert.deepEqual(asks, ['worklist']); // Stop pressed during the first ask (the unproven worklist comes first): no further asks
});

// A real EMR's entered address is its LOGIN page: navigating back to it after sign-in returns the
// doctor to the login form (on GHIS it ends the session), so the crawl must begin at the page the
// browser is already showing. Regression for the on-device failure of 2026-09-12.
test('the crawl starts at the browser current URL, not the typed login address', async () => {
  const state = { page: 'worklist', requests: [] };
  const plugin = fakePlugin(state);
  const navigated = [];
  plugin.navigate = async ({ url }) => { navigated.push(url); return { ok: true }; };
  plugin.currentUrl = async () => ({ url: 'https://emr.example/doctor/home' });
  await runPhoneDiscovery({
    plugin,
    api: fakeApi({}),
    session: { id: 'ses-1' },
    deployment: { id: 'dep-1', origins: ['https://emr.example'] },
    startUrl: 'https://emr.example/login',           // what the doctor typed
  });
  assert.ok(navigated.length > 0, 'the crawl navigated somewhere');
  assert.equal(navigated[0], 'https://emr.example/doctor/home', 'first navigation is where the doctor already is');
  assert.ok(!navigated.includes('https://emr.example/login'), 'never navigates back to the login page');
});

// No current URL (or one outside the allowed origins): the typed address is still the fallback.
test('falls back to the typed address when the browser has no usable current URL', async () => {
  const state = { page: 'worklist', requests: [] };
  const plugin = fakePlugin(state);
  const navigated = [];
  plugin.navigate = async ({ url }) => { navigated.push(url); return { ok: true }; };
  plugin.currentUrl = async () => { throw new Error('no tab'); };
  await runPhoneDiscovery({
    plugin,
    api: fakeApi({}),
    session: { id: 'ses-1' },
    deployment: { id: 'dep-1', origins: ['https://emr.example'] },
    startUrl: 'https://emr.example/login',
  });
  assert.equal(navigated[0], 'https://emr.example/login');
});
