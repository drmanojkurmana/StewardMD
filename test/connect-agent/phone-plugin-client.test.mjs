// test/connect-agent/phone-plugin-client.test.mjs — unit tests for connect-agent/phone/plugin-client.mjs
// against a fake ConnectBrowser plugin (see local-plugins/capacitor-connect-browser/README.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPluginClient } from '../../connect-agent/phone/plugin-client.mjs';

function fakePlugin() {
  const calls = [];
  return {
    calls,
    async open(args) { calls.push(['open', args]); return { ok: true }; },
    async navigate(args) { calls.push(['navigate', args]); return { ok: true }; },
    async evaluate(args) { calls.push(['evaluate', args]); return { result: 'ok' }; },
    async currentUrl() { calls.push(['currentUrl']); return { url: 'https://emr.example/worklist', title: 'Worklist' }; },
    async setMode(args) { calls.push(['setMode', args]); return { ok: true }; },
    async drainRequests() { calls.push(['drainRequests']); return { requests: [] }; },
    async close() { calls.push(['close']); return { ok: true }; },
  };
}

test('createTab calls plugin.open with an initScript built from the observer source', async () => {
  const plugin = fakePlugin();
  const client = createPluginClient({ plugin, storeId: 'store-1', origins: ['https://emr.example'], title: 'EMR' });
  const { tabId } = await client.createTab({ url: 'https://emr.example/login' });
  assert.equal(tabId, 'phone');
  const [name, args] = plugin.calls[0];
  assert.equal(name, 'open');
  assert.equal(args.url, 'https://emr.example/login');
  assert.equal(args.storeId, 'store-1');
  assert.deepEqual(args.origins, ['https://emr.example']);
  assert.match(args.initScript, /SMD_CONNECT_OBSERVER/);
  assert.match(args.initScript, /"enforce":false/);
});

test('evaluate strips a leading mw: prefix before calling plugin.evaluate', async () => {
  const plugin = fakePlugin();
  const client = createPluginClient({ plugin, storeId: 's', origins: ['https://emr.example'] });
  await client.evaluate({ expression: 'mw:location.href' });
  const [, args] = plugin.calls[0];
  assert.equal(args.expression, 'location.href');
});

test('evaluate passes a plain expression through unchanged', async () => {
  const plugin = fakePlugin();
  const client = createPluginClient({ plugin, storeId: 's', origins: ['https://emr.example'] });
  await client.evaluate({ expression: 'document.title' });
  const [, args] = plugin.calls[0];
  assert.equal(args.expression, 'document.title');
});

test('click evaluates a __smd_refs lookup for the given ref', async () => {
  const plugin = fakePlugin();
  const client = createPluginClient({ plugin, storeId: 's', origins: ['https://emr.example'] });
  await client.click({ ref: 'e7' });
  const [, args] = plugin.calls[0];
  assert.match(args.expression, /__smd_refs\["e7"\]/);
});

test('snapshot evaluates the snapshot walker and returns {snapshot}', async () => {
  const plugin = fakePlugin();
  plugin.evaluate = async () => ({ result: '- link "Doctor" [ref=e1]' });
  const client = createPluginClient({ plugin, storeId: 's', origins: ['https://emr.example'] });
  const { snapshot } = await client.snapshot();
  assert.equal(snapshot, '- link "Doctor" [ref=e1]');
});

test('setMode, currentUrl and drainRequests pass through to the plugin', async () => {
  const plugin = fakePlugin();
  const client = createPluginClient({ plugin, storeId: 's', origins: ['https://emr.example'] });
  await client.setMode({ mode: 'agent', origins: ['https://emr.example'] });
  await client.currentUrl();
  await client.drainRequests();
  assert.deepEqual(plugin.calls.map((c) => c[0]), ['setMode', 'currentUrl', 'drainRequests']);
});

test('createPluginClient requires plugin, storeId and at least one origin', () => {
  assert.throws(() => createPluginClient({ storeId: 's', origins: ['https://x'] }));
  assert.throws(() => createPluginClient({ plugin: fakePlugin(), origins: ['https://x'] }));
  assert.throws(() => createPluginClient({ plugin: fakePlugin(), storeId: 's', origins: [] }));
});
