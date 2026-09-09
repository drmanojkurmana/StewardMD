import { readFile, writeFile } from 'node:fs/promises';
import { createConsentReceipt, assertConsent } from './consent.mjs';
import { discoverAuthorizedEmr } from './discovery.mjs';
import { validateAdapterSpec } from './controller.mjs';

export async function runConnectPipeline({ client, actorId, hospitalName, emrUrl, scope, sessionKey, outDir = '.' }) {
  const consent = createConsentReceipt({ actorId, hospitalName, emrUrl, scope });
  assertConsent(consent, ['emr:discover']);
  const spec = await discoverAuthorizedEmr({
    startUrl: emrUrl,
    allowedOrigins: [new URL(emrUrl).origin],
    userId: actorId,
    sessionKey,
    client,
  });
  const errors = validateAdapterSpec(spec);
  if (errors.length) throw new Error(`Generated specification failed safety validation: ${errors.join('; ')}`);
  const safeSpec = { ...spec, consent: { receiptId: consent.receiptId, scope: consent.scope, emrOrigin: consent.emrOrigin } };
  await writeFile(`${outDir}/adapter-spec.json`, `${JSON.stringify(safeSpec, null, 2)}\n`, { mode: 0o600 });
  await writeFile(`${outDir}/consent-receipt.json`, `${JSON.stringify(consent, null, 2)}\n`, { mode: 0o600 });
  return { consent, spec: safeSpec, status: 'READY_FOR_HUMAN_REVIEW' };
}

export async function loadPipelineInputs(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
