import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const FORBIDDEN = /(^|\/)(password|passwd|credentials|secrets?|cookies?|tokens?|raw-?responses?|patient-?data|session|authorization|csrf|jwt)(\/|$)/i;
const SENSITIVE_KEY = /password|passwd|secret|cookie|token|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address|ssn|national.?id/i;
const WRITE_WORDS = /prescrib|medicat|order|delete|update|create.?patient|write.?back|allerg|diagnos|procedure|appointment|encounter|result.?entry/i;
const SAFE_METHODS = new Set(['GET', 'HEAD']);

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function containsSensitive(value, path = '$', findings = []) {
  if (findings.length >= 20) return findings;
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) findings.push(`${path}.${key}`);
      else containsSensitive(child, `${path}.${key}`, findings);
    }
  } else if (typeof value === 'string' && SENSITIVE_KEY.test(path)) {
    findings.push(path);
  }
  return findings;
}

export function validateAdapterSpec(spec, { allowWrites = false } = {}) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) errors.push('spec must be an object');
  if (!spec?.version) errors.push('missing version');
  if (!Array.isArray(spec?.events)) errors.push('events must be an array');
  if (!Array.isArray(spec?.allowedOrigins) || spec.allowedOrigins.length === 0) errors.push('allowedOrigins must be non-empty');
  if (Array.isArray(spec?.events)) for (const [i, e] of spec.events.entries()) {
    const method = String(e?.method || '').toUpperCase();
    if (!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method)) errors.push(`events[${i}] invalid method`);
    if (FORBIDDEN.test(String(e?.path || ''))) errors.push(`events[${i}] forbidden path`);
    if (!allowWrites && !SAFE_METHODS.has(method)) errors.push(`events[${i}] non-read operation requires explicit write approval`);
    if (WRITE_WORDS.test(`${e?.path || ''} ${JSON.stringify(e?.queryKeys || [])}`)) errors.push(`events[${i}] possible clinical write/sensitive operation`);
    if (containsSensitive(e).length) errors.push(`events[${i}] sensitive field metadata present`);
  }
  if (containsSensitive(spec).length) errors.push('sensitive credential/PHI metadata present');
  if (spec?.credentials || spec?.cookies || spec?.password || spec?.authorization) errors.push('credential material present');
  return [...new Set(errors)];
}

export async function approveAdapter({ specPath, approvalPath, approverId, hospitalName, scope = [], consentReceiptId, allowWrites = false }) {
  if (!approverId || !hospitalName) throw new Error('approverId and hospitalName are required');
  const raw = await readFile(specPath, 'utf8');
  const spec = JSON.parse(raw);
  const errors = validateAdapterSpec(spec, { allowWrites });
  if (errors.length) throw new Error(`Adapter cannot be approved:\n- ${errors.join('\n- ')}`);
  const approval = {
    version: 2,
    approvalId: randomUUID(),
    status: 'APPROVED_FOR_CONFORMANCE',
    approverId: String(approverId),
    hospitalName: String(hospitalName),
    consentReceiptId: consentReceiptId || spec?.consent?.receiptId || null,
    scope: [...new Set(scope.map(String))],
    allowWrites: Boolean(allowWrites),
    specSha256: digest(raw),
    approvedAt: new Date().toISOString(),
    productionEnabled: false,
    revokedAt: null,
  };
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, { mode: 0o600 });
  return approval;
}

export async function assertApprovalMatches({ specPath, approvalPath, requiredScope = [], requireReadOnly = true }) {
  const raw = await readFile(specPath, 'utf8');
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
  if (approval.status !== 'APPROVED_FOR_CONFORMANCE') throw new Error('Adapter is not approved for conformance');
  if (approval.productionEnabled !== false) throw new Error('Invalid approval state');
  if (approval.revokedAt) throw new Error('Adapter approval has been revoked');
  if (requireReadOnly && approval.allowWrites !== false) throw new Error('Write-enabled approval is not permitted by this gate');
  if (approval.specSha256 !== digest(raw)) throw new Error('Adapter spec changed after approval');
  const granted = new Set(approval.scope || []);
  for (const scope of requiredScope) if (!granted.has(scope)) throw new Error(`Approval scope missing: ${scope}`);
  return true;
}

export async function revokeApproval({ approvalPath, reason = 'revoked by controller' }) {
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
  approval.status = 'REVOKED';
  approval.revokedAt = new Date().toISOString();
  approval.revocationReason = String(reason).slice(0, 500);
  approval.productionEnabled = false;
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, { mode: 0o600 });
  return approval;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [specPath, approvalPath, approverId, hospitalName] = process.argv.slice(2);
  if (!specPath || !approvalPath || !approverId || !hospitalName) {
    console.error('Usage: node connect-agent/controller.mjs <spec.json> <approval.json> <approverId> <hospitalName>'); process.exit(2);
  }
  const approval = await approveAdapter({ specPath, approvalPath, approverId, hospitalName });
  console.log(JSON.stringify(approval, null, 2));
}
