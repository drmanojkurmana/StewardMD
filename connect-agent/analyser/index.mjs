// CLI entry / orchestrator for the laboratory analyser connector: fetches analyser config
// from the server, starts a TCP listener or client per active analyser, decodes MLLP/ASTM
// traffic into per-specimen results, enqueues them durably, and drains the queue to the
// server's analyser-results endpoint. See connect-agent/README.md for the full contract.

import net from 'node:net';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as mllp from './mllp.mjs';
import * as astm from './astm.mjs';
import { createClient, loadConnectorKey, computeMessageId, classifyResultsResponse } from './client.mjs';
import { createQueue, drainOnce, backoffMs } from './queue.mjs';

function makeLogger(level = 'info') {
  const silent = level === 'silent';
  // Never log result values, specimen ids' associated data, or patient info - only counts,
  // analyser ids, message ids (truncated) and error codes.
  return (msg) => { if (!silent) console.log(`[analyser] ${new Date().toISOString()} ${msg}`); };
}

async function writeConfigCache(dataDir, data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'config-cache.json'), JSON.stringify(data, null, 2));
}

async function readConfigCache(dataDir) {
  try { return JSON.parse(await readFile(path.join(dataDir, 'config-cache.json'), 'utf8')); } catch { return null; }
}

async function enqueueSpecimen(ctx, analyser, protocol, spec) {
  const messageId = computeMessageId(analyser.id, spec.specimenId, spec.results);
  await ctx.queue.enqueue(messageId, {
    analyserId: analyser.id, messageId, protocol,
    specimenId: spec.specimenId, observedAt: spec.observedAt || null, results: spec.results,
  });
  ctx.log(`analyser ${analyser.id}: enqueued message ${messageId.slice(0, 12)} (${spec.results.length} results)`);
  return messageId;
}

async function fetchOrdersSafe(ctx, analyser, specimenIds) {
  try {
    const { status, body } = await ctx.client.getOrders(analyser.id, specimenIds);
    return status === 200 && body?.ok ? body.orders : null;
  } catch {
    return null;
  }
}

function handleMllpConnection(socket, analyser, ctx) {
  const decoder = mllp.createMllpDecoder();
  let chain = Promise.resolve();
  socket.on('data', (chunk) => {
    for (const msg of decoder.push(chunk)) {
      chain = chain
        .then(() => handleOneHl7Message(socket, msg, analyser, ctx))
        .catch((err) => ctx.log(`analyser ${analyser.id} mllp error: ${err.code || err.message}`));
    }
  });
  socket.on('error', () => {});
}

async function handleOneHl7Message(socket, msg, analyser, ctx) {
  let type;
  try { ({ type } = mllp.peekMessageType(msg)); } catch { return; } // unparsable: no MSH, can't ACK

  if (type === 'QRY' || type === 'QBP') {
    socket.write(mllp.encodeMllp(mllp.buildAck(msg, { ackCode: 'AR', textMessage: 'host query over HL7 is not supported by this connector' })));
    return;
  }
  if (type !== 'ORU') {
    socket.write(mllp.encodeMllp(mllp.buildAck(msg, { ackCode: 'AR', textMessage: `unsupported message type ${type}` })));
    return;
  }

  let oru;
  try { oru = mllp.parseOruR01(msg); } catch {
    socket.write(mllp.encodeMllp(mllp.buildAck(msg, { ackCode: 'AE', textMessage: 'unparsable ORU message' })));
    return;
  }
  if (oru.droppedResults) ctx.log(`analyser ${analyser.id}: dropped ${oru.droppedResults} non-final HL7 result(s)`);
  try {
    for (const spec of oru.specimens) await enqueueSpecimen(ctx, analyser, 'hl7', spec);
  } catch (err) {
    ctx.log(`analyser ${analyser.id}: enqueue failed, AE: ${err.code || err.message}`);
    socket.write(mllp.encodeMllp(mllp.buildAck(msg, { ackCode: 'AE', textMessage: 'queue write failed' })));
    return;
  }
  socket.write(mllp.encodeMllp(mllp.buildAck(msg, { ackCode: 'AA' })));
}

function handleAstmConnection(socket, analyser, ctx) {
  socket.on('error', () => {});
  (async () => {
    while (!socket.destroyed) {
      let droppedResults = 0;
      const rx = await astm.receiveTransmission(socket, {
        ...ctx.timeouts.astm,
        onBeforeComplete: async (records) => {
          if (astm.hasQueryRecord(records)) return { accept: true }; // handled after EOT below
          const extracted = astm.extractResults(records);
          droppedResults = extracted.droppedResults;
          try {
            for (const spec of extracted.specimens) await enqueueSpecimen(ctx, analyser, 'astm', spec);
            return { accept: true };
          } catch (err) {
            ctx.log(`analyser ${analyser.id}: enqueue failed, NAK final frame: ${err.code || err.message}`);
            return { accept: false };
          }
        },
      });
      // Only a closed socket ends the loop: an idle line, a stray byte or a busy instrument just waits for the next ENQ.
      if (!rx.ok) {
        if (rx.reason === 'closed') break;
        continue;
      }
      if (droppedResults) ctx.log(`analyser ${analyser.id}: dropped ${droppedResults} non-final ASTM result(s)`);
      if (analyser.hostQuery && astm.hasQueryRecord(rx.records)) {
        await astm.answerHostQuery(socket, rx.records, { fetchOrders: (ids) => fetchOrdersSafe(ctx, analyser, ids) });
      }
    }
    socket.end();
  })().catch((err) => ctx.log(`analyser ${analyser.id} astm loop error: ${err.code || err.message}`));
}

