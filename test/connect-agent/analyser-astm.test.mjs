// Tests for connect-agent/analyser/astm.mjs (ASTM E1381/E1394, CLSI LIS01-A2/LIS02-A2).
//
// Spec verified against:
// - https://www.medplum.com/docs/agent/astm-channels
//   -> concrete wire example "ENQ <-ACK- STX 1 H|\^&|||...CR ETX C1C2 CR LF <-ACK- ... EOT",
//      confirming ENQ/ACK/frame/ETB-ETX/checksum/CRLF/EOT framing.
// - https://twgenaux.github.io/MessageFormats/MessageFormats
//   -> checksum = modulo-256 sum of bytes from the frame number through ETX/ETB inclusive,
//      as two ASCII hex digits; delimiters declared in H.
// - https://twgenaux.github.io/ASTME1394MessagParsing/ASTME1394MessagParsing
//   -> record types H/P/O/R/C/Q/L, O field layout (O-3 specimen id, O-5 universal test id,
//      O-6 priority, O-26 report type) matching this file's field positions.
// - https://store.astm.org/e1381-95.html, https://store.astm.org/e1394-97.html
//   -> canonical standard identifiers.
// L-record codes N (normal) and I (no information available) were corroborated by secondary
// sources; see the header comment in astm.mjs for the caveat on the rest of the L-3 code set.
//
// Run: node --test --test-concurrency=1 test/connect-agent/analyser-astm.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as astm from '../../connect-agent/analyser/astm.mjs';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/analyser/sample.astm.txt');

// --- checksum, hand-computed independently of astm.mjs -------------------------------------

test('checksum matches a hand-computed value for a known frame', () => {
  const frameText = '1H|\\^&|||LIS|||||||P|1'; // frame-number digit '1' + the H record text
  const bytes = Buffer.concat([Buffer.from(frameText, 'ascii'), Buffer.from([astm.ETX])]);
  let sum = 0;
  for (const b of bytes) sum = (sum + b) % 256;
  const expected = sum.toString(16).toUpperCase().padStart(2, '0');
  assert.equal(astm.checksum(bytes), expected);
  // encodeFrame/decodeFrame round-trip and agree with the same value.
  const frame = astm.encodeFrame(1, 'H|\\^&|||LIS|||||||P|1', 'ETX');
  const decoded = astm.decodeFrame(frame);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.checksumOk, true);
  assert.equal(decoded.seq, 1);
  assert.equal(decoded.terminator, 'ETX');
  assert.equal(decoded.text, 'H|\\^&|||LIS|||||||P|1');
});

test('a corrupted checksum is detected', () => {
  const frame = Buffer.from(astm.encodeFrame(1, 'H|1', 'ETX'));
  frame[frame.length - 4] = frame[frame.length - 4] === 0x30 ? 0x31 : 0x30; // flip a checksum hex digit
  assert.equal(astm.decodeFrame(frame).checksumOk, false);
});

// --- frame numbering and record splitting -------------------------------------------------

test('frame numbers wrap 7 -> 0 -> 1', () => {
  let seq = 1;
  const seen = [seq];
  for (let i = 0; i < 8; i += 1) { seq = astm.nextFrameNumber(seq); seen.push(seq); }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 0, 1]);
});

test('a record longer than 240 chars is split into ETB frames and rejoined', () => {
  const long = 'X'.repeat(500);
  const frames = astm.frameRecords([long]);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].terminator, 'ETB');
  assert.equal(frames[1].terminator, 'ETB');
  assert.equal(frames[2].terminator, 'ETX');
  const rejoined = frames.map((f) => f.text).join('').replace(/\r$/, '');
  assert.equal(rejoined, long);
});

// --- E1394 record parsing / building --------------------------------------------------------

test('per-specimen result extraction from the ASTM fixture, dropping an X-status result', async () => {
  const raw = await readFile(FIXTURE, 'utf8');
  const records = raw.split('\r');
  const { specimens, droppedResults } = astm.extractResults(records);
  assert.equal(droppedResults, 1);
  assert.equal(specimens.length, 1);
  assert.equal(specimens[0].specimenId, 'SPEC001');
  assert.deepEqual(specimens[0].results, [
    { instrumentCode: 'GLU', value: '98', unit: 'mg/dL', referenceRange: '70-110', flags: 'N', status: 'final' },
    { instrumentCode: 'CREA', value: '1.1', unit: 'mg/dL', referenceRange: '0.6-1.3', flags: 'N', status: 'final' },
  ]);
});

