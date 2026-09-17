// The three lab-connector server calls, plus connector-key loading and messageId
// determinism. fetchImpl is injectable for tests; every call times out via AbortSignal.timeout.

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { backoffMs } from './queue.mjs';

export async function loadConnectorKey(keyFile) {
  let raw;
  try {
    raw = await readFile(keyFile, 'utf8');
  } catch {
    throw new Error(`connector key file not found: ${keyFile}`);
  }
  const key = raw.trim();
  if (!key) throw new Error(`connector key file is empty: ${keyFile}`);
  try {
    const st = await stat(keyFile);
    if (st.mode & 0o077) console.warn(`connector key file ${keyFile} is readable by group/others (mode ${(st.mode & 0o777).toString(8)})`);
  } catch { /* best effort */ }
  return key;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeMessageId(analyserId, specimenId, results) {
  return createHash('sha256').update(`${analyserId}\n${specimenId}\n${canonicalJson(results)}`).digest('hex');
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function authHeaders(key, json) {
  const h = { Authorization: `Bearer ${key}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export function createClient({ serverUrl, key, fetchImpl = fetch, timeoutMs = 15000 }) {
  const base = serverUrl.replace(/\/$/, '');

  async function getAnalyserConfig() {
    const res = await fetchImpl(`${base}/api/queue/lab-connector/analyser-config`, {
      method: 'GET', headers: authHeaders(key, false), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await safeJson(res) };
  }

  async function postResults(payload) {
    const res = await fetchImpl(`${base}/api/queue/lab-connector/analyser-results`, {
      method: 'POST', headers: authHeaders(key, true), body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await safeJson(res) };
  }

  async function getOrders(analyserId, specimenIds) {
    const res = await fetchImpl(`${base}/api/queue/lab-connector/analyser-orders`, {
      method: 'POST', headers: authHeaders(key, true), body: JSON.stringify({ analyserId, specimenIds }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await safeJson(res) };
  }

  return { getAnalyserConfig, postResults, getOrders };
}

// Classify a POST .../analyser-results response into a queue outcome.
export function classifyResultsResponse(status, body, attempts) {
  if (status === 200 && body?.ok) return { action: 'done', outcome: body.outcome };
  if (status === 401 || status === 403) return { action: 'retry', delayMs: 300000, error: `credential-${status}` };
  if (status === 404 || status === 409 || status === 422) return { action: 'dead', status, error: body?.error || `http-${status}` };
  return { action: 'retry', delayMs: backoffMs(attempts + 1), error: `http-${status}` }; // 429, 5xx, anything else
}
