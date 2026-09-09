#!/usr/bin/env node
import { discoverAuthorizedEmr } from './discovery.mjs';
import { writeFile } from 'node:fs/promises';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const startUrl = arg('url');
const userId = arg('user');
const sessionKey = arg('session');
const origins = arg('origins', startUrl ? new URL(startUrl).origin : '').split(',').map(s => s.trim()).filter(Boolean);
const output = arg('out', 'adapter-spec.json');

if (!startUrl || !userId || !sessionKey) {
  console.error('Usage: node connect-agent/camofox-run.mjs --url <EMR_URL> --user <SESSION_OWNER> --session <EPHEMERAL_SESSION_KEY> [--origins <origin,...>] [--out adapter-spec.json]');
  process.exit(2);
}

const result = await discoverAuthorizedEmr({ startUrl, allowedOrigins: origins, userId, sessionKey });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(`Discovery complete: ${output}`);
console.log(`Observed interfaces: ${result.events.length}`);
console.log('No EMR credentials are persisted by this runner. Review the adapter spec before generation/approval.');
