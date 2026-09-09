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

test('adapter safety validator rejects credential material and write-like discoveries', () => {
  assert.ok(validateAdapterSpec({ version: 1, events: [{ method: 'GET', path: '/api/patients', responseShape: { type: 'object' } }] }).length === 0);
  assert.ok(validateAdapterSpec({ version: 1, credentials: { token: 'x' }, events: [] }).length > 0);
  assert.ok(validateAdapterSpec({ version: 1, events: [{ method: 'POST', path: '/prescribe', responseShape: { type: 'object' } }] }).length > 0);
});
