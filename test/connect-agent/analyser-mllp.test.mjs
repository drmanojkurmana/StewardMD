// Tests for connect-agent/analyser/mllp.mjs (HL7 v2 over MLLP).
//
// Spec verified against:
// - https://en.wikipedia.org/wiki/Minimal_Lower_Layer_Protocol
// - https://www.hl7.org/documentcenter/public/wg/inm/mllp_transport_specification.PDF
// - https://saga-it.com/docs/hl7/reference/mllp
//   -> VT(0x0B)...FS(0x1C)CR(0x0D) framing; ACK MSA-1/MSA-2 + MSH-9 ACK^<trigger>^ACK.
//
// Run: node --test --test-concurrency=1 test/connect-agent/analyser-mllp.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createMllpDecoder, encodeMllp, buildAck, parseOruR01, peekMessageType, decodeEscapes, toIso,
} from '../../connect-agent/analyser/mllp.mjs';

const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;
const FIXTURE = path.join(import.meta.dirname, 'fixtures/analyser/sample-oru.hl7');

const SAMPLE_MSG = 'MSH|^~\\&|A|B|C|D|20260101000000||ORU^R01^ORU_R01|CTRL1|P|2.5.1\rMSA|AA|X\r';

test('decoder reassembles a message split across chunks', () => {
  const decoder = createMllpDecoder();
  const full = encodeMllp(SAMPLE_MSG);
  const mid = Math.floor(full.length / 2);
  assert.deepEqual(decoder.push(full.subarray(0, mid)), []);
  const out = decoder.push(full.subarray(mid));
  assert.equal(out.length, 1);
  assert.equal(out[0], SAMPLE_MSG);
});

test('decoder splits coalesced messages in one chunk and discards leading garbage', () => {
  const decoder = createMllpDecoder();
  const garbage = Buffer.from([0x00, 0x01, 0x02]);
  const chunk = Buffer.concat([garbage, encodeMllp(SAMPLE_MSG), encodeMllp(SAMPLE_MSG)]);
  const out = decoder.push(chunk);
  assert.equal(out.length, 2);
  assert.equal(out[0], SAMPLE_MSG);
  assert.equal(out[1], SAMPLE_MSG);
});

test('encodeMllp wraps with VT ... FS CR', () => {
  const buf = encodeMllp('hi');
  assert.equal(buf[0], VT);
  assert.equal(buf[buf.length - 2], FS);
  assert.equal(buf[buf.length - 1], CR);
});

test('buildAck produces MSA|AA|<control id> and MSH-9 ACK^R01^ACK', () => {
  const ack = buildAck(SAMPLE_MSG, { ackCode: 'AA' });
  assert.match(ack, /MSA\|AA\|CTRL1\r/);
  assert.match(ack, /\|ACK\^R01\^ACK\|/);
});

test('buildAck supports AE (enqueue failure) and AR (unsupported/query) with a text message', () => {
  const ae = buildAck(SAMPLE_MSG, { ackCode: 'AE', textMessage: 'queue write failed' });
  assert.match(ae, /MSA\|AE\|CTRL1\|queue write failed\r/);
  const ar = buildAck(SAMPLE_MSG, { ackCode: 'AR', textMessage: 'host query over HL7 is not supported by this connector' });
  assert.match(ar, /MSA\|AR\|CTRL1\|host query over HL7 is not supported by this connector\r/);
});

test('peekMessageType routes ORU vs a query message without assuming ORU structure', () => {
  assert.deepEqual(peekMessageType(SAMPLE_MSG), { type: 'ORU', trigger: 'R01', controlId: 'CTRL1' });
  const qry = 'MSH|^~\\&|A|B|C|D|20260101000000||QRY^Q01|CTRL2|P|2.5.1\r';
  assert.deepEqual(peekMessageType(qry), { type: 'QRY', trigger: 'Q01', controlId: 'CTRL2' });
});

test('decodeEscapes handles \\F\\ \\S\\ \\T\\ \\R\\ \\E\\', () => {
  const delims = { fieldSep: '|', componentSep: '^', subcomponentSep: '&', repetitionSep: '~', escapeChar: '\\' };
  assert.equal(decodeEscapes('a\\F\\b', delims), 'a|b');
  assert.equal(decodeEscapes('a\\S\\b', delims), 'a^b');
  assert.equal(decodeEscapes('a\\T\\b', delims), 'a&b');
  assert.equal(decodeEscapes('a\\R\\b', delims), 'a~b');
  assert.equal(decodeEscapes('a\\E\\b', delims), 'a\\b');
});

test('a recorded ORU^R01 fixture parses into two per-specimen payloads', async () => {
  const raw = await readFile(FIXTURE, 'utf8');
  const parsed = parseOruR01(raw);
  assert.equal(parsed.messageControlId, 'MSG00001');
  assert.equal(parsed.droppedResults, 1); // the X-status potassium OBX
  assert.equal(parsed.specimens.length, 2);

  const [spec1, spec2] = parsed.specimens;
  assert.equal(spec1.specimenId, 'SPEC001');
  assert.equal(spec1.results.length, 2);
  assert.deepEqual(spec1.results[0], {
    instrumentCode: 'GLU', value: '98', unit: 'mg/dL', referenceRange: '70-110', flags: 'N', status: 'final',
  });
  // OBX #2's value carries an escaped component separator (\S\ -> ^).
  assert.equal(spec1.results[1].value, 'Note^Extra');
  assert.equal(spec1.results[1].status, 'final');

  assert.equal(spec2.specimenId, 'SPEC002');
  assert.equal(spec2.results.length, 1);
  assert.equal(spec2.results[0].instrumentCode, 'CREA');
});

test('parseOruR01 rejects a non-ORU message', () => {
  const qry = 'MSH|^~\\&|A|B|C|D|20260101000000||QRY^Q01|CTRL2|P|2.5.1\r';
  assert.throws(() => parseOruR01(qry), /not an ORU message/);
});

test('toIso honours an explicit offset and reads a bare timestamp as local laboratory time', () => {
  assert.equal(toIso('20260916083000+0530'), '2026-09-16T03:00:00.000Z');
  assert.equal(toIso('202609160830'), new Date(2026, 8, 16, 8, 30, 0).toISOString());
  assert.equal(toIso('not a date'), null);
});
