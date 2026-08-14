import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkProtocol } from '../kb/tools/validate-protocols.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'kb/schema/standard-protocol.schema.json'), 'utf8'));

// A real authored protocol: must pass clean.
const good = JSON.parse(
  readFileSync(join(ROOT, 'docs/superpowers/onco-protocols-v2/folfox-6.json'), 'utf8'),
);

test('good protocol passes', () => {
  assert.deepEqual(checkProtocol(schema, good), []);
});

test('ACTIVE with an unresolved VERIFY fails', () => {
  const bad = structuredClone(good);
  bad.status = 'ACTIVE';
  bad.verifyFields = []; // isolate the field-level VERIFY rule; histology is still "VERIFY"
  const errs = checkProtocol(schema, bad);
  assert.ok(errs.some((e) => e.includes('VERIFY')), errs.join('\n'));
});

test('endorsement string fails', () => {
  const bad = structuredClone(good);
  bad.provenanceNote = 'This regimen is NCCN-approved for all patients.';
  const errs = checkProtocol(schema, bad);
  assert.ok(errs.some((e) => e.toLowerCase().includes('endorsement')), errs.join('\n'));
});
