// HL7 v2 over MLLP (Minimal Lower Layer Protocol).
//
// Framing verified against:
// - https://en.wikipedia.org/wiki/Minimal_Lower_Layer_Protocol
//     start block VT (0x0B), HL7 payload, end block FS (0x1C) followed by CR (0x0D).
// - https://www.hl7.org/documentcenter/public/wg/inm/mllp_transport_specification.PDF
//     "Transport Specification: MLLP, Release 1" - the official HL7 source for the above.
// - https://saga-it.com/docs/hl7/reference/mllp
//     corroborates VT/FS/CR framing and general ACK usage.
// HL7 v2 itself: segments are CR-separated, fields pipe-separated, MSH-2 carries the
// encoding characters (component/repetition/escape/subcomponent), ACK MSA-1/MSA-2 and
// MSH-9 (ACK^<trigger>^ACK) construction is standard HL7 v2 ACK practice.

const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;

// Streaming decoder: feed raw TCP chunks in, get back zero or more complete HL7 message
// strings. Handles a message split across chunks and several messages coalesced into one
// chunk. Bytes seen before the first VT of a block (framing garbage, stray control bytes)
// are discarded, per MLLP being a byte-stream framing protocol with no other semantics.
export function createMllpDecoder() {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      const messages = [];
      for (;;) {
        const start = buf.indexOf(VT);
        if (start === -1) { buf = Buffer.alloc(0); break; }
        if (start > 0) buf = buf.subarray(start);
        const end = buf.indexOf(FS, 1);
        if (end === -1) break; // incomplete block, wait for more data
        const payload = buf.subarray(1, end);
        let consumed = end + 1;
        if (buf[consumed] === CR) consumed += 1; // FS is normally followed by CR
        messages.push(payload.toString('utf8'));
        buf = buf.subarray(consumed);
      }
      return messages;
    },
  };
}

export function encodeMllp(hl7Text) {
  return Buffer.concat([Buffer.from([VT]), Buffer.from(hl7Text, 'utf8'), Buffer.from([FS, CR])]);
}

// Parse raw HL7 v2 text into CR-separated segments, each split into fields. MSH is special:
// MSH-1 is the field separator character itself (not a field boundary), so segments[0][0]
// is the literal string 'MSH' as a placeholder and segments[0][n-1] is MSH-n for n>=2. Every
// other segment type has segments[k][0] equal to the 3-letter segment name (not a field) and
// segments[k][n] is that segment's field n.
export function parseHl7(message) {
  const raw = String(message).replace(/\r?\n/g, '\r');
  const lines = raw.split('\r').filter((s) => s.length > 0);
  if (!lines.length || !lines[0].startsWith('MSH')) throw new Error('not an HL7 message: missing MSH segment');
  const fieldSep = lines[0][3];
  const enc = lines[0].slice(4, 8); // e.g. ^~\&
  const componentSep = enc[0] || '^';
  const repetitionSep = enc[1] || '~';
  const escapeChar = enc[2] || '\\';
  const subcomponentSep = enc[3] || '&';
  const segments = lines.map((line) => {
    if (line.startsWith('MSH')) return ['MSH', ...line.slice(4).split(fieldSep)];
    return line.split(fieldSep);
  });
  return { segments, fieldSep, componentSep, repetitionSep, escapeChar, subcomponentSep };
}

export function fieldOf(seg, isMsh, n) {
  if (!seg) return '';
  return (isMsh ? seg[n - 1] : seg[n]) ?? '';
}

export function component(value, sep, n) {
  if (!value) return '';
  return value.split(sep)[n - 1] ?? '';
}

export function decodeEscapes(value, delims) {
  const esc = delims.escapeChar;
  if (!value || !esc || value.indexOf(esc) === -1) return value;
  const escRe = esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const map = { F: delims.fieldSep, S: delims.componentSep, T: delims.subcomponentSep, R: delims.repetitionSep, E: esc };
  const re = new RegExp(`${escRe}([FSTRE])${escRe}`, 'g');
  return value.replace(re, (whole, code) => map[code] ?? whole);
}

function hl7Timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

let ackCounter = 0;
function nextAckControlId() {
  ackCounter = (ackCounter + 1) % 1e9;
  return `ACK${Date.now().toString(36)}${ackCounter}`;
}

// MSA-1 = ackCode, MSA-2 = MSH-10 of the original message. MSH-9 of the ACK is
// ACK^<trigger>^ACK per contract.
export function buildAck(originalMessage, { ackCode = 'AA', textMessage, sendingApp = 'STEWARDMD', sendingFacility = 'STEWARDMD' } = {}) {
  const { segments } = parseHl7(originalMessage);
  const msh = segments[0];
  const controlId = fieldOf(msh, true, 10);
  const messageType = fieldOf(msh, true, 9);
  const trigger = messageType.split('^')[1] || 'R01';
  const origSendingApp = fieldOf(msh, true, 3);
  const origSendingFacility = fieldOf(msh, true, 4);
  const ackMsh = ['MSH', '^~\\&', sendingApp, sendingFacility, origSendingApp, origSendingFacility,
    hl7Timestamp(), '', `ACK^${trigger}^ACK`, nextAckControlId(), 'P', '2.5.1'].join('|');
  const msaFields = ['MSA', ackCode, controlId];
  if (textMessage) msaFields.push(textMessage);
  return `${ackMsh}\r${msaFields.join('|')}\r`;
}

