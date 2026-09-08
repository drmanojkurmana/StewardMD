import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

function validateApproval(spec, approval) {
  if (spec.format !== 'stewardmd-connect-adapter-draft/v1') throw new Error('invalid_adapter_spec');
  if (spec.consent?.confirmed !== true) throw new Error('missing_discovery_consent');
  if (spec.productionWrites !== false) throw new Error('writes_must_be_disabled');
  if (spec.credentialsStored !== false || spec.rawResponsesStored !== false) throw new Error('unsafe_spec');
  const digest = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  assert.equal(approval.specSha256, digest);
  assert.equal(approval.productionEnabled, false);
  assert.equal(approval.productionWrites, false);
}

test('approval is bound to the exact sanitized spec and cannot enable production', () => {
  const spec = {
    format: 'stewardmd-connect-adapter-draft/v1',
    consent: { confirmed: true },
    productionWrites: false,
    credentialsStored: false,
    rawResponsesStored: false,
    candidates: [{ url: 'https://emr.example/api/patient', status: 200 }]
  };
  const approval = {
    specSha256: createHash('sha256').update(JSON.stringify(spec)).digest('hex'),
    productionEnabled: false,
    productionWrites: false
  };
  validateApproval(spec, approval);
});

test('tampering with the spec invalidates its approval digest', () => {
  const spec = { format: 'stewardmd-connect-adapter-draft/v1', consent: { confirmed: true }, productionWrites: false, credentialsStored: false, rawResponsesStored: false, candidates: [] };
  const digest = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  spec.candidates.push({ url: 'https://emr.example/api/lab', status: 200 });
  assert.notEqual(createHash('sha256').update(JSON.stringify(spec)).digest('hex'), digest);
});
