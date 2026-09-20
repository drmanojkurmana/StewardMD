// Pins the exact request shapes of the three server calls (client.mjs) and runs an
// end-to-end pass through index.mjs's exported start()/stop() against a mocked fetch and a
// real net connection standing in for an ASTM analyser.
// Run: node --test --test-concurrency=1 test/connect-agent/analyser-contract.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient, computeMessageId } from '../../connect-agent/analyser/client.mjs';
import { start } from '../../connect-agent/analyser/index.mjs';
import * as astm from '../../connect-agent/analyser/astm.mjs';

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'analyser-contract-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// --- request shape pinning -------------------------------------------------------------

test('messageId is deterministic: sha256 of analyserId\\nspecimenId\\ncanonical(results)', () => {
  const results = [{ instrumentCode: 'GLU', value: '98', unit: 'mg/dL', referenceRange: null, flags: null, status: 'final' }];
  const id1 = computeMessageId('A1', 'S1', results);
  const id2 = computeMessageId('A1', 'S1', [...results]); // same content, different array identity
  assert.equal(id1, id2);
  assert.equal(id1.length, 64);
  assert.match(id1, /^[0-9a-f]{64}$/);
  const reordered = [{ status: 'final', value: '98', flags: null, referenceRange: null, unit: 'mg/dL', instrumentCode: 'GLU' }];
  assert.equal(computeMessageId('A1', 'S1', reordered), id1, 'key order must not change the id');
  assert.notEqual(computeMessageId('A1', 'S2', results), id1);
});

test('getAnalyserConfig: GET, Authorization header, no body', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, json: async () => ({ ok: true, analysers: [], pollSeconds: 300 }) };
  };
  const client = createClient({ serverUrl: 'https://stewardmd.in', key: 'k1', fetchImpl });
  const { status, body } = await client.getAnalyserConfig();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://stewardmd.in/api/queue/lab-connector/analyser-config');
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer k1');
  assert.equal(calls[0].opts.body, undefined);
});

test('postResults: POST, JSON body with the contracted keys', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, json: async () => ({ ok: true, outcome: 'queued' }) };
  };
  const client = createClient({ serverUrl: 'https://stewardmd.in/', key: 'k1', fetchImpl });
  const payload = {
    analyserId: 'A1', messageId: 'm1', protocol: 'astm', specimenId: 'S1',
    observedAt: null, results: [{ instrumentCode: 'GLU', value: '98', unit: 'mg/dL', referenceRange: null, flags: null, status: 'final' }],
  };
  await client.postResults(payload);
  assert.equal(calls[0].url, 'https://stewardmd.in/api/queue/lab-connector/analyser-results');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer k1');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(calls[0].opts.body);
  assert.deepEqual(Object.keys(sent).sort(), ['analyserId', 'messageId', 'observedAt', 'protocol', 'results', 'specimenId'].sort());
  assert.equal(typeof sent.analyserId, 'string');
  assert.ok(Array.isArray(sent.results));
});

test('getOrders: POST, JSON body {analyserId, specimenIds}', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, json: async () => ({ ok: true, orders: [] }) };
  };
  const client = createClient({ serverUrl: 'https://stewardmd.in', key: 'k1', fetchImpl });
  await client.getOrders('A1', ['S1', 'S2']);
  assert.equal(calls[0].url, 'https://stewardmd.in/api/queue/lab-connector/analyser-orders');
  assert.equal(calls[0].opts.method, 'POST');
  const sent = JSON.parse(calls[0].opts.body);
  assert.deepEqual(sent, { analyserId: 'A1', specimenIds: ['S1', 'S2'] });
});

// --- end to end: index.mjs start()/stop() against mocked fetch + a real instrument socket ---

test('end-to-end: one ASTM tcp-server analyser receives a message and exactly one analyser-results POST is sent', async () => {
  await withTmpDir(async (dir) => {
    const keyFile = path.join(dir, 'key.txt');
    await writeFile(keyFile, 'test-connector-key\n');

    const postCalls = [];
    const fetchImpl = async (url, opts) => {
      if (url.endsWith('/analyser-config')) {
        return {
          status: 200,
          json: async () => ({
            ok: true,
            analysers: [{ id: 'A1', name: 'Test Analyser', protocol: 'astm', transport: 'tcp-server', host: '127.0.0.1', port: 0, hostQuery: false, active: true }],
            pollSeconds: 3600,
          }),
        };
      }
      if (url.endsWith('/analyser-results')) {
        postCalls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
        return { status: 200, json: async () => ({ ok: true, outcome: 'queued' }) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    };

    const app = await start({
      serverUrl: 'https://stewardmd.in', keyFile, dataDir: dir,
      timeouts: { drainIntervalMs: 50, astm: { enqTimeoutMs: 3000, frameTimeoutMs: 3000 } },
    }, { fetchImpl });

    try {
      const port = app.ports.A1;
      assert.ok(port > 0, 'the tcp-server analyser must report its bound port');

      const client = net.connect(port, '127.0.0.1');
      await new Promise((resolve) => client.once('connect', resolve));

      const records = [
        'H|\\^&|||INSTR|||||||P|1',
        'P|1||PT1',
        'O|1|SPEC1||^^^GLU|||||||||O',
        'R|1|^^^GLU|98|mg/dL|70-110|N||F|||20260910120000',
        'L|1|N',
      ];
      const sendResult = await astm.sendTransmission(client, records, { enqTimeoutMs: 3000, frameAckTimeoutMs: 3000 });
      assert.equal(sendResult.ok, true, 'the instrument must have received ACKs through to EOT');

      // Wait for the drain loop to pick the enqueued item up and POST it.
      const deadline = Date.now() + 5000;
      while (postCalls.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

      assert.equal(postCalls.length, 1, 'exactly one analyser-results POST');
      const [call] = postCalls;
      assert.equal(call.headers.Authorization, 'Bearer test-connector-key');
      assert.equal(call.body.analyserId, 'A1');
      assert.equal(call.body.protocol, 'astm');
      assert.equal(call.body.specimenId, 'SPEC1');
      assert.deepEqual(call.body.results, [
        { instrumentCode: 'GLU', value: '98', unit: 'mg/dL', referenceRange: '70-110', flags: 'N', status: 'final' },
      ]);

      client.destroy();
    } finally {
      await app.stop();
    }
  });
});
