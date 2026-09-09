#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { safeHeaders, safeUrl, responseSchema, requestSchema } from './redact.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

const root = String(args.url || '').trim();
if (!root) {
  console.error('Usage: node connect-agent/agent.mjs --url https://hospital-emr.example [--allow-origin https://sso.example]');
  process.exit(2);
}
const rootUrl = new URL(root);

const rl = createInterface({ input, output });
const answer = await rl.question(
  `I confirm I am authorized to integrate this EMR and authorize StewardMD Connect Agent to inspect only the approved origins for adapter discovery. Type YES to continue: `
);
rl.close();
if (answer.trim() !== 'YES') {
  console.error('Consent not confirmed. Discovery stopped.');
  process.exit(1);
}

const allowedOrigins = new Set([rootUrl.origin, ...String(args['allow-origin'] || '').split(',').map(s => s.trim()).filter(Boolean)]);
const targets = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json()).catch(() => []);
const target = targets.find(t => t.type === 'page' && [...allowedOrigins].some(o => t.url?.startsWith(o)));
if (!target?.webSocketDebuggerUrl) {
  console.error('No matching doctor-controlled page found. Launch Chrome with remote debugging and open the authorized EMR page.');
  process.exit(3);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
const events = [];
const requests = new Map();

ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }

  if (msg.method === 'Network.requestWillBeSent') {
    const p = msg.params;
    if (!['XHR', 'Fetch'].includes(p.type)) return;
    const safe = safeUrl(p.request?.url, rootUrl.href, allowedOrigins);
    if (!safe) return;
    requests.set(p.requestId, {
      url: safe,
      method: p.request?.method || 'GET',
      requestSchema: requestSchema(p.request?.postData || '')
    });
    return;
  }

  if (msg.method === 'Network.responseReceived') {
    const p = msg.params;
    if (!['XHR', 'Fetch'].includes(p.type)) return;
    const safe = safeUrl(p.response?.url, rootUrl.href, allowedOrigins);
    if (!safe) return;
    const req = requests.get(p.requestId) || { method: 'GET', requestSchema: { type: 'none' } };
    try {
      const body = await command('Network.getResponseBody', { requestId: p.requestId });
      events.push({
        url: safe,
        method: req.method,
        status: p.response?.status,
        mimeType: p.response?.mimeType || '',
        requestSchema: req.requestSchema,
        headers: safeHeaders(p.response?.headers || {}),
        responseSchema: responseSchema(body?.result?.body || '')
      });
    } catch {}
  }
};

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('cdp_timeout')); }
    }, 10000);
    timer.unref?.();
  });
}

await command('Network.enable');
await command('Page.enable');
console.log(`\nAttached to: ${target.title || target.url}`);
console.log(`Allowed origins: ${[...allowedOrigins].join(', ')}`);
console.log('Complete login and exercise the permitted patient/lab/medication/radiology workflows normally.');
console.log('The agent observes XHR/Fetch metadata and schemas only; it does not read passwords, cookies, auth headers, or raw response values into the output.');
console.log('Press ENTER when the workflows you want StewardMD to support have been exercised.');
const wait = createInterface({ input, output });
await wait.question('> ');
wait.close();

const unique = new Map();
for (const e of events) {
  const key = `${e.method}|${e.url}|${e.status}|${JSON.stringify(e.requestSchema)}|${JSON.stringify(e.responseSchema)}`;
  if (!unique.has(key)) unique.set(key, e);
}

const candidates = [...unique.values()].map((e, i) => ({ id: `candidate-${i + 1}`, ...e }));
const spec = {
  format: 'stewardmd-connect-adapter-draft/v2',
  generatedAt: new Date().toISOString(),
  origin: rootUrl.origin,
  allowedOrigins: [...allowedOrigins],
  consent: { confirmed: true, mode: 'local-doctor-controlled-browser' },
  capabilities: inferCapabilities(candidates),
  candidates,
  productionWrites: false,
  credentialsStored: false,
  rawResponsesStored: false,
  reviewRequired: true,
  humanApprovalRequired: true
};

await writeFile('adapter-spec.json', JSON.stringify(spec, null, 2) + '\n', { mode: 0o600 });
console.log(`\nDiscovery complete. Wrote ${candidates.length} sanitized interface candidates to adapter-spec.json.`);
console.log('No password, cookie, Authorization header, or raw patient response was written.');
console.log('Next: human review -> deterministic adapter implementation -> Connect SDK conformance -> production approval.');
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
