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
  // Frozen, exactly like the real createPluginClient(): the engine must never write onto it.
  const plugin = Object.freeze(fakePlugin(state));
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
      // The first ask uses the gap prompt; a re-ask says why (nothing proven from that screen).
      if (asks.filter((a) => a === gap).length === 1) assert.equal(text, GAP_PROMPTS[gap]);
      else assert.match(text, /None of the requests from that screen returned|could not read a table/);
      if (gap === 'radiology') { state.guided = true; return { done: true }; }
      state.guided = false;
      return { done: false }; // doctor skipped
    },
  });

  // Crawl found worklist + labs; the engine asked for the rest in canonical order, capped at 4.
  // The worklist was found but its read proved nothing against this fake page, so it is asked FIRST.
  // Radiology was shown but nothing on this fake page could be proven, so the doctor was asked again.
  assert.deepEqual([...new Set(asks)], ['worklist', 'labs', 'radiology', 'medications', 'patient', 'notes']);
  assert.ok(asks.filter((a) => a === 'radiology').length >= 2, asks.join(','));
  assert.ok(phases.includes('CRAWLING') && phases.includes('ASKING') && phases.includes('DONE'), phases.join(','));

  // Mode sequence: agent (start) -> guide once per ask -> agent (before probes).
  assert.equal(plugin.modes[0].mode, 'agent');
  assert.equal(plugin.modes[plugin.modes.length - 1].mode, 'agent');
  assert.equal(plugin.modes.filter((m) => m.mode === 'guide').length, asks.length);

  const views = calls.discovery.observedViews;
  const rad = views.find((v) => v.resourceHint === 'radiology');
  assert.ok(rad, JSON.stringify(views));
  assert.equal(rad.guided, true);
  assert.deepEqual(rad.guidedPath, ['a "Patient profile"', 'h5#sb7 "Radiology"']);
  assert.deepEqual(rad.headers, ['Study', 'Reported on', 'Impression']);
  assert.equal(rad.rowsSelector, '#divPrint > div.rreport');
  // Skipped gaps produced no view.
  assert.ok(!views.some((v) => v.resourceHint === 'discharge' || v.resourceHint === 'medications'));
  // The labs click fired a request, but this page keeps no replay buffer, so nothing could be re-issued
  // and compared with the screen: an unproven endpoint is never saved (prove.mjs).
  const labs = views.find((v) => v.resourceHint === 'labs');
  assert.equal(labs.endpoints, undefined);
  assert.equal(labs.proof.status, 'no-requests');
  assert.ok(result.proofs.some((p) => p.resource === 'labs' && p.status === 'no-requests'));
  assert.ok(!JSON.stringify(views).includes('MR900001'));
  assert.ok(!JSON.stringify(views).includes('SECRET'));

  assert.deepEqual(result.found.sort(), ['labs', 'radiology', 'worklist']);
  assert.deepEqual(result.asked, ['worklist', 'labs', 'radiology', 'medications', 'patient', 'notes']);
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

/* SAVE WHAT YOU HAVE. A run that stalls late must not cost the doctor the crawl. finishSignal is the
 * doctor tapping it: unlike stopSignal, the run does not end empty-handed - it breaks out of the asks
 * and the verification and still writes the discovery and evidence with everything already learned.
 * Regression for the frozen-at-86% run (owner, iPhone, 2026-09-15). */
