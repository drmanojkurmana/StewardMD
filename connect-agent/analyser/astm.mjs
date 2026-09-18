// ASTM E1381 (CLSI LIS01-A2) low-level transport, and ASTM E1394 (CLSI LIS02-A2) record
// parsing/building, for laboratory instruments.
//
// Verified against:
// - https://www.medplum.com/docs/agent/astm-channels
//     concrete wire example: "ENQ <-ACK- STX 1 H|\^&|||...CR ETX C1C2 CR LF <-ACK- ... EOT".
//     Confirms: ENQ/ACK establishment, STX + frame-number digit + text + ETX/ETB + 2-hex
//     checksum + CR LF framing, ETB for intermediate frames vs ETX for the last frame of a
//     record, EOT to end the transmission.
// - https://twgenaux.github.io/MessageFormats/MessageFormats
//     checksum = modulo-256 sum of bytes from the frame number through ETX/ETB inclusive
//     (STX, the checksum bytes themselves, and the trailing CR LF are excluded), rendered as
//     two ASCII hex digits; field/repeat/component/escape delimiters declared in H.
// - https://twgenaux.github.io/ASTME1394MessagParsing/ASTME1394MessagParsing
//     record types H/P/O/R/C/Q/L and O record field layout (O-3 specimen id, O-5 universal
//     test id, O-6 priority, O-26 report type) matching the field positions used below.
// - https://store.astm.org/e1381-95.html and https://store.astm.org/e1394-97.html
//     canonical standard identifiers (both later adopted/superseded by CLSI as LIS01-A2 and
//     LIS02-A2 respectively).
// L-record termination codes N (normal) and I (no information available) were corroborated
// via secondary sources; T/R/E/Q/F are implemented per this task's contract as no public
// secondary source spelled them out within the time available for this pass - see README.

import { toIso } from './mllp.mjs';

export const ENQ = 0x05;
export const ACK = 0x06;
export const NAK = 0x15;
export const STX = 0x02;
export const ETB = 0x17;
export const ETX = 0x03;
export const EOT = 0x04;
export const CR = 0x0d;
export const LF = 0x0a;

const MAX_FRAME_TEXT = 240;

export function checksum(bytesLike) {
  const buf = Buffer.isBuffer(bytesLike) ? bytesLike : Buffer.from(bytesLike, 'ascii');
  let sum = 0;
  for (const b of buf) sum = (sum + b) % 256;
  return sum.toString(16).toUpperCase().padStart(2, '0').slice(-2);
}

// Frame numbers cycle 1,2,3,4,5,6,7,0,1,... The first frame of a transfer is 1.
export function nextFrameNumber(seq) {
  if (seq === 7) return 0;
  if (seq === 0) return 1;
  return seq + 1;
}

export function encodeFrame(seq, text, terminator) {
  const termByte = terminator === 'ETX' ? ETX : ETB;
  const body = Buffer.concat([Buffer.from(String(seq), 'ascii'), Buffer.from(text, 'ascii'), Buffer.from([termByte])]);
  const sum = checksum(body);
  return Buffer.concat([Buffer.from([STX]), body, Buffer.from(sum, 'ascii'), Buffer.from([CR, LF])]);
}

// Decode a raw frame buffer that runs from STX through the trailing LF inclusive.
export function decodeFrame(buf) {
  if (buf.length < 6 || buf[0] !== STX || buf[buf.length - 1] !== LF || buf[buf.length - 2] !== CR) {
    return { ok: false, reason: 'malformed-frame' };
  }
  const termByte = buf[buf.length - 5];
  if (termByte !== ETX && termByte !== ETB) return { ok: false, reason: 'malformed-frame' };
  const checksumBytes = buf.subarray(buf.length - 4, buf.length - 2).toString('ascii').toUpperCase();
  const body = buf.subarray(1, buf.length - 4); // seq digit + text + terminator
  const checksumOk = checksum(body) === checksumBytes;
  const seqDigit = String.fromCharCode(buf[1]);
  const seq = /^[0-9]$/.test(seqDigit) ? Number(seqDigit) : null;
  return {
    ok: true,
    checksumOk,
    seq,
    text: buf.subarray(2, buf.length - 5).toString('ascii'),
    terminator: termByte === ETX ? 'ETX' : 'ETB',
  };
}

