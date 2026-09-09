import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAuthorizedEmr } from '../connect-agent/discovery.mjs';

function fakeClient() {
  const calls = [];
  return {
    calls,
    async createTab(x) { calls.push(['createTab', x]); return { tabId: 'tab-1' }; },
    async evaluate(x) {
      calls.push(['evaluate', x]);
      if (String(x.expression).startsWith('JSON.stringify')) return { result: JSON.stringify([
        { method: 'GET', path: '/api/patients', queryKeys: ['q'], status: 200, contentType: 'application/json', responseShape: { type: 'object', keys: { items: { type: 'array', sample: { type: 'object', keys: { id: 'string' } } } } } },
        { method: 'GET', path: 'https://evil.example/api/secret', queryKeys: [], status: 200, contentType: 'application/json', responseShape: { type: 'object' } },
      ]) };
      return { result: '' };
    },
    async wait(x) { calls.push(['wait', x]); },
    async snapshot(x) { calls.push(['snapshot', x]); return { snapshot: 'Patient Search' }; },
    async closeTab(x) { calls.push(['closeTab', x]); },
  };
}

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

// GAP. A path segment can itself be an identifier (/api/patients/482910/summary) even though no
// query value was ever recorded. Collapse it to a typed placeholder rather than persisting it.
test('discovery redacts identifier-shaped path segments and records an explicit origin', async () => {
  const client = fakeClient();
  client.evaluate = async (x) => {
    client.calls.push(['evaluate', x]);
    if (String(x.expression).startsWith('JSON.stringify')) return { result: JSON.stringify([
      { method: 'GET', path: '/api/patients/482910/summary', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
      { method: 'GET', path: '/api/encounters/9f1c2a3b-11ee-4a1a-8c7e-2b6b3d0a9f11', origin: 'https://emr.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
    ]) };
    return { result: '' };
  };
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  assert.equal(result.events[0].path, '/api/patients/{id}/summary');
  assert.equal(result.events[0].origin, 'https://emr.example');
  assert.equal(result.events[1].path, '/api/encounters/{id}');
});

test('discovery drops events whose recorded origin is not allowlisted, even with a benign path', async () => {
  const client = fakeClient();
  client.evaluate = async (x) => {
    client.calls.push(['evaluate', x]);
    if (String(x.expression).startsWith('JSON.stringify')) return { result: JSON.stringify([
      { method: 'GET', path: '/api/patients', origin: 'https://evil.example', queryKeys: [], status: 200, contentType: 'application/json', responseShape: null },
    ]) };
    return { result: '' };
  };
  const result = await discoverAuthorizedEmr({
    startUrl: 'https://emr.example/login', allowedOrigins: ['https://emr.example'],
    userId: 'doctor-test', sessionKey: 'ephemeral-test', client,
  });
  assert.equal(result.events.length, 0);
});
