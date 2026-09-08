#!/usr/bin/env node
/**
 * StewardMD Connect Controller
 * Human-in-the-loop approval gate for sanitized adapter drafts.
 *
 * This controller never receives credentials or PHI. It operates on the
 * sanitized adapter-spec.json emitted by Connect Agent and creates a signed
 * local approval record. Production registration remains an explicit step.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const inputPath = process.argv[2] || 'adapter-spec.json';
const approvalPath = process.argv[3] || 'adapter-approval.json';

const spec = JSON.parse(await readFile(inputPath, 'utf8'));
if (spec.format !== 'stewardmd-connect-adapter-draft/v1') throw new Error('invalid_adapter_spec');
if (spec.consent?.confirmed !== true) throw new Error('missing_discovery_consent');
if (spec.productionWrites !== false) throw new Error('writes_must_be_disabled');
if (spec.credentialsStored !== false || spec.rawResponsesStored !== false) throw new Error('unsafe_spec');
if (!Array.isArray(spec.candidates) || spec.candidates.length === 0) throw new Error('no_discovered_interfaces');

const digest = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
console.log('\nStewardMD Connect Controller');
console.log('────────────────────────────────────────');
console.log(`Origin       : ${spec.origin}`);
console.log(`Candidates   : ${spec.candidates.length}`);
console.log(`Capabilities : ${Object.entries(spec.capabilities || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}`);
console.log(`Writes       : BLOCKED`);
console.log(`Credentials  : NOT STORED`);
console.log(`Raw PHI      : NOT STORED`);
console.log(`Spec SHA-256 : ${digest}`);
console.log('');

const rl = createInterface({ input, output });
const answer = await rl.question('Approve this adapter for conformance testing? Type APPROVE to continue: ');
rl.close();
if (answer.trim() !== 'APPROVE') {
  await writeFile(approvalPath, JSON.stringify({ format: 'stewardmd-connect-approval/v1', status: 'rejected', specSha256: digest, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Rejected. Wrote ${approvalPath}.`);
  process.exit(1);
}

const approval = {
  format: 'stewardmd-connect-approval/v1',
  approvalId: randomUUID(),
  status: 'approved-for-conformance',
  origin: spec.origin,
  specSha256: digest,
  approvedAt: new Date().toISOString(),
  approvedBy: process.env.USER || process.env.USERNAME || 'local-operator',
  productionWrites: false,
  credentialStorage: false,
  rawResponseStorage: false,
  productionEnabled: false,
  nextGate: 'conformance-tests'
};
await writeFile(approvalPath, JSON.stringify(approval, null, 2) + '\n', { mode: 0o600 });
console.log(`Approved for conformance only. Wrote ${approvalPath}.`);
console.log('Production remains DISABLED. Conformance and explicit production enablement are separate gates.');