// Split records (strings, no trailing CR) into the frame texts a sender must transmit. Each
// record is CR-terminated; a record longer than maxText is split across several frames, all
// but the last carrying ETB, the last of that record carrying ETX. Frame numbers are assigned
// by the caller (they run across the whole transfer, not per record).
export function frameRecords(records, { maxText = MAX_FRAME_TEXT } = {}) {
  const frames = [];
  for (const record of records) {
    const text = `${record}\r`;
    let offset = 0;
    while (offset < text.length) {
      const chunk = text.slice(offset, offset + maxText);
      offset += maxText;
      frames.push({ text: chunk, terminator: offset >= text.length ? 'ETX' : 'ETB' });
    }
  }
  return frames;
}

// Streaming reader for the ASTM control byte / frame stream: feed raw TCP chunks, get back
// events ({type:'ENQ'|'ACK'|'NAK'|'EOT'} or {type:'FRAME', frame: decodeFrame(...)}). Handles
// chunks split mid-frame or containing several frames/control bytes.
export function createFrameReader() {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      const events = [];
      for (;;) {
        if (!buf.length) break;
        const b0 = buf[0];
        if (b0 === ENQ || b0 === ACK || b0 === NAK || b0 === EOT) {
          events.push({ type: b0 === ENQ ? 'ENQ' : b0 === ACK ? 'ACK' : b0 === NAK ? 'NAK' : 'EOT' });
          buf = buf.subarray(1);
          continue;
        }
        if (b0 === STX) {
          const lfIdx = buf.indexOf(LF, 1);
          if (lfIdx === -1) break; // incomplete frame, wait for more data
          events.push({ type: 'FRAME', frame: decodeFrame(buf.subarray(0, lfIdx + 1)) });
          buf = buf.subarray(lfIdx + 1);
          continue;
        }
        buf = buf.subarray(1); // discard stray byte
      }
      return events;
    },
  };
}

// Attach a frame-event reader to a socket-like duplex (net.Socket, or anything exposing
// on/off('data'|'close'|'end') and write()). Returns nextEvent(timeoutMs), which resolves
// with the next control/frame event, or {type:'TIMEOUT'} / {type:'CLOSED'} - never rejects,
// so callers can drive the state machine with plain checks instead of try/catch.
function attach(socket) {
  const reader = createFrameReader();
  const queue = [];
  let waiter = null;
  let closed = false;
  const deliver = (ev) => {
    if (waiter) { const w = waiter; waiter = null; w(ev); } else queue.push(ev);
  };
  const onData = (chunk) => { for (const ev of reader.push(chunk)) deliver(ev); };
  const onClose = () => { closed = true; deliver({ type: 'CLOSED' }); };
  socket.on('data', onData);
  socket.on('close', onClose);
  socket.on('end', onClose);
  function nextEvent(timeoutMs) {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve({ type: 'CLOSED' });
    return new Promise((resolve) => {
      const timer = timeoutMs ? setTimeout(() => { waiter = null; resolve({ type: 'TIMEOUT' }); }, timeoutMs) : null;
      if (timer?.unref) timer.unref();
      waiter = (ev) => { if (timer) clearTimeout(timer); resolve(ev); };
    });
  }
  function detach() {
    socket.off('data', onData);
    socket.off('close', onClose);
    socket.off('end', onClose);
  }
  return { nextEvent, detach };
}

async function receiveFrameLoop(io, socket, { frameTimeoutMs, onBeforeComplete }) {
  const records = [];
  let currentText = '';
  let expectedSeq = 1;
  let lastAccepted = null;
  for (;;) {
    const ev = await io.nextEvent(frameTimeoutMs);
    if (ev.type === 'EOT') return { ok: true, records };
    if (ev.type === 'TIMEOUT' || ev.type === 'CLOSED') return { ok: false, reason: ev.type.toLowerCase(), records };
    if (ev.type !== 'FRAME') { socket.write(Buffer.from([NAK])); continue; }
    const f = ev.frame;
    // The same good frame again means our ACK was lost: acknowledge it and keep only the first copy.
    if (f.ok && f.checksumOk && lastAccepted && f.seq === lastAccepted.seq && f.text === lastAccepted.text) { socket.write(Buffer.from([ACK])); continue; }
    if (!f.ok || !f.checksumOk || f.seq !== expectedSeq) { socket.write(Buffer.from([NAK])); continue; }
    const text = currentText + f.text;
    const isRecordEnd = f.terminator === 'ETX';
    const completedRecord = isRecordEnd ? text.replace(/\r$/, '') : null;
    const isFinalRecord = isRecordEnd && completedRecord.startsWith('L');
    if (isFinalRecord && onBeforeComplete) {
      // The transmission's terminator (L) record is where the whole message is known: only
      // ACK it once the application has durably enqueued the results it carries. If that
      // fails, NAK instead - the instrument keeps the result and retransmits this frame.
      const verdict = await onBeforeComplete([...records, completedRecord]);
      if (!verdict?.accept) { socket.write(Buffer.from([NAK])); continue; }
    }
    currentText = isRecordEnd ? '' : text;
    if (isRecordEnd) records.push(completedRecord);
    lastAccepted = { seq: f.seq, text: f.text };
    expectedSeq = nextFrameNumber(expectedSeq);
    socket.write(Buffer.from([ACK]));
  }
}

