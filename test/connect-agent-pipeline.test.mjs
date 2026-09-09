import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsentReceipt, assertConsent } from '../connect-agent/consent.mjs';
import { validateAdapterSpec } from '../connect-agent/controller.mjs';

test('consent receipt is scoped and explicitly non-credentialed', () => {
  const receipt = createConsentReceipt({ actorId: 'doctor-1', hospitalName: 'Test Hospital', emrUrl: 'https://emr.example.test/login', scope: ['emr:discover', 'emr:read'] });
  assert.equal(receipt.credentialsProvidedToStewardMD, false);
  assertConsent(receipt, ['emr:discover']);
  assert.throws(() => assertConsent(receipt, ['emr:write']), /scope missing/);
});

test('adapter safety validator requires allowlisted origins and rejects writes by default', () => {
  const base = { version: 1, allowedOrigins: ['https://emr.example.test'], events: [{ method: 'GET', path: '/api/patients', responseShape: { type: 'object' } }] };
  assert.deepEqual(validateAdapterSpec(base), []);
  assert.ok(validateAdapterSpec({ ...base, credentials: { token: 'x' } }).length > 0);
  assert.ok(validateAdapterSpec({ ...base, events: [{ method: 'POST', path: '/api/patients' }] }).length > 0);
  assert.ok(validateAdapterSpec({ ...base, events: [{ method: 'GET', path: '/api/patients', queryKeys: ['mrn'] }] }).length > 0);
});

// REGRESSION. main went red on the assertion just above: containsSensitive() tested SENSITIVE_KEY
// against object keys and against the PATH of string leaves, never against a string leaf's VALUE. A
// spec names the identifiers it will read as values inside arrays, so `queryKeys: ['mrn']` sat under
// an innocent key at path `$.queryKeys.0` and was never seen. This pins the exact case, its siblings,
// and - so the fix cannot be a blanket refusal - that an ordinary spec still validates clean.
test('sensitive identifiers are detected as VALUES inside arrays, not only as keys or paths', () => {
  const base = { version: 1, allowedOrigins: ['https://emr.example.test'], events: [{ method: 'GET', path: '/api/patients', responseShape: { type: 'object' } }] };
  const withQuery = (queryKeys) => validateAdapterSpec({ ...base, events: [{ method: 'GET', path: '/api/patients', queryKeys }] });

  // The exact failure.
  assert.ok(withQuery(['mrn']).some((e) => /sensitive field metadata/.test(e)), 'queryKeys: [mrn] must be flagged as sensitive');
  // Siblings of the same shape: an identifier as a value under an innocent key.
  assert.ok(withQuery(['patientName']).length > 0);
  assert.ok(withQuery(['dob']).length > 0);
  assert.ok(validateAdapterSpec({ ...base, events: [{ method: 'GET', path: '/api/patients', fields: ['email'] }] }).length > 0);
  assert.ok(validateAdapterSpec({ ...base, events: [{ method: 'GET', path: '/api/patients', queryKeys: ['ward', 'mrn'] }] }).length > 0, 'one sensitive value among benign ones is enough');
  // Not weakened: a value that matches by KEY name alone is still caught, exactly as before.
  assert.ok(validateAdapterSpec({ ...base, events: [{ method: 'GET', path: '/api/patients', mrn: 'x' }] }).length > 0);
  // Not over-fitted: an ordinary read-only spec, and benign query keys, still validate clean.
  assert.deepEqual(validateAdapterSpec(base), []);
  assert.deepEqual(withQuery(['ward', 'bed', 'page']), []);
});
