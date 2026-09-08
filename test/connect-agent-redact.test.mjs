import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin, safeHeaders, safeUrl, responseSchema, requestSchema } from '../connect-agent/redact.mjs';

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
  const allowed = new Set(['https://emr.example', 'https://sso.example']);
  assert.equal(safeUrl('https://sso.example/login?ticket=secret', 'https://emr.example', allowed), 'https://sso.example/login?<query>');
});

test('responseSchema keeps keys and types but not values', () => {
  const schema = responseSchema(JSON.stringify({ patient: { name: 'Alice', mrn: '123', age: 42 }, token: 'secret', rows: [{ value: 7 }] }));
  assert.equal(schema.type, 'object');
  assert.equal(schema.fields.patient.fields.name.type, 'string');
  assert.equal(schema.fields.patient.fields.age.type, 'number');
  assert.equal(schema.fields.token.type, 'redacted');
  assert.equal(schema.fields.rows.type, 'array');
});

test('requestSchema never preserves submitted credential values', () => {
  const json = requestSchema(JSON.stringify({ patientId: '123', password: 'dont-store', accessToken: 'secret' }));
  assert.equal(json.fields.patientId.type, 'string');
  assert.equal(json.fields.password.type, 'redacted');
  assert.equal(json.fields.accessToken.type, 'redacted');

  const form = requestSchema('patientId=123&password=dont-store&search=cardiology');
  assert.equal(form.fields.patientId.type, 'string');
  assert.equal(form.fields.password.type, 'redacted');
  assert.equal(form.fields.search.type, 'string');
});
