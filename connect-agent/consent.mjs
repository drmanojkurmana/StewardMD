import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const VERSION = 1;

function normalizeOrigin(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('EMR URL must use http(s)');
  return u.origin;
}

// The receipt's signature is server-owned proof of authorization, not a checksum: it must be
// keyed, or anyone holding a receipt (client, file, logs) can mint their own by rehashing an
// edited copy. Key comes from the caller or CONNECT_CONSENT_SIGNING_KEY; there is no unkeyed
// fallback because an unkeyed "signature" is worse than none - it looks verified but isn't.
function signingKeyOf(signingKey) {
  const key = signingKey ?? process.env.CONNECT_CONSENT_SIGNING_KEY;
  if (!key) throw new Error('Consent signing key not configured (CONNECT_CONSENT_SIGNING_KEY)');
  return key;
}

function signReceipt(receipt, signingKey) {
  const { signature, ...unsigned } = receipt;
  return createHmac('sha256', signingKeyOf(signingKey)).update(JSON.stringify(unsigned)).digest('hex');
}

export function createConsentReceipt({ actorId, hospitalName, emrUrl, scope, expiresAt, signingKey }) {
  if (!actorId || !hospitalName || !emrUrl) throw new Error('actorId, hospitalName and emrUrl are required');
  if (!Array.isArray(scope) || scope.length === 0) throw new Error('At least one scope is required');
  if (expiresAt !== undefined && expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) throw new Error('expiresAt is not a valid date');
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
  receipt.signature = signReceipt(receipt, signingKey);
  return Object.freeze(receipt);
}

export function assertConsent(receipt, requiredScope = [], { signingKey } = {}) {
  if (!receipt || receipt.credentialsProvidedToStewardMD !== false) throw new Error('Valid consent receipt required');
  const expected = Buffer.from(signReceipt(receipt, signingKey), 'hex');
  const actual = Buffer.from(String(receipt.signature || ''), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Consent receipt signature invalid');
  if (receipt.expiresAt) {
    const expiry = Date.parse(receipt.expiresAt);
    if (Number.isNaN(expiry)) throw new Error('Consent receipt has an invalid expiry date');
    if (Date.now() >= expiry) throw new Error('Consent receipt expired');
  }
  const allowed = new Set(receipt.scope || []);
  for (const item of requiredScope) if (!allowed.has(item)) throw new Error(`Consent scope missing: ${item}`);
  return true;
}