test('runPhoneDiscovery: finishSignal saves what was found instead of discarding it', async () => {
  const state = { page: 'worklist', requests: [], guided: false, guideTaps: [] };
  const plugin = fakePlugin(state);
  const calls = {};
  let finish = false;
  const asks = [];
  const result = await runPhoneDiscovery({
    plugin, api: fakeApi(calls), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 },
    finishSignal: () => finish,
    // The doctor taps "Save what you have" while the first question is on screen.
    askDoctor: async ({ gap }) => { asks.push(gap); finish = true; return { done: false }; },
  });

  assert.deepEqual(asks, ['worklist']);                 // no further asks once finishing
  // The whole point: the run still SAVED. Stop would have left both of these undefined.
  assert.ok(calls.discovery, 'discovery was never posted: the crawl was thrown away');
  assert.ok(calls.evidence, 'evidence was never posted: no adapter candidate was created');
  assert.ok(calls.discovery.observedViews.length > 0, 'saved with no views');
  assert.equal(result.candidateVersionId, 'v1');
  assert.ok(result.found.length > 0, 'nothing was reported as found');
  // And it is honest that it was cut short rather than claiming everything was proven.
  assert.ok(result.warnings.some((w) => /saved at your request/.test(w)), result.warnings.join('|'));
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

/* F1 REGRESSION. window.__smdPointed (the table the doctor tapped during a guided ask) makes captureView
 * re-read that SAME table (CRAWL_RAW_TABLE / CRAWL_RAW_BLOCK prefer a pointed table), so clearing it must
 * happen BEFORE exploreDetailOf opens a row, not after: otherwise the "detail" captured is the list again.
 * And a detail is only worth opening once the parent screen is actually proven; chasing a row on an
 * unproven screen wastes the ask and can capture nothing of value. */
const DETAIL_LABS_RAW = { id: 'labs', class: '', headers: ['Test', 'Result', 'Unit'], rows: [{ isHeader: false, onclick: null }] };
const PROVEN_SCREEN = ['alphacbc', 'betaresult', 'gammaunit'];
const PROVEN_ENTRIES = [{ seq: 500, method: 'GET', url: 'https://emr.example/Lab/Home/GetLabResults?pid=X', body: null, xhr: true, status: 200, shape: { kind: 'json', keys: ['Test', 'Result', 'Unit'], rows: 1 } }];
const PROVEN_ANSWERS = { 500: { status: 200, contentType: 'application/json', text: JSON.stringify([{ Test: 'alphacbc', Result: 'betaresult', Unit: 'gammaunit' }]) } };

function detailFakePlugin({ proven }) {
  const evals = [];
  return {
    platform: 'android', evals,
    async navigate() { return { ok: true }; },
    async wait() {},
    async snapshot() { return { snapshot: '' }; },
    async click() { return { result: 'ok' }; },
    async closeTab() { return { ok: true }; },
    async currentUrl() { return { url: 'https://emr.example/doctor/home' }; },
    async setMode() { return { ok: true }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      const e = String(expression);
      evals.push(e);
      if (e.includes('__SMD_CONNECT_OBSERVER__.events')) return { result: '[]' };
      if (e.startsWith('mw:(')) return { result: JSON.stringify({ installed: true, installId: 'i1' }) };
      if (e.includes('function CRAWL_RAW_TABLE')) return { result: JSON.stringify(DETAIL_LABS_RAW) };
      if (e.includes('function CRAWL_RAW_BLOCK')) return { result: 'null' };
      if (e.includes('function CRAWL_GUIDE_PATH')) return { result: '[]' };
      if (e.includes('function CRAWL_ARM_GUIDE') || e.includes('function CRAWL_ARM_OBSERVER')) return { result: 'ok' };
      if (e.includes('function CRAWL_CLEAR_POINT')) return { result: 'ok' };
      if (e.includes('function CRAWL_CLICK_FIRST_ROW')) return { result: 'row' };
      if (e.includes('function PROVE_LIST(since)')) return { result: JSON.stringify(proven ? PROVEN_ENTRIES : []) };
      if (e.includes('function PROVE_SCREEN(spec)')) return { result: JSON.stringify(PROVEN_SCREEN) };
      if (e.includes('function PROVE_EXEC(seq)')) {
        const m = /\)\((\d+)\)$/.exec(e);
        return { result: JSON.stringify(PROVEN_ANSWERS[m ? Number(m[1]) : 0] || { status: 0 }) };
      }
      return { result: null };
    },
  };
}

function fakeApiDetail(calls) {
  return {
    plan: async () => ({ action: 'stop', reason: 'test' }),
    progress: async () => ({ ok: true }),
    discovery: async (body) => { calls.discovery = body; return { candidateVersionId: 'v1', manifest: { operations: [] }, probes: [] }; },
    evidence: async (body) => { calls.evidence = body; return { capabilities: [], evidenceHash: 'sha256:x', state: 'AWAITING_APPROVAL' }; },
  };
}

// askDoctor says Done once for 'labs', skips every other gap immediately.
const askDoneOnceForLabs = () => {
  let asks = 0;
  return async ({ gap }) => {
    if (gap !== 'labs') return { done: false };
    asks += 1;
    return { done: asks === 1 };
  };
};

test('askOne: an unproven guided screen is never sent into exploreDetailOf', async () => {
  const plugin = detailFakePlugin({ proven: false });
  await runPhoneDiscovery({
    plugin, api: fakeApiDetail({}), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    mode: 'manual', caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 },
    askDoctor: askDoneOnceForLabs(),
  });
  assert.ok(!plugin.evals.some((e) => e.includes('function CRAWL_CLICK_FIRST_ROW')), 'exploreDetailOf ran on an unproven view');
});

