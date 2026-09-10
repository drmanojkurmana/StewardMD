// Compiler tests: determinism, no invented endpoints, explicit unsupported capabilities, no raw values
// in the manifest, and the sandboxed `suggest` hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileManifest, COMPILER_VERSION } from '../../connect-agent/manifest/compile.mjs';
import { canonicalJson, validateManifest } from '../../connect-agent/manifest/schema.mjs';

const SPEC = JSON.parse(readFileSync(new URL('./fixtures/discovery-spec-v2.json', import.meta.url), 'utf8'));
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/emr-fixture.json', import.meta.url), 'utf8'));
const OPTS = { manifestId: 'synthetic-emr', timezone: 'Asia/Kolkata', generatedAt: '2026-09-10T00:00:00.000Z' };
const compile = (over = {}) => compileManifest(SPEC, { ...OPTS, ...over });

test('compilation is deterministic: same spec and options -> byte-identical manifest', async () => {
  const a = (await compile()).manifest;
  const b = (await compile()).manifest;
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.provenance.compilerVersion, COMPILER_VERSION);
  assert.match(a.provenance.discoverySpecHash, /^sha256:[0-9a-f]{64}$/);
});

test('every compiled operation corresponds to an observed request; nothing is invented', async () => {
  const { manifest } = await compile();
  const observed = new Set(SPEC.events.map((e) => `${e.method} ${e.path}`));
  for (const op of manifest.operations) {
    const redacted = op.pathTemplate.replace(/\{[^}]+\}/g, '{id}');
    assert.ok(observed.has(`${op.method} ${redacted}`), `${op.type} -> ${op.pathTemplate} was never observed`);
  }
  // list_notes was never seen, so it is simply absent - not synthesised from a sibling path.
  assert.equal(manifest.operations.some((o) => o.type === 'list_notes'), false);
});

test('an endpoint the compiler cannot justify becomes an explicit unsupported capability with a reason', async () => {
  const { manifest } = await compile();
  const reasons = Object.fromEntries(manifest.unsupported.map((u) => [u.observedPath ? `${u.capability} ${u.observedPath}` : u.capability, u.reason]));
  const find = (pathPart, capability) => manifest.unsupported.find((u) => u.capability === capability && String(u.observedPath).includes(pathPart));
  assert.ok(find('/discharge', 'non_read_endpoint'), 'a POST endpoint must be listed as non-read');
  assert.ok(find('/reports/render', 'non_json_endpoint'), 'an HTML endpoint must be listed as non-json');
  assert.ok(find('/settings/theme', 'unclassified_endpoint'), 'an unrecognised path must be listed, not guessed');
  assert.ok(find('/vitals', 'unverified_endpoint'), 'a 401-only observation is not evidence of a working read');
  for (const u of manifest.unsupported) assert.ok(u.reason && u.reason.length > 10, `unsupported entry needs a reason: ${canonicalJson(u)}`);
  assert.ok(Object.keys(reasons).length >= 4);
});

test('the manifest contains no observed values: only shape-derived key names', async () => {
  const { manifest } = await compile();
  const text = JSON.stringify(manifest);
  // Every literal value that appears in the read fixture must be absent from the manifest.
  const values = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string' && v.length > 3 && !/^(GET|HEAD|status|application\/json)$/.test(v)) values.push(v);
  };
  walk(Object.values(FIXTURE.routes).map((r) => r.body));
  const leaked = [...new Set(values)].filter((v) => text.includes(v));
  assert.deepEqual(leaked, [], `manifest leaked observed values: ${leaked.join(', ')}`);
  assert.equal(/cookie|authorization|password|token|session/i.test(text), false);
});

test('without a declared time zone every timestamp field is dropped into unsupported, never guessed', async () => {
  const { manifest } = await compile({ timezone: null });
  const results = manifest.operations.find((o) => o.type === 'list_results');
  assert.equal('effectiveDateTime' in results.mapping.fields, false);
  assert.ok(manifest.unsupported.some((u) => u.capability === 'list_results.effectiveDateTime' && /time zone/.test(u.reason)));
});

