import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVER_SOURCE, attachToTab, createCollector, discoverAuthorizedEmr, exploreReadWorkflows,
} from '../../connect-agent/discovery.mjs';
import { PHASE_AGENT_READ, PHASE_CLINICIAN_LOGIN, createPolicy, guardConfig } from '../../connect-agent/policy.mjs';
import { fakeCamofoxClient } from './fake-camofox-client.mjs';

const APP = 'https://emr.example';
const API = 'https://api.emr.example';
const POLICY = createPolicy({
  approvedOrigins: [APP, API],
  readEndpoints: [
    { method: 'GET', path: '/api/patients' },
    { method: 'GET', path: '/api/patients/{id}/medications' },
    { method: 'GET', path: '/api/v2/labs', origins: [API] },
  ],
  loginEndpoints: [{ method: 'POST', path: '/login', origins: [APP] }],
  navigationPaths: ['/worklist', '/patients/{id}'],
});

// ---------------------------------------------------------------------------------------------
// The main-world observer/guard, exercised for real. OBSERVER_SOURCE is the exact string shipped to
// the page, so running it here against browser stubs tests the code that actually runs in the EMR.
// ---------------------------------------------------------------------------------------------
function runObserver(config, { body = { items: [] }, contentType = 'application/json' } = {}) {
  const fetched = [];
  const nativeResponse = {
    status: 200,
    headers: { get: () => contentType },
    clone: () => ({ json: () => Promise.resolve(body) }),
  };
  const window = {
    fetch(...args) { fetched.push(args); return Promise.resolve(nativeResponse); },
    navigator: { sendBeacon: () => true },
  };
  const listeners = [];
  const document = { addEventListener: (type, fn) => listeners.push([type, fn]) };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function (method, url) { this.opened = [method, url]; };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.requestHeaders = this.requestHeaders || {};
    this.requestHeaders[name] = value;
  };
  XMLHttpRequest.prototype.send = function (data) {
    this.sent = true; this.sentBody = data;
    if (this.__loadListener) this.__loadListener();
  };
  XMLHttpRequest.prototype.addEventListener = function (type, fn) { if (type === 'load') this.__loadListener = fn; };
  XMLHttpRequest.prototype.getResponseHeader = function () { return null; };
  function HTMLFormElement() {}
  HTMLFormElement.prototype.submit = function () { this.submitted = true; };
  const location = { href: `${APP}/worklist` };

  const factory = new Function('window', 'document', 'XMLHttpRequest', 'HTMLFormElement', 'location', 'URL', 'Date', 'Math',
    `return (${OBSERVER_SOURCE});`);
  const install = factory(window, document, XMLHttpRequest, HTMLFormElement, location, URL, Date, Math);
  const receipt = JSON.parse(install(config));
  return { window, document, XMLHttpRequest, HTMLFormElement, listeners, fetched, receipt, state: window.__SMD_CONNECT_OBSERVER__ };
}

const agentGuard = (extra = {}) => guardConfig(POLICY, PHASE_AGENT_READ, {
  sensitive: 'password|token|cookie|authorization|session|mrn', limits: { maxEvents: 50, maxDepth: 3, maxKeys: 10, maxNodes: 100, maxStringLen: 100 }, ...extra,
});

test('guard allows an approved read and records it with its real origin', async () => {
  const env = runObserver(agentGuard(), { body: { items: [{ id: 1 }] } });
  await env.window.fetch(`${API}/api/v2/labs`);
  assert.equal(env.fetched.length, 1);
  const [event] = env.state.events;
  assert.equal(event.origin, API);
  assert.equal(event.path, '/api/v2/labs');
  assert.equal(event.blocked, false);
  // JSON round-trip, not a raw deepEqual: shape() deliberately builds `keys` with Object.create(null)
  // (hostile-key/prototype-pollution protection), so its objects are null-prototype and fail
  // deepStrictEqual against a plain `{}` even with identical own properties. Round-tripping through
  // JSON strips prototypes on both sides and compares structure only, which is what this test wants.
  assert.deepEqual(JSON.parse(JSON.stringify(event.responseShape)), { type: 'object', keys: { items: { type: 'array', sample: { type: 'object', keys: { id: 'number' } } } } });
});

