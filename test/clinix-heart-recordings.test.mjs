/* test/clinix-heart-recordings.test.mjs - the recorded heart-sound reference clip in the Sound Lab.
 * The data is eight labelled segments of ONE AAC file; a wrong offset plays the wrong sound under the wrong label,
 * which is the failure that matters for teaching. node --test test/clinix-heart-recordings.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = createRequire(import.meta.url)(join(ROOT, "clinix-audio.js"));
const aac = readFileSync(join(ROOT, "clinix/audio/heart-sounds.aac"));

function adtsSeconds(buf) {   // count ADTS frames (1024 samples at 44.1 kHz)
  let i = 0, frames = 0;
  while (i + 7 < buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xf6) !== 0xf0) { i++; continue; }
    const len = ((buf[i + 3] & 3) << 11) | (buf[i + 4] << 3) | (buf[i + 5] >> 5);
    if (len < 7) break;
    frames++; i += len;
  }
  return frames * 1024 / 44100;
}

test("the clip is a real ADTS AAC file and is long enough for every segment", () => {
  assert.ok(aac.length > 1e6);
  const secs = adtsSeconds(aac);
  const last = Math.max(...A.RECORDINGS.map((r) => r.end));
  assert.ok(secs >= last, `clip is ${secs.toFixed(1)} s, last segment ends at ${last}`);
});

test("eight segments: S1 S2 S3 S4 and four murmurs, in order, non-overlapping, each registered as a sound kind", () => {
  assert.deepEqual(A.RECORDINGS.map((r) => r.id), ["s1", "s2", "s3", "s4", "as", "mr", "ms", "ar"]);
  let prev = 0;
  for (const r of A.RECORDINGS) {
    assert.ok(r.start >= prev && r.end > r.start + 3, r.id + " segment is out of order or too short");
    prev = r.end;
    const k = A.KINDS["rec_" + r.id];
    assert.ok(k && k.recording === true && k.seg.start === r.start && k.seg.end === r.end, r.id + " kind");
    assert.equal(A.has("rec_" + r.id), true);
    const fr = r.marks.map((m) => m[1]);
    assert.deepEqual([...fr].sort((a, b) => a - b), fr, r.id + " markers must be in time order");
    assert.ok(fr.every((x) => x > 0 && x < 1), r.id + " marker outside the segment");
  }
});

test("each lesson label matches what the marker names say (S3 has an S3 marker, S4 an S4 marker)", () => {
  const marks = (id) => A.RECORDINGS.find((r) => r.id === id).marks.map((m) => m[0]);
  assert.ok(marks("s3").includes("S3") && marks("s4").includes("S4"));
  assert.deepEqual(marks("s1"), ["S1", "S2"]);
  assert.deepEqual(marks("s4"), ["S4", "S1", "S2"], "S4 comes BEFORE S1 in the cycle");
});

test("recordings are registered as recordings with a credit, never as synthesized", () => {
  const meta = A.getAudioMetadata("rec_s3");
  assert.equal(meta.type, "recording");
  assert.ok(/Supplied by StewardMD/.test(meta.license));
  assert.ok(A.REC_CREDIT.length > 10);
  assert.equal(A.getAudioMetadata("s3_gallop").type, "synthetic", "the synthesized sounds are unchanged");
});

test("no dashes in the text the student reads", () => {
  for (const r of A.RECORDINGS) assert.equal((r.label + r.desc + r.cue).search(/[–—]/), -1, r.id);
});