// Act as the ASTM receiver: wait for ENQ, ACK (or NAK if busy) it, read frames until EOT,
// NAKing bad checksums/out-of-sequence frames (the sender retransmits), and return the
// reconstructed records. `busy` answers ENQ with NAK per spec.
export async function receiveTransmission(socket, opts = {}) {
  const { enqTimeoutMs = 30000, frameTimeoutMs = 30000, busy = false, onBeforeComplete } = opts;
  const io = attach(socket);
  try {
    const enq = await io.nextEvent(enqTimeoutMs);
    if (enq.type !== 'ENQ') return { ok: false, reason: enq.type === 'TIMEOUT' ? 'timeout' : `unexpected-${enq.type.toLowerCase()}` };
    socket.write(Buffer.from([busy ? NAK : ACK]));
    if (busy) return { ok: false, reason: 'busy' };
    return await receiveFrameLoop(io, socket, { frameTimeoutMs, onBeforeComplete });
  } finally {
    io.detach();
  }
}

// Act as the ASTM sender: ENQ, wait for ACK, send frames (retrying up to maxRetries times on
// NAK/timeout), then EOT. Contention: if the instrument also sends ENQ instead of answering
// ours, this host yields - ACKs their ENQ and receives their transmission instead - and
// reports {ok:false, reason:'contention', incoming}. Callers should wait contentionDelayMs
// before retrying their own send (>=20s per spec; configurable, short in tests).
export async function sendTransmission(socket, records, opts = {}) {
  const { enqTimeoutMs = 15000, frameAckTimeoutMs = 15000, maxRetries = 6 } = opts;
  const io = attach(socket);
  try {
    socket.write(Buffer.from([ENQ]));
    const first = await io.nextEvent(enqTimeoutMs);
    if (first.type === 'ENQ') {
      socket.write(Buffer.from([ACK]));
      const incoming = await receiveFrameLoop(io, socket, { frameTimeoutMs: opts.frameTimeoutMs ?? 30000, onBeforeComplete: opts.onBeforeComplete });
      return { ok: false, reason: 'contention', incoming };
    }
    if (first.type !== 'ACK') return { ok: false, reason: first.type === 'NAK' ? 'establishment-nak' : `unexpected-${first.type.toLowerCase()}` };

    const frames = frameRecords(records);
    let seq = 1;
    for (const f of frames) {
      let sent = false;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        socket.write(encodeFrame(seq, f.text, f.terminator));
        const resp = await io.nextEvent(frameAckTimeoutMs);
        if (resp.type === 'ACK') { sent = true; break; }
        // NAK, TIMEOUT, or an unexpected event: retry the same frame.
      }
      if (!sent) { socket.write(Buffer.from([EOT])); return { ok: false, reason: 'max-retries-exceeded' }; }
      seq = nextFrameNumber(seq);
    }
    socket.write(Buffer.from([EOT]));
    return { ok: true };
  } finally {
    io.detach();
  }
}

// --- E1394 / LIS02-A2 record parsing and building -------------------------------------

export function parseDelimiters(hRecordText) {
  if (!hRecordText || hRecordText[0] !== 'H') return { field: '|', repeat: '\\', component: '^', escape: '&' };
  const fieldSep = hRecordText[1] || '|';
  const defs = hRecordText.slice(2).split(fieldSep)[0] || '\\^&';
  return { field: fieldSep, repeat: defs[0] || '\\', component: defs[1] || '^', escape: defs[2] || '&' };
}

function comp(value, sep, n) {
  if (!value) return '';
  return value.split(sep)[n - 1] ?? '';
}

function mapAstmStatus(code) {
  if (code === 'F') return 'final';
  if (code === 'P') return 'preliminary';
  if (code === 'C') return 'corrected';
  return null; // X ("cannot be done") or anything else: not a value, dropped by caller
}