test('guard rejects non-approved fetch, fetch(Request), XHR, beacon and form submit, and logs each block', async () => {
  const env = runObserver(agentGuard());

  await assert.rejects(() => env.window.fetch(`${APP}/api/export`), /policy blocked/);
  await assert.rejects(() => env.window.fetch(`${APP}/api/patients/pt-1/discharge`), /policy blocked/);
  await assert.rejects(() => env.window.fetch('https://evil.example/collect'), /policy blocked/);
  // fetch(Request): the method lives on the Request object, not on init
  await assert.rejects(() => env.window.fetch({ url: `${API}/api/v2/orders`, method: 'POST' }), /policy blocked/);
  // a GraphQL mutation is a POST, so it never reaches the network
  await assert.rejects(() => env.window.fetch(`${API}/graphql`, { method: 'POST', body: '{"query":"mutation{}"}' }), /policy blocked/);

  assert.equal(env.fetched.length, 0, 'not one blocked request reached the native fetch');
  assert.equal(env.window.navigator.sendBeacon(`${APP}/api/export`, 'x'), false);

  const xhr = new env.XMLHttpRequest();
  xhr.open('POST', `${API}/api/v2/orders`);
  assert.throws(() => xhr.send('{}'), /policy blocked/);
  assert.notEqual(xhr.sent, true);

  const form = new env.HTMLFormElement();
  form.action = `${APP}/api/export`; form.method = 'POST';
  env.HTMLFormElement.prototype.submit.call(form);
  assert.notEqual(form.submitted, true);

  const blocked = env.state.events.filter(e => e.blocked);
  assert.equal(blocked.length, 8);
  assert.deepEqual([...new Set(blocked.map(e => e.via))].sort(), ['fetch', 'form-submit', 'sendBeacon', 'xhr']);
  assert.ok(blocked.every(e => e.reason === 'policy-block'));
  // the block is recorded with the origin that was attempted, including the unapproved one
  assert.ok(blocked.some(e => e.origin === 'https://evil.example'));
});

test('guard never blocks during clinician login (the doctor keeps driving)', async () => {
  const env = runObserver(guardConfig(POLICY, PHASE_CLINICIAN_LOGIN, { sensitive: 'password', limits: { maxEvents: 50, maxDepth: 3, maxKeys: 10, maxNodes: 100, maxStringLen: 100 } }));
  await env.window.fetch(`${APP}/login`, { method: 'POST' });
  assert.equal(env.fetched.length, 1);
  const form = new env.HTMLFormElement();
  form.action = `${APP}/login`; form.method = 'POST';
  env.HTMLFormElement.prototype.submit.call(form);
  assert.equal(form.submitted, true);
  assert.equal(env.state.events.filter(e => e.blocked).length, 0);
});

test('a form-encoded XHR POST records bodyKeys, requestKind "form" and xhr true (never the values)', async () => {
  const env = runObserver(agentGuard({ enforce: false }));
  const xhr = new env.XMLHttpRequest();
  xhr.open('POST', `${API}/Doctor/Home/Searchnew`);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
  xhr.send('__RequestVerificationToken=super-secret-token&recordNo=MR900001');
  assert.equal(xhr.sent, true);
  const [event] = env.state.events;
  assert.equal(event.method, 'POST');
  assert.equal(event.path, '/Doctor/Home/Searchnew');
  assert.deepEqual(event.bodyKeys, ['__RequestVerificationToken', 'recordNo']);
  assert.equal(event.requestKind, 'form');
  assert.equal(event.xhr, true);
  const serialized = JSON.stringify(event);
  assert.ok(!/super-secret-token|MR900001/.test(serialized), serialized);
});