test('a result shape with no unit key yields no numeric value mapping', async () => {
  const spec = JSON.parse(JSON.stringify(SPEC));
  const results = spec.events.find((e) => e.path.endsWith('/results'));
  delete results.responseShape.keys.items.sample.keys.unit;
  const { manifest } = await compileManifest(spec, OPTS);
  const op = manifest.operations.find((o) => o.type === 'list_results');
  assert.equal('value.value' in op.mapping.fields, false);
  assert.ok(manifest.unsupported.some((u) => /unit key/.test(u.reason)));
});

test('pagination is derived only from observed query keys and is bounded', async () => {
  const { manifest } = await compile();
  const meds = manifest.operations.find((o) => o.type === 'list_medications');
  const allergies = manifest.operations.find((o) => o.type === 'list_allergies');
  assert.deepEqual(meds.pagination, { style: 'page', param: 'page', maxPages: 3, maxItems: 200 });
  assert.equal(allergies.pagination.style, 'none');
  assert.equal(allergies.pagination.maxPages, 1);
});

test('the suggest hook is fixture-backed and every proposal is re-validated', async () => {
  const seen = [];
  // Fixture-backed fake: no network, no model. It only ever receives the value-free shape plus the
  // caller's synthetic fixture, which is exactly the boundary the real hook would have.
  const suggest = async (input) => {
    seen.push(input);
    if (input.operationType !== 'list_encounters') return { fields: {} };
    return {
      fields: {
        // accepted: an unmapped canonical field whose selector exists in the shape
        'period.start': { op: 'toDate', path: 'start', timezone: 'Asia/Kolkata' },
        // rejected: references a key the observer never saw
        status: { op: 'pick', path: 'triageLevel' },
        // rejected: hostile field name (computed key, so it is a real own property)
        ['__proto__']: { op: 'pick', path: 'id' },
        // rejected: a literal outside the const allowlist (a value smuggling attempt)
        class: { op: 'const', value: 'Synthetic Testpatient' },
      },
    };
  };
  const { manifest, report } = await compileManifest(SPEC, { ...OPTS, timezone: null, suggest, fixtures: { list_encounters: FIXTURE.routes['GET /api/patients/pt-1/encounters'].body } });
  assert.deepEqual(validateManifest(manifest), []);
  for (const input of seen) {
    assert.equal('sanitizedShape' in input, true);
    assert.equal(JSON.stringify(input.sanitizedShape).includes('Synthetic'), false, 'the hook must only see a value-free shape');
  }
  const enc = manifest.operations.find((o) => o.type === 'list_encounters');
  assert.equal(enc.mapping.fields['period.start'].op, 'toDate');
  assert.equal(enc.suggested, true);
  assert.deepEqual(report.accepted.map((a) => a.field), ['period.start']);
  const rejected = Object.fromEntries(report.rejected.map((r) => [r.field, r.reason]));
  assert.match(rejected.status, /not present in the observed shape/);
  assert.match(rejected.class, /const allowlist/);
});

test('the suggest hook cannot introduce an operation, origin or method', async () => {
  const suggest = async () => ({
    fields: { id: { op: 'pick', path: 'id' } },
    operations: [{ type: 'list_notes', method: 'POST', pathTemplate: '/api/admin/export' }],
    origins: [{ id: 'origin:evil', origin: 'https://evil.example' }],
  });
  const { manifest } = await compileManifest(SPEC, { ...OPTS, suggest });
  assert.equal(manifest.origins.length, 1);
  assert.equal(manifest.operations.some((o) => o.type === 'list_notes'), false);
  assert.equal(manifest.operations.every((o) => o.method === 'GET'), true);
  assert.deepEqual(validateManifest(manifest), []);
});

test('a discovery spec of the wrong version is refused outright', async () => {
  await assert.rejects(() => compileManifest({ ...SPEC, version: 1 }, OPTS), /version 2/);
  await assert.rejects(() => compileManifest(SPEC, { ...OPTS, manifestId: '' }), /manifestId/);
});