function startListener(analyser, ctx) {
  const onConn = (socket) => (analyser.protocol === 'hl7' ? handleMllpConnection : handleAstmConnection)(socket, analyser, ctx);

  if (analyser.transport === 'tcp-server') {
    const server = net.createServer(onConn);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(analyser.port, analyser.host || '0.0.0.0', () => {
        server.removeListener('error', reject);
        server.on('error', (err) => ctx.log(`analyser ${analyser.id} server error: ${err.code || err.message}`));
        resolve({ port: server.address().port, stop: () => new Promise((r) => server.close(r)) });
      });
    });
  }

  // tcp-client: connect out (serial-over-TCP converter), reconnect with backoff on drop.
  let stopped = false;
  let socket = null;
  let attempts = 0;
  let timer = null;
  const connect = () => {
    if (stopped) return;
    socket = net.connect({ host: analyser.host, port: analyser.port });
    socket.on('connect', () => { attempts = 0; onConn(socket); });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (stopped) return;
      attempts += 1;
      timer = setTimeout(connect, backoffMs(attempts));
      timer.unref?.();
    });
  };
  connect();
  return Promise.resolve({ stop: () => { stopped = true; if (timer) clearTimeout(timer); socket?.destroy(); } });
}

async function sendItem(client, item) {
  try {
    const { status, body } = await client.postResults({
      analyserId: item.analyserId, messageId: item.messageId, protocol: item.protocol,
      specimenId: item.specimenId, observedAt: item.observedAt, results: item.results,
    });
    return classifyResultsResponse(status, body, item.attempts);
  } catch {
    return { action: 'retry', delayMs: backoffMs(item.attempts + 1), error: 'network-error' };
  }
}

function validateConfig(config) {
  if (!config?.serverUrl) throw new Error('config.serverUrl is required');
  if (!config?.keyFile) throw new Error('config.keyFile is required');
  if (!config?.dataDir) throw new Error('config.dataDir is required');
}

export async function start(config, { fetchImpl = fetch } = {}) {
  validateConfig(config);
  const key = await loadConnectorKey(config.keyFile);
  const client = createClient({ serverUrl: config.serverUrl, key, fetchImpl, timeoutMs: config.timeouts?.httpMs ?? 15000 });
  const queue = createQueue(config.dataDir);
  await queue.init();
  const log = makeLogger(config.logLevel);
  const ctx = { client, queue, log, timeouts: { astm: config.timeouts?.astm || {} } };

  const listeners = new Map();
  let stopped = false;

  async function applyAnalysers(analysers) {
    const active = new Map(analysers.filter((a) => a.active).map((a) => [a.id, a]));
    for (const [id, entry] of listeners) {
      if (!active.has(id)) { await entry.stop(); listeners.delete(id); log(`analyser ${id}: stopped (inactive)`); }
    }
    for (const [id, a] of active) {
      if (listeners.has(id)) continue;
      try {
        const entry = await startListener(a, ctx);
        listeners.set(id, entry);
        log(`analyser ${id}: listening (${a.protocol}/${a.transport}${entry.port ? ` port ${entry.port}` : ''})`);
      } catch (err) {
        log(`analyser ${id}: failed to start listener: ${err.code || err.message}`);
      }
    }
  }

  async function refreshAnalysers() {
    try {
      const { status, body } = await client.getAnalyserConfig();
      if (status !== 200 || !body?.ok) throw new Error(`unexpected analyser-config response ${status}`);
      await writeConfigCache(config.dataDir, { analysers: body.analysers, pollSeconds: body.pollSeconds ?? 300 });
      await applyAnalysers(body.analysers);
      return body.pollSeconds ?? 300;
    } catch (err) {
      log(`analyser-config fetch failed: ${err.code || err.message}`);
      const cached = await readConfigCache(config.dataDir);
      if (cached) {
        log('using cached analyser config');
        await applyAnalysers(cached.analysers);
        return cached.pollSeconds ?? 300;
      }
      log('no cached analyser config; not opening listeners');
      return 300;
    }
  }

  const pollSeconds = await refreshAnalysers();
  const pollTimer = setInterval(() => { refreshAnalysers().catch((err) => log(`poll error: ${err.message}`)); }, pollSeconds * 1000);
  pollTimer.unref?.();

  // One drain at a time: a slow server must not make the next tick send the same item again.
  let draining = false;
  const drainTimer = setInterval(() => {
    if (draining) return;
    draining = true;
    drainOnce(queue, (item) => sendItem(client, item))
      .catch((err) => log(`drain error: ${err.message}`))
      .finally(() => { draining = false; });
  }, config.timeouts?.drainIntervalMs ?? 5000);
  drainTimer.unref?.();

  const statusTimer = setInterval(async () => {
    const counts = await queue.counts();
    log(`queue status: pending=${counts.pending} dead=${counts.dead}`);
  }, 5 * 60 * 1000);
  statusTimer.unref?.();

  const ports = {};
  for (const [id, entry] of listeners) if (entry.port) ports[id] = entry.port;

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(pollTimer);
    clearInterval(drainTimer);
    clearInterval(statusTimer);
    for (const [, entry] of listeners) await entry.stop();
    listeners.clear();
  }

  return { stop, ports, queue, client };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('Usage: node connect-agent/analyser/index.mjs --config <path>');
    process.exit(2);
  }
  const config = JSON.parse(await readFile(args[configIdx + 1], 'utf8'));
  const app = await start(config);
  const shutdown = () => { app.stop().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
