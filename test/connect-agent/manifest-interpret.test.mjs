// Interpreter tests: only declared URLs and methods, resource limits, session expiry, partial reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileManifest } from '../../connect-agent/manifest/compile.mjs';
import { executeOperation, buildUrl, ManifestPolicyError, ResourceLimitError, SessionExpiredError } from '../../connect-agent/manifest/interpret.mjs';
import { createFixtureExec } from '../../connect-agent/manifest/validate.mjs';

const SPEC = JSON.parse(readFileSync(new URL('./fixtures/discovery-spec-v2.json', import.meta.url), 'utf8'));
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/emr-fixture.json', import.meta.url), 'utf8'));
const OPTS = { manifestId: 'synthetic-emr', timezone: 'Asia/Kolkata', generatedAt: '2026-09-10T00:00:00.000Z' };
let manifest;
const load = async () => (manifest ||= (await compileManifest(SPEC, OPTS)).manifest);
const opOf = (type) => manifest.operations.find((o) => o.type === type);

test('a declared operation reads its declared pages and stops when the source is exhausted', async () => {
  await load();
  const exec = createFixtureExec(FIXTURE);
  const result = await executeOperation({ manifest, operationType: 'list_results', exec, params: { patientId: 'pt-1' } });
  assert.equal(result.itemCount, 3);
  assert.equal(result.partial, false);
  assert.deepEqual(exec.calls, [
    'GET /api/patients/pt-1/results?page=1',
    'GET /api/patients/pt-1/results?page=2',
    'GET /api/patients/pt-1/results?page=3',
  ]);
});

test('an undeclared operation type is refused', async () => {
  await load();
  await assert.rejects(
    () => executeOperation({ manifest, operationType: 'list_notes', exec: createFixtureExec(FIXTURE) }),
    ManifestPolicyError,
  );
});

test('a URL outside the declared template or origin cannot be constructed', async () => {
  await load();
  const op = opOf('list_medications');
  // Path traversal, absolute URLs and hostnames inside a placeholder are all rejected by the type pattern.
  for (const bad of ['../../admin', 'https://evil.example/x', 'pt-1/../../admin', 'pt 1', 'a'.repeat(200)]) {
    assert.throws(() => buildUrl(manifest, op, { params: { patientId: bad } }), ManifestPolicyError, `accepted ${bad}`);
  }
  assert.throws(() => buildUrl(manifest, op, { params: { patientId: 'pt-1', tenantId: 't1' } }), /not a placeholder/);
  assert.throws(() => buildUrl(manifest, op, { params: { patientId: 'pt-1' }, query: { format: 'csv' } }), /not allowed/);
  assert.throws(() => buildUrl(manifest, op, { params: {} }), /missing value/);
  assert.equal(buildUrl(manifest, op, { params: { patientId: 'pt-1' } }), 'http://127.0.0.1:8099/api/patients/pt-1/medications');
});

test('the interpreter never issues a method the manifest did not declare', async () => {
  await load();
  const methods = new Set();
  const exec = { async request({ method, url }) { methods.add(method); return createFixtureExec(FIXTURE).request({ method, url }); } };
  for (const op of manifest.operations) {
    const params = op.pathTemplate.includes('{patientId}') ? { patientId: 'pt-1' } : {};
    await executeOperation({ manifest, operationType: op.type, exec, params });
  }
  assert.deepEqual([...methods], ['GET']);
});

test('resource limits are enforced: calls, bytes and time', async () => {
  await load();
  const exec = createFixtureExec(FIXTURE);
  const capped = await executeOperation({ manifest, operationType: 'list_results', exec, params: { patientId: 'pt-1' }, limits: { maxCalls: 1 } });
  assert.equal(capped.calls, 1);
  assert.equal(capped.partial, true);
  assert.match(capped.warnings.join(';'), /call limit/);

  await assert.rejects(
    () => executeOperation({ manifest, operationType: 'list_results', exec: createFixtureExec(FIXTURE), params: { patientId: 'pt-1' }, limits: { maxBytes: 10 } }),
    ResourceLimitError,
  );

  let clock = 0;
  const slow = await executeOperation({
    manifest, operationType: 'list_results', exec: createFixtureExec(FIXTURE), params: { patientId: 'pt-1' },
    limits: { maxMs: 5 }, now: () => (clock += 10),
  });
  assert.equal(slow.partial, true);
  assert.match(slow.warnings.join(';'), /time limit/);
});

test('a session-expiry signal aborts the read instead of returning a half bundle', async () => {
  await load();
  const exec = { async request() { return { status: 401, body: { error: 'unauthenticated' } }; } };
  await assert.rejects(() => executeOperation({ manifest, operationType: 'list_results', exec, params: { patientId: 'pt-1' } }), SessionExpiredError);
});

test('a partial response is reported as partial and yields only the pages that arrived', async () => {
  await load();
  const broken = JSON.parse(JSON.stringify(FIXTURE));
  broken.routes['GET /api/patients/pt-1/results?page=2'] = { status: 500, body: { error: 'upstream' } };
  const result = await executeOperation({ manifest, operationType: 'list_results', exec: createFixtureExec(broken), params: { patientId: 'pt-1' } });
  assert.equal(result.partial, true);
  assert.equal(result.itemCount, 2);
  assert.match(result.warnings.join(';'), /status 500/);

  const thrown = JSON.parse(JSON.stringify(FIXTURE));
  thrown.routes['GET /api/patients/pt-1/results?page=2'] = { throws: 'socket hang up' };
  const r2 = await executeOperation({ manifest, operationType: 'list_results', exec: createFixtureExec(thrown), params: { patientId: 'pt-1' } });
  assert.equal(r2.partial, true);
  assert.match(r2.warnings.join(';'), /socket hang up/);
});

test('a hostile payload cannot pollute Object.prototype through the interpreter', async () => {
  await load();
  const hostile = { async request() { return { status: 200, bodyText: '{"items":[{"id":"x","__proto__":{"polluted":true}}]}' } ; } };
  const result = await executeOperation({ manifest, operationType: 'list_allergies', exec: hostile, params: { patientId: 'pt-1' } });
  assert.equal({}.polluted, undefined);
  assert.equal(result.pages[0].items.length, 1);
});
