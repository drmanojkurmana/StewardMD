// test/connect-agent/phone-explore.test.mjs — unit tests for connect-agent/phone/explore.mjs:
// defaultPlanner keyword tiers, explorePhone caps and ref validation, probePhone shape rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlanner, explorePhone, probePhone } from '../../connect-agent/phone/explore.mjs';

// --- defaultPlanner -----------------------------------------------------------------------------

test('defaultPlanner: stops with no candidates at depth 0', async () => {
  const decision = await defaultPlanner({ lines: ['- text "nothing clickable"'], depth: 0, events: [] });
  assert.equal(decision.action, 'stop');
});

test('defaultPlanner: goes back with no candidates at depth > 0', async () => {
  const decision = await defaultPlanner({ lines: ['- text "nothing clickable"'], depth: 2, events: [] });
  assert.equal(decision.action, 'back');
});

test('defaultPlanner: picks a tier1 keyword link over a tier2 one', async () => {
  const lines = [
    '- link "Lab Results" [ref=e1]',
    '- link "Doctor Worklist" [ref=e2]',
  ];
  const decision = await defaultPlanner({ lines, depth: 0, events: [] });
  assert.equal(decision.action, 'click');
  assert.equal(decision.ref, 'e2');
});

test('defaultPlanner: falls back to tier2 keyword when no tier1 match', async () => {
  const lines = ['- link "Lab Results" [ref=e1]', '- link "Home" [ref=e2]'];
  const decision = await defaultPlanner({ lines, depth: 0, events: [] });
  assert.equal(decision.action, 'click');
  assert.equal(decision.ref, 'e1');
});

test('defaultPlanner: skips SKIP_LABEL candidates (e.g. Logout, Delete)', async () => {
  const lines = ['- link "Logout" [ref=e1]', '- link "Doctor Home" [ref=e2]'];
  const decision = await defaultPlanner({ lines, depth: 0, events: [] });
  assert.equal(decision.ref, 'e2');
});

test('defaultPlanner: after an array-shaped event, prefers an unvisited redacted-number row', async () => {
  const lines = [
    '- link "Doctor Dashboard" [ref=e1]',
    '- link "Patient #" [ref=e2]',
  ];
  const events = [{ method: 'GET', path: '/api/worklist', responseShape: { type: 'object', keys: { items: { type: 'array', sample: null } } } }];
  const decision = await defaultPlanner({ lines, depth: 1, events });
  assert.equal(decision.action, 'click');
  assert.equal(decision.ref, 'e2');
  assert.equal(decision.reason, 'patient-row');
});

test('defaultPlanner: never invents a ref not present in lines', async () => {
  const lines = ['- link "Doctor Worklist" [ref=e1]'];
  const decision = await defaultPlanner({ lines, depth: 0, events: [] });
  assert.ok(lines.some((l) => l.includes(`[ref=${decision.ref}]`)));
});

// --- explorePhone --------------------------------------------------------------------------------

function fakeClient({ pages }) {
  // pages: url -> { lines, events }. navigate/click move `current`.
  let current = Object.keys(pages)[0];
  const events = [];
  return {
    calls: [],
    async navigate({ url }) { current = url; },
    async currentUrl() { return { url: current }; },
    async snapshot() { return { snapshot: pages[current].lines.join('\n') }; },
    async click({ ref }) {
      const next = pages[current].clicks?.[ref];
      if (next) current = next;
    },
    async evaluate() { return { result: null }; },
  };
}

function fakeCollector(eventsByUrl, client) {
  const buffer = [];
  return {
    async observe() {
      const evs = eventsByUrl[(await client.currentUrl()).url] || [];
      buffer.push(...evs);
    },
    raw: () => [...buffer],
  };
}