test('a Q record triggers a host query; response is exactly H, P, O, L|1|N', () => {
  const incoming = ['H|\\^&|||INSTR|||||||P|1', 'Q|1|^SPEC001|||||||||O', 'L|1|N'];
  const specimenIds = astm.extractQuerySpecimenIds(incoming);
  assert.deepEqual(specimenIds, ['SPEC001']);
  assert.equal(astm.hasQueryRecord(incoming), true);

  const orders = [{ specimenId: 'SPEC001', priority: 'stat', tests: [{ instrumentCode: 'CODE' }, { instrumentCode: 'CODE2' }] }];
  const response = astm.buildQueryResponse(specimenIds, orders);
  assert.equal(response.length, 4);
  assert.match(response[0], /^H\|/);
  assert.equal(response[1], 'P|1');
  const oFields = response[2].split('|');
  assert.equal(oFields[0], 'O');
  assert.equal(oFields[2], 'SPEC001'); // O-3
  assert.equal(oFields[4], '^^^CODE\\^^^CODE2'); // O-5
  assert.equal(oFields[5], 'S'); // O-6: stat
  assert.equal(oFields[25], 'Q'); // O-26
  assert.equal(response[3], 'L|1|N');
});

test('server failure (or no order on record) answers the query with H then L|1|I', () => {
  const h = astm.buildHRecord();
  assert.deepEqual(astm.buildQueryResponse(['SPEC001'], null), [h, 'L|1|I']);
  assert.deepEqual(astm.buildQueryResponse(['SPEC-NONE'], [{ specimenId: 'OTHER', tests: [] }]), [h, 'L|1|I']);
});

test('R-13 becomes an ISO instant read as the laboratory clock, and a result with no value is not sent', () => {
  const { specimens, droppedResults } = astm.extractResults([
    'H|\\^&|||INSTR|||||||P|1', 'O|1|SPEC9||^^^K', 'R|1|^^^K|4.1|mmol/L||N||F||||20260916083000', 'R|2|^^^NA||mmol/L||N||F', 'L|1|N',
  ]);
  assert.equal(specimens[0].observedAt, new Date(2026, 8, 16, 8, 30, 0).toISOString());
  assert.deepEqual(specimens[0].results.map((r) => r.instrumentCode), ['K']);
  assert.equal(droppedResults, 1);
});

// --- receiver over a real localhost net socket ----------------------------------------------

test('ENQ/ACK/EOT over a real socket: instrument sends H,P,O,R,R,L split across frames', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const rxPromise = new Promise((resolve) => {
    server.once('connection', (socket) => {
      astm.receiveTransmission(socket, { enqTimeoutMs: 5000, frameTimeoutMs: 5000 }).then(resolve);
    });
  });

  const client = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));

  const records = [
    'H|\\^&|||INSTR|||||||P|1',
    'P|1||PT1',
    'O|1|SPEC1||^^^GLU|||||||||O',
    'R|1|^^^GLU|98|mg/dL|70-110|N||F|||20260910120000',
    'R|2|^^^CREA|1.1|mg/dL|0.6-1.3|N||F|||20260910120000',
    'L|1|N',
  ];
  const sendResult = await astm.sendTransmission(client, records, { enqTimeoutMs: 5000, frameAckTimeoutMs: 5000 });
  assert.equal(sendResult.ok, true);

  const rx = await rxPromise;
  assert.equal(rx.ok, true);
  assert.deepEqual(rx.records, records);

  client.destroy();
  await new Promise((resolve) => server.close(resolve));
});

