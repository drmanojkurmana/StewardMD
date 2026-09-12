// test/connect-agent/phone-modes.test.mjs — Manual mode (the doctor drives) and the brain hooks (the
// model advises on structure) in runPhoneDiscovery and deepCrawlClinical.
//   node --test test/connect-agent/phone-modes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPhoneDiscovery, ASK_ORDER, ASK_PROMPTS } from '../../connect-agent/phone/index.mjs';
import { enrichView, scrubForBrain, deepCrawlClinical, TARGET_HINTS } from '../../connect-agent/phone/deep-crawl.mjs';

const WORKLIST_RAW = { id: 'data_tables1', class: '', headers: ['Patient ID', 'Patient name', 'Age', 'Gender'], rows: [{ isHeader: false, onclick: "openPatient('SECRET')" }] };
const LABS_RAW = { id: 'labs', class: '', headers: ['Test name', 'Result', 'Unit'], rows: [{ isHeader: false, onclick: null }] };

// The doctor's screen: `table` is what CRAWL_RAW_TABLE sees right now; `block` what CRAWL_RAW_BLOCK sees.
function fakePlugin(state) {
  const modes = [];
  const clicks = [];
  return {
    platform: 'android', modes, clicks,
    async navigate() { return { ok: true }; },
    async wait() {},
    async snapshot() { return { snapshot: '- heading "Home"' }; },
    async click() { return { result: 'ok' }; },
    async closeTab() { return { ok: true }; },
    async currentUrl() { return { url: 'https://emr.example/Doctor/Home' }; },
    async setMode({ mode, banner }) { modes.push({ mode, banner }); return { ok: true }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      const e = String(expression);
      if (e.includes('__SMD_CONNECT_OBSERVER__.events')) return { result: '[]' };
      if (e.startsWith('mw:(')) return { result: JSON.stringify({ installed: true, installId: 'i1' }) };
      if (e.includes('function CRAWL_PAGE_STATE')) return { result: JSON.stringify({ textLen: 5000, hasPasswordInput: false, dataTableCount: 1, anyVisible: true }) };
      if (e.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify({ index: 1 }) };
      if (e.includes('function CRAWL_CLICK_ROW')) return { result: 'ok' };
      if (e.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(state.controls || []) };
      if (e.includes('function CRAWL_CLICK_CONTROL')) { const m = /\)\((\d+),/.exec(e); clicks.push(Number(m && m[1])); state.table = state.afterClick || null; state.controls = []; return { result: 'ok' }; }
      if (e.includes('function CRAWL_RAW_TABLE')) return { result: JSON.stringify(state.table || null) };
      if (e.includes('function CRAWL_RAW_BLOCK')) return { result: JSON.stringify(state.block || null) };
      if (e.includes('function CRAWL_GUIDE_PATH')) return { result: JSON.stringify(state.taps || []) };
      return { result: 'ok' };
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

test('manual mode asks for every resource in order, never clicks on its own, records Not in my EMR, and maps columns through the brain', async () => {
  const state = { table: WORKLIST_RAW, block: null, taps: ['a "IP list"'] };
  const plugin = fakePlugin(state);
  const calls = {};
  const asks = [];
  const brainCalls = [];
  const brain = {
    classify: async (p) => { brainCalls.push(['classify', p]); return { resource: p.ask === 'labs' ? 'medications' : p.ask, confidence: 0.9 }; },
    mapColumns: async (p) => { brainCalls.push(['map', p]); return { fields: { 'Patient ID': 'patientId', 'Patient name': 'name', 'Test name': 'testName' } }; },
    next: async () => { throw new Error('manual mode must never plan a tap'); },
  };
  const progress = [];
  const result = await runPhoneDiscovery({
    plugin, api: fakeApi(calls), session: { id: 's1' }, deployment: { origins: ['https://emr.example'] },
    startUrl: 'https://emr.example/login', mode: 'manual', brain, caps: { verifyWaitMs: 5 },
    onProgress: (p) => progress.push(p),
    askDoctor: async ({ gap, text, step, total }) => {
      asks.push(gap);
      assert.equal(text, ASK_PROMPTS[gap]);
      assert.equal(total, ASK_ORDER.length);
      assert.equal(step, asks.length);
      const last = plugin.modes[plugin.modes.length - 1];
      assert.equal(last.mode, 'guide');
      assert.equal(last.banner, text);
      if (gap === 'worklist') { state.table = WORKLIST_RAW; return { done: true }; }
      if (gap === 'labs') { state.table = LABS_RAW; return { done: true }; }
      if (gap === 'radiology' || gap === 'discharge') return { done: false, missing: true };
      state.table = null;
      return { done: false };
    },
  });

  assert.deepEqual(asks, [...ASK_ORDER]);
  assert.equal(plugin.clicks.length, 0, 'the agent never tapped anything');
  assert.equal(plugin.modes[0].mode, 'guide', 'manual mode never starts the agent-driven explore');
  assert.equal(plugin.modes[plugin.modes.length - 1].mode, 'agent', 'agent mode before the probes');
  assert.deepEqual(result.missing, ['radiology', 'discharge']);
  assert.deepEqual(result.found, ['worklist', 'labs']);
  assert.equal(result.mode, 'manual');
  assert.ok(result.warnings.some((w) => /labs screen looks like medications/.test(w)), result.warnings.join(';'));

  const views = calls.discovery.observedViews;
  assert.equal(views.length, 2);
  assert.equal(views[0].resourceHint, 'worklist', "the doctor's word on what a screen is stands");
  assert.equal(views[0].guided, true);
  assert.deepEqual(views[0].guidedPath, ['a "IP list"']);
  assert.deepEqual(views[0].fieldHints, { 'Patient ID': 'patientId', 'Patient name': 'name' });
  assert.equal(views[1].resourceHint, 'labs');
  assert.deepEqual(views[1].fieldHints, { 'Test name': 'testName' });
  assert.deepEqual(calls.discovery.steps, []);
  const asking = progress.filter((p) => p.phase === 'ASKING');
  assert.equal(asking.length, ASK_ORDER.length);
  assert.equal(asking[2].step, 3);
  assert.ok(progress.some((p) => p.phase === 'CAPTURED' && p.gap === 'worklist'));
  for (const [, p] of brainCalls) assert.ok(!JSON.stringify(p).includes('SECRET'), 'no onclick argument reaches the brain');
});

test('scrubForBrain replaces digit runs and drops anything with an @ before it leaves the phone', () => {
  assert.deepEqual(scrubForBrain({ path: '/Patient/123456/Labs', headers: ['Bed 101', 'x@y.org', 'Name'], n: 3 }), { path: '/Patient/#/Labs', headers: ['Bed #', 'Name'], n: 3 });
});

test('enrichView classifies an unknown view, keeps a rule-classified one, and survives a dead brain', async () => {
  const dead = { classify: async () => { throw new Error('503'); }, mapColumns: async () => null };
  const v1 = { resourceHint: 'unknown', pathTemplate: 'https://h/x', headers: ['Drug', 'Dose'] };
  assert.equal(await enrichView(v1, dead, { label: 'Rx' }), null);
  assert.equal(v1.resourceHint, 'unknown');
  const live = { classify: async () => ({ resource: 'medications', confidence: 0.7 }), mapColumns: async () => ({ fields: { Drug: 'drugName', Ghost: 'bed' } }) };
  const v2 = { resourceHint: 'unknown', pathTemplate: 'https://h/x', headers: ['Drug', 'Dose'] };
  await enrichView(v2, live, { label: 'Rx' });
  assert.equal(v2.resourceHint, 'medications');
  assert.deepEqual(v2.fieldHints, { Drug: 'drugName' });
  const weak = { classify: async () => ({ resource: 'labs', confidence: 0.3 }) };
  const v3 = { resourceHint: 'unknown', pathTemplate: 'https://h/x', headers: ['A'] };
  await enrichView(v3, weak, {});
  assert.equal(v3.resourceHint, 'unknown', 'a low-confidence answer changes nothing');
  assert.equal(await enrichView({ resourceHint: 'labs', headers: ['A'] }, null), null);
  assert.ok(TARGET_HINTS.includes('notes'));
});

test('auto crawl lets the brain pick the next control from the candidate list and falls back to the keyword rule', async () => {
  const state = { table: WORKLIST_RAW, controls: [{ index: 3, label: 'Billing', clinical: false }, { index: 7, label: 'Case sheet', clinical: false }], afterClick: LABS_RAW };
  const plugin = fakePlugin(state);
  const nexts = [];
  const brain = {
    next: async (p) => { nexts.push(p); return { index: 1, resource: 'notes' }; },
    classify: async () => null, mapColumns: async () => null,
  };
  const out = await deepCrawlClinical({ client: plugin, caps: { maxMs: 30000, waitMs: 1, maxClicks: 3 }, brain });
  assert.deepEqual(plugin.clicks, [7], 'the brain chose "Case sheet" (candidate index 1) over the first candidate');
  assert.deepEqual(nexts[0].controls, ['Billing', 'Case sheet']);
  assert.ok(nexts[0].looking.includes('medications') && !nexts[0].looking.includes('worklist'));
  assert.ok(out.observedViews.some((v) => v.resourceHint === 'notes' || v.resourceHint === 'labs'));

  const state2 = { table: WORKLIST_RAW, controls: [{ index: 3, label: 'Billing', clinical: false }, { index: 7, label: 'Lab reports', clinical: true }], afterClick: LABS_RAW };
  const plugin2 = fakePlugin(state2);
  await deepCrawlClinical({ client: plugin2, caps: { maxMs: 30000, waitMs: 1, maxClicks: 3 }, brain: { next: async () => ({ index: 42 }) } });
  assert.deepEqual(plugin2.clicks, [7], 'an out-of-range answer falls back to the clinical keyword rule');
});