test('explorePhone: click advances depth by one', async () => {
  const pages = {
    A: { lines: ['- link "Doctor Worklist" [ref=e1]'], clicks: { e1: 'B' } },
    B: { lines: [] },
  };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async ({ depth }) => (depth === 0 ? { action: 'click', ref: 'e1', label: 'Doctor Worklist' } : { action: 'stop', reason: 'done' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A' });
  assert.equal(result.steps.length, 1);
  assert.equal(result.depth, 1);
  assert.equal(result.stopReason, 'done');
});

test('explorePhone: back retreats depth by one', async () => {
  const pages = {
    A: { lines: ['- link "Doctor Worklist" [ref=e1]'], clicks: { e1: 'B' } },
    B: { lines: [] },
  };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  let n = 0;
  const planner = async ({ depth }) => {
    n += 1;
    if (n === 1) return { action: 'click', ref: 'e1', label: 'Doctor Worklist' };
    if (n === 2) return { action: 'back', reason: 'no-candidate' };
    return { action: 'stop', reason: 'done' };
  };
  const result = await explorePhone({ client, collector, planner, startUrl: 'A' });
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].action, 'back');
  assert.equal(result.depth, 0);
});

test('explorePhone: stops on step cap', async () => {
  const pages = { A: { lines: ['- link "Doctor" [ref=e1]'], clicks: { e1: 'A' } } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async () => ({ action: 'click', ref: 'e1', label: 'Doctor' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A', caps: { maxSteps: 3, maxDepth: 100 } });
  assert.equal(result.steps.length, 3);
  assert.equal(result.stopReason, 'step-cap');
});

test('explorePhone: stops on depth cap', async () => {
  const pages = { A: { lines: ['- link "Doctor" [ref=e1]'], clicks: { e1: 'A' } } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async () => ({ action: 'click', ref: 'e1', label: 'Doctor' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A', caps: { maxSteps: 100, maxDepth: 2 } });
  assert.equal(result.stopReason, 'depth-cap');
  assert.ok(result.depth <= 3);
});

test('explorePhone: stops on planner error without throwing', async () => {
  const pages = { A: { lines: [] } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async () => { throw new Error('planner boom'); };
  const result = await explorePhone({ client, collector, planner, startUrl: 'A' });
  assert.equal(result.stopReason, 'planner-error');
});

test('explorePhone: rejects a ref the planner invented that is not in the current snapshot', async () => {
  const pages = { A: { lines: ['- link "Doctor" [ref=e1]'] } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async () => ({ action: 'click', ref: 'e99', label: 'not real' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A' });
  assert.equal(result.stopReason, 'invalid-ref');
  assert.equal(result.steps.length, 0);
});

test('explorePhone: stops immediately on a blocked event', async () => {
  const pages = { A: { lines: ['- link "Doctor" [ref=e1]'], clicks: { e1: 'B' } }, B: { lines: [] } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({ B: [{ method: 'GET', path: '/x', blocked: true }] }, client);
  const planner = async ({ depth }) => (depth === 0 ? { action: 'click', ref: 'e1', label: 'Doctor' } : { action: 'stop' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A' });
  assert.equal(result.stopReason, 'blocked');
});

test('explorePhone: stopSignal() true ends exploration', async () => {
  const pages = { A: { lines: ['- link "Doctor" [ref=e1]'], clicks: { e1: 'A' } } };
  const client = fakeClient({ pages });
  const collector = fakeCollector({}, client);
  const planner = async () => ({ action: 'click', ref: 'e1', label: 'Doctor' });
  const result = await explorePhone({ client, collector, planner, startUrl: 'A', stopSignal: () => true });
  assert.equal(result.stopReason, 'stop-signal');
  assert.equal(result.steps.length, 0);
});

// --- probePhone -----------------------------------------------------------------------------------

test('probePhone: only runs probes it was given, and reads status/shape/itemCount from the page realm', async () => {
  const calls = [];
  const client = {
    async evaluate({ expression }) {
      calls.push(expression);
      return { result: JSON.stringify({ status: 200, contentType: 'application/json', responseShape: { type: 'array', sample: { type: 'object', keys: { id: 'string' } } }, itemCount: 3 }) };
    },
  };
  const { probes } = await probePhone({ client, probes: [{ opId: 'op1', url: 'https://emr.example/api/x' }] });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /credentials:\s*'include'/);
  assert.deepEqual(probes, [{ opId: 'op1', status: 200, contentType: 'application/json', responseShape: { type: 'array', sample: { type: 'object', keys: { id: 'string' } } }, itemCount: 3 }]);
});

test('probePhone: skips malformed probe entries', async () => {
  const client = { async evaluate() { return { result: 'null' }; } };
  const { probes } = await probePhone({ client, probes: [{}, { opId: 'no-url' }, null] });
  assert.deepEqual(probes, []);
});