test('a JSON fetch POST records bodyKeys and requestKind "json"; no X-Requested-With -> xhr false', async () => {
  const env = runObserver(agentGuard({ enforce: false }));
  await env.window.fetch(`${API}/api/v2/labs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: 'pt-1', note: 'x' }),
  });
  const [event] = env.state.events;
  assert.deepEqual(event.bodyKeys, ['patientId', 'note']);
  assert.equal(event.requestKind, 'json');
  assert.equal(event.xhr, false);
});

test('shape() drops hostile keys and sensitive keys and does not pollute Object.prototype', async () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":1},"password":"hunter2","sessionToken":"abc","ok":1}');
  const env = runObserver(agentGuard(), { body: hostile });
  await env.window.fetch(`${API}/api/v2/labs`);
  const shape = env.state.events[0].responseShape;
  assert.deepEqual(Object.keys(shape.keys), ['ok']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const serialized = JSON.stringify(shape);
  assert.ok(!/hunter2|abc|password|__proto__/.test(serialized), serialized);
});

test('shape() is bounded in depth, key count and node count', async () => {
  let deep = { leaf: 1 };
  for (let i = 0; i < 8; i += 1) deep = { nested: deep };
  const wide = {};
  for (let i = 0; i < 60; i += 1) wide[`k${i}`] = i;
  const env = runObserver(agentGuard(), { body: { deep, wide } });
  await env.window.fetch(`${API}/api/v2/labs`);
  const shape = env.state.events[0].responseShape;
  assert.equal(Object.keys(shape.keys.wide.keys).length, 10, 'maxKeys enforced');
  assert.equal(JSON.stringify(shape).includes('"leaf"'), false, 'maxDepth enforced');
});

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------
const SAMPLE = [
  { method: 'GET', path: '/api/patients', origin: APP, queryKeys: ['q'], status: 200, contentType: 'application/json', responseShape: { type: 'object', keys: { items: { type: 'array', sample: 'string' } } }, blocked: false },
  { method: 'GET', path: '/api/v2/labs', origin: API, queryKeys: [], status: 200, contentType: 'application/json', responseShape: null, blocked: false },
  { method: 'GET', path: '/api/patients', origin: 'https://evil.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null, blocked: false },
  { method: 'POST', path: '/api/v2/orders', origin: API, queryKeys: [], status: 0, contentType: '', responseShape: null, blocked: true, reason: 'policy-block', via: 'fetch' },
];

test('attachToTab uses an existing tab and never creates or destroys a session', async () => {
  const client = fakeCamofoxClient({ events: SAMPLE });
  const collector = await attachToTab({ tabId: 'doctor-tab', userId: 'doctor-1', policy: POLICY, client });
  assert.equal(client.calls.some(([name]) => name === 'createTab'), false, 'attach must not create a tab');
  await collector.observe({ ms: 400 });
  const spec = collector.collect();
  assert.deepEqual(spec.events.map(e => `${e.origin}${e.path}`), [`${APP}/api/patients`, `${API}/api/v2/labs`]);
  assert.equal(spec.blockedEvents.length, 1);
  assert.equal(spec.blockedEvents[0].path, '/api/v2/orders');

  const result = await collector.detach();
  assert.deepEqual(result, { detached: true, closedTab: false, closedSession: false });
  assert.equal(client.calls.some(([name]) => name === 'closeTab'), false, "detach must not close the doctor's tab");
});

test('detaching a collector it does not own leaves the session; the owner closes what it created', async () => {
  const closed = [];
  const client = fakeCamofoxClient({ events: [] });
  client.closeSession = async (x) => { closed.push(x); };
  const owner = createCollector({ client, tabId: 't', userId: 'u', policy: POLICY, ownsTab: true, ownsSession: true });
  await owner.start();
  await owner.detach();
  assert.equal(closed.length, 1);
  assert.equal(client.calls.some(([name]) => name === 'closeTab'), true);
});

test('pause stops observation without tearing anything down; resume continues', async () => {
  const client = fakeCamofoxClient({ events: SAMPLE });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  collector.pause();
  await assert.rejects(() => collector.observe({ ms: 100 }), /paused/);
  assert.equal(client.calls.some(([name]) => name === 'closeTab'), false);
  collector.resume();
  await collector.observe({ ms: 100 });
  assert.equal(collector.collect().events.length, 2);
});

test('a replaced document is detected and the observer reinstalled', async () => {
  const client = fakeCamofoxClient({ events: SAMPLE, drainMode: 'gone-then-fresh' });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  await collector.observe({ ms: 400 });
  assert.equal(collector.reinstalls >= 1, true, 'a fresh document must trigger a reinstall');
  assert.equal(collector.collect().events.length, 2);
});

test('a detached collector refuses further work', async () => {
  const client = fakeCamofoxClient({ events: [] });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  await collector.detach();
  await assert.rejects(() => collector.observe({ ms: 10 }), /detached/);
  await assert.rejects(() => collector.start(), /detached/);
});

test('collected events are re-sanitized server-side: hostile keys cannot ride back over the wire', async () => {
  const hostileShape = JSON.parse('{"type":"object","keys":{"__proto__":{"type":"object","keys":{"polluted":"boolean"}},"mrn":"string","drug":"string"}}');
  const client = fakeCamofoxClient({ events: [{ method: 'GET', path: '/api/patients', origin: APP, queryKeys: ['mrn', 'page'], status: 200, contentType: 'application/json', responseShape: hostileShape }] });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  await collector.observe({ ms: 100 });
  const [event] = collector.collect().events;
  assert.deepEqual(Object.keys(event.responseShape.keys), ['drug']);
  assert.deepEqual(event.queryKeys, ['page'], 'sensitive and id-ish query keys are dropped');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('an unsanitizable observation is rejected outright, not partially kept', async () => {
  const client = fakeCamofoxClient({ events: [
    { method: 'GET', path: '/api/patients', origin: APP, queryKeys: [], status: 200, contentType: 'application/json', responseShape: { type: 'object', keys: { bad: ['not', 'a', 'shape'] } } },
    { method: 'GET', path: '/api/v2/labs', origin: API, queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
  ] });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  await collector.observe({ ms: 100 });
  const spec = collector.collect();
  assert.equal(spec.events.length, 1);
  assert.equal(spec.events[0].path, '/api/v2/labs');
});

test('event count is bounded', async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ method: 'GET', path: `/api/patients?i=${i}`.split('?')[0], origin: APP, queryKeys: [], status: 200, contentType: 'application/json', responseShape: null }));
  const client = fakeCamofoxClient({ events: many });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client, maxEvents: 25 });
  await collector.observe({ ms: 100 });
  assert.equal(collector.collect().events.length, 25);
});

test('invalid transport data fails closed', async () => {
  const client = fakeCamofoxClient({ events: [] });
  client.evaluate = async (x) => (String(x.expression).startsWith('mw:JSON.stringify(window.__SMD')
    ? { result: 'not json' }
    : { result: JSON.stringify({ installed: true, fresh: true, installId: 'i' }) });
  const collector = await attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client });
  await assert.rejects(() => collector.observe({ ms: 100 }), /invalid discovery data/);
});

test('an observer that will not install is an error, never a silent empty result', async () => {
  const client = fakeCamofoxClient({ events: [] });
  client.evaluate = async () => ({ result: '' });
  await assert.rejects(() => attachToTab({ tabId: 't', userId: 'u', policy: POLICY, client }), /did not install/);
});

// ---------------------------------------------------------------------------------------------
// Bounded exploration
// ---------------------------------------------------------------------------------------------
const SNAPSHOT = [
  '- link "Worklist" [ref=e1]',
  '- button "Open patient summary" [ref=e2]',
  '- button "Sign out" [ref=e9]',
  '- button "Export all patients" [ref=e10]',
  '- link "Discharge patient" [ref=e11]',
  '- generic "not clickable" [ref=e12]',
].join('\n');

test('exploration honours the step cap and skips destructive-looking controls', async () => {
  const client = fakeCamofoxClient({ events: SAMPLE.slice(0, 2), snapshots: [SNAPSHOT] });
  const result = await exploreReadWorkflows({ client, tabId: 't', userId: 'u', policy: POLICY, maxSteps: 1, stepWaitMs: 50 });
  assert.equal(result.steps.length, 1);
  assert.equal(result.stopReason, 'step-cap');
  const clicked = client.calls.filter(([name]) => name === 'click').map(([, x]) => x.ref);
  assert.deepEqual(clicked, ['e1']);
});

test('exploration stops at the time cap and never clicks sign-out, export or discharge', async () => {
  const client = fakeCamofoxClient({ events: [], snapshots: [SNAPSHOT] });
  const result = await exploreReadWorkflows({ client, tabId: 't', userId: 'u', policy: POLICY, maxSteps: 50, maxMs: 0, stepWaitMs: 10 });
  assert.equal(result.stopReason, 'time-cap');
  assert.equal(result.steps.length, 0);
});

test('exploration stops immediately when the in-page guard reports a block', async () => {
  const client = fakeCamofoxClient({ events: [SAMPLE[3]], snapshots: [SNAPSHOT] });
  const result = await exploreReadWorkflows({ client, tabId: 't', userId: 'u', policy: POLICY, maxSteps: 10, stepWaitMs: 20 });
  assert.equal(result.stopReason, 'policy-block-observed');
  assert.equal(result.steps.length, 1);
  assert.equal(result.blockedEvents.length, 1);
});

test('exploration stops if the page has left the approved scope', async () => {
  const client = fakeCamofoxClient({ events: [], snapshots: [SNAPSHOT] });
  const inner = client.evaluate;
  client.evaluate = async (x) => (x.expression === 'mw:location.href' ? { result: 'https://evil.example/x' } : inner(x));
  const result = await exploreReadWorkflows({ client, tabId: 't', userId: 'u', policy: POLICY, maxSteps: 5, stepWaitMs: 10 });
  assert.equal(result.stopReason, 'left-approved-scope:origin-not-approved');
  assert.equal(client.calls.some(([name]) => name === 'click'), false);
});

test('exploration refuses to run without a policy', async () => {
  await assert.rejects(() => exploreReadWorkflows({ client: fakeCamofoxClient(), tabId: 't', userId: 'u' }), /requires a policy/);
});

test('discoverAuthorizedEmr still works and enforces the policy when one is given', async () => {
  const client = fakeCamofoxClient({ events: SAMPLE });
  const spec = await discoverAuthorizedEmr({
    startUrl: `${APP}/worklist`, allowedOrigins: [APP, API], userId: 'u', sessionKey: 's', client, policy: POLICY, waitMs: 400,
  });
  assert.equal(spec.events.length, 2);
  assert.equal(spec.blockedEvents.length, 1);
  const installExpression = client.calls.find(([name, x]) => name === 'evaluate' && String(x.expression).startsWith('mw:(function'))[1].expression;
  assert.ok(installExpression.includes('"enforce":true'), 'the guard must be armed in the agent phase');
});
