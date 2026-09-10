// Schema-layer tests: malformed manifests, hostile keys, prototype pollution, leak protection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateManifest, parseManifest, canonicalJson, manifestContentHash, findHostileKeys,
  OPERATION_TYPES, TRANSFORMS, MANIFEST_SCHEMA_VERSION,
} from '../../connect-agent/manifest/schema.mjs';
import { compileManifest } from '../../connect-agent/manifest/compile.mjs';

const SPEC = JSON.parse(readFileSync(new URL('./fixtures/discovery-spec-v2.json', import.meta.url), 'utf8'));
const OPTS = { manifestId: 'synthetic-emr', timezone: 'Asia/Kolkata', generatedAt: '2026-09-10T00:00:00.000Z' };
const good = async () => (await compileManifest(SPEC, OPTS)).manifest;
const clone = (v) => JSON.parse(JSON.stringify(v));

test('the schema pins schemaVersion 3, a fixed operation vocabulary and a closed transform set', () => {
  assert.equal(MANIFEST_SCHEMA_VERSION, 3);
  assert.deepEqual([...OPERATION_TYPES].sort(), [
    'get_patient_summary', 'list_allergies', 'list_encounters', 'list_medications',
    'list_notes', 'list_results', 'list_worklist',
  ]);
  assert.deepEqual([...TRANSFORMS].sort(), ['coalesce', 'const', 'map', 'pick', 'toDate', 'toNumber']);
});

test('a compiled manifest validates and its contentHash covers the body', async () => {
  const manifest = await good();
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.contentHash, manifestContentHash(manifest));
});

test('malformed manifests are rejected, not repaired', async () => {
  const base = await good();
  const cases = [
    [null, /plain object/],
    [{ ...clone(base), schemaVersion: 2 }, /schemaVersion/],
    [(() => { const m = clone(base); delete m.origins; return m; })(), /origins/],
    [(() => { const m = clone(base); m.surprise = 1; return m; })(), /unknown key/],
    [(() => { const m = clone(base); m.operations[0].method = 'POST'; return m; })(), /only GET and HEAD/],
    [(() => { const m = clone(base); m.operations[0].type = 'delete_patient'; return m; })(), /not a declared operation type/],
    [(() => { const m = clone(base); m.operations[0].originId = 'origin:elsewhere'; return m; })(), /not an approved origin/],
    [(() => { const m = clone(base); m.operations[0].pathTemplate = '/api/../admin'; return m; })(), /dot segments/],
    [(() => { const m = clone(base); m.origins[0].origin = 'https://evil.example/path'; return m; })(), /bare origin/],
    [(() => { const m = clone(base); m.contentHash = `sha256:${'0'.repeat(64)}`; return m; })(), /does not match/],
  ];
  for (const [manifest, pattern] of cases) {
    const errors = validateManifest(manifest);
    assert.ok(errors.length, `expected errors for ${pattern}`);
    assert.match(errors.join('\n'), pattern);
  }
});

test('missing mappings are an error: no id mapping, empty fields, unknown transform', async () => {
  const base = await good();
  const noId = clone(base);
  delete noId.operations[0].mapping.fields.id;
  assert.match(validateManifest(noId).join('\n'), /no 'id' mapping/);

  const empty = clone(base);
  empty.operations[0].mapping.fields = {};
  assert.match(validateManifest(empty).join('\n'), /at least one field mapping/);

  const bogus = clone(base);
  bogus.operations[0].mapping.fields.id = { op: 'javascript', src: 'process.exit(1)' };
  assert.match(validateManifest(bogus).join('\n'), /unknown transform/);
});

test('toDate must declare a real IANA zone and toNumber must declare a unit', async () => {
  const base = await good();
  const results = base.operations.find((o) => o.type === 'list_results');
  const badZone = clone(base);
  badZone.operations.find((o) => o.type === 'list_results').mapping.fields.effectiveDateTime.timezone = 'Mars/Olympus';
  assert.match(validateManifest(badZone).join('\n'), /not a known IANA zone/);

  assert.equal(results.mapping.fields.effectiveDateTime.op, 'toDate');
  assert.ok(results.mapping.fields.effectiveDateTime.timezone);
  assert.equal(results.mapping.fields['value.value'].op, 'toNumber');
  assert.ok(results.mapping.fields['value.value'].unit);
});

test('hostile keys and prototype pollution are refused', async () => {
  const base = await good();
  // A literal __proto__ member survives JSON.parse as an own property; findHostileKeys sees it.
  const poisoned = JSON.parse('{"schemaVersion":3,"__proto__":{"polluted":true}}');
  assert.ok(findHostileKeys(poisoned).length > 0);
  assert.match(validateManifest(poisoned).join('\n'), /hostile key/);

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const m = clone(base);
    m.operations[0].mapping.fields[key] = { op: 'pick', path: 'id' };
    assert.match(validateManifest(m).join('\n'), /hostile key/, `expected ${key} to be refused`);
  }
  // A selector that walks into a forbidden key is refused too.
  const walker = clone(base);
  walker.operations[0].mapping.fields.id = { op: 'pick', path: 'constructor.name' };
  assert.match(validateManifest(walker).join('\n'), /forbidden key/);
});

test('parseManifest drops __proto__ so reading a hostile artifact cannot pollute Object.prototype', () => {
  const parsed = parseManifest('{"a":1,"__proto__":{"polluted":"yes"}}');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
  assert.equal({}.polluted, undefined);
  assert.equal(parsed.a, 1);
});

test('a const literal can only carry an allowlisted canonical token, never an observed value', async () => {
  const base = await good();
  const leak = clone(base);
  leak.operations.find((o) => o.type === 'list_results').mapping.fields.category = { op: 'const', value: 'Synthetic Testpatient' };
  assert.match(validateManifest(leak).join('\n'), /const allowlist/);

  const table = clone(base);
  table.operations[0].mapping.fields.status = { op: 'map', path: 'status', table: { A: 'pt-1' } };
  assert.match(validateManifest(table).join('\n'), /const allowlist/);
});

test('canonicalJson is stable under key reordering, so hashes do not depend on serialization order', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});
