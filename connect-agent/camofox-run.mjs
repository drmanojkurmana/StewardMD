#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { discoverAuthorizedEmr } from './discovery.mjs';
import { writeFile } from 'node:fs/promises';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const startUrl = arg('url');
const sessionKey = process.env.CAMOFOX_SESSION_KEY || '';
const origins = arg('origins', startUrl ? new URL(startUrl).origin : '').split(',').map(s => s.trim()).filter(Boolean);
const output = arg('out', 'adapter-spec.json');
const userId = `smd-connect-${randomUUID()}`;

if (!startUrl || !sessionKey) {
  console.error('Usage: CAMOFOX_SESSION_KEY=<ephemeral-key> node connect-agent/camofox-run.mjs --url <EMR_URL> [--origins <origin,...>] [--out adapter-spec.json]');
  process.exit(2);
}

const result = await discoverAuthorizedEmr({ startUrl, allowedOrigins: origins, userId, sessionKey });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(`Discovery complete: ${output}`);
console.log(`Observed interfaces: ${result.events.length}`);
console.log('No clinician identity, EMR credentials, or page snapshots are persisted by this runner. Review the interface map before generation/approval.');
