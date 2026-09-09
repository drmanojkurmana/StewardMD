import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const FORBIDDEN = /(^|\/)(password|credentials|secrets?|cookies?|tokens?|raw-?responses?|patient-?data)/i;
const WRITE_WORDS = /prescrib|order|delete|update|create.?patient|write.?back/i;

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

export function validateAdapterSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') errors.push('spec must be an object');
  if (!spec?.version) errors.push('missing version');
  if (!Array.isArray(spec?.events)) errors.push('events must be an array');
  if (Array.isArray(spec?.events)) for (const [i, e] of spec.events.entries()) {
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(String(e.method).toUpperCase())) errors.push(`events[${i}] invalid method`);
    if (FORBIDDEN.test(String(e.path || ''))) errors.push(`events[${i}] forbidden path`);
    if (WRITE_WORDS.test(JSON.stringify(e))) errors.push(`events[${i}] possible clinical write operation`);
  }
  if (spec?.credentials || spec?.cookies || spec?.password || spec?.authorization) errors.push('credential material present');
  return errors;
}

export async function approveAdapter({ specPath, approvalPath, approverId, hospitalName, scope = [] }) {
  if (!approverId || !hospitalName) throw new Error('approverId and hospitalName are required');
  const raw = await readFile(specPath, 'utf8');
  const spec = JSON.parse(raw);
  const errors = validateAdapterSpec(spec);
  if (errors.length) throw new Error(`Adapter cannot be approved:\n- ${errors.join('\n- ')}`);
  const approval = {
    version: 1,
    status: 'APPROVED_FOR_CONFORMANCE',
    approverId: String(approverId),
    hospitalName: String(hospitalName),
    scope: [...new Set(scope.map(String))],
    specSha256: digest(raw),
    approvedAt: new Date().toISOString(),
    productionEnabled: false,
  };
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, { mode: 0o600 });
  return approval;
}

export async function assertApprovalMatches({ specPath, approvalPath }) {
  const raw = await readFile(specPath, 'utf8');
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
  if (approval.status !== 'APPROVED_FOR_CONFORMANCE') throw new Error('Adapter is not approved for conformance');
  if (approval.productionEnabled !== false) throw new Error('Invalid approval state');
  if (approval.specSha256 !== digest(raw)) throw new Error('Adapter spec changed after approval');
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [specPath, approvalPath, approverId, hospitalName] = process.argv.slice(2);
  if (!specPath || !approvalPath || !approverId || !hospitalName) {
    console.error('Usage: node connect-agent/controller.mjs <spec.json> <approval.json> <approverId> <hospitalName>'); process.exit(2);
  }
  const approval = await approveAdapter({ specPath, approvalPath, approverId, hospitalName });
  console.log(JSON.stringify(approval, null, 2));
}