test('askOne: the pointed table is cleared before a proven view is explored one row deeper', async () => {
  const plugin = detailFakePlugin({ proven: true });
  await runPhoneDiscovery({
    plugin, api: fakeApiDetail({}), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    mode: 'manual', caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5 },
    askDoctor: askDoneOnceForLabs(),
  });
  const clearAt = plugin.evals.findIndex((e) => e.includes('function CRAWL_CLEAR_POINT'));
  const clickAt = plugin.evals.findIndex((e) => e.includes('function CRAWL_CLICK_FIRST_ROW'));
  assert.ok(clearAt >= 0, 'clearPoint was never called');
  assert.ok(clickAt >= 0, 'exploreDetailOf never ran on a proven view');
  assert.ok(clearAt < clickAt, `clearPoint (index ${clearAt}) must run before the detail explore (index ${clickAt})`);
});

/* F2 REGRESSION. The autonomous crawl's inline "one level deeper" step (deep-crawl.mjs) turns a native
 * navigation GET into a replay candidate only when its origin is in `caps.origins` - but index.mjs
 * built that caps object as `Object.assign({ exploreDetails: true }, caps || {})`, never adding
 * `origins`, so a secondary-origin API host (GHIS-shaped: app host serves pages, api host serves the
 * detail print) always fell outside the allowlist and the detail request was silently dropped. */
function crossOriginFakePlugin(state) {
  const evals = [];
  return {
    platform: 'android', evals,
    async navigate() { return { ok: true }; },
    async wait() {},
    async snapshot() { return { snapshot: '' }; },
    async click() { return { result: 'ok' }; },
    async closeTab() { return { ok: true }; },
    async currentUrl() { return { url: 'https://emr.example/doctor/home' }; },
    async setMode() { return { ok: true }; },
    async drainRequests() {
      if (state.pendingCrossOrigin) {
        state.pendingCrossOrigin = false;
        return { requests: [{ method: 'GET', url: 'https://api.emr.example/Lab/Home/GetLabResultPrint?id=77' }] };
      }
      return { requests: [] };
    },
    async evaluate({ expression }) {
      const e = String(expression);
      evals.push(e);
      if (e.includes('__SMD_CONNECT_OBSERVER__.events')) return { result: '[]' };
      if (e.startsWith('mw:(')) return { result: JSON.stringify({ installed: true, installId: 'i1' }) };
      if (e.includes('function CRAWL_PAGE_STATE')) return { result: JSON.stringify({ textLen: 5000, hasPasswordInput: false, dataTableCount: 1, anyVisible: true }) };
      if (e.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify(state.page === 'worklist' ? { index: 1 } : null) };
      if (e.includes('function CRAWL_CLICK_ROW')) { state.page = 'patient'; return { result: 'ok' }; }
      if (e.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(state.page === 'worklist' ? [] : [{ index: 1, label: 'Lab reports', clinical: true }]) };
      if (e.includes('function CRAWL_CLICK_CONTROL')) { state.page = 'labs'; return { result: 'ok' }; }
      if (e.includes('function CRAWL_RAW_TABLE')) {
        if (state.page === 'worklist') return { result: JSON.stringify({ id: 'data_tables1', class: '', headers: ['Patient ID', 'Patient name'], rows: [{ isHeader: false, onclick: "openPatient('X')" }] }) };
        if (state.page === 'labs') return { result: JSON.stringify({ id: 'labs', class: '', headers: ['Test', 'Result'], rows: [{ isHeader: false, onclick: null }] }) };
        return { result: 'null' };
      }
      if (e.includes('function CRAWL_RAW_BLOCK')) return { result: 'null' };
      if (e.includes('function CRAWL_CLICK_FIRST_ROW')) { state.pendingCrossOrigin = true; return { result: 'row' }; }
      if (e.includes('function CRAWL_DETAIL_SETTLED')) return { result: JSON.stringify({ gone: false, newest: true }) };
      return { result: 'null' };
    },
  };
}

