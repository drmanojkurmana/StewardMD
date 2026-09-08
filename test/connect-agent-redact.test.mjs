import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin, safeHeaders, safeUrl, responseSchema } from '../connect-agent/redact.mjs';

test('sameOrigin only accepts the exact scheme+host', () => {
  assert.equal(sameOrigin('https://emr.example/patients', 'https://emr.example/login'), true);
  assert.equal(sameOrigin('https://evil.example/patients', 'https://emr.example/login'), false);
  assert.equal(sameOrigin('http://emr.example/patients', 'https://emr.example/login'), false);
});

test('safeHeaders removes credential-bearing headers', () => {
  const out = safeHeaders({ Authorization: 'Bearer secret', Cookie: 'sid=secret', Accept: 'application/json' });
  assert.deepEqual(out, { accept: 'application/json' });
});

test('safeUrl strips query values and rejects cross-origin URLs', () => {
  assert.equal(safeUrl('https://emr.example/api/patient?id=123&name=John', 'https://emr.example'), 'https://emr.example/api/patient?<query>');
  assert.equal(safeUrl('https://evil.example/steal', 'https://emr.example'), null);
});

test('responseSchema keeps keys and types but not values', () => {
  const schema = responseSchema(JSON.stringify({ patient: { name: 'Alice', mrn: '123', age: 42 }, token: 'secret', rows: [{ value: 7 }] }));
  assert.equal(schema.type, 'object');
  assert.equal(schema.fields.patient.fields.name.type, 'string');
  assert.equal(schema.fields.patient.fields.age.type, 'number');
  assert.equal(schema.fields.token.type, 'redacted');
  assert.equal(schema.fields.rows.type, 'array');
});
