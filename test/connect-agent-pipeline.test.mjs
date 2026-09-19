import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createConsentReceipt, assertConsent } from '../connect-agent/consent.mjs';
import { validateAdapterSpec } from '../connect-agent/controller.mjs';

const signingKey = 'test-only-consent-signing-key';

test('consent receipt is scoped and explicitly non-credentialed', () => {
  const receipt = createConsentReceipt({ actorId: 'doctor-1', hospitalName: 'Test Hospital', emrUrl: 'https://emr.example.test/login', scope: ['emr:discover', 'emr:read'], signingKey });
  assert.equal(receipt.credentialsProvidedToStewardMD, false);
  assertConsent(receipt, ['emr:discover'], { signingKey });
  assert.throws(() => assertConsent(receipt, ['emr:write'], { signingKey }), /scope missing/);
});

test('consent receipt signature is keyed proof, not a checksum anyone can recompute', () => {
  const receipt = createConsentReceipt({ actorId: 'doctor-1', hospitalName: 'Test Hospital', emrUrl: 'https://emr.example.test/login', scope: ['emr:discover'], signingKey });
  // Forging a "signature" by rehashing an edited receipt (what an unkeyed digest allows) must fail.
  const tampered = { ...receipt, scope: ['emr:discover', 'emr:write'] };
  tampered.signature = createHash('sha256').update(JSON.stringify(tampered)).digest('hex');
  assert.throws(() => assertConsent(tampered, [], { signingKey }), /signature invalid/);
  // Wrong key must also fail even with an otherwise-correctly-shaped signature.
  assert.throws(() => assertConsent(receipt, [], { signingKey: 'wrong-key' }), /signature invalid/);
  // No key configured at all must fail closed, not silently accept.
  assert.throws(() => assertConsent(receipt, []), /signing key not configured/);
});

test('consent receipt rejects an invalid expiry date, not only an expired one', () => {
  assert.throws(() => createConsentReceipt({ actorId: 'doctor-1', hospitalName: 'Test Hospital', emrUrl: 'https://emr.example.test/login', scope: ['emr:discover'], expiresAt: 'not-a-date', signingKey }), /valid date/);
  const receipt = createConsentReceipt({ actorId: 'doctor-1', hospitalName: 'Test Hospital', emrUrl: 'https://emr.example.test/login', scope: ['emr:discover'], signingKey });
  const corrupted = { ...receipt, expiresAt: 'not-a-date' };
  corrupted.signature = createHmac('sha256', signingKey).update(JSON.stringify({ ...corrupted, signature: undefined })).digest('hex');
  assert.throws(() => assertConsent(corrupted, [], { signingKey }), /invalid expiry/);
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

// GAP. Legacy schema (v1, still the default) blocks a plain GET of /patients/1/medications because
// "medicat" matches its clinical-write keyword list - it can't tell a read of a clinical category
// from a write against it. v2 keeps blocking actual write verbs but not domain nouns on safe methods.
test('schema v2 separates read semantics (method) from clinical-domain keywords; v1 stays as-is', () => {
  const readMedications = { version: 1, allowedOrigins: ['https://emr.example.test'],
    events: [{ method: 'GET', path: '/api/patients/1/medications' }] };
  assert.ok(validateAdapterSpec(readMedications).length > 0, 'legacy v1 behavior is unchanged (still over-blocks)');
  assert.deepEqual(validateAdapterSpec(readMedications, { schemaVersion: 2 }), [], 'v2: a read of a clinical category is not a write');

  const writeMedication = { version: 1, allowedOrigins: ['https://emr.example.test'],
    events: [{ method: 'GET', path: '/api/patients/1/prescribe' }] };
  assert.ok(validateAdapterSpec(writeMedication, { schemaVersion: 2 }).length > 0, 'v2: an action verb still blocks regardless of method label');

  const postMedications = { version: 1, allowedOrigins: ['https://emr.example.test'], events: [{ method: 'POST', path: '/api/patients/1/medications' }] };
  assert.ok(validateAdapterSpec(postMedications, { schemaVersion: 2, allowWrites: true }).length > 0, 'v2: a domain noun on a non-safe method is still flagged');
});
