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