// MSH-9 (message type) of an HL7 message, without assuming its structure - used to route
// ORU vs query messages before committing to a specific parser.
export function peekMessageType(message) {
  const { segments } = parseHl7(message);
  const raw = fieldOf(segments[0], true, 9);
  const [type = '', trigger = ''] = raw.split('^');
  return { type, trigger, controlId: fieldOf(segments[0], true, 10) };
}

function mapHl7Status(code) {
  if (code === 'F') return 'final';
  if (code === 'P' || code === 'R' || code === 'S' || code === 'I') return 'preliminary';
  if (code === 'C') return 'corrected';
  return null; // anything else (e.g. X) is dropped by the caller
}

// YYYYMMDD[HHMM[SS[.S+]]][+/-ZZZZ] (HL7 DTM, and the same shape in ASTM E1394) to an ISO instant. With an explicit
// offset it is honoured; without one the instrument's clock is local time, and this connector runs on the laboratory's
// own network in the same time zone, so it is read as this machine's local time rather than silently as UTC.
export function toIso(dtm) {
  if (!dtm) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2})(?:\.\d+)?)?)?([+-]\d{4})?$/.exec(String(dtm).trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', off] = m;
  const date = off
    ? new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${off.slice(0, 3)}:${off.slice(3)}`)
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Parse an ORU^R01 message into one entry per specimen. Specimen id: SPM-2 first component
// if an SPM segment is present, else the OBR-3 filler order number first component, else the
// OBR-2 placer order number first component. Results with an unmapped OBX-11 status (X, or
// anything not F/P/R/S/I/C) are dropped and counted in droppedResults rather than sent.
export function parseOruR01(message) {
  const { segments, componentSep, escapeChar, fieldSep, repetitionSep, subcomponentSep } = parseHl7(message);
  const delims = { fieldSep, componentSep, escapeChar, repetitionSep, subcomponentSep };
  const msh = segments[0];
  if (peekMessageType(message).type !== 'ORU') throw new Error('not an ORU message');
  const messageControlId = fieldOf(msh, true, 10);

  const specimens = new Map();
  let currentSpmId = null;
  let spmUsedForCurrentGroup = false; // SPM can precede or follow its OBR; only drop it once
  // the group it belongs to has actually consumed it, so an OBR-then-SPM message keeps
  // working too.
  let currentObr = null;
  let droppedResults = 0;

  for (const seg of segments) {
    const type = seg[0];
    if (type === 'SPM') {
      currentSpmId = component(fieldOf(seg, false, 2), componentSep, 1) || null;
      spmUsedForCurrentGroup = false;
    } else if (type === 'OBR') {
      if (spmUsedForCurrentGroup) currentSpmId = null; // that SPM belonged to the prior group
      spmUsedForCurrentGroup = false;
      const filler = component(fieldOf(seg, false, 3), componentSep, 1);
      const placer = component(fieldOf(seg, false, 2), componentSep, 1);
      currentObr = { filler, placer, obr7: fieldOf(seg, false, 7) };
    } else if (type === 'OBX') {
      if (!currentObr) continue;
      const specimenId = currentSpmId || currentObr.filler || currentObr.placer;
      spmUsedForCurrentGroup = true;
      if (!specimenId) continue;
      const rawStatus = fieldOf(seg, false, 11);
      const status = mapHl7Status(rawStatus);
      // A result with no value is not a result: counted, never sent (the server would refuse the whole specimen).
      if (!status || !fieldOf(seg, false, 5)) { droppedResults += 1; continue; }
      const code = component(fieldOf(seg, false, 3), componentSep, 1);
      const unit = component(fieldOf(seg, false, 6), componentSep, 1);
      const observedAt = toIso(fieldOf(seg, false, 14)) || toIso(currentObr.obr7) || null;
      if (!specimens.has(specimenId)) specimens.set(specimenId, { specimenId, observedAt: null, results: [] });
      const group = specimens.get(specimenId);
      if (!group.observedAt) group.observedAt = observedAt;
      group.results.push({
        instrumentCode: decodeEscapes(code, delims),
        value: decodeEscapes(fieldOf(seg, false, 5), delims),
        unit: unit ? decodeEscapes(unit, delims) : null,
        referenceRange: fieldOf(seg, false, 7) ? decodeEscapes(fieldOf(seg, false, 7), delims) : null,
        flags: fieldOf(seg, false, 8) ? decodeEscapes(fieldOf(seg, false, 8), delims) : null,
        status,
      });
    }
  }
  return { messageControlId, specimens: [...specimens.values()], droppedResults };
}