test('receiver NAKs a bad checksum and accepts the retransmission', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const rxPromise = new Promise((resolve) => {
    server.once('connection', (socket) => {
      astm.receiveTransmission(socket, { enqTimeoutMs: 5000, frameTimeoutMs: 5000 }).then(resolve);
    });
  });

  const client = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  const received = [];
  client.on('data', (d) => received.push(...d));

  client.write(Buffer.from([astm.ENQ]));
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received.splice(0), [astm.ACK]);

  const good = astm.encodeFrame(1, 'H|\\^&|||INSTR|||||||P|1', 'ETX');
  const bad = Buffer.from(good);
  bad[bad.length - 4] = bad[bad.length - 4] === 0x30 ? 0x31 : 0x30;
  client.write(bad);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received.splice(0), [astm.NAK]);

  client.write(good); // retransmit the same (unmodified) frame
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received.splice(0), [astm.ACK]);

  client.write(good); // our ACK "lost": the instrument sends the same frame again; it is ACKed and kept once
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received.splice(0), [astm.ACK]);

  client.write(astm.encodeFrame(2, 'L|1|N', 'ETX'));
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received.splice(0), [astm.ACK]);

  client.write(Buffer.from([astm.EOT]));
  const rx = await rxPromise;
  assert.equal(rx.ok, true);
  assert.deepEqual(rx.records, ['H|\\^&|||INSTR|||||||P|1', 'L|1|N']);

  client.destroy();
  await new Promise((resolve) => server.close(resolve));
});

test('contention: both ends raising ENQ makes the host yield and receive instead', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const hostSendPromise = new Promise((resolve) => {
    server.once('connection', (socket) => {
      astm.sendTransmission(socket, ['H|\\^&|||LIS|||||||P|1', 'L|1|N'], {
        enqTimeoutMs: 3000, frameAckTimeoutMs: 3000, frameTimeoutMs: 3000,
      }).then(resolve);
    });
  });

  const client = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  const received = [];
  client.on('data', (d) => received.push(...d));

  // The "instrument" raises its own ENQ immediately (driven at the byte level, not through
  // sendTransmission - a real instrument's firmware is not this module).
  client.write(Buffer.from([astm.ENQ]));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(received.includes(astm.ACK), 'host must ACK the instrument ENQ instead of insisting on its own');

  client.write(astm.encodeFrame(1, 'H|\\^&|||INSTR|||||||P|1', 'ETX'));
  await new Promise((r) => setTimeout(r, 100));
  client.write(astm.encodeFrame(2, 'L|1|N', 'ETX'));
  await new Promise((r) => setTimeout(r, 100));
  client.write(Buffer.from([astm.EOT]));

  const hostResult = await hostSendPromise;
  assert.equal(hostResult.ok, false);
  assert.equal(hostResult.reason, 'contention');
  assert.deepEqual(hostResult.incoming.records, ['H|\\^&|||INSTR|||||||P|1', 'L|1|N']);

  client.destroy();
  await new Promise((resolve) => server.close(resolve));
});

// --- in-memory duplex pair, for a fast enqueue-gated-ACK check without a real socket --------

class LoopSocket extends EventEmitter {
  constructor() { super(); this.peer = null; this.destroyed = false; }
  write(buf) { queueMicrotask(() => { if (!this.destroyed) this.peer.emit('data', Buffer.from(buf)); }); return true; }
  end() { this.destroy(); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
  off(ev, fn) { this.removeListener(ev, fn); return this; }
}
function pair() {
  const a = new LoopSocket();
  const b = new LoopSocket();
  a.peer = b; b.peer = a;
  return [a, b];
}

test('receiveTransmission NAKs the terminator frame when onBeforeComplete rejects, and ACKs the retry', async () => {
  const [receiverSide, senderSide] = pair();
  let attempts = 0;
  const rxPromise = astm.receiveTransmission(receiverSide, {
    enqTimeoutMs: 2000,
    frameTimeoutMs: 2000,
    onBeforeComplete: async () => { attempts += 1; return { accept: attempts >= 2 }; }, // fail once, then accept
  });

  const records = ['H|\\^&|||INSTR|||||||P|1', 'L|1|N'];
  const sendResult = await astm.sendTransmission(senderSide, records, { enqTimeoutMs: 2000, frameAckTimeoutMs: 2000, maxRetries: 6 });
  assert.equal(sendResult.ok, true);
  const rx = await rxPromise;
  assert.equal(rx.ok, true);
  assert.equal(attempts, 2); // NAK'd once (simulated enqueue failure), then accepted on retransmit
  assert.deepEqual(rx.records, records);
});
