#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { sameOrigin, safeHeaders, safeUrl, responseSchema } from './redact.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

const root = String(args.url || '').trim();
if (!root) {
  console.error('Usage: node connect-agent/agent.mjs --url https://hospital-emr.example');
  process.exit(2);
}
const rootUrl = new URL(root);

const rl = createInterface({ input, output });
const answer = await rl.question(
  `I confirm I am authorized to integrate this EMR and authorize StewardMD Connect Agent to inspect only this origin (${rootUrl.origin}) for adapter discovery. Type YES to continue: `
);
rl.close();
if (answer.trim() !== 'YES') {
  console.error('Consent not confirmed. Discovery stopped.');
  process.exit(1);
}

const version = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json()).catch(() => null);
if (!version?.webSocketDebuggerUrl) {
  console.error('Chrome DevTools endpoint not found. Launch the doctor-controlled browser with remote debugging enabled.');
  process.exit(3);
}

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
const events = [];
const requests = new Map();
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Network.responseReceived') {
    const p = msg.params;
    const type = p.type;
    if (!['XHR', 'Fetch'].includes(type)) return;
    const safe = safeUrl(p.response?.url, rootUrl.href);
    if (!safe) return;
    requests.set(p.requestId, { url: safe, method: p.response?.requestHeadersText ? undefined : undefined, status: p.response?.status, mimeType: p.response?.mimeType });
    try {
      const body = await command('Network.getResponseBody', { requestId: p.requestId });
      events.push({
        url: safe,
        status: p.response?.status,
        mimeType: p.response?.mimeType || '',
        headers: safeHeaders(p.response?.headers || {}),
        schema: responseSchema(body?.result?.body || '')
      });
    } catch {}
  }
};

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp_timeout')); } }, 10000).unref?.();
  });
}

await command('Network.enable');
await command('Page.enable');
await command('Page.navigate', { url: rootUrl.href });
console.log('\nBrowser attached. Complete login and navigate the EMR normally.');
console.log('Only same-origin XHR/fetch response schemas are collected. Passwords, cookies, auth headers and raw response values are discarded.');
console.log('Press ENTER when you have exercised the patient/lab/medication/radiology workflows you want StewardMD to support.');
const wait = createInterface({ input, output });
await wait.question('> ');
wait.close();

const unique = new Map();
for (const e of events) {
  const key = `${e.url}|${e.status}|${JSON.stringify(e.schema)}`;
  if (!unique.has(key)) unique.set(key, e);
}

const candidates = [...unique.values()].map((e, i) => ({
  id: `candidate-${i + 1}`,
  url: e.url,
  status: e.status,
  mimeType: e.mimeType,
  responseSchema: e.schema
}));

const spec = {
  format: 'stewardmd-connect-adapter-draft/v1',
  generatedAt: new Date().toISOString(),
  origin: rootUrl.origin,
  consent: { confirmed: true, mode: 'local-doctor-controlled-browser' },
  capabilities: inferCapabilities(candidates),
  candidates,
  productionWrites: false,
  credentialsStored: false,
  rawResponsesStored: false,
  reviewRequired: true
};

await writeFile('adapter-spec.json', JSON.stringify(spec, null, 2) + '\n', { mode: 0o600 });
console.log(`\nDiscovery complete. Wrote ${candidates.length} sanitized interface candidates to adapter-spec.json.`);
console.log('No password, cookie, Authorization header, or raw patient response was written.');
console.log('Next step: human review -> adapter implementation -> conformance tests -> production approval.');
ws.close();

function inferCapabilities(items) {
  const text = JSON.stringify(items).toLowerCase();
  const has = (...words) => words.some(w => text.includes(w));
  return {
    patientSearch: has('patient', 'search'),
    demographics: has('demographic', 'dob', 'gender'),
    encounters: has('encounter', 'visit', 'admission'),
    labs: has('lab', 'investigation', 'result'),
    radiology: has('radiology', 'imaging', 'report'),
    medications: has('medication', 'medicine', 'drug'),
    diagnoses: has('diagnos'),
    notes: has('note', 'assessment', 'clinical'),
    writes: false
  };
}