test('runPhoneDiscovery: the autonomous crawl carries deployment.origins through to the inline detail step, so a secondary-origin request is not dropped', async () => {
  const state = { page: 'worklist', pendingCrossOrigin: false };
  const plugin = crossOriginFakePlugin(state);
  const calls = {};
  await runPhoneDiscovery({
    plugin, api: fakeApiDetail(calls), session: { id: 's1' },
    deployment: { origins: ['https://emr.example', 'https://api.emr.example'] },
    caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5, verifyBudgetMs: 50 },
  });
  const detail = calls.discovery?.observedViews?.find((v) => v.resourceHint === 'labs-detail');
  assert.ok(detail, 'the crawl never opened a labs row: ' + JSON.stringify(calls.discovery?.observedViews));
  // navToReplayEntries only injects a nav-turned request into the replay buffer when its origin is
  // allowed: this eval only fires once the crawl's caps carried deployment.origins that far down.
  const injected = plugin.evals.some((e) => e.includes('window.__SMD_REPLAY__=window.__SMD_REPLAY__'));
  assert.ok(injected, 'the secondary-origin request never reached the replay buffer (origins was not passed through)');
});

/* B1 REGRESSION. askOne (index.mjs) used to call captureView BEFORE draining the native request log for
 * navToReplayEntries/INJECT_REPLAY. captureView itself drains (and CLEARS) that same log to build
 * view.endpoints (deep-crawl.mjs captureView), so a doctor's page-load navigation (GHIS radiology:
 * GET /Radio/Home?recordNo=... is a document load, not XHR) was already gone from the log by the time
 * the drain->nav->inject block ran: nav was always [] and INJECT_REPLAY_SRC was never even evaluated.
 * Fixed by moving that block above captureView, the same order deep-crawl.mjs's exploreDetailOf uses. */
function pageLoadFakePlugin(state) {
  const evals = [];
  return {
    platform: 'android', evals,
    async navigate() { return { ok: true }; },
    async wait() {},
    async snapshot() { return { snapshot: '' }; },
    async click() { return { result: 'ok' }; },
    async closeTab() { return { ok: true }; },
    async currentUrl() { return { url: 'https://emr.example/Radio/Home?recordNo=MR1' }; },
    async setMode() { return { ok: true }; },
    async drainRequests() { return { requests: state.requests.splice(0) }; },
    async evaluate({ expression }) {
      const e = String(expression);
      evals.push(e);
      if (e.includes('__SMD_CONNECT_OBSERVER__.events')) return { result: '[]' };
      if (e.startsWith('mw:(')) return { result: JSON.stringify({ installed: true, installId: 'i1' }) };
      if (e.includes('function CRAWL_RAW_TABLE')) return { result: 'null' };
      if (e.includes('function CRAWL_RAW_BLOCK')) return { result: JSON.stringify(RAD_BLOCK) };
      if (e.includes('function CRAWL_GUIDE_PATH')) return { result: '[]' };
      if (e.includes('function CRAWL_ARM_GUIDE') || e.includes('function CRAWL_ARM_OBSERVER')) return { result: 'ok' };
      if (e.includes('function CRAWL_CLEAR_POINT')) return { result: 'ok' };
      return { result: null };
    },
  };
}

test('askOne: the native request log is drained for replay injection BEFORE captureView drains (and clears) it', async () => {
  const state = { requests: [] };
  const plugin = pageLoadFakePlugin(state);
  await runPhoneDiscovery({
    plugin, api: fakeApiDetail({}), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    mode: 'manual', caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5, verifyBudgetMs: 50 },
    askDoctor: async ({ gap }) => {
      if (gap !== 'radiology') return { done: false };
      // The doctor's page-load navigation to the report is already sitting in the native log by the
      // time they tap Done, exactly like a real document-load GET fired before the ask resolves.
      state.requests.push({ method: 'GET', url: 'https://emr.example/Radio/Home?recordNo=MR1' });
      return { done: true };
    },
  });
  const injectAt = plugin.evals.findIndex((e) => e.includes('window.__SMD_REPLAY__=window.__SMD_REPLAY__'));
  const captureAt = plugin.evals.findIndex((e) => e.includes('function CRAWL_RAW_TABLE') || e.includes('function CRAWL_RAW_BLOCK'));
  assert.ok(injectAt >= 0, 'the nav GET never reached the replay buffer: ' + JSON.stringify(plugin.evals));
  assert.ok(plugin.evals[injectAt].includes('MR1'), 'the injected entry does not carry the navigated URL');
  assert.ok(captureAt >= 0, 'captureView never read the screen');
  assert.ok(injectAt < captureAt, `the replay injection (index ${injectAt}) must run before captureView drains the log (index ${captureAt})`);
});

