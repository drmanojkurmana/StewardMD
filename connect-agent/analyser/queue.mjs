// Durable on-disk retry queue for analyser results awaiting POST to the server.
// dataDir/queue/pending/<messageId>.json holds items not yet delivered; dataDir/queue/dead/
// holds permanently failed ones. All state lives on disk, so a new createQueue(dataDir)
// after a restart sees whatever pending/ still has and resumes it (anything there is due).
//
// ponytail: drainOnce processes all due items strictly oldest-first across every analyser
// (a superset of "one at a time per analyser" - simpler, still correct). Upgrade to
// per-analyser concurrent lanes if a single slow POST target starts starving others.

import { mkdir, readdir, readFile, rename, rm, open, access } from 'node:fs/promises';
import path from 'node:path';

async function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(JSON.stringify(data, null, 2));
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, filePath);
  try {
    const dh = await open(path.dirname(filePath), 'r');
    try { await dh.sync(); } finally { await dh.close(); }
  } catch { /* directory fsync unsupported on this platform: best effort */ }
}

export function backoffMs(attempts, { base = 5000, factor = 2, cap = 600000 } = {}) {
  const raw = Math.min(cap, base * factor ** Math.max(0, attempts - 1));
  return Math.round(raw * (0.5 + Math.random() * 0.5)); // jitter: 50-100% of the raw delay
}

export function createQueue(dataDir) {
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  const deadDir = path.join(dataDir, 'queue', 'dead');
  const pendingPath = (id) => path.join(pendingDir, `${id}.json`);
  const deadPath = (id) => path.join(deadDir, `${id}.json`);

  return {
    async init() {
      await mkdir(pendingDir, { recursive: true });
      await mkdir(deadDir, { recursive: true });
    },

    async enqueue(messageId, payload) {
      const filePath = pendingPath(messageId);
      try { await access(filePath); return { created: false }; } catch { /* not present, proceed */ }
      const record = { messageId, ...payload, attempts: 0, nextAt: Date.now(), createdAt: new Date().toISOString(), lastError: null };
      await atomicWriteJson(filePath, record);
      return { created: true };
    },

    async listDue(now = Date.now()) {
      const files = await readdir(pendingDir).catch(() => []);
      const items = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try { items.push(JSON.parse(await readFile(path.join(pendingDir, f), 'utf8'))); } catch { /* skip corrupt/in-flight write */ }
      }
      return items.filter((it) => it.nextAt <= now).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async markAttempt(messageId, patch) {
      const filePath = pendingPath(messageId);
      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      await atomicWriteJson(filePath, { ...raw, ...patch });
    },

    async remove(messageId) {
      await rm(pendingPath(messageId), { force: true });
    },

    async deadLetter(messageId, { lastStatus, lastError }) {
      const raw = JSON.parse(await readFile(pendingPath(messageId), 'utf8'));
      await atomicWriteJson(deadPath(messageId), { ...raw, lastStatus, lastError, deadAt: new Date().toISOString() });
      await rm(pendingPath(messageId), { force: true });
    },

    async counts() {
      const [p, d] = await Promise.all([
        readdir(pendingDir).catch(() => []),
        readdir(deadDir).catch(() => []),
      ]);
      return { pending: p.filter((f) => f.endsWith('.json')).length, dead: d.filter((f) => f.endsWith('.json')).length };
    },
  };
}

// sender(item) -> { action: 'done'|'retry'|'dead', status?, error?, delayMs? }
export async function drainOnce(queue, sender, { now = Date.now() } = {}) {
  const due = await queue.listDue(now);
  const results = [];
  for (const item of due) {
    const outcome = await sender(item);
    if (outcome.action === 'done') await queue.remove(item.messageId);
    else if (outcome.action === 'dead') await queue.deadLetter(item.messageId, { lastStatus: outcome.status, lastError: outcome.error });
    else await queue.markAttempt(item.messageId, { attempts: item.attempts + 1, nextAt: Date.now() + (outcome.delayMs ?? backoffMs(item.attempts + 1)), lastError: outcome.error ?? null });
    results.push({ messageId: item.messageId, ...outcome });
  }
  return results;
}