// Extract per-specimen results from a full set of records (H..L). Specimen id comes from the
// most recent O record's O-3. R records before any O are unmappable and dropped (counted).
export function extractResults(records) {
  const hRecord = records.find((r) => r[0] === 'H');
  const delims = parseDelimiters(hRecord);
  let currentSpecimenId = null;
  const specimens = new Map();
  let droppedResults = 0;
  for (const rec of records) {
    const seg = rec.split(delims.field);
    const type = seg[0];
    if (type === 'O') {
      currentSpecimenId = seg[2] || null; // O-3
    } else if (type === 'R') {
      if (!currentSpecimenId) { droppedResults += 1; continue; }
      const status = mapAstmStatus(seg[8]); // R-9
      // No status we can file, or no value: counted, never sent (the server would refuse the whole specimen).
      if (!status || !seg[3]) { droppedResults += 1; continue; }
      const testId = comp(seg[2], delims.component, 4) || comp(seg[2], delims.component, 1); // R-3
      if (!specimens.has(currentSpecimenId)) specimens.set(currentSpecimenId, { specimenId: currentSpecimenId, observedAt: null, results: [] });
      const group = specimens.get(currentSpecimenId);
      const observedAt = toIso(seg[12]) || toIso(seg[11]); // R-13 completed, else R-12 started; YYYYMMDDHHMMSS
      if (!group.observedAt) group.observedAt = observedAt;
      group.results.push({
        instrumentCode: testId,
        value: seg[3] ?? '', // R-4
        unit: seg[4] || null, // R-5
        referenceRange: seg[5] || null, // R-6
        flags: seg[6] || null, // R-7
        status,
      });
    }
  }
  return { specimens: [...specimens.values()], droppedResults };
}

export function hasQueryRecord(records) {
  return records.some((r) => r[0] === 'Q');
}

// Q-3 is the starting range id; the specimen id is its second component.
export function extractQuerySpecimenIds(records) {
  const hRecord = records.find((r) => r[0] === 'H');
  const delims = parseDelimiters(hRecord);
  const ids = [];
  for (const rec of records) {
    const seg = rec.split(delims.field);
    if (seg[0] === 'Q') {
      const id = comp(seg[2], delims.component, 2);
      if (id) ids.push(id);
    }
  }
  return ids;
}

export function buildHRecord({ sender = 'STEWARDMD' } = {}) {
  return `H|\\^&|||${sender}|||||||P|1`;
}

export function buildPRecord(seq) {
  return `P|${seq}`;
}

export function buildORecord(seq, { specimenId, testCodes, priority = '', reportType = '' }) {
  const fields = new Array(26).fill('');
  fields[0] = 'O';
  fields[1] = String(seq);
  fields[2] = specimenId; // O-3
  fields[4] = testCodes.map((c) => `^^^${c}`).join('\\'); // O-5
  fields[5] = priority; // O-6
  fields[25] = reportType; // O-26
  return fields.join('|');
}

export function buildLRecord(code = 'N', seq = 1) {
  return `L|${seq}|${code}`;
}

// Build the host's answer to an ASTM Q (query) record: H, then P/O per matched specimen
// (O-26 'Q' = query response, O-6 S stat / A ASAP / R routine), then L. If the server could not
// be reached, or has no order on record for any of the queried specimens, answer H then L with
// termination code 'I' (no information available) rather than claim a normal completion. A
// message always starts with its H record.
const ASTM_PRIORITY = { stat: 'S', urgent: 'A', routine: 'R' };
export function buildQueryResponse(specimenIds, orders) {
  const matched = (orders || []).filter((o) => specimenIds.includes(o.specimenId));
  if (!orders || matched.length === 0) return [buildHRecord(), buildLRecord('I', 1)];
  const out = [buildHRecord()];
  matched.forEach((order, i) => {
    const seq = i + 1;
    out.push(buildPRecord(seq));
    out.push(buildORecord(seq, { specimenId: order.specimenId, testCodes: order.tests.map((t) => t.instrumentCode), priority: ASTM_PRIORITY[order.priority] || 'R', reportType: 'Q' }));
  });
  out.push(buildLRecord('N', 1));
  return out;
}

// Full host-query flow: given the records of the instrument's completed query transmission,
// ask the server for orders and send the response back over the same socket as a new,
// host-initiated transmission.
export async function answerHostQuery(socket, incomingRecords, { fetchOrders, sendOpts } = {}) {
  const specimenIds = extractQuerySpecimenIds(incomingRecords);
  let orders = null;
  try { orders = await fetchOrders(specimenIds); } catch { orders = null; }
  const records = buildQueryResponse(specimenIds, orders);
  return sendTransmission(socket, records, sendOpts);
}
