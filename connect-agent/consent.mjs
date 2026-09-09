import { createHash, randomUUID } from 'node:crypto';

const VERSION = 1;

function normalizeOrigin(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('EMR URL must use http(s)');
  return u.origin;
}

export function createConsentReceipt({ actorId, hospitalName, emrUrl, scope, expiresAt }) {
  if (!actorId || !hospitalName || !emrUrl) throw new Error('actorId, hospitalName and emrUrl are required');
  if (!Array.isArray(scope) || scope.length === 0) throw new Error('At least one scope is required');
  const origin = normalizeOrigin(emrUrl);
  const receipt = {
    version: VERSION,
    receiptId: randomUUID(),
    actorId: String(actorId),
    hospitalName: String(hospitalName),
    emrOrigin: origin,
    scope: [...new Set(scope.map(String))],
    expiresAt: expiresAt || null,
    consentedAt: new Date().toISOString(),
    credentialsProvidedToStewardMD: false,
  };
  receipt.signature = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  return Object.freeze(receipt);
}

export function assertConsent(receipt, requiredScope = []) {
  if (!receipt || receipt.credentialsProvidedToStewardMD !== false) throw new Error('Valid consent receipt required');
  if (receipt.expiresAt && Date.now() >= Date.parse(receipt.expiresAt)) throw new Error('Consent receipt expired');
  const allowed = new Set(receipt.scope || []);
  for (const item of requiredScope) if (!allowed.has(item)) throw new Error(`Consent scope missing: ${item}`);
  return true;
}