/* FIX C. A patient with no radiology reports yet shows an EMPTY list: buildTableView marks it
 * singleRecord (no data rows), the proof ends no-screen-values, and the doctor was told "None of the
 * requests from that screen returned the radiology reports", which reads as a wrong screen when the
 * screen was right and the patient simply has none. The ask now says so and asks for a patient who has
 * some, without spending a proof attempt. */
const EMPTY_TABLE = { id: 'radioGrid', class: 'table', headers: ['Service ID', 'Date', 'Description'], rows: [{ isHeader: true, onclick: null }] };
test('askOne: an empty list gets a "this patient has no ... yet" re-ask, not a failed proof', async () => {
  const state = { requests: [] };
  const plugin = pageLoadFakePlugin(state);
  const orig = plugin.evaluate.bind(plugin);
  plugin.evaluate = async (args) => {
    const e = String(args.expression);
    if (e.includes('function CRAWL_RAW_TABLE')) { plugin.evals.push(e); return { result: JSON.stringify(EMPTY_TABLE) }; }
    return orig(args);
  };
  const prompts = [];
  let proves = 0;
  const book = { async prove() { proves += 1; }, trace: [] };
  await runPhoneDiscovery({
    plugin, api: fakeApiDetail({}), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] }, book,
    mode: 'manual', caps: { maxMs: 30000, waitMs: 1, verifyWaitMs: 5, verifyBudgetMs: 50 },
    askDoctor: async ({ gap, text }) => {
      if (gap !== 'radiology') return { done: false };
      prompts.push(text);
      return prompts.length < 2 ? { done: true } : { done: false };
    },
  }).catch(() => {});   // the run ends with nothing discovered once the second ask is declined: expected here
  assert.ok(prompts.length >= 2, 'the doctor was not asked again: ' + JSON.stringify(prompts));
  assert.match(prompts[1], /^This patient has no radiology reports yet\. Open the radiology reports of a patient who has some/, prompts[1]);
  assert.equal(proves, 0, 'an empty list must not be sent to the proof');
});


/* FEWEST TAPS TO A USABLE CONNECTION. Approval needs the ward list, labs and its report, radiology and
 * its report, and the drug chart. Patient details, notes, the discharge summary and visit history are
 * worth having but the gate does not require them - yet the doctor was asked for patient details and
 * notes FIRST, spending two of their taps before anything that could be approved (owner's live run,
 * 2026-09-18). The required screens come first so a doctor who stops early still has a usable adapter. */
test('ASK_ORDER asks for what approval needs first', async () => {
  const { ASK_ORDER } = await import('../../connect-agent/phone/index.mjs');
  const REQUIRED = ['worklist', 'labs', 'radiology', 'medications'];
  const OPTIONAL = ['patient', 'notes', 'discharge', 'history'];
  const lastRequired = Math.max(...REQUIRED.map((r) => ASK_ORDER.indexOf(r)));
  const firstOptional = Math.min(...OPTIONAL.map((r) => ASK_ORDER.indexOf(r)));
  assert.ok(lastRequired < firstOptional, 'every gate resource is asked before any optional one: ' + ASK_ORDER.join(','));
  assert.equal(ASK_ORDER[0], 'worklist', 'the ward list is still first');
  for (const r of REQUIRED.concat(OPTIONAL)) assert.ok(ASK_ORDER.includes(r), 'still asks for ' + r);
});


/* THE DETAIL NOBODY COULD SUPPLY. Run 6 finished looking healthy - 763 real patients, five of the six
 * gate resources proven - and was then refused approval: "no proven backend request for labs-detail".
 * The doctor could not have fixed it even if they had wanted to, because labs-detail had no prompt and
 * is not in ASK_ORDER, so it could never be asked. The agent opening the row itself stays the primary
 * path; this is the one extra tap, spent only when that path did not work on this hospital. */
test('a detail the agent could not chain is a question the doctor can answer', () => {
  for (const res of ['labs-detail', 'radiology-detail']) {
    assert.ok(GAP_PROMPTS[res], res + ' must be askable, or the run is refused for something nobody can supply');
    assert.match(GAP_PROMPTS[res], /tap Done/, res + ' prompt follows the same shape as every other ask');
    assert.ok(!/—/.test(GAP_PROMPTS[res]), 'no em-dash in app-facing text');
  }
  assert.match(GAP_PROMPTS['labs-detail'], /one lab report/i, 'it asks for ONE report, not the whole list again');
});
