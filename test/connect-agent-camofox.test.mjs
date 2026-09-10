import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAuthorizedEmr } from '../connect-agent/discovery.mjs';
import { fakeCamofoxClient } from './connect-agent/fake-camofox-client.mjs';

const DEFAULT_EVENTS = [
  { method: 'GET', path: '/api/patients', queryKeys: ['q'], status: 200, contentType: 'application/json', responseShape: { type: 'object', keys: { items: { type: 'array', sample: { type: 'object', keys: { id: 'string' } } } } } },
  { method: 'GET', path: 'https://evil.example/api/secret', queryKeys: [], status: 200, contentType: 'application/json', responseShape: { type: 'object', keys: {} } },
];

function fakeClient(events = DEFAULT_EVENTS) { return fakeCamofoxClient({ events }); }

test('Camofox discovery requires explicit origin allowlist', async () => {
  await assert.rejects(() => discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login',
    allowedOrigins: ['https://other.example'],
    userId: 'doctor-test',
    sessionKey: 'ephemeral-test',
    client: fakeClient(),
  }), /startUrl origin is not authorized/);
});

test('Camofox discovery returns only allowlisted interface metadata', async () => {
  const client = fakeClient();
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login',
    allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test',
    sessionKey: 'ephemeral-test',
    client,
  });
  assert.equal(result.browser, 'camofox');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].path, '/api/patients');
  assert.equal(client.calls.at(-1)[0], 'closeTab');
});

// KNOWN GAP, confirmed against a real running Camofox server (camofox-browser 1.14.0), not assumed:
// createTab({url}) already waits for that navigation to finish before returning, and a
// create-blank/evaluate/navigate reordering does NOT help - evaluate() runs in the current
// document and navigate() replaces it, so a value evaluate() just set is gone the instant navigate()
// resolves (verified: `window.__x = 1` set pre-navigate reads back as undefined post-navigate). The
// REST API has no init-script primitive. This pins that the code takes the only viable order given
// that constraint (evaluate after createTab-with-url) rather than a reordering that was tried and
// disproven live.
test('observer installs after the tab already navigated (the only order the transport allows)', () => {
  const client = fakeClient();
  return discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  }).then(() => {
    const [createTabCall, evaluateObserverCall] = client.calls;
    assert.equal(createTabCall[0], 'createTab');
    assert.equal(createTabCall[1].url, 'https://emr.example/login');
    assert.equal(evaluateObserverCall[0], 'evaluate');
    assert.ok(String(evaluateObserverCall[1].expression).startsWith('mw:(function SMD_CONNECT_OBSERVER'));
  });
});

// Without an explicit policy, discoverAuthorizedEmr() stays in legacy observe-only mode: the
// in-page guard is inert so nothing that already worked starts getting blocked. Enforcement is
// opt-in via `policy` (see test/connect-agent/discovery-lifecycle.test.mjs).
test('legacy discoverAuthorizedEmr() without a policy observes but does not enforce', async () => {
  const client = fakeClient();
  await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  const install = client.calls.find(([name, x]) => name === 'evaluate' && String(x.expression).startsWith('mw:(function'))[1].expression;
  assert.ok(install.includes('"enforce":false'));
});

// GAP. A path segment can itself be an identifier (/api/patients/482910/summary) even though no
// query value was ever recorded. Collapse it to a typed placeholder rather than persisting it.
test('discovery redacts identifier-shaped path segments and records an explicit origin', async () => {
  const client = fakeClient([
    { method: 'GET', path: '/api/patients/482910/summary', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
    { method: 'GET', path: '/api/encounters/9f1c2a3b-11ee-4a1a-8c7e-2b6b3d0a9f11', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
    // Caught in the live Camofox spike: a PREFIXED id (pt-482910) reached the spec unredacted.
    { method: 'GET', path: '/api/patients/pt-482910/medications', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
  ]);
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  assert.equal(result.events[0].path, '/api/patients/{id}/summary');
  assert.equal(result.events[0].origin, 'https://emr.example');
  assert.equal(result.events[1].path, '/api/encounters/{id}');
  assert.equal(result.events[2].path, '/api/patients/{id}/medications', 'a prefixed id (pt-482910) must be redacted too');
});

test('discovery drops events whose recorded origin is not allowlisted, even with a benign path', async () => {
  const client = fakeClient([
    { method: 'GET', path: '/api/patients', origin: 'https://evil.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
  ]);
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  assert.equal(result.events.length, 0);
});

// Multi-origin: the browser records every origin it sees and the SERVER filters. A second approved
// API origin must survive with its own provenance rather than being resolved against the first.
test('discovery keeps per-event provenance across multiple approved origins', async () => {
  const client = fakeClient([
    { method: 'GET', path: '/api/patients', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
    { method: 'GET', path: '/api/v2/labs', origin: 'https://api.emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
  ]);
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example', 'https://api.emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  assert.deepEqual(result.events.map(e => e.origin), ['https://emr.example', 'https://api.emr.example']);
});
